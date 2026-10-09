import { Vector3 } from '@babylonjs/core';

import {
  AttackDirection,
  AttackDirectionResolver,
} from '../combat/AttackDirectionResolver';

import { CombatMode } from '../combat/CombatMode';
import { HitReceiver } from '../combat/HitReceiver';

import {
  getSaberAttackProfile,
  AREN_COMBO_PROFILES,
  SaberAttackKind,
  SaberAttackProfile,
} from '../combat/SaberAttackProfile';

import { SaberSweepDetector } from '../combat/SaberSweepDetector';
import { SaberHitVolume } from '../combat/SaberHitVolume';

import { LightsaberController } from './LightsaberController';
import { PlayerController } from './PlayerController';

import {
  CombatAnimationName,
} from './PlayerCombatAnimationController';

import { WeaponAttachment } from './WeaponAttachment';
import { combatTrace } from '../debug/CombatTrace';

export type SaberAttackPhase =
  | 'READY'
  | 'WINDUP'
  | 'ACTIVE'
  | 'RECOVERY';

type BufferedAttack = {
  kind: SaberAttackKind;
  direction: AttackDirection;
  expiresAt: number;
  combo: boolean;
};

type CombatTarget = {
  id: string;
  receiver: HitReceiver;
  position: () => Vector3;
  radius: number;
};

export class LightsaberCombatController {
  // =========================================================
  // ATTACK STATE
  // =========================================================

  private phase:
    SaberAttackPhase =
      'READY';

  private elapsed = 0;

  private recoveryElapsed = 0;

  private profile?:
    SaberAttackProfile;

  private bufferedAttack?:
    BufferedAttack;

  private comboIndex = -1;
  private comboExpiresAt = 0;
  private comboAttack = false;
  private readonly comboTimeoutMs = 650;

  private get usesArenCombo() {
    return this.attachment.rightHandBoneName === 'RightHand_49';
  }

  private get nextComboIndex() {
    return this.comboIndex >= 0 && this.comboIndex < 2
      && (this.comboAttack && this.isBusy || performance.now() <= this.comboExpiresAt)
      ? this.comboIndex + 1 : 0;
  }

  // =========================================================
  // INPUT / TELEMETRY
  // =========================================================

  private lastInputTime = 0;

  private lastInputKind:
    'LIGHT'
    | 'HEAVY'
    | 'NONE' =
      'NONE';

  private lastInputAccepted =
    false;

  private executedAttacks = 0;

  private droppedAttacks = 0;

  private lastDirection =
    AttackDirection.CENTER;

  /**
   * Alternate small procedural variations only when authored
   * animation is not available.
   */
  private repeatVariant = 0;

  private pointerDown?: {
    x: number;
    y: number;
  };

  private tracePointerDown?: {
    x: number;
    y: number;
    startedAt: number;
    maxMovement: number;
    overUi: boolean;
  };

  // =========================================================
  // COMBAT HELPERS
  // =========================================================

  private readonly directionResolver =
    new AttackDirectionResolver(
      0.16,
    );

  private readonly sweepDetector =
    new SaberSweepDetector();

  private readonly swingOffset =
    new Vector3();

  private readonly armOffset =
    new Vector3();

  private readonly actionVelocity =
    new Vector3();

  private readonly targets:
    CombatTarget[] = [];

  private readonly targetsHitThisSwing =
    new Set<string>();

  private lastContact?: {
    targetId: string;
    direction: AttackDirection;
    speed: number;
    position: Vector3;
  };

  /**
   * True when the skeleton owns the attack.
   *
   * False means WeaponAttachment/SaberArmPoseController provides
   * the procedural fallback.
   */
  private authoredAttackActive =
    false;

  readonly hitVolume =
    new SaberHitVolume();

  constructor(
    private readonly player:
      PlayerController,

    private readonly attachment:
      WeaponAttachment,

    private readonly lightsaber:
      LightsaberController,
  ) {
    this.installInput();
  }

  // =========================================================
  // INPUT
  // =========================================================

