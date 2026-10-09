import { Scene, TransformNode, Vector3 } from '@babylonjs/core';
import { AssetLoader, ImportedAsset } from '../../assets/AssetLoader';
import type { HitReceiver, SaberHitEvent } from '../../combat/HitReceiver';
import { TATOOINE_ACTORS, TatooineActorId, TatooineActorPlacement, tatooineActorUrl } from './TatooineActorCatalog';

/** One scene-owned imported actor. No generated animation or simulated attack. */
export class TatooineActor implements HitReceiver {
  readonly position: Vector3;
  readonly radius: number;
  readonly maxHealth: number;
  readonly root: TransformNode;
  currentHealth: number;
  isAlive = true;
  private elapsed = 0;
  private walking = false;
  private constructor(readonly placement: TatooineActorPlacement, private readonly asset: ImportedAsset,
    private readonly onDefeated: (actor: TatooineActor) => void, scene: Scene) {
    const config = TATOOINE_ACTORS[placement.actor];
    this.radius = config.radius; this.maxHealth = config.hp; this.currentHealth = config.hp;
    this.position = new Vector3(placement.x, 0, placement.z);
    this.root = new TransformNode(`w224_${placement.id}`, scene);
    this.root.position.copyFrom(this.position);
    this.root.rotation.y = placement.yaw ?? 0;
    const min = new Vector3(Infinity, Infinity, Infinity), max = new Vector3(-Infinity, -Infinity, -Infinity);
    for (const mesh of asset.meshes) {
      if (!mesh.getTotalVertices()) continue;
      mesh.computeWorldMatrix(true);
      const bounds = mesh.getBoundingInfo().boundingBox;
      min.minimizeInPlace(bounds.minimumWorld); max.maximizeInPlace(bounds.maximumWorld);
    }
    const nativeHeight = max.y - min.y;
    if (!Number.isFinite(nativeHeight) || nativeHeight < 0.1) throw new Error(`W224 invalid actor bounds: ${placement.id}`);
    const scale = config.height / nativeHeight;
    asset.root.scaling.setAll(scale);
    asset.root.position.set(-(min.x + max.x) * 0.5 * scale, -min.y * scale, -(min.z + max.z) * 0.5 * scale);
    asset.root.parent = this.root;
    for (const mesh of asset.meshes) {
      mesh.isPickable = false;
      mesh.metadata = { ...mesh.metadata, w224Actor: placement.id };
    }
    const clip = asset.animationGroups.find(group => group.name === config.animation);
    if (!clip) throw new Error(`W224 missing clip ${config.animation} on ${placement.id}`);
    asset.animationGroups.forEach(group => group.stop());
    if (config.mode === 'idle') clip.start(true);
    else { clip.start(false); clip.pause(); clip.goToFrame(clip.from); }
  }
  static async load(placement: TatooineActorPlacement, loader: AssetLoader, scene: Scene, staged: boolean,
    onDefeated: (actor: TatooineActor) => void) {
    const asset = await loader.load(tatooineActorUrl(placement.actor, staged), scene);
    try { return new TatooineActor(placement, asset, onDefeated, scene); }
    catch (error) { asset.dispose(); throw error; }
  }
  /** Bantha alone does a bounded, slow demonstration wander on flat hub floor. */
  update(dt: number) {
    if (!this.isAlive || this.placement.actor !== 'bantha') return;
    this.elapsed = Math.min(6, this.elapsed + dt);
    const clip = this.asset.animationGroups[0];
    const walking = this.elapsed >= 4 && this.elapsed < 6;
    if (walking) {
      if (!this.walking) { clip.play(true); this.walking = true; }
      const offset = (this.elapsed - 4) * 0.23;
      this.root.position.z = this.position.z + offset;
    } else {
      if (this.walking) { clip.pause(); this.walking = false; }
      if (this.elapsed >= 6) this.root.position.z = this.position.z + 0.46;
      else this.root.position.z = this.position.z;
    }
  }
  face(target: Vector3) {
    const dx = target.x - this.root.position.x, dz = target.z - this.root.position.z;
    if (dx * dx + dz * dz > 0.0001) this.root.rotation.y = Math.atan2(dx, dz);
  }
  receiveSaberHit(event: SaberHitEvent) {
    if (!this.isAlive || !TATOOINE_ACTORS[this.placement.actor].hostile) return;
    // Both saber controllers enforce one hit per target per swing in ACTIVE.
    this.currentHealth = Math.max(0, this.currentHealth - Math.max(0, event.damage ?? event.power));
    console.info('[W224] HOSTILE HIT', { id: this.placement.id, hp: this.currentHealth, attack: event.attackId });
    if (this.currentHealth === 0) {
      this.isAlive = false;
      this.root.setEnabled(false); // Donor has no verified death animation.
      this.onDefeated(this);
    }
  }
  dispose() { this.asset.dispose(); this.root.dispose(); }
}
