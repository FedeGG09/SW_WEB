import { AnimationGroup, Scene, TransformNode, Vector3 } from "@babylonjs/core";
import { AssetLoader, ImportedAsset } from "../../assets/AssetLoader";
import { PlayerController } from "../../player/PlayerController";
import { PLAYER_CHARACTERS, type PlayerCharacterConfig } from "../../player/PlayerCharacterConfig";
import { ThirdPersonCamera } from "../../player/ThirdPersonCamera";
import { alignVisualFeetToGround, measureVisualBounds } from "../../world/CharacterGrounding";
import { CharacterControlOwnership } from "../../party/CharacterControlOwnership";
import { PartySelectionController, type PartySelectionResult, type PartySelectionSnapshot } from "../../party/PartySelectionController";
import { TacticalPartyRoster } from "../../party/TacticalPartyRoster";
import { TacticalPauseController } from "../../party/TacticalPauseController";
import { TacticalCommandQueue } from "../../party/tactical/TacticalCommandQueue";
import { TacticalCommandExecutor, type TacticalMotionActor, type TacticalAttackStep } from "../../party/tactical/TacticalCommandExecutor";
import { TacticalOrderSelection } from "../../party/tactical/TacticalOrderSelection";
import type { TacticalWorldPoint, TacticalAttackTargetCommand } from "../../party/tactical/TacticalCommand";

export type EboPoint = [number, number, number];
export type EboHit = { room: string; face: number; material: string; height: number; walkability: string; point: EboPoint; dist: number };
export type EboNav = { rooms: Array<{ resref: string; faces: Array<{ face: number; vertices: [EboPoint, EboPoint, EboPoint]; walkability: string; material: string; transitions: Array<number | null> }> }>; pth: any[]; doors?: any[]; roomAdjacency: any };
type LocomotionSemantic = "IDLE" | "WALK" | "RUN";
type Profile = {
  locomotion: Record<string, string>;
  jediReady?: Record<string, string>;
  modelForwardAxis?: "BABYLON_POSITIVE_Z" | "BABYLON_NEGATIVE_Z";
  visualYawOffset?: number;
  runtimeVisualGroundOffsetM?: number;
  peacefulIdle?: string;
};
const KOTOR1_COMPANION_VISUAL_PROFILE: Pick<Profile, "modelForwardAxis" | "visualYawOffset"> = {
  modelForwardAxis: "BABYLON_NEGATIVE_Z",
  visualYawOffset: Math.PI,
};
type Resolve = (p: EboPoint, walkOnly: boolean, maxH?: number, maxV?: number, allowedRooms?: string[]) => EboHit | null;
type Visibility = (renderPosition: Vector3, hit?: EboHit | null) => any;
type PthLink = { to: number; via?: EboPoint; kind: string; weight: number };
type TransitionPair = { to: string; midpoint: EboPoint; crossingDirection?: [number, number]; kind: string; gitDoorId?: string; doorTag?: string };
type LeaderNavigationEvent = {
  sequence: number;
  type: "SAME_ROOM_ANCHOR" | "PORTAL_APPROACH" | "PORTAL_CROSS" | "ROOM_ENTER" | "GIT_DOOR_APPROACH" | "GIT_DOOR_CROSS";
  room: string;
  face: number;
  worldPosition: EboPoint;
  transitionType: string | null;
  fromRoom: string | null;
  toRoom: string | null;
  sourceId: string | null;
  targetPosition: EboPoint | null;
};
class LeaderNavigationTrail {
  private nextSequence = 1;
  readonly events: LeaderNavigationEvent[] = [];
  append(event: Omit<LeaderNavigationEvent, "sequence">) {
    const row = { ...event, sequence: this.nextSequence++ };
    this.events.push(row);
    return row;
  }
}
type ActorState = {
  id: string; asset: string; behavior: string; position: number[]; room: string | null; face: number | null; surface: string | null;
  actorRootUniqueId: number; visualRootUniqueId: number; importedRootUniqueId: number; animationGroupCount: number;
  animation: string; distance: number; distanceWalk: number; distanceRun: number; maxSeparation: number; meanSeparation: number;
  repathCount: number; stuckCount: number; recoveryTeleports: number; facesVisited: string[]; roomTransitions: Array<Record<string, unknown>>; spawnRoom: string | null; spawnFace: number; formationSlot: string;
  lastConsumedLeaderEvent: number; nextLeaderEvent: number | null; targetSource: string; targetRoom: string | null; targetPosition: EboPoint | null;
  roomLag: number;
  rootYaw: number;
  visualYaw: number;
  velocity: EboPoint;
  localForward: EboPoint;
  forwardDotVelocity: number | null;
  requestedSemantic: LocomotionSemantic;
  requestedClip: string;
  resolvedClip: string;
  resolutionReason: string;
  animationFallbacks: number;
  animationSpeedRatio: number;
  rootScale: EboPoint;
  visualRootScale: EboPoint;
  visualRootPosition: number[];
  runtimeVisualGroundOffsetM: number;
  modelForwardAxis: "BABYLON_POSITIVE_Z" | "BABYLON_NEGATIVE_Z";
  sourceVisualHeight: number;
  renderedVisualHeight: number;
  skeletons: Array<{ name: string; bones: number; rootBone: string | null; rootScale: EboPoint | null }>;
};
type PartyTraceSample = {
  elapsedSeconds: number;
  leader: { room: string; face: number; position: EboPoint; distance: number; transitions: number };
  followers: Array<{ id: string; room: string; face: number; nearestPthNode: number | null; targetRoom: string | null; targetPosition: EboPoint | null; targetSource: string; distanceToAren: number; distanceInterval: number; velocity: number; routeCount: number; behavior: string; pathIndex: number; pathLength: number }>;
};
const pointDistance = (a: EboPoint, b: EboPoint) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const samePoint = (a: EboPoint, b: EboPoint) => pointDistance(a, b) < 0.015;
const navAt = (render: Vector3): EboPoint => [render.x, -render.z, render.y];
const renderAt = (nav: EboPoint) => new Vector3(nav[0], nav[2], -nav[1]);
const d3 = (a: Vector3, b: Vector3) => Math.hypot(a.x - b.x, a.z - b.z);

class Follower {
  readonly id: string;
  readonly assetPath: string;
  readonly asset: ImportedAsset;
  readonly groups: AnimationGroup[];
  readonly clips: Record<string, string>;
  readonly slot: "rear-left" | "rear-right";
  /** Navigation-only root. Character and weapon transforms live below visualRoot. */
  readonly root: TransformNode;
  readonly visualRoot: TransformNode;
  hit: EboHit;
  behavior = "IDLE_NEAR_PLAYER";
  activeAnimation = "";
  path: EboPoint[] = [];
  pathIndex = 0;
  distance = 0;
  distanceWalk = 0;
  distanceRun = 0;
  maxSeparation = 0;
  separationSum = 0;
  separationSamples = 0;
  repathCount = 0;
  stuckCount = 0;
  recoveryTeleports = 0;
  roomTransitions: Array<Record<string, unknown>> = [];
  faces = new Set<string>();
  spawnRoom: string;
  spawnFace: number;
  noProgressSeconds = 0;
  repathSeconds = 0;
  lastGoal: EboPoint | null = null;
  diagnosticTarget: { room: string | null; position: EboPoint | null; source: string } = { room: null, position: null, source: "NONE" };
  diagnosticLastDistance = 0;
  lastConsumedLeaderEvent = 0;
  activeTransitionSequence: number | null = null;
  activeTransitionStage: "APPROACH" | "CROSS" | null = null;
  directSteering = false;
  maxRoomLag = 0;
  readonly profile: Profile;
  readonly velocity = new Vector3();
  requestedSemantic: LocomotionSemantic = "IDLE";
  requestedClip = "";
  resolutionReason = "NOT_REQUESTED";
  animationFallbacks = 0;
  animationSpeedRatio = 1;
  armed = false;
  modelForwardAxis: "BABYLON_POSITIVE_Z" | "BABYLON_NEGATIVE_Z";
  visualYawOffset: number;
  readonly sourceVisualHeight: number;
  readonly renderedVisualHeight: number;
  readonly runtimeVisualGroundOffsetM: number;
  private readonly scene: Scene;
  private readonly animationResetObserverCleanup: () => void;
  private currentGroup: AnimationGroup | null = null;

  constructor(args: { scene: Scene; id: string; assetPath: string; asset: ImportedAsset; profile: Profile; slot: "rear-left" | "rear-right"; hit: EboHit; initialYaw: number; targetHeightM: number; runtimeVisualGroundOffsetM?: number }) {
    this.scene = args.scene;
    this.id = args.id;
    this.assetPath = args.assetPath;
    this.asset = args.asset;
    this.groups = args.asset.animationGroups;
    this.profile = args.profile;
    this.clips = args.profile.locomotion;
    this.slot = args.slot;
    this.hit = args.hit;
    this.spawnRoom = args.hit.room;
    this.spawnFace = args.hit.face;
    this.modelForwardAxis = args.profile.modelForwardAxis ?? "BABYLON_POSITIVE_Z";
    this.visualYawOffset = args.profile.visualYawOffset ?? 0;

    this.root = new TransformNode(`${args.id}_ActorNavRoot`, args.scene);
    this.root.metadata = { w236ActorIdentity: args.id, role: "ACTOR_NAV_ROOT" };
    this.visualRoot = new TransformNode(`${args.id}_CharacterVisualRoot`, args.scene);
    this.visualRoot.parent = this.root;
    this.visualRoot.rotation.y = this.visualYawOffset;
    this.visualRoot.metadata = { w2372aModelForwardAxis: this.modelForwardAxis, role: "CHARACTER_VISUAL_ROOT" };
    args.asset.root.parent = this.visualRoot;
    this.root.position.copyFrom(renderAt(args.hit.point));
    this.root.rotation.y = args.initialYaw;
    this.visualRoot.computeWorldMatrix(true);
    args.asset.root.computeWorldMatrix(true);
    const sourceBounds = measureVisualBounds(args.asset.meshes);
    this.sourceVisualHeight = sourceBounds.height;
    if (sourceBounds.height > 0) this.visualRoot.scaling.setAll(args.targetHeightM / sourceBounds.height);
    this.visualRoot.computeWorldMatrix(true);
    args.asset.root.computeWorldMatrix(true);
    alignVisualFeetToGround(this.visualRoot, args.asset.meshes, this.root.position.y + 0.02);
    this.runtimeVisualGroundOffsetM = args.runtimeVisualGroundOffsetM ?? args.profile.runtimeVisualGroundOffsetM ?? 0;
    this.visualRoot.position.y += this.runtimeVisualGroundOffsetM;
    this.renderedVisualHeight = measureVisualBounds(args.asset.meshes).height;
    this.faces.add(args.hit.room + ":" + args.hit.face);

    // Match the leader's root-motion treatment. Donor walk cycles key source root
    // nodes; resetting their authored bind positions prevents animation from
    // accumulating a second navigation transform, including on separate head rigs.
    this.animationResetObserverCleanup = this.asset.registerAnimatedRootResetObserver(args.scene, `Follower:${this.id}`);
    this.playSemantic("IDLE");
  }

  setArmed(armed: boolean) {
    this.armed = armed;
    this.playSemantic(this.requestedSemantic);
  }

  playSemantic(semantic: LocomotionSemantic) {
    this.requestedSemantic = semantic;
    const key = semantic.toLowerCase();
    const table = this.armed ? (this.profile.jediReady ?? this.profile.locomotion) : this.profile.locomotion;
    const clip = table[key] ?? "";
    this.requestedClip = clip;
    if (!clip) {
      this.resolutionReason = "MISSING_SEMANTIC_MAPPING";
      this.animationFallbacks++;
      return;
    }
    this.play(clip, semantic);
  }

