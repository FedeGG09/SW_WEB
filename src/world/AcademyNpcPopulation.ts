import { Color3, MeshBuilder, Scene, StandardMaterial, TransformNode, Vector3 } from '@babylonjs/core';
import { AssetLoader, type ImportedAsset } from '../assets/AssetLoader';
import { alignVisualFeetToGround, measureVisualBounds } from './CharacterGrounding';

export type AcademyNpcRuntimeAnimation = {
  idle?: string;
  walk?: string;
  talk?: string;
  returnToIdle?: string;
};

export type AcademyNpcRuntimeRecord = {
  stableNpcId: string;
  module: string;
  area: string;
  templateResRef: string;
  tag: string;
  displayName: string;
  sourcePosition: [number, number, number];
  sourceOrientation: [number, number];
  sourceRoom?: string | null;
  conversationResRef?: string | null;
  runtimeRole?: string;
  spawnPolicy: string;
  conditionStatus: string;
  runtimeReady: boolean;
  assetPath?: string;
  targetHeightM?: number;
  runtimeVisualGroundOffsetM?: number;
  animation?: AcademyNpcRuntimeAnimation;
  modelResolution?: string;
  /** Population provenance is kept separate from source GIT identity. */
  populationKind?: 'SOURCE_CANONICAL' | 'PLAYTEST_AMBIENT';
  interactionPolicy?: 'SOURCE_DIALOGUE' | 'PLAYTEST_INSPECT';
  sourceAppearanceRow?: number;
};

export type AcademyNpcSpawnResolution = {
  module: string;
  sourcePosition: [number, number, number];
  renderPosition: Vector3;
  room: string | null;
  face: number | null;
  floorY: number | null;
  confidence: string;
};

export type AcademyNpcInteraction = {
  id: string;
  label: string;
  position: () => Vector3;
  enabled: () => boolean;
  action: () => void;
};

export type AcademyNpcInstance = {
  record: AcademyNpcRuntimeRecord;
  asset: ImportedAsset;
  root: TransformNode;
  visualRoot: TransformNode;
  room: string | null;
  face: number | null;
  activeAnimation: string;
  debugMarker?: TransformNode;
  interaction: AcademyNpcInteraction;
};

/**
 * World-owned, actor-generic KOTOR NPC population. The loader consumes
 * normalized source records and never decides party ownership or combat.
 * Unsupported records are retained in `skipped` with their source reason.
 */
export class AcademyNpcPopulation {
  readonly actors: AcademyNpcInstance[] = [];
  readonly skipped: Array<{ stableNpcId: string; reason: string }> = [];
  private disposed = false;

  private constructor(
    private readonly scene: Scene,
    private readonly onInteraction?: (instance: AcademyNpcInstance) => void,
    private readonly debugMarkers = false,
  ) {}

  private debugMarkerMaterial?: StandardMaterial;

  static async create(args: {
    scene: Scene;
    loader: AssetLoader;
    records: AcademyNpcRuntimeRecord[];
    resolveSpawn: (record: AcademyNpcRuntimeRecord) => AcademyNpcSpawnResolution | null;
    onInteraction?: (instance: AcademyNpcInstance) => void;
    debugMarkers?: boolean;
  }) {
    const population = new AcademyNpcPopulation(args.scene, args.onInteraction, args.debugMarkers ?? false);
    try {
      for (const record of args.records) {
        try {
          if (!record.runtimeReady || !record.assetPath) {
            population.skipped.push({ stableNpcId: record.stableNpcId, reason: record.modelResolution ?? 'MODEL_NOT_RUNTIME_READY' });
            continue;
          }
        const spawn = args.resolveSpawn(record);
        if (!spawn) {
          population.skipped.push({ stableNpcId: record.stableNpcId, reason: 'SOURCE_POSITION_NOT_WALKABLE' });
          continue;
        }
        const asset = await args.loader.load(record.assetPath, args.scene);
        const root = new TransformNode(`AcademyNpc_${record.stableNpcId.replace(/[^a-z0-9]+/gi, '_')}`, args.scene);
        const visualRoot = new TransformNode(`${root.name}_Visual`, args.scene);
        visualRoot.parent = root;
        asset.root.parent = visualRoot;
        root.position.copyFrom(spawn.renderPosition);
        root.rotation.y = Math.atan2(-record.sourceOrientation[0], -record.sourceOrientation[1]);
        root.metadata = {
          ...(root.metadata ?? {}),
          academyNpc: true,
          stableNpcId: record.stableNpcId,
          sourceModule: record.module,
          sourceTemplateResRef: record.templateResRef,
          sourceTag: record.tag,
          sourcePosition: record.sourcePosition,
          sourceRoom: spawn.room,
          populationKind: record.populationKind ?? 'SOURCE_CANONICAL',
        };
        asset.meshes.forEach((mesh) => {
          mesh.isPickable = false;
          mesh.metadata = { ...(mesh.metadata ?? {}), academyNpcId: record.stableNpcId };
        });
        const bounds = measureVisualBounds(asset.meshes);
        const targetHeight = record.targetHeightM ?? 1.8;
        if (!(bounds.height > 0)) throw new Error(`ACADEMY_NPC_EMPTY_BOUNDS:${record.stableNpcId}`);
        const scale = targetHeight / bounds.height;
        asset.root.scaling.setAll(scale);
        // Existing grounding is the only visual correction. Source transforms
        // and navigation remain owned by the caller's KOTOR adapter.
        // `visualRoot` is parented to the world-positioned NPC root, so the
        // grounding target must be expressed in world space. Passing a local
        // zero here moves imported KOTOR meshes to world Y=0 and makes them
        // invisible in the Academy spawn room.
        alignVisualFeetToGround(
          visualRoot,
          asset.meshes,
          spawn.renderPosition.y + (record.runtimeVisualGroundOffsetM ?? 0.02),
        );
        const animation = population.startIdle(asset, record.animation?.idle);
        const instance = {} as AcademyNpcInstance;
        instance.record = record;
        instance.asset = asset;
        instance.root = root;
        instance.visualRoot = visualRoot;
        instance.room = spawn.room;
        instance.face = spawn.face;
        instance.activeAnimation = animation;
        if (population.debugMarkers && record.populationKind === 'PLAYTEST_AMBIENT') {
          population.debugMarkerMaterial ??= (() => {
            const material = new StandardMaterial('AcademyNpcDebugMarkerMaterial', args.scene);
            material.diffuseColor = new Color3(0.95, 0.25, 0.08);
            material.emissiveColor = new Color3(0.95, 0.12, 0.02);
            return material;
          })();
          const marker = MeshBuilder.CreateSphere(`${root.name}_DebugMarker`, { diameter: 0.16, segments: 8 }, args.scene);
          marker.parent = root;
          marker.position.y = targetHeight + 0.24;
          marker.material = population.debugMarkerMaterial;
          marker.isPickable = false;
          instance.debugMarker = marker;
        }
        instance.interaction = {
          id: `academy-npc:${record.stableNpcId}`,
          label: record.interactionPolicy === 'PLAYTEST_INSPECT'
            ? `Inspect: ${record.displayName}`
            : `Talk: ${record.displayName}`,
          position: () => root.getAbsolutePosition(),
          enabled: () => !population.disposed && root.isEnabled() &&
            (Boolean(record.conversationResRef) || record.interactionPolicy === 'PLAYTEST_INSPECT'),
          action: () => population.onInteraction?.(instance),
        };
          population.actors.push(instance);
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          population.skipped.push({ stableNpcId: record.stableNpcId, reason: `LOAD_FAILED:${reason.slice(0, 160)}` });
        }
      }
      return population;
    } catch (error) {
      population.dispose();
      throw error;
    }
  }

