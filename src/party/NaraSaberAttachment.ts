import {
  Bone,
  Color3,
  Mesh,
  MeshBuilder,
  PBRMaterial,
  PointLight,
  Quaternion,
  Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
} from '@babylonjs/core';

import {
  AssetLoader,
  ImportedAsset,
} from '../assets/AssetLoader';

import {
  getSharedSaberGlow,
} from '../combat/SaberEffects';

const NARA_RIGHT_HAND =
  'RightHand_0644';

const NARA_SABER_PATH =
  '/assets/weapons/mara_jade_lightsaber_grip_centered.glb';

/**
 * W222.1 socket measured in Nara's own hand coordinates.
 *
 * The Twi'lek donor uses an Unreal-style hand where the finger chain extends
 * along local +X and index->pinky separation is mainly local Z. The saber hilt
 * longitudinal +Z follows orientation B, with a measured -40° X / -50° Y
 * correction. Literal B intersects the body during heavy/locomotion; this
 * correction clears the full blade core in the sampled evaluated poses.
 * The W222 center and finger overlay remain unchanged.
 *
 * This is deliberately isolated from Aren's validated socket.
 */
const NARA_SOCKET_POSITION =
  new Vector3(
    0.105,
    0.040,
    0.005,
  );

const NARA_SOCKET_ROTATION =
  new Vector3(
    Math.PI * 140 / 180,
    Math.PI * 130 / 180,
    0,
  );

/*
 * Nara's whole visual is scaled from ~3.24 m donor bounds to ~1.76 m by the
 * party mount. Compensate the hilt/blade locally so the final world dimensions
 * remain close to Aren's saber.
 */
const NARA_HILT_SCALE =
  1.55;

const NARA_EMITTER_LOCAL =
  new Vector3(
    0,
    0,
    0.143,
  );

const NARA_BLADE_LENGTH =
  1.72;

const GREEN_CORE =
  new Color3(
    0.94,
    1.0,
    0.95,
  );

const GREEN_AURA =
  new Color3(
    0.24,
    1.0,
    0.38,
  );

const GREEN_LIGHT =
  new Color3(
    0.22,
    1.0,
    0.34,
  );

type FingerCapture = {
  transform: TransformNode;
  base: Quaternion;
};

type FingerOffset = {
  name: string;
  euler: Vector3;
};

const NARA_GRIP: FingerOffset[] = [
  // Index
  { name: 'RightHandIndex1_0679', euler: new Vector3(0.00, 0.00, 0.44) },
  { name: 'RightHandIndex2_0680', euler: new Vector3(0.00, 0.00, 0.72) },
  { name: 'RightHandIndex3_0681', euler: new Vector3(0.00, 0.00, 0.82) },
  { name: 'RightHandIndex4_0682', euler: new Vector3(0.00, 0.00, 0.52) },

  // Middle
  { name: 'RightHandMiddle1_0693', euler: new Vector3(0.00, 0.00, 0.48) },
  { name: 'RightHandMiddle2_0694', euler: new Vector3(0.00, 0.00, 0.78) },
  { name: 'RightHandMiddle3_0695', euler: new Vector3(0.00, 0.00, 0.86) },
  { name: 'RightHandMiddle4_0696', euler: new Vector3(0.00, 0.00, 0.56) },

  // Ring
  { name: 'RightHandRing1_0665', euler: new Vector3(0.00, 0.00, 0.50) },
  { name: 'RightHandRing2_0666', euler: new Vector3(0.00, 0.00, 0.80) },
  { name: 'RightHandRing3_0667', euler: new Vector3(0.00, 0.00, 0.88) },
  { name: 'RightHandRing4_0668', euler: new Vector3(0.00, 0.00, 0.58) },

  // Pinky
  { name: 'RightHandPinky1_0672', euler: new Vector3(0.00, 0.00, 0.54) },
  { name: 'RightHandPinky2_0673', euler: new Vector3(0.00, 0.00, 0.84) },
  { name: 'RightHandPinky3_0674', euler: new Vector3(0.00, 0.00, 0.90) },
  { name: 'RightHandPinky4_0675', euler: new Vector3(0.00, 0.00, 0.60) },

  // Thumb opposition
  { name: 'RightHandThumb1_0686', euler: new Vector3(-0.32, -0.08, 0.22) },
  { name: 'RightHandThumb2_0687', euler: new Vector3(0.125, 0.04, 0.16) },
  { name: 'RightHandThumb3_0688', euler: new Vector3(0.06, -0.005, -0.105) },
  { name: 'RightHandThumb4_0689', euler: new Vector3(0.02, 0.00, -0.10) },
];

