import { AbstractMesh, Color3, Color4, Engine, FreeCamera, HemisphericLight, MeshBuilder, PBRMaterial, Scene, SceneLoader, ShaderMaterial, StandardMaterial, Texture, TransformNode, Vector3 } from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import '@babylonjs/core/Materials/Textures/Loaders/tgaTextureLoader';
import { ANCHORHEAD_ODYSSEY_FRAGMENT_SOURCE, ANCHORHEAD_ODYSSEY_VERTEX_SOURCE, applyOdysseyMaterialPipeline } from './OdysseyMaterialPipeline';
import { applyAnchorheadOptimization, AnchorheadOptimizationMode } from './AnchorheadOptimization';
import { ANCHORHEAD_VALIDATED_SAMPLES } from './AnchorheadValidatedSamples';
import { buildAnchorheadNavigationWorld, detectCurrentRoomV2, deterministicWalkableSamples, NavPoint, NavigationWorld, projectToWalkmesh } from './AnchorheadNavigation';
import { buildAnchorheadPathGraph, buildPathTests, findPathBfs } from './AnchorheadPathGraph';
import { normalizeActorSpawns, normalizeDoors, normalizePlaceables, normalizeTriggers, normalizeWaypoints } from './AnchorheadWorldSemantics';
import { AnchorheadPlayerAdapter } from './AnchorheadPlayerAdapter';
import { CompanionController } from './CompanionController';
import { CharacterPresentationLighting } from '../../player/CharacterPresentationLighting';
import { PLAYER_CHARACTERS, resolvePlayerCharacter } from '../../player/PlayerCharacterConfig';
import { addDevPlayableCharacterSelector } from './DevPlayableCharacterSelector';
import { countW236Resources, W236WorldRuntimeHandle, W236LifecycleState } from './W236WorldLifecycle';
type AnchorheadViewerOptions = {
  verticalSlice?: boolean;
  companions?: Array<'mission' | 'jolee' | 'nara'>;
  onLifecycleState?: (state: W236LifecycleState) => void;
  onRuntimeCreated?: (runtime: W236WorldRuntimeHandle) => void;
  onLoadFailure?: (error: unknown) => void;
};
const PLAYABLE_PARAMS = new URLSearchParams(window.location.search);
const PLAYABLE_PROFILE = import.meta.env.DEV && (PLAYABLE_PARAMS.has('playable') || PLAYABLE_PARAMS.has('player')) ? resolvePlayerCharacter(PLAYABLE_PARAMS) : null;
const PLAYABLE = import.meta.env.DEV && Boolean(PLAYABLE_PROFILE);
const REQUESTED_ASSET = new URLSearchParams(window.location.search).get('asset');
const ASSET = REQUESTED_ASSET === 'uv2fix' ? 'uv2fix' : 'canonical';
const BASE = REQUESTED_ASSET === 'uv2fix' ? '/_lab/kotor/tat_m17aa/uv2fix/' : '/_lab/kotor/tat_m17aa/';
const METADATA_BASE = '/_lab/kotor/tat_m17aa/';
const LIGHTMAP_BASE = '/_lab/kotor/tat_m17aa/lightmaps/';
const NEUTRAL_SAMPLE = new URLSearchParams(window.location.search).get('neutral') === '1';
const MATERIAL_MODE = new URLSearchParams(window.location.search).get('materialMode') ?? 'shader';
const TEXTURE_DIAG = new URLSearchParams(window.location.search).get('textureDiag') ?? '';
const TEXTURE_SAMPLE = new URLSearchParams(window.location.search).get('textureSample') ?? 'Object184';
const OPTIMIZATION_PARAM = new URLSearchParams(window.location.search).get('anchorheadOptimization') ?? 'none';
const OPTIMIZATION_MODE: AnchorheadOptimizationMode = ['none', 'merge', 'vis', 'merge-vis'].includes(OPTIMIZATION_PARAM) ? OPTIMIZATION_PARAM as AnchorheadOptimizationMode : 'none';
const FREEZE_WORLD = new URLSearchParams(window.location.search).get('anchorheadFreeze') === '1';
const FREEZE_MATERIALS = new URLSearchParams(window.location.search).get('anchorheadFreezeMaterials') === '1';
const NAV_DEBUG = new URLSearchParams(window.location.search).get('anchorheadNavDebug') === '1';
const axis = (x: number, y: number, z: number) => new Vector3(-x, z, -y);
const lightmapRuntimeClones = new Map<number, any>();
const lightmapPairMaterials = new Map<string, any>();
const lightmapTextureCache = new Map<string, Texture>();
const odysseyShaderMaterials = new Map<string, ShaderMaterial>();

/** Release module-held cache references when the DEV world runtime is torn down. */
export function clearAnchorheadRuntimeCaches() {
  lightmapRuntimeClones.clear();
  lightmapPairMaterials.clear();
  lightmapTextureCache.clear();
  odysseyShaderMaterials.clear();
}
const WALK_CAMERA_POINTS: Record<number,{position: [number,number,number]; target: [number,number,number]}> = {
  3: { position: [209.15633900960287, 5.45, -242.58533223470053], target: [214.6042022705078, 5.45, -249.40659713745117] },
  4: { position: [335.71616617838544, 5.45, -161.68746439615884], target: [344.51605224609375, 5.45, -157.7084503173828] },
  5: { position: [436.9686635335286, 5.45, -240.7693328857422], target: [462.02779388427734, 5.45, -251.2476043701172] }
};
type RuntimeMetadata = { visibility?: any; walkmesh?: any; walkmeshGeometry?: any; pathfinding?: any; doors?: any; npcs?: any; placeables?: any; triggers?: any; waypoints?: any };
type NavSemanticRows = { doors: any[]; triggers: any[]; waypoints: any[]; actors: any[]; placeables: any[] };