  play(name: string, semantic: LocomotionSemantic = this.requestedSemantic) {
    this.requestedSemantic = semantic;
    this.requestedClip = name;
    const group = this.groups.find(g => g.name === name);
    if (!group) {
      this.resolutionReason = "NO_EXACT_ANIMATION_GROUP";
      this.animationFallbacks++;
      return;
    }
    this.resolutionReason = "EXACT_NAME_MATCH";
    if (this.currentGroup === group && group.isPlaying) return;
    // Imported GLBs may arrive with an authored group already started.  A
    // follower semantic transition owns exactly one locomotion group, so clear
    // every other imported group once at the transition boundary.
    this.groups.forEach(candidate => { if (candidate !== group && (candidate.isPlaying || candidate.isStarted)) candidate.stop(); });
    this.currentGroup = group;
    this.activeAnimation = group.name;
    this.animationSpeedRatio = 1;
    group.start(true, this.animationSpeedRatio);
  }

  state(): ActorState {
    this.visualRoot.computeWorldMatrix(true);
    const sourceForward = this.modelForwardAxis === "BABYLON_NEGATIVE_Z" ? Vector3.Backward() : Vector3.Forward();
    const localForward = Vector3.TransformNormal(sourceForward, this.visualRoot.getWorldMatrix()).normalize();
    const horizontalVelocity = new Vector3(this.velocity.x, 0, this.velocity.z);
    const forwardDotVelocity = horizontalVelocity.lengthSquared() > 1e-8
      ? Vector3.Dot(localForward, horizontalVelocity.normalize()) : null;
    const skeletons = [...new Set(this.asset.meshes.map(mesh => mesh.skeleton).filter(Boolean))].map((skeleton: any) => {
      const rootBone = skeleton.bones.find((bone: any) => !bone.getParent());
      const rootNode = rootBone?.getTransformNode?.();
      return { name: skeleton.name, uniqueId: skeleton.uniqueId, bones: skeleton.bones.length, rootBone: rootBone?.name ?? null, rootScale: rootNode?.scaling?.asArray?.() ?? null };
    });
    return {
      id: this.id, asset: this.assetPath, behavior: this.behavior, position: this.root.position.asArray(),
      actorRootUniqueId: this.root.uniqueId, visualRootUniqueId: this.visualRoot.uniqueId, importedRootUniqueId: this.asset.root.uniqueId, animationGroupCount: this.groups.length,
      room: this.hit.room, face: this.hit.face, surface: this.hit.material, animation: this.activeAnimation,
      distance: this.distance, distanceWalk: this.distanceWalk, distanceRun: this.distanceRun,
      maxSeparation: this.maxSeparation, meanSeparation: this.separationSamples ? this.separationSum / this.separationSamples : 0,
      repathCount: this.repathCount, stuckCount: this.stuckCount, recoveryTeleports: this.recoveryTeleports,
      roomTransitions: [...this.roomTransitions], facesVisited: [...this.faces], spawnRoom: this.spawnRoom, spawnFace: this.spawnFace, formationSlot: this.slot,
      lastConsumedLeaderEvent: this.lastConsumedLeaderEvent, nextLeaderEvent: null,
      targetSource: this.diagnosticTarget.source, targetRoom: this.diagnosticTarget.room,
      targetPosition: this.diagnosticTarget.position ? [...this.diagnosticTarget.position] : null,
      roomLag: 0,
      rootYaw: this.root.rotation.y, visualYaw: this.root.rotation.y + this.visualRoot.rotation.y,
      velocity: this.velocity.asArray() as EboPoint, localForward: localForward.asArray() as EboPoint, forwardDotVelocity,
      requestedSemantic: this.requestedSemantic, requestedClip: this.requestedClip, resolvedClip: this.activeAnimation,
      resolutionReason: this.resolutionReason, animationFallbacks: this.animationFallbacks, animationSpeedRatio: this.animationSpeedRatio,
      rootScale: this.root.scaling.asArray() as EboPoint, visualRootScale: this.visualRoot.scaling.asArray() as EboPoint,
      visualRootPosition: this.visualRoot.position.asArray(), modelForwardAxis: this.modelForwardAxis,
      runtimeVisualGroundOffsetM: this.runtimeVisualGroundOffsetM,
      sourceVisualHeight: this.sourceVisualHeight, renderedVisualHeight: this.renderedVisualHeight, skeletons,
    };
  }

  dispose() {
    this.animationResetObserverCleanup();
    this.currentGroup?.stop();
    this.asset.dispose();
    this.root.dispose(false, true);
  }
}

export class EbonHawkPartyAdapter {
  readonly player: PlayerController;
  readonly leaderId: "aren" | "aren-jka-prototype" | "aren-native-jka-v1" | "jolee" | "nara";
  readonly camera: ThirdPersonCamera;
  readonly spawnHit: EboHit;
  readonly spawnYaw: number;
  readonly followers: Follower[] = [];
  private readonly playersAsset: ImportedAsset;
  private acceptedPoint: EboPoint;
  private currentHit: EboHit;
  private lastPlayerPosition: Vector3;
  private playerDistance = 0;
  private playerWalkDistance = 0;
  private playerRunDistance = 0;
  private doorWaits = 0;
  private edgeRejectCount = 0;
  private acceptedFrames = 0;
  private roomTransitions: Array<Record<string, unknown>> = [];
  private visitedRooms = new Set<string>();
  private visitedFaces = new Set<string>();
  private readonly links = new Map<number, PthLink[]>();
  private readonly nodes = new Map<number, any>();
  private readonly transitionMap = new Map<string, TransitionPair[]>();
  private readonly leaderTrail = new LeaderNavigationTrail();
  private lastAnchorDistance = 0;
  private lastApproachKey: string | null = null;
  private diagnosticElapsed = 0;
  private diagnosticTotal = 0;
  private readonly diagnosticTrace: PartyTraceSample[] = [];
  private controlOwnership: CharacterControlOwnership | null = null;
  private partyRoster: TacticalPartyRoster | null = null;
  private partySelection: PartySelectionController | null = null;
  private activeNaraFollower: Follower | null = null;
  private controlSwapEnabled = false;
  private readonly pausedAnimationGroups = new Map<AnimationGroup, { loop: boolean; speed: number }>();
  private readonly controlKeys = new Set<string>();
  private tacticalQueue: TacticalCommandQueue | null = null;
  private tacticalExecutor: TacticalCommandExecutor | null = null;
  private tacticalOrderSelection: TacticalOrderSelection | null = null;
  private tacticalHostileTargetId: string | null = null;
  private tacticalAttackStepHandler: ((actorId: string, command: TacticalAttackTargetCommand, deltaSeconds: number) => TacticalAttackStep) | null = null;
  private readonly onControlKeyDown = (event: KeyboardEvent) => {
    if (!this.controlSwapEnabled) return;
    const key = event.key.toLowerCase();
    if (['w', 'a', 's', 'd', 'shift', 'tab'].includes(key)) event.preventDefault();
    if (key === 'tab' && !event.repeat) { this.partySelection?.selectNext(); return; }
    this.controlKeys.add(key);
  };
  private readonly onControlKeyUp = (event: KeyboardEvent) => { this.controlKeys.delete(event.key.toLowerCase()); };
  private readonly onControlBlur = () => this.controlKeys.clear();

  private constructor(
    private readonly scene: Scene,
    private readonly canvas: HTMLCanvasElement,
    private readonly nav: EboNav,
    spawn: EboHit,
    private readonly resolve: Resolve,
    private readonly updateVisibility: Visibility,
    semanticBounds: Array<{ min: Vector3; max: Vector3 }>,
    playersAsset: ImportedAsset,
    leaderProfile: PlayerCharacterConfig,
  ) {
    this.playersAsset = playersAsset;
    this.leaderId = leaderProfile.id === "aren-jka-prototype" ? "aren-jka-prototype" : leaderProfile.id === "aren-native-jka-v1" ? "aren-native-jka-v1" :
      leaderProfile.id === "jolee" ? "jolee" : leaderProfile.id.startsWith("nara-") ? "nara" : "aren";
    this.spawnHit = spawn;
    this.currentHit = spawn;
    this.acceptedPoint = [...spawn.point];
    this.visitedRooms.add(spawn.room);
    this.visitedFaces.add(spawn.room + ":" + spawn.face);
    this.lastPlayerPosition = renderAt(spawn.point);

    const cameraTarget = () => (this.activeNaraFollower?.root ?? this.player.root).getAbsolutePosition().add(new Vector3(0, 1.35, 0));
    this.camera = new ThirdPersonCamera(scene, canvas, cameraTarget);
    this.player = new PlayerController(scene, playersAsset, this.camera, leaderProfile);
    this.player.root.metadata = { ...(this.player.root.metadata ?? {}), w236ActorIdentity: this.leaderId };
    this.player.setPosition(renderAt(spawn.point));

    const next = nav.pth.find((node: any) => node.projection?.status === "PROJECTED" && node.projection?.room === spawn.room);
    const nextPoint: EboPoint | null = next ? [Number(next.position[0]), Number(next.position[1]), Number(next.projection?.height ?? spawn.height)] : null;
    const spawnRender = renderAt(spawn.point), nextRender = nextPoint ? renderAt(nextPoint) : null;
    this.spawnYaw = nextRender ? Math.atan2(nextRender.x - spawnRender.x, nextRender.z - spawnRender.z) : 0;
    this.player.setFacingYaw(this.spawnYaw);
    this.camera.setInteriorProfile(true, this.spawnYaw);
    if (semanticBounds.length) {
      const lo = semanticBounds.reduce((a, b) => Vector3.Minimize(a, b.min), semanticBounds[0].min.clone());
      const hi = semanticBounds.reduce((a, b) => Vector3.Maximize(a, b.max), semanticBounds[0].max.clone());
      this.camera.setInteriorBounds(lo, hi, 0.65, hi.y, 0.4);
    }
    this.player.setCollisionResolver(position => this.constrainPlayer(position));
    this.player.setPosition(renderAt(spawn.point));
    scene.activeCamera = this.camera.camera;
    this.buildPthGraph();
    this.seedRoomTransitions();
    this.leaderTrail.append({ type: "SAME_ROOM_ANCHOR", room: spawn.room, face: spawn.face, worldPosition: [...spawn.point], transitionType: null, fromRoom: null, toRoom: null, sourceId: null, targetPosition: null });
    this.updateVisibility(renderAt(spawn.point), spawn);
  }

