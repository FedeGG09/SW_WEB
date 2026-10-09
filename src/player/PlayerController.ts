import {
  AbstractMesh,
  MeshBuilder,
  Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
} from '@babylonjs/core';

import { ImportedAsset } from '../assets/AssetLoader';
import {
  PlayerAnimationController,
  PlayerAnimationState,
} from './PlayerAnimationController';

import {
  CombatAnimationName,
  PlayerCombatAnimationController,
} from './PlayerCombatAnimationController';

import { ThirdPersonCamera } from './ThirdPersonCamera';

import {
  alignVisualFeetToGround,
  measureVisualBounds,
} from '../world/CharacterGrounding';

import { LOCOMOTION } from './LocomotionConfig';
import { combatTrace } from '../debug/CombatTrace';
import { DEFAULT_PLAYER_CHARACTER, PlayerCharacterConfig } from './PlayerCharacterConfig';

import {
  LocomotionState,
  resolveLocomotionState,
} from './LocomotionState';

const PLAYER_VISUAL_TARGET_HEIGHT = 1.8;

export class PlayerController {
  readonly characterDefinition: PlayerCharacterConfig;
  readonly root: TransformNode;
  readonly visualRoot: TransformNode;
  readonly body: AbstractMesh;

  readonly animations: PlayerAnimationController;
  readonly combatAnimations: PlayerCombatAnimationController;

  private readonly keys = new Set<string>();

  private readonly camera: ThirdPersonCamera;
  private inputEnabled = true;
  private disposed = false;
  private readonly animationResetObserverCleanup: () => void;

  private speed = 0;

  private state: PlayerAnimationState = 'IDLE';

  private collisionResolver?: (
    position: Vector3,
  ) => void;

  // ---------------------------------------------------------
  // GAMEPLAY LOCK
  // ---------------------------------------------------------

  private actionLocked = false;

  // ---------------------------------------------------------
  // COMBAT MOVEMENT CONTROL
  // ---------------------------------------------------------

  private combatControlActive = false;

  private actionMovementMultiplier = 1;

  private actionTurnAllowance = Math.PI;

  private actionStartYaw = 0;

  /**
   * Extra velocity supplied by attacks.
   *
   * This is intentionally separate from normal locomotion.
   * It allows a saber attack to make a small committed step
   * without contaminating exploration velocity.
   */
  private readonly actionVelocity = Vector3.Zero();

  // ---------------------------------------------------------
  // LOCOMOTION
  // ---------------------------------------------------------

  private readonly currentInput = Vector3.Zero();

  /**
   * Actual physical horizontal velocity.
   */
  private readonly velocity = Vector3.Zero();

  /**
   * Target velocity calculated from input.
   */
  private readonly desiredVelocity = Vector3.Zero();

  /**
   * Desired movement direction in world space.
   */
  private readonly desiredWorldDirection = Vector3.Zero();

  private locomotionState: LocomotionState = 'IDLE';

  private targetSpeed = 0;

