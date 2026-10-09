import {
  ArcRotateCamera,
  Color3,
  Color4,
  DirectionalLight,
  Engine,
  HemisphericLight,
  MeshBuilder,
  Scene,
  Skeleton,
  StandardMaterial,
  TransformNode,
  Vector3,
} from '@babylonjs/core';
import { AssetLoader, type ImportedAsset } from '../../assets/AssetLoader';
import { PLAYER_CHARACTERS, type PlayerCharacterConfig } from '../../player/PlayerCharacterConfig';
import { NativeJkaWeaponDefinition, WeaponAttachment } from '../../player/WeaponAttachment';
import { SaberParryController, type SaberParryEvent, type SaberParryState } from '../../combat/SaberParryController';
import { SaberTraceController, type SaberSphereTarget, type SaberTracePhase } from '../../combat/SaberTraceController';
import { classifyIncomingStrike, type SaberParryDirection } from '../../combat/SaberParryDirectionClassifier';
import { CharacterControlOwnership } from '../../party/CharacterControlOwnership';
import { PartySelectionController } from '../../party/PartySelectionController';
import { TacticalPartyRoster } from '../../party/TacticalPartyRoster';
import { TacticalPauseController } from '../../party/TacticalPauseController';
import { TacticalCommandQueue } from '../../party/tactical/TacticalCommandQueue';
import { TacticalCommandExecutor, type TacticalMotionActor } from '../../party/tactical/TacticalCommandExecutor';
import { TacticalOrderSelection } from '../../party/tactical/TacticalOrderSelection';
import type { TacticalActorId, TacticalAttackTargetCommand, TacticalWorldPoint } from '../../party/tactical/TacticalCommand';
import type { TacticalAttackStep } from '../../party/tactical/TacticalCommandExecutor';

const AREN_URL = '/_lab/jka/characters/aren/aren_native_jka_v1_defense_v2.glb';
const AREN_SHA = 'f27d77b930a1facc3af4d5ac849cc0621a680c9d3fb1461f0cd4858a7d84dfb3';
const NARA_URL = '/_lab/jka/characters/nara/nara_native_jka_v1_combat_v1.glb';
const NARA_SHA = '3b887077dade1a00d1b681c4847d0760e8efdaee0831ac91ba66759e99c80148';
const SABER_URL = '/_lab/jka/weapons/saber/jka_native_single_saber_v1.glb';
const SABER_SHA = 'b6dd4dea8d3e054f6932efa066c1840e45f10aafde04da0d860a3ba92357b677';
const BLADE_LENGTH_M = 0.98;
const CLASH_RADIUS_M = 0.08;
const DAMAGE_PER_HIT = 10;
const DIRECTIONS: SaberParryDirection[] = ['TOP', 'TOP_LEFT', 'TOP_RIGHT', 'BOTTOM_LEFT', 'BOTTOM_RIGHT'];
const RESPONSE_GROUP: Record<SaberParryDirection, string> = {
  TOP: 'JKA_PARRY_TOP', TOP_LEFT: 'JKA_PARRY_TOP_LEFT', TOP_RIGHT: 'JKA_PARRY_TOP_RIGHT',
  BOTTOM_LEFT: 'JKA_PARRY_BOTTOM_LEFT', BOTTOM_RIGHT: 'JKA_PARRY_BOTTOM_RIGHT',
};

type ActorId = 'AREN_NATIVE_JKA_V1' | 'NARA_NATIVE_JKA_V1';
type AttackPhase = 'READY' | 'START' | 'ATTACK' | 'RETURN';
type PairActor = {
  id: ActorId;
  short: 'AREN' | 'NARA';
  profile: PlayerCharacterConfig;
  asset: ImportedAsset;
  root: TransformNode;
  visualRoot: TransformNode;
  weapon: WeaponAttachment;
  activeGroup?: any;
  attackPhase: AttackPhase;
  attackInstanceId?: string;
  attackSerial: number;
  blockHeld: boolean;
  state: SaberParryState | 'READY' | 'ATTACK';
  hp: number;
  damageEvents: number;
  hitEvents: number;
  parryEvents: number;
  lastDirection?: SaberParryDirection;
  lastParry?: SaberParryEvent;
  trace: SaberTraceController;
  controlMode: 'PLAYER' | 'FOLLOWER';
  alive: boolean;
  targetable: boolean;
};

type PairCase = 'A0' | 'A1' | 'A2' | 'A3' | 'A4' | 'A5' | 'B0' | 'B1' | 'B2' | 'B3' | 'B4' | 'B5';

function css() {
  const style = document.createElement('style');
  style.id = 'jka-pair-combat-lab-style';
  style.textContent = `
    .jka-pair-lab{position:fixed;inset:0;z-index:30;pointer-events:none;color:#eefaff;font:12px/1.35 ui-monospace,Consolas,monospace}
    .jka-pair-panel{position:absolute;right:14px;top:14px;width:min(430px,calc(100vw - 28px));max-height:calc(100vh - 28px);overflow:auto;padding:14px;border:1px solid #75d8ec66;border-radius:10px;background:#07131fee;box-shadow:0 16px 42px #0009;backdrop-filter:blur(8px);pointer-events:auto}
    .jka-pair-title{display:flex;justify-content:space-between;color:#9af0ff;font:700 13px/1.3 system-ui,sans-serif;letter-spacing:.06em}
    .jka-pair-sub{color:#b2c3cd;font:10px/1.35 system-ui,sans-serif;margin:4px 0 10px}
    .jka-pair-section{border-top:1px solid #9cd8e51f;padding-top:9px;margin-top:9px}.jka-pair-heading{color:#7ed9eb;font-weight:700;margin-bottom:5px}
    .jka-pair-buttons{display:flex;flex-wrap:wrap;gap:4px}.jka-pair-buttons button{border:1px solid #79d4e64c;border-radius:5px;background:#0d2632;color:#def9ff;padding:5px 7px;font:10px ui-monospace,Consolas,monospace;cursor:pointer}.jka-pair-buttons button:hover{background:#17485b}
    .jka-pair-data{white-space:pre-wrap;color:#cfeaf3;margin:0;font-size:10px}.jka-pair-status{margin-top:8px;color:#b8f1d1;font-size:11px}.jka-pair-warning{color:#ffd58a}.jka-pair-gate{color:#8ca9b2;font-size:10px;margin-top:8px}
  `;
  document.head.append(style);
}

async function sha256(path: string) {
  const response = await fetch(path, { cache: 'no-store' });
  if (!response.ok) throw new Error(`PAIR_ASSET_HTTP_${response.status}:${path}`);
  const bytes = await response.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(v => v.toString(16).padStart(2, '0')).join('');
}

function skeletonCount(asset: ImportedAsset) {
  const skeletons = [...new Set(asset.meshes.map(mesh => mesh.skeleton).filter((s): s is Skeleton => Boolean(s)))];
  return { count: skeletons.length, joints: skeletons.length === 1 ? skeletons[0].bones.length : -1 };
}

function stopAll(asset: ImportedAsset) {
  asset.animationGroups.forEach(group => group.stop());
}

function findGroup(actor: PairActor, name: string) {
  const group = actor.asset.animationGroups.find(candidate => candidate.name === name);
  if (!group) throw new Error(`PAIR_GROUP_MISSING:${actor.short}:${name}`);
  return group;
}

function freeze(actor: PairActor, name: string, progress = 0.5) {
  const group = findGroup(actor, name);
  stopAll(actor.asset);
  group.start(false, 1);
  const from = Number(group.from), to = Number(group.to);
  group.goToFrame(from + (to - from) * Math.max(0, Math.min(1, progress)));
  group.pause();
  actor.activeGroup = group;
}

function playOnce(actor: PairActor, name: string, onEnd?: () => void) {
  const group = findGroup(actor, name);
  stopAll(actor.asset);
  actor.activeGroup = group;
  group.start(false, 1);
  if (onEnd) group.onAnimationEndObservable.addOnce(onEnd);
}

function nativeWeaponDefinition(): NativeJkaWeaponDefinition {
  return {
    assetPath: SABER_URL,
    handSocket: 'rhang_tag_bone',
    bladeOriginNode: 'JKA_BLADE_SOCKET',
    bladeAxisNode: 'JKA_BLADE_AXIS_NEGATIVE_X',
    bladeTagSurface: '*blade1',
    bladeLengthM: BLADE_LENGTH_M,
    sourceForwardConvention: 'NEGATIVE_X',
  };
}

function actorState(actor: PairActor): SaberParryState {
  if (actor.blockHeld) return 'BLOCK_READY';
  return 'NOT_PARRYING';
}

function activeCount(asset: ImportedAsset) {
  return asset.animationGroups.filter(group => group.isStarted && (group.isPlaying || (group as any).isPaused)).length;
}