  private installInput() {
    window.addEventListener(
      'pointerdown',
      (event) => {
        if (event.button === 0) {
          const target = event.target as HTMLElement | null;
          const overUi = Boolean(target?.closest('#dialogueOverlay, button, input, textarea'));
          this.tracePointerDown = { x: event.clientX, y: event.clientY, startedAt: performance.now(), maxMovement: 0, overUi };
          combatTrace.log('LMB RAW', {
            stage: 'pointerdown', button: event.button, pointerMovement: 0, durationMs: 0,
            cameraDragging: false, dialogueActive: this.dialogueActive, labMode: this.labMode,
            playerCanControl: this.player.playerCanControl, saberState: this.lightsaber.currentState,
          });
        }
        if (
          event.button !== 0
        ) {
          return;
        }

        const target = event.target as HTMLElement | null;

        if (
          target?.closest(
            '#dialogueOverlay, button, input, textarea',
          )
        ) {
          return;
        }

        this.pointerDown = {
          x: event.clientX,
          y: event.clientY,
        };
      },
    );

    window.addEventListener(
      'pointermove',
      (event) => {
        if (
          !this.pointerDown
        ) {
          return;
        }

        const moved =
          Math.hypot(
            event.clientX
            - this.pointerDown.x,

            event.clientY
            - this.pointerDown.y,
          );

        if (this.tracePointerDown) this.tracePointerDown.maxMovement = Math.max(this.tracePointerDown.maxMovement, moved);

        /*
         * Preserve orbit-camera dragging.
         *
         * A click becomes an attack only if it stayed under
         * the drag threshold.
         */
        if (moved > 7) {
          this.pointerDown =
            undefined;
        }
      },
    );

    window.addEventListener(
      'pointerup',
      (event) => {
        if (event.button !== 0) return;
        const tracePointer = this.tracePointerDown;
        this.tracePointerDown = undefined;
        const cameraDragging = Boolean(tracePointer && tracePointer.maxMovement > 7);
        const durationMs = tracePointer ? performance.now() - tracePointer.startedAt : 0;
        combatTrace.log('LMB RAW', {
          stage: 'pointerup', button: event.button,
          pointerMovement: tracePointer?.maxMovement ?? 0, durationMs,
          cameraDragging, dialogueActive: this.dialogueActive, labMode: this.labMode,
          playerCanControl: this.player.playerCanControl, saberState: this.lightsaber.currentState,
        });

        if (!this.pointerDown) {
          combatTrace.log('LMB RESULT', {
            acceptedAsAttack: false,
            reason: !tracePointer ? 'NO_MATCHING_POINTERDOWN' : tracePointer.overUi ? 'UI_TARGET' : cameraDragging ? 'CAMERA_DRAG_THRESHOLD' : 'CLICK_SUPPRESSED',
          });
          return;
        }

        this.pointerDown =
          undefined;

        event.preventDefault();
        const click = !cameraDragging && !tracePointer?.overUi;
        const attackAccepted = click ? this.requestLight() : false;
        combatTrace.log('LMB RESULT', {
          acceptedAsAttack: click,
          attackAccepted,
          reason: click ? 'CLICK_NOT_DRAG' : cameraDragging ? 'CAMERA_DRAG_THRESHOLD' : tracePointer?.overUi ? 'UI_TARGET' : 'DIALOGUE_ACTIVE',
        });
      },
    );

    window.addEventListener(
      'pointercancel',
      (event) => {
        if ((event as PointerEvent).button === 0) {
          combatTrace.log('LMB RESULT', { acceptedAsAttack: false, reason: 'POINTER_CANCEL' });
          this.tracePointerDown = undefined;
        }
        this.pointerDown =
          undefined;
      },
    );

    window.addEventListener(
      'keydown',
      (event) => {
        if (
          event.repeat
          || event.key.toLowerCase()
            !== 'j'
        ) {
          return;
        }

        const canAttack = this.canAcceptAttackNow;
        combatTrace.log('HEAVY INPUT', {
          saberState: this.lightsaber.currentState,
          combatPhase: this.phase,
          attackInProgress: this.isBusy,
          canAttack,
          playerCanControl: this.player.playerCanControl,
        });

        event.preventDefault();

        const accepted = this.requestHeavy();
        combatTrace.log('HEAVY INPUT RESULT', {
          accepted,
          reason: accepted ? 'ATTACK_OR_BUFFER_ACCEPTED' : this.rejectionReason,
        });
      },
    );
  }

