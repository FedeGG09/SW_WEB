import type { TatooineSceneId } from '../world/tatooine/TatooineCatalog';
import type { TatooineMissionEvent } from '../quests/QuestSystem';
export type SceneId = 'shipInterior' | 'nerathisExterior' | 'cantinaInterior' | TatooineSceneId;
export type SpawnId = 'shipStart' | 'shipEntryInterior' | 'shipExit' | 'shipExitExterior' | 'landing' | 'waterfront' | 'city' | 'cantinaExterior' | 'cantinaInterior' | 'cantinaExit' | 'cantinaReturn' | 'tatooineArrival' | 'tatooineReturn' | 'tatooineCantinaReturn' | 'tatooineSpaceportReturn' | 'tatooineFireflyReturn';

export class GameState {
  currentScene: SceneId = 'shipInterior';
  currentSpawn: SpawnId = 'shipStart';
  questStarted = true;
  questStage = 1;
  naraConversationCompleted = false;
  readonly tatooineMissionEvents = new Set<TatooineMissionEvent>();

  setScene(scene: SceneId, spawn: SpawnId) {
    this.currentScene = scene;
    this.currentSpawn = spawn;
  }
}
