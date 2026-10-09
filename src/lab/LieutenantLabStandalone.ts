import {
  AbstractMesh,
  AnimationGroup,
  ArcRotateCamera,
  Color3,
  Color4,
  DirectionalLight,
  Engine,
  HemisphericLight,
  MeshBuilder,
  Scene,
  SceneLoader,
  StandardMaterial,
  TransformNode,
  Vector3,
} from '@babylonjs/core';
import '@babylonjs/loaders/glTF';

const ASSET_URL = '/assets/characters/lieutenant/lieutenant_blaster_v1.glb';

const CLIPS = [
  { label: 'Idle', name: 'idle_v2', loop: true, movingSpeed: 0 },
  { label: 'Walk', name: 'walk_forward_v2', loop: true, movingSpeed: 3.55 },
  { label: 'Run', name: 'run_forward_v2', loop: true, movingSpeed: 5.9 },
  { label: 'Low Ready', name: 'combat_ready', loop: true, movingSpeed: 0 },
  { label: 'Aim', name: 'aim_forward', loop: true, movingSpeed: 0 },
] as const;

type ClipName = (typeof CLIPS)[number]['name'];

interface ImportedLieutenant {
  root: TransformNode;
  animations: AnimationGroup[];
  dimensions: Vector3;
}

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Lieutenant Character Lab is missing #${id}.`);
  }
  return element as T;
}

const canvas = requireElement<HTMLCanvasElement>('lieutenantLabCanvas');
const stats = requireElement<HTMLDivElement>('lieutenantLabStats');
const errorPanel = requireElement<HTMLDivElement>('lieutenantLabError');
const animationButtons = requireElement<HTMLDivElement>('animationButtons');
const pauseButton = requireElement<HTMLButtonElement>('pauseAnimation');
const resetAnimationButton = requireElement<HTMLButtonElement>('resetAnimation');
const movingMode = requireElement<HTMLInputElement>('movingMode');
const speedSlider = requireElement<HTMLInputElement>('animationSpeed');
const speedValue = requireElement<HTMLSpanElement>('animationSpeedValue');
const rotateLeftButton = requireElement<HTMLButtonElement>('rotateModelLeft');
const rotateRightButton = requireElement<HTMLButtonElement>('rotateModelRight');
const resetModelButton = requireElement<HTMLButtonElement>('resetModel');

const engine = new Engine(canvas, true, {
  preserveDrawingBuffer: true,
  stencil: true,
});

const scene = new Scene(engine);
scene.clearColor = new Color4(0.018, 0.026, 0.034, 1);
scene.fogMode = Scene.FOGMODE_NONE;

const camera = new ArcRotateCamera(
  'LieutenantLabCamera',
  -Math.PI / 2,
  1.28,
  4.4,
  new Vector3(0, 0.9, 0),
  scene,
);
camera.lowerRadiusLimit = 2.0;
camera.upperRadiusLimit = 9.0;
camera.lowerBetaLimit = 0.35;
camera.upperBetaLimit = Math.PI - 0.35;
camera.wheelPrecision = 42;
camera.panningSensibility = 0;
camera.attachControl(canvas, true);

const ambient = new HemisphericLight('LieutenantLabAmbient', new Vector3(0, 1, 0), scene);
ambient.intensity = 0.88;
ambient.diffuse = new Color3(0.62, 0.72, 0.82);
ambient.groundColor = new Color3(0.055, 0.065, 0.075);

const key = new DirectionalLight('LieutenantLabKey', new Vector3(-0.55, -1, 0.40), scene);
key.intensity = 1.35;
key.diffuse = new Color3(0.92, 0.96, 1.0);

const rim = new DirectionalLight('LieutenantLabRim', new Vector3(0.60, -0.45, -0.75), scene);
rim.intensity = 0.62;
rim.diffuse = new Color3(0.32, 0.58, 0.72);

const ground = MeshBuilder.CreateGround('LieutenantLabGround', {
  width: 24,
  height: 24,
  subdivisions: 1,
}, scene);
const groundMaterial = new StandardMaterial('LieutenantLabGroundMaterial', scene);
groundMaterial.diffuseColor = new Color3(0.065, 0.080, 0.090);
groundMaterial.specularColor = new Color3(0.10, 0.13, 0.14);
ground.material = groundMaterial;
ground.isPickable = false;

