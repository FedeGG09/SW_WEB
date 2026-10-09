import {
  Bone,
  Color3,
  Color4,
  LinesMesh,
  Matrix,
  Mesh,
  MeshBuilder,
  PBRMaterial,
  Quaternion,
  Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
} from '@babylonjs/core';

import { AssetLoader, ImportedAsset } from '../assets/AssetLoader';
import { SaberColorConfig } from './SaberColorConfig';
import { SaberArmPoseController } from './SaberArmPoseController';
import type { WeaponPresentationProfile } from './PlayerCharacterConfig';
import { combatTrace } from '../debug/CombatTrace';

/** Source-preserving native JKA saber model and bolt markers. */
export type NativeJkaWeaponDefinition = {
  assetPath: string;
  handSocket: string;
  bladeOriginNode: string;
  bladeAxisNode: string;
  bladeTagSurface: string;
  bladeLengthM: number;
  sourceForwardConvention: 'NEGATIVE_X';
};


/**
 * Player saber attachment.
 *
 * V6 uses a hilt-only donor asset whose origin has been baked at the physical
 * grip center. This keeps the visible hilt, the hand socket and the procedural
 * blade in the same coordinate frame; no runtime source-space recenter hack is
 * required anymore.
 */
export const saberSocketConfig = {
  bone: 'mixamorig:RightHand_31',

  // RightHand is the wrist joint. The grip center belongs inside the palm,
  // between the thumb root (~+Y 0.11) and the long-finger roots (~+Y 0.24).
  //
  // IMPORTANT:
  // Keep this as the original Ithorian calibration.
  // Aren receives its own rotational correction below without modifying
  // the physical hand pose or breaking the old player rig.
  position: new Vector3(
    0.0,
    0.170,
    0.018,
  ),

  // Original Ithorian socket orientation.
  //
  // Donor +Z maps to hand +Y, so the emitter remains on the finger side
  // and the pommel on the wrist side.
  //
  // DO NOT modify this globally for Aren.
  rotation: new Vector3(
    -Math.PI * 0.5,
    Math.PI,
    Math.PI * 0.5,
  ),

  // The centered donor hilt is 0.289 m long in source space.
  modelScale: 1.2,

  // The GLB origin is already at the physical center of the grip.
  // The emitter therefore sits on local +Z.
  emitterLocal: new Vector3(
    0.0,
    0.0,
    0.143,
  ),

  // Blade length in socket-local units.
  bladeLength: 1.48,
};


/**
 * Aren Vey uses a human rig with a different RightHand local orientation
 * from the original Ithorian rig.
 *
 * We deliberately correct ONLY the weapon socket.
 *
 * Do NOT compensate by rotating:
 * - RightHand
 * - RightForeArm
 * - RightArm
 * - RightShoulder
 *
 * Those bones belong to Aren's authored combat animation.
 */
const AREN_RIGHT_HAND_BONE = 'RightHand_49';

/**
 * Aren saber calibration.
 *
 * W220.2 palm-space measurement: hilt +Z must cross the palm along hand +X,
 * rather than follow the finger chains along +Y. Final socket Euler is
 * (0°, 90°, 90°), after these corrections to the shared base. Position stays
 * (0.015, 0.061, 0.003). Four-view evidence: w220_2_contact_sheets/.
 */
const AREN_SABER_X_CORRECTION =
  90 * Math.PI / 180;

/**
 * Completes the measured transverse palm alignment. Blade, emitter and hilt
 * still share one socket; authored arm/forearm motion aims the held weapon.
 */
const AREN_SABER_Y_CORRECTION =
  -90 * Math.PI / 180;

/**
 * Aren-specific socket position.
 *
 * This is NOT the Ithorian hand position.
 *
 * The current Aren GLB places:
 * - thumb root at roughly local Y 0.026
 * - long-finger roots around local Y 0.090-0.100
 *
 * Their palm midpoint is ~Y 0.061.  Using the old Ithorian Y 0.170 puts the
 * hilt near/outside the fingers, which is exactly the visual separation seen
 * in the lab video.
 *
 * X/Z are the measured palm-center offsets in Aren's RightHand_49 space.
 */
