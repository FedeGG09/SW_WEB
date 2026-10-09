import {
  ArcRotateCamera,
  Color3,
  Color4,
  DirectionalLight,
  Engine,
  HemisphericLight,
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
import { classifyIncomingStrike, type SaberParryDirection } from '../../combat/SaberParryDirectionClassifier';
import type { BladeSegment } from '../../combat/SaberClashDetector';

const DEFENSE_URL = '/_lab/jka/characters/aren/aren_native_jka_v1_defense_v2.glb';
const DEFENSE_SHA256 = 'f27d77b930a1facc3af4d5ac849cc0621a680c9d3fb1461f0cd4858a7d84dfb3';
const SABER_URL = '/_lab/jka/weapons/saber/jka_native_single_saber_v1.glb';
const SABER_SHA256 = 'b6dd4dea8d3e054f6932efa066c1840e45f10aafde04da0d860a3ba92357b677';
const BLADE_LENGTH_M = 0.98;

type PoseId = 'ready' | 'block' | 'parryStart' | 'parryMid' | 'parryEnd';
type CameraId = 'full' | 'close' | 'front' | 'side' | 'right34' | 'left34';
const DEFENSE_GROUPS: Record<SaberParryDirection, string> = {
  TOP: 'JKA_PARRY_TOP',
  TOP_LEFT: 'JKA_PARRY_TOP_LEFT',
  TOP_RIGHT: 'JKA_PARRY_TOP_RIGHT',
  BOTTOM_LEFT: 'JKA_PARRY_BOTTOM_LEFT',
  BOTTOM_RIGHT: 'JKA_PARRY_BOTTOM_RIGHT',
};

const POSES: Record<PoseId, { label: string; group: string; progress: number; state: string }> = {
  ready: { label: 'NORMAL READY', group: 'JKA_SABER_READY', progress: 0.5, state: 'READY' },
  block: { label: 'BLOCK READY', group: 'JKA_SABER_READY', progress: 0.5, state: 'BLOCK_READY' },
  parryStart: { label: 'PARRY START', group: 'JKA_PARRY_TOP', progress: 0, state: 'PARRY_RESPONSE' },
  parryMid: { label: 'PARRY MID', group: 'JKA_PARRY_TOP', progress: 0.5, state: 'PARRY_RESPONSE' },
  parryEnd: { label: 'PARRY END', group: 'JKA_PARRY_TOP', progress: 1, state: 'PARRY_RESPONSE' },
};

function hashHex(bytes: ArrayBuffer) {
  return crypto.subtle.digest('SHA-256', bytes).then(hash =>
    [...new Uint8Array(hash)].map(value => value.toString(16).padStart(2, '0')).join(''),
  );
}

async function verifyHash(path: string, expected: string) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`ROSH_DEFENSE_LAB_HTTP_${response.status}:${path}`);
  return { actual: await hashHex(await response.arrayBuffer()), expected };
}

function rightHand(asset: ImportedAsset) {
  const skeletons = [...new Set(asset.meshes.map(mesh => mesh.skeleton).filter((skeleton): skeleton is Skeleton => Boolean(skeleton)))];
  for (const skeleton of skeletons) {
    const bone = skeleton.bones.find(candidate => candidate.name.toLowerCase() === 'rhand');
    const transform = bone?.getTransformNode?.();
    if (transform) return { bone, transform };
  }
  return null;
}

function worldTelemetry(node: TransformNode | Mesh | null | undefined) {
  if (!node) return null;
  node.computeWorldMatrix(true);
  const scale = Vector3.One();
  const rotation = Quaternion.Identity();
  const position = Vector3.Zero();
  node.getWorldMatrix().decompose(scale, rotation, position);
  return {
    position: position.asArray().map(value => Number(value.toFixed(5))),
    rotation: rotation.toEulerAngles().asArray().map(value => Number((value * 180 / Math.PI).toFixed(2))),
  };
}

