import { Scene } from '@babylonjs/core';

export type W236LifecycleState =
  | 'IDLE'
  | 'TRANSITION_REQUESTED'
  | 'FADE_OUT'
  | 'FREEZE_INPUT'
  | 'DISPOSE_PARTY_RUNTIME'
  | 'DISPOSE_WORLD'
  | 'LOAD_WORLD'
  | 'LOAD_NAVIGATION'
  | 'LOAD_VIS'
  | 'SPAWN_LEADER'
  | 'SPAWN_COMPANIONS'
  | 'CAMERA_ATTACH'
  | 'FADE_IN'
  | 'READY'
  | 'FAILED';

export type W236ResourceCounts = {
  meshes: number;
  transformNodes: number;
  materials: number;
  textures: number;
  skeletons: number;
  animationGroups: number;
  sceneObservers: number;
  cameras: number;
  activeCameraCount: number;
  actorCounts: { aren: number; mission: number; jolee: number; nara: number };
  disposed: boolean;
};

export type W236WorldRuntimeHandle = {
  worldId: string;
  snapshot(): W236ResourceCounts;
  state(): Record<string, unknown>;
  freezeInput(frozen: boolean): void;
  disposeActors(): W236ResourceCounts;
  disposeWorld(): W236ResourceCounts;
  setDebug(kind: 'BWM' | 'PTH' | 'VIS' | 'DOORS' | 'PARTY' | 'LIFECYCLE', enabled: boolean): void;
  runExitRoute?(): Promise<Record<string, unknown>>;
};

export function countW236Resources(scene: Scene, disposed = false): W236ResourceCounts {
  const live = (items: any[]) => items.filter((item) => item && !item.isDisposed?.()).length;
  const identities = new Map<string, number>();
  for (const node of scene.transformNodes) {
    const id = (node.metadata as any)?.w236ActorIdentity;
    if (id) {
      const key = String(id).toLowerCase();
      identities.set(key, (identities.get(key) ?? 0) + 1);
    }
  }
  return {
    meshes: live(scene.meshes), transformNodes: live(scene.transformNodes), materials: live(scene.materials),
    textures: live(scene.textures), skeletons: live(scene.skeletons), animationGroups: live(scene.animationGroups),
    sceneObservers: (scene.onBeforeRenderObservable?.observers?.length ?? 0) + (scene.onAfterAnimationsObservable?.observers?.length ?? 0),
    cameras: live(scene.cameras), activeCameraCount: scene.activeCamera && !(scene.activeCamera as any).isDisposed?.() ? 1 : 0,
    actorCounts: { aren: identities.get('aren') ?? 0, mission: identities.get('mission') ?? 0, jolee: identities.get('jolee') ?? 0, nara: identities.get('nara') ?? 0 },
    disposed,
  };
}

export type W236PartyMember = {
  id: 'mission' | 'jolee' | 'nara';
  characterId: 'mission_vao' | 'jolee_bindo' | 'belaya_kotor1_donor';
  assetVariant: string;
  formationRole: 'rear-left' | 'rear-right';
};

export type W236WorldDefinition = {
  id: 'ebon_hawk_003ebo' | 'anchorhead_tat_m17aa';
  sourceGame: 'KOTOR I' | 'KOTOR II';
  moduleResRef: string;
  glbPath: string;
  navigationConvention: 'GLOBAL_WOK_OR_BWM' | 'ROOM_LOCAL_BWM_WITH_LYT';
  worldLoader: 'EbonHawkLab' | 'AnchorheadViewer';
  navigationProvider: 'EbonHawkNavigation' | 'AnchorheadNavigation';
  visProvider: 'EbonHawkVIS' | 'AnchorheadOptimizationVIS';
  spawnAnchorId: string;
  transitionAnchorIds: string[];
};

export const W236_WORLD_DEFINITIONS: Record<W236WorldDefinition['id'], W236WorldDefinition> = {
  ebon_hawk_003ebo: {
    id: 'ebon_hawk_003ebo', sourceGame: 'KOTOR II', moduleResRef: '003EBO',
    glbPath: '/_lab/kotor2/ebon_hawk/ebon_hawk_kotor2_interior.glb',
    navigationConvention: 'GLOBAL_WOK_OR_BWM', worldLoader: 'EbonHawkLab',
    navigationProvider: 'EbonHawkNavigation', visProvider: 'EbonHawkVIS',
    spawnAnchorId: '003EBO_ENTRY', transitionAnchorIds: ['EBON_HAWK_EXIT_TO_TATOOINE'],
  },
  anchorhead_tat_m17aa: {
    id: 'anchorhead_tat_m17aa', sourceGame: 'KOTOR I', moduleResRef: 'tat_m17aa',
    glbPath: '/_lab/kotor/tat_m17aa/tat_m17aa_anchorhead.glb',
    navigationConvention: 'ROOM_LOCAL_BWM_WITH_LYT', worldLoader: 'AnchorheadViewer',
    navigationProvider: 'AnchorheadNavigation', visProvider: 'AnchorheadOptimizationVIS',
    spawnAnchorId: 'NERATHIS_TATOOINE_ARRIVAL', transitionAnchorIds: [],
  },
};