const AREN_SABER_SOCKET_POSITION =
  new Vector3(
    0.015,
    0.061,
    0.003,
  );


export class WeaponAttachment {
  /** Final finger-only overlay after authored combat/defense seeks. */
  finalizeCombatPose() {
    this.armPose?.finalizeGrip();
  }
  readonly saberPath: string;

  readonly rightHandBoneName: string;

  private socket?: TransformNode;
  private saber?: ImportedAsset;

  private bladeAnchor?: TransformNode;
  private nativeBladeOrigin?: TransformNode;
  private nativeBladeAxis?: TransformNode;
  private nativeWeaponSceneRoot?: TransformNode;
  private nativeSourceUnitScale = 1;
  private bladeCore?: Mesh;
  private bladeAura?: Mesh;

  private armPose?: SaberArmPoseController;

  private readonly combatArc = new Vector3();
  private readonly combatPose = new Vector3();

  private armDebugLines?: LinesMesh;
  private armDebugEnabled = false;

  private currentExtension = 0;
  private attached = false;
  private authoredAnimationActive = false;
  private activeBladeLength = saberSocketConfig.bladeLength;


  constructor(
    private readonly scene: Scene,
    private readonly playerVisual: ImportedAsset,
    private readonly loader: AssetLoader,
    private readonly preferredAttachmentNode?: string,
    private readonly weaponPresentation?: WeaponPresentationProfile,
    private readonly nativeWeaponDefinition?: NativeJkaWeaponDefinition,
    private readonly nativeJkaWeaponPresentation?: WeaponPresentationProfile,
  ) {
    this.saberPath = nativeWeaponDefinition?.assetPath
      ?? '/assets/weapons/mara_jade_lightsaber_grip_centered.glb';
    this.rightHandBoneName =
      this.findRightHandBone()?.name
      ?? 'NOT_FOUND';

    window.addEventListener(
      'keydown',
      (event) => {
        if (event.key === 'F9') {
          event.preventDefault();

          void this.toggle();
        }

        if (event.key === 'F4') {
          const debugPanel =
            document.getElementById(
              'debugOverlay',
            );

          if (
            debugPanel?.classList.contains(
              'is-hidden',
            )
          ) {
            return;
          }

          event.preventDefault();

          this.armDebugEnabled =
            !this.armDebugEnabled;

          this.armDebugLines?.setEnabled(
            this.armDebugEnabled,
          );
        }
      },
    );
  }


  async toggle() {
    if (this.attached) {
      this.detach();
      return;
    }

    await this.attach();

    this.setBladeExtension(1);
  }


