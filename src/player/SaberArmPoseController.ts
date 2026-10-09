import { Bone, Quaternion, Skeleton, TransformNode, Vector3 } from '@babylonjs/core';
import { combatTrace } from '../debug/CombatTrace';

export const ITHORIAN_ARM_CHAIN = {
  shoulder: 'mixamorig:RightShoulder_34',
  upperArm: 'mixamorig:RightArm_33',
  forearm: 'mixamorig:RightForeArm_32',
  hand: 'mixamorig:RightHand_31',
  torso: 'mixamorig:Spine2_35',

  index1: 'mixamorig:RightHandIndex1_24',
  index2: 'mixamorig:RightHandIndex2_23',
  index3: 'mixamorig:RightHandIndex3_22',

  middle1: 'mixamorig:RightHandMiddle1_27',
  middle2: 'mixamorig:RightHandMiddle2_26',
  middle3: 'mixamorig:RightHandMiddle3_25',

  ring1: 'mixamorig:RightHandRing1_30',
  ring2: 'mixamorig:RightHandRing2_29',
  ring3: 'mixamorig:RightHandRing3_28',

  thumb1: 'mixamorig:RightHandThumb1_21',
  thumb2: 'mixamorig:RightHandThumb2_20',
  thumb3: 'mixamorig:RightHandThumb3_19',
} as const;

export const AREN_ARM_CHAIN = {
  shoulder: 'RightShoulder_52',
  upperArm: 'RightArm_51',
  forearm: 'RightForeArm_50',
  hand: 'RightHand_49',
  torso: 'Spine2_53',
} as const;

type BoneRotation = {
  bone: Bone;
  base: Vector3;
  transform?: TransformNode;
  baseQuaternion?: Quaternion;
};
type ArmKey = 'shoulder' | 'upperArm' | 'forearm' | 'hand' | 'torso';
type FingerKey =
  | 'index1' | 'index2' | 'index3' | 'index4'
  | 'middle1' | 'middle2' | 'middle3' | 'middle4'
  | 'ring1' | 'ring2' | 'ring3' | 'ring4'
  | 'pinky1' | 'pinky2' | 'pinky3' | 'pinky4'
  | 'thumb1' | 'thumb2' | 'thumb3' | 'thumb4';

type GripRig = 'ITHORIAN' | 'AREN' | 'UNKNOWN';

const AREN_FINGER_CHAIN = {
  index1: 'RightHandIndex1_36',
  index2: 'RightHandIndex2_35',
  index3: 'RightHandIndex3_34',
  index4: 'RightHandIndex4_33',

  middle1: 'RightHandMiddle1_40',
  middle2: 'RightHandMiddle2_39',
  middle3: 'RightHandMiddle3_38',
  middle4: 'RightHandMiddle4_37',

  ring1: 'RightHandRing1_44',
  ring2: 'RightHandRing2_43',
  ring3: 'RightHandRing3_42',
  ring4: 'RightHandRing4_41',

  pinky1: 'RightHandPinky1_48',
  pinky2: 'RightHandPinky2_47',
  pinky3: 'RightHandPinky3_46',
  pinky4: 'RightHandPinky4_45',

  thumb1: 'RightHandThumb1_32',
  thumb2: 'RightHandThumb2_31',
  thumb3: 'RightHandThumb3_30',
  thumb4: 'RightHandThumb4_29',
} as const;

/**
 * Lightweight FK overlay for the player's saber arm and grip.
 *
 * The hilt socket stays rigidly parented to the hand. The arm chain moves the
 * hand that carries the hilt, while the finger overlay keeps the hand visibly
 * wrapped around the grip even when locomotion clips do not animate fingers.
 */
export class SaberArmPoseController {
  private authoredPose = false;