  constructor(
    private readonly scene: Scene,
    visual: ImportedAsset,
    camera: ThirdPersonCamera,
    characterDefinition: PlayerCharacterConfig = DEFAULT_PLAYER_CHARACTER,
  ) {
    this.characterDefinition = characterDefinition;
    this.camera = camera;

    // -------------------------------------------------------
    // PLAYER ROOT
    // -------------------------------------------------------

    this.root = new TransformNode(
      'PlayerRoot',
      scene,
    );

    this.root.position.set(
      0,
      0,
      12,
    );

    // -------------------------------------------------------
    // VISUAL ROOT
    // -------------------------------------------------------

    this.visualRoot = new TransformNode(
      'PlayerVisualRoot',
      scene,
    );

    this.visualRoot.parent = this.root;

    visual.root.parent = this.visualRoot;

    visual.root.position.set(
      0,
      0,
      0,
    );

    // -------------------------------------------------------
    // VISUAL SCALE
    // -------------------------------------------------------

    const initialBounds =
      measureVisualBounds(
        visual.meshes,
      );

    if (initialBounds.height > 0) {
      this.visualRoot.scaling.setAll(
        (this.characterDefinition.targetHeightM || PLAYER_VISUAL_TARGET_HEIGHT)
        / initialBounds.height,
      );
    }

    alignVisualFeetToGround(
      this.visualRoot,
      visual.meshes,
      0.02,
    );
    // Keep source navigation/capsule on its WOK point. This profile value only
    // corrects the skinned visual root after bind-pose bounds alignment.
    const visualGroundOffset = this.characterDefinition.runtimeVisualGroundOffsetM ?? 0;
    if (Number.isFinite(visualGroundOffset)) this.visualRoot.position.y += visualGroundOffset;
    visual.meshes.forEach(
      (mesh) => {
        mesh.isPickable = false;

        mesh.metadata = {
          ...(mesh.metadata ?? {}),
          coverageExclude: true,
          actor: 'PLAYER',
        };
      },
    );

    // -------------------------------------------------------
    // GAMEPLAY BODY
    // -------------------------------------------------------

    this.body = MeshBuilder.CreateCapsule(
      'GameplayBody',
      {
        height: 1.8,
        radius: 0.34,
        tessellation: 8,
      },
      scene,
    );

    this.body.parent = this.root;

    this.body.position.y = 0.9;

    this.body.isVisible = false;

    this.body.isPickable = false;

    // -------------------------------------------------------
    // CONTACT SHADOW
    // -------------------------------------------------------

    const contact =
      MeshBuilder.CreateDisc(
        'PlayerContactShadow',
        {
          radius: 0.42,
          tessellation: 20,
        },
        scene,
      );

    contact.parent = this.root;

    contact.position.y = 0.018;

    contact.rotation.x =
      Math.PI * 0.5;

    const contactMaterial =
      new StandardMaterial(
        'PlayerContactShadowMaterial',
        scene,
      );

    contactMaterial.diffuseColor.set(
      0.005,
      0.008,
      0.009,
    );

    contactMaterial.alpha = 0.3;

    contactMaterial.backFaceCulling =
      false;

    contact.material =
      contactMaterial;

    contact.isPickable = false;

    contact.metadata = {
      coverageExclude: true,
      actor: 'PLAYER_CONTACT',
    };

    // -------------------------------------------------------
    // ANIMATION CONTROLLERS
    // -------------------------------------------------------

    const leaderProfile = this.characterDefinition.leaderCombatProfile;
    const leaderGroups = leaderProfile
      ? Object.values(leaderProfile.groups).filter((name): name is string => typeof name === 'string')
      : [];
    const characterLabGroups = Object.values(this.characterDefinition.characterLabJkaPreviewProfile?.groups ?? {});
    const dedicatedCombatGroups = leaderProfile
      ? [
          leaderProfile.groups.saberReady,
          leaderProfile.groups.attackStart,
          leaderProfile.groups.attack,
          leaderProfile.groups.attackReturn,
          leaderProfile.groups.comboTransition,
          leaderProfile.groups.comboAttack,
          leaderProfile.groups.comboReturn,
          ...Object.values(leaderProfile.groups.parryResponses ?? {}),
        ].filter((name): name is string => Boolean(name))
      : [];
    this.animations =
      new PlayerAnimationController(
        visual.animationGroups,
        this.characterDefinition.exactLocomotion,
        dedicatedCombatGroups,
      );

    this.combatAnimations =
      new PlayerCombatAnimationController(
        visual.animationGroups,
        [...leaderGroups, ...characterLabGroups],
      );

    this.animations.setState(
      'IDLE',
    );

    this.installInput();

    /*
     * Preserve the imported visual hierarchy.
     *
     * Some donor GLBs animate their root nodes.
     * Resetting those animated roots after evaluation prevents
     * unwanted GLB root-motion from fighting gameplay movement.
     */
    this.animationResetObserverCleanup = visual.registerAnimatedRootResetObserver(scene, 'PlayerController');
  }

  // =========================================================
  // INPUT
  // =========================================================

