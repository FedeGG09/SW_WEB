import { isTatooineScene, TATOOINE_ZONES } from '../world/tatooine/TatooineCatalog';
import { TatooineWorld } from '../world/tatooine/TatooineWorld';
import {
  AbstractMesh,
  Color3,
  Color4,
  DirectionalLight,
  HemisphericLight,
  Light,
  MeshBuilder,
  PBRMaterial,
  ParticleSystem,
  PointLight,
  Scene,
  StandardMaterial,
  Texture,
  Vector3,
} from '@babylonjs/core';

import {
  AssetLoader,
  ImportedAsset,
} from '../assets/AssetLoader';

import { DialogueSystem } from '../dialogue/DialogueSystem';

import {
  GameState,
  SceneId,
  SpawnId,
} from './GameState';

import { InteractionSystem } from '../interaction/InteractionSystem';

import { PlayerController } from '../player/PlayerController';

import { QuestSystem } from '../quests/QuestSystem';

import { SimpleCollisionWorld } from '../world/SimpleCollisionWorld';

import {
  buildShipExteriorCollision,
  buildShipInteriorCollision,
} from '../world/ShipInteriorCollision';

import { ShipPortalSystem } from '../world/ShipPortalSystem';

import { buildKhepraCity } from '../world/KhepraCity';

import { buildKhepraSpaceport } from '../world/KhepraSpaceport';

import { buildKhepraFieldHospital } from '../world/KhepraFieldHospital';

import {
  placeSpaceportCargoShip,
  placeSpaceportParkedShip,
  SPACEPORT_CARGO_SHIP_URL,
  SPACEPORT_PARKED_SHIP,
  SPACEPORT_PARKED_SHIP_URL,
} from '../world/SpaceportShips';

import {
  placeSpaceportCargoCrates,
  SPACEPORT_CRATE_URL,
} from '../world/SpaceportCargoPass';

import {
  ELYRA_HOSPITAL_ASSET_URL,
  placeKhepraHospitalElyra,
} from '../world/KhepraHospitalElyra';

import {
  ElyraRecruitmentDialogue,
} from '../dialogue/ElyraRecruitmentDialogue';

import {
  partyRoster,
} from '../party/PartyRoster';

import { buildKhepraHeroComposition } from '../world/KhepraHeroComposition';

import { buildNerathisSkySystem } from '../world/NerathisSkySystem';

import { createNerathisLighting } from '../world/NerathisLighting';

import { buildNerathisTerrain } from '../world/NerathisTerrain';

import { buildNerathisWater } from '../world/NerathisWater';

import {
  applySceneryMetricUVs,
  freezeStaticMeshes,
  mergeStaticMeshes,
} from '../world/StaticMeshOptimizer';

import { WORLD_SCALE } from '../world/WorldScale';

import { buildSurfaceDecals } from '../world/SurfaceDecalSystem';

import { NerathisMaterialLibrary } from '../world/materials/NerathisMaterialLibrary';

import { buildShipInteriorArt } from '../world/ShipInteriorArt';

import {
  constrainToShipPlayableRoom,
  createShipInteriorRuntimeLayout,
} from '../world/ShipInteriorLayout';

import { buildNerathisWorldArtDirection } from '../world/NerathisWorldArtDirection';

import { buildRepublicOutpostInterior } from '../world/RepublicOutpostInterior';

import { measureVisualBounds } from '../world/CharacterGrounding';

import {
  auditShipInterior,
  createShipDebugVisualization,
  createShipExteriorScaleDebugVisualization,
  createShipScaleDebugVisualization,
  deriveShipScaleMetrics,
  findOpenShipCameraViews,
  findWalkableShipCells,
  isInsideShipBounds,
  ShipDebugVisualization,
  ShipExteriorScaleMetrics,
  ShipInteriorAudit,
  ShipInteriorScaleMetrics,
} from '../world/ShipInteriorSpatial';

export class SceneManager {
  private tatooineWorld?: TatooineWorld;
  private tatooineTravelGuard = () => this.player.playerCanControl;
  get tatooineTrainingDummy() { return this.tatooineWorld?.trainingDummy; }
  get tatooinePyke() { return this.tatooineWorld?.pyke; }
  get tatooineRancor() { return this.tatooineWorld?.rancor; }
  setTatooineTravelGuard(guard: () => boolean) { this.tatooineTravelGuard = guard; }

  private currentAssets: ImportedAsset[] = [];

  private runtimeMeshes: AbstractMesh[] = [];

  private lights: Light[] = [];

  private customDisposers: Array<
    () => void
  > = [];

  private collision?: SimpleCollisionWorld;

  private rain?: ParticleSystem;

  private currentMaterials?: NerathisMaterialLibrary;

  private transitionBusy = false;

  private shipAudit?: ShipInteriorAudit;

  private shipScaleMetrics?: ShipInteriorScaleMetrics;

  private shipScale = 0.4;

  private _shipInteriorCameraYaw = 0.11;

  private shipNaraHeight = 0;

  private shipDebugVisualization?: ShipDebugVisualization;

  private shipNaraPosition: () => Vector3 =
    () => Vector3.Zero();

  private _shipPlayableMin =
    Vector3.Zero();

  private _shipPlayableMax =
    Vector3.Zero();

  private _shipExitPosition =
    Vector3.Zero();

  private exteriorShipAudit?: ShipInteriorAudit;

  private _shipExteriorScaleMetrics?: ShipExteriorScaleMetrics;

  private shipExteriorSupportPositions: Vector3[] =
    [];

  private shipExteriorEntryPosition =
    Vector3.Zero();

  private shipExteriorEntryRotation =
    Vector3.Zero();

  private _shipExteriorRootScale =
    Vector3.One();

  private skyLightningTrigger?: () => void;

  private readonly portals: ShipPortalSystem;

  constructor(
    private readonly scene: Scene,
    private readonly loader: AssetLoader,
    private readonly player: PlayerController,
    private readonly state: GameState,
    private readonly quest: QuestSystem,
    private readonly interaction: InteractionSystem,
    private readonly dialogue: DialogueSystem,

    private readonly setProgress: (
      value: number,
      message: string,
    ) => void,

    private readonly onSceneReady?: (
      sceneId: SceneId,
      transitioned: boolean,
    ) => void,
  ) {
    this.portals =
      new ShipPortalSystem(
        interaction,
      );
  }

  async loadScene(
    sceneId: SceneId,
    spawn: SpawnId,
    transition = false,
  ) {
    if (
      this.transitionBusy
    ) {
      return;
    }

    this.transitionBusy = true;
    const tatooineTransition = isTatooineScene(sceneId) || isTatooineScene(this.state.currentScene);
    const wasLocked = this.player.isActionLocked;
    if (tatooineTransition) this.player.setActionLocked(true);

    try {
      if (
        transition
      ) {
        await this.fade(true);
      }

      this.showLoading(
        sceneId,
      );

      this.clearCurrentScene();

      this.state.setScene(
        sceneId,
        spawn,
      );

      if (
        sceneId ===
        'shipInterior'
      ) {
        await this.buildShipInterior(
          spawn,
        );
      }

      if (
        sceneId ===
        'nerathisExterior'
      ) {
        await this.buildExterior(
          spawn,
        );
      }

      if (
        sceneId ===
        'cantinaInterior'
      ) {
        await this.buildCantinaInterior(
          spawn,
        );
      }

      if (isTatooineScene(sceneId)) {
        this.tatooineWorld = await TatooineWorld.create(this.scene, this.loader, this.player, this.interaction,
          sceneId, spawn, import.meta.env.DEV && new URLSearchParams(location.search).get('tatooineStage') === '1',
          (next, nextSpawn) => this.loadScene(next, nextSpawn, true), () => this.tatooineTravelGuard(), this.setProgress,
          { enabled: true,
            stagedActors: import.meta.env.DEV && new URLSearchParams(location.search).get('tatooineActorStage') === '1',
            dialogue: this.dialogue, quest: this.quest });
        const world = this.tatooineWorld;
        this.customDisposers.push(() => { world.dispose(); this.tatooineWorld = undefined; });
      }
      this.setProgress(
        1,
        isTatooineScene(sceneId) ? `${TATOOINE_ZONES[sceneId].title} ready` : sceneId ===
          'shipInterior'
          ? 'Ship interior ready'
          : sceneId ===
              'cantinaInterior'
            ? 'Cantina ready'
            : 'Khepra Vale ready',
      );

      document
        .getElementById(
          'loadingOverlay',
        )
        ?.classList.add(
          'is-hidden',
        );

      if (
        transition
      ) {
        await this.fade(
          false,

          isTatooineScene(sceneId) ? TATOOINE_ZONES[sceneId].title : sceneId ===
            'nerathisExterior'
            ? 'KHEPRA VALE'
            : 'NERATHIS',
        );
      }

      this.onSceneReady?.(
        sceneId,
        transition,
      );
    } finally {
      if (tatooineTransition) this.player.setActionLocked(wasLocked);
      this.transitionBusy =
        false;
    }
  }

  // ================================================================
  // SHIP INTERIOR
  // ================================================================