  static async create(args: {
    scene: Scene; canvas: HTMLCanvasElement; nav: EboNav; spawn: EboHit; resolve: Resolve;
    updateVisibility: Visibility; semanticBounds: Array<{ min: Vector3; max: Vector3 }>;
    companions: Array<"Mission" | "Jolee" | "Nara" | "Aren">;
    leaderProfile?: PlayerCharacterConfig;
    /** DEV donor A/B only; keeps the existing follower controller and formation. */
    naraCandidate?: boolean;
    /** Selected native JKA follower presentation; still uses the existing tactical Follower controller. */
    naraJkaProfile?: PlayerCharacterConfig;
  }) {
    const leaderProfile = args.leaderProfile ?? PLAYER_CHARACTERS.aren;
    const asset = await new AssetLoader().load(leaderProfile.assetPath, args.scene);
    if (leaderProfile.leaderCombatProfile) {
      try {
        const response = await fetch(leaderProfile.assetPath, { cache: "no-store" });
        if (!response.ok) throw new Error("LEADER_ASSET_HTTP_" + response.status);
        const bytes = await response.arrayBuffer();
        const digest = await crypto.subtle.digest("SHA-256", bytes);
        const sha256 = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join("");
        const skeletons = [...new Set(asset.meshes.map(mesh => mesh.skeleton).filter((skeleton): skeleton is NonNullable<typeof skeleton> => Boolean(skeleton)))];
        const jointCount = skeletons.length === 1 ? skeletons[0].bones.length : -1;
        const profile = leaderProfile.leaderCombatProfile;
        const requiredClips = [
          leaderProfile.exactLocomotion?.idle,
          leaderProfile.exactLocomotion?.walk,
          leaderProfile.exactLocomotion?.run,
          leaderProfile.exactLocomotion?.backward,
          leaderProfile.exactLocomotion?.strafeLeft,
          leaderProfile.exactLocomotion?.strafeRight,
          ...(profile ? Object.values(profile.groups).filter((name): name is string => typeof name === "string") : []),
          ...(profile ? Object.values(profile.groups.parryResponses ?? {}) : []),
        ].filter((name): name is string => typeof name === "string" && Boolean(name));
        const missingClips = [...new Set(requiredClips)].filter(name => !asset.animationGroups.some(group => group.name === name));
        if (sha256 !== leaderProfile.expectedAssetSha256) throw new Error("LEADER_LOAD_GATE_FAIL: SHA256_MISMATCH:" + sha256);
        if (jointCount !== 53) throw new Error("LEADER_LOAD_GATE_FAIL: JOINT_COUNT:" + jointCount);
        if (!profile || profile.saberAttachmentNode !== "rhang_tag_bone") throw new Error("LEADER_LOAD_GATE_FAIL: COMBAT_PROFILE_OR_SOCKET_MISMATCH");
        if (missingClips.length) throw new Error("LEADER_LOAD_GATE_FAIL: REQUIRED_CLIPS_MISSING:" + missingClips.join(","));
      } catch (error) {
        asset.dispose();
        throw error;
      }
    }
    let adapter: EbonHawkPartyAdapter;
    try {
      adapter = new EbonHawkPartyAdapter(args.scene, args.canvas, args.nav, args.spawn, args.resolve, args.updateVisibility, args.semanticBounds, asset, leaderProfile);
    } catch (error) {
      asset.dispose();
      throw error;
    }
    const leaderRole = leaderProfile.id === "jolee" ? "jolee" : leaderProfile.id.startsWith("nara-") ? "nara" : "aren";
    const roleFor = (id: string) => id.toLowerCase() === "aren" ? "aren" : id.toLowerCase() === "jolee" ? "jolee" : "nara";
    const selectedNaraJkaProfile = args.naraJkaProfile ?? (args.naraCandidate ? PLAYER_CHARACTERS["nara-meetra-jka-candidate"] : null);
    const naraJkaLocomotion = selectedNaraJkaProfile?.exactLocomotion;
    const naraJkaReady = selectedNaraJkaProfile?.characterLabJkaPreviewProfile?.groups.saberReady ?? selectedNaraJkaProfile?.leaderCombatProfile?.groups.saberReady;
    const jkaNaraFollower = selectedNaraJkaProfile && naraJkaLocomotion ? {
      asset: selectedNaraJkaProfile.assetPath, profile: "",
      locomotion: { idle: naraJkaLocomotion.peacefulIdle ?? naraJkaLocomotion.idle ?? "JKA_IDLE", walk: naraJkaLocomotion.walk, run: naraJkaLocomotion.run },
      jediReady: { idle: naraJkaReady ?? naraJkaLocomotion.idle ?? "JKA_IDLE", walk: naraJkaLocomotion.walk, run: naraJkaLocomotion.run },
    } : null;
    const companions = args.companions.filter((id) => roleFor(id) !== leaderRole);
    for (const [index, id] of companions.entries()) {
      const profileById: Record<string, { asset: string; profile: string; locomotion?: Record<string, string>; jediReady?: Record<string, string> }> = {
        Aren: { asset: PLAYER_CHARACTERS.aren.assetPath, profile: "", locomotion: { idle: "idle_v2", walk: "walk_forward_v2", run: "run_forward_v2" }, jediReady: { idle: "idle_v2", walk: "walk_forward_v2", run: "run_forward_v2" } },
        Mission: { asset: "/_lab/kotor/characters/mission/mission_vao_kotor_donor_w230_3o_candidate.glb", profile: "/_lab/kotor/characters/mission/mission_jedi_animation_profile.json" },
        Jolee: { asset: "/_lab/kotor/characters/jolee/jolee_bindo_kotor1.glb", profile: "/_lab/kotor/characters/jolee/jolee_jedi_profile.json", jediReady: { idle: "g2r1", walk: "walkss", run: "runss" } },
        Nara: jkaNaraFollower ?? { asset: "/_lab/kotor/characters/belaya/belaya_kotor1_donor.glb", profile: "/_lab/kotor/characters/belaya/belaya_nara_runtime_profile.json", jediReady: { idle: "g2r1", walk: "walkss", run: "runss" } },
      } as const;
      const { asset: assetPath, profile: profileUrl, locomotion } = profileById[id];
      const profilePromise: Promise<Profile> = profileUrl
        ? fetch(profileUrl).then(r => { if (!r.ok) throw new Error("EBON_HAWK_" + id + "_PROFILE_HTTP_" + r.status); return r.json() as Promise<Profile>; })
        : Promise.resolve({ locomotion: locomotion ?? {} });
      const [profile, followerAsset] = await Promise.all([
        profilePromise,
        new AssetLoader().load(assetPath, args.scene),
      ]);
      if (id === "Mission") profile.locomotion = { ...profile.locomotion, walk: "walk", run: "run" };
      if (id === "Jolee") profile.locomotion = { idle: "pause1", walk: "walkss", run: "runss" };
      profile.jediReady = (profileById[id] as any).jediReady;
      if (id === "Jolee" || (id === "Nara" && !selectedNaraJkaProfile)) Object.assign(profile, KOTOR1_COMPANION_VISUAL_PROFILE);
      const slot = id === "Jolee" && companions.length > 1 ? "rear-right" : index === 0 ? "rear-left" : "rear-right";
      const desired = adapter.formationPoint(slot);
      const initialRoom = adapter.currentHit.room;
      let hit = args.resolve(desired, true, 3.5, 2.0, [initialRoom]);
      if (!hit) hit = args.resolve(adapter.acceptedPoint, true, 2.5, 2.0, [initialRoom]);
      if (!hit) {
        followerAsset.dispose();
        throw new Error("EBON_HAWK_" + id + "_SPAWN_UNRESOLVED_ON_BWM");
      }
      const targetHeightM = id === "Jolee" ? PLAYER_CHARACTERS.jolee.targetHeightM : id === "Nara" ? (selectedNaraJkaProfile?.targetHeightM ?? PLAYER_CHARACTERS["nara-belaya"].targetHeightM) : 1.8;
      adapter.followers.push(new Follower({ scene: args.scene, id, assetPath, asset: followerAsset, profile, slot, hit, initialYaw: adapter.spawnYaw, targetHeightM,
        runtimeVisualGroundOffsetM: id === "Nara" ? selectedNaraJkaProfile?.runtimeVisualGroundOffsetM ?? 0 : undefined }));
    }
    return adapter;
  }

  update(deltaSeconds: number, simulationPaused = false) {
    const dt = Math.max(0, Math.min(0.05, deltaSeconds));
    this.camera.update();
    if (simulationPaused) return;
    this.tacticalExecutor?.update(dt, false);
    if (this.activeNaraFollower) {
      if (!this.tacticalExecutor?.isActive("NARA")) this.updateDirectNara(dt);
      if (!this.tacticalExecutor?.isActive("AREN")) this.updatePlayerAsFollower(dt);
    } else {
      if (!this.tacticalExecutor?.isActive("AREN")) this.player.update(dt);
    }
    if (this.controlOwnership?.queued && this.controlOwnership.controlled === "AREN" && !this.player.combatAnimations.active) {
      this.controlOwnership.flushQueuedSwap();
    }
    const controlledPosition = this.activeNaraFollower?.root.position ?? this.player.position;
    const moved = d3(this.lastPlayerPosition, controlledPosition);
    if (moved > 0.0001) {
      this.playerDistance += moved;
      this.acceptedFrames++;
      if (this.activeNaraFollower?.requestedSemantic === "RUN" || this.player.detailedLocomotionState === "RUN_FORWARD") this.playerRunDistance += moved;
      else this.playerWalkDistance += moved;
    }
    this.lastPlayerPosition.copyFrom(controlledPosition);
    if (!this.activeNaraFollower) this.updateLeaderApproach();
    if (this.playerDistance - this.lastAnchorDistance >= 3.0 && !this.nearTransition(this.currentHit.room, this.acceptedPoint, 1.7)) {
      this.leaderTrail.append({ type: "SAME_ROOM_ANCHOR", room: this.currentHit.room, face: this.currentHit.face, worldPosition: [...this.acceptedPoint], transitionType: null, fromRoom: null, toRoom: null, sourceId: null, targetPosition: null });
      this.lastAnchorDistance = this.playerDistance;
    }
    this.updateVisibility(renderAt(this.acceptedPoint), this.currentHit);
    for (const follower of this.followers) if (follower !== this.activeNaraFollower && !this.tacticalExecutor?.isActive(follower.id.toUpperCase())) this.updateFollower(follower, dt);
    this.captureDiagnosticTrace(dt);
  }

  /** Gate authored animation playback without stopping the Babylon render loop. */
  setGameplayPaused(paused: boolean) {
    const assets = [this.playersAsset, ...this.followers.map(follower => follower.asset)];
    if (paused) {
      assets.forEach(asset => asset.animationGroups.forEach(group => {
        if (group.isPlaying) {
          this.pausedAnimationGroups.set(group, { loop: Boolean(group.loopAnimation), speed: group.speedRatio });
          group.pause();
        }
      }));
      this.controlKeys.clear();
      return;
    }
    this.pausedAnimationGroups.forEach((playback, group) => {
      if (group.isStarted) {
        group.speedRatio = playback.speed;
        group.play(playback.loop);
      }
    });
    this.pausedAnimationGroups.clear();
  }

  bindTacticalPause(controller: TacticalPauseController) {
    return controller.subscribe(paused => this.setGameplayPaused(paused));
  }

  /** Enable DEV-only ownership transfer without constructing another actor. */
  enableControlSwap() {
    if (this.controlSwapEnabled) return;
    const nara = this.followers.find(candidate => candidate.id === 'Nara') ?? null;
    if (!nara) return;
    this.controlOwnership = new CharacterControlOwnership(
      "AREN",
      "NARA",
      (from) => from !== "AREN" || !this.player.combatAnimations.active,
      (from, to) => this.applyControlTransfer(from, to),
    );
    this.partyRoster = new TacticalPartyRoster([
      { id: "AREN", displayName: "Aren", actorRef: this.player, controllable: true, alive: true },
      { id: "NARA", displayName: "Nara", actorRef: nara, controllable: true, alive: true },
    ]);
    this.partySelection = new PartySelectionController(this.partyRoster, this.controlOwnership);
    this.tacticalQueue = new TacticalCommandQueue(8);
    this.tacticalQueue.registerActor("AREN"); this.tacticalQueue.registerActor("NARA");
    this.tacticalOrderSelection = new TacticalOrderSelection(["AREN", "NARA"], "AREN");
    const actors = new Map<string, TacticalMotionActor>([
      ["AREN", { actorId: "AREN", stepToward: (destination, dt, tolerance) => this.stepTacticalAren(destination, dt, tolerance), stepAttackTarget: (command, dt) => this.tacticalAttackStepHandler?.("AREN", command, dt) ?? { completed: false, failedReason: "ATTACK_NOT_CONFIGURED" } }],
      ["NARA", { actorId: "NARA", stepToward: (destination, dt, tolerance) => this.stepTacticalNara(destination, dt, tolerance), stepAttackTarget: (command, dt) => this.tacticalAttackStepHandler?.("NARA", command, dt) ?? { completed: false, failedReason: "ATTACK_NOT_CONFIGURED" } }],
    ]);
    this.tacticalExecutor = new TacticalCommandExecutor(this.tacticalQueue, actors, 0.3);
    this.controlSwapEnabled = true;
    window.addEventListener('keydown', this.onControlKeyDown);
    window.addEventListener('keyup', this.onControlKeyUp);
    window.addEventListener('blur', this.onControlBlur);
  }