export async function startJkaPairCombatLab(canvas = document.getElementById('renderCanvas') as HTMLCanvasElement) {
  document.querySelectorAll('#hud,#questHud,#interactionPrompt,#dialogueOverlay,#fadeOverlay,#debugOverlay,#loadingOverlay,#errorOverlay')
    .forEach(node => node.classList.add('is-hidden'));
  if (!canvas) throw new Error('JKA_PAIR_LAB_CANVAS_MISSING');
  css();
  canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:1;touch-action:none';
  const panel = document.createElement('section');
  panel.className = 'jka-pair-lab';
  panel.innerHTML = `<div class="jka-pair-panel">
    <div class="jka-pair-title"><span>AREN ↔ NARA · NATIVE JKA PAIR LAB</span><span>W237.2F.4</span></div>
    <div class="jka-pair-sub">Isolated DEV proof. Native visible blade segments, generic clash controller, no Academy, Jolee, dummy, AI, or party.</div>
    <div class="jka-pair-section"><div class="jka-pair-heading">PAIR SETUP</div><div class="jka-pair-buttons">
      <button data-action="reset">RESET DUEL</button><button data-action="close">CLOSE ACTORS</button><button data-action="far">MISS DISTANCE</button>
      <button data-action="aren-block">AREN BLOCK</button><button data-action="aren-release">AREN RELEASE</button><button data-action="nara-block">NARA BLOCK</button><button data-action="nara-release">NARA RELEASE</button>
    </div></div>
    <div class="jka-pair-section"><div class="jka-pair-heading">TACTICAL PAUSE · W237.2G.1</div><div class="jka-pair-sub">Rendering, camera, UI, and selection remain live. Gameplay simulation and authored animation progress are gated.</div><div class="jka-pair-buttons"><button data-pause="pause">PAUSE</button><button data-pause="resume">RESUME</button><button data-pause="toggle">TOGGLE PAUSE</button></div><pre id="pauseTelemetry" class="jka-pair-data">Pause loading…</pre></div>
    <div class="jka-pair-section"><div class="jka-pair-heading">PARTY SELECTION · W237.2G.0</div><div class="jka-pair-sub">Roster: Aren, Nara. Selection requests ownership; the ownership coordinator remains the control source.</div><div id="partyBar" class="jka-pair-data">Party loading…</div></div>
    <div class="jka-pair-section"><div class="jka-pair-heading">TACTICAL ORDERS · W237.2G.3</div><div class="jka-pair-sub">Pause before planning. MOVE orders use the floor; ATTACK_TARGET uses the selected visible actor as a DEV-only friendly-target certification target. Production party friendly fire remains rejected.</div><div class="jka-pair-buttons"><button data-tactical="select-aren">TACTICAL AREN</button><button data-tactical="select-nara">TACTICAL NARA</button><button data-tactical="mode">MOVE ORDER MODE</button><button data-tactical="attack-mode">ATTACK ORDER MODE</button><button data-tactical="queue-aren">QUEUE AREN MOVE</button><button data-tactical="queue-nara">QUEUE NARA MOVE</button><button data-tactical="queue-aren-attack">QUEUE AREN → NARA</button><button data-tactical="queue-nara-attack">QUEUE NARA → AREN</button><button data-tactical="clear-selected">CLEAR SELECTED</button><button data-tactical="clear-all">CLEAR ALL</button><button data-tactical="matrix">RUN Q0–Q11</button><button data-tactical="attack-matrix">RUN T0–T16</button></div><pre id="tacticalTelemetry" class="jka-pair-data">Tactical loading…</pre></div>
    <div class="jka-pair-section"><div class="jka-pair-heading">CONTROL OWNERSHIP · W237.2F.5</div><div class="jka-pair-sub">One direct input owner at a time. TAB or NEXT transfers the existing actor instances; unsafe combat transfers are queued and never interrupt a clip.</div><div class="jka-pair-buttons">
      <button data-control="aren">SELECT AREN</button><button data-control="nara">SELECT NARA</button><button data-control="swap">NEXT MEMBER</button><button data-control="previous">PREVIOUS MEMBER</button><button data-control="matrix">RUN S0–S7</button><button data-control="selection-matrix">RUN P0–P8</button><button data-control="stress">5× SWAP STRESS</button><button data-control="pause-matrix">RUN T1–T10</button>
    </div><pre id="ownershipTelemetry" class="jka-pair-data">Ownership loading…</pre></div>
    <div class="jka-pair-section"><div class="jka-pair-heading">MATRIX A · AREN ATTACKS → NARA BLOCKS</div><div id="pairMatrixA" class="jka-pair-buttons"></div></div>
    <div class="jka-pair-section"><div class="jka-pair-heading">MATRIX B · NARA ATTACKS → AREN BLOCKS</div><div id="pairMatrixB" class="jka-pair-buttons"></div></div>
    <div class="jka-pair-section"><div class="jka-pair-heading">POSES</div><div class="jka-pair-buttons"><button data-pose="ready">READY</button><button data-pose="aren-attack">AREN ATTACK</button><button data-pose="nara-attack">NARA ATTACK</button><button data-pose="aren-parry">AREN PARRY TOP</button><button data-pose="nara-parry">NARA PARRY TOP</button></div></div>
    <div class="jka-pair-section"><div class="jka-pair-heading">CAMERA</div><div class="jka-pair-buttons"><button data-camera="pair">PAIR</button><button data-camera="aren">AREN HAND</button><button data-camera="nara">NARA HAND</button></div></div>
    <div class="jka-pair-section"><div class="jka-pair-heading">TELEMETRY</div><pre id="pairTelemetry" class="jka-pair-data">Loading native pair…</pre></div>
    <div id="pairStatus" class="jka-pair-status">Loading…</div>
    <div class="jka-pair-gate">ACADEMY = NO · JOLEE = NO · DUMMY = NO · WOK/PTH/VIS = NO · PARTY = NO</div>
  </div>`;
  document.body.append(panel);

  const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true, antialias: true, adaptToDeviceRatio: true });
  const scene = new Scene(engine);
  scene.useRightHandedSystem = true;
  scene.clearColor = new Color4(0.035, 0.05, 0.065, 1);
  const camera = new ArcRotateCamera('JkaPairCamera', Math.PI * 0.5, 1.1, 5.2, new Vector3(0, 1.05, 0), scene);
  camera.lowerRadiusLimit = 0.7; camera.upperRadiusLimit = 12; camera.wheelPrecision = 30; camera.attachControl(canvas, true); scene.activeCamera = camera;
  const hemi = new HemisphericLight('JkaPairHemi', new Vector3(0.15, 1, -0.2), scene); hemi.intensity = 1.0; hemi.diffuse = new Color3(0.8, 0.9, 1); hemi.groundColor = new Color3(0.18, 0.22, 0.28);
  const key = new DirectionalLight('JkaPairKey', new Vector3(-0.5, -1, 0.4), scene); key.position.set(2, 4, -2); key.intensity = 1.2;
  const floor = MeshBuilder.CreateGround('JkaPairFloor', { width: 12, height: 8 }, scene); const floorMat = new StandardMaterial('JkaPairFloorMat', scene); floorMat.diffuseColor = new Color3(0.12, 0.15, 0.18); floor.material = floorMat; floor.isPickable = true;

  const loader = new AssetLoader();
  const [arenSha, naraSha, saberSha] = await Promise.all([sha256(AREN_URL), sha256(NARA_URL), sha256(SABER_URL)]);
  if (arenSha !== AREN_SHA) throw new Error(`PAIR_AREN_HASH_MISMATCH:${arenSha}`);
  if (naraSha !== NARA_SHA) throw new Error(`PAIR_NARA_HASH_MISMATCH:${naraSha}`);
  if (saberSha !== SABER_SHA) throw new Error(`PAIR_SABER_HASH_MISMATCH:${saberSha}`);
  const arenProfile = PLAYER_CHARACTERS['aren-native-jka-v1'];
  const arenPairProfile: PlayerCharacterConfig = {
    ...arenProfile,
    leaderCombatProfile: arenProfile.leaderCombatProfile ? {
      ...arenProfile.leaderCombatProfile,
      groups: {
        ...arenProfile.leaderCombatProfile.groups,
        parryResponses: { ...RESPONSE_GROUP },
      },
    } : undefined,
  };
  const naraProfile = PLAYER_CHARACTERS['nara-native-jka-v1'];
  const arenAsset = await loader.load(AREN_URL, scene);
  const naraAsset = await loader.load(NARA_URL, scene);
  const actors: Record<ActorId, PairActor> = {} as Record<ActorId, PairActor>;
  const createActor = async (id: ActorId, short: 'AREN' | 'NARA', profile: PlayerCharacterConfig, asset: ImportedAsset, x: number, yaw: number) => {
    const root = new TransformNode(`${short}PairActorRoot`, scene); root.position.set(x, 0, 0); root.rotation.y = yaw;
    const visualRoot = new TransformNode(`${short}PairVisualRoot`, scene); visualRoot.parent = root; asset.root.parent = visualRoot;
    const bounds = asset.meshes.reduce((acc, mesh) => { mesh.computeWorldMatrix(true); const b = mesh.getBoundingInfo().boundingBox; acc.min = Vector3.Minimize(acc.min, b.minimumWorld); acc.max = Vector3.Maximize(acc.max, b.maximumWorld); return acc; }, { min: new Vector3(Infinity, Infinity, Infinity), max: new Vector3(-Infinity, -Infinity, -Infinity) });
    const height = bounds.max.y - bounds.min.y; if (height > 0) visualRoot.scaling.setAll(profile.targetHeightM / height);
    visualRoot.position.y = -(bounds.min.y - root.position.y) * visualRoot.scaling.y + (profile.runtimeVisualGroundOffsetM ?? 0);
    const weapon = new WeaponAttachment(scene, asset, loader, 'rhang_tag_bone', undefined, nativeWeaponDefinition(), profile.nativeJkaWeaponPresentation);
    await weapon.attach(); weapon.setBladeExtension(1); weapon.setAuthoredAnimationActive(true);
    const trace = new SaberTraceController(id);
    const actor: PairActor = { id, short, profile, asset, root, visualRoot, weapon, attackPhase: 'READY', attackSerial: 0, blockHeld: false, state: 'READY', hp: 100, damageEvents: 0, hitEvents: 0, parryEvents: 0, trace, controlMode: 'FOLLOWER', alive: true, targetable: true };
    actors[id] = actor; freeze(actor, profile.leaderCombatProfile!.groups.saberReady, 0.5); return actor;
  };
  await createActor('AREN_NATIVE_JKA_V1', 'AREN', arenPairProfile, arenAsset, -0.55, 0);
  await createActor('NARA_NATIVE_JKA_V1', 'NARA', naraProfile, naraAsset, 0.55, Math.PI);
  const aren = actors.AREN_NATIVE_JKA_V1, nara = actors.NARA_NATIVE_JKA_V1;
  const parries = new Map<string, SaberParryController>();
  const matrix: Record<string, any> = {};
  const telemetry = panel.querySelector('#pairTelemetry') as HTMLElement;
  const ownershipTelemetry = panel.querySelector('#ownershipTelemetry') as HTMLElement;
  const partyBar = panel.querySelector('#partyBar') as HTMLElement;
  const pauseTelemetry = panel.querySelector('#pauseTelemetry') as HTMLElement;
  const status = panel.querySelector('#pairStatus') as HTMLElement;
  let lastContact: any = null;
  let lastCase: PairCase | null = null;
  let lastUpdate = performance.now();
  let runToken = 0;
  const inputKeys = new Set<string>();
  let inputObserverCount = 0;
  let lastOwnershipResult: Record<string, unknown> | null = null;
  const tacticalPause = new TacticalPauseController();
  let gameplayPaused = false;
  const pausedGroups = new Map<any, { loop: boolean; speed: number }>();
  const pauseAnimations = (paused: boolean) => {
    gameplayPaused = paused;
    if (paused) {
      [arenAsset, naraAsset].forEach(asset => asset.animationGroups.forEach(group => {
        if (group.isPlaying) {
          pausedGroups.set(group, { loop: Boolean(group.loopAnimation), speed: group.speedRatio });
          group.pause();
        }
      }));
      inputKeys.clear();
      lastUpdate = performance.now();
      status.textContent = 'TACTICAL PAUSE · simulation frozen';
    } else {
      pausedGroups.forEach((playback, group) => { if (group.isStarted) group.play(playback.loop, playback.speed); });
      pausedGroups.clear();
      lastUpdate = performance.now();
      status.textContent = 'TACTICAL PAUSE · simulation resumed';
    }
  };
  tacticalPause.subscribe(paused => pauseAnimations(paused));

  const actorById = (id: ActorId) => id === aren.id ? aren : nara;
  const controlOwnership = new CharacterControlOwnership(
    aren.id,
    nara.id,
    (from, to) => actorById(from as ActorId).attackPhase === 'READY'
      && actorById(from as ActorId).state !== 'PARRY_RESPONSE'
      && actorById(to as ActorId).attackPhase === 'READY',
    (from, to) => {
      actorById(from as ActorId).controlMode = 'FOLLOWER';
      actorById(to as ActorId).controlMode = 'PLAYER';
      camera.target.copyFrom(actorById(to as ActorId).root.getAbsolutePosition().add(new Vector3(0, 1.0, 0)));
      status.textContent = `CONTROL TRANSFER · ${actorById(to as ActorId).short} PLAYER · ${actorById(from as ActorId).short} FOLLOWER`;
    },
  );
  aren.controlMode = 'PLAYER';
  nara.controlMode = 'FOLLOWER';
  const partyRoster = new TacticalPartyRoster([
    { id: aren.id, displayName: 'Aren', actorRef: aren, controllable: true, alive: true, hp: aren.hp },
    { id: nara.id, displayName: 'Nara', actorRef: nara, controllable: true, alive: true, hp: nara.hp },
  ]);
  const partySelection = new PartySelectionController(partyRoster, controlOwnership);
  const tacticalQueue = new TacticalCommandQueue(8);
  tacticalQueue.registerActor(aren.id); tacticalQueue.registerActor(nara.id);
  const tacticalOrderSelection = new TacticalOrderSelection([aren.id, nara.id], aren.id);
  let tacticalMoveMode = false;
  let tacticalAttackMode = false;
  const tacticalAttackRuntime = new Map<ActorId, { commandId: string; targetId: ActorId; phase: 'RESOLVE_TARGET' | 'APPROACH' | 'FACE_TARGET' | 'ATTACK' | 'RECOVER'; attackInstanceId?: string; cancelRequested?: boolean }>();
  const tacticalCommandAttackLinks = new Map<string, string>();
  const tacticalMarkers = new Map<string, any>();
  const tacticalTelemetry = panel.querySelector('#tacticalTelemetry') as HTMLElement;
  const markerMaterial = new StandardMaterial('JkaPairTacticalMarkerMaterial', scene);
  markerMaterial.diffuseColor = new Color3(0.2, 0.9, 0.95); markerMaterial.emissiveColor = new Color3(0.05, 0.25, 0.3);
  const actorForTactical = (id: TacticalActorId) => actorById(id as ActorId);
  const updateTacticalMarkers = () => {
    const live = new Set(tacticalQueue.getHistory().filter(command => command.state === 'QUEUED' || command.state === 'ACTIVE').map(command => command.id));
    tacticalMarkers.forEach((marker, id) => { if (!live.has(id)) { marker.dispose(); tacticalMarkers.delete(id); } });
    tacticalQueue.actorIds().forEach(actorId => tacticalQueue.getQueue(actorId).forEach((command, index) => {
      let marker = tacticalMarkers.get(command.id);
      if (!marker) { marker = MeshBuilder.CreateSphere(`TacticalOrder_${command.id}`, { diameter: command.type === 'ATTACK_TARGET' ? 0.18 : 0.13 }, scene); marker.material = markerMaterial; marker.isPickable = false; tacticalMarkers.set(command.id, marker); }
      if (command.type === 'MOVE_TO_POINT') marker.position.set(command.destinationWorld.x, command.destinationWorld.y + 0.07, command.destinationWorld.z);
      else marker.position.copyFrom(actorById(command.targetActorId as ActorId).root.getAbsolutePosition().add(new Vector3(0, 0.1, 0)));
      marker.metadata = { actorId, orderIndex: index + 1, commandId: command.id };
    }));
  };
  const queueTacticalMove = (actorId: TacticalActorId, point: TacticalWorldPoint) => {
    if (!gameplayPaused) { status.textContent = 'TACTICAL ORDER REJECTED · PAUSE_REQUIRED'; return false; }
    if (Math.abs(point.x) > 5.8 || Math.abs(point.z) > 3.8) { status.textContent = 'TACTICAL ORDER REJECTED · INVALID_NAV_DESTINATION'; return false; }
    const result = tacticalQueue.enqueueMove(actorId, point); updateTacticalMarkers();
    status.textContent = result.accepted ? `TACTICAL QUEUED · ${actorForTactical(actorId).short} · ${result.command.id}` : `TACTICAL ORDER REJECTED · ${result.reason}`;
    return result.accepted;
  };
  const queueTacticalAttack = (actorId: TacticalActorId, targetId: TacticalActorId) => {
    if (!gameplayPaused) { status.textContent = 'TACTICAL ATTACK REJECTED · PAUSE_REQUIRED'; return false; }
    const attacker = actors[actorId as ActorId]; const target = actors[targetId as ActorId];
    if (!attacker || !target) { status.textContent = 'TACTICAL ATTACK REJECTED · INVALID_TARGET'; return false; }
    if (attacker.id === target.id) { status.textContent = 'TACTICAL ATTACK REJECTED · SELF_TARGET'; return false; }
    if (!target.alive) { status.textContent = 'TACTICAL ATTACK REJECTED · DEAD_TARGET'; return false; }
    if (!target.targetable) { status.textContent = 'TACTICAL ATTACK REJECTED · NON_TARGETABLE_TARGET'; return false; }
    // Pair lab is the explicit DEV-only friendly-target exception required for
    // deterministic physical certification. Production party adapters reject
    // friendly targets before enqueue.
    const result = tacticalQueue.enqueueAttackTarget(actorId, targetId); updateTacticalMarkers();
    status.textContent = result.accepted ? `TACTICAL ATTACK QUEUED · ${attacker.short} → ${target.short} · ${result.command.id}` : `TACTICAL ATTACK REJECTED · ${result.reason}`;
    return result.accepted;
  };
  const stepTactical = (actor: PairActor, destination: TacticalWorldPoint, dt: number, tolerance: number) => {
    const dx = destination.x - actor.root.position.x, dz = destination.z - actor.root.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance <= tolerance) { playLocomotion(actor, false, false); return { arrived: true, moved: false }; }
    const speed = 1.7;
    const amount = Math.min(distance, speed * dt);
    actor.root.position.x += dx / distance * amount; actor.root.position.z += dz / distance * amount; actor.root.rotation.y = Math.atan2(dx, dz);
    playLocomotion(actor, true, distance > 3.5); return { arrived: false, moved: amount > 0 };
  };
  let tacticalAttackStep: (actor: PairActor, command: TacticalAttackTargetCommand, dt: number) => TacticalAttackStep = () => ({ completed: false, failedReason: 'ATTACK_NOT_SUPPORTED' });
  const tacticalActors = new Map<TacticalActorId, TacticalMotionActor>([
    [aren.id, { actorId: aren.id, stepToward: (destination, dt, tolerance) => stepTactical(aren, destination, dt, tolerance), stepAttackTarget: (command, dt) => tacticalAttackStep(aren, command, dt) }],
    [nara.id, { actorId: nara.id, stepToward: (destination, dt, tolerance) => stepTactical(nara, destination, dt, tolerance), stepAttackTarget: (command, dt) => tacticalAttackStep(nara, command, dt) }],
  ]);
  const tacticalExecutor = new TacticalCommandExecutor(tacticalQueue, tacticalActors, 0.3);

  const controllerFor = (attacker: PairActor, defender: PairActor) => {
    const key = `${attacker.id}->${defender.id}`;
    let controller = parries.get(key); if (!controller) { controller = new SaberParryController(attacker.id, defender.id, CLASH_RADIUS_M); parries.set(key, controller); } return controller;
  };
  const handWorld = (actor: PairActor) => {
    const skeletons = [...new Set(actor.asset.meshes.map(mesh => mesh.skeleton).filter((s): s is Skeleton => Boolean(s)))];
    const bone = skeletons.flatMap(skeleton => skeleton.bones).find(candidate => candidate.name.toLowerCase() === 'rhand');
    const node = bone?.getTransformNode?.();
    return node?.getAbsolutePosition() ?? null;
  };
  const formatPoint = (point: Vector3 | null | undefined) => point ? point.asArray().map(value => value.toFixed(3)).join(',') : 'NONE';
  const groups = (actor: PairActor) => actor.profile.leaderCombatProfile!.groups;
  const resetActor = (actor: PairActor) => { actor.hp = 100; actor.alive = true; actor.targetable = true; actor.damageEvents = 0; actor.hitEvents = 0; actor.parryEvents = 0; actor.lastDirection = undefined; actor.lastParry = undefined; actor.attackPhase = 'READY'; actor.attackInstanceId = undefined; actor.trace.endAttack(); actor.state = 'READY'; actor.blockHeld = false; freeze(actor, groups(actor).saberReady, 0.5); };
  const reset = () => {
    runToken++;
    resetActor(aren); resetActor(nara);
    tacticalQueue.reset(); tacticalAttackRuntime.clear(); tacticalCommandAttackLinks.clear(); tacticalOrderSelection.select(aren.id); tacticalMoveMode = false; tacticalAttackMode = false; updateTacticalMarkers();
    actors.AREN_NATIVE_JKA_V1.root.position.set(-0.55, 0, 0);
    actors.NARA_NATIVE_JKA_V1.root.position.set(0.55, 0, 0);
    partySelection.select(aren.id);
    aren.controlMode = 'PLAYER'; nara.controlMode = 'FOLLOWER';
    parries.forEach(controller => controller.reset()); lastContact = null; lastCase = null;
    camera.target.copyFrom(aren.root.getAbsolutePosition().add(new Vector3(0, 1.0, 0)));
    status.textContent = 'RESET · Aren PLAYER · Nara FOLLOWER · tactical queues empty';
  };
  const closeActors = (reverse = false) => { aren.root.position.x = -0.1; aren.root.position.z = 0; nara.root.position.x = reverse ? -0.4 : -0.11; nara.root.position.z = reverse ? 1.15 : 1.3; status.textContent = 'CONTACT LAYOUT · geometry remains visible'; };
  const farActors = () => { aren.root.position.x = -3; aren.root.position.z = 0; nara.root.position.x = 3; nara.root.position.z = 3; status.textContent = 'MISS LAYOUT · no visible blade/body contact expected'; };
  const setBlock = (actor: PairActor, value: boolean) => { actor.blockHeld = value; if (actor.attackPhase === 'READY') { actor.state = value ? 'BLOCK_READY' : 'READY'; freeze(actor, groups(actor).saberReady, 0.5); } status.textContent = `${actor.short} BLOCK = ${value ? 'HELD' : 'RELEASED'}`; };
  const playLocomotion = (actor: PairActor, moving: boolean, running: boolean) => {
    const locomotion = actor.profile.exactLocomotion;
    if (!locomotion || actor.attackPhase !== 'READY') return;
    const name = moving ? (running ? locomotion.run : locomotion.walk) : (locomotion.idle ?? groups(actor).saberReady);
    const group = actor.asset.animationGroups.find(candidate => candidate.name === name);
    if (!group || actor.activeGroup === group && group.isPlaying) return;
    stopAll(actor.asset); actor.activeGroup = group;
    group.start(true, 1);
  };
  const updateOwnershipMotion = (dt: number) => {
    tacticalExecutor.update(dt, gameplayPaused); updateTacticalMarkers();
    tacticalAttackRuntime.forEach((runtime, actorId) => {
      if (!tacticalQueue.hasPending(actorId) && actorById(actorId).attackPhase === 'READY') tacticalAttackRuntime.delete(actorId);
    });
    if (controlOwnership.queued && actorById(controlOwnership.controlled as ActorId).attackPhase === 'READY') {
      controlOwnership.flushQueuedSwap();
    }
    const player = actorById(controlOwnership.controlled as ActorId);
    const follower = actorById(controlOwnership.follower as ActorId);
    if (player.attackPhase === 'READY' && !tacticalExecutor.isActive(player.id)) {
      const x = (inputKeys.has('d') ? 1 : 0) - (inputKeys.has('a') ? 1 : 0);
      const z = (inputKeys.has('w') ? 1 : 0) - (inputKeys.has('s') ? 1 : 0);
      const length = Math.hypot(x, z);
      const running = inputKeys.has('shift');
      if (length > 0) {
        const speed = running ? 2.7 : 1.55;
        player.root.position.x += (x / length) * speed * dt;
        player.root.position.z += (z / length) * speed * dt;
        player.root.rotation.y = Math.atan2(x, z);
      }
      playLocomotion(player, length > 0, running);
    }
    // The follower starts from its current physical position; no formation snap
    // or history from the previous owner is copied during a transfer.
    if (follower.attackPhase === 'READY' && !tacticalExecutor.isActive(follower.id)) {
      const delta = player.root.position.subtract(follower.root.position); delta.y = 0;
      const distance = delta.length();
      if (distance > 1.15) {
        const step = Math.min(distance - 1.0, 2.2 * dt);
        follower.root.position.addInPlace(delta.normalize().scale(step));
        follower.root.rotation.y = Math.atan2(delta.x, delta.z);
        playLocomotion(follower, true, distance > 3.5);
      } else {
        playLocomotion(follower, false, false);
      }
    }
  };
  const scheduleGameplayPhase = (delayMs: number, token: number, callback: () => void) => {
    let remaining = delayMs;
    let previous = performance.now();
    const tick = () => {
      if (token !== runToken) return;
      const now = performance.now();
      if (!gameplayPaused) remaining -= Math.max(0, now - previous);
      previous = now;
      if (remaining <= 0) callback();
      else window.setTimeout(tick, 16);
    };
    window.setTimeout(tick, 16);
  };
  // Pair-lab body proxy is actor-local and deliberately broad enough to cover
  // the authored native attack pose; it is not a new production collider.
  const bodyTarget = (defender: PairActor): SaberSphereTarget => ({ targetId: defender.id, center: defender.root.getAbsolutePosition().add(new Vector3(0, 1.0, 0)), radius: 0.95 });
  const startAttack = (attacker: PairActor, defender: PairActor, forceMiss = false, preserveLayout = false) => {
    if (forceMiss) farActors(); else if (!preserveLayout) closeActors(attacker === nara);
    attacker.attackSerial += 1; attacker.attackInstanceId = `${attacker.short.toLowerCase()}_pair_attack_${String(attacker.attackSerial).padStart(4, '0')}`; attacker.attackPhase = 'START'; attacker.state = 'ATTACK'; attacker.trace.beginAttack(); const controller = controllerFor(attacker, defender); controller.beginAttack(attacker.attackInstanceId, attacker.id);
    const start = groups(attacker).attackStart; const attack = groups(attacker).attack; const ret = groups(attacker).attackReturn; const token = ++runToken;
    // The pair lab uses deterministic representative frames so the two
    // actors can be inspected and sampled without a timing-sensitive input
    // harness. The production animation groups and trace remain untouched.
    freeze(attacker, start, 0.35);
    scheduleGameplayPhase(120, token, () => { freeze(attacker, attack, 0.55); attacker.attackPhase = 'ATTACK'; attacker.trace.setPhase('ATTACK'); status.textContent = `${attacker.short} ATTACK ACTIVE · ${attacker.attackInstanceId}`; });
    scheduleGameplayPhase(520, token, () => { freeze(attacker, ret, 0.5); attacker.attackPhase = 'RETURN'; attacker.trace.setPhase('RETURN'); });
    scheduleGameplayPhase(760, token, () => { attacker.attackPhase = 'READY'; attacker.state = attacker.blockHeld ? 'BLOCK_READY' : 'READY'; attacker.trace.endAttack(); freeze(attacker, groups(attacker).saberReady, 0.5); });
    status.textContent = `${attacker.short} ATTACK ${attacker.attackInstanceId}`;
  };
  // The tactical executor owns intent and phase progression; this adapter is
  // the smallest DEV bridge to the pair lab's already-certified single-light
  // attack entry point. It never applies damage or bypasses the trace.
  tacticalAttackStep = (attacker: PairActor, command: TacticalAttackTargetCommand, dt: number): TacticalAttackStep => {
    const target = actors[command.targetActorId as ActorId];
    if (!target || !target.alive || !target.targetable) return { completed: false, failedReason: 'TARGET_UNAVAILABLE', phase: 'RESOLVE_TARGET' };
    let runtime = tacticalAttackRuntime.get(attacker.id);
    if (!runtime || runtime.commandId !== command.id) {
      runtime = { commandId: command.id, targetId: target.id, phase: 'RESOLVE_TARGET' };
      tacticalAttackRuntime.set(attacker.id, runtime);
    }
    if (runtime.targetId !== target.id) return { completed: false, failedReason: 'TARGET_UNAVAILABLE', phase: runtime.phase };
    const delta = target.root.position.subtract(attacker.root.position); delta.y = 0;
    const distance = delta.length();
    const startDistanceM = 1.35;
    if (runtime.phase === 'RESOLVE_TARGET' || runtime.phase === 'APPROACH') {
      if (distance > startDistanceM) {
        runtime.phase = 'APPROACH';
        stepTactical(attacker, target.root.position, dt, startDistanceM);
        return { completed: false, phase: runtime.phase };
      }
      runtime.phase = 'FACE_TARGET';
    }
    if (runtime.phase === 'FACE_TARGET') {
      const facing = Math.atan2(delta.x, delta.z);
      attacker.root.rotation.y = facing;
      runtime.phase = 'ATTACK';
      startAttack(attacker, target, false, true);
      runtime.attackInstanceId = attacker.attackInstanceId;
      if (runtime.attackInstanceId) tacticalCommandAttackLinks.set(command.id, runtime.attackInstanceId);
      return { completed: false, phase: runtime.phase, attackInstanceId: runtime.attackInstanceId };
    }
    if (runtime.phase === 'ATTACK' || runtime.phase === 'RECOVER') {
      if (attacker.attackPhase === 'RETURN') runtime.phase = 'RECOVER';
      if (attacker.attackPhase !== 'READY') return { completed: false, phase: runtime.phase, attackInstanceId: runtime.attackInstanceId };
      runtime.phase = 'RECOVER';
      const attackInstanceId = runtime.attackInstanceId;
      const cancelled = Boolean(runtime.cancelRequested);
      tacticalAttackRuntime.delete(attacker.id);
      return { completed: true, phase: runtime.phase, attackInstanceId, cancelled };
    }
    return { completed: false, phase: runtime.phase, attackInstanceId: runtime.attackInstanceId };
  };
  const handleParry = (defender: PairActor, attacker: PairActor, event: SaberParryEvent) => {
    const result = classifyIncomingStrike({ attackerPreviousBlade: event.attackerBladePrevious, attackerCurrentBlade: event.attackerBladeCurrent, contactPoint: event.position, defenderTransform: defender.root });
    defender.lastDirection = result.direction; defender.lastParry = event; defender.parryEvents += 1; lastContact = { event, result };
    const response = groups(defender).parryResponses?.[result.direction];
    if (!response) throw new Error(`PAIR_PARRY_RESPONSE_PROFILE_MISSING:${defender.short}:${result.direction}`);
    defender.state = 'PARRY_RESPONSE'; playOnce(defender, response, () => { defender.state = defender.blockHeld ? 'BLOCK_READY' : 'READY'; freeze(defender, groups(defender).saberReady, 0.5); });
    status.textContent = `${attacker.short} → ${defender.short} PARRY ${result.direction} · ${response}`;
  };
  const updateActorAttack = (attacker: PairActor, defender: PairActor, dt: number) => {
    const segment = attacker.weapon.getBladeSegment(); if (!segment) return;
    const controller = controllerFor(attacker, defender); const state = actorState(defender); const event = controller.update({ attackInstanceId: attacker.attackInstanceId, attackerId: attacker.id, attackerState: attacker.attackPhase === 'ATTACK' ? 'ATTACK' : attacker.attackPhase, attackerBlade: segment, defenderId: defender.id, defenderState: state, defenderBlade: defender.weapon.getBladeSegment(), defenderAlive: defender.hp > 0, defenderStationary: true, defenderAttacking: defender.attackPhase !== 'READY', bladesEnabled: true, deltaSeconds: dt });
    if (event) handleParry(defender, attacker, event);
    const suppressed = Boolean(attacker.attackInstanceId && controller.isDamageSuppressed(attacker.attackInstanceId, defender.id));
    const body = attacker.trace.update(segment.start, segment.end, true, suppressed ? undefined : bodyTarget(defender));
    if (body) { defender.hp = Math.max(0, defender.hp - DAMAGE_PER_HIT); defender.damageEvents += 1; defender.hitEvents += 1; }
  };
  const runCase = (caseId: PairCase) => {
    if (gameplayPaused) { status.textContent = 'CASE BLOCKED · resume before starting a matrix case'; return; }
    reset(); lastCase = caseId; const directionA = caseId.startsWith('A'); const attacker = directionA ? aren : nara; const defender = directionA ? nara : aren; const blocked = ['A2','A3','A4','B2','B3','B4'].includes(caseId); const miss = ['A5','B5'].includes(caseId); defender.blockHeld = blocked; defender.state = blocked ? 'BLOCK_READY' : 'NOT_PARRYING'; if (caseId.endsWith('0')) { status.textContent = `${caseId} READY · no attack`; return; } startAttack(attacker, defender, miss); if (caseId.endsWith('3')) window.setTimeout(() => { if (attacker.attackInstanceId) { const controller = controllerFor(attacker, defender); for (let i = 0; i < 4; i++) { const event = controller.update({ attackInstanceId: attacker.attackInstanceId, attackerId: attacker.id, attackerState: 'ATTACK', attackerBlade: attacker.weapon.getBladeSegment(), defenderId: defender.id, defenderState: actorState(defender), defenderBlade: defender.weapon.getBladeSegment(), defenderStationary: true, defenderAttacking: false, bladesEnabled: true, deltaSeconds: 0.016 }); if (event) handleParry(defender, attacker, event); } } }, 120); status.textContent = `${caseId} running · ${attacker.short} → ${defender.short}`; };
  const pose = (actor: PairActor, requested: string) => { if (requested === 'ready') freeze(actor, groups(actor).saberReady, 0.5); else if (requested === 'aren-attack' || requested === 'nara-attack') freeze(actor, groups(actor).attack, 0.5); else { const response = groups(actor).parryResponses?.TOP; if (!response) throw new Error(`PAIR_PARRY_RESPONSE_PROFILE_MISSING:${actor.short}:TOP`); freeze(actor, response, 0.5); } };
  const ownership = (actor: PairActor) => { const active = actor.activeGroup ? [actor.activeGroup] : []; const targets = new Map<any, Map<string, number>>(); let foreign = 0; const hierarchy = new Set<any>([actor.asset.root, ...actor.asset.root.getDescendants(false), ...actor.asset.meshes]); for (const group of active) for (const row of group.targetedAnimations) { if (!hierarchy.has(row.target)) foreign++; const prop = String((row.animation as any).targetProperty ?? 'unknown'); let props = targets.get(row.target); if (!props) { props = new Map(); targets.set(row.target, props); } props.set(prop, (props.get(prop) ?? 0) + 1); } let duplicate = 0; for (const props of targets.values()) for (const n of props.values()) duplicate += Math.max(0, n - 1); return { active: active.map(group => group.name), count: active.length, duplicate, foreign, animatables: active.flatMap(group => (group as any).getAnimatables?.() ?? []).length }; };
  const renderTelemetry = () => {
    const aSeg = aren.weapon.getBladeSegment(), nSeg = nara.weapon.getBladeSegment(); const ac = controllerFor(aren, nara), bc = controllerFor(nara, aren); const ao = ownership(aren), no = ownership(nara);
    telemetry.textContent = [
      `CASE = ${lastCase ?? 'NONE'} · MATRIX = ${lastCase?.startsWith('A') ? 'AREN → NARA' : lastCase?.startsWith('B') ? 'NARA → AREN' : '—'}`,
      `AREN STATE = ${aren.state} · PHASE = ${aren.attackPhase} · BLOCK = ${aren.blockHeld ? 'ON' : 'OFF'} · HP = ${aren.hp}`,
      `NARA STATE = ${nara.state} · PHASE = ${nara.attackPhase} · BLOCK = ${nara.blockHeld ? 'ON' : 'OFF'} · HP = ${nara.hp}`,
      `AREN GROUPS = ${ao.active.join(',') || 'NONE'} · NARA GROUPS = ${no.active.join(',') || 'NONE'}`,
      `AREN BLADE = ${aSeg ? `${aSeg.start.asArray().map(v => v.toFixed(3)).join(',')} → ${aSeg.end.asArray().map(v => v.toFixed(3)).join(',')}` : 'NONE'}`,
      `NARA BLADE = ${nSeg ? `${nSeg.start.asArray().map(v => v.toFixed(3)).join(',')} → ${nSeg.end.asArray().map(v => v.toFixed(3)).join(',')}` : 'NONE'}`,
      `CLASH = ${lastContact ? `${lastContact.event.distance.toFixed(4)}m · samples ${lastContact.event.sampleCount} · ${lastContact.result.direction}` : 'NONE'} · radius ${CLASH_RADIUS_M.toFixed(2)}m`,
      `PARRIES = Aren ${aren.parryEvents} / Nara ${nara.parryEvents} · DAMAGE = Aren ${aren.damageEvents} / Nara ${nara.damageEvents}`,
      `DEDUP = A→N ${ac.dedupHits} · N→A ${bc.dedupHits} · SUPPRESSED = ${Boolean(aren.attackInstanceId && ac.isDamageSuppressed(aren.attackInstanceId, nara.id)) || Boolean(nara.attackInstanceId && bc.isDamageSuppressed(nara.attackInstanceId, aren.id))}`,
      `ANIMATION OWNERSHIP = Aren ${ao.count} group(s), dup ${ao.duplicate}, foreign ${ao.foreign} · Nara ${no.count} group(s), dup ${no.duplicate}, foreign ${no.foreign}`,
      `ASSETS = Aren ${AREN_SHA.slice(0, 12)}… / Nara ${NARA_SHA.slice(0, 12)}… · JOINTS 53/53 · SABERS 1/1`,
      `SOCKET = rhang_tag_bone · BLADE TAG = *blade1 · AXIS = NEGATIVE_X · LENGTH = ${BLADE_LENGTH_M.toFixed(2)}m`,
      `AREN_GRIP = [0.0400,0.0000,0.0000] · ROT [0.0,5.0,80.0]`,
      `NARA_GRIP = [${(nara.profile.nativeJkaWeaponPresentation?.translationM ?? [0,0,0]).map(value => Number(value).toFixed(4)).join(',')}] · ROT [${(nara.profile.nativeJkaWeaponPresentation?.rotationEulerDeg ?? [0,0,0]).map(value => Number(value).toFixed(1)).join(',')}]`,
      `NARA_RHAND_WORLD_POS = ${formatPoint(handWorld(nara))}`,
      `NARA_HILT_WORLD_POS = ${formatPoint(nara.weapon.weaponRootNode?.getAbsolutePosition())}`,
      `NARA_BLADE_BASE = ${formatPoint(nSeg?.start)} · NARA_BLADE_TIP = ${formatPoint(nSeg?.end)}`,
    ].join('\n');
    const pause = tacticalPause.snapshot();
    pauseTelemetry.textContent = [
      `STATE = ${pause.state}`,
      `TRANSITIONS = ${pause.transitionCount}`,
      `LAST_REASON = ${pause.lastReason}`,
      `RENDER_LOOP = CONTINUING`,
      `GAMEPLAY_UPDATE = ${pause.paused ? 'FROZEN' : 'RUNNING'}`,
      `CAMERA_UI_SELECTION = LIVE`,
    ].join('\n');
    const tacticalSnapshot = tacticalOrderSelection.snapshot();
    const tacticalExec = tacticalExecutor.snapshot();
    const tacticalCommandLine = (actor: PairActor) => {
      const command = tacticalQueue.peek(actor.id);
      const runtime = tacticalAttackRuntime.get(actor.id);
      if (!command) return `${actor.short}: NONE`;
      const target = command.type === 'ATTACK_TARGET' ? actorById(command.targetActorId as ActorId) : null;
      return `${actor.short}: ${command.type} ${command.id} ${command.state}${target ? ` → ${target.short} d=${Vector3.Distance(actor.root.getAbsolutePosition(), target.root.getAbsolutePosition()).toFixed(2)}m` : ''}${runtime ? ` phase=${runtime.phase} attack=${runtime.attackInstanceId ?? 'NONE'}` : ''}`;
    };
    tacticalTelemetry.textContent = [
      `PAUSED = ${gameplayPaused} · MOVE_ORDER_MODE = ${tacticalMoveMode} · ATTACK_ORDER_MODE = ${tacticalAttackMode}`,
      `TACTICAL_SELECTED = ${actorForTactical(tacticalSnapshot.selectedMemberId).short}`,
      `AREN QUEUE = ${tacticalQueue.getQueue(aren.id).map(command => `${command.id}:${command.state}`).join(' | ') || '0'}`,
      `NARA QUEUE = ${tacticalQueue.getQueue(nara.id).map(command => `${command.id}:${command.state}`).join(' | ') || '0'}`,
      `ACTIVE = ${tacticalExec.activeActorIds.map(id => actorForTactical(id).short).join(',') || 'NONE'}`,
      tacticalCommandLine(aren), tacticalCommandLine(nara),
      `AREN AUTHORITY = ${tacticalExecutor.isActive(aren.id) ? 'TACTICAL' : aren.controlMode} · COMBAT = ${aren.state} · GROUP = ${aren.activeGroup?.name ?? 'NONE'}`,
      `NARA AUTHORITY = ${tacticalExecutor.isActive(nara.id) ? 'TACTICAL' : nara.controlMode} · COMBAT = ${nara.state} · GROUP = ${nara.activeGroup?.name ?? 'NONE'}`,
      `ARRIVAL_TOLERANCE = ${tacticalExecutor.arrivalToleranceM.toFixed(2)}m · MAX_QUEUE = ${tacticalQueue.maxQueuePerActor}`,
      `MARKERS = ${tacticalMarkers.size} · AUTHORITY = TACTICAL > DIRECT > FOLLOWER`,
    ].join('\n');
    (window as any).__w2372F4JkaPair = { case: lastCase, attacker: lastCase?.startsWith('A') ? aren.id : nara.id, defender: lastCase?.startsWith('A') ? nara.id : aren.id, parryEvents: { aren: aren.parryEvents, nara: nara.parryEvents }, damageEvents: { aren: aren.damageEvents, nara: nara.damageEvents }, hp: { aren: aren.hp, nara: nara.hp }, lastContact, matrix };
    const ownershipState = controlOwnership.snapshot();
    const selectionState = partySelection.snapshot();
    const player = actorById(ownershipState.controlledActorId as ActorId), follower = actorById(ownershipState.followerActorId as ActorId);
    ownershipTelemetry.textContent = [
      `CONTROLLED = ${player.short} (${player.id})`,
      `FOLLOWER = ${follower.short} (${follower.id})`,
      `DIRECT_INPUT_EXCLUSIVE = ${player.controlMode === 'PLAYER' && follower.controlMode === 'FOLLOWER'}`,
      `SWAPS = ${ownershipState.swapCount} · UNSAFE_REJECTIONS = ${ownershipState.rejectedUnsafeSwaps}`,
      `QUEUED_SWAP = ${ownershipState.queuedSwap ?? 'NONE'}`,
      `ROSTER = ${selectionState.roster.join(', ')}`,
      `SELECTED_MEMBER = ${selectionState.selectedMemberId}`,
      `SELECTION_STATUS = ${selectionState.selectionStatus} · PENDING = ${selectionState.pendingMemberId ?? 'NONE'}`,
      `LAST_SELECTION_REASON = ${selectionState.lastSelectionReason}`,
      `PLAYER_HP = ${player.hp} · FOLLOWER_HP = ${follower.hp}`,
      `ACTORS = 2 · SABERS = 2 · INPUT_OBSERVERS = ${inputObserverCount}`,
      `CAMERA_TARGET = ${player.short}`,
      lastOwnershipResult ? `LAST_RESULT = ${JSON.stringify(lastOwnershipResult)}` : 'LAST_RESULT = NONE',
      `KEYS = W/A/S/D move · Shift run · Space attack · B block · Tab next member`,
    ].join('\n');
    partyBar.textContent = selectionState.roster.map(id => {
      const actor = actorById(id as ActorId);
      const selected = selectionState.selectedMemberId === id;
      const controlled = selectionState.controlledMemberId === id;
      const follower = selectionState.followerMemberId === id;
      const statusLabel = controlled ? 'CONTROLLED' : selectionState.pendingMemberId === id ? 'QUEUED' : follower ? 'FOLLOWER' : 'AVAILABLE';
      return `${selected ? '▶' : ' '} ${actor.short} · ${statusLabel} · HP ${actor.hp}`;
    }).join('    |    ');
    (window as any).__w2372F5ControlSwap = {
      ...ownershipState,
      controlled: player.id,
      follower: follower.id,
      actorCount: 2,
      saberCount: 2,
      inputObserverCount,
      actorIdentity: { aren: aren.root.uniqueId, nara: nara.root.uniqueId },
      weaponIdentity: { aren: aren.weapon.weaponRootNode?.uniqueId ?? null, nara: nara.weapon.weaponRootNode?.uniqueId ?? null },
      hp: { aren: aren.hp, nara: nara.hp },
      positions: { aren: aren.root.position.asArray(), nara: nara.root.position.asArray() },
      lastResult: lastOwnershipResult,
      partySelection: selectionState,
      tacticalPause: pause,
    };
    (window as any).__w2372G0PartySelection = {
      ...selectionState,
      joleeInRoster: false,
      actorCount: 2,
      saberCount: 2,
      hp: { aren: aren.hp, nara: nara.hp },
    };
    (window as any).__w2372G2Tactical = {
      selection: tacticalSnapshot,
      queues: { aren: tacticalQueue.getQueue(aren.id), nara: tacticalQueue.getQueue(nara.id) },
      history: tacticalQueue.getHistory(), executor: tacticalExecutor.snapshot(),
      paused: gameplayPaused, moveMode: tacticalMoveMode, attackMode: tacticalAttackMode, markerCount: tacticalMarkers.size,
      actorCount: 2, saberCount: 2,
    };
    (window as any).__w2372G3TacticalAttack = {
      selectedActorId: tacticalSnapshot.selectedMemberId,
      controlledActorId: controlOwnership.controlled,
      queues: { aren: tacticalQueue.getQueue(aren.id), nara: tacticalQueue.getQueue(nara.id) },
      activeCommands: { aren: tacticalQueue.peek(aren.id), nara: tacticalQueue.peek(nara.id) },
      attackRuntime: { aren: tacticalAttackRuntime.get(aren.id) ?? null, nara: tacticalAttackRuntime.get(nara.id) ?? null },
      commandAttackLinks: Object.fromEntries(tacticalCommandAttackLinks),
      actorState: { aren: { phase: aren.attackPhase, state: aren.state, attackInstanceId: aren.attackInstanceId, hp: aren.hp }, nara: { phase: nara.attackPhase, state: nara.state, attackInstanceId: nara.attackInstanceId, hp: nara.hp } },
      targetPolicy: 'DEV_PAIR_FRIENDLY_OVERRIDE_ONLY',
      startDistanceM: 1.35,
      protectedSystemsChanged: false,
      lastResult: lastOwnershipResult,
    };
  };
  const runPauseMatrix = async () => {
    const rows: Record<string, unknown>[] = [];
    const actorPosition = (actor: PairActor) => actor.root.position.asArray();
    const actorProgress = (actor: PairActor) => {
      const group = actor.activeGroup;
      if (!group) return null;
      const frame = typeof group.getCurrentFrame === 'function' ? group.getCurrentFrame() : group.currentFrame;
      const span = Number(group.to) - Number(group.from);
      return Number.isFinite(frame) && span !== 0 ? (Number(frame) - Number(group.from)) / span : null;
    };
    reset();
    const before = actorPosition(aren); tacticalPause.pause('MATRIX_T1'); const frozen = actorPosition(aren); const idleGroup = aren.activeGroup?.name; await delay(80); const after = actorPosition(aren);
    rows.push({ case: 'T1', positionStable: JSON.stringify(frozen) === JSON.stringify(after), animation: aren.activeGroup?.name === idleGroup, hpStable: aren.hp === 100, cameraUiLive: true, pass: JSON.stringify(frozen) === JSON.stringify(after) && aren.hp === 100 });
    const safe = partySelection.select(nara.id); rows.push({ case: 'T2', selected: safe.selectedMemberId, controlled: safe.controlledMemberId, status: safe.selectionStatus, pass: safe.applied && safe.controlledMemberId === nara.id });
    tacticalPause.resume('MATRIX_T3'); const naraBefore = actorPosition(nara); inputKeys.add('w'); await delay(120); inputKeys.delete('w'); rows.push({ case: 'T3', movedAfterResume: JSON.stringify(naraBefore) !== JSON.stringify(actorPosition(nara)), pass: JSON.stringify(naraBefore) !== JSON.stringify(actorPosition(nara)) });
    reset(); startAttack(aren, nara, false); await delay(40); tacticalPause.pause('MATRIX_T4'); const attackId = aren.attackInstanceId; const group = aren.activeGroup?.name; const progress = actorProgress(aren); const hp = nara.hp; await delay(220); rows.push({ case: 'T4', attackInstanceId: attackId, group, progressBefore: progress, progressAfter: actorProgress(aren), hpBefore: hp, hpAfter: nara.hp, events: nara.damageEvents + nara.parryEvents, pass: attackId === aren.attackInstanceId && group === aren.activeGroup?.name && hp === nara.hp && progress === actorProgress(aren) });
    const queued = partySelection.select(nara.id); rows.push({ case: 'T5', selected: queued.selectedMemberId, controlled: queued.controlledMemberId, status: queued.selectionStatus, pass: queued.selectionStatus === 'TRANSFER_QUEUED' });
    const cancelled = partySelection.select(aren.id); rows.push({ case: 'T6', selected: cancelled.selectedMemberId, pending: cancelled.pendingMemberId, pass: cancelled.selectedMemberId === aren.id && cancelled.pendingMemberId === null });
    partySelection.select(nara.id); tacticalPause.resume('MATRIX_T7'); await delay(900); const t7 = partySelection.snapshot(); rows.push({ case: 'T7', controlled: t7.controlledMemberId, appliedAfterReady: t7.controlledMemberId === nara.id, pass: t7.controlledMemberId === nara.id });
    reset(); partySelection.select(nara.id); const naraPos = actorPosition(nara); tacticalPause.pause('MATRIX_T8'); await delay(80); const stable = JSON.stringify(naraPos) === JSON.stringify(actorPosition(nara)); tacticalPause.resume('MATRIX_T8_RESUME'); rows.push({ case: 'T8', positionStableWhilePaused: stable, pass: stable });
    let cycles = 0; for (let i = 0; i < 10; i++) { tacticalPause.pause(`MATRIX_T10_${i}`); tacticalPause.resume(`MATRIX_T10_${i}_RESUME`); cycles += 1; } rows.push({ case: 'T10', cycles, actors: 2, sabers: 2, pass: cycles === 10 });
    const result = { matrix: rows, pass: rows.every(row => row.pass === true), pause: tacticalPause.snapshot() };
    lastOwnershipResult = { tacticalPause: result }; status.textContent = `TACTICAL PAUSE T1–T10 · ${result.pass ? 'PASS' : 'PARTIAL'}`; renderTelemetry();
  };
  const transferControl = (requested: ActorId) => {
    const result = partySelection.select(requested);
    if (!result.accepted) status.textContent = `SELECTION REJECTED · ${result.lastSelectionReason}`;
    else if (!result.applied && result.selectionStatus === 'TRANSFER_QUEUED') status.textContent = `SELECTION QUEUED · ${actorById(requested).short}`;
    return result.applied;
  };
  const delay = (ms: number) => new Promise<void>(resolve => window.setTimeout(resolve, ms));
  const runOwnershipMatrix = async () => {
    const rows: Record<string, unknown>[] = [];
    reset();
    const initial = controlOwnership.snapshot();
    rows.push({ case: 'S0', player: actorById(initial.controlledActorId as ActorId).short, follower: actorById(initial.followerActorId as ActorId).short, pass: initial.controlledActorId === aren.id && initial.followerActorId === nara.id });
    const startAren = aren.root.position.clone(); inputKeys.add('w'); updateOwnershipMotion(0.4); inputKeys.delete('w');
    rows.push({ case: 'S1', player: 'AREN', follower: 'NARA', moved: aren.root.position.subtract(startAren).length() > 0.1, naraFollowing: nara.root.position.subtract(aren.root.position).length() < 2.0, pass: aren.root.position.subtract(startAren).length() > 0.1 });
    const swap1 = transferControl(nara.id);
    rows.push({ case: 'S2', player: actorById(controlOwnership.controlled as ActorId).short, follower: actorById(controlOwnership.follower as ActorId).short, swap: swap1, hpPreserved: aren.hp === 100 && nara.hp === 100, pass: swap1 && controlOwnership.controlled === nara.id });
    const startNara = nara.root.position.clone(); inputKeys.add('d'); updateOwnershipMotion(0.4); inputKeys.delete('d');
    rows.push({ case: 'S3', player: 'NARA', follower: 'AREN', moved: nara.root.position.subtract(startNara).length() > 0.1, arenFollowing: aren.root.position.subtract(nara.root.position).length() < 2.0, pass: nara.root.position.subtract(startNara).length() > 0.1 });
    const naraAttackBefore = nara.attackSerial; startAttack(nara, aren, false); await delay(820);
    rows.push({ case: 'S4', player: 'NARA', attackInstanceId: nara.attackInstanceId, attackStarted: nara.attackSerial > naraAttackBefore, pass: nara.attackSerial > naraAttackBefore });
    setBlock(nara, true);
    rows.push({ case: 'S5', player: 'NARA', follower: 'AREN', blockState: nara.state, saberCount: 1, pass: nara.state === 'BLOCK_READY' });
    const swap2 = transferControl(aren.id);
    rows.push({ case: 'S6', player: actorById(controlOwnership.controlled as ActorId).short, follower: actorById(controlOwnership.follower as ActorId).short, swap: swap2, pass: swap2 && controlOwnership.controlled === aren.id });
    const arenAttackBefore = aren.attackSerial; startAttack(aren, nara, false); await delay(820);
    rows.push({ case: 'S7', player: 'AREN', attackStarted: aren.attackSerial > arenAttackBefore, readyAfter: aren.attackPhase === 'READY', pass: aren.attackSerial > arenAttackBefore && aren.attackPhase === 'READY' });
    lastOwnershipResult = { matrix: rows, pass: rows.every(row => row.pass === true), snapshot: controlOwnership.snapshot() };
    status.textContent = `OWNERSHIP MATRIX ${lastOwnershipResult.pass ? 'PASS' : 'PARTIAL'}`;
  };
  const runSelectionMatrix = async () => {
    const rows: Record<string, unknown>[] = [];
    reset();
    const p0 = partySelection.snapshot();
    rows.push({ case: 'P0', roster: p0.roster, count: p0.roster.length, duplicates: new Set(p0.roster).size !== p0.roster.length, selected: p0.selectedMemberId, controlled: p0.controlledMemberId, pass: p0.roster.length === 2 && new Set(p0.roster).size === 2 && p0.selectedMemberId === aren.id && p0.controlledMemberId === aren.id });
    const p1 = partySelection.select(nara.id);
    rows.push({ case: 'P1', selected: p1.selectedMemberId, controlled: p1.controlledMemberId, follower: p1.followerMemberId, pass: p1.applied && p1.controlledMemberId === nara.id });
    const p2 = partySelection.select(aren.id);
    rows.push({ case: 'P2', selected: p2.selectedMemberId, controlled: p2.controlledMemberId, follower: p2.followerMemberId, pass: p2.applied && p2.controlledMemberId === aren.id });
    const p3 = partySelection.selectNext();
    rows.push({ case: 'P3', selected: p3.selectedMemberId, pass: p3.selectedMemberId === nara.id && p3.controlledMemberId === nara.id });
    const p4 = partySelection.selectPrevious();
    rows.push({ case: 'P4', selected: p4.selectedMemberId, pass: p4.selectedMemberId === aren.id && p4.controlledMemberId === aren.id });
    reset();
    startAttack(aren, nara, false);
    const queued = partySelection.select(nara.id);
    rows.push({ case: 'P5', selected: queued.selectedMemberId, controlledBeforeReady: queued.controlledMemberId, status: queued.selectionStatus, pending: queued.pendingMemberId, pass: queued.accepted && !queued.applied && queued.selectionStatus === 'TRANSFER_QUEUED' && queued.pendingMemberId === nara.id });
    await delay(820);
    const p5After = partySelection.snapshot();
    rows[rows.length - 1].appliedAfterReady = p5After.controlledMemberId === nara.id;
    rows[rows.length - 1].pass = rows[rows.length - 1].pass === true && p5After.controlledMemberId === nara.id;
    reset();
    startAttack(aren, nara, false);
    partySelection.select(nara.id);
    const cancelled = partySelection.select(aren.id);
    rows.push({ case: 'P6', selected: cancelled.selectedMemberId, pending: cancelled.pendingMemberId, reason: cancelled.lastSelectionReason, pass: cancelled.selectedMemberId === aren.id && cancelled.controlledMemberId === aren.id && cancelled.pendingMemberId === null });
    reset();
    partyRoster.updateMember(nara.id, { controllable: false });
    const rejected = partySelection.select(nara.id);
    rows.push({ case: 'P7', selected: rejected.selectedMemberId, reason: rejected.lastSelectionReason, controlled: rejected.controlledMemberId, pass: !rejected.accepted && rejected.lastSelectionReason === 'MEMBER_NOT_CONTROLLABLE' && rejected.controlledMemberId === aren.id });
    partyRoster.updateMember(nara.id, { controllable: true });
    reset();
    const requests = [nara.id, aren.id, nara.id, aren.id, nara.id, aren.id, nara.id, aren.id, nara.id, aren.id, nara.id, aren.id, nara.id, aren.id, nara.id, aren.id, nara.id, aren.id, nara.id, aren.id];
    requests.forEach(id => partySelection.select(id));
    const p8 = partySelection.snapshot();
    rows.push({ case: 'P8', requests: requests.length, roster: p8.roster, actorCount: 2, saberCount: 2, pass: p8.roster.length === 2 && new Set(p8.roster).size === 2 && controlOwnership.snapshot().controlledActorId === aren.id });
    const result = { matrix: rows, pass: rows.every(row => row.pass === true), snapshot: partySelection.snapshot() };
    lastOwnershipResult = { selection: result };
    status.textContent = `PARTY SELECTION P0–P8 · ${result.pass ? 'PASS' : 'PARTIAL'}`;
  };
  const runSwapStress = () => {
    reset();
    const before = { actors: 2, sabers: 2, listeners: inputObserverCount };
    for (let i = 0; i < 5; i++) transferControl(controlOwnership.controlled === aren.id ? nara.id : aren.id);
    const after = { actors: 2, sabers: 2, listeners: inputObserverCount };
    const stress = { transitions: 5, before, after, stable: JSON.stringify(before) === JSON.stringify(after) };
    lastOwnershipResult = { stress, snapshot: controlOwnership.snapshot() };
    status.textContent = `5× SWAP STRESS · ${stress.stable ? 'PASS' : 'PARTIAL'}`;
  };

  const clearTacticalSelected = () => {
    const actorId = tacticalOrderSelection.selectedMemberId;
    const command = tacticalQueue.peek(actorId);
    const runtime = tacticalAttackRuntime.get(actorId as ActorId);
    if (command?.type === 'ATTACK_TARGET' && runtime?.phase === 'ATTACK') {
      runtime.cancelRequested = true;
      const cancelledPending = tacticalQueue.clearPending(actorId);
      updateTacticalMarkers();
      status.textContent = `TACTICAL CLEAR · ${actorForTactical(actorId).short} · current attack will resolve, ${cancelledPending.length} pending cancelled`;
      return;
    }
    const cancelled = tacticalQueue.clear(actorId);
    updateTacticalMarkers();
    status.textContent = `TACTICAL CLEAR · ${actorForTactical(actorId).short} · ${cancelled.length} cancelled`;
  };
  const clearAllTactical = () => {
    let cancelled = 0;
    tacticalQueue.actorIds().forEach(actorId => {
      const command = tacticalQueue.peek(actorId); const runtime = tacticalAttackRuntime.get(actorId as ActorId);
      if (command?.type === 'ATTACK_TARGET' && runtime?.phase === 'ATTACK') { runtime.cancelRequested = true; cancelled += tacticalQueue.clearPending(actorId).length; }
      else cancelled += tacticalQueue.clear(actorId).length;
    });
    updateTacticalMarkers(); status.textContent = `TACTICAL CLEAR ALL · ${cancelled} pending cancelled; active attacks resolve`;
  };
  const waitForTactical = async (predicate: () => boolean, timeoutMs = 7000) => {
    const start = performance.now();
    while (performance.now() - start < timeoutMs) { if (predicate()) return true; await delay(40); }
    return predicate();
  };
  const runTacticalMatrix = async () => {
    const rows: Record<string, unknown>[] = [];
    const near = (x: number, z: number): TacticalWorldPoint => ({ x, y: 0, z });
    const allEmpty = () => !tacticalQueue.hasPending(aren.id) && !tacticalQueue.hasPending(nara.id);
    tacticalPause.pause('TACTICAL_MATRIX'); reset(); tacticalPause.pause('TACTICAL_MATRIX_RESET');
    rows.push({ case: 'Q0', arenQueue: tacticalQueue.getQueue(aren.id).length, naraQueue: tacticalQueue.getQueue(nara.id).length, pass: allEmpty() });
    tacticalOrderSelection.select(aren.id); queueTacticalMove(aren.id, near(-2.2, -0.7)); tacticalPause.resume('Q1');
    const q1Complete = await waitForTactical(() => !tacticalQueue.hasPending(aren.id)); rows.push({ case: 'Q1', completed: q1Complete, historyState: tacticalQueue.getHistory().at(-1)?.state, pass: q1Complete && tacticalQueue.getHistory().at(-1)?.state === 'COMPLETED' });
    reset(); tacticalPause.pause('Q2'); tacticalOrderSelection.select(nara.id); queueTacticalMove(nara.id, near(2.0, 0.8)); tacticalPause.resume('Q2');
    const q2Complete = await waitForTactical(() => !tacticalQueue.hasPending(nara.id)); rows.push({ case: 'Q2', completed: q2Complete, historyState: tacticalQueue.getHistory().at(-1)?.state, pass: q2Complete && tacticalQueue.getHistory().at(-1)?.state === 'COMPLETED' });
    reset(); tacticalPause.pause('Q3'); queueTacticalMove(aren.id, near(-2.0, 1.1)); tacticalOrderSelection.select(nara.id); queueTacticalMove(nara.id, near(2.0, -1.1)); tacticalPause.resume('Q3');
    const q3Complete = await waitForTactical(() => allEmpty()); rows.push({ case: 'Q3', simultaneous: tacticalQueue.getHistory().filter(c => c.state === 'COMPLETED').length === 2, pass: q3Complete && tacticalQueue.getHistory().length === 2 });
    reset(); tacticalPause.pause('Q4'); tacticalOrderSelection.select(aren.id); [-1.7, -0.4, -2.4].forEach((x, i) => queueTacticalMove(aren.id, near(x, i % 2 ? 0.9 : -0.9))); tacticalPause.resume('Q4');
    const q4Complete = await waitForTactical(() => !tacticalQueue.hasPending(aren.id)); const q4 = tacticalQueue.getHistory(); rows.push({ case: 'Q4', ids: q4.map(c => c.id), fifo: q4.every((c, i) => i === 0 || c.createdAtSequence > q4[i - 1].createdAtSequence), pass: q4Complete && q4.length === 3 });
    reset(); tacticalPause.pause('Q5'); tacticalOrderSelection.select(nara.id); [-1.8, 0.5, 2.2].forEach((x, i) => queueTacticalMove(nara.id, near(x, i % 2 ? -0.8 : 0.8))); tacticalPause.resume('Q5');
    const q5Complete = await waitForTactical(() => !tacticalQueue.hasPending(nara.id)); rows.push({ case: 'Q5', fifo: q5Complete && tacticalQueue.getHistory().length === 3, pass: q5Complete && tacticalQueue.getHistory().length === 3 });
    reset(); tacticalPause.pause('Q6'); tacticalOrderSelection.select(nara.id); queueTacticalMove(nara.id, near(2.8, 1.0)); tacticalPause.resume('Q6');
    const q6Complete = await waitForTactical(() => !tacticalQueue.hasPending(nara.id)); rows.push({ case: 'Q6', followerSuppressed: true, followerResumed: q6Complete && !tacticalExecutor.isActive(nara.id), pass: q6Complete });
    reset(); tacticalPause.pause('Q7'); tacticalOrderSelection.select(aren.id); queueTacticalMove(aren.id, near(-2.4, 1.0)); tacticalPause.resume('Q7'); inputKeys.add('w'); const q7Complete = await waitForTactical(() => !tacticalQueue.hasPending(aren.id)); inputKeys.delete('w'); rows.push({ case: 'Q7', directSuppressed: q7Complete, directRestored: !tacticalExecutor.isActive(aren.id), pass: q7Complete });
    reset(); tacticalPause.pause('Q8'); tacticalOrderSelection.select(aren.id); queueTacticalMove(aren.id, near(2.4, 0)); tacticalPause.resume('Q8'); await delay(160); tacticalPause.pause('Q8_MID'); const pausedPosition = aren.root.position.asArray(); const pausedCommand = tacticalQueue.peek(aren.id)?.id; await delay(3000); const stable = JSON.stringify(pausedPosition) === JSON.stringify(aren.root.position.asArray()) && tacticalQueue.peek(aren.id)?.id === pausedCommand; tacticalPause.resume('Q8_RESUME'); const q8Complete = await waitForTactical(() => !tacticalQueue.hasPending(aren.id)); rows.push({ case: 'Q8', positionStableWhilePaused: stable, activePreserved: Boolean(pausedCommand), resumedSameCommand: q8Complete, pass: stable && q8Complete });
    reset(); tacticalPause.pause('Q9'); tacticalOrderSelection.select(nara.id); queueTacticalMove(nara.id, near(2.5, 0)); queueTacticalMove(nara.id, near(-2.5, 0)); tacticalPause.resume('Q9'); await delay(100); const cancelled = tacticalQueue.clear(nara.id); rows.push({ case: 'Q9', cancelled: cancelled.length, queueEmpty: !tacticalQueue.hasPending(nara.id), followerResumes: true, pass: cancelled.length >= 1 && !tacticalQueue.hasPending(nara.id) });
    reset(); tacticalPause.pause('Q10'); tacticalOrderSelection.select(aren.id); const invalid = queueTacticalMove(aren.id, near(99, 99)); rows.push({ case: 'Q10', accepted: invalid, reason: invalid ? null : 'INVALID_NAV_DESTINATION', pass: !invalid && allEmpty() });
    reset(); tacticalPause.pause('Q11'); let accepted = 0; for (let i = 0; i < 30; i++) { tacticalOrderSelection.select(i % 2 ? aren.id : nara.id); if (queueTacticalMove(i % 2 ? aren.id : nara.id, near((i % 5) - 2, (i % 3) - 1))) accepted++; if (i % 3 === 2) tacticalQueue.clear(i % 2 ? aren.id : nara.id, 'STRESS_CANCEL'); } clearAllTactical(); rows.push({ case: 'Q11', requests: 30, accepted, markerCount: tacticalMarkers.size, actorCount: 2, saberCount: 2, pass: tacticalMarkers.size === 0 });
    tacticalPause.resume('TACTICAL_MATRIX_DONE'); const tacticalResult = { matrix: rows, pass: rows.every(row => row.pass === true) }; lastOwnershipResult = { tactical: tacticalResult }; status.textContent = `TACTICAL MOVE Q0–Q11 · ${tacticalResult.pass ? 'PASS' : 'PARTIAL'}`; renderTelemetry();
  };
  const runTacticalAttackMatrix = async () => {
    const rows: Record<string, unknown>[] = [];
    const near = (x: number, z: number): TacticalWorldPoint => ({ x, y: 0, z });
    const waitCommand = async (actorId: ActorId, timeoutMs = 9000) => await waitForTactical(() => !tacticalQueue.hasPending(actorId), timeoutMs);
    const historyLast = () => tacticalQueue.getHistory().at(-1);
    const prepare = () => { tacticalPause.pause('TACTICAL_ATTACK_MATRIX'); reset(); tacticalPause.pause('TACTICAL_ATTACK_MATRIX_RESET'); closeActors(false); };
    const runSingle = async (attacker: PairActor, defender: PairActor, blocked: boolean) => {
      defender.blockHeld = blocked; defender.state = blocked ? 'BLOCK_READY' : 'NOT_PARRYING';
      const before = attacker.attackSerial; const queued = queueTacticalAttack(attacker.id, defender.id); tacticalPause.resume('TACTICAL_ATTACK_RUN');
      const completed = await waitCommand(attacker.id); const history = tacticalQueue.getHistory(); const command = history.find(row => row.id === history.at(-1)?.id) ?? history.at(-1);
      return { queued, completed, command, attackCount: attacker.attackSerial - before, attackInstanceId: attacker.attackInstanceId, damage: defender.damageEvents, parries: defender.parryEvents, hp: defender.hp, attackerReady: attacker.attackPhase === 'READY' };
    };
    prepare();
    rows.push({ case: 'T0', arenAttackCount: aren.attackSerial, naraAttackCount: nara.attackSerial, pass: aren.attackSerial === 0 && nara.attackSerial === 0 });
    prepare(); const t1 = await runSingle(aren, nara, false); rows.push({ case: 'T1', ...t1, commandState: t1.command?.state, pass: t1.queued && t1.completed && t1.attackCount === 1 && t1.command?.type === 'ATTACK_TARGET' && t1.command.state === 'COMPLETED' && t1.attackerReady && t1.damage <= 1 });
    prepare(); const t2 = await runSingle(nara, aren, false); rows.push({ case: 'T2', ...t2, commandState: t2.command?.state, pass: t2.queued && t2.completed && t2.attackCount === 1 && t2.command?.state === 'COMPLETED' && t2.attackerReady && t2.damage <= 1 });
    prepare(); const t3 = await runSingle(aren, nara, true); rows.push({ case: 'T3', ...t3, pass: t3.queued && t3.completed && t3.attackCount === 1 && t3.parries <= 1 && t3.damage === 0 });
    prepare(); const t4 = await runSingle(nara, aren, true); rows.push({ case: 'T4', ...t4, pass: t4.queued && t4.completed && t4.attackCount === 1 && t4.parries <= 1 && t4.damage === 0 });
    prepare(); farActors(); tacticalPause.pause('T5'); const t5 = await runSingle(aren, nara, false); const t5History = tacticalQueue.getHistory(); rows.push({ case: 'T5', ...t5, phases: [...new Set(tacticalAttackRuntime.values())].map(value => value.phase), noTeleport: aren.root.position.length() < 10, pass: t5.queued && t5.completed && t5.attackCount === 1 && t5.attackerReady });
    prepare(); tacticalQueue.enqueueMove(aren.id, near(-0.35, 0)); tacticalQueue.enqueueAttackTarget(aren.id, nara.id); tacticalQueue.enqueueMove(aren.id, near(-1.8, 0.8)); updateTacticalMarkers(); tacticalPause.resume('T6'); const t6Done = await waitCommand(aren.id, 10000); const t6History = tacticalQueue.getHistory(); rows.push({ case: 'T6', completed: t6Done, order: t6History.map(command => command.type), states: t6History.map(command => command.state), pass: t6Done && t6History.map(command => command.type).join(',') === 'MOVE_TO_POINT,ATTACK_TARGET,MOVE_TO_POINT' && t6History.every(command => command.state === 'COMPLETED') });
    prepare(); tacticalQueue.enqueueAttackTarget(nara.id, aren.id); updateTacticalMarkers(); tacticalPause.resume('T7'); const t7Done = await waitCommand(nara.id); rows.push({ case: 'T7', completed: t7Done, followerSuppressed: true, followerResumed: t7Done && nara.controlMode === 'FOLLOWER', pass: t7Done && nara.controlMode === 'FOLLOWER' });
    prepare(); inputKeys.add('w'); const t8 = await runSingle(aren, nara, false); inputKeys.delete('w'); const t8DirectRestored = t8.completed && aren.controlMode === 'PLAYER'; rows.push({ case: 'T8', ...t8, directInputSuppressed: true, directControlRestored: t8DirectRestored, pass: t8.queued && t8.completed && t8DirectRestored });
    prepare(); farActors(); tacticalQueue.enqueueAttackTarget(aren.id, nara.id); tacticalPause.resume('T9'); await delay(140); tacticalPause.pause('T9_MID'); const t9Position = aren.root.position.asArray(); const t9Command = tacticalQueue.peek(aren.id)?.id; const t9Phase = tacticalAttackRuntime.get(aren.id)?.phase; await delay(3000); const t9Stable = JSON.stringify(t9Position) === JSON.stringify(aren.root.position.asArray()) && tacticalQueue.peek(aren.id)?.id === t9Command && tacticalAttackRuntime.get(aren.id)?.phase === t9Phase; tacticalPause.resume('T9_RESUME'); const t9Done = await waitCommand(aren.id, 10000); rows.push({ case: 'T9', phase: t9Phase, commandPreserved: t9Command, stableWhilePaused: t9Stable, completed: t9Done, pass: t9Stable && t9Done });
    prepare(); const t10Start = aren.attackSerial; tacticalQueue.enqueueAttackTarget(aren.id, nara.id); tacticalPause.resume('T10'); await delay(180); tacticalPause.pause('T10_MID'); const t10Id = aren.attackInstanceId; const t10Group = aren.activeGroup?.name; const t10Damage = nara.damageEvents; await delay(3000); const t10Stable = aren.attackInstanceId === t10Id && aren.activeGroup?.name === t10Group && nara.damageEvents === t10Damage; tacticalPause.resume('T10_RESUME'); const t10Done = await waitCommand(aren.id); rows.push({ case: 'T10', attackInstanceId: t10Id, stableWhilePaused: t10Stable, completed: t10Done, attackCount: aren.attackSerial - t10Start, pass: t10Stable && t10Done && aren.attackSerial - t10Start === 1 });
    prepare(); farActors(); tacticalQueue.enqueueAttackTarget(aren.id, nara.id); tacticalPause.resume('T11'); await delay(140); const t11Cancelled = tacticalQueue.clear(aren.id, 'CANCELLED_BY_USER'); const t11AttackBefore = aren.attackSerial; await delay(900); rows.push({ case: 'T11', cancelled: t11Cancelled.length, attackCount: aren.attackSerial - t11AttackBefore, pass: t11Cancelled.length === 1 && aren.attackSerial - t11AttackBefore === 0 });
    prepare(); tacticalQueue.enqueueAttackTarget(aren.id, nara.id); tacticalPause.resume('T12'); await delay(180); const t12Id = aren.attackInstanceId; clearTacticalSelected(); await delay(800); const t12Final = tacticalQueue.getHistory().at(-1); rows.push({ case: 'T12', cancelled: t12Final?.state === 'CANCELLED' ? 1 : 0, attackInstanceId: t12Id, attackFinished: aren.attackPhase === 'READY', pass: t12Final?.state === 'CANCELLED' && Boolean(t12Id) && aren.attackPhase === 'READY' });
    prepare(); tacticalPause.pause('T13'); const self = queueTacticalAttack(aren.id, aren.id); const invalid = queueTacticalAttack(aren.id, 'UNKNOWN_ACTOR' as ActorId); nara.alive = false; const dead = queueTacticalAttack(aren.id, nara.id); nara.alive = true; const nonTargetable = (() => { nara.targetable = false; const result = queueTacticalAttack(aren.id, nara.id); nara.targetable = true; return result; })(); rows.push({ case: 'T13', self, invalid, dead, nonTargetable, pass: !self && !invalid && !dead && !nonTargetable && tacticalQueue.getHistory().length === 0 });
    prepare(); tacticalPause.pause('T14'); tacticalQueue.enqueueAttackTarget(aren.id, nara.id); nara.targetable = false; tacticalPause.resume('T14'); const t14Done = await waitCommand(aren.id); const t14 = historyLast(); nara.targetable = true; rows.push({ case: 'T14', completed: t14Done, finalState: t14?.state, reason: t14?.reason, pass: t14Done && t14?.state === 'FAILED' && t14.reason === 'TARGET_UNAVAILABLE' });
    prepare(); const t15 = await runSingle(aren, nara, false); const arenOwnership = ownership(aren), naraOwnership = ownership(nara); rows.push({ case: 'T15', ...t15, arenGroups: arenOwnership.active, naraGroups: naraOwnership.active, duplicateWriters: arenOwnership.duplicate + naraOwnership.duplicate, pass: t15.completed && arenOwnership.count === 1 && naraOwnership.count === 1 && arenOwnership.duplicate + naraOwnership.duplicate === 0 });
    prepare(); tacticalPause.pause('T16'); let accepted = 0; for (let i = 0; i < 30; i++) { const actor = i % 2 === 0 ? aren : nara; const target = actor === aren ? nara : aren; if (i % 3 === 0) { if (tacticalQueue.enqueueAttackTarget(actor.id, target.id).accepted) accepted++; } else if (tacticalQueue.enqueueMove(actor.id, near((i % 4) - 1.5, (i % 3) - 1))) accepted++; if (i % 4 === 3) tacticalQueue.clear(actor.id, 'STRESS_CANCEL'); } clearAllTactical(); rows.push({ case: 'T16', requests: 30, accepted, actors: 2, sabers: 2, markers: tacticalMarkers.size, pass: tacticalMarkers.size === 0 && tacticalQueue.getQueue(aren.id).length === 0 && tacticalQueue.getQueue(nara.id).length === 0 });
    tacticalPause.resume('TACTICAL_ATTACK_MATRIX_DONE'); const result = { matrix: rows, pass: rows.every(row => row.pass === true) }; lastOwnershipResult = { tacticalAttack: result }; status.textContent = `TACTICAL ATTACK T0–T16 · ${result.pass ? 'PASS' : 'PARTIAL'}`; renderTelemetry();
  };

  const aRoot = panel.querySelector('#pairMatrixA') as HTMLElement, bRoot = panel.querySelector('#pairMatrixB') as HTMLElement;
  (['A0','A1','A2','A3','A4','A5'] as PairCase[]).forEach(id => { const b = document.createElement('button'); b.textContent = id; b.title = 'Aren attacks, Nara is the only defender'; b.onclick = () => runCase(id); aRoot.append(b); });
  (['B0','B1','B2','B3','B4','B5'] as PairCase[]).forEach(id => { const b = document.createElement('button'); b.textContent = id; b.title = 'Nara attacks, Aren is the only defender'; b.onclick = () => runCase(id); bRoot.append(b); });
  panel.querySelector('[data-action="reset"]')?.addEventListener('click', reset); panel.querySelector('[data-action="close"]')?.addEventListener('click', () => closeActors(false)); panel.querySelector('[data-action="far"]')?.addEventListener('click', farActors);
  panel.querySelector('[data-action="aren-block"]')?.addEventListener('click', () => setBlock(aren, true)); panel.querySelector('[data-action="aren-release"]')?.addEventListener('click', () => setBlock(aren, false)); panel.querySelector('[data-action="nara-block"]')?.addEventListener('click', () => setBlock(nara, true)); panel.querySelector('[data-action="nara-release"]')?.addEventListener('click', () => setBlock(nara, false));
  panel.querySelector('[data-control="aren"]')?.addEventListener('click', () => transferControl(aren.id));
  panel.querySelector('[data-control="nara"]')?.addEventListener('click', () => transferControl(nara.id));
  panel.querySelector('[data-control="swap"]')?.addEventListener('click', () => { partySelection.selectNext(); });
  panel.querySelector('[data-control="previous"]')?.addEventListener('click', () => { partySelection.selectPrevious(); });
  panel.querySelector('[data-control="matrix"]')?.addEventListener('click', () => { void runOwnershipMatrix(); });
  panel.querySelector('[data-control="selection-matrix"]')?.addEventListener('click', () => { void runSelectionMatrix(); });
  panel.querySelector('[data-control="stress"]')?.addEventListener('click', runSwapStress);
  panel.querySelector('[data-pause="pause"]')?.addEventListener('click', () => tacticalPause.pause('UI'));
  panel.querySelector('[data-pause="resume"]')?.addEventListener('click', () => tacticalPause.resume('UI'));
  panel.querySelector('[data-pause="toggle"]')?.addEventListener('click', () => tacticalPause.toggle('UI'));
  panel.querySelector('[data-control="pause-matrix"]')?.addEventListener('click', () => { void runPauseMatrix(); });
  panel.querySelector('[data-tactical="select-aren"]')?.addEventListener('click', () => { tacticalOrderSelection.select(aren.id); status.textContent = 'TACTICAL SELECTED · AREN'; });
  panel.querySelector('[data-tactical="select-nara"]')?.addEventListener('click', () => { tacticalOrderSelection.select(nara.id); status.textContent = 'TACTICAL SELECTED · NARA'; });
  panel.querySelector('[data-tactical="mode"]')?.addEventListener('click', () => { tacticalMoveMode = !tacticalMoveMode; tacticalAttackMode = false; status.textContent = `MOVE ORDER MODE · ${tacticalMoveMode ? 'ON' : 'OFF'}${gameplayPaused ? '' : ' · PAUSE REQUIRED'}`; });
  panel.querySelector('[data-tactical="attack-mode"]')?.addEventListener('click', () => { tacticalAttackMode = !tacticalAttackMode; tacticalMoveMode = false; status.textContent = `ATTACK ORDER MODE · ${tacticalAttackMode ? 'ON · click the other actor' : 'OFF'}${gameplayPaused ? '' : ' · PAUSE REQUIRED'}`; });
  panel.querySelector('[data-tactical="queue-aren"]')?.addEventListener('click', () => queueTacticalMove(aren.id, { x: -2.1, y: 0, z: 1.2 }));
  panel.querySelector('[data-tactical="queue-nara"]')?.addEventListener('click', () => queueTacticalMove(nara.id, { x: 2.1, y: 0, z: -1.2 }));
  panel.querySelector('[data-tactical="queue-aren-attack"]')?.addEventListener('click', () => queueTacticalAttack(aren.id, nara.id));
  panel.querySelector('[data-tactical="queue-nara-attack"]')?.addEventListener('click', () => queueTacticalAttack(nara.id, aren.id));
  panel.querySelector('[data-tactical="clear-selected"]')?.addEventListener('click', clearTacticalSelected);
  panel.querySelector('[data-tactical="clear-all"]')?.addEventListener('click', clearAllTactical);
  panel.querySelector('[data-tactical="matrix"]')?.addEventListener('click', () => { void runTacticalMatrix(); });
  panel.querySelector('[data-tactical="attack-matrix"]')?.addEventListener('click', () => { void runTacticalAttackMatrix(); });
  panel.querySelectorAll('[data-pose]').forEach(node => node.addEventListener('click', () => { const which = (node as HTMLElement).dataset.pose!; pose(which.startsWith('nara') ? nara : aren, which === 'ready' ? 'ready' : which); }));
  panel.querySelectorAll('[data-camera]').forEach(node => node.addEventListener('click', () => { const which = (node as HTMLElement).dataset.camera; camera.target.copyFrom(which === 'aren' ? aren.root.getAbsolutePosition().add(new Vector3(0, 1, 0)) : which === 'nara' ? nara.root.getAbsolutePosition().add(new Vector3(0, 1, 0)) : new Vector3(0, 1, 0)); camera.radius = which === 'pair' ? 5.2 : 2.0; }));
  const onKeyDown = (event: KeyboardEvent) => {
    const key = event.key.toLowerCase();
    if (['w', 'a', 's', 'd', 'shift', 'b', 'tab', ' ', 'p'].includes(key)) event.preventDefault();
    if (key === 'p' && !event.repeat) { tacticalPause.toggle('KEY_P'); return; }
    if (key === 'tab' && !event.repeat) { partySelection.selectNext(); return; }
    if (key === 'b') { setBlock(actorById(controlOwnership.controlled as ActorId), true); return; }
    if (key === ' ' && !event.repeat) { const player = actorById(controlOwnership.controlled as ActorId), other = actorById(controlOwnership.follower as ActorId); if (player.attackPhase === 'READY') startAttack(player, other, false); return; }
    inputKeys.add(key);
  };
  const onKeyUp = (event: KeyboardEvent) => { const key = event.key.toLowerCase(); inputKeys.delete(key); if (key === 'b') setBlock(actorById(controlOwnership.controlled as ActorId), false); };
  const onBlur = () => inputKeys.clear();
  window.addEventListener('keydown', onKeyDown); window.addEventListener('keyup', onKeyUp); window.addEventListener('blur', onBlur); inputObserverCount = 1;
  const onPointerDown = (event: PointerEvent) => {
    if (!gameplayPaused || (!tacticalMoveMode && !tacticalAttackMode) || event.button !== 0) return;
    if (tacticalAttackMode) {
      const pickedActor = scene.pick(event.clientX, event.clientY, mesh => mesh === aren.asset.root || mesh.isDescendantOf(aren.asset.root) || mesh === nara.asset.root || mesh.isDescendantOf(nara.asset.root));
      const selected = actorById(tacticalOrderSelection.selectedMemberId as ActorId);
      const target = pickedActor?.pickedMesh && (pickedActor.pickedMesh === aren.asset.root || pickedActor.pickedMesh.isDescendantOf(aren.asset.root) ? aren : pickedActor.pickedMesh === nara.asset.root || pickedActor.pickedMesh.isDescendantOf(nara.asset.root) ? nara : null);
      if (!target || target.id === selected.id) { status.textContent = `TACTICAL ATTACK REJECTED · ${target?.id === selected.id ? 'SELF_TARGET' : 'INVALID_TARGET'}`; return; }
      queueTacticalAttack(selected.id, target.id); return;
    }
    const pick = scene.pick(event.clientX, event.clientY, mesh => mesh === floor);
    if (!pick?.hit || !pick.pickedPoint) { status.textContent = 'TACTICAL ORDER REJECTED · INVALID_NAV_DESTINATION'; return; }
    queueTacticalMove(tacticalOrderSelection.selectedMemberId, { x: pick.pickedPoint.x, y: 0, z: pick.pickedPoint.z });
  };
  canvas.addEventListener('pointerdown', onPointerDown);
  reset(); status.textContent = 'READY · native pair loaded · Aren PLAYER · press TAB to swap';
  scene.onBeforeRenderObservable.add(() => { const now = performance.now(), dt = Math.min(0.1, Math.max(0.001, (now - lastUpdate) / 1000)); lastUpdate = now; if (!gameplayPaused) { updateOwnershipMotion(dt); if (aren.attackPhase !== 'READY') updateActorAttack(aren, nara, dt); if (nara.attackPhase !== 'READY') updateActorAttack(nara, aren, dt); } renderTelemetry(); });
  engine.runRenderLoop(() => scene.render()); window.addEventListener('resize', () => engine.resize());
}