  private installInput() {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (!this.inputEnabled || this.disposed) return;
    const key = event.key.toLowerCase();
    this.keys.add(key);
    if (['w', 'a', 's', 'd', 'shift'].includes(key)) event.preventDefault();
  };

  private readonly onKeyUp = (event: KeyboardEvent) => { this.keys.delete(event.key.toLowerCase()); };
  private readonly onBlur = () => { this.keys.clear(); };

  setInputEnabled(enabled: boolean) {
    this.inputEnabled = enabled;
    if (!enabled) this.keys.clear();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.animationResetObserverCleanup();
    this.keys.clear();
    this.root.dispose(false, true);
  }

  // =========================================================
  // UPDATE
  // =========================================================

  update(
    deltaSeconds: number,
  ) {
    if (this.disposed || !this.inputEnabled) return;
    if (this.actionLocked) {
      this.updateLockedState();
      return;
    }

    // -------------------------------------------------------
    // RAW INPUT
    // -------------------------------------------------------

    const x =
      (this.keys.has('d') ? 1 : 0)
      - (this.keys.has('a') ? 1 : 0);

    const z =
      (this.keys.has('w') ? 1 : 0)
      - (this.keys.has('s') ? 1 : 0);

    this.currentInput.set(
      x,
      0,
      z,
    );

    const moving =
      this.currentInput.lengthSquared()
      > LOCOMOTION.inputDeadZone
      * LOCOMOTION.inputDeadZone;

    /*
     * Sprint only applies when there is a forward component.
     *
     * Shift+S does not become backward sprint.
     */
    const running =
      this.keys.has('shift')
      && z > 0
      && moving;

    // -------------------------------------------------------
    // DETAILED STATE
    // -------------------------------------------------------

    this.locomotionState =
      resolveLocomotionState(
        x,
        z,
        running,
      );

    // -------------------------------------------------------
    // WORLD MOVEMENT DIRECTION
    // -------------------------------------------------------

    if (moving) {
      const localDirection =
        this.currentInput.normalizeToNew();

      const forward =
        new Vector3(
          Math.sin(this.camera.yaw),
          0,
          -Math.cos(this.camera.yaw),
        );

      const right =
        new Vector3(
          Math.cos(this.camera.yaw),
          0,
          Math.sin(this.camera.yaw),
        );

      this.desiredWorldDirection
        .copyFrom(
          forward
            .scale(localDirection.z)
            .add(
              right.scale(
                localDirection.x,
              ),
            ),
        );

      if (
        this.desiredWorldDirection
          .lengthSquared()
        > 0.0001
      ) {
        this.desiredWorldDirection
          .normalize();
      }
    } else {
      this.desiredWorldDirection.set(
        0,
        0,
        0,
      );
    }

    // -------------------------------------------------------
    // TARGET SPEED
    // -------------------------------------------------------

    const inputMagnitude =
      moving
        ? Math.min(
            1,
            this.currentInput.length(),
          )
        : 0;

    const directionalSpeed =
      this.resolveDirectionalSpeed(
        this.locomotionState,
        running,
      );

    this.targetSpeed =
      moving
        ? directionalSpeed
          * inputMagnitude
          * this.actionMovementMultiplier
        : 0;

    // -------------------------------------------------------
    // TARGET VELOCITY
    // -------------------------------------------------------

    if (moving) {
      this.desiredVelocity
        .copyFrom(
          this.desiredWorldDirection,
        )
        .scaleInPlace(
          this.targetSpeed,
        );
    } else {
      this.desiredVelocity.set(
        0,
        0,
        0,
      );
    }

    // -------------------------------------------------------
    // ACCELERATION
    // -------------------------------------------------------

    if (moving) {
      const baseAcceleration =
        running
          ? LOCOMOTION.runAcceleration
          : LOCOMOTION.acceleration;

      const acceleration =
        this.resolveAcceleration(
          baseAcceleration,
        );

      this.moveVelocityToward(
        this.desiredVelocity,
        acceleration
        * deltaSeconds,
      );
    } else {
      this.moveVelocityToward(
        Vector3.Zero(),
        LOCOMOTION.deceleration
        * deltaSeconds,
      );
    }

    // -------------------------------------------------------
    // REMOVE MICRO DRIFT
    // -------------------------------------------------------

    if (
      !moving
      && this.velocity.length()
        < LOCOMOTION.stopSpeed
    ) {
      this.velocity.set(
        0,
        0,
        0,
      );
    }

    // -------------------------------------------------------
    // PHYSICAL MOVEMENT
    // -------------------------------------------------------

    if (
      this.velocity.lengthSquared()
      > 0.000001
    ) {
      this.root.position.addInPlace(
        this.velocity.scale(
          deltaSeconds,
        ),
      );
    }

    // -------------------------------------------------------
    // BODY FACING
    // -------------------------------------------------------

    this.updateFacing(
      deltaSeconds,
      moving,
    );

    // -------------------------------------------------------
    // COMBAT FOOTWORK / ATTACK STEP
    // -------------------------------------------------------

    if (
      this.actionVelocity
        .lengthSquared()
      > 0.0001
    ) {
      this.root.position.addInPlace(
        this.actionVelocity.scale(
          deltaSeconds,
        ),
      );
    }

    // -------------------------------------------------------
    // COLLISION / GROUNDING
    // -------------------------------------------------------

    if (this.collisionResolver) {
      this.collisionResolver(
        this.root.position,
      );
    } else {
      this.root.position.y = 0;
    }

    // -------------------------------------------------------
    // ACTUAL SPEED
    // -------------------------------------------------------

    this.speed =
      this.velocity.length();

    // -------------------------------------------------------
    // LEGACY HIGH-LEVEL STATE
    // -------------------------------------------------------

    const nextState:
      PlayerAnimationState =
        this.speed
          < LOCOMOTION.stopSpeed
          ? 'IDLE'
          : running
            && this.speed
              > LOCOMOTION.walkSpeed
              * 1.06
            ? 'RUN'
            : 'WALK';

    this.state = nextState;

    // -------------------------------------------------------
    // LOCOMOTION ANIMATION
    // -------------------------------------------------------

    if (
      !this.combatAnimations.active
    ) {
      this.animations
        .setLocomotionState(
          this.speed
            < LOCOMOTION.stopSpeed
            ? 'IDLE'
            : this.locomotionState,

          this.speed,
        );
    } else {
      combatTrace.once('locomotion-suppressed', 'LOCOMOTION SUPPRESSED DURING ATTACK', {
        requestedState: this.locomotionState,
        locomotionCurrent: this.animations.activeClipName,
        combatOwnsSkeleton: true,
      });
    }
  }

