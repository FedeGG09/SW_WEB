import { Engine, Scene } from '@babylonjs/core';
import { AssetLoader, ImportedAsset } from '../assets/AssetLoader';
import { WorldBuilder } from '../world/WorldBuilder';
import { DEFAULT_PLAYER_CHARACTER } from '../player/PlayerCharacterConfig';

export interface SceneAssets { environment: ImportedAsset; player: ImportedAsset; enemy: ImportedAsset; }

export class SceneBootstrap {
  readonly scene: Scene;
  readonly loader = new AssetLoader();

  constructor(readonly engine: Engine) {
    this.scene = new Scene(engine);
    new WorldBuilder(this.scene).buildBase();
  }

  async load(onProgress: (value: number, message: string) => void): Promise<SceneAssets> {
    const entries = [
      ['environment', '/assets/environments/imperial_hangar.glb'],
      ['player', DEFAULT_PLAYER_CHARACTER.assetPath],
      ['enemy', '/assets/characters/enemies/darth_revan_clone_wars.glb'],
    ] as const;
    const loaded = {} as Record<typeof entries[number][0], ImportedAsset>;
    for (let index = 0; index < entries.length; index++) {
      const [key, url] = entries[index];
      onProgress(index / entries.length, `Loading ${key}...`);
      loaded[key] = await this.loader.load(url, this.scene, (fraction) => onProgress((index + fraction) / entries.length, `Loading ${key}...`));
    }
    loaded.environment.root.position.set(0, 0, 0);
    loaded.enemy.root.scaling.setAll(1.4);
    loaded.enemy.root.position.set(4, 0, 6);
    loaded.enemy.root.computeWorldMatrix(true);
    loaded.enemy.meshes.forEach((mesh) => mesh.computeWorldMatrix(true));
    loaded.environment.animationGroups.forEach((group) => group.start(true));
    loaded.enemy.animationGroups.forEach((group) => group.goToFrame(0));
    return loaded;
  }
}
