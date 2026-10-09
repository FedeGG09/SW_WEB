/** W225 measured layout. One imported module is cloned twice at runtime. */
export const W225_PROMOTED = true;
export const W225_STAGING_ASSETS = '/docs/_audit_codex/w225_staging/assets/';
export const W225_PRODUCTION_SPACEPORT = '/assets/environments/tatooine/spaceport/spaceport.glb';
export const W225_PRODUCTION_FIREFLY = '/assets/ships/firefly/firefly_exterior.glb';
export const W225_PAD_SCALE = 0.8;
export const W225_PAD_FLOOR_Y = 4.730 * W225_PAD_SCALE;
export const W225_FIREFLY_SCALE = 0.16;
export const W225_PADS = [
  { id: 'A', x: -45, z: -18, occupied: true, shipId: 'firefly', npcSpawnPoints: [[-45, 0, 38]], questAnchor: [-45, 0, 26], cargoSpawnPoints: [[-53, 0, 39]] },
  { id: 'B', x: 0, z: -18, occupied: false, npcSpawnPoints: [[0, 0, 38]], questAnchor: [0, 0, 26], cargoSpawnPoints: [[8, 0, 39]] },
  { id: 'C', x: 45, z: -18, occupied: false, npcSpawnPoints: [[45, 0, 38]], questAnchor: [45, 0, 26], cargoSpawnPoints: [[53, 0, 39]] },
] as const;
