import {
  ArcRotateCamera,
  Color3,
  Color4,
  DirectionalLight,
  Engine,
  HemisphericLight,
  LinesMesh,
  Mesh,
  MeshBuilder,
  Quaternion,
  Scene,
  Skeleton,
  StandardMaterial,
  TransformNode,
  Vector3,
} from '@babylonjs/core';
import { AssetLoader, ImportedAsset } from '../../assets/AssetLoader';
import { PLAYER_CHARACTERS } from '../../player/PlayerCharacterConfig';
import { NativeJkaWeaponDefinition, WeaponAttachment } from '../../player/WeaponAttachment';
import { alignVisualFeetToGround, measureVisualBounds } from '../../world/CharacterGrounding';

const ROSH_COMBO_URL = '/_lab/jka/characters/aren/aren_native_jka_v1_combo_v3.glb';
const ROSH_COMBO_SHA256 = '6e921a5e8fd0c20a0e18009f712468bf1b5925adfacd7b366882297af8545cdc';
const NATIVE_SABER_URL = '/_lab/jka/weapons/saber/jka_native_single_saber_v1.glb';
const NATIVE_SABER_SHA256 = 'b6dd4dea8d3e054f6932efa066c1840e45f10aafde04da0d860a3ba92357b677';
const BLADE_LENGTH_M = 0.98;

type GripPoseId = 'rest' | 'ready' | 'attack1_start' | 'attack1' | 'combo_transition' | 'attack2' | 'attack2_return' | 'final_ready';
type CameraPresetId = 'full_body' | 'hand_closeup' | 'hand_side' | 'hand_front' | 'hand_3_4';
type Vec3Tuple = [number, number, number];
type GripTransform = { translation: Vec3Tuple; rotation: Vec3Tuple };
type GripSlot = 'A' | 'B' | 'C';

const POSES: Array<{ id: GripPoseId; label: string; group?: string; progress?: number }> = [
  { id: 'rest', label: 'REST' },
  { id: 'ready', label: 'READY', group: 'JKA_SABER_READY', progress: 0.5 },
  { id: 'attack1_start', label: 'ATTACK 1 START', group: 'JKA_ATTACK_START', progress: 0.5 },
  { id: 'attack1', label: 'ATTACK 1', group: 'JKA_ATTACK', progress: 0.5 },
  { id: 'combo_transition', label: 'COMBO TRANSITION', group: 'JKA_COMBO_TRANSITION_B_TO_TL', progress: 0.5 },
  { id: 'attack2', label: 'ATTACK 2', group: 'JKA_COMBO_ATTACK_TL_TO_BR', progress: 0.5 },
  { id: 'attack2_return', label: 'ATTACK 2 RETURN', group: 'JKA_COMBO_RETURN_BR_TO_READY', progress: 0.5 },
  { id: 'final_ready', label: 'FINAL READY', group: 'JKA_SABER_READY', progress: 0.5 },
];

const CAMERAS: Array<{ id: CameraPresetId; label: string }> = [
  { id: 'full_body', label: 'FULL BODY' },
  { id: 'hand_closeup', label: 'RIGHT HAND CLOSEUP' },
  { id: 'hand_side', label: 'RIGHT HAND SIDE' },
  { id: 'hand_front', label: 'RIGHT HAND FRONT' },
  { id: 'hand_3_4', label: 'RIGHT HAND 3/4' },
];

function addStyle() {
  const style = document.createElement('style');
  style.id = 'rosh-grip-lab-style';
  style.textContent = `
    .rosh-grip-lab { position:fixed; inset:0; z-index:30; color:#e8f4fb; font:12px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace; pointer-events:none; }
    .rosh-grip-lab * { box-sizing:border-box; }
    .rosh-grip-panel { position:absolute; left:16px; bottom:16px; top:auto; width:min(330px,calc(100vw - 32px)); max-height:78vh; overflow:auto; padding:14px; border:1px solid #6ad8e766; border-radius:10px; background:#07131fee; box-shadow:0 16px 42px #0009; backdrop-filter:blur(8px); pointer-events:auto; }
    .rosh-grip-title { display:flex; justify-content:space-between; align-items:center; color:#95efff; font:700 13px/1.3 system-ui,sans-serif; letter-spacing:.11em; margin-bottom:5px; }
    .rosh-grip-subtitle { color:#93aab7; margin-bottom:12px; }
    .rosh-grip-section { border-top:1px solid #9cd8e51f; padding-top:9px; margin-top:9px; }
    .rosh-grip-heading { color:#ffd591; font-size:10px; font-weight:700; letter-spacing:.1em; margin-bottom:6px; }
    .rosh-grip-buttons { display:flex; flex-wrap:wrap; gap:5px; }
    .rosh-grip-lab button { border:1px solid #9ac2d13b; border-radius:5px; background:#102536; color:#e2f3fb; padding:6px 8px; font:600 10px/1.2 system-ui,sans-serif; cursor:pointer; }
    .rosh-grip-lab button:hover,.rosh-grip-lab button.active { border-color:#87edff; background:#17445a; color:white; }
    .rosh-grip-adjust { display:grid; grid-template-columns:32px minmax(70px,1fr) repeat(4,32px); align-items:center; gap:4px; margin:5px 0; }
    .rosh-grip-adjust span { color:#bdced7; }
    .rosh-grip-adjust output { text-align:right; color:#9becff; font-variant-numeric:tabular-nums; }
    .rosh-grip-step { padding:5px 3px!important; }
    .rosh-grip-warn { min-height:16px; color:#ffd591; }
    .rosh-grip-warn.over { color:#ff9292; font-weight:700; }
    .rosh-grip-workflow { color:#aebfc9; font:10px/1.45 system-ui,sans-serif; }
    .rosh-grip-slot-row { display:grid; grid-template-columns:30px 1fr 1fr; gap:5px; align-items:center; margin:4px 0; }
    .rosh-grip-slot-row span { color:#bdd0d9; }
    .rosh-grip-ab { display:grid; grid-template-columns:1fr 1fr; gap:5px; }
    .rosh-grip-small { color:#95aebb; font-size:9px; }
    .rosh-grip-data { white-space:pre-wrap; overflow-wrap:anywhere; color:#c6d5de; font-size:10px; line-height:1.45; margin:0; }
    .rosh-grip-status { color:#a7edbd; min-height:16px; }
    .rosh-grip-markers { display:flex; flex-wrap:wrap; gap:9px; color:#c5d6df; }
    .rosh-grip-markers label { display:flex; align-items:center; gap:4px; cursor:pointer; }
    .rosh-grip-lab input { accent-color:#7fe6fb; }
    @media(max-width:760px){ .rosh-grip-panel{left:8px;bottom:8px;top:auto;width:min(280px,calc(100vw - 16px));max-height:72vh;padding:10px}.rosh-grip-data{font-size:9px}.rosh-grip-adjust{grid-template-columns:28px minmax(58px,1fr) repeat(4,29px);gap:3px}.rosh-grip-step{padding:5px 2px!important} }
  `;
  document.head.append(style);
}