export async function startAnchorheadViewer(options: AnchorheadViewerOptions = {}): Promise<W236WorldRuntimeHandle> {
  const shaderCompileErrors: string[] = [];
  const originalConsoleError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    const message = args.map((value) => typeof value === 'string' ? value : String(value)).join(' ');
    if (/unable to compile effect|shader\s+(?:compilation|compile)\s+error|vertex shader error|fragment shader error/i.test(message)) shaderCompileErrors.push(message);
    originalConsoleError(...args);
  };
  (window as any).__anchorheadShaderCompileErrors = shaderCompileErrors;
  document.querySelectorAll('#hud,#questHud,#interactionPrompt,#dialogueOverlay,#fadeOverlay,#debugOverlay,#loadingOverlay,#errorOverlay').forEach((n) => n.classList.add('is-hidden'));
  const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement; const originalCanvasClass = canvas.className; const originalCanvasStyle = canvas.getAttribute('style'); canvas.classList.add('anchorhead-canvas');
  const root = document.createElement('div'); root.className = 'anchorhead-viewer'; document.body.appendChild(root);
  const title = document.createElement('div'); title.className = 'anchorhead-title'; title.textContent = PLAYABLE ? `NERATHIS · W236 · ANCHORHEAD · ${PLAYABLE_PROFILE?.displayName.toUpperCase()}` : `NERATHIS · W228.5 · ANCHORHEAD NAV LAB · ${ASSET.toUpperCase()}`; root.appendChild(title); root.dataset.asset = ASSET; document.documentElement.dataset.anchorheadAsset = ASSET;
  if (import.meta.env.DEV) addDevPlayableCharacterSelector(root, PLAYABLE_PROFILE?.id ?? 'aren', { keepParty: true, title: 'DEV profile switch; reload cleanly disposes and recreates controller, camera and party.' });
  const hud = document.createElement('div'); hud.className = 'anchorhead-hud'; root.appendChild(hud);
  const help = document.createElement('div'); help.className = 'anchorhead-help'; help.textContent = NAV_DEBUG ? 'NAV DEBUG · WASD move marker on walkmesh · SHIFT fast · mouse look · 1–5 view · L lightmap · M semantics · W walkmesh · P PTH' : 'WASD move · mouse look · SHIFT fast · H human height · R reset · 1–5 view · L lightmap · M markers · W walkmesh · P PTH'; root.appendChild(help);
  const status = document.createElement('div'); status.className = 'anchorhead-status'; status.textContent = 'Loading GLB…'; root.appendChild(status);
  const metrics = document.createElement('pre'); metrics.className = 'anchorhead-metrics'; metrics.id = 'anchorheadRuntimeMetrics'; root.appendChild(metrics);
  const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true, adaptToDeviceRatio: true });
  const scene = new Scene(engine); scene.clearColor = new Color4(0.018, 0.024, 0.035, 1); scene.useRightHandedSystem = true;
  const ambient = new HemisphericLight('AnchorheadAmbient', new Vector3(0, 1, 0), scene); ambient.intensity = NEUTRAL_SAMPLE ? 0 : 0.85;
  let camera = new FreeCamera('AnchorheadFreeCamera', new Vector3(160, 12, -90), scene); if (!PLAYABLE) camera.attachControl(canvas, true); camera.speed = 0.65; camera.angularSensibility = 4500; camera.minZ = 0.05; scene.activeCamera = camera;
  const human = MeshBuilder.CreateBox('HumanScale_1_75m', { width: .35, depth: .35, height: 1.75 }, scene); human.position = new Vector3(160, .875, -90); const hm = new StandardMaterial('HumanScaleDebug', scene); hm.diffuseColor = new Color3(1, .65, .12); hm.emissiveColor = new Color3(.25, .1, 0); human.material = hm; human.isVisible = false; human.isPickable = false;
  let imported: { meshes: AbstractMesh[] } | undefined; let optimizationState: ReturnType<typeof applyAnchorheadOptimization> | undefined; let bounds: { min: Vector3; max: Vector3; center: Vector3; size: Vector3 } | undefined; let metadata: RuntimeMetadata = {}; let sidecar: any; let lightmapsOn = false; let humanMode = false;
  let navigationWorld: NavigationWorld | undefined; let pathGraph: ReturnType<typeof buildAnchorheadPathGraph> | undefined; let semanticRows: NavSemanticRows | undefined; let semanticBounds: Array<{ room: string; min: NavPoint; max: NavPoint }> = []; let navWalker: AbstractMesh | undefined; let walkerFeet: Vector3 | undefined; let currentNav: ReturnType<typeof detectCurrentRoomV2> | undefined; let roomTransitions: Array<any> = []; const navKeys = new Set<string>();
  let movementAccepted = 0; let movementRejected = 0; let lastMovementAccepted: boolean | null = null; let lastVisibility: any = null; let playable: AnchorheadPlayerAdapter | null = null; let companionController: CompanionController | null = null; let characterLighting: CharacterPresentationLighting | null = null;
  let disposedWorld = false; let disposedActors = false; let renderLoop: () => void = () => {}; let resizeHandler: () => void = () => {}; let keyDownHandler: (event: KeyboardEvent) => void = () => {}; let keyUpHandler: (event: KeyboardEvent) => void = () => {}; let blurHandler: () => void = () => {}; let renderObserver: any = null;
  let visEnabled = true;
  const navState = () => ({ position: walkerFeet?.asArray() ?? null, room: currentNav?.room ?? null, face: currentNav?.face ?? null, surface: currentNav?.surfaceType ?? null, height: currentNav?.height ?? null, detectionMethod: currentNav?.method ?? 'UNRESOLVED', movementAccepted, movementRejected, lastMovementAccepted, roomTransitionCount: roomTransitions.length, lastFromRoom: roomTransitions.at(-1)?.fromRoom ?? null, lastToRoom: roomTransitions.at(-1)?.toRoom ?? null, visVisibleRoomCount: lastVisibility?.enabledRooms ?? null, visFallbackCount: optimizationState?.result.fallbackCount ?? 0 });
  const publishNavState = () => { const state = navState(); (window as any).__anchorheadNavState = state; (window as any).__anchorheadNavDebug = { ...(window as any).__anchorheadNavDebug, enabled: NAV_DEBUG, currentRoom: state.room, walker: state.position, roomTransitions: roomTransitions.slice(-100), telemetry: state }; return state; };
  const updateWalkerVisibility = (force = false) => { if (!walkerFeet) return; lastVisibility = optimizationState?.updateVisibility(walkerFeet, force) ?? null; publishNavState(); };
  const runtimeHandle: W236WorldRuntimeHandle = {
    worldId: 'anchorhead_tat_m17aa',
    snapshot: () => countW236Resources(scene, disposedWorld),
    state: () => ({ navigation: playable?.state() ?? navState(), party: companionController?.state() ?? null, vis: lastVisibility ?? null, characterLighting: characterLighting?.state() ?? null, runtime: (window as any).__anchorheadRuntimeMetrics ?? null }),
    freezeInput: (frozen) => { playable?.setInputEnabled(!frozen); companionController?.setInputEnabled(!frozen); },
    disposeActors: () => {
      if (!disposedActors) {
        disposedActors = true;
        characterLighting?.dispose(); characterLighting = null;
        companionController?.dispose(); companionController = null;
        playable?.dispose(); playable = null;
        for (const key of Object.keys(window)) if (/^__anchorhead(?:Player|Playable)/.test(key)) delete (window as any)[key];
      }
      return countW236Resources(scene, disposedWorld);
    },
    disposeWorld: () => {
      if (!disposedWorld) {
        disposedWorld = true;
        engine.stopRenderLoop(renderLoop);
        window.removeEventListener('resize', resizeHandler);
        window.removeEventListener('keydown', keyDownHandler);
        window.removeEventListener('keyup', keyUpHandler);
        window.removeEventListener('blur', blurHandler);
        if (renderObserver) scene.onBeforeRenderObservable.remove(renderObserver);
        scene.dispose();
        engine.dispose();
        clearAnchorheadRuntimeCaches();
        console.error = originalConsoleError;
        root.remove();
        canvas.className = originalCanvasClass;
        if (originalCanvasStyle == null) canvas.removeAttribute('style'); else canvas.setAttribute('style', originalCanvasStyle);
        delete (document.documentElement.dataset as any).anchorheadAsset;
        delete (document.documentElement.dataset as any).captureReady;
        for (const key of Object.keys(window)) if (key.startsWith('__anchorhead')) delete (window as any)[key];
        delete (window as any).__w236AnchorheadTest;
      }
      return countW236Resources(scene, true);
    },
    setDebug: (kind, enabled) => {
      if (kind === 'BWM') walkRoot.setEnabled(enabled);
      if (kind === 'PTH') pthRoot.setEnabled(enabled);
      if (kind === 'DOORS') markerRoot.setEnabled(enabled);
      if (kind === 'PARTY') companionController?.setDebugRoute(enabled);
      if (kind === 'VIS') {
        visEnabled = enabled;
        if (!enabled) optimizationState?.entries.forEach((entry) => entry.node.setEnabled(true));
        else if (playable) optimizationState?.updateVisibility(playable.navPosition, true);
      }
    },
  };
  options.onRuntimeCreated?.(runtimeHandle);
  options.onLifecycleState?.('LOAD_NAVIGATION');
  const applyWalkerInput = (keys: ReadonlySet<string>, deltaMs: number, forwardOverride?: Vector3): boolean | null => {
    if (!NAV_DEBUG || !navWalker || !walkerFeet || !navigationWorld) return null;
    const forward = (forwardOverride ?? camera.getForwardRay().direction).clone(); forward.y = 0; if (forward.lengthSquared() > 0) forward.normalize();
    const right = Vector3.Cross(Vector3.Up(), forward).normalize(); const move = Vector3.Zero();
    if (keys.has('w')) move.addInPlace(forward); if (keys.has('s')) move.subtractInPlace(forward); if (keys.has('d')) move.addInPlace(right); if (keys.has('a')) move.subtractInPlace(right);
    if (move.lengthSquared() <= 0) { lastMovementAccepted = null; publishNavState(); return null; }
    move.normalize(); const distance = (keys.has('shift') ? 5.0 : 2.0) * Math.min(deltaMs / 1000, .05); const candidate = walkerFeet.add(move.scale(distance));
    const currentRoom = currentNav?.room ?? null; const adjacentRooms = new Set<string>(currentRoom ? [currentRoom] : []);
    if (currentRoom && pathGraph) for (const edge of pathGraph.edges) if (edge.crossRoom && edge.validWalkmeshEndpoints) { const a = pathGraph.nodes[edge.from]?.room, b = pathGraph.nodes[edge.to]?.room; if (a === currentRoom && b) adjacentRooms.add(b); if (b === currentRoom && a) adjacentRooms.add(a); }
    const maxDistance = Math.max(.45, distance * 1.5);
    const projection = projectToWalkmesh({ x: candidate.x, y: walkerFeet.y, z: candidate.z }, navigationWorld, { currentRoom, allowedRooms: adjacentRooms.size ? [...adjacentRooms] : undefined, maxHorizontalDistance: maxDistance, maxVerticalDistance: 1.5, walkableOnly: true });
    if (projection && projection.horizontalDistance <= maxDistance) {
      const priorRoom = currentNav?.room ?? null; const previousFace = currentNav?.face ?? null; walkerFeet = new Vector3(projection.point.x, projection.height, projection.point.z); navWalker.position.copyFrom(walkerFeet).addInPlace(new Vector3(0, .875, 0));
      currentNav = detectCurrentRoomV2(walkerFeet, navigationWorld, { previousRoom: priorRoom, semanticBounds }); movementAccepted++; lastMovementAccepted = true;
      if (currentNav.room && priorRoom && currentNav.room !== priorRoom) { const transition = { fromRoom: priorRoom, toRoom: currentNav.room, position: walkerFeet.asArray(), oldFace: previousFace, newFace: currentNav.face, method: currentNav.method }; roomTransitions.push(transition); }
      updateWalkerVisibility(Boolean(currentNav.room && priorRoom && currentNav.room !== priorRoom)); return true;
    }
    movementRejected++; lastMovementAccepted = false; publishNavState(); return false;
  };
  const markerRoot = new TransformNode('AnchorheadMetadataMarkers', scene); markerRoot.setEnabled(false);
  const pthRoot = new TransformNode('AnchorheadPTHDebug', scene); pthRoot.setEnabled(false);
  const walkRoot = new TransformNode('AnchorheadWalkmeshDebug', scene); walkRoot.setEnabled(false);
  const start = performance.now();
  try {
    sidecar = await fetch(`${BASE}tat_m17aa_anchorhead_lightmaps.json`).then((r) => r.json());
    const files = ['anchorhead_visibility','anchorhead_walkmesh','anchorhead_pathfinding','anchorhead_doors','anchorhead_npcs','anchorhead_placeables','anchorhead_triggers','anchorhead_waypoints'];
    const loaded = await Promise.all(files.map(async (name) => [name, await fetch(`${METADATA_BASE}metadata/${name}.json`).then((r) => r.json())] as const)); loaded.forEach(([name, value]) => { metadata[name.replace('anchorhead_', '') as keyof RuntimeMetadata] = value; });
    metadata.walkmeshGeometry = await fetch(`${METADATA_BASE}anchorhead_walkmesh_geometry.json`).then((r) => r.json());
    navigationWorld = buildAnchorheadNavigationWorld(metadata.walkmeshGeometry);
    const roomOrigins = Object.fromEntries((metadata.walkmeshGeometry?.walkmeshes ?? []).filter((row: any) => row.room_origin).map((row: any) => [String(row.room).replace(/^GLB_Room_/, ''), row.room_origin as number[]]));
    pathGraph = buildAnchorheadPathGraph(metadata.pathfinding, navigationWorld, roomOrigins);
    semanticRows = {
      doors: normalizeDoors(metadata.doors, navigationWorld, roomOrigins, pathGraph),
      triggers: normalizeTriggers(metadata.triggers, navigationWorld, roomOrigins, pathGraph),
      waypoints: normalizeWaypoints(metadata.waypoints, navigationWorld, roomOrigins, pathGraph),
      actors: normalizeActorSpawns(metadata.npcs, navigationWorld, roomOrigins, pathGraph),
      placeables: normalizePlaceables(metadata.placeables, navigationWorld, roomOrigins, pathGraph),
    };
    options.onLifecycleState?.('LOAD_WORLD');
    const result = await SceneLoader.ImportMeshAsync(null, BASE, 'tat_m17aa_anchorhead.glb', scene); imported = { meshes: result.meshes }; const baseMaterials = new Set(result.meshes.map((m) => m.material).filter(Boolean));
    (window as any).__anchorheadScene = scene; (window as any).__anchorheadAsset = ASSET;
    (window as any).__anchorheadUVRuntime = ['Object184', 'Object542', 'Object03'].map((name) => {
      const mesh = result.meshes.find((m) => m.name === name);
      const range = (raw: ArrayLike<number> | null) => { const values = raw ? Array.from(raw) : []; return values.length ? { count: values.length / 2, minU: Math.min(...values.filter((_, i) => i % 2 === 0)), maxU: Math.max(...values.filter((_, i) => i % 2 === 0)), minV: Math.min(...values.filter((_, i) => i % 2 === 1)), maxV: Math.max(...values.filter((_, i) => i % 2 === 1)) } : { count: 0 }; };
      return { name, uniqueId: mesh?.uniqueId ?? null, uv0: range(mesh?.getVerticesData('uv') ?? null), uv1: range(mesh?.getVerticesData('uv2') ?? null) };
    });
    const queryEarly = new URLSearchParams(window.location.search); const sampleRoom=queryEarly.get('sampleRoom'); if (sampleRoom) result.meshes.filter((m) => m.getTotalVertices() > 0).forEach((m) => { let p=m.parent; let room=''; while(p){ if(p.name.startsWith('GLB_Room_')) { room=p.name.replace(/^GLB_Room_/,''); break; } p=p.parent; } if(room!==sampleRoom) m.setEnabled(false); }); if (TEXTURE_DIAG) result.meshes.filter((m) => m.getTotalVertices() > 0 && m.isEnabled()).forEach((m) => { m.setEnabled(m.name === TEXTURE_SAMPLE); });
    if (NEUTRAL_SAMPLE) result.meshes.forEach((m) => { const material: any = m.material; if (material && 'disableLighting' in material) material.disableLighting = true; });
    const renderMeshes = result.meshes.filter((m) => m.getTotalVertices() > 0 && m.isEnabled()); if (!renderMeshes.length) throw new Error('GLB loaded without renderable meshes.');
    const min = new Vector3(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY), max = new Vector3(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY);
    renderMeshes.forEach((m) => { const b = m.getBoundingInfo().boundingBox; min.minimizeInPlace(b.minimumWorld); max.maximizeInPlace(b.maximumWorld); }); bounds = { min, max, center: min.add(max).scale(.5), size: max.subtract(min) };
    camera.position = bounds.center.add(new Vector3(-bounds.size.x * .25, Math.max(8, bounds.size.y * .25), -bounds.size.z * .25)); camera.setTarget(bounds.center);
    if ((NAV_DEBUG || PLAYABLE) && pathGraph && semanticRows) {
      const roomMeshBounds = new Map<string, { min: Vector3; max: Vector3 }>();
      for (const mesh of result.meshes) {
        let parent = mesh.parent; let room = '';
        while (parent) { if (parent.name.startsWith('GLB_Room_')) { room = parent.name.replace(/^GLB_Room_/, ''); break; } parent = parent.parent; }
        if (!room || mesh.getTotalVertices() <= 0) continue;
        mesh.computeWorldMatrix(true); const box = mesh.getBoundingInfo().boundingBox; const current = roomMeshBounds.get(room);
        if (!current) roomMeshBounds.set(room, { min: box.minimumWorld.clone(), max: box.maximumWorld.clone() });
        else { current.min.minimizeInPlace(box.minimumWorld); current.max.maximizeInPlace(box.maximumWorld); }
      }
      semanticBounds = [...roomMeshBounds.entries()].map(([room, b]) => ({ room, min: { x: b.min.x, y: b.min.y, z: b.min.z }, max: { x: b.max.x, y: b.max.y, z: b.max.z } }));
      if (NAV_DEBUG) { makeNormalizedSemanticDebug(semanticRows, markerRoot, scene); makeNormalizedPthDebug(pathGraph, pthRoot, scene); makeWalkmesh(metadata.walkmeshGeometry, walkRoot, scene); }
    } else {
      makeMarkers(metadata, markerRoot, scene, 'doors', new Color3(1, .35, .15)); makeMarkers(metadata, markerRoot, scene, 'npcs', new Color3(.25, 1, .45)); makeMarkers(metadata, markerRoot, scene, 'placeables', new Color3(.45, .75, 1)); makeMarkers(metadata, markerRoot, scene, 'triggers', new Color3(1, .2, .8)); makeMarkers(metadata, markerRoot, scene, 'waypoints', new Color3(1, .9, .2)); makePth(metadata.pathfinding, pthRoot, scene); makeWalkmesh(metadata.walkmeshGeometry, walkRoot, scene);
    }
    status.textContent = `Loaded in ${Math.round(performance.now() - start)} ms`;
    const query = new URLSearchParams(window.location.search); const rawView=query.get('view') ?? ''; const viewNames: Record<string,number>={topdown:1,overview:2,streetA:3,streetB:4,streetC:5,sampleLightmap:6,matchedSample:7}; const view = Number(rawView) || viewNames[rawView] || 0; const humanQuery=query.get('human') === '1'; humanMode=humanQuery; if (!PLAYABLE && view >= 1 && view <= 7) window.setTimeout(() => { setView(view, camera, bounds, humanQuery); exportCamera(); }, 50); if (TEXTURE_DIAG) { lightmapsOn = true; const stats = applyOdysseyMaterialPipeline(imported.meshes, sidecar, scene, ({factor:0,diffuse:1,lightmap:2,multiply:3,alpha:4} as Record<string,number>)[TEXTURE_DIAG] ?? 3); (window as any).__anchorheadOdysseyBinding = stats; } else if (MATERIAL_MODE === 'shader') { lightmapsOn = true; const stats = applyOdysseyMaterialPipeline(imported.meshes, sidecar, scene, 3); (window as any).__anchorheadOdysseyBinding = stats; } else if (query.get('lightmap') === 'on' || query.get('lightmaps') === '1') { lightmapsOn = true; applyLightmaps(imported.meshes, sidecar, true, query.get('lmInvertY') === '1', query.get('lmGamma') === '1', query.get('lmShadow') === '1'); } publishMaterialAudit(scene, imported.meshes, sidecar, ASSET, sampleRoom, baseMaterials); options.onLifecycleState?.('LOAD_VIS'); optimizationState = applyAnchorheadOptimization(imported.meshes, scene, metadata, OPTIMIZATION_MODE, FREEZE_WORLD, FREEZE_MATERIALS, ANCHORHEAD_VALIDATED_SAMPLES, (NAV_DEBUG || PLAYABLE) && navigationWorld ? (position) => detectCurrentRoomV2(position, navigationWorld!, { semanticBounds }).room : undefined); (window as any).__anchorheadOptimizationAudit = optimizationState.result; if (query.get('pth') === '1' || NAV_DEBUG) pthRoot.setEnabled(true); if (query.get('markers') === '1' || NAV_DEBUG) markerRoot.setEnabled(true); if (query.get('walkmesh') === '1' || NAV_DEBUG) walkRoot.setEnabled(true);
    if (NAV_DEBUG && !PLAYABLE && navigationWorld && pathGraph) {
      const seed = pathGraph.nodes.find((node) => node.worldPosition)?.worldPosition ?? deterministicWalkableSamples(navigationWorld, 1)[0]?.point;
      if (seed) {
        walkerFeet = new Vector3(seed.x, seed.y, seed.z);
        navWalker = MeshBuilder.CreateCapsule('AnchorheadDebugWalker_1_75m', { height: 1.75, radius: .32, tessellation: 8 }, scene);
        navWalker.position = walkerFeet.add(new Vector3(0, .875, 0));
        const walkerMaterial = new StandardMaterial('AnchorheadDebugWalkerMaterial', scene); walkerMaterial.diffuseColor = new Color3(.1, .9, .72); walkerMaterial.emissiveColor = new Color3(.02, .18, .12); navWalker.material = walkerMaterial; navWalker.isPickable = false; navWalker.checkCollisions = false;
        camera.keysUp = []; camera.keysDown = []; camera.keysLeft = []; camera.keysRight = [];
        camera.position = walkerFeet.add(new Vector3(0, 2.8, -5.5)); camera.setTarget(walkerFeet.add(new Vector3(0, 1, 0)));
        currentNav = detectCurrentRoomV2(walkerFeet, navigationWorld, { semanticBounds });
      }
    }
    (window as any).__anchorheadNavigationAudit = buildRuntimeNavigationAudit(navigationWorld, pathGraph, semanticRows, semanticBounds, metadata); (window as any).__anchorheadNavDebug = { enabled: NAV_DEBUG, currentRoom: currentNav?.room ?? null, walker: walkerFeet?.asArray() ?? null, roomTransitions };
    if (NAV_DEBUG && !PLAYABLE && navigationWorld && pathGraph && walkerFeet) {
      const controlledStep = (keys: string[], deltaMs = 50, forward?: Vector3) => applyWalkerInput(new Set(keys.map((key) => key.toLowerCase())), deltaMs, forward);
      const driveTo = async (target: NavPoint, maxFrames = 500) => {
        let frames = 0; let blocked = false;
        while (frames < maxFrames) {
          const dx = target.x - walkerFeet!.x, dz = target.z - walkerFeet!.z; const distance = Math.hypot(dx, dz); if (distance <= .28) break;
          const accepted = controlledStep(['w'], 50, new Vector3(dx, 0, dz)); frames++; if (accepted !== true) { blocked = true; break; } await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        }
        return { frames, blocked, distanceRemaining: Math.hypot(target.x - walkerFeet!.x, target.z - walkerFeet!.z), state: publishNavState() };
      };
      (window as any).__anchorheadNavTest = {
        state: () => publishNavState(),
        step: (keys: string[], frames = 1, deltaMs = 50) => { const startPosition = walkerFeet!.asArray(); let accepted = 0, rejected = 0; for (let i = 0; i < Math.max(1, Math.min(1000, frames)); i++) { const result = controlledStep(keys, deltaMs); if (result === true) accepted++; else if (result === false) rejected++; } const endPosition = walkerFeet!.asArray(); return { startPosition, endPosition, distance: Math.hypot(endPosition[0]-startPosition[0], endPosition[1]-startPosition[1], endPosition[2]-startPosition[2]), accepted, rejected, state: publishNavState() }; },
        movementProof: (frames = 20) => { const startPosition = walkerFeet!.clone(), start = currentNav; const acceptedBefore = movementAccepted; for (let i=0;i<Math.max(1,Math.min(1000,frames));i++) controlledStep(['w'],50); const end = walkerFeet!.clone(), final = detectCurrentRoomV2(end,navigationWorld!,{previousRoom:currentNav?.room,semanticBounds}); const distance = Vector3.Distance(startPosition,end); return { startPosition:startPosition.asArray(),endPosition:end.asArray(),distance,startFace:start?.face??null,endFace:final.face,finalRoom:final.room,finalWalkable:Boolean(final.hit?.walkability==='WALKABLE'),accepted:movementAccepted-acceptedBefore,movementAccepted:lastMovementAccepted,pass:distance>0&&final.hit?.walkability==='WALKABLE' }; },
        edgeRejectionProof: async (maxApproachFrames = 100) => {
          const rejectedBefore=movementRejected, startPosition=walkerFeet!.asArray(), room=navigationWorld!.roomsById.get(currentNav?.room ?? ''); if(!room) return {pass:false,reason:'NO_CURRENT_WALKABLE_ROOM'};
          const edgeRows=new Map<string,{a:NavPoint;b:NavPoint;face:any;count:number}>(); const key=(p:NavPoint)=>[p.x,p.y,p.z].map((n)=>Math.round(n*1000)).join(':');
          for(const face of room.walkableFaces) for(let i=0;i<3;i++){const a=face.vertices[i],b=face.vertices[(i+1)%3],ka=key(a),kb=key(b),edgeKey=ka<kb?`${ka}|${kb}`:`${kb}|${ka}`,existing=edgeRows.get(edgeKey); if(existing) existing.count++; else edgeRows.set(edgeKey,{a,b,face,count:1});}
          const closest=(p:Vector3,a:NavPoint,b:NavPoint)=>{const dx=b.x-a.x,dz=b.z-a.z,len=dx*dx+dz*dz,t=len?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.z-a.z)*dz)/len)):0; return {x:a.x+dx*t,z:a.z+dz*t};};
          const edge=[...edgeRows.values()].filter((row)=>row.count===1).map((row)=>{const q=closest(walkerFeet!,row.a,row.b);return {...row,q,distance:Math.hypot(q.x-walkerFeet!.x,q.z-walkerFeet!.z)}}).sort((a,b)=>a.distance-b.distance)[0]; if(!edge) return {pass:false,reason:'NO_BOUNDARY_EDGE_IN_CURRENT_ROOM'};
          {const v=edge.face.vertices,center={x:(v[0].x+v[1].x+v[2].x)/3,y:(v[0].y+v[1].y+v[2].y)/3,z:(v[0].z+v[1].z+v[2].z)/3},mid={x:(edge.a.x+edge.b.x)/2,y:(edge.a.y+edge.b.y)/2,z:(edge.a.z+edge.b.z)/2}; let inward=new Vector3(center.x-mid.x,0,center.z-mid.z); if(!inward.lengthSquared()) return {pass:false,reason:'DEGENERATE_BOUNDARY_EDGE'}; inward.normalize(); const approach={x:edge.q.x+inward.x*.3,y:walkerFeet!.y,z:edge.q.z+inward.z*.3}; const approachResult=await driveTo(approach,maxApproachFrames); if(approachResult.blocked||approachResult.distanceRemaining>.75) return {pass:false,reason:'COULD_NOT_REACH_NEAREST_BOUNDARY_WITH_NORMAL_MOVEMENT',startPosition,endPosition:walkerFeet!.asArray(),boundaryFace:edge.face.faceIndex,boundaryDistance:edge.distance,approach,approachResult,finalWalkable:currentNav?.hit?.walkability==='WALKABLE'};
            const outward=new Vector3(edge.q.x-center.x,0,edge.q.z-center.z); if(!outward.lengthSquared()) return {pass:false,reason:'DEGENERATE_OUTWARD_VECTOR'}; outward.normalize(); let constraint:any=null, reject:any=null; let attemptedOutside=false; const outsideSamples:any[]=[];
            for(let i=0;i<16;i++){
              const before=walkerFeet!.clone(), requested=before.add(outward.scale(.1));
              const strict=projectToWalkmesh({x:requested.x,y:requested.y,z:requested.z},navigationWorld!,{currentRoom:currentNav?.room,maxHorizontalDistance:0,maxVerticalDistance:1.5,walkableOnly:true});
              const accepted=controlledStep(['w'],50,outward); attemptedOutside ||= !strict; if(!strict) outsideSamples.push({requested:requested.asArray(),projectedTo:walkerFeet!.asArray(),distanceFromRequested:Vector3.Distance(requested,walkerFeet!)});
              const actualDistance=Vector3.Distance(before,walkerFeet!);
              if(accepted===false){reject={heading:[outward.x,outward.z],requested:requested.asArray(),state:publishNavState()};break;}
              if(!strict&&actualDistance<.005){constraint={type:'PROJECTED_TO_WALKABLE_EDGE',requested:requested.asArray(),actualPosition:walkerFeet!.asArray(),actualDistance,state:publishNavState()};break;}
              await new Promise<void>((resolve)=>requestAnimationFrame(()=>resolve()));
            }
            const after=detectCurrentRoomV2(walkerFeet!,navigationWorld!,{previousRoom:currentNav?.room,semanticBounds});
            if(reject||constraint||outsideSamples.length) return {startPosition,endPosition:walkerFeet!.asArray(),approach:{edgeFace:edge.face.faceIndex,boundaryDistance:edge.distance,target:approach,result:approachResult},rejectedDelta:movementRejected-rejectedBefore,rejection:reject,constraint:constraint??(outsideSamples.length?{type:'CLAMPED_OR_SLID_TO_WALKABLE_SURFACE'}:null),outsideSamples,attemptedOutside,finalWalkable:after.hit?.walkability==='WALKABLE',finalRoom:after.room,pass:Boolean(attemptedOutside&&outsideSamples.length>0&&after.hit?.walkability==='WALKABLE')};
            return {pass:false,reason:'BOUNDARY_NOT_REACHED_OR_MOVEMENT_NOT_CONSTRAINED',startPosition,endPosition:walkerFeet!.asArray(),approach:{edgeFace:edge.face.faceIndex,boundaryDistance:edge.distance,target:approach,result:approachResult},attemptedOutside,finalWalkable:after.hit?.walkability==='WALKABLE',finalRoom:after.room};
          }
        },
        roomTransitionProof: async () => {
          const initialRoom=currentNav?.room; if(!initialRoom) return {pass:false,reason:'NO_INITIAL_ROOM'};
          const startNode=pathGraph!.nodes.filter((node)=>node.projected&&node.room===initialRoom).sort((a,b)=>Math.hypot(a.worldPosition!.x-walkerFeet!.x,a.worldPosition!.z-walkerFeet!.z)-Math.hypot(b.worldPosition!.x-walkerFeet!.x,b.worldPosition!.z-walkerFeet!.z))[0]; if(!startNode) return {pass:false,reason:'NO_START_PTH_NODE'};
          const options=pathGraph!.edges.filter((edge)=>edge.crossRoom&&edge.validWalkmeshEndpoints).flatMap((edge)=>[[edge.from,edge.to],[edge.to,edge.from]] as const).map(([from,to])=>({from,to,path:findPathBfs(pathGraph!,startNode.id,from)})).filter((row)=>row.path); options.sort((a,b)=>a.path!.length-b.path!.length); const chosen=options[0]; if(!chosen) return {pass:false,reason:'NO_CONNECTED_CROSS_ROOM_EDGE'};
          const visBefore={room:currentNav?.room,visibleRooms:lastVisibility?.enabledRooms??null,enabledMeshes:lastVisibility?.enabledMeshes??null,fallbackCount:optimizationState?.result.fallbackCount??0};
          const walkNode=(id:number)=>driveTo(pathGraph!.nodes[id].worldPosition!); const routeResults=[]; for(const id of chosen.path!) { const result=await walkNode(id); routeResults.push({node:id,...result}); if(result.blocked||result.distanceRemaining>.75) return {pass:false,reason:'BLOCKED_ON_PTH_ROUTE',chosen,routeResults,visBefore}; }
          const beforeEdge={room:currentNav?.room,face:currentNav?.face,position:walkerFeet!.asArray(),visibleRooms:lastVisibility?.enabledRooms??null,enabledMeshes:lastVisibility?.enabledMeshes??null,fallbackCount:optimizationState?.result.fallbackCount??0}; const fromRoom=currentNav?.room; const edgeWalk=await walkNode(chosen.to); const afterFirst={room:currentNav?.room,face:currentNav?.face,position:walkerFeet!.asArray(),visibleRooms:lastVisibility?.enabledRooms??null,enabledMeshes:lastVisibility?.enabledMeshes??null,fallbackCount:optimizationState?.result.fallbackCount??0,method:currentNav?.method}; const firstPass=Boolean(!edgeWalk.blocked&&fromRoom&&currentNav?.room&&fromRoom!==currentNav.room&&lastVisibility?.currentRoom===currentNav.room&&!(lastVisibility?.fallback));
          const reverseWalk=await walkNode(chosen.from); const afterReturn={room:currentNav?.room,face:currentNav?.face,position:walkerFeet!.asArray(),visibleRooms:lastVisibility?.enabledRooms??null,enabledMeshes:lastVisibility?.enabledMeshes??null,fallbackCount:optimizationState?.result.fallbackCount??0,method:currentNav?.method}; const secondPass=Boolean(firstPass&&!reverseWalk.blocked&&afterFirst.room&&currentNav?.room===fromRoom&&lastVisibility?.currentRoom===fromRoom&&!(lastVisibility?.fallback));
          return {pass:firstPass&&secondPass,visBefore,fromRoom,toRoom:afterFirst.room,transition1:{fromRoom,toRoom:afterFirst.room,position:afterFirst.position,oldFace:beforeEdge.face,newFace:afterFirst.face,method:afterFirst.method,visBefore:beforeEdge,visAfter:afterFirst,pass:firstPass},transition2:{fromRoom:afterFirst.room,toRoom:afterReturn.room,position:afterReturn.position,oldFace:afterFirst.face,newFace:afterReturn.face,method:afterReturn.method,visBefore:afterFirst,visAfter:afterReturn,pass:secondPass},route:{startNode:startNode.id,fromNode:chosen.from,toNode:chosen.to,path:chosen.path,returnFrames:reverseWalk.frames},routeResults,roomTransitions:roomTransitions.slice(-2)};
        }
      };
      const navProofPanel = document.createElement('div'); navProofPanel.id = 'anchorheadNavProofPanel'; navProofPanel.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:10000;background:#101820ed;color:#dce8e8;padding:10px;border:1px solid #53666b;border-radius:6px;font:12px monospace;max-width:380px;';
      const proofOutput = document.createElement('pre'); proofOutput.id = 'anchorheadNavProofOutput'; proofOutput.style.cssText = 'max-height:180px;overflow:auto;white-space:pre-wrap;margin:8px 0 0;';
      const addProofButton = (label: string, id: string, run: () => Promise<any> | any) => { const button = document.createElement('button'); button.id = id; button.textContent = label; button.style.cssText = 'margin:2px;padding:5px 7px;cursor:pointer;'; button.onclick = async () => { button.disabled = true; try { const result = await run(); (window as any).__anchorheadNavProofResults ??= {}; (window as any).__anchorheadNavProofResults[id] = result; proofOutput.textContent = JSON.stringify(result, null, 2); } catch (error) { proofOutput.textContent = String(error); } finally { button.disabled = false; } }; navProofPanel.appendChild(button); };
      addProofButton('Movement proof', 'nav-proof-movement', () => (window as any).__anchorheadNavTest.movementProof(30)); addProofButton('Transition A↔B', 'nav-proof-transition', () => (window as any).__anchorheadNavTest.roomTransitionProof()); addProofButton('Edge reject', 'nav-proof-edge', () => (window as any).__anchorheadNavTest.edgeRejectionProof()); navProofPanel.appendChild(proofOutput); root.appendChild(navProofPanel);
      publishNavState();
    }
    if (PLAYABLE && navigationWorld && pathGraph) {
      options.onLifecycleState?.('SPAWN_LEADER');
      playable = await AnchorheadPlayerAdapter.create(scene, navigationWorld, pathGraph, semanticBounds, (position) => optimizationState?.updateVisibility(position), PLAYABLE_PROFILE ?? PLAYER_CHARACTERS.aren);
      const technicalCamera = camera;
      options.onLifecycleState?.('CAMERA_ATTACH');
      camera = playable.camera.camera;
      technicalCamera.dispose();
      scene.activeCamera = camera;
      currentNav = detectCurrentRoomV2(playable.navPosition, navigationWorld, { previousRoom: playable.spawnRoom, semanticBounds });
      (window as any).__anchorheadPlayerState = playable.state();
      (window as any).__anchorheadPlayableSpawn = { room: playable.spawnRoom, face: playable.spawnFace, position: playable.spawnPosition.asArray(), navigationPosition: playable.navigationSpawnPosition.asArray(), height: playable.spawnPosition.y, yaw: playable.spawnYaw };
      const activeCompanions = (options.companions ?? []).filter((id) => id !== PLAYABLE_PROFILE?.id);
      if (options.verticalSlice && activeCompanions.length) {
        options.onLifecycleState?.('SPAWN_COMPANIONS');
        companionController = await CompanionController.create({
          scene, navigation: navigationWorld, graph: pathGraph, leaderRoom: playable.spawnRoom,
          leaderPosition: { x: playable.navigationSpawnPosition.x, y: playable.navigationSpawnPosition.y, z: playable.navigationSpawnPosition.z },
          leaderRenderPosition: playable.spawnPosition, leaderYaw: playable.player.visualRoot.rotation.y,
          party: activeCompanions.map((id, index) => id === 'mission'
            ? { id, slot: index === 0 ? 'rear-left' as const : 'rear-right' as const, assetPath: '/_lab/kotor/characters/mission/mission_vao_kotor_donor_w230_3o_candidate.glb', profilePath: '/_lab/kotor/characters/mission/mission_jedi_animation_profile.json' }
            : id === 'nara'
              ? { id, slot: index === 0 ? 'rear-left' as const : 'rear-right' as const, assetPath: '/_lab/kotor/characters/belaya/belaya_kotor1_donor.glb', profilePath: '/_lab/kotor/characters/belaya/belaya_nara_runtime_profile.json' }
              : { id, slot: index === 0 ? 'rear-left' as const : 'rear-right' as const, assetPath: '/_lab/kotor/characters/jolee/jolee_bindo_kotor1.glb', profilePath: '/_lab/kotor/characters/jolee/jolee_jedi_profile.json' }),
        });
      }
      const actorMeshes = scene.meshes.filter((mesh) => {
        let node: any = mesh;
        while (node) { if (node.metadata?.w236ActorIdentity) return true; node = node.parent; }
        return false;
      });
      characterLighting = new CharacterPresentationLighting(scene, actorMeshes, 'outdoor');
      if (options.verticalSlice && playable) {
        (window as any).__w236AnchorheadTest = {
          state: () => ({ leader: playable?.state() ?? null, party: companionController?.state() ?? null }),
          runPthSmoke: async (mode: 'walk' | 'run') => ({ ...(await playable!.runPthDistanceSmoke(mode, 20)), party: companionController?.state() ?? null }),
          moveHold: async (keys: string[], durationMs: number) => {
            const before = playable!.state();
            const dispatch = (type: 'keydown' | 'keyup') => keys.forEach((key) => window.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true, cancelable: true })));
            dispatch('keydown');
            try { await new Promise((resolve) => window.setTimeout(resolve, Math.max(100, Math.min(durationMs, 30000)))); }
            finally { dispatch('keyup'); }
            await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
            const after = playable!.state();
            return { keys, durationMs, before, after, walked: after.distanceWalked - before.distanceWalked, ran: after.distanceRun - before.distanceRun, party: companionController?.state() ?? null };
          },
        };
      }
      help.textContent = NAV_DEBUG ? `${PLAYABLE_PROFILE?.displayName ?? 'PLAYER'} PLAYABLE · WASD WALK · SHIFT RUN · DRAG MOUSE LOOK · BWM DEBUG ON` : `${PLAYABLE_PROFILE?.displayName ?? 'PLAYER'} · WASD WALK · SHIFT RUN · DRAG MOUSE LOOK`;
      hud.hidden = !NAV_DEBUG; metrics.hidden = !NAV_DEBUG; title.hidden = NAV_DEBUG;
      const playerStateJson = document.createElement('script'); playerStateJson.type = 'application/json'; playerStateJson.id = 'anchorheadPlayerStateJson'; root.appendChild(playerStateJson); (window as any).__anchorheadPlayerStateJson = playerStateJson;
      if (query.get('playableTest') === '1') {
        const panel = document.createElement('div'); panel.id = 'anchorheadPlayableTestPanel'; panel.style.cssText = 'position:fixed;right:10px;top:10px;z-index:10000;background:#101820ed;color:#dce8e8;padding:8px;border:1px solid #53666b;border-radius:6px;font:11px monospace;max-width:190px;pointer-events:auto;';
        const output = document.createElement('pre'); output.id = 'anchorheadPlayableTestOutput'; output.style.cssText = 'max-height:150px;overflow:auto;white-space:pre-wrap;margin:6px 0 0;';
        const hold = async (keys: string[], durationMs: number) => {
          const before = playable!.state();
          const setKeys = (type: 'keydown' | 'keyup') => keys.forEach((key) => window.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true, cancelable: true })));
          let midpoint: ReturnType<AnchorheadPlayerAdapter['state']> | null = null;
          setKeys('keydown');
          try {
            await new Promise((resolve) => window.setTimeout(resolve, durationMs / 2));
            midpoint = playable!.state();
            await new Promise((resolve) => window.setTimeout(resolve, durationMs - durationMs / 2));
          } finally {
            setKeys('keyup');
          }
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          const after = playable!.state(); const result = { keys, durationMs, start: before.position, midpoint, end: after.position, walked: after.distanceWalked - before.distanceWalked, ran: after.distanceRun - before.distanceRun, state: after };
          (window as any).__anchorheadPlayableTestResults ??= []; (window as any).__anchorheadPlayableTestResults.push(result); output.textContent = JSON.stringify(result, null, 2); return result;
        };
        const addButton = (label: string, keys: string[], durationMs: number) => { const button = document.createElement('button'); button.textContent = label; button.style.cssText = 'margin:2px;padding:5px;cursor:pointer;'; button.onclick = () => { button.disabled = true; void hold(keys, durationMs).finally(() => { button.disabled = false; }); }; panel.appendChild(button); };
        addButton('WALK W 5s', ['w'], 5000); addButton('WALK S 5s', ['s'], 5000); addButton('RUN W 5s', ['shift','w'], 5000); addButton('STRAFE A 2s', ['a'], 2000); panel.appendChild(output); root.appendChild(panel);
        const addPthSmoke = (mode: 'walk' | 'run') => { const button = document.createElement('button'); button.textContent = `${mode.toUpperCase()} BWM ≥20m`; button.style.cssText = 'margin:2px;padding:5px;cursor:pointer;'; button.onclick = async () => { button.disabled = true; try { const result = await playable!.runPthDistanceSmoke(mode, 20); (window as any).__anchorheadPthSmokeResults ??= {}; (window as any).__anchorheadPthSmokeResults[mode] = result; output.textContent = JSON.stringify(result, null, 2); } catch (error) { output.textContent = `PTH_${mode.toUpperCase()}_SMOKE_FAILED: ${String(error)}`; } finally { button.disabled = false; } }; panel.appendChild(button); };
        addPthSmoke('walk'); addPthSmoke('run');
        if (characterLighting) { const lightButton = document.createElement('button'); lightButton.textContent = 'CHARACTER LIGHTS A/B'; lightButton.style.cssText = 'margin:2px;padding:5px;cursor:pointer;'; lightButton.onclick = () => { const enabled = !(characterLighting?.state().enabled ?? false); characterLighting?.setEnabled(enabled); output.textContent = `Character-only lighting ${enabled ? 'ON' : 'OFF'}; worldMeshesAffected=0`; }; panel.appendChild(lightButton); }
      }
      if (NAV_DEBUG) status.textContent = `AREN READY · ${playable.spawnRoom} · FACE ${playable.spawnFace}`;
      else status.hidden = true;
    }
  } catch (error) {
    status.textContent = `LOAD FAILED · ${error instanceof Error ? error.message : String(error)}`;
    if (options.verticalSlice) {
      options.onLoadFailure?.(error);
      runtimeHandle.disposeActors();
      runtimeHandle.disposeWorld();
      throw error;
    }
  }
  const loadTime = performance.now() - start;
  keyDownHandler = (event) => { const key=event.key.toLowerCase(); if (NAV_DEBUG && !PLAYABLE && ['w','a','s','d','shift'].includes(key)) { navKeys.add(key); event.preventDefault(); return; } if (event.repeat) return; if (!PLAYABLE && key === 'h') { humanMode = !humanMode; camera.position.y = humanMode ? 1.7 : Math.max(8, camera.position.y); } if (!PLAYABLE && key === 'r' && bounds) { camera.position = bounds.center.add(new Vector3(-bounds.size.x*.25, humanMode ? 1.7 : bounds.size.y*.25, -bounds.size.z*.25)); camera.setTarget(bounds.center); } if (key === 'l') { lightmapsOn = !lightmapsOn; applyLightmaps(imported?.meshes ?? [], sidecar, lightmapsOn, false, false, false); } if (!PLAYABLE && key === 'm') markerRoot.setEnabled(!markerRoot.isEnabled()); if (!PLAYABLE && key === 'p') pthRoot.setEnabled(!pthRoot.isEnabled()); if (key === 'w' && !NAV_DEBUG && !PLAYABLE) walkRoot.setEnabled(!walkRoot.isEnabled()); if (!PLAYABLE && '12345'.includes(event.key)) setView(Number(event.key), camera, bounds, humanMode); };
  keyUpHandler = (event) => { if (NAV_DEBUG && !PLAYABLE) navKeys.delete(event.key.toLowerCase()); };
  blurHandler = () => navKeys.clear();
  window.addEventListener('keydown', keyDownHandler); window.addEventListener('keyup', keyUpHandler); window.addEventListener('blur', blurHandler);  const samples: number[] = []; let frameSamples = 0; let lastMetricsAt = 0;
  renderObserver = scene.onBeforeRenderObservable.add(() => {
    frameSamples++;
    const delta = engine.getDeltaTime();
    const engineFpsSample = engine.getFps();
    if (frameSamples > 30 && engineFpsSample > 0 && engineFpsSample < 240 && samples.length < 600) samples.push(engineFpsSample);
    const now = performance.now();
    if (playable) {
      playable.update(delta / 1000);
      const playerState = playable.state();
      currentNav = detectCurrentRoomV2(playable.navPosition, navigationWorld!, { previousRoom: playerState.room, semanticBounds });
      (window as any).__anchorheadPlayerState = playerState;
      if ((window as any).__anchorheadPlayerStateJson) (window as any).__anchorheadPlayerStateJson.textContent = JSON.stringify(playerState);
      if (companionController && playerState.room) companionController.update(delta / 1000, playable.player.position, { x: playable.navPosition.x, y: playable.navPosition.y, z: playable.navPosition.z }, playerState.room, playerState.face, playable.player.visualRoot.rotation.y);
    }
    else if (NAV_DEBUG && navKeys.size > 0) applyWalkerInput(navKeys, delta);
    else if (NAV_DEBUG) publishNavState();
    const visibilityPoint = playable ? playable.navPosition : NAV_DEBUG && walkerFeet ? walkerFeet : camera.position;
    if (visEnabled) lastVisibility = optimizationState?.updateVisibility(visibilityPoint) ?? lastVisibility;
    if (now - lastMetricsAt < 500) return;
    lastMetricsAt = now;
    const allRenderMeshes = scene.meshes.filter((mesh) => !mesh.isDisposed() && mesh.getTotalVertices() > 0);
    const activeList = scene.getActiveMeshes().data as AbstractMesh[];
    const active = activeList.length;
    const tris = activeList.reduce((n, mesh) => n + mesh.getTotalIndices() / 3, 0);
    const mats = new Set(allRenderMeshes.map((mesh) => mesh.material).filter(Boolean)).size;
    const enabledMeshes = allRenderMeshes.filter((mesh) => mesh.isEnabled()).length;
    const fpsRaw = engine.getFps();
    const fps = Number.isFinite(fpsRaw) && fpsRaw > 0 ? fpsRaw : (delta > 0 ? 1000 / delta : 0);
    const min = samples.length ? Math.min(...samples) : 0;
    const avg = samples.length ? samples.reduce((a, b) => a + b, 0) / samples.length : 0;
    const max = samples.length ? Math.max(...samples) : 0;
    const optimization = optimizationState?.result;
    const vis = lastVisibility;
    const totalTriangles = optimization?.totalTrianglesAfter ?? allRenderMeshes.reduce((n, mesh) => n + mesh.getTotalIndices() / 3, 0);
    const debugMeshes = new Set<AbstractMesh>([...markerRoot.getChildMeshes(), ...pthRoot.getChildMeshes(), ...walkRoot.getChildMeshes()]);
    if (navWalker) debugMeshes.add(navWalker);
    const debugGeometryTriangles = [...debugMeshes].reduce((n, mesh) => n + mesh.getTotalIndices() / 3, 0);
    const drawCallsValue = null;
    const runtime = {
      view: new URLSearchParams(window.location.search).get('view') ?? 'default',
      asset: ASSET,
      materialMode: MATERIAL_MODE,
      optimizationMode: OPTIMIZATION_MODE,
      loadTimeMs: Math.round(loadTime),
      fps: { min: Number(min.toFixed(2)), avg: Number(avg.toFixed(2)), max: Number(max.toFixed(2)), instantaneous: Number(fps.toFixed(2)), samples: samples.length },
      frameTimeMs: { instantaneous: Number(delta.toFixed(2)), averageFromFpsSamples: samples.length ? Number((1000 / (samples.reduce((a, b) => a + b, 0) / samples.length)).toFixed(2)) : null },
      activeMeshes: active,
      enabledMeshes,
      totalRenderMeshes: optimization?.optimizedMeshCount ?? allRenderMeshes.length,
      totalSourceRenderMeshes: optimization?.sourceMeshCount ?? imported?.meshes.filter((mesh) => mesh.getTotalVertices() > 0).length ?? 0,
      triangles: Math.round(tris),
      totalTriangles,
      worldTriangles: totalTriangles,
      debugGeometryTriangles: Math.round(debugGeometryTriangles),
      shaderCompileErrors: shaderCompileErrors.length,
      shaderSourceAudit: (window as any).__anchorheadShaderSourceAudit ?? null,
      materials: mats,
      textures: scene.textures.length,
      drawCalls: Number.isFinite(drawCallsValue) ? drawCallsValue : null,
      odysseyShaderMeshes: (scene as any).__anchorheadOdysseyStats?.odysseyShaderMeshes ?? 0,
      nonLightmappedMeshes: (scene as any).__anchorheadOdysseyStats?.nonLightmappedMeshes ?? 0,
      failedShaderBindings: (scene as any).__anchorheadOdysseyStats?.failedShaderBindings ?? 0,
      uniqueDiffuseImages: (scene as any).__anchorheadOdysseyStats?.uniqueDiffuseImages ?? 0,
      uniqueLightmapFiles: (scene as any).__anchorheadOdysseyStats?.uniqueLightmapFiles ?? lightmapTextureCache.size,
      uniqueOdysseyShaderMaterials: (scene as any).__anchorheadOdysseyStats?.uniqueShaderMaterials ?? 0,
      freezeWorldMatrices: optimization?.freezeWorldMatrices ?? 0,
      freezeMaterials: optimization?.freezeMaterials ?? 0,
      merge: optimization ? { mergedSourceMeshes: optimization.mergedSourceMeshes, optimizedMeshes: optimization.optimizedMeshCount, mergeGroups: optimization.mergeGroups, opaqueMerged: optimization.opaqueMerged, maskMerged: optimization.maskMerged, blendMerged: optimization.blendMerged, totalTrianglesBefore: optimization.totalTrianglesBefore, totalTrianglesAfter: optimization.totalTrianglesAfter } : null,
      materialSampleRegression: optimization?.materialSampleRegression ?? null,
      visRoomCount: optimization?.vis.renderableRoomCount ?? null,
      visEdges: optimization?.vis.edges ?? null,
      visUnresolvedReferences: optimization ? optimization.vis.unresolvedReferences.length + optimization.vis.unresolvedSources.length : null,
      currentRoom: vis?.currentRoom ?? null,
      navigationConvention: 'ROOM_LOCAL_BWM_WITH_LYT',
      enabledRooms: vis?.enabledRooms ?? null,
      visFallback: vis?.fallback ?? false,
      visFallbackCount: optimization?.fallbackCount ?? 0,
      navigation: NAV_DEBUG && currentNav ? { method: currentNav.method, room: currentNav.room, face: currentNav.face, surfaceType: currentNav.surfaceType, height: currentNav.height, walker: walkerFeet?.asArray() ?? null, roomTransitions: roomTransitions.length } : null,
      bounds: bounds ? { min: bounds.min.asArray(), max: bounds.max.asArray(), size: bounds.size.asArray() } : null,
      party: companionController?.state() ?? null,
      characterLighting: characterLighting?.state() ?? null,
      actorCounts: countW236Resources(scene).actorCounts,
    };
    hud.innerHTML = '<b>ANCHORHEAD LAB · W228.5</b><br>MODE ' + OPTIMIZATION_MODE.toUpperCase() + '<br>LOAD TIME ' + Math.round(loadTime) + ' ms<br>FPS ' + fps.toFixed(1) + ' · SAMPLE ' + samples.length + '/600<br>MESHES ' + runtime.totalRenderMeshes + ' · ACTIVE ' + active + ' · ENABLED ' + enabledMeshes + '<br>TRIANGLES ' + Math.round(tris).toLocaleString() + ' / ' + Math.round(totalTriangles).toLocaleString() + '<br>MATERIALS ' + mats + ' · TEXTURES ' + scene.textures.length + '<br>ODYSSEY SHADER ' + runtime.odysseyShaderMeshes + ' · LIGHTMAPS ' + runtime.uniqueLightmapFiles + '<br>ROOM ' + (runtime.currentRoom ?? 'FALLBACK/ALL') + ' · VIS ROOMS ' + (runtime.enabledRooms ?? '—') + '<br>HUMAN HEIGHT ' + (humanMode ? 'ON' : 'OFF') + ' · LIGHTMAP ' + (lightmapsOn ? 'ON' : 'OFF') + (runtime.navigation ? '<br>NAV ' + (runtime.navigation.room ?? 'UNRESOLVED') + ' · FACE ' + (runtime.navigation.face ?? '—') + ' · SURFACE ' + (runtime.navigation.surfaceType ?? '—') + ' · Y ' + (runtime.navigation.height?.toFixed(2) ?? '—') + ' · ' + runtime.navigation.method : '');
    metrics.textContent = JSON.stringify(runtime, null, 2);
    (window as any).__anchorheadRuntimeMetrics = runtime;
    const w236State = (window as any).__nerathisWorldState;
    if (w236State) { w236State.currentWorld = { id: 'anchorhead_tat_m17aa', sourceGame: 'KOTOR I', module: 'tat_m17aa', navigationConvention: 'ROOM_LOCAL_BWM_WITH_LYT' }; w236State.leader = playable?.state() ?? null; w236State.party = companionController?.state() ?? null; w236State.vis = { currentRoom: vis?.currentRoom ?? null, enabledRooms: vis?.enabledRooms ?? null, fallback: vis?.fallback ?? false, fallbackCount: optimization?.fallbackCount ?? 0 }; w236State.resources = countW236Resources(scene); }
  });
  const cameraDebug = document.createElement('script'); cameraDebug.type='application/json'; cameraDebug.id='anchorheadCameraRuntimeJson'; root.appendChild(cameraDebug);
  const exportCamera = () => { camera.computeWorldMatrix(); const aspect=engine.getRenderWidth()/engine.getRenderHeight(); const snapshot={asset:ASSET,room:'m17aa_03',viewport:{width:engine.getRenderWidth(),height:engine.getRenderHeight()},position:camera.position.asArray(),target:camera.getTarget().asArray(),forward:camera.getForwardRay().direction.asArray(),upVector:camera.upVector.asArray(),fov:camera.fov,minZ:camera.minZ,maxZ:camera.maxZ,aspect,handedness:scene.useRightHandedSystem?'right-handed':'left-handed',rootTransform:'-X,Y,Z',worldMatrix:camera.getWorldMatrix().asArray(),viewMatrix:camera.getViewMatrix().asArray(),projectionMatrix:camera.getProjectionMatrix().asArray()}; (window as any).__anchorheadCameraRuntime=snapshot; cameraDebug.textContent=JSON.stringify(snapshot); return snapshot; };
  const captureReady = async () => { await scene.whenReadyAsync(); for (let i=0;i<8;i++) { scene.render(); await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined))); } exportCamera(); root.dataset.captureReady='true'; document.documentElement.dataset.captureReady='true'; root.setAttribute('data-capture-ready','true'); const shaderFallbackRequests=performance.getEntriesByType('resource').map((entry)=>entry.name).filter((url)=>url.includes('/src/Shaders/anchorheadOdysseyMultiply')); (window as any).__anchorheadShaderSourceAudit={mode:'INLINE_SOURCE',vertexSourceProvided:true,fragmentSourceProvided:true,invalidHtmlGuard:'ODYSSEY_SHADER_SOURCE_INVALID_HTML',fallbackRequests:shaderFallbackRequests,compileErrors:shaderCompileErrors.slice()}; (window as any).__anchorheadCaptureState={ready:true,sceneReady:true,asset:ASSET,camera:(window as any).__anchorheadCameraRuntime,lightmaps:lightmapsOn,meshes:imported?.meshes.length ?? 0,activeMeshes:scene.getActiveMeshes().length,materials:new Set(scene.meshes.map((m)=>m.material).filter(Boolean)).size,textures:scene.textures.length}; };
  renderLoop = () => {
    if (PLAYABLE_PROFILE?.id === 'jolee' && playable) {
      (window as any).__joleeAnimationTrace = {
        leaderId: 'jolee',
        ...playable.state().animationResolution,
        characterId: 'jolee',
      };
    }
    scene.render();
  };
  resizeHandler = () => engine.resize();
  engine.runRenderLoop(renderLoop);
  window.addEventListener('resize', resizeHandler);
  if (options.verticalSlice) {
    const timeout = new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error('W236_ANCHORHEAD_READY_TIMEOUT_45000MS')), 45_000));
    try {
      await Promise.race([captureReady(), timeout]);
      options.onLifecycleState?.('READY');
      return runtimeHandle;
    } catch (error) {
      runtimeHandle.disposeActors();
      runtimeHandle.disposeWorld();
      throw error;
    }
  }
  void captureReady();
  return runtimeHandle;
}