function addStyle() {
  const style = document.createElement('style');
  style.id = 'rosh-defense-lab-style';
  style.textContent = `
    .rosh-defense-lab{position:fixed;inset:0;z-index:30;pointer-events:none;color:#eaf7fc;font:12px/1.4 ui-monospace,Consolas,monospace}
    .rosh-defense-panel{position:absolute;right:16px;top:16px;width:min(360px,calc(100vw - 32px));max-height:calc(100vh - 32px);overflow:auto;padding:14px;border:1px solid #6ad8e766;border-radius:10px;background:#07131fee;box-shadow:0 16px 42px #0009;backdrop-filter:blur(8px);pointer-events:auto}
    .rosh-defense-title{display:flex;justify-content:space-between;color:#95efff;font:700 13px/1.3 system-ui,sans-serif;letter-spacing:.08em;margin-bottom:4px}
    .rosh-defense-sub{color:#aebfc9;font:10px/1.35 system-ui,sans-serif;margin-bottom:10px}
    .rosh-defense-section{border-top:1px solid #9cd8e51f;padding-top:9px;margin-top:9px}
    .rosh-defense-heading{color:#ffd591;font-size:10px;font-weight:700;letter-spacing:.1em;margin-bottom:6px}
    .rosh-defense-buttons{display:flex;flex-wrap:wrap;gap:5px}
    .rosh-defense-lab button{border:1px solid #9ac2d13b;border-radius:5px;background:#102536;color:#e2f3fb;padding:6px 8px;font:600 10px/1.2 system-ui,sans-serif;cursor:pointer}
    .rosh-defense-lab button:hover,.rosh-defense-lab button.active{border-color:#87edff;background:#17445a;color:white}
    .rosh-defense-data{white-space:pre-wrap;overflow-wrap:anywhere;color:#c6d5de;font-size:10px;line-height:1.45;margin:0}
    .rosh-defense-status{color:#a7edbd;min-height:16px;margin-top:7px}
    .rosh-defense-gate{color:#9becff;font-size:10px;margin-top:7px}
  `;
  document.head.append(style);
}