function hashHex(bytes: ArrayBuffer) {
  return crypto.subtle.digest('SHA-256', bytes).then(hash =>
    [...new Uint8Array(hash)].map(value => value.toString(16).padStart(2, '0')).join(''),
  );
}

async function verifyHash(path: string, expected: string) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`GRIP_LAB_ASSET_HTTP_${response.status}:${path}`);
  return { actual: await hashHex(await response.arrayBuffer()), expected };
}

function quaternionTelemetry(node: TransformNode | Mesh | null | undefined) {
  if (!node) return null;
  node.computeWorldMatrix(true);
  const scale = Vector3.One(), rotation = Quaternion.Identity(), position = Vector3.Zero();
  node.getWorldMatrix().decompose(scale, rotation, position);
  return {
    position: position.asArray().map(n => Number(n.toFixed(5))),
    quaternion: rotation.asArray().map(n => Number(n.toFixed(5))),
    eulerDeg: rotation.toEulerAngles().asArray().map(n => Number((n * 180 / Math.PI).toFixed(2))),
  };
}

function findRightHand(asset: ImportedAsset) {
  const skeletons = [...new Set(asset.meshes.map(mesh => mesh.skeleton).filter((skeleton): skeleton is Skeleton => Boolean(skeleton)))];
  for (const skeleton of skeletons) {
    const bone = skeleton.bones.find(candidate => candidate.name.toLowerCase() === 'rhand')
      ?? skeleton.bones.find(candidate => /right.?hand|r[_:]?hand/i.test(candidate.name));
    const transform = bone?.getTransformNode?.();
    if (transform) return { skeleton, bone, transform };
  }
  return null;
}

function createLine(scene: Scene, name: string, color: Color3): LinesMesh {
  const line = MeshBuilder.CreateLines(name, { points: [Vector3.Zero(), Vector3.Up()] }, scene);
  line.color = color;
  line.isPickable = false;
  line.setEnabled(false);
  return line;
}

function updateLine(scene: Scene, line: LinesMesh, start: Vector3, end: Vector3) {
  MeshBuilder.CreateLines(line.name, { points: [start, end], instance: line }, scene);
}

