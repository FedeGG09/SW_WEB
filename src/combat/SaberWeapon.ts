import { Bone, Color3, Mesh, MeshBuilder, PBRMaterial, PointLight, Scene, StandardMaterial, TransformNode, Vector3 } from '@babylonjs/core';
import { AssetLoader, ImportedAsset } from '../assets/AssetLoader';
import { registerSaberGlow } from './SaberEffects';

export type SaberWeaponConfig = {
  id: string;
  boneName: string;
  scale: number;
  position: Vector3;
  rotation: Vector3;
  bladeLength: number;
  emitter: Vector3;
  core: Color3;
  aura: Color3;
  light: Color3;
  lightEnabled: boolean;
};

export class SaberWeapon {
  private socket?: TransformNode;
  private saber?: ImportedAsset;
  private bladeAnchor?: TransformNode;
  private bladeCore?: Mesh;
  private bladeAura?: Mesh;
  private light?: PointLight;
  private extension = 0;
  private attached = false;
  private readonly baseRotation = new Vector3();

  constructor(private readonly scene: Scene, private readonly visual: ImportedAsset, private readonly loader: AssetLoader, private readonly config: SaberWeaponConfig) {}

  async attach() {
    if (this.attached) return true;
    const bone = this.findBone();
    if (!bone) return false;
    this.saber = await this.loader.load('/assets/weapons/mara_jade_lightsaber.glb', this.scene);
    this.saber.animationGroups.forEach((group) => group.stop());
    const transform = bone.getTransformNode();
    if (!transform) { this.saber.dispose(); this.saber = undefined; return false; }
    this.socket = new TransformNode(`${this.config.id}_socket`, this.scene);
    this.socket.parent = transform;
    this.socket.position.copyFrom(this.config.position);
    this.socket.rotation.copyFrom(this.config.rotation);
    this.baseRotation.copyFrom(this.config.rotation);
    this.saber.root.parent = this.socket;
    this.saber.root.scaling.setAll(this.config.scale);
    this.saber.root.position.set(0, 0, 0);
    this.saber.root.rotation.set(0, 0, 0);
    this.saber.meshes.forEach((mesh) => {
      mesh.isPickable = false;
      if (/lightsaber|blade/i.test(mesh.name)) mesh.setEnabled(false);
      const material = mesh.material as PBRMaterial | StandardMaterial | null;
      if (material instanceof PBRMaterial && /chrome/i.test(material.name)) {
        material.metallic = 0.72;
        material.roughness = 0.3;
      }
    });
    this.bladeAnchor = new TransformNode(`${this.config.id}_emitter`, this.scene);
    this.bladeAnchor.parent = this.socket;
    this.bladeAnchor.position.copyFrom(this.config.emitter).scaleInPlace(this.config.scale);
    this.bladeCore = this.createBlade(`${this.config.id}_core`, this.config.core, 0.034, 0);
    this.bladeAura = this.createBlade(`${this.config.id}_aura`, this.config.aura, 0.072, 0.15);
    registerSaberGlow(this.scene, [this.bladeCore, this.bladeAura]);
    if (this.config.lightEnabled && this.socket) {
      this.light = new PointLight(`${this.config.id}_light`, Vector3.Zero(), this.scene);
      this.light.parent = this.socket;
      this.light.position.set(0.08, -0.02, 0.1);
      this.light.diffuse = this.config.light;
      this.light.specular = this.config.light.scale(0.45);
      this.light.range = 2.4;
      this.light.intensity = 0;
      this.light.setEnabled(false);
    }
    this.setBladeExtension(0);
    this.attached = true;
    return true;
  }

  setBladeExtension(factor: number) {
    const value = Math.max(0, Math.min(1, factor));
    this.extension = value;
    [this.bladeCore, this.bladeAura].forEach((blade) => {
      if (!blade) return;
      blade.scaling.y = value;
      blade.position.z = this.config.bladeLength * 0.5 * value;
      blade.setEnabled(value > 0.001);
    });
    if (this.light) {
      this.light.intensity = 0.35 * value;
      this.light.setEnabled(value > 0.02);
    }
  }

  setCombatOffset(offset: Vector3) {
    if (!this.socket) return;
    this.socket.rotation.set(this.baseRotation.x + offset.x, this.baseRotation.y + offset.y, this.baseRotation.z + offset.z);
  }

  clearCombatOffset() { if (this.socket) this.socket.rotation.copyFrom(this.baseRotation); }

  getBladeSegment() {
    if (!this.bladeAnchor || this.extension <= 0.001) return undefined;
    const start = this.bladeAnchor.getAbsolutePosition().clone();
    const direction = Vector3.TransformNormal(Vector3.Forward(), this.bladeAnchor.getWorldMatrix()).normalize();
    return { start, end: start.add(direction.scale(this.config.bladeLength * this.extension)) };
  }

  dispose() {
    this.light?.dispose();
    this.light = undefined;
    this.bladeCore?.dispose();
    this.bladeAura?.dispose();
    this.bladeCore = undefined;
    this.bladeAura = undefined;
    this.bladeAnchor?.dispose();
    this.bladeAnchor = undefined;
    this.socket?.dispose();
    this.socket = undefined;
    this.saber?.dispose();
    this.saber = undefined;
    this.extension = 0;
    this.attached = false;
  }

  private createBlade(name: string, color: Color3, diameter: number, alpha: number) {
    const blade = MeshBuilder.CreateCylinder(name, { height: this.config.bladeLength, diameter, tessellation: 12 }, this.scene);
    blade.parent = this.bladeAnchor!;
    blade.rotation.x = Math.PI * 0.5;
    const material = new StandardMaterial(`${name}_material`, this.scene);
    material.diffuseColor = color;
    material.emissiveColor = color;
    material.alpha = alpha > 0 ? alpha : 1;
    material.backFaceCulling = false;
    blade.material = material;
    blade.isPickable = false;
    return blade;
  }

  private findBone(): Bone | undefined {
    const skeleton = this.visual.meshes.find((mesh) => mesh.skeleton)?.skeleton;
    return skeleton?.bones.find((bone) => bone.name === this.config.boneName || new RegExp(this.config.boneName, 'i').test(bone.name));
  }

  get boneName() { return this.findBone()?.name ?? this.config.boneName; }
  get isAttached() { return this.attached; }
  get isOn() { return this.extension > 0.98; }
  get currentExtension() { return this.extension; }
  get socketNode() { return this.socket; }
  get glowMeshes() { return [this.bladeCore, this.bladeAura].filter((mesh): mesh is Mesh => Boolean(mesh)); }
}
