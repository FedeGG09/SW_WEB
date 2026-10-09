import { Scene, TransformNode, Vector3 } from '@babylonjs/core';
import { AssetLoader, type ImportedAsset } from '../assets/AssetLoader';
import type { HostileMercenaryProfile } from '../party/tactical/HostileMercenaryProfile';

/** Source-scoped native JKA blaster attachment. It does not own firing or targeting. */
export class BlasterWeaponAttachment {
  readonly assetPath: string;
  private asset?: ImportedAsset;
  private hand?: TransformNode;
  private muzzleNode?: TransformNode;
  private weaponRoot?: TransformNode;
  private muzzleAnchor?: TransformNode;
  private sourceScale = 1;

  constructor(
    private readonly scene: Scene,
    private readonly loader: AssetLoader,
    private readonly profile: HostileMercenaryProfile,
  ) {
    this.assetPath = profile.weapon.assetPath;
  }

  async attachTo(actorAsset: ImportedAsset) {
    if (this.asset) return;
    this.hand = this.findHand(actorAsset);
    if (!this.hand) throw new Error('HOSTILE_BLASTER_HAND_SOCKET_MISSING:' + this.profile.weapon.socket);
    this.asset = await this.loader.load(this.assetPath, this.scene);
    this.asset.animationGroups.forEach(group => group.stop());
    this.asset.root.parent = this.hand;
    this.hand.computeWorldMatrix(true);
    this.asset.root.computeWorldMatrix(true);
    this.asset.meshes.forEach(mesh => mesh.computeWorldMatrix(true));
    const inheritedScale = Vector3.One();
    this.hand.getWorldMatrix().decompose(inheritedScale);
    this.sourceScale = Number.isFinite(inheritedScale.x) && inheritedScale.x > 0.0001 ? inheritedScale.x : 1;
    this.asset.root.scaling.setAll(this.sourceScale);
    this.asset.root.position.set(0, 0, 0);
    this.asset.root.rotation.set(0, 0, 0);
    this.asset.meshes.forEach(mesh => {
      mesh.isPickable = false;
      mesh.metadata = { ...(mesh.metadata ?? {}), actor: 'BLASTER', coverageExclude: true, rangedWeapon: true };
    });
    const flash = this.asset.meshes.find(mesh => /^\*flash(?:_|$)/i.test(mesh.name));
    this.muzzleNode = flash as TransformNode | undefined;
    this.weaponRoot = this.asset.root;
    if (this.muzzleNode) {
      this.muzzleAnchor = new TransformNode(`${this.profile.id}_MuzzleAnchor`, this.scene);
      this.muzzleAnchor.parent = this.asset.root;
      this.muzzleAnchor.position.copyFrom(this.muzzleNode.getAbsolutePosition().subtract(this.asset.root.getAbsolutePosition()).scale(1 / Math.max(this.sourceScale, 0.0001)));
    }
  }

  get attached() { return Boolean(this.asset && this.hand); }
  get sourceAsset() { return this.asset; }
  get handNode() { return this.hand; }
  get rootNode() { return this.weaponRoot; }
  get muzzleAnchorNode() { return this.muzzleAnchor; }

  getMuzzleWorldPosition() {
    if (this.muzzleNode) return this.muzzleNode.getAbsolutePosition().clone();
    if (this.muzzleAnchor) return this.muzzleAnchor.getAbsolutePosition().clone();
    return this.hand?.getAbsolutePosition().clone() ?? Vector3.Zero();
  }

  getForwardWorld(targetPoint?: Vector3) {
    const origin = this.getMuzzleWorldPosition();
    if (targetPoint) {
      const aimed = targetPoint.subtract(origin);
      if (aimed.lengthSquared() > 1e-8) return aimed.normalize();
    }
    return this.hand?.getDirection(Vector3.FromArray(this.profile.weapon.localForward)).normalize() ?? new Vector3(0, 0, 1);
  }

  telemetry(targetPoint?: Vector3) {
    return {
      sourceAssetPath: this.assetPath,
      sourceWeaponModel: this.profile.weapon.sourceModel,
      socket: this.profile.weapon.socket,
      muzzleSource: this.muzzleNode?.name ?? this.profile.weapon.muzzleTag,
      muzzleLocalPosition: this.profile.weapon.muzzleLocalPosition,
      muzzleLocalForward: this.profile.weapon.localForward,
      muzzleWorldPosition: this.getMuzzleWorldPosition().asArray(),
      weaponForward: this.getForwardWorld(targetPoint).asArray(),
      sourceScale: this.sourceScale,
    };
  }

  dispose() {
    this.muzzleAnchor?.dispose();
    this.muzzleAnchor = undefined;
    this.asset?.dispose();
    this.asset = undefined;
    this.hand = undefined;
    this.muzzleNode = undefined;
    this.weaponRoot = undefined;
  }

  private findHand(asset: ImportedAsset) {
    const skeletons = [...new Set(asset.meshes.map(mesh => mesh.skeleton).filter(Boolean))];
    for (const skeleton of skeletons) {
      const bone = skeleton!.bones.find(candidate => candidate.name === this.profile.weapon.socket)
        ?? skeleton!.bones.find(candidate => /^(?:rhand|right.?hand)$/i.test(candidate.name));
      const transform = bone?.getTransformNode?.();
      if (transform) return transform;
    }
    return undefined;
  }
}