  private startIdle(asset: ImportedAsset, requested?: string) {
    asset.animationGroups.forEach((group) => group.stop());
    if (requested?.toUpperCase() === 'STATIC_BIND_POSE') {
      // Explicit source-asset fallback for a converted appearance whose
      // available pause clip is visibly non-neutral. A fresh import owns the
      // bind pose; reset authored root translations without inventing motion.
      asset.resetAnimatedRoots('AcademyNpcPopulation:STATIC_BIND_POSE');
      return 'STATIC_BIND_POSE';
    }
    // Ambient population may contain combat/death/locomotion groups whose
    // first imported group is not a peaceful pose. Only an explicit source
    // idle or a conservative pause/stand semantic may own this state.
    const isSafeIdle = (name: string) => /^(idle|pause[0-9]*|cpause[0-9]*|stand[0-9]*)$/i.test(name.trim());
    const requestedGroup = requested
      ? asset.animationGroups.find((candidate) => candidate.name.toLowerCase() === requested.toLowerCase() && isSafeIdle(candidate.name))
      : undefined;
    const group = requestedGroup ?? asset.animationGroups.find((candidate) => isSafeIdle(candidate.name));
    if (!group) return 'NO_SAFE_IDLE_GROUP';
    group.metadata = { ...(group.metadata ?? {}), academyNpcAnimationOwner: 'AcademyNpcPopulation', academyNpcAnimationSemantic: 'PEACEFUL_IDLE' };
    group.start(true, 1);
    return group.name;
  }

  setModuleEnabled(module: string) {
    for (const actor of this.actors) actor.root.setEnabled(actor.record.module.toLowerCase() === module.toLowerCase());
  }

  nearestInteraction(position: Vector3, maxDistance = 2.8) {
    return this.actors
      .filter((actor) => actor.interaction.enabled())
      .map((actor) => ({ actor, distance: Vector3.Distance(position, actor.root.getAbsolutePosition()) }))
      .filter((candidate) => candidate.distance <= maxDistance)
      .sort((a, b) => a.distance - b.distance)[0]?.actor ?? null;
  }

  triggerNearest(position: Vector3, maxDistance = 2.8) {
    const actor = this.nearestInteraction(position, maxDistance);
    if (!actor) return null;
    actor.interaction.action();
    return actor;
  }

  state() {
    return {
      disposed: this.disposed,
      actorCount: this.actors.length,
      skippedCount: this.skipped.length,
      actors: this.actors.map((actor) => ({
        stableNpcId: actor.record.stableNpcId,
        module: actor.record.module,
        templateResRef: actor.record.templateResRef,
        displayName: actor.record.displayName,
        populationKind: actor.record.populationKind ?? 'SOURCE_CANONICAL',
        sourceAppearanceRow: actor.record.sourceAppearanceRow ?? null,
        position: actor.root.getAbsolutePosition().asArray(),
        room: actor.room,
        face: actor.face,
        activeAnimation: actor.activeAnimation,
        animationGroupCount: actor.asset.animationGroups.length,
        interactionId: actor.interaction.id,
        conversationResRef: actor.record.conversationResRef ?? null,
      })),
      skipped: [...this.skipped],
    };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const actor of this.actors) {
      actor.asset.animationGroups.forEach((group) => group.stop());
      actor.asset.dispose();
      actor.root.dispose(false, true);
    }
    this.debugMarkerMaterial?.dispose();
    this.actors.length = 0;
  }
}
