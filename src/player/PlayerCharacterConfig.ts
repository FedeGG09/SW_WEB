/**
 * Central player-character asset selection.
 *
 * Aren Vey is now the default playable protagonist.
 * The Ithorian prototype is intentionally preserved as an alternate character
 * so it can be brought back later without moving, renaming or deleting assets.
 */
export type PlayerCharacterId = 'aren' | 'aren-jka-prototype' | 'aren-native-jka-v1' | 'aren-caleb-jka-candidate' | 'nara-native-jka-v1' | 'ithorian' | 'jolee' | 'nara-original' | 'nara-belaya' | 'nara-meetra-jka-candidate';

/** Exact source clip names for donor characters. Omitted profiles keep the
 * legacy authored-asset resolver used by Aren and the preserved prototype. */
export type ExactLocomotionProfile = {
  idle?: string;
  walk: string;
  run: string;
  backward?: string;
  strafeLeft?: string;
  strafeRight?: string;
  source?: string;
  /** Source-backed non-combat pose used during peaceful exploration when the authored idle is combat-like. */
  peacefulIdle?: string;
  sourceSupermodelByClip?: Record<string, string>;
};

export type JkaLeaderCombatProfile = {
  groups: {
    forwardWalk: string;
    forwardRun: string;
    backwardWalk: string;
    backwardRun?: string;
    strafeLeft: string;
    strafeRight: string;
    saberReady: string;
    attackStart: string;
    attack: string;
    attackReturn: string;
    comboTransition?: string;
    comboAttack?: string;
    comboReturn?: string;
    /** DEV-only native JKA block/parry response clip, if the asset carries one. */
    parryResponse?: string;
    /** DEV-only native JKA directional response clips selected after physical contact. */
    parryResponses?: Partial<Record<'TOP' | 'TOP_LEFT' | 'TOP_RIGHT' | 'BOTTOM_LEFT' | 'BOTTOM_RIGHT', string>>;
  };
  sourceSymbols: Record<string, string>;
  sourceFps: Record<string, number>;
  saberAttachmentNode: string;
};

export type JkaCharacterLabPreviewProfile = {
  groups: Pick<JkaLeaderCombatProfile['groups'], 'forwardWalk' | 'forwardRun' | 'backwardWalk' | 'backwardRun' | 'strafeLeft' | 'strafeRight' | 'saberReady'>;
};

/** Reversible character-local weapon fit; translation is in socket-parent axes, in metres. */
export type WeaponPresentationProfile = {
  translationM: readonly [number, number, number];
  rotationEulerDeg: readonly [number, number, number];
};

const JKA_DONOR_COMBAT_PROFILE: JkaLeaderCombatProfile = {
  groups: {
    forwardWalk: 'BOTH_WALK1', forwardRun: 'BOTH_RUN1',
    backwardWalk: 'BOTH_WALKBACK1', backwardRun: 'BOTH_RUNBACK1',
    strafeLeft: 'BOTH_STRAFE_LEFT1', strafeRight: 'BOTH_STRAFE_RIGHT1',
    saberReady: 'BOTH_SABERFAST_STANCE', attackStart: 'BOTH_S1_S1_T_',
    attack: 'BOTH_A1_T__B_', attackReturn: 'BOTH_R1_B__S1',
  },
  sourceSymbols: {
    idle: 'BOTH_STAND1', forwardWalk: 'BOTH_WALK1', forwardRun: 'BOTH_RUN1',
    backwardWalk: 'BOTH_WALKBACK1', backwardRun: 'BOTH_RUNBACK1',
    strafeLeft: 'BOTH_STRAFE_LEFT1', strafeRight: 'BOTH_STRAFE_RIGHT1',
    saberReady: 'BOTH_SABERFAST_STANCE', attackStart: 'BOTH_S1_S1_T_',
    attack: 'BOTH_A1_T__B_', attackReturn: 'BOTH_R1_B__S1',
  },
  sourceFps: { attackStart: 20, attack: 30, attackReturn: 30 },
  saberAttachmentNode: 'rhang_tag_bone',
};