  private async buildShipInterior(
    spawn: SpawnId,
  ) {
    this.configureAtmosphere(
      new Color4(
        0.025,
        0.045,
        0.07,
        1,
      ),
      0.012,
    );

    const materials =
      this.currentMaterials =
        new NerathisMaterialLibrary(
          this.scene,
        );

    this.addLighting(
      false,
    );

    const interior =
      await this.load(
        '/assets/w1/ship/yt1300_inside.glb',
        'ship interior',
        0,
        2,
      );

    this.adaptShipInteriorLook(
      interior,
    );

    const sourceAudit =
      auditShipInterior(
        '/assets/w1/ship/yt1300_inside.glb',
        interior,
      );

    const sourceFloor =
      sourceAudit.meshReports.find(
        (report) =>
          report.name ===
          'Object_6',
      ) ??
      sourceAudit.floorCandidates[0];

    const rawFloorY =
      sourceFloor?.max.y ??
      -1.95;

    const rawCeilingY =
      sourceAudit.meshReports.find(
        (report) =>
          report.name ===
          'Object_17',
      )?.max.y ??
      rawFloorY + 3.5;

    const rawClearHeight =
      Math.max(
        0.1,
        rawCeilingY -
          rawFloorY,
      );

    const targetClearHeight =
      2.8;

    const calculatedScale =
      targetClearHeight /
      rawClearHeight;

    this.shipScale =
      resolveShipScale(
        calculatedScale,
      );

    const scaleOverride =
      getShipScaleOverride();

    if (
      scaleOverride !==
      undefined
    ) {
      this.shipScale =
        scaleOverride;
    }

    interior.root.scaling.setAll(
      this.shipScale,
    );

    interior.root.position.set(
      0,
      -rawFloorY *
        this.shipScale,
      0,
    );

    interior.meshes.forEach(
      (mesh) => {
        mesh.isPickable = false;
      },
    );

    this.shipAudit =
      auditShipInterior(
        '/assets/w1/ship/yt1300_inside.glb',
        interior,
      );

    this.shipScaleMetrics =
      deriveShipScaleMetrics(
        sourceAudit,
        this.shipAudit,
        this.shipScale,
        1.83,
      );

    console.info(
      '[W2.0.6.2] ship source audit',
      JSON.stringify(
        summarizeShipAudit(
          sourceAudit,
        ),
      ),
    );

    console.info(
      '[W2.0.6.2] ship calibrated audit',
      JSON.stringify(
        summarizeShipAudit(
          this.shipAudit,
        ),
      ),
    );

    console.info(
      '[W2.0.6.2] ship scale metrics',
      JSON.stringify(
        summarizeShipScaleMetrics(
          this.shipScaleMetrics,
        ),
      ),
    );

    if (
      new URLSearchParams(
        window.location.search,
      ).get(
        'w2061Audit',
      ) === '1'
    ) {
      const floorBounds =
        this.shipAudit
          .floorCandidates[0] ??
        this.shipAudit;

      const walkableCells =
        findWalkableShipCells(
          this.scene,
          interior.meshes,
          this.shipScaleMetrics.floorY,
          {
            min:
              floorBounds.min,

            max:
              floorBounds.max,
          },
        );

      console.info(
        '[W2.0.6.1] ship walkable cells',
        JSON.stringify(
          walkableCells,
        ),
      );

      console.info(
        '[W2.0.6.1] ship open camera views',

        JSON.stringify(
          findOpenShipCameraViews(
            this.scene,
            interior.meshes,
            walkableCells,
            {
              min:
                floorBounds.min,

              max:
                floorBounds.max,
            },
          ),
        ),
      );
    }

    this.currentAssets.push(
      interior,
    );

    const floorY =
      this.shipScaleMetrics.floorY;

    const runtimeLayout =
      createShipInteriorRuntimeLayout(
        this.shipScale,
        floorY,
      );

    this._shipPlayableMin.copyFrom(
      runtimeLayout.playableMin,
    );

    this._shipPlayableMax.copyFrom(
      runtimeLayout.playableMax,
    );

    this._shipExitPosition.copyFrom(
      runtimeLayout.exitPrompt,
    );

    this.collision =
      new SimpleCollisionWorld(
        this.scene,
        floorY,
      );

    const exitWallZ =
      this._shipPlayableMin.z +
      0.18;

    buildShipInteriorCollision(
      this.collision,
      {
        floorMinX:
          this._shipPlayableMin.x,

        floorMaxX:
          this._shipPlayableMax.x,

        floorMinZ:
          this._shipPlayableMin.z,

        floorMaxZ:
          this._shipPlayableMax.z,

        floorY,

        ceilingY:
          this.shipScaleMetrics
            .ceilingY,

        exitCenterX:
          runtimeLayout
            .exitPrompt.x,

        exitZ:
          exitWallZ,

        exitWidth:
          3.65,
      },
    );

    const shipArtLayoutScale =
      this.shipScale /
      0.4;

    this.collision.addBox(
      'ship_nara_station_proxy',

      new Vector3(
        -0.75 *
          shipArtLayoutScale,

        floorY + 0.55,

        -3.45 *
          shipArtLayoutScale,
      ),

      new Vector3(
        1.45,
        1.1,
        0.95,
      ),

      true,

      {
        category:
          'obstacle',

        blocksPlayer:
          true,

        cameraBlocker:
          true,
      },
    );

    this.player.setCollisionResolver(
      (position) => {
        this.collision?.resolve(
          position,
        );

        constrainToShipPlayableRoom(
          position,
          this._shipPlayableMin,
          this._shipPlayableMax,
        );
      },
    );

    const shipArt =
      buildShipInteriorArt(
        this.scene,
        materials,
        this.shipScale /
          0.4,
      );

    this.runtimeMeshes.push(
      ...this.compactRuntimeMeshes(
        shipArt.meshes,
        'ShipInteriorArt',
      ),
    );

    this.lights.push(
      ...shipArt.lights,
    );

    const playerStart =
      runtimeLayout.playerStart;

    const naraStart =
      runtimeLayout.naraStart;

    const exitPrompt =
      runtimeLayout.exitPrompt;

    const entrySpawn =
      runtimeLayout.entrySpawn;

    const enteringFromRamp =
      spawn ===
        'shipEntryInterior' ||
      spawn ===
        'shipExit';

    this._shipInteriorCameraYaw =
      0.08;

    console.info(
      '[SHIP PLAYABILITY] camera yaw',
      this._shipInteriorCameraYaw,
    );

    // ============================================================
    // NARA VOSS — W218 TWILEK REPLACEMENT
    // ============================================================

    let nara:
      ImportedAsset |
      undefined;

    if (
      !partyRoster.isRecruited(
        'nara_voss',
      )
    ) {
      nara =
        await this.load(
          '/assets/characters/nara/nara_voss_twilek_v1.glb',
          'Nara Voss',
          1,
          2,
        );

      const sourceHeight =
        measureVisualBounds(
          nara.meshes,
        ).height;

      const targetHeight =
        1.76;

      const scale =
        sourceHeight > 0.001
          ? targetHeight /
            sourceHeight
          : 1;

      nara.root.scaling.setAll(
        scale,
      );

      nara.root.position.copyFrom(
        naraStart,
      );

      nara.animationGroups.forEach(
        (group) => group.stop(),
      );

      const idle =
        nara.animationGroups.find(
          (group) =>
            group.name.trim().toLowerCase() ===
            'idle_v2',
        );

      idle?.start(
        true,
        1,
        idle.from,
        idle.to,
      );

      this.shipNaraHeight =
        measureVisualBounds(
          nara.meshes,
        ).height;

      console.info(
        '[W218] Nara Twilek static actor',
        {
          sourceHeight,
          targetHeight,
          scale,
          measuredHeight:
            this.shipNaraHeight,
          animations:
            nara.animationGroups.map(
              (group) => group.name,
            ),
        },
      );

      nara.meshes.forEach(
        (mesh) => {
          mesh.isPickable = true;
          mesh.metadata = {
            ...(mesh.metadata ?? {}),
            actor: 'NARA_VOSS',
            storyNpc: true,
          };
        },
      );

      this.currentAssets.push(
        nara,
      );

      const onNaraRecruited =
        (
          event: Event,
        ) => {
          const custom =
            event as CustomEvent<{
              id?: string;
            }>;

          if (
            custom.detail?.id !==
            'nara_voss'
          ) {
            return;
          }

          nara?.root.setEnabled(
            false,
          );
        };

      window.addEventListener(
        'nerathis:party-recruited',
        onNaraRecruited,
      );

      this.customDisposers.push(
        () =>
          window.removeEventListener(
            'nerathis:party-recruited',
            onNaraRecruited,
          ),
      );
    } else {
      this.shipNaraHeight =
        1.76;
    }

    this.shipNaraPosition =
      () =>
        nara?.root
          .getAbsolutePosition()
          .clone()
        ?? naraStart.clone();

    this.player.setPosition(
      enteringFromRamp
        ? entrySpawn
        : playerStart,
    );

    const facingTarget =
      enteringFromRamp
        ? playerStart
        : naraStart;

    const facing =
      facingTarget.subtract(
        this.player.position,
      );

    this.player.setFacingYaw(
      Math.atan2(
        facing.x,
        facing.z,
      ),
    );

    if (nara) {
      this.interaction.register({
        id: 'nara',

        label:
          'Hablar con Nara',

        position: () =>
          nara?.root
            .getAbsolutePosition()
          ?? naraStart,

        radius: 1.55,

        enabled: () =>
          !partyRoster.isRecruited(
            'nara_voss',
          ),

        action: () =>
          this.dialogue.openNara(),
      });
    }

    this.portals.registerInteriorExit(
      exitPrompt,

      () => {
        this.quest.markExteriorReached();

        void this.loadScene(
          'nerathisExterior',
          'shipExitExterior',
          true,
        );
      },

      () =>
        this.state
          .naraConversationCompleted ||
        this.state.questStage >=
          2,
    );
  }

  // ================================================================
  // NERATHIS EXTERIOR
  // ================================================================

