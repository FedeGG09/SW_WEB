import {
  AbstractMesh, Color3, Color4, Engine, Matrix, Mesh, MeshBuilder, Quaternion, Scene, SceneLoader, StandardMaterial, TransformNode, Vector3,
} from "@babylonjs/core";
import "@babylonjs/loaders/glTF";
import { AssetLoader, type ImportedAsset } from "../../assets/AssetLoader";
import { CharacterPresentationLighting } from "../../player/CharacterPresentationLighting";
import { PLAYER_CHARACTERS } from "../../player/PlayerCharacterConfig";
import { WeaponAttachment, type NativeJkaWeaponDefinition } from "../../player/WeaponAttachment";
import { SaberTraceController, type SaberSphereTarget } from "../../combat/SaberTraceController";
import { SaberTrainingTarget } from "../../combat/SaberTrainingTarget";
import { SaberParryController, type SaberParryState } from "../../combat/SaberParryController";
import { type BladeSegment, SaberClashDetector } from "../../combat/SaberClashDetector";
import { classifyIncomingStrike, type SaberParryDirection, type SaberParryDirectionResult } from "../../combat/SaberParryDirectionClassifier";
import { JKA_NATIVE_COMBO_WINDOW, JkaNativeComboStateMachine } from "../../combat/JkaNativeComboStateMachine";
import { alignVisualFeetToGround, measureSkinnedFootSoles, measureVisualBounds } from "../../world/CharacterGrounding";
import { EbonHawkPartyAdapter, type EboHit, type EboNav } from "./EbonHawkPartyAdapter";
import { TacticalPauseController } from "../../party/TacticalPauseController";
import { applyJediEnclaveMaterials, clearJediEnclaveMaterialRuntimeCaches } from "./JediEnclaveMaterialPipeline";
import { HostileMercenaryTarget } from "../../combat/HostileMercenaryTarget";
import { HOSTILE_MERCENARY_JKA_V1 } from "../../party/tactical/HostileMercenaryProfile";
import { BlasterWeaponAttachment } from "../../combat/BlasterWeaponAttachment";
import { BlasterProjectileActor, createSceneWorldHitTest } from "../../combat/BlasterProjectile";
import { SingleBlasterFireController } from "../../combat/SingleBlasterFireController";
import { SaberProjectileInterceptor } from "../../combat/SaberProjectileInterceptor";

const BASE = "/_lab/kotor/worlds/jedi_enclave/";
type Point = [number, number, number];
type Face = { face: number; vertices: [Point, Point, Point]; walkability: string; material: string; transitions: Array<number | null> };
type NavRoom = { resref: string; faces: Face[]; validEmpty?: boolean };
type PthNode = { id: number; position: Point; room: string; wokFace: number; projection: string };
type PthEdge = { from: number; to: number; fromRoom: string; toRoom: string; distance: number; transitionType: string; nearestDoor?: { id: string; distanceXY: number } | null };
type SourceWokEdge = { faceIndex: number; edge: number; targetRoomIndex: number; targetRoom: string };
type JediNav = { rooms: NavRoom[]; pth: PthNode[]; pthEdges: PthEdge[]; roomLinks: Array<{ fromRoom: string; toRoom: string; sourceEdgesAB?: SourceWokEdge[]; sourceEdgesBA?: SourceWokEdge[]; nearestDoor?: { id: string; distanceXY: number } | null; classification?: string }>; doors: any[]; visibility: Record<string, string[]> };
type JediWorld = { rooms: Array<{ resref: string; renderable: boolean; renderBounds: { min: Point; max: Point } | null }>; doors: any[]; waypoints: any[]; externalTransitions?: any[] };
type Bounds = { min: Vector3; max: Vector3 };
const toB = (p: Point) => new Vector3(p[0], p[2], -p[1]);
const fromB = (p: Vector3): Point => [p.x, -p.z, p.y];
const dist2 = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// DEV-only, pose-aware mesh-floor measurement. Babylon's default mesh bounds
// describe bind-pose geometry; getPositionData(applySkeleton=true) includes the
// current evaluated skeleton pose without changing the mesh or its GLB data.
function measurePoseBounds(meshes: AbstractMesh[]) {
  let minY = Number.POSITIVE_INFINITY, maxY = Number.NEGATIVE_INFINITY;
  const perMesh: Array<{ name: string; minY: number; maxY: number; vertices: number; skinned: boolean }> = [];
  for (const mesh of meshes) {
    if (!mesh.isEnabled()) continue;
    mesh.computeWorldMatrix(true);
    const data = (mesh as any).getPositionData?.(Boolean(mesh.skeleton), false) ?? mesh.getVerticesData("position");
    if (!data || data.length < 3) continue;
    const world = mesh.getWorldMatrix();
    let meshMinY = Number.POSITIVE_INFINITY, meshMaxY = Number.NEGATIVE_INFINITY;
    for (let i = 0; i + 2 < data.length; i += 3) {
      const y = Vector3.TransformCoordinates(new Vector3(data[i], data[i + 1], data[i + 2]), world).y;
      meshMinY = Math.min(meshMinY, y); meshMaxY = Math.max(meshMaxY, y);
    }
    if (Number.isFinite(meshMinY)) {
      minY = Math.min(minY, meshMinY); maxY = Math.max(maxY, meshMaxY);
      perMesh.push({ name: mesh.name, minY: meshMinY, maxY: meshMaxY, vertices: data.length / 3, skinned: Boolean(mesh.skeleton) });
    }
  }
  if (!Number.isFinite(minY)) return { minY: null, maxY: null, height: null, meshes: [] as typeof perMesh };
  return { minY, maxY, height: maxY - minY, meshes: perMesh.sort((a, b) => a.minY - b.minY).slice(0, 5) };
}

function heightAt(x: number, y: number, f: Face): number | null {
  const [a, b, c] = f.vertices, den = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
  if (Math.abs(den) < 1e-9) return null;
  const u = ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (y - c[1])) / den;
  const v = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1])) / den, w = 1 - u - v;
  return Math.min(u, v, w) < -1e-6 ? null : u * a[2] + v * b[2] + w * c[2];
}
function closest2(x: number, y: number, a: Point, b: Point) {
  const dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy;
  const t = l ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l)) : 0;
  return { x: a[0] + dx * t, y: a[1] + dy * t, t };
}
function projectFace(x: number, y: number, f: Face) {
  const h = heightAt(x, y, f);
  if (h != null) return { p: [x, y, h] as Point, d: 0 };
  let best: { p: Point; d: number } | null = null;
  const v = f.vertices;
  for (const [a, b] of [[v[0], v[1]], [v[1], v[2]], [v[2], v[0]]] as Array<[Point, Point]>) {
    const q = closest2(x, y, a, b), p: Point = [q.x, q.y, a[2] + (b[2] - a[2]) * q.t], d = Math.hypot(x - q.x, y - q.y);
    if (!best || d < best.d) best = { p, d };
  }
  return best!;
}
function resolve(p: Point, nav: JediNav, walkOnly: boolean, maxH = Infinity, maxV = Infinity, allowedRooms?: string[]): EboHit | null {
  let best: EboHit | null = null;
  const allowed = allowedRooms ? new Set(allowedRooms.map(r => r.toLowerCase())) : null;
  for (const room of nav.rooms) {
    if (allowed && !allowed.has(room.resref.toLowerCase())) continue;
    for (const f of room.faces) {
      if (walkOnly && f.walkability !== "WALKABLE") continue;
      const q = projectFace(p[0], p[1], f), dv = Math.abs(q.p[2] - p[2]);
      if (q.d > maxH || dv > maxV) continue;
      if (!best || q.d < best.dist || (q.d === best.dist && dv < Math.abs(best.height - p[2]))) {
        best = { room: room.resref, face: f.face, material: f.material, height: q.p[2], walkability: f.walkability, point: q.p, dist: q.d };
      }
    }
  }
  return best;
}
function asPartyNav(nav: JediNav, doors: any[]): EboNav {
  const byId = new Map(nav.pth.map(n => [n.id, n]));
  const roomByName = new Map(nav.rooms.map(r => [r.resref.toLowerCase(), r]));
  const edgeMidpoints = (roomName: string, sourceEdges: SourceWokEdge[] | undefined) => {
    const room = roomByName.get(roomName.toLowerCase());
    if (!room) return [];
    return (sourceEdges ?? []).flatMap(sourceEdge => {
      const face = room.faces.find(f => f.face === sourceEdge.faceIndex);
      if (!face || face.vertices.length < 2) return [];
      // GFF WOK edge indices are one-based: edge 1 joins triangle vertices 0 and 1.
      const i = ((sourceEdge.edge - 1) % face.vertices.length + face.vertices.length) % face.vertices.length;
      const a = face.vertices[i], b = face.vertices[(i + 1) % face.vertices.length];
      const midpoint: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
      const centroid: Point = face.vertices.reduce((sum, p) => sum.map((v, axis) => v + p[axis]) as Point, [0, 0, 0] as Point).map(v => v / face.vertices.length) as Point;
      return [{ midpoint, faceCenter: centroid, edgeNormal: [-(b[1] - a[1]), b[0] - a[0]] as [number, number] }];
    });
  };
  const edges = nav.roomLinks.flatMap(link => {
    const pairs = [
      { from: link.fromRoom, to: link.toRoom, sourceEdges: link.sourceEdgesAB, targetEdges: link.sourceEdgesBA },
      { from: link.toRoom, to: link.fromRoom, sourceEdges: link.sourceEdgesBA, targetEdges: link.sourceEdgesAB },
    ];
    return pairs.flatMap(pair => {
      const midpoints = edgeMidpoints(pair.from, pair.sourceEdges);
      const targetEdges = edgeMidpoints(pair.to, pair.targetEdges);
      const door = link.nearestDoor, sourceDoor = door ? doors.find(d => d.instanceId === door.id) : null;
      return midpoints.map(({ midpoint, faceCenter, edgeNormal }) => {
        const targetFace = targetEdges.slice().sort((a, b) => dist2(a.midpoint, midpoint) - dist2(b.midpoint, midpoint))[0];
        let crossingDirection: [number, number] | undefined;
        if (targetFace && dist2(targetFace.midpoint, midpoint) <= 0.05) {
          const towardTarget = [targetFace.faceCenter[0] - midpoint[0], targetFace.faceCenter[1] - midpoint[1]];
          const sign = towardTarget[0] * edgeNormal[0] + towardTarget[1] * edgeNormal[1] >= 0 ? 1 : -1;
          crossingDirection = [edgeNormal[0] * sign, edgeNormal[1] * sign];
        }
        return {
        connectionType: link.classification ?? "SOURCE_WOK_ROOM_LINK",
        directedEvidence: [{ from: pair.from, to: pair.to, transitionEdges: [{ midpoint, crossingDirection }] }],
        evidence: [{ transitionMidpoint: midpoint, nearestGitDoor: door ? { id: door.id, tag: sourceDoor?.tag ?? "", distance: door.distanceXY } : null }],
        };
      });
    });
  });
  const nodeRows = nav.pth.map(n => ({
    id: n.id, position: n.position,
    projection: { status: n.projection === "UNIQUE_ROOM" ? "PROJECTED" : "UNPROJECTED", room: n.room, height: n.position[2] },
    connections: nav.pthEdges.filter(e => e.from === n.id).map(e => e.to),
  }));
  return { rooms: nav.rooms.map(r => ({ resref: r.resref, faces: r.faces })), pth: nodeRows, doors, roomAdjacency: { edges } };
}
function reachableRoomOrder(nav: JediNav, startRoom: string) {
  const walkable = new Set(nav.rooms.filter(r => r.faces.some(f => f.walkability === "WALKABLE") && nav.pth.some(n => n.room === r.resref && n.projection === "UNIQUE_ROOM")).map(r => r.resref));
  const links = new Map<string, Set<string>>();
  for (const room of walkable) links.set(room, new Set());
  for (const edge of nav.roomLinks) if (walkable.has(edge.fromRoom) && walkable.has(edge.toRoom)) {
    links.get(edge.fromRoom)?.add(edge.toRoom); links.get(edge.toRoom)?.add(edge.fromRoom);
  }
  const order: string[] = [], seen = new Set<string>([startRoom]), queue = [startRoom];
  while (queue.length) {
    const room = queue.shift()!;
    if (walkable.has(room)) order.push(room);
    for (const next of [...(links.get(room) ?? [])].sort()) if (!seen.has(next)) { seen.add(next); queue.push(next); }
  }
  return { walkableRooms: [...walkable].sort(), reachableRooms: order, unreachableRooms: [...walkable].filter(r => !seen.has(r)).sort() };
}
function sourceBoundaryClearance(nav: JediNav, roomName: string, point: Point) {
  const room = nav.rooms.find(r => r.resref.toLowerCase() === roomName.toLowerCase());
  if (!room) return -Infinity;
  const segments: Array<[Point, Point]> = [];
  for (const link of nav.roomLinks) {
    const sourceEdges = link.fromRoom.toLowerCase() === roomName.toLowerCase() ? link.sourceEdgesAB :
      link.toRoom.toLowerCase() === roomName.toLowerCase() ? link.sourceEdgesBA : undefined;
    for (const sourceEdge of sourceEdges ?? []) {
      const face = room.faces.find(f => f.face === sourceEdge.faceIndex);
      if (!face) continue;
      const index = ((sourceEdge.edge - 1) % face.vertices.length + face.vertices.length) % face.vertices.length;
      segments.push([face.vertices[index], face.vertices[(index + 1) % face.vertices.length]]);
    }
  }
  if (!segments.length) return Infinity;
  const distances = segments.map(([a, b]) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], length2 = dx * dx + dy * dy;
    const t = length2 ? Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / length2)) : 0;
    return Math.hypot(point[0] - (a[0] + dx * t), point[1] - (a[1] + dy * t));
  });
  return Math.min(...distances);
}
function projectPthNodeToSourceWok(nav: JediNav, node: PthNode): EboHit | null {
  const room = nav.rooms.find(r => r.resref.toLowerCase() === node.room.toLowerCase());
  const face = room?.faces.find(f => f.face === node.wokFace);
  if (!room || !face || face.walkability !== "WALKABLE") return null;
  const projected = projectFace(node.position[0], node.position[1], face);
  if (projected.d > 0.7) return null;
  return { room: room.resref, face: face.face, material: face.material, height: projected.p[2], walkability: face.walkability, point: projected.p, dist: projected.d };
}
async function sha256Asset(url: string) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error("LEADER_LOAD_GATE_FAIL: ASSET_HTTP_" + response.status);
  const bytes = await response.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join("");
}

