import './style.css';
import {
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
  type AnimationGroup,
} from '@babylonjs/core';
import '@babylonjs/loaders/glTF';

// Reuse the ACTUAL Academy dialogue adapter from the development branch.
// Its AcademyNpcInstance dependency is type-only and is erased by Vite.
import { BelayaDialogueV1, BELAYA_SOURCE_NPC_ID } from '../src/dev/kotor/BelayaDialogueV1';

const canvas = document.querySelector<HTMLCanvasElement>('#renderCanvas');
const status = document.querySelector<HTMLDivElement>('#status');
const diagnostics = document.querySelector<HTMLPreElement>('#diagnostics');
const prompt = document.querySelector<HTMLParagraphElement>('#interactionPrompt');
const approach = document.querySelector<HTMLButtonElement>('#approach');
const idleButton = document.querySelector<HTMLButtonElement>('#idle');
const talkButton = document.querySelector<HTMLButtonElement>('#talk');
const resetButton = document.querySelector<HTMLButtonElement>('#reset');

if (!canvas || !status || !diagnostics || !prompt || !approach || !idleButton || !talkButton || !resetButton) {
  throw new Error('BELAYA_SANDBOX_DOM_INCOMPLETE');
}

const dom = { canvas, status, diagnostics, prompt, approach, idleButton, talkButton, resetButton };
const engine = new Engine(dom.canvas, true, { preserveDrawingBuffer: true, stencil: true, antialias: true });
const scene = new Scene(engine);
scene.clearColor = new Color4(0.035, 0.045, 0.06, 1);

const camera = new ArcRotateCamera('BelayaSandboxCamera', -Math.PI / 2, 1.15, 5, new Vector3(0, 1, 0), scene);
camera.attachControl(dom.canvas, true);
camera.lowerRadiusLimit = 1;
camera.upperRadiusLimit = 18;
camera.wheelPrecision = 40;

new HemisphericLight('BelayaSandboxHemi', new Vector3(0, 1, 0), scene).intensity = 1.1;
const sunlight = new DirectionalLight('BelayaSandboxSun', new Vector3(-0.4, -1, 0.2), scene);
sunlight.intensity = 0.65;

const ground = MeshBuilder.CreateGround('BelayaSandboxGround', { width: 14, height: 14 }, scene);
const groundMaterial = new StandardMaterial('BelayaSandboxGroundMaterial', scene);
groundMaterial.diffuseColor = new Color3(0.16, 0.21, 0.24);
groundMaterial.specularColor = Color3.Black();
ground.material = groundMaterial;
ground.isPickable = false;

const marker = MeshBuilder.CreateCylinder('TestPlayerMarker', { diameter: 0.28, height: 0.95 }, scene);
const markerMaterial = new StandardMaterial('TestPlayerMarkerMaterial', scene);
markerMaterial.diffuseColor = new Color3(0.1, 0.52, 0.9);
markerMaterial.emissiveColor = new Color3(0.05, 0.16, 0.27);
marker.material = markerMaterial;
marker.isPickable = false;

const belayaRoot = new TransformNode('BelayaSandboxInteractionAnchor', scene);
const dialogue = new BelayaDialogueV1();
const inputKeys = new Set<string>();
let groups: AnimationGroup[] = [];
let loaded = false;
let modelHeight = 0;
let skeletonCount = 0;
let currentClip = 'NONE';
let lastPublished = 0;

function play(name: string): boolean {
  const match = groups.find(group => group.name.trim().toLowerCase() === name.toLowerCase());
  if (!match) {
    dom.status.textContent = 'Falta el clip solicitado: ' + name;
    return false;
  }
  for (const group of groups) group.stop();
  match.start(true, 1);
  currentClip = match.name;
  return true;
}

function groundDistance(): number {
  const dx = marker.position.x - belayaRoot.position.x;
  const dz = marker.position.z - belayaRoot.position.z;
  return Math.hypot(dx, dz);
}

function speak(): void {
  if (!loaded || dialogue.isOpen || groundDistance() > 2.8) return;

  // Only these fields are accessed by BelayaDialogueV1. This standalone proxy
  // intentionally does not emulate the Academy navigation or party systems.
  const actor = {
    record: { stableNpcId: BELAYA_SOURCE_NPC_ID },
    root: belayaRoot,
    asset: { animationGroups: groups },
    activeAnimation: currentClip,
  } as unknown as Parameters<BelayaDialogueV1['open']>[0];

  if (dialogue.open(actor)) {
    inputKeys.clear();
    currentClip = actor.activeAnimation;
  }
}

function moveNear(): void {
  if (!loaded) return;
  marker.position.x = belayaRoot.position.x + 1.5;
  marker.position.z = belayaRoot.position.z + 0.5;
}

dom.approach.addEventListener('click', moveNear);
dom.idleButton.addEventListener('click', () => { if (!dialogue.isOpen) play('pause1'); });
dom.talkButton.addEventListener('click', () => { if (!dialogue.isOpen) play('talk'); });
dom.resetButton.addEventListener('click', () => {
  dialogue.close();
  inputKeys.clear();
  marker.position.x = belayaRoot.position.x + 4;
  marker.position.z = belayaRoot.position.z;
  play('pause1');
});