function setView(index: number, camera: FreeCamera, bounds: { center: Vector3; size: Vector3 } | undefined, human: boolean) { if (!bounds) return; if (index===7) { camera.position=new Vector3(172.8824676513672,12.863977813720703,-280.2092742919922); camera.setTarget(new Vector3(214.60420368057413,3.5640800634498824,-249.40659773836217)); return; } const c=bounds.center, s=bounds.size; if (index===6) { camera.position=new Vector3(c.x-s.x*.9,c.y+s.y*.45,c.z-s.z*.9); camera.setTarget(c); return; } const walk=WALK_CAMERA_POINTS[index]; if (walk) { camera.position=Vector3.FromArray(walk.position); camera.setTarget(Vector3.FromArray(walk.target)); return; } const poses=[new Vector3(c.x,c.y+s.y*.8,c.z),new Vector3(c.x-s.x*.55,c.y+s.y*.3,c.z-s.z*.55),new Vector3(c.x-s.x*.22,human?1.7:c.y+s.y*.08,c.z-s.z*.34),new Vector3(c.x+s.x*.22,human?1.7:c.y+s.y*.08,c.z-s.z*.30),new Vector3(c.x+s.x*.36,human?1.7:c.y+s.y*.08,c.z+s.z*.30),new Vector3(c.x-s.x*.05,human?1.7:c.y+s.y*.08,c.z-s.z*.05)]; const p=poses[Math.min(index-1,5)]; camera.position=p; camera.setTarget(index===1?c:p.add(new Vector3(0,0,1))); }
function buildRuntimeNavigationAudit(world: NavigationWorld | undefined, graph: ReturnType<typeof buildAnchorheadPathGraph> | undefined, semantic: NavSemanticRows | undefined, semanticBounds: Array<{ room: string; min: NavPoint; max: NavPoint }>, metadata: RuntimeMetadata) {
  if (!world || !graph || !semantic) return { enabled: false };
  const samples = deterministicWalkableSamples(world, 30).map((sample) => {
    const hit = projectToWalkmesh(sample.point, world, { currentRoom: sample.expectedRoom, allowedRooms: [sample.expectedRoom], maxHorizontalDistance: 0, maxVerticalDistance: .001 });
    return { point: sample.point, room: sample.expectedRoom, face: sample.expectedFace, expectedHeight: sample.expectedHeight, resolvedHeight: hit?.height ?? null, delta: hit ? Math.abs(hit.height - sample.expectedHeight) : null, pass: Boolean(hit && hit.room === sample.expectedRoom && hit.face === sample.expectedFace && Math.abs(hit.height - sample.expectedHeight) < .001) };
  });
  const roomTests = world.rooms.flatMap((room) => room.walkableFaces.slice(0, 1).map((face) => {
    const point = { x: (face.vertices[0].x + face.vertices[1].x + face.vertices[2].x) / 3, y: (face.vertices[0].y + face.vertices[1].y + face.vertices[2].y) / 3, z: (face.vertices[0].z + face.vertices[1].z + face.vertices[2].z) / 3 };
    return detectCurrentRoomV2(point, world, { previousRoom: room.room, semanticBounds });
  }));
  const pathTests = buildPathTests(graph);
  return {
    enabled: true,
    walkmesh: { resources: world.rooms.length, withGeometry: world.rooms.filter((r) => r.faces.length).length, emptyValid: world.rooms.filter((r) => !r.faces.length).length, faceCount: world.faceCount, walkableFaces: world.walkableFaceCount, nonWalkableFaces: world.nonWalkableFaceCount, unknownFaces: world.unknownFaceCount },
    currentRoomDetection: 'BWM walkable point-in-triangle; room semantic bounds fallback; unresolved safely retains VIS-all fallback',
    roomDetectionTests: { count: roomTests.length, pass: roomTests.filter((r) => r.room && r.method === 'BWM_POINT_IN_WALKABLE_TRIANGLE').length, fail: roomTests.filter((r) => !r.room || r.method !== 'BWM_POINT_IN_WALKABLE_TRIANGLE').length },
    projectionTests: { count: samples.length, pass: samples.filter((s) => s.pass).length, fail: samples.filter((s) => !s.pass).length, samples },
    pth: { nodes: graph.sourceNodeCount, connections: graph.sourceConnectionCount, projected: graph.nodes.filter((n) => n.projected).length, unresolved: graph.nodes.filter((n) => !n.projected).length, invalidConnections: graph.invalidConnectionIndices, asymmetricConnections: graph.asymmetricConnections, connectedComponents: graph.connectedComponents.length, pathTests, crossRoomPaths: pathTests.filter((t) => t.roomsCrossed.length > 1).length },
    semantics: { doors: semantic.doors.length, doorsWithRoom: semantic.doors.filter((d) => d.room).length, doorsByType: { roomTransition: semantic.doors.filter((d) => d.semantic === 'ROOM_TRANSITION').length, moduleTransition: semantic.doors.filter((d) => d.semantic === 'MODULE_TRANSITION').length, unknown: semantic.doors.filter((d) => d.semantic === 'STATIC/UNKNOWN').length }, triggers: semantic.triggers.length, triggersWithRoom: semantic.triggers.filter((d) => d.room).length, waypoints: semantic.waypoints.length, waypointsWithRoom: semantic.waypoints.filter((d) => d.room).length, actors: semantic.actors.length, actorsWithRoom: semantic.actors.filter((d) => d.room).length, placeables: semantic.placeables.length, placeablesWithRoom: semantic.placeables.filter((d) => d.room).length, visualActorsLoaded: false },
    vis: { sourceRooms: metadata.visibility?.rooms ? Object.keys(metadata.visibility.rooms).length : null, runtimeLayer: 'W228.4 MERGE_VIS, unresolved current room falls back to all rooms' },
    semanticBoundsRooms: semanticBounds.length,
    runtime: 'LAB_ONLY',
  };
}