  async attach() {
    if (this.attached) {
      return;
    }

    const bone =
      this.findRightHandBone();

    if (!bone) {
      return;
    }


    // ------------------------------------------------------------
    // HAND / GRIP
    // ------------------------------------------------------------

    const isNativeJkaSocket = bone.name === this.preferredAttachmentNode;
    this.armPose = isNativeJkaSocket
      ? undefined
      : new SaberArmPoseController(bone.getSkeleton());

    // The handle is always present in the hand in the current design,
    // even while the blade is OFF.
    //
    // IMPORTANT:
    // This controls the grip/fingers.
    // It is intentionally NOT used to compensate the saber angle.
    this.armPose?.setGripPose(true);


    // ------------------------------------------------------------
    // LOAD HILT
    // ------------------------------------------------------------

    this.saber =
      await this.loader.load(
        this.saberPath,
        this.scene,
      );

    this.saber.animationGroups.forEach(
      (group) => group.stop(),
    );

    if (this.nativeWeaponDefinition) {
      const nodes = this.saber.root.getDescendants(false);
      this.nativeBladeOrigin = nodes.find((node) =>
        node.name === this.nativeWeaponDefinition!.bladeOriginNode) as TransformNode | undefined;
      this.nativeBladeAxis = nodes.find((node) =>
        node.name === this.nativeWeaponDefinition!.bladeAxisNode) as TransformNode | undefined;
      this.nativeWeaponSceneRoot = nodes.find((node) =>
        node.name === 'scene_root') as TransformNode | undefined;
      if (!this.nativeBladeOrigin || !this.nativeBladeAxis || !this.nativeWeaponSceneRoot) {
        this.saber.dispose();
        this.saber = undefined;
        throw new Error('NATIVE_JKA_SABER_BLADE_TAG_NODES_MISSING');
      }
    }


    // ------------------------------------------------------------
    // RIGHT-HAND TRANSFORM
    // ------------------------------------------------------------

    const transform =
      bone.getTransformNode();

    if (!transform) {
      this.saber.dispose();
      this.saber = undefined;

      return;
    }


    // ------------------------------------------------------------
    // SABER SOCKET
    // ------------------------------------------------------------

    this.socket =
      new TransformNode(
        'player_saber_prototype_socket',
        this.scene,
      );

    this.socket.parent =
      transform;

    let nativeJkaInheritedScale = 1;
    if (isNativeJkaSocket) {
      // JKA joints are authored in game units while PlayerController normalizes
      // the prototype to 1.8 m. Cancel that uniform actor scale for the weapon.
      transform.computeWorldMatrix(true);
      const inheritedScale = Vector3.One();
      transform.getWorldMatrix().decompose(inheritedScale);
      if (Number.isFinite(inheritedScale.x) && inheritedScale.x > 0.0001) {
        nativeJkaInheritedScale = inheritedScale.x;
        this.socket.scaling.setAll(1 / inheritedScale.x);
      }
      this.nativeSourceUnitScale = nativeJkaInheritedScale;
      this.activeBladeLength = 0.98;
    } else {
      this.activeBladeLength = saberSocketConfig.bladeLength;
    }


    // ------------------------------------------------------------
    // RIG-SPECIFIC POSITION + ROTATION
    // ------------------------------------------------------------

    const isAren =
      bone.name ===
      AREN_RIGHT_HAND_BONE;

    /*
     * The Ithorian and Aren do not share the same palm proportions.
     *
     * Do not add an Aren correction on top of the Ithorian Y=0.170 socket:
     * Aren gets its own absolute palm-center position.
     */
    this.socket.position.copyFrom(
      isNativeJkaSocket
        ? Vector3.Zero()
        : isAren
        ? AREN_SABER_SOCKET_POSITION
        : saberSocketConfig.position,
    );

    const activePresentation = this.nativeWeaponDefinition
      ? this.nativeJkaWeaponPresentation
      : this.weaponPresentation;
    if (activePresentation) {
      const [x, y, z] = activePresentation.translationM;
      const parentScale = isNativeJkaSocket ? nativeJkaInheritedScale : 1;
      this.socket.position.addInPlace(new Vector3(x / parentScale, y / parentScale, z / parentScale));
    }

    // Start from the visually validated base hilt orientation.
    const socketRotation =
      saberSocketConfig.rotation.clone();

    if (isNativeJkaSocket) {
      socketRotation.set(0, 0, 0);
    } else if (isAren) {
      socketRotation.x +=
        AREN_SABER_X_CORRECTION;

      socketRotation.y +=
        AREN_SABER_Y_CORRECTION;
    }

    if (activePresentation) {
      const toRadians = Math.PI / 180;
      const [x, y, z] = activePresentation.rotationEulerDeg;
      socketRotation.addInPlace(new Vector3(x * toRadians, y * toRadians, z * toRadians));
    }

    this.socket.rotation.copyFrom(
      socketRotation,
    );


    // ------------------------------------------------------------
    // HILT ROOT
    // ------------------------------------------------------------

    this.saber.root.parent =
      this.socket;

    if (this.nativeWeaponDefinition) {
      // Keep JKA source units in the same world scale as the native player rig.
      // The weapon export's 0.1 conversion differs from Rosh's 0.02666 rig scale;
      // derive the runtime source-unit scale from the attached hand, not a visual fit.
      this.saber.root.scaling.setAll(1);
      this.nativeWeaponSceneRoot?.scaling.setAll(this.nativeSourceUnitScale);
    } else {
      this.saber.root.scaling.setAll(saberSocketConfig.modelScale);
    }


    // IMPORTANT:
    // This asset is already authored with its origin at the physical grip
    // center.
    //
    // Do not apply source-space recentering here.
    //
    // The old donor GLB carried a nested Sketchfab/FBX transform;
    // subtracting world-space values from the wrapper root left the visible
    // hilt several metres away while the procedural blade stayed correctly
    // attached to the hand.
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


    // ------------------------------------------------------------
    // HILT MESHES / MATERIALS
    // ------------------------------------------------------------

    this.saber.meshes.forEach(
      (mesh) => {
        mesh.isPickable = false;

        mesh.metadata = {
          ...(mesh.metadata ?? {}),
          coverageExclude: true,
          actor: 'SABER',
        };


        // We render our own extendable blade.
        // Keep only the donor hilt meshes.
        if (
          /lightsaber/i.test(mesh.name)
          || (this.nativeWeaponDefinition && mesh.name.startsWith(this.nativeWeaponDefinition.bladeTagSurface))
        ) {
          mesh.setEnabled(false);
        }


        const material =
          mesh.material as
            | PBRMaterial
            | StandardMaterial
            | null;


        if (
          material instanceof PBRMaterial
          && /chrome/i.test(
            material.name,
          )
        ) {
          material.metallic = 0.72;
          material.roughness = 0.28;
        }
      },
    );


    // ------------------------------------------------------------
    // BLADE EMITTER
    // ------------------------------------------------------------

    this.bladeAnchor =
      new TransformNode(
        'SaberBladeEmitter',
        this.scene,
      );

    if (this.nativeWeaponDefinition && this.nativeBladeOrigin && this.nativeBladeAxis) {
      this.nativeBladeOrigin.computeWorldMatrix(true);
      this.nativeBladeAxis.computeWorldMatrix(true);
      const originWorld = this.nativeBladeOrigin.getAbsolutePosition();
      const directionWorld = this.nativeBladeAxis.getAbsolutePosition().subtract(originWorld).normalize();
      const inverseSocket = Matrix.Invert(this.socket.getWorldMatrix());
      const originLocal = Vector3.TransformCoordinates(originWorld, inverseSocket);
      const directionLocal = Vector3.TransformNormal(directionWorld, inverseSocket).normalize();
      // The bolt chooses the exact emitter point and axis, while the procedural
      // blade stays in the meter-scale socket frame instead of inheriting the
      // GLM scene_root's source-unit conversion a second time.
      this.bladeAnchor.parent = this.socket;
      this.bladeAnchor.position.copyFrom(originLocal);
      this.bladeAnchor.rotationQuaternion = Quaternion.FromUnitVectorsToRef(
        new Vector3(0, 0, 1), directionLocal, Quaternion.Identity(),
      );
      this.activeBladeLength = this.nativeWeaponDefinition.bladeLengthM;
    } else {
      this.bladeAnchor.parent = this.socket;
      this.bladeAnchor.position.copyFrom(
        saberSocketConfig.emitterLocal.scale(saberSocketConfig.modelScale),
      );
      this.bladeAnchor.rotation.set(0, 0, 0);
    }


    // ------------------------------------------------------------
    // PROCEDURAL BLADE
    // ------------------------------------------------------------

    this.bladeCore =
      this.createBlade(
        'SaberBladeCore',
        SaberColorConfig.core,
        0.034,
        0,
      );

    this.bladeAura =
      this.createBlade(
        'SaberBladeAura',
        SaberColorConfig.aura,
        0.068,
        0.14,
      );


    this.setBladeExtension(0);

    this.attached = true;
  }

