import { AnimationGroup, Scene, TransformNode, Vector3 } from '@babylonjs/core';
import { AssetLoader, ImportedAsset } from '../../assets/AssetLoader';
import { AnchorheadPathGraph } from './AnchorheadPathGraph';
import { NavigationWorld, NavPoint, projectToWalkmesh } from './AnchorheadNavigation';

type CompanionId = 'mission' | 'jolee' | 'nara';
type Slot = 'rear-left' | 'rear-right';
type ClipProfile = { locomotion: { idle: string; walk: string; run: string } };
type CompanionSpec = { id: CompanionId; assetPath: string; profilePath: string; slot: Slot };
type CompanionHit = { room: string; face: number; point: NavPoint; height: number };
type LeaderEvent = {
  sequence: number;
  type: 'SAME_ROOM_ANCHOR' | 'PORTAL_CROSS';
  room: string;
  fromRoom: string | null;
  toRoom: string | null;
  position: NavPoint;
  sourceNode: number | null;
  targetNode: number | null;
};
type Follower = {
  id: CompanionId; slot: Slot; asset: ImportedAsset; profile: ClipProfile; root: TransformNode;
  hit: CompanionHit; activeAnimation: string; group: AnimationGroup | null;
  distance: number; maxSeparation: number; separationSum: number; samples: number;
  repathCount: number; stuckCount: number; recoveryTeleports: number; maxRoomLag: number;
  lastConsumedEvent: number; activeTransition: number | null; transitionStage: 'APPROACH' | 'CROSS' | null;
  path: NavPoint[]; pathIndex: number; lastGoal: NavPoint | null; noProgressSeconds: number; lastTargetDistance: number;
  target: { room: string | null; position: NavPoint | null; source: string; state: string };
};

const d2 = (a: NavPoint, b: NavPoint) => Math.hypot(a.x - b.x, a.z - b.z);
const d3 = (a: Vector3, b: Vector3) => Math.hypot(a.x - b.x, a.z - b.z);
const navFromRender = (p: Vector3): NavPoint => ({ x: -p.x, y: p.y, z: p.z });
const renderFromNav = (p: NavPoint) => new Vector3(-p.x, p.y, p.z);
const clonePoint = (p: NavPoint): NavPoint => ({ x: p.x, y: p.y, z: p.z });

/** World-agnostic actor/follow runtime. The world-specific provider supplies BWM and PTH data. */
export class CompanionController {
  readonly leaderEvents: LeaderEvent[] = [];
  readonly followers: Follower[] = [];
  private nextSequence = 1;
  private leaderRoom: string;
  private lastLeaderPosition: NavPoint;
  private lastAnchorPosition: NavPoint;
  private leaderRouteRooms: string[];
  private disposed = false;
  private routeDebug = false;
  private inputEnabled = true;

  private constructor(
    private readonly scene: Scene,
    private readonly navigation: NavigationWorld,
    private readonly graph: AnchorheadPathGraph,
    leaderRoom: string,
    leaderPosition: NavPoint,
    followers: Follower[],
  ) {
    this.leaderRoom = leaderRoom;
    this.lastLeaderPosition = clonePoint(leaderPosition);
    this.lastAnchorPosition = clonePoint(leaderPosition);
    this.leaderRouteRooms = [leaderRoom];
    this.followers = followers;
    this.append({ type: 'SAME_ROOM_ANCHOR', room: leaderRoom, fromRoom: null, toRoom: null, position: leaderPosition, sourceNode: null, targetNode: null });
    for (const follower of followers) follower.lastConsumedEvent = this.leaderEvents[0].sequence;
  }