  private async buildExterior(
    spawn: SpawnId,
  ) {
    const search =
      new URLSearchParams(
        window.location.search,
      );

    const w209Matte =
      search.has(
        'w209Capture',
      );

    const w210Capture =
      search.get(
        'w210Capture',
      );

    const w210Matte =
      false;

    const matteExterior =
      w209Matte ||
      w210Matte;

    // ==============================================================
    // ATMOSPHERE
    // ==============================================================

    this.configureAtmosphere(
      new Color4(
        0.05,
        0.095,
        0.12,
        1,
      ),
      0.0029,
    );

    if (
      matteExterior
    ) {
      this.scene.clearColor =
        new Color4(
          0.02,
          0.04,
          0.06,
          0,
        );
    }

    this.scene.fogColor =
      new Color3(
        0.23,
        0.33,
        0.35,
      );

    this.scene
      .imageProcessingConfiguration
      .contrast = 1.06;

    this.scene
      .imageProcessingConfiguration
      .exposure = 1.08;

    // ==============================================================
    // MATERIALS
    // ==============================================================

    this.currentMaterials =
      new NerathisMaterialLibrary(
        this.scene,
      );

    const materials =
      this.currentMaterials;

    // ==============================================================
    // SKY
    // ==============================================================

    const atmosphere =
      buildNerathisSkySystem(
        this.scene,
      );

    this.skyLightningTrigger =
      atmosphere.triggerLightning;

    this.customDisposers.push(
      atmosphere.dispose,
    );

    // ==============================================================
    // WORLD LIGHTING
    // ==============================================================

    const lighting =
      createNerathisLighting(
        this.scene,
      );

    this.lights.push(
      ...lighting.lights,
    );

    // ==============================================================
    // COLLISION WORLD
    // ==============================================================

    this.collision =
      new SimpleCollisionWorld(
        this.scene,
      );

    this.player.setCollisionResolver(
      (position) =>
        this.collision?.resolve(
          position,
        ),
    );

    // ==============================================================
    // DISTRICT 01 — SPACEPORT
    // ==============================================================

    const spaceport =
      buildKhepraSpaceport(
        this.scene,
        materials,
      );

    const spaceportMeshes =
      this.compactRuntimeMeshes(
        spaceport.meshes,
        'Spaceport',
      );

    this.runtimeMeshes.push(
      ...spaceportMeshes,
    );

    this.lights.push(
      ...spaceport.lights,
    );

    // ==============================================================
    // DISTRICT 02 — FIELD HOSPITAL / CLINICA 2
    //
    // IMPORTANT:
    //
    // This block was missing from the current SceneManager.
    //
    // Without it KhepraFieldHospital.ts exists on disk but is never
    // instantiated into the Babylon scene.
    // ==============================================================

    const fieldHospital =
      buildKhepraFieldHospital(
        this.scene,
        materials,
      );

    const fieldHospitalMeshes =
      this.compactRuntimeMeshes(
        fieldHospital.meshes,
        'KhepraFieldHospital',
      );

    this.runtimeMeshes.push(
      ...fieldHospitalMeshes,
    );

    this.lights.push(
      ...fieldHospital.lights,
    );

    fieldHospital.collisions.forEach(
      (volume) => {
        this.collision?.addBox(
          volume.name,
          volume.center,
          volume.size,

          volume.cameraBlocker ??
            true,

          {
            category:
              'obstacle',

            blocksPlayer:
              true,

            cameraBlocker:
              volume.cameraBlocker ??
              true,
          },
        );
      },
    );

    // ==============================================================
    // STORY NPC — LIEUTENANT ELYRA DANE
    // W215: hospital NPC exists only until recruitment.
    // After recruitment, PartyController owns her physical party actor.
    // ==============================================================

    let elyra:
      ImportedAsset |
      undefined;

    if (
      !partyRoster.isRecruited(
        'elyra_dane',
      )
    ) {
      elyra =
        await this.loader.load(
          ELYRA_HOSPITAL_ASSET_URL,
          this.scene,
        );

      placeKhepraHospitalElyra(
        elyra,
      );

      this.currentAssets.push(
        elyra,
      );

      const elyraDialogue =
        new ElyraRecruitmentDialogue(
          this.player,

          () =>
            elyra?.root
              .getAbsolutePosition()
              .clone() ??
            Vector3.Zero(),
        );

      this.customDisposers.push(
        () =>
          elyraDialogue.dispose(),
      );

      const onElyraRecruited =
        (
          event:
            Event,
        ) => {
          const custom =
            event as CustomEvent<{
              id?: string;
            }>;

          if (
            custom.detail?.id !==
            'elyra_dane'
          ) {
            return;
          }

          elyra?.root.setEnabled(
            false,
          );
        };

      window.addEventListener(
        'nerathis:party-recruited',
        onElyraRecruited,
      );

      this.customDisposers.push(
        () =>
          window.removeEventListener(
            'nerathis:party-recruited',
            onElyraRecruited,
          ),
      );

      if (
        !matteExterior
      ) {
        this.interaction.register({
          id:
            'elyraDane',

          label:
            'Hablar con Teniente Elyra Dane',

          position: () =>
            partyRoster.isRecruited(
              'elyra_dane',
            )
              ? new Vector3(
                  9999,
                  -9999,
                  9999,
                )
              : elyra?.root
                  .getAbsolutePosition() ??
                new Vector3(
                  9999,
                  -9999,
                  9999,
                ),

          radius:
            1.85,

          action: () => {
            if (
              partyRoster.isRecruited(
                'elyra_dane',
              )
            ) {
              return;
            }

            elyraDialogue.open();
          },
        });
      }
    }

    // ==============================================================
    // WATER
    // ==============================================================

    const water =
      buildNerathisWater(
        this.scene,
        materials,
      );

    this.customDisposers.push(
      water.dispose,
    );

    // ==============================================================
    // TERRAIN
    // ==============================================================

    const terrain =
      buildNerathisTerrain(
        this.scene,
        materials,
      );

    const terrainMeshes =
      this.compactRuntimeMeshes(
        terrain.meshes,
        'Terrain',
      );

    this.runtimeMeshes.push(
      ...terrainMeshes,
    );

    // ==============================================================
    // SURFACE DECALS
    // ==============================================================

    const decals =
      buildSurfaceDecals(
        this.scene,
        materials,
      );

    const decalMeshes =
      this.compactRuntimeMeshes(
        decals.meshes,
        'SurfaceDecals',
      );

    this.runtimeMeshes.push(
      ...decalMeshes,
    );

    this.customDisposers.push(
      decals.dispose,
    );

    this.addRain();

    // ==============================================================
    // HERO SHIP
    // ==============================================================

    const ship =
      await this.load(
        '/assets/w210/ship/heavy_class_firefly.glb',
        'Heavy-class Firefly',
        0,
        9,
      );

    const exteriorShipScale =
      resolveExteriorShipScale(
        getExteriorShipScaleOverride(),
      );

    ship.root.scaling.setAll(
      exteriorShipScale,
    );

    this.adaptHeroShipMaterials(
      ship,
      materials,
    );

    ship.root.position.set(
      -16,
      0,
      2.5,
    );

    this.exteriorShipAudit =
      auditShipInterior(
        '/assets/w210/ship/heavy_class_firefly.glb',
        ship,
      );

    const supportReference =
      this.exteriorShipAudit
        .meshReports
        .reduce(
          (
            lowest,
            report,
          ) =>
            report.min.y <
            lowest.min.y
              ? report
              : lowest,

          this.exteriorShipAudit
            .meshReports[0],
        );

    ship.root.position.y -=
      supportReference.min.y;

    this.exteriorShipAudit =
      auditShipInterior(
        '/assets/w210/ship/heavy_class_firefly.glb',
        ship,
      );

    this._shipExteriorScaleMetrics =
      {
        playerHeight:
          1.83,

        shipScale:
          exteriorShipScale,

        width:
          this.exteriorShipAudit
            .size.x,

        height:
          this.exteriorShipAudit
            .size.y,

        length:
          this.exteriorShipAudit
            .size.z,

        entryHeight:
          2.5,

        entryWidth:
          2.6,

        deckY:
          0,

        supportReference:
          supportReference.name,

        playerToShipHeightRatio:
          1.83 /
          Math.max(
            0.001,

            this.exteriorShipAudit
              .size.y,
          ),
      };

    console.info(
      '[W2.0.6.4] exterior ship audit',

      JSON.stringify(
        summarizeShipAudit(
          this.exteriorShipAudit,
        ),
      ),
    );

    console.info(
      '[W2.0.6.4] exterior ship scale metrics',

      JSON.stringify(
        this._shipExteriorScaleMetrics,
      ),
    );

    this._shipExteriorRootScale =
      ship.root.scaling.clone();

    this.shipExteriorEntryRotation =
      new Vector3(
        0,
        Math.PI * 0.5,
        0,
      );

    this.shipExteriorEntryPosition =
      deriveExteriorShipEntry(
        this.exteriorShipAudit,
        0.95,
      );

    this.shipExteriorSupportPositions =
      deriveExteriorSupportPositions(
        this.exteriorShipAudit,
      );

    const entranceMeshes =
      createExteriorShipEntrance(
        this.scene,

        this.exteriorShipAudit,

        this.shipExteriorEntryPosition,

        materials,
      );

    this.runtimeMeshes.push(
      ...entranceMeshes,
    );

    buildShipExteriorCollision(
      this.collision,

      {
        min:
          this.exteriorShipAudit
            .min,

        max:
          this.exteriorShipAudit
            .max,

        entry:
          this.shipExteriorEntryPosition,

        entryWidth:
          this._shipExteriorScaleMetrics
            .entryWidth,
      },
    );

    freezeStaticMeshes(
      ship.meshes,
    );

    this.currentAssets.push(
      ship,
    );
    // ==============================================================
    // PARKED CB1
    // ==============================================================

    const parkedShip =
      await this.load(
        SPACEPORT_PARKED_SHIP_URL,
        'parked CB1 shuttle',
        2,
        9,
      );

    placeSpaceportParkedShip(
      parkedShip,
      0.13,
    );

    this.currentAssets.push(
      parkedShip,
    );

    this.collision.addBox(
      'spaceport_cb1_safety_volume',

      new Vector3(
        SPACEPORT_PARKED_SHIP
          .center.x,

        SPACEPORT_PARKED_SHIP
          .collisionSize.y *
          0.5,

        SPACEPORT_PARKED_SHIP
          .center.z,
      ),

      SPACEPORT_PARKED_SHIP
        .collisionSize,

      true,

      {
        category:
          'obstacle',

        blocksPlayer:
          true,

        cameraBlocker:
          true,
      },
    );

    // ==============================================================
    // FLOATING CARGO SHIP
    // ==============================================================

    const cargoShip =
      await this.load(
        SPACEPORT_CARGO_SHIP_URL,
        'hovering cargo ship',
        3,
        9,
      );

    placeSpaceportCargoShip(
      cargoShip,
    );

    this.currentAssets.push(
      cargoShip,
    );

    // ==============================================================
    // SPACEPORT CRATES
    // ==============================================================

    const crateDonor =
      await this.load(
        SPACEPORT_CRATE_URL,
        'spaceport cargo crates',
        4,
        9,
      );

    const cargoPass =
      placeSpaceportCargoCrates(
        crateDonor,
      );

    this.currentAssets.push(
      crateDonor,
    );

    cargoPass.collisions.forEach(
      (volume) => {
        this.collision?.addBox(
          volume.name,

          volume.center,

          volume.size,

          true,

          {
            category:
              'obstacle',

            blocksPlayer:
              true,

            cameraBlocker:
              true,
          },
        );
      },
    );

    // ==============================================================
    // CAPTURE / MATTE MODE
    // ==============================================================

    if (
      matteExterior
    ) {
      spaceportMeshes.forEach(
        (mesh) =>
          mesh.setEnabled(
            false,
          ),
      );

      // Hospital must follow the same capture rule as the procedural
      // gameplay environment.
      fieldHospitalMeshes.forEach(
        (mesh) =>
          mesh.setEnabled(
            false,
          ),
      );

      elyra?.meshes.forEach(
        (mesh) =>
          mesh.setEnabled(
            false,
          ),
      );

      water.meshes.forEach(
        (mesh) =>
          mesh.setEnabled(
            false,
          ),
      );

      terrainMeshes.forEach(
        (mesh) =>
          mesh.setEnabled(
            false,
          ),
      );

      decalMeshes.forEach(
        (mesh) =>
          mesh.setEnabled(
            false,
          ),
      );

      if (
        w209Matte ||
        w210Capture ===
          'sky'
      ) {
        ship.meshes.forEach(
          (mesh) =>
            mesh.setEnabled(
              false,
            ),
        );
      }
    }

    // ==============================================================
    // DISTANT CITY DONOR
    // ==============================================================

    const city =
      await this.load(
        '/assets/w1/city/city_kit.glb',
        'city kit',
        5,
        9,
      );

    city.root.scaling.setAll(
      0.035,
    );

    city.root.position.set(
      0,
      -0.2,

      WORLD_SCALE
        .cityCenterZ -
        30,
    );

    this.adaptCityMaterials(
      city,
      materials,
    );

    this.compactImportedAsset(
      city,
      'City',
    );

    this.currentAssets.push(
      city,
    );

    // ==============================================================
    // PROCEDURAL KHEPRA
    // ==============================================================

    const cityDecor =
      buildKhepraCity(
        this.scene,
        materials,
      );

    const cityDecorMeshes =
      matteExterior
        ? cityDecor.meshes.filter(
            (mesh) =>
              !String(
                (
                  mesh.metadata as
                    | {
                        zone?: string;
                      }
                    | null
                )?.zone ??
                  '',
              ).includes(
                'CITY',
              ),
          )
        : cityDecor.meshes;

    cityDecor.meshes
      .filter(
        (mesh) =>
          !cityDecorMeshes.includes(
            mesh,
          ),
      )
      .forEach(
        (mesh) =>
          mesh.dispose(),
      );

    this.runtimeMeshes.push(
      ...this.compactRuntimeMeshes(
        cityDecorMeshes,
        'CityDecor',
      ),
    );

    this.lights.push(
      ...cityDecor.lights,
    );

    // ==============================================================
    // HERO COMPOSITION
    // ==============================================================

    const heroComposition =
      buildKhepraHeroComposition(
        this.scene,
        materials,
      );

    const heroMeshes =
      matteExterior
        ? w210Capture ===
          'sky'
          ? []
          : heroComposition
              .meshes
              .filter(
                (mesh) => {
                  const zone =
                    String(
                      (
                        mesh.metadata as
                          | {
                              zone?: string;
                            }
                          | null
                      )?.zone ??
                        '',
                    );

                  return (
                    zone.startsWith(
                      'LANDING_',
                    ) ||
                    zone ===
                      'SHIP_FOREGROUND'
                  );
                },
              )
        : heroComposition.meshes;

    heroComposition.meshes
      .filter(
        (mesh) =>
          !heroMeshes.includes(
            mesh,
          ),
      )
      .forEach(
        (mesh) =>
          mesh.dispose(),
      );

    this.runtimeMeshes.push(
      ...this.compactRuntimeMeshes(
        heroMeshes,
        'W209HeroComposition',
      ),
    );

    this.customDisposers.push(
      heroComposition.dispose,
    );

    // ==============================================================
    // WORLD ART
    // ==============================================================

    const worldArt =
      buildNerathisWorldArtDirection(
        this.scene,
        materials,
      );

    const worldArtMeshes =
      matteExterior
        ? (
            w210Matte &&
            w210Capture !==
              'sky'
              ? worldArt.meshes.filter(
                  (mesh) =>
                    String(
                      (
                        mesh.metadata as
                          | {
                              zone?: string;
                            }
                          | null
                      )?.zone ??
                        '',
                    ) ===
                    'SHIP_SERVICE',
                )
              : []
          )
        : worldArt.meshes;

    worldArt.meshes
      .filter(
        (mesh) =>
          !worldArtMeshes.includes(
            mesh,
          ),
      )
      .forEach(
        (mesh) =>
          mesh.dispose(),
      );

    this.runtimeMeshes.push(
      ...this.compactRuntimeMeshes(
        worldArtMeshes,
        'W210WorldArt',
      ),
    );

    // ==============================================================
    // CITY COLLISION
    // ==============================================================

    this.collision.addBox(
      'city_front_block',

      new Vector3(
        0,
        2,
        -108,
      ),

      new Vector3(
        54,
        4,
        2,
      ),
    );

    this.collision.addBox(
      'city_back_block',

      new Vector3(
        0,
        2,
        -138,
      ),

      new Vector3(
        48,
        4,
        2,
      ),
    );

    // ==============================================================
    // CANTINA
    // ==============================================================

    const cantina =
      await this.load(
        '/assets/w1/cantina/cantina.glb',
        'cantina exterior',
        6,
        9,
      );

    cantina.root.scaling.setAll(
      0.07,
    );

    cantina.root.position.set(
      12,
      0,
      -105,
    );

    this.adaptExteriorAsset(
      cantina,
      materials,
      'CANTINA',
    );

    this.compactImportedAsset(
      cantina,
      'CantinaExterior',
    );

    this.currentAssets.push(
      cantina,
    );

    this.collision.addBox(
      'cantina_shell',

      new Vector3(
        12,
        2,
        -105,
      ),

      new Vector3(
        8,
        4,
        7,
      ),
    );

    const entranceLight =
      new PointLight(
        'CantinaEntranceAmber',

        new Vector3(
          8,
          2.4,
          -101.5,
        ),

        this.scene,
      );

    entranceLight.diffuse =
      new Color3(
        1,
        0.52,
        0.2,
      );

    entranceLight.intensity =
      26;

    entranceLight.range =
      12;

    this.lights.push(
      entranceLight,
    );

    // ==============================================================
    // DISTANT FOREST
    // ==============================================================

    const forest =
      await this.load(
        '/assets/w1/background/forest_mountains.glb',
        'distant forest',
        7,
        9,
      );

    forest.root.scaling.setAll(
      0.72,
    );

    forest.root.position.set(
      0,
      -16,

      WORLD_SCALE
        .mountainLineZ -
        30,
    );

    this.adaptExteriorAsset(
      forest,
      materials,
      'FOREST',
    );

    this.compactImportedAsset(
      forest,
      'Forest',
    );

    this.currentAssets.push(
      forest,
    );

    // ==============================================================
    // ROUTE-AWARE DONOR CULLING
    // ==============================================================

    const cullingObserver =
      this.scene
        .onBeforeRenderObservable
        .add(
          () => {
            const z =
              this.player
                .position.z;

            const cityVisible =
              !matteExterior &&
              z <= -42;

            const cantinaVisible =
              !matteExterior &&
              z <= -70;

            city.meshes.forEach(
              (mesh) =>
                mesh.setEnabled(
                  cityVisible,
                ),
            );

            cantina.meshes.forEach(
              (mesh) =>
                mesh.setEnabled(
                  cantinaVisible,
                ),
            );

            forest.meshes.forEach(
              (mesh) =>
                mesh.setEnabled(
                  !matteExterior &&
                    cityVisible,
                ),
            );
          },
        );

    this.customDisposers.push(
      () =>
        this.scene
          .onBeforeRenderObservable
          .remove(
            cullingObserver,
          ),
    );

    // ==============================================================
    // PLAYER SPAWN
    // ==============================================================

    const exteriorShipSpawn =
      spawn ===
      'shipExitExterior';

    this.player.setPosition(
      exteriorShipSpawn
        ? this.shipExteriorEntryPosition.clone()

        : spawn ===
            'cantinaReturn'
          ? new Vector3(
              7,
              0,
              -99,
            )

        : spawn ===
            'city'
          ? new Vector3(
              0,
              0,
              -86,
            )

        : spawn ===
            'waterfront'
          ? new Vector3(
              0,
              0,
              -55,
            )

        : new Vector3(
            0,
            0,
            0,
          ),
    );

    if (
      exteriorShipSpawn
    ) {
      this.player.setFacingYaw(
        Math.PI * 0.5,
      );
    }

    // ==============================================================
    // SHIP PORTAL
    // ==============================================================

    this.portals.registerExteriorEntry(
      this.shipExteriorEntryPosition,

      () =>
        void this.loadScene(
          'shipInterior',
          'shipEntryInterior',
          true,
        ),
    );

    // ==============================================================
    // CANTINA INTERACTION
    // ==============================================================

    this.interaction.register({
      id:
        'cantinaEnter',

      label:
        'Entrar a la cantina',

      position:
        new Vector3(
          8,
          0,
          -101.5,
        ),

      radius:
        2.8,

      action:
        () =>
          void this.loadScene(
            'cantinaInterior',
            'cantinaInterior',
            true,
          ),
    });
  }

