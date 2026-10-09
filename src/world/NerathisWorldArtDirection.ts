import { Mesh, MeshBuilder, PBRMaterial, Scene, StandardMaterial, Vector3 } from '@babylonjs/core';
import { NerathisMaterialLibrary } from './materials/NerathisMaterialLibrary';

type SurfaceMaterial = PBRMaterial | StandardMaterial;

export interface NerathisWorldArtResult {
  meshes: Mesh[];
  zoneCenters: {
    swampPath: Vector3;
    floatingSettlement: Vector3;
    attackedZone: Vector3;
  };
}

/**
 * W2.1.0 authored connective tissue.
 *
 * The earlier passes already own the large playable surfaces. This layer makes
 * their relationship explicit: serviced ship -> working port -> marsh edge ->
 * inhabited water settlement -> damaged city. Everything is static, shares the
 * established material library and is intentionally safe to merge by family.
 */
export function buildNerathisWorldArtDirection(scene: Scene, materials: NerathisMaterialLibrary): NerathisWorldArtResult {
  const meshes: Mesh[] = [];
  const addMetadata = (mesh: Mesh, family: string, zone: string) => {
    mesh.metadata = { materialFamily: family, mapping: 'W210_UNIFIED_ART', zone };
    mesh.isPickable = false;
    meshes.push(mesh);
    return mesh;
  };
  const addBox = (
    name: string,
    size: { width: number; height: number; depth: number },
    position: Vector3,
    material: SurfaceMaterial,
    family: string,
    zone: string,
  ) => {
    const mesh = MeshBuilder.CreateBox(name, size, scene);
    mesh.position.copyFrom(position);
    mesh.material = material;
    return addMetadata(mesh, family, zone);
  };
  const addCylinder = (
    name: string,
    diameter: number,
    height: number,
    position: Vector3,
    material: SurfaceMaterial,
    family: string,
    zone: string,
    tessellation = 8,
  ) => {
    const mesh = MeshBuilder.CreateCylinder(name, { diameter, height, tessellation }, scene);
    mesh.position.copyFrom(position);
    mesh.material = material;
    return addMetadata(mesh, family, zone);
  };
  const addTube = (name: string, points: Vector3[], radius: number, material: SurfaceMaterial, family: string, zone: string) => {
    const mesh = MeshBuilder.CreateTube(name, { path: points, radius, tessellation: 6 }, scene);
    mesh.material = material;
    return addMetadata(mesh, family, zone);
  };
  const addSphere = (name: string, diameter: number, position: Vector3, material: SurfaceMaterial, family: string, zone: string) => {
    const mesh = MeshBuilder.CreateSphere(name, { diameter, segments: 6 }, scene);
    mesh.position.copyFrom(position);
    mesh.material = material;
    return addMetadata(mesh, family, zone);
  };

  // PARKED SHIP / SERVICE APRON ------------------------------------------------
  // The ship sits to port of the arrival axis. Repeated service elements point
  // toward the real entry instead of being scattered as generic decoration.
  for (const [x, z, width, depth] of [
    [-23, 17, 8.5, 0.38], [-13, 17, 7.2, 0.38], [-4, 13, 5.4, 0.32],
    [-25, -17, 6.8, 0.32], [-14, -17, 8.6, 0.32], [-4, -11, 5.2, 0.32],
  ] as Array<[number, number, number, number]>) {
    addBox(`W210ShipParkingMark_${x}_${z}`, { width, height: 0.025, depth }, new Vector3(x, 0.145, z), materials.industrialMarkings, 'WARNING', 'SHIP_SERVICE');
  }
  for (const [x, z, height] of [[2.5, 12, 1.05], [4.2, 10.8, 0.78], [2.8, -9.5, 0.92], [5.1, -7.8, 0.62]] as Array<[number, number, number]>) {
    addBox(`W210ShipServiceCargo_${x}_${z}`, { width: 1.8, height, depth: 1.45 }, new Vector3(x, height * 0.5 + 0.12, z), materials.atlasWallWetMetal, 'METAL', 'SHIP_SERVICE');
    addBox(`W210ShipServiceCargoBand_${x}_${z}`, { width: 1.86, height: 0.07, depth: 1.5 }, new Vector3(x, Math.min(height, 0.64), z), materials.industrialMarkings, 'WARNING', 'SHIP_SERVICE');
  }
  addTube('W210ShipFuelUmbilical', [new Vector3(4.6, 0.32, 7.2), new Vector3(2.8, 0.62, 6.6), new Vector3(0.8, 0.48, 5.1), new Vector3(-1.2, 0.36, 4.2)], 0.085, materials.rubberCable, 'CABLE', 'SHIP_SERVICE');
  addBox('W210ShipServiceDrain', { width: 8.5, height: 0.025, depth: 0.62 }, new Vector3(1.5, 0.13, 15.1), materials.atlasFloorGrate, 'DARK_STEEL', 'SHIP_SERVICE');
  for (const [x, z] of [[-24, 14], [-8, 14], [-24, -14], [-8, -14]] as Array<[number, number]>) {
    addCylinder(`W210ShipServiceBeacon_${x}_${z}`, 0.24, 0.75, new Vector3(x, 0.52, z), materials.redBeacon, 'RED_BEACON', 'SHIP_SERVICE', 8);
  }

  // SWAMP / OUTSKIRTS ---------------------------------------------------------
  const swampCenter = new Vector3(-31, 0, -59);
  addBox('W210SwampPathBase', { width: 15.5, height: 0.18, depth: 49 }, new Vector3(-31.5, -0.11, -59), materials.atlasTerrainWet, 'MUD', 'SWAMP_PATH');
  addBox('W210SwampPathMossEdgeWest', { width: 1.4, height: 0.1, depth: 47 }, new Vector3(-39.2, -0.04, -59), materials.atlasTerrainMoss, 'MOSS', 'SWAMP_PATH');
  addBox('W210SwampPathMossEdgeEast', { width: 1.1, height: 0.1, depth: 47 }, new Vector3(-23.9, -0.04, -59), materials.atlasTerrainMoss, 'MOSS', 'SWAMP_PATH');
  const swampSteps: Array<[number, number, number, number]> = [
    [-28, -37, 4.8, 3.4], [-31, -43, 5.8, 3.8], [-29, -50, 6.4, 4.2], [-33, -57, 5.4, 3.6],
    [-31, -64, 6.2, 4.1], [-35, -71, 5.2, 3.5], [-32, -78, 6.0, 4.0],
  ];
  swampSteps.forEach(([x, z, sx, sz], index) => {
    const island = addCylinder(`W210SwampMudStep_${index}`, 1, 0.22, new Vector3(x, -0.04, z), index % 3 === 0 ? materials.atlasTerrainBasalt : materials.atlasTerrainMud, index % 3 === 0 ? 'BASALT' : 'MUD', 'SWAMP_PATH', 10);
    island.scaling.set(sx, 1, sz);
    const wetPatch = addCylinder(`W210SwampWetPatch_${index}`, 1, 0.025, new Vector3(x + (index % 2 ? 0.8 : -0.7), 0.09, z + 0.4), materials.atlasTerrainPuddle, 'WATER', 'SWAMP_PATH', 10);
    wetPatch.scaling.set(sx * 0.34, 1, sz * 0.3);
  });
  for (const [x, z, height] of [[-37, -42, 2.6], [-25, -48, 2.1], [-38, -58, 3.2], [-25, -66, 2.5], [-39, -73, 3.5], [-27, -78, 2.8]] as Array<[number, number, number]>) {
    addCylinder(`W210SwampRoot_${x}_${z}`, 0.28, height, new Vector3(x, height * 0.45, z), materials.atlasTerrainRoots, 'WOOD', 'SWAMP_PATH', 7).rotation.z = x % 2 === 0 ? 0.2 : -0.17;
    const crown = addSphere(`W210SwampFoliage_${x}_${z}`, 1.8, new Vector3(x, height + 0.1, z), materials.foliage, 'VEGETATION', 'SWAMP_PATH');
    crown.scaling.set(1.35, 0.72, 0.9);
  }
  for (const [x, z, scale] of [[-38, -49, 1.4], [-25, -55, 1.1], [-37, -66, 1.25], [-26, -72, 1.35], [-36, -80, 1.05]] as Array<[number, number, number]>) {
    const rock = addSphere(`W210SwampBasalt_${x}_${z}`, 1.9, new Vector3(x, 0.15, z), materials.atlasTerrainBasalt, 'BASALT', 'SWAMP_PATH');
    rock.scaling.set(scale, 0.55, scale * 0.78);
  }
  addTube('W210SwampUtilityPipe', [new Vector3(-26, 0.55, -38), new Vector3(-27.5, 0.72, -51), new Vector3(-25.8, 0.48, -64), new Vector3(-27.2, 0.62, -78)], 0.09, materials.atlasDetailPipe, 'METAL', 'SWAMP_PATH');
  for (const z of [-41, -55, -69, -78]) {
    addCylinder(`W210SwampWarmMarker_${z}`, 0.2, 0.68, new Vector3(-27.2, 0.48, z), materials.warmGlass, 'WARM_LIGHT', 'SWAMP_PATH', 8);
  }

  // FLOATING / WATER SETTLEMENT ----------------------------------------------
  const settlementCenter = new Vector3(23, 0, -69);
  const settlement: Array<[number, number, number, number]> = [
    [18, -48, 5.8, 3.0], [24, -59, 6.6, 3.8], [19, -72, 5.4, 3.2], [27, -82, 6.2, 4.1],
  ];
  settlement.forEach(([x, z, width, height], index) => {
    const zone = 'FLOATING_SETTLEMENT';
    addBox(`W210SettlementDeck_${index}`, { width: width + 2.4, height: 0.18, depth: 5.2 }, new Vector3(x, 0.28, z), materials.atlasFloorPlatform, 'METAL', zone);
    for (const px of [x - width * 0.46, x + width * 0.46]) for (const pz of [z - 2, z + 2]) {
      addCylinder(`W210SettlementPiling_${index}_${px}_${pz}`, 0.32, 4.1, new Vector3(px, -1.55, pz), index % 2 === 0 ? materials.darkSteel : materials.oxidizedMetal, index % 2 === 0 ? 'DARK_STEEL' : 'RUST', zone, 8);
      addCylinder(`W210SettlementWaterline_${index}_${px}_${pz}`, 0.4, 0.7, new Vector3(px, -0.25, pz), materials.moss, 'MOSS', zone, 8);
    }
    addBox(`W210SettlementHouse_${index}`, { width, height, depth: 4.2 }, new Vector3(x, height * 0.5 + 0.37, z), index % 2 === 0 ? materials.atlasWallConcreteB : materials.atlasWallPainted, index % 2 === 0 ? 'CONCRETE' : 'METAL', zone);
    const roof = addBox(`W210SettlementRoof_${index}`, { width: width + 0.8, height: 0.13, depth: 4.9 }, new Vector3(x, height + 0.68, z), index % 2 === 0 ? materials.atlasRoofCanvas : materials.atlasRoofMetal, index % 2 === 0 ? 'CANVAS' : 'ROOF', zone);
    roof.rotation.z = index % 2 === 0 ? 0.11 : -0.11;
    addBox(`W210SettlementWindow_${index}`, { width: 1.25, height: 0.72, depth: 0.04 }, new Vector3(x - width * 0.2, 2.05, z + 2.12), materials.warmGlass, 'WARM_LIGHT', zone);
    addBox(`W210SettlementRepair_${index}`, { width: width * 0.3, height: 1.2, depth: 0.05 }, new Vector3(x + width * 0.26, 1.35, z + 2.14), index % 2 === 0 ? materials.darkWood : materials.atlasWallRust, index % 2 === 0 ? 'WOOD' : 'RUST', zone);
  });
  addTube('W210SettlementCableA', [new Vector3(18, 4.2, -48), new Vector3(22, 5.0, -54), new Vector3(24, 4.8, -59)], 0.04, materials.rubberCable, 'CABLE', 'FLOATING_SETTLEMENT');
  addTube('W210SettlementCableB', [new Vector3(19, 4.4, -72), new Vector3(23, 5.1, -77), new Vector3(27, 5.2, -82)], 0.04, materials.rubberCable, 'CABLE', 'FLOATING_SETTLEMENT');

  // ATTACKED DISTRICT ----------------------------------------------------------
  const attackedCenter = new Vector3(-18, 0, -111);
  for (const [x, z, angle] of [[-22, -106, -0.28], [-17, -109, 0.35], [-13, -113, -0.18], [-20, -117, 0.22]] as Array<[number, number, number]>) {
    const slab = addBox(`W210AttackedCollapsedPanel_${x}_${z}`, { width: 4.2, height: 0.24, depth: 1.4 }, new Vector3(x, 0.32, z), materials.atlasWallRust, 'RUST', 'ATTACKED_ZONE');
    slab.rotation.y = angle;
    slab.rotation.z = angle * 0.5;
    addBox(`W210AttackedSoot_${x}_${z}`, { width: 2.6, height: 0.03, depth: 2.2 }, new Vector3(x + 0.4, 0.11, z + 0.3), materials.burntMetal, 'RUST', 'ATTACKED_ZONE');
  }
  for (const [x, z, height] of [[-25, -111, 2.8], [-10, -108, 2.2], [-22, -122, 3.1]] as Array<[number, number, number]>) {
    const brokenPost = addBox(`W210AttackedBrokenPost_${x}_${z}`, { width: 0.34, height, depth: 0.34 }, new Vector3(x, height * 0.43, z), materials.darkSteel, 'DARK_STEEL', 'ATTACKED_ZONE');
    brokenPost.rotation.z = x % 2 === 0 ? 0.22 : -0.28;
    addCylinder(`W210AttackedEmergency_${x}_${z}`, 0.2, 0.5, new Vector3(x, height + 0.12, z), materials.redBeacon, 'RED_BEACON', 'ATTACKED_ZONE', 8);
  }
  addTube('W210AttackedBrokenCable', [new Vector3(-26, 3.2, -109), new Vector3(-20, 1.2, -112), new Vector3(-12, 2.8, -110)], 0.055, materials.rubberCable, 'CABLE', 'ATTACKED_ZONE');
  addBox('W210AttackedEmergencyBarrier', { width: 6.8, height: 0.12, depth: 0.18 }, new Vector3(-16, 0.72, -104.5), materials.warningWear, 'WARNING', 'ATTACKED_ZONE').rotation.z = -0.08;

  return { meshes, zoneCenters: { swampPath: swampCenter, floatingSettlement: settlementCenter, attackedZone: attackedCenter } };
}