  get controlledActorId() { return this.controlOwnership?.controlled === "NARA" ? "NARA" : "AREN"; }
  get followerActorId() { return this.controlOwnership?.follower === "AREN" ? "AREN" : "NARA"; }
  get controlOwnershipSnapshot() { return this.controlOwnership?.snapshot() ?? null; }
  get partySelectionSnapshot(): PartySelectionSnapshot | null { return this.partySelection?.snapshot() ?? null; }

  setControlledActor(actor: "AREN" | "NARA") {
    if (!this.controlSwapEnabled || !this.partySelection) return false;
    return this.partySelection.select(actor).accepted;
  }

  selectPartyMember(actor: "AREN" | "NARA"): PartySelectionResult | null {
    return this.partySelection?.select(actor) ?? null;
  }

  selectNextPartyMember(): PartySelectionResult | null {
    return this.partySelection?.selectNext() ?? null;
  }

  selectPreviousPartyMember(): PartySelectionResult | null {
    return this.partySelection?.selectPrevious() ?? null;
  }

  tacticalOrderSelectionSnapshot() { return this.tacticalOrderSelection?.snapshot() ?? null; }
  tacticalQueueSnapshot() { return this.tacticalQueue ? { aren: this.tacticalQueue.getQueue("AREN"), nara: this.tacticalQueue.getQueue("NARA") } : null; }
  tacticalCommandHistory() { return this.tacticalQueue?.getHistory() ?? []; }
  tacticalExecutorSnapshot() { return this.tacticalExecutor?.snapshot() ?? null; }
  setTacticalHostileTarget(targetActorId: string | null) { this.tacticalHostileTargetId = targetActorId; }
  setTacticalAttackStepHandler(handler: ((actorId: string, command: TacticalAttackTargetCommand, deltaSeconds: number) => TacticalAttackStep) | null) { this.tacticalAttackStepHandler = handler; }
  stepTacticalActor(actorId: "AREN" | "NARA", destination: TacticalWorldPoint, deltaSeconds: number, arrivalToleranceM = 0.3) {
    return actorId === "AREN" ? this.stepTacticalAren(destination, deltaSeconds, arrivalToleranceM) : this.stepTacticalNara(destination, deltaSeconds, arrivalToleranceM);
  }
  selectTacticalActor(actor: "AREN" | "NARA") { return this.tacticalOrderSelection?.select(actor) ?? false; }
  selectNextTacticalActor() { return this.tacticalOrderSelection?.selectNext() ?? false; }
  queueTacticalMove(destinationWorld: TacticalWorldPoint) {
    if (!this.tacticalQueue || !this.tacticalOrderSelection) return { accepted: false as const, reason: "TACTICAL_NOT_ENABLED" };
    const valid = this.resolve(navAt(new Vector3(destinationWorld.x, destinationWorld.y, destinationWorld.z)), true, 0.7, 1.2);
    if (!valid) return { accepted: false as const, reason: "INVALID_NAV_DESTINATION" };
    return this.tacticalQueue.enqueueMove(this.tacticalOrderSelection.selectedMemberId, { x: valid.point[0], y: valid.point[2], z: -valid.point[1] });
  }
  /** Production Academy guard: party members are friendly; an explicit DEV hostile route may register one target. */
  queueTacticalAttack(targetActorId: string) {
    if (!this.tacticalQueue || !this.tacticalOrderSelection) return { accepted: false as const, reason: "TACTICAL_NOT_ENABLED" };
    const actorId = this.tacticalOrderSelection.selectedMemberId;
    if (!targetActorId) return { accepted: false as const, reason: "INVALID_TARGET" };
    if (targetActorId === actorId) return { accepted: false as const, reason: "SELF_TARGET" };
    const friendlyPartyIds = new Set(["AREN", "NARA"]);
    if (friendlyPartyIds.has(targetActorId)) return { accepted: false as const, reason: "FRIENDLY_TARGET" };
    if (this.tacticalHostileTargetId === targetActorId) return this.tacticalQueue.enqueueAttackTarget(actorId, targetActorId);
    return { accepted: false as const, reason: "INVALID_TARGET" };
  }
  /** DEV route helper: exposes existing PTH waypoints without changing movement resolution. */
  planTacticalPthRoute(actor: "AREN" | "NARA", destinationWorld: TacticalWorldPoint) {
    if (!this.tacticalQueue) return { accepted: false as const, reason: "TACTICAL_NOT_ENABLED" };
    const follower = actor === "NARA" ? this.followers.find(candidate => candidate.id === "Nara") ?? null : null;
    const start = follower ? follower.hit : this.currentHit;
    const target = this.resolve(navAt(new Vector3(destinationWorld.x, destinationWorld.y, destinationWorld.z)), true, 0.7, 1.2);
    if (!target) return { accepted: false as const, reason: "INVALID_NAV_DESTINATION" };
    const points = this.plannedPath(start.point, start.room, target.point, target.room)
      .filter((point, index, all) => index === 0 || pointDistance(point, all[index - 1]) > 0.22)
      .filter(point => pointDistance(point, start.point) > 0.3);
    if (!points.length) return { accepted: false as const, reason: "TACTICAL_ROUTE_EMPTY" };
    return { accepted: true as const, points: points.map(point => ({ x: point[0], y: point[2], z: -point[1] })), targetRoom: target.room };
  }
  clearTacticalSelected() { const id = this.tacticalOrderSelection?.selectedMemberId; return id && this.tacticalQueue ? this.tacticalQueue.clear(id) : []; }
  clearTacticalAll() { return this.tacticalQueue?.clearAll() ?? []; }

  private stepTacticalAren(destination: TacticalWorldPoint, dt: number, tolerance: number) {
    const dx = destination.x - this.player.position.x, dz = destination.z - this.player.position.z, distance = Math.hypot(dx, dz);
    if (distance <= tolerance) { this.player.animations.setLocomotionState("IDLE", 0); return { arrived: true, moved: false }; }
    const amount = Math.min(distance, Math.max(1.55, this.player.horizontalSpeed) * dt);
    const candidate = this.player.position.add(new Vector3(dx / distance * amount, 0, dz / distance * amount));
    this.constrainPlayer(candidate); this.player.setPosition(candidate); this.player.setFacingYaw(Math.atan2(dx, dz));
    this.player.animations.setLocomotionState(amount > 0.06 ? "WALK_FORWARD" : "IDLE", amount);
    return { arrived: false, moved: amount > 0.001 };
  }

  private stepTacticalNara(destination: TacticalWorldPoint, dt: number, tolerance: number) {
    const follower = this.followers.find(candidate => candidate.id === "Nara");
    if (!follower) return { arrived: false, moved: false, failedReason: "NARA_NOT_LOADED" };
    const dx = destination.x - follower.root.position.x, dz = destination.z - follower.root.position.z, distance = Math.hypot(dx, dz);
    if (distance <= tolerance) { follower.playSemantic("IDLE"); return { arrived: true, moved: false }; }
    const amount = Math.min(distance, 1.7 * dt);
    const candidateRender = follower.root.position.add(new Vector3(dx / distance * amount, 0, dz / distance * amount));
    const next = this.projectTransitionAware(navAt(candidateRender), follower.hit, Math.max(0.07, amount + 0.035));
    if (!next) { follower.playSemantic("IDLE"); return { arrived: false, moved: false, failedReason: "INVALID_NAV_DESTINATION" }; }
    const old = follower.root.position.clone(); const oldHit = follower.hit;
    follower.hit = next; follower.root.position.copyFrom(renderAt(next.point)); follower.root.rotation.y = Math.atan2(dx, dz); follower.velocity.copyFrom(follower.root.position.subtract(old).scale(1 / Math.max(dt, 1e-4))); follower.distance += d3(old, follower.root.position); follower.playSemantic(amount > 0.06 ? "WALK" : "IDLE");
    if (oldHit.room !== next.room) follower.roomTransitions.push({ fromRoom: oldHit.room, toRoom: next.room, fromFace: oldHit.face, toFace: next.face, position: [...next.point], method: "TACTICAL_BWM_PROJECTION" });
    return { arrived: false, moved: true };
  }

  private applyControlTransfer(from: string, to: string) {
    if (to === "NARA") {
      const follower = this.followers.find(candidate => candidate.id === 'Nara') ?? null;
      if (!follower) return;
      this.player.setInputEnabled(false);
      follower.path = []; follower.pathIndex = 0; follower.lastGoal = null; follower.directSteering = false;
      this.activeNaraFollower = follower;
      this.lastPlayerPosition.copyFrom(follower.root.position);
      return;
    }
    this.activeNaraFollower = null;
    this.player.setInputEnabled(true);
    this.lastPlayerPosition.copyFrom(this.player.position);
  }

  interactionOrigin() { return (this.activeNaraFollower?.root ?? this.player.root).getAbsolutePosition(); }
  /**
   * Apply a source-backed module transition to the existing party runtime.
   * The caller resolves the destination waypoint through the active WOK/PTH
   * data; this method only rebinds the already-created actors to that hit and
   * keeps the camera/follower runtime alive.
   */
  applySourceTransition(destination: EboHit, followerDestinations: Array<{ id: string; hit: EboHit }> = []) {
    const previousRoom = this.currentHit.room;
    this.currentHit = destination;
    this.acceptedPoint = [...destination.point];
    this.player.setPosition(renderAt(destination.point));
    this.lastPlayerPosition.copyFrom(this.player.position);
    this.visitedRooms.add(destination.room);
    this.visitedFaces.add(destination.room + ":" + destination.face);
    this.roomTransitions.push({ fromRoom: previousRoom, toRoom: destination.room, fromFace: null, toFace: destination.face, position: [...destination.point], method: "SOURCE_MODULE_TRANSITION" });
    this.leaderTrail.append({ type: "GIT_DOOR_CROSS", room: destination.room, face: destination.face, worldPosition: [...destination.point], transitionType: "SOURCE_MODULE_TRANSITION", fromRoom: previousRoom, toRoom: destination.room, sourceId: null, targetPosition: [...destination.point] });
    for (const row of followerDestinations) {
      const follower = this.followers.find(candidate => candidate.id.toLowerCase() === row.id.toLowerCase());
      if (!follower) continue;
      follower.hit = row.hit;
      follower.root.position.copyFrom(renderAt(row.hit.point));
      follower.path = [];
      follower.pathIndex = 0;
      follower.lastGoal = null;
      follower.roomTransitions.push({ fromRoom: previousRoom, toRoom: row.hit.room, fromFace: null, toFace: row.hit.face, position: [...row.hit.point], method: "SOURCE_MODULE_TRANSITION" });
      follower.playSemantic("IDLE");
    }
    this.updateVisibility(renderAt(destination.point), destination);
  }
  private get controlledPosition() { return this.activeNaraFollower?.root.position ?? this.player.position; }

