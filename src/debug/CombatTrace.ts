import { AnimationGroup } from '@babylonjs/core';

const REQUIRED_AREN_CLIPS = [
  'combat_ready',
  'slash_left',
  'slash_right',
  'slash_forward',
  'slash_diagonal_left',
  'slash_diagonal_right',
  'heavy_overhead',
  'block_center',
  'parry_right',
] as const;

class CombatTraceService {
  readonly enabled = new URLSearchParams(window.location.search).get('combatTrace') === '1';
  private attackId = 'NONE';
  private ownsSkeleton = false;
  private readonly progressBuckets = new Set<number>();
  private readonly overlayEvents = new Set<string>();
  private readonly onceEvents = new Set<string>();

  log(event: string, details?: Record<string, unknown>) {
    if (!this.enabled) return;
    if (details) console.info(`[COMBAT TRACE] ${event}`, details);
    else console.info(`[COMBAT TRACE] ${event}`);
  }

  playerAssetLoaded(groups: AnimationGroup[]) {
    if (!this.enabled) return;
    this.log('PLAYER ASSET LOADED');
    console.table(groups.map((group, index) => ({
      index,
      name: group.name,
      from: group.from,
      to: group.to,
      targetedAnimations: group.targetedAnimations.length,
      isPlaying: group.isPlaying,
      isPaused: group.isStarted && !group.isPlaying,
      speedRatio: group.speedRatio,
      loopAnimation: group.loopAnimation,
    })));

    const normalise = (name: string) => name.trim().toLowerCase().replace(/\s+/g, '_').replace(/-/g, '_');
    const names = groups.map((group) => normalise(group.name));
    console.info('[COMBAT TRACE] required animation groups');
    console.table(REQUIRED_AREN_CLIPS.map((name) => {
      const duplicates = names.filter((candidate) => candidate === name).length;
      return { name, status: duplicates ? 'FOUND' : 'MISSING', duplicates: duplicates > 1 ? duplicates : '' };
    }));
    const duplicates = [...new Set(names)].filter((name) => names.filter((candidate) => candidate === name).length > 1);
    if (duplicates.length) this.log('DUPLICATE ANIMATION GROUPS', { duplicates });
  }

  beginAttack(id: string, ownsSkeleton: boolean) {
    if (!this.enabled) return;
    this.attackId = id;
    this.ownsSkeleton = ownsSkeleton;
    this.progressBuckets.clear();
    this.overlayEvents.clear();
    this.onceEvents.clear();
  }

  setOwnsSkeleton(ownsSkeleton: boolean) {
    if (this.enabled) this.ownsSkeleton = ownsSkeleton;
  }

  endAttack() {
    this.ownsSkeleton = false;
    this.attackId = 'NONE';
  }

  get combatOwnsSkeleton() {
    return this.enabled && this.ownsSkeleton;
  }

  frameSnapshot(clip: string, progress: number, frame: number, phase: string) {
    if (!this.enabled) return;
    const bucket = progress >= 1 ? 4 : Math.floor(progress * 4);
    if (this.progressBuckets.has(bucket)) return;
    this.progressBuckets.add(bucket);
    this.log('ATTACK FRAME', { clip, progress: Number(progress.toFixed(2)), frame, combatPhase: phase });
  }

  overlayOnce(source: string, details: Record<string, unknown>) {
    if (!this.enabled || !this.ownsSkeleton || this.overlayEvents.has(source)) return;
    this.overlayEvents.add(source);
    this.log('ARM OVERLAY DURING ATTACK', { mode: source, ...details, attackId: this.attackId });
  }

  once(key: string, event: string, details: Record<string, unknown>) {
    if (!this.enabled || this.onceEvents.has(key)) return;
    this.onceEvents.add(key);
    this.log(event, details);
  }
}

export const combatTrace = new CombatTraceService();