  private createBlade(name: string, color: Color3, diameter: number, alpha: number) {
    const blade = MeshBuilder.CreateCylinder(
      name,
      { height: this.activeBladeLength, diameter, tessellation: 12 },
      this.scene,
    );
    blade.parent = this.bladeAnchor!;
    blade.rotation.x = Math.PI * 0.5;

    const material = new StandardMaterial(`${name}Material`, this.scene);
    material.diffuseColor = color;
    material.emissiveColor = color;
    material.alpha = alpha > 0 ? alpha : 1;
    material.backFaceCulling = false;
    blade.material = material;
    blade.isPickable = false;
    blade.metadata = { materialFamily: 'WARM_LIGHT', mapping: 'SABER_EMISSIVE', coverageExclude: true, actor: 'SABER' };
    return blade;
  }

  setBladeExtension(factor: number) {
    const extension = Math.max(0, Math.min(1, factor));
    this.currentExtension = extension;
    [this.bladeCore, this.bladeAura].forEach((blade) => {
      if (!blade) return;
      blade.scaling.y = extension;
      blade.position.z = (this.activeBladeLength * 0.5) * extension;
      blade.setEnabled(extension > 0.001);
    });
  }

  setCombatOffset(offset: Vector3) {
    combatTrace.overlayOnce('WeaponAttachment.setCombatOffset', {
      targetBones: ['arm chain via SaberArmPoseController'],
      reason: 'procedural combat offset request',
      authoredAnimationActive: this.authoredAnimationActive,
    });
    if (this.authoredAnimationActive) return;
    this.combatArc.copyFrom(offset);
    this.armPose?.setWeaponArc(this.combatArc);
  }