function makeNormalizedPthDebug(graph: ReturnType<typeof buildAnchorheadPathGraph>, root: TransformNode, scene: Scene) {
  const valid: Vector3[][] = [], suspect: Vector3[][] = [];
  for (const edge of graph.edges) {
    const a = graph.nodes[edge.from]?.worldPosition, b = graph.nodes[edge.to]?.worldPosition; if (!a || !b) continue;
    (edge.validWalkmeshEndpoints ? valid : suspect).push([new Vector3(a.x,a.y+.12,a.z),new Vector3(b.x,b.y+.12,b.z)]);
  }
  for (const [name,lines,color] of [['PTH_Valid',valid,new Color3(.15,.95,.45)],['PTH_Suspect',suspect,new Color3(1,.25,.2)]] as Array<[string,Vector3[][],Color3]>) {
    if (!lines.length) continue; const mesh=MeshBuilder.CreateLineSystem(name,{lines,updatable:false},scene); mesh.color=color; mesh.alpha=.85; mesh.parent=root; mesh.isPickable=false;
  }
  for (const node of graph.nodes) {
    if (!node.worldPosition) continue; const marker=MeshBuilder.CreateSphere(`PTH_Node_${node.id}`,{diameter:.36},scene); marker.position=new Vector3(node.worldPosition.x,node.worldPosition.y+.18,node.worldPosition.z); const material=new StandardMaterial(`PTH_Node_Mat_${node.id}`,scene); material.diffuseColor=node.projected?new Color3(.1,.9,.35):new Color3(1,.2,.15); material.emissiveColor=material.diffuseColor.scale(.35); marker.material=material; marker.parent=root; marker.isPickable=false;
  }
}