  // =========================================================
  // SPEED SELECTION
  // =========================================================

  private resolveDirectionalSpeed(
    state: LocomotionState,
    running: boolean,
  ) {
    switch (state) {
      case 'RUN_FORWARD':
        return LOCOMOTION.runSpeed;

      case 'BACKPEDAL':
        return LOCOMOTION.backpedalSpeed;

      case 'STRAFE_LEFT':
      case 'STRAFE_RIGHT':
        return LOCOMOTION.strafeSpeed;

      case 'FORWARD_LEFT':
      case 'FORWARD_RIGHT':
        /*
         * Allow diagonal sprinting but slightly slower than
         * pure forward sprint.
         */
        return running
          ? LOCOMOTION.runSpeed * 0.92
          : LOCOMOTION.diagonalForwardSpeed;

      case 'BACK_LEFT':
      case 'BACK_RIGHT':
        return LOCOMOTION.diagonalBackSpeed;

      case 'WALK_FORWARD':
        return LOCOMOTION.walkSpeed;

      case 'IDLE':
      default:
        return 0;
    }
  }

  // =========================================================
  // ACCELERATION MODEL
  // =========================================================

  private resolveAcceleration(
    baseAcceleration: number,
  ) {
    if (
      this.velocity.lengthSquared()
      < 0.01
      || this.desiredVelocity
        .lengthSquared()
      < 0.01
    ) {
      return baseAcceleration;
    }

    const currentDirection =
      this.velocity.normalizeToNew();

    const targetDirection =
      this.desiredVelocity
        .normalizeToNew();

    const directionDot =
      Vector3.Dot(
        currentDirection,
        targetDirection,
      );

    /*
     * dot:
     *
     * +1  = same direction
     *  0  = 90-degree turn
     * -1  = complete reversal
     *
     * Blend toward a higher acceleration as the requested
     * direction becomes more different from current momentum.
     *
     * This makes W -> S and A -> D responsive without making
     * ordinary acceleration unrealistically sharp.
     */
    const directionChange =
      Math.max(
        0,
        Math.min(
          1,
          (1 - directionDot) * 0.5,
        ),
      );

    return (
      baseAcceleration
      + (
        LOCOMOTION
          .directionChangeAcceleration
        - baseAcceleration
      )
      * directionChange
    );
  }

