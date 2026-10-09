import {
  ArcRotateCamera,
  Color3,
  Color4,
  DirectionalLight,
  Engine,
  HemisphericLight,
  MeshBuilder,
  Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import { AssetLoader, ImportedAsset } from "../../assets/AssetLoader";

type DonorActor = { id: "CALEB" | "MEETRA"; asset: ImportedAsset; actorRoot: TransformNode; visualRoot: TransformNode; resetObserverCleanup: () => void };
type ClipTest = "REST_BOTH" | "CALEB_WALK_ONLY" | "MEETRA_WALK_ONLY" | "BOTH_WALK";

const DONORS = [
  { id: "CALEB" as const, path: "/_lab/jka/characters/aren/aren_caleb_jka_candidate_v0.glb", expectedSha256: "06681468976eb7ea4e53bb692bbcfbedaed0304ae23166b6117917103cd48215" },
  { id: "MEETRA" as const, path: "/_lab/jka/characters/nara/nara_meetra_jka_candidate_v0.glb", expectedSha256: "6f0c1da82fb569ad4a2f0d014ce8336e21f6b1d77fcfbb41bc0d1c7b51150f32" },
];
const WALK_CLIP = "BOTH_WALK1";
const IDLE_CLIP = "BOTH_STAND1";

async function sha256(path: string) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(`JKA_ISOLATION_ASSET_HTTP_${response.status}:${path}`);
  const digest = await crypto.subtle.digest("SHA-256", await response.arrayBuffer());
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join("");
}

