import type { TatooineSceneId } from './TatooineCatalog';

/** W224 actor library. Files in tatooine2 remain untouched. */
export const TATOOINE_ACTORS = {
  bantha: { file: 'creatures/bantha.glb', sourceId: 16, role: 'fauna', height: 1.8, animation: 'Bantha_Walk', mode: 'walk', radius: 0.95, hostile: false, hp: 0, damage: 0 },
  eopie: { file: 'creatures/eopie.glb', sourceId: 17, role: 'fauna', height: 1.75, animation: 'Unreal Take', mode: 'idle', radius: 0.65, hostile: false, hp: 0, damage: 0 },
  ronto: { file: 'creatures/ronto.glb', sourceId: 18, role: 'fauna', height: 3.8, animation: 'Unreal Take', mode: 'static', radius: 1.5, hostile: false, hp: 0, damage: 0 },
  rancor: { file: 'bosses/rancor.glb', sourceId: 19, role: 'boss', height: 3.25, animation: 'Unreal Take', mode: 'idle', radius: 1.4, hostile: true, hp: 500, damage: 0 },
  sullustan: { file: 'npcs/sullustan.glb', sourceId: 20, role: 'npc', height: 1.6, animation: 'Sullustran_Walk', mode: 'static', radius: 0.42, hostile: false, hp: 0, damage: 0 },
  dewback: { file: 'creatures/dewback.glb', sourceId: 21, role: 'fauna', height: 1.75, animation: 'Unreal Take', mode: 'idle', radius: 0.9, hostile: false, hp: 0, damage: 0 },
  pyke: { file: 'enemies/pyke_marksman.glb', sourceId: 22, role: 'enemy', height: 1.85, animation: 'mixamo.com', mode: 'static', radius: 0.45, hostile: true, hp: 100, damage: 0 },
  jawa: { file: 'npcs/jawa.glb', sourceId: 23, role: 'npc', height: 1.15, animation: 'idle-pose', mode: 'static', radius: 0.35, hostile: false, hp: 0, damage: 0 },
} as const;
export type TatooineActorId = keyof typeof TATOOINE_ACTORS;
export interface TatooineActorPlacement { id: string; actor: TatooineActorId; x: number; z: number; yaw?: number; interaction?: 'contact' | 'merchant' }
/** Four or fewer actors per sector, each owned by that sector. */
export const TATOOINE_POPULATION: Record<TatooineSceneId, readonly TatooineActorPlacement[]> = {
  tatooineFireflyInterior: [],
  tatooineSpaceport: [],
  tatooineHub: [
    { id: 'hub_contact', actor: 'sullustan', x: -2, z: 19, interaction: 'contact' },
    { id: 'hub_merchant', actor: 'jawa', x: 5, z: 13, interaction: 'merchant' },
    { id: 'hub_bantha', actor: 'bantha', x: 31, z: -15 },
    { id: 'hub_ronto', actor: 'ronto', x: 38, z: 38 },
  ],
  tatooineCantina: [
    { id: 'cantina_contact', actor: 'sullustan', x: -4, z: -2, interaction: 'contact' },
    { id: 'cantina_merchant', actor: 'jawa', x: 9, z: 4, interaction: 'merchant' },
  ],
  tatooineOutskirts: [
    { id: 'outskirts_ronto', actor: 'ronto', x: -16, z: 7 },
    { id: 'outskirts_eopie', actor: 'eopie', x: 5.5, z: 3 },
  ],
  tatooineCheckpoint: [
    { id: 'checkpoint_pyke', actor: 'pyke', x: 2, z: 9 },
  ],
  tatooineCamp: [
    { id: 'camp_pyke', actor: 'pyke', x: -2, z: 9 },
    { id: 'camp_dewback', actor: 'dewback', x: -5.5, z: 18 },
  ],
  tatooineBoss: [
    { id: 'arena_rancor', actor: 'rancor', x: -3, z: 2, yaw: Math.PI },
  ],
};
export function tatooineActorUrl(actor: TatooineActorId, staged: boolean) {
  return `${staged ? '/docs/_audit_codex/w224_staging/assets/' : '/assets/characters/tatooine/'}${TATOOINE_ACTORS[actor].file}`;
}