  // =========================================================
  // TARGETS
  // =========================================================

  registerTarget(
    target: CombatTarget,
  ) {
    this.targets.push(
      target,
    );
  }

  clearTargets() {
    this.targets.length = 0;
  }

  // =========================================================
  // USER ATTACK REQUESTS
  // =========================================================

  requestLight(): boolean {
    if (
      !this.lightsaber.isOn
    ) {
      combatTrace.log('ATTACK REJECTED', { reason: `saberState=${this.lightsaber.currentState}`, input: 'LIGHT' });
      return false;
    }

    this.directionResolver.update(
      0,
      this.player.movementInput,
    );

    combatTrace.log('LIGHT INPUT', { saberState: this.lightsaber.currentState, combatPhase: this.phase, attackInProgress: this.isBusy, canAttack: this.canAcceptAttackNow, playerCanControl: this.player.playerCanControl });
    return this.requestAttack(
      'LIGHT',
      this.directionResolver.resolve(),
      this.usesArenCombo,
    );
  }

  requestHeavy(): boolean {
    if (
      !this.lightsaber.isOn
    ) {
      combatTrace.log('ATTACK REJECTED', { reason: `saberState=${this.lightsaber.currentState}`, input: 'HEAVY' });
      return false;
    }

    this.directionResolver.update(
      0,
      this.player.movementInput,
    );

    return this.requestAttack(
      'HEAVY',
      this.usesArenCombo ? AttackDirection.FORWARD : this.directionResolver.resolve(),
    );
  }

  requestDirectionalLight(
    direction:
      AttackDirection,
  ): boolean {
    if (
      this.lightsaber.isOn
    ) {
      return this.requestAttack(
        'LIGHT',
        direction,
      );
    }
    combatTrace.log('ATTACK REJECTED', { reason: `saberState=${this.lightsaber.currentState}`, input: 'LIGHT', source: 'directional' });
    return false;
  }

  requestDirectionalHeavy(
    direction:
      AttackDirection,
  ): boolean {
    if (
      this.lightsaber.isOn
    ) {
      return this.requestAttack(
        'HEAVY',
        direction,
      );
    }
    combatTrace.log('ATTACK REJECTED', { reason: `saberState=${this.lightsaber.currentState}`, input: 'HEAVY', source: 'directional' });
    return false;
  }

  // =========================================================
  // EXTERNAL COMBAT RESULT
  // =========================================================

  notifyExternalResult(
    result:
      | 'CLASH'
      | 'BLOCK'
      | 'PARRY'
      | 'BODY_HIT',
  ) {
    if (
      this.phase === 'READY'
    ) {
      return;
    }

    this.bufferedAttack =
      undefined;

    if (result === 'PARRY' || result === 'CLASH') {
      this.comboIndex = -1;
      this.comboExpiresAt = 0;
    }

    this.phase =
      'RECOVERY';

    this.recoveryElapsed =
      result === 'PARRY'
        ? 0
        : 0.06;

    this.elapsed =
      this.profile?.duration
      ?? this.elapsed;

    this.hitVolume.endFrame();

    this.sweepDetector.begin();
  }

  // =========================================================
  // ATTACK REQUEST / BUFFER
  // =========================================================

