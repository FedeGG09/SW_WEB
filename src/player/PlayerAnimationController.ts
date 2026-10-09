import { AnimationGroup } from '@babylonjs/core';
import { LOCOMOTION } from './LocomotionConfig';
import { LocomotionState } from './LocomotionState';
import { combatTrace } from '../debug/CombatTrace';
import type { ExactLocomotionProfile } from './PlayerCharacterConfig';

export type PlayerAnimationState = 'IDLE' | 'WALK' | 'RUN';

type LocomotionClipSet = {
  idle?: AnimationGroup;

  walkForward?: AnimationGroup;
  runForward?: AnimationGroup;

  backward?: AnimationGroup;

  strafeLeft?: AnimationGroup;
  strafeRight?: AnimationGroup;

  diagonalForwardLeft?: AnimationGroup;
  diagonalForwardRight?: AnimationGroup;

  diagonalBackLeft?: AnimationGroup;
  diagonalBackRight?: AnimationGroup;

  turnLeft?: AnimationGroup;
  turnRight?: AnimationGroup;
};

type PlaybackRequest = {
  clip?: AnimationGroup;
  referenceSpeed: number;
  label: string;
  fallback: boolean;
};

/**
 * Owns locomotion animation only.
 *
 * Combat clips are deliberately excluded because
 * PlayerCombatAnimationController must remain the sole owner
 * of authored lightsaber animation.
 *
 * The controller prefers the V2 names we are going to author,
 * but stays compatible with the current donor GLB.
 */
export class PlayerAnimationController {
  private clips!: LocomotionClipSet;
  private readonly locomotionGroups: AnimationGroup[];

  private state: PlayerAnimationState = 'IDLE';
  private detailedState: LocomotionState = 'IDLE';

  private active?: AnimationGroup;
  private activeLabel = 'neutral pose';

  private lastPlaybackRatio = 1;
  private lastAttackTraceRequest = '';
  private exactProfileSource?: string;
  private exactClipSources?: Record<string, string>;
  private resolutionTrace: Record<string, unknown> = {};

  constructor(groups: AnimationGroup[], exactProfile?: ExactLocomotionProfile, excludedGroupNames: string[] = []) {
    const excluded = new Set(excludedGroupNames.map((name) => this.normalise(name)));
    this.locomotionGroups = groups.filter(
      (group) => !this.isCombatGroup(group.name) && !excluded.has(this.normalise(group.name)),
    );

    if (exactProfile) {
      this.setExactLocomotionProfile(exactProfile);
      return;
    }

    const find = (...patterns: RegExp[]) =>
      this.locomotionGroups.find((group) =>
        patterns.some((pattern) => pattern.test(this.normalise(group.name))),
      );

    /*
     * IMPORTANT:
     *
     * Search the purpose-built V2 names first.
     * Only then fall back to legacy/donor names.
     */

    const walkForward =
      find(
        /^walk_forward_v2$/,
        /^walk_forward$/,
        /^walk$/,
        /walk-ip/,
        /locomotion/,
        /mixamo/,
      )
      ?? this.locomotionGroups[0];

    this.clips = {
      idle: find(
        /^idle_v2$/,
        /^idle$/,
        /idle/,
        /stand/,
        /breath/,
      ),

      walkForward,

      runForward: find(
        /^run_forward_v2$/,
        /^run_forward$/,
        /^run$/,
        /sprint/,
        /jog/,
      ),

      backward: find(
        /^backpedal_v2$/,
        /^walk_backward_v2$/,
        /^walk_backward$/,
        /^backpedal$/,
        /backward/,
        /reverse/,
      ),

      strafeLeft: find(
        /^strafe_left_v2$/,
        /^strafe_left$/,
        /strafe.*left/,
        /left.*strafe/,
        /sidestep.*left/,
      ),

      strafeRight: find(
        /^strafe_right_v2$/,
        /^strafe_right$/,
        /strafe.*right/,
        /right.*strafe/,
        /sidestep.*right/,
      ),

      diagonalForwardLeft: find(
        /^forward_left_v2$/,
        /^walk_forward_left$/,
        /^diagonal_forward_left$/,
      ),

      diagonalForwardRight: find(
        /^forward_right_v2$/,
        /^walk_forward_right$/,
        /^diagonal_forward_right$/,
      ),

      diagonalBackLeft: find(
        /^back_left_v2$/,
        /^walk_back_left$/,
        /^diagonal_back_left$/,
      ),

      diagonalBackRight: find(
        /^back_right_v2$/,
        /^walk_back_right$/,
        /^diagonal_back_right$/,
      ),

      turnLeft: find(
        /^turn_left_v2$/,
        /^turn_left$/,
      ),

      turnRight: find(
        /^turn_right_v2$/,
        /^turn_right$/,
      ),
    };

    this.setLocomotionState('IDLE', 0);
  }

