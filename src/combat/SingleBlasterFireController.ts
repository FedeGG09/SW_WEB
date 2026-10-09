import { AnimationGroup, Scene, Vector3 } from '@babylonjs/core';
import type { AssetLoader, ImportedAsset } from '../assets/AssetLoader';
import { BlasterProjectileManager, type BlasterProjectile } from './BlasterProjectile';
import type { SaberProjectileInterceptor } from './SaberProjectileInterceptor';
import type { BlasterWeaponAttachment } from './BlasterWeaponAttachment';
import type { HostileMercenaryProfile } from '../party/tactical/HostileMercenaryProfile';

export type BlasterFirePhase = 'READY' | 'FACE' | 'FIRE_ANIMATION' | 'RELEASE' | 'PROJECTILE_ACTIVE' | 'RECOVER' | 'CANCELLED';

export type BlasterFireCallbacks = {
  isShooterAlive: () => boolean;
  isTargetAlive: (targetId: string) => boolean;
  onRelease?: (projectile: BlasterProjectile) => void;
  onComplete?: () => void;
};

/** One-shot native JKA fire lifecycle. It never acquires targets or repeats fire. */
export class SingleBlasterFireController {
  readonly projectileManager: BlasterProjectileManager;
  phase: BlasterFirePhase = 'READY';
  targetId: string | null = null;
  targetPoint: Vector3 | null = null;
  elapsedSeconds = 0;
  releaseCount = 0;
  requestCount = 0;
  cancelledCount = 0;
  lastReason = 'INITIAL_READY';
  private fireGroup: AnimationGroup | null = null;
  private projectile: BlasterProjectile | null = null;
  private paused = false;

  constructor(
    private readonly scene: Scene,
    private readonly actorId: string,
    private readonly asset: ImportedAsset,
    private readonly weapon: BlasterWeaponAttachment,
    private readonly profile: HostileMercenaryProfile,
    private readonly callbacks: BlasterFireCallbacks,
  ) {
    this.projectileManager = new BlasterProjectileManager(scene);
  }

  requestSingleShot(targetId: string, targetPoint: Vector3) {
    this.requestCount++;
    if (!this.callbacks.isShooterAlive()) return { accepted: false as const, reason: 'DEAD_ACTOR' };
    if (this.phase !== 'READY') return { accepted: false as const, reason: 'SHOT_LIFECYCLE_ACTIVE' };
    this.targetId = targetId;
    this.targetPoint = targetPoint.clone();
    this.elapsedSeconds = 0;
    this.releaseCount = 0;
    this.phase = 'FIRE_ANIMATION';
    this.lastReason = 'FIRE_REQUEST_ACCEPTED';
    this.fireGroup = this.asset.animationGroups.find(group => group.name === this.profile.groups.fire) ?? null;
    if (!this.fireGroup) {
      this.phase = 'CANCELLED';
      this.lastReason = 'FIRE_GROUP_MISSING';
      this.cancelledCount++;
      return { accepted: false as const, reason: 'FIRE_GROUP_MISSING' };
    }
    this.asset.animationGroups.forEach(group => group.stop());
    this.fireGroup.start(false, 1);
    return { accepted: true as const, reason: 'QUEUED' };
  }