  private requestAttack(
    kind:
      SaberAttackKind,

    direction:
      AttackDirection,
    combo = false,
  ): boolean {
    const now =
      performance.now();

    this.lastInputKind =
      kind;

    this.lastInputAccepted =
      false;

    const reject = (reason: string) => {
      this.droppedAttacks += 1;
      combatTrace.log('ATTACK REJECTED', { reason, currentPhase: this.phase, saberState: this.lightsaber.currentState });
      return false;
    };
    if (!this.player.playerCanControl) return reject('PLAYER_CONTROL_LOCKED');
    if (this.dialogueActive) return reject('DIALOGUE_ACTIVE');
    if (/^(block_|parry_)/.test(this.player.combatAnimationState)) return reject('DEFENSE_ACTIVE');
    if (now - this.lastInputTime < 90) return reject('DUPLICATE_INPUT_DEBOUNCE_90MS');

    // -------------------------------------------------------
    // READY -> ATTACK
    // -------------------------------------------------------

    if (
      this.phase === 'READY'
    ) {
      this.startAttack(
        kind,
        direction,
        combo,
      );

      this.lastInputTime =
        now;

      this.lastInputAccepted =
        true;

      this.traceAcceptedAttack(kind, direction, false, combo);

      return true;
    }

    // -------------------------------------------------------
    // INPUT BUFFER
    // -------------------------------------------------------

    const nearEndOfSwing = Boolean(this.profile && this.elapsed >= this.profile.activeEnd);

    const recoveryDuration =
      this.profile?.recovery
      ?? 0.16;

    const nearEndOfRecovery =
      this.phase === 'RECOVERY'
      && this.recoveryElapsed
        >= Math.max(
          0,
          recoveryDuration - 0.22,
        );

    if (
      nearEndOfSwing
      || nearEndOfRecovery
    ) {
      if (this.bufferedAttack) return reject('BUFFER_ALREADY_FILLED');
      if (combo && (!this.comboAttack || this.comboIndex >= 2)) return reject('COMBO_FINISHER_MUST_RECOVER');
      this.bufferedAttack = {
        kind,
        direction,
        combo,

        /*
         * Slightly generous queue window.
         */
        expiresAt:
          now + Math.max(0, (this.profile?.duration ?? 0) - this.elapsed
            + recoveryDuration - this.recoveryElapsed) * 1000 + 200,
      };

      this.lastInputTime = now;

      this.lastInputAccepted =
        true;

      this.traceAcceptedAttack(kind, direction, true, combo);

      return true;
    }

    this.droppedAttacks +=
      1;
    combatTrace.log('ATTACK REJECTED', { reason: `currentPhase=${this.phase}; buffer window closed`, currentPhase: this.phase, attackInProgress: this.isBusy, saberState: this.lightsaber.currentState });
    return false;
  }

  // =========================================================
  // UPDATE
  // =========================================================

