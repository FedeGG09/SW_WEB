import { Color3, MeshBuilder, Scene, StandardMaterial, TransformNode, Vector3 } from '@babylonjs/core';
import { AssetLoader, ImportedAsset } from '../assets/AssetLoader';
import { PlayerController } from '../player/PlayerController';
import { AttackDirection } from './AttackDirectionResolver';
import { CombatActor, GuardState, StaggerState } from './CombatActor';
import { HitReceiver, SaberHitEvent } from './HitReceiver';
import { SaberWeapon, SaberWeaponConfig } from './SaberWeapon';
import { StaggerController, StaggerKind } from './StaggerController';
import { alignVisualFeetToGround, measureVisualBounds } from '../world/CharacterGrounding';

export type DuelistState = 'IDLE' | 'APPROACH' | 'CIRCLE' | 'ASSESS' | 'ATTACK' | 'BLOCK' | 'STAGGER' | 'RECOVER';
export type DuelistAttackPhase = 'WINDUP' | 'ACTIVE' | 'RECOVERY';
type EnemyAttack = { id: string; direction: AttackDirection; phase: DuelistAttackPhase; elapsed: number; duration: number; activeStart: number; activeEnd: number; power: number; windup: Vector3; strike: Vector3 };

// The Mandalorian source is audited but produces degenerate Babylon bounds in
// this runtime. Revan is the already validated W0 humanoid fallback for W2.0.
const DUELIST_TARGET_HEIGHT = 1.85;
const DUELIST_ASSET_PATH = '/assets/characters/enemies/darth_revan_clone_wars.glb';
const RED_SABER: SaberWeaponConfig = {
  id: 'duelist_red_saber',
  boneName: 'hand.R_45',
  scale: 0.02,
  position: new Vector3(0.035, -0.1, 0.025),
  rotation: new Vector3(-Math.PI, 0, Math.PI * 0.5),
  bladeLength: 0.98,
  emitter: new Vector3(1.868, 0.191, 3.868),
  core: new Color3(0.98, 0.98, 1),
  aura: new Color3(1, 0.08, 0.035),
  light: new Color3(1, 0.12, 0.06),
  lightEnabled: true,
};

export class DuelistAI implements CombatActor, HitReceiver {
  readonly id = 'duelist_prototype_01';
  readonly root: TransformNode;
  readonly visualRoot: TransformNode;
  readonly bodyRadius = 0.38;
  readonly stagger = new StaggerController();
  readonly saber: SaberWeapon;
  private state: DuelistState = 'IDLE';
  private guard: GuardState = 'NONE';
  private attack?: EnemyAttack;
  private enabled = false;
  private ready = false;
  private decisionClock = 0;
  private attackCooldown = 0;
  private circleClock = 0;
  private lastAttackIndex = -1;
  private blockRemaining = 0;
  private readonly forwardVector = new Vector3(0, 0, 1);

  private constructor(private readonly scene: Scene, private readonly player: PlayerController, private readonly visual: ImportedAsset, private readonly spawn: Vector3, loader: AssetLoader) {
    this.root = new TransformNode('DuelistPrototypeRoot', scene);
    this.root.position.copyFrom(spawn);
    this.visualRoot = new TransformNode('DuelistPrototypeVisualRoot', scene);
    this.visualRoot.parent = this.root;
    this.visual.root.parent = this.visualRoot;
    this.visual.root.scaling.setAll(1);
    this.visual.root.position.set(0, 0, 0);
    this.visual.meshes.forEach((mesh) => { mesh.isPickable = false; });
    const contact = MeshBuilder.CreateDisc('DuelistContactShadow', { radius: 0.42, tessellation: 20 }, scene);
    contact.parent = this.root;
    contact.position.y = 0.018;
    contact.rotation.x = Math.PI * 0.5;
    const contactMaterial = new StandardMaterial('DuelistContactShadowMaterial', scene);
    contactMaterial.diffuseColor.set(0.005, 0.008, 0.009);
    contactMaterial.alpha = 0.28;
    contactMaterial.backFaceCulling = false;
    contact.material = contactMaterial;
    contact.isPickable = false;
    this.visual.animationGroups.forEach((group) => group.start(true));
    scene.onAfterAnimationsObservable.add(() => this.visual.resetAnimatedRoots());
    this.saber = new SaberWeapon(scene, visual, loader, RED_SABER);
  }

  static async create(scene: Scene, player: PlayerController, loader: AssetLoader, spawn: Vector3) {
    const visual = await loader.load(DUELIST_ASSET_PATH, scene);
    const duelist = new DuelistAI(scene, player, visual, spawn, loader);
    const initialBounds = measureVisualBounds(visual.meshes);
    const measuredPlayerHeight = player.visualInfo.height;
    const visualTargetHeight = measuredPlayerHeight > 0 ? Math.max(1.82, Math.min(1.87, measuredPlayerHeight * 1.03)) : DUELIST_TARGET_HEIGHT;
    if (initialBounds.height > 0) duelist.visual.root.scaling.setAll(visualTargetHeight / initialBounds.height);
    duelist.ready = await duelist.saber.attach();
    alignVisualFeetToGround(duelist.visualRoot, visual.meshes, 0.02);
    duelist.saber.setBladeExtension(1);
    duelist.facePlayer();
    return duelist;
  }