const gridMaterial = new StandardMaterial('LieutenantLabGridMaterial', scene);
gridMaterial.diffuseColor = Color3.Black();
gridMaterial.emissiveColor = new Color3(0.035, 0.12, 0.15);
gridMaterial.disableLighting = true;

for (let i = -6; i <= 6; i += 1) {
  const lineX = MeshBuilder.CreateBox(`LieutenantGridX_${i}`, {
    width: 0.012,
    height: 0.004,
    depth: 20,
  }, scene);
  lineX.position.set(i, 0.004, 0);
  lineX.material = gridMaterial;
  lineX.isPickable = false;

  const lineZ = MeshBuilder.CreateBox(`LieutenantGridZ_${i}`, {
    width: 20,
    height: 0.004,
    depth: 0.012,
  }, scene);
  lineZ.position.set(0, 0.004, i);
  lineZ.material = gridMaterial;
  lineZ.isPickable = false;
}

const centerLineMaterial = new StandardMaterial('LieutenantLabCenterLineMaterial', scene);
centerLineMaterial.diffuseColor = Color3.Black();
centerLineMaterial.emissiveColor = new Color3(0.58, 0.24, 0.08);
centerLineMaterial.disableLighting = true;

const centerLine = MeshBuilder.CreateBox('LieutenantLabCenterLine', {
  width: 0.025,
  height: 0.006,
  depth: 20,
}, scene);
centerLine.position.y = 0.006;
centerLine.material = centerLineMaterial;
centerLine.isPickable = false;

let lieutenant: ImportedLieutenant | null = null;
let selectedClip: ClipName = 'idle_v2';
let activeGroup: AnimationGroup | null = null;
let playbackSpeed = 1;
let paused = false;
let currentYaw = 0;
let routeDistance = 0;
let lastStatsUpdate = 0;

function splitUrl(url: string): { rootUrl: string; fileName: string } {
  const slash = url.lastIndexOf('/');
  return {
    rootUrl: slash >= 0 ? url.slice(0, slash + 1) : '/',
    fileName: slash >= 0 ? url.slice(slash + 1) : url,
  };
}

function animationByName(name: string): AnimationGroup | null {
  if (!lieutenant) return null;
  const lower = name.toLowerCase();

  return lieutenant.animations.find((group) => group.name.toLowerCase() === lower)
    ?? lieutenant.animations.find((group) => group.name.toLowerCase().includes(lower))
    ?? null;
}

function stopAllAnimations(): void {
  lieutenant?.animations.forEach((group) => {
    group.stop();
    group.reset();
  });
  activeGroup = null;
}

function setActiveButton(): void {
  animationButtons.querySelectorAll<HTMLButtonElement>('button[data-clip]').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.clip === selectedClip);
  });
}

function playClip(name: ClipName, restart = true): void {
  if (!lieutenant) return;

  selectedClip = name;
  const definition = CLIPS.find((clip) => clip.name === name);
  const group = animationByName(name);

  stopAllAnimations();
  setActiveButton();

  if (!definition || !group) {
    updateStats(true);
    return;
  }

  if (restart) group.reset();
  group.start(definition.loop, playbackSpeed, group.from, group.to, false);
  activeGroup = group;
  paused = false;
  pauseButton.textContent = 'Pause';
  updateStats(true);
}

function togglePause(): void {
  if (!activeGroup) return;
  paused = !paused;

  if (paused) {
    activeGroup.pause();
    pauseButton.textContent = 'Resume';
  } else {
    activeGroup.play(activeGroup.loopAnimation);
    activeGroup.speedRatio = playbackSpeed;
    pauseButton.textContent = 'Pause';
  }
}

function resetCharacter(): void {
  if (!lieutenant) return;
  lieutenant.root.position.set(0, lieutenant.root.position.y, 0);
  lieutenant.root.rotationQuaternion = null;
  lieutenant.root.rotation.set(0, 0, 0);
  currentYaw = 0;
  routeDistance = 0;
  playClip(selectedClip, true);
  frameCamera();
}

function setCameraPreset(preset: string): void {
  const alphaByPreset: Record<string, number> = {
    front: -Math.PI / 2,
    left: Math.PI,
    back: Math.PI / 2,
    right: 0,
  };
  camera.alpha = alphaByPreset[preset] ?? -Math.PI / 2;
  camera.beta = 1.28;
  frameCamera();
}