  static async create(args: {
    scene: Scene; navigation: NavigationWorld; graph: AnchorheadPathGraph;
    leaderRoom: string; leaderPosition: NavPoint; leaderRenderPosition: Vector3; leaderYaw: number;
    party: CompanionSpec[];
  }) {
    const created: Follower[] = [];
    const loader = new AssetLoader();
    try {
      for (const spec of args.party) {
        const [profile, asset] = await Promise.all([
          fetch(spec.profilePath).then((response) => { if (!response.ok) throw new Error(`W236_${spec.id.toUpperCase()}_PROFILE_HTTP_${response.status}`); return response.json() as Promise<ClipProfile>; }),
          loader.load(spec.assetPath, args.scene),
        ]);
        const desired = this.formationTarget(args.leaderRenderPosition, args.leaderYaw, spec.slot);
        const projected = projectToWalkmesh(navFromRender(desired), args.navigation, {
          currentRoom: args.leaderRoom, allowedRooms: [args.leaderRoom], maxHorizontalDistance: 2.7,
          maxVerticalDistance: 1.4, walkableOnly: true,
        });
        if (!projected || projected.walkability !== 'WALKABLE') {
          asset.dispose();
          throw new Error(`W236_${spec.id.toUpperCase()}_SPAWN_UNRESOLVED_ON_BWM`);
        }
        asset.root.metadata = { ...(asset.root.metadata ?? {}), w236ActorIdentity: spec.id };
        asset.root.position.copyFrom(renderFromNav(projected.point));
        asset.root.rotation.y = args.leaderYaw;
        const follower: Follower = {
          id: spec.id, slot: spec.slot, asset, profile, root: asset.root,
          hit: { room: projected.room, face: projected.face, point: clonePoint(projected.point), height: projected.height },
          activeAnimation: '', group: null, distance: 0, maxSeparation: 0, separationSum: 0, samples: 0,
          repathCount: 0, stuckCount: 0, recoveryTeleports: 0, maxRoomLag: 0,
          lastConsumedEvent: 0, activeTransition: null, transitionStage: null,
          path: [], pathIndex: 0, lastGoal: null, noProgressSeconds: 0, lastTargetDistance: Infinity,
          target: { room: projected.room, position: clonePoint(projected.point), source: 'SPAWN', state: 'IDLE_NEAR_PLAYER' },
        };
        this.play(follower, profile.locomotion.idle);
        created.push(follower);
      }
      return new CompanionController(args.scene, args.navigation, args.graph, args.leaderRoom, args.leaderPosition, created);
    } catch (error) {
      created.forEach((follower) => follower.asset.dispose());
      throw error;
    }
  }

  update(deltaSeconds: number, leaderRenderPosition: Vector3, leaderNavPosition: NavPoint, leaderRoom: string, leaderFace: number | null, leaderYaw: number) {
    if (this.disposed) return;
    const dt = Math.max(0, Math.min(0.05, deltaSeconds));
    if (!this.inputEnabled) { this.followers.forEach((follower) => this.play(follower, follower.profile.locomotion.idle)); return; }
    this.recordLeader(leaderNavPosition, leaderRoom, leaderFace);
    for (const follower of this.followers) this.updateFollower(follower, dt, leaderRenderPosition, leaderNavPosition, leaderRoom, leaderYaw);
    this.lastLeaderPosition = clonePoint(leaderNavPosition);
  }

  private recordLeader(position: NavPoint, room: string, face: number | null) {
    const previousRoom = this.leaderRoom;
    if (room && previousRoom && room !== previousRoom) {
      const edge = this.closestRoomEdge(previousRoom, room, position);
      this.append({ type: 'PORTAL_CROSS', room, fromRoom: previousRoom, toRoom: room, position: clonePoint(position), sourceNode: edge?.from ?? null, targetNode: edge?.to ?? null });
      this.leaderRouteRooms.push(room);
      this.leaderRoom = room;
      this.lastAnchorPosition = clonePoint(position);
      return;
    }
    if (d2(position, this.lastAnchorPosition) >= 3.0) {
      this.append({ type: 'SAME_ROOM_ANCHOR', room, fromRoom: null, toRoom: null, position: clonePoint(position), sourceNode: null, targetNode: null });
      this.lastAnchorPosition = clonePoint(position);
    }
    if (face != null && this.leaderEvents.length === 0) this.lastLeaderPosition = clonePoint(position);
  }

  private closestRoomEdge(fromRoom: string, toRoom: string, position: NavPoint) {
    const options = this.graph.edges.filter((edge) => edge.crossRoom && edge.validWalkmeshEndpoints).flatMap((edge) => {
      const a = this.graph.nodes[edge.from], b = this.graph.nodes[edge.to];
      if (!a?.room || !b?.room) return [];
      if (a.room === fromRoom && b.room === toRoom) return [{ from: edge.from, to: edge.to }];
      if (b.room === fromRoom && a.room === toRoom) return [{ from: edge.to, to: edge.from }];
      return [];
    });
    return options.sort((a, b) => {
      const pa = this.graph.nodes[a.from].worldPosition!, qa = this.graph.nodes[a.to].worldPosition!;
      const pb = this.graph.nodes[b.from].worldPosition!, qb = this.graph.nodes[b.to].worldPosition!;
      return d2({ x: (pa.x + qa.x) / 2, y: (pa.y + qa.y) / 2, z: (pa.z + qa.z) / 2 }, position)
        - d2({ x: (pb.x + qb.x) / 2, y: (pb.y + qb.y) / 2, z: (pb.z + qb.z) / 2 }, position);
    })[0] ?? null;
  }