export class NaraSaberAttachment {
  private socket?: TransformNode;
  private saber?: ImportedAsset;
  private emitter?: TransformNode;
  private bladeCore?: Mesh;
  private bladeAura?: Mesh;
  private light?: PointLight;
  private fingerObserver?: any;
  private readonly fingers =
    new Map<string, FingerCapture>();
  private attached = false;
  private extension = 0;

  constructor(
    private readonly scene: Scene,
    private readonly loader: AssetLoader,
    private readonly naraVisual: ImportedAsset,
  ) {}

  async attach() {
    if (this.attached) return;

    const hand =
      this.findHandBone();

    const handTransform =
      hand?.getTransformNode();

    if (!hand || !handTransform) {
      console.warn(
        '[NARA SABER] Right hand not found',
        this.rightHandBoneName,
      );
      return;
    }

    this.captureFingerGrip(
      hand.getSkeleton(),
    );

    this.saber =
      await this.loader.load(
        NARA_SABER_PATH,
        this.scene,
      );

    this.saber.animationGroups.forEach(
      (group) => group.stop(),
    );

    this.socket =
      new TransformNode(
        'NaraVoss_SaberSocket',
        this.scene,
      );

    this.socket.parent =
      handTransform;

    this.socket.position.copyFrom(
      NARA_SOCKET_POSITION,
    );

    this.socket.rotation.copyFrom(
      NARA_SOCKET_ROTATION,
    );

    this.saber.root.parent =
      this.socket;

    this.saber.root.position.set(
      0,
      0,
      0,
    );

    this.saber.root.rotation.set(
      0,
      0,
      0,
    );

    this.saber.root.scaling.setAll(
      NARA_HILT_SCALE,
    );

    this.saber.meshes.forEach(
      (mesh) => {
        mesh.isPickable = false;

        mesh.metadata = {
          ...(mesh.metadata ?? {}),
          coverageExclude: true,
          actor: 'NARA_SABER',
        };

        if (/lightsaber/i.test(mesh.name)) {
          mesh.setEnabled(false);
        }

        const material =
          mesh.material as
            | PBRMaterial
            | StandardMaterial
            | null;

        if (
          material instanceof PBRMaterial &&
          /chrome/i.test(material.name)
        ) {
          material.metallic = 0.72;
          material.roughness = 0.28;
        }
      },
    );

    this.emitter =
      new TransformNode(
        'NaraVoss_SaberEmitter',
        this.scene,
      );

    this.emitter.parent =
      this.socket;

    this.emitter.position.copyFrom(
      NARA_EMITTER_LOCAL.scale(
        NARA_HILT_SCALE,
      ),
    );

    this.emitter.rotation.set(
      0,
      0,
      0,
    );

    this.bladeCore =
      this.createBlade(
        'NaraVoss_BladeCore',
        GREEN_CORE,
        0.034,
        1,
      );

    this.bladeAura =
      this.createBlade(
        'NaraVoss_BladeAura',
        GREEN_AURA,
        0.070,
        0.18,
      );

    const glow =
      getSharedSaberGlow(
        this.scene,
      );

    glow.intensity =
      Math.max(
        glow.intensity,
        0.58,
      );

    glow.addIncludedOnlyMesh(
      this.bladeCore,
    );

    glow.addIncludedOnlyMesh(
      this.bladeAura,
    );

    this.light =
      new PointLight(
        'NaraVoss_GreenSaberLight',
        Vector3.Zero(),
        this.scene,
      );

    this.light.parent =
      this.emitter;

    this.light.position.set(
      0,
      0,
      0.08,
    );

    this.light.diffuse =
      GREEN_LIGHT;

    this.light.specular =
      GREEN_AURA.scale(0.55);

    this.light.range = 2.6;
    this.light.intensity = 0;
    this.light.setEnabled(false);

    this.setBladeExtension(0);
    this.installFingerOverlay();
    this.attached = true;

    console.info(
      '[NARA SABER] attached',
      {
        hand: hand.name,
        socketPosition:
          NARA_SOCKET_POSITION.asArray(),
      },
    );
  }