  // ================================================================
  // CANTINA INTERIOR
  // ================================================================

  private async buildCantinaInterior(
    spawn: SpawnId,
  ) {
    this.configureAtmosphere(
      new Color4(
        0.075,
        0.035,
        0.022,
        1,
      ),
      0.009,
    );

    const materials =
      this.currentMaterials =
        new NerathisMaterialLibrary(
          this.scene,
        );

    this.addLighting(
      false,
      true,
    );

    this.collision =
      new SimpleCollisionWorld(
        this.scene,
      );

    this.player.setCollisionResolver(
      (position) =>
        this.collision?.resolve(
          position,
        ),
    );

    const cantina =
      await this.load(
        '/assets/w1/cantina/cantina.glb',
        'cantina interior',
        0,
        1,
      );

    cantina.root.scaling.setAll(
      0.07,
    );

    cantina.root.position.set(
      0,
      0,
      0,
    );

    this.adaptExteriorAsset(
      cantina,
      materials,
      'CANTINA',
    );

    this.compactImportedAsset(
      cantina,
      'RepublicOutpostShell',
    );

    this.currentAssets.push(
      cantina,
    );

    this.collision.addBox(
      'cantina_back_wall',

      new Vector3(
        0,
        2,
        5,
      ),

      new Vector3(
        12,
        4,
        0.35,
      ),
    );

    this.collision.addBox(
      'cantina_left_wall',

      new Vector3(
        -6,
        2,
        0,
      ),

      new Vector3(
        0.35,
        4,
        10,
      ),
    );

    this.collision.addBox(
      'cantina_right_wall',

      new Vector3(
        6,
        2,
        0,
      ),

      new Vector3(
        0.35,
        4,
        10,
      ),
    );

    const outpost =
      buildRepublicOutpostInterior(
        this.scene,
        materials,
      );

    this.runtimeMeshes.push(
      ...this.compactRuntimeMeshes(
        outpost.meshes,
        'RepublicOutpostInterior',
      ),
    );

    this.lights.push(
      ...outpost.lights,
    );

    this.player.setPosition(
      spawn ===
        'cantinaInterior'
        ? new Vector3(
            0,
            0,
            2.6,
          )
        : new Vector3(
            0,
            0,
            -2.4,
          ),
    );

    this.interaction.register({
      id:
        'cantinaExit',

      label:
        'Salir a Khepra Vale',

      position:
        new Vector3(
          0,
          0,
          -2.8,
        ),

      radius:
        2.4,

      action:
        () =>
          void this.loadScene(
            'nerathisExterior',
            'cantinaReturn',
            true,
          ),
    });
  }