const JKA_DONOR_LOCOMOTION: ExactLocomotionProfile = {
  idle: 'BOTH_STAND1', walk: 'BOTH_WALK1', run: 'BOTH_RUN1',
  backward: 'BOTH_WALKBACK1', strafeLeft: 'BOTH_STRAFE_LEFT1', strafeRight: 'BOTH_STRAFE_RIGHT1',
  source: 'W237.2D.1 selected JKA _humanoid.gla clips; exact NLA animation names; no retarget.',
};

export type PlayerCharacterConfig = {
  id: PlayerCharacterId;
  displayName: string;
  assetPath: string;
  expectedAssetSha256?: string;
  loadingMessage: string;
  labReadyMessage: string;
  targetHeightM: number;
  /** Reversible runtime-only vertical calibration for the visual root; navigation/collision stay at the floor anchor. */
  runtimeVisualGroundOffsetM?: number;
  /** Source identity and reversible DEV presentation variant provenance. */
  sourceCharacter?: string;
  runtimeRole?: string;
  /** Native JKA presentation profile; combat remains role-specific. */
  nativeJkaRig?: boolean;
  assetVariant?: string;
  provenance?: string;
  exactLocomotion?: ExactLocomotionProfile;
  leaderCombatProfile?: JkaLeaderCombatProfile;
  /** Native JKA saber socket correction; kept separate from the legacy generic weapon path. */
  nativeJkaWeaponPresentation?: WeaponPresentationProfile;
  weaponPresentation?: WeaponPresentationProfile;
  /** DEV Character Lab only; does not grant leader combat behavior to a party follower. */
  characterLabJkaPreviewProfile?: JkaCharacterLabPreviewProfile;
  weaponAttachmentNode?: string;
  semanticClips?: {
    saberIdle?: string;
    saberReady?: string;
    saberWalk?: string;
    saberRun?: string;
    attacks?: string[];
    parries?: string[];
    deflects?: string[];
    hits?: string[];
    force?: string[];
    death?: string;
  };
};

export const PLAYER_CHARACTERS: Record<
  PlayerCharacterId,
  PlayerCharacterConfig