  // =========================================================
  // FACING
  // =========================================================

  private updateFacing(
    deltaSeconds: number,
    moving: boolean,
  ) {
    if (!moving) {
      return;
    }

    if (
      this.desiredWorldDirection
        .lengthSquared()
      < 0.0001
    ) {
      return;
    }

    const requestedYaw =
      Math.atan2(
        this.desiredWorldDirection.x,
        this.desiredWorldDirection.z,
      );

    let targetYaw =
      requestedYaw;

    let turnRate: number =
      LOCOMOTION.turnSpeed;

    /*
     * During a committed saber attack the actor may turn,
     * but only inside the attack profile allowance.
     */
    if (
      this.combatControlActive
    ) {
      const relative =
        this.shortestAngle(
          requestedYaw
          - this.actionStartYaw,
        );

      const bounded =
        Math.max(
          -this.actionTurnAllowance,
          Math.min(
            this.actionTurnAllowance,
            relative,
          ),
        );

      targetYaw =
        this.actionStartYaw
        + bounded;

      turnRate =
        LOCOMOTION.combatTurnSpeed;
    }

    /*
     * Exponential response is frame-rate independent.
     *
     * At 60 fps and 30 fps the character should therefore
     * feel almost identical.
     */
    const blend =
      1
      - Math.exp(
          -turnRate
          * deltaSeconds,
        );

    this.visualRoot.rotation.y =
      this.smoothAngle(
        this.visualRoot.rotation.y,
        targetYaw,
        blend,
      );
  }

  // =========================================================
  // VELOCITY UTILITY
  // =========================================================

  private moveVelocityToward(
    target: Vector3,
    maxDelta: number,
  ) {
    const delta =
      target.subtract(
        this.velocity,
      );

    const distance =
      delta.length();

    if (
      distance <= maxDelta
      || distance < 0.0001
    ) {
      this.velocity.copyFrom(
        target,
      );

      return;
    }

    this.velocity.addInPlace(
      delta.scale(
        maxDelta / distance,
      ),
    );
  }

  // =========================================================
  // ANGLES
  // =========================================================

  private smoothAngle(
    current: number,
    target: number,
    amount: number,
  ) {
    const delta =
      this.shortestAngle(
        target - current,
      );

    return (
      current
      + delta * amount
    );
  }

  private shortestAngle(
    angle: number,
  ) {
    return Math.atan2(
      Math.sin(angle),
      Math.cos(angle),
    );
  }

  // =========================================================
  // LOCKED STATE
  // =========================================================

  private updateLockedState() {
    this.speed = 0;

    this.targetSpeed = 0;

    this.velocity.set(
      0,
      0,
      0,
    );

    this.desiredVelocity.set(
      0,
      0,
      0,
    );

    this.desiredWorldDirection.set(
      0,
      0,
      0,
    );

    this.locomotionState =
      'IDLE';

    if (
      this.state !== 'IDLE'
    ) {
      this.state = 'IDLE';
    }

    if (
      !this.combatAnimations.active
    ) {
      this.animations
        .setLocomotionState(
          'IDLE',
          0,
        );
    }

    if (this.collisionResolver) {
      this.collisionResolver(
        this.root.position,
      );
    } else {
      this.root.position.y = 0;
    }
  }

