import { Vector3 } from '@babylonjs/core';
import { GameState, SceneId } from '../game/GameState';
import { PlayerController } from '../player/PlayerController';
import { ThirdPersonCamera } from '../player/ThirdPersonCamera';
import { WORLD_SCALE } from '../world/WorldScale';

interface GameMinimapSpatial {
  readonly shipPlayableMin: Vector3;
  readonly shipPlayableMax: Vector3;
  readonly shipNaraWorldPosition: Vector3;
  readonly shipExitWorldPosition: Vector3;
  readonly shipExteriorEntryWorldPosition: Vector3;
}

interface MapPoint {
  id: string;
  label: string;
  shortLabel: string;
  position: Vector3;
  kind: 'npc' | 'exit' | 'poi' | 'ship' | 'danger';
  priority?: boolean;
  locked?: boolean;
}

interface MapProfile {
  title: string;
  subtitle: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  points: MapPoint[];
  objective?: MapPoint;
  roomLabel?: string;
}

const MAP_WIDTH = 270;
const MAP_HEIGHT = 196;
const MAP_PAD = 16;

const EXTERIOR_BOUNDS = {
  minX: -48,
  maxX: 48,
  minZ: -145,
  maxZ: 28,
} as const;

/**
 * Authored points of interest for Khepra Vale.
 *
 * Route V1:
 *
 * SPACEPORT
 *    ↓
 * FIELD HOSPITALS
 *    ↓
 * WATERFRONT
 *    ↓
 * KHEPRA VALE
 */
const EXTERIOR_POINTS = {
  landing: new Vector3(
    0,
    0,
    0,
  ),

  hospital: new Vector3(
    8,
    0,
    -58,
  ),

  waterfront: new Vector3(
    0,
    0,
    WORLD_SCALE.waterCenterZ,
  ),

  swamp: new Vector3(
    -31,
    0,
    -59,
  ),

  settlement: new Vector3(
    23,
    0,
    -69,
  ),

  city: new Vector3(
    0,
    0,
    WORLD_SCALE.cityCenterZ,
  ),

  cantina: new Vector3(
    8,
    0,
    -101.5,
  ),

  attacked: new Vector3(
    -18,
    0,
    -111,
  ),

  parkedShip: new Vector3(
    35,
    0,
    -5.5,
  ),
} as const;

/**
 * The file keeps its historical ShipMinimap name so Game.ts does not need a
 * compatibility change, but V2 turns it into the normal navigation minimap
 * for every gameplay scene.
 *
 * Hospital V1 expands the exterior route:
 *
 * PUERTO
 *   ↓
 * HOSPITAL
 *   ↓
 * MUELLE
 *   ↓
 * KHEPRA
 */
export class ShipMinimap {
  private readonly root: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly title: HTMLSpanElement;
  private readonly subtitle: HTMLDivElement;
  private readonly objective: HTMLDivElement;

  private userVisible = true;
  private lastDraw = 0;

  constructor(
    private readonly player: PlayerController,
    private readonly camera: ThirdPersonCamera,
    private readonly state: GameState,
    private readonly spatial: GameMinimapSpatial,
  ) {
    // Defensive cleanup for Vite HMR/restarts.
    document
      .getElementById('gameMinimap')
      ?.remove();

    this.root = document.createElement(
      'div',
    );

    this.root.id = 'gameMinimap';
    this.root.className =
      'game-minimap';

    this.root.setAttribute(
      'aria-label',
      'Minimapa de navegación',
    );

    const header =
      document.createElement('div');

    header.className =
      'game-minimap__header';

    this.title =
      document.createElement('span');

    this.title.textContent = 'NAVE';

    const key =
      document.createElement('span');

    key.className =
      'game-minimap__key';

    key.textContent = 'M';

    header.append(
      this.title,
      key,
    );

    this.subtitle =
      document.createElement('div');

    this.subtitle.className =
      'game-minimap__subtitle';

    this.canvas =
      document.createElement('canvas');

    this.canvas.className =
      'game-minimap__canvas';

    this.canvas.setAttribute(
      'aria-label',
      'Mapa dinámico del área actual',
    );

    const context =
      this.canvas.getContext('2d');

    if (!context) {
      throw new Error(
        'Game minimap requires a 2D canvas context',
      );
    }

    this.context = context;

    const legend =
      document.createElement('div');

    legend.className =
      'game-minimap__legend';

    legend.innerHTML = [
      '<span><i class="game-minimap__dot game-minimap__dot--player"></i>Vos</span>',
      '<span><i class="game-minimap__dot game-minimap__dot--objective"></i>Objetivo</span>',
      '<span><i class="game-minimap__dot game-minimap__dot--poi"></i>Ubicación</span>',
    ].join('');

    this.objective =
      document.createElement('div');

    this.objective.className =
      'game-minimap__objective';

    this.root.append(
      header,
      this.subtitle,
      this.canvas,
      legend,
      this.objective,
    );

    document.body.appendChild(
      this.root,
    );

    // Do not rely on the shared .is-hidden helper for this HUD. The V1 map
    // could stay invisible after scene/HMR state changes.
    this.root.style.display = 'block';

    window.addEventListener(
      'keydown',
      this.onKeyDown,
    );

    this.draw();
  }

