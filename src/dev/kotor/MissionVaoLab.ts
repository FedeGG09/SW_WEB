import {
  AbstractMesh,
  AnimationGroup,
  ArcRotateCamera,
  Color3,
  Color4,
  Engine,
  HemisphericLight,
  Matrix,
  Mesh,
  MeshBuilder,
  PBRMaterial,
  Quaternion,
  Scene,
  SceneLoader,
  StandardMaterial,
  TransformNode,
  Vector3,
} from '@babylonjs/core';
import '@babylonjs/loaders/glTF';

type LabState = {
  loaded: boolean;
  error?: string;
  meshes: number;
  transformNodes: number;
  skeletons: Array<{ name: string; joints: number }>;
  animationGroups: string[];
  currentAnimation: string | null;
  animationTime: number | null;
  height: number | null;
  hooksFound: string[];
  loadMs: number | null;
  fpsApprox: number | null;
  materials: number;
  textures: number;
  lightsaberVisible: boolean;
  lightsaberHookParent: string | null;
  lightsaberHookWorldPosition: [number, number, number] | null;
  rightHandWorldPosition: [number, number, number] | null;
  weaponAnchorWorldPosition: [number, number, number] | null;
  saberBasisRotationXYZW: [number, number, number, number] | null;
  hierarchyDiagnostics: Record<string, { name: string; parent: string | null; nodeClass: string; matrixLocal: number[]; matrixWorld: number[]; position: [number, number, number] } | null>;
  gripMeasurements: Record<string, { sampleCount: number; minHandToHilt: number | null; meanHandToHilt: number | null; maxHandToHilt: number | null; minHookToHand: number | null; meanHookToHand: number | null; maxHookToHand: number | null; minAnchorToHand: number | null; meanAnchorToHand: number | null; maxAnchorToHand: number | null; samples: Array<Record<string, unknown>> }>;
  headAttachmentMeasurements: Record<string, { sampleCount: number; bodyHeadHookToHeadRoot: { min: number | null; mean: number | null; max: number | null }; bodyNeckToHeadNeck: { min: number | null; mean: number | null; max: number | null }; headNeckRootToModelRoot: { min: number | null; mean: number | null; max: number | null }; samples: Array<Record<string, unknown>> }>;
  deflectHookParent: string | null;
  deflectHookWorldPosition: [number, number, number] | null;
  lightsaberAsset: string | null;
  lightsaberMeshCount: number;
  lightsaberBounds: { min: [number, number, number]; max: [number, number, number] } | null;
  lightsaberImportedRoots: string[];
  headAttachment: Record<string, unknown>;
  faceTelemetry: Record<string, Record<string, number | null>>;
  eyeAudit: Record<string, unknown>;
  neckSeam: Record<string, unknown>;
  talk: Record<string, unknown>;
  pause1: Record<string, unknown>;
  weaponGrip: Record<string, unknown>;
  skeletonProbe: Record<string, unknown>;
};

declare global {
  interface Window { __missionVaoLabState?: LabState }
}

const GLB_ROOT = '/_lab/kotor/characters/mission/';
const BASELINE_GLB_NAME = 'mission_vao_kotor_donor.glb';
const CANDIDATE_GLB_NAME = 'mission_vao_kotor_donor_w230_3o_candidate.glb';
const HOOK_NAMES = [
  'LightsaberHook', 'DeflectHook', 'handconjure', 'headconjure', 'impact_bolt', 'Impact',
  'camerahook', 'FreeLookHook', 'headhook', 'MaskHook', 'GoggleHook',
];
const animationMap: Record<string, string> = {
  IDLE: 'pause1', WALK: 'walk', RUN: 'run', ATTACK: 'b7a1', BLOCK: 'fblock',
  DIE: 'die', TALK: 'talk', SALUTE: 'salute', TAUNT: 'taunt',
};

function makePanel(visualCheck: boolean, candidateSelected: boolean): HTMLElement {
  document.getElementById('hud')?.classList.add('is-hidden');
  document.getElementById('questHud')?.classList.add('is-hidden');
  document.getElementById('debugOverlay')?.classList.add('is-hidden');
  document.getElementById('loadingOverlay')?.classList.add('is-hidden');
  const old = document.getElementById('missionVaoLabHud');
  old?.remove();
  const panel = document.createElement('section');
  panel.id = 'missionVaoLabHud';
  panel.setAttribute('aria-label', 'Mission Vao character lab');
  panel.innerHTML = `
    <style>
      #missionVaoLabHud{position:fixed;z-index:30;left:18px;top:18px;width:min(390px,calc(100vw - 36px));max-height:calc(100vh - 36px);overflow:auto;padding:16px 18px;color:#efe9dc;background:rgba(18,22,27,.92);border:1px solid rgba(224,176,100,.55);border-radius:10px;font:13px/1.4 system-ui,sans-serif;box-shadow:0 10px 36px #0008}
      #missionVaoLabHud h1{font-size:16px;letter-spacing:.08em;margin:0 0 8px;color:#f0c57d}#missionVaoLabHud p{margin:5px 0;color:#c9c5bd}
      #missionVaoLabHud .mvl-state{font:11px/1.5 ui-monospace,monospace;color:#c6d7cc;white-space:pre-wrap;margin:10px 0}
      #missionVaoLabHud .mvl-buttons{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin:10px 0}
      #missionVaoLabHud button,#missionVaoLabHud select{color:#f3eee5;background:#393832;border:1px solid #75664f;border-radius:5px;padding:7px 8px;cursor:pointer}
      #missionVaoLabHud button:hover{background:#65503a}#mvlVisualButtons button{min-height:40px;font-size:13px;font-weight:700}#missionVaoLabHud .mvl-row{display:flex;gap:8px;align-items:center;margin-top:7px}
      #missionVaoLabHud select{min-width:0;flex:1}#missionVaoLabHud label{display:flex;gap:7px;align-items:center;color:#dad4c9}
      #missionVaoLabHud .mvl-error{color:#ffb3a8}
      #mvlToggleHud{position:fixed;z-index:31;right:14px;bottom:14px;padding:9px 12px;color:#fff;background:#302b25;border:1px solid #b9945e;border-radius:6px;cursor:pointer}
      #missionVaoLabHud.is-hidden{display:none}
    </style>
    <h1>MISSION VAO · CHARACTER LAB</h1>
    <p>Blender 4.4 donor → GLB → Babylon</p>
    <div class="mvl-state" id="mvlStatus">Loading character…</div>
    <div class="mvl-buttons" id="mvlButtons"></div>
    <div class="mvl-row"><select id="mvlAllClips" aria-label="All animation clips"><option value="">All clips…</option></select><button id="mvlPlaySelected">Play</button></div>
    <section id="mvlVisualCheck" hidden><h2>W230.3O · RIGID FACE NODES · ${candidateSelected ? 'CANDIDATE' : 'BASELINE'}</h2><div class="mvl-buttons" id="mvlVisualButtons"></div></section>
    <h2>JEDI PROFILE · SINGLE LIGHTSABER</h2>
    <div class="mvl-buttons" id="mvlJediButtons"></div>
    <h2>FACE DEBUG</h2>
    <div class="mvl-buttons" id="mvlFaceButtons"></div>
    <div class="mvl-row"><label><input id="mvlLightsaber" type="checkbox"> Show DEV lightsaber (right-hand anchor)</label></div>
    <div class="mvl-row"><label><input id="mvlHooks" type="checkbox"> Show 11 hooks</label></div>
    <div class="mvl-row"><button id="mvlResetCamera">Reset camera</button></div>
    <p>Drag to orbit · Wheel to zoom · Body and facial tracks retain KOTOR names.</p>`;
  document.body.appendChild(panel);
  const toggle = document.createElement('button');
  toggle.id = 'mvlToggleHud';
  toggle.type = 'button';
  toggle.textContent = 'Hide controls';
  toggle.addEventListener('click', () => {
    const hidden = panel.classList.toggle('is-hidden');
    toggle.textContent = hidden ? 'Show controls' : 'Hide controls';
  });
  document.body.appendChild(toggle);
  return panel;
}