  // ================================================================
  // ASSET LOADER
  // ================================================================

  private async load(
    url: string,
    label: string,
    index: number,
    total: number,
  ) {
    const asset =
      await this.loader.load(
        url,

        this.scene,

        (fraction) =>
          this.setProgress(
            (
              index +
              fraction
            ) /
              total,

            `Loading ${label}...`,
          ),
      );

    asset.meshes.forEach(
      (mesh) => {
        mesh.isPickable = false;
      },
    );

    return asset;
  }

  // ================================================================
  // ATMOSPHERE
  // ================================================================

  private configureAtmosphere(
    clear: Color4,
    fogDensity: number,
  ) {
    this.scene.clearColor =
      clear;

    this.scene
      .imageProcessingConfiguration
      .contrast = 1;

    this.scene
      .imageProcessingConfiguration
      .exposure = 1;

    this.scene.fogMode =
      Scene.FOGMODE_EXP2;

    this.scene.fogDensity =
      fogDensity;

    this.scene.fogColor =
      new Color3(
        0.055,
        0.1,
        0.15,
      );
  }

  // ================================================================
  // LEGACY LIGHTING HELPERS
  // ================================================================

  private addLighting(
    exterior: boolean,
    warm = false,
  ) {
    const ambient =
      new HemisphericLight(
        `Ambient_${this.state.currentScene}`,

        new Vector3(
          0,
          1,
          0,
        ),

        this.scene,
      );

    ambient.intensity =
      exterior
        ? 0.5
        : 0.5;

    ambient.diffuse =
      new Color3(
        0.45,
        0.62,
        0.78,
      );

    ambient.groundColor =
      new Color3(
        0.03,
        0.045,
        0.07,
      );

    const key =
      new DirectionalLight(
        `Key_${this.state.currentScene}`,

        new Vector3(
          -0.45,
          -1,
          0.35,
        ),

        this.scene,
      );

    key.position =
      new Vector3(
        8,
        12,
        -8,
      );

    key.intensity =
      exterior
        ? 1.1
        : 0.95;

    key.diffuse =
      new Color3(
        0.68,
        0.83,
        1,
      );

    const fill =
      new PointLight(
        `Warm_${this.state.currentScene}`,

        new Vector3(
          0,
          2.5,
          warm
            ? -1
            : 1,
        ),

        this.scene,
      );

    fill.intensity =
      warm
        ? 5
        : 16;

    fill.range =
      warm
        ? 10
        : 14;

    fill.diffuse =
      warm
        ? new Color3(
            1,
            0.45,
            0.18,
          )
        : new Color3(
            1,
            0.62,
            0.3,
          );

    this.lights.push(
      ambient,
      key,
      fill,
    );
  }

  // ================================================================
  // LEGACY LANDING SET
  // ================================================================

  private addLanding() {
    const platform =
      MeshBuilder.CreateCylinder(
        'landing_platform',

        {
          diameter: 14,
          height: 0.18,
          tessellation: 48,
        },

        this.scene,
      );

    platform.position.y =
      -0.08;

    const material =
      new PBRMaterial(
        'WetLandingMaterial',
        this.scene,
      );

    material.albedoColor =
      new Color3(
        0.035,
        0.07,
        0.085,
      );

    material.metallic =
      0.55;

    material.roughness =
      0.28;

    platform.material =
      material;

    platform.isPickable =
      true;

    this.runtimeMeshes.push(
      platform,
    );

    const markerMaterial =
      new StandardMaterial(
        'LandingCyanMarkings',
        this.scene,
      );

    markerMaterial.diffuseColor =
      new Color3(
        0.08,
        0.45,
        0.5,
      );

    markerMaterial.emissiveColor =
      new Color3(
        0.03,
        0.22,
        0.25,
      );

    for (
      let i = 0;
      i < 8;
      i++
    ) {
      const marker =
        MeshBuilder.CreateBox(
          `landing_edge_${i}`,

          {
            width: 0.08,
            height: 0.025,
            depth: 2.2,
          },

          this.scene,
        );

      const angle =
        (
          Math.PI *
          2 *
          i
        ) /
        8;

      marker.position.set(
        Math.cos(angle) *
          5.6,

        0.04,

        Math.sin(angle) *
          5.6,
      );

      marker.rotation.y =
        angle;

      marker.material =
        markerMaterial;

      marker.isPickable =
        false;

      this.runtimeMeshes.push(
        marker,
      );
    }
  }

  // ================================================================
  // LEGACY SHIP SET
  // ================================================================

  private addShipInteriorSet() {
    const floor =
      MeshBuilder.CreateBox(
        'ship_walkable_deck',

        {
          width: 7.2,
          height: 0.08,
          depth: 8.6,
        },

        this.scene,
      );

    floor.position.y =
      -0.04;

    const material =
      new PBRMaterial(
        'ShipDeckMaterial',
        this.scene,
      );

    material.albedoColor =
      new Color3(
        0.045,
        0.07,
        0.085,
      );

    material.metallic =
      0.6;

    material.roughness =
      0.38;

    floor.material =
      material;

    floor.isPickable =
      true;

    this.runtimeMeshes.push(
      floor,
    );

    const panelMaterial =
      new StandardMaterial(
        'ShipPanelMaterial',
        this.scene,
      );

    panelMaterial.diffuseColor =
      new Color3(
        0.08,
        0.14,
        0.16,
      );

    panelMaterial.emissiveColor =
      new Color3(
        0.015,
        0.07,
        0.09,
      );

    for (
      const [x, z]
      of [
        [-2.8, 1.6],
        [2.8, 1.6],
        [-2.8, -1.4],
        [2.8, -1.4],
      ] as Array<
        [
          number,
          number,
        ]
      >
    ) {
      const panel =
        MeshBuilder.CreateBox(
          `ship_console_${x}_${z}`,

          {
            width: 0.7,
            height: 0.9,
            depth: 1.2,
          },

          this.scene,
        );

      panel.position.set(
        x,
        0.45,
        z,
      );

      panel.material =
        panelMaterial;

      panel.isPickable =
        false;

      this.runtimeMeshes.push(
        panel,
      );
    }
  }

  // ================================================================
  // LEGACY WATER
  // ================================================================

  private addWater() {
    const water =
      MeshBuilder.CreateGround(
        'near_black_water',

        {
          width: 260,
          height: 260,
        },

        this.scene,
      );

    water.position.y =
      -0.22;

    const material =
      new PBRMaterial(
        'NearBlackBlueGreenWater',
        this.scene,
      );

    material.albedoColor =
      new Color3(
        0.012,
        0.035,
        0.04,
      );

    material.metallic =
      0.2;

    material.roughness =
      0.42;

    water.material =
      material;

    water.isPickable =
      false;

    this.runtimeMeshes.push(
      water,
    );
  }

  // ================================================================
  // LEGACY CANTINA SET
  // ================================================================

  private addCantinaInteriorSet() {
    const floor =
      MeshBuilder.CreateGround(
        'cantina_walkable_floor',

        {
          width: 12,
          height: 10,
        },

        this.scene,
      );

    const floorMaterial =
      new PBRMaterial(
        'CantinaFloorMaterial',
        this.scene,
      );

    floorMaterial.albedoColor =
      new Color3(
        0.12,
        0.055,
        0.028,
      );

    floorMaterial.metallic =
      0.25;

    floorMaterial.roughness =
      0.5;

    floor.material =
      floorMaterial;

    floor.isPickable =
      true;

    this.runtimeMeshes.push(
      floor,
    );

    const wood =
      new StandardMaterial(
        'CantinaWoodMaterial',
        this.scene,
      );

    wood.diffuseColor =
      new Color3(
        0.25,
        0.09,
        0.035,
      );

    wood.emissiveColor =
      new Color3(
        0.06,
        0.018,
        0.005,
      );

    const bar =
      MeshBuilder.CreateBox(
        'cantina_bar',

        {
          width: 5.2,
          height: 1.2,
          depth: 0.7,
        },

        this.scene,
      );

    bar.position.set(
      0,
      0.6,
      2.2,
    );

    bar.material =
      wood;

    bar.isPickable =
      false;

    this.runtimeMeshes.push(
      bar,
    );

    for (
      const x
      of [
        -3.2,
        0,
        3.2,
      ]
    ) {
      const table =
        MeshBuilder.CreateCylinder(
          `cantina_table_${x}`,

          {
            diameter: 1.35,
            height: 0.12,
            tessellation: 24,
          },

          this.scene,
        );

      table.position.set(
        x,
        0.9,
        -0.4,
      );

      table.material =
        wood;

      table.isPickable =
        false;

      this.runtimeMeshes.push(
        table,
      );

      const light =
        new PointLight(
          `CantinaTableLight_${x}`,

          new Vector3(
            x,
            2.4,
            -0.4,
          ),

          this.scene,
        );

      light.diffuse =
        new Color3(
          1,
          0.36,
          0.1,
        );

      light.intensity =
        12;

      light.range =
        6;

      this.lights.push(
        light,
      );
    }
  }

  // ================================================================
  // LEGACY CITY PROMENADE
  // ================================================================