export async function startJkaDonorIsolationLab() {
  const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
  if (!canvas) throw new Error("JKA_ISOLATION_CANVAS_MISSING");
  const params = new URLSearchParams(location.search);
  const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true, antialias: true });
  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.075, 0.095, 0.12, 1);
  const camera = new ArcRotateCamera("JkaIsolationCamera", -Math.PI / 2, 1.15, 6.5, new Vector3(0, 1, 0), scene);
  camera.lowerRadiusLimit = 2.2;
  camera.upperRadiusLimit = 14;
  camera.attachControl(canvas, true);
  new HemisphericLight("JkaIsolationHemi", new Vector3(0, 1, 0), scene).intensity = 0.78;
  const key = new DirectionalLight("JkaIsolationKey", new Vector3(-0.3, -1, 0.4), scene);
  key.position.set(2, 6, -3);
  key.intensity = 0.8;
  const floor = MeshBuilder.CreateGround("JkaIsolationFloor", { width: 18, height: 18 }, scene);
  const floorMaterial = new StandardMaterial("JkaIsolationFloorMaterial", scene);
  floorMaterial.diffuseColor = new Color3(0.19, 0.23, 0.26);
  floorMaterial.specularColor = Color3.Black();
  floor.material = floorMaterial;
  floor.isPickable = false;

  const loader = new AssetLoader();
  const actors: DonorActor[] = [];
  for (const donor of DONORS) {
    const actualSha256 = await sha256(donor.path);
    if (actualSha256 !== donor.expectedSha256) throw new Error(`${donor.id}_FULL_CANDIDATE_SHA256_MISMATCH:${actualSha256}`);
    const asset = await loader.load(donor.path, scene);
    const actorRoot = new TransformNode(`${donor.id}_IsolationActorRoot`, scene);
    actorRoot.position.x = donor.id === "CALEB" ? -1.2 : 1.2;
    actorRoot.metadata = { actorId: donor.id, role: "DIAGNOSTIC_ONLY", sourceAssetSha256: actualSha256 };
    const visualRoot = new TransformNode(`${donor.id}_IsolationVisualRoot`, scene);
    visualRoot.parent = actorRoot;
    asset.root.parent = visualRoot;
    asset.root.position.set(0, 0, 0);
    asset.setAnimatedRootsResetEnabled(params.get("jkaRootReset") !== "off");
    const resetObserverCleanup = asset.registerAnimatedRootResetObserver(scene, `JkaDonorIsolationLab:${donor.id}`);
    actors.push({ id: donor.id, asset, actorRoot, visualRoot, resetObserverCleanup });
  }

  const panel = document.createElement("div");
  panel.id = "jkaDonorIsolationPanel";
  panel.style.cssText = "position:fixed;left:14px;top:14px;z-index:80;width:min(510px,calc(100vw - 28px));padding:13px;background:#101922e8;color:#f3eedf;border:1px solid #8c7650;border-radius:8px;font:12px system-ui;box-shadow:0 8px 28px #0009";
  const heading = document.createElement("div");
  heading.textContent = "W237.2D.3 · TWO JKA ACTORS · NO CONTROLLERS";
  heading.style.cssText = "font-weight:700;font-size:14px;margin-bottom:9px";
  panel.appendChild(heading);
  const controls = document.createElement("div");
  controls.style.cssText = "display:flex;flex-wrap:wrap;gap:6px";
  panel.appendChild(controls);
  const output = document.createElement("pre");
  output.id = "jkaDonorIsolationTelemetry";
  output.style.cssText = "font:10px ui-monospace,Consolas,monospace;white-space:pre-wrap;max-height:34vh;overflow:auto;margin:10px 0 0";
  panel.appendChild(output);
  document.body.appendChild(panel);

  let resetEnabled = params.get("jkaRootReset") !== "off";
  let test: ClipTest = "REST_BOTH";
  let disposed = false;
  const groupFor = (actor: DonorActor, name: string) => actor.asset.animationGroups.find(group => group.name === name);
  const stop = (actor: DonorActor) => actor.asset.animationGroups.forEach(group => group.stop());
  const scheduleSnapshot = (actor: DonorActor, label: string) => actor.asset.requestAnimatedRootResetSnapshot(`${actor.id}_${label}`);
  const setTest = (next: ClipTest) => {
    actors.forEach(stop);
    test = next;
    if (next !== "REST_BOTH") {
      const caleb = actors.find(actor => actor.id === "CALEB")!;
      const meetra = actors.find(actor => actor.id === "MEETRA")!;
      const playWalk = (actor: DonorActor) => {
        const group = groupFor(actor, WALK_CLIP);
        if (!group) throw new Error(`${actor.id}_WALK_CLIP_MISSING:${WALK_CLIP}`);
        scheduleSnapshot(actor, "WALK");
        group.start(true, 1, group.from, group.to);
      };
      if (next === "CALEB_WALK_ONLY" || next === "BOTH_WALK") playWalk(caleb);
      else scheduleSnapshot(caleb, "REST");
      if (next === "MEETRA_WALK_ONLY" || next === "BOTH_WALK") playWalk(meetra);
      else scheduleSnapshot(meetra, "REST");
    } else {
      actors.forEach(actor => scheduleSnapshot(actor, "REST"));
    }
    publish();
  };
  const setRootReset = (enabled: boolean) => {
    resetEnabled = enabled;
    actors.forEach(actor => actor.asset.setAnimatedRootsResetEnabled(enabled));
    const url = new URL(location.href);
    url.searchParams.set("jkaRootReset", enabled ? "on" : "off");
    history.replaceState(null, "", url);
    resetButton.textContent = `ROOT RESET · ${enabled ? "ON" : "OFF"}`;
    publish();
  };
  const addButton = (label: string, action: () => void) => {
    const button = document.createElement("button");
    button.textContent = label;
    button.style.cssText = "border:1px solid #657f8a;border-radius:4px;background:#253847;color:white;padding:7px 9px;cursor:pointer;font:11px system-ui";
    button.onclick = action;
    controls.appendChild(button);
    return button;
  };
  addButton("REST BOTH", () => setTest("REST_BOTH"));
  addButton("CALEB WALK ONLY", () => setTest("CALEB_WALK_ONLY"));
  addButton("MEETRA WALK ONLY", () => setTest("MEETRA_WALK_ONLY"));
  addButton("BOTH WALK", () => setTest("BOTH_WALK"));
  const resetButton = addButton(`ROOT RESET · ${resetEnabled ? "ON" : "OFF"}`, () => setRootReset(!resetEnabled));
  addButton("FRONT", () => { camera.alpha = -Math.PI / 2; camera.beta = Math.PI / 2; publish(); });
  addButton("3/4", () => { camera.alpha = -Math.PI / 3; camera.beta = 1.15; publish(); });
  addButton("SIDE", () => { camera.alpha = 0; camera.beta = Math.PI / 2; publish(); });

  const targetSet = (actor: DonorActor) => new Set<any>([actor.asset.root, ...(actor.asset.root.getDescendants(false) as any[])]);
  const publish = () => {
    const rows = actors.map(actor => {
      const owned = targetSet(actor);
      const active = actor.asset.animationGroups.filter(group => group.isStarted && (group.isPlaying || (group as any).isPaused));
      const foreignTargetCount = actor.asset.animationGroups.reduce((count, group) => count + group.targetedAnimations.filter(row => !owned.has(row.target)).length, 0);
      const skeletons = [...new Set(actor.asset.meshes.map(mesh => mesh.skeleton).filter(Boolean))] as any[];
      return {
        id: actor.id,
        asset: DONORS.find(donor => donor.id === actor.id)!.path,
        assetSha256: actor.actorRoot.metadata?.sourceAssetSha256,
        importedAssetInstanceCount: 1,
        actorRootUniqueId: actor.actorRoot.uniqueId,
        visualRootUniqueId: actor.visualRoot.uniqueId,
        importedRootUniqueId: actor.asset.root.uniqueId,
        skeletonUniqueIds: skeletons.map(skeleton => skeleton.uniqueId),
        skeletonCount: skeletons.length,
        joints: skeletons.map(skeleton => skeleton.bones.length),
        animationGroupCount: actor.asset.animationGroups.length,
        activeGroupNames: active.map(group => group.name),
        activeAnimationGroupCount: active.length,
        activeAnimatableCount: active.reduce((count, group) => count + ((group as any).getAnimatables?.().length ?? (group as any)._animatables?.length ?? 0), 0),
        activeTargetCounts: active.map(group => ({ name: group.name, targets: group.targetedAnimations.length })),
        foreignTargetCount,
        reset: actor.asset.animatedRootResetDiagnostics(),
      };
    });
    const targetsByActor = actors.map(actor => new Set(actor.asset.animationGroups.flatMap(group => group.targetedAnimations.map(row => row.target))));
    const sharedAnimationTargetCount = [...targetsByActor[0]].filter(target => targetsByActor[1].has(target)).length;
    const state = {
      test, resetEnabled, browserAnimationGroupsTotal: scene.animationGroups.length,
      sharedAnimationTargetCount, actors: Object.fromEntries(rows.map(row => [row.id, row])),
      selectedFrames: Object.fromEntries(actors.map(actor => [actor.id, actor.asset.animatedRootResetDiagnostics().latestSnapshot])),
      mode: "BARE_BABYLON_TWO_ACTOR_SCENE_NO_ACADEMY_NO_NAV_NO_PARTY_NO_SABER_NO_CONTROLLER",
    };
    (window as any).__w2372D2Isolation = state;
    output.textContent = JSON.stringify(state, null, 2);
    return state;
  };
  setTest("REST_BOTH");
  const resize = () => engine.resize();
  window.addEventListener("resize", resize);
  const render = () => { scene.render(); };
  engine.runRenderLoop(render);
  document.getElementById("loadingOverlay")?.classList.add("is-hidden");
  return {
    state: publish,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      engine.stopRenderLoop(render);
      window.removeEventListener("resize", resize);
      actors.forEach(actor => { actor.resetObserverCleanup(); actor.asset.root.parent = null; actor.asset.dispose(); actor.visualRoot.dispose(); actor.actorRoot.dispose(); });
      scene.dispose(); engine.dispose(); panel.remove();
    },
  };
}