  private updateDirectNara(dt: number) {
    const follower = this.activeNaraFollower;
    if (!follower) return;
    const x = (this.controlKeys.has('d') ? 1 : 0) - (this.controlKeys.has('a') ? 1 : 0);
    const z = (this.controlKeys.has('w') ? 1 : 0) - (this.controlKeys.has('s') ? 1 : 0);
    const length = Math.hypot(x, z);
    if (length <= 0) { follower.playSemantic('IDLE'); return; }
    const running = this.controlKeys.has('shift');
    const speed = running ? 2.7 : 1.55;
    const forward = new Vector3(Math.sin(this.camera.yaw), 0, -Math.cos(this.camera.yaw));
    const right = new Vector3(Math.cos(this.camera.yaw), 0, Math.sin(this.camera.yaw));
    const direction = forward.scale(z).add(right.scale(x)).normalize();
    const candidate = new Vector3(follower.root.position.x + direction.x * speed * dt, follower.root.position.y, follower.root.position.z + direction.z * speed * dt);
    const next = this.projectTransitionAware(navAt(candidate), follower.hit, Math.max(0.07, speed * dt + 0.035));
    if (!next) { follower.playSemantic('IDLE'); return; }
    const delta = candidate.subtract(follower.root.position);
    follower.hit = next;
    follower.root.position.copyFrom(renderAt(next.point));
    follower.root.rotation.y = Math.atan2(direction.x, direction.z);
    follower.velocity.copyFrom(follower.root.position.subtract(candidate).scale(1 / Math.max(dt, 1e-4)));
    follower.distance += d3(follower.root.position, candidate);
    follower.playSemantic(running ? 'RUN' : 'WALK');
    this.acceptedPoint = [...next.point];
    this.currentHit = next;
    this.visitedRooms.add(next.room); this.visitedFaces.add(next.room + ':' + next.face);
  }

  private updatePlayerAsFollower(dt: number) {
    const leader = this.activeNaraFollower;
    if (!leader) return;
    const delta = leader.root.position.subtract(this.player.position); delta.y = 0;
    const distance = delta.length();
    if (distance <= 1.1) { this.player.setExactLocomotionProfile(this.player.characterDefinition.exactLocomotion!); return; }
    const step = Math.min(distance - 1.0, 2.2 * dt);
    const candidate = this.player.position.add(delta.normalize().scale(step));
    this.player.setPosition(candidate);
    this.player.setFacingYaw(Math.atan2(delta.x, delta.z));
    this.player.animations.setLocomotionState(step > 0.1 ? 'WALK_FORWARD' : 'IDLE', step);
  }

  private captureDiagnosticTrace(dt: number) {
    this.diagnosticElapsed += dt;
    this.diagnosticTotal += dt;
    if (this.diagnosticElapsed < 1) return;
    const elapsedSeconds = this.diagnosticElapsed;
    this.diagnosticElapsed = 0;
    const followers = this.followers.map(follower => {
      const distanceInterval = Math.max(0, follower.distance - follower.diagnosticLastDistance);
      const roomLag = this.leaderTrail.events.filter(event => event.sequence > follower.lastConsumedLeaderEvent && (event.type === "PORTAL_CROSS" || event.type === "GIT_DOOR_CROSS")).length;
      follower.maxRoomLag = Math.max(follower.maxRoomLag, roomLag);
      const nearest = this.nearestNode(follower.hit.point, follower.hit.room);
      const sample = {
        id: follower.id, room: follower.hit.room, face: follower.hit.face,
        nearestPthNode: nearest ? Number(nearest.id) : null,
        targetRoom: follower.diagnosticTarget.room,
        targetPosition: follower.diagnosticTarget.position ? [...follower.diagnosticTarget.position] as EboPoint : null,
        targetSource: follower.diagnosticTarget.source,
        distanceToAren: d3(follower.root.position, this.controlledPosition),
        distanceInterval, velocity: distanceInterval / elapsedSeconds,
        routeCount: follower.repathCount, behavior: follower.behavior,
        pathIndex: follower.pathIndex, pathLength: follower.path.length, roomLag,
      };
      follower.diagnosticLastDistance = follower.distance;
      return sample;
    });
    this.diagnosticTrace.push({
      elapsedSeconds: this.diagnosticTotal,
      leader: { room: this.currentHit.room, face: this.currentHit.face, position: [...this.acceptedPoint], distance: this.playerDistance, transitions: this.roomTransitions.length },
      followers,
    });
  }

  private constrainPlayer(renderPosition: Vector3) {
    const requested = navAt(renderPosition);
    const step = pointDistance(requested, this.acceptedPoint);
    const hit = this.projectTransitionAware(requested, this.currentHit, Math.min(0.2, Math.max(0.055, step + 0.025)));
    if (!hit) {
      this.edgeRejectCount++;
      const accepted = renderAt(this.acceptedPoint);
      renderPosition.copyFrom(accepted);
      if (step > 0.035) this.player.setPosition(accepted);
      return;
    }
    const oldHit = this.currentHit;
    const acceptedDistance = pointDistance(hit.point, this.acceptedPoint);
    if (acceptedDistance > Math.max(0.16, step + 0.12)) {
      this.edgeRejectCount++;
      renderPosition.copyFrom(renderAt(this.acceptedPoint));
      this.player.setPosition(renderAt(this.acceptedPoint));
      return;
    }
    this.acceptedPoint = [...hit.point];
    this.currentHit = hit;
    renderPosition.copyFrom(renderAt(hit.point));
    this.visitedRooms.add(hit.room);
    this.visitedFaces.add(hit.room + ":" + hit.face);
    if (oldHit.room !== hit.room) {
      const edge = this.transitionFor(oldHit.room, hit.room);
      const transitionPosition = [...hit.point] as EboPoint;
      const transitionTarget = this.transitionExit(edge?.midpoint ?? hit.point, oldHit.room, hit.room);
      const isDoor = Boolean(edge?.gitDoorId);
      this.roomTransitions.push({
        fromRoom: oldHit.room, toRoom: hit.room, fromFace: oldHit.face, toFace: hit.face,
        position: [...hit.point], height: hit.height, method: edge?.kind ?? "BWM_ROOM_TRANSITION",
        connection: edge?.kind ?? "UNKNOWN", gitDoorId: edge?.gitDoorId ?? null,
      });
      this.leaderTrail.append({
        type: isDoor ? "GIT_DOOR_CROSS" : "PORTAL_CROSS", room: oldHit.room, face: oldHit.face,
        worldPosition: transitionPosition, transitionType: edge?.kind ?? "BWM_ROOM_TRANSITION",
        fromRoom: oldHit.room, toRoom: hit.room, sourceId: edge?.gitDoorId ?? null, targetPosition: transitionTarget,
      });
      this.leaderTrail.append({ type: "ROOM_ENTER", room: hit.room, face: hit.face, worldPosition: transitionPosition, transitionType: edge?.kind ?? "BWM_ROOM_TRANSITION", fromRoom: oldHit.room, toRoom: hit.room, sourceId: edge?.gitDoorId ?? null, targetPosition: transitionTarget });
      this.lastApproachKey = null;
    }
  }

  private roomCenter(room: string): EboPoint | null {
    const faces = this.nav.rooms.find(r => r.resref.toLowerCase() === room.toLowerCase())?.faces.filter(f => f.walkability === "WALKABLE") ?? [];
    const points = faces.flatMap(f => f.vertices);
    if (!points.length) return null;
    return points.reduce((sum, p) => [sum[0] + p[0], sum[1] + p[1], sum[2] + p[2]], [0, 0, 0] as EboPoint).map(v => v / points.length) as EboPoint;
  }

  private hasCrossedSeam(point: EboPoint, from: string, to: string, edge: TransitionPair) {
    const a = this.roomCenter(from), b = this.roomCenter(to);
    const direction = edge.crossingDirection ?? (a && b ? [b[0] - a[0], b[1] - a[1]] as [number, number] : null);
    if (!direction) return false;
    const [dx, dy] = direction, length = Math.hypot(dx, dy);
    if (length < 0.001) return pointDistance(point, edge.midpoint) < 0.2;
    return ((point[0] - edge.midpoint[0]) * dx + (point[1] - edge.midpoint[1]) * dy) / length > 0.015;
  }

  private projectTransitionAware(point: EboPoint, previous: EboHit, maxDistance: number) {
    for (const edge of this.transitionMap.get(previous.room) ?? []) {
      if (pointDistance(point, edge.midpoint) > 0.72 || !this.hasCrossedSeam(point, previous.room, edge.to, edge)) continue;
      const other = this.resolve(point, true, maxDistance, 2.8, [edge.to]);
      if (other?.walkability === "WALKABLE") return other;
    }
    const sameRoom = this.resolve(point, true, maxDistance, 2.8, [previous.room]);
    if (sameRoom?.walkability === "WALKABLE") {
      const noForwardProgress = sameRoom.dist > 0.035 && pointDistance(sameRoom.point, previous.point) < 0.012;
      return noForwardProgress ? null : sameRoom;
    }
    return null;
  }
  private transitionFor(from: string, to: string) {
    return this.transitionMap.get(from)?.find(edge => edge.to === to);
  }

  private nearTransition(room: string, point: EboPoint, radius: number) {
    return (this.transitionMap.get(room) ?? []).find(edge => pointDistance(point, edge.midpoint) <= radius) ?? null;
  }

  private transitionExit(midpoint: EboPoint, from: string, to: string) {
    const a = this.roomCenter(from), b = this.roomCenter(to);
    if (!a || !b) return [...midpoint] as EboPoint;
    const dx = b[0] - a[0], dy = b[1] - a[1], length = Math.max(0.001, Math.hypot(dx, dy));
    const edge = this.transitionFor(from, to);
    const direction = edge?.crossingDirection ?? [dx, dy];
    const directionLength = Math.max(0.001, Math.hypot(direction[0], direction[1]));
    return [midpoint[0] + direction[0] / directionLength * 0.28, midpoint[1] + direction[1] / directionLength * 0.28, midpoint[2]] as EboPoint;
  }

  private updateLeaderApproach() {
    const edges = this.transitionMap.get(this.currentHit.room) ?? [];
    const nearest = edges.map(edge => ({ edge, distance: pointDistance(this.acceptedPoint, edge.midpoint) })).sort((a, b) => a.distance - b.distance)[0];
    if (!nearest || nearest.distance > 1.35) { this.lastApproachKey = null; return; }
    const key = `${this.currentHit.room}>${nearest.edge.to}:${nearest.edge.gitDoorId ?? nearest.edge.midpoint.map(v => v.toFixed(2)).join(",")}`;
    if (this.lastApproachKey === key) return;
    this.lastApproachKey = key;
    const isDoor = Boolean(nearest.edge.gitDoorId);
    this.leaderTrail.append({
      type: isDoor ? "GIT_DOOR_APPROACH" : "PORTAL_APPROACH",
      room: this.currentHit.room, face: this.currentHit.face, worldPosition: [...this.acceptedPoint],
      transitionType: nearest.edge.kind, fromRoom: this.currentHit.room, toRoom: nearest.edge.to,
      sourceId: nearest.edge.gitDoorId ?? null, targetPosition: this.transitionExit(nearest.edge.midpoint, this.currentHit.room, nearest.edge.to),
    });
  }

  private seedRoomTransitions() {
    for (const row of this.nav.roomAdjacency?.edges ?? []) {
      const kind = String(row.connectionType ?? "UNKNOWN");
      for (const evidence of row.directedEvidence ?? []) {
        const from = String(evidence.from).toLowerCase(), to = String(evidence.to).toLowerCase();
        let transitionEdges = (evidence.transitionEdges ?? []).map((e: any) => ({ midpoint: e.midpoint as EboPoint, crossingDirection: Array.isArray(e.crossingDirection) ? e.crossingDirection as [number, number] : undefined }));
        if (!transitionEdges.length && Array.isArray(evidence.midpoint)) transitionEdges = [{ midpoint: evidence.midpoint as EboPoint }];
        for (const { midpoint, crossingDirection } of transitionEdges) {
          const list = this.transitionMap.get(from) ?? [];
          const matchingEvidence = (row.evidence ?? []).map((e: any) => ({ evidence: e, distance: Array.isArray(e.transitionMidpoint) ? pointDistance(e.transitionMidpoint, midpoint) : Infinity })).sort((a: any, b: any) => a.distance - b.distance)[0]?.evidence;
          const candidateDoor = matchingEvidence?.nearestGitDoor;
          const gitDoorId = candidateDoor && Number(candidateDoor.distance) <= 0.75 ? String(candidateDoor.id) : undefined;
          list.push({ to, midpoint, crossingDirection, kind, gitDoorId, doorTag: gitDoorId ? String(candidateDoor.tag ?? "") : undefined });
          this.transitionMap.set(from, list);
        }
      }
    }
  }

