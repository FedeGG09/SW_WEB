import {
  AbstractMesh,
  Color3,
  DirectionalLight,
  HemisphericLight,
  Scene,
  Vector3,
} from '@babylonjs/core';

export type CharacterLightingEnvironment = 'interior' | 'outdoor';

/** Character-only fill/key light. Included-only lists keep Odyssey world
 * materials and their source-matched shader pipeline untouched. */
export class CharacterPresentationLighting {
  private readonly fill: HemisphericLight;
  private readonly key: DirectionalLight;
  readonly includedMeshes: string[];
  private enabled = true;

  constructor(
    scene: Scene,
    meshes: AbstractMesh[],
    environment: CharacterLightingEnvironment,
  ) {
    const renderables = meshes.filter((mesh) => mesh.getTotalVertices() > 0);
    this.includedMeshes = renderables.map((mesh) => mesh.name);

    this.fill = new HemisphericLight(
      'CharacterPresentationFill',
      new Vector3(0.05, 1, -0.12).normalize(),
      scene,
    );
    this.fill.diffuse = new Color3(0.92, 0.96, 1.0);
    this.fill.groundColor = new Color3(0.24, 0.29, 0.34);
    this.fill.specular = new Color3(0.12, 0.14, 0.16);
    this.fill.intensity = environment === 'interior' ? 1.0 : 0.12;
    this.fill.includedOnlyMeshes = renderables;

    this.key = new DirectionalLight(
      'CharacterPresentationKey',
      new Vector3(-0.35, -0.82, 0.44).normalize(),
      scene,
    );
    this.key.diffuse = new Color3(1.0, 0.91, 0.78);
    this.key.specular = new Color3(0.18, 0.16, 0.12);
    this.key.intensity = environment === 'interior' ? 0.52 : 0.10;
    this.key.includedOnlyMeshes = renderables;
  }

  state() {
    return {
      method: 'BABYLON_INCLUDED_ONLY_CHARACTER_MESH_LIGHTS',
      enabled: this.enabled,
      worldMeshesAffected: 0,
      includedMeshCount: this.includedMeshes.length,
      includedMeshes: [...this.includedMeshes],
      lights: [
        { name: this.fill.name, type: 'HEMISPHERIC', intensity: this.fill.intensity },
        { name: this.key.name, type: 'DIRECTIONAL', intensity: this.key.intensity },
      ],
    };
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    this.fill.setEnabled(enabled);
    this.key.setEnabled(enabled);
  }

  dispose() {
    this.fill.dispose();
    this.key.dispose();
  }
}