export async function startRoshNativeGripLab(canvas = document.getElementById('renderCanvas') as HTMLCanvasElement) {
  document.querySelectorAll('#hud,#questHud,#interactionPrompt,#dialogueOverlay,#fadeOverlay,#debugOverlay,#loadingOverlay,#errorOverlay')
    .forEach(node => node.classList.add('is-hidden'));
  if (!canvas) throw new Error('ROSH_GRIP_LAB_CANVAS_MISSING');
  document.getElementById('renderCanvas')?.setAttribute('style', 'position:fixed;inset:0;width:100vw;height:100vh;z-index:1;touch-action:none');
  addStyle();

  const lab = document.createElement('section');
  lab.className = 'rosh-grip-lab';
  lab.innerHTML = `
    <div class="rosh-grip-panel">
      <div class="rosh-grip-title"><span>ROSH · NATIVE SABER GRIP LAB</span><span>W237.2E.A3B</span></div>
      <div class="rosh-grip-subtitle">Isolated pose inspection · drag to orbit · wheel to zoom</div>
      <div class="rosh-grip-workflow">1 READY + CLOSEUP · 2 translate first, then rotate · 3 compare the same candidate across READY / ATTACK 1 / ATTACK 2 / FINAL READY · 4 use ZERO/CANDIDATE A/B · 5 copy values for review.</div>
      <div class="rosh-grip-section"><div class="rosh-grip-heading">POSE · ONE FROZEN GROUP</div><div id="roshGripPoses" class="rosh-grip-buttons"></div></div>
      <div class="rosh-grip-section"><div class="rosh-grip-heading">CAMERA PRESETS</div><div id="roshGripCameras" class="rosh-grip-buttons"></div></div>
      <div class="rosh-grip-section"><div class="rosh-grip-heading">OPTIONAL DEBUG MARKERS</div><div class="rosh-grip-markers">
        <label><input type="checkbox" data-marker="socketAxes">SOCKET AXES</label>
        <label><input type="checkbox" data-marker="handOrigin">RHAND ORIGIN</label>
        <label><input type="checkbox" data-marker="hiltOrigin">HILT ORIGIN</label>
        <label><input type="checkbox" data-marker="bladeTag">BLADE TAG</label>
        <label><input type="checkbox" data-marker="bladeAxis">BLADE AXIS</label>
      </div></div>
      <div class="rosh-grip-section"><div class="rosh-grip-heading">ZERO / CANDIDATE A/B</div>
        <div class="rosh-grip-ab"><button data-action="show-zero">SHOW ZERO</button><button data-action="show-candidate" class="active">SHOW CANDIDATE</button></div>
        <div id="roshGripCandidate" class="rosh-grip-small"></div>
      </div>
      <div class="rosh-grip-section"><div class="rosh-grip-heading">TEMPORARY TRANSLATION · LOCAL METERS</div>
        <div class="rosh-grip-small">COARSE ±0.0100 m · FINE ±0.0025 m</div><div id="roshGripTranslation"></div>
      </div>
      <div class="rosh-grip-section"><div class="rosh-grip-heading">TEMPORARY ROTATION · LOCAL DEGREES</div>
        <div class="rosh-grip-small">COARSE ±5.0° · FINE ±1.0°</div><div id="roshGripRotation"></div>
        <div id="roshGripWarnings" class="rosh-grip-warn"></div>
        <div class="rosh-grip-buttons"><button data-action="reset">RESET CANDIDATE TO ZERO</button><button data-action="undo">UNDO LAST CHANGE</button><button data-action="copy">COPY CURRENT VALUES</button></div>
        <div id="roshGripCopyStatus" class="rosh-grip-status"></div>
      </div>
      <div class="rosh-grip-section"><div class="rosh-grip-heading">IN-MEMORY CANDIDATE SLOTS</div>
        <div id="roshGripSlots"></div><div class="rosh-grip-small">Slots live only until this page is reloaded · candidate edits do not modify the saved profile</div>
      </div>
      <div class="rosh-grip-section"><div class="rosh-grip-heading">TELEMETRY</div><pre id="roshGripTelemetry" class="rosh-grip-data">Loading Rosh and native saber…</pre></div>
      <div id="roshGripStatus" class="rosh-grip-status">Loading isolated DEV scene…</div>
    </div>`;
  document.body.append(lab);

  const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true, antialias: true, adaptToDeviceRatio: true });
  const scene = new Scene(engine);
  scene.useRightHandedSystem = true;
  scene.clearColor = new Color4(0.045, 0.055, 0.068, 1);

  const camera = new ArcRotateCamera('RoshGripOrbitCamera', -Math.PI * 0.72, 1.15, 3.2, new Vector3(0, 1, 0), scene);
  camera.lowerRadiusLimit = 0.35;
  camera.upperRadiusLimit = 10;
  camera.wheelPrecision = 35;
  camera.panningSensibility = 0;
  camera.attachControl(canvas, true);
  camera.fov = 0.52;
  scene.activeCamera = camera;

  const hemi = new HemisphericLight('GripLabSkyLight', new Vector3(0.2, 1, -0.25), scene);
  hemi.intensity = 1.05;
  hemi.diffuse = new Color3(0.78, 0.86, 0.95);
  hemi.groundColor = new Color3(0.25, 0.28, 0.33);
  const key = new DirectionalLight('GripLabKeyLight', new Vector3(-0.6, -1, 0.45), scene);
  key.position.set(2.2, 4, -2.5);
  key.intensity = 1.15;

  const floor = MeshBuilder.CreateGround('GripLabNeutralFloor', { width: 8, height: 8 }, scene);
  floor.position.y = 0;
  const floorMaterial = new StandardMaterial('GripLabFloorMaterial', scene);
  floorMaterial.diffuseColor = new Color3(0.16, 0.19, 0.22);
  floorMaterial.specularColor = new Color3(0.08, 0.08, 0.08);
  floor.material = floorMaterial;
  floor.isPickable = false;
  const gridMaterial = new StandardMaterial('GripLabGridMaterial', scene);
  gridMaterial.emissiveColor = new Color3(0.085, 0.12, 0.14);
  gridMaterial.disableLighting = true;
  for (let p = -4; p <= 4; p += 0.5) {
    const major = Math.abs(p % 1) < 0.001;
    const pointsX = [new Vector3(p, 0.003, -4), new Vector3(p, 0.003, 4)];
    const pointsZ = [new Vector3(-4, 0.003, p), new Vector3(4, 0.003, p)];
    for (const [suffix, points] of [['x', pointsX], ['z', pointsZ]] as const) {
      const line = MeshBuilder.CreateLines(`GripLabGrid_${suffix}_${p}`, { points }, scene);
      line.color = major ? new Color3(0.16, 0.23, 0.26) : new Color3(0.075, 0.105, 0.12);
      line.isPickable = false;
    }
  }

  const profile = PLAYER_CHARACTERS['aren-native-jka-v1'];
  const actorProfile = { ...profile, assetPath: ROSH_COMBO_URL, expectedAssetSha256: ROSH_COMBO_SHA256 };
  const expectedModelHash = actorProfile.expectedAssetSha256!;
  const [modelHash, saberHash] = await Promise.all([
    verifyHash(actorProfile.assetPath, expectedModelHash),
    verifyHash(NATIVE_SABER_URL, NATIVE_SABER_SHA256),
  ]);
  if (modelHash.actual !== modelHash.expected) throw new Error(`ROSH_ASSET_HASH_MISMATCH:${modelHash.actual}`);
  if (saberHash.actual !== saberHash.expected) throw new Error(`NATIVE_SABER_HASH_MISMATCH:${saberHash.actual}`);

  const root = new TransformNode('RoshGripLabActorRoot', scene);
  const visualRoot = new TransformNode('RoshGripLabVisualRoot', scene);
  visualRoot.parent = root;
  const loader = new AssetLoader();
  const asset = await loader.load(actorProfile.assetPath, scene);
  asset.root.parent = visualRoot;
  asset.root.position.set(0, 0, 0);
  const initialBounds = measureVisualBounds(asset.meshes);
  if (initialBounds.height > 0) visualRoot.scaling.setAll(actorProfile.targetHeightM / initialBounds.height);
  alignVisualFeetToGround(visualRoot, asset.meshes, 0.02);
  visualRoot.position.y += actorProfile.runtimeVisualGroundOffsetM ?? 0;
  const skeletons = [...new Set(asset.meshes.map(mesh => mesh.skeleton).filter((skeleton): skeleton is Skeleton => Boolean(skeleton)))];
  const jointCount = skeletons[0]?.bones.length ?? 0;
  if (skeletons.length !== 1 || jointCount !== 53) throw new Error(`ROSH_NATIVE_RIG_GATE_FAIL:${JSON.stringify({ skeletons: skeletons.length, jointCount })}`);
  const requiredGroups = [...new Set(POSES.flatMap(pose => pose.group ? [pose.group] : []))];
  const missingGroups = requiredGroups.filter(name => !asset.animationGroups.some(group => group.name === name));
  if (asset.animationGroups.length !== 13 || missingGroups.length) {
    throw new Error(`ROSH_COMBO_CLIP_GATE_FAIL:${JSON.stringify({ groups: asset.animationGroups.length, missingGroups })}`);
  }

  const hand = findRightHand(asset);
  if (!hand || hand.bone?.name.toLowerCase() !== 'rhand') throw new Error(`ROSH_RIGHT_HAND_GATE_FAIL:${hand?.bone?.name ?? 'missing'}`);
  const baseProfileTranslation = [...(actorProfile.nativeJkaWeaponPresentation?.translationM ?? [0, 0, 0])] as Vec3Tuple;
  const baseProfileRotation = [...(actorProfile.nativeJkaWeaponPresentation?.rotationEulerDeg ?? [0, 0, 0])] as Vec3Tuple;
  const zeroPresentation: GripTransform = { translation: [0, 0, 0], rotation: [0, 0, 0] };
  const weaponDefinition: NativeJkaWeaponDefinition = {
    assetPath: NATIVE_SABER_URL,
    handSocket: 'rhang_tag_bone',
    bladeOriginNode: 'JKA_BLADE_SOCKET',
    bladeAxisNode: 'JKA_BLADE_AXIS_NEGATIVE_X',
    bladeTagSurface: '*blade1',
    bladeLengthM: BLADE_LENGTH_M,
    sourceForwardConvention: 'NEGATIVE_X',
  };
  const weapon = new WeaponAttachment(
    scene,
    asset,
    loader,
    weaponDefinition.handSocket,
    undefined,
    weaponDefinition,
    actorProfile.nativeJkaWeaponPresentation,
  );
  await weapon.attach();
  weapon.setBladeExtension(1);
  weapon.setAuthoredAnimationActive(true);
  const tagInfo = weapon.nativeBladeTagInfo;
  if (!weapon.isAttached || !tagInfo || tagInfo.bladeOriginNode !== 'JKA_BLADE_SOCKET'
    || tagInfo.sourceForwardConvention !== 'NEGATIVE_X' || weaponDefinition.bladeTagSurface !== '*blade1'
    || weaponDefinition.bladeLengthM !== 0.98) throw new Error('ROSH_NATIVE_SABER_TAG_GATE_FAIL');

  const restPose = (asset.root.getDescendants(false) as TransformNode[]).map(node => ({
    node,
    position: node.position.clone(),
    rotation: node.rotation.clone(),
    rotationQuaternion: node.rotationQuaternion?.clone() ?? null,
    scaling: node.scaling.clone(),
  }));
  const candidateTranslation: Vec3Tuple = [...baseProfileTranslation];
  const candidateRotation: Vec3Tuple = [...baseProfileRotation];
  let zeroPreview = false;
  let undoSnapshot: GripTransform | null = null;
  const gripSlots: Record<GripSlot, GripTransform | null> = { A: null, B: null, C: null };
  let currentPose: GripPoseId = 'ready';
  let activeGroupName: string | null = null;
  let activeProgress = 0.5;
  let currentCameraPreset: CameraPresetId = 'hand_closeup';
  const telemetry = lab.querySelector('#roshGripTelemetry') as HTMLElement;
  const status = lab.querySelector('#roshGripStatus') as HTMLElement;
  const candidateOutput = lab.querySelector('#roshGripCandidate') as HTMLOutputElement;
  const socket = weapon.socketNode;
  if (!socket) throw new Error('ROSH_NATIVE_SABER_SOCKET_MISSING');
  const baseSocketPosition = socket.position.clone();
  const baseSocketRotation = socket.rotation.clone();
  const markerFlags = { socketAxes: false, handOrigin: false, hiltOrigin: false, bladeTag: false, bladeAxis: false };

  const markerMaterial = new StandardMaterial('RoshGripLabMarkerMaterial', scene);
  markerMaterial.emissiveColor = new Color3(0.2, 0.9, 1);
  markerMaterial.disableLighting = true;
  const handMarker = MeshBuilder.CreateSphere('RoshGripLabRhandMarker', { diameter: 0.035 }, scene);
  handMarker.material = markerMaterial;
  handMarker.isPickable = false;
  handMarker.setEnabled(false);
  const hiltMarker = MeshBuilder.CreateSphere('RoshGripLabHiltMarker', { diameter: 0.025 }, scene);
  hiltMarker.material = markerMaterial;
  hiltMarker.isPickable = false;
  hiltMarker.setEnabled(false);
  const bladeTagMarker = MeshBuilder.CreateSphere('RoshGripLabBladeTagMarker', { diameter: 0.035 }, scene);
  bladeTagMarker.material = markerMaterial;
  bladeTagMarker.isPickable = false;
  bladeTagMarker.setEnabled(false);
  const socketAxes = [
    createLine(scene, 'RoshGripLabSocketX', new Color3(1, 0.25, 0.23)),
    createLine(scene, 'RoshGripLabSocketY', new Color3(0.35, 1, 0.4)),
    createLine(scene, 'RoshGripLabSocketZ', new Color3(0.25, 0.55, 1)),
  ];
  const bladeAxisLine = createLine(scene, 'RoshGripLabBladeAxis', new Color3(1, 0.82, 0.22));

  const cloneCandidate = (): GripTransform => ({ translation: [...candidateTranslation], rotation: [...candidateRotation] });
  const saveUndo = () => {
    undoSnapshot = cloneCandidate();
    const button = lab.querySelector<HTMLButtonElement>('[data-action="undo"]');
    if (button) button.disabled = false;
  };
  const setCandidate = (value: GripTransform) => {
    candidateTranslation.splice(0, 3, ...value.translation);
    candidateRotation.splice(0, 3, ...value.rotation);
  };
  const applyCandidateTransform = () => {
    const effectiveTranslation = zeroPreview ? zeroPresentation.translation : candidateTranslation;
    const effectiveRotation = zeroPreview ? zeroPresentation.rotation : candidateRotation;
    const parent = socket.parent as TransformNode | null;
    const parentScale = Vector3.One();
    parent?.computeWorldMatrix(true);
    parent?.getWorldMatrix().decompose(parentScale);
    const scale = Math.abs(parentScale.x) > 0.0001 ? Math.abs(parentScale.x) : 1;
    const profileDelta = effectiveTranslation.map((value, axis) => (value - baseProfileTranslation[axis]) / scale);
    socket.position.set(
      baseSocketPosition.x + profileDelta[0],
      baseSocketPosition.y + profileDelta[1],
      baseSocketPosition.z + profileDelta[2],
    );
    socket.rotationQuaternion = null;
    const degToRad = Math.PI / 180;
    socket.rotation.set(
      baseSocketRotation.x + (effectiveRotation[0] - baseProfileRotation[0]) * degToRad,
      baseSocketRotation.y + (effectiveRotation[1] - baseProfileRotation[1]) * degToRad,
      baseSocketRotation.z + (effectiveRotation[2] - baseProfileRotation[2]) * degToRad,
    );
    candidateOutput.textContent = `${zeroPreview ? 'ZERO PREVIEW · ' : 'PERSISTED PROFILE CANDIDATE · '}T [${candidateTranslation.map(v => v.toFixed(4)).join(', ')}] m · R [${candidateRotation.map(v => v.toFixed(1)).join(', ')}]°`;
    for (let axis = 0; axis < 3; axis++) {
      const translationOutput = lab.querySelector<HTMLOutputElement>(`[data-value="translation-${axis}"]`);
      const rotationOutput = lab.querySelector<HTMLOutputElement>(`[data-value="rotation-${axis}"]`);
      if (translationOutput) translationOutput.textContent = `${candidateTranslation[axis] >= 0 ? '+' : ''}${candidateTranslation[axis].toFixed(4)}`;
      if (rotationOutput) rotationOutput.textContent = `${candidateRotation[axis] >= 0 ? '+' : ''}${candidateRotation[axis].toFixed(1)}°`;
    }
    const warnings: string[] = [];
    const translationOver = candidateTranslation.some(value => Math.abs(value) > 0.05);
    const rotationOver = candidateRotation.some(value => Math.abs(value) > 30);
    if (translationOver) warnings.push('WARNING: translation exceeds 0.05 m; recheck socket-space assumptions.');
    if (rotationOver) warnings.push('WARNING: rotation exceeds ±30°; recheck native socket relationship.');
    const warning = lab.querySelector<HTMLElement>('#roshGripWarnings');
    if (warning) {
      warning.textContent = warnings.join(' ');
      warning.classList.toggle('over', warnings.length > 0);
    }
    lab.querySelector<HTMLButtonElement>('[data-action="show-zero"]')?.classList.toggle('active', zeroPreview);
    lab.querySelector<HTMLButtonElement>('[data-action="show-candidate"]')?.classList.toggle('active', !zeroPreview);
  };

  const handWorld = () => {
    hand?.transform.computeWorldMatrix(true);
    const socketParent = socket.parent as TransformNode | null;
    return hand?.transform.getAbsolutePosition().clone() ?? socketParent?.getAbsolutePosition().clone() ?? Vector3.Zero();
  };
  const hiltWorld = () => weapon.weaponRootNode?.getAbsolutePosition().clone() ?? socket.getAbsolutePosition().clone();
  const bladeSegment = () => weapon.getBladeSegment();
  const poseDescriptor = () => POSES.find(row => row.id === currentPose)!;

  const applyCameraPreset = (preset: CameraPresetId) => {
    currentCameraPreset = preset;
    camera.lowerRadiusLimit = preset === 'full_body' ? 1.2 : 0.35;
    if (preset === 'full_body') {
      const bounds = measureVisualBounds(asset.meshes);
      camera.target.set(0, (bounds.minY + bounds.maxY) * 0.5, 0);
      camera.alpha = Math.PI * 0.25;
      camera.beta = 1.2;
      camera.radius = 3.8;
      const fullBodyRight = camera.getDirection(Vector3.Right()).normalize();
      camera.target.subtractInPlace(fullBodyRight.scale(0.33));
      return;
    }
    const handPos = handWorld();
    const base = hiltWorld();
    const segment = bladeSegment();
    const axis = segment ? segment.end.subtract(segment.start).normalize() : new Vector3(1, 0, 0);
    camera.target.copyFrom(base.add(axis.scale(0.12)).add(Vector3.Up().scale(0.18)));
    camera.beta = 1.32;
    camera.radius = preset === 'hand_closeup' ? 1.2 : 1.3;
    camera.alpha = preset === 'hand_side' ? 0
      : preset === 'hand_front' ? Math.PI * 0.5
        : preset === 'hand_3_4' ? Math.PI * 0.25 : Math.PI * 0.25;
    if (!Number.isFinite(handPos.x)) camera.target.copyFrom(hiltWorld());
    const closeupRight = camera.getDirection(Vector3.Right()).normalize();
    camera.target.subtractInPlace(closeupRight.scale(0.05));
  };

  const restoreRestPose = () => {
    for (const row of restPose) {
      row.node.position.copyFrom(row.position);
      row.node.rotation.copyFrom(row.rotation);
      row.node.rotationQuaternion = row.rotationQuaternion?.clone() ?? null;
      row.node.scaling.copyFrom(row.scaling);
    }
  };
  const setPose = (poseId: GripPoseId) => {
    asset.animationGroups.forEach(group => group.stop());
    restoreRestPose();
    currentPose = poseId;
    const pose = POSES.find(row => row.id === poseId)!;
    activeGroupName = null;
    activeProgress = pose.progress ?? 0;
    if (pose.group) {
      const group = asset.animationGroups.find(candidate => candidate.name === pose.group);
      if (!group) throw new Error(`ROSH_GRIP_POSE_GROUP_MISSING:${pose.group}`);
      const from = group.from;
      const to = group.to;
      const frame = from + (to - from) * (pose.progress ?? 0.5);
      group.start(false, 1, from, to);
      group.goToFrame(frame);
      group.pause();
      activeGroupName = group.name;
      activeProgress = to > from ? (frame - from) / (to - from) : 0;
    }
    applyCandidateTransform();
    asset.root.computeWorldMatrix(true);
    socket.computeWorldMatrix(true);
    lab.querySelectorAll<HTMLButtonElement>('[data-pose]').forEach(button => button.classList.toggle('active', button.dataset.pose === poseId));
    if (currentCameraPreset !== 'full_body') applyCameraPreset(currentCameraPreset);
    updateTelemetry();
    status.textContent = `${pose.label} · frozen at ${Math.round(activeProgress * 100)}%${activeGroupName ? ` · ${activeGroupName}` : ' · bind/rest pose'}`;
  };

  const updateTelemetry = () => {
    asset.root.computeWorldMatrix(true);
    socket.computeWorldMatrix(true);
    weapon.weaponRootNode?.computeWorldMatrix(true);
    const blade = bladeSegment();
    const socketParent = socket.parent as TransformNode | null;
    const activeGroups = asset.animationGroups.filter(group => group.isStarted);
    const activeAnimatables = activeGroups.flatMap(group => (group as any).getAnimatables?.() ?? (group as any)._animatables ?? []);
    const hierarchyObjects = new Set<unknown>([asset.root, ...asset.root.getDescendants(false), ...asset.meshes, ...skeletons]);
    for (const skeleton of skeletons) {
      for (const bone of skeleton.bones) {
        hierarchyObjects.add(bone);
        const transform = bone.getTransformNode?.();
        if (transform) hierarchyObjects.add(transform);
      }
    }
    const foreignTargets = asset.animationGroups.flatMap(group => group.targetedAnimations)
      .filter(targeted => !hierarchyObjects.has(targeted.target));
    const writerCounts = new Map<object, Map<string, number>>();
    for (const group of activeGroups) {
      for (const targeted of group.targetedAnimations) {
        const target = targeted.target as object;
        const property = targeted.animation.targetProperty;
        const properties = writerCounts.get(target) ?? new Map<string, number>();
        properties.set(property, (properties.get(property) ?? 0) + 1);
        writerCounts.set(target, properties);
      }
    }
    let duplicateWriterCount = 0;
    for (const properties of writerCounts.values()) {
      for (const count of properties.values()) if (count > 1) duplicateWriterCount += count - 1;
    }
    const nativeProfile = actorProfile.nativeJkaWeaponPresentation ?? { translationM: [0, 0, 0], rotationEulerDeg: [0, 0, 0] };
    const runtimePresentation = weapon.presentationDiagnostics.effectiveCorrection ?? { translationM: [0, 0, 0], rotationEulerDeg: [0, 0, 0] };
    const profileRuntimeMatch = nativeProfile.translationM.every((value, index) => value === runtimePresentation.translationM[index])
      && nativeProfile.rotationEulerDeg.every((value, index) => value === runtimePresentation.rotationEulerDeg[index]);
    const socketPosition = socket.getAbsolutePosition();
    const handPosition = handWorld();
    const hiltPosition = hiltWorld();
    const data = {
      POSE: poseDescriptor().label,
      ACTIVE_GROUP: activeGroupName,
      NORMALIZED_PROGRESS: Number(activeProgress.toFixed(3)),
      ACTIVE_GROUP_COUNT: activeGroups.length,
      ACTIVE_GROUP_NAMES: activeGroups.map(group => group.name),
      ACTIVE_ANIMATABLE_COUNT: activeAnimatables.length,
      DUPLICATE_TARGET_PROPERTY_WRITERS: duplicateWriterCount,
      FOREIGN_ANIMATION_TARGET_COUNT: foreignTargets.length,
      JOINT_COUNT: jointCount,
      ANIMATION_GROUP_COUNT: asset.animationGroups.length,
      ROSH_ASSET_IDENTITY: modelHash.actual === ROSH_COMBO_SHA256 ? 'PASS' : 'FAIL',
      ROSH_ASSET: actorProfile.assetPath,
      ROSH_ASSET_SHA256: modelHash.actual,
      WEAPON: NATIVE_SABER_URL,
      WEAPON_SHA256: saberHash.actual,
      NATIVE_SABER_IDENTITY: saberHash.actual === NATIVE_SABER_SHA256 ? 'PASS' : 'FAIL',
      SABER_INSTANCE_COUNT: weapon.isAttached ? 1 : 0,
      SOCKET: weaponDefinition.handSocket,
      SOCKET_PARENT_NAME: socketParent?.name ?? null,
      RHANG_TAG_WORLD_POS: quaternionTelemetry(socketParent)?.position ?? null,
      RHANG_TAG_WORLD_ROT: quaternionTelemetry(socketParent)?.eulerDeg ?? null,
      RHAND_BONE_ORIGIN_WORLD_POS: quaternionTelemetry(hand?.transform)?.position ?? null,
      RHAND_BONE_ORIGIN_WORLD_ROT: quaternionTelemetry(hand?.transform)?.eulerDeg ?? null,
      HILT_WORLD_POS: quaternionTelemetry(weapon.weaponRootNode)?.position ?? null,
      HILT_WORLD_ROT: quaternionTelemetry(weapon.weaponRootNode)?.eulerDeg ?? null,
      SOCKET_TO_RHAND_DISTANCE_M: Number(Vector3.Distance(socketPosition, handPosition).toFixed(5)),
      HILT_TO_RHAND_DISTANCE_M: Number(Vector3.Distance(hiltPosition, handPosition).toFixed(5)),
      BLADE_BASE: blade?.start.asArray().map(v => Number(v.toFixed(5))) ?? null,
      BLADE_TIP: blade?.end.asArray().map(v => Number(v.toFixed(5))) ?? null,
      BLADE_LENGTH_M: blade ? Number(Vector3.Distance(blade.start, blade.end).toFixed(5)) : null,
      BLADE_TAG: tagInfo?.bladeOriginNode ?? null,
      BLADE_SOURCE_SURFACE: weaponDefinition.bladeTagSurface,
      BLADE_AXIS: tagInfo?.sourceForwardConvention ?? null,
      NATIVE_PRESENTATION_TRANSLATION: nativeProfile.translationM,
      NATIVE_PRESENTATION_ROTATION: nativeProfile.rotationEulerDeg,
      RUNTIME_NATIVE_PRESENTATION_TRANSLATION: runtimePresentation.translationM,
      RUNTIME_NATIVE_PRESENTATION_ROTATION: runtimePresentation.rotationEulerDeg,
      PROFILE_RUNTIME_MATCH: profileRuntimeMatch ? 'YES' : 'NO',
      DISPLAY_MODE: zeroPreview ? 'ZERO' : 'CANDIDATE',
      TEMPORARY_CANDIDATE_TRANSLATION_M: candidateTranslation,
      TEMPORARY_CANDIDATE_ROTATION_EULER_DEG: candidateRotation,
      EFFECTIVE_PRESENTATION_TRANSLATION_M: zeroPreview ? zeroPresentation.translation : candidateTranslation,
      EFFECTIVE_PRESENTATION_ROTATION_EULER_DEG: zeroPreview ? zeroPresentation.rotation : candidateRotation,
      PERSISTED_GRIP_CORRECTION: true,
      ACADEMY_LOADED: false,
      PARTY_LOADED: false,
      NAVIGATION_ACTIVE: false,
      SABER_TRACE_ACTIVE: false,
      DAMAGE_ACTIVE: false,
      PROFILE_MODIFIED: false,
      DEBUG_MARKERS: markerFlags,
    };
    telemetry.textContent = JSON.stringify(data, null, 2);
    (window as any).__roshNativeGripLab = {
      ...data,
      status: modelHash.actual === ROSH_COMBO_SHA256 && saberHash.actual === NATIVE_SABER_SHA256
        && jointCount === 53 && asset.animationGroups.length === 13 && skeletons.length === 1
        && foreignTargets.length === 0 && weapon.isAttached && duplicateWriterCount === 0 && profileRuntimeMatch ? 'PASS' : 'FAIL',
      nativeSaberAttached: weapon.isAttached,
      rigSkeletons: skeletons.length,
    };
  };

  const updateDebug = () => {
    const socketPos = socket.getAbsolutePosition();
    const axes = [Vector3.Right(), Vector3.Up(), new Vector3(0, 0, 1)];
    if (markerFlags.socketAxes) {
      socketAxes.forEach((line, i) => {
        line.setEnabled(true);
        const direction = socket.getDirection(axes[i]).normalize();
        updateLine(scene, line, socketPos, socketPos.add(direction.scale(0.12)));
      });
    } else socketAxes.forEach(line => line.setEnabled(false));
    if (markerFlags.handOrigin && hand) {
      handMarker.setEnabled(true);
      handMarker.position.copyFrom(handWorld());
    } else handMarker.setEnabled(false);
    if (markerFlags.hiltOrigin) {
      hiltMarker.setEnabled(true);
      hiltMarker.position.copyFrom(hiltWorld());
    } else hiltMarker.setEnabled(false);
    const origin = weapon.nativeBladeOriginNode;
    if (markerFlags.bladeTag && origin) {
      origin.computeWorldMatrix(true);
      bladeTagMarker.setEnabled(true);
      bladeTagMarker.position.copyFrom(origin.getAbsolutePosition());
    } else bladeTagMarker.setEnabled(false);
    const segment = bladeSegment();
    if (markerFlags.bladeAxis && segment) {
      bladeAxisLine.setEnabled(true);
      const axis = segment.end.subtract(segment.start).normalize();
      updateLine(scene, bladeAxisLine, segment.start, segment.start.add(axis.scale(0.25)));
    } else bladeAxisLine.setEnabled(false);
  };

  const poseHost = lab.querySelector('#roshGripPoses')!;
  for (const pose of POSES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.pose = pose.id;
    button.textContent = pose.label;
    button.addEventListener('click', () => setPose(pose.id));
    poseHost.append(button);
  }
  const cameraHost = lab.querySelector('#roshGripCameras')!;
  for (const preset of CAMERAS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.camera = preset.id;
    button.textContent = preset.label;
    button.addEventListener('click', () => {
      lab.querySelectorAll<HTMLButtonElement>('[data-camera]').forEach(item => item.classList.toggle('active', item === button));
      applyCameraPreset(preset.id);
    });
    cameraHost.append(button);
  }
  const makeAdjustmentRows = (
    hostId: string,
    kind: 'translation' | 'rotation',
    values: Vec3Tuple,
    axisLabels: string,
  ) => {
    const host = lab.querySelector<HTMLElement>(`#${hostId}`)!;
    const steps = kind === 'translation' ? [{ id: 'coarse', amount: 0.01, text: 'C' }, { id: 'fine', amount: 0.0025, text: 'F' }]
      : [{ id: 'coarse', amount: 5, text: 'C' }, { id: 'fine', amount: 1, text: 'F' }];
    for (let axis = 0; axis < 3; axis++) {
      const row = document.createElement('div');
      row.className = 'rosh-grip-adjust';
      const label = document.createElement('span');
      label.textContent = `${kind === 'translation' ? 'T' : 'R'}${axisLabels[axis]}`;
      const output = document.createElement('output');
      output.dataset.value = `${kind}-${axis}`;
      const precision = kind === 'translation' ? 4 : 1;
      output.textContent = `${values[axis] >= 0 ? '+' : ''}${values[axis].toFixed(precision)}${kind === 'translation' ? '' : '°'}`;
      for (const step of steps) {
        for (const direction of [-1, 1] as const) {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'rosh-grip-step';
          button.textContent = `${direction < 0 ? '−' : '+'}${step.text}`;
          button.setAttribute('aria-label', `${kind === 'translation' ? 'Translation' : 'Rotation'} ${axisLabels[axis]} ${step.id} ${direction < 0 ? 'minus' : 'plus'} ${step.amount}${kind === 'translation' ? ' meters' : ' degrees'}`);
          button.addEventListener('click', () => {
            saveUndo();
            const vector = kind === 'translation' ? candidateTranslation : candidateRotation;
            vector[axis] = Number((vector[axis] + direction * step.amount).toFixed(4));
            zeroPreview = false;
            applyCandidateTransform();
            updateTelemetry();
          });
          row.append(button);
        }
      }
      row.insertBefore(label, row.firstChild);
      row.insertBefore(output, row.children[1]);
      host.append(row);
    }
  };
  makeAdjustmentRows('roshGripTranslation', 'translation', candidateTranslation, 'XYZ');
  makeAdjustmentRows('roshGripRotation', 'rotation', candidateRotation, 'XYZ');

  const refreshSlotLabels = () => {
    for (const slot of ['A', 'B', 'C'] as const) {
      const label = lab.querySelector<HTMLElement>(`[data-slot-label="${slot}"]`);
      const saved = gripSlots[slot];
      label!.textContent = saved
        ? `SAVED · T [${saved.translation.map(value => value.toFixed(4)).join(', ')}] · R [${saved.rotation.map(value => value.toFixed(1)).join(', ')}]`
        : 'EMPTY';
    }
  };
  const slotHost = lab.querySelector('#roshGripSlots')!;
  for (const slot of ['A', 'B', 'C'] as const) {
    const row = document.createElement('div');
    row.className = 'rosh-grip-slot-row';
    const name = document.createElement('span');
    name.textContent = slot;
    const save = document.createElement('button');
    save.type = 'button'; save.textContent = `SAVE ${slot}`;
    save.addEventListener('click', () => {
      gripSlots[slot] = cloneCandidate();
      refreshSlotLabels();
      refreshSlotButtons();
    });
    const load = document.createElement('button');
    load.type = 'button'; load.textContent = `LOAD ${slot}`;
    load.disabled = true;
    load.addEventListener('click', () => {
      const saved = gripSlots[slot];
      if (!saved) return;
      saveUndo();
      setCandidate(saved);
      zeroPreview = false;
      applyCandidateTransform();
      updateTelemetry();
    });
    const label = document.createElement('div');
    label.dataset.slotLabel = slot;
    label.className = 'rosh-grip-small';
    label.style.gridColumn = '2 / 4';
    row.append(name, save, load, label);
    slotHost.append(row);
  }
  const refreshSlotButtons = () => {
    for (const slot of ['A', 'B', 'C'] as const) {
      const load = lab.querySelector<HTMLButtonElement>(`.rosh-grip-slot-row:nth-child(${['A', 'B', 'C'].indexOf(slot) + 1}) button:last-of-type`);
      if (load) load.disabled = gripSlots[slot] === null;
    }
  };
  lab.querySelector<HTMLButtonElement>('[data-action="show-zero"]')!.addEventListener('click', () => {
    zeroPreview = true;
    applyCandidateTransform();
    updateTelemetry();
  });
  lab.querySelector<HTMLButtonElement>('[data-action="show-candidate"]')!.addEventListener('click', () => {
    zeroPreview = false;
    applyCandidateTransform();
    updateTelemetry();
  });
  lab.querySelector<HTMLButtonElement>('[data-action="reset"]')!.addEventListener('click', () => {
    saveUndo();
    setCandidate({ translation: [...zeroPresentation.translation], rotation: [...zeroPresentation.rotation] });
    zeroPreview = false;
    applyCandidateTransform();
    updateTelemetry();
  });
  lab.querySelector<HTMLButtonElement>('[data-action="undo"]')!.addEventListener('click', event => {
    if (!undoSnapshot) return;
    setCandidate(undoSnapshot);
    undoSnapshot = null;
    zeroPreview = false;
    applyCandidateTransform();
    updateTelemetry();
    (event.currentTarget as HTMLButtonElement).disabled = true;
  });
  const undoButton = lab.querySelector<HTMLButtonElement>('[data-action="undo"]')!;
  undoButton.disabled = true;
  const copyStatus = lab.querySelector<HTMLElement>('#roshGripCopyStatus')!;
  lab.querySelector<HTMLButtonElement>('[data-action="copy"]')!.addEventListener('click', async () => {
    const payload = `nativeJkaWeaponPresentation: {\n  translationM: [${candidateTranslation.map(value => value.toFixed(4)).join(', ')}],\n  rotationEulerDeg: [${candidateRotation.map(value => value.toFixed(1)).join(', ')}]\n}`;
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(payload);
      else throw new Error('clipboard API unavailable');
      copyStatus.textContent = 'Copied current candidate · profile remains unchanged by this lab';
    } catch {
      try {
        const textarea = document.createElement('textarea');
        textarea.value = payload;
        textarea.style.position = 'fixed'; textarea.style.opacity = '0';
        document.body.append(textarea); textarea.select();
        const copied = document.execCommand('copy');
        textarea.remove();
        if (!copied) throw new Error('clipboard unavailable');
        copyStatus.textContent = 'Copied current candidate · profile remains unchanged by this lab';
      } catch {
        copyStatus.textContent = 'Clipboard unavailable; values remain visible in the telemetry/current candidate.';
      }
    }
  });
  refreshSlotLabels();
  refreshSlotButtons();
  lab.querySelectorAll<HTMLInputElement>('[data-marker]').forEach(input => input.addEventListener('change', () => {
    const key = input.dataset.marker as keyof typeof markerFlags;
    markerFlags[key] = input.checked;
    updateDebug();
    updateTelemetry();
  }));

  applyCandidateTransform();
  applyCameraPreset('hand_closeup');
  lab.querySelectorAll<HTMLButtonElement>('[data-camera]').forEach(button => button.classList.toggle('active', button.dataset.camera === 'hand_closeup'));
  setPose('ready');
  let lastTelemetryAt = 0;
  scene.onBeforeRenderObservable.add(() => {
    const now = performance.now();
    if (now - lastTelemetryAt >= 150) { lastTelemetryAt = now; updateTelemetry(); }
    if (Object.values(markerFlags).some(Boolean)) updateDebug();
  });
  engine.runRenderLoop(() => scene.render());
  window.addEventListener('resize', () => engine.resize());
  status.textContent = 'PASS · Rosh hash, 53-joint rig, native saber, rhang_tag_bone, *blade1, 0.98 m';
}