export async function startMissionVaoLab(): Promise<void> {
  const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement | null;
  if (!canvas) throw new Error('MISSION_VAO_LAB_CANVAS_MISSING');
  const visualCheck = new URLSearchParams(window.location.search).get('visualCheck') === '1';
  const candidateSelected = visualCheck;
  const GLB_NAME = candidateSelected ? CANDIDATE_GLB_NAME : BASELINE_GLB_NAME;
  const panel = makePanel(visualCheck, candidateSelected);
  const status = panel.querySelector<HTMLElement>('#mvlStatus')!;
  const buttons = panel.querySelector<HTMLElement>('#mvlButtons')!;
  const clipSelect = panel.querySelector<HTMLSelectElement>('#mvlAllClips')!;
  const showHooks = panel.querySelector<HTMLInputElement>('#mvlHooks')!;
  const showLightsaber = panel.querySelector<HTMLInputElement>('#mvlLightsaber')!;
  const visualButtons = panel.querySelector<HTMLElement>('#mvlVisualButtons')!;
  panel.querySelector<HTMLElement>('#mvlVisualCheck')!.hidden = !visualCheck;
  const jediButtons = panel.querySelector<HTMLElement>('#mvlJediButtons')!;
  const faceButtons = panel.querySelector<HTMLElement>('#mvlFaceButtons')!;
  const engine = new Engine(canvas, true, { antialias: true, preserveDrawingBuffer: true, stencil: true });
  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.075, 0.088, 0.105, 1);
  const camera = new ArcRotateCamera('MissionLabCamera', -Math.PI / 2, 1.18, 3.8, new Vector3(0, 0.9, 0), scene);
  camera.lowerRadiusLimit = 0.45;
  camera.minZ = 0.025;
  camera.upperRadiusLimit = 12;
  camera.wheelPrecision = 45;
  camera.attachControl(canvas, true);
  const hemi = new HemisphericLight('MissionLabHemi', new Vector3(-0.25, 1, -0.3), scene);
  hemi.intensity = 0.95;
  const key = new HemisphericLight('MissionLabFill', new Vector3(0.3, 0.4, 1), scene);
  key.intensity = 0.38;
  const floor = MeshBuilder.CreateGround('MissionLabFloor', { width: 20, height: 20 }, scene);
  const floorMat = new PBRMaterial('MissionLabFloorMaterial', scene);
  floorMat.albedoColor = new Color3(0.19, 0.2, 0.21);
  floorMat.roughness = 0.95;
  floorMat.metallic = 0;
  floor.material = floorMat;
  floor.isPickable = false;
  floor.receiveShadows = false;

  const state: LabState = {
    loaded: false, meshes: 0, transformNodes: 0, skeletons: [], animationGroups: [],
    currentAnimation: null, animationTime: null, height: null, hooksFound: [], loadMs: null,
    fpsApprox: null, materials: 0, textures: 0,
      lightsaberVisible: false, lightsaberHookParent: null, lightsaberHookWorldPosition: null, rightHandWorldPosition: null,
      weaponAnchorWorldPosition: null, saberBasisRotationXYZW: null, hierarchyDiagnostics: {}, gripMeasurements: {}, headAttachmentMeasurements: {},
    deflectHookParent: null, deflectHookWorldPosition: null, lightsaberAsset: null,
    lightsaberMeshCount: 0, lightsaberBounds: null, lightsaberImportedRoots: [],
    headAttachment: {}, faceTelemetry: {}, eyeAudit: {}, neckSeam: { method: 'evaluated skinned open-boundary curves; Blender world-space meters; 0/25/50/75/100% clip samples', sourceReport: 'docs/_audit_codex/w230_3m_neck_surface_seam.json', classification: 'SMALL_SOURCE_SEAM', clips: { pause1: { min: 0.050024, mean: 0.066295, max: 0.079126 }, walkss: { min: 0.055538, mean: 0.062925, max: 0.078170 }, runss: { min: 0.043258, mean: 0.058722, max: 0.081541 }, g2r1: { min: 0.036028, mean: 0.052115, max: 0.084736 }, c2a1: { min: 0.031359, mean: 0.056253, max: 0.089626 }, f2a1: { min: 0.039546, mean: 0.063441, max: 0.086676 }, die: { min: 0.040905, mean: 0.061546, max: 0.081155 } } }, talk: {}, pause1: {}, weaponGrip: {}, skeletonProbe: {},
  };
  window.__missionVaoLabState = state;
  const markers: Mesh[] = [];
  let groups: AnimationGroup[] = [];
  let updateSaberBounds = () => {};
  let refreshStatusForLoop: (() => void) | null = null;
  const loadStart = performance.now();
  try {
    state.eyeAudit = { candidateSelected, glbName: GLB_NAME, expectedEyeMeshes: ['eyeLA.001','eyeRA.001','eyeLlid.001','eyeRlid.001'], foundFacialMeshes: [], leftEyeVisible: 'UNVERIFIED', rightEyeVisible: 'UNVERIFIED', eyelidsVisible: 'UNVERIFIED' };
    const result = await SceneLoader.ImportMeshAsync('', GLB_ROOT, GLB_NAME, scene);
    state.loadMs = performance.now() - loadStart;
    state.meshes = result.meshes.filter((m) => m.getTotalVertices() > 0).length;
    state.transformNodes = result.transformNodes.length;
    state.skeletons = result.skeletons.map((s) => ({ name: s.name, joints: s.bones.length }));
    state.animationGroups = result.animationGroups.map((g) => g.name);
    state.materials = result.meshes.reduce((n, m) => n + (m.material ? 1 : 0), 0);
    state.textures = scene.textures.length;
    const bounds = result.meshes.filter((m) => m.getTotalVertices() > 0);
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const mesh of bounds) {
      mesh.computeWorldMatrix(true);
      const box = mesh.getBoundingInfo().boundingBox;
      minY = Math.min(minY, box.minimumWorld.y);
      maxY = Math.max(maxY, box.maximumWorld.y);
    }
    state.height = Number.isFinite(minY) && Number.isFinite(maxY) ? maxY - minY : null;
    const center = new Vector3(0, state.height ? state.height * 0.5 : 0.9, 0);
    camera.target.copyFrom(center);
    camera.radius = Math.max(2.5, (state.height ?? 1.8) * 2.1);
    const namedNodes = [...result.transformNodes, ...result.meshes];
    const bodySkeleton = result.skeletons.find((s) => s.name === 'Armature_P_HandmaidenBA');
    const headSkeleton = result.skeletons.find((s) => s.name === 'Armature_P_MissionH');
    state.skeletonProbe = { skeletons: result.skeletons.map((s) => ({ name: s.name, bones: s.bones.slice(0, 12).map((b) => ({ name: b.name, transformNode: b.getTransformNode()?.name ?? null })), requested: ['head_g','neck_g','rhand','rhand_g','necklwr_g.001','f_jaw_g.001','eyeLA','eyeRA'].map((name) => { const b=s.bones.find((bone) => bone.name === name); return { name, found: Boolean(b), transformNode: b?.getTransformNode()?.name ?? null }; }) })), nodeNames: result.transformNodes.filter((n) => /Armature_P_MissionH|Armature_P_HandmaidenBA|head_g|rhand|necklwr_g\.001/i.test(n.name)).map((n) => ({ name: n.name, parent: n.parent?.name ?? null })) };
    const linkedBoneNodes = new Map<string, TransformNode>();
    const boneNode = (skeleton: typeof bodySkeleton, name: string): TransformNode | null => {
      const bone = skeleton?.bones.find((item) => item.name === name);
      if (!bone) return namedNodes.find((node) => node.name === name && hasAncestor(node, skeleton?.name ?? '')) as TransformNode | undefined ?? null;
      const key = `${skeleton!.name}:${name}`;
      const cached = linkedBoneNodes.get(key); if (cached) return cached;
      let linked = bone.getTransformNode();
      if (!linked) { linked = new TransformNode(`MissionBoneRef_${key.replace(/[^a-zA-Z0-9_]/g, '_')}`, scene); bone.linkTransformNode(linked); }
      linkedBoneNodes.set(key, linked);
      return linked;
    };
    state.hooksFound = HOOK_NAMES.filter((name) => namedNodes.some((node) => node.name.toLowerCase() === name.toLowerCase()));
    const hookCandidates = (name: string) => namedNodes.filter((node) => node.name.toLowerCase() === name.toLowerCase());
    const hasAncestor = (node: TransformNode | Mesh, ancestorName: string): boolean => {
      let parent = node.parent;
      while (parent) {
        if (parent.name === ancestorName) return true;
        parent = parent.parent;
      }
      return false;
    };
    // GLB contains a duplicate non-animated body-hook node. The armature child is the one
    // targeted by the source animation channels (including LightsaberHook).
    const animatedHook = (name: string) => hookCandidates(name).find((node) => node.parent?.name === 'Armature_P_HandmaidenBA') ?? hookCandidates(name)[0];
    const sourceLightsaberHook = hookCandidates('LightsaberHook').find((node) => node.parent?.name === 'P_HandmaidenBA') ?? hookCandidates('LightsaberHook')[0];
    const lightsaberHook = animatedHook('LightsaberHook');
    const deflectHook = animatedHook('DeflectHook');
    const rightHand = namedNodes.find((node) => node.name === 'rhand' && node.parent?.name === 'rhand_g') ?? boneNode(bodySkeleton, 'rhand');
    const bodyHeadReference = namedNodes.find((node) => node.name === 'head_g' && node.parent?.name === 'Hturn_g') ?? boneNode(bodySkeleton, 'head_g');
    const bodyHeadHook = hookCandidates('headhook').find((node) => hasAncestor(node, 'Armature_P_HandmaidenBA')) ?? hookCandidates('headhook')[0];
    const headNeckRoot = namedNodes.find((node) => node.name === 'necklwr_g.001' && node.parent?.name === 'torsoUpr_g.001') ?? boneNode(headSkeleton, 'necklwr_g.001');
    const bodyNeck = namedNodes.find((node) => node.name === 'neck_g' && node.parent?.name === 'necklwr_g') ?? boneNode(bodySkeleton, 'neck_g');
    const headNeck = namedNodes.find((node) => node.name === 'neck_g' && node.parent?.name === 'necklwr_g.001') ?? boneNode(headSkeleton, 'neck_g');
    const headArmatureRoot = namedNodes.find((node) => node.name === 'Armature_P_MissionH');
    const headModelRoot = namedNodes.find((node) => node.name === 'P_MissionH');
    state.skeletonProbe = { ...state.skeletonProbe, resolvedNodes: { rightHand: rightHand?.name ?? null, rightHandParent: rightHand?.parent?.name ?? null, bodyHeadReference: bodyHeadReference?.name ?? null, bodyHeadParent: bodyHeadReference?.parent?.name ?? null, bodyHeadHook: bodyHeadHook?.name ?? null, headNeckRoot: headNeckRoot?.name ?? null, bodyNeck: bodyNeck?.name ?? null, headNeck: headNeck?.name ?? null, headArmatureRoot: headArmatureRoot?.name ?? null } };
    const hookWorldPosition = (node: TransformNode | Mesh | null | undefined): [number, number, number] | null => {
      if (!node) return null;
      node.computeWorldMatrix(true);
      const p = node.getAbsolutePosition();
      return [p.x, p.y, p.z];
    };
    state.lightsaberHookParent = lightsaberHook?.parent?.name ?? null;
    state.deflectHookParent = deflectHook?.parent?.name ?? null;
    state.lightsaberHookWorldPosition = hookWorldPosition(lightsaberHook);
    state.deflectHookWorldPosition = hookWorldPosition(deflectHook);
    state.loaded = true;
    const matrixSnapshot = (node: TransformNode | Mesh | null | undefined) => {
      if (!node) return null;
      node.computeWorldMatrix(true);
      const localRotation = node.rotationQuaternion ?? Quaternion.RotationYawPitchRoll(node.rotation.y, node.rotation.x, node.rotation.z);
      const local = Matrix.Compose(node.scaling, localRotation, node.position).m.map((value: number) => Number(value.toFixed(7)));
      const world = node.getWorldMatrix().m.map((value) => Number(value.toFixed(7)));
      const position = node.getAbsolutePosition();
      return { name: node.name, parent: node.parent?.name ?? null, nodeClass: node.getClassName(), matrixLocal: local, matrixWorld: world, position: [position.x, position.y, position.z] as [number, number, number] };
    };
    const absoluteRotation = (node: TransformNode | Mesh | null | undefined): Quaternion | null => {
      if (!node) return null;
      node.computeWorldMatrix(true);
      const rotation = new Quaternion();
      node.getWorldMatrix().decompose(undefined, rotation);
      return rotation;
    };
    const headOriginalParent = headArmatureRoot?.parent?.name ?? null;
    const headBindLocal = Matrix.Identity();
    if (headArmatureRoot) {
      const localRotation = headArmatureRoot.rotationQuaternion ?? Quaternion.RotationYawPitchRoll(headArmatureRoot.rotation.y, headArmatureRoot.rotation.x, headArmatureRoot.rotation.z);
      Matrix.ComposeToRef(headArmatureRoot.scaling, localRotation, headArmatureRoot.position, headBindLocal);
    }
    state.headAttachment = {
      method: 'SOURCE_BONE_PARENT_PRESERVED',
      bodyReference: bodyHeadReference?.name ?? null,
      headRigRoot: headArmatureRoot?.name ?? null,
      originalParent: headOriginalParent,
      sourceParentPreserved: Boolean(bodyHeadReference && headArmatureRoot?.parent === bodyHeadReference),
      bindTranslation: headArmatureRoot ? [headArmatureRoot.position.x, headArmatureRoot.position.y, headArmatureRoot.position.z] : null,
      bindQuaternionXYZW: headArmatureRoot ? [headArmatureRoot.rotationQuaternion?.x ?? 0, headArmatureRoot.rotationQuaternion?.y ?? 0, headArmatureRoot.rotationQuaternion?.z ?? 0, headArmatureRoot.rotationQuaternion?.w ?? 1] : null,
      bindScale: headArmatureRoot ? [headArmatureRoot.scaling.x, headArmatureRoot.scaling.y, headArmatureRoot.scaling.z] : null,
      anchorCreated: false,
    };
    const faceNames = ['f_jaw_g.001','f_Llm_g.001','f_Rlm_g.001','f_lmc_g.001','f_rmc_g.001','f_um_g.001','f_tonguetip_g.001','eyeLA','eyeRA','eyeLlid','eyeRlid','f_lbrw_g.001','f_mdbrw_g.001','f_rbrw_g.001'];
    const faceNodes = new Map(faceNames.map((name) => [name, boneNode(/^(eyeLA|eyeRA|eyeLlid|eyeRlid)$/i.test(name) ? bodySkeleton : headSkeleton, name)]));
    const faceBind = new Map([...faceNodes].map(([name, node]) => { node?.computeWorldMatrix(true); return [name, node ? { position: node.position.clone(), rotation: (node.rotationQuaternion ?? Quaternion.RotationYawPitchRoll(node.rotation.y,node.rotation.x,node.rotation.z)).clone() } : null] as const; }));
    state.eyeAudit = { ...state.eyeAudit, foundFacialMeshes: result.meshes.filter((mesh) => /^(eyeLA|eyeRA|eyeLlid|eyeRlid)/i.test(mesh.name)).map((mesh) => ({ name: mesh.name, vertices: mesh.getTotalVertices(), material: mesh.material?.name ?? null, visible: mesh.isVisible && mesh.isEnabled(), texture: mesh.material?.getActiveTextures().map((texture) => texture.name) ?? [] })), separateEyeMeshesInGlb: result.meshes.some((mesh) => /^(eyeLA|eyeRA)/i.test(mesh.name)), eyeJointNames: [...(bodySkeleton?.bones.map((b) => b.name) ?? []), ...(headSkeleton?.bones.map((b) => b.name) ?? [])].filter((name) => /^(eyeLA|eyeRA|eyeLlid|eyeRlid)$/i.test(name)), headAtlasTextureResolved: result.meshes.some((mesh) => /eyeLA|eyeRA|eyeLlid|eyeRlid/i.test(mesh.name) && Boolean(mesh.material?.getActiveTextures().length)), renderClassification: 'STRUCTURE_PRESENT_VISUAL_REVIEW_REQUIRED', sourceNote: 'Do not mark visible until close-up review confirms socket alignment and atlas appearance' };
    const eyeMaterialBackface = new Map<NonNullable<AbstractMesh['material']>, boolean>();
    for (const mesh of result.meshes) if (/^(eyeLA|eyeRA|eyeLlid|eyeRlid)/i.test(mesh.name) && mesh.material) eyeMaterialBackface.set(mesh.material, mesh.material.backFaceCulling);
    let eyeDoubleSidedDiagnostic = false;
    const headOcclusionTargets = result.meshes.filter((mesh) => /^head(?:\.\d+)?$/i.test(mesh.name) && mesh.getTotalVertices() > 0);
    const headVisibilityBaseline = new Map(headOcclusionTargets.map((mesh) => [mesh, mesh.isVisible] as const));
    let headOcclusionDiagnostic = false;
    state.eyeAudit = { ...state.eyeAudit, headOcclusionCandidates: headOcclusionTargets.map((mesh) => mesh.name) };
    const rigidFacialBindings = [
      ['eyeLA', 'eyeLA.001', 'EyeLRenderAnchor', 25],
      ['eyeRA', 'eyeRA.001', 'EyeRRenderAnchor', 27],
      ['eyeLlid', 'eyeLlid.001', 'EyeLidLRenderAnchor', 28],
      ['eyeRlid', 'eyeRlid.001', 'EyeLidRRenderAnchor', 26],
    ].map(([jointName, meshName, anchorName, sourceNodeId]) => {
      const anchor = namedNodes.find((node) => node.name === anchorName) as TransformNode | undefined;
      const mesh = result.meshes.find((item) => item.name === meshName);
      return { jointName: String(jointName), meshName: String(meshName), anchorName: String(anchorName), sourceNodeId: Number(sourceNodeId), anchor, mesh, parentName: anchor?.parent?.name ?? null };
    });
    const sampleRigidFacialBindings = () => {
      const samples = rigidFacialBindings.map(({ jointName, meshName, anchorName, sourceNodeId, anchor, mesh, parentName }) => {
        if (!anchor || !mesh || !anchor.parent) return { jointName, meshName, anchorName, sourceNodeId, parentName, valid: false };
        anchor.computeWorldMatrix(true); mesh.computeWorldMatrix(true);
        const localRotation = anchor.rotationQuaternion ?? Quaternion.RotationYawPitchRoll(anchor.rotation.y, anchor.rotation.x, anchor.rotation.z);
        const local = Matrix.Compose(anchor.scaling, localRotation, anchor.position);
        const expected = local.multiply(anchor.parent.getWorldMatrix());
        const actual = anchor.getWorldMatrix();
        const matrixMaxAbsError = Math.max(...expected.m.map((value, index) => Math.abs(value - actual.m[index])));
        const expectedPosition = expected.getTranslation();
        const actualPosition = anchor.getAbsolutePosition();
        const positionErrorM = Vector3.Distance(expectedPosition, actualPosition);
        const meshAnchorMatrixError = Math.max(...actual.m.map((value, index) => Math.abs(value - mesh.getWorldMatrix().m[index])));
        return { jointName, meshName, anchorName, sourceNodeId, parentName, meshParentName: mesh.parent?.name ?? null, valid: parentName === jointName && mesh.parent === anchor, positionErrorM, matrixMaxAbsError, meshAnchorMatrixError };
      });
      state.eyeAudit = { ...state.eyeAudit, rigidNodeFollow: { currentClip: state.currentAnimation, samples } };
    };
    state.faceTelemetry = { talk: {}, pause1: {} };
    const handBindRotation = absoluteRotation(rightHand);
    const hookBindRotation = absoluteRotation(lightsaberHook);
    const handToHookBasis = handBindRotation && hookBindRotation
      ? handBindRotation.conjugateInPlace().multiply(hookBindRotation).normalize()
      : Quaternion.Identity();
    state.saberBasisRotationXYZW = [handToHookBasis.x, handToHookBasis.y, handToHookBasis.z, handToHookBasis.w];
    state.hierarchyDiagnostics = {
      sourceLightsaberHook: matrixSnapshot(sourceLightsaberHook),
      animatedLightsaberHook: matrixSnapshot(lightsaberHook),
      deflectHook: matrixSnapshot(deflectHook),
      rightHand: matrixSnapshot(rightHand),
      bodyHeadHook: matrixSnapshot(bodyHeadHook),
      headNeckRoot: matrixSnapshot(headNeckRoot),
      bodyNeck: matrixSnapshot(bodyNeck),
      headNeck: matrixSnapshot(headNeck),
      headArmatureRoot: matrixSnapshot(headArmatureRoot),
      headModelRoot: matrixSnapshot(headModelRoot),
      weaponAnchor: null,
      saberBasisAdapter: null,
    };
    groups = result.animationGroups;
    for (const group of groups) {
      const option = document.createElement('option');
      option.value = group.name;
      option.textContent = group.name;
      clipSelect.appendChild(option);
    }
    for (const [label, clip] of Object.entries(animationMap)) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.addEventListener('click', () => playClip(clip));
      buttons.appendChild(button);
    }
    const animationMapJson = await fetch(GLB_ROOT + 'mission_animation_map.json').then((r) => r.ok ? r.json() : null).catch(() => null) as { clips?: Array<{ name?: string; loopCandidate?: boolean }> } | null;
    const loopByName = new Map((animationMapJson?.clips ?? []).map((clip) => [clip.name ?? '', Boolean(clip.loopCandidate)]));
    function freezeClip(name: string, percent: number): void {
      const group = groups.find((item) => item.name === name);
      if (!group) { state.error = 'Animation group not found: ' + name; refreshStatus(); return; }
      for (const item of groups) item.stop();
      group.start(false, 1);
      const frame = group.from + (group.to - group.from) * percent;
      group.goToFrame(frame);
      group.pause();
      state.currentAnimation = group.name;
      state.animationTime = (group.to - group.from) * percent / 30;
      state.faceTelemetry[name] = {};
      if (name === 'talk') state.talk = { activeClip: name, samples: 0, jawDelta: 0, lipDelta: 0, tongueDelta: 0 };
      if (name === 'pause1') state.pause1 = { activeClip: name, samples: 0, eyeDelta: 0, eyelidDelta: 0, browDelta: 0, jawDelta: 0 };
      refreshStatus();
    }
    function playClip(name: string, loopOverride?: boolean): void {
      const group = groups.find((item) => item.name === name);
      if (!group) { state.error = `Animation group not found: ${name}`; refreshStatus(); return; }
      for (const item of groups) item.stop();
      group.start(loopOverride ?? loopByName.get(name) ?? ['pause1', 'walk', 'run', 'walkss', 'runss', 'talk'].includes(name), 1);
      state.currentAnimation = group.name;
      state.faceTelemetry[name] = {};
      if (name === 'talk') state.talk = { activeClip: name, samples: 0, jawDelta: 0, lipDelta: 0, tongueDelta: 0 };
      if (name === 'pause1') state.pause1 = { activeClip: name, samples: 0, eyeDelta: 0, eyelidDelta: 0, browDelta: 0, jawDelta: 0 };
      state.animationTime = 0;
      state.gripMeasurements[name] = { sampleCount: 0, minHandToHilt: null, meanHandToHilt: null, maxHandToHilt: null, minHookToHand: null, meanHookToHand: null, maxHookToHand: null, minAnchorToHand: null, meanAnchorToHand: null, maxAnchorToHand: null, samples: [] };
      refreshStatus();
    }
    function refreshStatus(): void {
      const fps = engine.getFps();
      state.fpsApprox = Number.isFinite(fps) && fps > 0 ? fps : null;
      status.classList.toggle('mvl-error', Boolean(state.error));
      status.textContent = state.error ?? [
        `Loaded: ${state.loaded} · height: ${state.height?.toFixed(3) ?? 'n/a'} m`,
        `Meshes: ${state.meshes} · transform nodes: ${state.transformNodes}`,
        `Skeletons: ${state.skeletons.map((s) => `${s.name} (${s.joints})`).join(', ') || 'none'}`,
        `Animation groups: ${state.animationGroups.length} · current: ${state.currentAnimation ?? 'none'} @ ${state.animationTime?.toFixed(2) ?? '0.00'}s`,
        `Materials: ${scene.materials.length} · textures: ${state.textures} · hooks: ${state.hooksFound.length}/11`,
        `Lightsaber: ${state.lightsaberVisible ? state.lightsaberAsset ?? 'attached' : 'off'} · anchor: ${state.hierarchyDiagnostics.weaponAnchor?.parent ?? 'off'}`,
        `Saber meshes: ${state.lightsaberMeshCount} · roots: ${state.lightsaberImportedRoots.join(', ') || 'none'}`,
        `Saber world bounds: ${state.lightsaberBounds ? `${state.lightsaberBounds.min.map((v) => v.toFixed(2)).join(',')} → ${state.lightsaberBounds.max.map((v) => v.toFixed(2)).join(',')}` : 'n/a'}`,
        `Source hook world: ${state.hierarchyDiagnostics.sourceLightsaberHook?.position.map((v) => v.toFixed(3)).join(', ') ?? 'n/a'}`,
        `Animated hook world: ${state.lightsaberHookWorldPosition?.map((v) => v.toFixed(3)).join(', ') ?? 'n/a'} · rhand: ${state.rightHandWorldPosition?.map((v) => v.toFixed(3)).join(', ') ?? 'n/a'}`,
        `Hand→hilt: ${state.gripMeasurements[state.currentAnimation ?? '']?.meanHandToHilt?.toFixed(3) ?? 'n/a'} m mean · basis q: ${state.saberBasisRotationXYZW?.map((v) => v.toFixed(3)).join(', ') ?? 'n/a'}`,
        `Head bind error: ${String(state.headAttachment.currentPositionError ?? 'n/a')} m / ${String(state.headAttachment.currentAngularErrorRadians ?? 'n/a')} rad · neck seam (surface): ${String((state.neckSeam.clips as Record<string, { mean: number }> | undefined)?.[state.currentAnimation ?? '']?.mean ?? 'see sampled report') } m`,
        `Face pose ${state.currentAnimation ?? '—'}: jaw ${String(state.faceTelemetry[state.currentAnimation ?? '']?.TALK_JAW_DELTA ?? 'n/a')} · lip ${String(state.faceTelemetry[state.currentAnimation ?? '']?.TALK_LIP_DELTA ?? 'n/a')} · tongue ${String(state.faceTelemetry[state.currentAnimation ?? '']?.TALK_TONGUE_DELTA ?? 'n/a')} · eye ${String(state.faceTelemetry[state.currentAnimation ?? '']?.TALK_EYE_DELTA ?? 'n/a')} · lid ${String(state.faceTelemetry[state.currentAnimation ?? '']?.TALK_EYELID_DELTA ?? 'n/a')} · brow ${String(state.faceTelemetry[state.currentAnimation ?? '']?.TALK_BROW_DELTA ?? 'n/a')}`,
        `Pause1 pose: jaw ${String(state.faceTelemetry.pause1?.PAUSE1_JAW_DELTA ?? 'n/a')} · eye ${String(state.faceTelemetry.pause1?.PAUSE1_EYE_DELTA ?? 'n/a')} · lid ${String(state.faceTelemetry.pause1?.PAUSE1_EYELID_DELTA ?? 'n/a')} · brow ${String(state.faceTelemetry.pause1?.PAUSE1_BROW_DELTA ?? 'n/a')}`,
        `Eye GLB separate meshes: ${String(state.eyeAudit.separateEyeMeshesInGlb)} · atlas: ${String(state.eyeAudit.headAtlasTextureResolved)} · visual state: ${String(state.eyeAudit.renderClassification ?? 'pending review')}`,
        `Rigid facial anchors: ${JSON.stringify((state.eyeAudit.rigidNodeFollow as { samples?: unknown[] } | undefined)?.samples ?? [])}`,
        `Neck seam: ${String(state.neckSeam.classification ?? state.neckSeam.status)} · source: ${String(state.neckSeam.metric ?? 'surface samples')}`,
        `TALK facial deltas: jaw ${String(state.talk.jawDelta ?? 'n/a')} · lips ${String(state.talk.lipDelta ?? 'n/a')} · tongue ${String(state.talk.tongueDelta ?? 'n/a')}`,
        `PAUSE1 facial deltas: eye ${String(state.pause1.eyeDelta ?? 'n/a')} · lids ${String(state.pause1.eyelidDelta ?? 'n/a')} · brow ${String(state.pause1.browDelta ?? 'n/a')} · jaw ${String(state.pause1.jawDelta ?? 'n/a')}`,
        `Resolved rig nodes: hand ${String((state.skeletonProbe.resolvedNodes as Record<string, unknown> | undefined)?.rightHand ?? 'n/a')} · head ${String((state.skeletonProbe.resolvedNodes as Record<string, unknown> | undefined)?.headArmatureRoot ?? 'n/a')}`,
        `DeflectHook parent: ${state.deflectHookParent ?? 'missing'} · world: ${state.deflectHookWorldPosition?.map((v) => v.toFixed(3)).join(', ') ?? 'n/a'}`,
        `Load: ${state.loadMs?.toFixed(0) ?? '…'} ms · FPS: ${state.fpsApprox?.toFixed(1) ?? '…'}`,
      ].join('\n');
      window.__missionVaoLabState = { ...state };
    }
    refreshStatusForLoop = refreshStatus;
    const jediProfile = await fetch(GLB_ROOT + 'mission_jedi_animation_profile.json').then((r) => r.ok ? r.json() : null).catch(() => null) as {
      locomotion?: Record<string, string | null>;
      combat?: { ready?: string | null; attacks?: Array<{ clip: string; semantic: string }>; block?: string[]; parry?: string[]; deflect?: string[]; hit?: string[]; dodge?: string[]; death?: string[] };
      force?: { candidates?: string[] };
    } | null;
    if (visualCheck) {
      const manualClips: Array<[string, string | null]> = [['IDLE','pause1'],['WALK SS','walkss'],['RUN SS','runss'],['READY','g2r1'],['ATTACK 1','c2a1'],['ATTACK 2','f2a1'],['ATTACK 3','f2a2'],['PARRY','c2p1'],['DEFLECT','c2n1'],['TALK','talk'],['PAUSE1','pause1'],['DIE','die']];
      for (const [label, clip] of manualClips) { const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.disabled = !groups.some((group) => group.name === clip); if (clip) button.addEventListener('click', () => playClip(clip, ['pause1','talk','walkss','runss'].includes(clip))); visualButtons.appendChild(button); }
      for (const percent of [0, 25, 50, 75, 100]) {
        const freeze = document.createElement('button'); freeze.type='button'; freeze.textContent='FREEZE ' + percent + '%';
        freeze.addEventListener('click', () => freezeClip(state.currentAnimation === 'talk' ? 'talk' : 'pause1', percent / 100));
        visualButtons.appendChild(freeze);
      }
      const closeup = document.createElement('button'); closeup.type='button'; closeup.textContent='FACE CLOSEUP'; closeup.addEventListener('click', () => { camera.alpha=-Math.PI/2; camera.beta=1.48; camera.radius=0.82; camera.target.set(0,(state.height ?? 1.8)*0.88,0); }); visualButtons.appendChild(closeup);
      const saberToggle = document.createElement('button'); saberToggle.type='button'; saberToggle.textContent='LIGHTSABER'; saberToggle.addEventListener('click', () => { showLightsaber.checked=!showLightsaber.checked; showLightsaber.dispatchEvent(new Event('change')); }); visualButtons.appendChild(saberToggle);
      const hookToggle = document.createElement('button'); hookToggle.type='button'; hookToggle.textContent='SHOW HOOKS'; hookToggle.addEventListener('click', () => { showHooks.checked=!showHooks.checked; showHooks.dispatchEvent(new Event('change')); }); visualButtons.appendChild(hookToggle);
      const eyeCullToggle = document.createElement('button'); eyeCullToggle.type='button'; eyeCullToggle.textContent='EYE DOUBLE-SIDED TEST';
      eyeCullToggle.addEventListener('click', () => {
        eyeDoubleSidedDiagnostic = !eyeDoubleSidedDiagnostic;
        for (const [material, original] of eyeMaterialBackface) material.backFaceCulling = eyeDoubleSidedDiagnostic ? false : original;
        eyeCullToggle.textContent = eyeDoubleSidedDiagnostic ? 'RESTORE EYE CULLING' : 'EYE DOUBLE-SIDED TEST';
        state.eyeAudit = { ...state.eyeAudit, cullingDiagnostic: eyeDoubleSidedDiagnostic ? 'DOUBLE_SIDED_TEMPORARY' : 'SOURCE_SETTING_RESTORED' };
        refreshStatus();
      });
      visualButtons.appendChild(eyeCullToggle);
      const headOcclusionToggle = document.createElement('button'); headOcclusionToggle.type='button'; headOcclusionToggle.textContent='HEAD OCCLUSION TEST';
      headOcclusionToggle.addEventListener('click', () => {
        headOcclusionDiagnostic = !headOcclusionDiagnostic;
        for (const [mesh, original] of headVisibilityBaseline) mesh.isVisible = headOcclusionDiagnostic ? false : original;
        headOcclusionToggle.textContent = headOcclusionDiagnostic ? 'RESTORE HEAD MESHES' : 'HEAD OCCLUSION TEST';
        state.eyeAudit = { ...state.eyeAudit, headOcclusionDiagnostic: headOcclusionDiagnostic ? 'HEAD_SKIN_TEMPORARILY_HIDDEN' : 'SOURCE_VISIBILITY_RESTORED' };
        refreshStatus();
      });
      visualButtons.appendChild(headOcclusionToggle);

    }
    const semanticButtons: Array<[string, string | null]> = [
      ['JEDI IDLE', jediProfile?.locomotion?.idle ?? null], ['JEDI WALK', jediProfile?.locomotion?.walk ?? null],
      ['JEDI RUN', jediProfile?.locomotion?.run ?? null], ['COMBAT READY', jediProfile?.combat?.ready ?? null],
      ['ATTACK c2a1', 'c2a1'], ['ATTACK f2a1', 'f2a1'], ['ATTACK f2a2', 'f2a2'], ['ATTACK f2a3', 'f2a3'],
      ['BLOCK', jediProfile?.combat?.block?.[0] ?? null], ['PARRY c2p1', 'c2p1'], ['PARRY f2p1', 'f2p1'],
      ['DEFLECT c2n1', 'c2n1'], ['DEFLECT f2n1', 'f2n1'], ['HIT', jediProfile?.combat?.hit?.[0] ?? null],
      ['DODGE', jediProfile?.combat?.dodge?.[0] ?? null], ['FORCE CANDIDATE', jediProfile?.force?.candidates?.[0] ?? null],
      ['DEATH', jediProfile?.combat?.death?.[0] ?? null],
    ];
    for (const [label, clip] of semanticButtons) {
      const button = document.createElement('button');
      button.type = 'button'; button.textContent = clip ? `${label} · ${clip}` : `${label} · UNKNOWN`;
      button.disabled = !clip || !groups.some((group) => group.name === clip);
      button.title = clip ? `Validated mapping to KOTOR clip ${clip}` : 'No clip selected: evidence is insufficient';
      if (clip) button.addEventListener('click', () => playClip(clip));
      jediButtons.appendChild(button);
    }
    for (const [label, clip] of [['TALK LOOP','talk'], ['PAUSE1 LOOP','pause1']] as const) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.disabled = !groups.some((group) => group.name === clip); button.addEventListener('click', () => playClip(clip, true)); faceButtons.appendChild(button);
    }
    let weaponAnchor: TransformNode | null = null;
    let saberBasisAdapter: TransformNode | null = null;
    let saberRoot: TransformNode | null = null;
    let saberMeshes: AbstractMesh[] = [];
    async function setLightsaber(visible: boolean): Promise<void> {
      state.error = undefined;
      if (!visible) {
        weaponAnchor?.dispose(false, true); weaponAnchor = null; saberBasisAdapter = null; saberRoot = null; saberMeshes = [];
        state.lightsaberVisible = false; state.lightsaberAsset = null; state.lightsaberMeshCount = 0;
        state.lightsaberBounds = null; state.lightsaberImportedRoots = []; state.weaponAnchorWorldPosition = null;
        state.hierarchyDiagnostics.weaponAnchor = null; state.hierarchyDiagnostics.saberBasisAdapter = null; refreshStatus(); return;
      }
      if (!lightsaberHook || !rightHand) { state.error = !lightsaberHook ? 'LIGHTSABER_HOOK_NOT_FOUND' : 'RIGHT_HAND_NODE_NOT_FOUND'; refreshStatus(); return; }
      if (!saberRoot) {
        const loadedSaber = await SceneLoader.ImportMeshAsync('', '/assets/weapons/', 'mara_jade_lightsaber_grip_centered.glb', scene);
        weaponAnchor = new TransformNode('MissionWeaponAnchor', scene);
        weaponAnchor.parent = rightHand;
        weaponAnchor.position.set(0, 0, 0); weaponAnchor.rotation.set(0, 0, 0); weaponAnchor.scaling.setAll(1);
        saberBasisAdapter = new TransformNode('MissionSaberBasisAdapter', scene);
        saberBasisAdapter.parent = weaponAnchor;
        saberBasisAdapter.position.set(0, 0, 0); saberBasisAdapter.rotationQuaternion = handToHookBasis.clone(); saberBasisAdapter.scaling.setAll(1);
        saberRoot = new TransformNode('MissionSaberAssetRoot', scene);
        saberRoot.parent = saberBasisAdapter;
        // The saber asset's imported grip pivot is at its root. Scale is kept at 1:
        // its measured hilt is ~0.29 m; basis orientation comes from inverse(hand bind)*hook bind.
        saberRoot.position.set(0, 0, 0); saberRoot.rotation.set(0, 0, 0); saberRoot.scaling.setAll(1);
        const roots = [...loadedSaber.transformNodes, ...loadedSaber.meshes].filter((node) => {
          const parent = node.parent as unknown as { getClassName?: () => string } | null;
          return !node.parent || parent?.getClassName?.() === 'Scene';
        });
        state.lightsaberImportedRoots = roots.map((node) => node.name);
        for (const node of roots) node.parent = saberRoot;
        saberMeshes = loadedSaber.meshes.filter((mesh) => mesh.getTotalVertices() > 0);
        for (const mesh of saberMeshes) { mesh.isPickable = false; mesh.checkCollisions = false; }
        state.lightsaberMeshCount = saberMeshes.length;
        // The selected GLB is hilt-only. Its measured imported long axis is local +Z;
        // this simple DEV blade has no hitbox, damage, or gameplay ignition logic.
        const blade = MeshBuilder.CreateCylinder('MissionDevSaberBlade', { height: 1.0, diameter: 0.034, tessellation: 12 }, scene);
        blade.parent = saberRoot;
        blade.rotation.x = Math.PI * 0.5;
        blade.position.z = 0.5;
        blade.isPickable = false; blade.checkCollisions = false;
        const bladeMaterial = new StandardMaterial('MissionDevSaberBladeMaterial', scene);
        bladeMaterial.diffuseColor = new Color3(0.22, 0.55, 1);
        bladeMaterial.emissiveColor = new Color3(0.22, 0.55, 1);
        bladeMaterial.backFaceCulling = false;
        blade.material = bladeMaterial;
        state.lightsaberAsset = 'mara_jade_lightsaber_grip_centered.glb + 1 m DEV blade (rhand anchor; no combat)';
      }
      state.lightsaberVisible = true;
      updateSaberBounds();
      refreshStatus();
    }
    updateSaberBounds = (): void => {
      sampleRigidFacialBindings();
      state.lightsaberHookWorldPosition = hookWorldPosition(lightsaberHook);
      state.deflectHookWorldPosition = hookWorldPosition(deflectHook);
      state.rightHandWorldPosition = hookWorldPosition(rightHand);
      state.weaponAnchorWorldPosition = hookWorldPosition(weaponAnchor ?? undefined);
      state.hierarchyDiagnostics = {
        sourceLightsaberHook: matrixSnapshot(sourceLightsaberHook),
        animatedLightsaberHook: matrixSnapshot(lightsaberHook),
        deflectHook: matrixSnapshot(deflectHook),
        rightHand: matrixSnapshot(rightHand),
        weaponAnchor: matrixSnapshot(weaponAnchor ?? undefined),
        saberBasisAdapter: matrixSnapshot(saberBasisAdapter ?? undefined),
      };
      const min = new Vector3(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
      const max = new Vector3(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY);
      if (!saberMeshes.length) {
        state.lightsaberBounds = null;
      } else {
        for (const mesh of saberMeshes) {
          mesh.computeWorldMatrix(true);
          const box = mesh.getBoundingInfo().boundingBox;
          min.minimizeInPlace(box.minimumWorld); max.maximizeInPlace(box.maximumWorld);
        }
        state.lightsaberBounds = { min: [min.x, min.y, min.z], max: [max.x, max.y, max.z] };
      }
      if (state.lightsaberVisible && rightHand && weaponAnchor && state.currentAnimation) {
        const clip = state.currentAnimation;
        const metrics = state.gripMeasurements[clip] ??= { sampleCount: 0, minHandToHilt: null, meanHandToHilt: null, maxHandToHilt: null, minHookToHand: null, meanHookToHand: null, maxHookToHand: null, minAnchorToHand: null, meanAnchorToHand: null, maxAnchorToHand: null, samples: [] };
        const hand = rightHand.getAbsolutePosition();
        const hiltCenter = min.add(max).scale(0.5);
        const hook = lightsaberHook.getAbsolutePosition();
        const anchorPos = weaponAnchor.getAbsolutePosition();
        const handToHilt = Vector3.Distance(hand, hiltCenter);
        const hookToHand = Vector3.Distance(hand, hook);
        const anchorToHand = Vector3.Distance(hand, anchorPos);
        metrics.sampleCount += 1;
        const updateRange = (prefix: 'HandToHilt' | 'HookToHand' | 'AnchorToHand', value: number) => {
          const minKey = `min${prefix}` as 'minHandToHilt' | 'minHookToHand' | 'minAnchorToHand';
          const maxKey = `max${prefix}` as 'maxHandToHilt' | 'maxHookToHand' | 'maxAnchorToHand';
          const meanKey = `mean${prefix}` as 'meanHandToHilt' | 'meanHookToHand' | 'meanAnchorToHand';
          const previousMean = metrics[meanKey] ?? 0;
          metrics[minKey] = metrics[minKey] === null ? value : Math.min(metrics[minKey]!, value);
          metrics[maxKey] = metrics[maxKey] === null ? value : Math.max(metrics[maxKey]!, value);
          metrics[meanKey] = previousMean + (value - previousMean) / metrics.sampleCount;
        };
        updateRange('HandToHilt', handToHilt); updateRange('HookToHand', hookToHand); updateRange('AnchorToHand', anchorToHand);
        state.weaponGrip = { anchor: weaponAnchor.name, anchorParent: weaponAnchor.parent?.name ?? null, handToHiltDistance: handToHilt, anchorToHandDistance: anchorToHand, basisRotationXYZW: state.saberBasisRotationXYZW, currentClip: clip };
        if (metrics.samples.length < 32 && (metrics.samples.length === 0 || performance.now() - Number(metrics.samples[metrics.samples.length - 1].atMs) >= 80)) {
          metrics.samples.push({ atMs: performance.now(), handToHilt, hookToHand, anchorToHand, hand: [hand.x, hand.y, hand.z], hook: [hook.x, hook.y, hook.z], hiltCenter: [hiltCenter.x, hiltCenter.y, hiltCenter.z], rightHandMatrix: matrixSnapshot(rightHand)?.matrixWorld, animatedHookMatrix: matrixSnapshot(lightsaberHook)?.matrixWorld, anchorMatrix: matrixSnapshot(weaponAnchor)?.matrixWorld });
        }
      }
      if (state.currentAnimation && bodyHeadHook && headNeckRoot && bodyNeck && headNeck && headArmatureRoot) {
        const clip = state.currentAnimation;
        const metrics = state.headAttachmentMeasurements[clip] ??= {
          sampleCount: 0,
          bodyHeadHookToHeadRoot: { min: null, mean: null, max: null },
          bodyNeckToHeadNeck: { min: null, mean: null, max: null },
          headNeckRootToModelRoot: { min: null, mean: null, max: null },
          samples: [],
        };
        const bodyHookPos = bodyHeadHook.getAbsolutePosition();
        const headNeckRootPos = headNeckRoot.getAbsolutePosition();
        const bodyNeckPos = bodyNeck.getAbsolutePosition();
        const headNeckPos = headNeck.getAbsolutePosition();
        const headRootPos = headArmatureRoot.getAbsolutePosition();
        const record = (range: { min: number | null; mean: number | null; max: number | null }, value: number, count: number) => {
          range.min = range.min === null ? value : Math.min(range.min, value);
          range.max = range.max === null ? value : Math.max(range.max, value);
          range.mean = (range.mean ?? 0) + (value - (range.mean ?? 0)) / count;
        };
        metrics.sampleCount++;
        const hookGap = Vector3.Distance(bodyHookPos, headNeckRootPos);
        const neckGap = Vector3.Distance(bodyNeckPos, headNeckPos);
        const rootGap = Vector3.Distance(headNeckRootPos, headRootPos);
        record(metrics.bodyHeadHookToHeadRoot, hookGap, metrics.sampleCount);
        record(metrics.bodyNeckToHeadNeck, neckGap, metrics.sampleCount);
        record(metrics.headNeckRootToModelRoot, rootGap, metrics.sampleCount);
        if (metrics.samples.length < 32 && (metrics.samples.length === 0 || performance.now() - Number(metrics.samples[metrics.samples.length - 1].atMs) >= 80)) {
          metrics.samples.push({ atMs: performance.now(), bodyHeadHook: [bodyHookPos.x, bodyHookPos.y, bodyHookPos.z], headNeckRoot: [headNeckRootPos.x, headNeckRootPos.y, headNeckRootPos.z], bodyNeck: [bodyNeckPos.x, bodyNeckPos.y, bodyNeckPos.z], headNeck: [headNeckPos.x, headNeckPos.y, headNeckPos.z], headModelRoot: [headRootPos.x, headRootPos.y, headRootPos.z], bodyHeadHookToHeadRoot: hookGap, bodyNeckToHeadNeck: neckGap, headNeckRootToModelRoot: rootGap });
        }
      }
      if (bodyHeadReference && headArmatureRoot) {
        bodyHeadReference.computeWorldMatrix(true); headArmatureRoot.computeWorldMatrix(true);
        const expectedRootWorld = headBindLocal.multiply(bodyHeadReference.getWorldMatrix());
        const expectedPos = expectedRootWorld.getTranslation(); const actualPos = headArmatureRoot.getAbsolutePosition();
        const positionError = Vector3.Distance(expectedPos, actualPos);
        const expectedRot = new Quaternion(); expectedRootWorld.decompose(undefined, expectedRot);
        const actualRot = absoluteRotation(headArmatureRoot) ?? Quaternion.Identity();
        const angularError = 2 * Math.acos(Math.min(1, Math.abs(Quaternion.Dot(expectedRot, actualRot))));
        state.headAttachment = { ...state.headAttachment, currentPositionError: positionError, currentAngularErrorRadians: angularError, bodyReferenceWorld: matrixSnapshot(bodyHeadReference)?.matrixWorld ?? null, headRigWorld: matrixSnapshot(headArmatureRoot)?.matrixWorld ?? null };
      }
      if (state.currentAnimation) {
        const clip = state.currentAnimation; const telemetry = state.faceTelemetry[clip] ??= {};
        for (const [name, node] of faceNodes) {
          if (!node) continue; const bind = faceBind.get(name); if (!bind) continue;
          const posDelta = Vector3.Distance(node.position, bind.position);
          const rot = node.rotationQuaternion ?? Quaternion.RotationYawPitchRoll(node.rotation.y,node.rotation.x,node.rotation.z);
          const rotDelta = 2 * Math.acos(Math.min(1, Math.abs(Quaternion.Dot(rot, bind.rotation))));
          telemetry[name] = Math.max(telemetry[name] ?? 0, posDelta + rotDelta);
        }
        const pick = (...names: string[]) => Math.max(0, ...names.map((name) => telemetry[name] ?? 0));
        state.faceTelemetry[clip] = { ...telemetry };
        if (clip === 'talk') state.talk = { activeClip: clip, samples: state.talk.samples = Number(state.talk.samples ?? 0) + 1, jawDelta: pick('f_jaw_g.001'), lipDelta: pick('f_Llm_g.001','f_Rlm_g.001','f_lmc_g.001','f_rmc_g.001','f_um_g.001'), tongueDelta: pick('f_tonguetip_g.001') };
        if (clip === 'pause1') state.pause1 = { activeClip: clip, samples: state.pause1.samples = Number(state.pause1.samples ?? 0) + 1, jawDelta: pick('f_jaw_g.001'), eyeDelta: pick('eyeLA','eyeRA'), eyelidDelta: pick('eyeLlid','eyeRlid'), browDelta: pick('f_lbrw_g.001','f_mdbrw_g.001','f_rbrw_g.001') };
      }
    };
    showLightsaber.addEventListener('change', () => {
      void setLightsaber(showLightsaber.checked).then(() => {
        if (showHooks.checked) showHooks.dispatchEvent(new Event('change'));
      });
    });
    clipSelect.addEventListener('change', () => { state.error = undefined; refreshStatus(); });
    panel.querySelector<HTMLButtonElement>('#mvlPlaySelected')!.addEventListener('click', () => { if (clipSelect.value) playClip(clipSelect.value); });
    panel.querySelector<HTMLButtonElement>('#mvlResetCamera')!.addEventListener('click', () => {
      camera.alpha = -Math.PI / 2; camera.beta = 1.18; camera.radius = Math.max(2.5, (state.height ?? 1.8) * 2.1);
      camera.target.set(0, state.height ? state.height * 0.5 : 0.9, 0);
    });
    showHooks.addEventListener('change', () => {
      for (const marker of markers) marker.dispose();
      markers.length = 0;
      if (!showHooks.checked) return;
      for (const name of state.hooksFound) {
        const node = name === 'LightsaberHook' ? sourceLightsaberHook ?? lightsaberHook : namedNodes.find((n) => n.name.toLowerCase() === name.toLowerCase());
        if (!node) continue;
        const marker = MeshBuilder.CreateSphere(`MissionHookMarker_${name}`, { diameter: 0.055, segments: 6 }, scene);
        const material = new StandardMaterial(`MissionHookMarkerMat_${name}`, scene);
        material.emissiveColor = name === 'LightsaberHook' ? new Color3(1, 0.18, 0.08) : new Color3(1, 0.35, 0.05);
        marker.metadata = { diagnosticLabel: name === 'LightsaberHook' ? 'SOURCE_LIGHTSABER_HOOK_ROOT_CHILD' : name };
        marker.material = material;
        marker.parent = node;
        marker.position.set(0, 0, 0);
        marker.isPickable = false;
        marker.alwaysSelectAsActiveMesh = false;
        markers.push(marker);
      }
      if (lightsaberHook && sourceLightsaberHook !== lightsaberHook) {
        const marker = MeshBuilder.CreateSphere('MissionDiag_AnimatedLightsaberHook', { diameter: 0.055, segments: 6 }, scene);
        const material = new StandardMaterial('MissionDiag_AnimatedLightsaberHook_Material', scene);
        material.emissiveColor = new Color3(1, 0.68, 0.06); marker.material = material;
        marker.metadata = { diagnosticLabel: 'ANIMATED_LIGHTSABER_HOOK_JOINT' }; marker.parent = lightsaberHook; marker.position.set(0, 0, 0); marker.isPickable = false; markers.push(marker);
      }
      if (weaponAnchor) {
        const marker = MeshBuilder.CreateSphere('MissionDiag_MissionWeaponAnchor', { diameter: 0.075, segments: 8 }, scene);
        const material = new StandardMaterial('MissionDiag_MissionWeaponAnchor_Material', scene);
        material.emissiveColor = new Color3(0.1, 1, 0.25); marker.material = material;
        marker.metadata = { diagnosticLabel: 'MISSION_WEAPON_ANCHOR' }; marker.parent = weaponAnchor; marker.position.set(0, 0, 0); marker.isPickable = false; markers.push(marker);
      }
    });
    refreshStatus();
    if (groups.some((group) => group.name === 'pause1')) playClip('pause1');
    else if (groups.length) playClip(groups[0].name);
    updateSaberBounds();
    refreshStatus();
  } catch (error) {
    state.error = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error);
    status.classList.add('mvl-error');
    status.textContent = state.error;
  }
  let lastHudRefresh = 0;
  engine.runRenderLoop(() => {
    scene.render();
    const activeGroup = groups.find((group) => group.name === state.currentAnimation);
    if (activeGroup?.animatables.length) { const animatable = activeGroup.animatables[0]; const fpsRate = activeGroup.targetedAnimations[0]?.animation.framePerSecond ?? 1; state.animationTime = fpsRate > 0 ? animatable.masterFrame / fpsRate : null; }
    const fps = engine.getFps();
    if (Number.isFinite(fps) && fps > 0) { state.fpsApprox = fps; try { updateSaberBounds(); } catch (error) { state.error = `MISSION_LAB_FRAME_DIAGNOSTIC_ERROR: ${error instanceof Error ? error.stack ?? error.message : String(error)}`; status.classList.add('mvl-error'); status.textContent = state.error; } window.__missionVaoLabState = { ...state }; if (performance.now() - lastHudRefresh > 250) { lastHudRefresh = performance.now(); refreshStatusForLoop?.(); } }
  });
  window.addEventListener('resize', () => engine.resize());
}



