import { Scene, Vector3 } from '@babylonjs/core';
import { AssetLoader } from '../../assets/AssetLoader';
import { DialogueSystem } from '../../dialogue/DialogueSystem';
import { InteractionSystem } from '../../interaction/InteractionSystem';
import { QuestSystem } from '../../quests/QuestSystem';
import { TatooineSceneId } from './TatooineCatalog';
import { TATOOINE_ACTORS, TATOOINE_POPULATION } from './TatooineActorCatalog';
import { TatooineActor } from './TatooineActor';
import { TatooineNavigation } from './TatooineNavigation';

export class TatooinePopulation {
  readonly actors: TatooineActor[] = [];
  private constructor(private readonly navigation: TatooineNavigation, private readonly quest?: QuestSystem) {}
  static async create(sceneId: TatooineSceneId, scene: Scene, loader: AssetLoader,
    interaction: InteractionSystem, navigation: TatooineNavigation, staged: boolean,
    playerPosition: () => Vector3, dialogue?: DialogueSystem, quest?: QuestSystem) {
    const population = new TatooinePopulation(navigation, quest);
    try {
      for (const entry of TATOOINE_POPULATION[sceneId]) {
        // Large background landmarks may deliberately stand outside the player's corridor.
        const outside = entry.actor === 'ronto' && (sceneId === 'tatooineHub' || sceneId === 'tatooineOutskirts');
        const intended = new Vector3(entry.x, 0, entry.z);
        const safe = outside ? intended : navigation.nearest(intended);
        const placement = { ...entry, x: safe.x, z: safe.z };
        const actor = await TatooineActor.load(placement, loader, scene, staged, defeated => {
          if (defeated.placement.actor === 'rancor') quest?.markTatooineEvent('DEFEATED_RANCOR');
        });
        population.actors.push(actor);
        if (entry.interaction && dialogue) interaction.register({
          id: `w224_${entry.id}`, label: entry.interaction === 'contact' ? 'Hablar con contacto' : 'Hablar con comerciante Jawa',
          position: actor.position, radius: 2.8, enabled: () => actor.isAlive,
          action: () => {
            actor.face(playerPosition());
            dialogue.openTatooinePlaceholder(entry.interaction!);
            if (entry.interaction === 'contact') quest?.markTatooineEvent('MET_CONTACT');
          },
        });
      }
      console.info('[W224] POPULATION READY', { scene: sceneId, actors: population.actors.map(actor => ({ id: actor.placement.id, role: TATOOINE_ACTORS[actor.placement.actor].role, position: actor.position.asArray() })) });
      return population;
    } catch (error) { population.dispose(); throw error; }
  }
  get hostile() { return this.actors.find(actor => TATOOINE_ACTORS[actor.placement.actor].hostile && actor.isAlive); }
  get rancor() { return this.actors.find(actor => actor.placement.actor === 'rancor'); }
  get pyke() { return this.actors.find(actor => actor.placement.actor === 'pyke'); }
  update(dt: number) { this.actors.forEach(actor => actor.update(dt)); }
  /** Lightweight horizontal proxy; the W223 floor/navigation still owns grounding. */
  resolvePlayer(position: Vector3) {
    for (const actor of this.actors) {
      if (!actor.isAlive || actor.placement.actor === 'ronto') continue;
      const dx = position.x - actor.root.position.x, dz = position.z - actor.root.position.z;
      const radius = actor.radius + 0.4, distance = Math.hypot(dx, dz);
      if (distance >= radius || distance < 1e-5) continue;
      position.x += dx / distance * (radius - distance);
      position.z += dz / distance * (radius - distance);
    }
  }
  dispose() { this.actors.forEach(actor => actor.dispose()); this.actors.length = 0; }
}