  /** Replace the exact source-semantic clip set without fuzzy name lookup. */
  setExactLocomotionProfile(profile: ExactLocomotionProfile) {
    this.exactProfileSource = profile.source ?? 'character-definition';
    this.exactClipSources = profile.sourceSupermodelByClip;
    const exact = (name?: string) =>
      name ? this.locomotionGroups.find((group) => group.name === name) : undefined;
    this.clips = {
      idle: exact(profile.idle),
      walkForward: exact(profile.walk),
      runForward: exact(profile.run),
      backward: exact(profile.backward),
      strafeLeft: exact(profile.strafeLeft),
      strafeRight: exact(profile.strafeRight),
    };
    this.setLocomotionState(this.detailedState, 0);
  }

  setState(next: PlayerAnimationState) {
    const detailed: LocomotionState =
      next === 'RUN'
        ? 'RUN_FORWARD'
        : next === 'WALK'
          ? 'WALK_FORWARD'
          : 'IDLE';

    const speed =
      next === 'RUN'
        ? LOCOMOTION.runSpeed
        : next === 'WALK'
          ? LOCOMOTION.walkSpeed
          : 0;

    this.setLocomotionState(detailed, speed);
  }

  setLocomotionState(
    next: LocomotionState,
    horizontalSpeed: number,
  ) {
    if (combatTrace.combatOwnsSkeleton) {
      const request = `${next}:${this.resolvePlayback(next).clip?.name ?? 'NONE'}`;
      if (request !== this.lastAttackTraceRequest) {
        this.lastAttackTraceRequest = request;
        combatTrace.log('LOCOMOTION REQUEST DURING ATTACK', {
          requested: this.resolvePlayback(next).clip?.name ?? 'NONE',
          combatOwnsSkeleton: true,
        });
      }
    } else {
      this.lastAttackTraceRequest = '';
    }
    this.detailedState = next;

    this.state =
      next === 'IDLE'
        ? 'IDLE'
        : next === 'RUN_FORWARD'
          ? 'RUN'
          : 'WALK';

    if (next === 'IDLE') {
      this.recordResolution(next, this.clips.idle, false);
      this.applyIdle();
      return;
    }

    const request = this.resolvePlayback(next);
    this.recordResolution(next, request.clip, request.fallback);

    if (!request.clip) {
      this.applyNeutralPose();
      return;
    }

    const rawRatio =
      horizontalSpeed
      / Math.max(0.01, request.referenceSpeed);

    let ratio = Math.max(
      LOCOMOTION.animationMinRatio,
      Math.min(
        LOCOMOTION.animationMaxRatio,
        rawRatio,
      ),
    );

    /*
     * Fallback clips are intentionally kept calmer.
     *
     * Example:
     * If the only animation available is walk-ip, we do not want
     * strafing/backpedal to look like the character is sprinting
     * sideways simply because gameplay velocity is higher.
     */
    if (request.fallback) {
      if (
        next === 'BACKPEDAL'
        || next === 'BACK_LEFT'
        || next === 'BACK_RIGHT'
      ) {
        ratio = Math.min(ratio, 0.88);
      }

      if (
        next === 'STRAFE_LEFT'
        || next === 'STRAFE_RIGHT'
      ) {
        ratio = Math.min(ratio, 0.92);
      }

      if (
        next === 'FORWARD_LEFT'
        || next === 'FORWARD_RIGHT'
      ) {
        ratio = Math.min(ratio, 1.05);
      }

      if (next === 'RUN_FORWARD') {
        /*
         * Current project has no genuine run clip.
         *
         * Avoid the old exaggerated 1.8x-looking walk.
         * The actual V2 run animation will replace this fallback.
         */
        ratio = Math.min(ratio, 1.34);
      }
    }

    this.play(
      request.clip,
      ratio,
      request.label,
      request.fallback,
    );
  }