  private readonly onKeyDown = (
    event: KeyboardEvent,
  ) => {
    if (
      event.repeat ||
      event.key.toLowerCase() !== 'm'
    ) {
      return;
    }

    this.userVisible =
      !this.userVisible;

    this.syncVisibility();
  };

  private syncVisibility() {
    this.root.style.display =
      this.userVisible
        ? 'block'
        : 'none';
  }

  update() {
    this.syncVisibility();

    if (!this.userVisible) {
      return;
    }

    const now =
      performance.now();

    if (
      now - this.lastDraw < 50
    ) {
      return;
    }

    this.lastDraw = now;

    this.draw();
  }

  private getProfile(
    scene: SceneId,
  ): MapProfile {
    // ============================================================
    // SHIP INTERIOR
    // ============================================================

    if (
      scene === 'shipInterior'
    ) {
      const min =
        this.spatial.shipPlayableMin;

      const max =
        this.spatial.shipPlayableMax;

      const nara: MapPoint = {
        id: 'nara',
        label: 'Nara Voss',
        shortLabel: 'NARA',
        position:
          this.spatial
            .shipNaraWorldPosition,
        kind: 'npc',
        priority: true,
      };

      const exitLocked =
        !this.state
          .naraConversationCompleted &&
        this.state.questStage <= 1;

      const exit: MapPoint = {
        id: 'shipExit',

        label: exitLocked
          ? 'Salida (bloqueada)'
          : 'Salida de la nave',

        shortLabel: exitLocked
          ? 'SALIDA ×'
          : 'SALIDA',

        position:
          this.spatial
            .shipExitWorldPosition,

        kind: 'exit',

        priority:
          !exitLocked,

        locked:
          exitLocked,
      };

      return {
        title:
          'NAVE · AFT HOLD',

        subtitle: exitLocked
          ? 'Briefing con Nara · salida bloqueada'
          : 'Ruta al hatch de salida',

        minX: Math.min(
          min.x,
          max.x,
        ),

        maxX: Math.max(
          min.x,
          max.x,
        ),

        minZ: Math.min(
          min.z,
          max.z,
        ),

        maxZ: Math.max(
          min.z,
          max.z,
        ),

        points: [
          nara,
          exit,
        ],

        objective: exitLocked
          ? nara
          : exit,

        roomLabel:
          'AFT HOLD',
      };
    }

    // ============================================================
    // CANTINA INTERIOR
    // ============================================================

    if (
      scene === 'cantinaInterior'
    ) {
      const exit: MapPoint = {
        id: 'cantinaExit',

        label:
          'Salida a Khepra Vale',

        shortLabel:
          'SALIDA',

        position:
          new Vector3(
            0,
            0,
            -2.8,
          ),

        kind:
          'exit',

        priority:
          true,
      };

      return {
        title:
          'CANTINA · INTERIOR',

        subtitle:
          'Distrito de Khepra Vale',

        minX:
          -6.2,

        maxX:
          6.2,

        minZ:
          -5.2,

        maxZ:
          5.2,

        points: [
          exit,
        ],

        objective:
          exit,

        roomLabel:
          'CANTINA',
      };
    }

    // ============================================================
    // EXTERIOR
    // ============================================================

    const ship: MapPoint = {
      id:
        'ship',

      label:
        'Nave',

      shortLabel:
        'NAVE',

      position:
        this.spatial
          .shipExteriorEntryWorldPosition,

      kind:
        'ship',

      priority:
        true,
    };

    const hospital: MapPoint = {
      id:
        'hospital',

      label:
        'Hospitales de Campaña',

      shortLabel:
        'HOSPITAL',

      position:
        EXTERIOR_POINTS.hospital,

      kind:
        'poi',

      priority:
        true,
    };

    const city: MapPoint = {
      id:
        'city',

      label:
        'Khepra Vale',

      shortLabel:
        'KHEPRA',

      position:
        EXTERIOR_POINTS.city,

      kind:
        'poi',

      priority:
        true,
    };

    const cantina: MapPoint = {
      id:
        'cantina',

      label:
        'Cantina',

      shortLabel:
        'CANTINA',

      position:
        EXTERIOR_POINTS.cantina,

      kind:
        'poi',

      priority:
        true,
    };

    const attacked: MapPoint = {
      id:
        'attacked',

      label:
        'Zona atacada',

      shortLabel:
        'ATAQUE',

      position:
        EXTERIOR_POINTS.attacked,

      kind:
        'danger',

      priority:
        true,
    };

    return {
      title:
        'KHEPRA VALE · SUPERFICIE',

      subtitle:
        'Puerto → Hospitales → Khepra Vale',

      ...EXTERIOR_BOUNDS,

      points: [
        ship,

        {
          id:
            'landing',

          label:
            'Espaciopuerto',

          shortLabel:
            'PUERTO',

          position:
            EXTERIOR_POINTS.landing,

          kind:
            'poi',

          priority:
            true,
        },

        hospital,

        {
          id:
            'parkedShip',

          label:
            'CB1 estacionada',

          shortLabel:
            'CB1',

          position:
            EXTERIOR_POINTS.parkedShip,

          kind:
            'ship',
        },

        {
          id:
            'waterfront',

          label:
            'Muelle / Waterfront',

          shortLabel:
            'MUELLE',

          position:
            EXTERIOR_POINTS.waterfront,

          kind:
            'poi',
        },

        {
          id:
            'swamp',

          label:
            'Sendero del pantano',

          shortLabel:
            'PANTANO',

          position:
            EXTERIOR_POINTS.swamp,

          kind:
            'poi',
        },

        {
          id:
            'settlement',

          label:
            'Asentamiento flotante',

          shortLabel:
            'ALDEA',

          position:
            EXTERIOR_POINTS.settlement,

          kind:
            'poi',
        },

        city,

        cantina,

        attacked,
      ],

      // For now the global mission still points toward Khepra Vale.
      // Hospital is a priority POI and part of the authored route.
      objective:
        city,

      roomLabel:
        'NERATHIS',
    };
  }