  private addCityPromenade() {
    const buildingMaterial =
      new PBRMaterial(
        'KhepraCityMaterial',
        this.scene,
      );

    buildingMaterial.albedoColor =
      new Color3(
        0.12,
        0.17,
        0.18,
      );

    buildingMaterial.metallic =
      0.18;

    buildingMaterial.roughness =
      0.6;

    const windowMaterial =
      new StandardMaterial(
        'KhepraWindowMaterial',
        this.scene,
      );

    windowMaterial.diffuseColor =
      new Color3(
        0.18,
        0.38,
        0.42,
      );

    windowMaterial.emissiveColor =
      new Color3(
        0.03,
        0.2,
        0.24,
      );

    for (
      const [x, z, h]
      of [
        [-10, 1, 4.4],
        [-4, 5, 6.2],
        [5, 3, 5.1],
        [11, 7, 7.2],
        [-12, 9, 3.8],
      ] as Array<
        [
          number,
          number,
          number,
        ]
      >
    ) {
      const building =
        MeshBuilder.CreateBox(
          `khepra_building_${x}_${z}`,

          {
            width: 4.2,
            height: h,
            depth: 4.2,
          },

          this.scene,
        );

      building.position.set(
        70 + x,
        h / 2,
        z,
      );

      building.material =
        buildingMaterial;

      building.isPickable =
        false;

      this.runtimeMeshes.push(
        building,
      );

      const window =
        MeshBuilder.CreateBox(
          `khepra_window_${x}_${z}`,

          {
            width: 1.15,
            height: 0.6,
            depth: 0.025,
          },

          this.scene,
        );

      window.position.set(
        70 + x,

        Math.min(
          h - 0.7,
          2.2,
        ),

        z - 2.12,
      );

      window.material =
        windowMaterial;

      window.isPickable =
        false;

      this.runtimeMeshes.push(
        window,
      );
    }
  }

  // ================================================================
  // RAIN
  // ================================================================

  private addRain() {
    const rain =
      new ParticleSystem(
        'NerathisRain',
        220,
        this.scene,
      );

    rain.particleTexture =
      new Texture(
        '/favicon.svg',
        this.scene,
      );

    rain.emitter =
      this.player.body;

    rain.minEmitBox =
      new Vector3(
        -16,
        8,
        -16,
      );

    rain.maxEmitBox =
      new Vector3(
        16,
        14,
        16,
      );

    rain.color1 =
      new Color4(
        0.55,
        0.75,
        0.9,
        0.45,
      );

    rain.color2 =
      new Color4(
        0.35,
        0.55,
        0.8,
        0.2,
      );

    rain.minSize =
      0.015;

    rain.maxSize =
      0.035;

    rain.minLifeTime =
      0.3;

    rain.maxLifeTime =
      0.6;

    rain.emitRate =
      140;

    rain.direction1 =
      new Vector3(
        -0.3,
        -10,
        0.15,
      );

    rain.direction2 =
      new Vector3(
        0.3,
        -14,
        -0.15,
      );

    rain.start();

    this.rain =
      rain;
  }

  // ================================================================
  // MATERIAL ADAPTERS
  // ================================================================

  private adaptCityMaterials(
    asset: ImportedAsset,
    materials: NerathisMaterialLibrary,
  ) {
    this.adaptExteriorAsset(
      asset,
      materials,
      'CITY',
    );
  }

  private adaptShipInteriorLook(
    asset: ImportedAsset,
  ) {
    const adjusted =
      new Set<number>();

    asset.meshes.forEach(
      (mesh) => {
        const material =
          mesh.material;

        if (
          material &&
          !adjusted.has(
            material.uniqueId,
          )
        ) {
          adjusted.add(
            material.uniqueId,
          );

          const name =
            material.name.toLowerCase();

          const coolTint =
            new Color3(
              0.48,
              0.58,
              0.56,
            );

          if (
            material instanceof
            PBRMaterial
          ) {
            material.albedoColor =
              material.albedoColor.multiply(
                coolTint,
              );

            material.roughness =
              Math.max(
                material.roughness ??
                  0.5,
                0.54,
              );

            if (
              name.includes(
                'light',
              ) ||
              name.includes(
                'emissive',
              )
            ) {
              material.emissiveColor =
                new Color3(
                  0.42,
                  0.16,
                  0.045,
                );
            }
          } else if (
            material instanceof
            StandardMaterial
          ) {
            material.diffuseColor =
              material.diffuseColor.multiply(
                coolTint,
              );

            material.specularColor =
              material.specularColor.scale(
                0.42,
              );

            if (
              name.includes(
                'light',
              ) ||
              name.includes(
                'emissive',
              )
            ) {
              material.emissiveColor =
                new Color3(
                  0.42,
                  0.16,
                  0.045,
                );
            }
          }
        }

        mesh.metadata = {
          ...(mesh.metadata ??
            {}),

          materialFamily:
            'SHIP_INTERIOR',

          mapping:
            'W210_COHERENCE_GRADE',

          zone:
            'SHIP_INTERIOR',
        };
      },
    );
  }

  private adaptHeroShipMaterials(
    asset: ImportedAsset,
    materials: NerathisMaterialLibrary,
  ) {
    asset.meshes.forEach(
      (mesh) => {
        const sourceMaterial =
          mesh.material?.name.toLowerCase() ??
          '';

        const source =
          `${mesh.name.toLowerCase()} ${sourceMaterial}`;

        let replacement:
          | PBRMaterial
          | StandardMaterial =
          materials.atlasWallWetMetal;

        let family =
          'METAL';

        if (
          source.includes(
            'glass_mat',
          ) ||
          source.includes(
            'cockpit_glass',
          )
        ) {
          replacement =
            materials.shipGlass;

          family =
            'GLASS';
        } else if (
          source.includes(
            'light_mat',
          ) &&
          !source.includes(
            'light_metal',
          )
        ) {
          replacement =
            materials.warmGlass;

          family =
            'WARM_LIGHT';
        } else if (
          source.includes(
            'solar_panel',
          )
        ) {
          replacement =
            materials.atlasRoofPanel;

          family =
            'DARK_STEEL';
        } else if (
          source.includes(
            'dark_metal',
          )
        ) {
          replacement =
            materials.darkSteel;

          family =
            'DARK_STEEL';
        } else if (
          source.includes(
            'light_metal',
          )
        ) {
          replacement =
            materials.oxidizedMetal;

          family =
            'RUST';
        } else if (
          source.includes(
            'plating',
          )
        ) {
          replacement =
            materials.wetPaintedMetal;
        } else if (
          source.includes(
            'default',
          )
        ) {
          replacement =
            materials.atlasDetailPanel;
        }

        mesh.material =
          replacement;

        mesh.metadata = {
          ...(mesh.metadata ??
            {}),

          materialFamily:
            family,

          mapping:
            'W210_HERO_SHIP_LOOKDEV',

          zone:
            'SHIP_LANDING',
        };

        mesh.isPickable =
          false;
      },
    );
  }

  private adaptExteriorAsset(
    asset: ImportedAsset,

    materials:
      NerathisMaterialLibrary,

    role:
      | 'CITY'
      | 'CANTINA'
      | 'FOREST',
  ) {
    const cityWallProfiles =
      [
        materials.atlasWallConcrete,
        materials.atlasWallConcreteB,
        materials.atlasWallWetMetal,
        materials.atlasWallPainted,
        materials.atlasWallRust,
      ];

    const cityRoofProfiles =
      [
        materials.atlasRoofMetal,
        materials.atlasRoofIndustrial,
        materials.atlasRoofPanel,
        materials.atlasRoofVegetation,
        materials.atlasRoofCanvas,
      ];

    const cantinaProfiles =
      [
        materials.atlasWallConcreteB,
        materials.atlasWallPainted,
        materials.darkWood,
        materials.atlasWallWetMetal,
        materials.wetCanvas,
      ];

    asset.meshes.forEach(
      (
        mesh,
        index,
      ) => {
        const material =
          mesh.material as
            | StandardMaterial
            | PBRMaterial
            | null;

        const name =
          mesh.name.toLowerCase();

        let replacement:
          | PBRMaterial
          | StandardMaterial
          | undefined;

        let family =
          'METAL';

        let condition =
          role ===
          'CANTINA'
            ? 'USED'
            : index %
                  11 ===
                0
              ? 'DAMAGED'
              : index %
                    5 ===
                  0
                ? 'NEGLECTED'
                : 'USED';

        if (
          role ===
          'FOREST'
        ) {
          replacement =
            name.includes(
              'rock',
            ) ||
            name.includes(
              'stone',
            ) ||
            name.includes(
              'ground',
            )
              ? materials.atlasWallStone

              : name.includes(
                    'vine',
                  ) ||
                  name.includes(
                    'moss',
                  )
                ? materials.atlasVegetationVines

                : materials.foliage;

          family =
            replacement ===
            materials.atlasWallStone
              ? 'BASALT'
              : 'VEGETATION';

          condition =
            'HUMID';
        } else if (
          name.includes(
            'window',
          ) ||
          name.includes(
            'lamp',
          ) ||
          name.includes(
            'light',
          ) ||
          name.includes(
            'emissive',
          )
        ) {
          replacement =
            role ===
            'CANTINA'
              ? materials.warmGlass
              : material ??
                materials.warmGlass;

          family =
            'WARM_LIGHT';
        } else if (
          name.includes(
            'roof',
          ) ||
          name.includes(
            'awning',
          ) ||
          name.includes(
            'canopy',
          ) ||
          name.includes(
            'tarpaulin',
          )
        ) {
          replacement =
            role ===
            'CANTINA'
              ? materials.atlasRoofCanvas
              : cityRoofProfiles[
                  index %
                    cityRoofProfiles.length
                ];

          family =
            replacement ===
            materials.atlasRoofCanvas
              ? 'CANVAS'
              : 'ROOF';
        } else if (
          name.includes(
            'pipe',
          ) ||
          name.includes(
            'gutter',
          ) ||
          name.includes(
            'cable',
          ) ||
          name.includes(
            'vent',
          ) ||
          name.includes(
            'rail',
          )
        ) {
          replacement =
            name.includes(
              'vent',
            )
              ? materials.atlasDetailVent
              : materials.atlasDetailPipe;

          family =
            'METAL';
        } else if (
          name.includes(
            'stone',
          ) ||
          name.includes(
            'rock',
          ) ||
          name.includes(
            'basalt',
          )
        ) {
          replacement =
            materials.atlasWallStone;

          family =
            'BASALT';
        } else if (
          name.includes(
            'rust',
          ) ||
          name.includes(
            'damage',
          ) ||
          name.includes(
            'burn',
          )
        ) {
          replacement =
            materials.atlasWallRust;

          family =
            'RUST';

          condition =
            'DAMAGED';
        } else if (
          name.includes(
            'concrete',
          ) ||
          name.includes(
            'floor',
          ) ||
          name.includes(
            'ground',
          )
        ) {
          replacement =
            role ===
            'CANTINA'
              ? cantinaProfiles[
                  index %
                    cantinaProfiles.length
                ]
              : materials.atlasWallConcrete;

          family =
            replacement ===
            materials.darkWood
              ? 'WOOD'

              : replacement ===
                  materials.wetCanvas
                ? 'CANVAS'

                : 'CONCRETE';
        } else {
          replacement =
            role ===
            'CANTINA'
              ? cantinaProfiles[
                  index %
                    cantinaProfiles.length
                ]

              : cityWallProfiles[
                  index %
                    cityWallProfiles.length
                ];

          family =
            replacement ===
              materials.atlasWallConcrete ||
            replacement ===
              materials.atlasWallConcreteB
              ? 'CONCRETE'

              : replacement ===
                  materials.atlasWallRust
                ? 'RUST'

                : replacement ===
                    materials.darkWood
                  ? 'WOOD'

                  : replacement ===
                      materials.wetCanvas
                    ? 'CANVAS'

                    : 'METAL';
        }

        mesh.material =
          replacement;

        mesh.metadata = {
          ...(mesh.metadata ??
            {}),

          materialFamily:
            family,

          mapping:
            'FULL_PAINTOVER',

          zone:
            role,

          condition,
        };

        mesh.isPickable =
          false;
      },
    );
  }