  clearCombatOffset() {
    this.combatArc.set(0, 0, 0);
    this.armPose?.clearWeaponArc();
  }

  setCombatPose(offset: Vector3) {
    combatTrace.overlayOnce('WeaponAttachment.setCombatPose', {
      targetBones: ['torso', 'right shoulder', 'right arm', 'right forearm', 'right hand'],
      reason: 'procedural attack pose request',
      authoredAnimationActive: this.authoredAnimationActive,
    });
    if (this.authoredAnimationActive) return;
    this.combatPose.copyFrom(offset);
    this.armPose?.setAttackPose(this.combatPose);
  }

  clearCombatPose() {
    this.combatPose.set(0, 0, 0);
    this.armPose?.clearAttackPose();
  }

  setReadyPose(enabled: boolean) {
    if (this.authoredAnimationActive) return;
    this.armPose?.setReadyPose(enabled);
  }

  setAuthoredAnimationActive(enabled: boolean) {
    this.authoredAnimationActive = enabled;
    this.armPose?.setAuthoredPose(enabled);
    if (enabled) {
      this.clearCombatOffset();
      this.clearCombatPose();
      this.armPose?.setReadyPose(false);
    }
  }

  updateArmDebug() {
    if (!this.armDebugEnabled || !this.armPose) return;
    const segment = this.getBladeSegment();
    const debug = this.armPose.getDebugData(this.socket?.getAbsolutePosition(), segment?.end);
    const points = [debug.shoulder, debug.elbow, debug.hand, debug.hilt, debug.bladeTip];
    if (!this.armDebugLines) {
      this.armDebugLines = MeshBuilder.CreateLines(
        'W201ArmChainDebug',
        {
          points,
          colors: [
            new Color4(0.1, 0.85, 1, 1),
            new Color4(0.2, 1, 0.55, 1),
            new Color4(1, 0.72, 0.15, 1),
            new Color4(0.4, 0.85, 1, 1),
            new Color4(0.4, 0.85, 1, 1),
          ],
        },
        this.scene,
      );
      this.armDebugLines.isPickable = false;
      this.armDebugLines.setEnabled(true);
    } else {
      MeshBuilder.CreateLines(
        'W201ArmChainDebug',
        {
          points,
          instance: this.armDebugLines,
          colors: [
            new Color4(0.1, 0.85, 1, 1),
            new Color4(0.2, 1, 0.55, 1),
            new Color4(1, 0.72, 0.15, 1),
            new Color4(0.4, 0.85, 1, 1),
            new Color4(0.4, 0.85, 1, 1),
          ],
        },
      );
    }
  }

  getBladeSegment() {
    if (!this.bladeAnchor || this.currentExtension <= 0.001) return undefined;

    const world = this.bladeAnchor.getWorldMatrix();
    const start = Vector3.TransformCoordinates(Vector3.Zero(), world);
    const end = Vector3.TransformCoordinates(
      new Vector3(0, 0, this.activeBladeLength * this.currentExtension),
      world,
    );

    return { start, end };
  }

