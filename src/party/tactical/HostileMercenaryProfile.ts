export type HostileMercenaryProfile = {
  id: 'HOSTILE_MERCENARY_JKA_V1';
  displayName: string;
  faction: 'HOSTILE';
  assetPath: string;
  expectedAssetSha256: string;
  sourceDonor: string;
  sourceFiles: string[];
  targetHeightM: number;
  initialHealth: number;
  nativeRig: string;
  jointCount: number;
  groups: {
    idle: string;
    walk: string;
    run: string;
    weaponReady: string;
    fire: string;
    pain: string;
    death: string;
  };
  weapon: {
    name: string;
    assetPath: string;
    sourceModel: string;
    sha256: string;
    socket: string;
    axis: 'NEGATIVE_X' | 'POSITIVE_X' | 'UNKNOWN';
    muzzleTag: string;
    muzzleLocalPosition: [number, number, number];
    localForward: [number, number, number];
    firingImplemented: boolean;
    projectileSpeedMps: number;
    damage: number;
    maxLifetimeSeconds: number;
    maxDistanceM: number;
    fireReleaseFrame: number;
    fireAnimationStartFrame: number;
    fireAnimationFrameCount: number;
    fireAnimationFps: number;
    fireFacingToleranceDeg: number;
  };
};

/** Source-backed Rodian2 native JKA enemy profile. Gameplay remains actor-generic. */
export const HOSTILE_MERCENARY_JKA_V1: HostileMercenaryProfile = {
  id: 'HOSTILE_MERCENARY_JKA_V1',
  displayName: 'Rodian Mercenary',
  faction: 'HOSTILE',
  assetPath: '/_lab/jka/characters/enemies/rodian/hostile_mercenary_jka_v1.glb',
  expectedAssetSha256: 'f084310ebcbc52015e2abca6921cf1eec39150a032a913f247881a97b9c4df42',
  sourceDonor: 'JEDI ACADEMY RODIAN2 / CLASS_RODIAN',
  sourceFiles: [
    'assets1.pk3::models/players/rodian/model.glm',
    'assets1.pk3::models/players/rodian/model_default.skin',
    'assets1.pk3::models/players/_humanoid/_humanoid.gla',
    'assets1.pk3::ext_data/npcs/rodian.npc',
    'assets1.pk3::botfiles/rodian.jkb',
  ],
  targetHeightM: 1.72,
  initialHealth: 20,
  nativeRig: '_humanoid.gla',
  jointCount: 53,
  groups: {
    idle: 'BOTH_STAND1IDLE1',
    walk: 'BOTH_WALK1',
    run: 'BOTH_RUN1',
    weaponReady: 'TORSO_WEAPONREADY10',
    fire: 'BOTH_ATTACK10',
    pain: 'BOTH_PAIN1',
    death: 'BOTH_DEATH1',
  },
  weapon: {
    name: 'JKA_RODIAN_BLASTER_V1',
    assetPath: '/_lab/jka/weapons/blaster/jka_rodian_blaster_v1.glb',
    sourceModel: 'assets1.pk3::models/weapons2/blaster_r/blaster_w.glm (WP_BLASTER)',
    sha256: '237fc2ea7b77f1fb30bb914f2581027867299c6591482d0ca79035b51dab05d2',
    socket: 'rhand_tag_bone',
    axis: 'UNKNOWN',
    muzzleTag: 'SOURCE_GEOMETRY_*flash_0',
    muzzleLocalPosition: [0, 0, 0],
    localForward: [0, 0, 1],
    firingImplemented: true,
    projectileSpeedMps: 23,
    damage: 10,
    maxLifetimeSeconds: 3.0,
    maxDistanceM: 70,
    fireReleaseFrame: 1548,
    fireAnimationStartFrame: 1541,
    fireAnimationFrameCount: 20,
    fireAnimationFps: 10,
    fireFacingToleranceDeg: 12,
  },
};
