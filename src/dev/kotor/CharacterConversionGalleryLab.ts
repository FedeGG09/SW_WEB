import {
  ArcRotateCamera, Color3, Color4, Engine, HemisphericLight, MeshBuilder,
  Scene, SceneLoader, StandardMaterial, Vector3,
} from '@babylonjs/core';
import '@babylonjs/loaders/glTF';

type GalleryProfile = { id: string; label: string; category: string; asset: string; appearanceRow?: number; sourceCreatureInstanceIds?: string[] };
type CoverageRow = {
  appearanceRow: number;
  sourceCreatureInstanceIds: string[];
  rigFamily: string;
  derivedGLB?: string | null;
  validationStatus: string;
  blocker?: string | null;
};
type GalleryState = {
  loaded: boolean;
  selected: string;
  category: string;
  asset: string;
  meshes: number;
  transformNodes: number;
  skeletons: Array<{ name: string; joints: number }>;
  animationGroups: string[];
  playingAnimation: string | null;
  appearanceRow?: number;
  sourceCreatureInstanceIds?: string[];
  runtimeStatus: 'LOADING' | 'READY' | 'ERROR';
  error?: string;
};

type GalleryRowResult = GalleryState & {
  exactAppearance: boolean;
  idlePlayback: boolean;
  walkPlayback: boolean | null;
  gesturePlayback: boolean | null;
  returnedToIdle: boolean;
};

declare global {
  interface Window {
    __w238_0a2cGalleryState?: GalleryState;
    __w238_0a2cGalleryValidation?: { status: string; rows: GalleryRowResult[]; blockers: Array<{ appearanceRow: number; reason: string }> };
  }
}

const PROFILES: GalleryProfile[] = [
  { id: 'pmhb05', label: 'Jedi · PMHB05 exact head', category: 'HUMANOID_JEDI', asset: '/_lab/kotor/characters/w238_0a2c/kotor1_n_jedicounm_pmhb05.glb' },
  { id: 'rodian', label: 'Rodian · native body', category: 'ALIEN_HUMANOID', asset: '/_lab/kotor/characters/w238_0a2c/kotor1_n_rodian_body.glb' },
  { id: 'duros', label: 'Duros · native body', category: 'ALIEN_HUMANOID', asset: '/_lab/kotor/characters/w238_0a2c/kotor1_n_duros_body.glb' },
  { id: 'drdprot', label: 'Protocol droid · rigid nodes', category: 'DROID', asset: '/_lab/kotor/characters/w238_0a2c/kotor1_c_drdprot_body.glb' },
  { id: 'khounda', label: 'Kath hound A · quadruped rig', category: 'CREATURE', asset: '/_lab/kotor/characters/w238_0a2c/kotor1_c_khounda_body.glb' },
];

const idleName = (groups: string[]) => groups.find((name) => /^(pause1|cpause1)$/i.test(name)) ?? groups[0] ?? null;