> = {
  aren: {
    id: 'aren',
    displayName: 'Aren Vey',
    assetPath: '/assets/characters/player/aren_vey_human_v1.glb',
    expectedAssetSha256: '79073f978c889e268e77800dbf7a2d609ec40a2bb314100447ce458f8d8a7ba4',
    loadingMessage: 'Loading Aren Vey...',
    labReadyMessage: 'Aren Human Character Lab ready',
    targetHeightM: 1.8,
    exactLocomotion: {
      idle: 'idle_v2',
      walk: 'walk_forward_v2',
      run: 'run_forward_v2',
      source: 'Protected Aren GLB; SHA-256 verified; exact named clips animate all 68 joints including pelvis and both leg chains.',
    },
  },

  'aren-jka-prototype': {
    id: 'aren-jka-prototype',
    displayName: 'Aren Vey · native Jedi Academy prototype V0',
    assetPath: '/_lab/jka/characters/aren/aren_jka_prototype_v0.glb',
    expectedAssetSha256: 'c6b3766d8bbb01a182b918c2161b64a0a3e0ddefb35249dc8118fb1eb6f97bca',
    loadingMessage: 'Loading native Jedi Academy Aren prototype...',
    labReadyMessage: 'Native JKA Aren DEV Character Lab ready',
    targetHeightM: 1.8,
    runtimeVisualGroundOffsetM: 0.655, // Skinned vertices measured 0.6343 m below WOK before calibration; retain 0.02 m sole clearance.
    sourceCharacter: 'JKA PLAYER MODEL: models/players/jedi/model.glm',
    runtimeRole: 'AREN_LEADER',
    nativeJkaRig: true,
    assetVariant: 'AREN_JKA_PROTOTYPE_V0',
    provenance: 'Temporary native Jedi Academy player donor; shared _humanoid.gla skeleton; 11 selected source clips; original protected Aren GLB remains canonical.',
    exactLocomotion: {
      idle: 'JKA_IDLE',
      walk: 'JKA_WALK_FORWARD',
      run: 'JKA_RUN_FORWARD',
      backward: 'JKA_WALK_BACKWARD',
      strafeLeft: 'JKA_STRAFE_LEFT',
      strafeRight: 'JKA_STRAFE_RIGHT',
      source: 'Native JKA _humanoid.gla ranges imported by Blender Jedi Academy Tools 2.1.0; exact glTF action names.',
    },
    leaderCombatProfile: {
      groups: {
        forwardWalk: 'JKA_WALK_FORWARD',
        forwardRun: 'JKA_RUN_FORWARD',
        backwardWalk: 'JKA_WALK_BACKWARD',
        backwardRun: 'JKA_RUN_BACKWARD',
        strafeLeft: 'JKA_STRAFE_LEFT',
        strafeRight: 'JKA_STRAFE_RIGHT',
        saberReady: 'JKA_SABER_READY',
        attackStart: 'JKA_ATTACK_START',
        attack: 'JKA_ATTACK',
        attackReturn: 'JKA_ATTACK_RETURN',
      },
      sourceSymbols: {
        idle: 'BOTH_STAND1',
        forwardWalk: 'BOTH_WALK1',
        forwardRun: 'BOTH_RUN1',
        backwardWalk: 'BOTH_WALKBACK1',
        backwardRun: 'BOTH_RUNBACK1',
        strafeLeft: 'BOTH_STRAFE_LEFT1',
        strafeRight: 'BOTH_STRAFE_RIGHT1',
        saberReady: 'BOTH_SABERFAST_STANCE',
        attackStart: 'BOTH_S1_S1_T_',
        attack: 'BOTH_A1_T__B_',
        attackReturn: 'BOTH_R1_B__S1',
      },
      sourceFps: {
        attackStart: 20,
        attack: 30,
        attackReturn: 30,
      },
      saberAttachmentNode: 'rhang_tag_bone',
    },
  },

  'aren-native-jka-v1': {
    id: 'aren-native-jka-v1',
    displayName: 'Aren · Rosh Penin native JKA V1',
    assetPath: '/_lab/jka/characters/aren/aren_native_jka_v1.glb',
    expectedAssetSha256: '8b5c958621d6050ce268accc08f15d664dd6e398ffdcf1dd61486925329b9b58',
    loadingMessage: 'Loading native JKA Rosh-based Aren...',
    labReadyMessage: 'Native JKA Aren V1 Character Lab ready',
    targetHeightM: 1.8,
    runtimeVisualGroundOffsetM: 0.676, // WOK-relative talus-weighted boot samples: worst pose -0.6654 m, minimum sole clearance +0.0106 m.
    weaponPresentation: {
      // Legacy generic-saber fit only. Native JKA saber attachment bypasses this field.
      translationM: [0.008, 0, -0.006],
      rotationEulerDeg: [0, 0, 0],
    },
    nativeJkaWeaponPresentation: {
      // W237.2E.A4: user-approved Rosh-only native JKA saber grip.
      translationM: [0.04, 0, 0],
      rotationEulerDeg: [0, 5, 80],
    },
    sourceCharacter: 'JKA VANILLA: models/players/rosh_penin/model.glm',
    runtimeRole: 'AREN_LEADER',
    assetVariant: 'AREN_NATIVE_JKA_V1',
    nativeJkaRig: true,
    provenance: 'Vanilla Jedi Academy Rosh Penin model_default skin; native shared humanoid rig; no retarget; local prototype pending distribution rights review.',
    exactLocomotion: {
      idle: 'JKA_IDLE', walk: 'JKA_WALK_FORWARD', run: 'JKA_RUN_FORWARD',
      backward: 'JKA_WALK_BACKWARD', strafeLeft: 'JKA_STRAFE_LEFT', strafeRight: 'JKA_STRAFE_RIGHT',
      source: 'W237.2D.4 selected vanilla JKA clips; exact names; native rig; no retarget.',
    },
    leaderCombatProfile: {
      groups: {
        forwardWalk: 'JKA_WALK_FORWARD', forwardRun: 'JKA_RUN_FORWARD',
        backwardWalk: 'JKA_WALK_BACKWARD',
        strafeLeft: 'JKA_STRAFE_LEFT', strafeRight: 'JKA_STRAFE_RIGHT',
        saberReady: 'JKA_SABER_READY', attackStart: 'JKA_ATTACK_START',
        attack: 'JKA_ATTACK', attackReturn: 'JKA_ATTACK_RETURN',
      },
      sourceSymbols: {
        idle: 'BOTH_STAND1', forwardWalk: 'BOTH_WALK1', forwardRun: 'BOTH_RUN1',
        backwardWalk: 'BOTH_WALKBACK1', backwardRun: 'BOTH_RUNBACK1',
        strafeLeft: 'BOTH_STRAFE_LEFT1', strafeRight: 'BOTH_STRAFE_RIGHT1',
        saberReady: 'BOTH_SABERFAST_STANCE', attackStart: 'BOTH_S1_S1_T_',
        attack: 'BOTH_A1_T__B_', attackReturn: 'BOTH_R1_B__S1',
      },
      sourceFps: { attackStart: 20, attack: 30, attackReturn: 30 },
      saberAttachmentNode: 'rhang_tag_bone',
    },
  },
  'aren-caleb-jka-candidate': {
    id: 'aren-caleb-jka-candidate',
    displayName: 'Caleb Dume · JKA donor candidate V0',
    assetPath: '/_lab/jka/characters/aren/aren_caleb_jka_candidate_v0.glb',
    expectedAssetSha256: '06681468976eb7ea4e53bb692bbcfbedaed0304ae23166b6117917103cd48215',
    loadingMessage: 'Loading Caleb Dume JKA donor candidate...',
    labReadyMessage: 'Caleb Dume native JKA donor Character Lab ready',
    targetHeightM: 1.8,
    sourceCharacter: 'CALEB_DUME',
    runtimeRole: 'AREN_CANDIDATE',
    assetVariant: 'AREN_CALEB_JKA_CANDIDATE',
    provenance: 'Local research candidate from caleb_dume_v1.1; original mod sources preserved; selected robed skin; JKA standard _humanoid.gla; not production-cleared.',
    exactLocomotion: JKA_DONOR_LOCOMOTION,
    leaderCombatProfile: JKA_DONOR_COMBAT_PROFILE,
    weaponAttachmentNode: 'rhang_tag_bone',
  },

  ithorian: {
    id: 'ithorian',
    displayName: 'Ithorian prototype',
    assetPath: '/assets/characters/player/ithorian_combat_v1.glb',
    loadingMessage: 'Loading preserved Ithorian prototype...',
    labReadyMessage: 'Ithorian Character Lab ready',
    targetHeightM: 1.8,
  },

  jolee: {
    id: 'jolee',
    displayName: 'Jolee Bindo',
    assetPath: '/_lab/kotor/characters/jolee/jolee_bindo_kotor1.glb',
    loadingMessage: 'Loading Jolee Bindo...',
    labReadyMessage: 'Jolee Bindo Character Lab ready',
    targetHeightM: 1.8,
    exactLocomotion: {
      idle: 'pause1',
      // The source semantic profile resolves walking to walkss (2DA row 338)
      // for Jolee's validated single-saber style. The generic `walk` clip is
      // retained in the lab for comparison but its frozen mid-cycle sample
      // presents a seated/crouched pose in the Babylon export.
      walk: 'walkss',
      run: 'runss',
      source: 'docs/_audit_codex/w231_4_jedi_semantics.json + jolee_animation_catalog.json; exact KOTOR 2DA row flags, winning source, and Babylon locomotion review',
      sourceSupermodelByClip: {
        pause1: 'P_JoleeBB',
        walkss: 'S_Male02',
        run: 'S_Male02',
      },
    },
    semanticClips: {
      saberIdle: 'g2r1',
      saberReady: 'g2r1',
      saberWalk: 'walkss',
      saberRun: 'runss',
      attacks: ['c2a1', 'c2a2', 'c2a3', 'f2a1', 'f2a2', 'f2a3'],
      parries: ['c2p1', 'f2p1'],
      deflects: ['c2n1', 'c2n2'],
      hits: ['c2d1', 'f2d1'],
      force: ['castout1', 'castout2', 'castout3'],
      death: 'die',
    },
  },

  'nara-original': {
    id: 'nara-original',
    displayName: 'Nara Voss · original',
    assetPath: '/assets/characters/nara/nara_voss_twilek_v1.glb',
    loadingMessage: 'Loading original Nara Voss...',
    labReadyMessage: 'Original Nara DEV profile ready',
    targetHeightM: 1.8,
    sourceCharacter: 'NARA_ORIGINAL',
    runtimeRole: 'NARA',
    assetVariant: 'nara_original_protected',
    provenance: 'Existing protected Nerathis Nara asset; SHA256 verified by W236.6.',
  },

  'nara-belaya': {
    id: 'nara-belaya',
    displayName: 'Nara role · Belaya KOTOR I donor',
    assetPath: '/_lab/kotor/characters/belaya/belaya_kotor1_donor.glb',
    loadingMessage: 'Loading Belaya vanilla donor as Nara role...',
    labReadyMessage: 'Belaya KOTOR I donor profile ready as Nara',
    targetHeightM: 1.8,
    sourceCharacter: 'BELAYA',
    runtimeRole: 'NARA',
    assetVariant: 'belaya_kotor1_donor_vanilla',
    provenance: 'KOTOR I UTC dan13_belaya → appearance.2da → active PFBIM body + comm_w_f head; no Nara reskin applied.',
    exactLocomotion: {
      idle: 'pause1', walk: 'walk', run: 'run',
      source: 'belaya_animation_catalog.json + animations.2da / combatanimations.2da exact semantics.',
      sourceSupermodelByClip: {
        pause1: 'S_Female03', walk: 'S_Male02', run: 'S_Female03',
        walkss: 'S_Female03', runss: 'S_Male02', g2r1: 'S_Female03',
        c2a1: 'S_Female03', c2a2: 'S_Female03', c2a3: 'S_Female03',
        c2p1: 'S_Female03', c2n1: 'S_Female03', talk: 'S_Female03', die: 'S_Female03',
      },
    },
    semanticClips: {
      saberIdle: 'g2r1', saberReady: 'g2r1', saberWalk: 'walkss', saberRun: 'runss',
      attacks: ['c2a1','c2a2','c2a3','c2a4','c2a5','c2a6','f2a1','f2a2','f2a3','f2a4'],
      parries: ['c2p1','c2p2','c2p3','c2p4','c2p5','f2p1','f2p2','f2p3'],
      deflects: ['c2n1','c2n2'], hits: ['c2d1','f2d1'],
      force: ['castout1','castout2','castout3'], death: 'die',
    },
  },

  'nara-native-jka-v1': {
    id: 'nara-native-jka-v1',
    displayName: 'Nara · Jan Ors native JKA V1',
    assetPath: '/_lab/jka/characters/nara/nara_native_jka_v1_combat_v1.glb',
    expectedAssetSha256: '3b887077dade1a00d1b681c4847d0760e8efdaee0831ac91ba66759e99c80148',
    loadingMessage: 'Loading native JKA Jan-based Nara...',
    labReadyMessage: 'Native JKA Nara V1 Character Lab ready',
    targetHeightM: 1.8,
    runtimeVisualGroundOffsetM: 0.652, // WOK-relative talus-weighted boot samples: worst pose -0.6411 m, minimum sole clearance +0.0109 m.
    sourceCharacter: 'JKA VANILLA: models/players/jan/model.glm',
    runtimeRole: 'NARA_COMPANION',
    assetVariant: 'NARA_NATIVE_JKA_V1',
    nativeJkaRig: true,
    nativeJkaWeaponPresentation: {
      // W237.2F.4 addendum: start from the certified Aren/Rosh native-JKA
      // presentation as a Nara-only candidate. Keep this profile-scoped so a
      // later Jan visual review can make a small independent adjustment.
      translationM: [0.04, 0, 0],
      rotationEulerDeg: [0, 5, 80],
    },
    provenance: 'Vanilla Jedi Academy Jan Ors model_default skin; native shared humanoid rig; tactical companion authority remains KOTOR/XCOM; local prototype pending distribution rights review.',
    exactLocomotion: {
      idle: 'JKA_IDLE', walk: 'JKA_WALK_FORWARD', run: 'JKA_RUN_FORWARD',
      // Source-backed exploration idle: BOTH_STAND1. JKA_SABER_READY is
      // BOTH_SABERFAST_STANCE and is reserved for explicit combat readiness.
      peacefulIdle: 'JKA_IDLE',
      backward: 'JKA_WALK_BACKWARD', strafeLeft: 'JKA_STRAFE_LEFT', strafeRight: 'JKA_STRAFE_RIGHT',
      source: 'W237.2D.4 selected vanilla JKA clips; exact names; native rig; no retarget.',
    },
    characterLabJkaPreviewProfile: {
      groups: {
        forwardWalk: 'JKA_WALK_FORWARD', forwardRun: 'JKA_RUN_FORWARD',
        backwardWalk: 'JKA_WALK_BACKWARD',
        strafeLeft: 'JKA_STRAFE_LEFT', strafeRight: 'JKA_STRAFE_RIGHT',
        saberReady: 'JKA_SABER_READY',
      },
    },
    leaderCombatProfile: {
      groups: {
        forwardWalk: 'JKA_WALK_FORWARD',
        forwardRun: 'JKA_RUN_FORWARD',
        backwardWalk: 'JKA_WALK_BACKWARD',
        strafeLeft: 'JKA_STRAFE_LEFT',
        strafeRight: 'JKA_STRAFE_RIGHT',
        saberReady: 'JKA_SABER_READY',
        attackStart: 'JKA_ATTACK_START',
        attack: 'JKA_ATTACK',
        attackReturn: 'JKA_ATTACK_RETURN',
        parryResponses: {
          TOP: 'JKA_PARRY_TOP',
          TOP_LEFT: 'JKA_PARRY_TOP_LEFT',
          TOP_RIGHT: 'JKA_PARRY_TOP_RIGHT',
          BOTTOM_LEFT: 'JKA_PARRY_BOTTOM_LEFT',
          BOTTOM_RIGHT: 'JKA_PARRY_BOTTOM_RIGHT',
        },
      },
      sourceSymbols: {
        idle: 'BOTH_STAND1',
        forwardWalk: 'BOTH_WALK1',
        forwardRun: 'BOTH_RUN1',
        backwardWalk: 'BOTH_WALKBACK1',
        strafeLeft: 'BOTH_STRAFE_LEFT1',
        strafeRight: 'BOTH_STRAFE_RIGHT1',
        saberReady: 'BOTH_SABERFAST_STANCE',
        attackStart: 'BOTH_S1_S1_T_',
        attack: 'BOTH_A1_T__B_',
        attackReturn: 'BOTH_R1_B__S1',
        parryTop: 'BOTH_P1_S1_T_',
        parryTopLeft: 'BOTH_P1_S1_TL',
        parryTopRight: 'BOTH_P1_S1_TR',
        parryBottomLeft: 'BOTH_P1_S1_BL',
        parryBottomRight: 'BOTH_P1_S1_BR',
      },
      sourceFps: {
        attackStart: 20,
        attack: 30,
        attackReturn: 30,
        parryTop: 20,
        parryTopLeft: 20,
        parryTopRight: 20,
        parryBottomLeft: 20,
        parryBottomRight: 20,
      },
      saberAttachmentNode: 'rhang_tag_bone',
    },
    weaponAttachmentNode: 'rhang_tag_bone',
  },
  'nara-meetra-jka-candidate': {
    id: 'nara-meetra-jka-candidate',
    displayName: 'Meetra Surik · JKA donor candidate V0',
    assetPath: '/_lab/jka/characters/nara/nara_meetra_jka_candidate_v0.glb',
    expectedAssetSha256: '6f0c1da82fb569ad4a2f0d014ce8336e21f6b1d77fcfbb41bc0d1c7b51150f32',
    loadingMessage: 'Loading Meetra Surik JKA donor candidate...',
    labReadyMessage: 'Meetra Surik native JKA follower donor Character Lab ready',
    targetHeightM: 1.8,
    sourceCharacter: 'MEETRA_SURIK',
    runtimeRole: 'NARA_CANDIDATE',
    assetVariant: 'NARA_MEETRA_JKA_CANDIDATE',
    provenance: 'Local research candidate from Meetra_Surik.pk3 standard model.glm + default skin; shared JKA _humanoid.gla; model_sp.glm left out; not production-cleared.',
    exactLocomotion: JKA_DONOR_LOCOMOTION,
    characterLabJkaPreviewProfile: {
      groups: {
        forwardWalk: 'BOTH_WALK1', forwardRun: 'BOTH_RUN1',
        backwardWalk: 'BOTH_WALKBACK1', backwardRun: 'BOTH_RUNBACK1',
        strafeLeft: 'BOTH_STRAFE_LEFT1', strafeRight: 'BOTH_STRAFE_RIGHT1',
        saberReady: 'BOTH_SABERFAST_STANCE',
      },
    },
    weaponAttachmentNode: 'rhang_tag_bone',
  },
};