  setBladeExtension(
    factor: number,
  ) {
    const extension =
      Math.max(
        0,
        Math.min(1, factor),
      );

    this.extension = extension;

    [
      this.bladeCore,
      this.bladeAura,
    ].forEach(
      (blade) => {
        if (!blade) return;

        blade.scaling.y =
          extension;

        blade.position.z =
          NARA_BLADE_LENGTH
          * 0.5
          * extension;

        blade.setEnabled(
          extension > 0.001,
        );
      },
    );

    if (this.light) {
      this.light.intensity =
        0.92 * extension;

      this.light.setEnabled(
        extension > 0.02,
      );
    }
  }

  dispose() {
    if (this.fingerObserver) {
      this.scene
        .onAfterAnimationsObservable
        .remove(
          this.fingerObserver,
        );

      this.fingerObserver =
        undefined;
    }

    this.light?.dispose();
    this.light = undefined;

    this.bladeCore?.dispose();
    this.bladeAura?.dispose();
    this.bladeCore = undefined;
    this.bladeAura = undefined;

    this.emitter?.dispose();
    this.emitter = undefined;

    this.saber?.dispose();
    this.saber = undefined;

    this.socket?.dispose();
    this.socket = undefined;

    this.fingers.clear();
    this.attached = false;
    this.extension = 0;
  }

  private createBlade(
    name: string,
    color: Color3,
    diameter: number,
    alpha: number,
  ) {
    const blade =
      MeshBuilder.CreateCylinder(
        name,
        {
          height: NARA_BLADE_LENGTH,
          diameter,
          tessellation: 12,
        },
        this.scene,
      );

    blade.parent =
      this.emitter!;

    blade.rotation.x =
      Math.PI * 0.5;

    const material =
      new StandardMaterial(
        `${name}_Material`,
        this.scene,
      );

    material.diffuseColor =
      color;

    material.emissiveColor =
      color;

    material.alpha =
      alpha;

    material.backFaceCulling =
      false;

    blade.material =
      material;

    blade.isPickable =
      false;

    blade.metadata = {
      materialFamily:
        'NARA_GREEN_SABER',
      coverageExclude: true,
      actor: 'NARA_SABER',
    };

    return blade;
  }

  private captureFingerGrip(
    skeleton: import('@babylonjs/core').Skeleton,
  ) {
    this.fingers.clear();

    NARA_GRIP.forEach(
      ({ name }) => {
        const bone =
          skeleton.bones.find(
            (candidate) =>
              candidate.name === name,
          );

        const transform =
          bone?.getTransformNode();

        if (!transform) return;

        const base =
          transform.rotationQuaternion?.clone()
          ?? Quaternion.FromEulerAngles(
            transform.rotation.x,
            transform.rotation.y,
            transform.rotation.z,
          );

        this.fingers.set(
          name,
          {
            transform,
            base,
          },
        );
      },
    );
  }

  private installFingerOverlay() {
    if (this.fingerObserver) return;

    this.fingerObserver =
      this.scene
        .onAfterAnimationsObservable
        .add(
          () => this.applyGrip(),
        );

    this.applyGrip();
  }

  private applyGrip() {
    NARA_GRIP.forEach(
      ({ name, euler }) => {
        const entry =
          this.fingers.get(name);

        if (!entry) return;

        const offset =
          Quaternion.FromEulerAngles(
            euler.x,
            euler.y,
            euler.z,
          );

        if (!entry.transform.rotationQuaternion) {
          entry.transform.rotationQuaternion =
            Quaternion.Identity();
        }

        entry.base.multiplyToRef(
          offset,
          entry.transform.rotationQuaternion,
        );
      },
    );
  }

  private findHandBone():
    Bone | undefined {
    const skeleton =
      this.naraVisual.meshes
        .find(
          (mesh) => mesh.skeleton,
        )
        ?.skeleton;

    return skeleton?.bones.find(
      (bone) =>
        bone.name ===
        NARA_RIGHT_HAND,
    );
  }

  get rightHandBoneName() {
    return (
      this.findHandBone()?.name
      ?? 'NOT_FOUND'
    );
  }

  get isAttached() {
    return this.attached;
  }

  get currentExtension() {
    return this.extension;
  }

  /** Apply after manual animation seeking, which can overwrite sampled fingers. */
  finalizeGrip() { this.applyGrip(); }

  getBladeSegment() {
    if (!this.emitter || this.extension <= 0.001) return undefined;
    this.emitter.computeWorldMatrix(true);
    const matrix = this.emitter.getWorldMatrix();
    return {
      start: Vector3.TransformCoordinates(Vector3.Zero(), matrix),
      end: Vector3.TransformCoordinates(new Vector3(0, 0, NARA_BLADE_LENGTH * this.extension), matrix),
    };
  }
}