  update(
    deltaSeconds: number,
  ) {
    this.directionResolver.update(
      deltaSeconds,
      this.player.movementInput,
    );

    this.lightsaber.setToggleLocked(
      this.isBusy,
    );

    // -------------------------------------------------------
    // READY
    // -------------------------------------------------------

    if (
      this.phase === 'READY'
    ) {
      if (!this.lightsaber.isOn || performance.now() > this.comboExpiresAt) {
        this.comboIndex = -1;
      }
      this.attachment
        .clearCombatOffset();

      this.attachment
        .clearCombatPose();

      this.player
        .clearCombatControl();

      this.hitVolume
        .endFrame();

      return;
    }

    // -------------------------------------------------------
    // RECOVERY
    // -------------------------------------------------------

    if (
      this.phase === 'RECOVERY'
      && this.elapsed >= (this.profile?.duration ?? 0)
    ) {
      this.recoveryElapsed +=
        deltaSeconds;

      if (
        this.authoredAttackActive
      ) {
        /*
         * Hold the final authored pose until recovery ends.
         */
        this.player
          .setCombatAnimationProgress(
            1,
            this.phase,
          );
      } else {
        this.attachment
          .clearCombatOffset();

        this.attachment
          .clearCombatPose();
      }

      if (this.profile) {
        this.player
          .setCombatControl(
            this.profile
              .movementMultiplier
              * 0.35,

            this.profile
              .turnAllowance,

            Vector3.Zero(),
          );
      }

      this.hitVolume
        .endFrame();

      if (
        this.profile
        && this.recoveryElapsed
          >= this.profile.recovery
      ) {
        this.finishRecovery();
      }

      return;
    }

    // -------------------------------------------------------
    // ACTIVE ATTACK
    // -------------------------------------------------------

    if (!this.profile) {
      return;
    }

    this.elapsed +=
      deltaSeconds;

    this.phase = this.elapsed < this.profile.activeStart ? 'WINDUP'
      : this.elapsed <= this.profile.activeEnd ? 'ACTIVE' : 'RECOVERY';

    const normalized =
      Math.min(
        1,
        this.elapsed
        / this.profile.duration,
      );

    if (
      this.authoredAttackActive
    ) {
      /*
       * Skeleton owns the saber movement.
       */
      this.attachment
        .clearCombatOffset();

      this.attachment
        .clearCombatPose();

      this.player
        .setCombatAnimationProgress(
          normalized,
          this.phase,
        );
    } else {
      /*
       * Procedural fallback.
       */
      this.applyArc(
        this.profile,
        normalized,
      );
    }

    // -------------------------------------------------------
    // HIT WINDOW
    // -------------------------------------------------------

    if (
      this.phase === 'ACTIVE'
    ) {
      this.updateSweep(
        deltaSeconds,
      );
    } else {
      this.hitVolume
        .endFrame();

      this.sweepDetector
        .begin();
    }

    // -------------------------------------------------------
    // FINISH SWING
    // -------------------------------------------------------

    if (
      this.elapsed
      >= this.profile.duration
    ) {
      this.phase =
        'RECOVERY';

      this.recoveryElapsed =
        0;

      this.hitVolume
        .endFrame();

      this.sweepDetector
        .begin();
    }
  }

  // =========================================================
  // START ATTACK
  // =========================================================

  private startAttack(
    kind:
      SaberAttackKind,

    direction:
      AttackDirection,
    combo = false,
  ) {
    /*
     * Capture PREVIOUS direction before replacing the profile.
     *
     * V1 compared this.profile.direction after assigning the new
     * profile, which meant every attack looked like a repeated
     * direction.
     */
    const previousDirection =
      this.lastDirection;

    const previousKind =
      this.profile?.kind;

    this.comboIndex = combo ? this.nextComboIndex : -1;
    this.comboAttack = combo;
    this.comboExpiresAt = 0;
    this.profile = combo ? AREN_COMBO_PROFILES[this.comboIndex] : getSaberAttackProfile(kind, direction);
    direction = this.profile.direction;

    combatTrace.log('ATTACK PROFILE SELECTED', {
      attackId: this.profile.id,
      attackType: kind,
      direction,
      profile: this.profile,
      duration: this.profile.duration,
      windup: this.profile.activeStart,
      active: { start: this.profile.activeStart, end: this.profile.activeEnd },
      recovery: this.profile.recovery,
      comboIndex: combo ? this.comboIndex : null,
    });

    this.phase =
      'WINDUP';

    this.elapsed =
      0;

    this.recoveryElapsed =
      0;

    this.bufferedAttack =
      undefined;

    const wasRepeat =
      previousDirection
        === direction
      && previousKind
        === kind;

    this.repeatVariant =
      wasRepeat
        ? (
            this.repeatVariant
            + 1
          ) % 2
        : 0;

    this.lastDirection =
      direction;

    this.targetsHitThisSwing
      .clear();

    combatTrace.beginAttack(this.profile.id, false);

    this.lastContact =
      undefined;

    this.sweepDetector
      .begin();

    // -------------------------------------------------------
    // ATTACK FOOTWORK
    // -------------------------------------------------------

    const localDirection =
      direction
        === AttackDirection.CENTER
        ? Vector3.Zero()
        : this.directionResolver
            .vectorFor(
              direction,
            );

    const worldDirection =
      direction
        === AttackDirection.CENTER
        ? this.player
            .cameraForwardDirection
        : this.player
            .getWorldDirectionFromInput(
              localDirection,
            );

    /*
     * movementStep is now always positive.
     *
     * AttackDirection already provides the sign/direction.
     */
    this.actionVelocity
      .copyFrom(
        worldDirection,
      )
      .scaleInPlace(
        this.profile.movementStep
        / Math.max(
          0.01,
          this.profile.duration,
        ),
      );

    this.player
      .setCombatControl(
        this.profile
          .movementMultiplier,

        this.profile
          .turnAllowance,

        this.actionVelocity,
      );

    // -------------------------------------------------------
    // AUTHORED CLIP
    // -------------------------------------------------------

    const authoredClip =
      this.resolveAuthoredClip(
        this.profile.id,
      );

    combatTrace.log('ATTACK CLIP REQUEST', {
      attackId: this.profile.id,
      requestedClip: authoredClip ?? 'NONE',
      fallbackCandidates: authoredClip ? this.player.combatAnimations.fallbackCandidates(authoredClip) : [],
      locomotionCurrent: this.player.animations.activeClipName,
    });

    this.authoredAttackActive =
      authoredClip
        ? this.player
            .playCombatAttack(
              authoredClip,
            )
        : false;

    this.attachment
      .setAuthoredAnimationActive(
        this.authoredAttackActive,
      );

    this.lightsaber
      .setToggleLocked(
        true,
      );

    this.executedAttacks +=
      1;

    combatTrace.setOwnsSkeleton(this.authoredAttackActive);
  }