  private resolvePlayback(
    state: LocomotionState,
  ): PlaybackRequest {
    const walk = this.clips.walkForward;

    switch (state) {
      case 'RUN_FORWARD':
        if (this.clips.runForward) {
          return {
            clip: this.clips.runForward,
            referenceSpeed: LOCOMOTION.animationRunReferenceSpeed,
            label: 'run-forward',
            fallback: false,
          };
        }

        return {
          clip: walk,
          referenceSpeed: LOCOMOTION.animationWalkReferenceSpeed,
          label: 'run / walk fallback',
          fallback: true,
        };

      case 'BACKPEDAL':
        if (this.clips.backward) {
          return {
            clip: this.clips.backward,
            referenceSpeed: LOCOMOTION.animationBackReferenceSpeed,
            label: 'backpedal',
            fallback: false,
          };
        }

        return {
          clip: walk,
          referenceSpeed: LOCOMOTION.animationWalkReferenceSpeed,
          label: 'backpedal / walk fallback',
          fallback: true,
        };

      case 'STRAFE_LEFT':
        if (this.clips.strafeLeft) {
          return {
            clip: this.clips.strafeLeft,
            referenceSpeed: LOCOMOTION.animationStrafeReferenceSpeed,
            label: 'strafe-left',
            fallback: false,
          };
        }

        return {
          clip: walk,
          referenceSpeed: LOCOMOTION.animationWalkReferenceSpeed,
          label: 'strafe-left / walk fallback',
          fallback: true,
        };

      case 'STRAFE_RIGHT':
        if (this.clips.strafeRight) {
          return {
            clip: this.clips.strafeRight,
            referenceSpeed: LOCOMOTION.animationStrafeReferenceSpeed,
            label: 'strafe-right',
            fallback: false,
          };
        }

        return {
          clip: walk,
          referenceSpeed: LOCOMOTION.animationWalkReferenceSpeed,
          label: 'strafe-right / walk fallback',
          fallback: true,
        };

      case 'FORWARD_LEFT':
        if (this.clips.diagonalForwardLeft) {
          return {
            clip: this.clips.diagonalForwardLeft,
            referenceSpeed: LOCOMOTION.animationWalkReferenceSpeed,
            label: 'forward-left',
            fallback: false,
          };
        }

        return {
          clip: walk,
          referenceSpeed: LOCOMOTION.animationWalkReferenceSpeed,
          label: 'forward-left / walk fallback',
          fallback: true,
        };

      case 'FORWARD_RIGHT':
        if (this.clips.diagonalForwardRight) {
          return {
            clip: this.clips.diagonalForwardRight,
            referenceSpeed: LOCOMOTION.animationWalkReferenceSpeed,
            label: 'forward-right',
            fallback: false,
          };
        }

        return {
          clip: walk,
          referenceSpeed: LOCOMOTION.animationWalkReferenceSpeed,
          label: 'forward-right / walk fallback',
          fallback: true,
        };

      case 'BACK_LEFT':
        if (this.clips.diagonalBackLeft) {
          return {
            clip: this.clips.diagonalBackLeft,
            referenceSpeed: LOCOMOTION.animationBackReferenceSpeed,
            label: 'back-left',
            fallback: false,
          };
        }

        if (this.clips.backward) {
          return {
            clip: this.clips.backward,
            referenceSpeed: LOCOMOTION.animationBackReferenceSpeed,
            label: 'back-left / backpedal fallback',
            fallback: true,
          };
        }

        return {
          clip: walk,
          referenceSpeed: LOCOMOTION.animationWalkReferenceSpeed,
          label: 'back-left / walk fallback',
          fallback: true,
        };

      case 'BACK_RIGHT':
        if (this.clips.diagonalBackRight) {
          return {
            clip: this.clips.diagonalBackRight,
            referenceSpeed: LOCOMOTION.animationBackReferenceSpeed,
            label: 'back-right',
            fallback: false,
          };
        }

        if (this.clips.backward) {
          return {
            clip: this.clips.backward,
            referenceSpeed: LOCOMOTION.animationBackReferenceSpeed,
            label: 'back-right / backpedal fallback',
            fallback: true,
          };
        }

        return {
          clip: walk,
          referenceSpeed: LOCOMOTION.animationWalkReferenceSpeed,
          label: 'back-right / walk fallback',
          fallback: true,
        };

      case 'WALK_FORWARD':
      default:
        return {
          clip: walk,
          referenceSpeed: LOCOMOTION.animationWalkReferenceSpeed,
          label: 'walk-forward',
          fallback: false,
        };
    }
  }

  private applyIdle() {
    if (this.clips.idle) {
      this.play(
        this.clips.idle,
        1,
        'idle',
        false,
      );
      return;
    }

    /*
     * Until idle_v2 exists, hold the first frame of the donor
     * walk instead of continuously running a walk cycle at zero speed.
     */
    this.applyNeutralPose();
  }

  private applyNeutralPose() {
    const base = this.clips.walkForward;

    this.stopAll();

    if (base) {
      base.goToFrame(base.from);
      this.activeLabel =
        `neutral fallback: ${base.name} @ ${base.from.toFixed(1)}`;
    } else {
      this.activeLabel = 'neutral fallback / no locomotion clip';
    }

    this.active = undefined;
    this.lastPlaybackRatio = 1;
  }

