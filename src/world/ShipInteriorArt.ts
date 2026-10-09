import { Mesh, MeshBuilder, PointLight, PBRMaterial, Scene, StandardMaterial, Vector3, Color3 } from '@babylonjs/core';
import { NerathisMaterialLibrary } from './materials/NerathisMaterialLibrary';

export interface ShipInteriorArtResult {
  meshes: Mesh[];
  lights: PointLight[];
}

/**
 * Low-cost field-ship dressing. It deliberately sits in a separate builder
 * so SceneManager only coordinates loading and scene transitions.
 */
export function buildShipInteriorArt(scene: Scene, materials: NerathisMaterialLibrary, layoutScale = 1): ShipInteriorArtResult {
  const meshes: Mesh[] = [];
  const lights: PointLight[] = [];
  const metal = materials.darkSteel;
  const painted = materials.wetPaintedMetal;
  const oxidized = materials.oxidizedMetal;
  const cable = materials.rubberCable;
  const wood = materials.darkWood;
  const warm = materials.warmGlass;
  const grime = materials.grime;
  const oil = materials.oil;

  const addBox = (name: string, width: number, height: number, depth: number, position: Vector3, material: PBRMaterial | StandardMaterial, pickable = false) => {
    const mesh = MeshBuilder.CreateBox(name, { width, height, depth }, scene);
    mesh.position.copyFrom(position);
    mesh.material = material;
    mesh.metadata = { materialFamily: material === metal ? 'DARK_STEEL' : material === painted ? 'METAL' : material === oxidized ? 'RUST' : material === cable ? 'CABLE' : material === wood ? 'WOOD' : material === warm ? 'WARM_LIGHT' : 'METAL', mapping: 'SHIP_SHARED' };
    mesh.isPickable = pickable;
    meshes.push(mesh);
    return mesh;
  };

  // Do not place a large visual floor over the donor. The donor deck remains
  // authoritative for appearance; the invisible SimpleCollisionWorld owns
  // gameplay grounding.
  for (const z of [-3.1, -1.35, 0.45, 2.2]) addBox(`ship_floor_seam_z_${z}`, 6.7, 0.018, 0.045, new Vector3(0, 0.012, z), cable);
  for (const x of [-2.35, 0, 2.35]) addBox(`ship_floor_seam_x_${x}`, 0.045, 0.018, 8.05, new Vector3(x, 0.012, 0), cable);
  for (const [x, z, width, depth, material] of [
    [-2.0, 1.8, 1.3, 0.65, grime], [1.8, -0.6, 1.1, 0.48, oil], [-1.3, -2.3, 1.6, 0.52, grime], [2.2, 2.6, 0.75, 0.35, oil],
  ] as Array<[number, number, number, number, PBRMaterial]>) {
    const decal = MeshBuilder.CreatePlane(`ship_floor_wear_${x}_${z}`, { width, height: depth }, scene);
    decal.position.set(x, 0.025, z);
    decal.rotation.x = Math.PI * 0.5;
    decal.material = material;
    decal.isPickable = false;
    meshes.push(decal);
  }

  // Wall repair plates and ceiling utility panels keep the interior
  // operational instead of pristine or ruined.
  for (const [x, z, width, height] of [[-3.58, 2.2, 1.2, 0.8], [3.58, 0.4, 1.3, 0.9], [-3.58, -1.8, 0.9, 1.1], [3.58, -2.4, 1.4, 0.7]] as Array<[number, number, number, number]>) {
    const plate = addBox(`ship_wall_repair_${x}_${z}`, 0.06, height, width, new Vector3(x, 1.15, z), oxidized);
    plate.rotation.x = (z % 2) * 0.018;
  }
  for (const [x, z] of [[-2.6, 2.5], [0.2, 2.65], [2.7, 2.35]] as Array<[number, number]>) {
    addBox(`ship_ceiling_service_panel_${x}_${z}`, 1.25, 0.06, 0.65, new Vector3(x, 2.43, z), painted);
  }

  // Cable and pipe runs are one tube per route, so the visual gain does not
  // become a draw-call explosion.
  for (const [index, path] of [
    [0, [new Vector3(-3.2, 2.25, 3.7), new Vector3(-2.4, 2.5, 2.0), new Vector3(-1.0, 2.45, 0.8), new Vector3(1.9, 2.5, 0.2)]],
    [1, [new Vector3(3.2, 2.3, 3.4), new Vector3(2.4, 2.48, 1.5), new Vector3(1.7, 2.45, -1.1), new Vector3(2.9, 2.35, -3.3)]],
  ] as Array<[number, Vector3[]]>) {
    const route = MeshBuilder.CreateTube(`ship_ceiling_cable_route_${index}`, { path, radius: 0.045, tessellation: 6 }, scene);
    route.material = cable;
    route.metadata = { materialFamily: 'CABLE', mapping: 'SHIP_SHARED' };
    route.isPickable = false;
    meshes.push(route);
  }
  for (const [x, z, length] of [[-2.9, 0.8, 4.5], [2.9, -0.6, 3.8]] as Array<[number, number, number]>) {
    const pipe = MeshBuilder.CreateCylinder(`ship_utility_pipe_${x}_${z}`, { diameter: 0.12, height: length, tessellation: 8 }, scene);
    pipe.position.set(x, 1.85, z);
    pipe.rotation.z = Math.PI * 0.5;
    pipe.material = oxidized;
    pipe.metadata = { materialFamily: 'RUST', mapping: 'SHIP_SHARED' };
    pipe.isPickable = false;
    meshes.push(pipe);
  }

  // Nara's field station: a map/work table, cargo, terminal and one warm task
  // light provide a readable backdrop without changing dialogue placement.
  // W2 ship-playability recovery: keep Nara's complete field station on the
  // donor's continuous aft-hold deck instead of the old empty-space spawn.
  addBox('nara_field_table', 1.25, 0.14, 0.72, new Vector3(-0.75, 0.72, -3.45), wood);
  addBox('nara_field_map', 0.8, 0.018, 0.5, new Vector3(-0.75, 0.805, -3.45), materials.industrialMarkings);
  addBox('nara_field_terminal', 0.4, 0.72, 0.18, new Vector3(-0.15, 1.05, -3.45), metal);
  addBox('nara_field_terminal_screen', 0.28, 0.24, 0.025, new Vector3(-0.15, 1.22, -3.56), warm);
  addBox('nara_field_cargo_a', 0.72, 0.62, 0.68, new Vector3(-1.3, 0.31, -2.2), oxidized);
  addBox('nara_field_cargo_b', 0.58, 0.48, 0.56, new Vector3(1.1, 0.24, -2.3), metal);
  addBox('nara_field_lamp', 0.16, 0.42, 0.16, new Vector3(-1.15, 1.0, -3.42), warm);

  const taskLight = new PointLight('ShipNaraTaskLight', new Vector3(-0.75, 2.2, -3.35), scene);
  taskLight.diffuse = new Color3(1, 0.48, 0.18);
  taskLight.intensity = 5.5;
  taskLight.range = 5.2;
  lights.push(taskLight);

  // Exit readability: keep a physical frame, ramp and restrained cold light.
  // V1 used a large opaque preview plane here; depending on camera angle it
  // covered half the screen and looked like an extra blue wall. The hatch is
  // now readable through geometry + light + minimap instead.
  addBox('ship_exit_frame_left', 0.18, 2.7, 0.24, new Vector3(-1.75, 1.35, -4.58), metal);
  addBox('ship_exit_frame_right', 0.18, 2.7, 0.24, new Vector3(1.75, 1.35, -4.58), metal);
  addBox('ship_exit_frame_top', 3.65, 0.18, 0.24, new Vector3(0, 2.66, -4.58), oxidized);
  addBox('ship_exit_ramp', 3.1, 0.06, 1.15, new Vector3(0, -0.01, -4.25), painted);
  const hatchLight = new PointLight('ShipExitColdLight', new Vector3(0, 1.7, -4.05), scene);
  hatchLight.diffuse = new Color3(0.22, 0.58, 0.82);
  hatchLight.intensity = 2.8;
  hatchLight.range = 4.2;
  lights.push(hatchLight);

  const exitBeaconMaterial = new StandardMaterial('ShipExitBeaconMaterial', scene);
  exitBeaconMaterial.diffuseColor = new Color3(1, 0.62, 0.12);
  exitBeaconMaterial.emissiveColor = new Color3(0.8, 0.32, 0.03);
  exitBeaconMaterial.disableLighting = true;
  const exitBeacon = MeshBuilder.CreateTorus('ship_exit_beacon', { diameter: 1.15, thickness: 0.045, tessellation: 32 }, scene);
  exitBeacon.position.set(0, 0.055, -4.3);
  exitBeacon.material = exitBeaconMaterial;
  exitBeacon.isPickable = false;
  exitBeacon.metadata = { materialFamily: 'WARM_LIGHT', mapping: 'SHIP_EXIT_OBJECTIVE' };
  meshes.push(exitBeacon);

  // W2.0.6.2 keeps props and work surfaces at human scale, but moves their
  // authored layout with the donor ship when the whole interior wrapper is
  // recalibrated. This avoids the old global-space offsets becoming stale.
  if (layoutScale !== 1) {
    meshes.forEach((mesh) => {
      mesh.position.x *= layoutScale;
      mesh.position.z *= layoutScale;
    });
    lights.forEach((light) => {
      light.position.x *= layoutScale;
      light.position.z *= layoutScale;
    });
  }

  return { meshes, lights };
}