export async function startRoshDefenseLab(canvas = document.getElementById('renderCanvas') as HTMLCanvasElement) {
  document.querySelectorAll('#hud,#questHud,#interactionPrompt,#dialogueOverlay,#fadeOverlay,#debugOverlay,#loadingOverlay,#errorOverlay')
    .forEach(node => node.classList.add('is-hidden'));
  if (!canvas) throw new Error('ROSH_DEFENSE_LAB_CANVAS_MISSING');
  document.getElementById('renderCanvas')?.setAttribute('style', 'position:fixed;inset:0;width:100vw;height:100vh;z-index:1;touch-action:none');
  addStyle();

  const panel = document.createElement('section');
  panel.className = 'rosh-defense-lab';
  panel.innerHTML = `
    <div class="rosh-defense-panel">
      <div class="rosh-defense-title"><span>ROSH · NATIVE DEFENSE LAB</span><span>W237.2F.3A</span></div>
      <div class="rosh-defense-sub">Visual-only isolated inspector. No Academy, Jolee, party, navigation, trace, or damage.</div>
      <div class="rosh-defense-section"><div class="rosh-defense-heading">POSE / STATE</div><div id="roshDefensePoses" class="rosh-defense-buttons"></div></div>
      <div class="rosh-defense-section"><div class="rosh-defense-heading">SYNTHETIC INCOMING STRIKE → CLASSIFIER → RESPONSE</div><div id="roshDefenseDirections" class="rosh-defense-buttons"></div><div id="roshDefenseRotations" class="rosh-defense-buttons"></div></div>
      <div class="rosh-defense-section"><div class="rosh-defense-heading">VISUAL TRIGGER ONLY</div><div class="rosh-defense-buttons">
        <button data-action="play">PLAY FULL PARRY</button><button data-action="return-held">RETURN WHILE BLOCK HELD</button><button data-action="return-release">RETURN AFTER BLOCK RELEASED</button>
      </div></div>
      <div class="rosh-defense-section"><div class="rosh-defense-heading">CAMERA</div><div id="roshDefenseCameras" class="rosh-defense-buttons"></div></div>
      <div class="rosh-defense-section"><div class="rosh-defense-heading">TELEMETRY</div><pre id="roshDefenseTelemetry" class="rosh-defense-data">Loading Rosh defense asset…</pre></div>
      <div id="roshDefenseStatus" class="rosh-defense-status">Loading isolated scene…</div>
      <div class="rosh-defense-gate">COMBAT_PHYSICS_LOADED = NO · JOLEE_LOADED = NO · ACADEMY_LOADED = NO</div>
    </div>`;
  document.body.append(panel);

  const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true, antialias: true, adaptToDeviceRatio: true });
  const scene = new Scene(engine);
  scene.useRightHandedSystem = true;
  scene.clearColor = new Color4(0.045, 0.055, 0.068, 1);
  const camera = new ArcRotateCamera('RoshDefenseOrbitCamera', Math.PI * 0.25, 1.2, 3.8, new Vector3(0, 1, 0), scene);
  camera.lowerRadiusLimit = 0.4;
  camera.upperRadiusLimit = 10;
  camera.wheelPrecision = 35;
  camera.panningSensibility = 0;
  camera.attachControl(canvas, true);
  camera.fov = 0.52;
  scene.activeCamera = camera;
  const hemi = new HemisphericLight('RoshDefenseSkyLight', new Vector3(0.2, 1, -0.25), scene);
  hemi.intensity = 1.05;
  hemi.diffuse = new Color3(0.78, 0.86, 0.95);
  hemi.groundColor = new Color3(0.25, 0.28, 0.33);
  const key = new DirectionalLight('RoshDefenseKeyLight', new Vector3(-0.6, -1, 0.45), scene);
  key.position.set(2.2, 4, -2.5);
  key.intensity = 1.15;
  const floor = MeshBuilder.CreateGround('RoshDefenseNeutralFloor', { width: 8, height: 8 }, scene);
  const floorMaterial = new StandardMaterial('RoshDefenseFloorMaterial', scene);
  floorMaterial.diffuseColor = new Color3(0.16, 0.19, 0.22);
  floorMaterial.specularColor = new Color3(0.08, 0.08, 0.08);
  floor.material = floorMaterial;
  floor.isPickable = false;

  const profile = PLAYER_CHARACTERS['aren-native-jka-v1'];
  const loader = new AssetLoader();
  const [defenseHash, saberHash] = await Promise.all([verifyHash(DEFENSE_URL, DEFENSE_SHA256), verifyHash(SABER_URL, SABER_SHA256)]);
  if (defenseHash.actual !== defenseHash.expected) throw new Error(`ROSH_DEFENSE_ASSET_HASH_MISMATCH:${defenseHash.actual}`);
  if (saberHash.actual !== saberHash.expected) throw new Error(`ROSH_DEFENSE_SABER_HASH_MISMATCH:${saberHash.actual}`);

  const actorRoot = new TransformNode('RoshDefenseActorRoot', scene);
  const visualRoot = new TransformNode('RoshDefenseVisualRoot', scene);
  visualRoot.parent = actorRoot;
  const asset = await loader.load(DEFENSE_URL, scene);
  asset.root.parent = visualRoot;
  asset.root.position.set(0, 0, 0);
  const bounds = measureVisualBounds(asset.meshes);
  if (bounds.height > 0) visualRoot.scaling.setAll(profile.targetHeightM / bounds.height);
  alignVisualFeetToGround(visualRoot, asset.meshes, 0.02);
  visualRoot.position.y += profile.runtimeVisualGroundOffsetM ?? 0;
  const skeletons = [...new Set(asset.meshes.map(mesh => mesh.skeleton).filter((skeleton): skeleton is Skeleton => Boolean(skeleton)))];
  const jointCount = skeletons[0]?.bones.length ?? 0;
  if (skeletons.length !== 1 || jointCount !== 53) throw new Error(`ROSH_DEFENSE_RIG_GATE_FAIL:${JSON.stringify({ skeletons: skeletons.length, jointCount })}`);
  const required = ['JKA_SABER_READY', ...Object.values(DEFENSE_GROUPS)];
  const missing = required.filter(group => !asset.animationGroups.some(candidate => candidate.name === group));
  if (asset.animationGroups.length !== 18 || missing.length) throw new Error(`ROSH_DEFENSE_GROUP_GATE_FAIL:${JSON.stringify({ groups: asset.animationGroups.length, missing })}`);
  const hand = rightHand(asset);
  const handBone = hand?.bone;
  if (!hand || !handBone || handBone.name.toLowerCase() !== 'rhand') throw new Error(`ROSH_DEFENSE_HAND_GATE_FAIL:${handBone?.name ?? 'missing'}`);

  const weaponDefinition: NativeJkaWeaponDefinition = {
    assetPath: SABER_URL,
    handSocket: 'rhang_tag_bone',
    bladeOriginNode: 'JKA_BLADE_SOCKET',
    bladeAxisNode: 'JKA_BLADE_AXIS_NEGATIVE_X',
    bladeTagSurface: '*blade1',
    bladeLengthM: BLADE_LENGTH_M,
    sourceForwardConvention: 'NEGATIVE_X',
  };
  const weapon = new WeaponAttachment(scene, asset, loader, weaponDefinition.handSocket, undefined, weaponDefinition, profile.nativeJkaWeaponPresentation);
  await weapon.attach();
  weapon.setBladeExtension(1);
  weapon.setAuthoredAnimationActive(true);
  if (!weapon.isAttached || !weapon.nativeBladeTagInfo || weapon.nativeBladeTagInfo.bladeOriginNode !== 'JKA_BLADE_SOCKET') throw new Error('ROSH_DEFENSE_WEAPON_GATE_FAIL');
  const socket = weapon.socketNode;
  if (!socket) throw new Error('ROSH_DEFENSE_SOCKET_MISSING');
  const initialRoot = actorRoot.getAbsolutePosition().clone();
  const telemetry = panel.querySelector('#roshDefenseTelemetry') as HTMLElement;
  const status = panel.querySelector('#roshDefenseStatus') as HTMLElement;
  let activeGroup: any = null;
  let activePose: PoseId = 'parryMid';
  let state = 'PARRY_RESPONSE';
  let blockHeld = true;
  let responsePlaying = false;
  let selectedDirection: SaberParryDirection = 'TOP';
  let expectedDirection: SaberParryDirection | null = null;
  let directionResult: ReturnType<typeof classifyIncomingStrike> | null = null;
  let syntheticContactPoint = new Vector3(0, 1.15, 0);

  const allTargets = () => new Set<any>([asset.root, ...asset.root.getDescendants(false), ...asset.meshes]);
  const ownership = () => {
    const targetSet = allTargets();
    const byTarget = new Map<any, Map<string, number>>();
    const activeAnimatables: any[] = activeGroup
      ? ((activeGroup as any).getAnimatables?.() ?? (activeGroup as any)._animatables ?? [])
      : [];
    let foreignTargets = 0;
    if (activeGroup) {
      for (const targeted of activeGroup.targetedAnimations) {
        const target: any = targeted.target;
        if (!targetSet.has(target)) foreignTargets += 1;
        const property = String((targeted.animation as any)?.targetProperty ?? 'unknown');
        let properties = byTarget.get(target);
        if (!properties) { properties = new Map<string, number>(); byTarget.set(target, properties); }
        properties.set(property, (properties.get(property) ?? 0) + 1);
      }
    }
    let duplicateWriters = 0;
    for (const properties of byTarget.values()) {
      for (const count of properties.values()) duplicateWriters += Math.max(0, count - 1);
    }
    return { animatableCount: activeAnimatables.length, foreignTargets, duplicateWriters };
  };
  const updateTelemetry = () => {
    actorRoot.computeWorldMatrix(true);
    const segment = weapon.getBladeSegment();
    const from = activeGroup ? Number(activeGroup.from) : 0;
    const to = activeGroup ? Number(activeGroup.to) : 1;
    const frame = activeGroup ? Number(activeGroup.getCurrentFrame?.() ?? from) : from;
    const progress = to === from ? 0 : Math.max(0, Math.min(1, (frame - from) / (to - from)));
    const own = ownership();
    const root = worldTelemetry(actorRoot);
    const rootPos = actorRoot.getAbsolutePosition();
    const delta = rootPos.subtract(initialRoot);
    telemetry.textContent = [
      `STATE = ${state}`,
      `BLOCK_HELD = ${blockHeld ? 'YES' : 'NO'}`,
      `ACTIVE_GROUP = ${activeGroup?.name ?? 'NONE'}`,
      `ACTIVE_GROUP_COUNT = ${activeGroup ? 1 : 0}`,
      `NORMALIZED_PROGRESS = ${progress.toFixed(3)}`,
      `ANIMATABLE_COUNT = ${own.animatableCount}`,
      `DUPLICATE_TARGET_PROPERTY_WRITERS = ${own.duplicateWriters}`,
      `FOREIGN_TARGETS = ${own.foreignTargets}`,
      `ROOT_WORLD_POSITION = ${root?.position.map(value => value.toFixed(5)).join(', ')}`,
      `ROOT_DELTA = ${delta.asArray().map(value => value.toFixed(6)).join(', ')}`,
      `RIGHT_HAND_WORLD_POSITION = ${worldTelemetry(hand.transform)?.position.map(value => value.toFixed(5)).join(', ')}`,
      `HILT_WORLD_POSITION = ${worldTelemetry(weapon.weaponRootNode)?.position.map(value => value.toFixed(5)).join(', ')}`,
      `BLADE_BASE = ${segment?.start.asArray().map(value => value.toFixed(5)).join(', ') ?? 'NONE'}`,
      `BLADE_TIP = ${segment?.end.asArray().map(value => value.toFixed(5)).join(', ') ?? 'NONE'}`,
      `BLADE_LENGTH = ${segment ? Vector3.Distance(segment.start, segment.end).toFixed(5) : '0.00000'} m`,
      `NATIVE_GRIP_TRANSLATION = [0.0400, 0.0000, 0.0000]`,
      `NATIVE_GRIP_ROTATION = [0.0, 5.0, 80.0] deg`,
      `EXPECTED_DIRECTION = ${expectedDirection ?? 'NONE'}`,
      `CLASSIFIED_DIRECTION = ${directionResult?.direction ?? 'NONE'}`,
      `SELECTED_GROUP = ${activeGroup?.name ?? 'NONE'}`,
      `INCOMING_VECTOR_WORLD = ${directionResult?.incomingVectorWorld.asArray().map(value => value.toFixed(4)).join(', ') ?? 'NONE'}`,
      `INCOMING_VECTOR_LOCAL = ${directionResult?.incomingVectorLocal.asArray().map(value => value.toFixed(4)).join(', ') ?? 'NONE'}`,
      `CONTACT_POINT_LOCAL = ${directionResult?.contactPointLocal.asArray().map(value => value.toFixed(4)).join(', ') ?? 'NONE'}`,
      `CONTACT_POINT_WORLD = ${syntheticContactPoint.asArray().map(value => value.toFixed(4)).join(', ')}`,
      `SOCKET = rhang_tag_bone · BLADE_TAG = *blade1 · AXIS = NEGATIVE_X`,
      `ASSET = ${DEFENSE_URL} · JOINTS = ${jointCount} · ANIMATION_GROUPS = ${asset.animationGroups.length}`,
    ].join('\n');
  };

  const stopGroups = () => asset.animationGroups.forEach(group => group.stop());
  const freezeGroup = (groupName: string, progress: number, nextState: string) => {
    const group = asset.animationGroups.find(candidate => candidate.name === groupName);
    if (!group) throw new Error(`ROSH_DEFENSE_POSE_GROUP_MISSING:${groupName}`);
    stopGroups();
    group.start(false, 1);
    const from = Number(group.from);
    const to = Number(group.to);
    group.goToFrame(from + (to - from) * progress);
    group.pause();
    activeGroup = group;
    state = nextState;
    responsePlaying = false;
    updateTelemetry();
  };
  const freeze = (poseId: PoseId) => {
    const pose = POSES[poseId];
    freezeGroup(pose.group, pose.progress, pose.state);
    activePose = poseId;
  };
  const recover = () => freeze(blockHeld ? 'block' : 'ready');
  const playFullParry = (held: boolean) => {
    blockHeld = held;
    const group = asset.animationGroups.find(candidate => candidate.name === DEFENSE_GROUPS[selectedDirection]);
    if (!group) throw new Error('ROSH_DEFENSE_RESPONSE_GROUP_MISSING');
    stopGroups();
    activeGroup = group;
    activePose = 'parryMid';
    state = 'PARRY_RESPONSE';
    responsePlaying = true;
    group.start(false, 1);
    group.onAnimationEndObservable.addOnce(() => {
      responsePlaying = false;
      recover();
    });
    updateTelemetry();
  };
  const localDirectionVector = (direction: SaberParryDirection) => {
    switch (direction) {
      case 'TOP_LEFT': return new Vector3(-1, 1, 0).normalize();
      case 'TOP_RIGHT': return new Vector3(1, 1, 0).normalize();
      case 'BOTTOM_LEFT': return new Vector3(-1, -1, 0).normalize();
      case 'BOTTOM_RIGHT': return new Vector3(1, -1, 0).normalize();
      default: return Vector3.Up();
    }
  };
  const makeSyntheticBlade = (near: Vector3, axis: Vector3): BladeSegment => ({
    start: near.add(axis.scale(0.42)),
    end: near.subtract(axis.scale(0.42)),
  });
  const classifySyntheticLocal = (localDirection: Vector3, rotationDegrees = actorRoot.rotation.y * 180 / Math.PI) => {
    actorRoot.rotation.y = rotationDegrees * Math.PI / 180;
    actorRoot.computeWorldMatrix(true);
    const desiredWorld = Vector3.TransformNormal(localDirection.normalize(), actorRoot.getWorldMatrix()).normalize();
    const contact = actorRoot.getAbsolutePosition().add(new Vector3(0, 1.15, 0));
    const previousNear = contact.add(desiredWorld.scale(0.20));
    const currentNear = contact.subtract(desiredWorld.scale(0.20));
    const bladeAxis = actorRoot.getDirection(Vector3.Forward()).normalize();
    return classifyIncomingStrike({
      attackerPreviousBlade: makeSyntheticBlade(previousNear, bladeAxis),
      attackerCurrentBlade: makeSyntheticBlade(currentNear, bladeAxis),
      contactPoint: contact,
      defenderTransform: actorRoot,
    });
  };
  const simulateDirection = (expected: SaberParryDirection) => {
    expectedDirection = expected;
    const desiredLocal = localDirectionVector(expected);
    actorRoot.computeWorldMatrix(true);
    const desiredWorld = Vector3.TransformNormal(desiredLocal, actorRoot.getWorldMatrix()).normalize();
    syntheticContactPoint = actorRoot.getAbsolutePosition().add(new Vector3(0, 1.15, 0));
    const previousNear = syntheticContactPoint.add(desiredWorld.scale(0.20));
    const currentNear = syntheticContactPoint.subtract(desiredWorld.scale(0.20));
    // Keep the finite test blade axis orthogonal to the X/Y classification
    // plane so closest-point sampling preserves the incoming motion vector.
    const bladeAxisWorld = actorRoot.getDirection(Vector3.Forward()).normalize();
    directionResult = classifyIncomingStrike({
      attackerPreviousBlade: makeSyntheticBlade(previousNear, bladeAxisWorld),
      attackerCurrentBlade: makeSyntheticBlade(currentNear, bladeAxisWorld),
      contactPoint: syntheticContactPoint,
      defenderTransform: actorRoot,
    });
    selectedDirection = directionResult.direction;
    freezeGroup(DEFENSE_GROUPS[selectedDirection], 0.5, 'PARRY_RESPONSE_DIRECTIONAL');
    activePose = 'parryMid';
    status.textContent = `CLASSIFIED ${directionResult.direction} · ${DEFENSE_GROUPS[selectedDirection]} · synthetic input only`;
  };
  const testRotation = (degrees: number) => {
    actorRoot.rotation.y = degrees * Math.PI / 180;
    simulateDirection(expectedDirection ?? 'TOP_LEFT');
  };
  const boundaryResults = {
    TOP_TL: classifySyntheticLocal(new Vector3(-0.5, 1, 0), 0).direction,
    TOP_TR: classifySyntheticLocal(new Vector3(0.5, 1, 0), 0).direction,
    TL_BL: classifySyntheticLocal(new Vector3(-1, 0, 0), 0).direction,
    TR_BR: classifySyntheticLocal(new Vector3(1, 0, 0), 0).direction,
  };
  const rotationResults = [0, 90, 180].map(rotation => ({
    rotation,
    classified: classifySyntheticLocal(new Vector3(-1, 1, 0), rotation).direction,
  }));
  actorRoot.rotation.y = 0;
  (window as any).__w2372F4DirectionMatrix = {
    synthetic: Object.fromEntries((Object.keys(DEFENSE_GROUPS) as SaberParryDirection[]).map(direction => [direction, {
      classified: classifySyntheticLocal(localDirectionVector(direction), 0).direction,
      group: DEFENSE_GROUPS[classifySyntheticLocal(localDirectionVector(direction), 0).direction],
    }])),
    boundaries: boundaryResults,
    rotationInvariance: rotationResults,
  };
  const cameras: Array<{ id: CameraId; label: string }> = [
    { id: 'full', label: 'FULL BODY' }, { id: 'close', label: 'RIGHT HAND CLOSEUP' }, { id: 'front', label: 'FRONT' },
    { id: 'side', label: 'SIDE' }, { id: 'right34', label: 'RIGHT 3/4' }, { id: 'left34', label: 'LEFT 3/4' },
  ];
  const applyCamera = (id: CameraId) => {
    const handPos = hand.transform.getAbsolutePosition().clone();
    const hiltPos = weapon.weaponRootNode?.getAbsolutePosition().clone() ?? handPos;
    if (id === 'full') {
      const current = measureVisualBounds(asset.meshes);
      camera.target.set(0, (current.minY + current.maxY) * 0.5, 0);
      camera.alpha = Math.PI * 0.25; camera.beta = 1.2; camera.radius = 3.8;
      return;
    }
    camera.target.copyFrom(id === 'close' || id === 'front' || id === 'side' || id === 'right34' || id === 'left34' ? hiltPos.add(Vector3.Up().scale(0.16)) : handPos);
    camera.radius = id === 'close' ? 1.05 : 1.45;
    camera.beta = 1.3;
    camera.alpha = id === 'front' ? Math.PI * 0.5 : id === 'side' ? 0 : id === 'left34' ? -Math.PI * 0.25 : Math.PI * 0.25;
  };
  const poseRoot = panel.querySelector('#roshDefensePoses') as HTMLElement;
  Object.entries(POSES).forEach(([id, pose]) => {
    const button = document.createElement('button'); button.textContent = pose.label;
    button.addEventListener('click', () => { blockHeld = id === 'block' || id.startsWith('parry'); freeze(id as PoseId); });
    poseRoot.append(button);
  });
  const directionRoot = panel.querySelector('#roshDefenseDirections') as HTMLElement;
  (Object.keys(DEFENSE_GROUPS) as SaberParryDirection[]).forEach(direction => {
    const button = document.createElement('button');
    button.textContent = `SIMULATE ${direction.replace('_', ' ')}`;
    button.addEventListener('click', () => simulateDirection(direction));
    directionRoot.append(button);
  });
  const rotationRoot = panel.querySelector('#roshDefenseRotations') as HTMLElement;
  [0, 90, 180].forEach(degrees => {
    const button = document.createElement('button');
    button.textContent = `ROTATE DEFENDER ${degrees}°`;
    button.addEventListener('click', () => testRotation(degrees));
    rotationRoot.append(button);
  });
  const cameraRoot = panel.querySelector('#roshDefenseCameras') as HTMLElement;
  cameras.forEach(cameraDef => {
    const button = document.createElement('button'); button.textContent = cameraDef.label;
    button.addEventListener('click', () => applyCamera(cameraDef.id)); cameraRoot.append(button);
  });
  panel.querySelector('[data-action="play"]')?.addEventListener('click', () => playFullParry(true));
  panel.querySelector('[data-action="return-held"]')?.addEventListener('click', () => playFullParry(true));
  panel.querySelector('[data-action="return-release"]')?.addEventListener('click', () => playFullParry(false));
  freezeGroup(DEFENSE_GROUPS.TOP, 0.5, 'PARRY_RESPONSE_DIRECTIONAL');
  expectedDirection = 'TOP';
  selectedDirection = 'TOP';
  applyCamera('right34');
  status.textContent = 'READY · directional synthetic lab · choose an incoming strike';
  engine.runRenderLoop(() => { scene.render(); updateTelemetry(); });
  window.addEventListener('resize', () => engine.resize());
}