  update(deltaSeconds: number, playerAttacking: boolean) {
    if (!this.ready) return;
    this.stagger.update(deltaSeconds);
    this.attackCooldown = Math.max(0, this.attackCooldown - deltaSeconds);
    this.blockRemaining = Math.max(0, this.blockRemaining - deltaSeconds);
    if (this.stagger.active) {
      this.state = 'STAGGER';
      this.guard = 'NONE';
      this.attack = undefined;
      this.saber.clearCombatOffset();
      this.facePlayer();
      return;
    }
    if (this.attack) { this.updateAttack(deltaSeconds); return; }
    if (!this.enabled) { this.state = 'IDLE'; this.guard = 'NONE'; this.saber.clearCombatOffset(); return; }
    if (this.blockRemaining > 0) {
      this.state = 'BLOCK';
      this.guard = 'BLOCKING';
      this.saber.setCombatOffset(new Vector3(-0.18, 0.3, -0.16));
      this.facePlayer();
      return;
    }
    this.guard = 'NONE';
    this.decisionClock += deltaSeconds;
    const toPlayer = this.player.position.subtract(this.root.position);
    toPlayer.y = 0;
    const distance = toPlayer.length();
    const direction = distance > 0.001 ? toPlayer.scale(1 / distance) : Vector3.Forward();
    this.facePlayer();
    if (distance > 4.5) {
      this.state = 'APPROACH';
      this.move(direction, 1.55, deltaSeconds);
      return;
    }
    if (distance < 1.1) {
      this.state = 'RECOVER';
      this.move(direction.scale(-1), 0.8, deltaSeconds);
      return;
    }
    if (distance > 2.5) {
      this.state = 'APPROACH';
      this.move(direction, 1.05, deltaSeconds);
      return;
    }
    this.state = this.decisionClock < 0.35 ? 'ASSESS' : 'CIRCLE';
    this.circleClock += deltaSeconds;
    const side = Math.sin(this.circleClock * 1.15) >= 0 ? 1 : -1;
    const strafe = new Vector3(-direction.z * side, 0, direction.x * side);
    this.move(strafe, 0.46, deltaSeconds);
    if (playerAttacking && this.decisionClock > 0.18 && this.decisionClock < 0.55) {
      this.blockRemaining = 0.52;
      this.decisionClock = 0;
      return;
    }
    if (this.attackCooldown <= 0 && this.decisionClock > 1.15) {
      this.startAttack();
      this.decisionClock = 0;
    }
  }

  startAI() { this.enabled = true; this.decisionClock = 0; this.state = 'IDLE'; }
  stopAI() { this.enabled = false; this.attack = undefined; this.guard = 'NONE'; this.state = 'IDLE'; this.saber.clearCombatOffset(); }
  toggleAI() { if (this.enabled) this.stopAI(); else this.startAI(); }

  reset(position = this.spawn) {
    this.root.position.copyFrom(position);
    this.stopAI();
    this.stagger.clear();
    this.attackCooldown = 0;
    this.blockRemaining = 0;
    this.lastAttackIndex = -1;
    this.facePlayer();
  }

  notifyClash(result: 'CLASH' | 'BLOCK' | 'PARRY') {
    if (result === 'PARRY') this.stagger.apply('PARRY');
    else { this.attack = undefined; this.attackCooldown = result === 'BLOCK' ? 0.7 : 0.35; this.state = 'RECOVER'; this.saber.clearCombatOffset(); }
  }

  receiveSaberHit(event: SaberHitEvent) { this.stagger.apply(event.power > 1 ? 'HEAVY' : 'LIGHT'); }

  applyStagger(kind: StaggerKind) { this.stagger.apply(kind); }

  resolveSeparation(playerPosition: Vector3) {
    const offset = this.root.position.subtract(playerPosition); offset.y = 0;
    const distance = offset.length();
    if (distance >= 0.76 || distance <= 0.001) return;
    this.root.position.addInPlace(offset.normalize().scale(0.76 - distance));
  }

  setEnabled(value: boolean) {
    this.enabled = value;
    this.root.setEnabled(value);
  }

  private startAttack() {
    const attackIndex = (this.lastAttackIndex + 1) % 4;
    this.lastAttackIndex = attackIndex;
    const data = [
      { id: 'DUEL_LEFT', direction: AttackDirection.LEFT, windup: new Vector3(0.62, 0.38, 0.08), strike: new Vector3(-0.78, 0.18, -0.2) },
      { id: 'DUEL_RIGHT', direction: AttackDirection.RIGHT, windup: new Vector3(-0.62, 0.38, 0.08), strike: new Vector3(0.78, 0.18, -0.2) },
      { id: 'DUEL_OVERHEAD', direction: AttackDirection.FORWARD, windup: new Vector3(-0.12, 0.98, 0.16), strike: new Vector3(0.34, -1.02, -0.28) },
      { id: 'DUEL_DIAGONAL', direction: AttackDirection.FORWARD_RIGHT, windup: new Vector3(-0.52, 0.62, 0.12), strike: new Vector3(0.9, -0.76, -0.3) },
    ][attackIndex];
    this.attack = { ...data, phase: 'WINDUP', elapsed: 0, duration: 1.05, activeStart: 0.38, activeEnd: 0.68, power: attackIndex === 2 ? 2 : 1 };
    this.state = 'ATTACK';
    this.guard = 'NONE';
  }

