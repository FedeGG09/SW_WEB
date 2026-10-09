import { projectToWalkmesh } from './AnchorheadNavigation';
import type { NavPoint, NavigationWorld, WalkmeshHit } from './AnchorheadNavigation';
import type { AnchorheadPathGraph } from './AnchorheadPathGraph';

export type RoomAnchoredResolution = { room: string | null; sourcePosition: NavPoint; roomOrigin: number[] | null; worldPosition: NavPoint | null; projected: WalkmeshHit | null; confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'UNRESOLVED'; candidates: number };
export type NormalizedSemantic = { id: string; type: string; resref: string | null; tag: string | null; room: string | null; sourcePosition: NavPoint; roomOrigin: number[] | null; worldPosition: NavPoint | null; orientation: any; walkmesh: WalkmeshHit | null; pthNearestNode: number | null; pthDistance: number | null; source: any };

export function resolveRoomAnchoredPosition(sourcePosition: NavPoint, navigation: NavigationWorld, roomOrigins: Record<string, number[]>, maxHorizontalDistance = 5): RoomAnchoredResolution {
  const candidates: Array<{ room: string; origin: number[]; world: NavPoint; hit: WalkmeshHit }> = [];
  for (const room of navigation.rooms) {
    const origin = roomOrigins[room.room];
    if (!origin || !room.walkableFaces.length) continue;
    const world = { x: -(sourcePosition.x + Number(origin[0] ?? 0)), y: sourcePosition.z + Number(origin[2] ?? 0), z: -(sourcePosition.y + Number(origin[1] ?? 0)) };
    const hit = projectToWalkmesh(world, navigation, { allowedRooms: [room.room], maxHorizontalDistance, maxVerticalDistance: Infinity });
    if (hit) candidates.push({ room: room.room, origin, world: { ...world, y: hit.height }, hit });
  }
  candidates.sort((a, b) => a.hit.horizontalDistance - b.hit.horizontalDistance || a.hit.verticalError - b.hit.verticalError);
  const best = candidates[0];
  const tied = Boolean(best && candidates[1] && Math.abs(best.hit.horizontalDistance - candidates[1].hit.horizontalDistance) < 0.02 && best.room !== candidates[1].room);
  if (!best || tied) {
    // Door anchors can sit just outside walkable BWM faces. Accept only a unique room-bounds
    // candidate inside the caller's distance limit, preserving the source-derived point.
    const bounded: Array<{ room: string; origin: number[]; world: NavPoint; gap: number }> = [];
    for (const room of navigation.rooms) {
      const origin = roomOrigins[room.room]; if (!origin || !room.bounds) continue;
      const world = { x: -(sourcePosition.x + Number(origin[0] ?? 0)), y: sourcePosition.z + Number(origin[2] ?? 0), z: -(sourcePosition.y + Number(origin[1] ?? 0)) };
      const b = room.bounds; const dx = Math.max(b.min.x - world.x, 0, world.x - b.max.x), dz = Math.max(b.min.z - world.z, 0, world.z - b.max.z); const gap = Math.hypot(dx, dz);
      if (gap <= maxHorizontalDistance && world.y >= b.min.y - 4 && world.y <= b.max.y + 4) bounded.push({ room: room.room, origin, world, gap });
    }
    bounded.sort((a, b) => a.gap - b.gap || a.room.localeCompare(b.room));
    const unique = bounded.length === 1 || (bounded.length > 1 && bounded[0].gap + 0.05 < bounded[1].gap);
    if (unique) { const candidate = bounded[0]; return { room: candidate.room, sourcePosition, roomOrigin: candidate.origin, worldPosition: candidate.world, projected: null, confidence: candidate.gap < .05 ? 'MEDIUM' : 'LOW', candidates: bounded.length }; }
    return { room: null, sourcePosition, roomOrigin: null, worldPosition: null, projected: null, confidence: 'UNRESOLVED', candidates: Math.max(candidates.length, bounded.length) };
  }
  return { room: best.room, sourcePosition, roomOrigin: best.origin, worldPosition: best.world, projected: best.hit, confidence: best.hit.horizontalDistance <= 0.1 ? 'HIGH' : best.hit.horizontalDistance <= 2 ? 'MEDIUM' : 'UNRESOLVED', candidates: candidates.length };
}

