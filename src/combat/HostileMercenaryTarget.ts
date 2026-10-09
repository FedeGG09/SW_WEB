import { AnimationGroup, Color3, MeshBuilder, Scene, StandardMaterial, TransformNode, Vector3 } from '@babylonjs/core';
import type { ImportedAsset } from '../assets/AssetLoader';
import type { SaberPhysicalHitEvent, SaberSphereTarget } from './SaberTraceController';
import type { HostileMercenaryProfile } from '../party/tactical/HostileMercenaryProfile';

/** Actor-generic hostile damage receiver. It exposes the same sphere target contract as existing DEV targets. */
export class HostileMercenaryTarget {
  readonly targetId: string;
  readonly root: TransformNode;
  readonly collider: SaberSphereTarget;
  readonly initialHealth: number;
  readonly asset: ImportedAsset;
  readonly profile: HostileMercenaryProfile;
  private readonly material: StandardMaterial;
  private readonly marker: ReturnType<typeof MeshBuilder.CreateSphere>;
  private _health: number;
  private _hitEvents = 0;
  private _damageEvents = 0;
  private _defeated = false;
  private _lastHit: SaberPhysicalHitEvent | null = null;
  private _activeGroup: AnimationGroup | null = null;

  constructor(scene: Scene, targetId: string, profile: HostileMercenaryProfile, asset: ImportedAsset, floorPosition: Vector3) {
    this.targetId = targetId;
    this.profile = profile;
    this.asset = asset;
    this.initialHealth = profile.initialHealth;
    this.root = new TransformNode(`HostileTarget_${targetId}`, scene);
    this.root.position.copyFrom(floorPosition);
    this.collider = { targetId, center: floorPosition.add(new Vector3(0, 0.98, 0)), radius: 0.58 };
    this._health = this.initialHealth;
    this.material = new StandardMaterial(`HostileTargetMarker_${targetId}`, scene);
    this.material.diffuseColor = new Color3(0.60, 0.12, 0.08);
    this.material.emissiveColor = new Color3(0.11, 0.015, 0.005);
    this.marker = MeshBuilder.CreateSphere(`HostileTargetMarker_${targetId}`, { diameter: 0.12, segments: 8 }, scene);
    this.marker.parent = this.root;
    this.marker.position.y = 1.95;
    this.marker.material = this.material;
    this.marker.isVisible = false;
    this.marker.isPickable = false;
  }

  get health() { return this._health; }
  get alive() { return !this._defeated; }
  get targetable() { return !this._defeated; }
  get hitEvents() { return this._hitEvents; }
  get damageEvents() { return this._damageEvents; }
  get lastHit() { return this._lastHit; }
  get activeGroup() { return this._activeGroup; }

  placeOnFloor(position: Vector3) {
    this.root.position.copyFrom(position);
    this.collider.center.set(position.x, position.y + 0.98, position.z);
  }

  reset() {
    this.stopAnimation();
    this._health = this.initialHealth;
    this._hitEvents = 0;
    this._damageEvents = 0;
    this._defeated = false;
    this._lastHit = null;
    this.marker.isVisible = false;
    this.play(this.profile.groups.idle, true);
  }

  applyHit(event: SaberPhysicalHitEvent, damage: number) {
    if (event.targetId !== this.targetId || !this.targetable) return false;
    this._lastHit = event;
    this._hitEvents += 1;
    this._damageEvents += 1;
    this._health = Math.max(0, this._health - Math.max(0, damage));
    this.marker.isVisible = true;
    if (this._health <= 0) {
      this._defeated = true;
      this.play(this.profile.groups.death, false);
    } else {
      this.play(this.profile.groups.pain, false, () => this.play(this.profile.groups.idle, true));
    }
    return true;
  }

  play(name: string, loop: boolean, onEnd?: () => void) {
    const group = this.asset.animationGroups.find(candidate => candidate.name === name);
    if (!group) return false;
    this.asset.animationGroups.forEach(candidate => candidate.stop());
    this._activeGroup = group;
    group.start(loop, 1);
    if (onEnd) group.onAnimationEndObservable.addOnce(onEnd);
    return true;
  }

  stopAnimation() {
    this.asset.animationGroups.forEach(group => group.stop());
    this._activeGroup = null;
  }

  dispose() {
    this.marker.dispose();
    this.material.dispose();
    this.root.dispose(false, true);
  }
}