window.addEventListener('keydown', event => {
  if (dialogue.isOpen) return;
  const key = event.key.toLowerCase();
  if (['w', 'a', 's', 'd'].includes(key)) {
    event.preventDefault();
    inputKeys.add(key);
  }
  if (key === 'e' && !event.repeat) {
    event.preventDefault();
    speak();
  }
});
window.addEventListener('keyup', event => inputKeys.delete(event.key.toLowerCase()));
window.addEventListener('blur', () => inputKeys.clear());
window.addEventListener('resize', () => engine.resize());

engine.runRenderLoop(() => {
  const dt = Math.min(engine.getDeltaTime() / 1000, 0.05);
  if (loaded && !dialogue.isOpen) {
    const dx = Number(inputKeys.has('d')) - Number(inputKeys.has('a'));
    const dz = Number(inputKeys.has('s')) - Number(inputKeys.has('w'));
    if (dx !== 0 || dz !== 0) {
      const magnitude = Math.hypot(dx, dz);
      marker.position.x = Math.max(belayaRoot.position.x - 6, Math.min(belayaRoot.position.x + 6, marker.position.x + dx / magnitude * 2.2 * dt));
      marker.position.z = Math.max(belayaRoot.position.z - 6, Math.min(belayaRoot.position.z + 6, marker.position.z + dz / magnitude * 2.2 * dt));
    }
  }

  const distance = groundDistance();
  dom.prompt.style.display = loaded && !dialogue.isOpen && distance <= 2.8 ? 'block' : 'none';
  dom.prompt.textContent = '[E] HABLAR CON BELAYA · ' + distance.toFixed(2) + 'm';

  const now = performance.now();
  if (now - lastPublished > 250) {
    lastPublished = now;
    const playing = groups.filter(group => group.isPlaying).map(group => group.name);
    dom.diagnostics.textContent = JSON.stringify({
      loaded,
      modelHeightM: modelHeight,
      skeletons: skeletonCount,
      animationGroups: groups.length,
      pause1Available: groups.some(group => group.name.toLowerCase() === 'pause1'),
      talkAvailable: groups.some(group => group.name.toLowerCase() === 'talk'),
      activeGroups: playing,
      expectedClip: dialogue.isOpen ? 'talk' : currentClip,
      playerDistanceM: Number(distance.toFixed(2)),
      dialogue: dialogue.snapshot(),
    }, null, 2);
  }
  scene.render();
});

async function loadBelaya(): Promise<void> {
  try {
    dom.status.textContent = 'Cargando Belaya (GLB local ~30 MB)...';
    const imported = await SceneLoader.ImportMeshAsync('', '/_lab/kotor/characters/belaya/', 'belaya_kotor1_donor.glb', scene);
    groups = imported.animationGroups;
    skeletonCount = imported.skeletons.length;
    const meshes = imported.meshes.filter(mesh => mesh.getTotalVertices() > 0);
    if (!meshes.length) throw new Error('BELAYA_GLB_NO_RENDERABLE_MESHES');

    let min = new Vector3(Infinity, Infinity, Infinity);
    let max = new Vector3(-Infinity, -Infinity, -Infinity);
    for (const mesh of meshes) {
      mesh.computeWorldMatrix(true);
      const bounds = mesh.getBoundingInfo().boundingBox;
      min = Vector3.Minimize(min, bounds.minimumWorld);
      max = Vector3.Maximize(max, bounds.maximumWorld);
    }
    if (!Number.isFinite(min.y) || !Number.isFinite(max.y)) throw new Error('BELAYA_NONFINITE_WORLD_BOUNDS');
    modelHeight = max.y - min.y;
    if (modelHeight <= 0) throw new Error('BELAYA_ZERO_HEIGHT');
    const center = min.add(max).scale(0.5);

    belayaRoot.position.set(center.x, min.y + 0.45, center.z);
    ground.position.set(center.x, min.y - 0.03, center.z);
    marker.position.set(center.x + 4, min.y + 0.48, center.z);
    camera.target.copyFrom(center);
    camera.radius = Math.max(3.5, Math.min(9, modelHeight * 2.1));
    loaded = true;

    for (const button of [dom.approach, dom.idleButton, dom.talkButton, dom.resetButton]) button.disabled = false;
    const idleAvailable = play('pause1');
    const talkAvailable = groups.some(group => group.name.trim().toLowerCase() === 'talk');
    dom.status.textContent = 'GLB cargado · ' + groups.length + ' animaciones · IDLE ' +
      (idleAvailable ? 'OK' : 'FALTA') + ' · TALK ' + (talkAvailable ? 'OK' : 'FALTA');
  } catch (error) {
    loaded = false;
    dom.status.textContent = 'ERROR DE CARGA: ' + (error instanceof Error ? error.message : String(error)) +
      ' · Verificá que copiaste el GLB local a belaya-sandbox/public.';
  }
}

void loadBelaya();