  private append(event: Omit<LeaderEvent, 'sequence'>) {
    const entry = { ...event, sequence: this.nextSequence++ };
    this.leaderEvents.push(entry);
    return entry;
  }

  private updateFollower(follower: Follower, dt: number, leaderRender: Vector3, leaderNav: NavPoint, leaderRoom: string, leaderYaw: number) {
    const currentRender = follower.root.position.clone();
    const separation = d3(currentRender, leaderRender);
    follower.maxSeparation = Math.max(follower.maxSeparation, separation);
    follower.separationSum += separation;
    follower.samples++;
    const leaderIndex = this.leaderRouteRooms.lastIndexOf(leaderRoom);
    const followerIndex = this.leaderRouteRooms.lastIndexOf(follower.hit.room);
    const roomLag = leaderIndex >= 0 && followerIndex >= 0 ? Math.max(0, leaderIndex - followerIndex) : (leaderRoom === follower.hit.room ? 0 : 1);
    follower.maxRoomLag = Math.max(follower.maxRoomLag, roomLag);

    let target: NavPoint | null = null;
    let targetRoom: string | null = null;
    let targetSource = 'FORMATION';
    let transitionEvent: LeaderEvent | null = null;
    let allowedRooms: string[] = [follower.hit.room];
    let state = 'IDLE_NEAR_PLAYER';

    if (follower.hit.room !== leaderRoom) {
      transitionEvent = this.nextTransition(follower);
      if (transitionEvent?.toRoom === follower.hit.room) {
        follower.lastConsumedEvent = transitionEvent.sequence;
        follower.activeTransition = null;
        follower.transitionStage = null;
        transitionEvent = this.nextTransition(follower);
      }
      if (!transitionEvent || transitionEvent.fromRoom !== follower.hit.room || transitionEvent.sourceNode == null || transitionEvent.targetNode == null) {
        follower.target = { room: transitionEvent?.fromRoom ?? null, position: null, source: 'PORTAL', state: 'WAIT_FOR_ORDERED_TRANSITION' };
        this.play(follower, follower.profile.locomotion.idle);
        return;
      }
      const source = this.graph.nodes[transitionEvent.sourceNode]?.worldPosition;
      const destination = this.graph.nodes[transitionEvent.targetNode]?.worldPosition;
      if (!source || !destination) {
        follower.target = { room: transitionEvent.fromRoom, position: null, source: 'PTH', state: 'TRANSITION_EDGE_UNRESOLVED' };
        this.play(follower, follower.profile.locomotion.idle);
        return;
      }
      targetRoom = follower.transitionStage === 'CROSS' ? transitionEvent.toRoom : transitionEvent.fromRoom;
      target = clonePoint(follower.transitionStage === 'CROSS' ? destination : source);
      targetSource = 'PORTAL';
      state = 'TRANSITION_CATCHUP';
      allowedRooms = follower.transitionStage === 'CROSS' ? [transitionEvent.fromRoom!, transitionEvent.toRoom!] : [follower.hit.room];
      if (follower.activeTransition !== transitionEvent.sequence) {
        follower.activeTransition = transitionEvent.sequence;
        follower.transitionStage = 'APPROACH';
        follower.path = [];
        follower.pathIndex = 0;
      }
      if (follower.transitionStage === 'APPROACH' && d2(follower.hit.point, source) <= 0.78) {
        follower.transitionStage = 'CROSS';
        follower.path = [];
        follower.pathIndex = 0;
        targetRoom = transitionEvent.toRoom;
        target = clonePoint(destination);
        allowedRooms = [transitionEvent.fromRoom!, transitionEvent.toRoom!];
      }
    } else {
      const slot = this.formationTarget(leaderRender, leaderYaw, follower.slot);
      const projection = projectToWalkmesh(navFromRender(slot), this.navigation, {
        currentRoom: leaderRoom, allowedRooms: [leaderRoom], maxHorizontalDistance: 3.0,
        maxVerticalDistance: 1.5, walkableOnly: true,
      });
      target = projection ? clonePoint(projection.point) : clonePoint(leaderNav);
      targetRoom = leaderRoom;
      if (separation <= 1.9) {
        follower.path = [];
        follower.pathIndex = 0;
        follower.target = { room: targetRoom, position: target, source: 'FORMATION', state: 'IDLE_NEAR_PLAYER' };
        this.play(follower, follower.profile.locomotion.idle);
        return;
      }
      state = separation > 5.8 ? 'CATCH_UP' : 'FOLLOW_WALK';
    }

    if (!target || !targetRoom) return;
    let direct = false;
    if (targetRoom === follower.hit.room && (!transitionEvent || follower.transitionStage !== 'CROSS')) {
      direct = this.segmentWalkable(follower.hit.point, target, follower.hit.room);
    }
    if (direct) {
      follower.path = [];
      follower.pathIndex = 0;
    } else if (!follower.lastGoal || d2(follower.lastGoal, target) > 0.9 || !follower.path.length || follower.pathIndex >= follower.path.length) {
      const path = this.route(follower.hit.point, target, follower.hit.room);
      if (path?.length) {
        follower.path = path;
        follower.pathIndex = path.length > 1 ? 1 : 0;
        follower.repathCount++;
      } else if (transitionEvent && follower.transitionStage === 'CROSS') {
        follower.path = [];
      } else {
        follower.target = { room: targetRoom, position: target, source: 'PTH', state: 'WAIT_FOR_VALID_BWM_ROUTE' };
        this.play(follower, follower.profile.locomotion.idle);
        return;
      }
      follower.lastGoal = clonePoint(target);
    }
    while (follower.pathIndex < follower.path.length - 1 && d2(follower.hit.point, follower.path[follower.pathIndex]) < 0.45) follower.pathIndex++;
    const steerPoint = direct ? target : (follower.path[follower.pathIndex] ?? target);
    const goalDistance = d2(follower.hit.point, steerPoint);
    const moveSpeed = transitionEvent ? 2.55 : separation > 5.8 ? 3.15 : separation > 2.3 ? 1.7 : 0;
    const step = Math.min(goalDistance, moveSpeed * dt);
    if (step > 0.0005) {
      const dx = steerPoint.x - follower.hit.point.x;
      const dz = steerPoint.z - follower.hit.point.z;
      const requested = { x: follower.hit.point.x + dx / goalDistance * step, y: follower.hit.point.y, z: follower.hit.point.z + dz / goalDistance * step };
      const hit = projectToWalkmesh(requested, this.navigation, {
        currentRoom: follower.hit.room, allowedRooms, maxHorizontalDistance: Math.max(0.22, step + 0.1),
        maxVerticalDistance: 1.25, walkableOnly: true,
      });
      if (hit && hit.walkability === 'WALKABLE' && (hit.room === follower.hit.room || (transitionEvent && follower.transitionStage === 'CROSS' && hit.room === transitionEvent.toRoom))) {
        const next = renderFromNav(hit.point);
        const moved = d3(currentRender, next);
        follower.distance += moved;
        follower.root.position.copyFrom(next);
        follower.hit = { room: hit.room, face: hit.face, point: clonePoint(hit.point), height: hit.height };
        follower.root.rotation.y = Math.atan2(next.x - currentRender.x, next.z - currentRender.z);
        follower.noProgressSeconds = moved < 0.003 ? follower.noProgressSeconds + dt : 0;
        if (transitionEvent && follower.transitionStage === 'CROSS' && hit.room === transitionEvent.toRoom) {
          follower.lastConsumedEvent = transitionEvent.sequence;
          follower.activeTransition = null;
          follower.transitionStage = null;
          follower.path = [];
          follower.pathIndex = 0;
        }
      } else {
        follower.noProgressSeconds += dt;
      }
    }
    if (follower.noProgressSeconds > 2.4) {
      follower.stuckCount++;
      follower.noProgressSeconds = 0;
      follower.path = [];
      follower.pathIndex = 0;
    }
    const running = transitionEvent != null || separation > 5.8;
    this.play(follower, running ? follower.profile.locomotion.run : follower.profile.locomotion.walk);
    follower.target = { room: targetRoom, position: clonePoint(target), source: direct ? 'FORMATION' : targetSource, state };
  }