  private buildPthGraph() {
    for (const node of this.nav.pth) {
      const id = Number(node.id);
      this.nodes.set(id, node);
      this.links.set(id, []);
    }
    const add = (from: number, link: PthLink) => {
      const list = this.links.get(from);
      if (list && !list.some(e => e.to === link.to && ((e.via == null && link.via == null) || (e.via && link.via && samePoint(e.via, link.via))))) list.push(link);
    };
    for (const node of this.nav.pth) {
      const from = Number(node.id);
      for (const id0 of node.connections ?? []) {
        const id = Number(id0), other = this.nodes.get(id);
        if (!other || !this.projected(node) || !this.projected(other)) continue;
        const a = this.nodePoint(node), b = this.nodePoint(other);
        const fromRoom = String(node.projection.room).toLowerCase(), toRoom = String(other.projection.room).toLowerCase();
        if (fromRoom !== toRoom) {
          const seam = this.transitionFor(fromRoom, toRoom);
          if (seam) add(from, { to: id, via: seam.midpoint, kind: seam.kind, weight: pointDistance(a, seam.midpoint) + pointDistance(seam.midpoint, b) });
        } else add(from, { to: id, kind: "PTH", weight: pointDistance(a, b) });
      }
    }
    for (const row of this.nav.roomAdjacency?.edges ?? []) for (const evidence of row.directedEvidence ?? []) {
      const fromRoom = String(evidence.from).toLowerCase(), toRoom = String(evidence.to).toLowerCase();
      let targets: EboPoint[] = (evidence.transitionEdges ?? []).map((e: any) => e.midpoint as EboPoint);
      if (!targets.length && Array.isArray(evidence.midpoint)) targets = [evidence.midpoint as EboPoint];
      for (const via of targets) {
        const a = this.nearestNode(via, fromRoom), b = this.nearestNode(via, toRoom);
        if (!a || !b || a.id === b.id) continue;
        add(Number(a.id), { to: Number(b.id), via, kind: String(row.connectionType ?? "ROOM_PORTAL"), weight: pointDistance(this.nodePoint(a), via) + pointDistance(via, this.nodePoint(b)) });
      }
    }
  }

  private projected(node: any) { return node.projection?.status === "PROJECTED" && node.projection?.room; }
  private nodePoint(node: any): EboPoint { return [Number(node.position[0]), Number(node.position[1]), Number(node.projection?.height ?? 1.8)]; }
  private nearestNode(point: EboPoint, room?: string) {
    const candidates = [...this.nodes.values()].filter(n => this.projected(n) && (!room || String(n.projection.room).toLowerCase() === room.toLowerCase()));
    return candidates.sort((a, b) => pointDistance(this.nodePoint(a), point) - pointDistance(this.nodePoint(b), point))[0] ?? null;
  }

  private plannedPath(from: EboPoint, fromRoom: string, to: EboPoint, toRoom: string): EboPoint[] {
    const sameRoom = fromRoom.toLowerCase() === toRoom.toLowerCase();
    const start = this.nearestNode(from, fromRoom) ?? (sameRoom ? null : this.nearestNode(from));
    const goal = this.nearestNode(to, toRoom) ?? (sameRoom ? null : this.nearestNode(to));
    if (!start || !goal) return [to];
    const s = Number(start.id), g = Number(goal.id), distance = new Map<number, number>([[s, 0]]);
    const previous = new Map<number, { id: number; via?: EboPoint }>(), queue = [s], visited = new Set<number>();
    while (queue.length) {
      queue.sort((a, b) => (distance.get(a) ?? Infinity) - (distance.get(b) ?? Infinity));
      const id = queue.shift()!;
      if (visited.has(id)) continue;
      visited.add(id);
      if (id === g) break;
      for (const edge of this.links.get(id) ?? []) {
        // Intra-room routes may not use a nearby PTH edge through an old portal.
        // Cross-room movement is driven only by the leader's transition cursor.
        const nextNode = this.nodes.get(edge.to);
        if (sameRoom && String(nextNode?.projection?.room ?? "").toLowerCase() !== fromRoom.toLowerCase()) continue;
        const next = (distance.get(id) ?? Infinity) + edge.weight;
        if (next < (distance.get(edge.to) ?? Infinity)) {
          distance.set(edge.to, next); previous.set(edge.to, { id, via: edge.via }); queue.push(edge.to);
        }
      }
    }
    if (!distance.has(g)) return [to];
    const ids = [g];
    while (ids[0] !== s && previous.has(ids[0])) ids.unshift(previous.get(ids[0])!.id);
    if (ids[0] !== s) return [to];
    const out: EboPoint[] = [];
    for (let i = 0; i < ids.length; i++) {
      if (i > 0) { const bridge = previous.get(ids[i]); if (bridge?.via) out.push([...bridge.via]); }
      const node = this.nodes.get(ids[i]); if (node) out.push(this.nodePoint(node));
    }
    out.push([...to]);
    return out.filter((p, i) => i === 0 || pointDistance(p, out[i - 1]) > 0.22);
  }

  private formationPoint(slot: "rear-left" | "rear-right"): EboPoint {
    const yaw = this.player?.visualRoot.rotation.y ?? this.spawnYaw;
    const forwardX = Math.sin(yaw), forwardZ = Math.cos(yaw);
    const sideX = Math.cos(yaw), sideZ = -Math.sin(yaw);
    const isNarrow = this.roomWidth(this.currentHit.room) < 2.7;
    const side = isNarrow ? 0 : slot === "rear-left" ? -0.58 : 0.58;
    const back = slot === "rear-left" ? 2.0 : 3.25;
    const x = this.controlledPosition.x - forwardX * back + sideX * side;
    const z = this.controlledPosition.z - forwardZ * back + sideZ * side;
    return [x, -z, this.controlledPosition.y];
  }

  private roomWidth(room: string) {
    const faces = this.nav.rooms.find(r => r.resref.toLowerCase() === room.toLowerCase())?.faces.filter(f => f.walkability === "WALKABLE") ?? [];
    const points = faces.flatMap(f => f.vertices);
    if (!points.length) return Infinity;
    const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
    return Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  }

  async runRouteTo(target: EboPoint, targetRoom: string, running = false) {
    const room = targetRoom.toLowerCase();
    const targetHit = this.resolve(target, true, 0.7, 1.2, [room]);
    if (!targetHit) return { pass: false, reason: "TARGET_NOT_WALKABLE", target, targetRoom };
    const start = [...this.acceptedPoint] as EboPoint;
    const route = this.plannedPath(start, this.currentHit.room, targetHit.point, room);
    const playerStart = this.playerDistance, walkStart = this.playerWalkDistance, runStart = this.playerRunDistance;
    const followerStart = Object.fromEntries(this.followers.map(f => [f.id, f.state()]));
    const result = await this.driveRoute(route, running);
    const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    let followerSettleFrames = 0;
    const followersToSettle = this.followers.filter(follower => follower !== this.activeNaraFollower);
    while (followersToSettle.length && followerSettleFrames < 1800) {
      if (followersToSettle.every(follower => follower.hit.room === this.currentHit.room && d3(follower.root.position, this.controlledPosition) <= 6.0)) break;
      await frame(); followerSettleFrames++;
    }
    const end = [...this.acceptedPoint] as EboPoint;
    const remaining = pointDistance(end, targetHit.point);
    const followers = this.followers.map(f => {
      const before: any = followerStart[f.id];
      const after = f.state();
      return { ...after, distanceDelta: after.distance - Number(before?.distance ?? 0), maxSeparationDelta: after.maxSeparation };
    });
    return {
      pass: result.pass && this.currentHit.room.toLowerCase() === room && remaining <= 0.72,
      method: "PTH_ROUTE_WITH_PLAYERCONTROLLER_AND_BWM",
      targetSource: "SOURCE_TR_LEAVE_PROJECTED_TO_BWM",
      targetRoom: room,
      targetFace: targetHit.face,
      targetPosition: targetHit.point,
      start,
      end,
      endRoom: this.currentHit.room,
      endFace: this.currentHit.face,
      remaining,
      running,
      playerDistance: this.playerDistance - playerStart,
      walked: this.playerWalkDistance - walkStart,
      ran: this.playerRunDistance - runStart,
      roomsVisited: [...this.visitedRooms],
      roomTransitions: [...this.roomTransitions],
      edgeRejectDelta: this.edgeRejectCount,
      followerSettleFrames,
      followersSettled: followersToSettle.every(follower => follower.hit.room === this.currentHit.room && d3(follower.root.position, this.controlledPosition) <= 6.0),
      route: result,
      followers,
    };
  }