  // =========================================================
  // RECOVERY
  // =========================================================

  private finishRecovery() {
    const buffered =
      this.bufferedAttack;

    this.bufferedAttack =
      undefined;

    const endingClip = this.player.combatAnimationState;
    const endingFrame = this.player.combatAnimationFrame;
    const chained = Boolean(buffered && buffered.expiresAt >= performance.now());
    combatTrace.log('ATTACK END', {
      clip: endingClip,
      finalFrame: endingFrame,
      phase: this.phase,
      nextCombatState: chained ? 'WINDUP' : 'READY',
      locomotionResumed: !chained,
    });
    combatTrace.endAttack();

    /*
     * Combo chaining.
     */
    if (
      buffered
      && buffered.expiresAt
        >= performance.now()
    ) {
      this.startAttack(
        buffered.kind,
        buffered.direction,
        buffered.combo,
      );

      return;
    }

    this.comboExpiresAt = this.comboAttack && this.comboIndex < 2
      ? performance.now() + this.comboTimeoutMs : 0;
    if (!this.comboExpiresAt) this.comboIndex = -1;
    this.comboAttack = false;

    this.profile =
      undefined;

    this.phase =
      'READY';

    this.elapsed =
      0;

    this.recoveryElapsed =
      0;

    this.player
      .clearCombatControl();

    if (
      this.authoredAttackActive
    ) {
      this.attachment
        .setAuthoredAnimationActive(
          false,
        );

      this.player
        .clearCombatAnimation();
    }

    this.authoredAttackActive =
      false;

    this.lightsaber
      .setToggleLocked(
        false,
      );
  }

  // =========================================================
  // ATTACK PROFILE -> AUTHORED CLIP
  // =========================================================