  private nextTransition(follower: Follower) {
    return this.leaderEvents.find((event) => event.sequence > follower.lastConsumedEvent && event.type === 'PORTAL_CROSS') ?? null;
  }

  private segmentWalkable(from: NavPoint, to: NavPoint, room: string) {
    const distance = d2(from, to);
    const samples = Math.max(1, Math.ceil(distance / 0.4));
    for (let i = 1; i <= samples; i++) {
      const t = i / samples;
      const point = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t, z: from.z + (to.z - from.z) * t };
      const hit = projectToWalkmesh(point, this.navigation, { allowedRooms: [room], maxHorizontalDistance: 0.06, maxVerticalDistance: 0.9, walkableOnly: true });
      if (!hit || hit.room !== room || hit.walkability !== 'WALKABLE') return false;
    }
    return true;
  }

  private route(from: NavPoint, to: NavPoint, room: string): NavPoint[] | null {
    const roomNodes = this.graph.nodes.filter((node) => node.room === room && node.worldPosition && node.projected?.walkability === 'WALKABLE');
    const nearest = (point: NavPoint) => roomNodes.sort((a, b) => d2(a.worldPosition!, point) - d2(b.worldPosition!, point))[0];
    const start = nearest(from), end = nearest(to);
    if (!start || !end) return null;
    const previous = new Map<number, number>();
    const queue = [start.id]; previous.set(start.id, start.id);
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const current = queue[cursor];
      if (current === end.id) break;
      for (const next of this.graph.adjacency[current] ?? []) {
        if (previous.has(next) || this.graph.nodes[next]?.room !== room) continue;
        previous.set(next, current); queue.push(next);
      }
    }
    if (!previous.has(end.id)) return null;
    const ids = [end.id];
    while (ids[ids.length - 1] !== start.id) ids.push(previous.get(ids[ids.length - 1])!);
    ids.reverse();
    return [...ids.map((id) => this.graph.nodes[id].worldPosition!).map(clonePoint), clonePoint(to)];
  }

  private static formationTarget(leader: Vector3, yaw: number, slot: Slot) {
    const forward = new Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const right = new Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const lateral = slot === 'rear-left' ? -0.58 : 0.58;
    return leader.subtract(forward.scale(2.1)).add(right.scale(lateral));
  }

  private formationTarget(leader: Vector3, yaw: number, slot: Slot) {
    return CompanionController.formationTarget(leader, yaw, slot);
  }

  private static play(follower: Follower, name: string) {
    if (!name || follower.activeAnimation.toLowerCase() === name.toLowerCase()) return;
    const group = follower.asset.animationGroups.find((candidate) => candidate.name.toLowerCase() === name.toLowerCase());
    if (!group) return;
    follower.group?.stop();
    follower.group = group;
    follower.activeAnimation = group.name;
    group.start(true, 1);
  }

  private play(follower: Follower, name: string) { CompanionController.play(follower, name); }

  setDebugRoute(enabled: boolean) { this.routeDebug = enabled; }
  setInputEnabled(enabled: boolean) { this.inputEnabled = enabled; }

  state() {
    return {
      enabled: !this.disposed,
      controller: 'CompanionController',
      leaderEvents: this.leaderEvents.map((event) => ({ ...event })),
      party: this.followers.map((follower) => ({
        id: follower.id, formationSlot: follower.slot, position: follower.root.position.asArray(), room: follower.hit.room, face: follower.hit.face,
        animation: follower.activeAnimation, distance: follower.distance,
        maxSeparation: follower.maxSeparation, meanSeparation: follower.samples ? follower.separationSum / follower.samples : 0,
        repathCount: follower.repathCount, stuckCount: follower.stuckCount, recoveryTeleports: follower.recoveryTeleports,
        maxRoomLag: follower.maxRoomLag, lastConsumedLeaderEvent: follower.lastConsumedEvent,
        nextLeaderEvent: this.nextTransition(follower)?.sequence ?? null, target: { ...follower.target },
        routeDebug: this.routeDebug,
      })),
    };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.followers.forEach((follower) => follower.asset.dispose());
    this.followers.length = 0;
    this.leaderEvents.length = 0;
  }
}
