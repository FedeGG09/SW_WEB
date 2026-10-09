import { AnimationGroup } from '@babylonjs/core';
import { combatTrace } from '../debug/CombatTrace';

export type CombatAnimationName =
  | 'combat_ready'

  | 'slash_left'
  | 'slash_right'
  | 'slash_forward'
  | 'slash_diagonal_left'
  | 'slash_diagonal_right'

  | 'slash_backward'
  | 'slash_back_left'
  | 'slash_back_right'

  | 'heavy_overhead'
  | 'heavy_left'
  | 'heavy_right'

  | 'block_center'
  | 'block_left'
  | 'block_right'

  | 'parry_left'
  | 'parry_right';

type DefenseSide =
  | 'CENTER'
  | 'LEFT'
  | 'RIGHT';

/**
 * Owns authored full-body saber animation.
 *
 * Gameplay timing, movement, hit windows and collision remain owned
 * by LightsaberCombatController.
 *
 * This controller only decides which skeleton animation is evaluated.
 *
 * V2 IMPORTANT:
 *
 * We support the expanded V2 animation set while preserving fallbacks
 * to the existing V1 GLB. That means TypeScript can be upgraded before
 * the new Blender animation pack is generated.
 */
export class PlayerCombatAnimationController {
  private readonly allGroups: AnimationGroup[];

  private readonly groups =
    new Map<string, AnimationGroup>();

  private activeName?: string;
  private blockHolding = false;

  constructor(
    animationGroups: AnimationGroup[],
    additionalExactGroups: string[] = [],
  ) {
    this.allGroups =
      animationGroups;

    const additional = new Set(additionalExactGroups.map((name) => this.normalise(name)));
    animationGroups.forEach(
      (group) => {
        const normalised =
          this.normalise(group.name);

        if (
          this.isCombatGroup(normalised)
          || additional.has(normalised)
        ) {
          this.groups.set(
            normalised,
            group,
          );
        }
      },
    );

    this.stopAll();
  }

  // =========================================================
  // PUBLIC STATE
  // =========================================================

  get available() {
    return this.groups.size > 0;
  }

  get active() {
    return Boolean(
      this.activeName,
    );
  }

  get current() {
    return (
      this.activeName
      ?? 'NONE'
    );
  }

  get names() {
    return [
      ...this.groups.keys(),
    ];
  }

  hasExact(
    name: CombatAnimationName,
  ) {
    return this.groups.has(
      name,
    );
  }

  get activeGroupDetails() {
    const group = this.activeName ? this.groups.get(this.activeName) : undefined;
    return group ? { name: group.name, from: group.from, to: group.to, frame: group.getCurrentFrame(), isPlaying: group.isPlaying, isPaused: group.isStarted && !group.isPlaying } : undefined;
  }

  // =========================================================
  // READY
  // =========================================================

  playReady() {
    this.play(
      'combat_ready',
      true,
    );
  }

  /** Play one exact prototype/profile clip without extending the generic combat vocabulary. */
  playExact(name: string, loop: boolean) {
    const resolved = this.normalise(name);
    const group = this.groups.get(resolved);
    if (!group) return false;
    if (this.activeName === resolved && (group.isPlaying || !loop)) return true;
    this.stopAll();
    this.activeName = resolved;
    this.blockHolding = false;
    group.start(loop, 1, group.from, group.to);
    group.goToFrame(group.from);
    return true;
  }

  // =========================================================
  // ATTACK
  // =========================================================

  playAttack(
    name: CombatAnimationName,
  ) {
    /*
     * Attacks are driven by LightsaberCombatController's normalized gameplay
     * clock.  Pause the Babylon group and seek it explicitly so animation time
     * cannot advance twice (automatic playback + goToFrame).
     */
    return this.play(
      name,
      false,
      true,
    );
  }

  // =========================================================
  // BLOCK
  // =========================================================

  playBlock(
    side: DefenseSide = 'CENTER',
  ) {
    const requested:
      CombatAnimationName =
        side === 'LEFT'
          ? 'block_left'
          : side === 'RIGHT'
            ? 'block_right'
            : 'block_center';

    /*
     * Defense owns a single entry clock and holds its final guard frame.
     */
    return this.play(
      requested,
      false,
      true,
    );
  }

  holdBlockAtTime(elapsedSeconds: number) {
    if (!this.activeName?.startsWith('block_')) return;
    const group = this.groups.get(this.activeName);
    if (!group) return;
    const fps = group.targetedAnimations[0]?.animation.framePerSecond ?? 60;
    const frame = Math.min(group.to, group.from + Math.max(0, elapsedSeconds) * fps);
    group.goToFrame(frame);
    if (frame >= group.to && !this.blockHolding) {
      this.blockHolding = true;
      combatTrace.log('BLOCK HOLD', { clip: group.name, frame, paused: !group.isPlaying });
    }
  }

  // =========================================================
  // PARRY
  // =========================================================

  playParry(
    side: DefenseSide = 'RIGHT',
  ) {
    const requested:
      CombatAnimationName =
        side === 'LEFT'
          ? 'parry_left'
          : 'parry_right';

    return this.play(
      requested,
      false,
    );
  }

  // =========================================================
  // GAMEPLAY-SYNCHRONISED PROGRESS
  // =========================================================

  setProgress(
    normalized: number,
    combatPhase = 'UNKNOWN',
  ) {
    if (!this.activeName) {
      return;
    }

    const group =
      this.groups.get(
        this.activeName,
      );

    if (!group) {
      return;
    }

    const clamped =
      Math.max(
        0,
        Math.min(
          1,
          normalized,
        ),
      );

    const frame =
      group.from
      + (
        group.to
        - group.from
      )
      * clamped;

    group.goToFrame(frame);
    combatTrace.frameSnapshot(this.activeName, clamped, frame, combatPhase);
  }