  setAuthoredPose(enabled: boolean) {
    this.authoredPose = enabled;
    if (enabled) {
      this.ready = false;
      this.weaponArc.setAll(0);
      this.attackPose.setAll(0);
    }
  }
  private readonly chain: Record<ArmKey, BoneRotation | undefined>;
  private readonly fingers: Record<FingerKey, BoneRotation | undefined>;
  private readonly weaponArc = new Vector3();
  private readonly attackPose = new Vector3();
  private readonly gripRig: GripRig;
  private afterAnimationsObserver?: any;
  private ready = false;
  private grip = false;

  constructor(private readonly skeleton: Skeleton) {
    const hasArenHand = this.skeleton.bones.some(
      (bone) => bone.name === AREN_ARM_CHAIN.hand,
    );

    const hasIthorianHand = this.skeleton.bones.some(
      (bone) => bone.name === ITHORIAN_ARM_CHAIN.hand,
    );

    this.gripRig = hasArenHand
      ? 'AREN'
      : hasIthorianHand
        ? 'ITHORIAN'
        : 'UNKNOWN';

    const armChain = this.gripRig === 'AREN'
      ? AREN_ARM_CHAIN
      : ITHORIAN_ARM_CHAIN;

    this.chain = {
      shoulder: this.capture(armChain.shoulder),
      upperArm: this.capture(armChain.upperArm),
      forearm: this.capture(armChain.forearm),
      hand: this.capture(armChain.hand),
      torso: this.capture(armChain.torso),
    };

    const fingerChain = this.gripRig === 'AREN'
      ? AREN_FINGER_CHAIN
      : ITHORIAN_ARM_CHAIN;

    this.fingers = {
      index1: this.capture(fingerChain.index1),
      index2: this.capture(fingerChain.index2),
      index3: this.capture(fingerChain.index3),
      index4: this.capture('index4' in fingerChain ? fingerChain.index4 : ''),

      middle1: this.capture(fingerChain.middle1),
      middle2: this.capture(fingerChain.middle2),
      middle3: this.capture(fingerChain.middle3),
      middle4: this.capture('middle4' in fingerChain ? fingerChain.middle4 : ''),

      ring1: this.capture(fingerChain.ring1),
      ring2: this.capture(fingerChain.ring2),
      ring3: this.capture(fingerChain.ring3),
      ring4: this.capture('ring4' in fingerChain ? fingerChain.ring4 : ''),

      pinky1: this.capture('pinky1' in fingerChain ? fingerChain.pinky1 : ''),
      pinky2: this.capture('pinky2' in fingerChain ? fingerChain.pinky2 : ''),
      pinky3: this.capture('pinky3' in fingerChain ? fingerChain.pinky3 : ''),
      pinky4: this.capture('pinky4' in fingerChain ? fingerChain.pinky4 : ''),

      thumb1: this.capture(fingerChain.thumb1),
      thumb2: this.capture(fingerChain.thumb2),
      thumb3: this.capture(fingerChain.thumb3),
      thumb4: this.capture('thumb4' in fingerChain ? fingerChain.thumb4 : ''),
    };

    this.apply();
  }

  setReadyPose(enabled: boolean) {
    this.ready = enabled;
    this.apply();
  }

  setGripPose(enabled: boolean) {
    this.grip = enabled;

    if (enabled) {
      this.ensureGripAfterAnimations();
    } else {
      this.removeGripAfterAnimations();
    }

    this.apply();
  }

  setWeaponArc(offset: Vector3) {
    this.weaponArc.copyFrom(offset);
    this.apply();
  }

  clearWeaponArc() {
    this.weaponArc.set(0, 0, 0);
    this.apply();
  }

  setAttackPose(offset: Vector3) {
    this.attackPose.copyFrom(offset);
    this.apply();
  }

  clearAttackPose() {
    this.attackPose.set(0, 0, 0);
    this.apply();
  }

  get boneNames() {
    return {
      shoulder: this.chain.shoulder?.bone.name ?? 'NOT_FOUND',
      upperArm: this.chain.upperArm?.bone.name ?? 'NOT_FOUND',
      forearm: this.chain.forearm?.bone.name ?? 'NOT_FOUND',
      hand: this.chain.hand?.bone.name ?? 'NOT_FOUND',
    };
  }