export type W236GameSession = {
  currentWorldId: W236WorldDefinition['id'];
  previousWorldId: W236WorldDefinition['id'] | null;
  leaderId: 'aren' | 'jolee';
  partyPreset: 'default' | 'belaya_donor';
  party: W236PartyMember[];
  transitionSequence: number;
  lastTransition: W236TransitionRecord | null;
};

export type W236TransitionRecord = {
  sequence: number;
  transitionId: 'EBON_HAWK_TO_ANCHORHEAD';
  fromWorld: W236WorldDefinition['id'];
  toWorld: W236WorldDefinition['id'];
  reason: 'SOURCE_TRIGGER_SEMANTIC';
  startedAt: number;
  completedAt: number | null;
  status: 'REQUESTED' | 'READY' | 'FAILED';
};

export function createW236Session(leaderId: 'aren' | 'jolee' = 'aren', partyPreset: 'default' | 'belaya_donor' = 'default'): W236GameSession {
  const party: W236PartyMember[] = partyPreset === 'belaya_donor'
    ? [{ id: 'nara', characterId: 'belaya_kotor1_donor', assetVariant: 'belaya_kotor1_donor_vanilla', formationRole: 'rear-left' }, { id: 'jolee', characterId: 'jolee_bindo', assetVariant: 'w231_promoted_a7241700', formationRole: 'rear-right' }]
    : leaderId === 'jolee'
      ? [{ id: 'mission', characterId: 'mission_vao', assetVariant: 'w230_3o_candidate', formationRole: 'rear-left' }]
      : [{ id: 'mission', characterId: 'mission_vao', assetVariant: 'w230_3o_candidate', formationRole: 'rear-left' }, { id: 'jolee', characterId: 'jolee_bindo', assetVariant: 'w231_promoted_a7241700', formationRole: 'rear-right' }];
  return {
    currentWorldId: 'ebon_hawk_003ebo', previousWorldId: null, leaderId, partyPreset, party,
    transitionSequence: 0, lastTransition: null,
  };
}

export type W236TransitionHooks = {
  setState(state: W236LifecycleState): void;
  fadeOut(): Promise<void>;
  fadeIn(): Promise<void>;
  freezeInput(frozen: boolean): void;
  disposeActors(): Promise<W236ResourceCounts>;
  disposeWorld(): Promise<W236ResourceCounts>;
  loadDestination(): Promise<W236WorldRuntimeHandle>;
  onMilestone(name: string, durationMs: number): void;
};

export class WorldTransitionController {
  state: W236LifecycleState = 'IDLE';
  private running = false;

  async transition(hooks: W236TransitionHooks) {
    if (this.running) throw new Error('W236_TRANSITION_ALREADY_RUNNING');
    this.running = true;
    const time = performance.now();
    try {
      hooks.setState(this.state = 'TRANSITION_REQUESTED');
      hooks.setState(this.state = 'FADE_OUT');
      await hooks.fadeOut();
      hooks.setState(this.state = 'FREEZE_INPUT');
      hooks.freezeInput(true);
      hooks.setState(this.state = 'DISPOSE_PARTY_RUNTIME');
      const partyAt = performance.now();
      await hooks.disposeActors();
      hooks.onMilestone('actorDisposeMs', performance.now() - partyAt);
      hooks.setState(this.state = 'DISPOSE_WORLD');
      const disposeAt = performance.now();
      await hooks.disposeWorld();
      hooks.onMilestone('worldDisposeMs', performance.now() - disposeAt);
      hooks.setState(this.state = 'LOAD_WORLD');
      hooks.setState(this.state = 'LOAD_NAVIGATION');
      const loadAt = performance.now();
      const runtime = await hooks.loadDestination();
      hooks.onMilestone('anchorheadLoadAndSpawnMs', performance.now() - loadAt);
      hooks.setState(this.state = 'CAMERA_ATTACH');
      hooks.freezeInput(false);
      hooks.setState(this.state = 'FADE_IN');
      await hooks.fadeIn();
      hooks.setState(this.state = 'READY');
      hooks.onMilestone('transitionTotalMs', performance.now() - time);
      this.running = false;
      return runtime;
    } catch (error) {
      hooks.setState(this.state = 'FAILED');
      this.running = false;
      throw error;
    }
  }
}