  // ================================================================
  // OPTIMIZATION
  // ================================================================

  private compactImportedAsset(
    asset: ImportedAsset,
    label: string,
  ) {
    asset.meshes.splice(
      0,
      asset.meshes.length,

      ...mergeStaticMeshes(
        asset.meshes,
        label,
      ),
    );

    freezeStaticMeshes(
      asset.meshes,
    );
  }

  private compactRuntimeMeshes(
    meshes: AbstractMesh[],
    label: string,
  ) {
    applySceneryMetricUVs(
      meshes,
    );

    const compacted =
      mergeStaticMeshes(
        meshes,
        label,
      );

    freezeStaticMeshes(
      compacted,
    );

    return compacted;
  }

  // ================================================================
  // CLEAR CURRENT SCENE
  // ================================================================

  private clearCurrentScene() {
    this.interaction.clear();

    this.currentAssets.forEach(
      (asset) =>
        asset.dispose(),
    );

    this.currentAssets.length =
      0;

    this.customDisposers
      .splice(0)
      .forEach(
        (dispose) =>
          dispose(),
      );

    this.shipDebugVisualization?.dispose();

    this.shipDebugVisualization =
      undefined;

    this.shipAudit =
      undefined;

    this.shipScaleMetrics =
      undefined;

    this.shipScale =
      0.4;

    this._shipInteriorCameraYaw =
      0.11;

    this.shipNaraHeight =
      0;

    this.shipNaraPosition =
      () =>
        Vector3.Zero();

    this._shipPlayableMin.set(
      0,
      0,
      0,
    );

    this._shipPlayableMax.set(
      0,
      0,
      0,
    );

    this._shipExitPosition.set(
      0,
      0,
      0,
    );

    this.exteriorShipAudit =
      undefined;

    this._shipExteriorScaleMetrics =
      undefined;

    this.shipExteriorSupportPositions =
      [];

    this.shipExteriorEntryPosition =
      Vector3.Zero();

    this.shipExteriorEntryRotation =
      Vector3.Zero();

    this._shipExteriorRootScale =
      Vector3.One();

    this.skyLightningTrigger =
      undefined;

    this.currentMaterials?.dispose();

    this.currentMaterials =
      undefined;

    this.runtimeMeshes.forEach(
      (mesh) =>
        mesh.dispose(),
    );

    this.runtimeMeshes.length =
      0;

    this.lights.forEach(
      (light) =>
        light.dispose(),
    );

    this.lights.length =
      0;

    this.collision?.dispose();

    this.collision =
      undefined;

    this.rain?.dispose();

    this.rain =
      undefined;
  }

  // ================================================================
  // LOADING UI
  // ================================================================

  private showLoading(
    sceneId: SceneId,
  ) {
    const overlay =
      document.getElementById(
        'loadingOverlay',
      );

    overlay?.classList.remove(
      'is-hidden',
    );

    this.setProgress(
      0,

      isTatooineScene(sceneId) ? `Loading ${TATOOINE_ZONES[sceneId].title}...` : sceneId ===
        'shipInterior'
        ? 'Loading ship interior...'

        : sceneId ===
            'cantinaInterior'
          ? 'Loading cantina...'

          : 'Loading Nerathis...',
    );
  }

  private async fade(
    toBlack: boolean,
    label = '',
  ) {
    const overlay =
      document.getElementById(
        'fadeOverlay',
      );

    if (!overlay) {
      return;
    }

    const labelElement =
      document.getElementById(
        'fadeLabel',
      );

    if (
      labelElement
    ) {
      labelElement.textContent =
        label;
    }

    overlay.classList.toggle(
      'is-black',
      toBlack,
    );

    await new Promise<void>(
      (resolve) =>
        window.setTimeout(
          resolve,
          toBlack
            ? 260
            : 420,
        ),
    );
  }

  // ================================================================
  // PUBLIC STATE
  // ================================================================

  get currentScene() {
    return this.state.currentScene;
  }

  get currentSpawn() {
    return this.state.currentSpawn;
  }

  get shipCurrentRoom() {
    if (
      this.state.currentScene !==
      'shipInterior'
    ) {
      return 'n/a';
    }

    return Vector3.Distance(
      this.player.position,
      this._shipExitPosition,
    ) < 2.2
      ? 'AFT HOLD / EXIT HATCH'
      : 'AFT HOLD / NARA STATION';
  }

  get shipInteriorAudit() {
    return this.shipAudit;
  }

  get shipInteriorScaleMetrics() {
    return this.shipScaleMetrics;
  }

  get shipInteriorScale() {
    return this.shipScale;
  }

  get shipInteriorCameraYaw() {
    return this._shipInteriorCameraYaw;
  }

  get shipInteriorNaraHeight() {
    return this.shipNaraHeight;
  }

  get shipPlayerInsideBounds() {
    return this.shipAudit
      ? isInsideShipBounds(
          this.shipAudit,
          this.player.position,
        )
      : false;
  }

  get shipNaraInsideBounds() {
    return this.shipAudit
      ? isInsideShipBounds(
          this.shipAudit,
          this.shipNaraPosition(),
        )
      : false;
  }

  get shipNaraWorldPosition() {
    return this.shipNaraPosition();
  }

  get shipPlayableMin() {
    return this._shipPlayableMin.clone();
  }

  get shipPlayableMax() {
    return this._shipPlayableMax.clone();
  }

  get shipExitWorldPosition() {
    return this._shipExitPosition.clone();
  }

  get shipExteriorAudit() {
    return this.exteriorShipAudit;
  }

  get shipExteriorScaleMetrics() {
    return this._shipExteriorScaleMetrics;
  }

  get shipExteriorSupportWorldPositions() {
    return this.shipExteriorSupportPositions;
  }

  get shipExteriorEntryWorldPosition() {
    return this.shipExteriorEntryPosition;
  }

  get shipExteriorEntryDistance() {
    return Vector3.Distance(
      this.player.position,
      this.shipExteriorEntryPosition,
    );
  }

  get shipExteriorEntryActive() {
    return (
      this.interaction
        .currentTargetId ===
      'shipEntry'
    );
  }

  get shipExteriorRootScale() {
    return this._shipExteriorRootScale;
  }

  get shipExteriorRootPosition() {
    return (
      this.exteriorShipAudit
        ?.rootPosition ??
      Vector3.Zero()
    );
  }

  get shipExteriorRootRotation() {
    return (
      this.exteriorShipAudit
        ?.rootRotation ??
      this.shipExteriorEntryRotation
    );
  }

  get shipCollisionProxyCount() {
    return (
      this.collision
        ?.colliderCount ??
      0
    );
  }

  get shipCameraBlockerCount() {
    return (
      this.collision
        ?.cameraBlockerCount ??
      0
    );
  }

  triggerSkyLightning() {
    this.skyLightningTrigger?.();
  }

  setCollisionDebugVisible(
    visible: boolean,
  ) {
    this.collision?.setDebugVisible(
      visible,
    );
  }

  enableShipDebugVisualization() {
    if (
      this.state.currentScene !==
        'shipInterior' ||
      !this.shipAudit ||
      this.shipDebugVisualization
    ) {
      return;
    }

    this.shipDebugVisualization =
      createShipDebugVisualization(
        this.scene,

        this.shipAudit,

        () =>
          this.player.position,

        this.shipNaraPosition,
      );

    this.runtimeMeshes.push(
      ...this.shipDebugVisualization
        .meshes,
    );
  }

  enableShipScaleDebugVisualization() {
    if (
      this.state.currentScene !==
        'shipInterior' ||
      !this.shipAudit ||
      this.shipDebugVisualization
    ) {
      return;
    }

    this.shipDebugVisualization =
      createShipScaleDebugVisualization(
        this.scene,

        this.shipAudit,

        () =>
          this.player.position,

        this.shipNaraPosition,
      );

    this.runtimeMeshes.push(
      ...this.shipDebugVisualization
        .meshes,
    );
  }

  enableShipExteriorScaleDebugVisualization() {
    if (
      this.state.currentScene !==
        'nerathisExterior' ||
      !this.exteriorShipAudit ||
      this.shipDebugVisualization
    ) {
      return;
    }

    this.shipDebugVisualization =
      createShipExteriorScaleDebugVisualization(
        this.scene,

        this.exteriorShipAudit,

        () =>
          this.player.position,

        this.shipExteriorEntryPosition,

        this.shipExteriorSupportPositions,
      );

    this.runtimeMeshes.push(
      ...this.shipDebugVisualization
        .meshes,
    );
  }
}

// ==================================================================
// AUDIT HELPERS
// ==================================================================