  get isValid() {
    return Boolean(this.chain.shoulder && this.chain.upperArm && this.chain.forearm && this.chain.hand);
  }

  get debugPose() {
    const arc = this.weaponArc;
    const pose = this.attackPose;
    const magnitude = (factor: number, arcFactor: number) => Math.min(1, (pose.length() * factor + arc.length() * arcFactor) / 1.65);
    return {
      active: pose.lengthSquared() + arc.lengthSquared() > 0.0001 || this.ready || this.grip,
      shoulder: magnitude(0.24, 0.12),
      upperArm: magnitude(0.52, 0.3),
      forearm: magnitude(0.82, 0.58),
      hand: magnitude(1, 0.78),
      grip: this.grip,
      gripRig: this.gripRig,
      attackOffset: pose.clone(),
      weaponArc: arc.clone(),
    };
  }

  getDebugData(hilt?: Vector3, bladeTip?: Vector3) {
    const shoulder = this.chain.shoulder?.bone.getTransformNode()?.getAbsolutePosition().clone() ?? Vector3.Zero();
    const elbow = this.chain.upperArm?.bone.getTransformNode()?.getAbsolutePosition().clone() ?? Vector3.Zero();
    const hand = this.chain.hand?.bone.getTransformNode()?.getAbsolutePosition().clone() ?? Vector3.Zero();
    const hiltPosition = hilt?.clone() ?? hand.clone();
    return {
      names: this.boneNames,
      valid: this.isValid,
      shoulder,
      elbow,
      hand,
      hilt: hiltPosition,
      bladeTip: bladeTip?.clone() ?? hiltPosition.clone(),
      handHiltDistance: Vector3.Distance(hand, hiltPosition),
    };
  }

  private capture(name: string): BoneRotation | undefined {
    if (!name) return undefined;

    const bone = this.skeleton.bones.find(
      (candidate) => candidate.name === name,
    );

    if (!bone) return undefined;

    const transform =
      bone.getTransformNode()
      ?? undefined;

    const baseQuaternion = transform
      ? (
          transform.rotationQuaternion?.clone()
          ?? Quaternion.FromEulerAngles(
            transform.rotation.x,
            transform.rotation.y,
            transform.rotation.z,
          )
        )
      : undefined;

    return {
      bone,
      base: bone.rotation.clone(),
      transform,
      baseQuaternion,
    };
  }

  /**
   * Aren's exported GLB contains sampled rotation tracks for the finger bones
   * in every authored animation. A one-shot grip is therefore overwritten by
   * Babylon on the next animation tick.
   *
   * Reapply ONLY the finger overlay after Babylon has evaluated animations.
   * The arm, hand/wrist and saber socket remain owned by the authored clip.
   */
  private ensureGripAfterAnimations() {
    if (this.afterAnimationsObserver) return;

    const scene = this.skeleton.getScene();

    this.afterAnimationsObserver =
      scene.onAfterAnimationsObservable.add(
        () => {
          if (!this.grip) return;
          combatTrace.overlayOnce('SaberArmPoseController.applyGrip', {
            targetBones: Object.values(this.fingers).filter((entry) => Boolean(entry)).map((entry) => entry!.bone.name),
            reason: 'post-animation finger grip reapplication',
          });
          this.applyGrip();
        },
      );
  }

  private removeGripAfterAnimations() {
    if (!this.afterAnimationsObserver) return;

    const scene = this.skeleton.getScene();

    scene.onAfterAnimationsObservable.remove(
      this.afterAnimationsObserver,
    );

    this.afterAnimationsObserver = undefined;
  }