  private updateAttack(deltaSeconds: number) {
    if (!this.attack) return;
    this.attack.elapsed += deltaSeconds;
    const attack = this.attack;
    attack.phase = attack.elapsed < attack.activeStart ? 'WINDUP' : attack.elapsed <= attack.activeEnd ? 'ACTIVE' : 'RECOVERY';
    const normalized = Math.min(1, attack.elapsed / attack.duration);
    const t = normalized < 0.38 ? normalized / 0.38 : (normalized - 0.38) / 0.62;
    const eased = t * t * (3 - 2 * t);
    const offset = normalized < 0.38 ? Vector3.Lerp(attack.windup, attack.strike, eased) : Vector3.Lerp(attack.strike, Vector3.Zero(), eased);
    this.saber.setCombatOffset(offset);
    this.facePlayer();
    if (attack.elapsed >= attack.duration) {
      this.attack = undefined;
      this.attackCooldown = 0.9;
      this.state = 'RECOVER';
      this.saber.clearCombatOffset();
    }
  }

  private move(direction: Vector3, speed: number, deltaSeconds: number) {
    this.root.position.addInPlace(direction.scale(speed * deltaSeconds));
    this.root.position.y = 0;
  }

  private facePlayer() {
    const toPlayer = this.player.position.subtract(this.root.position); toPlayer.y = 0;
    if (toPlayer.lengthSquared() < 0.001) return;
    const desired = Math.atan2(toPlayer.x, toPlayer.z);
    const current = this.visualRoot.rotation.y;
    const delta = Math.atan2(Math.sin(desired - current), Math.cos(desired - current));
    this.visualRoot.rotation.y = current + delta * 0.12;
    this.forwardVector.set(Math.sin(this.visualRoot.rotation.y), 0, Math.cos(this.visualRoot.rotation.y));
  }

  get position() { return this.root.position; }
  get forward() { return this.forwardVector; }
  get bodyCenter() { return this.root.position.add(new Vector3(0, 0.9, 0)); }
  get combatState() { return this.state; }
  get guardState() { return this.guard; }
  get staggerState(): StaggerState { return this.stagger.currentState; }
  get currentAttackId() { return this.attack?.id ?? 'NONE'; }
  get currentAttackDirection() { return this.attack?.direction ?? AttackDirection.CENTER; }
  get currentAttackPhase() { return this.attack?.phase ?? 'READY'; }
  get currentAttackPower() { return this.attack?.power ?? 0; }
  get isAttackActive() { return this.attack?.phase === 'ACTIVE'; }
  get attackBusy() { return Boolean(this.attack); }
  get isAIEnabled() { return this.enabled; }
  get saberSpeed() { return 0; }
  get currentDistance() { return Vector3.Distance(this.player.position, this.root.position); }
  get visualInfo() {
    const enabled = this.visual.meshes.filter((mesh) => mesh.isEnabled() && mesh.isVisible).length;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    this.visual.meshes.forEach((mesh) => {
      mesh.computeWorldMatrix(true);
      const box = mesh.getBoundingInfo().boundingBox;
      minY = Math.min(minY, box.minimumWorld.y);
      maxY = Math.max(maxY, box.maximumWorld.y);
    });
    const triangles = this.visual.meshes.reduce((sum, mesh) => sum + Math.floor(mesh.getTotalIndices() / 3), 0);
    const names = this.visual.meshes.slice(0, 3).map((mesh) => mesh.name).join('|');
    const first = this.visual.meshes[0];
    const firstPosition = first ? first.getAbsolutePosition() : Vector3.Zero();
    const normalizedMinY = Number.isFinite(minY) ? minY : 0;
    const normalizedMaxY = Number.isFinite(maxY) ? maxY : 0;
    return {
      enabled,
      minY: normalizedMinY,
      maxY: normalizedMaxY,
      height: Math.max(0, normalizedMaxY - normalizedMinY),
      feetY: normalizedMinY,
      groundError: normalizedMinY - 0.02,
      visualOffsetY: this.visualRoot.position.y,
      triangles,
      names,
      firstPosition,
      bone: this.saber.boneName,
    };
  }
  get saberInfo() {
    const segment = this.saber.getBladeSegment();
    return segment ? `${segment.start.x.toFixed(1)},${segment.start.y.toFixed(1)},${segment.start.z.toFixed(1)} → ${segment.end.x.toFixed(1)},${segment.end.y.toFixed(1)},${segment.end.z.toFixed(1)}` : 'OFF';
  }
}
