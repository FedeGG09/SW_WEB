import {
  ArcRotateCamera, Color3, Color4, DirectionalLight, Engine, HemisphericLight,
  Matrix, Mesh, Scene, SceneLoader, StandardMaterial, TransformNode, Vector3,
} from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import { AssetLoader, type ImportedAsset } from '../../assets/AssetLoader';
import { PLAYER_CHARACTERS, type PlayerCharacterConfig } from '../../player/PlayerCharacterConfig';
import { WeaponAttachment, type NativeJkaWeaponDefinition } from '../../player/WeaponAttachment';
import { applyJediEnclaveMaterials, applyJediEnclaveHdOverrides, type AcademyHdOverrideRegistry } from './JediEnclaveMaterialPipeline';
import { EbonHawkPartyAdapter, type EboHit, type EboNav, type EboPoint } from './EbonHawkPartyAdapter';
import { TacticalPauseController } from '../../party/TacticalPauseController';
import { AcademyNpcPopulation, type AcademyNpcRuntimeRecord } from '../../world/AcademyNpcPopulation';
import { BelayaDialogueV1, BELAYA_SOURCE_NPC_ID } from './BelayaDialogueV1';

const BASE = '/_lab/kotor/worlds/jedi_enclave/';
const DANM13 = BASE + 'jedi_enclave_danm13_kotor1.glb';
const DANM14 = BASE + 'jedi_enclave_danm14aa_kotor1_candidate_v2.glb';
const AREN = '/_lab/jka/characters/aren/aren_native_jka_v1_defense_v2.glb';
const NARA = '/_lab/jka/characters/nara/nara_native_jka_v1_combat_v1.glb';
const SABER = '/_lab/jka/weapons/saber/jka_native_single_saber_v1.glb';
type Point = [number, number, number];
const toB = (p: Point) => new Vector3(p[0], p[2], -p[1]);
const fromB = (p: Vector3): Point => [p.x, -p.z, p.y];
type NavFace = { vertices?: Point[]; walkability?: string; room?: string };
const toK = (p: Vector3): Point => [p.x, -p.z, p.y];

type PartyFace = { face: number; vertices: [Point, Point, Point]; walkability: string; material: string; transitions: Array<number | null> };
type PartyRawNav = { rooms: Array<{ resref: string; faces: PartyFace[] }>; pth: any[]; pthEdges?: any[]; roomLinks?: any[]; visibility?: Record<string, string[]>; doors?: any[] };
const PARTY_SECTOR_OFFSET_X = 300;
const partyShift = (point: Point, offsetX = 0): Point => [point[0] + offsetX, point[1], point[2]];
const partyDistance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

function partyHeightAt(x: number, y: number, face: PartyFace) {
  const [a, b, c] = face.vertices;
  const den = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
  if (Math.abs(den) < 1e-9) return null;
  const u = ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (y - c[1])) / den;
  const v = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1])) / den;
  const w = 1 - u - v;
  return Math.min(u, v, w) < -1e-6 ? null : u * a[2] + v * b[2] + w * c[2];
}

function partyClosest2(x: number, y: number, a: Point, b: Point) {
  const dx = b[0] - a[0], dy = b[1] - a[1], length = dx * dx + dy * dy;
  const t = length ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / length)) : 0;
  return { x: a[0] + dx * t, y: a[1] + dy * t, t };
}

function partyProjectFace(x: number, y: number, face: PartyFace) {
  const height = partyHeightAt(x, y, face);
  if (height != null) return { point: [x, y, height] as Point, distance: 0 };
  let best: { point: Point; distance: number } | null = null;
  for (const [a, b] of [[face.vertices[0], face.vertices[1]], [face.vertices[1], face.vertices[2]], [face.vertices[2], face.vertices[0]]] as Array<[Point, Point]>) {
    const q = partyClosest2(x, y, a, b);
    const point: Point = [q.x, q.y, a[2] + (b[2] - a[2]) * q.t];
    const distance = Math.hypot(x - q.x, y - q.y);
    if (!best || distance < best.distance) best = { point, distance };
  }
  return best!;
}

function partyResolve(point: Point, nav: { rooms: Array<{ resref: string; faces: PartyFace[] }> }, walkOnly: boolean, maxH = Infinity, maxV = Infinity, allowedRooms?: string[]): EboHit | null {
  let best: EboHit | null = null;
  const allowed = allowedRooms ? new Set(allowedRooms.map(room => room.toLowerCase())) : null;
  for (const room of nav.rooms) {
    if (allowed && !allowed.has(room.resref.toLowerCase())) continue;
    for (const face of room.faces) {
      if (walkOnly && face.walkability !== 'WALKABLE') continue;
      const projected = partyProjectFace(point[0], point[1], face);
      const vertical = Math.abs(projected.point[2] - point[2]);
      if (projected.distance > maxH || vertical > maxV) continue;
      if (!best || projected.distance < best.dist || (projected.distance === best.dist && vertical < Math.abs(best.height - point[2]))) best = { room: room.resref, face: face.face, material: face.material, height: projected.point[2], walkability: face.walkability, point: projected.point, dist: projected.distance };
    }
  }
  return best;
}

function partyTransformNav(raw: PartyRawNav, offsetX: number): PartyRawNav {
  if (!offsetX) return raw;
  const pthIdOffset = 10000;
  return {
    ...raw,
    rooms: raw.rooms.map(room => ({ ...room, faces: room.faces.map(face => ({ ...face, vertices: face.vertices.map(point => partyShift(point, offsetX)) as PartyFace['vertices'] })) })),
    pth: raw.pth.map(node => ({ ...node, id: Number(node.id) + pthIdOffset, position: partyShift(node.position as Point, offsetX) })),
    pthEdges: (raw.pthEdges ?? []).map(edge => ({ ...edge, from: Number(edge.from) + pthIdOffset, to: Number(edge.to) + pthIdOffset })),
    doors: (raw.doors ?? []).map(door => ({ ...door, position: partyShift(door.position as Point, offsetX) })),
  };
}

function partyEdgeMidpoint(raw: PartyRawNav, roomName: string, edge: any, offsetX: number): Point | null {
  const room = raw.rooms.find(candidate => candidate.resref.toLowerCase() === String(roomName).toLowerCase());
  const face = room?.faces.find(candidate => candidate.face === Number(edge.faceIndex));
  if (!face) return null;
  const index = ((Number(edge.edge) - 1) % face.vertices.length + face.vertices.length) % face.vertices.length;
  const a = face.vertices[index], b = face.vertices[(index + 1) % face.vertices.length];
  return partyShift([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], offsetX);
}

function partyRoomEdges(raw: PartyRawNav, offsetX: number, doors: any[]) {
  const result: any[] = [];
  for (const link of raw.roomLinks ?? []) for (const pair of [
    { from: link.fromRoom, to: link.toRoom, source: link.sourceEdgesAB, target: link.sourceEdgesBA },
    { from: link.toRoom, to: link.fromRoom, source: link.sourceEdgesBA, target: link.sourceEdgesAB },
  ]) {
    const mids = (pair.source ?? []).map((edge: any) => partyEdgeMidpoint(raw, pair.from, edge, offsetX)).filter(Boolean) as Point[];
    const targets = (pair.target ?? []).map((edge: any) => partyEdgeMidpoint(raw, pair.to, edge, offsetX)).filter(Boolean) as Point[];
    if (!mids.length) continue;
    const transitionEdges = mids.map(midpoint => { const target = targets.slice().sort((a, b) => partyDistance(a, midpoint) - partyDistance(b, midpoint))[0]; const separation = target ? partyDistance(target, midpoint) : Infinity; return { midpoint, crossingDirection: target && separation > 0.05 ? [target[0] - midpoint[0], target[1] - midpoint[1]] : undefined }; });
    const door = link.nearestDoor ? doors.find(candidate => candidate.instanceId === link.nearestDoor.id) : null;
    result.push({ connectionType: link.classification ?? 'SOURCE_WOK_ROOM_LINK', directedEvidence: [{ from: pair.from, to: pair.to, transitionEdges }], evidence: [{ transitionMidpoint: transitionEdges[0].midpoint, nearestGitDoor: door ? { id: door.instanceId, tag: door.tag ?? '', distance: link.nearestDoor?.distanceXY ?? 0 } : null }] });
  }
  return result;
}

function partyNav(raw: PartyRawNav, offsetX: number, doors: any[]): EboNav {
  const transformed = partyTransformNav(raw, offsetX);
  const nodes = transformed.pth.map(node => ({ id: node.id, position: node.position, projection: { status: node.projection === 'UNIQUE_ROOM' ? 'PROJECTED' : 'UNPROJECTED', room: node.room, height: node.position[2] }, connections: (raw.pthEdges ?? []).filter(edge => Number(edge.from) === Number(node.id)).map(edge => edge.to) }));
  return { rooms: transformed.rooms.map(room => ({ resref: room.resref, faces: room.faces })), pth: nodes, doors, roomAdjacency: { edges: partyRoomEdges(raw, offsetX, doors) } };
}