  private apply() {
    // Clearing a procedural offset is not permission to reset authored bones.
    if (this.authoredPose) {
      this.applyGrip();
      return;
    }
    const arc = this.weaponArc;
    const pose = this.attackPose;
    const attackVisibility = 1.12;

    // A readable one-handed guard for the procedural fallback. The authored
    // combat_ready animation normally owns this pose, but keeping the fallback
    // correct avoids the old hanging-arm/downward-saber silhouette.
    const readyShoulder = this.ready
      ? new Vector3(-0.28, 0.08, -0.14)
      : Vector3.Zero();
    const readyUpperArm = this.ready
      ? new Vector3(-0.48, -0.16, -0.20)
      : Vector3.Zero();
    const readyForearm = this.ready
      ? new Vector3(-0.52, -0.12, -0.28)
      : Vector3.Zero();
    const readyHand = this.ready
      ? new Vector3(-0.14, 0.08, 0.06)
      : Vector3.Zero();

    this.write(
      this.chain.torso,
      new Vector3(
        pose.x * 0.12 + arc.x * 0.035,
        pose.y * 0.12 + arc.y * 0.045,
        pose.z * 0.12 + arc.z * 0.035,
      ),
    );

    this.write(
      this.chain.shoulder,
      new Vector3(
        readyShoulder.x + pose.x * 0.24 * attackVisibility + arc.x * 0.12 * attackVisibility,
        readyShoulder.y + pose.y * 0.20 * attackVisibility + arc.y * 0.10 * attackVisibility,
        readyShoulder.z + pose.z * 0.24 * attackVisibility + arc.z * 0.12 * attackVisibility,
      ),
    );

    this.write(
      this.chain.upperArm,
      new Vector3(
        readyUpperArm.x + pose.x * 0.52 * attackVisibility + arc.x * 0.30 * attackVisibility,
        readyUpperArm.y + pose.y * 0.45 * attackVisibility + arc.y * 0.28 * attackVisibility,
        readyUpperArm.z + pose.z * 0.52 * attackVisibility + arc.z * 0.30 * attackVisibility,
      ),
    );

    this.write(
      this.chain.forearm,
      new Vector3(
        readyForearm.x + pose.x * 0.82 * attackVisibility + arc.x * 0.58 * attackVisibility,
        readyForearm.y + pose.y * 0.72 * attackVisibility + arc.y * 0.54 * attackVisibility,
        readyForearm.z + pose.z * 0.82 * attackVisibility + arc.z * 0.58 * attackVisibility,
      ),
    );

    this.write(
      this.chain.hand,
      new Vector3(
        readyHand.x + pose.x * attackVisibility + arc.x * 0.78 * attackVisibility,
        readyHand.y + pose.y * attackVisibility + arc.y * 0.72 * attackVisibility,
        readyHand.z + pose.z * attackVisibility + arc.z * 0.78 * attackVisibility,
      ),
    );

    this.applyGrip();
  }

  private applyGrip() {
    if (!this.grip) {
      this.clearGrip();
      return;
    }

    if (this.gripRig === 'AREN') {
      this.applyArenGrip();
      return;
    }

    this.applyIthorianGrip();
  }

  /** Manual goToFrame runs after onAfterAnimations in Game's render update. */
  finalizeGrip() {
    if (this.grip) this.applyGrip();
  }

  /**
   * Original Ithorian grip, preserved exactly.
   */
  private applyIthorianGrip() {
    // Positive X curls the Ithorian Mixamo-style finger chain toward the palm.
    this.write(this.fingers.index1, new Vector3(0.72, 0.00, -0.03));
    this.write(this.fingers.index2, new Vector3(0.92, 0.00, 0.00));
    this.write(this.fingers.index3, new Vector3(0.62, 0.00, 0.00));

    this.write(this.fingers.middle1, new Vector3(0.78, 0.00, 0.00));
    this.write(this.fingers.middle2, new Vector3(0.98, 0.00, 0.00));
    this.write(this.fingers.middle3, new Vector3(0.66, 0.00, 0.00));

    this.write(this.fingers.ring1, new Vector3(0.76, 0.00, 0.04));
    this.write(this.fingers.ring2, new Vector3(0.94, 0.00, 0.00));
    this.write(this.fingers.ring3, new Vector3(0.62, 0.00, 0.00));

    this.write(this.fingers.thumb1, new Vector3(0.30, 0.12, -0.30));
    this.write(this.fingers.thumb2, new Vector3(0.48, 0.04, -0.16));
    this.write(this.fingers.thumb3, new Vector3(0.26, 0.00, -0.08));
  }