  private resolveAuthoredClip(
    profileId: string,
  ):
    CombatAnimationName
    | undefined {
    const map:
      Record<
        string,
        CombatAnimationName
    > = {
      AREN_COMBO_1: 'slash_right',
      AREN_COMBO_2: 'slash_left',
      AREN_COMBO_3: 'slash_forward',
      // -----------------------------------------------------
      // LIGHT
      // -----------------------------------------------------

      LIGHT_CENTER:
        'slash_forward',

      LIGHT_FORWARD:
        'slash_forward',

      LIGHT_LEFT:
        'slash_left',

      LIGHT_RIGHT:
        'slash_right',

      LIGHT_FORWARD_LEFT:
        'slash_diagonal_left',

      LIGHT_FORWARD_RIGHT:
        'slash_diagonal_right',

      /*
       * V2 dedicated retreat attacks.
       *
       * PlayerCombatAnimationController automatically falls
       * back to V1 clips until these exist in the GLB.
       */
      LIGHT_BACKWARD:
        'slash_backward',

      LIGHT_BACK_LEFT:
        'slash_back_left',

      LIGHT_BACK_RIGHT:
        'slash_back_right',

      // -----------------------------------------------------
      // HEAVY
      // -----------------------------------------------------

      HEAVY_FORWARD:
        'heavy_overhead',

      HEAVY_LEFT:
        'heavy_left',

      HEAVY_RIGHT:
        'heavy_right',
    };

    return map[
      profileId
    ];
  }

  // =========================================================
  // PROCEDURAL FALLBACK
  // =========================================================

  private applyArc(
    profile:
      SaberAttackProfile,

    normalized:
      number,
  ) {
    const split =
      0.42;

    const first =
      normalized < split;

    const t =
      first
        ? this.smoothstep(
            normalized
            / split,
          )
        : this.smoothstep(
            (
              normalized
              - split
            )
            / (
              1 - split
            ),
          );

    const socket =
      first
        ? Vector3.Lerp(
            profile.socketWindup,
            profile.socketStrike,
            t,
          )
        : Vector3.Lerp(
            profile.socketStrike,
            Vector3.Zero(),
            t,
          );

    const arm =
      first
        ? Vector3.Lerp(
            profile.armWindup,
            profile.armStrike,
            t,
          )
        : Vector3.Lerp(
            profile.armStrike,
            Vector3.Zero(),
            t,
          );

    /*
     * Only the procedural fallback receives repeat variation.
     *
     * Authored clips should contain their own readable body motion.
     */
    if (
      this.repeatVariant === 1
    ) {
      socket.y *=
        0.88;

      arm.y *=
        0.90;
    }

    this.swingOffset
      .copyFrom(
        socket,
      );

    this.armOffset
      .copyFrom(
        arm,
      );

    this.attachment
      .setCombatOffset(
        this.swingOffset,
      );

    this.attachment
      .setCombatPose(
        this.armOffset,
      );
  }

  // =========================================================
  // SABER SWEEP / HIT DETECTION
  // =========================================================

  private updateSweep(
    deltaSeconds:
      number,
  ) {
    const segment =
      this.attachment
        .getBladeSegment();

    if (
      !segment
      || !this.profile
    ) {
      return;
    }

    if (
      !this.hitVolume.isActive
    ) {
      this.hitVolume.begin(
        this.profile.id,

        this.profile.power > 1
          ? 0.15
          : 0.10,
      );
    }

    this.hitVolume
      .updateFromAttachment(
        this.attachment,
      );

    this.sweepDetector
      .update(
        segment.start,
        segment.end,
        deltaSeconds,
      );

    const event =
      this.hitVolume.toEvent(
        'aren_vey',
        this.profile.power,
      );

    if (!event) {
      return;
    }

    for (
      const target
      of this.targets
    ) {
      if (
        this.targetsHitThisSwing
          .has(
            target.id,
          )
      ) {
        continue;
      }

      if (
        !this.sweepDetector
          .intersectsSphere(
            target.position(),
            target.radius,
          )
      ) {
        continue;
      }

      target.receiver
        .receiveSaberHit(
          event,
        );

      this.targetsHitThisSwing
        .add(
          target.id,
        );

      this.lastContact = {
        targetId:
          target.id,

        direction:
          this.lastDirection,

        speed:
          this.sweepDetector
            .saberSpeed,

        position:
          event.position.clone(),
      };
    }
  }

  // =========================================================
  // MATH
  // =========================================================

  private smoothstep(
    value: number,
  ) {
    const clamped =
      Math.max(
        0,
        Math.min(
          1,
          value,
        ),
      );

    return (
      clamped
      * clamped
      * (
        3
        - 2
        * clamped
      )
    );
  }