  get glowMeshes() {
    return [this.bladeCore, this.bladeAura].filter((mesh): mesh is Mesh => Boolean(mesh));
  }

  get socketNode() { return this.socket; }
  get weaponRootNode() { return this.saber?.root; }
  get nativeBladeOriginNode() { return this.nativeBladeOrigin; }
  get nativeBladeAxisNode() { return this.nativeBladeAxis; }
  get nativeWeaponSceneRootNode() { return this.nativeWeaponSceneRoot; }
  get presentationDiagnostics() {
    return {
      path: this.nativeWeaponDefinition ? "NATIVE_JKA" : "GENERIC",
      genericProfileCorrectionProvided: Boolean(this.weaponPresentation),
      nativeProfileCorrectionProvided: Boolean(this.nativeJkaWeaponPresentation),
      effectiveCorrection: this.nativeWeaponDefinition
        ? this.nativeJkaWeaponPresentation ?? { translationM: [0, 0, 0], rotationEulerDeg: [0, 0, 0] }
        : this.weaponPresentation ?? null,
      nativeWeaponDefinition: this.nativeWeaponDefinition ?? null,
    };
  }
  get emitterNode() { return this.bladeAnchor; }
  get nativeBladeTagInfo() {
    if (!this.nativeWeaponDefinition || !this.nativeBladeOrigin || !this.nativeBladeAxis) return null;
    return {
      sourceForwardConvention: this.nativeWeaponDefinition.sourceForwardConvention,
      bladeOriginNode: this.nativeBladeOrigin.name,
      bladeAxisNode: this.nativeBladeAxis.name,
      originLocalPosition: this.nativeBladeOrigin.position.asArray(),
      originLocalRotationQuaternion: this.nativeBladeOrigin.rotationQuaternion?.asArray() ?? null,
      axisMarkerLocalPosition: this.nativeBladeAxis.position.asArray(),
      sourceUnitScale: this.nativeSourceUnitScale,
    };
  }

  detach() {
    this.saber?.dispose();
    this.saber = undefined;
    this.bladeCore?.dispose();
    this.bladeAura?.dispose();
    this.bladeCore = undefined;
    this.bladeAura = undefined;
    this.currentExtension = 0;
    this.authoredAnimationActive = false;
    this.clearCombatPose();
    this.armPose?.setGripPose(false);
    this.armPose = undefined;
    this.bladeAnchor?.dispose();
    this.bladeAnchor = undefined;
    this.nativeBladeOrigin = undefined;
    this.nativeBladeAxis = undefined;
    this.nativeWeaponSceneRoot = undefined;
    this.nativeSourceUnitScale = 1;
    this.socket?.dispose();
    this.socket = undefined;
    this.armDebugLines?.dispose();
    this.armDebugLines = undefined;
    this.attached = false;
  }

  private findRightHandBone(): Bone | undefined {
    const skeletons = [...new Set(this.playerVisual.meshes
      .map((mesh) => mesh.skeleton)
      .filter((skeleton): skeleton is NonNullable<typeof skeleton> => Boolean(skeleton)))];
    for (const skeleton of skeletons) {
      if (this.preferredAttachmentNode) {
        const preferred = skeleton.bones.find((candidate) => candidate.name === this.preferredAttachmentNode);
        if (preferred) return preferred;
      }
      const bone = skeleton.bones.find((candidate) => /right.?hand|r[_:]?hand/i.test(candidate.name));
      if (bone) return bone;
    }
    return undefined;
  }
  get isAttached() { return this.attached; }
  get socketCreated() { return Boolean(this.socket); }

  get armChainDebug() {
    const segment = this.getBladeSegment();
    const hilt = this.socket?.getAbsolutePosition();
    return this.armPose?.getDebugData(hilt, segment?.end);
  }

  get armPoseDebug() { return this.armPose?.debugPose; }
  get armDebugVisible() { return this.armDebugEnabled; }

  setArmDebugVisible(enabled: boolean) {
    this.armDebugEnabled = enabled;
    this.armDebugLines?.setEnabled(enabled);
  }
}
