import { Color3, Color4, MeshBuilder, PBRMaterial, Scene, StandardMaterial, Vector3 } from '@babylonjs/core';
import { createLighting } from './Lighting';

export class WorldBuilder {
  constructor(private readonly scene: Scene) {}

  buildBase() {
    this.scene.clearColor = new Color4(0.025, 0.06, 0.105, 1);
    this.scene.fogMode = Scene.FOGMODE_EXP2;
    this.scene.fogDensity = 0.008;
    this.scene.fogColor = new Color3(0.055, 0.11, 0.17);
    createLighting(this.scene);
    const ground = MeshBuilder.CreateGround('ground', { width: 120, height: 120, subdivisions: 2 }, this.scene);
    const material = new PBRMaterial('WetDarkGroundMaterial', this.scene);
    material.albedoColor = new Color3(0.045, 0.075, 0.1);
    material.metallic = 0.42;
    material.roughness = 0.34;
    ground.material = material;
    ground.isPickable = true;
    const markerMaterial = new StandardMaterial('CoolRunwayMarkers', this.scene);
    markerMaterial.diffuseColor = new Color3(0.12, 0.5, 0.65);
    markerMaterial.emissiveColor = new Color3(0.03, 0.22, 0.32);
    for (let z = -12; z <= 18; z += 6) {
      const marker = MeshBuilder.CreateBox(`runway_marker_${z}`, { width: 0.08, height: 0.018, depth: 2.2 }, this.scene);
      marker.position.set(-2.8, 0.012, z);
      marker.material = markerMaterial;
      marker.isPickable = false;
    }
    return ground;
  }
}