function summarizeShipAudit(
  audit: ShipInteriorAudit,
) {
  return {
    file:
      audit.file,

    meshCount:
      audit.meshCount,

    boundsMin:
      audit.min
        .asArray()
        .map(
          (value) =>
            Number(
              value.toFixed(3),
            ),
        ),

    boundsMax:
      audit.max
        .asArray()
        .map(
          (value) =>
            Number(
              value.toFixed(3),
            ),
        ),

    size:
      audit.size
        .asArray()
        .map(
          (value) =>
            Number(
              value.toFixed(3),
            ),
        ),

    rootPosition:
      audit.rootPosition
        .asArray()
        .map(
          (value) =>
            Number(
              value.toFixed(3),
            ),
        ),

    rootScale:
      audit.rootScale
        .asArray()
        .map(
          (value) =>
            Number(
              value.toFixed(3),
            ),
        ),

    floorCandidates:
      audit.floorCandidates
        .slice(
          0,
          12,
        )
        .map(
          (candidate) => ({
            name:
              candidate.name,

            center:
              candidate.center
                .asArray()
                .map(
                  (value) =>
                    Number(
                      value.toFixed(
                        3,
                      ),
                    ),
                ),

            size:
              candidate.size
                .asArray()
                .map(
                  (value) =>
                    Number(
                      value.toFixed(
                        3,
                      ),
                    ),
                ),
          }),
        ),

    meshReports:
      audit.meshReports.map(
        (mesh) => ({
          name:
            mesh.name,

          center:
            mesh.center
              .asArray()
              .map(
                (value) =>
                  Number(
                    value.toFixed(
                      3,
                    ),
                  ),
              ),

          size:
            mesh.size
              .asArray()
              .map(
                (value) =>
                  Number(
                    value.toFixed(
                      3,
                    ),
                  ),
              ),

          triangles:
            mesh.triangles,
        }),
      ),
  };
}

function deriveExteriorShipEntry(
  audit: ShipInteriorAudit,
  offset = 1.35,
) {
  const center =
    audit.min
      .add(
        audit.max,
      )
      .scale(
        0.5,
      );

  return new Vector3(
    audit.max.x +
      offset,

    Math.max(
      0.03,
      audit.min.y +
        0.02,
    ),

    center.z,
  );
}

function deriveExteriorSupportPositions(
  audit: ShipInteriorAudit,
) {
  const center =
    audit.min
      .add(
        audit.max,
      )
      .scale(
        0.5,
      );

  return [
    new Vector3(
      center.x -
        audit.size.x *
          0.26,

      0.045,

      center.z -
        audit.size.z *
          0.22,
    ),

    new Vector3(
      center.x +
        audit.size.x *
          0.26,

      0.045,

      center.z -
        audit.size.z *
          0.22,
    ),

    new Vector3(
      center.x -
        audit.size.x *
          0.26,

      0.045,

      center.z +
        audit.size.z *
          0.22,
    ),

    new Vector3(
      center.x +
        audit.size.x *
          0.26,

      0.045,

      center.z +
        audit.size.z *
          0.22,
    ),
  ];
}

function createExteriorShipEntrance(
  scene: Scene,
  audit: ShipInteriorAudit,
  entry: Vector3,
  materials: NerathisMaterialLibrary,
) {
  const meshes:
    AbstractMesh[] = [];

  const center =
    audit.min
      .add(
        audit.max,
      )
      .scale(
        0.5,
      );

  const rampDepth =
    Math.max(
      1.55,

      entry.x -
        audit.max.x +
        0.12,
    );

  const rampWidth =
    2.6;

  const darkSteel =
    materials.darkSteel;

  const warm =
    materials.warmGlass;

  const add = (
    name: string,

    size: {
      width: number;
      height: number;
      depth: number;
    },

    position: Vector3,

    material:
      | PBRMaterial
      | StandardMaterial,
  ) => {
    const mesh =
      MeshBuilder.CreateBox(
        name,
        size,
        scene,
      );

    mesh.position.copyFrom(
      position,
    );

    mesh.material =
      material;

    mesh.metadata = {
      materialFamily:
        material === warm
          ? 'WARM_LIGHT'
          : 'METAL',

      mapping:
        'SHIP_SERVICE',

      zone:
        'SHIP_LANDING',
    };

    mesh.isPickable =
      false;

    meshes.push(
      mesh,
    );

    return mesh;
  };

  add(
    'ShipEntryRampVisual',

    {
      width:
        rampDepth,

      height:
        0.1,

      depth:
        rampWidth,
    },

    new Vector3(
      audit.max.x +
        rampDepth *
          0.5,

      0.08,

      center.z,
    ),

    darkSteel,
  );

  add(
    'ShipEntryRampLeftRail',

    {
      width:
        rampDepth,

      height:
        0.9,

      depth:
        0.08,
    },

    new Vector3(
      audit.max.x +
        rampDepth *
          0.5,

      0.52,

      center.z -
        rampWidth *
          0.5,
    ),

    darkSteel,
  );

  add(
    'ShipEntryRampRightRail',

    {
      width:
        rampDepth,

      height:
        0.9,

      depth:
        0.08,
    },

    new Vector3(
      audit.max.x +
        rampDepth *
          0.5,

      0.52,

      center.z +
        rampWidth *
          0.5,
    ),

    darkSteel,
  );

  add(
    'ShipEntryFrameLeft',

    {
      width:
        0.12,

      height:
        2.5,

      depth:
        0.12,
    },

    new Vector3(
      audit.max.x +
        0.06,

      1.25,

      center.z -
        rampWidth *
          0.5 +
        0.08,
    ),

    darkSteel,
  );

  add(
    'ShipEntryFrameRight',

    {
      width:
        0.12,

      height:
        2.5,

      depth:
        0.12,
    },

    new Vector3(
      audit.max.x +
        0.06,

      1.25,

      center.z +
        rampWidth *
          0.5 -
        0.08,
    ),

    darkSteel,
  );

  add(
    'ShipEntryFrameTop',

    {
      width:
        0.12,

      height:
        0.12,

      depth:
        rampWidth,
    },

    new Vector3(
      audit.max.x +
        0.06,

      2.48,

      center.z,
    ),

    darkSteel,
  );

  add(
    'ShipEntryLampLeft',

    {
      width:
        0.08,

      height:
        0.36,

      depth:
        0.08,
    },

    new Vector3(
      audit.max.x +
        0.15,

      1.45,

      center.z -
        1.0,
    ),

    warm,
  );

  add(
    'ShipEntryLampRight',

    {
      width:
        0.08,

      height:
        0.36,

      depth:
        0.08,
    },

    new Vector3(
      audit.max.x +
        0.15,

      1.45,

      center.z +
        1.0,
    ),

    warm,
  );

  deriveExteriorSupportPositions(
    audit,
  ).forEach(
    (
      position,
      index,
    ) => {
      add(
        `ShipLandingSupport_${index}`,

        {
          width:
            0.55,

          height:
            0.42,

          depth:
            0.8,
        },

        new Vector3(
          position.x,

          0.21,

          position.z,
        ),

        darkSteel,
      );
    },
  );

  return meshes;
}

function summarizeShipScaleMetrics(
  metrics: ShipInteriorScaleMetrics,
) {
  return {
    playerHeight:
      Number(
        metrics.playerHeight.toFixed(
          3,
        ),
      ),

    shipScale:
      Number(
        metrics.shipScale.toFixed(
          3,
        ),
      ),

    rawFloorY:
      Number(
        metrics.rawFloorY.toFixed(
          3,
        ),
      ),

    rawCeilingY:
      Number(
        metrics.rawCeilingY.toFixed(
          3,
        ),
      ),

    rawClearHeight:
      Number(
        metrics.rawClearHeight.toFixed(
          3,
        ),
      ),

    floorY:
      Number(
        metrics.floorY.toFixed(
          3,
        ),
      ),

    ceilingY:
      Number(
        metrics.ceilingY.toFixed(
          3,
        ),
      ),

    clearHeight:
      Number(
        metrics.clearHeight.toFixed(
          3,
        ),
      ),

    doorHeight:
      Number(
        metrics.doorHeight.toFixed(
          3,
        ),
      ),

    corridorWidth:
      Number(
        metrics.corridorWidth.toFixed(
          3,
        ),
      ),

    consoleHeight:
      Number(
        metrics.consoleHeight.toFixed(
          3,
        ),
      ),

    headClearance:
      Number(
        metrics.headClearance.toFixed(
          3,
        ),
      ),

    roomWidth:
      Number(
        metrics.roomWidth.toFixed(
          3,
        ),
      ),

    roomDepth:
      Number(
        metrics.roomDepth.toFixed(
          3,
        ),
      ),

    floorMesh:
      metrics.floorMesh,

    ceilingMesh:
      metrics.ceilingMesh,

    doorMesh:
      metrics.doorMesh,

    corridorMesh:
      metrics.corridorMesh,
  };
}

function resolveShipScale(
  calculatedScale: number,
) {
  return Number(
    Math.max(
      0.7,

      Math.min(
        1.2,
        calculatedScale,
      ),
    ).toFixed(3),
  );
}

function resolveExteriorShipScale(
  override?: number,
) {
  return Number(
    (
      override ??
      0.35
    ).toFixed(3),
  );
}

function getExteriorShipScaleOverride() {
  const search =
    new URLSearchParams(
      window.location.search,
    );

  const value =
    search.get(
      'w2064shipscale',
    );

  if (
    !value ||
    value === '1'
  ) {
    return undefined;
  }

  const numeric =
    Number(value);

  if (
    !Number.isFinite(
      numeric,
    )
  ) {
    return undefined;
  }

  const supported =
    [
      0.3,
      0.35,
      0.4,
    ];

  const closest =
    supported.reduce(
      (
        best,
        candidate,
      ) =>
        Math.abs(
          candidate -
            numeric,
        ) <
        Math.abs(
          best -
            numeric,
        )
          ? candidate
          : best,

      supported[0],
    );

  return (
    Math.abs(
      closest -
        numeric,
    ) <= 0.051
      ? closest
      : undefined
  );
}

function getShipScaleOverride() {
  const value =
    Number(
      new URLSearchParams(
        window.location.search,
      ).get(
        'w2062scale',
      ),
    );

  if (
    !Number.isFinite(
      value,
    )
  ) {
    return undefined;
  }

  const supported =
    [
      0.7,
      0.8,
      0.9,
      1,
      1.1,
      1.2,
    ];

  const closest =
    supported.reduce(
      (
        best,
        candidate,
      ) =>
        Math.abs(
          candidate -
            value,
        ) <
        Math.abs(
          best -
            value,
        )
          ? candidate
          : best,

      supported[0],
    );

  return (
    Math.abs(
      closest -
        value,
    ) <= 0.051
      ? closest
      : undefined
  );
}