function makeNormalizedSemanticDebug(rows: NavSemanticRows, root: TransformNode, scene: Scene) {
  const groups: Array<[string,any[],Color3]> = [['Doors',rows.doors,new Color3(1,.32,.15)],['Triggers',rows.triggers,new Color3(.95,.2,.72)],['Waypoints',rows.waypoints,new Color3(1,.86,.15)],['ActorSpawns',rows.actors,new Color3(.25,1,.45)],['Placeables',rows.placeables,new Color3(.25,.65,1)]];
  for (const [name,items,color] of groups) for (const item of items) {
    if (!item.worldPosition) continue;
    const marker=MeshBuilder.CreateSphere(`${name}_${item.id}`,{diameter:name==='Waypoints'?.22:.42},scene); marker.position=new Vector3(item.worldPosition.x,item.worldPosition.y+.25,item.worldPosition.z); const mat=new StandardMaterial(`${name}_mat_${item.id}`,scene); mat.diffuseColor=item.room?color:color.scale(.45); mat.emissiveColor=color.scale(.3); marker.material=mat; marker.parent=root; marker.isPickable=false;
    if (name==='Triggers' && item.worldVertices?.length>=3) { const points=item.worldVertices.map((p:any)=>new Vector3(p[0],p[1]+.1,p[2])); const lines=points.map((p:Vector3,i:number)=>[p,points[(i+1)%points.length]]); const outline=MeshBuilder.CreateLineSystem(`TriggerOutline_${item.id}`,{lines,updatable:false},scene); outline.color=color; outline.alpha=.8; outline.parent=root; outline.isPickable=false; }
  }
}