export const DEFAULT_PLAYER_CHARACTER_ID: PlayerCharacterId =
  'aren';

export const DEFAULT_PLAYER_CHARACTER =
  PLAYER_CHARACTERS[DEFAULT_PLAYER_CHARACTER_ID];

/**
 * Optional development override:
 *   ?player=aren
 *   ?player=ithorian
 *   ?player=jolee (DEV character lab / KOTOR world labs only)
 *
 * Invalid or absent values always fall back to Aren.
 */
export function resolvePlayerCharacter(
  search: URLSearchParams,
): PlayerCharacterConfig {
  const requested = (search.get('playable') ?? search.get('player') ?? '').toLowerCase();

  if (import.meta.env.DEV && requested === 'aren-native-jka-v1') return PLAYER_CHARACTERS['aren-native-jka-v1'];

  if (import.meta.env.DEV && requested === 'nara-native-jka-v1') return PLAYER_CHARACTERS['nara-native-jka-v1'];

  if (import.meta.env.DEV && requested === 'aren-jka-prototype') {
    return PLAYER_CHARACTERS['aren-jka-prototype'];
  }

  if (import.meta.env.DEV && requested === 'aren-caleb-jka-candidate') {
    return PLAYER_CHARACTERS['aren-caleb-jka-candidate'];
  }

  if (import.meta.env.DEV && requested === 'nara-meetra-jka-candidate') {
    return PLAYER_CHARACTERS['nara-meetra-jka-candidate'];
  }

  if (requested === 'ithorian') {
    return PLAYER_CHARACTERS.ithorian;
  }

  if (requested === 'aren') {
    return PLAYER_CHARACTERS.aren;
  }

  if (requested === 'jolee' && import.meta.env.DEV) {
    return PLAYER_CHARACTERS.jolee;
  }

  if (import.meta.env.DEV) {
    const naraVariant = (search.get('naraVariant') ?? '').toLowerCase();
    if (requested === 'nara-belaya' || (requested === 'nara' && ['belaya', 'donor', 'belaya-donor'].includes(naraVariant))) {
      return PLAYER_CHARACTERS['nara-belaya'];
    }
    if (requested === 'nara' || requested === 'nara-original') {
      return PLAYER_CHARACTERS['nara-original'];
    }
  }

  return DEFAULT_PLAYER_CHARACTER;
}