function numberOrNull(value: any): number | null { const n = Number(value); return Number.isFinite(n) ? n : null; }
function rawFields(item: any): any { return item?.raw_fields ?? item ?? {}; }
function sourcePosition(item: any): NavPoint | null {
  const f = rawFields(item); const x = numberOrNull(f.XPosition ?? f.X); const y = numberOrNull(f.YPosition ?? f.Y); const z = numberOrNull(f.ZPosition ?? f.Z);
  return x === null || y === null || z === null ? null : { x, y, z };
}
function nearestPth(position: NavPoint | null, graph?: AnchorheadPathGraph): { node: number | null; distance: number | null } {
  if (!position || !graph) return { node: null, distance: null };
  let id: number | null = null, distance = Infinity;
  for (const node of graph.nodes) if (node.worldPosition) {
    const d = Math.hypot(node.worldPosition.x - position.x, node.worldPosition.y - position.y, node.worldPosition.z - position.z);
    if (d < distance) { id = node.id; distance = d; }
  }
  return { node: id, distance: Number.isFinite(distance) ? distance : null };
}
function normalizeRows(items: any[], type: string, navigation: NavigationWorld, roomOrigins: Record<string, number[]>, graph?: AnchorheadPathGraph, maxProjection = 5): NormalizedSemantic[] {
  return items.map((item, index) => {
    const f = rawFields(item); const source = sourcePosition(item);
    const resolved = source ? resolveRoomAnchoredPosition(source, navigation, roomOrigins, maxProjection) : null;
    const worldPosition = resolved?.worldPosition ?? null; const pth = nearestPth(worldPosition, graph);
    const orientation = type === 'door' ? { bearingRadians: numberOrNull(f.Bearing), sourceEuler: null }
      : { x: numberOrNull(f.XOrientation), y: numberOrNull(f.YOrientation), z: numberOrNull(f.ZOrientation), bearingRadians: numberOrNull(f.Bearing) };
    return { id: String(item.instance_id ?? `${type}_${String(index).padStart(3,'0')}`), type, resref: String(item.TemplateResRef ?? f.TemplateResRef ?? item.source_resref ?? '') || null, tag: String(item.Tag ?? f.Tag ?? '') || null, room: resolved?.room ?? null, sourcePosition: source ?? { x: NaN, y: NaN, z: NaN }, roomOrigin: resolved?.roomOrigin ?? null, worldPosition, orientation, walkmesh: resolved?.projected ?? null, pthNearestNode: pth.node, pthDistance: pth.distance, source: { confidence: resolved?.confidence ?? 'UNRESOLVED', candidateRooms: resolved?.candidates ?? 0, template: item.template ?? null, rawFields: f } };
  });
}

export function normalizeWaypoints(meta: any, navigation: NavigationWorld, roomOrigins: Record<string, number[]>, graph?: AnchorheadPathGraph) {
  // Waypoint room assignment is intentionally strict: preserve the one source
  // waypoint that sits outside a walkable face instead of snapping it to an edge.
  return normalizeRows(meta?.instances ?? [], 'waypoint', navigation, roomOrigins, graph, 0).map((row, index) => {
    const f = rawFields(meta.instances[index]);
    const x = numberOrNull(f.XOrientation), y = numberOrNull(f.YOrientation);
    return { ...row, tag: row.tag ?? (String(meta.instances[index]?.Tag ?? '') || null), linkedTo: String(meta.instances[index]?.LinkedTo ?? f.LinkedTo ?? '') || null, localizedName: f.LocalizedName ?? null, directionSource: x === null || y === null ? null : { x, y }, directionWorld: x === null || y === null ? null : { x: -x, y: 0, z: -y } };
  });
}

export function normalizeActorSpawns(meta: any, navigation: NavigationWorld, roomOrigins: Record<string, number[]>, graph?: AnchorheadPathGraph) {
  return normalizeRows(meta?.instances ?? [], 'creature', navigation, roomOrigins, graph).map((row, index) => {
    const source = meta.instances[index];
    return { ...row, appearanceRow: source.appearance_row ?? null, appearanceId: source.appearance_id ?? null, appearanceStatus: source.appearance_status ?? 'UNKNOWN' };
  });
}

export function normalizePlaceables(meta: any, navigation: NavigationWorld, roomOrigins: Record<string, number[]>, graph?: AnchorheadPathGraph) {
  return normalizeRows(meta?.instances ?? [], 'placeable', navigation, roomOrigins, graph).map((row, index) => ({ ...row, templateStatus: meta.instances[index]?.template?.status ?? 'UNKNOWN' }));
}