function makeMarkers(meta: RuntimeMetadata, root: TransformNode, scene: Scene, key: keyof RuntimeMetadata, color: Color3) { const items: any = meta[key]?.instances; if (!items) return; const values = Array.isArray(items) ? items : Object.values(items); (values as any[]).forEach((item) => { const f=item.raw_fields ?? item; const x=Number(f.X ?? f.XPosition), y=Number(f.Y ?? f.YPosition), z=Number(f.Z ?? f.ZPosition); if (![x,y,z].every(Number.isFinite)) return; const marker=MeshBuilder.CreateSphere(`${String(key)}_marker`,{diameter:.45},scene); marker.position=axis(x,y,z); const m=new StandardMaterial(`${String(key)}_material`,scene); m.diffuseColor=color; m.emissiveColor=color.scale(.45); marker.material=m; marker.parent=root; marker.isPickable=false; }); }
function applyLightmaps(meshes: AbstractMesh[], sidecar: any, enabled: boolean, invertY: boolean, gammaSpace = false, useShadowmap = false) { const entries=Object.values(sidecar?.meshes ?? {}) as any[]; const byMesh=new Map(entries.map((e) => [e.mesh, e])); meshes.forEach((mesh) => { const original=mesh.material; if (!original || !(original instanceof StandardMaterial || original instanceof PBRMaterial)) return; let parent=mesh.parent; let room: string | undefined; while (parent) { if (parent.name.startsWith('GLB_Room_') || parent.name.startsWith('Room_')) { room=parent.name.replace(/^GLB_Room_/,'').replace(/^Room_/,''); break; } parent=parent.parent; } const key=room ? `${room}::${mesh.name}` : ''; const entry=byMesh.get(key); if (!enabled) { const runtime=lightmapRuntimeClones.get(mesh.uniqueId); if (runtime) (runtime as any).lightmapTexture=null; else (original as any).lightmapTexture=null; return; } if (!entry?.lightmap) return; const uvSet=entry.uvSet ?? 1; const pairKey=`${original.uniqueId}|${entry.lightmap}|${uvSet}|${invertY}|${gammaSpace}|${useShadowmap}`; let material=lightmapPairMaterials.get(pairKey); if (!material) { material=original.clone(`${original.name}_lightmap_${entry.lightmap}_${uvSet}_${invertY ? 'flip' : 'normal'}_${gammaSpace ? 'srgb' : 'linear'}`); lightmapPairMaterials.set(pairKey,material); } lightmapRuntimeClones.set(mesh.uniqueId,material); mesh.material=material; let tex=lightmapTextureCache.get(`${entry.lightmap}|${invertY}|${gammaSpace}`); if (!tex) { tex=new Texture(`${LIGHTMAP_BASE}${entry.lightmap}.tga`, mesh.getScene(), true, invertY); tex.coordinatesIndex=uvSet; tex.gammaSpace=gammaSpace; lightmapTextureCache.set(`${entry.lightmap}|${invertY}|${gammaSpace}`,tex); } (material as any).lightmapTexture=tex; (material as any).useLightmapAsShadowmap=useShadowmap; (material as any).__anchorheadLightmapPair=pairKey; }); }
function applyOdysseyMultiplyShader(meshes: AbstractMesh[], sidecar: any, debugMode = 3) { const entries=Object.values(sidecar?.meshes ?? {}) as any[]; const byMesh=new Map(entries.map((e) => [e.mesh, e])); const gammaSpace = new URLSearchParams(window.location.search).get('lmGamma') === '1'; meshes.forEach((mesh) => { const original = mesh.material as any; if (!original) return; let parent=mesh.parent; let room: string | undefined; while (parent) { if (parent.name.startsWith('GLB_Room_') || parent.name.startsWith('Room_')) { room=parent.name.replace(/^GLB_Room_/,'').replace(/^Room_/,''); break; } parent=parent.parent; } const key=room ? `${room}::${mesh.name}` : ''; const entry=byMesh.get(key); if (!entry?.lightmap) return; const diffuse=original.albedoTexture ?? original.diffuseTexture ?? null; if (diffuse) diffuse.gammaSpace=false; const diffuseFactor=original.albedoColor ?? original.diffuseColor ?? new Color3(1,1,1); const alphaCutoff=Number(original.alphaCutOff ?? original.alphaCutoff ?? 0); const diffuseId=diffuse?.getInternalTexture?.()?.uniqueId ?? diffuse?.uniqueId ?? 'factor'; const lightmapKey=`${entry.lightmap}|true|${gammaSpace}`; let lightmap=lightmapTextureCache.get(lightmapKey); if (!lightmap) { lightmap=new Texture(`${LIGHTMAP_BASE}${entry.lightmap}.tga`, mesh.getScene(), true, true); lightmap.coordinatesIndex=1; lightmap.gammaSpace=gammaSpace; lightmapTextureCache.set(lightmapKey,lightmap); } const factor=diffuseFactor.asArray?.() ?? [1,1,1]; const pairKey=`${diffuseId}|${entry.lightmap}|${factor.join(',')}|${original.alphaMode ?? 0}|${original.backFaceCulling ?? true}|odyssey-multiply|${debugMode}|${gammaSpace}`; let material=odysseyShaderMaterials.get(pairKey); if (!material) { material=new ShaderMaterial(`AnchorheadOdysseyMultiply_${odysseyShaderMaterials.size}`,mesh.getScene(),{vertexSource:ANCHORHEAD_ODYSSEY_VERTEX_SOURCE,fragmentSource:ANCHORHEAD_ODYSSEY_FRAGMENT_SOURCE,spectorName:'AnchorheadOdysseyMultiplyInline'},{attributes:['position','uv','uv2'],uniforms:['world','view','projection','baseColorFactor','hasDiffuseTexture','alphaCutoff','debugMode'],samplers:['diffuseSampler','lightmapSampler']}); material.setTexture('lightmapSampler',lightmap); if (diffuse) material.setTexture('diffuseSampler',diffuse); material.setColor4('baseColorFactor',new Color4(factor[0] ?? 1,factor[1] ?? 1,factor[2] ?? 1,factor[3] ?? 1)); material.setFloat('hasDiffuseTexture',diffuse ? 1 : 0); material.setFloat('alphaCutoff',alphaCutoff); material.setFloat('debugMode',debugMode); material.backFaceCulling=original.backFaceCulling ?? true; material.alpha=original.alpha ?? 1; (material as any).alphaMode=original.alphaMode ?? 0; (material as any).transparencyMode=original.transparencyMode ?? null; (material as any).__anchorheadOdysseyShaderPair=pairKey; odysseyShaderMaterials.set(pairKey,material); } mesh.material=material; lightmapRuntimeClones.set(mesh.uniqueId,material); }); }