function partyNearestPth(point: Point, nav: PartyRawNav, allowedPrefix: string): { point: Point; room: string } | null {
  const prefix = allowedPrefix.toLowerCase();
  const candidates = nav.pth.filter(node => String(node.room ?? '').toLowerCase().startsWith(prefix));
  if (!candidates.length) return null;
  const nearest = candidates.slice().sort((a, b) => partyDistance(a.position as Point, point) - partyDistance(b.position as Point, point))[0];
  return { point: nearest.position as Point, room: nearest.room as string };
}

function pointInTriangle2D(px: number, py: number, a: Point, b: Point, c: Point) {
  const v0x = c[0] - a[0], v0y = c[1] - a[1];
  const v1x = b[0] - a[0], v1y = b[1] - a[1];
  const v2x = px - a[0], v2y = py - a[1];
  const dot00 = v0x * v0x + v0y * v0y;
  const dot01 = v0x * v1x + v0y * v1y;
  const dot02 = v0x * v2x + v0y * v2y;
  const dot11 = v1x * v1x + v1y * v1y;
  const dot12 = v1x * v2x + v1y * v2y;
  const denominator = dot00 * dot11 - dot01 * dot01;
  if (Math.abs(denominator) < 1e-7) return false;
  const u = (dot11 * dot02 - dot01 * dot12) / denominator;
  const v = (dot00 * dot12 - dot01 * dot02) / denominator;
  return u >= -0.001 && v >= -0.001 && u + v <= 1.001;
}

function walkableHeight(sourcePoint: Point, faces: NavFace[]) {
  for (const face of faces) {
    if (face.walkability !== 'WALKABLE' || !face.vertices || face.vertices.length < 3) continue;
    const [a, b, c] = face.vertices;
    if (!pointInTriangle2D(sourcePoint[0], sourcePoint[1], a, b, c)) continue;
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const height = Math.abs(nz) > 1e-7
      ? a[2] - (nx * (sourcePoint[0] - a[0]) + ny * (sourcePoint[1] - a[1])) / nz
      : a[2];
    return { height, room: face.room ?? null };
  }
  return null;
}

function button(label: string, action: () => void) {
  const b = document.createElement('button');
  b.textContent = label;
  b.style.cssText = 'background:#263b4a;color:#fff;border:1px solid #668396;border-radius:4px;padding:6px 8px;cursor:pointer';
  b.onclick = action;
  return b;
}

async function loadJson<T>(name: string): Promise<T> {
  const response = await fetch(BASE + name, { cache: 'no-store' });
  if (!response.ok) throw new Error(`ACADEMY_CANDIDATE_${name}_HTTP_${response.status}`);
  return response.json() as Promise<T>;
}