  // =========================================================
  // PUBLIC MOVEMENT INFO
  // =========================================================

  get position() {
    return this.root.position;
  }

  get horizontalSpeed() {
    return this.speed;
  }

  get animationState() {
    return this.state;
  }

  get detailedLocomotionState() {
    return this.locomotionState;
  }

  get movementVelocity() {
    return this.velocity;
  }

  get desiredSpeed() {
    return this.targetSpeed;
  }

  get movementInput() {
    return this.currentInput;
  }

  get worldMovementDirection() {
    return this.desiredWorldDirection;
  }

  // =========================================================
  // POSITION / FACING
  // =========================================================

  setPosition(
    position: Vector3,
  ) {
    this.root.position.copyFrom(
      position,
    );

    /*
     * Teleports/portals must not preserve old momentum.
     */
    this.velocity.set(
      0,
      0,
      0,
    );

    this.desiredVelocity.set(
      0,
      0,
      0,
    );

    this.targetSpeed = 0;

    this.speed = 0;
  }

  setFacingYaw(
    yaw: number,
  ) {
    this.visualRoot.rotation.y =
      yaw;

    this.actionStartYaw =
      yaw;
  }

  setCollisionResolver(
    resolver?: (
      position: Vector3,
    ) => void,
  ) {
    this.collisionResolver =
      resolver;
  }

  // =========================================================
  // GAMEPLAY LOCK
  // =========================================================

  setActionLocked(
    locked: boolean,
  ) {
    this.actionLocked =
      locked;

    if (locked) {
      this.clearCombatControl();
    }
  }

  // =========================================================
  // COMBAT MOVEMENT
  // =========================================================

  setCombatControl(
    movementMultiplier: number,
    turnAllowanceRadians: number,
    velocity = Vector3.Zero(),
  ) {
    this.actionLocked = false;

    /*
     * Capture attack-facing only when combat control begins.
     *
     * Previously this reference could be overwritten repeatedly
     * during recovery and could later leak into exploration turning.
     */
    if (
      !this.combatControlActive
    ) {
      this.actionStartYaw =
        this.visualRoot.rotation.y;
    }

    this.combatControlActive =
      true;

    this.actionMovementMultiplier =
      Math.max(
        0,
        Math.min(
          1,
          movementMultiplier,
        ),
      );

    this.actionTurnAllowance =
      Math.max(
        0,
        turnAllowanceRadians,
      );

    this.actionVelocity.copyFrom(
      velocity,
    );
  }

  clearCombatControl() {
    this.combatControlActive =
      false;

    this.actionMovementMultiplier =
      1;

    this.actionTurnAllowance =
      Math.PI;

    this.actionVelocity.set(
      0,
      0,
      0,
    );

    /*
     * Exploration starts from current body orientation,
     * not from the yaw where an old attack began.
     */
    this.actionStartYaw =
      this.visualRoot.rotation.y;
  }

  getWorldDirectionFromInput(
    input: Vector3,
  ) {
    const forward =
      new Vector3(
        Math.sin(this.camera.yaw),
        0,
        -Math.cos(this.camera.yaw),
      );

    const right =
      new Vector3(
        Math.cos(this.camera.yaw),
        0,
        Math.sin(this.camera.yaw),
      );

    const direction =
      forward
        .scale(input.z)
        .add(
          right.scale(
            input.x,
          ),
        );

    if (
      direction.lengthSquared()
      < 0.0001
    ) {
      return Vector3.Zero();
    }

    return direction.normalize();
  }

  get cameraForwardDirection() {
    return new Vector3(
      Math.sin(this.camera.yaw),
      0,
      -Math.cos(this.camera.yaw),
    );
  }

  get isActionLocked() {
    return this.actionLocked;
  }

  get playerCanControl() {
    return !this.actionLocked;
  }

  // =========================================================
  // AUTHORED COMBAT ANIMATION
  // =========================================================

  get hasAuthoredCombatAnimations() {
    return this.combatAnimations.available;
  }