function textureSnapshot(texture: any) { if (!texture) return null; const internal=texture.getInternalTexture?.(); return { name: texture.name ?? null, url: texture.url ?? null, uniqueId: texture.uniqueId ?? null, internalUniqueId: internal?.uniqueId ?? null, gammaSpace: texture.gammaSpace ?? null, coordinatesIndex: texture.coordinatesIndex ?? null, wrapU: texture.wrapU ?? null, wrapV: texture.wrapV ?? null, samplingMode: texture.samplingMode ?? null, ready: texture.isReady?.() ?? null }; }
function materialSnapshot(material: any) { if (!material) return null; const p: any = material; return { name: p.name ?? null, uniqueId: p.uniqueId ?? null, className: p.getClassName?.() ?? p.constructor?.name ?? null, diffuseTexture: textureSnapshot(p.diffuseTexture), albedoTexture: textureSnapshot(p.albedoTexture), lightmapTexture: textureSnapshot(p.lightmapTexture), normalTexture: textureSnapshot(p.bumpTexture ?? p.normalTexture), emissiveTexture: textureSnapshot(p.emissiveTexture), diffuseColor: p.diffuseColor?.asArray?.() ?? null, albedoColor: p.albedoColor?.asArray?.() ?? null, emissiveColor: p.emissiveColor?.asArray?.() ?? null, metallic: p.metallic ?? null, roughness: p.roughness ?? null, alpha: p.alpha ?? null, alphaCutOff: p.alphaCutOff ?? p.alphaCutoff ?? null, backFaceCulling: p.backFaceCulling ?? null, useLightmapAsShadowmap: p.useLightmapAsShadowmap ?? null, lightmapLevel: p.lightmapTexture?.level ?? null }; }
function publishMaterialAudit(scene: Scene, meshes: AbstractMesh[], sidecar: any, asset: string, sampleRoom: string | null, baseMaterials: Set<any>) { const roomMeshes=meshes.filter((m) => m.getTotalVertices() > 0 && m.isEnabled()); const roomOf=(mesh: AbstractMesh) => { let p=mesh.parent; while(p){ if(p.name.startsWith('GLB_Room_')) return p.name.replace(/^GLB_Room_/,''); p=p.parent; } return null; }; const entries=new Map(Object.values(sidecar?.meshes ?? {}).map((e: any) => [e.mesh,e])); const samples=roomMeshes.slice(0,24).map((mesh) => { const entry=entries.get(`${roomOf(mesh)}::${mesh.name}`); return { mesh: mesh.name, uniqueId: mesh.uniqueId, stableId: `${roomOf(mesh)}::${mesh.name}`, room: roomOf(mesh), material: materialSnapshot(mesh.material), sidecar: entry ? { lightmap: entry.lightmap ?? null, uvSet: entry.uvSet ?? null, source: entry.source ?? null } : null, vertices: mesh.getTotalVertices(), indices: mesh.getTotalIndices(), uv0: Boolean(mesh.getVerticesData('uv')), uv1: Boolean(mesh.getVerticesData('uv2')) }; }); const allTextures=scene.textures.map((t: any) => textureSnapshot(t)); const unique=(key: string) => new Set(allTextures.map((t: any) => t?.[key]).filter((v: any) => v !== null && v !== undefined)).size; const audit={ asset, sampleRoom, materialClasses:Array.from(new Set(Array.from(baseMaterials).map((m: any) => m.getClassName?.() ?? m.constructor?.name))), baseMaterialCount:baseMaterials.size, finalMaterialCount:new Set(meshes.map((m) => m.material).filter(Boolean)).size, sampleMeshes:samples, textureIdentity:{ logicalTextureObjects:allTextures.length, uniqueTextureUrls:unique('url'), uniqueInternalTextures:unique('internalUniqueId'), lightmapTextureObjects:allTextures.filter((t: any) => String(t?.url ?? '').includes('/lightmaps/')).length, lightmapInternalTextures:new Set(allTextures.filter((t: any) => String(t?.url ?? '').includes('/lightmaps/')).map((t: any) => t?.internalUniqueId).filter(Boolean)).size }, combine:{ invertY:new Set(samples.map((s: any) => s.material?.lightmapTexture?.invertY)).values().next().value ?? null, gammaSpace:new Set(samples.map((s: any) => s.material?.lightmapTexture?.gammaSpace)).values().next().value ?? null, coordinatesIndex:new Set(samples.map((s: any) => s.material?.lightmapTexture?.coordinatesIndex)).values().next().value ?? null, useLightmapAsShadowmap:new Set(samples.map((s: any) => s.material?.useLightmapAsShadowmap)).values().next().value ?? null } }; let node=document.getElementById('anchorheadMaterialAuditJson') as HTMLScriptElement | null; if (!node) { node=document.createElement('script'); node.type='application/json'; node.id='anchorheadMaterialAuditJson'; document.querySelector('.anchorhead-viewer')?.appendChild(node); } node.textContent=JSON.stringify(audit); (window as any).__anchorheadMaterialAudit=audit; }