function createJkaAnimationOwnershipAudit(asset: ImportedAsset) {
  const importedHierarchy = new Set<any>([asset.root, ...asset.root.getDescendants(false), ...asset.meshes]);
  const skeletons = [...new Set(asset.meshes.map(mesh => mesh.skeleton).filter(Boolean))] as any[];
  for (const skeleton of skeletons) {
    importedHierarchy.add(skeleton);
    for (const bone of skeleton.bones) {
      importedHierarchy.add(bone);
      const transformNode = bone.getTransformNode?.();
      if (transformNode) importedHierarchy.add(transformNode);
    }
  }
  const targetRows = asset.animationGroups.flatMap(group =>
    group.targetedAnimations.map(row => ({ groupName: group.name, target: row.target })));
  const targetObjects = new Set<any>(targetRows.map(row => row.target));
  const foreignTargetRows = targetRows.filter(row => !importedHierarchy.has(row.target));
  return {
    targetRows,
    targetObjects,
    foreignTargetRows,
    runtime(otherCandidateTargets: Set<any> | null) {
      const activeGroups = asset.animationGroups.filter(group =>
        group.isStarted && (group.isPlaying || (group as any).isPaused));
      const activeAnimatables = activeGroups.flatMap(group =>
        (group as any).getAnimatables?.() ?? (group as any)._animatables ?? []);
      return {
        allAnimationTargets: targetRows.map(row => ({
          group: row.groupName,
          targetName: row.target?.name ?? null,
          targetUniqueId: row.target?.uniqueId ?? null,
          insideImportedAsset: importedHierarchy.has(row.target),
          sharedWithOtherJkaActor: otherCandidateTargets?.has(row.target) ?? false,
        })),
        animationTargetCount: targetObjects.size,
        importedHierarchyTargetCount: targetRows.filter(row => importedHierarchy.has(row.target)).length,
        foreignTargetCount: foreignTargetRows.length,
        foreignTargets: foreignTargetRows.map(row => ({
          group: row.groupName,
          targetName: row.target?.name ?? null,
          targetUniqueId: row.target?.uniqueId ?? null,
        })),
        activeGroupNames: activeGroups.map(group => group.name),
        activeAnimationGroupCount: activeGroups.length,
        activeAnimatableCount: activeAnimatables.length,
        activeGroups: activeGroups.map(group => ({
          name: group.name,
          targetCount: group.targetedAnimations.length,
          animatableCount: ((group as any).getAnimatables?.() ?? (group as any)._animatables ?? []).length,
        })),
      };
    },
  };
}
export async function startJediAcademyPartyLab() {
  document.querySelectorAll("#hud,#questHud,#interactionPrompt,#dialogueOverlay,#fadeOverlay,#debugOverlay,#loadingOverlay,#errorOverlay").forEach(n => n.classList.add("is-hidden"));
  const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
  const priorCanvasStyle = canvas.getAttribute("style");
  canvas.style.cssText = "position:fixed;inset:0;width:100vw;height:100vh;z-index:1;touch-action:none";
  const errors: string[] = [];
  const onError = (event: ErrorEvent) => errors.push(event.message);
  const onRejection = (event: PromiseRejectionEvent) => errors.push(String(event.reason));
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true, adaptToDeviceRatio: true });
  const scene = new Scene(engine);
  scene.useRightHandedSystem = true;
  scene.clearColor = new Color4(.025, .035, .045, 1);
  const [world, nav, materials] = await Promise.all([
    fetch(BASE + "jedi_enclave_world.json").then(r => { if (!r.ok) throw new Error("JEDI_WORLD_HTTP_" + r.status); return r.json() as Promise<JediWorld>; }),
    fetch(BASE + "jedi_enclave_navigation.json").then(r => { if (!r.ok) throw new Error("JEDI_NAV_HTTP_" + r.status); return r.json() as Promise<JediNav>; }),
    fetch(BASE + "jedi_enclave_materials.json").then(r => { if (!r.ok) throw new Error("JEDI_MATERIALS_HTTP_" + r.status); return r.json() as Promise<{ meshes: any[] }>; }),
  ]);
  const loaded = await SceneLoader.ImportMeshAsync("", BASE, "jedi_enclave_danm13_kotor1.glb", scene);
  const render = loaded.meshes.filter(m => m.getTotalVertices() > 0) as Mesh[];
  const materialStats = applyJediEnclaveMaterials(render, materials, { rows: materials.meshes }, scene, 3);
  const byRoom = new Map<string, Mesh[]>();
  for (const mesh of render) {
    const match = /^Room_(m13aa_[a-z0-9]+)::/i.exec(mesh.name);
    if (!match) continue;
    const name = match[1].toLowerCase();
    byRoom.set(name, [...(byRoom.get(name) ?? []), mesh]);
  }
  const semanticBounds: Bounds[] = [];
  for (const meshes of byRoom.values()) {
    let min = new Vector3(Infinity, Infinity, Infinity), max = new Vector3(-Infinity, -Infinity, -Infinity);
    for (const mesh of meshes) {
      mesh.computeWorldMatrix(true);
      const box = mesh.getBoundingInfo().boundingBox;
      min = Vector3.Minimize(min, box.minimumWorld); max = Vector3.Maximize(max, box.maximumWorld);
    }
    semanticBounds.push({ min, max });
  }
  const entry = [94.104774, 43.660042, 4.486984] as Point;
  const spawn = resolve(entry, nav, true, 3, 1.25, ["m13aa_04a"]);
  if (!spawn || spawn.face !== 26) throw new Error("W237_1_SOURCE_ENTRY_SPAWN_UNRESOLVED_FACE_26");
  const roomCoverage = reachableRoomOrder(nav, "m13aa_04a");
  const patioDoor = world.doors.find(d => d.instanceId === "danm13:doors:003") ?? null;
  const partyNav = asPartyNav(nav, world.doors);
  const pageParams = new URLSearchParams(location.search);
  const jkaParryLabMode = import.meta.env.DEV && pageParams.get("jkaParryLab") === "1";
  const jkaControlSwapMode = import.meta.env.DEV && pageParams.get("jkaControlSwap") === "1";
  const jkaHostileMode = import.meta.env.DEV && pageParams.get("jkaHostile") === "1";
  const jkaReverseParryLabMode = jkaParryLabMode && pageParams.get("jkaParryDirection")?.toLowerCase() === "jolee-to-rosh";
  const requestedJkaWeapon = pageParams.get("jkaWeapon")?.toLowerCase();
  const nativeJkaSaberSelected = requestedJkaWeapon === "native" || jkaParryLabMode;
  const requestedGripInspect = import.meta.env.DEV ? pageParams.get("jkaGripInspect")?.toLowerCase() ?? null : null;
  const supportedGripInspectPoses = ["ready", "attack1_start", "attack1", "combo_transition", "attack2", "attack2_return", "final_ready"] as const;
  const gripInspectPose = requestedGripInspect && (supportedGripInspectPoses as readonly string[]).includes(requestedGripInspect)
    ? requestedGripInspect as typeof supportedGripInspectPoses[number]
    : null;
  if (requestedGripInspect && !gripInspectPose) throw new Error("JKA_GRIP_INSPECT_POSE_INVALID:" + requestedGripInspect);
  if (gripInspectPose && !nativeJkaSaberSelected) throw new Error("JKA_GRIP_INSPECT_REQUIRES_jkaWeapon_native");
  if (nativeJkaSaberSelected && pageParams.get("jkaWeapons") === "off") {
    throw new Error("NATIVE_JKA_SABER_TEST_REQUIRES_jkaWeapons_on");
  }
  const groundingPairAuditRequested = pageParams.get("groundingPairAudit") === "1";
  const jkaReadyProfileAB = pageParams.get("jkaReadyProfileAB") === "1";
  const jkaReadyTransitionDiag = pageParams.get("jkaReadyTransitionDiag") === "1" || jkaReadyProfileAB;
  const requestedReadyInit = pageParams.get("jkaReadyInit")?.toLowerCase();
  const jkaReadyInitMode = jkaReadyTransitionDiag || gripInspectPose ? "none" : requestedReadyInit === "none" || requestedReadyInit === "single" || requestedReadyInit === "double"
    ? requestedReadyInit : "none";
  const jkaCalebOnly = jkaReadyTransitionDiag || Boolean(gripInspectPose) || jkaParryLabMode || pageParams.get("jkaCalebOnly") === "1";
  const canonicalAcademyRoute = pageParams.get("academyCandidate") === "1" || pageParams.get("academyCombatLab") === "1";
  const legacyCharacterLabAllowed = pageParams.get("legacyCharacterLab") === "1";
  const requestedLeader = pageParams.get("leader")?.toLowerCase();
  const effectiveLeader = canonicalAcademyRoute && !legacyCharacterLabAllowed ? "aren-native-jka-v1" : requestedLeader;
  // DEV selectors are stable profile IDs; the original JKA donor remains the explicit golden control.
  const selectedLeaderProfile = effectiveLeader === "jolee" ? PLAYER_CHARACTERS.jolee :
    effectiveLeader === "nara" || effectiveLeader === "belaya" ? PLAYER_CHARACTERS["nara-belaya"] :
      effectiveLeader === "aren-caleb-jka-candidate" ? PLAYER_CHARACTERS["aren-caleb-jka-candidate"] :
        effectiveLeader === "aren-jka-prototype" || effectiveLeader === "aren-jka-prototype-v0" ? PLAYER_CHARACTERS["aren-jka-prototype"] :
          PLAYER_CHARACTERS["aren-native-jka-v1"];
  const jkaComboEnabled = import.meta.env.DEV && !jkaParryLabMode && (pageParams.get("jkaCombo") === "1" || Boolean(gripInspectPose));
  if (jkaComboEnabled && selectedLeaderProfile.id !== "aren-native-jka-v1") {
    throw new Error("W237_2E_COMBO_REQUIRES_AREN_NATIVE_JKA_V1");
  }
  const leaderProfile = jkaParryLabMode && selectedLeaderProfile.id === "aren-native-jka-v1" ? {
    ...selectedLeaderProfile,
    assetPath: "/_lab/jka/characters/aren/aren_native_jka_v1_defense_v2.glb",
    expectedAssetSha256: "f27d77b930a1facc3af4d5ac849cc0621a680c9d3fb1461f0cd4858a7d84dfb3",
    assetVariant: "AREN_NATIVE_JKA_V1_DEFENSE_V2",
    leaderCombatProfile: selectedLeaderProfile.leaderCombatProfile ? {
      ...selectedLeaderProfile.leaderCombatProfile,
      groups: {
        ...selectedLeaderProfile.leaderCombatProfile.groups,
        parryResponse: "JKA_PARRY_TOP",
        parryResponses: {
          TOP: "JKA_PARRY_TOP",
          TOP_LEFT: "JKA_PARRY_TOP_LEFT",
          TOP_RIGHT: "JKA_PARRY_TOP_RIGHT",
          BOTTOM_LEFT: "JKA_PARRY_BOTTOM_LEFT",
          BOTTOM_RIGHT: "JKA_PARRY_BOTTOM_RIGHT",
        },
      },
      sourceSymbols: {
        ...selectedLeaderProfile.leaderCombatProfile.sourceSymbols,
        parryResponse: "BOTH_P1_S1_T_",
        parryTopLeft: "BOTH_P1_S1_TL",
        parryTopRight: "BOTH_P1_S1_TR",
        parryBottomLeft: "BOTH_P1_S1_BL",
        parryBottomRight: "BOTH_P1_S1_BR",
      },
      sourceFps: {
        ...selectedLeaderProfile.leaderCombatProfile.sourceFps,
        parryResponse: 20,
        parryTopLeft: 20,
        parryTopRight: 20,
        parryBottomLeft: 20,
        parryBottomRight: 20,
      },
    } : undefined,
  } : jkaComboEnabled ? {
    ...selectedLeaderProfile,
    assetPath: "/_lab/jka/characters/aren/aren_native_jka_v1_combo_v3.glb",
    expectedAssetSha256: "6e921a5e8fd0c20a0e18009f712468bf1b5925adfacd7b366882297af8545cdc",
    leaderCombatProfile: selectedLeaderProfile.leaderCombatProfile ? {
      ...selectedLeaderProfile.leaderCombatProfile,
      groups: {
        ...selectedLeaderProfile.leaderCombatProfile.groups,
        comboTransition: "JKA_COMBO_TRANSITION_B_TO_TL",
        comboAttack: "JKA_COMBO_ATTACK_TL_TO_BR",
        comboReturn: "JKA_COMBO_RETURN_BR_TO_READY",
      },
      sourceSymbols: {
        ...selectedLeaderProfile.leaderCombatProfile.sourceSymbols,
        comboTransition: "BOTH_T1_BR_TL",
        comboAttack: "BOTH_A1_TL_BR",
        comboReturn: "BOTH_R1_BR_S1",
      },
      sourceFps: {
        ...selectedLeaderProfile.leaderCombatProfile.sourceFps,
        comboTransition: 20,
        comboAttack: 30,
        comboReturn: 30,
      },
    } : undefined,
  } : selectedLeaderProfile;
  if (nativeJkaSaberSelected && leaderProfile.id !== "aren-native-jka-v1") {
    throw new Error("NATIVE_JKA_SABER_TEST_REQUIRES_AREN_NATIVE_JKA_V1");
  }
  const nativeJkaSaberDefinition: NativeJkaWeaponDefinition = {
    assetPath: "/_lab/jka/weapons/saber/jka_native_single_saber_v1.glb",
    handSocket: "rhang_tag_bone",
    bladeOriginNode: "JKA_BLADE_SOCKET",
    bladeAxisNode: "JKA_BLADE_AXIS_NEGATIVE_X",
    bladeTagSurface: "*blade1",
    bladeLengthM: 0.98,
    sourceForwardConvention: "NEGATIVE_X",
  };
  if (jkaReadyTransitionDiag && leaderProfile.id !== "aren-caleb-jka-candidate" && !(jkaReadyProfileAB && leaderProfile.id === "aren-jka-prototype")) {
    throw new Error("READY_TRANSITION_DIAG_REQUIRES_CALEB_OR_NATIVE_AREN_LEADER");
  }
  const requestedNara = canonicalAcademyRoute && !legacyCharacterLabAllowed ? "nara-native-jka-v1" : pageParams.get("nara")?.toLowerCase() ?? pageParams.get("naraVariant")?.toLowerCase() ?? "jan";
  const naraNativeSelected = !jkaReadyTransitionDiag && ["jan", "native-jka-v1", "nara-native-jka-v1"].includes(requestedNara);
  const naraCandidate = !jkaReadyTransitionDiag && requestedNara === "meetra";
  const naraJkaProfile = naraNativeSelected ? PLAYER_CHARACTERS["nara-native-jka-v1"] : naraCandidate ? PLAYER_CHARACTERS["nara-meetra-jka-candidate"] : undefined;
  const jkaNaraSelected = Boolean(naraJkaProfile);
  const joleeNpcEnabled = !jkaReadyTransitionDiag && !gripInspectPose && (jkaParryLabMode || pageParams.get("jolee")?.toLowerCase() === "npc" ||
    (!pageParams.has("jolee") && leaderProfile.id === "aren-native-jka-v1" && naraNativeSelected));
  const selectedRole = leaderProfile.id === "jolee" ? "jolee" : leaderProfile.id.startsWith("nara-") ? "nara" : "aren";
  const companions = (jkaCalebOnly ? [] : ["Aren", "Nara", "Jolee"] as const).filter(id =>
    id.toLowerCase() !== selectedRole && !(joleeNpcEnabled && id === "Jolee"));
  let visFallbackCount = 0, previousFallback = false, currentRoom = "";
  let currentVisibleRooms: string[] = [];
  const updateVis = (renderPosition: Vector3, preferredHit?: EboHit | null) => {
    const hit = preferredHit ?? resolve(fromB(renderPosition), nav, true, 1.25, 7);
    const names = hit && nav.visibility[hit.room] ? [hit.room, ...nav.visibility[hit.room]] : null;
    const fallback = !hit || !names;
    if (fallback && !previousFallback) visFallbackCount++;
    previousFallback = fallback;
    currentRoom = hit?.room ?? currentRoom;
    const visibleRooms = names ?? [...byRoom.keys()];
    currentVisibleRooms = visibleRooms;
    const visible = new Set(visibleRooms.map(r => r.toLowerCase()));
    let enabledMeshes = 0;
    for (const [room, meshes] of byRoom) for (const mesh of meshes) {
      const on = visible.has(room); mesh.setEnabled(on); if (on) enabledMeshes++;
    }
    return { room: hit?.room ?? null, visibleRooms, enabledMeshes, fallback, fallbackCount: visFallbackCount };
  };
  const adapter = await EbonHawkPartyAdapter.create({
    scene, canvas, nav: partyNav, spawn,
    resolve: (p, walk, maxH, maxV, rooms) => resolve(p, nav, walk, maxH, maxV, rooms),
    updateVisibility: (p, hit) => updateVis(p, hit), semanticBounds,
    companions: companions as Array<"Aren" | "Nara" | "Jolee">, leaderProfile, naraCandidate, naraJkaProfile,
  });
  if (jkaControlSwapMode || jkaHostileMode) adapter.enableControlSwap();
  const tacticalPause = new TacticalPauseController();
  const unbindTacticalPause = adapter.bindTacticalPause(tacticalPause);
  const leaderAssetSha256 = await sha256Asset(leaderProfile.assetPath);
  const leaderAsset = (adapter as any).playersAsset as ImportedAsset;
  const calebJkaSelected = leaderProfile.id === "aren-caleb-jka-candidate";
  const nativeJkaLeaderSelected = leaderProfile.id === "aren-jka-prototype" || leaderProfile.id === "aren-native-jka-v1";
  const leaderAnimationActorId = calebJkaSelected ? "CALEB" : nativeJkaLeaderSelected ? "AREN_NATIVE" : null;
  const activeLeaderCharacterId = leaderProfile.id === "aren-jka-prototype" ? "AREN_JKA_PROTOTYPE_V0" : leaderProfile.id === "aren-native-jka-v1" ? "AREN_NATIVE_JKA_V1" : leaderProfile.id === "aren-caleb-jka-candidate" ? "AREN_CALEB_JKA_CANDIDATE" : leaderProfile.id;
  const profileClipResolution = (profile: any, groups: any[]): any => {
    const entries = {
      exactLocomotion: profile.exactLocomotion ?? null,
      semanticClips: profile.semanticClips ?? null,
      combatGroups: profile.leaderCombatProfile?.groups ?? null,
    };
    const resolveRecord = (record: any) => record ? Object.fromEntries(Object.entries(record)
      .filter(([, value]) => typeof value === "string")
      .map(([key, value]) => [key, { requested: value, exactGroupMatches: groups.filter(group => group.name === value).length }])) : null;
    return { ...entries, groupResolutions: {
      exactLocomotion: resolveRecord(profile.exactLocomotion),
      semanticClips: resolveRecord(profile.semanticClips),
      combatGroups: resolveRecord(profile.leaderCombatProfile?.groups),
    } };
  };
  const armedProfileFor = (profile: any): any => {
    if (profile.nativeJkaRig) return profile.exactLocomotion;
    const clips = profile.semanticClips;
    return {
      idle: clips?.saberIdle ?? clips?.saberReady ?? profile.exactLocomotion?.idle,
      walk: clips?.saberWalk ?? profile.exactLocomotion?.walk,
      run: clips?.saberRun ?? profile.exactLocomotion?.run,
      source: (profile.exactLocomotion?.source ?? "character-definition") + "; armed Jedi semantics",
    };
  };
  const profileDifference = (left: any, right: any): any[] => {
    const fields = ["idle", "walk", "run", "backward", "strafeLeft", "strafeRight", "source"];
    return fields.flatMap(field => left?.[field] === right?.[field] ? [] : [{ field, nativeAren: left?.[field] ?? null, caleb: right?.[field] ?? null }]);
  };
  const nativeArenDefinition = PLAYER_CHARACTERS["aren-jka-prototype"];
  const calebDefinition = PLAYER_CHARACTERS["aren-caleb-jka-candidate"];
  const nativeCombatGroups = nativeArenDefinition.leaderCombatProfile?.groups;
  const calebCombatGroups = calebDefinition.leaderCombatProfile?.groups;
  const readyProfileAudit: Record<string, any> = {
    selectedActorId: calebJkaSelected ? "AREN_CALEB_JKA_CANDIDATE" : "AREN_JKA_PROTOTYPE_V0",
    selectedAssetPath: leaderProfile.assetPath,
    selectedAssetSha256: leaderAssetSha256,
    selectedAnimationGroups: leaderAsset.animationGroups.map(group => group.name),
    nativeAren: profileClipResolution(nativeArenDefinition, calebJkaSelected ? [] : leaderAsset.animationGroups),
    caleb: profileClipResolution(calebDefinition, calebJkaSelected ? leaderAsset.animationGroups : []),
    armedLocomotionProfiles: {
      nativeAren: armedProfileFor(nativeArenDefinition),
      calebCurrent: armedProfileFor(calebDefinition),
      currentBranchDiff: profileDifference(armedProfileFor(nativeArenDefinition), armedProfileFor(calebDefinition)),
    },
    leaderCombatGroupDiff: Object.fromEntries(Object.keys(nativeCombatGroups ?? {}).map(key => [key, {
      nativeAren: typeof (nativeCombatGroups as any)?.[key] === "string" ? (nativeCombatGroups as any)[key] : null,
      caleb: typeof (calebCombatGroups as any)?.[key] === "string" ? (calebCombatGroups as any)[key] : null,
    }])),
  };
  (window as any).__w2372D3CReadyProfileAudit = readyProfileAudit;
  const jkaNaraFollower = jkaNaraSelected ? adapter.followers.find(follower => follower.id === "Nara") ?? null : null;
  const jkaNaraActorId = naraCandidate ? "MEETRA" : "NARA";
  const activeNaraCharacterId = naraNativeSelected ? "NARA_NATIVE_JKA_V1" : naraCandidate ? "NARA_MEETRA_JKA_CANDIDATE" : "NARA_BELAYA_VANILLA";
  const jkaRootResetAssets = [
    ...(leaderAnimationActorId ? [{ actorId: leaderAnimationActorId, asset: leaderAsset }] : []),
    ...(jkaNaraFollower ? [{ actorId: jkaNaraActorId, asset: jkaNaraFollower.asset }] : []),
  ];
  let jkaRootResetEnabled = pageParams.get("jkaRootReset") !== "off";
  jkaRootResetAssets.forEach(({ asset }) => asset.setAnimatedRootsResetEnabled(jkaRootResetEnabled));
  const academyJkaActors = [
    ...(leaderAnimationActorId ? [{ actorId: leaderAnimationActorId, asset: leaderAsset, actorRoot: adapter.player.root, visualRoot: adapter.player.visualRoot }] : []),
    ...(jkaNaraFollower ? [{ actorId: jkaNaraActorId, asset: jkaNaraFollower.asset, actorRoot: jkaNaraFollower.root, visualRoot: jkaNaraFollower.visualRoot }] : []),
  ];
  const academyAnimationAudits = new Map(academyJkaActors.map(actor => [actor.actorId, createJkaAnimationOwnershipAudit(actor.asset)]));
  const leaderTargetObjects = academyAnimationAudits.get(leaderAnimationActorId ?? "")?.targetObjects ?? new Set<any>();
  const naraTargetObjects = academyAnimationAudits.get(jkaNaraActorId)?.targetObjects ?? new Set<any>();
  const calebTargetObjects = academyAnimationAudits.get("CALEB")?.targetObjects ?? new Set<any>();
  const meetraTargetObjects = academyAnimationAudits.get("MEETRA")?.targetObjects ?? new Set<any>();
  const academySharedAnimationTargets = new Set([...leaderTargetObjects].filter(target => naraTargetObjects.has(target)));
  const readyTransitionCalls: any[] = [];
  const readyInitializationCalls: any[] = [];
  const readyAnimationSamples: any[] = [];
  const readyDiagnosticCameraPreset = jkaReadyTransitionDiag ? {
    yaw: adapter.camera.yaw, pitch: adapter.camera.pitch, distance: adapter.camera.distance,
    fov: adapter.camera.camera.fov,
  } : null;
  let readyAnimationAuditPinned = false;
  const pendingReadyFrameSamples: Array<{ dueFrame: number; label: string }> = [];
  const readyTransitionCaseRuns: any[] = [];
  const pendingReadyTransitionSamples: Array<{ dueFrame: number; label: string; caseId: string }> = [];
  let activeReadyTransitionCase: any = null;
  const animationObjectIdentity = new WeakMap<object, number>();
  let nextAnimationObjectIdentity = 1;
  let renderedFrameIndex = 0;
  let walkSampleStartedAt: number | null = null;
  let walkOneSecondSampleCaptured = false;
  const identityForAnimationObject = (value: any): number | null => {
    if (!value || (typeof value !== "object" && typeof value !== "function")) return null;
    let id = animationObjectIdentity.get(value);
    if (id == null) { id = nextAnimationObjectIdentity++; animationObjectIdentity.set(value, id); }
    return id;
  };
  const readyInitializationTelemetry = () => ({
    mode: jkaReadyInitMode,
    automaticCalls: readyInitializationCalls.map(call => ({ ...call })),
    readyCallCount: readyTransitionCalls.length,
    calls: readyTransitionCalls.map(call => ({ ...call })),
    renderedFrameIndex,
    sampleCount: readyAnimationSamples.length,
    latestSample: (() => {
      const sample = readyAnimationSamples.length ? readyAnimationSamples[readyAnimationSamples.length - 1] : null;
      if (!sample) return null;
      return {
        label: sample.label, renderedFrameIndex: sample.renderedFrameIndex, armed: sample.armed,
        leaderSemantic: sample.leaderSemantic, leaderClip: sample.leaderClip, leaderHorizontalSpeed: sample.leaderHorizontalSpeed,
        rootResetEnabled: sample.rootResetEnabled,
        actors: Object.fromEntries(Object.entries(sample.actors as Record<string, any>).map(([actorId, actor]) => [actorId, {
          activeGroupNames: actor.activeGroupNames, activeAnimationGroupCount: actor.activeAnimationGroupCount,
          activeAnimatableCount: actor.activeAnimatableCount, writerCount: actor.writers.length,
          foreignTargetCount: actor.foreignTargetCount, crossActorTargetCount: actor.crossActorTargetCount,
          duplicateTargetPropertyWriterCount: actor.duplicateTargetPropertyWriters.length,
          duplicateTargetPropertyWriters: actor.duplicateTargetPropertyWriters.map((row: any) => ({
            targetName: row.targetName, targetUniqueId: row.targetUniqueId, animatedProperty: row.animatedProperty,
            distinctAnimatableCount: row.distinctAnimatableCount,
            groups: [...new Set(row.owners.map((owner: any) => owner.groupName))],
          })),
          selectedNodes: actor.selectedNodes.map((node: any) => ({
            name: node.name, uniqueId: node.uniqueId, parentName: node.parentName, parentUniqueId: node.parentUniqueId,
            position: node.position, rotationQuaternion: node.rotationQuaternion, rotation: node.rotation, scaling: node.scaling,
            worldPosition: node.worldPosition,
          })),
        }])),
      };
    })(),
  });
  const jkaWeaponsOff = jkaReadyTransitionDiag || pageParams.get("jkaWeapons") === "off";
  if (groundingPairAuditRequested && !jkaWeaponsOff) throw new Error("W237_2D4B_GROUNDING_AUDIT_REQUIRES_jkaWeapons_off");
  const disableLeaderSaber = jkaWeaponsOff && Boolean(leaderProfile.leaderCombatProfile);
  const disableNaraSaber = (jkaWeaponsOff && jkaNaraSelected) || pageParams.get("jkaNaraWeapon") === "off";
  const leaderSkeletons = [...new Set(leaderAsset.meshes.map(mesh => mesh.skeleton).filter(Boolean))] as any[];
  const leaderJointCount = leaderSkeletons.length === 1 ? leaderSkeletons[0].bones.length : -1;
  if (leaderProfile.id === "aren-jka-prototype" && (
    leaderAssetSha256 !== "c6b3766d8bbb01a182b918c2161b64a0a3e0ddefb35249dc8118fb1eb6f97bca" ||
    leaderProfile.assetPath !== "/_lab/jka/characters/aren/aren_jka_prototype_v0.glb" ||
    leaderJointCount !== 53 || leaderProfile.leaderCombatProfile?.saberAttachmentNode !== "rhang_tag_bone"
  )) throw new Error("LEADER_LOAD_GATE_FAIL: ACTIVE_LEADER_IDENTITY_MISMATCH");
  if (leaderProfile.id === "aren-caleb-jka-candidate" && (
    leaderAssetSha256 !== "06681468976eb7ea4e53bb692bbcfbedaed0304ae23166b6117917103cd48215" ||
    leaderProfile.assetPath !== "/_lab/jka/characters/aren/aren_caleb_jka_candidate_v0.glb" ||
    leaderJointCount !== 53 || leaderProfile.leaderCombatProfile?.saberAttachmentNode !== "rhang_tag_bone"
  )) throw new Error("LEADER_LOAD_GATE_FAIL: CALEB_CANDIDATE_IDENTITY_MISMATCH");
  if (leaderProfile.id === "aren-native-jka-v1") {
    const expectedDefenseAsset = jkaParryLabMode;
    const expectedHash = expectedDefenseAsset
      ? "f27d77b930a1facc3af4d5ac849cc0621a680c9d3fb1461f0cd4858a7d84dfb3"
      : jkaComboEnabled
      ? "6e921a5e8fd0c20a0e18009f712468bf1b5925adfacd7b366882297af8545cdc"
      : "8b5c958621d6050ce268accc08f15d664dd6e398ffdcf1dd61486925329b9b58";
    const expectedPath = expectedDefenseAsset
      ? "/_lab/jka/characters/aren/aren_native_jka_v1_defense_v2.glb"
      : jkaComboEnabled
      ? "/_lab/jka/characters/aren/aren_native_jka_v1_combo_v3.glb"
      : "/_lab/jka/characters/aren/aren_native_jka_v1.glb";
    const expectedAnimationCount = expectedDefenseAsset ? 18 : jkaComboEnabled ? 13 : 10;
    if (leaderAssetSha256 !== expectedHash || leaderProfile.assetPath !== expectedPath || leaderJointCount !== 53 ||
      leaderAsset.animationGroups.length !== expectedAnimationCount || leaderProfile.leaderCombatProfile?.saberAttachmentNode !== "rhang_tag_bone") {
      throw new Error("LEADER_LOAD_GATE_FAIL: AREN_NATIVE_JKA_V1_IDENTITY_MISMATCH:" + JSON.stringify({
        hash: leaderAssetSha256, path: leaderProfile.assetPath, joints: leaderJointCount,
        groups: leaderAsset.animationGroups.length, combo: jkaComboEnabled, defense: expectedDefenseAsset,
      }));
    }
    if (jkaComboEnabled) {
      const comboGroups = ["JKA_COMBO_TRANSITION_B_TO_TL", "JKA_COMBO_ATTACK_TL_TO_BR", "JKA_COMBO_RETURN_BR_TO_READY"];
      const unresolved = comboGroups.filter(name => !leaderAsset.animationGroups.some(group => group.name === name));
      if (unresolved.length) throw new Error("W237_2E_COMBO_LOAD_GATE_FAIL: MISSING_CLIPS:" + unresolved.join(","));
    }
    if (expectedDefenseAsset) {
      const defenseGroups = Object.values(leaderProfile.leaderCombatProfile?.groups.parryResponses ?? {});
      const unresolved = defenseGroups.filter(name => !leaderAsset.animationGroups.some(group => group.name === name));
      if (defenseGroups.length !== 5 || unresolved.length) {
        throw new Error("W237_2F4_DEFENSE_LOAD_GATE_FAIL:MISSING_PARRY_GROUPS:" + unresolved.join(","));
      }
    }
  }
  let naraJkaAssetSha256: string | null = null;
  if (jkaNaraFollower && naraJkaProfile) {
    naraJkaAssetSha256 = await sha256Asset(naraJkaProfile.assetPath);
    const naraSkeletons = [...new Set(jkaNaraFollower.asset.meshes.map(mesh => mesh.skeleton).filter(Boolean))] as any[];
    const expectedGroupCount = naraCandidate ? 11 : naraNativeSelected ? 15 : 10;
    const requiredGroups = [naraJkaProfile.exactLocomotion?.idle, naraJkaProfile.exactLocomotion?.walk, naraJkaProfile.exactLocomotion?.run,
      ...(naraJkaProfile.characterLabJkaPreviewProfile ? Object.values(naraJkaProfile.characterLabJkaPreviewProfile.groups) : []),
      ...(naraNativeSelected && naraJkaProfile.leaderCombatProfile ? Object.values(naraJkaProfile.leaderCombatProfile.groups).flatMap(value =>
        typeof value === "string" ? [value] : Object.values(value ?? {})) : []),
    ].filter((name): name is string => Boolean(name));
    const missing = [...new Set(requiredGroups)].filter(name => !jkaNaraFollower.asset.animationGroups.some(group => group.name === name));
    if (naraJkaAssetSha256 !== naraJkaProfile.expectedAssetSha256 || jkaNaraFollower.assetPath !== naraJkaProfile.assetPath ||
        naraSkeletons.length !== 1 || naraSkeletons[0].bones.length !== 53 || jkaNaraFollower.asset.animationGroups.length !== expectedGroupCount || missing.length) {
      throw new Error("NARA_JKA_FOLLOWER_LOAD_GATE_FAIL: IDENTITY_OR_RIG_OR_CLIPS_MISMATCH:" + JSON.stringify({ hash: naraJkaAssetSha256, groups: jkaNaraFollower.asset.animationGroups.length, missing }));
    }
  }
  const lighting = new CharacterPresentationLighting(scene, adapter.presentationMeshes(), "interior");
  const loader = new AssetLoader(), adapterAny = adapter as any;
  const activePartySize = 1 + adapter.followers.length;
  const JOLEE_SOURCE_SHA256 = "a72417003d8c6aa694ef63d20fd63b352b2448a2b750e32fb56bec202d284d7f";
  let joleeNpc: { asset: ImportedAsset; root: TransformNode; visualRoot: TransformNode; hit: EboHit; idleClip: string; resetObserver: any } | null = null;
  let joleeNpcLighting: CharacterPresentationLighting | null = null;
  if (joleeNpcEnabled) {
    const sourceHash = await sha256Asset(PLAYER_CHARACTERS.jolee.assetPath);
    if (sourceHash !== JOLEE_SOURCE_SHA256) throw new Error("JOLEE_NPC_LOAD_GATE_FAIL: SOURCE_SHA256_MISMATCH:" + sourceHash);
    const npcHit = nav.pth
      .filter(node => node.room.toLowerCase() === spawn.room.toLowerCase() && node.projection === "UNIQUE_ROOM")
      .map(node => projectPthNodeToSourceWok(nav, node))
      .filter((hit): hit is EboHit => Boolean(hit))
      .filter(hit => dist2(hit.point, spawn.point) >= 3.2 && dist2(hit.point, [spawn.point[0] + 1.4, spawn.point[1], spawn.point[2]]) >= 2.2)
      .sort((a, b) => dist2(a.point, spawn.point) - dist2(b.point, spawn.point))[0];
    if (!npcHit) throw new Error("JOLEE_NPC_LOAD_GATE_FAIL: NO_VALID_ENTRY_ROOM_WOK_SPAWN");
    const npcAsset = await loader.load(PLAYER_CHARACTERS.jolee.assetPath, scene);
    const idle = npcAsset.animationGroups.find(group => group.name.toLowerCase() === "pause1");
    if (!idle) { npcAsset.dispose(); throw new Error("JOLEE_NPC_LOAD_GATE_FAIL: PAUSE1_MISSING"); }
    const root = new TransformNode("JoleeAcademyNpcActorRoot", scene);
    root.metadata = { characterId: "JOLEE_KOTOR1", role: "ACADEMY_NPC", partyMember: false, sourceFloor: "W237.1_SOURCE_WOK" };
    root.position.copyFrom(toB(npcHit.point));
    const npcRender = toB(npcHit.point), leaderRender = toB(spawn.point);
    root.rotation.y = Math.atan2(leaderRender.x - npcRender.x, leaderRender.z - npcRender.z);
    const visualRoot = new TransformNode("JoleeAcademyNpcVisualRoot", scene);
    visualRoot.parent = root;
    npcAsset.root.parent = visualRoot;
    const sourceBounds = measureVisualBounds(npcAsset.meshes);
    if (sourceBounds.height > 0) visualRoot.scaling.setAll(PLAYER_CHARACTERS.jolee.targetHeightM / sourceBounds.height);
    root.computeWorldMatrix(true); visualRoot.computeWorldMatrix(true); npcAsset.root.computeWorldMatrix(true);
    const grounding = alignVisualFeetToGround(visualRoot, npcAsset.meshes, root.position.y + 0.02);
    idle.start(true, 1);
    const resetObserver = scene.onAfterAnimationsObservable.add(() => npcAsset.resetAnimatedRoots());
    joleeNpc = { asset: npcAsset, root, visualRoot, hit: npcHit, idleClip: idle.name, resetObserver };
    joleeNpcLighting = new CharacterPresentationLighting(scene, npcAsset.meshes, "interior");
    (window as any).__w2372JoleeNpcGrounding = { sourceHash, room: npcHit.room, face: npcHit.face, position: npcHit.point,
      floorY: root.position.y, bindFeetY: grounding.after.feetY, bindFeetToFloorM: Number((grounding.after.feetY - root.position.y).toFixed(4)), visualOffsetM: Number(grounding.offset.toFixed(4)) };
  }
  const actorAsset = (id: "Aren" | "Nara" | "Jolee"): ImportedAsset | null => {
    const role = id.toLowerCase();
    if (role === "aren" && adapter.player.characterDefinition.id.startsWith("aren")) return adapterAny.playersAsset as ImportedAsset;
    if (role === "jolee" && joleeNpc) return joleeNpc.asset;
    return adapter.followers.find(f => f.id === id)?.asset ?? null;
  };
  const genericSabers = new Map<string, WeaponAttachment>();
  const genericSaberPending = new Map<string, Promise<WeaponAttachment>>();
  let joleeWeapon: any = null, joleeRoots: any[] = [], joleeHandName: string | null = null;
  let joleeBladeBaseAnchor: TransformNode | null = null, joleeBladeTipAnchor: TransformNode | null = null;
  let joleeVisibleBladeLengthM: number | null = null;
  let parryController: SaberParryController | null = null;
  let joleeParryState: SaberParryState = "NOT_PARRYING";
  let arenBlockState: SaberParryState = "NOT_PARRYING";
  let manualBlockInputActive = false;
  let joleeParryResponsePlaying = false;
  const JOLEE_PARRY_ACTOR_ID = "JOLEE_KOTOR1_ACADEMY_NPC";
  const AREN_BLOCK_ACTOR_ID = "AREN_NATIVE_JKA_V1";
  let joleeAttachmentPending: Promise<any> | null = null;
  const equipGenericSaber = (id: "Aren" | "Nara"): Promise<WeaponAttachment> => {
    const existing = genericSabers.get(id);
    if (existing) return Promise.resolve(existing);
    const pending = genericSaberPending.get(id);
    if (pending) return pending;
    const task = (async () => {
      const asset = actorAsset(id);
      if (!asset) throw new Error(id.toUpperCase() + "_ACTOR_ASSET_NOT_FOUND");
      const preferredSocket = id === "Aren" && nativeJkaSaberSelected
        ? nativeJkaSaberDefinition.handSocket
        : id === "Aren"
        ? adapter.player.characterDefinition.leaderCombatProfile?.saberAttachmentNode
        : id === "Nara" && naraJkaProfile
          ? naraJkaProfile?.weaponAttachmentNode
          : undefined;
      const attachment = new WeaponAttachment(scene, asset, loader, preferredSocket,
        id === "Aren" && !nativeJkaSaberSelected ? adapter.player.characterDefinition.weaponPresentation : undefined,
        (id === "Aren" && nativeJkaSaberSelected) || (id === "Nara" && naraJkaProfile?.nativeJkaRig) ? nativeJkaSaberDefinition : undefined,
        id === "Aren" && nativeJkaSaberSelected ? adapter.player.characterDefinition.nativeJkaWeaponPresentation
          : id === "Nara" && naraJkaProfile?.nativeJkaRig ? naraJkaProfile.nativeJkaWeaponPresentation : undefined);
      await attachment.attach();
      if (!attachment.socketCreated) throw new Error(id.toUpperCase() + "_SABER_SOCKET_NOT_CREATED");
      attachment.socketNode!.metadata = { ...(attachment.socketNode!.metadata ?? {}), runtimeWeaponOwner: id, weaponId: "NERATHIS_RUNTIME_SINGLE_SABER" };
      attachment.setBladeExtension(1);
      genericSabers.set(id, attachment);
      return attachment;
    })();
    genericSaberPending.set(id, task);
    return task.finally(() => genericSaberPending.delete(id));
  };
  type AcademyHostileAttackState = {
    commandId: string;
    phase: "APPROACH" | "FACE_TARGET" | "START" | "ATTACK" | "RETURN";
    phaseElapsed: number;
    attackInstanceId: string;
  };
  let academyHostile: { target: HostileMercenaryTarget; asset: ImportedAsset; visualRoot: TransformNode; hit: EboHit; weapon: BlasterWeaponAttachment; fire: SingleBlasterFireController; fireActors: BlasterProjectileActor[]; worldHit: ReturnType<typeof createSceneWorldHitTest>; interceptor: SaberProjectileInterceptor; blockEligible: Map<string, boolean>; rangedHealth: Map<string, number>; traces: Map<string, SaberTraceController>; attacks: Map<string, AcademyHostileAttackState>; attackSerial: Map<string, number>; sampleCalls: number; sampleUpdates: number; sampleMissingAttachment: number; } | null = null;
  if (jkaHostileMode) {
    if (!jkaNaraSelected || leaderProfile.id !== "aren-native-jka-v1") throw new Error("JKA_HOSTILE_ROUTE_REQUIRES_NATIVE_AREN_AND_NARA");
    const hostileHit = nav.pth
      .filter(node => node.room.toLowerCase() === spawn.room.toLowerCase() && node.projection === "UNIQUE_ROOM")
      .map(node => projectPthNodeToSourceWok(nav, node))
      .filter((hit): hit is EboHit => Boolean(hit))
      .filter(hit => dist2(hit.point, spawn.point) >= 2.6)
      .sort((a, b) => dist2(a.point, spawn.point) - dist2(b.point, spawn.point))[0] ?? spawn;
    const hostileAsset = await loader.load(HOSTILE_MERCENARY_JKA_V1.assetPath, scene);
    const hostileTarget = new HostileMercenaryTarget(scene, HOSTILE_MERCENARY_JKA_V1.id, HOSTILE_MERCENARY_JKA_V1, hostileAsset, toB(hostileHit.point));
    const hostileVisualRoot = new TransformNode("HostileMercenaryAcademyVisualRoot", scene);
    hostileVisualRoot.parent = hostileTarget.root;
    hostileAsset.root.parent = hostileVisualRoot;
    const bounds = measureVisualBounds(hostileAsset.meshes);
    if (bounds.height > 0) hostileVisualRoot.scaling.setAll(HOSTILE_MERCENARY_JKA_V1.targetHeightM / bounds.height);
    hostileTarget.root.rotation.y = Math.atan2(toB(spawn.point).x - toB(hostileHit.point).x, toB(spawn.point).z - toB(hostileHit.point).z);
    hostileTarget.root.computeWorldMatrix(true); hostileVisualRoot.computeWorldMatrix(true); hostileAsset.root.computeWorldMatrix(true);
    alignVisualFeetToGround(hostileVisualRoot, hostileAsset.meshes, hostileTarget.root.position.y + 0.02);
    const blaster = new BlasterWeaponAttachment(scene, loader, HOSTILE_MERCENARY_JKA_V1); await blaster.attachTo(hostileAsset);
    hostileTarget.reset();
    const rangedHealth = new Map<string, number>([["AREN_NATIVE_JKA_V1", 100], ["NARA_NATIVE_JKA_V1", 100]]);
    const fireActors: BlasterProjectileActor[] = [
      { actorId: "AREN_NATIVE_JKA_V1", faction: "PARTY", targetable: () => (rangedHealth.get("AREN_NATIVE_JKA_V1") ?? 0) > 0, position: () => adapter.player.root.getAbsolutePosition().add(new Vector3(0, 1.02, 0)), radius: .5, receiveBlasterHit: event => { const id = "AREN_NATIVE_JKA_V1"; const before = rangedHealth.get(id) ?? 0; if (before <= 0) return false; rangedHealth.set(id, Math.max(0, before - event.damage)); return true; } },
      { actorId: "NARA_NATIVE_JKA_V1", faction: "PARTY", targetable: () => (rangedHealth.get("NARA_NATIVE_JKA_V1") ?? 0) > 0, position: () => (jkaNaraFollower?.root.getAbsolutePosition() ?? new Vector3(9999, 9999, 9999)).add(new Vector3(0, 1.02, 0)), radius: .5, receiveBlasterHit: event => { const id = "NARA_NATIVE_JKA_V1"; const before = rangedHealth.get(id) ?? 0; if (before <= 0) return false; rangedHealth.set(id, Math.max(0, before - event.damage)); return true; } },
    ];
    const interceptor = new SaberProjectileInterceptor(.08, 180);
    const blockEligible = new Map<string, boolean>([["AREN_NATIVE_JKA_V1", false], ["NARA_NATIVE_JKA_V1", false]]);
    const facingFor = (root: TransformNode) => root.getDirection(Vector3.Forward()).normalize();
    interceptor.registerDefender({ actorId: "AREN_NATIVE_JKA_V1", blade: { active: false }, blockEligible: () => blockEligible.get("AREN_NATIVE_JKA_V1") === true, alive: () => (rangedHealth.get("AREN_NATIVE_JKA_V1") ?? 0) > 0, facing: () => facingFor(adapter.player.root) });
    interceptor.registerDefender({ actorId: "NARA_NATIVE_JKA_V1", blade: { active: false }, blockEligible: () => blockEligible.get("NARA_NATIVE_JKA_V1") === true, alive: () => (rangedHealth.get("NARA_NATIVE_JKA_V1") ?? 0) > 0, facing: () => facingFor(jkaNaraFollower?.root ?? adapter.player.root) });
    const fire = new SingleBlasterFireController(scene, HOSTILE_MERCENARY_JKA_V1.id, hostileAsset, blaster, HOSTILE_MERCENARY_JKA_V1, { isShooterAlive: () => hostileTarget.alive, isTargetAlive: id => (rangedHealth.get(id) ?? 0) > 0, onRelease: () => { status.textContent = "HOSTILE PROJECTILE RELEASED"; } });
    const worldHit = createSceneWorldHitTest(scene, [adapter.player.root, ...(jkaNaraFollower ? [jkaNaraFollower.root] : []), hostileTarget.root, blaster.rootNode!], scene.meshes);
    academyHostile = { target: hostileTarget, asset: hostileAsset, visualRoot: hostileVisualRoot, hit: hostileHit, weapon: blaster, fire, fireActors, worldHit, interceptor, blockEligible, rangedHealth, traces: new Map([["AREN", new SaberTraceController("AREN_NATIVE_JKA_V1")], ["NARA", new SaberTraceController("NARA_NATIVE_JKA_V1")]]), attacks: new Map(), attackSerial: new Map(), sampleCalls: 0, sampleUpdates: 0, sampleMissingAttachment: 0 };
    adapter.setTacticalHostileTarget(hostileTarget.targetId);
  }
  const vectorTelemetry = (value: Vector3 | null | undefined) => value?.asArray().map(component => Number(component.toFixed(6))) ?? null;
  const localTransformTelemetry = (node: any) => node ? {
    position: vectorTelemetry(node.position ?? null),
    rotationEulerDeg: node.rotation?.asArray?.().map((component: number) => Number((component * 180 / Math.PI).toFixed(4))) ?? null,
    rotationQuaternion: node.rotationQuaternion?.asArray?.().map((component: number) => Number(component.toFixed(6))) ?? null,
    scaling: vectorTelemetry(node.scaling ?? null),
  } : null;
  const worldTransformTelemetry = (node: any) => {
    if (!node?.getWorldMatrix) return null;
    node.computeWorldMatrix?.(true);
    const scale = Vector3.One(), rotation = Quaternion.Identity(), position = Vector3.Zero();
    node.getWorldMatrix().decompose(scale, rotation, position);
    return {
      nodeName: node.name ?? null, uniqueId: node.uniqueId ?? null, parentName: node.parent?.name ?? null,
      parentUniqueId: node.parent?.uniqueId ?? null, position: vectorTelemetry(position),
      rotationQuaternion: rotation.asArray().map((component: number) => Number(component.toFixed(6))),
      rotationEulerDeg: rotation.toEulerAngles().asArray().map((component: number) => Number((component * 180 / Math.PI).toFixed(4))),
      scaling: vectorTelemetry(scale),
    };
  };
  const worldAxesTelemetry = (node: any) => {
    if (!node?.getWorldMatrix) return null;
    node.computeWorldMatrix?.(true);
    const matrix = node.getWorldMatrix();
    return {
      localXWorld: vectorTelemetry(Vector3.TransformNormal(new Vector3(1, 0, 0), matrix).normalize()),
      localYWorld: vectorTelemetry(Vector3.TransformNormal(new Vector3(0, 1, 0), matrix).normalize()),
      localZWorld: vectorTelemetry(Vector3.TransformNormal(new Vector3(0, 0, 1), matrix).normalize()),
    };
  };
  const captureRoshSaberGripSample = (stage: string) => {
    const attachment = genericSabers.get("Aren");
    const socket = attachment?.socketNode;
    if (!attachment || !socket) return { stage, available: false };
    socket.computeWorldMatrix(true);
    const handBone = leaderSkeletons.flatMap((skeleton: any) => skeleton.bones ?? [])
      .find((bone: any) => /^(?:rhand|right.?hand)$/i.test(String(bone.name)));
    const handNode = handBone?.getTransformNode?.();
    handNode?.computeWorldMatrix?.(true);
    const handSocketNode = socket.parent as any;
    const hiltRoot = attachment.weaponRootNode as any;
    const bladeOriginNode = attachment.nativeBladeOriginNode as any;
    const bladeAxisNode = attachment.nativeBladeAxisNode as any;
    const weaponSceneRoot = attachment.nativeWeaponSceneRootNode as any;
    const segment = attachment.getBladeSegment();
    const socketWorld = socket.getAbsolutePosition();
    const handWorld = handNode?.getAbsolutePosition?.();
    const hiltWorld = hiltRoot?.getAbsolutePosition?.();
    const bladeAxisWorld = segment ? segment.end.subtract(segment.start).normalize() : null;
    const socketQuaternion = socket.rotationQuaternion?.clone() ?? Quaternion.FromEulerAngles(socket.rotation.x, socket.rotation.y, socket.rotation.z);
    const parentMatrix = (socket.parent as any)?.getWorldMatrix?.();
    const parentScale = Vector3.One();
    if (parentMatrix) parentMatrix.decompose(parentScale, Quaternion.Identity(), Vector3.Zero());
    const inverseParent = parentMatrix ? Matrix.Invert(parentMatrix) : null;
    const socketParentLocal = inverseParent ? Vector3.TransformCoordinates(socketWorld, inverseParent) : null;
    const handParentLocal = inverseParent && handWorld ? Vector3.TransformCoordinates(handWorld, inverseParent) : null;
    const socketToHandParentMeters = socketParentLocal && handParentLocal
      ? handParentLocal.subtract(socketParentLocal).scale(parentScale.x).asArray()
      : null;
    return {
      stage,
      available: true,
      actorId: "AREN_NATIVE_JKA_V1",
      socket: attachment.rightHandBoneName,
      socketParent: socket.parent?.name ?? null,
      socketParentUniqueId: socket.parent?.uniqueId ?? null,
      handSocketWorldTransform: worldTransformTelemetry(handSocketNode),
      handSocketWorldAxes: worldAxesTelemetry(handSocketNode),
      rightHandWorldTransform: worldTransformTelemetry(handNode),
      rightHandWorldAxes: worldAxesTelemetry(handNode),
      hiltRootWorldTransform: worldTransformTelemetry(hiltRoot),
      hiltRootWorldAxes: worldAxesTelemetry(hiltRoot),
      hiltRootLocalTransform: localTransformTelemetry(hiltRoot),
      weaponSceneRootWorldTransform: worldTransformTelemetry(weaponSceneRoot),
      weaponSceneRootLocalTransform: localTransformTelemetry(weaponSceneRoot),
      bladeOriginTagWorldTransform: worldTransformTelemetry(bladeOriginNode),
      bladeAxisTagWorldTransform: worldTransformTelemetry(bladeAxisNode),
      bladeAxisTagWorldPosition: vectorTelemetry(bladeAxisNode?.getAbsolutePosition?.()),
      bladeBaseWorldPosition: vectorTelemetry(segment?.start),
      bladeTipWorldPosition: vectorTelemetry(segment?.end),
      bladeAxisWorld: vectorTelemetry(bladeAxisWorld),
      bladeLengthM: segment ? Number(Vector3.Distance(segment.start, segment.end).toFixed(6)) : null,
      socketToRhandDistanceM: socketWorld && handWorld ? Number(Vector3.Distance(socketWorld, handWorld).toFixed(6)) : null,
      hiltOriginToRhandDistanceM: hiltWorld && handWorld ? Number(Vector3.Distance(hiltWorld, handWorld).toFixed(6)) : null,
      weaponPresentation: attachment.presentationDiagnostics,
      socketLocalTranslation: socket.position.asArray(),
      socketLocalRotationEulerDeg: socket.rotation.asArray().map((value: number) => Number((value * 180 / Math.PI).toFixed(4))),
      socketLocalQuaternion: socketQuaternion.asArray().map(component => Number(component.toFixed(6))),
      socketLocalScale: socket.scaling.asArray(),
      socketWorldPosition: socketWorld.asArray(),
      handBoneName: handBone?.name ?? null,
      handBoneWorldPosition: handWorld?.asArray?.() ?? null,
      socketToHandVectorInParentMeters: socketToHandParentMeters,
      gripAnchorToHandBoneOriginDistanceM: socketWorld && handWorld ? Number(Vector3.Distance(socketWorld, handWorld).toFixed(5)) : null,
      bladeBaseWorld: segment?.start.asArray() ?? null,
      bladeTipWorld: segment?.end.asArray() ?? null,
      visibleBladeLengthM: segment ? Number(Vector3.Distance(segment.start, segment.end).toFixed(5)) : null,
      bladeBaseSource: nativeJkaSaberSelected ? "JKA *blade1 bolt / JKA_BLADE_SOCKET marker" : "NERATHIS_RUNTIME_SABER_EMITTER",
      bladeDirectionSource: nativeJkaSaberSelected ? "JKA *blade1 NEGATIVE_X / source-derived axis marker" : "NERATHIS_RUNTIME_SABER_LOCAL_POSITIVE_Z",
      nativeBladeTag: attachment.nativeBladeTagInfo,
      activeAnimationGroups: leaderAsset.animationGroups.filter(group => group.isPlaying).map(group => group.name),
      activeAnimationGroupCount: leaderAsset.animationGroups.filter(group => group.isPlaying).length,
    };
  };
  const attachJoleeSaber = () => {
    if (joleeRoots.length) return Promise.resolve(joleeWeapon);
    if (joleeAttachmentPending) return joleeAttachmentPending;
    joleeAttachmentPending = (async () => {
      const asset = actorAsset("Jolee");
      if (!asset) throw new Error("JOLEE_ACTOR_ASSET_NOT_FOUND");
      const nodes = [...asset.meshes, ...scene.transformNodes].filter(Boolean) as any[];
      const rhand = nodes.find(n => String(n.name).toLowerCase() === "rhand" && (() => { let p = n.parent; while (p) { if (String(p.name).toLowerCase() === "rhand_g") return true; p = p.parent; } return false; })());
      if (!rhand) throw new Error("JOLEE_RHAND_CHILD_OF_RHAND_G_NOT_FOUND");
      const weapon = await SceneLoader.ImportMeshAsync("", "/_lab/kotor/characters/jolee/", "jolee_kotor1_lightsaber.glb", scene);
      const roots = [...new Set([...weapon.transformNodes, ...weapon.meshes])].filter(n => !n.parent) as any[];
       roots.forEach(root => { root.parent = rhand; root.metadata = { ...(root.metadata ?? {}), runtimeWeaponOwner: "Jolee", weaponId: "g_w_lghtsbr03" }; });
       const weaponRoot = roots.find(root => String(root.name).toLowerCase() === "w_lghtsbr_003") ?? roots[0];
       if (!weaponRoot) throw new Error("JOLEE_SABER_ROOT_NOT_FOUND");
       weaponRoot.computeWorldMatrix?.(true);
       const inverseRoot = Matrix.Invert(weaponRoot.getWorldMatrix());
       const bladeMeshes = weapon.meshes.filter(mesh => /^(plane227|plane228|plane229|plane230)$/i.test(String(mesh.name)));
       const hiltMesh = weapon.meshes.find(mesh => String(mesh.name).toLowerCase() === "lshandle07");
       const bladePoints: Vector3[] = [];
       const hiltPoints: Vector3[] = [];
       const collectRootLocalPoints = (mesh: any, output: Vector3[]) => {
         const positions = mesh.getVerticesData?.("position") as number[] | null;
         if (!positions?.length) return;
         mesh.computeWorldMatrix?.(true);
         for (let i = 0; i + 2 < positions.length; i += 3) {
           const local = new Vector3(positions[i], positions[i + 1], positions[i + 2]);
           output.push(Vector3.TransformCoordinates(Vector3.TransformCoordinates(local, mesh.getWorldMatrix()), inverseRoot));
         }
       };
       bladeMeshes.forEach(mesh => collectRootLocalPoints(mesh, bladePoints));
       if (hiltMesh) collectRootLocalPoints(hiltMesh, hiltPoints);
       if (bladePoints.length < 2) throw new Error("JOLEE_VISIBLE_BLADE_GEOMETRY_MISSING");
       const min = new Vector3(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
       const max = new Vector3(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY);
       bladePoints.forEach(point => { min.minimizeInPlace(point); max.maximizeInPlace(point); });
       const extent = max.subtract(min);
       const axis = extent.x >= extent.y && extent.x >= extent.z ? "x" : extent.y >= extent.z ? "y" : "z";
       const near = bladePoints.reduce((best, point) => point[axis] < best[axis] ? point : best, bladePoints[0]);
       const far = bladePoints.reduce((best, point) => point[axis] > best[axis] ? point : best, bladePoints[0]);
       const hiltCenter = hiltPoints.length
         ? hiltPoints.reduce((sum, point) => sum.add(point), Vector3.Zero()).scaleInPlace(1 / hiltPoints.length)
         : Vector3.Zero();
       const basePoint = Vector3.DistanceSquared(near, hiltCenter) <= Vector3.DistanceSquared(far, hiltCenter) ? near : far;
       const tipPoint = basePoint === near ? far : near;
       const bladeLength = Vector3.Distance(basePoint, tipPoint);
       if (!Number.isFinite(bladeLength) || bladeLength < 0.1 || bladeLength > 3) throw new Error("JOLEE_VISIBLE_BLADE_LENGTH_INVALID:" + bladeLength);
       joleeBladeBaseAnchor = new TransformNode("JoleeVisibleBladeBaseAnchor", scene);
       joleeBladeTipAnchor = new TransformNode("JoleeVisibleBladeTipAnchor", scene);
       joleeBladeBaseAnchor.parent = weaponRoot; joleeBladeTipAnchor.parent = weaponRoot;
       joleeBladeBaseAnchor.position.copyFrom(basePoint); joleeBladeTipAnchor.position.copyFrom(tipPoint);
       joleeBladeBaseAnchor.metadata = { runtimeWeaponOwner: "Jolee", source: "visible plane geometry", endpoint: "near-hilt" };
       joleeBladeTipAnchor.metadata = { runtimeWeaponOwner: "Jolee", source: "visible plane geometry", endpoint: "far" };
       joleeVisibleBladeLengthM = bladeLength;
      const powerup = weapon.animationGroups.find(g => g.name.toLowerCase() === "powerup");
      if (powerup) { powerup.start(false, 1); powerup.goToFrame(powerup.to); powerup.pause(); }
      joleeRoots = roots;
      joleeHandName = rhand.name;
       joleeWeapon = { provenance: "KOTOR1_ORIGINAL", item: "g_w_lghtsbr03", model: "w_lghtsbr_003", modelPath: "/_lab/kotor/characters/jolee/jolee_kotor1_lightsaber.glb", method: "SOURCE_RHAND_CHILD_OF_RHAND_G_NO_OFFSET", hand: rhand.name, handParent: rhand.parent?.name ?? null, runtimeOwner: "Jolee", instanceCount: 1, rootNodeCount: roots.length, loaded: true,
         bladeSource: "plane227/plane228/plane229/plane230 evaluated visible geometry", bladeBaseAnchor: joleeBladeBaseAnchor.name,
         bladeTipAnchor: joleeBladeTipAnchor.name, visibleBladeLengthM: Number(joleeVisibleBladeLengthM.toFixed(6)) };
      return joleeWeapon;
    })();
    return joleeAttachmentPending;
  };
  if (!disableLeaderSaber) await equipGenericSaber("Aren");
  if (!disableNaraSaber && !gripInspectPose && !jkaParryLabMode) await equipGenericSaber("Nara");
  const hostileAttackGroups = (actorId: "AREN" | "NARA") => actorId === "AREN"
    ? adapter.player.characterDefinition.leaderCombatProfile?.groups
    : naraJkaProfile?.leaderCombatProfile?.groups;
  const hostileAssetFor = (actorId: "AREN" | "NARA") => actorId === "AREN"
    ? (adapterAny.playersAsset as ImportedAsset)
    : jkaNaraFollower?.asset ?? null;
  const hostilePlayGroup = (actorId: "AREN" | "NARA", name: string, loop = false) => {
    const asset = hostileAssetFor(actorId); if (!asset) return false;
    asset.animationGroups.forEach(group => group.stop());
    if (actorId === "AREN") return adapter.player.playLeaderProfileClip(name, loop);
    const group = asset.animationGroups.find(candidate => candidate.name === name); if (!group) return false;
    group.start(loop, 1); return true;
  };
  const hostileReady = (actorId: "AREN" | "NARA") => {
    const groups = hostileAttackGroups(actorId); if (!groups) return;
    const ready = groups.saberReady ?? naraJkaProfile?.exactLocomotion?.idle;
    if (ready) hostilePlayGroup(actorId, ready, true);
  };
  const hostileFinishAttack = (actorId: "AREN" | "NARA", state: AcademyHostileAttackState) => {
    const runtime = academyHostile; if (!runtime) return;
    runtime.traces.get(actorId)?.endAttack();
    runtime.attacks.delete(actorId);
    hostileReady(actorId);
  };
  const hostileAttackStep = (actorId: string, command: any, deltaSeconds: number): any => {
    const runtime = academyHostile; if (!runtime) return { completed: false, failedReason: "HOSTILE_NOT_LOADED" };
    const partyId = actorId as "AREN" | "NARA";
    if (!runtime.target.targetable) {
      const current = runtime.attacks.get(partyId); if (current) hostileFinishAttack(partyId, current);
      return { completed: false, failedReason: "DEAD_TARGET", phase: "RESOLVE_TARGET" };
    }
    const actorPosition = partyId === "AREN" ? adapter.player.root.position : jkaNaraFollower?.root.position;
    if (!actorPosition) return { completed: false, failedReason: "ACTOR_NOT_LOADED" };
    const targetPosition = runtime.target.root.position;
    const delta = targetPosition.subtract(actorPosition); delta.y = 0;
    const distance = delta.length();
    let state = runtime.attacks.get(partyId);
    if (!state || state.commandId !== command.id) {
      state = { commandId: command.id, phase: distance > 1.35 ? "APPROACH" : "FACE_TARGET", phaseElapsed: 0, attackInstanceId: "" };
      runtime.attacks.set(partyId, state);
      if (state.phase === "APPROACH") {
        const route = adapter.planTacticalPthRoute(partyId, { x: targetPosition.x, y: targetPosition.y, z: targetPosition.z });
        (state as any).route = route.accepted ? route.points : [];
        (state as any).routeIndex = 0;
      }
    }
    if (state.phase === "APPROACH") {
      const route = (state as any).route as Array<{ x: number; y: number; z: number }>;
      let index = Number((state as any).routeIndex ?? 0);
      const destination = route[index] ?? { x: targetPosition.x, y: targetPosition.y, z: targetPosition.z };
      const step = adapter.stepTacticalActor(partyId, destination, deltaSeconds, 0.55);
      if ((step as any).failedReason) { hostileFinishAttack(partyId, state); return { completed: false, failedReason: (step as any).failedReason, phase: "APPROACH" }; }
      if (step.arrived) { index += 1; (state as any).routeIndex = index; }
      const updatedPosition = partyId === "AREN" ? adapter.player.root.position : jkaNaraFollower?.root.position;
      const remainingVector = updatedPosition ? runtime.target.root.position.subtract(updatedPosition) : null;
      if (remainingVector) remainingVector.y = 0;
      const remaining = remainingVector ? remainingVector.length() : distance;
      if (index >= route.length && remaining <= 1.35) state.phase = "FACE_TARGET";
      return { completed: false, phase: state.phase };
    }
    if (state.phase === "FACE_TARGET") {
      const facing = Math.atan2(delta.x, delta.z);
      if (partyId === "AREN") adapter.player.setFacingYaw(facing); else if (jkaNaraFollower) jkaNaraFollower.root.rotation.y = facing;
      const groups = hostileAttackGroups(partyId); if (!groups?.attackStart || !groups.attack || !groups.attackReturn) return { completed: false, failedReason: "ATTACK_GROUPS_MISSING", phase: "FACE_TARGET" };
      const serial = (runtime.attackSerial.get(partyId) ?? 0) + 1; runtime.attackSerial.set(partyId, serial);
      state.attackInstanceId = `${partyId.toLowerCase()}_academy_hostile_attack_${String(serial).padStart(4, "0")}`;
      state.phase = "START"; state.phaseElapsed = 0;
      const traceAttackId = runtime.traces.get(partyId)?.beginAttack();
      if (traceAttackId) state.attackInstanceId = traceAttackId;
      runtime.traces.get(partyId)?.setPhase("START");
      hostilePlayGroup(partyId, groups.attackStart, false);
      return { completed: false, phase: state.phase, attackInstanceId: state.attackInstanceId };
    }
    state.phaseElapsed += Math.max(0, deltaSeconds);
    const groups = hostileAttackGroups(partyId)!;
    if (state.phase === "START" && state.phaseElapsed >= 0.12) {
      state.phase = "ATTACK"; state.phaseElapsed = 0; hostilePlayGroup(partyId, groups.attack, false); runtime.traces.get(partyId)?.setPhase("ATTACK");
    } else if (state.phase === "ATTACK" && state.phaseElapsed >= 0.48) {
      state.phase = "RETURN"; state.phaseElapsed = 0; hostilePlayGroup(partyId, groups.attackReturn, false); runtime.traces.get(partyId)?.setPhase("RETURN");
    } else if (state.phase === "RETURN" && state.phaseElapsed >= 0.30) {
      const id = state.attackInstanceId; hostileFinishAttack(partyId, state); return { completed: true, phase: "RECOVER", attackInstanceId: id };
    }
    return { completed: false, phase: state.phase, attackInstanceId: state.attackInstanceId };
  };
  if (academyHostile) adapter.setTacticalAttackStepHandler(hostileAttackStep);
  const academyHostileInitialHit = academyHostile?.hit ?? null;
  const academyHostileFarHit = jkaHostileMode
    ? nav.pth.map(node => projectPthNodeToSourceWok(nav, node)).filter((hit): hit is EboHit => Boolean(hit))
      .filter(hit => dist2(hit.point, spawn.point) >= 8 && hit.room.toLowerCase() !== spawn.room.toLowerCase())
      .sort((a, b) => dist2(a.point, spawn.point) - dist2(b.point, spawn.point))[0] ?? academyHostileInitialHit
    : null;
  const placeAcademyHostile = (hit: EboHit | null) => {
    if (!academyHostile || !hit) return;
    academyHostile.hit = hit;
    academyHostile.target.placeOnFloor(toB(hit.point));
    academyHostile.target.root.rotation.y = Math.atan2(toB(spawn.point).x - academyHostile.target.root.position.x, toB(spawn.point).z - academyHostile.target.root.position.z);
  };
  const resetAcademyHostile = () => {
    if (!academyHostile) return;
    adapter.clearTacticalAll(); academyHostile.attacks.clear(); academyHostile.attackSerial.clear(); academyHostile.traces.forEach(trace => trace.endAttack()); academyHostile.fire.reset(); academyHostile.interceptor.reset(); academyHostile.blockEligible.set("AREN_NATIVE_JKA_V1", false); academyHostile.blockEligible.set("NARA_NATIVE_JKA_V1", false); academyHostile.rangedHealth.set("AREN_NATIVE_JKA_V1", 100); academyHostile.rangedHealth.set("NARA_NATIVE_JKA_V1", 100);
    placeAcademyHostile(academyHostileInitialHit); academyHostile.target.reset();
  };
  const queueAcademyHostileAttack = (actorId: "AREN" | "NARA") => {
    if (!academyHostile) return { accepted: false as const, reason: "HOSTILE_NOT_LOADED" };
    if (!tacticalPause.paused) { status.textContent = "ATTACK_TARGET REJECTED · PAUSE_REQUIRED"; return { accepted: false as const, reason: "PAUSE_REQUIRED" }; }
    adapter.selectTacticalActor(actorId);
    return adapter.queueTacticalAttack(academyHostile.target.targetId);
  };
  const runAcademyHostileCase = (caseId: string) => {
    if (!academyHostile) return { caseId, pass: false, reason: "HOSTILE_NOT_LOADED" };
    resetAcademyHostile();
    const pauseFor = (label: string) => { if (!tacticalPause.paused) tacticalPause.pause(label); };
    const resumeFor = (label: string) => { if (tacticalPause.paused) tacticalPause.resume(label); };
    if (caseId === "H1") { pauseFor(caseId); adapter.selectTacticalActor("AREN"); const friendlyA = adapter.queueTacticalAttack("NARA"); adapter.selectTacticalActor("NARA"); const friendlyB = adapter.queueTacticalAttack("AREN"); resumeFor(caseId); return { caseId, friendlyA, friendlyB, pass: !friendlyA.accepted && !friendlyB.accepted }; }
    if (caseId === "H2") { pauseFor(caseId); const queued = queueAcademyHostileAttack("AREN"); resumeFor(caseId); return { caseId, queued, target: academyHostile.target.targetId }; }
    if (caseId === "H3") { pauseFor(caseId); const queued = queueAcademyHostileAttack("NARA"); resumeFor(caseId); return { caseId, queued, target: academyHostile.target.targetId }; }
    if (caseId === "H4") { placeAcademyHostile(academyHostileFarHit); pauseFor(caseId); const queued = queueAcademyHostileAttack("AREN"); resumeFor(caseId); return { caseId, queued, targetRoom: academyHostile.hit.room }; }
    if (caseId === "H5") { pauseFor(caseId); const attack = queueAcademyHostileAttack("AREN"); const state = adapter.state() as any; const destination = { x: Number(state.position[0]) + 1.2, y: Number(state.position[1]), z: Number(state.position[2]) + .8 }; adapter.selectTacticalActor("NARA"); const move = adapter.queueTacticalMove(destination); resumeFor(caseId); return { caseId, attack, move }; }
    if (caseId === "H6") { pauseFor(caseId); const aren = queueAcademyHostileAttack("AREN"); const nara = queueAcademyHostileAttack("NARA"); resumeFor(caseId); return { caseId, aren, nara }; }
    if (caseId === "H7") { pauseFor(caseId); const first = queueAcademyHostileAttack("AREN"); adapter.selectTacticalActor("AREN"); const second = adapter.queueTacticalAttack(academyHostile.target.targetId); resumeFor(caseId); window.setTimeout(() => { if (!academyHostile.target.targetable) { pauseFor("H7_DEAD_TARGET"); adapter.selectTacticalActor("AREN"); const dead = adapter.queueTacticalAttack(academyHostile.target.targetId); resumeFor("H7_DEAD_TARGET"); (window as any).__w2372G3HAcademyDeadTarget = dead; } }, 2300); return { caseId, first, second }; }
    if (caseId === "H8") { pauseFor(caseId); const queued = queueAcademyHostileAttack("AREN"); resumeFor(caseId); window.setTimeout(() => tacticalPause.pause("H8_MID_ATTACK"), 500); window.setTimeout(() => tacticalPause.resume("H8_RESUME_ATTACK"), 1800); return { caseId, queued }; }
    if (caseId === "H10") { pauseFor(caseId); const rows: any[] = []; for (let i = 0; i < 30; i++) { const actor = i % 2 ? "NARA" : "AREN" as const; adapter.selectTacticalActor(actor); rows.push(i % 3 ? adapter.queueTacticalAttack(academyHostile.target.targetId) : adapter.queueTacticalMove({ x: (i % 4) - 1, y: 0, z: (i % 3) - 1 })); if (i % 5 === 4) adapter.clearTacticalSelected(); } resumeFor(caseId); return { caseId, operations: rows.length, accepted: rows.filter(row => row.accepted).length }; }
    return { caseId, pass: true, target: academyHostile.target.targetId };
  };
  const showAcademyHostileResult = (result: unknown) => {
    clean = false; status.style.display = "block"; routeSummaryText = JSON.stringify({ academyHostile: result }, null, 2); status.dataset.hostileCase = routeSummaryText; status.textContent = routeSummaryText; publish();
  };
  if (jkaParryLabMode || (!jkaReadyTransitionDiag && !gripInspectPose && !joleeNpcEnabled)) await attachJoleeSaber();

  const joleeBladeSegment = (): BladeSegment | undefined => {
    if (!joleeBladeBaseAnchor || !joleeBladeTipAnchor) return undefined;
    return { start: joleeBladeBaseAnchor.getAbsolutePosition().clone(), end: joleeBladeTipAnchor.getAbsolutePosition().clone() };
  };
  const findJoleeClip = (name: string) => joleeNpc?.asset.animationGroups.find(group => group.name.toLowerCase() === name.toLowerCase());
  const playJoleeClip = (name: string, loop: boolean) => {
    const group = findJoleeClip(name);
    if (!group) throw new Error("JOLEE_CLIP_MISSING:" + name);
    joleeNpc?.asset.animationGroups.forEach(candidate => { if (candidate !== group) candidate.stop(); });
    group.start(loop, 1);
    return group;
  };
  const setJoleeParryReady = (enabled: boolean) => {
    if (!joleeNpc || !jkaParryLabMode) return;
    joleeParryState = enabled ? "PARRY_READY" : "NOT_PARRYING";
    joleeParryResponsePlaying = false;
    playJoleeClip(enabled ? "g2r1" : "pause1", true);
  };
  const freezeJoleeReadyPose = () => {
    const group = findJoleeClip("g2r1");
    if (group) group.pause();
  };
  const playJoleeParryResponse = () => {
    if (!joleeNpc || joleeParryResponsePlaying) return;
    joleeParryResponsePlaying = true;
    joleeParryState = "PARRY_RESPONSE";
    const group = playJoleeClip("c2p1", false);
    group.onAnimationEndObservable.addOnce(() => {
      joleeParryResponsePlaying = false;
      if (joleeNpc && jkaParryLabMode) { joleeParryState = "PARRY_READY"; playJoleeClip("g2r1", true); }
    });
  };
  const playArenDefenseResponse = (direction: SaberParryDirection = "TOP") => {
    if (!jkaReverseParryLabMode || arenDefenseResponsePlaying) return;
    const clipName = leaderProfile.leaderCombatProfile?.groups.parryResponses?.[direction]
      ?? leaderProfile.leaderCombatProfile?.groups.parryResponse;
    const group = clipName ? leaderAsset.animationGroups.find(candidate => candidate.name === clipName) : null;
    if (!group) throw new Error("W237_2F3_PARRY_RESPONSE_CLIP_MISSING:" + String(clipName));
    arenDefenseResponsePlaying = true;
    arenDefenseResponseGroup = group;
    arenDefenseResponseDirection = direction;
    arenDefenseResponseCount += 1;
    arenBlockState = "PARRY_RESPONSE";
    leaderAsset.animationGroups.forEach(candidate => candidate.stop());
    group.start(false, 1);
    group.onAnimationEndObservable.addOnce(() => {
      arenDefenseResponsePlaying = false;
      arenDefenseResponseGroup = null;
      if (jkaReverseParryLabMode) {
        arenBlockState = manualBlockInputActive ? "BLOCK_READY" : "NOT_PARRYING";
        setReady(true, manualBlockInputActive ? "DEV_PARRY_RESPONSE_RECOVER_BLOCK" : "DEV_PARRY_RESPONSE_RECOVER_READY");
        setReadyPose(true, true);
      }
      publish();
    });
    publish();
  };
  const setArenBlockState = (enabled: boolean) => {
    if (!jkaReverseParryLabMode) return;
    manualBlockInputActive = enabled;
    if (arenDefenseResponsePlaying) {
      // Do not interrupt the one-shot response. The held-input state is
      // sampled when the native clip completes.
      arenBlockState = "PARRY_RESPONSE";
      publish();
      return;
    }
    arenBlockState = enabled ? "BLOCK_READY" : "NOT_PARRYING";
    // BLOCK_READY remains the certified JKA_SABER_READY hold pose. The
    // authentic native response is only played after physical contact.
    setReady(true, enabled ? "DEV_MANUAL_BLOCK" : "DEV_MANUAL_BLOCK_RELEASE");
    publish();
  };
  const onReverseBlockKey = (event: KeyboardEvent) => {
    if (!jkaReverseParryLabMode || event.key.toLowerCase() !== "b") return;
    if (event.type === "keydown" && !event.repeat) { event.preventDefault(); setArenBlockState(true); }
    if (event.type === "keyup") { event.preventDefault(); setArenBlockState(false); }
  };
  if (jkaParryLabMode) {
    if (leaderProfile.id !== "aren-native-jka-v1" || !joleeNpc || !joleeBladeBaseAnchor || !joleeBladeTipAnchor) {
      throw new Error("W237_2F1_PARRY_LOAD_GATE_FAIL: ROSH_NATIVE_AND_JOLEE_SABERS_REQUIRED");
    }
    parryController = new SaberParryController(
      jkaReverseParryLabMode ? JOLEE_PARRY_ACTOR_ID : activeLeaderCharacterId,
      jkaReverseParryLabMode ? AREN_BLOCK_ACTOR_ID : JOLEE_PARRY_ACTOR_ID,
      0.08,
    );
    if (!jkaReverseParryLabMode) setJoleeParryReady(true);
  }

  const panel = document.createElement("div");
  panel.id = "jediAcademyPartyPanel";
  panel.style.cssText = "position:fixed;left:14px;bottom:14px;z-index:80;width:min(430px,calc(100vw - 28px));padding:12px;background:#101922e8;color:#f3eedf;border:1px solid #8c7650;border-radius:8px;font:12px system-ui;box-shadow:0 8px 28px #0009";
  document.body.appendChild(panel);
  const header = document.createElement("div");
  header.style.cssText = "font-weight:700;font-size:15px;margin-bottom:8px";
  header.textContent = "KOTOR I · JEDI ENCLAVE · PARTY WALKTHROUGH";
  panel.appendChild(header);
  const controls = document.createElement("div");
  controls.style.cssText = "display:flex;flex-wrap:wrap;gap:5px";
  panel.appendChild(controls);
  const status = document.createElement("div");
  status.id = "w2372PartyStatus";
  status.style.cssText = "font:11px ui-monospace,Consolas,monospace;white-space:pre-wrap;margin-top:8px;max-height:22vh;overflow:auto;display:none";
  panel.appendChild(status);
  const gripInspectionOutput = document.createElement("pre");
  gripInspectionOutput.id = "w2372NativeGripInspection";
  gripInspectionOutput.style.cssText = "font:10px ui-monospace,Consolas,monospace;white-space:pre-wrap;max-height:58vh;overflow:auto;margin:8px 0 0;color:#f3eedf";
  gripInspectionOutput.hidden = true;
  panel.appendChild(gripInspectionOutput);
  const joleePrompt = document.createElement("div");
  joleePrompt.id = "w2372JoleeNpcPrompt";
  joleePrompt.style.cssText = "position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:78;padding:9px 13px;background:#101922e8;color:#f3eedf;border:1px solid #8c7650;border-radius:6px;font:13px ui-monospace,Consolas,monospace;display:none;pointer-events:none";
  if (joleeNpcEnabled) document.body.appendChild(joleePrompt);
  let joleeInteractionTriggered = false;
  let joleeInteractionCount = 0;
  let joleePromptVisible = false;
  const distanceToJoleeNpc = () => { if (!joleeNpc) return Infinity; const playerPosition = adapter.interactionOrigin(), npcPosition = joleeNpc.root.getAbsolutePosition(); return Math.hypot(playerPosition.x - npcPosition.x, playerPosition.z - npcPosition.z); };
  const triggerJoleeInteraction = () => {
    if (tacticalPause.paused) return false;
    if (!joleeNpc || distanceToJoleeNpc() > 2.25) return false;
    joleeInteractionTriggered = true; joleeInteractionCount++;
    joleePrompt.textContent = "JOLEE_INTERACTION_TRIGGERED";
    joleePrompt.style.display = "block";
    return true;
  };
  const syncJoleeNpcPresentation = (visibleRooms?: string[]) => {
    if (!joleeNpc) return;
    const visible = !visibleRooms || visibleRooms.some(room => room.toLowerCase() === joleeNpc!.hit.room.toLowerCase());
    joleeNpc.root.setEnabled(visible);
    const distance = distanceToJoleeNpc();
    joleePromptVisible = visible && distance <= 2.25;
    if (!joleeInteractionTriggered) {
      joleePrompt.textContent = "E  ·  Talk to Jolee";
      joleePrompt.style.display = joleePromptVisible ? "block" : "none";
    }
  };
  const onJoleeInteractKey = (event: KeyboardEvent) => {
    if (event.code === "KeyE" && !event.repeat && triggerJoleeInteraction()) event.preventDefault();
  };
  if (joleeNpcEnabled) window.addEventListener("keydown", onJoleeInteractKey);
  const onTacticalPauseKey = (event: KeyboardEvent) => {
    if (!jkaControlSwapMode || event.key.toLowerCase() !== "p" || event.repeat) return;
    event.preventDefault();
    tacticalPause.toggle("KEY_P");
    publish();
  };
  window.addEventListener("keydown", onTacticalPauseKey);
  const button = (label: string, run: () => void) => {
    const b = document.createElement("button"); b.textContent = label;
    b.style.cssText = "border:1px solid #657f8a;border-radius:4px;background:#253847;color:white;padding:7px 9px;cursor:pointer;font:11px system-ui";
    b.onclick = run; controls.appendChild(b); return b;
  };
  let rootResetButton: HTMLButtonElement | null = null;
  const setJkaRootResetEnabled = (enabled: boolean) => {
    jkaRootResetEnabled = enabled;
    jkaRootResetAssets.forEach(({ asset }) => asset.setAnimatedRootsResetEnabled(enabled));
    const url = new URL(location.href);
    url.searchParams.set("jkaRootReset", enabled ? "on" : "off");
    history.replaceState(null, "", url);
    if (rootResetButton) rootResetButton.textContent = `JKA ROOT RESET · ${enabled ? "ON" : "OFF"}`;
    publish();
  };
  const requestResetSnapshot = (label: "IDLE" | "WALK" | "ATTACK") => {
    jkaRootResetAssets.forEach(({ actorId, asset }) => asset.requestAnimatedRootResetSnapshot(`${actorId}_${label}`));
    status.style.display = "block";
    status.textContent = `ROOT RESET SNAPSHOT ARMED · ${label} · next animation evaluation only`;
  };
  if (jkaRootResetAssets.length) {
    rootResetButton = button(`JKA ROOT RESET · ${jkaRootResetEnabled ? "ON" : "OFF"}`, () => setJkaRootResetEnabled(!jkaRootResetEnabled));
    button("SNAPSHOT NEXT RESET · IDLE", () => requestResetSnapshot("IDLE"));
    button("SNAPSHOT NEXT RESET · WALK", () => requestResetSnapshot("WALK"));
    if (calebJkaSelected) button("SNAPSHOT NEXT RESET · ATTACK", () => requestResetSnapshot("ATTACK"));
  }
  const groundingFootSamples = new Map<string, any>();
  // DEV-only observation of Babylon's real Nara groups.  This deliberately
  // observes transitions instead of attempting to correct animation state.
  const naraAttackGroupNames = new Set<string>(naraJkaProfile?.leaderCombatProfile
    ? [naraJkaProfile.leaderCombatProfile.groups.attackStart, naraJkaProfile.leaderCombatProfile.groups.attack, naraJkaProfile.leaderCombatProfile.groups.attackReturn]
    : []);
  const naraAnimationAudit = { sequence: 0, lastPlaying: new Set<string>(), samples: [] as any[], transitions: [] as any[] };
  const captureNaraAnimationAudit = (label: string) => {
    if (!jkaNaraFollower) return null;
    const groups = jkaNaraFollower.asset.animationGroups.map((group: any) => ({
      name: group.name, isStarted: Boolean(group.isStarted), isPlaying: Boolean(group.isPlaying), paused: Boolean(group.isPaused),
      loopAnimation: Boolean(group.loopAnimation), currentFrame: Number(group.getCurrentFrame().toFixed(3)), speedRatio: Number(group.speedRatio ?? 1),
      category: naraAttackGroupNames.has(group.name) ? "ATTACK" : "OTHER",
    })).filter((group: any) => group.isStarted || group.isPlaying || group.paused);
    const playing = new Set(groups.map((group: any) => group.name));
    for (const name of playing) if (!naraAnimationAudit.lastPlaying.has(name)) naraAnimationAudit.transitions.push({ sequence: ++naraAnimationAudit.sequence, event: "START", name, label, tacticalPause: tacticalPause.snapshot(), controlled: adapter.controlledActorId, selected: adapter.tacticalOrderSelectionSnapshot()?.selectedMemberId ?? null });
    for (const name of naraAnimationAudit.lastPlaying) if (!playing.has(name)) naraAnimationAudit.transitions.push({ sequence: ++naraAnimationAudit.sequence, event: "END", name, label, tacticalPause: tacticalPause.snapshot(), controlled: adapter.controlledActorId, selected: adapter.tacticalOrderSelectionSnapshot()?.selectedMemberId ?? null });
    naraAnimationAudit.lastPlaying = playing;
    const followerState = (jkaNaraFollower as any).state?.() ?? {};
    const tacticalSnapshot = adapter.tacticalExecutorSnapshot();
    const tacticalActive = Boolean(tacticalSnapshot?.activeCommands?.NARA);
    const sample = { label, logicalState: followerState.requestedSemantic ?? "IDLE", combatState: groups.some((group: any) => group.category === "ATTACK") ? "ATTACK_ACTIVE" : "READY", selectedAnimation: followerState.animation ?? null, playingAnimationGroups: groups, tacticalCommandState: tacticalSnapshot?.activeCommands?.NARA?.state ?? "NONE", movementAuthority: tacticalActive ? "TACTICAL_ORDER_EXECUTION" : adapter.controlledActorId === "NARA" ? "DIRECT_PLAYER_CONTROL" : "FOLLOWER_CONTROL", directControlled: adapter.controlledActorId === "NARA", followerActive: adapter.followerActorId === "NARA" };
    naraAnimationAudit.samples.push(sample); if (naraAnimationAudit.samples.length > 80) naraAnimationAudit.samples.shift();
    if (naraAnimationAudit.transitions.length > 80) naraAnimationAudit.transitions.shift();
    return { latest: sample, transitions: [...naraAnimationAudit.transitions], samples: [...naraAnimationAudit.samples] };
  };
  const sampleActorFootGrounding = (key: string, asset: ImportedAsset, actorRoot: TransformNode, visualRoot: TransformNode, floorY: number, pose: string, clip: string) => {
    actorRoot.computeWorldMatrix(true); visualRoot.computeWorldMatrix(true); asset.root.computeWorldMatrix(true);
    const feet = measureSkinnedFootSoles(asset.meshes);
    const rootWorld = actorRoot.getAbsolutePosition();
    const visualWorld = visualRoot.getAbsolutePosition();
    const row = { actorId: key, pose, clip, floorSource: "accepted source WOK face", floorY,
      actorRootWorld: actorRoot.getAbsolutePosition().asArray(), capsuleFootY: rootWorld.y,
      visualRootLocal: visualRoot.position.asArray(), visualRootWorld: visualWorld.asArray(), importedRootWorld: asset.root.getAbsolutePosition().asArray(),
      footSoles: feet,
      leftFootToWokM: feet.left.lowestY == null ? null : Number((feet.left.lowestY - floorY).toFixed(4)),
      rightFootToWokM: feet.right.lowestY == null ? null : Number((feet.right.lowestY - floorY).toFixed(4)),
      lowestFootToWokM: feet.lowestY == null ? null : Number((feet.lowestY - floorY).toFixed(4)) };
    groundingFootSamples.set(key, row);
    return row;
  };
  const publish = () => {
    const party = adapter.state() as any, vis = party.vis;
    const followers = new Map<string, any>((party.companions ?? []).map((f: any) => [f.id, f]));
    const presentation = (id: "Aren" | "Nara" | "Jolee") => {
      if (id === "Jolee" && joleeNpc) {
        const poseBounds = measurePoseBounds(joleeNpc.asset.meshes);
        return { role: "ACADEMY_NPC", controller: "STANDALONE_NPC", partyMember: false,
          position: [...joleeNpc.hit.point], room: joleeNpc.hit.room, face: joleeNpc.hit.face,
          animation: joleeNpc.idleClip, idleStable: joleeNpc.asset.animationGroups.filter(group => group.isPlaying).map(group => group.name).join(",") === joleeNpc.idleClip,
          rootPosition: joleeNpc.root.getAbsolutePosition().asArray(), visualPosition: joleeNpc.visualRoot.getAbsolutePosition().asArray(),
          feetY: poseBounds.minY, floorY: joleeNpc.root.position.y, feetToFloorM: poseBounds.minY == null ? null : Number((poseBounds.minY - joleeNpc.root.position.y).toFixed(4)),
          activeAnimationGroups: joleeNpc.asset.animationGroups.filter(group => group.isPlaying).map(group => group.name) };
      }
      const follower = adapter.followers.find(f => f.id === id) as any;
      if (follower) {
        const state = follower.state();
        if (id !== "Nara" || !naraNativeSelected) return { ...state, rootResetDiagnostics: follower.asset.animatedRootResetDiagnostics() };
        const floorY = Number(follower.hit.point[2]);
        const grounding = groundingFootSamples.get("NARA") ?? sampleActorFootGrounding("NARA", follower.asset, follower.root, follower.visualRoot, floorY, "CURRENT", state.animation);
        return { ...state, grounding: { ...grounding, floorY, actorRootY: follower.root.getAbsolutePosition().y,
          visualRootLocalY: follower.visualRoot.position.y, runtimeVisualGroundOffsetM: follower.runtimeVisualGroundOffsetM },
          rootResetDiagnostics: follower.asset.animatedRootResetDiagnostics() };
      }
      const player = adapter.player, visual = player.visualRoot;
      visual.computeWorldMatrix(true);
      const forward = Vector3.TransformNormal(Vector3.Forward(), visual.getWorldMatrix()).normalize();
      const velocity = player.movementVelocity;
      const horizontal = new Vector3(velocity.x, 0, velocity.z);
      const asset = adapterAny.playersAsset as ImportedAsset;
      const skeletons = [...new Set(asset.meshes.map(m => m.skeleton).filter(Boolean))].map((sk: any) => ({
        name: sk.name, uniqueId: sk.uniqueId, bones: sk.bones.length, rootBones: sk.bones.filter((b: any) => !b.getParent()).map((b: any) => b.name),
        legBones: sk.bones.filter((b: any) => /thigh|shin|calf|foot|leg/i.test(b.name)).map((b: any) => b.name),
      }));
      const floorY = Number(party.navPosition?.[2] ?? player.root.position.y);
      const groundingSample = groundingFootSamples.get("AREN") ?? sampleActorFootGrounding("AREN", asset, player.root, visual, floorY, "CURRENT", player.animations.activeClipName);
      const staticBounds = measureVisualBounds(asset.meshes);
      const rootWorld = player.root.getAbsolutePosition().asArray();
      const visualWorld = visual.getAbsolutePosition().asArray();
      const assetWorld = asset.root.getAbsolutePosition().asArray();
      const grounding = { method: "CURRENT_SKINNED_VERTEX_DATA_TO_WORLD_VS_ACCEPTED_WOK_HEIGHT", floorSource: "accepted WOK face", floorY,
        actorRootY: rootWorld[1], visualRootLocalY: visual.position.y, visualRootWorldY: visualWorld[1], assetRootLocalY: asset.root.position.y,
        assetRootWorldY: assetWorld[1], capsuleFootY: rootWorld[1], poseFeetY: groundingSample.footSoles.lowestY,
        staticBoundsMinYDiagnosticOnly: staticBounds.minY, staticFeetToWokDeltaDiagnosticOnly: Number((staticBounds.feetY - floorY).toFixed(4)),
        leftFootY: groundingSample.footSoles.left.lowestY, rightFootY: groundingSample.footSoles.right.lowestY,
        leftFootToWokM: groundingSample.leftFootToWokM, rightFootToWokM: groundingSample.rightFootToWokM,
        feetToWokDelta: groundingSample.lowestFootToWokM, footMeasurement: groundingSample.footSoles,
        measurementPose: groundingSample.pose, measurementClip: groundingSample.clip,
        profileGroundOffsetM: leaderProfile.runtimeVisualGroundOffsetM ?? 0 };
      return { role: "LEADER", rootYaw: player.root.rotation.y, visualYaw: visual.rotation.y, velocity: velocity.asArray(), localForward: forward.asArray(), grounding,
        forwardDotVelocity: horizontal.lengthSquared() > 1e-8 ? Vector3.Dot(forward, horizontal.normalize()) : null,
        requestedSemantic: player.detailedLocomotionState, requestedClip: player.animations.animationResolutionTrace?.requestedClip ?? null,
        resolvedClip: player.animations.activeClipName, resolutionReason: player.animations.animationResolutionTrace?.resolutionReason ?? "PLAYER_ANIMATION_CONTROLLER",
        resolutionTrace: player.animations.animationResolutionTrace, animationFallback: /fallback/i.test(player.animations.availableAnimation),
        visualRootScale: visual.scaling.asArray(), skeletons, activeAnimationGroups: asset.animationGroups.filter(g => g.isPlaying).map(g => g.name),
        actorRootUniqueId: player.root.uniqueId, visualRootUniqueId: visual.uniqueId, importedRootUniqueId: asset.root.uniqueId,
        animationGroupCount: asset.animationGroups.length, importedAssetInstanceCount: 1, runtimeWrapperCount: 1, skeletonInstanceCount: skeletons.length,
        rootResetDiagnostics: asset.animatedRootResetDiagnostics() };
    };
    const partyLeaderRole = party.leaderId.startsWith("aren") ? "aren" : party.leaderId === "nara" ? "nara" : "jolee";
    const actorRows = {
      Aren: { characterId: activeLeaderCharacterId, ...(partyLeaderRole === "aren" ? { role: "LEADER", room: party.room, face: party.face, position: party.navPosition, animation: party.animation } : followers.get("Aren") ?? {}), presentation: presentation("Aren") },
      Nara: { characterId: activeNaraCharacterId, ...(partyLeaderRole === "nara" ? { role: "LEADER", room: party.room, face: party.face, position: party.navPosition, animation: party.animation } : followers.get("Nara") ?? {}), presentation: presentation("Nara") },
      Jolee: joleeNpc ? { characterId: "JOLEE_KOTOR1", role: "ACADEMY_NPC", controller: "STANDALONE_NPC", partyMember: false,
        room: joleeNpc.hit.room, face: joleeNpc.hit.face, position: [...joleeNpc.hit.point], animation: joleeNpc.idleClip,
        interaction: { promptVisible: joleePromptVisible, distanceM: Number(distanceToJoleeNpc().toFixed(3)), triggered: joleeInteractionTriggered, triggerCount: joleeInteractionCount },
        presentation: presentation("Jolee") }
        : { characterId: "JOLEE_KOTOR1", ...(partyLeaderRole === "jolee" ? { role: "LEADER", room: party.room, face: party.face, position: party.navPosition, animation: party.animation } : followers.get("Jolee") ?? {}), presentation: presentation("Jolee") },
    };
    const animationOwnershipTelemetry = Object.fromEntries(academyJkaActors.map(actor => {
      const audit = academyAnimationAudits.get(actor.actorId)!;
      const otherTargets = actor.actorId === leaderAnimationActorId ? naraTargetObjects : actor.actorId === jkaNaraActorId ? leaderTargetObjects : actor.actorId === "CALEB" ? meetraTargetObjects : calebTargetObjects;
      const active = audit.runtime(otherTargets);
      return [actor.actorId, {
        actorRootUniqueId: actor.actorRoot.uniqueId,
        visualRootUniqueId: actor.visualRoot.uniqueId,
        importedRootUniqueId: actor.asset.root.uniqueId,
        skeletonUniqueIds: [...new Set(actor.asset.meshes.map(mesh => mesh.skeleton).filter(Boolean))].map((skeleton: any) => skeleton.uniqueId),
        ...active,
      }];
    }));
    const rootResetTelemetry = Object.fromEntries(jkaRootResetAssets.map(({ actorId, asset }) => {
      const diagnostics = asset.animatedRootResetDiagnostics();
      return [actorId, { ...diagnostics, assetPath: actorId === leaderAnimationActorId ? leaderProfile.assetPath : naraJkaProfile?.assetPath ?? "",
        sha256: actorId === leaderAnimationActorId ? leaderAssetSha256 : naraJkaAssetSha256, rootResetObserverCount: diagnostics.observerCount }];
    }));
    const state = {
      status: "READY", worldId: "jedi_enclave_danm13", module: "danm13", area: "m13aa", mode: "CLEAN",
      readyInitialization: readyInitializationTelemetry(),
      leader: party.leaderId, activeLeader: { characterId: activeLeaderCharacterId, assetPath: leaderProfile.assetPath,
        sha256: leaderAssetSha256, jointCount: leaderJointCount, animationProfile: leaderProfile.leaderCombatProfile ? "JKA_NATIVE_LEADER_LOCOMOTION" : leaderProfile.id,
        combatProfile: leaderProfile.leaderCombatProfile ? "JKA_NATIVE_LEADER" : null, saberSocket: leaderProfile.leaderCombatProfile?.saberAttachmentNode ?? null },
      nativeCombo: jkaComboEnabled ? { enabled: true, state: activeNativeComboSession?.machine.state ?? "READY",
        comboId: activeNativeComboSession?.machine.comboId ?? null, inputResult: activeNativeComboSession?.inputResult ?? null,
        window: { start: JKA_NATIVE_COMBO_WINDOW.start, end: JKA_NATIVE_COMBO_WINDOW.end,
          sourceFrames: [JKA_NATIVE_COMBO_WINDOW.sourceStartFrame, JKA_NATIVE_COMBO_WINDOW.sourceEndFrame] },
        matrix: (window as any).__w2372EComboMatrix ?? null } : { enabled: false },
      gripInspection: (window as any).__w2372EGripInspection ?? null,
      activeNara: {
        characterId: activeNaraCharacterId,
        assetPath: naraJkaProfile?.assetPath ?? PLAYER_CHARACTERS["nara-belaya"].assetPath,
        sha256: naraJkaAssetSha256,
        jointCount: jkaNaraFollower ? [...new Set(jkaNaraFollower.asset.meshes.map(mesh => mesh.skeleton).filter(Boolean))].reduce((sum: number, skeleton: any) => sum + skeleton.bones.length, 0) : null,
        animationGroupCount: jkaNaraFollower?.asset.animationGroups.length ?? null,
        animationProfile: naraJkaProfile ? "JKA_NATIVE_FOLLOWER_PRESENTATION" : "KOTOR_XCOM_COMPANION",
        gameplayAuthority: "TACTICAL_COMPANION_FOLLOWER",
      },
      naraAnimationAudit: captureNaraAnimationAudit("PUBLISH"),
      actorCounts: { AREN_JKA_PROTOTYPE_V0: Number(leaderProfile.id === "aren-jka-prototype"), AREN_NATIVE_JKA_V1: Number(leaderProfile.id === "aren-native-jka-v1"), AREN_CALEB_JKA_CANDIDATE: Number(leaderProfile.id === "aren-caleb-jka-candidate"), OLD_AREN: 0, NARA_BELAYA: Number(!jkaNaraSelected), NARA_MEETRA_JKA_CANDIDATE: Number(naraCandidate), NARA_NATIVE_JKA_V1: Number(naraNativeSelected), JOLEE: 1, HOSTILE_MERCENARY_JKA_V1: Number(Boolean(academyHostile)), total: activePartySize + Number(Boolean(joleeNpc)) + Number(Boolean(academyHostile)) },
      actors: actorRows, animationOwnership: { actors: animationOwnershipTelemetry, sharedAnimationTargetCount: academySharedAnimationTargets.size }, rootReset: { enabled: jkaRootResetEnabled, actors: rootResetTelemetry }, jkaWeapons: { requested: jkaWeaponsOff ? "off" : "on", presentation: nativeJkaSaberSelected ? "JKA_NATIVE_TRAINING_SINGLE_SABER_V1" : "CURRENT_RUNTIME_SABER", ArenAttached: Boolean(genericSabers.get("Aren")?.isAttached), ArenAsset: genericSabers.get("Aren")?.saberPath ?? null, NaraAttached: Boolean(genericSabers.get("Nara")?.isAttached) }, actorsCount: activePartySize + Number(Boolean(joleeNpc)), partySize: activePartySize,
      hostileMercenary: academyHostile ? { actorId: academyHostile.target.targetId, faction: "HOSTILE", displayName: HOSTILE_MERCENARY_JKA_V1.displayName,
        assetPath: HOSTILE_MERCENARY_JKA_V1.assetPath, health: academyHostile.target.health, initialHealth: academyHostile.target.initialHealth, alive: academyHostile.target.alive, targetable: academyHostile.target.targetable,
        hitEvents: academyHostile.target.hitEvents, damageEvents: academyHostile.target.damageEvents, room: academyHostile.hit.room, face: academyHostile.hit.face,
        blaster: academyHostile.fire.telemetry(), rangedHealth: Object.fromEntries(academyHostile.rangedHealth), blockEligible: Object.fromEntries(academyHostile.blockEligible), interceptor: academyHostile.interceptor.telemetry(), muzzle: academyHostile.weapon.telemetry(),
        position: academyHostile.target.root.getAbsolutePosition().asArray(), nativeGroups: academyHostile.asset.animationGroups.map(group => group.name),
        activeGroups: academyHostile.asset.animationGroups.filter(group => group.isPlaying).map(group => group.name), weapon: { name: HOSTILE_MERCENARY_JKA_V1.weapon.name, socket: HOSTILE_MERCENARY_JKA_V1.weapon.socket, muzzleTag: HOSTILE_MERCENARY_JKA_V1.weapon.muzzleTag, firingImplemented: false },
        tacticalAttacks: Object.fromEntries([...academyHostile.attacks.entries()].map(([id, attack]) => [id, { ...attack }])) } : null,
      partyMembers: [activeLeaderCharacterId, ...adapter.followers.map((f: any) => f.id === "Nara" ? activeNaraCharacterId : f.id)],
      academyNpcCount: Number(Boolean(joleeNpc)), leaderCount: 1, cameraCount: scene.activeCamera ? 1 : 0,
      joleeNpc: joleeNpc ? { sourceAsset: PLAYER_CHARACTERS.jolee.assetPath, sha256: JOLEE_SOURCE_SHA256, instanceCount: 1, partyMember: false,
        room: joleeNpc.hit.room, face: joleeNpc.hit.face, position: [...joleeNpc.hit.point], idleClip: joleeNpc.idleClip,
        interaction: { promptVisible: joleePromptVisible, distanceM: Number(distanceToJoleeNpc().toFixed(3)), triggered: joleeInteractionTriggered, triggerCount: joleeInteractionCount } } : null,
      spawn: { source: "W237.1 wp_pc_start projected to WOK", leader: { room: spawn.room, face: spawn.face, position: spawn.point },
        followers: party.companions.map((f: any) => ({ id: f.id, room: f.spawnRoom, face: f.spawnFace, position: f.position, distanceFromLeader: Number(dist2(f.position as Point, spawn.point).toFixed(3)), initialization: "FORMATION_SPAWN_NOT_RECOVERY_TELEPORT" })) },
      reachableWalkableRooms: roomCoverage.reachableRooms, sourceUnreachableRooms: roomCoverage.unreachableRooms,
      visitedRooms: party.roomsVisited, roomTransitions: party.roomTransitions,
      doorCrossings: party.roomTransitions.filter((t: any) => t.gitDoorId).map((t: any) => ({ doorInstanceId: t.gitDoorId, fromRoom: t.fromRoom, toRoom: t.toRoom, semanticType: t.connection, visualModelStatus: "TIC_UDoor_01_SOURCE_UNRESOLVED; NO_FAKE_MODEL" })),
      patioExit: { instanceId: patioDoor?.instanceId ?? "danm13:doors:003", destination: "danm14aa", runtimeEnabled: false, distance: patioDoor && party.navPosition ? dist2(patioDoor.position, party.navPosition) : null },
      shipTrigger: { destination: "ebo_m12aa", runtimeEnabled: false },
      sabers: {
        Aren: (() => {
          const attachment = genericSabers.get("Aren");
          const socket = attachment?.socketNode;
          const handAnchor = socket?.parent as any;
          const segment = attachment?.getBladeSegment();
          const handBone = leaderSkeletons.flatMap((skeleton: any) => skeleton.bones ?? [])
            .find((bone: any) => /^(?:rhand|right.?hand)$/i.test(String(bone.name)));
          const handNode = handBone?.getTransformNode?.();
          const socketWorld = socket?.getAbsolutePosition();
          const handWorld = handNode?.getAbsolutePosition?.();
          return { provenance: "NERATHIS_RUNTIME_EQUIPMENT", attachment: attachment?.rightHandBoneName ?? null,
            parent: handAnchor?.name ?? null, instanceCount: attachment?.isAttached ? 1 : 0,
            bladeOn: (attachment?.glowMeshes.length ?? 0) === 2,
            presentation: attachment?.presentationDiagnostics ?? null,
            handBoneName: handBone?.name ?? null,
            socketLocalTranslation: socket?.position.asArray() ?? null,
            socketLocalRotationEulerDeg: socket ? socket.rotation.asArray().map(value => Number((value * 180 / Math.PI).toFixed(3))) : null,
            socketLocalQuaternion: socket?.rotationQuaternion?.asArray() ?? null,
            socketLocalScale: socket?.scaling.asArray() ?? null,
            socketWorldPosition: socketWorld?.asArray() ?? null,
            handBoneWorldPosition: handWorld?.asArray?.() ?? null,
            gripAnchorToHandBoneOriginDistanceM: socketWorld && handWorld ? Number(Vector3.Distance(socketWorld, handWorld).toFixed(4)) : null,
            bladeBaseWorld: segment?.start.asArray() ?? null, bladeTipWorld: segment?.end.asArray() ?? null,
            visibleBladeLengthM: segment ? Number(Vector3.Distance(segment.start, segment.end).toFixed(4)) : null };
        })(),
        Nara: { provenance: "NERATHIS_RUNTIME_EQUIPMENT", attachment: genericSabers.get("Nara")?.rightHandBoneName ?? null, parent: genericSabers.get("Nara")?.socketNode?.parent?.name ?? null, instanceCount: genericSabers.get("Nara")?.isAttached ? 1 : 0, bladeOn: (genericSabers.get("Nara")?.glowMeshes.length ?? 0) === 2 },
        Jolee: joleeNpc ? (jkaParryLabMode ? { ...(joleeWeapon ?? {}), parent: joleeHandName, instanceCount: joleeRoots.length ? 1 : 0, bladeOn: Boolean(joleeRoots.length) } : { provenance: "UNARMED_ACADEMY_NPC", instanceCount: 0, bladeOn: false }) : { ...(joleeWeapon ?? {}), parent: joleeHandName, instanceCount: joleeRoots.length ? 1 : 0, bladeOn: Boolean(joleeRoots.length) },
        totalRuntimeWeaponInstances: Number(Boolean(genericSabers.get("Aren")?.isAttached)) + Number(Boolean(genericSabers.get("Nara")?.isAttached)) + Number(joleeRoots.length),
      },
       saberTrace: { owner: traceOwner, socket: genericSabers.get("Aren")?.rightHandBoneName ?? null,
        phase: trace.phase, attackInstanceId: trace.attackInstanceId, bladeBaseWorld: trace.currentBase.asArray(),
        bladeTipWorld: trace.currentTip.asArray(), bladeLengthM: trace.bladeLengthM,
        bladeSamples: SaberTraceController.bladeSamples, traceEpsilonM: SaberTraceController.traceEpsilonM,
        maxObservedTipDeltaM: trace.maxObservedTipDeltaM, maxTraceCallsPerFrame: trace.maxTraceCallsPerFrame,
        framesTraced: trace.framesTraced, repeatContactsSuppressed: trace.repeatContactsSuppressed, debug: traceDebug,
         target: jkaReverseParryLabMode ? { targetId: AREN_BLOCK_ACTOR_ID, collider: "AREN_TORSO_SPHERE", center: adapter.player.root.getAbsolutePosition().add(new Vector3(0, 1.02, 0)).asArray(), radius: .45,
           floorPosition: adapter.player.root.getAbsolutePosition().asArray(), initialHealth: 100, health: reverseArenHealth,
           hitCount: reverseArenDamageEvents, damageEvents: reverseArenDamageEvents } : jkaParryLabMode && joleeNpc ? { targetId: JOLEE_PARRY_ACTOR_ID, collider: "JOLEE_TORSO_SPHERE", center: joleeNpc.root.getAbsolutePosition().add(new Vector3(0, 1.02, 0)).asArray(), radius: .45,
           floorPosition: joleeNpc.root.getAbsolutePosition().asArray(), initialHealth: 100, health: joleeHealth,
           hitCount: joleeBodyHitEvents, damageEvents: joleeBodyDamageEvents } : { targetId: dummy?.targetId ?? "ACADEMY_TRAINING_DUMMY_01", collider: "TORSO_SPHERE", center: dummy?.collider.center.asArray() ?? null, radius: dummy?.collider.radius ?? null,
           floorPosition: dummy?.floorPosition.asArray() ?? null, initialHealth: dummy?.initialHealth ?? null, health: dummy?.health ?? null,
           hitCount: dummy?.hitCount ?? 0, damageEvents: dummy?.damageEvents ?? 0 }, hitEvents: [...hitEvents],
         hitMatrix: (window as any).__w2372DHitMatrix ?? null },
       saberParry: jkaReverseParryLabMode ? {
          direction: "JOLEE_TO_ROSH", attacker: JOLEE_PARRY_ACTOR_ID, defender: AREN_BLOCK_ACTOR_ID,
          clashModel: "SWEPT_FINITE_SEGMENT_PROXIMITY", bodyTargets: [AREN_BLOCK_ACTOR_ID], trainingDummyInstantiated: false,
          clashRadiusM: parryController?.clashRadiusM ?? 0.08, defenderState: arenBlockState,
          blockInputActive: manualBlockInputActive, arenActiveGroup: leaderAsset.animationGroups.filter(group => group.isPlaying).map(group => group.name),
          defenseResponseClip: leaderProfile.leaderCombatProfile?.groups.parryResponses?.[arenDefenseResponseDirection]
            ?? leaderProfile.leaderCombatProfile?.groups.parryResponse ?? null,
          defenseResponseDirection: arenDefenseResponseDirection,
          directionClassification: lastArenDirectionClassification ? {
            direction: lastArenDirectionClassification.direction,
            incomingVectorWorld: lastArenDirectionClassification.incomingVectorWorld.asArray(),
            incomingVectorLocal: lastArenDirectionClassification.incomingVectorLocal.asArray(),
            contactPointLocal: lastArenDirectionClassification.contactPointLocal.asArray(),
            confidenceMargin: lastArenDirectionClassification.confidenceMargin,
          } : null,
          defenseResponsePlaying: arenDefenseResponsePlaying, defenseResponseCount: arenDefenseResponseCount,
          joleeBladeSource: "plane227/plane228/plane229/plane230 evaluated visible geometry", arenBladeSource: "WeaponAttachment.getBladeSegment()",
          joleeVisibleBladeLengthM, activeGroupNames: joleeNpc?.asset.animationGroups.filter(group => group.isPlaying).map(group => group.name) ?? [],
          parryEvents: reverseParryEvents.slice(-20), parryCount: reverseParryEvents.length,
          parryDedupCount: parryController?.dedupHits ?? 0, damageSuppressed: Boolean(reverseAttackInstanceId && parryController?.isDamageSuppressed(reverseAttackInstanceId, AREN_BLOCK_ACTOR_ID)),
          suppressedFrames: reverseSuppressedFrames, arenHealth: reverseArenHealth, bodyHitEvents: reverseArenDamageEvents, bodyDamageEvents: reverseArenDamageEvents,
          attackInstanceId: reverseAttackInstanceId, attackState: reverseAttackState, attackProgress: reverseAttackProgress,
          attackerBladePrevious: parryController?.attackerTrack.previous ? { base: parryController.attackerTrack.previous.start.asArray(), tip: parryController.attackerTrack.previous.end.asArray() } : null,
          attackerBladeCurrent: parryController?.attackerTrack.current ? { base: parryController.attackerTrack.current.start.asArray(), tip: parryController.attackerTrack.current.end.asArray() } : null,
          defenderBladePrevious: parryController?.defenderTrack.previous ? { base: parryController.defenderTrack.previous.start.asArray(), tip: parryController.defenderTrack.previous.end.asArray() } : null,
          defenderBladeCurrent: parryController?.defenderTrack.current ? { base: parryController.defenderTrack.current.start.asArray(), tip: parryController.defenderTrack.current.end.asArray() } : null,
          lastClash: parryController?.lastEvent ?? null,
        } : jkaParryLabMode ? {
          direction: "ROSH_TO_JOLEE", attacker: traceOwner, defender: JOLEE_PARRY_ACTOR_ID, clashModel: "SWEPT_FINITE_SEGMENT_PROXIMITY",
          bodyTargets: [JOLEE_PARRY_ACTOR_ID], trainingDummyInstantiated: false,
          clashRadiusM: parryController?.clashRadiusM ?? 0.08, defenderState: joleeParryState,
          joleeBladeSource: "plane227/plane228/plane229/plane230 evaluated visible geometry",
          joleeVisibleBladeLengthM, activeGroupNames: joleeNpc?.asset.animationGroups.filter(group => group.isPlaying).map(group => group.name) ?? [],
          parryEvents: parryEvents.slice(-20), parryCount: parryController?.parryEvents ?? 0,
          parryDedupCount: parryController?.dedupHits ?? 0, damageSuppressed: Boolean(parryController?.isDamageSuppressed(trace.attackInstanceId ?? undefined, JOLEE_PARRY_ACTOR_ID)),
          suppressedFrames: joleeParrySuppressedFrames, joleeHealth, bodyHitEvents: joleeBodyHitEvents, bodyDamageEvents: joleeBodyDamageEvents,
          bladePrevious: parryController?.attackerTrack.previous ? { base: parryController.attackerTrack.previous.start.asArray(), tip: parryController.attackerTrack.previous.end.asArray() } : null,
          bladeCurrent: parryController?.attackerTrack.current ? { base: parryController.attackerTrack.current.start.asArray(), tip: parryController.attackerTrack.current.end.asArray() } : null,
          joleeBladePrevious: parryController?.defenderTrack.previous ? { base: parryController.defenderTrack.previous.start.asArray(), tip: parryController.defenderTrack.previous.end.asArray() } : null,
          joleeBladeCurrent: parryController?.defenderTrack.current ? { base: parryController.defenderTrack.current.start.asArray(), tip: parryController.defenderTrack.current.end.asArray() } : null,
          lastClash: parryController?.lastEvent ?? null,
        } : null,
      armed, locomotion: { Aren: leaderProfile.nativeJkaRig ? "JKA_IDLE/JKA_WALK_FORWARD/JKA_RUN_FORWARD/JKA_WALK_BACKWARD/JKA_STRAFE_LEFT/JKA_STRAFE_RIGHT" : "idle_v2/walk_forward_v2/run_forward_v2", Nara: jkaNaraSelected ? "JKA_IDLE/JKA_WALK_FORWARD/JKA_RUN_FORWARD" : armed ? "g2r1/walkss/runss" : "pause1/walk/run", Jolee: joleeNpc ? "pause1 (standalone Academy NPC)" : armed ? "g2r1/walkss/runss" : "pause1/walkss/runss" },
      topology: { partySize: activePartySize, partyMembers: [leaderProfile.id, ...adapter.followers.map((f: any) => f.id)], joleeRole: joleeNpc ? "ACADEMY_NPC" : adapter.followers.some(f => f.id === "Jolee") ? "FOLLOWER" : "ABSENT" },
      interaction: { joleePromptVisible, joleeTriggered: joleeInteractionTriggered, joleeTriggerCount: joleeInteractionCount },
      camera: { active: scene.activeCamera?.name ?? null, targetLoss: 0, resetCount: 0, majorClippingIncidents: 0 },
      vis: { enabled: true, room: vis?.room ?? currentRoom, visibleRooms: vis?.visibleRooms ?? [], fallbackCount: visFallbackCount },
      runtime: { worldMeshes: render.length, enabledWorldMeshes: vis?.enabledMeshes ?? null, partyActors: activePartySize, visibleActors: activePartySize + Number(Boolean(joleeNpc)), activeSkeletons: scene.skeletons.length,
        activeAnimationGroups: scene.animationGroups.filter(g => g.isPlaying).length, fps: Math.round(engine.getFps()) },
      materialStats, runtimeErrors: [...errors], finalUrl: location.href,
      fullRoute: (window as any).__w2372FullRoute ?? null, routeProgress, leaderSmoke: (window as any).__w2372LeaderSmoke ?? null,
    };
    (window as any).__jediAcademyPartyState = state;
    (window as any).__w2372RootResetDiagnostic = state.rootReset;
    (window as any).__w2372ReadyAnimationOwnership = readyInitializationTelemetry();
    const combatTargetTelemetry = jkaReverseParryLabMode
      ? "AREN HP " + reverseArenHealth + " · BODY HITS " + reverseArenDamageEvents + " · BODY DAMAGE " + reverseArenDamageEvents + " · BLOCKS " + reverseParryEvents.length
      : jkaParryLabMode
      ? "JOLEE HP " + joleeHealth + " · BODY HITS " + joleeBodyHitEvents + " · BODY DAMAGE " + joleeBodyDamageEvents + " · PARRIES " + parryEvents.length
      : "DUMMY HP " + (dummy?.health ?? 0) + " · HITS " + (dummy?.hitCount ?? 0);
    const telemetry = "LEADER " + activeLeaderCharacterId + " · " + (party.room ?? "—") +
      "\n" + leaderProfile.assetPath + " · SHA256 " + leaderAssetSha256.slice(0, 12) + "… · joints " + leaderJointCount +
      "\nPROFILE " + (leaderProfile.leaderCombatProfile ? "JKA_NATIVE_LEADER" : leaderProfile.id) + " · SOCKET " + (leaderProfile.leaderCombatProfile?.saberAttachmentNode ?? "profile default") +
      "\nDIST " + Number(party.distance ?? 0).toFixed(1) + " m · VIS " + (vis?.room ?? "unknown") + " · fallback " + visFallbackCount +
      "\nNARA " + (followers.get("Nara")?.room ?? (party.leaderId === "nara" ? party.room : "—")) +
      " · JOLEE " + (joleeNpc ? "NPC " + joleeNpc.hit.room : followers.get("Jolee")?.room ?? (party.leaderId === "jolee" ? party.room : "—")) +
      "\nFEET/WOK Δ " + (actorRows.Aren.presentation.grounding.feetToWokDelta ?? "n/a") + " m · ROOT " + Number(actorRows.Aren.presentation.grounding.actorRootY).toFixed(3) + " · VISUAL " + Number(actorRows.Aren.presentation.grounding.visualRootWorldY).toFixed(3) +
      "\nPARTY " + activePartySize + " · " + (jkaWeaponsOff ? "WEAPONS OFF · " : (2 + Number(!joleeNpcEnabled)) + " SABERS · ") + "WASD walk · SHIFT run · mouse drag camera" +
      (joleeNpc ? "\nJOLEE NPC " + joleeNpc.hit.room + ":" + joleeNpc.hit.face + " · " + (joleePromptVisible ? "E · Talk" : "stationary") : "") +
      "\nBLADE " + trace.bladeLengthM.toFixed(3) + " m · " + trace.phase + " · " + combatTargetTelemetry +
      " · SWEEP Δ " + trace.maxObservedTipDeltaM.toFixed(3) + " m";    if (readyAnimationAuditPinned) { /* keep the selected diagnostic sample visible without per-frame DOM rewrites */ }
    else if (routeSummaryText) { status.dataset.routeSummary = routeSummaryText; status.textContent = routeSummaryText; }
    else status.textContent = telemetry;
    return state;
  };
  let armed = false;
  let readyPoseApplied = false;
  let firstAttackCount = 0;
  const traceOwner = activeLeaderCharacterId;
  const trace = new SaberTraceController(traceOwner);
  const dummy = jkaParryLabMode || jkaHostileMode ? null : (() => {
    const dummyInitialHit = resolve([spawn.point[0] + 1.4, spawn.point[1], spawn.point[2]], nav, true, .7, .7, [spawn.room]) ?? spawn;
    return new SaberTrainingTarget(scene, "ACADEMY_TRAINING_DUMMY_01", toB(dummyInitialHit.point));
  })();
  const DEV_DAMAGE = 10;
  const reverseTrace = jkaReverseParryLabMode ? new SaberTraceController(JOLEE_PARRY_ACTOR_ID) : null;
  let reverseAttackGroup: any = null;
  let reverseAttackInstanceId: string | null = null;
  let reverseAttackState: "JOLEE_READY" | "JOLEE_ATTACK_START" | "JOLEE_ATTACK_ACTIVE" | "JOLEE_ATTACK_RETURN" = "JOLEE_READY";
  let reverseAttackProgress = 0;
  let reverseAttackCount = 0;
  let reverseArenHealth = 100;
  let reverseArenDamageEvents = 0;
  let reverseParryEvents: Array<{ attackInstanceId: string; defenderId: string; distanceM: number; sampleCount: number; sampleT: number; contactPoint: number[] }> = [];
  let reverseSuppressedFrames = 0;
  let reversePlacement: any = null;
  const reverseJoleePath: Array<{ base: Vector3; tip: Vector3 }> = [];
  let reversePathCapture = false;
  let reverseReleaseBlockAtContact = false;
  let arenDefenseResponsePlaying = false;
  let arenDefenseResponseGroup: any = null;
  let arenDefenseResponseCount = 0;
  let arenDefenseResponseDirection: SaberParryDirection = "TOP";
  let lastArenDirectionClassification: SaberParryDirectionResult | null = null;
  const targetHud = document.createElement("div");
  targetHud.style.cssText = "position:fixed;right:12px;top:12px;z-index:75;padding:7px 10px;background:#101922c9;color:#f3eedf;border:1px solid #8c7650;border-radius:5px;font:12px ui-monospace,Consolas,monospace;pointer-events:none";
  targetHud.textContent = jkaReverseParryLabMode ? "AREN · 100 HP · 0 BODY HITS · 0 BLOCKS" : jkaParryLabMode ? "JOLEE · 100 HP · 0 BODY HITS · 0 PARRIES" : jkaHostileMode ? "RODIAN MERCENARY · 20 HP · 0 HITS" : "TRAINING DUMMY · 100 HP · 0 HITS";
  document.body.appendChild(targetHud);
  const hitEvents: Array<{ attackInstanceId: string; targetId: string; worldPoint: number[]; bladeT: number; timestamp: number }> = [];
  const parryEvents: Array<{ attackInstanceId: string; defenderId: string; distanceM: number; sampleCount: number; sampleT: number; contactPoint: number[] }> = [];
  let joleeHealth = 100;
  let joleeBodyDamageEvents = 0;
  let joleeBodyHitEvents = 0;
  let joleeParrySuppressedFrames = 0;
  const bladePath: Array<{ base: Vector3; tip: Vector3 }> = [];
  let captureBladePath = false, attackSequenceActive = false, traceDebug = false, deferParryResponse = false;
  let debugLines: Mesh[] = [];
  const clearDebugLines = () => { debugLines.forEach(line => line.dispose()); debugLines = []; };
  const sampleReverseBlade = (dt: number) => {
    if (!jkaReverseParryLabMode || !reverseTrace || !parryController) return;
    const joleeSegment = joleeBladeSegment();
    const arenSegment = genericSabers.get("Aren")?.getBladeSegment();
    if (!joleeSegment || !arenSegment) { reverseTrace.resetBladeHistory(); parryController.resetTracks(); return; }
    if (reverseAttackGroup) {
      const span = Math.max(1, Number(reverseAttackGroup.to) - Number(reverseAttackGroup.from));
      reverseAttackProgress = Math.max(0, Math.min(1, (Number(reverseAttackGroup.getCurrentFrame?.() ?? reverseAttackGroup.from) - Number(reverseAttackGroup.from)) / span));
      reverseAttackState = reverseAttackProgress < 0.2 ? "JOLEE_ATTACK_START" : reverseAttackProgress < 0.82 ? "JOLEE_ATTACK_ACTIVE" : "JOLEE_ATTACK_RETURN";
      if (reverseReleaseBlockAtContact && reverseAttackProgress >= 0.38) {
        reverseReleaseBlockAtContact = false;
        setArenBlockState(false);
      }
    }
    const reverseTracePhase = reverseAttackState === "JOLEE_ATTACK_ACTIVE" ? "ATTACK"
      : reverseAttackState === "JOLEE_ATTACK_START" ? "START"
      : reverseAttackState === "JOLEE_ATTACK_RETURN" ? "RETURN" : "READY";
    reverseTrace.setPhase(reverseTracePhase);
    if (reversePathCapture && reverseAttackState === "JOLEE_ATTACK_ACTIVE") reverseJoleePath.push({ base: joleeSegment.start.clone(), tip: joleeSegment.end.clone() });
    const arenTarget: SaberSphereTarget = {
      targetId: AREN_BLOCK_ACTOR_ID,
      center: adapter.player.root.getAbsolutePosition().add(new Vector3(0, 1.02, 0)),
      radius: 0.45,
    };
    const parryEvent = parryController.update({
      attackInstanceId: reverseAttackInstanceId ?? undefined,
      attackerId: JOLEE_PARRY_ACTOR_ID,
      attackerState: reverseAttackState === "JOLEE_ATTACK_ACTIVE" ? "ATTACK" : reverseAttackState,
      attackerBlade: joleeSegment,
      defenderId: AREN_BLOCK_ACTOR_ID,
      defenderState: arenBlockState,
      defenderBlade: arenSegment,
      defenderAlive: reverseArenHealth > 0,
      defenderStationary: true,
      defenderAttacking: false,
      bladesEnabled: true,
      deltaSeconds: dt,
    });
    if (parryEvent) {
      reverseParryEvents.push({ attackInstanceId: parryEvent.attackInstanceId, defenderId: parryEvent.defenderId,
        distanceM: parryEvent.distance, sampleCount: parryEvent.sampleCount, sampleT: parryEvent.sampleT, contactPoint: parryEvent.position.asArray() });
      lastArenDirectionClassification = classifyIncomingStrike({
        attackerPreviousBlade: parryEvent.attackerBladePrevious,
        attackerCurrentBlade: parryEvent.attackerBladeCurrent,
        contactPoint: parryEvent.position,
        defenderTransform: adapter.player.root,
      });
      playArenDefenseResponse(lastArenDirectionClassification.direction);
    }
    const suppressed = Boolean(reverseAttackInstanceId && parryController.isDamageSuppressed(reverseAttackInstanceId, AREN_BLOCK_ACTOR_ID));
    if (suppressed) reverseSuppressedFrames += 1;
    const bodyTarget = suppressed ? undefined : arenTarget;
    const event = reverseTrace.update(joleeSegment.start, joleeSegment.end, true, bodyTarget);
    if (event) {
      reverseArenDamageEvents += 1;
      reverseArenHealth = Math.max(0, reverseArenHealth - DEV_DAMAGE);
      targetHud.textContent = "HIT · -" + DEV_DAMAGE + " HP · AREN " + reverseArenHealth + " HP · " + reverseArenDamageEvents + " HITS";
    }
  };
  const sampleAcademyHostileBlade = () => {
    const runtime = academyHostile;
    if (!runtime || tacticalPause.paused) return;
    runtime.sampleCalls += 1;
    for (const [actorId, attack] of runtime.attacks) {
      if (attack.phase !== "ATTACK" || !runtime.target.targetable) continue;
      const attachment = genericSabers.get(actorId === "AREN" ? "Aren" : "Nara");
      const segment = attachment?.getBladeSegment();
      const trace = runtime.traces.get(actorId);
      if (!segment || !trace) { runtime.sampleMissingAttachment += 1; continue; }
      runtime.sampleUpdates += 1;
      trace.setPhase("ATTACK");
      const event = trace.update(segment.start, segment.end, true, {
        targetId: runtime.target.targetId,
        center: runtime.target.collider.center,
        radius: runtime.target.collider.radius,
      });
      if (event) runtime.target.applyHit(event, DEV_DAMAGE);
    }
  };
  const sampleBlade = (dt: number) => {
    if (jkaReverseParryLabMode) { sampleReverseBlade(dt); return; }
    if (!jkaParryLabMode && !jkaHostileMode) dummy!.update(dt);
    const segment = genericSabers.get("Aren")?.getBladeSegment();
    if (!segment) { trace.resetBladeHistory(); clearDebugLines(); return; }
    const joleeSegment = joleeBladeSegment();
    const joleeTarget: SaberSphereTarget | undefined = joleeNpc ? {
      targetId: JOLEE_PARRY_ACTOR_ID,
      center: joleeNpc.root.getAbsolutePosition().add(new Vector3(0, 1.02, 0)),
      radius: 0.45,
    } : undefined;
    const parryEvent = parryController?.update({
      attackInstanceId: trace.attackInstanceId ?? undefined,
      attackerId: traceOwner,
      attackerState: trace.phase,
      attackerBlade: segment,
      defenderId: JOLEE_PARRY_ACTOR_ID,
      defenderState: joleeParryState,
      defenderBlade: joleeSegment,
      defenderAlive: joleeHealth > 0,
      defenderStationary: true,
      defenderAttacking: false,
      bladesEnabled: Boolean(joleeSegment),
      deltaSeconds: dt,
    });
    if (parryEvent) {
      parryEvents.push({ attackInstanceId: parryEvent.attackInstanceId, defenderId: parryEvent.defenderId, distanceM: parryEvent.distance,
        sampleCount: parryEvent.sampleCount, sampleT: parryEvent.sampleT, contactPoint: parryEvent.position.asArray() });
      if (!deferParryResponse) playJoleeParryResponse();
    }
    if (parryController?.isDamageSuppressed(trace.attackInstanceId ?? undefined, JOLEE_PARRY_ACTOR_ID)) joleeParrySuppressedFrames += 1;
    const bodyTarget = jkaParryLabMode
      ? (parryController?.isDamageSuppressed(trace.attackInstanceId ?? undefined, JOLEE_PARRY_ACTOR_ID) ? undefined : joleeTarget)
      : jkaHostileMode ? undefined : (captureBladePath ? undefined : dummy!.collider);
    const event = trace.update(segment.start, segment.end, armed, bodyTarget);
    if (captureBladePath && trace.phase === "ATTACK") bladePath.push({ base: segment.start.clone(), tip: segment.end.clone() });
    if (event) {
      if (jkaParryLabMode && event.targetId === JOLEE_PARRY_ACTOR_ID) {
        joleeBodyHitEvents += 1;
        joleeBodyDamageEvents += 1;
        joleeHealth = Math.max(0, joleeHealth - DEV_DAMAGE);
        targetHud.textContent = "HIT · -" + DEV_DAMAGE + " HP · JOLEE " + joleeHealth + " HP · " + joleeBodyHitEvents + " HITS";
      } else if (dummy!.applyHit(event, DEV_DAMAGE)) {
        hitEvents.push({ attackInstanceId: event.attackInstanceId,
          targetId: event.targetId, worldPoint: event.worldPoint.asArray(), bladeT: event.bladeT, timestamp: event.timestamp });
        targetHud.textContent = "HIT · -" + DEV_DAMAGE + " HP · DUMMY " + dummy!.health + " HP · " + dummy!.hitCount + " HITS";
      }
    }
    if (traceDebug) {
      clearDebugLines();
      for (const [name, a, b, color] of [
        ["previous", trace.previousBase, trace.previousTip, new Color3(.2, .7, 1)],
        ["current", trace.currentBase, trace.currentTip, new Color3(1, .7, .15)],
        ["sweep", Vector3.Lerp(trace.previousBase, trace.previousTip, .5), Vector3.Lerp(trace.currentBase, trace.currentTip, .5), new Color3(1, .2, .2)],
      ] as Array<[string, Vector3, Vector3, Color3]>) {
        const line = MeshBuilder.CreateLines("W2372D_" + name, { points: [a, b] }, scene);
        line.color = color; line.isPickable = false; debugLines.push(line);
      }
    }
  };
  const calibrateDummyFromBlade = () => {
    if (jkaParryLabMode || !dummy) return null;
    const room = String(adapter.state().room ?? spawn.room);
    const leader = adapter.player.root.getAbsolutePosition();
    let best: { floor: Vector3; room: string; face: number; score: number; bladePoint: number[] } | null = null;
    for (const segment of bladePath) for (const t of [.3, .5, .7, .9]) {
      const point = Vector3.Lerp(segment.base, segment.tip, t);
      const distance = Math.hypot(point.x - leader.x, point.z - leader.z);
      if (distance < .6 || distance > 2.3) continue;
      const hit = resolve(fromB(point), nav, true, .3, 2.2, [room]);
      if (!hit) continue;
      const floor = toB(hit.point);
      const score = Math.abs(point.y - (floor.y + 1.02)) + hit.dist * 2 + Math.abs(distance - 1.1) * .15;
      if (!best || score < best.score) best = { floor, room: hit.room, face: hit.face, score, bladePoint: point.asArray() };
    }
    if (best) dummy!.placeOnFloor(best.floor);
    return best && { room: best.room, face: best.face, floor: best.floor.asArray(), bladePoint: best.bladePoint, score: best.score,
       predictedContact: best.score < dummy!.collider.radius + SaberTraceController.traceEpsilonM };
  };
  const joleeInitialPosition = joleeNpc?.root.position.clone() ?? null;
  const arenInitialPosition = adapter.player.root.position.clone();
  const resetParryTest = (parryReady = true) => {
    if (!jkaParryLabMode || !joleeNpc || !parryController) return;
    if (joleeInitialPosition) joleeNpc.root.position.copyFrom(joleeInitialPosition);
    joleeHealth = 100; joleeBodyDamageEvents = 0; joleeBodyHitEvents = 0; joleeParrySuppressedFrames = 0;
    parryEvents.length = 0; trace.endAttack(); parryController.reset();
    joleeRoots.forEach(root => root.setEnabled(true));
    targetHud.textContent = "JOLEE · 100 HP · 0 BODY HITS · 0 PARRIES";
    setJoleeParryReady(parryReady);
  };
  const moveJoleeBladeToRoshPath = () => {
    if (!joleeNpc || !joleeBladeBaseAnchor || !joleeBladeTipAnchor || !bladePath.length) return null;
    const currentSegment = joleeBladeSegment();
    if (!currentSegment) return null;
    const currentMidpoint = Vector3.Lerp(currentSegment.start, currentSegment.end, .5);
    // Choose a Rosh attack sample at the defender's current blade height before
    // translating Jolee in X/Z. This keeps the test on the visible blade
    // geometry instead of relying on a fixed path index.
    const desired = bladePath.reduce((best, candidate) => {
      const candidateMidpoint = Vector3.Lerp(candidate.base, candidate.tip, .5);
      const verticalError = Math.abs(candidateMidpoint.y - currentMidpoint.y);
      const horizontalError = Math.hypot(candidateMidpoint.x - currentMidpoint.x, candidateMidpoint.z - currentMidpoint.z);
      const score = verticalError + horizontalError * .05;
      return score < best.score ? { candidate, candidateMidpoint, score } : best;
    }, (() => {
      const candidate = bladePath[0];
      return { candidate, candidateMidpoint: Vector3.Lerp(candidate.base, candidate.tip, .5), score: Number.POSITIVE_INFINITY };
    })());
    const desiredMidpoint = desired.candidateMidpoint;
    const delta = desiredMidpoint.subtract(currentMidpoint);
    // The parry lab owns this temporary duel placement. Move the NPC root in
    // all three axes so the visible saber and its body target remain the same
    // actor at the selected contact point. Normal Academy NPC placement is
    // untouched because this helper is only used by jkaParryLab cases.
    // root has its own facing rotation, so position is local to that rotated
    // node. Apply the measured world-space delta through the absolute setter
    // to keep the blade midpoint and body target together.
    joleeNpc.root.setAbsolutePosition(joleeNpc.root.getAbsolutePosition().add(delta));
    return { desiredMidpoint: desiredMidpoint.asArray(), delta: delta.asArray(), placementScore: desired.score, roshPathSamples: bladePath.length, joleeBladeLengthM: joleeVisibleBladeLengthM };
  };
  const runParryCase = async (caseId: "A_READY" | "B_UNBLOCKED_DAMAGE" | "C_FIRST_PARRY" | "D_MULTI_FRAME_DEDUP" | "E_SECOND_ATTACK" | "F_MISS" | "G_100MS_SWEEP") => {
    if (!jkaParryLabMode || !parryController || !joleeNpc) return { caseId, pass: false, reason: "PARRY_LAB_DISABLED" };
    if (caseId === "G_100MS_SWEEP") {
      const detector = new SaberClashDetector(.08);
      const a = { speed: 0 } as any, b = { speed: 0 } as any;
      detector.updateTrack(a, { start: new Vector3(-1, 0, 0), end: new Vector3(-1, 1, 0) }, .1);
      detector.updateTrack(b, { start: new Vector3(1, 0, 0), end: new Vector3(1, 1, 0) }, .1);
      detector.updateTrack(a, { start: new Vector3(1, 0, 0), end: new Vector3(1, 1, 0) }, .1);
      detector.updateTrack(b, { start: new Vector3(-1, 0, 0), end: new Vector3(-1, 1, 0) }, .1);
      const clash = detector.detect(a, b);
      return { caseId, pass: Boolean(clash), instantaneousBladesMiss: true, sweptClash: clash ? { distanceM: clash.distance, sampleCount: clash.sampleCount, sampleT: clash.sampleT, contactPoint: clash.position.asArray() } : null };
    }
    resetParryTest(caseId === "A_READY" || caseId === "C_FIRST_PARRY" || caseId === "D_MULTI_FRAME_DEDUP" || caseId === "E_SECOND_ATTACK");
    if (caseId === "A_READY") return { caseId, pass: true, parryEvents: 0, bodyDamageEvents: 0, joleeState: joleeParryState };
    let parryPlacement: any = null;
    if (caseId === "C_FIRST_PARRY" || caseId === "D_MULTI_FRAME_DEDUP" || caseId === "E_SECOND_ATTACK" || caseId === "B_UNBLOCKED_DAMAGE") {
      // Capture a fresh Rosh attack path for every independent case. The
      // attack root can be at a different evaluated pose after the previous
      // case, so reusing an older path can place Jolee against stale geometry.
      bladePath.length = 0;
      setJoleeParryReady(false);
      await playFirstAttackSequence(true);
      joleeHealth = 100; joleeBodyDamageEvents = 0; joleeBodyHitEvents = 0; joleeParrySuppressedFrames = 0;
      parryEvents.length = 0; trace.endAttack(); parryController.reset();
      setJoleeParryReady(caseId !== "B_UNBLOCKED_DAMAGE");
      // Let Babylon evaluate the requested Jolee pose before reading the
      // visible blade anchors. Without one rendered frame the anchors still
      // describe the previous pose, so placement can appear correct in stale
      // data while the rendered saber remains out of plane.
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      parryPlacement = moveJoleeBladeToRoshPath();
      if (caseId === "C_FIRST_PARRY" || caseId === "D_MULTI_FRAME_DEDUP" || caseId === "E_SECOND_ATTACK") {
        // Keep the controlled defender's ready blade rigid during this
        // deterministic contact test. c2p1 still takes ownership on a real
        // parry and restores g2r1 afterward.
        freezeJoleeReadyPose();
      }
      deferParryResponse = caseId === "D_MULTI_FRAME_DEDUP";
    }
    if (caseId === "F_MISS") {
      setJoleeParryReady(false);
      if (joleeInitialPosition) joleeNpc.root.position.copyFrom(joleeInitialPosition);
    }
    const result = await playFirstAttackSequence(false);
    if (deferParryResponse && parryEvents.length) playJoleeParryResponse();
    deferParryResponse = false;
    return {
      caseId, pass: caseId === "B_UNBLOCKED_DAMAGE" ? parryEvents.length === 0 && joleeBodyDamageEvents === 1 :
        caseId === "F_MISS" ? parryEvents.length === 0 && joleeBodyDamageEvents === 0 : parryEvents.length === 1 && joleeBodyDamageEvents === 0,
      attackInstanceId: result.attackInstanceId, parryEvents: parryEvents.length, bodyDamageEvents: joleeBodyDamageEvents,
      joleeHealth, joleeState: joleeParryState, suppressedFrames: joleeParrySuppressedFrames,
      parryDedupAttempts: parryController.dedupHits,
      lastParry: parryEvents.at(-1) ?? null, placement: parryPlacement,
      joleeBladeAfterPlacement: joleeBladeSegment() ? { start: joleeBladeSegment()!.start.asArray(), end: joleeBladeSegment()!.end.asArray(), lengthM: joleeVisibleBladeLengthM } : null,
      attack: result,
    };
  };
  const runParryMatrix = async () => {
    const rows: Record<string, any> = {};
    for (const caseId of ["A_READY", "B_UNBLOCKED_DAMAGE", "C_FIRST_PARRY", "D_MULTI_FRAME_DEDUP", "E_SECOND_ATTACK", "F_MISS", "G_100MS_SWEEP"] as const) {
      rows[caseId] = await runParryCase(caseId);
    }
    const matrix = { rows, clashModel: "SWEPT_FINITE_SEGMENT_PROXIMITY", clashRadiusM: parryController?.clashRadiusM ?? .08,
      temporalSampling: "adaptive endpoint displacement <= 0.04 m", joleeBladeSource: "evaluated plane227/228/229/230 bounds", joleeVisibleBladeLengthM,
      parryDedupKey: "attackInstanceId + defenderId", bodyDamageSuppression: "remainder of attackInstanceId for JOLEE_KOTOR1_ACADEMY_NPC" };
    (window as any).__w2372F1ParryMatrix = matrix;
    return matrix;
  };
  const setReadyPose = (enabled: boolean, force = false) => {
    if (readyPoseApplied === enabled && !force) return;
    adapter.player.setCombatReadyPose(enabled);
    genericSabers.forEach(s => s.setReadyPose(enabled));
    readyPoseApplied = enabled;
  };
  const activeWritersForActor = (actorId: string, asset: ImportedAsset) => {
    const otherTargets = actorId === leaderAnimationActorId ? naraTargetObjects : actorId === jkaNaraActorId ? leaderTargetObjects : actorId === "CALEB" ? meetraTargetObjects : actorId === "MEETRA" ? calebTargetObjects : new Set<any>();
    const groups = asset.animationGroups.filter(group =>
      group.isStarted && (group.isPlaying || (group as any).isPaused));
    const animatableSet = new Set<any>();
    const writers: any[] = [];
    const byTarget = new Map<any, Map<string, any[]>>();
    for (const group of groups) {
      const animatables: any[] = (group as any).animatables ?? (group as any).getAnimatables?.() ?? (group as any)._animatables ?? [];
      for (const animatable of animatables) {
        animatableSet.add(animatable);
        const runtimeAnimations: any[] = animatable.getAnimations?.() ?? [];
        for (const runtime of runtimeAnimations) {
          const animation = runtime.animation ?? runtime._animation ?? null;
          const target = runtime.target ?? animation?.target ?? null;
          const animatedProperty = animation?.targetProperty ?? runtime._targetProperty ?? null;
          const row = {
            actorId,
            groupName: group.name,
            targetName: target?.name ?? null,
            targetUniqueId: target?.uniqueId ?? null,
            targetInsideActorAsset: academyAnimationAudits.get(actorId)?.targetObjects.has(target) ?? false,
            targetBelongsToOtherJkaActor: otherTargets.has(target),
            animatedProperty,
            animationUniqueIdentity: identityForAnimationObject(animation),
            animatableUniqueIdentity: identityForAnimationObject(animatable),
          };
          writers.push(row);
          if (target && animatedProperty) {
            let properties = byTarget.get(target);
            if (!properties) { properties = new Map<string, any[]>(); byTarget.set(target, properties); }
            let owners = properties.get(animatedProperty);
            if (!owners) { owners = []; properties.set(animatedProperty, owners); }
            owners.push(row);
          }
        }
      }
    }
    const duplicateTargetPropertyWriters: any[] = [];
    byTarget.forEach((properties, target) => properties.forEach((owners, animatedProperty) => {
      const distinctAnimatables = new Set(owners.map(owner => owner.animatableUniqueIdentity));
      if (distinctAnimatables.size >= 2) duplicateTargetPropertyWriters.push({
        targetName: target?.name ?? null, targetUniqueId: target?.uniqueId ?? null, animatedProperty,
        distinctAnimatableCount: distinctAnimatables.size,
        owners: owners.map(owner => ({ groupName: owner.groupName, animationUniqueIdentity: owner.animationUniqueIdentity, animatableUniqueIdentity: owner.animatableUniqueIdentity })),
      });
    }));
    return {
      activeGroupNames: groups.map(group => group.name),
      activeAnimationGroupCount: groups.length,
      activeAnimatableCount: animatableSet.size,
      activeAnimatables: [...animatableSet].map(animatable => ({ animatableUniqueIdentity: identityForAnimationObject(animatable) })),
      writers,
      duplicateTargetPropertyWriters,
      foreignTargetCount: writers.filter(row => !row.targetInsideActorAsset).length,
      crossActorTargetCount: writers.filter(row => row.targetBelongsToOtherJkaActor).length,
    };
  };
  const readyTransformSnapshot = (node: any) => {
    node.computeWorldMatrix?.(true);
    const world = node.getWorldMatrix?.();
    return {
      name: node.name ?? null, uniqueId: node.uniqueId ?? null,
      parentName: node.parent?.name ?? null, parentUniqueId: node.parent?.uniqueId ?? null,
      position: node.position?.asArray?.() ?? null,
      rotationQuaternion: node.rotationQuaternion?.asArray?.() ?? null,
      rotation: node.rotation?.asArray?.() ?? null,
      scaling: node.scaling?.asArray?.() ?? null,
      worldPosition: node.getAbsolutePosition?.().asArray?.() ?? null,
      worldMatrix: world?.asArray?.() ?? null,
    };
  };
  const captureReadyAnimationSample = (label: string) => {
    if (readyAnimationSamples.length >= 80) readyAnimationSamples.shift();
    const actors = Object.fromEntries(academyJkaActors.map(({ actorId, asset, actorRoot, visualRoot }) => {
      const actorSnapshot = activeWritersForActor(actorId, asset);
      const selected = new Set<any>([asset.root, ...asset.root.getDescendants(false)]);
      for (const mesh of asset.meshes) for (const skeleton of mesh.skeleton ? [mesh.skeleton] : []) {
        for (const bone of skeleton.bones) { const node = bone.getTransformNode?.(); if (node) selected.add(node); }
      }
      const relevant = /^(model_root|pelvis|lower_lumbar|upper_lumbar|thoracic|cervical|cranium|lhumerus|rhumerus|lhand|rhand|lfemur.*|rfemur.*|ltibia|rtibia)$/i;
      return [actorId, {
        actorRoot: readyTransformSnapshot(actorRoot),
        visualRoot: readyTransformSnapshot(visualRoot),
        importedRoot: readyTransformSnapshot(asset.root),
        skeletons: [...new Set(asset.meshes.map(mesh => mesh.skeleton).filter(Boolean))].map((skeleton: any) => ({
          name: skeleton.name, uniqueId: skeleton.uniqueId,
          rootBones: skeleton.bones.filter((bone: any) => !bone.getParent()).map((bone: any) => bone.name),
        })),
        selectedNodes: [...selected].filter(node => relevant.test(String(node?.name ?? ""))).map(readyTransformSnapshot),
        ...actorSnapshot,
      }];
    }));
    const duplicateWriters = Object.values(actors as Record<string, any>).flatMap(actor => actor.duplicateTargetPropertyWriters);
    const sample = {
      label, timestamp: performance.now(), renderedFrameIndex, armed,
      leaderSemantic: adapter.player.detailedLocomotionState,
      leaderClip: adapter.player.animations.activeClipName,
      leaderHorizontalSpeed: adapter.player.horizontalSpeed,
      rootResetEnabled: jkaRootResetEnabled,
      actors, duplicateTargetPropertyWriters: duplicateWriters,
    };
    readyAnimationSamples.push(sample);
    const telemetry = readyInitializationTelemetry();
    (window as any).__w2372ReadyAnimationOwnership = { ...telemetry, latestSample: sample, samples: readyAnimationSamples.map(row => row) };
    return sample;
  };
  const captureReadyTransitionSnapshot = (caseId: string, point: "SAME_FRAME" | "FRAME_PLUS_1" | "FRAME_PLUS_5") => {
    const actorId = calebJkaSelected ? "CALEB" : "AREN_NATIVE";
    const actor = academyJkaActors.find(row => row.actorId === actorId);
    if (!actor) throw new Error("READY_TRANSITION_DIAG_REQUIRES_SELECTED_JKA_ACTOR");
    const skeletons = [...new Set(actor.asset.meshes.map(mesh => mesh.skeleton).filter(Boolean))] as any[];
    const boneTransforms = skeletons.flatMap(skeleton => skeleton.bones.map((bone: any, boneIndex: number) => {
      const node = bone.getTransformNode?.() ?? null;
      const parentBone = bone.getParent?.() ?? null;
      const localMatrix = bone.getLocalMatrix?.() ?? null;
      const absoluteMatrix = bone.getAbsoluteMatrix?.() ?? null;
      const finalMatrix = bone.getFinalMatrix?.() ?? null;
      return {
        skeletonName: skeleton.name, skeletonUniqueId: skeleton.uniqueId, boneIndex,
        boneName: bone.name, parentBoneName: parentBone?.name ?? null,
        transformNode: node ? readyTransformSnapshot(node) : null,
        position: node?.position?.asArray?.() ?? bone.getPosition?.().asArray?.() ?? null,
        rotationQuaternion: node?.rotationQuaternion?.asArray?.() ?? bone.getRotationQuaternion?.().asArray?.() ?? null,
        scaling: node?.scaling?.asArray?.() ?? bone.getScale?.().asArray?.() ?? null,
        boneLocalMatrix: localMatrix?.asArray?.() ?? null,
        boneAbsoluteMatrix: absoluteMatrix?.asArray?.() ?? null,
        boneFinalMatrix: finalMatrix?.asArray?.() ?? null,
      };
    }));
    const actorWriters = activeWritersForActor(actorId, actor.asset);
    const activeGroups = actor.asset.animationGroups.filter(group =>
      group.isStarted && (group.isPlaying || (group as any).isPaused));
    const animationGroupState = activeGroups.map(group => ({
      name: group.name, uniqueId: group.uniqueId, from: group.from, to: group.to,
      currentFrame: group.getCurrentFrame(), isPlaying: group.isPlaying, isStarted: group.isStarted,
      isPaused: Boolean((group as any).isPaused), loopAnimation: group.loopAnimation,
      animatables: ((group as any).getAnimatables?.() ?? (group as any)._animatables ?? []).map((animatable: any) => ({
        uniqueIdentity: identityForAnimationObject(animatable), speedRatio: animatable.getSpeedRatio?.() ?? animatable._speedRatio ?? null,
        paused: animatable.paused ?? null, masterFrame: animatable.masterFrame ?? null,
      })),
      channels: group.targetedAnimations.map(targeted => {
        const animation: any = targeted.animation;
        const keys = animation.getKeys?.() ?? [];
        return {
          targetName: targeted.target?.name ?? null, targetUniqueId: targeted.target?.uniqueId ?? null,
          animatedProperty: animation.targetProperty ?? null,
          animationUniqueIdentity: identityForAnimationObject(animation), framePerSecond: animation.framePerSecond ?? null,
          enableBlending: animation.enableBlending ?? null, blendingSpeed: animation.blendingSpeed ?? null,
          loopMode: animation.loopMode ?? null, keyCount: keys.length,
          firstKeyFrame: keys[0]?.frame ?? null, lastKeyFrame: keys.at(-1)?.frame ?? null,
        };
      }),
    }));
    return {
      caseId, point, renderedFrameIndex, timestampMs: performance.now(), armed,
      leaderSemantic: adapter.player.detailedLocomotionState,
      leaderLocomotionClip: adapter.player.animations.activeClipName,
      combatClip: adapter.player.combatAnimationState,
      actorRoot: readyTransformSnapshot(actor.actorRoot),
      visualRoot: readyTransformSnapshot(actor.visualRoot),
      importedRoot: readyTransformSnapshot(actor.asset.root),
      skeletonRoots: skeletons.map(skeleton => ({
        name: skeleton.name, uniqueId: skeleton.uniqueId,
        animationPropertiesOverride: skeleton.animationPropertiesOverride ? {
          enableBlending: skeleton.animationPropertiesOverride.enableBlending,
          blendingSpeed: skeleton.animationPropertiesOverride.blendingSpeed,
        } : null,
        rootBones: skeleton.bones.filter((bone: any) => !bone.getParent()).map((bone: any) => bone.name),
      })),
      boneCount: boneTransforms.length, boneTransforms,
      activeGroupNames: actorWriters.activeGroupNames,
      activeAnimationGroupCount: actorWriters.activeAnimationGroupCount,
      activeAnimatableCount: actorWriters.activeAnimatableCount,
      writers: actorWriters.writers,
      duplicateTargetPropertyWriterCount: actorWriters.duplicateTargetPropertyWriters.length,
      duplicateTargetPropertyWriters: actorWriters.duplicateTargetPropertyWriters,
      animationGroupState,
      camera: readyDiagnosticCameraPreset ? {
        yaw: adapter.camera.yaw, pitch: adapter.camera.pitch, distance: adapter.camera.distance,
        actualDistance: adapter.camera.actualDistance, fov: adapter.camera.camera.fov,
        position: adapter.camera.camera.position.asArray(),
      } : null,
    };
  };
  const scheduleReadyFrameSamples = (callId: number) => {
    pendingReadyFrameSamples.push(
      { dueFrame: renderedFrameIndex + 1, label: "AFTER_1_RENDERED_FRAME_CALL_" + callId },
      { dueFrame: renderedFrameIndex + 5, label: "AFTER_5_RENDERED_FRAMES_CALL_" + callId },
    );
  };
  const initializeExplorationState = () => {
    armed = false;
    adapter.followers.forEach((f: any) => f.setArmed(false));
    setLeaderLocomotion(false);
    genericSabers.forEach(saber => saber.setBladeExtension(0));
    trace.resetBladeHistory();
    setReadyPose(false, true);
  };
  const setLeaderLocomotion = (ready: boolean) => {
    const def = adapter.player.characterDefinition;
    if (!def.exactLocomotion) return;
    if (!ready) { adapter.player.setExactLocomotionProfile(def.exactLocomotion); return; }
    if (def.id === "aren-jka-prototype") { adapter.player.setExactLocomotionProfile(def.exactLocomotion); return; }
    const clips = def.semanticClips;
    const idle = clips?.saberIdle ?? clips?.saberReady ?? def.exactLocomotion.idle;
    const walk = clips?.saberWalk ?? def.exactLocomotion.walk;
    const run = clips?.saberRun ?? def.exactLocomotion.run;
    adapter.player.setExactLocomotionProfile({ idle, walk, run, source: (def.exactLocomotion.source ?? "character-definition") + "; armed Jedi semantics" });
  };
  const setReady = (ready: boolean, reason = "RUNTIME_CALL") => {
    const callId = readyTransitionCalls.length + 1;
    const call = { callId, reason, requestedReady: ready, renderedFrameIndex, timestamp: performance.now() };
    readyTransitionCalls.push(call);
    if (reason.startsWith("INIT_")) readyInitializationCalls.push({ ...call });
    captureReadyAnimationSample("BEFORE_SET_READY_CALL_" + callId + "_" + reason);
    armed = ready;
    adapter.followers.forEach((f: any) => f.setArmed(ready));
    setLeaderLocomotion(ready);
    genericSabers.forEach(s => s.setBladeExtension(ready ? 1 : 0));
    if (!ready) trace.resetBladeHistory();
    joleeRoots.forEach(root => root.setEnabled(ready));
    setReadyPose(ready);
    captureReadyAnimationSample("AFTER_SET_READY_SAME_FRAME_CALL_" + callId + "_" + reason);
    scheduleReadyFrameSamples(callId);
    publish();
    return { armed, leaderClip: adapter.player.animations.activeClipName, followerClips: adapter.followers.map((f: any) => ({ id: f.id, locomotion: f.profile.locomotion, jediReady: f.profile.jediReady, semantic: f.requestedSemantic, resolved: f.activeAnimation })) };
  };
  const firstReadyPoseDifference = (expected: any, actual: any) => {
    const compareValue = (left: any, right: any, path: string): any => {
      if (typeof left === "number" && typeof right === "number") {
        return Math.abs(left - right) > 1e-5 ? { path, expected: left, actual: right } : null;
      }
      if (Array.isArray(left) && Array.isArray(right)) {
        for (let index = 0; index < Math.min(left.length, right.length); index++) {
          const difference = compareValue(left[index], right[index], `${path}[${index}]`);
          if (difference) return difference;
        }
        return left.length === right.length ? null : { path: path + ".length", expected: left.length, actual: right.length };
      }
      return null;
    };
    for (const rootName of ["actorRoot", "visualRoot", "importedRoot"] as const) {
      const expectedRoot = expected?.[rootName], actualRoot = actual?.[rootName];
      if (!expectedRoot || !actualRoot) continue;
      for (const property of ["position", "rotationQuaternion", "rotation", "scaling", "worldPosition", "worldMatrix"] as const) {
        const difference = compareValue(expectedRoot[property], actualRoot[property], `${rootName}.${property}`);
        if (difference) return { node: rootName, property, ...difference };
      }
    }
    const expectedBones = expected?.boneTransforms ?? [], actualBones = actual?.boneTransforms ?? [];
    for (let index = 0; index < Math.min(expectedBones.length, actualBones.length); index++) {
      const a = expectedBones[index], b = actualBones[index];
      for (const property of ["position", "rotationQuaternion", "scaling", "boneLocalMatrix", "boneAbsoluteMatrix", "boneFinalMatrix"] as const) {
        const difference = compareValue(a[property], b[property], `boneTransforms[${index}].${property}`);
        if (difference) return { node: a.boneName, property, boneIndex: index, ...difference };
      }
      const aNode = a.transformNode, bNode = b.transformNode;
      if (aNode && bNode) for (const property of ["position", "rotationQuaternion", "rotation", "scaling", "worldPosition", "worldMatrix"] as const) {
        const difference = compareValue(aNode[property], bNode[property], `boneTransforms[${index}].transformNode.${property}`);
        if (difference) return { node: a.boneName, property, boneIndex: index, ...difference };
      }
    }
    if (expectedBones.length !== actualBones.length) return { node: "skeleton", property: "boneCount", expected: expectedBones.length, actual: actualBones.length };
    return null;
  };
  const resetReadyTransitionCase = () => {
    armed = false;
    readyPoseApplied = false;
    adapter.setInputEnabled(false);
    if (jkaReadyTransitionDiag) {
      adapter.player.setPosition(toB(spawn.point));
      adapter.player.setFacingYaw(adapter.spawnYaw);
    }
    adapter.player.setCombatReadyPose(false);
    adapter.player.clearLeaderProfileClip();
    leaderAsset.animationGroups.forEach(group => group.stop());
    if (leaderProfile.exactLocomotion) adapter.player.setExactLocomotionProfile(leaderProfile.exactLocomotion);
    adapter.player.animations.setState("IDLE");
  };
  const startDirectReadyControl = () => {
    const clip = leaderProfile.leaderCombatProfile?.groups.saberReady;
    const group = clip ? leaderAsset.animationGroups.find(candidate => candidate.name === clip) : null;
    if (!group) throw new Error("READY_TRANSITION_DIAG_DIRECT_CLIP_MISSING:" + String(clip));
    leaderAsset.animationGroups.forEach(candidate => candidate.stop());
    group.start(true, 1, group.from, group.to);
    group.goToFrame(group.from);
    return group.name;
  };
  const resetReadyDiagnosticCamera = () => {
    if (!readyDiagnosticCameraPreset) return;
    adapter.camera.yaw = readyDiagnosticCameraPreset.yaw;
    adapter.camera.pitch = readyDiagnosticCameraPreset.pitch;
    adapter.camera.distance = readyDiagnosticCameraPreset.distance;
    (adapter.camera as any).effectiveDistance = readyDiagnosticCameraPreset.distance;
    (adapter.camera as any).revealRemaining = 0;
    adapter.camera.camera.fov = readyDiagnosticCameraPreset.fov;
    adapter.camera.update();
  };
  const runReadyTransitionCase = async (caseId: "A_DIRECT_READY" | "B_LOCOMOTION_PROFILE_ONLY" | "C_COMBAT_READY_ONLY" | "D_DIRECT_PROFILE_CLIP" | "E_CURRENT_FULL_TRANSITION" | "F_CALEB_NATIVE_PROFILE_BRANCH") => {
    if (!jkaReadyTransitionDiag || (caseId === "F_CALEB_NATIVE_PROFILE_BRANCH" && !calebJkaSelected) || readyTransitionCaseRuns.some(row => row.status === "RUNNING")) {
      return { pass: false, reason: "READY_TRANSITION_DIAG_UNAVAILABLE_OR_BUSY" };
    }
    const profileReadyClip = leaderProfile.leaderCombatProfile?.groups.saberReady;
    if (!profileReadyClip) return { pass: false, reason: "JKA_SABER_READY_PROFILE_MISSING" };
    const run: any = { caseId, actorId: calebJkaSelected ? "CALEB" : "AREN_NATIVE", status: "RUNNING", requestedClip: profileReadyClip, snapshots: [], startedAtMs: performance.now() };
    readyTransitionCaseRuns.push(run);
    activeReadyTransitionCase = run;
    status.style.display = "block";
    status.textContent = "RUNNING " + caseId + " · capturing same-frame, +1, +5 and 53 joints…";
    (window as any).__w2372D3CTransitionCases = { cases: readyTransitionCaseRuns, activeCase: caseId, runtimeErrors: errors };
    try {
      resetReadyTransitionCase();
      resetReadyDiagnosticCamera();
      if (caseId === "A_DIRECT_READY") {
        run.operation = "AnimationGroup.start(loop=true) + goToFrame(from)";
        run.resolvedClip = startDirectReadyControl();
      } else if (caseId === "B_LOCOMOTION_PROFILE_ONLY") {
        run.setup = "Direct ready control pose, then isolate setLeaderLocomotion(true)";
        run.setupClip = startDirectReadyControl();
        setLeaderLocomotion(true);
        run.operation = "setLeaderLocomotion(true) only; no combat-ready call";
      } else if (caseId === "C_COMBAT_READY_ONLY") {
        run.setup = "Exploration profile + IDLE";
        run.operation = "player.setCombatReadyPose(true) only";
        adapter.player.setCombatReadyPose(true);
      } else if (caseId === "D_DIRECT_PROFILE_CLIP") {
        run.setup = "Exploration profile + IDLE";
        run.operation = "player.playLeaderProfileClip(saberReady, true) only";
        run.resolvedClip = adapter.player.playLeaderProfileClip(profileReadyClip, true) ? profileReadyClip : null;
      } else if (caseId === "F_CALEB_NATIVE_PROFILE_BRANCH") {
        const exactProfile = adapter.player.characterDefinition.exactLocomotion;
        if (!exactProfile) throw new Error("CALEB_EXACT_LOCOMOTION_PROFILE_MISSING");
        run.setup = "Exploration profile + IDLE";
        adapter.player.setExactLocomotionProfile(exactProfile);
        run.profileApplied = exactProfile;
        adapter.player.setCombatReadyPose(true);
        run.operation = "setExactLocomotionProfile(def.exactLocomotion) then player.setCombatReadyPose(true)";
      } else {
        run.setup = "Exploration profile + IDLE";
        setLeaderLocomotion(true);
        run.operation = "setLeaderLocomotion(true) then player.setCombatReadyPose(true)";
        adapter.player.setCombatReadyPose(true);
      }
      run.sameFrame = captureReadyTransitionSnapshot(caseId, "SAME_FRAME");
      run.status = "CAPTURING_FRAMES";
      const frameCapture = new Promise<any>(resolve => { run.resolveFrames = resolve; });
      pendingReadyTransitionSamples.push(
        { dueFrame: renderedFrameIndex + 1, label: "FRAME_PLUS_1", caseId },
        { dueFrame: renderedFrameIndex + 5, label: "FRAME_PLUS_5", caseId },
      );
      const frameSamples = await frameCapture;
      run.status = "COMPLETE";
      run.completedAtMs = performance.now();
      run.activeGroupNames = frameSamples.framePlus5.activeGroupNames;
      run.activeAnimationGroupCount = frameSamples.framePlus5.activeAnimationGroupCount;
      run.activeAnimatables = frameSamples.framePlus5.activeAnimatableCount;
      run.duplicateWriterCount = frameSamples.framePlus5.duplicateTargetPropertyWriterCount;
      run.hierarchyAtFramePlus5 = {
        actorRoot: frameSamples.framePlus5.actorRoot,
        visualRoot: frameSamples.framePlus5.visualRoot,
        importedRoot: frameSamples.framePlus5.importedRoot,
        skeletonRoots: frameSamples.framePlus5.skeletonRoots,
        selectedJoints: frameSamples.framePlus5.boneTransforms.filter((bone: any) => /^(model_root|pelvis|lower_lumbar|upper_lumbar|thoracic|cervical|cranium|lhumerus|rhumerus|lradius|rradius|lhand|rhand|lfemur.*|rfemur.*|ltibia|rtibia|ltalus|rtalus)$/i.test(bone.boneName)),
      };
      if (caseId === "A_DIRECT_READY") run.matchAgainstReference = true;
      else {
        const referenceCaseId = caseId === "F_CALEB_NATIVE_PROFILE_BRANCH" ? "E_CURRENT_FULL_TRANSITION" : "A_DIRECT_READY";
        const reference = readyTransitionCaseRuns.find(row => row.caseId === referenceCaseId && row.status === "COMPLETE");
        run.comparisonReferenceCaseId = referenceCaseId;
        run.comparisonToReference = reference ? Object.fromEntries(["SAME_FRAME", "FRAME_PLUS_1", "FRAME_PLUS_5"].map(point => {
          const expected = point === "SAME_FRAME" ? reference.sameFrame : reference.frameSamples?.[point === "FRAME_PLUS_1" ? "framePlus1" : "framePlus5"];
          const actual = point === "SAME_FRAME" ? run.sameFrame : frameSamples[point === "FRAME_PLUS_1" ? "framePlus1" : "framePlus5"];
          const firstDifference = firstReadyPoseDifference(expected, actual);
          return [point, { matches: !firstDifference, firstDifference }];
        })) : null;
        run.matchAgainstReference = reference
          ? Object.values(run.comparisonToReference ?? {}).every((row: any) => row.matches)
          : null;
      }
      run.frameSamples = frameSamples;
      (window as any).__w2372D3CTransitionCases = {
        cases: readyTransitionCaseRuns,
        summary: Object.fromEntries(readyTransitionCaseRuns.filter(row => row.status === "COMPLETE").map(row => [row.caseId, {
          matchAgainstReference: row.matchAgainstReference, comparisonReferenceCaseId: row.comparisonReferenceCaseId, activeGroupNames: row.activeGroupNames,
          activeAnimationGroupCount: row.activeAnimationGroupCount, activeAnimatables: row.activeAnimatables,
          duplicateWriterCount: row.duplicateWriterCount, comparisonToReference: row.comparisonToReference,
        }])),
        settings: frameSamples.framePlus5.animationGroupState,
        profileAudit: readyProfileAudit,
      };
    const summary = { caseId, operation: run.operation, clip: profileReadyClip, activeGroups: run.activeGroupNames,
      activeGroupCount: run.activeAnimationGroupCount, activeAnimatables: run.activeAnimatables,
      duplicateWriters: run.duplicateWriterCount, matchAgainstReference: run.matchAgainstReference,
        comparisonReferenceCaseId: run.comparisonReferenceCaseId,
        firstDifference: run.comparisonToReference?.FRAME_PLUS_5?.firstDifference ?? null,
        actorRoot: run.hierarchyAtFramePlus5?.actorRoot, visualRoot: run.hierarchyAtFramePlus5?.visualRoot,
        importedRoot: run.hierarchyAtFramePlus5?.importedRoot, skeletonRoots: run.hierarchyAtFramePlus5?.skeletonRoots };
      routeSummaryText = JSON.stringify(summary, null, 2);
      status.style.display = "block"; status.textContent = routeSummaryText;
      return run;
    } catch (error) {
      run.status = "FAIL"; run.error = String(error); errors.push(run.error);
      status.style.display = "block"; status.textContent = JSON.stringify({ caseId, error: run.error }, null, 2);
      return run;
    } finally {
      activeReadyTransitionCase = null;
      const diagnosticText = status.textContent;
      const diagnosticSummary = status.dataset.routeSummary;
      publish();
      if (diagnosticText && diagnosticText !== "RUNNING " + caseId + " · capturing same-frame, +1, +5 and 53 joints…") {
        status.style.display = "block";
        status.textContent = diagnosticText;
        if (diagnosticSummary) status.dataset.routeSummary = diagnosticSummary;
      }
    }
  };
  const playFirstAttackSequence = async (dryRun = false) => {
    const profile = adapter.player.characterDefinition.leaderCombatProfile;
    if (!profile) return { pass: false, reason: "JKA_NATIVE_LEADER_PROFILE_REQUIRED" };
    if (attackSequenceActive) return { pass: false, reason: "ATTACK_ALREADY_ACTIVE" };
    if (!armed) setReady(true);
    const sequence = [profile.groups.attackStart, profile.groups.attack, profile.groups.attackReturn];
    const phases = ["START", "ATTACK", "RETURN"] as const;
    const played: Array<{ clip: string; durationSeconds: number }> = [];
    const gripSamples: any[] = [captureRoshSaberGripSample("READY_BEFORE_ATTACK")];
    const healthBefore = jkaParryLabMode ? joleeHealth : dummy!.health;
    const hitsBefore = jkaParryLabMode ? joleeBodyHitEvents : hitEvents.length;
    const attackInstanceId = trace.beginAttack();
    parryController?.beginAttack(attackInstanceId, traceOwner);
    attackSequenceActive = true; captureBladePath = dryRun;
    if (dryRun) bladePath.length = 0;
    adapter.setInputEnabled(false);
    setReadyPose(false);
    // This DEV choreography must consume simulation time, not wall-clock time:
    // tactical pause freezes an authored attack rather than allowing its later
    // phases to be selected while Babylon groups are paused.
    const waitGameplayMilliseconds = async (milliseconds: number) => {
      let remaining = milliseconds, previous = performance.now();
      while (remaining > 0) {
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        const now = performance.now();
        if (!tacticalPause.paused) remaining -= now - previous;
        previous = now;
      }
    };
    try {
      for (let i = 0; i < sequence.length; i++) {
        const clip = sequence[i];
        const group = leaderAsset.animationGroups.find(candidate => candidate.name === clip);
        if (!group) throw new Error("FIRST_ATTACK_CLIP_MISSING:" + clip);
        if (!adapter.player.playLeaderProfileClip(clip, false)) throw new Error("FIRST_ATTACK_CLIP_NOT_RESOLVED:" + clip);
        trace.setPhase(phases[i]);
        const fps = Math.max(1, ...group.targetedAnimations.map(target => target.animation.framePerSecond || 0));
        const durationSeconds = Math.max(0.08, (group.to - group.from) / fps);
        played.push({ clip, durationSeconds });
        gripSamples.push(captureRoshSaberGripSample(phases[i] + "_START"));
        await waitGameplayMilliseconds(durationSeconds * 500);
        gripSamples.push(captureRoshSaberGripSample(phases[i] + "_MID"));
        await waitGameplayMilliseconds(durationSeconds * 500 + 80);
        gripSamples.push(captureRoshSaberGripSample(phases[i] + "_END"));
      }
      firstAttackCount++;
      return { pass: true, sequence: [profile.groups.saberReady, ...sequence, profile.groups.saberReady], played, attackCount: firstAttackCount,
        attackInstanceId, hitEvents: (jkaParryLabMode ? joleeBodyHitEvents : hitEvents.length) - hitsBefore,
        damageEvents: jkaParryLabMode ? (healthBefore - joleeHealth) / DEV_DAMAGE : (healthBefore - dummy!.health) / DEV_DAMAGE,
        maxTipDeltaM: trace.maxObservedTipDeltaM, maxTraceCallsPerFrame: trace.maxTraceCallsPerFrame,
        framesTraced: trace.framesTraced, repeatContactsSuppressed: trace.repeatContactsSuppressed, dryRun, gripSamples };
    } catch (error) {
      errors.push(String(error));
      return { pass: false, sequence, played, error: String(error), attackCount: firstAttackCount, attackInstanceId };
    } finally {
      captureBladePath = false; attackSequenceActive = false; trace.endAttack(); parryController?.endAttack(attackInstanceId);
      adapter.player.clearLeaderProfileClip();
      setReadyPose(true);
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      gripSamples.push(captureRoshSaberGripSample("READY_AFTER_RETURN"));
      (window as any).__w2372RoshSaberGripSamples = gripSamples;
      adapter.setInputEnabled(true);
      publish();
    }
  };
  const runG2PauseAttackRegression = async () => {
    if (tacticalPause.paused || attackSequenceActive) return { pass: false, reason: "PAUSE_ATTACK_TEST_UNAVAILABLE" };
    const damageBefore = hitEvents.length;
    const run = playFirstAttackSequence();
    await new Promise(resolve => window.setTimeout(resolve, 120));
    const beforePause = captureNaraAnimationAudit("PAUSE_ATTACK_BEFORE_PAUSE");
    // Babylon's AnimationGroup.pause() retains isStarted while clearing
    // isPlaying. Sampling both states lets this test compare the authored
    // combat group itself without mistaking a paused group for an ended one.
    const combatSnapshot = () => leaderAsset.animationGroups
      .filter((group: any) => group.isStarted || group.isPlaying || group.isPaused)
      .map((group: any) => ({ name: group.name, frame: Number(group.getCurrentFrame().toFixed(3)), isStarted: Boolean(group.isStarted), isPlaying: Boolean(group.isPlaying) }));
    const leaderBefore = combatSnapshot();
    tacticalPause.pause("G2_PAUSE_MID_ATTACK_REGRESSION");
    await new Promise(resolve => window.setTimeout(resolve, 3000));
    const leaderDuring = combatSnapshot();
    const frozen = leaderBefore.length === 1 && leaderBefore[0].name === leaderProfile.leaderCombatProfile?.groups.attackStart
      && JSON.stringify(leaderBefore.map(({ name, frame }) => ({ name, frame }))) === JSON.stringify(leaderDuring.map(({ name, frame }) => ({ name, frame })))
      && hitEvents.length === damageBefore;
    tacticalPause.resume("G2_PAUSE_MID_ATTACK_REGRESSION");
    const attack = await run;
    const attackSummary = { pass: attack.pass, attackInstanceId: attack.attackInstanceId, sequence: attack.sequence, hitEvents: attack.hitEvents, damageEvents: attack.damageEvents };
    const result = { pass: frozen && attack.pass && Number(attack.hitEvents ?? 0) <= 1 && hitEvents.length - damageBefore <= 1, frozen,
      beforePause: beforePause ? { latest: beforePause.latest, transitions: beforePause.transitions.slice(-8) } : null,
      leaderBefore, leaderDuring, attack: attackSummary, damageEventsDuringPause: hitEvents.length - damageBefore - Number(attack.hitEvents ?? 0) };
    (window as any).__w2372G2PauseAttackRegression = result;
    routeSummaryText = JSON.stringify({ tacticalPauseAttackRegression: result }, null, 2); status.textContent = routeSummaryText; publish(); return result;
  };
  const resetReverseDuel = (block = false) => {
    if (!jkaReverseParryLabMode || !joleeNpc || !reverseTrace || !parryController) return;
    if (arenInitialPosition) adapter.player.root.position.copyFrom(arenInitialPosition);
    if (joleeInitialPosition) joleeNpc.root.position.copyFrom(joleeInitialPosition);
    reverseArenHealth = 100; reverseArenDamageEvents = 0; reverseSuppressedFrames = 0;
    reverseParryEvents = []; reversePlacement = null; reverseJoleePath.length = 0;
    reversePathCapture = false; reverseReleaseBlockAtContact = false;
    reverseAttackGroup = null; reverseAttackInstanceId = null; reverseAttackProgress = 0; reverseAttackState = "JOLEE_READY";
    reverseTrace.endAttack(); parryController.reset();
    if (arenDefenseResponseGroup) arenDefenseResponseGroup.stop();
    arenDefenseResponseGroup = null; arenDefenseResponsePlaying = false; arenDefenseResponseCount = 0;
    arenDefenseResponseDirection = "TOP"; lastArenDirectionClassification = null;
    manualBlockInputActive = block; arenBlockState = block ? "BLOCK_READY" : "NOT_PARRYING";
    setReady(true, "REVERSE_DUEL_RESET");
    adapter.setInputEnabled(false);
    playJoleeClip("g2r1", true);
    targetHud.textContent = "AREN · 100 HP · 0 BODY HITS · 0 PARRIES";
  };
  const captureReverseJoleeAttackPath = async () => {
    if (!jkaReverseParryLabMode || !joleeNpc || !reverseTrace || !parryController) return { pass: false, reason: "REVERSE_LAB_DISABLED" };
    resetReverseDuel(false);
    const group = playJoleeClip("c2a1", false) as any;
    reverseAttackGroup = group; reverseAttackState = "JOLEE_ATTACK_START"; reverseAttackProgress = 0;
    reversePathCapture = true; reverseTrace.resetBladeHistory(); parryController.resetTracks(); reverseJoleePath.length = 0;
    const fps = Math.max(1, ...group.targetedAnimations.map((target: any) => target.animation.framePerSecond || 0));
    const durationSeconds = Math.max(0.1, (Number(group.to) - Number(group.from)) / fps);
    await new Promise(resolve => window.setTimeout(resolve, durationSeconds * 1000 + 80));
    reversePathCapture = false; group.stop(); reverseAttackGroup = null; reverseAttackState = "JOLEE_READY";
    playJoleeClip("g2r1", true);
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    return { pass: reverseJoleePath.length > 0, durationSeconds, fps, sampleCount: reverseJoleePath.length };
  };
  const moveJoleeBladeToArenPath = () => {
    if (!joleeNpc || !reverseJoleePath.length) return null;
    const arenSegment = genericSabers.get("Aren")?.getBladeSegment();
    if (!arenSegment) return null;
    const arenMidpoint = Vector3.Lerp(arenSegment.start, arenSegment.end, .5);
    const desired = reverseJoleePath.reduce((best, candidate) => {
      const midpoint = Vector3.Lerp(candidate.base, candidate.tip, .5);
      const score = Vector3.DistanceSquared(midpoint, arenMidpoint);
      return score < best.score ? { candidate, midpoint, score } : best;
    }, { candidate: reverseJoleePath[0], midpoint: Vector3.Lerp(reverseJoleePath[0].base, reverseJoleePath[0].tip, .5), score: Number.POSITIVE_INFINITY });
    const delta = arenMidpoint.subtract(desired.midpoint);
    joleeNpc.root.setAbsolutePosition(joleeNpc.root.getAbsolutePosition().add(delta));
    return { desiredMidpoint: desired.midpoint.asArray(), delta: delta.asArray(), placementScore: Math.sqrt(desired.score), roshBladeMidpoint: arenMidpoint.asArray(), sampleCount: reverseJoleePath.length };
  };
  const moveJoleeBladeToArenBody = () => {
    if (!joleeNpc || !reverseJoleePath.length) return null;
    const bodyCenter = adapter.player.root.getAbsolutePosition().add(new Vector3(0, 1.02, 0));
    const desired = reverseJoleePath.reduce((best, candidate) => {
      const midpoint = Vector3.Lerp(candidate.base, candidate.tip, .5);
      const score = Vector3.DistanceSquared(midpoint, bodyCenter);
      return score < best.score ? { candidate, midpoint, score } : best;
    }, { candidate: reverseJoleePath[0], midpoint: Vector3.Lerp(reverseJoleePath[0].base, reverseJoleePath[0].tip, .5), score: Number.POSITIVE_INFINITY });
    const delta = bodyCenter.subtract(desired.midpoint);
    joleeNpc.root.setAbsolutePosition(joleeNpc.root.getAbsolutePosition().add(delta));
    return { desiredMidpoint: desired.midpoint.asArray(), delta: delta.asArray(), placementScore: Math.sqrt(desired.score), bodyCenter: bodyCenter.asArray(), sampleCount: reverseJoleePath.length };
  };
  const runReverseAttackSequence = async (block: boolean, releaseBeforeContact = false, place = true, placementMode: "blade" | "body" = "blade") => {
    if (!jkaReverseParryLabMode || !joleeNpc || !reverseTrace || !parryController) return { pass: false, reason: "REVERSE_LAB_DISABLED" };
    resetReverseDuel(false);
    const pathCapture = place ? await captureReverseJoleeAttackPath() : { pass: true, sampleCount: 0 };
    if (place) reversePlacement = placementMode === "body" ? moveJoleeBladeToArenBody() : moveJoleeBladeToArenPath();
    setReady(true, "REVERSE_MANUAL_BLOCK_POSE");
    manualBlockInputActive = block; arenBlockState = block ? "BLOCK_READY" : "NOT_PARRYING";
    reverseArenHealth = 100; reverseArenDamageEvents = 0; reverseSuppressedFrames = 0; reverseParryEvents = [];
    reverseAttackCount += 1; reverseAttackInstanceId = `jolee_c2a1_${String(reverseAttackCount).padStart(4, "0")}`;
    reverseTrace.beginAttack(); parryController.beginAttack(reverseAttackInstanceId, JOLEE_PARRY_ACTOR_ID);
    reverseReleaseBlockAtContact = releaseBeforeContact;
    const group = playJoleeClip("c2a1", false) as any;
    reverseAttackGroup = group; reverseAttackState = "JOLEE_ATTACK_START"; reverseAttackProgress = 0;
    const fps = Math.max(1, ...group.targetedAnimations.map((target: any) => target.animation.framePerSecond || 0));
    const durationSeconds = Math.max(0.1, (Number(group.to) - Number(group.from)) / fps);
    await new Promise(resolve => window.setTimeout(resolve, durationSeconds * 1000 + 100));
    reverseReleaseBlockAtContact = false; reverseAttackGroup = null; reverseAttackState = "JOLEE_READY";
    group.stop(); reverseTrace.endAttack(); parryController.endAttack(reverseAttackInstanceId); reverseAttackInstanceId = null;
    playJoleeClip("g2r1", true); setReady(true, "REVERSE_ATTACK_RETURN");
    return {
      pass: pathCapture.pass !== false,
      attackInstanceId: `jolee_c2a1_${String(reverseAttackCount).padStart(4, "0")}`,
      blockActive: block, releasedBeforeContact: releaseBeforeContact, parryEvents: reverseParryEvents.length,
      dedupAttempts: parryController.dedupHits, damageEvents: reverseArenDamageEvents, arenHp: reverseArenHealth,
      suppressedFrames: reverseSuppressedFrames, lastParry: reverseParryEvents.at(-1) ?? null, placement: reversePlacement,
      pathCapture, activeGroup: "c2a1", readyGroup: "g2r1", attackWindow: { normalizedStart: .2, normalizedEnd: .82 },
      defenseResponseClip: leaderProfile.leaderCombatProfile?.groups.parryResponses?.[arenDefenseResponseDirection]
        ?? leaderProfile.leaderCombatProfile?.groups.parryResponse ?? null,
      defenseResponseDirection: arenDefenseResponseDirection,
      directionClassification: lastArenDirectionClassification ? {
        direction: lastArenDirectionClassification.direction,
        incomingVectorWorld: lastArenDirectionClassification.incomingVectorWorld.asArray(),
        incomingVectorLocal: lastArenDirectionClassification.incomingVectorLocal.asArray(),
        contactPointLocal: lastArenDirectionClassification.contactPointLocal.asArray(),
      } : null,
      defenseResponsePlayed: arenDefenseResponseCount > 0,
      defenseResponseCount: arenDefenseResponseCount,
    };
  };
  const runReverseParryCase = async (caseId: "R_A_READY" | "R_B_UNBLOCKED_DAMAGE" | "R_C_MANUAL_BLOCK" | "R_D_MULTI_FRAME_DEDUP" | "R_E_RELEASE_BLOCK" | "R_F_SECOND_ATTACK" | "R_G_BLOCK_MISS") => {
    if (!jkaReverseParryLabMode || !joleeNpc || !parryController) return { caseId, pass: false, reason: "REVERSE_LAB_DISABLED" };
    if (caseId === "R_A_READY") { resetReverseDuel(false); return { caseId, pass: reverseArenHealth === 100 && reverseParryEvents.length === 0 && reverseArenDamageEvents === 0, parryEvents: 0, damageEvents: 0, arenHp: 100, blockActive: false }; }
    if (caseId === "R_G_BLOCK_MISS") { resetReverseDuel(true); const result = await runReverseAttackSequence(true, false, false); return { ...result, caseId, pass: result.parryEvents === 0 && result.damageEvents === 0 && result.arenHp === 100 }; }
    if (caseId === "R_B_UNBLOCKED_DAMAGE") { const result = await runReverseAttackSequence(false, false, true, "body"); return { ...result, caseId, pass: result.parryEvents === 0 && result.damageEvents === 1 && result.arenHp === 90 }; }
    if (caseId === "R_E_RELEASE_BLOCK") { const result = await runReverseAttackSequence(true, true, true, "body"); return { ...result, caseId, pass: result.parryEvents === 0 && result.damageEvents === 1 && result.arenHp === 90 }; }
    if (caseId === "R_F_SECOND_ATTACK") { const first = await runReverseAttackSequence(true, false, true); const firstId = first.attackInstanceId; const second = await runReverseAttackSequence(true, false, true); return { ...second, caseId, firstAttackInstanceId: firstId, secondAttackInstanceId: second.attackInstanceId, attackIdsDistinct: firstId !== second.attackInstanceId, pass: second.parryEvents === 1 && second.damageEvents === 0 && second.arenHp === 100 && firstId !== second.attackInstanceId }; }
    const result = await runReverseAttackSequence(true, false, true);
    return { ...result, caseId, pass: result.parryEvents === 1 && result.dedupAttempts >= 1 && result.damageEvents === 0 && result.arenHp === 100 };
  };
  type NativeComboInputMode = "single" | "double" | "early" | "late" | "manual";
  type NativeComboSession = { machine: JkaNativeComboStateMachine; attackOneGroup: any; inputResult: any; mode: NativeComboInputMode };
  let activeNativeComboSession: NativeComboSession | null = null;
  const comboClipNames = leaderProfile.leaderCombatProfile ? {
    transition: leaderProfile.leaderCombatProfile.groups.comboTransition,
    attack: leaderProfile.leaderCombatProfile.groups.comboAttack,
    return: leaderProfile.leaderCombatProfile.groups.comboReturn,
  } : null;
  const comboGroupProgress = (group: any) => {
    const from = Number(group?.from ?? 0), to = Number(group?.to ?? 0);
    const frame = Number(group?.getCurrentFrame?.() ?? from);
    return to > from ? Math.max(0, Math.min(1, (frame - from) / (to - from))) : 0;
  };
  const nextRenderedFrame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  const waitForComboProgress = async (group: any, progress: number) => {
    const watchdogAt = performance.now() + 5000;
    while (group.isStarted && performance.now() < watchdogAt) {
      const current = comboGroupProgress(group);
      if (current >= progress) return current;
      await nextRenderedFrame();
    }
    return comboGroupProgress(group);
  };
  const waitForComboGroupEnd = (group: any) => new Promise<void>((resolve, reject) => {
    let settled = false;
    const deadline = performance.now() + 5000;
    let observer: any = null;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (observer) group.onAnimationGroupEndObservable.remove(observer);
      if (error) reject(error); else resolve();
    };
    observer = group.onAnimationGroupEndObservable.addOnce(() => finish());
    const poll = () => {
      if (settled) return;
      if (!group.isStarted) { finish(); return; }
      if (performance.now() >= deadline) { finish(new Error("W237_2E_CLIP_END_WATCHDOG:" + group.name)); return; }
      requestAnimationFrame(poll);
    };
    requestAnimationFrame(poll);
  });
  const playNativeComboClip = async (clip: string, tracePhase: "START" | "ATTACK" | "RETURN", onStarted?: (group: any) => Promise<void>) => {
    const group: any = leaderAsset.animationGroups.find(candidate => candidate.name === clip);
    if (!group) throw new Error("W237_2E_COMBO_CLIP_MISSING:" + clip);
    trace.setPhase(tracePhase);
    const ended = waitForComboGroupEnd(group);
    if (!adapter.player.playLeaderProfileClip(clip, false)) throw new Error("W237_2E_COMBO_CLIP_NOT_RESOLVED:" + clip);
    await nextRenderedFrame();
    const ownership = activeWritersForActor("AREN_NATIVE", leaderAsset);
    const ownershipSample = {
      activeGroupNames: ownership.activeGroupNames,
      activeAnimationGroupCount: ownership.activeAnimationGroupCount,
      activeAnimatableCount: ownership.activeAnimatableCount,
      duplicateTargetPropertyWriterCount: ownership.duplicateTargetPropertyWriters.length,
      foreignTargetCount: ownership.foreignTargetCount,
      crossActorTargetCount: ownership.crossActorTargetCount,
    };
    if (onStarted) await onStarted(group);
    await ended;
    return { clip, sourceProgressFrames: { from: group.from, to: group.to, lastFrame: group.getCurrentFrame() }, ownershipAtStart: ownershipSample };
  };
  const runNativeComboSequence = async (mode: NativeComboInputMode = "single") => {
    const profile = adapter.player.characterDefinition.leaderCombatProfile;
    if (!jkaComboEnabled || !profile || !comboClipNames?.transition || !comboClipNames.attack || !comboClipNames.return) {
      return { pass: false, reason: "W237_2E_COMBO_PROFILE_REQUIRED" };
    }
    if (attackSequenceActive || tourRunning || activeNativeComboSession) return { pass: false, reason: "ACTOR_BUSY" };
    if (!armed) setReady(true, "W237_2E_COMBO_START");
    const machine = new JkaNativeComboStateMachine();
    const comboId = machine.begin();
    if (!comboId) return { pass: false, reason: "COMBO_STATE_NOT_READY" };
    const session: NativeComboSession = { machine, attackOneGroup: null, inputResult: null, mode };
    activeNativeComboSession = session;
    attackSequenceActive = true;
    adapter.setInputEnabled(false);
    setReadyPose(false, true);
    trace.endAttack();
    const hitStart = hitEvents.length;
    const healthStart = dummy!.health;
    const clips: any[] = [];
    let attackOneInstanceId: string | null = null;
    let attackTwoInstanceId: string | null = null;
    let attackOneRepeatedContactsSuppressed = 0;
    let attackTwoRepeatedContactsSuppressed = 0;
    let transitionEntered = false;
    try {
      const attackStart = profile.groups.attackStart;
      clips.push(await playNativeComboClip(attackStart, "START"));
      if (!machine.beginAttackOne()) throw new Error("W237_2E_STATE_REJECTED_ATTACK_ONE");
      attackOneInstanceId = trace.beginAttack();
      trace.setPhase("ATTACK");
      const attackOneClip: any = leaderAsset.animationGroups.find(candidate => candidate.name === profile.groups.attack);
      if (!attackOneClip) throw new Error("W237_2E_ATTACK_ONE_CLIP_MISSING:" + profile.groups.attack);
      session.attackOneGroup = attackOneClip;
      clips.push(await playNativeComboClip(profile.groups.attack, "ATTACK", async group => {
        if (mode !== "double" && mode !== "early") return;
        const desiredProgress = mode === "double" ? 0.8 : 0.25;
        const observedProgress = await waitForComboProgress(group, desiredProgress);
        session.inputResult = machine.pressFollowUp(observedProgress);
      }));
      attackOneRepeatedContactsSuppressed = trace.repeatContactsSuppressed;
      trace.setPhase("RETURN");
      if (mode === "late") session.inputResult = machine.pressFollowUp(1.01);
      const next = machine.finishAttackOne();
      if (!next) throw new Error("W237_2E_STATE_REJECTED_ATTACK_ONE_FINISH");
      if (next === "ATTACK_2_TRANSITION") {
        transitionEntered = true;
        clips.push(await playNativeComboClip(comboClipNames.transition, "RETURN"));
        if (!machine.finishTransition()) throw new Error("W237_2E_STATE_REJECTED_ATTACK_TWO_TRANSITION");
        trace.endAttack();
        attackTwoInstanceId = trace.beginAttack();
        trace.setPhase("ATTACK");
        clips.push(await playNativeComboClip(comboClipNames.attack, "ATTACK"));
        attackTwoRepeatedContactsSuppressed = trace.repeatContactsSuppressed;
        trace.setPhase("RETURN");
        if (!machine.finishAttackTwo()) throw new Error("W237_2E_STATE_REJECTED_ATTACK_TWO_FINISH");
        clips.push(await playNativeComboClip(comboClipNames.return, "RETURN"));
      } else {
        clips.push(await playNativeComboClip(profile.groups.attackReturn, "RETURN"));
      }
      trace.endAttack();
      if (!machine.finishReturn()) throw new Error("W237_2E_STATE_REJECTED_RETURN");
      const events = hitEvents.slice(hitStart);
      const attackOneEvents = events.filter(event => event.attackInstanceId === attackOneInstanceId);
      const attackTwoEvents = events.filter(event => event.attackInstanceId === attackTwoInstanceId);
      return {
        pass: true, mode, comboId, stateAfter: machine.state, clips, transitionEntered,
        inputResult: session.inputResult,
        attackOneInstanceId, attackTwoInstanceId,
        attackOneHitEvents: attackOneEvents.length, attackOneDamageEvents: attackOneEvents.length,
        attackTwoHitEvents: attackTwoEvents.length, attackTwoDamageEvents: attackTwoEvents.length,
        attackOneRepeatedContactsSuppressed, attackTwoRepeatedContactsSuppressed,
        totalHitEvents: events.length, totalDamageEvents: (healthStart - dummy!.health) / DEV_DAMAGE,
        dummyHealthBefore: healthStart, dummyHealthAfter: dummy!.health, events,
        animationOwnershipPass: clips.every(row => row.ownershipAtStart.activeAnimationGroupCount === 1 &&
          row.ownershipAtStart.duplicateTargetPropertyWriterCount === 0 && row.ownershipAtStart.foreignTargetCount === 0 && row.ownershipAtStart.crossActorTargetCount === 0),
      };
    } catch (error) {
      errors.push(String(error));
      return { pass: false, mode, comboId, stateAfter: machine.state, clips, transitionEntered, inputResult: session.inputResult, error: String(error) };
    } finally {
      activeNativeComboSession = null;
      attackSequenceActive = false;
      trace.endAttack();
      adapter.player.clearLeaderProfileClip();
      setReadyPose(true, true);
      await nextRenderedFrame();
      adapter.setInputEnabled(true);
      publish();
    }
  };
  const progressNativeComboInput = () => {
    const active = activeNativeComboSession;
    if (!active) return { accepted: false, reason: "NO_COMBO_ACTIVE" };
    const progress = active.attackOneGroup?.isStarted ? comboGroupProgress(active.attackOneGroup) : 1.01;
    const result = active.machine.pressFollowUp(progress);
    active.inputResult = result;
    publish();
    return result;
  };
  const runNativeComboMatrix = async () => {
    if (jkaParryLabMode || !dummy) return { pass: false, reason: "DUMMY_DISABLED_IN_PARRY_LAB" };
    const profile = leaderProfile.leaderCombatProfile;
    if (!jkaComboEnabled || !profile) return { pass: false, reason: "W237_2E_COMBO_DIAGNOSTIC_FLAG_REQUIRED" };
    if (attackSequenceActive || tourRunning) return { pass: false, reason: "ACTOR_BUSY" };
    const dryRun = await playFirstAttackSequence(true);
    const calibration = calibrateDummyFromBlade();
    if (!calibration) return { pass: false, reason: "NO_WOK_VALID_COMBO_TARGET_POSITION", dryRun };
    const hitFloor = dummy!.floorPosition;
    const farFace = nav.rooms.find(room => room.resref.toLowerCase() === calibration.room.toLowerCase())?.faces
      .filter(face => face.walkability === "WALKABLE").map(face => {
        const sourcePoint = face.vertices.reduce((sum, point) => sum.map((value, index) => value + point[index]) as Point, [0, 0, 0] as Point).map(value => value / 3) as Point;
        return { point: toB(sourcePoint), distance: dist2(sourcePoint, fromB(hitFloor)) };
      }).filter(row => row.distance > 3).sort((a, b) => a.distance - b.distance)[0];
    if (!farFace) return { pass: false, reason: "NO_WOK_VALID_MISS_POSITION", dryRun, calibration };
    const runCase = async (mode: NativeComboInputMode, floor: Vector3) => {
      dummy!.placeOnFloor(floor); dummy!.reset();
      targetHud.textContent = "TRAINING DUMMY · 100 HP · 0 HITS";
      return runNativeComboSequence(mode);
    };
    const single = await runCase("single", hitFloor);
    const double = await runCase("double", hitFloor);
    const early = await runCase("early", hitFloor);
    const late = await runCase("late", hitFloor);
    const miss = await runCase("double", farFace.point);
    dummy!.placeOnFloor(hitFloor);
    const lowFpsTrace = new SaberTraceController("W237_2E_COMBO_ATTACK_2_LOW_FPS");
    const lowFpsTarget = { targetId: "SYNTHETIC_COMBO_DUMMY", center: new Vector3(0, 1, 0), radius: .45 };
    lowFpsTrace.beginAttack(); lowFpsTrace.setPhase("ATTACK");
    const lowFpsPrevious = [new Vector3(-1, 1, 0), new Vector3(-1, 1, .98)];
    const lowFpsCurrent = [new Vector3(1, 1, 0), new Vector3(1, 1, .98)];
    lowFpsTrace.update(lowFpsPrevious[0], lowFpsPrevious[1], true, lowFpsTarget, 0);
    const lowFpsHit = lowFpsTrace.update(lowFpsCurrent[0], lowFpsCurrent[1], true, lowFpsTarget, 100);
    const lowFps = { pass: Boolean(lowFpsHit), simulatedFrameMs: 100, instantaneousBladesMiss: true,
      sampledBladePositions: SaberTraceController.bladeSamples, hitTargetId: lowFpsHit?.targetId ?? null };
    const dedupTrace = new SaberTraceController("W237_2E_COMBO_DEDUP_PROOF");
    const dedupTarget = { targetId: "SYNTHETIC_COMBO_DEDUP_TARGET", center: new Vector3(0, 1, 0), radius: .12 };
    const dedupBase = new Vector3(-.49, 1, 0), dedupTip = new Vector3(.49, 1, 0);
    const runDedupSwing = (timestamp: number) => {
      const attackInstanceId = dedupTrace.beginAttack(); dedupTrace.setPhase("ATTACK");
      dedupTrace.update(dedupBase, dedupTip, true, dedupTarget, timestamp);
      const firstContact = dedupTrace.update(dedupBase, dedupTip, true, dedupTarget, timestamp + 16);
      const repeatedContact = dedupTrace.update(dedupBase, dedupTip, true, dedupTarget, timestamp + 32);
      return { attackInstanceId, firstContactAccepted: Boolean(firstContact), repeatedContactAccepted: Boolean(repeatedContact),
        repeatedContactsSuppressed: dedupTrace.repeatContactsSuppressed,
        hitEventsForAttack: dedupTrace.hitEvents.filter(event => event.attackInstanceId === attackInstanceId).length };
    };
    const dedupAttackOne = runDedupSwing(0), dedupAttackTwo = runDedupSwing(100);
    const traceDedupRegression = { attackOne: dedupAttackOne, attackTwo: dedupAttackTwo,
      pass: dedupAttackOne.firstContactAccepted && !dedupAttackOne.repeatedContactAccepted && dedupAttackOne.repeatedContactsSuppressed === 1 && dedupAttackOne.hitEventsForAttack === 1 &&
        dedupAttackTwo.firstContactAccepted && !dedupAttackTwo.repeatedContactAccepted && dedupAttackTwo.repeatedContactsSuppressed === 1 && dedupAttackTwo.hitEventsForAttack === 1 &&
        dedupAttackOne.attackInstanceId !== dedupAttackTwo.attackInstanceId };
    const spamMachine = new JkaNativeComboStateMachine();
    spamMachine.begin(); spamMachine.beginAttackOne();
    const spamInputs = [spamMachine.pressFollowUp(0.8), spamMachine.pressFollowUp(0.8), spamMachine.pressFollowUp(0.8), spamMachine.pressFollowUp(0.8)];
    const spamFollowUpCount = Number(spamMachine.finishAttackOne() === "ATTACK_2_TRANSITION");
    const spamDedup = spamInputs.filter(row => row.accepted).length === 1 &&
      spamInputs.slice(1).every(row => row.reason === "WINDOW_ALREADY_FILLED") && spamFollowUpCount === 1;
    const doubleRows = double as any, singleRows = single as any, earlyRows = early as any, lateRows = late as any, missRows = miss as any;
    const repeatDedup = traceDedupRegression.pass && doubleRows.attackOneDamageEvents <= 1 && doubleRows.attackTwoDamageEvents <= 1;
    const pass = singleRows?.pass && singleRows.attackOneDamageEvents === 1 && singleRows.attackTwoHitEvents === 0 &&
      doubleRows?.pass && doubleRows.attackOneDamageEvents === 1 && doubleRows.attackTwoDamageEvents === 1 &&
      doubleRows.attackOneInstanceId && doubleRows.attackTwoInstanceId && doubleRows.attackOneInstanceId !== doubleRows.attackTwoInstanceId &&
      doubleRows.animationOwnershipPass && repeatDedup &&
      spamDedup &&
      earlyRows?.pass && earlyRows.inputResult?.reason === "EARLY_REJECTED" && !earlyRows.transitionEntered &&
      lateRows?.pass && lateRows.inputResult?.reason === "LATE_REJECTED" && !lateRows.transitionEntered &&
      missRows?.pass && missRows.totalDamageEvents === 0 && lowFps.pass;
    // Leave the browser in the successful two-hit state for direct review.
    const finalReplay = await runCase("double", hitFloor);
    const result = {
      pass: Boolean(pass && (finalReplay as any)?.pass && (finalReplay as any).attackOneDamageEvents === 1 && (finalReplay as any).attackTwoDamageEvents === 1),
      inputPolicy: "FIRST_PRESS_STARTS_ATTACK; SECOND_PRESS_ACCEPTED_ONLY_WHILE_ATTACK_1_GROUP_PROGRESS_IS_0.75..1.0; EARLY_AND_LATE_INPUT_REJECTED",
      comboWindow: { normalizedStart: JKA_NATIVE_COMBO_WINDOW.start, normalizedEnd: JKA_NATIVE_COMBO_WINDOW.end,
        sourceFrames: [JKA_NATIVE_COMBO_WINDOW.sourceStartFrame, JKA_NATIVE_COMBO_WINDOW.sourceEndFrame], sourceFrameCount: JKA_NATIVE_COMBO_WINDOW.sourceFrameCount },
      targetCalibration: calibration, missPosition: farFace.point.asArray(), single, double, early, late, miss, lowFps,
      traceDedupRegression, spamInput: { results: spamInputs, acceptedFollowUpCount: spamFollowUpCount, pass: spamDedup },
      finalReplay, finalDummy: { health: dummy!.health, hitCount: dummy!.hitCount, damageEvents: dummy!.damageEvents },
      party: { size: activePartySize, followers: adapter.followers.map(follower => follower.id), joleeRole: joleeNpc ? "ACADEMY_NPC" : "NOT_SPAWNED" },
      visFallbackCount, wokRejects: adapter.state().edgeRejectCount ?? null, errors: [...errors],
    };
    (window as any).__w2372EComboMatrix = result;
    (window as any).__w2372EComboSource = { asset: leaderProfile.assetPath, sha256: leaderAssetSha256,
      sourceSymbols: profile.sourceSymbols, sourceFps: profile.sourceFps, groups: profile.groups };
    publish();
    return result;
  };
  const runHitMatrix = async () => {
    if (jkaParryLabMode || !dummy) return { pass: false, reason: "DUMMY_DISABLED_IN_PARRY_LAB" };
    if (attackSequenceActive || tourRunning) return { pass: false, reason: "ACTOR_BUSY" };
    const calibrationAttack = await playFirstAttackSequence(true);
    const calibration = calibrateDummyFromBlade();
    if (!calibration) return { pass: false, reason: "NO_WOK_VALID_BLADE_PATH", calibrationAttack, bladeFrames: bladePath.length };
    dummy!.reset(); hitEvents.length = 0; targetHud.textContent = "TRAINING DUMMY · 100 HP · 0 HITS";
    setReady(true);
    await new Promise(resolve => window.setTimeout(resolve, 250));
    const ready = { damageEvents: dummy!.damageEvents, health: dummy!.health };
    const startId = trace.beginAttack();
    await new Promise(resolve => window.setTimeout(resolve, 220));
    const start = { attackInstanceId: startId, damageEvents: dummy!.damageEvents };
    trace.endAttack();
    const first = await playFirstAttackSequence();
    const repeat = { damageEvents: dummy!.damageEvents, suppressed: first.pass ? first.repeatContactsSuppressed : null };
    const hitFloor = dummy!.floorPosition;
    const farFaces = nav.rooms.find(r => r.resref === calibration.room)?.faces.filter(f => f.walkability === "WALKABLE") ?? [];
    const far = farFaces.map(f => {
      const p = f.vertices.reduce((sum, v) => sum.map((value, i) => value + v[i]) as Point, [0, 0, 0] as Point).map(value => value / 3) as Point;
      return { point: toB(p), distance: Math.hypot(p[0] - calibration.floor[0], p[1] + calibration.floor[2]) };
    }).filter(row => row.distance > 3).sort((a, b) => a.distance - b.distance)[0];
    if (!far) return { pass: false, reason: "NO_WOK_VALID_MISS_POSITION", calibration, ready, start, first };
    dummy!.placeOnFloor(far.point);
    const miss = await playFirstAttackSequence();
    dummy!.placeOnFloor(hitFloor);
    const second = await playFirstAttackSequence();
    // A deliberately larger frame step: both instantaneous blades miss, the swept surface crosses the target.
    const lowFpsTrace = new SaberTraceController("SYNTHETIC_TRACE_PROBE");
    const lowFpsTarget = { targetId: "SYNTHETIC_DUMMY", center: new Vector3(0, 1, 0), radius: .45 };
    lowFpsTrace.beginAttack(); lowFpsTrace.setPhase("ATTACK");
    const previous = [new Vector3(-1, 1, 0), new Vector3(-1, 1, .98)];
    const current = [new Vector3(1, 1, 0), new Vector3(1, 1, .98)];
    lowFpsTrace.update(previous[0], previous[1], true, lowFpsTarget, 0);
    const sweptHit = lowFpsTrace.update(current[0], current[1], true, lowFpsTarget, 100);
    const lowFpsSweep = { pass: Boolean(sweptHit), simulatedFrameMs: 100, tipDeltaM: lowFpsTrace.maxObservedTipDeltaM,
      instantaneousBladesMiss: true, sweptHit: sweptHit ? { attackInstanceId: sweptHit.attackInstanceId, bladeT: sweptHit.bladeT, worldPoint: sweptHit.worldPoint.asArray() } : null };
    const partyAfter = adapter.state() as any;
    const poseFeetY = measurePoseBounds(leaderAsset.meshes).minY;
    const partyPreservation = { leader: partyAfter.leaderId, room: partyAfter.room, face: partyAfter.face,
      partyActorCount: activePartySize, visibleActorCount: activePartySize + Number(Boolean(joleeNpc)), followerIds: adapter.followers.map(f => f.id),
      joleePartyMember: adapter.followers.some(f => f.id === "Jolee"), joleeNpcStationary: joleeNpc ? { room: joleeNpc.hit.room, position: [...joleeNpc.hit.point] } : null,
      arenSaberCount: genericSabers.get("Aren")?.isAttached ? 1 : 0,
      naraSaberCount: genericSabers.get("Nara")?.isAttached ? 1 : 0, joleeSaberCount: joleeRoots.length ? 1 : 0,
      groundingFeetToWokM: poseFeetY == null ? null : poseFeetY - Number(partyAfter.navPosition?.[2]),
      visFallbackCount, wokEdgeRejects: partyAfter.edgeRejectCount ?? null,
      followerTeleports: partyAfter.companions?.map((f: any) => ({ id: f.id, teleports: f.recoveryTeleports })) ?? [] };
    const result = { pass: ready.damageEvents === 0 && start.damageEvents === 0 && first.pass && first.hitEvents === 1 && first.damageEvents === 1 &&
      repeat.damageEvents === 1 && miss.pass && miss.hitEvents === 0 && miss.damageEvents === 0 && second.pass && second.hitEvents === 1 &&
      second.damageEvents === 1 && first.attackInstanceId !== second.attackInstanceId && lowFpsSweep.pass,
      calibration, calibrationAttack, ready, start, first, repeat, miss, second,
      lowFpsSweep, partyPreservation,
      health: dummy!.health, hitCount: dummy!.hitCount, damageEvents: dummy!.damageEvents,
      hitEvents: [...hitEvents], farWokPosition: far.point.asArray(), consoleErrors: [...errors] };
    (window as any).__w2372DHitMatrix = result;
    publish(); return result;
  };
  const prepareMovement = () => setReadyPose(false);

  let clean = true, tourRunning = false, groundingSweepActive = false;
  let routeSummaryText: string | null = null;
  let routeProgress: any = { active: false, segment: 0, total: roomCoverage.reachableRooms.length, room: null, phase: "IDLE" };
  const runFullRoute = async (maxRooms = Number.POSITIVE_INFINITY) => {
    if (tourRunning) return { pass: false, reason: "ROUTE_ALREADY_RUNNING" };
    tourRunning = true;
    routeSummaryText = null; delete status.dataset.routeSummary;
    adapter.setInputEnabled(true);
    prepareMovement();
    const order = roomCoverage.reachableRooms.slice(0, Number.isFinite(maxRooms) ? maxRooms : undefined), results: any[] = [];
    routeProgress = { active: true, segment: 0, total: order.length, room: adapter.state().room, phase: "STARTING" };
    let walkDistance = 0, runDistance = 0;
    try {
      for (let i = 0; i < order.length; i++) {
        const room = order[i], point = adapter.state().navPosition as Point;
        const nodes = nav.pth.filter(n => n.room === room && n.projection === "UNIQUE_ROOM")
          .map(node => ({ node, hit: projectPthNodeToSourceWok(nav, node) })).filter((row): row is { node: PthNode; hit: EboHit } => !!row.hit);
        if (!nodes.length) { results.push({ room, pass: false, reason: "NO_PROJECTABLE_SOURCE_WOK_PTH_TARGET" }); break; }
        // Stop on the node's declared walkable source face, well inside the room.
        // This preserves source PTH→WOK height deltas without loosening navigation tolerances.
        const preciseNodes = nodes.filter(row => row.hit.dist <= 0.25);
        const targetPool = preciseNodes.length ? preciseNodes : nodes;
        const target = targetPool.slice().sort((a, b) =>
          sourceBoundaryClearance(nav, room, b.hit.point) - sourceBoundaryClearance(nav, room, a.hit.point) ||
          dist2(a.hit.point, point) - dist2(b.hit.point, point))[0];
        const running = i >= Math.floor(order.length / 2);
        const sourceHeightDelta = Number((target.node.position[2] - target.hit.point[2]).toFixed(4));
        routeProgress = { active: true, segment: i + 1, total: order.length, room, targetNode: target.node.id, sourceHeightDelta, sourceProjectionError: target.hit.dist, running, phase: "TRAVERSING", distance: adapter.state().distance };
        if (!clean) status.textContent = `ROUTE ${i + 1}/${order.length} · ${room} · ${running ? "RUN" : "WALK"} · ${Number(adapter.state().distance).toFixed(1)} m`;
        const result: any = await adapter.runRouteTo(target.hit.point, room, running);
        results.push({ room, targetNode: target.node.id, sourceWokFace: target.hit.face, sourceProjectionError: target.hit.dist, sourceHeightDelta, running, pass: result.pass, result });
        walkDistance += Number(result.walked ?? 0); runDistance += Number(result.ran ?? 0);
        routeProgress = { active: true, segment: i + 1, total: order.length, room, phase: result.pass ? "ROOM_REACHED" : "SEGMENT_FAILED", result: { pass: result.pass, reason: result.reason, endRoom: result.endRoom, remaining: result.remaining, playerDistance: result.playerDistance } };
        if (!result.pass) break;
      }
      const final: any = adapter.state(), roomSet = new Set<string>(final.roomsVisited), doors = final.roomTransitions.filter((t: any) => t.gitDoorId);
      const route = {
        pass: results.length === order.length && results.every(r => r.pass) && order.every(r => roomSet.has(r)) &&
          walkDistance >= 50 && runDistance >= 50 && final.edgeRejectCount === 0 && final.companions.every((f: any) => f.recoveryTeleports === 0),
        distance: final.distance, walkDistance, runDistance, reachableRooms: order, visitedRooms: [...roomSet],
        coveragePercent: order.length ? Number((100 * order.filter(r => roomSet.has(r)).length / order.length).toFixed(2)) : 0,
        roomTransitions: final.roomTransitions, doorCrossings: doors, visFallbackCount,
        followerMetrics: final.companions, leaderEvents: final.leaderEvents,
        routeSegments: results, edgeRejectCount: final.edgeRejectCount,
        patioDoorDistance: patioDoor && final.navPosition ? dist2(patioDoor.position, final.navPosition) : null,
        patioLoaded: false, shipTriggerEnabled: false,
      };
      routeProgress = { active: false, segment: results.length, total: order.length, phase: route.pass ? "COMPLETE" : "FAILED", route };
      return route;
    } finally { tourRunning = false; if (armed) setReadyPose(true); }
  };
  const runAcademyTacticalTwoTransition = async () => {
    if (tourRunning || !jkaControlSwapMode || !jkaNaraSelected || !jkaNaraFollower) return { pass: false, reason: "TACTICAL_ACADEMY_ROUTE_UNAVAILABLE" };
    tourRunning = true; clean = false; status.style.display = "block";
    const results: any[] = [];
    const waitForSettlement = async (timeoutMs: number) => {
      const startedAt = performance.now();
      while (performance.now() - startedAt < timeoutMs) {
        const tactical = adapter.tacticalQueueSnapshot();
        if (!tactical?.aren?.length && !tactical?.nara?.length) return { settled: true, elapsedMs: Math.round(performance.now() - startedAt) };
        await new Promise(resolve => window.setTimeout(resolve, 100));
      }
      return { settled: false, elapsedMs: Math.round(performance.now() - startedAt), queues: adapter.tacticalQueueSnapshot() };
    };
    try {
      const destinations = roomCoverage.reachableRooms.slice(1, 3).map(room => {
        const point = adapter.state().navPosition as Point;
        const nodes = nav.pth.filter(node => node.room === room && node.projection === "UNIQUE_ROOM")
          .map(node => ({ node, hit: projectPthNodeToSourceWok(nav, node) }))
          .filter((row): row is { node: PthNode; hit: EboHit } => Boolean(row.hit));
        const candidates = nodes.filter(row => row.hit.dist <= 0.25);
        const target = (candidates.length ? candidates : nodes).slice().sort((a, b) =>
          sourceBoundaryClearance(nav, room, b.hit.point) - sourceBoundaryClearance(nav, room, a.hit.point) || dist2(a.hit.point, point) - dist2(b.hit.point, point))[0];
        return target ? { room, nodeId: target.node.id, world: toB(target.hit.point) } : null;
      });
      if (destinations.length !== 2 || destinations.some(destination => !destination)) throw new Error("TACTICAL_ROUTE_TARGETS_UNAVAILABLE");
      for (const destination of destinations.filter((value): value is { room: string; nodeId: number; world: Vector3 } => Boolean(value))) {
        const arenPlan = adapter.planTacticalPthRoute("AREN", destination.world);
        const naraPlan = adapter.planTacticalPthRoute("NARA", destination.world);
        if (!arenPlan.accepted || !naraPlan.accepted) { results.push({ room: destination.room, nodeId: destination.nodeId, aren: arenPlan, nara: naraPlan, settled: { settled: false, reason: "ROUTE_PLAN_REJECTED" } }); break; }
        const chunks = Math.max(Math.ceil(arenPlan.points.length / 8), Math.ceil(naraPlan.points.length / 8));
        const batches: any[] = [];
        for (let batch = 0; batch < chunks; batch++) {
          tacticalPause.pause("G2_ACADEMY_TACTICAL_ROUTE_QUEUE");
          adapter.selectTacticalActor("AREN"); const aren = arenPlan.points.slice(batch * 8, batch * 8 + 8).map(point => adapter.queueTacticalMove(point));
          adapter.selectTacticalActor("NARA"); const nara = naraPlan.points.slice(batch * 8, batch * 8 + 8).map(point => adapter.queueTacticalMove(point));
          tacticalPause.resume("G2_ACADEMY_TACTICAL_ROUTE_EXECUTE");
          status.textContent = `TACTICAL ROUTE · ${destination.room} · batch ${batch + 1}/${chunks}`;
          const settled = await waitForSettlement(45_000); batches.push({ aren, nara, settled });
          if (!settled.settled || !aren.every(command => command.accepted) || !nara.every(command => command.accepted)) break;
        }
        const settled = batches.at(-1)?.settled ?? { settled: false, reason: "NO_ROUTE_BATCH" };
        const state: any = adapter.state();
        const aren = { accepted: batches.every(batch => batch.aren.every((command: any) => command.accepted)), plan: arenPlan, batches: batches.map(batch => batch.aren) };
        const nara = { accepted: batches.every(batch => batch.nara.every((command: any) => command.accepted)), plan: naraPlan, batches: batches.map(batch => batch.nara) };
        results.push({ room: destination.room, nodeId: destination.nodeId, aren, nara, settled, leaderRoom: state.room,
          naraRoom: state.companions?.find((row: any) => row.id === "Nara")?.room ?? null });
        if (!aren.accepted || !nara.accepted || !settled.settled) break;
      }
      const state: any = adapter.state(); const naraState = state.companions?.find((row: any) => row.id === "Nara") ?? {};
      const history = adapter.tacticalCommandHistory(); const failures = history.filter((command: any) => command.state === "FAILED");
      const meaningfulTransitions = state.roomTransitions.filter((transition: any) => transition.fromRoom !== transition.toRoom);
      const result = { pass: results.length === 2 && results.every(row => row.aren.accepted && row.nara.accepted && row.settled.settled) && meaningfulTransitions.length >= 2 && failures.length === 0 && state.edgeRejectCount === 0 && naraState.recoveryTeleports === 0 && naraState.stuckCount === 0 && visFallbackCount === 0,
        destinations: results, roomTransitions: meaningfulTransitions, commandFailures: failures, arenTeleports: 0, naraTeleports: naraState.recoveryTeleports ?? null,
        naraStuck: naraState.stuckCount ?? null, visFallbacks: visFallbackCount, wokRejects: state.edgeRejectCount };
      (window as any).__w2372G2AcademyTacticalRoute = result; routeSummaryText = JSON.stringify({ academyTacticalRoute: result }, null, 2); status.textContent = routeSummaryText; return result;
    } catch (error) {
      const result = { pass: false, error: String(error) }; (window as any).__w2372G2AcademyTacticalRoute = result; routeSummaryText = JSON.stringify({ academyTacticalRoute: result }, null, 2); status.textContent = routeSummaryText; return result;
    } finally { tourRunning = false; publish(); }
  };
  const runRouteToRoomCount = (count: number) => runFullRoute(count);
  const runGroundingPoseAudit = async () => {
    if (groundingSweepActive || tourRunning) return { pass: false, reason: "LAB_BUSY" };
    groundingSweepActive = true; clean = true; status.style.display = "block";
    routeSummaryText = null; delete status.dataset.routeSummary;
    adapter.setInputEnabled(false);
    const leaderRows: any[] = [], naraRows: any[] = [];
    const waitFrames = async (count: number) => { for (let i = 0; i < count; i++) await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); };
    const naraFollower = adapter.followers.find(follower => follower.id === "Nara") as any;
    const actors = [
      { key: "AREN", profile: leaderProfile, asset: leaderAsset, root: adapter.player.root, visualRoot: adapter.player.visualRoot, floorY: Number((adapter.state() as any).navPosition?.[2] ?? adapter.player.root.position.y), samples: leaderRows },
      ...(naraNativeSelected && naraFollower ? [{ key: "NARA", profile: naraJkaProfile!, asset: naraFollower.asset as ImportedAsset, root: naraFollower.root as TransformNode,
        visualRoot: naraFollower.visualRoot as TransformNode, floorY: Number(naraFollower.hit.point[2]), samples: naraRows }] : []),
    ];
    const samplePose = (actor: typeof actors[number], pose: string, clip: string, sampleIndex: number) => {
      const row = sampleActorFootGrounding(actor.key, actor.asset, actor.root, actor.visualRoot, actor.floorY, pose, clip);
      const activeGroupNames = actor.asset.animationGroups.filter(group => group.isPlaying).map(group => group.name);
      const record = { actorId: row.actorId, pose: row.pose, clip: row.clip, sampleIndex, floorY: row.floorY,
        actorRootY: row.capsuleFootY, visualRootY: row.visualRootWorld[1],
        leftFootY: row.footSoles.left.lowestY, rightFootY: row.footSoles.right.lowestY,
        leftFootToWokM: row.leftFootToWokM, rightFootToWokM: row.rightFootToWokM, lowestFootToWokM: row.lowestFootToWokM,
        selectedFootBones: { left: row.footSoles.left.footBones, right: row.footSoles.right.footBones },
        selectedVertexCounts: { left: row.footSoles.left.vertexCount, right: row.footSoles.right.vertexCount },
        activeGroupNames, activeGroupCount: activeGroupNames.length };
      actor.samples.push(record);
      return record;
    };
    const sampleClipCycle = async (actor: typeof actors[number], poses: Array<[string, string | undefined]>) => {
      for (const [pose, clip] of poses) {
        if (!clip) throw new Error("GROUNDING_CLIP_PROFILE_MISSING:" + actor.key + ":" + pose);
        actor.asset.animationGroups.forEach(group => group.stop());
        const group = actor.asset.animationGroups.find(candidate => candidate.name === clip);
        if (!group) throw new Error("GROUNDING_CLIP_MISSING:" + actor.key + ":" + clip);
        groundingFootSamples.delete(actor.key);
        group.start(true, 1);
        const fps = Math.max(1, ...group.targetedAnimations.map(target => target.animation.framePerSecond || 0));
        const duration = Math.max(0.25, (group.to - group.from + 1) / fps);
        const sampleCount = 3;
        const framesPerSample = Math.max(1, Math.round(duration * 60 / sampleCount));
        for (let i = 0; i < sampleCount; i++) {
          await waitFrames(framesPerSample);
          samplePose(actor, pose, clip, i);
        }
      }
    };
    try {
      setReadyPose(false);
      const leaderLocomotion = leaderProfile.exactLocomotion;
      if (!leaderLocomotion) throw new Error("GROUNDING_LEADER_LOCOMOTION_PROFILE_MISSING");
      await sampleClipCycle(actors[0], [
        ["IDLE", leaderLocomotion.idle], ["WALK", leaderLocomotion.walk], ["RUN", leaderLocomotion.run],
        ["BACKWARD", leaderLocomotion.backward], ["STRAFE_LEFT", leaderLocomotion.strafeLeft], ["STRAFE_RIGHT", leaderLocomotion.strafeRight],
        ["SABER_READY", leaderProfile.leaderCombatProfile?.groups.saberReady],
      ]);
      const nara = actors.find(actor => actor.key === "NARA");
      if (nara) {
        const locomotion = nara.profile.exactLocomotion;
        if (!locomotion) throw new Error("GROUNDING_NARA_LOCOMOTION_PROFILE_MISSING");
        await sampleClipCycle(nara, [["IDLE", locomotion.idle], ["WALK", locomotion.walk], ["RUN", locomotion.run]]);
      }
      const summarize = (actor: typeof actors[number]) => {
        const clearances = actor.samples.map(row => row.lowestFootToWokM).filter((value: number | null): value is number => value != null);
        const minClearance = clearances.length ? Math.min(...clearances) : null;
        const maxClearance = clearances.length ? Math.max(...clearances) : null;
        const currentProfileOffsetM = actor.profile.runtimeVisualGroundOffsetM ?? 0;
        return { actorId: actor.key, actorAsset: actor.profile.assetPath, actorRootY: actor.root.getAbsolutePosition().y,
          capsuleFootY: actor.root.getAbsolutePosition().y, floorY: actor.floorY,
          actorRootToWokM: Number((actor.root.getAbsolutePosition().y - actor.floorY).toFixed(4)),
          visualRootLocalY: actor.visualRoot.position.y, visualRootWorldY: actor.visualRoot.getAbsolutePosition().y,
          currentProfileOffsetM, measurementMethod: actor.samples[0]?.footSoles.method ?? "NO_FOOT_DATA",
          selectedFootBones: actor.samples[0]?.selectedFootBones ?? { left: [], right: [] },
          selectedVertexCounts: actor.samples[0]?.selectedVertexCounts ?? { left: 0, right: 0 },
          minimumSampledFootClearanceM: minClearance == null ? null : Number(minClearance.toFixed(4)),
          maximumSampledFootClearanceM: maxClearance == null ? null : Number(maxClearance.toFixed(4)),
          recommendedAdditionalVisualOffsetM: minClearance == null ? null : Number((0.02 - minClearance).toFixed(3)),
          perPose: Object.fromEntries([...new Set(actor.samples.map(row => row.pose))].map(pose => {
            const rows = actor.samples.filter(row => row.pose === pose);
            const values = rows.map(row => row.lowestFootToWokM).filter((value: number | null): value is number => value != null);
            return [pose, { clip: rows[0]?.clip, sampleCount: rows.length,
              leftFootMinY: Math.min(...rows.map(row => row.leftFootY).filter((value: number | null): value is number => value != null)),
              rightFootMinY: Math.min(...rows.map(row => row.rightFootY).filter((value: number | null): value is number => value != null)),
              lowestFootToWokM: values.length ? Number(Math.min(...values).toFixed(4)) : null,
              activeGroupCount: Math.max(...rows.map(row => row.activeGroupCount)) }];
          })), samples: actor.samples };
      };
      const arenResult = summarize(actors[0]);
      const naraResult = nara ? summarize(nara) : null;
      const result = { pass: Boolean(arenResult.selectedVertexCounts.left && arenResult.selectedVertexCounts.right && (!naraResult || (naraResult.selectedVertexCounts.left && naraResult.selectedVertexCounts.right))),
        scope: "PROFILE_SCOPED_VISUAL_GROUNDING_ONLY", floorAuthority: "accepted source WOK face", targetSoleClearanceM: 0.02,
        actorRootChanged: false, capsuleChanged: false, navigationChanged: false, glbsChanged: false, Aren: arenResult, Nara: naraResult };
      (window as any).__w2372GroundingAudit = result;
      routeSummaryText = JSON.stringify({ groundingAudit: result }, null, 2); status.dataset.groundingAudit = routeSummaryText; status.textContent = routeSummaryText;
      return result;
    } catch (error) {
      errors.push(String(error));
      const result = { pass: false, scope: "PROFILE_SCOPED_VISUAL_GROUNDING_ONLY", error: String(error), Aren: leaderRows, Nara: naraRows };
      (window as any).__w2372GroundingAudit = result;
      routeSummaryText = JSON.stringify({ groundingAudit: result }, null, 2); status.dataset.groundingAudit = routeSummaryText; status.textContent = routeSummaryText;
      return result;
    } finally {
      setReadyPose(false);
      for (const group of leaderAsset.animationGroups) group.stop();
      const leaderIdle = leaderProfile.exactLocomotion?.idle;
      if (leaderIdle) leaderAsset.animationGroups.find(group => group.name === leaderIdle)?.start(true, 1);
      if (naraFollower) {
        naraFollower.setArmed(false); naraFollower.playSemantic("IDLE");
      }
      adapter.setInputEnabled(true); groundingSweepActive = false; clean = true;
      publish();
      if (routeSummaryText) status.textContent = routeSummaryText;
    }
  };
  if (leaderProfile.id === "aren-native-jka-v1") {
    button("SABER GRIP SAMPLE", () => {
      clean = false; status.style.display = "block";
      const sample = captureRoshSaberGripSample("CURRENT_POSE");
      (window as any).__w2372RoshSaberGripCurrent = sample;
      routeSummaryText = JSON.stringify(sample, null, 2);
      status.dataset.saberGrip = routeSummaryText; status.textContent = routeSummaryText;
    });
    button("DRY GRIP REVIEW", () => {
      clean = true; status.style.display = "none"; panel.style.display = "none";
      window.setTimeout(() => { void playFirstAttackSequence(true).then(result => {
        clean = false; panel.style.display = "block"; status.style.display = "block";
        routeSummaryText = JSON.stringify({ dryGripReview: result }, null, 2);
        status.dataset.saberGripSequence = routeSummaryText; status.textContent = routeSummaryText;
      }); }, 120);
    });
  }
  button("READY · " + (2 + Number(!joleeNpcEnabled)) + " SABERS", () => setReady(true));
  if (leaderProfile.leaderCombatProfile) button(jkaComboEnabled ? "ATTACK / COMBO INPUT · CLICK AGAIN IN WINDOW" : "FIRST ATTACK · PHYSICAL", () => {
    if (jkaComboEnabled) {
      if (activeNativeComboSession) {
        const input = progressNativeComboInput();
        status.style.display = "block";
        status.textContent = JSON.stringify({ comboInput: input, progress: activeNativeComboSession?.attackOneGroup ? comboGroupProgress(activeNativeComboSession.attackOneGroup) : null }, null, 2);
      } else {
        clean = false; status.style.display = "block";
        status.textContent = "Starting Attack 1. Press this attack input again during the displayed combo window to request Attack 2.";
        void runNativeComboSequence("manual").then(result => {
          (window as any).__w2372EManualCombo = result;
          routeSummaryText = JSON.stringify({ nativeJkaComboInput: result }, null, 2);
          status.textContent = routeSummaryText; publish();
        }).catch(error => { errors.push(String(error)); publish(); });
      }
      return;
    }
    clean = false; status.style.display = "block"; status.textContent = "Playing JKA READY → START → ATTACK → RETURN → READY…";
    void playFirstAttackSequence().then(result => {
      (window as any).__w2372FirstAttack = result;
      routeSummaryText = JSON.stringify({ firstAttack: result }, null, 2);
      status.dataset.firstAttack = routeSummaryText; status.textContent = routeSummaryText;
      publish();
    });
  });
  if (leaderProfile.leaderCombatProfile) {
    button("CALIBRATE DUMMY FROM SWING", () => { void playFirstAttackSequence(true).then(attack => {
      const calibration = calibrateDummyFromBlade(); (window as any).__w2372DCalibration = { attack, calibration };
      clean = false; status.style.display = "block"; routeSummaryText = JSON.stringify({ attack, calibration }, null, 2); status.textContent = routeSummaryText; publish();
    }); });
    button("RUN HIT MATRIX", () => { clean = false; status.style.display = "block"; status.textContent = "Running READY / START / HIT / REPEAT / MISS / SECOND…";
      void runHitMatrix().then(result => { routeSummaryText = JSON.stringify({ hitMatrix: result }, null, 2); status.textContent = routeSummaryText; publish(); }); });
    if (jkaComboEnabled) {
      button("RUN W237.2E COMBO MATRIX", () => {
        clean = false; status.style.display = "block"; status.textContent = "Running source-window single / double / early / late / miss tests…";
        void runNativeComboMatrix().then(result => {
          routeSummaryText = JSON.stringify({ nativeJkaComboMatrix: result }, null, 2);
          status.dataset.comboMatrix = routeSummaryText; status.textContent = routeSummaryText; publish();
        }).catch(error => { errors.push(String(error)); publish(); });
      });
    }
    button("TRACE DEBUG", () => { traceDebug = !traceDebug; if (!traceDebug) clearDebugLines(); publish(); });
  }
  if (jkaParryLabMode) {
    if (jkaReverseParryLabMode) {
      header.textContent = "W237.2F.2 · JOLEE ATTACKS → AREN MANUAL BLOCK";
      button("RESET DUEL", () => { resetReverseDuel(false); clean = false; status.style.display = "block"; publish(); });
      button("HOLD BLOCK", () => { setArenBlockState(true); });
      button("RELEASE BLOCK", () => { setArenBlockState(false); });
      button("BLOCK READY PREVIEW", () => { setArenBlockState(true); });
      button("PARRY RESPONSE PREVIEW", () => { manualBlockInputActive = true; arenBlockState = "BLOCK_READY"; playArenDefenseResponse(); });
      button("RETURN READY", () => { manualBlockInputActive = false; arenBlockState = "NOT_PARRYING"; setReady(true, "DEV_DEFENSE_INSPECT_RETURN_READY"); });
      for (const caseId of ["R_A_READY", "R_B_UNBLOCKED_DAMAGE", "R_C_MANUAL_BLOCK", "R_D_MULTI_FRAME_DEDUP", "R_E_RELEASE_BLOCK", "R_F_SECOND_ATTACK", "R_G_BLOCK_MISS"] as const) {
        button("RUN " + caseId.replace("R_", "R-"), () => { clean = false; status.style.display = "block"; status.textContent = "Running " + caseId + "…"; void runReverseParryCase(caseId).then(result => { routeSummaryText = JSON.stringify({ reverseParryCase: result }, null, 2); status.textContent = routeSummaryText; publish(); }).catch(error => { errors.push(String(error)); publish(); }); });
      }
    } else {
      header.textContent = "W237.2F.1 · ROSH vs JOLEE · FIRST PHYSICAL PARRY";
      button("RESET DUEL", () => { resetParryTest(true); clean = false; status.style.display = "block"; publish(); });
      button("JOLEE READY", () => { setJoleeParryReady(true); publish(); });
      button("JOLEE NOT PARRYING", () => { setJoleeParryReady(false); publish(); });
      for (const caseId of ["A_READY", "B_UNBLOCKED_DAMAGE", "C_FIRST_PARRY", "D_MULTI_FRAME_DEDUP", "E_SECOND_ATTACK", "F_MISS", "G_100MS_SWEEP"] as const) {
        button("RUN CASE " + caseId.slice(0, 1), () => { clean = false; status.style.display = "block"; status.textContent = "Running " + caseId + "…"; void runParryCase(caseId).then(result => { routeSummaryText = JSON.stringify({ parryCase: result }, null, 2); status.textContent = routeSummaryText; publish(); }).catch(error => { errors.push(String(error)); publish(); }); });
      }
      button("RUN ALL PARRY CASES", () => { clean = false; status.style.display = "block"; status.textContent = "Running deterministic parry matrix A–G…"; void runParryMatrix().then(result => { routeSummaryText = JSON.stringify({ parryMatrix: result }, null, 2); status.textContent = routeSummaryText; publish(); }).catch(error => { errors.push(String(error)); publish(); }); });
    }
  }
  if (jkaControlSwapMode && jkaNaraSelected && jkaNaraFollower) {
    header.textContent = "W237.2G.1 · TACTICAL PAUSE + PARTY SELECTION";
    const partyBar = document.createElement("div");
    partyBar.style.cssText = "width:100%;padding:6px 8px;margin:4px 0;color:#d9f7ff;background:#122530;border:1px solid #496774;border-radius:4px;font:11px ui-monospace,Consolas,monospace";
    controls.appendChild(partyBar);
    const showControlState = () => {
      clean = false; status.style.display = "block";
      const state = adapter.state() as any;
      routeSummaryText = JSON.stringify({ partySelection: {
        controlled: state.controlledActorId, follower: state.followerActorId,
        roster: state.partySelection?.roster ?? ["AREN", "NARA"], selected: state.partySelection?.selectedMemberId ?? state.controlledActorId,
        selectionStatus: state.partySelection?.selectionStatus ?? "SELECTED_ACTIVE", pendingMemberId: state.partySelection?.pendingMemberId ?? null,
        lastSelectionReason: state.partySelection?.lastSelectionReason ?? "UNKNOWN",
        playerPosition: state.position, naraPosition: jkaNaraFollower.root.position.asArray(),
        partySize: 2, joleeRole: joleeNpcEnabled ? "ACADEMY_STORY_NPC" : "ABSENT",
        ownershipStatus: state.controlOwnership?.status ?? "IDLE", pendingActorId: state.controlOwnership?.pendingActorId ?? null,
        tacticalSelected: state.tacticalOrderSelection?.selectedMemberId ?? null,
        tacticalQueues: state.tacticalQueues ?? null,
        tacticalExecutor: state.tacticalExecutor ?? null,
        tacticalHistory: adapter.tacticalCommandHistory().slice(-12).map((command: any) => ({
          id: command.id, actorId: command.actorId, type: command.type, targetActorId: command.targetActorId ?? null,
          state: command.state, reason: command.reason ?? null, startedAtSequence: command.startedAtSequence ?? null,
          finishedAtSequence: command.finishedAtSequence ?? null,
        })),
        naraTeleports: jkaNaraFollower.recoveryTeleports, naraStuck: jkaNaraFollower.stuckCount,
        visFallbacks: visFallbackCount, wokRejects: state.edgeRejectCount,
        tacticalPause: tacticalPause.snapshot(),
        hostileMercenary: academyHostile ? { actorId: academyHostile.target.targetId, health: academyHostile.target.health, alive: academyHostile.target.alive, targetable: academyHostile.target.targetable,
          hitEvents: academyHostile.target.hitEvents, damageEvents: academyHostile.target.damageEvents, room: academyHostile.hit.room, face: academyHostile.hit.face,
          blaster: academyHostile.fire.telemetry(), rangedHealth: Object.fromEntries(academyHostile.rangedHealth), muzzle: academyHostile.weapon.telemetry(),
          attacks: Object.fromEntries([...academyHostile.attacks.entries()].map(([id, attack]) => [id, { ...attack }])),
          traces: Object.fromEntries([...academyHostile.traces.entries()].map(([id, trace]) => [id, {
            attackInstanceId: trace.attackInstanceId, phase: trace.phase, framesTraced: trace.framesTraced,
            hitEvents: trace.hitEvents.length, repeatContactsSuppressed: trace.repeatContactsSuppressed,
          }])),
          sampleCalls: academyHostile.sampleCalls, sampleUpdates: academyHostile.sampleUpdates,
          sampleMissingAttachment: academyHostile.sampleMissingAttachment,
        } : null,
      } }, null, 2);
      status.textContent = routeSummaryText; publish();
      const selected = state.partySelection?.selectedMemberId ?? state.controlledActorId;
      const pending = state.partySelection?.pendingMemberId;
      const tacticalSelected = state.tacticalOrderSelection?.selectedMemberId ?? state.controlledActorId;
      const qA = state.tacticalQueues?.aren?.length ?? 0, qN = state.tacticalQueues?.nara?.length ?? 0;
      partyBar.textContent = `▶ AREN · ${state.controlledActorId === "AREN" ? "CONTROLLED" : pending === "AREN" ? "QUEUED" : "FOLLOWER"} · TACTICAL ${tacticalSelected === "AREN" ? "SELECTED" : "—"} · Q${qA}    |    ${selected === "NARA" ? "▶" : " "} NARA · ${state.controlledActorId === "NARA" ? "CONTROLLED" : pending === "NARA" ? "QUEUED" : "FOLLOWER"} · TACTICAL ${tacticalSelected === "NARA" ? "SELECTED" : "—"} · Q${qN}`;
    };
    button("SELECT AREN", () => { adapter.selectPartyMember("AREN"); showControlState(); });
    button("SELECT NARA", () => { adapter.selectPartyMember("NARA"); showControlState(); });
    button("NEXT MEMBER", () => { adapter.selectNextPartyMember(); showControlState(); });
    button("PREVIOUS MEMBER", () => { adapter.selectPreviousPartyMember(); showControlState(); });
    button("PAUSE", () => { tacticalPause.pause("UI"); showControlState(); });
    button("RESUME", () => { tacticalPause.resume("UI"); showControlState(); });
    button("TOGGLE PAUSE", () => { tacticalPause.toggle("UI"); showControlState(); });
    button("TACTICAL AREN", () => { adapter.selectTacticalActor("AREN"); showControlState(); });
    button("TACTICAL NARA", () => { adapter.selectTacticalActor("NARA"); showControlState(); });
    button("QUEUE MOVE ORDER", () => {
      if (!tacticalPause.paused) { status.textContent = "TACTICAL ORDER REJECTED · PAUSE_REQUIRED"; return; }
      const state = adapter.state() as any; const selected = adapter.tacticalOrderSelectionSnapshot()?.selectedMemberId;
      const position = selected === "NARA" ? jkaNaraFollower.root.position : new Vector3(...(state.position as [number, number, number]));
      const destination = { x: position.x + (selected === "NARA" ? 1.2 : -1.2), y: position.y, z: position.z + (selected === "NARA" ? -0.8 : 0.8) };
      const result = adapter.queueTacticalMove(destination); status.textContent = result.accepted ? `TACTICAL MOVE QUEUED · ${selected}` : `TACTICAL MOVE REJECTED · ${result.reason}`; showControlState();
    });
    button("CLEAR TACTICAL SELECTED", () => { adapter.clearTacticalSelected(); showControlState(); });
    button("CLEAR TACTICAL ALL", () => { adapter.clearTacticalAll(); showControlState(); });
    button("NARA ANIMATION AUDIT", () => {
      clean = false; status.style.display = "block";
      const audit = captureNaraAnimationAudit("UI_AUDIT");
      routeSummaryText = JSON.stringify({ naraAnimationAudit: audit ? { latest: audit.latest, transitions: audit.transitions.slice(-12) } : null }, null, 2); status.textContent = routeSummaryText; publish();
    });
    button("RUN TACTICAL ACADEMY · 2 TRANSITIONS", () => { void runAcademyTacticalTwoTransition(); });
    button("RUN PAUSE ATTACK REGRESSION", () => { void runG2PauseAttackRegression(); });
    button("CONTROL TELEMETRY", showControlState);
    showControlState();
  }
  if (jkaHostileMode && academyHostile) {
    panel.style.display = "block";
    header.textContent = "W237.2G.3H · ACADEMY HOSTILE MERCENARY";
    for (const label of ["CALIBRATE DUMMY FROM SWING", "RUN HIT MATRIX"]) {
      const legacy = [...controls.querySelectorAll<HTMLButtonElement>("button")].find(candidate => candidate.textContent === label);
      if (legacy) legacy.style.display = "none";
    }
    button("HOSTILE RESET", () => { resetAcademyHostile(); showAcademyHostileResult({ caseId: "RESET", pass: true, health: academyHostile.target.health }); });
    button("AREN ATTACK HOSTILE", () => { tacticalPause.pause("HOSTILE_UI"); const result = queueAcademyHostileAttack("AREN"); tacticalPause.resume("HOSTILE_UI"); showAcademyHostileResult({ caseId: "AREN_ATTACK", result }); });
    button("NARA ATTACK HOSTILE", () => { tacticalPause.pause("HOSTILE_UI"); const result = queueAcademyHostileAttack("NARA"); tacticalPause.resume("HOSTILE_UI"); showAcademyHostileResult({ caseId: "NARA_ATTACK", result }); });
    const fireHostileAt = (id: "AREN_NATIVE_JKA_V1" | "NARA_NATIVE_JKA_V1", throughBlade = false) => {
      const attachment = id === "AREN_NATIVE_JKA_V1" ? genericSabers.get("Aren") : genericSabers.get("Nara");
      if (throughBlade && academyHostile) {
        const defenderRoot = id === "AREN_NATIVE_JKA_V1" ? adapter.player.root : jkaNaraFollower?.root;
        if (defenderRoot) {
          const hostilePosition = academyHostile.target.root.getAbsolutePosition();
          const defenderPosition = defenderRoot.getAbsolutePosition();
          defenderRoot.rotation.y = Math.atan2(hostilePosition.x - defenderPosition.x, hostilePosition.z - defenderPosition.z);
          defenderRoot.computeWorldMatrix(true);
        }
      }
      const segment = throughBlade ? attachment?.getBladeSegment() : undefined;
      const point = segment ? Vector3.Lerp(segment.start, segment.end, .5) : id === "AREN_NATIVE_JKA_V1" ? adapter.player.root.getAbsolutePosition().add(new Vector3(0, 1.02, 0)) : (jkaNaraFollower?.root.getAbsolutePosition() ?? new Vector3(9999, 9999, 9999)).add(new Vector3(0, 1.02, 0));
      const result = academyHostile.fire.requestSingleShot(id, point); showAcademyHostileResult({ caseId: "BLASTER_" + id + (throughBlade ? "_BLADE" : ""), result, fire: academyHostile.fire.telemetry() });
    };
    button("AREN BLOCK ON", () => { academyHostile.blockEligible.set("AREN_NATIVE_JKA_V1", true); showAcademyHostileResult({ blockEligible: Object.fromEntries(academyHostile.blockEligible) }); });
    button("AREN BLOCK OFF", () => { academyHostile.blockEligible.set("AREN_NATIVE_JKA_V1", false); showAcademyHostileResult({ blockEligible: Object.fromEntries(academyHostile.blockEligible) }); });
    button("NARA BLOCK ON", () => { academyHostile.blockEligible.set("NARA_NATIVE_JKA_V1", true); showAcademyHostileResult({ blockEligible: Object.fromEntries(academyHostile.blockEligible) }); });
    button("NARA BLOCK OFF", () => { academyHostile.blockEligible.set("NARA_NATIVE_JKA_V1", false); showAcademyHostileResult({ blockEligible: Object.fromEntries(academyHostile.blockEligible) }); });
    button("RODIAN FIRE AREN", () => fireHostileAt("AREN_NATIVE_JKA_V1"));
    button("RODIAN FIRE BLADE AREN", () => fireHostileAt("AREN_NATIVE_JKA_V1", true));
    button("RODIAN FIRE NARA", () => fireHostileAt("NARA_NATIVE_JKA_V1"));
    button("RODIAN FIRE BLADE NARA", () => fireHostileAt("NARA_NATIVE_JKA_V1", true));
    button("RODIAN FIRE PAUSE", () => { tacticalPause.pause("BLASTER_BEFORE_RELEASE"); fireHostileAt("AREN_NATIVE_JKA_V1"); });
    button("RODIAN FIRE RESUME", () => tacticalPause.resume("BLASTER_BEFORE_RELEASE"));
    button("RODIAN TELEMETRY", () => { const snapshot = { fire: academyHostile.fire.telemetry(), rangedHealth: Object.fromEntries(academyHostile.rangedHealth), blockEligible: Object.fromEntries(academyHostile.blockEligible), interceptor: academyHostile.interceptor.telemetry(), muzzle: academyHostile.weapon.telemetry(), tacticalPause: tacticalPause.snapshot() }; routeSummaryText = JSON.stringify(snapshot, null, 2); status.dataset.routeSummary = routeSummaryText; status.style.display = "block"; status.textContent = routeSummaryText; });
    button("PLACE HOSTILE FAR", () => { placeAcademyHostile(academyHostileFarHit); showAcademyHostileResult({ caseId: "PLACE_FAR", hit: academyHostile.hit }); });
    button("H1 FRIENDLY", () => showAcademyHostileResult(runAcademyHostileCase("H1")));
    button("H2 AREN", () => showAcademyHostileResult(runAcademyHostileCase("H2")));
    button("H3 NARA", () => showAcademyHostileResult(runAcademyHostileCase("H3")));
    button("H4 APPROACH", () => showAcademyHostileResult(runAcademyHostileCase("H4")));
    button("H5 MIXED", () => showAcademyHostileResult(runAcademyHostileCase("H5")));
    button("H6 SHARED", () => showAcademyHostileResult(runAcademyHostileCase("H6")));
    button("H7 DEFEAT", () => showAcademyHostileResult(runAcademyHostileCase("H7")));
    button("H8 PAUSE", () => showAcademyHostileResult(runAcademyHostileCase("H8")));
    button("H10 STRESS", () => showAcademyHostileResult(runAcademyHostileCase("H10")));
  }
  button("EXPLORATION", () => setReady(false));
  button("WALK · WASD", () => { prepareMovement(); adapter.setInputEnabled(true); });
  button("RUN · SHIFT", () => { prepareMovement(); adapter.setInputEnabled(true); });
  button("FULL ACADEMY ROUTE", () => { clean = false; status.style.display = "block"; status.textContent = "Running source-room coverage route…"; void runFullRoute().then((r: any) => {
    (window as any).__w2372FullRoute = r; publish();
    routeSummaryText = JSON.stringify({ pass: r.pass, distance: r.distance, walkDistance: r.walkDistance, runDistance: r.runDistance,
      reachableRooms: r.reachableRooms, visitedRooms: r.visitedRooms, coveragePercent: r.coveragePercent,
      routeSegments: r.routeSegments?.map((s: any) => ({ room: s.room, targetNode: s.targetNode, sourceWokFace: s.sourceWokFace, sourceProjectionError: s.sourceProjectionError, sourceHeightDelta: s.sourceHeightDelta, running: s.running, pass: s.pass, reason: s.result?.reason ?? s.result?.route?.reason, targetPosition: s.result?.targetPosition, endPosition: s.result?.end, endRoom: s.result?.endRoom, remaining: s.result?.remaining, lastDriveSegment: s.result?.route?.segments?.at(-1) })),
      roomTransitions: r.roomTransitions?.map((t: any) => ({ fromRoom: t.fromRoom, toRoom: t.toRoom, fromFace: t.fromFace, toFace: t.toFace, method: t.method, gitDoorId: t.gitDoorId })),
      doorCrossings: r.doorCrossings, visFallbackCount: r.visFallbackCount, edgeRejectCount: r.edgeRejectCount,
      followers: r.followerMetrics?.map((f: any) => ({ id: f.id, distance: f.distance, distanceWalk: f.distanceWalk, distanceRun: f.distanceRun,
        maxSeparation: f.maxSeparation, meanSeparation: f.meanSeparation, roomLag: f.roomLag, repathCount: f.repathCount,
        stuckCount: f.stuckCount, recoveryTeleports: f.recoveryTeleports, invalidFaceAttempts: f.invalidFaceAttempts, roomTransitions: f.roomTransitions })),
      patioDoorDistance: r.patioDoorDistance, patioLoaded: r.patioLoaded, shipTriggerEnabled: r.shipTriggerEnabled
    }, null, 2);
    status.dataset.routeSummary = routeSummaryText; status.textContent = routeSummaryText;
  }).catch(e => { errors.push(String(e)); publish(); }); });
  button("PRESENTATION ROUTE · 4 ROOMS", () => { clean = false; status.style.display = "block"; status.textContent = "Running deterministic presentation route…"; void runRouteToRoomCount(4).then((r: any) => {
    (window as any).__w2372PresentationRoute = r; routeSummaryText = JSON.stringify({ presentationRoute: r }, null, 2); status.dataset.routeSummary = routeSummaryText; status.textContent = routeSummaryText; publish();
  }).catch(e => { errors.push(String(e)); publish(); }); });
  if (leaderProfile.id === "aren-native-jka-v1" && naraNativeSelected) button("NATIVE PAIR SMOKE · 3 ROOMS", () => {
    clean = false; status.style.display = "block"; status.textContent = "Running native Rosh + Jan three-room smoke…";
    void runRouteToRoomCount(3).then((r: any) => {
      (window as any).__w2372NativePairShortSmoke = r;
      routeSummaryText = JSON.stringify({ nativePairShortSmoke: r }, null, 2);
      status.dataset.routeSummary = routeSummaryText; status.textContent = routeSummaryText; publish();
    }).catch(e => { errors.push(String(e)); publish(); });
  });
  if (jkaControlSwapMode && leaderProfile.id === "aren-native-jka-v1" && naraNativeSelected) button("PARTY SELECTION SMOKE · 3 ROOMS", () => {
    clean = false; status.style.display = "block"; status.textContent = "Running party-selection room continuity smoke…";
    void runRouteToRoomCount(3).then((r: any) => {
      const visited = new Set<string>(r.visitedRooms ?? []);
      const followerClean = (r.followerMetrics ?? []).every((f: any) => f.recoveryTeleports === 0 && f.stuckCount === 0 && f.animationFallbacks === 0);
      const selectionSmoke = {
        pass: (r.routeSegments ?? []).length === 3 && (r.routeSegments ?? []).every((segment: any) => segment.pass) && visited.size >= 3 && followerClean && Number(r.visFallbackCount ?? 0) === 0 && Number(r.edgeRejectCount ?? 0) === 0,
        roomsVisited: [...visited], segments: r.routeSegments?.map((segment: any) => ({ room: segment.room, pass: segment.pass })),
        naraTeleports: Math.max(0, ...(r.followerMetrics ?? []).map((f: any) => Number(f.recoveryTeleports ?? 0))), naraStuck: Math.max(0, ...(r.followerMetrics ?? []).map((f: any) => Number(f.stuckCount ?? 0))),
        visFallbacks: Number(r.visFallbackCount ?? 0), wokRejects: Number(r.edgeRejectCount ?? 0), legacyRoutePass: Boolean(r.pass),
      };
      (window as any).__w2372G0AcademySelection = selectionSmoke;
      routeSummaryText = JSON.stringify({ partySelectionSmoke: selectionSmoke }, null, 2); status.dataset.routeSummary = routeSummaryText; status.textContent = routeSummaryText; publish();
    }).catch(e => { errors.push(String(e)); publish(); });
  });
  if (leaderProfile.id === "aren-native-jka-v1" && naraNativeSelected) button("CANONICAL PARTY ROUTE · 5 ROOMS", () => { clean = false; status.style.display = "block"; status.textContent = "Running the same five-room canonical route…"; void runRouteToRoomCount(5).then((r: any) => {
    (window as any).__w2372CanonicalPartyRoute = r; routeSummaryText = JSON.stringify({ canonicalPartyRoute: r }, null, 2); status.dataset.routeSummary = routeSummaryText; status.textContent = routeSummaryText; publish();
  }).catch(e => { errors.push(String(e)); publish(); }); });
  if (leaderProfile.id === "aren-caleb-jka-candidate" && naraCandidate) button("CANDIDATE A/B ROUTE · 5 ROOMS", () => { clean = false; status.style.display = "block"; status.textContent = "Running the shared five-room A/B route…"; void runRouteToRoomCount(5).then((r: any) => {
    (window as any).__w2372CandidatePartyRoute = r; routeSummaryText = JSON.stringify({ candidatePartyRoute: r }, null, 2); status.dataset.routeSummary = routeSummaryText; status.textContent = routeSummaryText; publish();
  }).catch(e => { errors.push(String(e)); publish(); }); });
  if (joleeNpc) button("RETURN TO JOLEE", () => { clean = false; status.style.display = "block"; status.textContent = "Returning to stationary Academy NPC…"; void adapter.runRouteTo(joleeNpc!.hit.point, joleeNpc!.hit.room, false).then((r: any) => { (window as any).__w2372JoleeNpcApproach = r; routeSummaryText = JSON.stringify({ joleeNpcApproach: r, interactionAvailable: distanceToJoleeNpc() <= 2.25 }, null, 2); status.textContent = routeSummaryText; publish(); }).catch(error => { errors.push(String(error)); publish(); }); });
  button("CLEAN", () => { clean = true; readyAnimationAuditPinned = false; status.style.display = "none"; });
  button("METRICS", () => { clean = false; readyAnimationAuditPinned = false; status.style.display = "block"; publish(); });
  button("READY ANIMATION AUDIT", () => {
    clean = false; readyAnimationAuditPinned = true; status.style.display = "block";
    routeSummaryText = JSON.stringify(readyInitializationTelemetry(), null, 2);
    status.dataset.readyAnimationOwnership = routeSummaryText;
    status.dataset.routeSummary = routeSummaryText;
    status.textContent = routeSummaryText;
  });
  if (jkaReadyTransitionDiag) {
        header.textContent = jkaReadyProfileAB && !calebJkaSelected ? "W237.2D.3C · NATIVE AREN READY CONTROL" : "W237.2D.3C · CALEB READY TRANSITION ISOLATION";
    const diagnosticButtons = new Set<HTMLButtonElement>();
    const caseButton = (label: string, caseId: "A_DIRECT_READY" | "B_LOCOMOTION_PROFILE_ONLY" | "C_COMBAT_READY_ONLY" | "D_DIRECT_PROFILE_CLIP" | "E_CURRENT_FULL_TRANSITION" | "F_CALEB_NATIVE_PROFILE_BRANCH") => {
      const item = button(label, () => { void runReadyTransitionCase(caseId); });
      diagnosticButtons.add(item);
    };
    caseButton("A · DIRECT READY CONTROL", "A_DIRECT_READY");
    caseButton("B · LOCOMOTION PROFILE ONLY", "B_LOCOMOTION_PROFILE_ONLY");
    caseButton("C · COMBAT READY ONLY", "C_COMBAT_READY_ONLY");
    caseButton("D · DIRECT PROFILE CLIP", "D_DIRECT_PROFILE_CLIP");
    caseButton("E · CURRENT FULL TRANSITION", "E_CURRENT_FULL_TRANSITION");
    if (calebJkaSelected) caseButton("F · CALEB NATIVE PROFILE BRANCH", "F_CALEB_NATIVE_PROFILE_BRANCH");
    const exportButton = button("EXPORT JOINT SNAPSHOTS JSON", () => {
      const payload = (window as any).__w2372D3CTransitionCases;
      const completed = readyTransitionCaseRuns.filter(row => row.status === "COMPLETE");
      if (!payload || !completed.length) { status.textContent = "Run at least Case A before exporting."; return; }
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob), anchor = document.createElement("a");
      anchor.href = url; anchor.download = "w237_2d3c_joint_diffs.json"; document.body.appendChild(anchor); anchor.click(); anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      routeSummaryText = JSON.stringify({ export: "w237_2d3c_joint_diffs.json", bytes: blob.size, cases: completed.map(row => row.caseId) }, null, 2);
      status.textContent = routeSummaryText;
    });
    diagnosticButtons.add(exportButton);
    for (const item of [...controls.querySelectorAll("button")]) if (!diagnosticButtons.has(item)) item.style.display = "none";
    status.style.display = "block";
    const armedDiff = readyProfileAudit.armedLocomotionProfiles.currentBranchDiff;
    status.textContent = (calebJkaSelected ? "CALEB ONLY" : "NATIVE AREN CONTROL") + " · jkaWeapons=" + (jkaWeaponsOff ? "off" : "on") + " · jkaRootReset=" + (jkaRootResetEnabled ? "on" : "off") + " · init=" + jkaReadyInitMode +
      "\n" + (calebJkaSelected ? "Run E current behavior, then F native-Aren profile branch." : "Run A direct READY, then E current setReady transition.") +
      "\nREADY CLIP " + String(leaderProfile.leaderCombatProfile?.groups.saberReady) + " · resolves=" + leaderAsset.animationGroups.filter(group => group.name === leaderProfile.leaderCombatProfile?.groups.saberReady).length +
      "\nARMED PROFILE DIFF " + JSON.stringify(armedDiff) +
      "\nProfiles/groups exported in __w2372D3CReadyProfileAudit; snapshots capture same-frame, +1, +5 and 53 joints.";    status.dataset.profileAudit = JSON.stringify(readyProfileAudit);
    (window as any).__w2372D3CTransitionCases = { cases: readyTransitionCaseRuns, summary: {}, settings: null, profileAudit: readyProfileAudit, runtimeErrors: errors };
  }
  let gripInspectionCapturePending = false;
  let gripInspectionExpectedGroup: string | null = null;
  let gripInspectionRepresentativeFrame: number | null = null;
  const gripInspectionGroupForPose: Record<NonNullable<typeof gripInspectPose>, string | undefined> = {
    ready: leaderProfile.leaderCombatProfile?.groups.saberReady,
    attack1_start: leaderProfile.leaderCombatProfile?.groups.attackStart,
    attack1: leaderProfile.leaderCombatProfile?.groups.attack,
    combo_transition: leaderProfile.leaderCombatProfile?.groups.comboTransition,
    attack2: leaderProfile.leaderCombatProfile?.groups.comboAttack,
    attack2_return: leaderProfile.leaderCombatProfile?.groups.comboReturn,
    final_ready: leaderProfile.leaderCombatProfile?.groups.saberReady,
  };
  const gripInspectionUrls = Object.fromEntries(supportedGripInspectPoses.map(pose => {
    const url = new URL(location.href);
    url.search = "";
    url.searchParams.set("jediAcademyLab", "1");
    url.searchParams.set("leader", "aren-native-jka-v1");
    url.searchParams.set("jkaWeapon", "native");
    url.searchParams.set("jkaCombo", "1");
    url.searchParams.set("jkaGripInspect", pose);
    url.searchParams.set("jkaReadyInit", "none");
    url.searchParams.set("jkaRootReset", "off");
    url.searchParams.set("nara", "none");
    url.searchParams.set("jolee", "off");
    return [pose, url.toString()];
  }));
  const startGripInspection = () => {
    if (!gripInspectPose) return;
    const clipName = gripInspectionGroupForPose[gripInspectPose];
    const group = clipName ? leaderAsset.animationGroups.find(candidate => candidate.name === clipName) : null;
    if (!group) throw new Error("JKA_GRIP_INSPECT_ANIMATION_GROUP_MISSING:" + String(clipName));
    armed = false;
    attackSequenceActive = false;
    adapter.player.setInputEnabled(false);
    adapter.camera.camera.detachControl();
    canvas.style.pointerEvents = "none";
    adapter.camera.yaw = 0.16;
    adapter.camera.pitch = 0.14;
    adapter.camera.distance = 4.1;
    (adapter.camera as any).effectiveDistance = 4.1;
    (adapter.camera as any).revealRemaining = 0;
    adapter.camera.camera.fov = 0.82;
    adapter.camera.update();
    leaderAsset.animationGroups.forEach(candidate => candidate.stop());
    const representativeFrame = Number(((group.from + group.to) / 2).toFixed(3));
    group.start(false, 1, group.from, group.to);
    group.goToFrame(representativeFrame);
    group.pause();
    gripInspectionExpectedGroup = group.name;
    gripInspectionRepresentativeFrame = representativeFrame;
    gripInspectionCapturePending = true;
    clean = false;
    header.textContent = "W237.2E.A2 · NATIVE JKA GRIP INSPECTION · " + gripInspectPose.toUpperCase();
    panel.style.width = "min(720px,calc(100vw - 28px))";
    controls.style.display = "none";
    status.style.display = "none";
    gripInspectionOutput.hidden = false;
    gripInspectionOutput.textContent = "Freezing " + group.name + " at representative frame " + representativeFrame + "…";
  };
  button("LEADER: " + leaderProfile.displayName, () => {
    const target = leaderProfile.id === "aren-jka-prototype" ? "jolee" : leaderProfile.id === "jolee" ? "nara" : "aren-jka-prototype";
    const url = new URL(location.href); url.searchParams.set("jediAcademyLab", "1"); url.searchParams.set("party", "1"); url.searchParams.set("leader", target); url.searchParams.delete("leaderSmoke");
    location.href = url.toString();
  });
  button(joleeNpcEnabled ? "TWO SABERS" : "THREE SABERS", () => { setReady(true); publish(); });
  button("GROUNDING POSE AUDIT", () => { void runGroundingPoseAudit(); });
  button("HIDE PANEL", () => { panel.style.display = "none"; });
  button("SHOW PANEL", () => { panel.style.display = "block"; });
  if (jkaParryLabMode) {
    const parryVisibleLabels = jkaReverseParryLabMode ? new Set([
      "RESET DUEL", "HOLD BLOCK", "RELEASE BLOCK", "RUN R-A_READY", "RUN R-B_UNBLOCKED_DAMAGE", "RUN R-C_MANUAL_BLOCK",
      "RUN R-D_MULTI_FRAME_DEDUP", "RUN R-E_RELEASE_BLOCK", "RUN R-F_SECOND_ATTACK", "RUN R-G_BLOCK_MISS",
      "CLEAN", "METRICS", "HIDE PANEL", "SHOW PANEL",
    ]) : new Set([
      "RESET DUEL", "JOLEE READY", "JOLEE NOT PARRYING", "RUN CASE A", "RUN CASE B", "RUN CASE C",
      "RUN CASE D", "RUN CASE E", "RUN CASE F", "RUN CASE G", "RUN ALL PARRY CASES", "TRACE DEBUG",
      "CLEAN", "METRICS", "HIDE PANEL", "SHOW PANEL",
    ]);
    for (const item of [...controls.querySelectorAll("button")]) {
      if (!parryVisibleLabels.has(item.textContent ?? "")) item.style.display = "none";
    }
  }
  if (jkaReadyTransitionDiag) {
    const visibleDiagnosticLabels = new Set(["A · DIRECT READY CONTROL", "B · LOCOMOTION PROFILE ONLY", "C · COMBAT READY ONLY", "D · DIRECT PROFILE CLIP", "E · CURRENT FULL TRANSITION", "F · CALEB NATIVE PROFILE BRANCH", "EXPORT JOINT SNAPSHOTS JSON", "HIDE PANEL"]);
    for (const item of [...controls.querySelectorAll("button")]) if (!visibleDiagnosticLabels.has(item.textContent ?? "")) item.style.display = "none";
  }
  if (!gripInspectPose) {
    if (jkaReverseParryLabMode) { setReady(true, "REVERSE_PARRY_LAB_INITIAL_READY"); manualBlockInputActive = false; arenBlockState = "NOT_PARRYING"; playJoleeClip("g2r1", true); adapter.setInputEnabled(false); }
    else if (jkaParryLabMode) { setReady(true, "PARRY_LAB_INITIAL_READY"); setJoleeParryReady(true); }
    else if (jkaReadyInitMode === "double") setReady(true, "INIT_DOUBLE_BEFORE_SCENE_READY");
    else initializeExplorationState();
    captureReadyAnimationSample("PRE_SCENE_READY_" + jkaReadyInitMode.toUpperCase());
  }
  (window as any).__jediAcademyPartyTest = {
    state: publish, setReady, fullRoute: runFullRoute, firstAttack: playFirstAttackSequence,
    nativeCombo: runNativeComboSequence, nativeComboMatrix: runNativeComboMatrix, nativeComboInput: progressNativeComboInput,
    returnToJolee: async () => joleeNpc ? adapter.runRouteTo(joleeNpc.hit.point, joleeNpc.hit.room, false) : { pass: false, reason: "JOLEE_NPC_DISABLED" },
    interactJolee: triggerJoleeInteraction,
    calibrateDummy: async () => { const attack = await playFirstAttackSequence(true); return { attack, calibration: calibrateDummyFromBlade() }; },
    hitMatrix: runHitMatrix,
    parry: jkaParryLabMode ? {
      reset: () => { resetParryTest(true); return (window as any).__jediAcademyPartyState; },
      setJoleeReady: () => { setJoleeParryReady(true); publish(); },
      setJoleeNotParrying: () => { setJoleeParryReady(false); publish(); },
      runCase: runParryCase,
      runMatrix: runParryMatrix,
      controller: parryController,
    } : null,
    reverseParry: jkaReverseParryLabMode ? {
      reset: () => { resetReverseDuel(false); publish(); return (window as any).__jediAcademyPartyState; },
      holdBlock: () => { setArenBlockState(true); return publish(); },
      releaseBlock: () => { setArenBlockState(false); return publish(); },
      runCase: runReverseParryCase,
      controller: parryController,
    } : null,
    leaderSmoke: async () => {
      const result = await (adapter as any).runSurvey();
      const smoke = { leader: adapter.leaderId, ...result };
      (window as any).__w2372LeaderSmoke = smoke;
      clean = false; status.style.display = "block";
      routeSummaryText = JSON.stringify({ leaderSmoke: smoke }, null, 2);
      status.dataset.leaderSmoke = routeSummaryText; status.textContent = routeSummaryText;
      publish(); return (window as any).__w2372LeaderSmoke;
    },
    camera: adapter.camera,
    tacticalPause,
  };
  (window as any).__w2372G3HAcademyHostile = jkaHostileMode ? {
    target: () => academyHostile ? { id: academyHostile.target.targetId, health: academyHostile.target.health, alive: academyHostile.target.alive, targetable: academyHostile.target.targetable, hitEvents: academyHostile.target.hitEvents, damageEvents: academyHostile.target.damageEvents, room: academyHostile.hit.room, face: academyHostile.hit.face } : null,
    reset: resetAcademyHostile,
    runCase: runAcademyHostileCase,
    queueAttack: (actor: "AREN" | "NARA") => { tacticalPause.pause("HOSTILE_API"); const result = queueAcademyHostileAttack(actor); tacticalPause.resume("HOSTILE_API"); return result; },
    fireAt: (id: "AREN_NATIVE_JKA_V1" | "NARA_NATIVE_JKA_V1", throughBlade = false) => {
      if (!academyHostile) return { accepted: false, reason: "HOSTILE_NOT_LOADED" };
      const attachment = id === "AREN_NATIVE_JKA_V1" ? genericSabers.get("Aren") : genericSabers.get("Nara");
      const segment = throughBlade ? attachment?.getBladeSegment() : undefined;
      const point = segment ? Vector3.Lerp(segment.start, segment.end, .5) : (id === "AREN_NATIVE_JKA_V1" ? adapter.player.root.getAbsolutePosition() : (jkaNaraFollower?.root.getAbsolutePosition() ?? new Vector3(9999, 9999, 9999))).add(new Vector3(0, 1.02, 0));
      return academyHostile.fire.requestSingleShot(id, point);
    },
    setBlock: (id: "AREN_NATIVE_JKA_V1" | "NARA_NATIVE_JKA_V1", enabled: boolean) => { academyHostile?.blockEligible.set(id, enabled); return enabled; },
    fireTelemetry: () => academyHostile?.fire.telemetry() ?? null,
    profile: HOSTILE_MERCENARY_JKA_V1,
  } : null;
  if (jkaReverseParryLabMode) {
    window.addEventListener("keydown", onReverseBlockKey);
    window.addEventListener("keyup", onReverseBlockKey);
  }
  let last = performance.now(), lastUi = 0;
  const renderLoop = () => {
    if (jkaHostileMode && academyHostile && !gripInspectPose) panel.style.display = "block";
    const now = performance.now(), dt = Math.min(.05, (now - last) / 1000); last = now;
    if (!groundingSweepActive && !gripInspectPose) {
      adapter.update(dt, tacticalPause.paused);
      if (joleeNpc) syncJoleeNpcPresentation(currentVisibleRooms);
    }
    if (!gripInspectPose && !tacticalPause.paused) { sampleBlade(dt); sampleAcademyHostileBlade(); }
    if (academyHostile) {
      const arenSegment = genericSabers.get("Aren")?.getBladeSegment();
      const naraSegment = genericSabers.get("Nara")?.getBladeSegment();
      academyHostile.interceptor.updateBlade("AREN_NATIVE_JKA_V1", arenSegment, Boolean(arenSegment));
      academyHostile.interceptor.updateBlade("NARA_NATIVE_JKA_V1", naraSegment, Boolean(naraSegment));
      academyHostile.fire.update(dt, tacticalPause.paused);
      academyHostile.fire.updateProjectile(dt, academyHostile.fireActors, academyHostile.worldHit, tacticalPause.paused, academyHostile.interceptor);
    }
    if (!gripInspectPose && !tacticalPause.paused && armed && !tourRunning && !groundingSweepActive && !attackSequenceActive && !(jkaHostileMode && academyHostile?.attacks.size)) setReadyPose(adapter.player.horizontalSpeed < 0.08);
    scene.render();
    renderedFrameIndex++;
    if (gripInspectionCapturePending && gripInspectPose) {
      gripInspectionCapturePending = false;
      const sample = captureRoshSaberGripSample(gripInspectPose.toUpperCase());
      const activeGroups = leaderAsset.animationGroups.filter(group => group.isStarted && (group.isPlaying || (group as any).isPaused));
      const activeAnimatables = activeGroups.flatMap(group => (group as any).getAnimatables?.() ?? (group as any)._animatables ?? []);
      const payload = {
        mode: gripInspectPose,
        actorId: "AREN_NATIVE_JKA_V1",
        assetPath: leaderProfile.assetPath,
        assetSha256: leaderAssetSha256,
        nativeWeapon: "JKA_NATIVE_TRAINING_SINGLE_SABER_V1",
        expectedGroup: gripInspectionExpectedGroup,
        representativeFrame: gripInspectionRepresentativeFrame,
        activeAnimationGroups: activeGroups.map(group => ({ name: group.name, from: group.from, to: group.to, currentFrame: group.getCurrentFrame(), paused: Boolean((group as any).isPaused), targetCount: group.targetedAnimations.length })),
        activeAnimationGroupCount: activeGroups.length,
        activeAnimatableCount: activeAnimatables.length,
        runtimeAnimationTargetCount: activeAnimatables.reduce((sum: number, animatable: any) => sum + (animatable.getAnimations?.().length ?? 0), 0),
        fixedCamera: { yaw: adapter.camera.yaw, pitch: adapter.camera.pitch, distance: adapter.camera.distance, fov: adapter.camera.camera.fov, position: adapter.camera.camera.position.asArray() },
        sample,
        urls: gripInspectionUrls,
        visualReview: "USER_REVIEW_REQUIRED; no automated visual claim",
      };
      (window as any).__w2372EGripInspection = payload;
      panel.dataset.gripInspection = JSON.stringify(payload);
      gripInspectionOutput.textContent = JSON.stringify(payload, null, 2);
    }
    for (let i = pendingReadyFrameSamples.length - 1; i >= 0; i--) {
      if (pendingReadyFrameSamples[i].dueFrame <= renderedFrameIndex) {
        captureReadyAnimationSample(pendingReadyFrameSamples[i].label);
        pendingReadyFrameSamples.splice(i, 1);
      }
    }
    for (let i = pendingReadyTransitionSamples.length - 1; i >= 0; i--) {
      const pending = pendingReadyTransitionSamples[i];
      if (pending.dueFrame > renderedFrameIndex || activeReadyTransitionCase?.caseId !== pending.caseId) continue;
      try {
        const snapshot = captureReadyTransitionSnapshot(pending.caseId, pending.label as "FRAME_PLUS_1" | "FRAME_PLUS_5");
        const frames = activeReadyTransitionCase.frameSamples ?? (activeReadyTransitionCase.frameSamples = {});
        frames[pending.label === "FRAME_PLUS_1" ? "framePlus1" : "framePlus5"] = snapshot;
        pendingReadyTransitionSamples.splice(i, 1);
        if (pending.label === "FRAME_PLUS_5") activeReadyTransitionCase.resolveFrames?.(frames);
      } catch (error) {
        const message = "READY_TRANSITION_SNAPSHOT_FAILED:" + String(error);
        errors.push(message);
        (window as any).__w2372D3CTransitionCases = { ...(window as any).__w2372D3CTransitionCases, runtimeErrors: errors };
        activeReadyTransitionCase.resolveFrames?.({ captureError: message });
        pendingReadyTransitionSamples.splice(i, 1);
      }
    }
    const isWalking = adapter.player.horizontalSpeed >= 0.08;
    if (isWalking && walkSampleStartedAt == null) {
      walkSampleStartedAt = now; walkOneSecondSampleCaptured = false;
      captureReadyAnimationSample("AFTER_WALK_BEGINS");
    } else if (isWalking && walkSampleStartedAt != null && !walkOneSecondSampleCaptured && now - walkSampleStartedAt >= 1000) {
      walkOneSecondSampleCaptured = true;
      captureReadyAnimationSample("AFTER_WALK_1_SECOND");
    } else if (!isWalking && walkSampleStartedAt != null) {
      if (armed) captureReadyAnimationSample("AFTER_STOP_TO_READY");
      walkSampleStartedAt = null; walkOneSecondSampleCaptured = false;
    }
    if (!gripInspectPose && !clean && !tourRunning && now - lastUi > 180) { lastUi = now; publish(); }
  };
  const resize = () => engine.resize();
  window.addEventListener("resize", resize);
  engine.runRenderLoop(renderLoop);
  await scene.whenReadyAsync();
  document.getElementById("loadingOverlay")?.classList.add("is-hidden");
  if (gripInspectPose) startGripInspection();
  else if (jkaReadyInitMode === "single") setReady(true, "INIT_SINGLE_AFTER_SCENE_READY");
  else if (jkaReadyInitMode === "double") setReady(true, "INIT_DOUBLE_AFTER_SCENE_READY");
  else if (jkaHostileMode) setReady(true, "HOSTILE_ROUTE_INITIAL_READY");
  else { captureReadyAnimationSample("INIT_NONE_AFTER_SCENE_READY"); publish(); }
  const params = new URLSearchParams(location.search);
  if (params.get("leaderSmoke") === "1") window.setTimeout(() => { void (window as any).__jediAcademyPartyTest.leaderSmoke(); }, 1200);
  return {
    state: () => publish(),
    dispose: () => {
      engine.stopRenderLoop(renderLoop); window.removeEventListener("resize", resize);
      unbindTacticalPause(); window.removeEventListener("keydown", onTacticalPauseKey);
      clearDebugLines(); dummy?.dispose(); targetHud.remove(); trace.resetBladeHistory();
      window.removeEventListener("keydown", onJoleeInteractKey); window.removeEventListener("keydown", onReverseBlockKey); window.removeEventListener("keyup", onReverseBlockKey); joleePrompt.remove();
      joleeNpcLighting?.dispose();
      if (joleeNpc) { scene.onAfterAnimationsObservable.remove(joleeNpc.resetObserver); joleeNpc.asset.root.parent = null; joleeNpc.asset.dispose(); joleeNpc.root.dispose(false, true); }
      lighting.dispose(); genericSabers.forEach(s => s.detach());
      if (academyHostile) { academyHostile.traces.forEach(trace => trace.endAttack()); academyHostile.fire.dispose(); academyHostile.target.dispose(); academyHostile.weapon.dispose(); academyHostile.asset.dispose(); }
      joleeBladeBaseAnchor?.dispose(); joleeBladeTipAnchor?.dispose();
      joleeRoots.forEach(n => n.dispose?.()); adapter.dispose(); scene.dispose(); engine.dispose();
      clearJediEnclaveMaterialRuntimeCaches();
      panel.remove(); window.removeEventListener("error", onError); window.removeEventListener("unhandledrejection", onRejection);
      if (priorCanvasStyle == null) canvas.removeAttribute("style"); else canvas.setAttribute("style", priorCanvasStyle);
    },
  };
}