  private draw() {
    const profile =
      this.getProfile(
        this.state.currentScene,
      );

    this.title.textContent =
      profile.title;

    this.subtitle.textContent =
      profile.subtitle;

    const dpr =
      Math.min(
        2,
        Math.max(
          1,
          window.devicePixelRatio ||
            1,
        ),
      );

    const expectedWidth =
      Math.round(
        MAP_WIDTH * dpr,
      );

    const expectedHeight =
      Math.round(
        MAP_HEIGHT * dpr,
      );

    if (
      this.canvas.width !==
        expectedWidth ||
      this.canvas.height !==
        expectedHeight
    ) {
      this.canvas.width =
        expectedWidth;

      this.canvas.height =
        expectedHeight;

      this.canvas.style.width =
        `${MAP_WIDTH}px`;

      this.canvas.style.height =
        `${MAP_HEIGHT}px`;
    }

    const ctx =
      this.context;

    ctx.setTransform(
      dpr,
      0,
      0,
      dpr,
      0,
      0,
    );

    ctx.clearRect(
      0,
      0,
      MAP_WIDTH,
      MAP_HEIGHT,
    );

    const width =
      Math.max(
        0.001,
        profile.maxX -
          profile.minX,
      );

    const depth =
      Math.max(
        0.001,
        profile.maxZ -
          profile.minZ,
      );

    const usableW =
      MAP_WIDTH -
      MAP_PAD * 2;

    const usableH =
      MAP_HEIGHT -
      MAP_PAD * 2;

    const toMap = (
      position: {
        x: number;
        z: number;
      },
    ) => ({
      x:
        MAP_PAD +
        ((position.x -
          profile.minX) /
          width) *
          usableW,

      // min-Z is north/top in the authored Khepra route.
      y:
        MAP_PAD +
        ((position.z -
          profile.minZ) /
          depth) *
          usableH,
    });

    // ============================================================
    // BACKGROUND
    // ============================================================

    ctx.fillStyle =
      'rgba(3, 12, 22, 0.96)';

    ctx.fillRect(
      0,
      0,
      MAP_WIDTH,
      MAP_HEIGHT,
    );

    // ============================================================
    // GRID
    // ============================================================

    ctx.strokeStyle =
      'rgba(140, 236, 255, 0.10)';

    ctx.lineWidth = 1;

    for (
      let i = 1;
      i < 4;
      i += 1
    ) {
      const x =
        MAP_PAD +
        (usableW * i) / 4;

      const y =
        MAP_PAD +
        (usableH * i) / 4;

      ctx.beginPath();

      ctx.moveTo(
        x,
        MAP_PAD,
      );

      ctx.lineTo(
        x,
        MAP_HEIGHT -
          MAP_PAD,
      );

      ctx.stroke();

      ctx.beginPath();

      ctx.moveTo(
        MAP_PAD,
        y,
      );

      ctx.lineTo(
        MAP_WIDTH -
          MAP_PAD,
        y,
      );

      ctx.stroke();
    }

    // ============================================================
    // NORTH INDICATOR
    // ============================================================

    ctx.fillStyle =
      'rgba(191,239,255,.82)';

    ctx.font =
      '700 9px ui-monospace, Consolas, monospace';

    ctx.fillText(
      'N',
      MAP_WIDTH -
        MAP_PAD -
        3,
      MAP_PAD + 8,
    );

    ctx.beginPath();

    ctx.moveTo(
      MAP_WIDTH -
        MAP_PAD,
      MAP_PAD + 12,
    );

    ctx.lineTo(
      MAP_WIDTH -
        MAP_PAD -
        3,
      MAP_PAD + 18,
    );

    ctx.lineTo(
      MAP_WIDTH -
        MAP_PAD +
        3,
      MAP_PAD + 18,
    );

    ctx.closePath();
    ctx.fill();

    // ============================================================
    // INTERIOR FLOOR OR EXTERIOR ROUTE
    // ============================================================

    if (
      this.state.currentScene ===
        'shipInterior' ||
      this.state.currentScene ===
        'cantinaInterior'
    ) {
      ctx.fillStyle =
        'rgba(51, 90, 110, 0.18)';

      ctx.strokeStyle =
        'rgba(140, 236, 255, 0.62)';

      ctx.lineWidth = 1.5;

      ctx.fillRect(
        MAP_PAD,
        MAP_PAD,
        usableW,
        usableH,
      );

      ctx.strokeRect(
        MAP_PAD,
        MAP_PAD,
        usableW,
        usableH,
      );
    } else {
      // ==========================================================
      // EXTERIOR ROUTE V1
      //
      // PUERTO
      //   ↓
      // HOSPITAL
      //   ↓
      // MUELLE
      //   ↓
      // KHEPRA
      // ==========================================================

      const routeSpaceport =
        toMap(
          EXTERIOR_POINTS.landing,
        );

      const routeHospital =
        toMap(
          EXTERIOR_POINTS.hospital,
        );

      const routeWaterfront =
        toMap(
          EXTERIOR_POINTS.waterfront,
        );

      const routeCity =
        toMap(
          EXTERIOR_POINTS.city,
        );

      // Soft route underlay.
      ctx.strokeStyle =
        'rgba(140,236,255,.10)';

      ctx.lineWidth = 7;

      ctx.beginPath();

      ctx.moveTo(
        routeSpaceport.x,
        routeSpaceport.y,
      );

      ctx.lineTo(
        routeHospital.x,
        routeHospital.y,
      );

      ctx.lineTo(
        routeWaterfront.x,
        routeWaterfront.y,
      );

      ctx.lineTo(
        routeCity.x,
        routeCity.y,
      );

      ctx.stroke();

      // Main route.
      ctx.strokeStyle =
        'rgba(140,236,255,.34)';

      ctx.lineWidth = 3;

      ctx.beginPath();

      ctx.moveTo(
        routeSpaceport.x,
        routeSpaceport.y,
      );

      ctx.lineTo(
        routeHospital.x,
        routeHospital.y,
      );

      ctx.lineTo(
        routeWaterfront.x,
        routeWaterfront.y,
      );

      ctx.lineTo(
        routeCity.x,
        routeCity.y,
      );

      ctx.stroke();

      // Hospital route node emphasis.
      ctx.fillStyle =
        'rgba(255,211,138,.20)';

      ctx.beginPath();

      ctx.arc(
        routeHospital.x,
        routeHospital.y,
        9,
        0,
        Math.PI * 2,
      );

      ctx.fill();

      ctx.strokeStyle =
        'rgba(255,211,138,.48)';

      ctx.lineWidth = 1.5;

      ctx.beginPath();

      ctx.arc(
        routeHospital.x,
        routeHospital.y,
        9,
        0,
        Math.PI * 2,
      );

      ctx.stroke();
    }

    // ============================================================
    // PLAYER + CURRENT OBJECTIVE
    // ============================================================

    const player =
      toMap(
        this.player.position,
      );

    if (
      profile.objective
    ) {
      const target =
        toMap(
          profile.objective.position,
        );

      ctx.save();

      ctx.setLineDash([
        5,
        5,
      ]);

      ctx.strokeStyle =
        'rgba(255, 211, 138, .68)';

      ctx.lineWidth = 1.5;

      ctx.beginPath();

      ctx.moveTo(
        player.x,
        player.y,
      );

      ctx.lineTo(
        target.x,
        target.y,
      );

      ctx.stroke();

      ctx.restore();
    }

    // ============================================================
    // POI
    // ============================================================

    for (
      const point of
      profile.points
    ) {
      this.drawPoint(
        ctx,
        point,
        toMap(
          point.position,
        ),
      );
    }

    // ============================================================
    // PLAYER ARROW
    // ============================================================

    // Player marker follows camera yaw; this remains useful while animations
    // temporarily rotate the character skeleton.
    const forwardX =
      Math.sin(
        this.camera.yaw,
      );

    const forwardZ =
      -Math.cos(
        this.camera.yaw,
      );

    const angle =
      Math.atan2(
        forwardZ,
        forwardX,
      );

    ctx.save();

    ctx.translate(
      player.x,
      player.y,
    );

    ctx.rotate(
      -angle,
    );

    ctx.fillStyle =
      '#ffffff';

    ctx.strokeStyle =
      '#5fd9ff';

    ctx.lineWidth = 2;

    ctx.beginPath();

    ctx.moveTo(
      9,
      0,
    );

    ctx.lineTo(
      -6,
      -5.5,
    );

    ctx.lineTo(
      -3,
      0,
    );

    ctx.lineTo(
      -6,
      5.5,
    );

    ctx.closePath();

    ctx.fill();
    ctx.stroke();

    ctx.restore();

    // ============================================================
    // OBJECTIVE TEXT
    // ============================================================

    if (
      profile.objective
    ) {
      const distance =
        Vector3.Distance(
          this.player.position,
          profile.objective.position,
        );

      this.objective.textContent =
        `OBJETIVO · ${profile.objective.shortLabel} · ${distance.toFixed(1)} m`;
    } else {
      this.objective.textContent =
        `UBICACIÓN · ${profile.roomLabel ?? profile.title}`;
    }
  }