  // =========================================================
  // CLEAR
  // =========================================================

  clear() {
    this.stopAll();

    this.activeName =
      undefined;
  }

  // =========================================================
  // PLAYBACK
  // =========================================================

  private play(
    requestedName:
      CombatAnimationName,
    loop: boolean,
    manualProgress = false,
  ) {
    const fallbackCandidates = this.fallbackCandidates(requestedName);
    const resolvedName =
      this.resolveAvailableClip(
        requestedName,
      );

    const group = resolvedName ? this.groups.get(resolvedName) : undefined;
    const isAttack = manualProgress && !requestedName.startsWith('block_');
    if (group && this.activeName === resolvedName && !isAttack) return true;
    combatTrace.log('RESOLVE CLIP', {
      requested: requestedName,
      candidates: [requestedName, ...fallbackCandidates],
      resolved: resolvedName ?? 'NONE',
      exact: resolvedName === requestedName,
      from: group?.from ?? null,
      to: group?.to ?? null,
      duplicates: this.allGroups.filter((item) => this.normalise(item.name) === resolvedName).length,
    });

    if (!resolvedName) {
      return false;
    }

    if (!group) {
      return false;
    }

    /*
     * Do not restart the same authored clip every frame.
     *
     * This is especially important for block: DefenseController requests the
     * guard continuously while RMB is held.  Once the one-shot entry reaches
     * its final guard frame, keep that pose until clear() is called.
     */
    this.stopAll();

    this.activeName =
      resolvedName;

    this.blockHolding = false;

    if (isAttack) {
      combatTrace.log('START AUTHORED ATTACK', {
        group: group.name,
        from: group.from,
        to: group.to,
        isPlayingBefore: group.isPlaying,
        isPausedBefore: group.isStarted && !group.isPlaying,
        loopAnimation: group.loopAnimation,
        speedRatio: group.speedRatio,
      });
    }

    group.start(
      loop,
      1,
      group.from,
      group.to,
    );

    group.goToFrame(
      group.from,
    );

    if (manualProgress) {
      group.pause();
    }

    if (isAttack) {
      combatTrace.log('AUTHORED ATTACK STARTED', {
        group: group.name,
        from: group.from,
        to: group.to,
        isPlayingAfter: group.isPlaying,
        isPausedAfter: group.isStarted && !group.isPlaying,
        loopAnimation: group.loopAnimation,
        speedRatio: group.speedRatio,
      });
      combatTrace.frameSnapshot(group.name, 0, group.from, 'WINDUP');
    } else if (/^(block_|parry_)/.test(requestedName)) {
      combatTrace.log('START AUTHORED DEFENSE', {
        requested: requestedName,
        group: group.name,
        isPlayingAfter: group.isPlaying,
        isPausedAfter: group.isStarted && !group.isPlaying,
        from: group.from,
        to: group.to,
      });
    }

    return true;
  }

  // =========================================================
  // V2 -> V1 FALLBACK
  // =========================================================

  private resolveAvailableClip(
    requested:
      CombatAnimationName,
  ): CombatAnimationName | undefined {
    /*
     * Exact V2 clip always wins.
     */
    if (
      this.groups.has(
        requested,
      )
    ) {
      return requested;
    }

    /*
     * Until w204_build_combat_asset.py generates the expanded
     * animation set, safely fall back to the closest V1 motion.
     *
     * This means the code can be deployed BEFORE regenerating
     * ithorian_combat_v1.glb.
     */
    const fallback:
      Partial<
        Record<
          CombatAnimationName,
          CombatAnimationName
        >
      > = {
        slash_backward:
          'slash_forward',

        slash_back_left:
          'slash_left',

        slash_back_right:
          'slash_right',

        heavy_left:
          'heavy_overhead',

        heavy_right:
          'heavy_overhead',

        block_left:
          'block_center',

        block_right:
          'block_center',

        parry_left:
          'parry_right',
      };

    const alternative =
      fallback[requested];

    if (
      alternative
      && this.groups.has(
        alternative,
      )
    ) {
      return alternative;
    }

    return undefined;
  }

  fallbackCandidates(requested: CombatAnimationName) {
    const fallback: Partial<Record<CombatAnimationName, CombatAnimationName>> = {
      slash_backward: 'slash_forward',
      slash_back_left: 'slash_left',
      slash_back_right: 'slash_right',
      heavy_left: 'heavy_overhead',
      heavy_right: 'heavy_overhead',
      block_left: 'block_center',
      block_right: 'block_center',
      parry_left: 'parry_right',
    };
    const alternative = fallback[requested];
    return alternative ? [alternative] : [];
  }

  // =========================================================
  // STOP
  // =========================================================

  private stopAll() {
    this.allGroups.forEach(
      (group) => {
        group.stop();
      },
    );
  }

  // =========================================================
  // NAME HELPERS
  // =========================================================

  private normalise(
    name: string,
  ) {
    return name
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/-/g, '_');
  }

  private isCombatGroup(
    name: string,
  ) {
    return /^(combat_ready|slash_left|slash_right|slash_forward|slash_diagonal_left|slash_diagonal_right|slash_backward|slash_back_left|slash_back_right|heavy_overhead|heavy_left|heavy_right|block_center|block_left|block_right|parry_left|parry_right)$/i.test(
      name,
    );
  }
}