  /**
   * Aren Vey human grip.
   *
   * Only finger bones are modified here. RightHand_49, RightForeArm_50,
   * RightArm_51, RightShoulder_52 and the saber socket remain untouched.
   *
   * Aren has four joints per finger. Curl is distributed across the complete
   * chain so the hand wraps around the cylindrical hilt instead of collapsing
   * into a generic fist.
   */
  private applyArenGrip() {
    // Index: slightly softer because it sits closest to the emitter.
    this.write(this.fingers.index1, new Vector3(1.50, 0, 0));
    this.write(this.fingers.index2, new Vector3(1.20, 0, 0));
    this.write(this.fingers.index3, new Vector3(0.80, 0, 0));
    this.write(this.fingers.index4, Vector3.Zero());

    // Middle finger: strongest central contact with the grip.
    this.write(this.fingers.middle1, new Vector3(1.30, 0, 0));
    this.write(this.fingers.middle2, new Vector3(1.60, 0, 0));
    this.write(this.fingers.middle3, new Vector3(1.20, 0, 0));
    this.write(this.fingers.middle4, Vector3.Zero());

    // Ring finger.
    this.write(this.fingers.ring1, new Vector3(1.30, 0, 0));
    this.write(this.fingers.ring2, new Vector3(1.40, 0, 0));
    this.write(this.fingers.ring3, new Vector3(0.60, 0, 0));
    this.write(this.fingers.ring4, Vector3.Zero());

    // Pinky closes a little more to keep the lower grip visually secure.
    this.write(this.fingers.pinky1, new Vector3(1.50, 0, 0));
    this.write(this.fingers.pinky2, new Vector3(1.00, 0, 0));
    this.write(this.fingers.pinky3, new Vector3(0.60, 0, 0));
    this.write(this.fingers.pinky4, Vector3.Zero());

    // Thumb opposition: bring the thumb across the hilt instead of merely
    // curling it into the palm.
    this.write(this.fingers.thumb1, new Vector3(0.28, -0.38, 0.55));
    this.write(this.fingers.thumb2, new Vector3(0.58, -0.10, 0.12));
    this.write(this.fingers.thumb3, new Vector3(0.65, 0, 0.06));
    this.write(this.fingers.thumb4, Vector3.Zero());
  }

  private clearGrip() {
    const zero = Vector3.Zero();

    (Object.keys(this.fingers) as FingerKey[]).forEach((key) => {
      this.write(this.fingers[key], zero);
    });
  }

  private write(
    entry: BoneRotation | undefined,
    offset: Vector3,
  ) {
    if (!entry) return;

    /*
     * glTF skeletons are linked to TransformNodes. Authored AnimationGroups
     * animate those nodes directly, so for Aren the overlay must write to the
     * TransformNode as well instead of only changing Bone.rotation.
     */
    if (
      entry.transform
      && entry.baseQuaternion
    ) {
      const offsetQuaternion =
        Quaternion.FromEulerAngles(
          offset.x,
          offset.y,
          offset.z,
        );

      if (!entry.transform.rotationQuaternion) {
        entry.transform.rotationQuaternion =
          Quaternion.Identity();
      }

      entry.baseQuaternion
        .multiplyToRef(
          offsetQuaternion,
          entry.transform.rotationQuaternion,
        );

      return;
    }

    // Fallback for legacy skeletons without linked transform nodes.
    entry.bone.rotation.set(
      entry.base.x + offset.x,
      entry.base.y + offset.y,
      entry.base.z + offset.z,
    );
  }
}
