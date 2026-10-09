import { Color3, Mesh, MeshBuilder, PBRMaterial, PointLight, Scene, StandardMaterial, Vector3 } from '@babylonjs/core';
import { NerathisMaterialLibrary } from './materials/NerathisMaterialLibrary';

type SurfaceMaterial = PBRMaterial | StandardMaterial;

export interface RepublicOutpostResult {
  meshes: Mesh[];
  lights: PointLight[];
}

/** Warm, practical frontier-post dressing for the cantina scene. */
export function buildRepublicOutpostInterior(scene: Scene, materials: NerathisMaterialLibrary): RepublicOutpostResult {
  const meshes: Mesh[] = [];
  const lights: PointLight[] = [];
  const add = (mesh: Mesh, material: SurfaceMaterial, family: string, zone: string) => {
    mesh.material = material;
    mesh.metadata = { materialFamily: family, mapping: 'W210_REPUBLIC_OUTPOST', zone };
    mesh.isPickable = false;
    meshes.push(mesh);
    return mesh;
  };
  const box = (name: string, width: number, height: number, depth: number, position: Vector3, material: SurfaceMaterial, family: string, zone = 'REPUBLIC_OUTPOST') => {
    const mesh = MeshBuilder.CreateBox(name, { width, height, depth }, scene);
    mesh.position.copyFrom(position);
    return add(mesh, material, family, zone);
  };
  const cylinder = (name: string, diameter: number, height: number, position: Vector3, material: SurfaceMaterial, family: string, zone = 'REPUBLIC_OUTPOST') => {
    const mesh = MeshBuilder.CreateCylinder(name, { diameter, height, tessellation: 10 }, scene);
    mesh.position.copyFrom(position);
    return add(mesh, material, family, zone);
  };

  // Wet, repaired floor: donor geometry remains visible around the edge, but
  // the playable rectangle now shares the same material language as the port.
  box('W210OutpostFloor', 12, 0.08, 10, new Vector3(0, -0.04, 0), materials.atlasFloorMetal, 'METAL', 'OUTPOST_FLOOR');
  for (const x of [-4, 0, 4]) box(`W210OutpostFloorSeam_${x}`, 0.04, 0.018, 9.4, new Vector3(x, 0.012, 0), materials.darkSteel, 'DARK_STEEL', 'OUTPOST_FLOOR');
  for (const z of [-3.2, 0, 3.2]) box(`W210OutpostFloorCrossSeam_${z}`, 11.4, 0.018, 0.04, new Vector3(0, 0.013, z), materials.darkSteel, 'DARK_STEEL', 'OUTPOST_FLOOR');

  // Structural framing and utilities make the room feel fabricated, repaired
  // and occupied rather than a generic warm box.
  for (const x of [-5.35, 5.35]) {
    box(`W210OutpostColumn_${x}`, 0.34, 3.55, 0.38, new Vector3(x, 1.77, 0), materials.atlasWallWetMetal, 'METAL', 'OUTPOST_STRUCTURE');
    box(`W210OutpostPipe_${x}`, 0.2, 3.2, 0.2, new Vector3(x * 0.96, 1.6, 4.45), materials.atlasDetailPipe, 'METAL', 'OUTPOST_UTILITIES');
  }
  box('W210OutpostCeilingBeamFront', 11.2, 0.28, 0.34, new Vector3(0, 3.35, -3.8), materials.darkSteel, 'DARK_STEEL', 'OUTPOST_STRUCTURE');
  box('W210OutpostCeilingBeamBack', 11.2, 0.28, 0.34, new Vector3(0, 3.35, 3.8), materials.darkSteel, 'DARK_STEEL', 'OUTPOST_STRUCTURE');
  box('W210OutpostCommandWall', 6.1, 2.75, 0.12, new Vector3(0.4, 1.55, 4.48), materials.atlasWallConcreteB, 'CONCRETE', 'OUTPOST_COMMAND');
  box('W210OutpostRepairPanel', 2.1, 1.6, 0.06, new Vector3(-1.3, 1.55, 4.39), materials.atlasWallRust, 'RUST', 'OUTPOST_COMMAND');
  box('W210OutpostMapPanel', 2.8, 1.45, 0.045, new Vector3(1.55, 1.95, 4.37), materials.atlasDetailPanel, 'METAL', 'OUTPOST_COMMAND');
  box('W210OutpostMapSurface', 1.9, 0.85, 0.025, new Vector3(1.55, 1.95, 4.32), materials.industrialMarkings, 'METAL', 'OUTPOST_COMMAND');
  box('W210OutpostMapTaskLight', 2.0, 0.045, 0.065, new Vector3(1.55, 2.42, 4.27), materials.warmGlass, 'WARM_LIGHT', 'OUTPOST_COMMAND');

  // Shared field table: a readable command/social focal point modelled from a
  // handful of mergeable shapes rather than many bespoke props.
  box('W210OutpostFieldTableTop', 4.6, 0.16, 2.25, new Vector3(0.9, 0.86, 0.9), materials.darkWood, 'WOOD', 'OUTPOST_SOCIAL');
  for (const [x, z] of [[-1.0, 0.15], [2.8, 0.15], [-1.0, 1.65], [2.8, 1.65]] as Array<[number, number]>) {
    box(`W210OutpostTableLeg_${x}_${z}`, 0.16, 0.78, 0.16, new Vector3(x, 0.39, z), materials.darkSteel, 'DARK_STEEL', 'OUTPOST_SOCIAL');
  }
  box('W210OutpostTableMap', 2.7, 0.025, 1.3, new Vector3(0.9, 0.96, 0.9), materials.atlasWallConcrete, 'CONCRETE', 'OUTPOST_SOCIAL');
  for (const [x, z, rotation] of [[-1.55, 0.9, Math.PI * 0.5], [3.35, 0.9, -Math.PI * 0.5], [0.9, -0.65, 0], [0.9, 2.45, Math.PI]] as Array<[number, number, number]>) {
    const chair = box(`W210OutpostChair_${x}_${z}`, 0.65, 0.12, 0.62, new Vector3(x, 0.48, z), materials.darkWood, 'WOOD', 'OUTPOST_SOCIAL');
    chair.rotation.y = rotation;
    box(`W210OutpostChairBack_${x}_${z}`, 0.65, 0.85, 0.1, new Vector3(x, 0.88, z + Math.cos(rotation) * 0.28), materials.wetCanvas, 'CANVAS', 'OUTPOST_SOCIAL').rotation.y = rotation;
  }

  // Storage/bunks establish the practical republican-post function while the
  // repaired donor shell keeps its original spatial silhouette.
  for (const z of [2.55, -0.2, -2.95]) {
    box(`W210OutpostLocker_${z}`, 1.15, 2.05, 0.72, new Vector3(-4.55, 1.03, z), materials.atlasWallWetMetal, 'METAL', 'OUTPOST_STORAGE');
    box(`W210OutpostLockerVent_${z}`, 0.58, 0.3, 0.025, new Vector3(-3.965, 1.35, z), materials.atlasDetailVent, 'METAL', 'OUTPOST_STORAGE').rotation.y = Math.PI * 0.5;
  }
  for (const [z, y] of [[2.2, 0.58], [2.2, 1.66], [-1.25, 0.58], [-1.25, 1.66]] as Array<[number, number]>) {
    box(`W210OutpostBunk_${z}_${y}`, 3.3, 0.18, 1.0, new Vector3(4.15, y, z), materials.darkSteel, 'DARK_STEEL', 'OUTPOST_BUNKS');
    box(`W210OutpostBunkCanvas_${z}_${y}`, 3.05, 0.12, 0.88, new Vector3(4.15, y + 0.14, z), materials.wetCanvas, 'CANVAS', 'OUTPOST_BUNKS');
  }
  box('W210OutpostCanvasDivider', 0.08, 2.55, 3.5, new Vector3(3.05, 1.65, 0.45), materials.atlasRoofCanvas, 'CANVAS', 'OUTPOST_BUNKS');

  // A restrained light rhythm: emissive cages do most of the work; a single
  // real lamp complements the existing scene key/fill budget.
  for (const [x, z] of [[-3.8, -3.5], [0.2, -3.5], [3.9, -3.5], [-2.8, 3.7], [3.5, 3.7]] as Array<[number, number]>) {
    cylinder(`W210OutpostLamp_${x}_${z}`, 0.22, 0.62, new Vector3(x, 2.82, z), materials.warmGlass, 'WARM_LIGHT', 'OUTPOST_LIGHTING');
    box(`W210OutpostLampCage_${x}_${z}`, 0.34, 0.08, 0.34, new Vector3(x, 3.13, z), materials.darkSteel, 'DARK_STEEL', 'OUTPOST_LIGHTING');
  }
  const utilityLight = new PointLight('W210OutpostUtilityLight', new Vector3(0.6, 2.75, 0.6), scene);
  utilityLight.diffuse = new Color3(1, 0.48, 0.2);
  utilityLight.intensity = 2.5;
  utilityLight.range = 7.5;
  lights.push(utilityLight);

  // Exit framing preserves the interaction point and makes the cold exterior
  // direction legible without adding another gameplay portal.
  box('W210OutpostExitFrameTop', 3.2, 0.2, 0.22, new Vector3(0, 2.72, -4.65), materials.darkSteel, 'DARK_STEEL', 'OUTPOST_EXIT');
  for (const x of [-1.5, 1.5]) box(`W210OutpostExitFrame_${x}`, 0.22, 2.7, 0.22, new Vector3(x, 1.36, -4.65), materials.darkSteel, 'DARK_STEEL', 'OUTPOST_EXIT');
  box('W210OutpostExitColdStrip', 2.45, 0.12, 0.04, new Vector3(0, 2.42, -4.54), materials.coldHorizon, 'COLD_LIGHT', 'OUTPOST_EXIT');

  return { meshes, lights };
}