function frameCamera(): void {
  if (!lieutenant) return;
  const target = lieutenant.root.position.add(new Vector3(0, Math.max(0.75, lieutenant.dimensions.y * 0.50), 0));
  camera.setTarget(target);
  camera.radius = Math.max(3.0, lieutenant.dimensions.y * 2.55);
}

function measureAndCenter(root: TransformNode): Vector3 {
  root.computeWorldMatrix(true);

  const renderMeshes = scene.meshes.filter((mesh: AbstractMesh) => {
    if (mesh === ground || mesh.name.startsWith('LieutenantGrid') || mesh === centerLine) return false;
    let node = mesh.parent;
    while (node) {
      if (node === root) return true;
      node = node.parent;
    }
    return false;
  });

  let min = new Vector3(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
  let max = new Vector3(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY);

  renderMeshes.forEach((mesh: AbstractMesh) => {
    mesh.computeWorldMatrix(true);
    const bounds = mesh.getBoundingInfo().boundingBox;
    min = Vector3.Minimize(min, bounds.minimumWorld);
    max = Vector3.Maximize(max, bounds.maximumWorld);
  });

  if (!Number.isFinite(min.x) || !Number.isFinite(max.x)) {
    return new Vector3(1, 1.72, 0.5);
  }

  const center = min.add(max).scale(0.5);
  root.position.x -= center.x;
  root.position.z -= center.z;
  root.position.y -= min.y;
  root.computeWorldMatrix(true);

  return max.subtract(min);
}

async function loadLieutenant(): Promise<ImportedLieutenant> {
  const { rootUrl, fileName } = splitUrl(ASSET_URL);
  const result = await SceneLoader.ImportMeshAsync(null, rootUrl, fileName, scene);

  const root = new TransformNode('LieutenantLabAssetRoot', scene);
  const allNodes = [...result.transformNodes, ...result.meshes];
  const allNodeSet = new Set<import('@babylonjs/core').Node>(allNodes);
  const topLevel = allNodes.filter((node) => !node.parent || !allNodeSet.has(node.parent));
  topLevel.forEach((node) => {
    node.parent = root;
  });

  const dimensions = measureAndCenter(root);

  result.meshes.forEach((mesh: AbstractMesh) => {
    mesh.isPickable = false;
  });

  return {
    root,
    animations: result.animationGroups,
    dimensions,
  };
}

function buildAnimationButtons(): void {
  animationButtons.innerHTML = '';

  CLIPS.forEach((clip, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.clip = clip.name;
    button.textContent = `${index + 1} ${clip.label}`;
    button.addEventListener('click', () => playClip(clip.name));
    animationButtons.appendChild(button);
  });
}

function updateStats(force = false): void {
  const now = performance.now();
  if (!force && now - lastStatsUpdate < 120) return;
  lastStatsUpdate = now;

  if (!lieutenant) {
    stats.textContent = 'Loading lieutenant asset…';
    return;
  }

  const definition = CLIPS.find((clip) => clip.name === selectedClip);
  const selectedGroup = animationByName(selectedClip);
  const animationNames = lieutenant.animations.map((group) => group.name);
  const missing = CLIPS.filter((clip) => !animationByName(clip.name)).map((clip) => clip.name);
  const position = lieutenant.root.position;

  stats.textContent = [
    'W206 — LIEUTENANT CHARACTER LAB',
    '',
    `ASSET        ${ASSET_URL}`,
    `DIMENSIONS   ${lieutenant.dimensions.x.toFixed(3)} × ${lieutenant.dimensions.y.toFixed(3)} × ${lieutenant.dimensions.z.toFixed(3)} m`,
    `POSITION     ${position.x.toFixed(2)}, ${position.y.toFixed(2)}, ${position.z.toFixed(2)}`,
    `MODEL YAW    ${(currentYaw * 180 / Math.PI).toFixed(0)}°`,
    '',
    `CLIP         ${selectedClip}`,
    `FOUND        ${selectedGroup ? 'YES' : 'NO'}`,
    `PLAYING      ${activeGroup?.isPlaying ? 'YES' : 'NO'}`,
    `PAUSED       ${paused ? 'YES' : 'NO'}`,
    `SPEED        ${playbackSpeed.toFixed(2)}×`,
    `MOVING       ${movingMode.checked ? 'YES' : 'NO'}`,
    `MOVE SPEED   ${(definition?.movingSpeed ?? 0).toFixed(2)} m/s`,
    `ROUTE        ${routeDistance.toFixed(2)} m`,
    '',
    'ANIMATION GROUPS',
    ...animationNames.map((name) => `  ${name}`),
    '',
    missing.length > 0 ? `MISSING: ${missing.join(', ')}` : 'EXPECTED CLIPS: ALL FOUND',
    '',
    'VISUAL CHECK',
    '  right hand on E-11 grip',
    '  left hand on foregrip',
    '  barrel orientation',
    '  shoulders / elbows',
    '  knees / foot sliding',
    '  low-ready vs aim silhouette',
  ].join('\n');
}

function showError(error: unknown): void {
  const message = error instanceof Error ? `${error.name}: ${error.message}\n\n${error.stack ?? ''}` : String(error);
  errorPanel.style.display = 'block';
  errorPanel.textContent = [
    'LIEUTENANT LAB FAILED TO LOAD',
    '',
    message,
    '',
    `Expected asset: ${ASSET_URL}`,
    '',
    'Confirm that W205.3 generated lieutenant_blaster_v1.glb and that Vite is running from the project workspace root.',
  ].join('\n');
}

buildAnimationButtons();

pauseButton.addEventListener('click', togglePause);
resetAnimationButton.addEventListener('click', () => playClip(selectedClip, true));

speedSlider.addEventListener('input', () => {
  playbackSpeed = Number.parseFloat(speedSlider.value);
  speedValue.textContent = `${playbackSpeed.toFixed(2)}×`;
  if (activeGroup) activeGroup.speedRatio = playbackSpeed;
  updateStats(true);
});

rotateLeftButton.addEventListener('click', () => {
  if (!lieutenant) return;
  currentYaw -= Math.PI / 2;
  lieutenant.root.rotation.y = currentYaw;
  updateStats(true);
});

rotateRightButton.addEventListener('click', () => {
  if (!lieutenant) return;
  currentYaw += Math.PI / 2;
  lieutenant.root.rotation.y = currentYaw;
  updateStats(true);
});

resetModelButton.addEventListener('click', resetCharacter);

document.querySelectorAll<HTMLButtonElement>('button[data-camera]').forEach((button) => {
  button.addEventListener('click', () => setCameraPreset(button.dataset.camera ?? 'front'));
});

window.addEventListener('keydown', (event) => {
  if (event.repeat) return;

  if (event.code === 'Space') {
    event.preventDefault();
    togglePause();
    return;
  }

  if (event.key.toLowerCase() === 'r') {
    resetCharacter();
    return;
  }

  const digit = Number.parseInt(event.key, 10);
  const clip = CLIPS[digit - 1];
  if (clip) playClip(clip.name);
});

window.addEventListener('resize', () => engine.resize());

scene.onBeforeRenderObservable.add(() => {
  if (!lieutenant || !movingMode.checked || paused) {
    updateStats();
    return;
  }

  const definition = CLIPS.find((clip) => clip.name === selectedClip);
  const moveSpeed = definition?.movingSpeed ?? 0;

  if (moveSpeed > 0 && activeGroup?.isPlaying) {
    const dt = Math.min(0.05, engine.getDeltaTime() / 1000);
    const distance = moveSpeed * playbackSpeed * dt;

    // The animation itself is in-place. Runtime owns translation.
    lieutenant.root.position.z -= distance;
    routeDistance += distance;

    // Loop the demo lane so the actor remains visible.
    if (lieutenant.root.position.z < -5.5) {
      lieutenant.root.position.z = 4.5;
    }

    camera.setTarget(lieutenant.root.position.add(new Vector3(0, Math.max(0.75, lieutenant.dimensions.y * 0.50), 0)));
  }

  updateStats();
});

async function start(): Promise<void> {
  try {
    lieutenant = await loadLieutenant();
    frameCamera();
    setActiveButton();
    playClip('idle_v2');
    updateStats(true);
  } catch (error) {
    console.error('[W206 Lieutenant Lab]', error);
    showError(error);
  }
}

void start();
engine.runRenderLoop(() => scene.render());