  get combatAnimationState() {
    return this.combatAnimations.current;
  }

  get combatAnimationFrame() {
    return this.combatAnimations.activeGroupDetails?.frame ?? null;
  }

  playLeaderProfileClip(name: string, loop: boolean) {
    const profile = this.characterDefinition.leaderCombatProfile;
    const allowed = profile
      ? [
          ...Object.values(profile.groups).filter((value): value is string => typeof value === 'string'),
          ...Object.values(profile.groups.parryResponses ?? {}),
        ]
      : [];
    if (!profile || !allowed.includes(name)) return false;
    return this.combatAnimations.playExact(name, loop);
  }

  clearLeaderProfileClip() {
    if (!this.characterDefinition.leaderCombatProfile || !this.combatAnimations.active) return;
    this.combatAnimations.clear();
    this.animations.setLocomotionState(this.locomotionState, this.speed);
  }

  playCombatAttack(
    name: CombatAnimationName,
  ) {
    if (
      !this.combatAnimations.available
    ) {
      return false;
    }

    return this.combatAnimations
      .playAttack(name);
  }

  setCombatAnimationProgress(
    normalized: number,
    combatPhase = 'UNKNOWN',
  ) {
    this.combatAnimations
      .setProgress(
        normalized,
        combatPhase,
      );
  }

  setExactLocomotionProfile(profile: NonNullable<PlayerCharacterConfig['exactLocomotion']>) {
    this.animations.setExactLocomotionProfile(profile);
  }

  setCombatReadyPose(
    enabled: boolean,
  ) {
    if (!this.combatAnimations.available) return;

    const profileReadyClip = this.characterDefinition.leaderCombatProfile?.groups.saberReady;
    if (enabled) {
      // Native JKA leader profiles have an exact ready group, not the generic
      // `combat_ready` alias used by the original Nerathis combat rig.
      if (profileReadyClip) this.combatAnimations.playExact(profileReadyClip, true);
      else this.combatAnimations.playReady();
      return;
    }

    const active = this.combatAnimations.current.toLowerCase();
    if (active === 'combat_ready' || (profileReadyClip && active === profileReadyClip.toLowerCase())) {
      this.combatAnimations.clear();
      this.animations.setState(this.state);
    }
  }

  playCharacterLabClip(name: string, loop: boolean) {
    if (!import.meta.env.DEV) return false;
    const allowed = [
      ...Object.values(this.characterDefinition.characterLabJkaPreviewProfile?.groups ?? {}).filter((name): name is string => typeof name === 'string'),
      ...(this.characterDefinition.leaderCombatProfile
        ? Object.values(this.characterDefinition.leaderCombatProfile.groups).filter((name): name is string => typeof name === 'string')
        : []),
      ...(this.characterDefinition.leaderCombatProfile ? Object.values(this.characterDefinition.leaderCombatProfile.groups.parryResponses ?? {}) : []),
    ];
    if (!allowed.includes(name)) return false;
    return this.combatAnimations.playExact(name, loop);
  }

  clearCharacterLabClip() {
    if (!import.meta.env.DEV) return;
    this.combatAnimations.clear();
    this.animations.setLocomotionState(this.locomotionState, this.speed);
  }
  clearCombatAnimation() {
    if (
      !this.combatAnimations.active
    ) {
      return;
    }

    combatTrace.log('COMBAT ANIMATION CLEARED', { clip: this.combatAnimations.current, reason: 'clearCombatAnimation called' });
    this.combatAnimations.clear();

    this.animations.setState(
      this.state,
    );
  }

  // =========================================================
  // DEBUG / MEASUREMENTS
  // =========================================================

  get visualInfo() {
    const bounds =
      measureVisualBounds(
        this.animationsVisualMeshes,
      );

    return {
      minY: bounds.minY,
      maxY: bounds.maxY,
      height: bounds.height,
      feetY: bounds.feetY,
      scale:
        this.visualRoot.scaling.x,
    };
  }

  private get animationsVisualMeshes() {
    return this.visualRoot
      .getChildMeshes(false);
  }
}