async function loadDataJson<T>(name: string): Promise<T> {
  const response = await fetch(`/data/${name}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`ACADEMY_DATA_${name}_HTTP_${response.status}`);
  return response.json() as Promise<T>;
}

async function sha256(path: string) {
  const response = await fetch(path, { cache: 'no-store' });
  if (!response.ok) throw new Error(`ACADEMY_CANDIDATE_ASSET_HTTP_${response.status}:${path}`);
  const digest = await crypto.subtle.digest('SHA-256', await response.arrayBuffer());
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}

function sourceNativeSaber(): NativeJkaWeaponDefinition {
  return {
    assetPath: SABER, handSocket: 'rhang_tag_bone', bladeOriginNode: 'JKA_BLADE_SOCKET',
    bladeAxisNode: 'JKA_BLADE_AXIS_NEGATIVE_X', bladeTagSurface: '*blade1', bladeLengthM: .98,
    sourceForwardConvention: 'NEGATIVE_X',
  };
}

type Actor = {
  id: 'AREN_NATIVE_JKA_V1' | 'NARA_NATIVE_JKA_V1';
  short: 'AREN' | 'NARA';
  profile: PlayerCharacterConfig;
  asset: ImportedAsset;
  root: TransformNode;
  visualRoot: TransformNode;
  weapon: WeaponAttachment;
};

function stopAndReady(actor: Actor) {
  actor.asset.animationGroups.forEach(group => group.stop());
  const name = actor.profile.leaderCombatProfile?.groups.saberReady ?? actor.profile.exactLocomotion?.idle ?? 'JKA_IDLE';
  const group = actor.asset.animationGroups.find(candidate => candidate.name === name);
  if (group) group.start(true, 1);
}

function fitActor(actor: Actor) {
  let min = new Vector3(Infinity, Infinity, Infinity), max = new Vector3(-Infinity, -Infinity, -Infinity);
  for (const mesh of actor.asset.meshes) {
    mesh.computeWorldMatrix(true);
    const box = mesh.getBoundingInfo().boundingBox;
    min = Vector3.Minimize(min, box.minimumWorld); max = Vector3.Maximize(max, box.maximumWorld);
  }
  const height = max.y - min.y;
  if (height > 0) actor.visualRoot.scaling.setAll(actor.profile.targetHeightM / height);
  actor.visualRoot.position.y = -(min.y - actor.root.position.y) * actor.visualRoot.scaling.y + (actor.profile.runtimeVisualGroundOffsetM ?? 0);
}

export async function startAcademyPrologueCandidatePreviewLab(canvas = document.getElementById('renderCanvas') as HTMLCanvasElement) {
  document.querySelectorAll('#hud,#questHud,#interactionPrompt,#dialogueOverlay,#fadeOverlay,#debugOverlay,#loadingOverlay,#errorOverlay').forEach(node => node.classList.add('is-hidden'));
  canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:1;touch-action:none';
  const errors: string[] = [];
  window.addEventListener('error', event => errors.push(event.message));
  window.addEventListener('unhandledrejection', event => errors.push(String(event.reason)));
  const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true, antialias: true, adaptToDeviceRatio: true });
  const scene = new Scene(engine);
  scene.useRightHandedSystem = true;
  scene.clearColor = new Color4(.025, .035, .045, 1);
  new HemisphericLight('AcademyCandidateHemi', new Vector3(.2, 1, -.3), scene).intensity = .95;
  const key = new DirectionalLight('AcademyCandidateKey', new Vector3(-.3, -1, .4), scene); key.position.set(20, 40, -20); key.intensity = .8;
  const camera = new ArcRotateCamera('AcademyCandidateCamera', Math.PI * .65, 1.05, 22, new Vector3(90, 2, -80), scene);
  camera.lowerRadiusLimit = 2; camera.upperRadiusLimit = 500; camera.attachControl(canvas, true); scene.activeCamera = camera;

  const [world13, world14, nav14, materials13] = await Promise.all([
    loadJson<any>('jedi_enclave_world.json'), loadJson<any>('jedi_enclave_danm14aa_world.json'), loadJson<any>('jedi_enclave_danm14aa_navigation.json'), loadJson<any>('jedi_enclave_materials.json'),
  ]);
  const nav13 = await loadJson<any>('jedi_enclave_navigation.json');
  const loaded13 = await SceneLoader.ImportMeshAsync('', BASE, 'jedi_enclave_danm13_kotor1.glb', scene);
  const loaded14 = await SceneLoader.ImportMeshAsync('', BASE, 'jedi_enclave_danm14aa_kotor1_candidate_v2.glb', scene);
  const render13 = loaded13.meshes.filter(mesh => mesh.getTotalVertices() > 0);
  applyJediEnclaveMaterials(render13, materials13, { rows: materials13.meshes }, scene, 3);
  const sector13 = new TransformNode('AcademyCandidateSector_danm13', scene);
  const sector14 = new TransformNode('AcademyCandidateSector_danm14aa', scene);
  // Keep the sectors physically separate while preserving each source module's
  // authored coordinates.  This is a candidate preview transform, not a door.
  sector14.position.set(300, 0, 0);
  [...loaded13.meshes, ...loaded13.transformNodes].filter(node => !node.parent).forEach(node => node.parent = sector13);
  [...loaded14.meshes, ...loaded14.transformNodes].filter(node => !node.parent).forEach(node => node.parent = sector14);
  const sectorMeshes = {
    danm13: loaded13.meshes.filter(mesh => mesh.getTotalVertices() > 0) as Mesh[],
    danm14aa: loaded14.meshes.filter(mesh => mesh.getTotalVertices() > 0) as Mesh[],
  };
  const loader = new AssetLoader();
  const [arenAsset, naraAsset] = await Promise.all([loader.load(AREN, scene), loader.load(NARA, scene)]);
  const makeActor = async (id: Actor['id'], short: Actor['short'], profile: PlayerCharacterConfig, asset: ImportedAsset, position: Point) => {
    const root = new TransformNode(`${short}AcademyCandidateRoot`, scene);
    root.position.copyFrom(toB(position));
    const visualRoot = new TransformNode(`${short}AcademyCandidateVisualRoot`, scene); visualRoot.parent = root; asset.root.parent = visualRoot;
    const weapon = new WeaponAttachment(scene, asset, loader, 'rhang_tag_bone', undefined, sourceNativeSaber(), profile.nativeJkaWeaponPresentation);
    await weapon.attach(); weapon.setBladeExtension(1); weapon.setAuthoredAnimationActive(true);
    const actor = { id, short, profile, asset, root, visualRoot, weapon } as Actor;
    fitActor(actor); stopAndReady(actor); return actor;
  };
  const actors = {
    AREN: await makeActor('AREN_NATIVE_JKA_V1', 'AREN', PLAYER_CHARACTERS['aren-native-jka-v1'], arenAsset, [94.1, 43.7, 4.5]),
    NARA: await makeActor('NARA_NATIVE_JKA_V1', 'NARA', PLAYER_CHARACTERS['nara-native-jka-v1'], naraAsset, [96.5, 43.7, 4.5]),
  };
  actors.NARA.root.rotation.y = Math.PI;
  const keys = new Set<string>();
  let sector: 'danm13' | 'danm14aa' = 'danm13';
  let partyFollow = true;
  const sourceTransition = {
    from: { module: 'danm13', doorTag: 'dan13_door03', linkedTo: 'from13', position: [82.17449951171875, 127.64099884033203, 5.074999809265137] },
    to: { module: 'danm14aa', doorTag: 'man14aa_door03', linkedTo: 'from14a', position: [108.5250015258789, 93.9749984741211, 1.5] },
    sourceBacked: true,
  } as const;
  const candidateSectorOffset = new Vector3(300, 0, 0);
  const navFaces = {
    danm13: (nav13.rooms ?? []).flatMap((room: any) => (room.faces ?? []).map((face: any) => ({ ...face, room: room.resref }))) as NavFace[],
    danm14aa: (nav14.rooms ?? []).flatMap((room: any) => (room.faces ?? []).map((face: any) => ({ ...face, room: room.resref }))) as NavFace[],
  };
  let wokRejects = 0;
  let stuckIncidents = 0;
  let blockedPreviousFrame = false;
  let lastMovementBlocked = false;
  const worldOffset = (name: typeof sector) => name === 'danm14aa' ? candidateSectorOffset : Vector3.Zero();
  const projectToWok = (position: Vector3, name: typeof sector) => {
    const source = toK(position.subtract(worldOffset(name)));
    const hit = walkableHeight(source, navFaces[name]);
    if (hit === null) return null;
    const projected = position.clone(); projected.y = hit.height;
    return { position: projected, room: hit.room };
  };
  const moveOnWok = (actor: Actor, delta: Vector3) => {
    const candidate = actor.root.position.add(delta);
    const projected = projectToWok(candidate, sector);
    if (!projected) {
      wokRejects += 1; lastMovementBlocked = true; return false;
    }
    actor.root.position.copyFrom(projected.position); actorRooms[actor.short] = projected.room; lastMovementBlocked = false; return true;
  };
  const startPositions = {
    danm13: { aren: toB([...sourceTransition.from.position] as Point), nara: toB([84.17449951171875, 127.64099884033203, 5.074999809265137]) },
    danm14aa: { aren: toB([...sourceTransition.to.position] as Point).add(candidateSectorOffset), nara: toB([110.5250015258789, 93.9749984741211, 1.5]).add(candidateSectorOffset) },
  };
  const actorRooms: Record<'AREN' | 'NARA', string | null> = { AREN: null, NARA: null };
  const setSector = (next: typeof sector) => {
    sector = next;
    const positions = startPositions[next];
    actors.AREN.root.position.copyFrom(positions.aren); actors.NARA.root.position.copyFrom(positions.nara);
    const meshes = next === 'danm13' ? sectorMeshes.danm13 : sectorMeshes.danm14aa;
    const other = next === 'danm13' ? sectorMeshes.danm14aa : sectorMeshes.danm13;
    meshes.forEach(mesh => mesh.setEnabled(true)); other.forEach(mesh => mesh.setEnabled(false));
    camera.target.copyFrom(positions.aren.add(new Vector3(0, 1, 0))); camera.radius = next === 'danm13' ? 22 : 32;
    lastMovementBlocked = false;
    actorRooms.AREN = projectToWok(actors.AREN.root.position, next)?.room ?? null;
    actorRooms.NARA = projectToWok(actors.NARA.root.position, next)?.room ?? null;
  };
  const transitionThroughSourceDoor = () => {
    // This is the candidate route's explicit source-backed module transfer.
    // Entry placement is derived from the reciprocal GIT door records; it is
    // not a gameplay teleport or a replacement for room navigation.
    const door = sector === 'danm13' ? sourceTransition.from.position : sourceTransition.to.position;
    const doorWorld = toB([...door] as Point).add(worldOffset(sector));
    if (Vector3.Distance(actors.AREN.root.position, doorWorld) > 5) return;
    setSector(sector === 'danm13' ? 'danm14aa' : 'danm13');
  };
  setSector('danm13');

  const panel = document.createElement('div');
  panel.id = 'academyPrologueCandidatePanel';
  panel.style.cssText = 'position:fixed;top:14px;left:14px;z-index:50;background:#101922e8;color:#f2ead4;padding:14px;border:1px solid #8c7650;border-radius:8px;font:12px system-ui;max-width:370px;max-height:90vh;overflow:auto';
  panel.innerHTML = '<strong>KOTOR I · ACADEMY PROLOGUE CANDIDATE</strong><div style="color:#b8c4cc;margin:4px 0 8px">danm13 interior + danm14aa courtyard · opt-in world candidate</div>';
  const controls = document.createElement('div'); controls.style.cssText = 'display:grid;grid-template-columns:repeat(2,minmax(120px,1fr));gap:5px'; panel.appendChild(controls);
  controls.append(button('INTERIOR · DANM13', () => setSector('danm13')));
  controls.append(button('COURTYARD · DANM14AA', () => setSector('danm14aa')));
  controls.append(button('SOURCE DOOR TRANSITION', transitionThroughSourceDoor));
  controls.append(button('RESET PARTY', () => setSector(sector)));
  controls.append(button('TOGGLE FOLLOW', () => { partyFollow = !partyFollow; }));
  const status = document.createElement('pre'); status.style.cssText = 'white-space:pre-wrap;font:11px monospace;margin:10px 0 0'; panel.appendChild(status);
  document.body.appendChild(panel);
  const onKeyDown = (event: KeyboardEvent) => {
    keys.add(event.key.toLowerCase());
    if (event.key.toLowerCase() === 'e') transitionThroughSourceDoor();
  };
  const onKeyUp = (event: KeyboardEvent) => keys.delete(event.key.toLowerCase());
  window.addEventListener('keydown', onKeyDown); window.addEventListener('keyup', onKeyUp);
  let last = performance.now(), distance = 0, followDistance = 0;
  const state = () => ({ status: 'READY', route: 'ACADEMY_PROLOGUE_V1', sector, logicalSector: sector, actorSector: sector, cameraSector: sector, renderSector: sector, sectorModules: ['danm13', 'danm14aa'], party: [{ id: actors.AREN.id, role: 'PARTY', position: actors.AREN.root.position.asArray(), room: actorRooms.AREN }, { id: actors.NARA.id, role: 'PARTY', position: actors.NARA.root.position.asArray(), room: actorRooms.NARA }], jolee: 'NOT_LOADED_BY_CANDIDATE_ROUTE', actorCount: 2, saberCount: 2, world: { danm13Rooms: world13.rooms?.length ?? 0, danm14aaRooms: world14.rooms?.length ?? 0, danm13WokFaces: navFaces.danm13.length, danm14aaWokFaces: navFaces.danm14aa.length, danm14aaPthNodes: nav14.pth?.length ?? 0, danm14aaVisRooms: Object.keys(nav14.visibility ?? {}).length }, navigation: { sourceSidecarsLoaded: true, runtimePartyAdapter: 'W238_0A1B_WOK_PROJECTED_CANDIDATE', sourceTransition, movementAuthority: 'WOK_WALKABLE_FACE_PROJECTION', lastMovementBlocked, wokRejects, stuckIncidents }, errors });
  (window as any).__academyPrologueCandidateState = state;
  (window as any).__academyPrologueCandidate = { state, setSector, toggleFollow: () => { partyFollow = !partyFollow; } };
  engine.runRenderLoop(() => {
    const now = performance.now(), dt = Math.min(.05, (now - last) / 1000); last = now;
    const dir = new Vector3((keys.has('d') ? 1 : 0) - (keys.has('a') ? 1 : 0), 0, (keys.has('s') ? 1 : 0) - (keys.has('w') ? 1 : 0));
    if (dir.lengthSquared() > 0) {
      dir.normalize().scaleInPlace(2.2 * dt);
      const moved = moveOnWok(actors.AREN, dir);
      if (moved) distance += dir.length();
      const walkClip = actors.AREN.profile.exactLocomotion?.walk;
      const active = actors.AREN.asset.animationGroups.find(group => group.isPlaying);
      if (moved && walkClip && active?.name !== walkClip) { actors.AREN.asset.animationGroups.forEach(group => group.stop()); actors.AREN.asset.animationGroups.find(group => group.name === walkClip)?.start(true, 1); }
      if (!moved && !blockedPreviousFrame) stuckIncidents += 1;
      blockedPreviousFrame = !moved;
      if (partyFollow) { const desired = actors.AREN.root.position.subtract(new Vector3(0, 0, 1.8)); const delta = desired.subtract(actors.NARA.root.position); if (delta.length() > .05) { const step = Math.min(delta.length(), 2.0 * dt); const followerMoved = moveOnWok(actors.NARA, delta.normalize().scale(step)); if (followerMoved) followDistance += step; } }
      camera.target.copyFrom(actors.AREN.root.position.add(new Vector3(0, 1, 0)));
    } else if (actors.AREN.asset.animationGroups.some(group => group.isPlaying && group.name === actors.AREN.profile.exactLocomotion?.walk)) stopAndReady(actors.AREN);
    status.textContent = `SECTOR ${sector.toUpperCase()}\nAREN/NARA native JKA · party 2\nAren ${actors.AREN.root.position.asArray().map(v => v.toFixed(2)).join(', ')} · ${actorRooms.AREN ?? 'room unresolved'}\nNara ${actors.NARA.root.position.asArray().map(v => v.toFixed(2)).join(', ')} · ${actorRooms.NARA ?? 'room unresolved'}\nFollow ${partyFollow ? 'ON' : 'OFF'} · move ${distance.toFixed(1)} m\nWOK faces ${state().world.danm14aaWokFaces} · PTH ${state().world.danm14aaPthNodes} · VIS ${state().world.danm14aaVisRooms} rooms\nWOK rejects ${wokRejects} · stuck ${stuckIncidents}\nSOURCE DOOR: E / button near reciprocal GIT entry\nSOURCE TRANSITION: DANM13/dan13_door03 ↔ DANM14AA/man14aa_door03`;
    scene.render();
  });
  window.addEventListener('resize', () => engine.resize());
  await scene.whenReadyAsync();
  document.getElementById('loadingOverlay')?.classList.add('is-hidden');
  return state();
}

/** W238.0A.1C: production-candidate route backed by the shared party runtime. */
export async function startAcademyPrologueCandidateLab(canvas = document.getElementById('renderCanvas') as HTMLCanvasElement) {
  document.querySelectorAll('#hud,#questHud,#interactionPrompt,#dialogueOverlay,#fadeOverlay,#debugOverlay,#loadingOverlay,#errorOverlay').forEach(node => node.classList.add('is-hidden'));
  const setLoadPhase = (phase: string) => {
    (window as any).__academyPrologueLoadPhase = phase;
    document.documentElement.dataset.academyLoadPhase = phase;
    document.title = `Nerathis — Academy ${phase}`;
  };
  setLoadPhase('ENGINE_INITIALIZING');
  canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:1;touch-action:none';
  const errors: string[] = [];
  const academyLoadStartedAt = performance.now();
  const onError = (event: ErrorEvent) => errors.push(event.message);
  const onRejection = (event: PromiseRejectionEvent) => errors.push(String(event.reason));
  window.addEventListener('error', onError); window.addEventListener('unhandledrejection', onRejection);
  const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true, antialias: true, adaptToDeviceRatio: true });
  const scene = new Scene(engine); scene.useRightHandedSystem = true; scene.clearColor = new Color4(.025, .035, .045, 1);
  new HemisphericLight('AcademyCandidateHemi', new Vector3(.2, 1, -.3), scene).intensity = .95;
  const key = new DirectionalLight('AcademyCandidateKey', new Vector3(-.3, -1, .4), scene); key.position.set(20, 40, -20); key.intensity = .8;
  setLoadPhase('SIDECARS_LOADING');
  const [world13, world14, raw13, raw14, materials13] = await Promise.all([
    loadJson<any>('jedi_enclave_world.json'), loadJson<any>('jedi_enclave_danm14aa_world.json'),
    loadJson<PartyRawNav>('jedi_enclave_navigation.json'), loadJson<PartyRawNav>('jedi_enclave_danm14aa_navigation.json'),
    loadJson<any>('jedi_enclave_materials.json'),
  ]);
  setLoadPhase('DANM13_GLB_LOADING');
  const loaded13 = await SceneLoader.ImportMeshAsync('', BASE, 'jedi_enclave_danm13_kotor1.glb', scene);
  setLoadPhase('DANM14AA_GLB_LOADING');
  const loaded14 = await SceneLoader.ImportMeshAsync('', BASE, 'jedi_enclave_danm14aa_kotor1_candidate_v2.glb', scene);
  const render13 = loaded13.meshes.filter(mesh => mesh.getTotalVertices() > 0) as Mesh[];
  const render14 = loaded14.meshes.filter(mesh => mesh.getTotalVertices() > 0) as Mesh[];
  applyJediEnclaveMaterials(render13, materials13, { rows: materials13.meshes }, scene, 3);
  const hdEnabled = new URLSearchParams(window.location.search).get('hdDantooine') === '1';
  let hdOverlay: { mode: string; applied: unknown[]; skipped: unknown[]; metrics?: Record<string, unknown> } | null = null;
  if (hdEnabled) {
    const hdRegistry = await loadDataJson<AcademyHdOverrideRegistry>('w238_0a2f_material_override_registry.json');
    hdOverlay = applyJediEnclaveHdOverrides([...render13, ...render14], hdRegistry, scene);
  }
  const sector13 = new TransformNode('AcademyCandidateSector_danm13', scene), sector14 = new TransformNode('AcademyCandidateSector_danm14aa', scene);
  sector14.position.x = PARTY_SECTOR_OFFSET_X;
  [...loaded13.meshes, ...loaded13.transformNodes].filter(node => !node.parent).forEach(node => node.parent = sector13);
  [...loaded14.meshes, ...loaded14.transformNodes].filter(node => !node.parent).forEach(node => node.parent = sector14);
  const byRoom = new Map<string, Mesh[]>();
  for (const mesh of [...render13, ...render14]) { const match = /^Room_([^:]+)::/i.exec(mesh.name); if (match) byRoom.set(match[1].toLowerCase(), [...(byRoom.get(match[1].toLowerCase()) ?? []), mesh]); }
  const doors = [...(world13.doors ?? []), ...(world14.doors ?? [])];
  const transformed14 = partyTransformNav(raw14, PARTY_SECTOR_OFFSET_X);
  const combined: PartyRawNav = {
    rooms: [...raw13.rooms, ...transformed14.rooms],
    pth: [...raw13.pth, ...transformed14.pth],
    pthEdges: [...(raw13.pthEdges ?? []), ...(transformed14.pthEdges ?? [])],
    roomLinks: [...(raw13.roomLinks ?? []), ...(transformed14.roomLinks ?? [])],
    visibility: { ...(raw13.visibility ?? {}), ...(transformed14.visibility ?? {}) }, doors,
  };
  const fromRoom = 'm13aa_12a', toRoom = 'm14aa_01g';
  const fromDoor = doors.find(door => door.tag === 'dan13_door03');
  const toDoor = doors.find(door => door.tag === 'man14aa_door03');
  if (!fromDoor || !toDoor) throw new Error('ACADEMY_CANDIDATE_SOURCE_DOOR_METADATA_MISSING');
  const crossEdges = {
    connectionType: 'RECIPROCAL_MODULE_TRANSITION_DOOR',
    directedEvidence: [
      { from: fromRoom, to: toRoom, transitionEdges: [{ midpoint: partyShift(fromDoor.position), crossingDirection: [0, 1] }] },
      { from: toRoom, to: fromRoom, transitionEdges: [{ midpoint: partyShift(toDoor.position, PARTY_SECTOR_OFFSET_X), crossingDirection: [0, -1] }] },
    ],
    evidence: [
      { transitionMidpoint: partyShift(fromDoor.position), nearestGitDoor: { id: fromDoor.instanceId, tag: fromDoor.tag, distance: 0 } },
      { transitionMidpoint: partyShift(toDoor.position, PARTY_SECTOR_OFFSET_X), nearestGitDoor: { id: toDoor.instanceId, tag: toDoor.tag, distance: 0 } },
    ],
  };
  const nav = partyNav(combined, 0, doors); nav.roomAdjacency.edges.push(crossEdges);
  const forwardArrival = partyNearestPth(partyShift(toDoor.position, PARTY_SECTOR_OFFSET_X), combined, 'm14aa_');
  const reverseArrival = partyNearestPth(fromDoor.position, combined, 'm13aa_');
  if (!forwardArrival || !reverseArrival) throw new Error('ACADEMY_CANDIDATE_SOURCE_ARRIVAL_PTH_MISSING');
  const spawn = partyResolve([94.104774, 43.660042, 4.486984], combined, true, 3, 1.25, ['m13aa_04a']);
  if (!spawn) throw new Error('ACADEMY_CANDIDATE_SPAWN_UNRESOLVED');
  const semanticBounds = [...byRoom.values()].map(meshes => { let min = new Vector3(Infinity, Infinity, Infinity), max = new Vector3(-Infinity, -Infinity, -Infinity); for (const mesh of meshes) { mesh.computeWorldMatrix(true); const box = mesh.getBoundingInfo().boundingBox; min = Vector3.Minimize(min, box.minimumWorld); max = Vector3.Maximize(max, box.maximumWorld); } return Number.isFinite(min.x) ? { min, max } : null; }).filter((bounds): bounds is { min: Vector3; max: Vector3 } => Boolean(bounds));
  let visFallbacks = 0, previousFallback = false, currentRoom = spawn.room;
  const updateVisibility = (renderPosition: Vector3, preferredHit?: EboHit | null) => {
    const hit = preferredHit ?? partyResolve(fromB(renderPosition), combined, true, 1.25, 7);
    const names = hit && combined.visibility?.[hit.room] ? [hit.room, ...combined.visibility[hit.room]] : null;
    const fallback = !hit || !names; if (fallback && !previousFallback) visFallbacks++; previousFallback = fallback; currentRoom = hit?.room ?? currentRoom;
    const visible = new Set((names ?? [...byRoom.keys()]).map(room => room.toLowerCase()));
    for (const [room, meshes] of byRoom) for (const mesh of meshes) mesh.setEnabled(visible.has(room));
    return { room: hit?.room ?? null, visibleRooms: [...visible], enabledMeshes: [...byRoom.entries()].reduce((count, [room, meshes]) => count + (visible.has(room) ? meshes.length : 0), 0), fallback, fallbackCount: visFallbacks };
  };
  setLoadPhase('PARTY_RUNTIME_LOADING');
  const adapter = await EbonHawkPartyAdapter.create({
    scene, canvas, nav, spawn,
    resolve: (point, walk, maxH, maxV, rooms) => partyResolve(point, combined, walk, maxH, maxV, rooms),
    updateVisibility, semanticBounds, companions: ['Nara'],
    leaderProfile: PLAYER_CHARACTERS['aren-native-jka-v1'], naraJkaProfile: PLAYER_CHARACTERS['nara-native-jka-v1'],
  });
  adapter.enableControlSwap();
  const loader = new AssetLoader(), saber = sourceNativeSaber();
  const attach = async (asset: ImportedAsset) => {
    const weapon = new WeaponAttachment(scene, asset, loader, 'rhang_tag_bone', undefined, saber, PLAYER_CHARACTERS['aren-native-jka-v1'].nativeJkaWeaponPresentation);
    await weapon.attach();
    // Exploration starts with the native hilt attached but the blade retracted.
    // Combat remains the only layer allowed to request an authored saber pose.
    weapon.setBladeExtension(0);
    weapon.setAuthoredAnimationActive(true);
    return weapon;
  };
  setLoadPhase('WEAPON_ATTACHMENTS_LOADING');
  const arenWeapon = await attach((adapter as any).playersAsset as ImportedAsset);
  const naraFollower = adapter.followers.find(follower => follower.id === 'Nara');
  const naraWeapon = naraFollower ? await attach(naraFollower.asset) : null;
  type SaberRuntimeState = 'OFF' | 'IGNITING' | 'ON' | 'RETRACTING';
  const saberRuntime = {
    AREN: { state: 'OFF' as SaberRuntimeState, extension: 0, target: 0, elapsed: 0 },
    NARA: { state: 'OFF' as SaberRuntimeState, extension: 0, target: 0, elapsed: 0 },
  };
  const setSaberPose = (actor: 'AREN' | 'NARA', enabled: boolean) => {
    if (actor === 'AREN') adapter.player.setCombatReadyPose(enabled);
    else (naraFollower as any)?.setArmed(enabled);
  };
  const requestSaber = (actor: 'AREN' | 'NARA', enabled: boolean) => {
    const runtime = saberRuntime[actor];
    if ((enabled && (runtime.state === 'ON' || runtime.state === 'IGNITING')) || (!enabled && (runtime.state === 'OFF' || runtime.state === 'RETRACTING'))) return;
    runtime.state = enabled ? 'IGNITING' : 'RETRACTING';
    runtime.target = enabled ? 1 : 0;
    runtime.elapsed = 0;
    setSaberPose(actor, enabled);
  };
  const updateSaber = (deltaSeconds: number) => {
    for (const actor of ['AREN', 'NARA'] as const) {
      const runtime = saberRuntime[actor];
      if (runtime.state !== 'IGNITING' && runtime.state !== 'RETRACTING') continue;
      runtime.elapsed = Math.min(0.28, runtime.elapsed + deltaSeconds);
      const progress = Math.min(1, runtime.elapsed / 0.28);
      runtime.extension = runtime.state === 'IGNITING' ? progress : 1 - progress;
      const weapon = actor === 'AREN' ? arenWeapon : naraWeapon;
      weapon?.setBladeExtension(runtime.extension);
      if (progress >= 1) runtime.state = runtime.target > 0 ? 'ON' : 'OFF';
    }
  };
  const tacticalPause = new TacticalPauseController(); const unbindPause = adapter.bindTacticalPause(tacticalPause);
  let currentSector = 'danm13', doorTransitions = 0, lastCommandResult = 'NONE', lastDoorResult = 'NONE';
  let lastNpcInteraction = 'NONE';
  const belayaDialogue = new BelayaDialogueV1();
  const npcPopulationMode = new URLSearchParams(window.location.search).get('npcPopulation') === '1';
  const npcManifestName = npcPopulationMode
    ? 'w238_0a2d_npc_population_manifest.json'
    : 'w238_0a2_npc_appearance_manifest.json';
  setLoadPhase('NPC_MANIFEST_LOADING');
  const npcManifest = await loadDataJson<{ records: AcademyNpcRuntimeRecord[] }>(npcManifestName);
  const spawnClassification = await loadDataJson<{ records: Array<{ stableNpcId: string; module: string; spawnPolicy?: string }> }>('w238_0a2d_spawn_classification.json');
  const npcRecords = npcManifest.records.filter(record => record.runtimeReady && Boolean(record.assetPath));
  const sourceNpcIds = new Set(npcRecords.map(record => record.stableNpcId));
  const sourceNpcWithheld = spawnClassification.records.filter(record => !sourceNpcIds.has(record.stableNpcId));
  const resolveNpcSpawn = (record: AcademyNpcRuntimeRecord) => {
    const offset = record.module.toLowerCase() === 'danm14aa' ? PARTY_SECTOR_OFFSET_X : 0;
    const sourcePoint = partyShift(record.sourcePosition, offset);
    const allowedRooms = record.sourceRoom ? [record.sourceRoom] : undefined;
    const hit = partyResolve(sourcePoint, combined, true, 3, 4, allowedRooms);
    if (!hit) return null;
    return {
      module: record.module,
      sourcePosition: record.sourcePosition,
      renderPosition: toB(hit.point),
      room: hit.room,
      face: hit.face,
      floorY: hit.height,
      confidence: 'WOK_PROJECTED_SOURCE_POSITION',
    };
  };
  const createNpcPopulation = () => AcademyNpcPopulation.create({
    scene,
    loader,
    records: npcRecords,
    resolveSpawn: resolveNpcSpawn,
    onInteraction: (instance) => {
      lastNpcInteraction = `TRIGGERED:${instance.record.stableNpcId}:${instance.record.conversationResRef ?? 'NO_DLG'}`;
      if (instance.record.stableNpcId === BELAYA_SOURCE_NPC_ID) belayaDialogue.open(instance);
    },
  });
  setLoadPhase('NPC_POPULATION_LOADING');
  let npcPopulation = await createNpcPopulation();
  let showcaseEnabled = new URLSearchParams(window.location.search).get('npcShowcase') !== '0';
  const showcaseDebugMarkers = new URLSearchParams(window.location.search).get('npcMarkers') === '1';
  const showcaseRegistry = await loadDataJson<{ records: AcademyNpcRuntimeRecord[] }>('w238_0a2h2_final_npc_showcase_registry.json');
  const showcaseRecords = showcaseRegistry.records
    .filter(record => record.runtimeReady && Boolean(record.assetPath))
    // The showcase is deliberately not a source GIT population. Normalize
    // provenance at the integration boundary as a guard against stale
    // manifests that copied the model-ready default.
    .map(record => ({ ...record, populationKind: 'PLAYTEST_AMBIENT' as const, interactionPolicy: 'PLAYTEST_INSPECT' as const }));
  const createShowcasePopulation = () => AcademyNpcPopulation.create({
    scene,
    loader,
    records: showcaseEnabled ? showcaseRecords : [],
    resolveSpawn: resolveNpcSpawn,
    debugMarkers: showcaseDebugMarkers,
    onInteraction: (instance) => { lastNpcInteraction = `INSPECTED:PLAYTEST_AMBIENT:${instance.record.stableNpcId}:${instance.record.displayName}`; },
  });
  let showcasePopulation = await createShowcasePopulation();
  const orientShowcaseCamera = () => {
    if (!showcaseEnabled) return;
    const spawnActors = showcasePopulation.actors.filter(actor => actor.record.module.toLowerCase() === 'danm13' && actor.record.sourceRoom === 'm13aa_04a');
    if (!spawnActors.length) return;
    const center = spawnActors.reduce((sum, actor) => sum.add(actor.root.getAbsolutePosition()), Vector3.Zero()).scale(1 / spawnActors.length);
    const player = adapter.player.root.getAbsolutePosition();
    const dx = center.x - player.x, dz = center.z - player.z;
    if (Math.hypot(dx, dz) > 0.1) adapter.camera.yaw = Math.atan2(dx, -dz);
    adapter.camera.pitch = 0.36;
    adapter.camera.distance = Math.min(adapter.camera.distance, 2.25);
  };
  orientShowcaseCamera();
  const toggleShowcase = async () => {
    showcaseEnabled = !showcaseEnabled;
    showcasePopulation.dispose();
    showcasePopulation = await createShowcasePopulation();
    showcasePopulation.setModuleEnabled(currentSector);
  };
  const npcLifecycle = { requested: new URLSearchParams(window.location.search).get('npcLifecycle') === '1' ? 10 : 0, completed: 0, actorCounts: [] as number[], duplicateNpcIds: 0, observerLeakDelta: 0, animationWriterLeakDelta: 0 };
  for (let cycle = 0; cycle < npcLifecycle.requested; cycle += 1) {
    npcPopulation.dispose();
    npcPopulation = await createNpcPopulation();
    showcasePopulation.dispose();
    showcasePopulation = await createShowcasePopulation();
    npcLifecycle.completed += 1;
    npcLifecycle.actorCounts.push(npcPopulation.actors.length + showcasePopulation.actors.length);
  }
  const setSectorMeshes = (name: string) => { currentSector = name; const prefix = name === 'danm13' ? 'm13aa_' : 'm14aa_'; for (const [room, meshes] of byRoom) meshes.forEach(mesh => mesh.setEnabled(room.startsWith(prefix))); npcPopulation.setModuleEnabled(name); showcasePopulation.setModuleEnabled(name); };
  const transition = () => {
    const reverse = currentSector === 'danm14aa', active = adapter.interactionOrigin();
    const door = reverse ? toDoor : fromDoor; const doorWorld = toB(partyShift(door.position, reverse ? PARTY_SECTOR_OFFSET_X : 0));
    if (Vector3.Distance(active, doorWorld) > 5) { lastDoorResult = `OUT_OF_RANGE:${Vector3.Distance(active, doorWorld).toFixed(2)}`; return false; }
    const arrival = reverse ? reverseArrival : forwardArrival;
    const destination = partyResolve(arrival.point, combined, true, 1.5, 3, [arrival.room]);
    if (!destination) { lastDoorResult = 'DESTINATION_WOK_UNRESOLVED'; return false; }
    const followerDestination = partyResolve(arrival.point, combined, true, 2.5, 3, [arrival.room]);
    if (!followerDestination) { lastDoorResult = 'FOLLOWER_DESTINATION_WOK_UNRESOLVED'; return false; }
    adapter.applySourceTransition(destination, naraFollower ? [{ id: 'Nara', hit: followerDestination }] : []);
    setSectorMeshes(reverse ? 'danm13' : 'danm14aa'); doorTransitions++; lastDoorResult = reverse ? 'RETURN_DANM13_FROM14A' : 'FORWARD_DANM14AA_FROM13'; return true;
  };
  const panel = document.createElement('div'); panel.id = 'academyPrologueCandidatePanel'; panel.style.cssText = 'position:fixed;top:12px;left:12px;z-index:50;background:#101922d9;color:#f2ead4;padding:8px 10px;border:1px solid #8c7650;border-radius:8px;font:11px system-ui;max-width:300px;max-height:74vh;overflow:auto;backdrop-filter:blur(5px)';
  panel.innerHTML = '<strong>KOTOR I · ACADEMY</strong><div style="color:#b8c4cc;margin:3px 0 6px">F8 DEV · F6 NPCs · F1 controls</div>';
  const devControls = document.createElement('div'); devControls.hidden = true; devControls.style.cssText = 'margin-top:4px'; panel.appendChild(devControls);
  const controls = document.createElement('div'); controls.style.cssText = 'display:grid;grid-template-columns:repeat(2,minmax(118px,1fr));gap:4px'; devControls.appendChild(controls);
  controls.append(button('E · SOURCE DOOR', () => transition())); controls.append(button('PAUSE / RESUME', () => tacticalPause.toggle()));
  controls.append(button('MOVE TO COURTYARD', () => {
    if (currentSector === 'danm13') { lastCommandResult = 'SOURCE_DOOR_REQUIRED:dan13_door03'; return; }
    const hit = partyResolve(forwardArrival.point, combined, true, 1.5, 3, [forwardArrival.room]);
    lastCommandResult = hit ? 'SOURCE_DOOR_APPROACH_RUNNING' : 'TARGET_NOT_WALKABLE';
    if (hit) void adapter.runRouteTo(hit.point, forwardArrival.room).then(result => { lastCommandResult = JSON.stringify(result); });
  }));
  controls.append(button('MOVE TO INTERIOR', () => {
    const hit = partyResolve(reverseArrival.point, combined, true, 1.5, 3, [reverseArrival.room]);
    lastCommandResult = hit ? 'SOURCE_DOOR_APPROACH_RUNNING' : 'TARGET_NOT_WALKABLE';
    if (hit) void adapter.runRouteTo(hit.point, reverseArrival.room).then(result => { lastCommandResult = JSON.stringify(result); });
  }));
  controls.append(button('MOVE TO NPC', () => {
    const target = npcPopulation.actors.find(actor => actor.record.module.toLowerCase() === currentSector.toLowerCase() && actor.record.conversationResRef);
    if (!target) { lastCommandResult = 'NO_INTERACTABLE_NPC_IN_SECTOR'; return; }
    const sourcePoint = fromB(target.root.getAbsolutePosition());
    const hit = partyResolve(sourcePoint, combined, true, 2, 4, [target.room ?? '']);
    lastCommandResult = hit ? `NPC_APPROACH:${target.record.stableNpcId}` : 'NPC_TARGET_NOT_WALKABLE';
    if (hit) void adapter.runRouteTo(hit.point, target.room ?? '').then(result => { lastCommandResult = JSON.stringify(result); });
  }));
  controls.append(button('MOVE TO SOURCE DOOR', () => {
    const door = currentSector === 'danm13' ? fromDoor : toDoor;
    const arrival = currentSector === 'danm13' ? reverseArrival : forwardArrival;
    // Approach the source-backed arrival PTH point.  The rendered door can sit
    // on a non-walkable threshold, so using the nearest valid face at the
    // authored door transform can leave the player outside interaction range.
    const hit = partyResolve(arrival.point, combined, true, 1.5, 3, [arrival.room]);
    lastCommandResult = hit ? `DOOR_APPROACH:${door.tag}` : 'DOOR_TARGET_NOT_WALKABLE';
    if (hit) void adapter.runRouteTo(hit.point, arrival.room).then(result => { lastCommandResult = JSON.stringify(result); });
  }));
  controls.append(button('Q · SABER TOGGLE', () => requestSaber(adapter.controlledActorId === 'NARA' ? 'NARA' : 'AREN', saberRuntime[adapter.controlledActorId === 'NARA' ? 'NARA' : 'AREN'].target < 0.5)));
  controls.append(button('AMBIENT NPCS: ON/OFF', () => { void toggleShowcase(); }));
  controls.append(button('F6 · NPC LOCATOR', () => { locator.hidden = !locator.hidden; }));
  controls.append(button('F1 · CONTROLS', () => { help.hidden = !help.hidden; }));
  const diagnostics = document.createElement('details'); diagnostics.style.cssText = 'margin-top:8px';
  diagnostics.innerHTML = '<summary>DEV diagnostics</summary>';
  const diagnosticsText = document.createElement('pre'); diagnosticsText.style.cssText = 'white-space:pre-wrap;font:10px monospace;max-height:260px;overflow:auto;margin:6px 0 0'; diagnostics.appendChild(diagnosticsText); devControls.appendChild(diagnostics);
  const sourceAudit = document.createElement('div'); sourceAudit.style.cssText = 'color:#b8c4cc;margin-top:5px;font:10px monospace'; sourceAudit.textContent = `SOURCE NPCs: ${npcRecords.length} active · ${sourceNpcWithheld.length}/${spawnClassification.records.length} withheld`; devControls.appendChild(sourceAudit);
  const help = document.createElement('div'); help.hidden = true; help.style.cssText = 'margin-top:6px;color:#d7e3e8;font:10px monospace;white-space:pre-wrap'; help.textContent = 'WASD move · mouse drag camera · wheel zoom\nQ ignite/retract controlled saber\nE inspect NPC / use source door\nP pause · TAB control swap\nF6 locator · F8 diagnostics · F9 screenshot'; devControls.appendChild(help);
  const status = document.createElement('pre'); status.style.cssText = 'white-space:pre-wrap;font:10px monospace;margin:7px 0 0;line-height:1.3'; panel.appendChild(status);
  const locator = document.createElement('div'); locator.hidden = true; locator.style.cssText = 'position:fixed;right:12px;top:12px;z-index:51;background:#101922e8;color:#f2ead4;padding:9px;border:1px solid #668396;border-radius:8px;font:10px monospace;max-width:330px;max-height:60vh;overflow:auto;white-space:pre-wrap'; document.body.appendChild(locator);
  document.body.appendChild(panel);
  const onKeyDown = (event: KeyboardEvent) => {
    const key = event.key.toLowerCase();
    if (key === 'q' && !event.repeat) { event.preventDefault(); requestSaber(adapter.controlledActorId === 'NARA' ? 'NARA' : 'AREN', saberRuntime[adapter.controlledActorId === 'NARA' ? 'NARA' : 'AREN'].target < 0.5); }
    if (key === 'e') { if (belayaDialogue.isOpen) return; if (npcPopulation.triggerNearest(adapter.interactionOrigin(), 2.8) || showcasePopulation.triggerNearest(adapter.interactionOrigin(), 2.8)) return; transition(); }
    if (key === 'p') tacticalPause.toggle();
    if (key === 'f6') { event.preventDefault(); locator.hidden = !locator.hidden; }
    if (key === 'f1') { event.preventDefault(); help.hidden = !help.hidden; }
    if (key === 'f8') { event.preventDefault(); devControls.hidden = !devControls.hidden; }
  };
  window.addEventListener('keydown', onKeyDown);
  const sourceTransition = { from: { module: 'danm13', doorTag: 'dan13_door03', linkedTo: 'from13', position: fromDoor.position }, to: { module: 'danm14aa', doorTag: 'man14aa_door03', linkedTo: 'from14a', position: toDoor.position }, sourceBacked: true };
  const ambientVisualAudit = () => {
    const camera = adapter.camera.camera;
    const viewport = camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight());
    const transform = camera.getTransformationMatrix();
    const playerPosition = adapter.interactionOrigin();
    return showcasePopulation.actors.map(actor => {
      let min = new Vector3(Infinity, Infinity, Infinity), max = new Vector3(-Infinity, -Infinity, -Infinity);
      let visibleMeshes = 0, enabledMeshes = 0, inFrustumMeshes = 0;
      const materialNames = new Set<string>(), textureNames = new Set<string>();
      for (const mesh of actor.asset.meshes) {
        mesh.computeWorldMatrix(true);
        const box = mesh.getBoundingInfo().boundingBox;
        min = Vector3.Minimize(min, box.minimumWorld); max = Vector3.Maximize(max, box.maximumWorld);
        if (mesh.isVisible) visibleMeshes++; if (mesh.isEnabled()) enabledMeshes++;
        if (camera.isInFrustum(mesh)) inFrustumMeshes++;
        const material: any = mesh.material; if (material?.name) materialNames.add(material.name);
        const albedo = material?.albedoTexture ?? material?.diffuseTexture; if (albedo?.name) textureNames.add(albedo.name);
      }
      const center = min.add(max).scale(0.5);
      const p0 = Vector3.Project(min, Matrix.Identity(), transform, viewport), p1 = Vector3.Project(max, Matrix.Identity(), transform, viewport);
      const enabled = actor.root.isEnabled() && actor.visualRoot.isEnabled() && actor.asset.root.isEnabled();
      return {
        stableNpcId: actor.record.stableNpcId, displayName: actor.record.displayName, sourceAppearanceRow: actor.record.sourceAppearanceRow ?? null,
        sourceGlb: actor.record.assetPath ?? null, room: actor.room, meshCount: actor.asset.meshes.length, enabled, isVisible: visibleMeshes > 0,
        enabledMeshCount: enabledMeshes, visibleMeshCount: visibleMeshes, inFrustumMeshCount: inFrustumMeshes,
        rootWorld: actor.root.getAbsolutePosition().asArray(), bounds: { min: min.asArray(), max: max.asArray(), height: max.y - min.y },
        distanceToPlayer: Vector3.Distance(playerPosition, actor.root.getAbsolutePosition()), screenBounds: { min: p0.asArray(), max: p1.asArray(), width: Math.abs(p1.x-p0.x), height: Math.abs(p1.y-p0.y) },
        cameraInFrustum: inFrustumMeshes > 0, materialNames: [...materialNames], textureNames: [...textureNames], activeAnimation: actor.activeAnimation,
        visualState: enabled && visibleMeshes > 0 && inFrustumMeshes > 0 ? 'IN_CAMERA_CANDIDATE' : 'LOADED_NOT_CAMERA_VISIBLE',
      };
    });
  };
  const naraAnimationAudit = () => {
    const nara: any = adapter.followers.find(follower => follower.id === 'Nara');
    if (!nara) return null;
    const groups = nara.asset.animationGroups.map((group: any) => ({ name: group.name, isPlaying: Boolean(group.isPlaying), isStarted: Boolean(group.isStarted), loopAnimation: Boolean(group.loopAnimation), speedRatio: group.speedRatio ?? null, from: group.from ?? null, to: group.to ?? null, owner: group.metadata?.academyAnimationOwner ?? group.metadata?.animationOwner ?? null }));
    const skeletons = [...new Set(nara.asset.meshes.map((mesh: any) => mesh.skeleton).filter(Boolean))] as any[];
    const poseBones = ['rhand','lhand','rwrist','lwrist','relbow','lelbow','rshoulder','lshoulder','torso'];
    const bones = skeletons.flatMap(skeleton => poseBones.map(name => skeleton.bones.find((bone: any) => bone.name.toLowerCase() === name) ?? null).filter(Boolean).map((bone: any) => ({ name: bone.name, rotation: bone.rotation?.asArray?.() ?? null, quaternion: bone.rotationQuaternion?.asArray?.() ?? null })));
    const weapon: any = (window as any).__academyPrologueCandidate?.weapons?.nara;
    return { actor: nara.id, activeAnimation: nara.activeAnimation, requestedClip: nara.requestedClip, requestedSemantic: nara.requestedSemantic, armed: nara.armed, groups, bones, weapon: weapon ? { attached: Boolean(weapon.parent), authoredAnimationActive: Boolean(weapon.authoredAnimationActive), armPose: weapon.armPoseDebug ?? null, socket: weapon.socket ?? null } : null, owner: 'EbonHawkPartyAdapter.Follower' };
  };
  const state = () => { const hit: any = (adapter as any).currentHit, nara = adapter.followers.find(follower => follower.id === 'Nara'); return { status: 'READY', route: 'ACADEMY_PROLOGUE_V1', hdDantooine: hdEnabled, hdOverlay: hdOverlay ? { mode: hdOverlay.mode, applied: hdOverlay.applied.length, skipped: hdOverlay.skipped.length } : null, npcPopulationMode, npcManifest: npcManifestName, npcSourceTotal: spawnClassification.records.length, npcSourceActive: npcRecords.length, npcSourceWithheld: sourceNpcWithheld.length, npcShowcaseEnabled: showcaseEnabled, npcShowcaseTarget: showcaseRecords.length, npcShowcaseLoaded: showcasePopulation.actors.length, npcShowcaseVisibleAtSpawn: showcasePopulation.actors.filter(actor => actor.record.sourceRoom === 'm13aa_04a').length, npcShowcaseAdjacent: showcasePopulation.actors.filter(actor => actor.record.sourceRoom !== 'm13aa_04a').length, npcLifecycle, sector: currentSector, logicalSector: currentSector, actorSector: hit?.room?.startsWith('m14aa_') ? 'danm14aa' : 'danm13', cameraSector: currentSector, renderSector: currentSector, sectorModules: ['danm13', 'danm14aa'], party: [{ id: 'AREN_NATIVE_JKA_V1', role: 'PARTY', position: adapter.player.position.asArray(), room: hit?.room ?? null }, { id: 'NARA_NATIVE_JKA_V1', role: 'PARTY', position: nara?.root.position.asArray() ?? null, room: nara?.hit.room ?? null }], jolee: 'ACADEMY_STORY_NPC_SEPARATE_OVERLAY', npcPopulation: npcPopulation.state(), ambientPopulation: showcasePopulation.state(), interaction: { lastNpcInteraction, belayaDialogue: belayaDialogue.snapshot() }, actorCount: 2 + npcPopulation.actors.length + showcasePopulation.actors.length, partyActorCount: 2, followerCount: nara ? 1 : 0, saberCount: Number(Boolean(arenWeapon)) + Number(Boolean(naraWeapon)), saber: { aren: saberRuntime.AREN, nara: saberRuntime.NARA, controlled: adapter.controlledActorId }, naraAnimation: { active: nara?.activeAnimation ?? null, armed: Boolean((nara as any)?.armed), owner: 'EbonHawkPartyAdapter.Follower', audit: naraAnimationAudit() }, ambientVisualAudit: ambientVisualAudit(), navigation: { runtimePartyAdapter: 'EbonHawkPartyAdapter', movementAuthority: 'PLAYER_CONTROLLER_WOK_RESOLVER_PTH_FOLLOWER', pthNodes: nav.pth.length, wokFaces: nav.rooms.reduce((sum, room) => sum + room.faces.length, 0), sourceTransition, doorTransitions, currentRoom, visFallbacks, tacticalPause: tacticalPause.snapshot(), tactical: adapter.tacticalExecutorSnapshot() }, errors }; };
  (window as any).__academyPrologueCandidateState = state;
  setLoadPhase('READY');
  (window as any).__academyPrologueCandidate = { state, adapter, transition, tacticalPause, npcPopulation, showcasePopulation, toggleShowcase, requestSaber, saberRuntime, weapons: { aren: arenWeapon, nara: naraWeapon }, ambientVisualAudit, naraAnimationAudit, orientShowcaseCamera };
  setSectorMeshes('danm13');
  const perfEnabled = new URLSearchParams(window.location.search).get('perf') === '1';
  const perfStartedAt = performance.now();
  let perfLastFrame = perfStartedAt;
  let perfSampleStart = 0;
  const perfSamples: number[] = [];
  let perfResult: Record<string, unknown> | null = null;
  const finishPerfSample = (now: number) => {
    if (!perfSampleStart || perfResult || now < perfSampleStart + 10000) return;
    const sorted = [...perfSamples].sort((a, b) => a - b);
    const percentile = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? null;
    const averageFrameTime = sorted.length ? sorted.reduce((sum, value) => sum + value, 0) / sorted.length : null;
    const internalTextures = scene.textures.reduce((sum, texture) => {
      const internal = texture.getInternalTexture?.() as any;
      const width = Number(internal?.width ?? 0), height = Number(internal?.height ?? 0);
      return sum + (width > 0 && height > 0 ? width * height * 4 : 0);
    }, 0);
    perfResult = {
      status: sorted.length ? 'PASS_MEASURED' : 'NO_SAMPLES',
      browser: navigator.userAgent,
      renderer: engine.getCaps().standardDerivatives ? 'WEBGL_STANDARD_DERIVATIVES' : 'WEBGL',
      viewport: { width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio },
      warmupMs: 3000,
      sampleDurationMs: Math.round(now - perfSampleStart),
      frameSamples: sorted.length,
      medianFrameTimeMs: percentile(.5),
      p95FrameTimeMs: percentile(.95),
      averageFrameTimeMs: averageFrameTime,
      averageFps: averageFrameTime ? 1000 / averageFrameTime : null,
      gpuTimeMs: null,
      textureCount: scene.textures.length,
      estimatedTextureMemoryBytes: internalTextures,
      loadTimeMs: Math.round(perfStartedAt - academyLoadStartedAt),
      rendererErrors: errors.length,
      hdDantooine: hdEnabled,
    };
    (window as any).__w238_0a2ef1Performance = perfResult;
  };
  (window as any).__w238_0a2ef1Performance = { status: perfEnabled ? 'SAMPLING_AFTER_READY' : 'DISABLED', hdDantooine: hdEnabled };
  let last = performance.now();
   engine.runRenderLoop(() => { const now = performance.now(), dt = Math.min(.05, (now - last) / 1000); last = now; if (perfEnabled) { const elapsed = now - perfStartedAt; if (elapsed >= 3000 && !perfSampleStart) perfSampleStart = now; if (perfSampleStart && now < perfSampleStart + 10000) perfSamples.push(now - perfLastFrame); finishPerfSample(now); } perfLastFrame = now; adapter.update(dt, tacticalPause.paused); updateSaber(dt); const hit: any = (adapter as any).currentHit; const follower = adapter.followers.find(candidate => candidate.id === 'Nara'); const adapterSnapshot: any = adapter.state(); currentRoom = hit?.room ?? currentRoom; currentSector = currentRoom.startsWith('m14aa_') ? 'danm14aa' : 'danm13'; npcPopulation.setModuleEnabled(currentSector); showcasePopulation.setModuleEnabled(currentSector); const followerDistance = follower ? Vector3.Distance(adapter.player.position, follower.root.position) : 0; const compactCommand = lastCommandResult.startsWith('{') ? 'PTH_ROUTE_COMPLETE' : lastCommandResult; status.textContent = `SECTOR ${currentSector.toUpperCase()}\nAREN / NARA native JKA · party 2\nNPC ${npcPopulation.actors.length} source + ${showcasePopulation.actors.length} ambient · ${sourceNpcWithheld.length}/${spawnClassification.records.length} source withheld${hdEnabled ? ' · HD Dantooine ON' : ''}\nCONTROLLED ${adapter.controlledActorId} · FOLLOWER ${adapter.followerActorId}\nSABERS A:${saberRuntime.AREN.state} N:${saberRuntime.NARA.state}\nROOM ${currentRoom} · WOK ${nav.rooms.reduce((sum, room) => sum + room.faces.length, 0)} · PTH ${nav.pth.length}\nCOMMAND ${compactCommand}\nDOOR ${lastDoorResult} · transitions ${doorTransitions}\n${tacticalPause.paused ? 'PAUSED' : 'PLAYING'} · NPC ${lastNpcInteraction}\nVIS fallbacks ${visFallbacks} · errors ${errors.length}`; diagnosticsText.textContent = JSON.stringify({ route: 'ACADEMY_PROLOGUE_V1', hdDantooine: hdEnabled, hdOverlay: hdOverlay ? { mode: hdOverlay.mode, applied: hdOverlay.applied.length, skipped: hdOverlay.skipped.length, metrics: hdOverlay.metrics } : null, performance: perfResult ?? (perfEnabled ? 'SAMPLING' : 'DISABLED'), sector: currentSector, arena: { room: hit?.room ?? null, face: hit?.face ?? null, position: adapter.player.position.asArray() }, nara: follower ? { room: follower.hit.room, face: follower.hit.face, position: follower.root.position.asArray(), separation: followerDistance, animation: follower.activeAnimation, lastConsumedLeaderEvent: follower.lastConsumedLeaderEvent, nextLeaderEvent: adapterSnapshot.companions?.[0]?.nextLeaderEvent ?? null, roomLag: adapterSnapshot.companions?.[0]?.roomLag ?? null } : null, npcPopulation: { ...npcPopulation.state(), sourceTotal: spawnClassification.records.length, sourceWithheld: sourceNpcWithheld.length }, ambientPopulation: showcasePopulation.state(), npcLifecycle, interaction: { lastNpcInteraction }, leaderEventCount: adapterSnapshot.leaderEventCount ?? null, leaderEvents: (adapterSnapshot.leaderEvents ?? []).filter((event: any) => ['PORTAL_CROSS', 'GIT_DOOR_CROSS'].includes(event.type)).map((event: any) => ({ sequence: event.sequence, type: event.type, fromRoom: event.fromRoom, toRoom: event.toRoom })), lastCommandResult, sourceTransition, tacticalPause: tacticalPause.snapshot(), tactical: adapter.tacticalExecutorSnapshot(), errors }, null, 2); if (!locator.hidden) { const origin = adapter.interactionOrigin(); const candidates = [...npcPopulation.actors, ...showcasePopulation.actors].map(actor => ({ actor, distance: Vector3.Distance(origin, actor.root.getAbsolutePosition()) })).sort((a, b) => a.distance - b.distance).slice(0, 12); locator.textContent = `NPC LOCATOR · ${currentRoom}\n${candidates.map(({ actor, distance }) => `${actor.record.populationKind === 'PLAYTEST_AMBIENT' ? 'AMBIENT' : 'SOURCE'} · ${actor.record.displayName} · ${distance.toFixed(1)}m · ${actor.room ?? '-'} · ${distance <= 2.8 ? 'E AVAILABLE' : 'out of range'}`).join('\n')}`; } scene.render(); });
  window.addEventListener('resize', () => engine.resize());
  await scene.whenReadyAsync(); document.getElementById('loadingOverlay')?.classList.add('is-hidden');
  return state();
}