export async function startCharacterConversionGalleryLab(): Promise<void> {
  for (const id of ['hud', 'questHud', 'debugOverlay', 'loadingOverlay']) document.getElementById(id)?.classList.add('is-hidden');
  const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement | null;
  if (!canvas) throw new Error('W238_0A2C_GALLERY_CANVAS_MISSING');
  canvas.style.cssText = 'display:block;position:fixed;inset:0;width:100vw;height:100vh;touch-action:none';
  const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true, antialias: true });
  const scene = new Scene(engine); scene.clearColor = new Color4(.08, .09, .1, 1);
  const camera = new ArcRotateCamera('W238_0A2C_GalleryCamera', -Math.PI / 2, 1.18, 4.4, new Vector3(0, .9, 0), scene);
  camera.attachControl(canvas, true); camera.wheelPrecision = 55; camera.lowerRadiusLimit = .35; camera.upperRadiusLimit = 20; camera.panningSensibility = 0;
  const key = new HemisphericLight('W238_0A2C_GalleryKey', new Vector3(.1, 1, .1), scene); key.intensity = 1.05; key.groundColor = new Color3(.18, .19, .22);
  const fill = new HemisphericLight('W238_0A2C_GalleryFill', new Vector3(0, -.6, -1), scene); fill.intensity = .35;
  const ground = MeshBuilder.CreateGround('W238_0A2C_GalleryGround', { width: 16, height: 16 }, scene);
  const groundMat = new StandardMaterial('W238_0A2C_GalleryGroundMat', scene); groundMat.diffuseColor = new Color3(.19, .21, .23); groundMat.specularColor = new Color3(.08, .08, .08); ground.material = groundMat;

  document.getElementById('w238_0a2cGalleryPanel')?.remove();
  const panel = document.createElement('section'); panel.id = 'w238_0a2cGalleryPanel';
  panel.style.cssText = 'position:fixed;z-index:50;left:16px;top:16px;width:min(470px,calc(100vw - 32px));max-height:calc(100vh - 32px);overflow:auto;padding:14px;color:#eee8dc;background:#14191eef;border:1px solid #a07b48;border-radius:10px;font:12px/1.45 system-ui,sans-serif';
  panel.innerHTML = '<h2 style="margin:0 0 4px">W238.0A.2C · CHARACTER GALLERY</h2><div>Original KOTOR1 derived assets · Babylon loader smoke · DEV only</div><div id="w238_0a2cGalleryButtons" style="display:flex;flex-wrap:wrap;gap:5px;margin:8px 0"></div><div id="w238_0a2cGalleryStatus" style="margin:7px 0">Loading…</div><div id="w238_0a2cGalleryClips" style="display:flex;flex-wrap:wrap;gap:5px;margin:8px 0"></div><pre id="w238_0a2cGalleryMetrics" style="white-space:pre-wrap;max-height:34vh;overflow:auto"></pre>';
  document.body.appendChild(panel);
  const state: GalleryState = { loaded: false, selected: '', category: '', asset: '', meshes: 0, transformNodes: 0, skeletons: [], animationGroups: [], playingAnimation: null, runtimeStatus: 'LOADING' };
  window.__w238_0a2cGalleryState = state;
  const status = panel.querySelector('#w238_0a2cGalleryStatus') as HTMLDivElement;
  const metrics = panel.querySelector('#w238_0a2cGalleryMetrics') as HTMLPreElement;
  const clips = panel.querySelector('#w238_0a2cGalleryClips') as HTMLDivElement;
  const publish = () => { window.__w238_0a2cGalleryState = { ...state, skeletons: [...state.skeletons], animationGroups: [...state.animationGroups] }; metrics.textContent = JSON.stringify(window.__w238_0a2cGalleryState, null, 2); };
  let imported: Awaited<ReturnType<typeof SceneLoader.ImportMeshAsync>> | null = null;
  let active: import('@babylonjs/core').AnimationGroup | null = null;
  const play = (name: string) => { if (!imported) return; const group = imported.animationGroups.find((candidate) => candidate.name.toLowerCase() === name.toLowerCase()); if (!group) return; active?.stop(); active = group; group.start(true, 1); state.playingAnimation = group.name; status.textContent = `${state.selected} · ${state.category} · playing ${group.name}`; publish(); };
  const load = async (profile: GalleryProfile): Promise<GalleryState> => {
    active?.stop(); active = null; imported?.meshes.forEach((mesh) => mesh.dispose(false, true)); imported?.transformNodes.forEach((node) => { if (!node.isDisposed()) node.dispose(false, true); }); imported = null;
    state.loaded = false; state.selected = profile.id; state.category = profile.category; state.asset = profile.asset; state.appearanceRow = profile.appearanceRow; state.sourceCreatureInstanceIds = profile.sourceCreatureInstanceIds; state.animationGroups = []; state.playingAnimation = null; state.runtimeStatus = 'LOADING'; state.error = undefined; status.textContent = `Loading ${profile.label}…`; publish();
    try {
      imported = await SceneLoader.ImportMeshAsync('', '', profile.asset, scene);
      const renderables = imported.meshes.filter((mesh) => mesh.getTotalVertices() > 0);
      if (renderables.length) { const boxes = renderables.map((mesh) => { mesh.computeWorldMatrix(true); return mesh.getBoundingInfo().boundingBox; }); const minY = Math.min(...boxes.map((box) => box.minimumWorld.y)); const maxY = Math.max(...boxes.map((box) => box.maximumWorld.y)); camera.target.set(0, (minY + maxY) / 2, 0); camera.radius = Math.max(2.6, (maxY - minY) * 2.3); }
      state.loaded = true; state.runtimeStatus = 'READY'; state.meshes = renderables.length; state.transformNodes = imported.transformNodes.length; state.skeletons = imported.skeletons.map((skeleton) => ({ name: skeleton.name, joints: skeleton.bones.length })); state.animationGroups = imported.animationGroups.map((group) => group.name); status.textContent = `${profile.label} · ${profile.category} · READY`;
      clips.replaceChildren(); for (const name of state.animationGroups) { const button = document.createElement('button'); button.textContent = name; button.onclick = () => play(name); clips.append(button); }
      const idle = idleName(state.animationGroups); if (idle) play(idle); else publish();
    } catch (error) { state.runtimeStatus = 'ERROR'; state.error = error instanceof Error ? error.message : String(error); status.textContent = `${profile.label} · ERROR · ${state.error}`; publish(); }
    return { ...state, skeletons: [...state.skeletons], animationGroups: [...state.animationGroups] };
  };
  const buttons = panel.querySelector('#w238_0a2cGalleryButtons') as HTMLDivElement;
  for (const profile of PROFILES) { const button = document.createElement('button'); button.textContent = profile.label; button.onclick = () => void load(profile); buttons.append(button); }
  const allButton = document.createElement('button'); allButton.textContent = 'RUN 24 EXACT ROWS'; allButton.onclick = () => void runAllRows(); buttons.append(allButton);
  const waitFrame = () => new Promise<void>((resolve) => window.setTimeout(resolve, 90));
  const playAndVerify = async (name: string | null) => {
    if (!name) return false;
    play(name); await waitFrame();
    return Boolean(imported?.animationGroups.find((group) => group.name.toLowerCase() === name.toLowerCase())?.isPlaying);
  };
  const runAllRows = async () => {
    status.textContent = 'Loading exact appearance coverage…';
    const coverage = await fetch('/data/w238_0a2c_appearance_coverage.json', { cache: 'no-store' }).then((response) => response.json() as Promise<{ rows: CoverageRow[] }>);
    const rows = coverage.rows.filter((row) => row.validationStatus === 'PASS_STRUCTURAL' && row.derivedGLB);
    const results: GalleryRowResult[] = [];
    const blockers: Array<{ appearanceRow: number; reason: string }> = coverage.rows.filter((row) => row.validationStatus !== 'PASS_STRUCTURAL' || !row.derivedGLB).map((row) => ({ appearanceRow: row.appearanceRow, reason: row.blocker ?? 'NO_RUNTIME_ASSET' }));
    for (const row of rows) {
      const profile: GalleryProfile = { id: `appearance-${row.appearanceRow}`, label: `Appearance row ${row.appearanceRow}`, category: row.rigFamily, asset: `/${row.derivedGLB!.replace(/^\//, '')}`, appearanceRow: row.appearanceRow, sourceCreatureInstanceIds: row.sourceCreatureInstanceIds };
      const loaded = await load(profile);
      const idle = idleName(loaded.animationGroups);
      const walk = loaded.animationGroups.find((name) => /^(walk|cwalk|run|crun)$/i.test(name)) ?? null;
      const gesture = loaded.animationGroups.find((name) => /^(talk|tlknorm|listen|g2r1|fblock)$/i.test(name)) ?? null;
      const idlePlayback = loaded.runtimeStatus === 'READY' && Boolean(await playAndVerify(idle));
      const walkPlayback = walk ? await playAndVerify(walk) : null;
      const gesturePlayback = gesture ? await playAndVerify(gesture) : null;
      const returnedToIdle = idle ? await playAndVerify(idle) : false;
      results.push({ ...loaded, exactAppearance: loaded.runtimeStatus === 'READY' && loaded.meshes > 0, idlePlayback, walkPlayback, gesturePlayback, returnedToIdle });
    }
    const failed = results.filter((result) => !result.exactAppearance || !result.idlePlayback || result.walkPlayback === false || result.gesturePlayback === false || !result.returnedToIdle);
    window.__w238_0a2cGalleryValidation = { status: failed.length === 0 && blockers.length === 0 ? 'PASS_ALL_24_EXACT_ROWS' : 'PARTIAL', rows: results, blockers };
    // Source-model blockers are an inventory result, not a Babylon loader
    // failure. Keep the selected structurally ready row green when its own
    // runtime checks pass; the aggregate status remains PARTIAL while the
    // four unresolved source rows stay explicit.
    state.runtimeStatus = failed.length === 0 ? 'READY' : 'ERROR';
    status.textContent = `EXACT ROW VALIDATION · ${results.length}/${rows.length} assets loaded · ${failed.length} runtime failures · ${blockers.length} source/asset blockers`;
    publish();
  };
  await load(PROFILES[0]);
  if (new URLSearchParams(window.location.search).get('all') === '1') await runAllRows();
  engine.runRenderLoop(() => scene.render()); window.addEventListener('resize', () => engine.resize());
}