export function normalizeDoors(meta: any, navigation: NavigationWorld, roomOrigins: Record<string, number[]>, graph?: AnchorheadPathGraph) {
  return normalizeRows(meta?.instances ?? [], 'door', navigation, roomOrigins, graph, 0).map((row, index) => {
    const item = meta.instances[index], f = rawFields(item);
    const module = String(item.LinkedToModule ?? f.LinkedToModule ?? '').trim();
    const linked = String(item.LinkedTo ?? f.LinkedTo ?? '').trim();
    const destination = String(item.TransitionDestin ?? f.TransitionDestin ?? '').trim();
    const staticFlag = Number(item.template?.Static ?? f.Static ?? 0) === 1;
    const semantic = module ? 'MODULE_TRANSITION' : linked || (destination && destination !== '-1') ? 'ROOM_TRANSITION' : 'STATIC/UNKNOWN';
    const bearing = numberOrNull(item.Bearing ?? f.Bearing);
    const worldForward = bearing === null ? null : { x: -Math.cos(bearing), y: 0, z: Math.sin(bearing) };
    // Static/unknown doors had no reliable room mapping in the source audit.
    // Do not assign a room via nearby bounds or invent a transition.
    const keepSpatialResolution = semantic === 'MODULE_TRANSITION' && row.walkmesh !== null;
    return { ...row,
      room: keepSpatialResolution ? row.room : null,
      roomOrigin: keepSpatialResolution ? row.roomOrigin : null,
      worldPosition: keepSpatialResolution ? row.worldPosition : null,
      walkmesh: keepSpatialResolution ? row.walkmesh : null,
      pthNearestNode: keepSpatialResolution ? row.pthNearestNode : null,
      pthDistance: keepSpatialResolution ? row.pthDistance : null,
      source: { ...row.source, confidence: keepSpatialResolution ? row.source.confidence : 'UNRESOLVED' },
      linkedTo: linked || null, linkedToModule: module || null, transitionDestination: destination && destination !== '-1' ? destination : null, semantic, static: staticFlag, worldForward, roomOnSides: null, nearestDoorHook: null, hookAlignment: 'AMBIGUOUS_NOT_INFERRED' };
  });
}

export function normalizeTriggers(meta: any, navigation: NavigationWorld, roomOrigins: Record<string, number[]>, graph?: AnchorheadPathGraph) {
  return normalizeRows(meta?.instances ?? [], 'trigger', navigation, roomOrigins, graph, 8).map((row, index) => {
    const item = meta.instances[index], f = rawFields(item); const resolution = row.room && row.roomOrigin ? row : null;
    const source = row.sourcePosition, origin = row.roomOrigin;
    const base = source && origin ? { x: -(source.x + Number(origin[0] ?? 0)), y: source.z + Number(origin[2] ?? 0), z: -(source.y + Number(origin[1] ?? 0)) } : null;
    const points = (item.geometry ?? []).map((vertex: any) => {
      const lx = Number(vertex.PointX ?? vertex.x ?? 0), ly = Number(vertex.PointY ?? vertex.y ?? 0), lz = Number(vertex.PointZ ?? vertex.z ?? 0);
      if (!base) return null;
      return { x: base.x - lx, y: base.y + lz, z: base.z - ly };
    }).filter(Boolean) as NavPoint[];
    const bounds = points.length ? { min: { x: Math.min(...points.map(p=>p.x)), y: Math.min(...points.map(p=>p.y)), z: Math.min(...points.map(p=>p.z)) }, max: { x: Math.max(...points.map(p=>p.x)), y: Math.max(...points.map(p=>p.y)), z: Math.max(...points.map(p=>p.z)) } } : null;
    return { ...row, shape: 'POLYGON', geometrySourceLocal: item.geometry ?? [], worldVertices: points, bounds, possibleSemanticType: 'UNKNOWN', scriptExecution: 'NOT_EXECUTED', transformNote: 'Preserved raw GIT orientation; local XY polygon converted through room origin and Babylon axis mapping.' };
  });
}

export function classifySpawnCandidates(waypoints: any[], doors: any[]) {
  const rows = [
    ...waypoints.map((row) => ({ id: row.id, sourceType: 'WAYPOINT', tag: row.tag, room: row.room, position: row.worldPosition, confidence: /spawn|start|entry|exit|arrival|transition/i.test(`${row.tag ?? ''} ${row.resref ?? ''}`) ? 'MEDIUM' : 'LOW', evidence: ['KOTOR waypoint semantic name; not selected as player spawn'] })),
    ...doors.filter((row) => row.semantic === 'MODULE_TRANSITION' || row.semantic === 'ROOM_TRANSITION').map((row) => ({ id: row.id, sourceType: 'DOOR', tag: row.tag, room: row.room, position: row.worldPosition, confidence: 'MEDIUM', evidence: ['GIT linked destination fields; not selected as player spawn'] })),
  ];
  return rows;
}