function makePth(meta: any, root: TransformNode, scene: Scene) { const nodes=meta?.nodes ?? []; const connections=meta?.connections ?? []; const points=nodes.map((n: any) => axis(Number(n.X), Number(n.Y), 0)); const lines=connections.map((c: any, i: number) => { const from=nodes[i]; const to=nodes[Number(c.Destination)]; return from && to ? [axis(Number(from.X), Number(from.Y), 0), axis(Number(to.X), Number(to.Y), 0)] : null; }).filter(Boolean) as Vector3[][]; if (!lines.length) return; const mesh=MeshBuilder.CreateLineSystem('PTH_Debug_96x226',{lines,updatable:false},scene); mesh.color=new Color3(1,.8,.1); mesh.alpha=.7; mesh.parent=root; }
function makeWalkmesh(meta: any, root: TransformNode, scene: Scene) { const walkables: Vector3[][]=[]; const blocked: Vector3[][]=[]; for (const room of meta?.walkmeshes ?? []) for (const face of room.faces ?? []) { const vs=(face.v ?? []).map((i: number) => room.vertices?.[i]).filter(Boolean).map((v: number[]) => axis(v[0],v[1],v[2]).add(new Vector3(0,.03,0))); if (vs.length!==3) continue; (face.walkable ? walkables : blocked).push([vs[0],vs[1],vs[2],vs[0]]); } const add=(name: string, lines: Vector3[][], color: Color3) => { if (!lines.length) return; const mesh=MeshBuilder.CreateLineSystem(name,{lines,updatable:false},scene); mesh.color=color; mesh.alpha=.65; mesh.parent=root; }; add('Walkmesh_Walkable',walkables,new Color3(.1,.8,1)); add('Walkmesh_Blocked',blocked,new Color3(1,.2,.2)); }