  private play(
    group: AnimationGroup,
    speedRatio: number,
    label: string,
    fallback: boolean,
  ) {
    const clipChanged = this.active !== group;

    if (clipChanged || !group.isPlaying) {
      this.stopAll();

      group.start(
        true,
        speedRatio,
        group.from,
        group.to,
      );

      this.active = group;
    }

    /*
     * Avoid huge instantaneous playback jumps.
     *
     * PlayerController already smooths physical velocity, so this
     * lightweight interpolation lets animation cadence follow that
     * physical acceleration instead of snapping.
     */
    const ratioBlend = 0.28;

    this.lastPlaybackRatio +=
      (speedRatio - this.lastPlaybackRatio)
      * ratioBlend;

    group.speedRatio = this.lastPlaybackRatio;

    this.activeLabel =
      `${label}${fallback ? ' [fallback]' : ''}: `
      + `${group.name} ×${this.lastPlaybackRatio.toFixed(2)}`;
  }

  private stopAll() {
    this.locomotionGroups.forEach(
      (group) => group.stop(),
    );
  }

  private normalise(name: string) {
    return name
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/-/g, '_');
  }

  private isCombatGroup(name: string) {
    const normalised = this.normalise(name);

    return /^(combat_ready|slash_left|slash_right|slash_forward|slash_diagonal_left|slash_diagonal_right|slash_backward|slash_back_left|slash_back_right|heavy_overhead|heavy_left|heavy_right|block_center|block_left|block_right|parry_left|parry_right)$/i.test(
      normalised,
    );
  }

  get currentState() {
    return this.state;
  }

  get currentLocomotionState() {
    return this.detailedState;
  }

  get availableAnimation() {
    return this.activeLabel;
  }

  get availableClips() {
    return {
      idle:
        this.clips.idle?.name
        ?? 'neutral fallback',

      walk:
        this.clips.walkForward?.name
        ?? 'none',

      run:
        this.clips.runForward?.name
        ?? 'walk fallback',

      backward:
        this.clips.backward?.name
        ?? 'walk fallback',

      strafeLeft:
        this.clips.strafeLeft?.name
        ?? 'walk fallback',

      strafeRight:
        this.clips.strafeRight?.name
        ?? 'walk fallback',

      diagonalForwardLeft:
        this.clips.diagonalForwardLeft?.name
        ?? 'walk fallback',

      diagonalForwardRight:
        this.clips.diagonalForwardRight?.name
        ?? 'walk fallback',

      diagonalBackLeft:
        this.clips.diagonalBackLeft?.name
        ?? this.clips.backward?.name
        ?? 'walk fallback',

      diagonalBackRight:
        this.clips.diagonalBackRight?.name
        ?? this.clips.backward?.name
        ?? 'walk fallback',

      turnLeft:
        this.clips.turnLeft?.name
        ?? 'not authored yet',

      turnRight:
        this.clips.turnRight?.name
        ?? 'not authored yet',
    };
  }

  get activeClipName() {
    return this.active?.name ?? 'NONE';
  }

  get animationResolutionTrace() {
    return { ...this.resolutionTrace };
  }

  private recordResolution(
    semantic: LocomotionState,
    group: AnimationGroup | undefined,
    fallback: boolean,
  ) {
    const fps = Number((group as any)?.targetedAnimations?.[0]?.animation?.framePerSecond ?? 30);
    this.resolutionTrace = {
      requestedSemantic: semantic,
      requestedClipName: group?.name ?? null,
      resolvedAnimationGroup: group?.name ?? null,
      nextAnimation: group?.name ?? null,
      animationGroupIndex: group ? this.locomotionGroups.indexOf(group) : -1,
      sourceSupermodel: group ? this.exactClipSources?.[group.name] ?? null : null,
      durationSeconds: group ? (group.to - group.from) / Math.max(1, fps) : null,
      loopState: group ? 'LOOPED' : 'NO_EXACT_CLIP',
      blendState: group === this.active ? 'CURRENT_GROUP_CONTINUES' : 'HARD_GROUP_SWITCH',
      previousAnimation: this.active?.name ?? null,
      speedRatio: group?.speedRatio ?? null,
      fallback,
      exactLookup: Boolean(this.exactProfileSource),
      source: this.exactProfileSource ?? 'legacy-authored-name-resolver',
    };
    if (typeof window !== 'undefined') {
      (window as any).__playerAnimationTrace = this.animationResolutionTrace;
    }
  }
}
