/** W225.1 staged service-dock replacement. Firefly scale is frozen from W225. */
export const W225_1_PROMOTED = true;
export const W225_1_STAGING_ASSETS = '/docs/_audit_codex/w225_1_staging/assets/';
export const W225_1_PRODUCTION_SERVICE_DOCK = '/assets/environments/tatooine/spaceport/service_dock.glb';
export const W225_1_DOCK_SCALE = 0.30;
export const W225_1_DOCK_FOOTPRINT = { width: 42.8, depth: 37.8 } as const;
export const W225_1_PADS = [
  { id: 'A', x: -68, z: -18, rotationY: 0, occupied: true, shipId: 'firefly', futureRole: 'arrival', npcSpawnPoints: [[-63, 0, -10]], cargoSpawnPoints: [[-75, 0, -5]], questAnchor: [-68, 0, -2] },
  { id: 'B', x: 0, z: -18, rotationY: 0, occupied: false, shipId: null, futureRole: 'service', npcSpawnPoints: [[5, 0, -10]], cargoSpawnPoints: [[-7, 0, -5]], questAnchor: [0, 0, -2] },
  { id: 'C', x: 68, z: -18, rotationY: 0, occupied: false, shipId: null, futureRole: 'quest', npcSpawnPoints: [[73, 0, -10]], cargoSpawnPoints: [[61, 0, -5]], questAnchor: [68, 0, -2] },
] as const;
export const W225_1_ARRIVAL_SPAWN = { x: -76, y: 0, z: -10, facingYaw: Math.PI } as const;
export const W225_1_RETURN_SPAWN = { x: 0, y: 0, z: 83, facingYaw: Math.PI } as const;