  private canWalkSegment(from: EboPoint, to: EboPoint, room: string) {
    const length = pointDistance(from, to), steps = Math.max(1, Math.ceil(length / 0.3));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const p: EboPoint = [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, from[2] + (to[2] - from[2]) * t];
      const hit = this.resolve(p, true, 0.28, 1.25, [room]);
      if (!hit || hit.walkability !== "WALKABLE" || hit.room !== room) return false;
    }
    return true;
  }

  private nextLeaderTransition(follower: Follower) {
    return this.leaderTrail.events.find(event =>
      event.sequence > follower.lastConsumedLeaderEvent &&
      (event.type === "PORTAL_CROSS" || event.type === "GIT_DOOR_CROSS")
    ) ?? null;
  }

  private updateFollower(follower: Follower, dt: number) {
    follower.velocity.set(0, 0, 0);
    const separation = d3(follower.root.position, this.controlledPosition);
    follower.maxSeparation = Math.max(follower.maxSeparation, separation);
    follower.separationSum += separation; follower.separationSamples++;
    follower.repathSeconds -= dt;

    // Advance only when the BWM has confirmed that the follower entered the event's target room.
    const justCompleted = follower.activeTransitionSequence == null ? null : this.leaderTrail.events.find(e => e.sequence === follower.activeTransitionSequence) ?? null;
    if (justCompleted && follower.hit.room === justCompleted.toRoom) {
      follower.lastConsumedLeaderEvent = Math.max(follower.lastConsumedLeaderEvent, justCompleted.sequence);
      follower.activeTransitionSequence = null;
      follower.activeTransitionStage = null;
      follower.path = []; follower.pathIndex = 0; follower.lastGoal = null; follower.directSteering = false;
    }

    let transition = this.nextLeaderTransition(follower);
    // The follower may already be in the destination if the room resolver changed before this update.
    while (transition && follower.hit.room === transition.toRoom) {
      follower.lastConsumedLeaderEvent = Math.max(follower.lastConsumedLeaderEvent, transition.sequence);
      follower.activeTransitionSequence = null;
      follower.activeTransitionStage = null;
      transition = this.nextLeaderTransition(follower);
    }

    let goal: EboHit | null = null;
    let targetSource = "FORMATION";
    let transitionMode = false;
    let transitionStageChanged = false;
    if (transition) {
      if (transition.fromRoom !== follower.hit.room || !transition.targetPosition || !transition.toRoom) {
        follower.behavior = "WAIT_AT_DOOR"; follower.diagnosticTarget = { room: transition.fromRoom, position: transition.worldPosition, source: "PORTAL" };
        follower.playSemantic("IDLE"); return;
      }
      const edge = this.transitionFor(transition.fromRoom, transition.toRoom);
      if (!edge) { follower.behavior = "WAIT_AT_DOOR"; follower.playSemantic("IDLE"); return; }
      const sourceEntry = this.transitionExit(edge.midpoint, transition.toRoom, transition.fromRoom);
      const sourceHit = this.resolve(sourceEntry, true, 1.1, 2.0, [transition.fromRoom]);
      goal = this.resolve(transition.targetPosition, true, 1.1, 2.0, [transition.toRoom]);
      if (!sourceHit || !goal) { follower.behavior = "WAIT_AT_DOOR"; follower.playSemantic("IDLE"); return; }
      targetSource = transition.type === "GIT_DOOR_CROSS" ? "DOOR" : "PORTAL";
      transitionMode = true;
      if (follower.activeTransitionSequence !== transition.sequence) {
        follower.activeTransitionSequence = transition.sequence;
        follower.activeTransitionStage = "APPROACH";
        follower.path = []; follower.pathIndex = 0; follower.lastGoal = null; follower.directSteering = false;
        transitionStageChanged = true;
      }
      if (follower.activeTransitionStage === "APPROACH" && pointDistance(follower.hit.point, sourceHit.point) <= 0.34) {
        follower.activeTransitionStage = "CROSS";
        follower.path = []; follower.pathIndex = 0; follower.lastGoal = null; follower.directSteering = true;
        transitionStageChanged = true;
      }
      if (follower.activeTransitionStage === "APPROACH") goal = sourceHit;
    } else if (follower.hit.room === this.currentHit.room) {
      const desired = this.formationPoint(follower.slot);
      goal = this.resolve(desired, true, 1.1, 2.1, [follower.hit.room]) ?? this.resolve(desired, true, 2.4, 2.4, [follower.hit.room]);
      if (!goal) { follower.behavior = "WAIT_AT_DOOR"; follower.diagnosticTarget = { room: follower.hit.room, position: desired, source: "FORMATION" }; follower.playSemantic("IDLE"); return; }
      if (separation <= 1.8 && follower.hit.room === this.currentHit.room) {
        follower.path = []; follower.pathIndex = 0; follower.directSteering = true;
        follower.diagnosticTarget = { room: goal.room, position: [...goal.point], source: "FORMATION" };
        follower.behavior = "IDLE_NEAR_PLAYER"; follower.playSemantic("IDLE"); return;
      }
    } else {
      follower.behavior = "WAIT_AT_DOOR"; follower.playSemantic("IDLE"); return;
    }

    const goalPoint = [...goal.point] as EboPoint;
    const goalChanged = !follower.lastGoal || pointDistance(follower.lastGoal, goalPoint) > (transitionMode ? 0.28 : 1.8);
    if (!transitionMode && (goalChanged || (follower.path.length === 0 && follower.repathSeconds <= 0))) {
      const directlyWalkable = this.canWalkSegment(follower.hit.point, goalPoint, follower.hit.room);
      follower.directSteering = directlyWalkable;
      follower.path = []; follower.pathIndex = 0;
      if (!directlyWalkable) {
        follower.path = this.plannedPath(follower.hit.point, follower.hit.room, goalPoint, goal.room);
        follower.pathIndex = 0; follower.repathCount++;
      }
      follower.lastGoal = goalPoint; follower.repathSeconds = 0.35;
    }
    if (transitionMode && follower.activeTransitionStage === "APPROACH" && (transitionStageChanged || goalChanged || (follower.path.length === 0 && follower.repathSeconds <= 0))) {
      const direct = this.canWalkSegment(follower.hit.point, goalPoint, follower.hit.room);
      follower.directSteering = direct;
      follower.path = direct ? [] : this.plannedPath(follower.hit.point, follower.hit.room, goalPoint, goal.room);
      follower.pathIndex = 0; follower.lastGoal = goalPoint; follower.repathSeconds = 0.6;
      if (!direct) follower.repathCount++;
    } else if (transitionMode && follower.activeTransitionStage === "CROSS") {
      follower.path = []; follower.pathIndex = 0; follower.lastGoal = goalPoint; follower.directSteering = true;
    }

    const running = separation > 5 || transitionMode;
    const speed = running ? Math.max(5.5, Math.min(7.2, this.player.horizontalSpeed * 1.22)) : 4.0;
    let next: EboPoint | null = null;
    if (follower.directSteering) next = goalPoint;
    else {
      next = follower.path[follower.pathIndex] ?? null;
      while (next && pointDistance(follower.hit.point, next) < 0.34 && follower.pathIndex < follower.path.length - 1) next = follower.path[++follower.pathIndex];
    }
    follower.diagnosticTarget = { room: goal.room, position: next ? [...next] : goalPoint, source: transitionMode ? targetSource : running ? "CATCHUP" : follower.directSteering ? "FORMATION" : "PTH" };
    if (!next) {
      if (transitionMode && follower.hit.room === transition?.toRoom) {
        follower.lastConsumedLeaderEvent = Math.max(follower.lastConsumedLeaderEvent, transition.sequence);
        follower.activeTransitionSequence = null; follower.activeTransitionStage = null; follower.path = []; follower.lastGoal = null;
      } else if (follower.directSteering && !transitionMode) {
        follower.behavior = "IDLE_NEAR_PLAYER"; follower.playSemantic("IDLE");
      } else { follower.behavior = "WAIT_AT_DOOR"; follower.playSemantic("IDLE"); }
      return;
    }

    const dx = next[0] - follower.hit.point[0], dy = next[1] - follower.hit.point[1], distance = Math.hypot(dx, dy);
    if (distance < 0.03) {
      // A follower can reach its formation point while retaining the previous
      // RUN/WALK group. Clear velocity and return to peaceful idle at arrival;
      // otherwise the visual keeps running while navigation is stationary.
      follower.velocity.set(0, 0, 0);
      if (transitionMode && follower.activeTransitionStage === "CROSS" && follower.hit.room === transition?.toRoom) {
        follower.lastConsumedLeaderEvent = Math.max(follower.lastConsumedLeaderEvent, transition?.sequence ?? 0);
        follower.activeTransitionSequence = null;
        follower.activeTransitionStage = null;
        follower.path = [];
        follower.pathIndex = 0;
        follower.lastGoal = null;
        follower.directSteering = false;
        follower.behavior = "IDLE_NEAR_PLAYER";
      } else {
        follower.behavior = transitionMode ? "WAIT_AT_DOOR" : "IDLE_NEAR_PLAYER";
      }
      follower.playSemantic("IDLE");
      return;
    }
    const amount = Math.min(distance, speed * dt);
    const candidate: EboPoint = [follower.hit.point[0] + dx / distance * amount, follower.hit.point[1] + dy / distance * amount, follower.hit.point[2]];
    let nextHit = this.projectTransitionAware(candidate, follower.hit, Math.max(0.07, amount + 0.035));
    // Formation and source-side approach are room-local. Only the explicit CROSS
    // stage may accept the destination room from the transition-aware BWM resolver.
    if (nextHit && nextHit.room !== follower.hit.room &&
        !(transitionMode && follower.activeTransitionStage === "CROSS")) nextHit = null;
    if (!nextHit) {
      follower.noProgressSeconds += dt;
      if (follower.noProgressSeconds > 1.5) {
        follower.behavior = transitionMode ? (targetSource === "DOOR" ? "WAIT_AT_DOOR" : "TRANSITION_CATCHUP") : "STUCK_RECOVERY";
        if (!transitionMode) follower.stuckCount++;
        follower.repathSeconds = 0; follower.path = []; follower.noProgressSeconds = 0;
      }
      follower.playSemantic("IDLE"); return;
    }
    const old = follower.root.position.clone();
    const oldHit = follower.hit;
    follower.hit = nextHit; follower.root.position.copyFrom(renderAt(nextHit.point));
    if (oldHit.room !== nextHit.room) {
      const edge = this.transitionFor(oldHit.room, nextHit.room);
      follower.roomTransitions.push({ fromRoom: oldHit.room, toRoom: nextHit.room, fromFace: oldHit.face, toFace: nextHit.face, position: [...nextHit.point], method: edge?.kind ?? "BWM_ROOM_TRANSITION", gitDoorId: edge?.gitDoorId ?? null });
    }
    const moved = d3(old, follower.root.position);
    if (moved > 0.001) {
      follower.noProgressSeconds = 0; follower.distance += moved;
      if (running) follower.distanceRun += moved; else follower.distanceWalk += moved;
      follower.faces.add(nextHit.room + ":" + nextHit.face);
      const renderDelta = follower.root.position.subtract(old);
      follower.velocity.copyFrom(renderDelta.scale(1 / Math.max(dt, 1e-4)));
      // Navigation Y is -Babylon Z. Compute heading in render space, matching PlayerController's +Z forward convention.
      follower.root.rotation.y = Math.atan2(renderDelta.x, renderDelta.z);
      if (transitionMode) follower.behavior = targetSource === "DOOR" ? (transition && pointDistance(follower.hit.point, transition.worldPosition) > 1.0 ? "APPROACH_DOOR" : "CROSS_DOOR") : "TRANSITION_CATCHUP";
      else if (separation > 5) follower.behavior = "CATCH_UP";
      else follower.behavior = running ? "FOLLOW_RUN" : "FOLLOW_WALK";
      follower.playSemantic(running ? "RUN" : "WALK");
    }
  }

  async runSurvey() {
    this.diagnosticTrace.length = 0;
    this.diagnosticElapsed = 0;
    this.diagnosticTotal = 0;
    const start = [...this.acceptedPoint] as EboPoint;
    const startNode = this.nearestNode(start, this.currentHit.room) ?? this.nearestNode(start);
    if (!startNode) return { pass: false, reason: "NO_PTH_START_NODE" };
    const dist = new Map<number, number>([[Number(startNode.id), 0]]);
    const prev = new Map<number, { from: number; via?: EboPoint }>();
    const queue = [Number(startNode.id)], seen = new Set<number>();
    while (queue.length) {
      queue.sort((a, b) => (dist.get(a) ?? Infinity) - (dist.get(b) ?? Infinity));
      const id = queue.shift()!; if (seen.has(id)) continue; seen.add(id);
      for (const edge of this.links.get(id) ?? []) {
        const next = (dist.get(id) ?? 0) + edge.weight;
        if (next < (dist.get(edge.to) ?? Infinity)) { dist.set(edge.to, next); prev.set(edge.to, { from: id, via: edge.via }); queue.push(edge.to); }
      }
    }
    const choices = [...dist.entries()].filter(([id, d]) => d >= 28 && id !== Number(startNode.id))
      .map(([id, d]) => ({ id, d, node: this.nodes.get(id) }))
      .filter(x => x.node?.projection?.status === "PROJECTED").sort((a, b) => b.d - a.d);
    const target = choices[0];
    if (!target) return { pass: false, reason: "NO_30M_PTH_ROUTE", reachableNodes: dist.size };
    const ids = [target.id];
    while (ids[0] !== Number(startNode.id) && prev.has(ids[0])) ids.unshift(prev.get(ids[0])!.from);
    const points: EboPoint[] = [];
    for (let i = 0; i < ids.length; i++) {
      if (i > 0) { const bridge = prev.get(ids[i]); if (bridge?.via) points.push([...bridge.via]); }
      points.push(this.nodePoint(this.nodes.get(ids[i])));
    }
    const endNode = this.nodes.get(target.id), endRoom = String(endNode.projection.room).toLowerCase();
    const endHit = this.resolve(this.nodePoint(endNode), true, 0.12, 1.2, [endRoom]);
    if (!endHit) return { pass: false, reason: "PTH_ENDPOINT_NOT_BWM_WALKABLE", targetRoom: endRoom };
    points.push([...endHit.point]);
    const out = await this.driveRoute(points, false);
    const walked = this.playerWalkDistance;
    const back = await this.driveRoute(points.slice().reverse(), true);
    return {
      pass: out.pass && back.pass && this.visitedRooms.size >= 2, start, end: [...this.acceptedPoint], targetRoom: endRoom,
      pthNodeSequence: ids, routeDistance: target.d, outbound: out, return: back, distanceWalked: walked,
      distanceRun: this.playerRunDistance, totalPlayerDistance: this.playerDistance, edgeRejectCount: this.edgeRejectCount, doorWaits: this.doorWaits,
      roomTransitions: [...this.roomTransitions], roomsVisited: [...this.visitedRooms], facesVisited: [...this.visitedFaces],
      mission: this.followers.find(f => f.id === "Mission")?.state() ?? null, jolee: this.followers.find(f => f.id === "Jolee")?.state() ?? null, nara: this.followers.find(f => f.id === "Nara")?.state() ?? null,
      diagnosticTrace: [...this.diagnosticTrace],
      leaderEvents: [...this.leaderTrail.events],
    };
  }

  async runGitDoorSurvey(doorId = "doors_001") {
    const directed = [...this.transitionMap.entries()].flatMap(([from, edges]) => edges.filter(edge => edge.gitDoorId === doorId && this.nearestNode(edge.midpoint, from)).map(edge => ({ from, edge })))
      .sort((a, b) => pointDistance(a.edge.midpoint, this.acceptedPoint) - pointDistance(b.edge.midpoint, this.acceptedPoint))[0];
    if (!directed) return { pass: false, reason: "GIT_DOOR_EDGE_OR_SOURCE_PTH_UNRESOLVED", doorId };
    const fromRoom = directed.from, toRoom = directed.edge.to, midpoint = [...directed.edge.midpoint] as EboPoint;
    const a = this.roomCenter(fromRoom), b = this.roomCenter(toRoom);
    if (!a || !b) return { pass: false, reason: "DOOR_ROOM_CENTER_UNRESOLVED", doorId, fromRoom, toRoom };
    const dx = b[0] - a[0], dy = b[1] - a[1], length = Math.max(0.001, Math.hypot(dx, dy));
    const approach: EboPoint = [midpoint[0] - dx / length * 0.3, midpoint[1] - dy / length * 0.3, midpoint[2]];
    const exit: EboPoint = [midpoint[0] + dx / length * 0.32, midpoint[1] + dy / length * 0.32, midpoint[2]];
    const approachHit = this.resolve(approach, true, 0.65, 1.2, [fromRoom]);
    const exitHit = this.resolve(exit, true, 0.65, 1.2, [toRoom]);
    if (!approachHit || !exitHit) return { pass: false, reason: "DOOR_ENTRY_EXIT_NOT_WALKABLE_IN_EXPECTED_ROOMS", doorId, fromRoom, toRoom, approachHit, exitHit };
    const route = this.plannedPath(this.acceptedPoint, this.currentHit.room, approachHit.point, fromRoom);
    if (!route.length) return { pass: false, reason: "DOOR_PTH_ROUTE_EMPTY", doorId, fromRoom, toRoom };
    const startPoint = [...this.acceptedPoint] as EboPoint;
    const playerDistanceStart = this.playerDistance;
    const followerDistanceStart = Object.fromEntries(this.followers.map(f => [f.id, f.distance]));
    const roomsBefore = new Set(this.visitedRooms);
    const transitionStart = this.roomTransitions.length;
    const points = [...route.map(p => [...p] as EboPoint), exit];
    const outbound = await this.driveRoute(points, false);
    const outboundTransitions = this.roomTransitions.slice(transitionStart);
    let returning: any = { pass: false, reason: "OUTBOUND_DOOR_ROUTE_FAILED" };
    if (outbound.pass && this.currentHit.room === toRoom) returning = await this.driveRoute([...points.slice().reverse(), startPoint], true);
    const doorTransitions = this.roomTransitions.slice(transitionStart).filter(t => t.gitDoorId === doorId);
    const metrics = this.followers.map(f => {
      const state = f.state();
      return { ...state, distanceDelta: f.distance - Number(followerDistanceStart[f.id] ?? 0), roomLag: this.leaderTrail.events.filter(event => event.sequence > f.lastConsumedLeaderEvent && (event.type === "PORTAL_CROSS" || event.type === "GIT_DOOR_CROSS")).length };
    });
    return {
      pass: outbound.pass && returning.pass && doorTransitions.some(t => t.fromRoom === fromRoom && t.toRoom === toRoom) && this.currentHit.room === this.spawnHit.room,
      doorId, sourceRoom: fromRoom, targetRoom: toRoom, transitionType: directed.edge.kind, midpoint,
      doorPosition: this.nav.doors?.find((d: any) => d.instanceId === doorId)?.position ?? null,
      approachPosition: approachHit.point, crossPosition: exitHit.point, startPoint,
      outbound, return: returning, doorTransitions, roomTransitions: [...this.roomTransitions.slice(transitionStart)],
      routeDistance: this.playerDistance - playerDistanceStart,
      followerDistance: Object.fromEntries(metrics.map(f => [f.id, f.distanceDelta])),
      followerMetrics: metrics, roomsVisited: [...this.visitedRooms], newlyVisitedRooms: [...this.visitedRooms].filter(r => !roomsBefore.has(r)),
      eventCount: this.leaderTrail.events.length, leaderEvents: [...this.leaderTrail.events],
      mission: this.followers.find(f => f.id === "Mission")?.state() ?? null,
      jolee: this.followers.find(f => f.id === "Jolee")?.state() ?? null,
      nara: this.followers.find(f => f.id === "Nara")?.state() ?? null,
    };
  }

  private async driveRoute(points: EboPoint[], running: boolean) {
    const results: any[] = [];
    const press = (key: string) => window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    const release = (key: string) => window.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true }));
    const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    let inputHeld = true, roomAtLastFrame = this.currentHit.room, pendingRoomDistance: number | null = null;
    press("w");
    if (running) press("Shift");
    for (const target of points) {
      let frames = 0, beforeReject = this.edgeRejectCount, lastDistance = Infinity, noProgress = 0;
      while (frames < 2600) {
        const remaining = pointDistance(this.acceptedPoint, target);
        if (remaining < 0.24) break;
        this.camera.yaw = Math.atan2(target[0] - this.acceptedPoint[0], target[1] - this.acceptedPoint[1]);
        await frame();
        frames++;
        if (this.currentHit.room !== roomAtLastFrame) {
          roomAtLastFrame = this.currentHit.room;
          pendingRoomDistance = this.playerDistance;
        }
        if (remaining >= lastDistance - 0.003) noProgress++; else noProgress = 0;
        lastDistance = remaining;
        if (noProgress > 180 || this.edgeRejectCount - beforeReject > 30) break;
      }
      results.push({ target, position: [...this.acceptedPoint], room: this.currentHit.room, face: this.currentHit.face, remaining: pointDistance(this.acceptedPoint, target), frames, rejected: this.edgeRejectCount - beforeReject });
      if (pointDistance(this.acceptedPoint, target) > 0.72) {
        release("w"); if (running) release("Shift");
        // Synthetic route input must not leak into the next gameplay frame.
        // Clearing and restoring the existing controller input gate preserves
        // direct control while making route completion deterministic.
        this.player.setInputEnabled(false);
        this.player.setInputEnabled(true);
        this.player.setPosition(renderAt(this.acceptedPoint));
        return { pass: false, segments: results, reason: "ROUTE_SEGMENT_BLOCKED" };
      }
      const clearDoorDistance = pendingRoomDistance != null && this.playerDistance - pendingRoomDistance >= 4.25;
      const needsDoorWait = clearDoorDistance && this.followers.some(f => f !== this.activeNaraFollower && (f.hit.room !== this.currentHit.room || d3(f.root.position, this.controlledPosition) > 6.0));
      if (needsDoorWait) {
        if (inputHeld) { release("w"); if (running) release("Shift"); inputHeld = false; }
        this.doorWaits++;
        for (let wait = 0; wait < 600; wait++) {
          await frame();
        if (this.followers.filter(f => f !== this.activeNaraFollower).every(f => f.hit.room === this.currentHit.room && d3(f.root.position, this.controlledPosition) <= 6.0)) break;
        }
        press("w"); if (running) press("Shift"); inputHeld = true;
      }
      if (clearDoorDistance) pendingRoomDistance = null;
    }
    if (inputHeld) { release("w"); if (running) release("Shift"); }
    this.player.setInputEnabled(false);
    this.player.setInputEnabled(true);
    this.player.setPosition(renderAt(this.acceptedPoint));
    // A long post-route settle let residual PlayerController momentum carry the
    // leader away from a target that had already been reached (about 1.2 m on
    // Academy run segments). One frame is enough to commit the final WOK sample;
    // followers continue their ordinary update on subsequent render frames.
    await frame();
    return { pass: true, segments: results, doorWaits: this.doorWaits };
  }
  state() {
    const vis = this.updateVisibility(renderAt(this.acceptedPoint), this.currentHit);
    const companions = this.followers.map(follower => {
      const actor = follower.state();
      actor.roomLag = this.leaderTrail.events.filter(event => event.sequence > follower.lastConsumedLeaderEvent && (event.type === "PORTAL_CROSS" || event.type === "GIT_DOOR_CROSS")).length;
      const next = this.leaderTrail.events.find(event => event.sequence > follower.lastConsumedLeaderEvent && (event.type === "PORTAL_CROSS" || event.type === "GIT_DOOR_CROSS"));
      actor.nextLeaderEvent = next?.sequence ?? null;
      return actor;
    });
    return {
      enabled: true, controller: "PlayerController", camera: "ThirdPersonCamera", leaderId: this.leaderId, characterId: this.leaderId, position: this.controlledPosition.asArray(),
      controlledActorId: this.controlledActorId, followerActorId: this.followerActorId, controlSwapEnabled: this.controlSwapEnabled,
      controlOwnership: this.controlOwnership?.snapshot() ?? null,
      partySelection: this.partySelection?.snapshot() ?? null,
      tacticalOrderSelection: this.tacticalOrderSelection?.snapshot() ?? null,
      tacticalQueues: this.tacticalQueue ? { aren: this.tacticalQueue.getQueue("AREN"), nara: this.tacticalQueue.getQueue("NARA") } : null,
      tacticalExecutor: this.tacticalExecutor?.snapshot() ?? null,
      navPosition: [...this.acceptedPoint], speed: this.player.horizontalSpeed, animation: this.player.animations.activeClipName,
      animationState: this.player.animationState, locomotionState: this.player.detailedLocomotionState,
      animationResolution: this.player.animations.animationResolutionTrace,
      room: this.currentHit.room, face: this.currentHit.face, surface: this.currentHit.material, height: this.currentHit.height,
      distance: this.playerDistance, distanceWalk: this.playerWalkDistance, distanceRun: this.playerRunDistance,
      edgeRejectCount: this.edgeRejectCount, movementAcceptedFrames: this.acceptedFrames, roomTransitions: [...this.roomTransitions], doorWaits: this.doorWaits,
      roomsVisited: [...this.visitedRooms], facesVisited: [...this.visitedFaces], vis,
      spawn: { room: this.spawnHit.room, face: this.spawnHit.face, position: this.spawnHit.point, height: this.spawnHit.height, method: "MODULE_ENTRY_PROJECT_TO_BWM" },
      runtimeHeight: 1.8, runtimeScale: this.player.visualRoot.scaling.x, companions,
      pthPlanEdges: [...this.links.values()].reduce((n, a) => n + a.length, 0), leaderEventCount: this.leaderTrail.events.length,
      leaderEvents: [...this.leaderTrail.events],
      diagnosticTrace: [...this.diagnosticTrace],
    };
  }

  setInputEnabled(enabled: boolean) {
    this.player.setInputEnabled(enabled);
  }

  presentationMeshes() {
    return [...new Set([
      ...this.playersAsset.meshes,
      ...this.followers.flatMap((follower) => follower.asset.meshes),
    ])];
  }

  dispose() {
    window.removeEventListener('keydown', this.onControlKeyDown);
    window.removeEventListener('keyup', this.onControlKeyUp);
    window.removeEventListener('blur', this.onControlBlur);
    this.followers.forEach(f => f.dispose());
    this.player.dispose();
    this.playersAsset.dispose();
    this.camera.dispose();
  }
}