  private drawPoint(
    ctx: CanvasRenderingContext2D,
    point: MapPoint,
    mapped: {
      x: number;
      y: number;
    },
  ) {
    const color =
      point.locked
        ? '#71808b'
        : point.kind === 'npc'
          ? '#8cecff'
          : point.kind ===
              'danger'
            ? '#ff8d79'
            : point.kind ===
                'exit'
              ? '#ffd38a'
              : point.kind ===
                  'ship'
                ? '#c7b5ff'
                : '#a8d2c5';

    ctx.save();

    ctx.translate(
      mapped.x,
      mapped.y,
    );

    ctx.fillStyle = color;

    ctx.strokeStyle =
      'rgba(255,255,255,.55)';

    ctx.lineWidth = 1;

    if (
      point.kind ===
        'exit' ||
      point.kind ===
        'danger'
    ) {
      ctx.rotate(
        Math.PI * 0.25,
      );

      ctx.fillRect(
        -4.5,
        -4.5,
        9,
        9,
      );

      ctx.strokeRect(
        -4.5,
        -4.5,
        9,
        9,
      );
    } else if (
      point.kind ===
      'ship'
    ) {
      ctx.beginPath();

      ctx.moveTo(
        0,
        -6,
      );

      ctx.lineTo(
        6,
        4,
      );

      ctx.lineTo(
        0,
        2,
      );

      ctx.lineTo(
        -6,
        4,
      );

      ctx.closePath();

      ctx.fill();
      ctx.stroke();
    } else {
      ctx.beginPath();

      ctx.arc(
        0,
        0,
        point.priority
          ? 4.5
          : 3.5,
        0,
        Math.PI * 2,
      );

      ctx.fill();
      ctx.stroke();
    }

    ctx.restore();

    if (
      point.priority
    ) {
      ctx.fillStyle =
        color;

      ctx.font =
        '700 8px ui-monospace, Consolas, monospace';

      ctx.fillText(
        point.shortLabel,
        mapped.x + 7,
        mapped.y - 6,
      );
    }
  }

  dispose() {
    window.removeEventListener(
      'keydown',
      this.onKeyDown,
    );

    this.root.remove();
  }
}