  // =========================================================
  // TELEMETRY
  // =========================================================

  get currentState() {
    return this.phase;
  }

  get currentPhase() {
    return this.phase;
  }

  get currentAttackId() {
    return (
      this.profile?.id
      ?? 'NONE'
    );
  }

  get currentAttackPower() {
    return (
      this.profile?.power
      ?? 0
    );
  }

  private get dialogueActive() {
    const overlay = document.getElementById('dialogueOverlay');
    return Boolean(overlay && !overlay.classList.contains('is-hidden'));
  }

  private get labMode() {
    const search = new URLSearchParams(window.location.search);
    return search.get('arenLab') === '1' || search.get('ithorianLab') === '1' || search.get('characterLab') === '1';
  }

  private get canAcceptAttackNow() {
    if (this.bufferedAttack || !this.player.playerCanControl || /^(block_|parry_)/.test(this.player.combatAnimationState)) return false;
    if (this.phase === 'READY') return true;
    const nearEndOfSwing = Boolean(this.profile && this.elapsed >= this.profile.activeEnd);
    const nearEndOfRecovery = this.phase === 'RECOVERY' && this.recoveryElapsed >= Math.max(0, (this.profile?.recovery ?? 0.16) - 0.22);
    return nearEndOfSwing || nearEndOfRecovery;
  }

  private get rejectionReason() {
    if (!this.lightsaber.isOn) return `saberState=${this.lightsaber.currentState}`;
    if (!this.canAcceptAttackNow) return `currentPhase=${this.phase}; buffer window closed`;
    return 'DUPLICATE_INPUT_DEBOUNCE_90MS';
  }

  private traceAcceptedAttack(kind: SaberAttackKind, direction: AttackDirection, buffered: boolean, combo = false) {
    const index = buffered ? this.nextComboIndex : this.comboIndex;
    const profile = combo ? AREN_COMBO_PROFILES[index] : getSaberAttackProfile(kind, direction);
    const requestedClip = this.resolveAuthoredClip(profile.id);
    combatTrace.log('ATTACK ACCEPTED', {
      attackId: profile.id,
      attackType: kind,
      direction,
      requestedClip: requestedClip ?? 'NONE',
      fallbackCandidates: requestedClip ? this.player.combatAnimations.fallbackCandidates(requestedClip) : [],
      profile,
      phase: buffered ? this.phase : 'WINDUP',
      duration: profile.duration,
      windup: profile.activeStart,
      active: { start: profile.activeStart, end: profile.activeEnd },
      recovery: profile.recovery,
      buffered,
      comboIndex: combo ? index : null,
      authoredGroupFound: requestedClip ? this.player.combatAnimations.hasExact(requestedClip) || this.player.combatAnimations.fallbackCandidates(requestedClip).some((candidate) => this.player.combatAnimations.hasExact(candidate as CombatAnimationName)) : false,
    });
  }

  get lastInputLabel() {
    return (
      `${this.lastInputKind} / `
      + (
        this.lastInputAccepted
          ? 'ACCEPTED'
          : 'DROPPED'
      )
    );
  }

  get executedAttackCount() {
    return this.executedAttacks;
  }

  get droppedAttackCount() {
    return this.droppedAttacks;
  }

  get attackProgress() {
    return this.profile
      ? Math.min(
          1,
          this.elapsed
          / this.profile.duration,
        )
      : 0;
  }

  get currentDirection() {
    return this.lastDirection;
  }

  get combatMode() {
    return this.isBusy
      ? CombatMode.REALTIME_COMBAT
      : CombatMode.EXPLORATION;
  }

  get isBusy() {
    return (
      this.phase !== 'READY'
    );
  }

  get hitboxActive() {
    return this.hitVolume
      .isActive;
  }

  get saberSpeed() {
    return this.sweepDetector
      .saberSpeed;
  }

  get lastContactInfo() {
    return this.lastContact;
  }

  get sweepDebug() {
    return this.sweepDetector
      .debugData;
  }
}