  update(deltaSeconds: number, paused: boolean) {
    if (this.phase === 'READY' || this.phase === 'CANCELLED') return;
    if (paused) {
      if (!this.paused) this.fireGroup?.pause();
      this.paused = true;
      return;
    }
    if (this.paused) {
      this.fireGroup?.play(false);
      this.paused = false;
    }
    const dt = Math.max(0, Math.min(0.1, deltaSeconds));
    this.elapsedSeconds += dt;
    const releaseSeconds = (this.profile.weapon.fireReleaseFrame - this.profile.weapon.fireAnimationStartFrame) / this.profile.weapon.fireAnimationFps;
    const animationSeconds = this.profile.weapon.fireAnimationFrameCount / this.profile.weapon.fireAnimationFps;
    if (this.phase === 'FIRE_ANIMATION' && this.elapsedSeconds >= releaseSeconds) {
      if (!this.callbacks.isShooterAlive()) {
        this.cancel('DEAD_ACTOR_BEFORE_RELEASE');
      } else if (!this.targetId || !this.targetPoint || !this.callbacks.isTargetAlive(this.targetId)) {
        this.cancel('TARGET_DEAD_BEFORE_RELEASE');
      } else {
        const origin = this.weapon.getMuzzleWorldPosition();
        const direction = this.weapon.getForwardWorld(this.targetPoint);
        this.projectile = this.projectileManager.spawn({
          ownerActorId: this.actorId,
          targetActorId: this.targetId,
          origin,
          direction,
          speedMps: this.profile.weapon.projectileSpeedMps,
          damage: this.profile.weapon.damage,
          maxLifetimeSeconds: this.profile.weapon.maxLifetimeSeconds,
          maxDistanceM: this.profile.weapon.maxDistanceM,
        });
        this.releaseCount++;
        this.phase = 'PROJECTILE_ACTIVE';
        this.lastReason = 'PROJECTILE_RELEASED';
        this.callbacks.onRelease?.(this.projectile);
      }
    }
    if (this.phase === 'PROJECTILE_ACTIVE' && this.elapsedSeconds >= animationSeconds) {
      this.phase = 'RECOVER';
    }
    if (this.phase === 'RECOVER') {
      this.asset.animationGroups.forEach(group => group.stop());
      const ready = this.asset.animationGroups.find(group => group.name === this.profile.groups.weaponReady || group.name === this.profile.groups.idle);
      if (ready) ready.start(true, 1);
      this.phase = 'READY';
      this.lastReason = 'RECOVERED_READY';
      this.targetId = null;
      this.targetPoint = null;
      this.fireGroup = null;
      this.projectile = null;
      this.callbacks.onComplete?.();
    }
  }

  updateProjectile(deltaSeconds: number, actors: Parameters<BlasterProjectileManager['update']>[1], worldHitTest: Parameters<BlasterProjectileManager['update']>[2], paused: boolean, interceptor?: SaberProjectileInterceptor | null) {
    this.projectileManager.update(deltaSeconds, actors, worldHitTest, paused, interceptor);
  }

  cancel(reason: string) {
    if (this.phase === 'READY' || this.phase === 'CANCELLED') return;
    this.fireGroup?.stop();
    this.phase = 'CANCELLED';
    this.lastReason = reason;
    this.cancelledCount++;
    this.targetId = null;
    this.targetPoint = null;
    this.fireGroup = null;
    this.projectile = null;
  }

  reset() {
    this.cancel('RESET');
    this.phase = 'READY';
    this.elapsedSeconds = 0;
    this.projectileManager.clear();
  }

  telemetry() {
    return {
      actorId: this.actorId,
      phase: this.phase,
      targetId: this.targetId,
      targetPoint: this.targetPoint?.asArray() ?? null,
      elapsedSeconds: this.elapsedSeconds,
      releaseCount: this.releaseCount,
      requestCount: this.requestCount,
      cancelledCount: this.cancelledCount,
      lastReason: this.lastReason,
      fireAnimationGroup: this.profile.groups.fire,
      fireReleaseFrame: this.profile.weapon.fireReleaseFrame,
      fireAnimationDurationSeconds: this.profile.weapon.fireAnimationFrameCount / this.profile.weapon.fireAnimationFps,
      projectile: this.projectile?.telemetry() ?? null,
      projectiles: this.projectileManager.telemetry(),
      weapon: this.weapon.telemetry(this.targetPoint ?? undefined),
    };
  }

  dispose() {
    this.fireGroup?.stop();
    this.projectileManager.dispose();
  }
}
