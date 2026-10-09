import { Color3, Mesh, MeshBuilder, PointLight, PBRMaterial, Scene, StandardMaterial, Vector3 } from '@babylonjs/core';
import { NerathisMaterialLibrary } from './materials/NerathisMaterialLibrary';

export interface SpaceportCompositionScalePassResult {
  meshes: Mesh[];
  lights: PointLight[];
}

/**
 * SPACEPORT COMPOSITION & SCALE PASS
 *
 * Goals:
 * - strengthen zone hierarchy;
 * - create silhouette masses in the background;
 * - give each playable area a clearer framing language;
 * - add a few fill lights for visual separation;
 * - improve the feeling of scale without adding expensive donor assets.
 */
export function buildSpaceportCompositionScalePass(
  scene: Scene,
  materials: NerathisMaterialLibrary,
): SpaceportCompositionScalePassResult {
  const meshes: Mesh[] = [];
  const lights: PointLight[] = [];

  const dark = materials.darkSteel;
  const wall = materials.spaceportPadMetal;
  const wallAlt = materials.spaceportDeckSecondary;
  const wet = materials.spaceportDeckWet;
  const yellow = materials.spaceportSafetyYellow;
  const neutral = materials.spaceportNeutralMarking;
  const glowAmber = materials.warmGlass;
  const glowCold = materials.shipGlass;

  const addBox = (
    name: string,
    width: number,
    height: number,
    depth: number,
    x: number,
    y: number,
    z: number,
    material: PBRMaterial | StandardMaterial,
    zone = 'SPACEPORT_COMPOSITION',
  ) => {
    const mesh = MeshBuilder.CreateBox(name, { width, height, depth }, scene);
    mesh.position.set(x, y, z);
    mesh.material = material;
    mesh.isPickable = false;
    mesh.metadata = {
      materialFamily: material === yellow || material === neutral ? 'MARKING' : 'STRUCTURE',
      mapping: 'SPACEPORT_COMPOSITION_V1',
      zone,
    };
    meshes.push(mesh);
    return mesh;
  };

  const addStrip = (
    name: string,
    x: number,
    z: number,
    width: number,
    depth: number,
    material: StandardMaterial,
    zone = 'SPACEPORT_STRIP',
  ) => addBox(name, width, 0.035, depth, x, 0.145, z, material, zone);

  const addSoftLight = (
    name: string,
    x: number,
    y: number,
    z: number,
    diffuse: Color3,
    intensity: number,
    range: number,
  ) => {
    const light = new PointLight(name, new Vector3(x, y, z), scene);
    light.diffuse = diffuse;
    light.intensity = intensity;
    light.range = range;
    lights.push(light);
    return light;
  };

  // ------------------------------------------------------------------
  // 1. Background skyline masses / silhouettes
  // ------------------------------------------------------------------
  // These masses sit behind the existing north wall so the scene no longer
  // reads as a flat "end of map".
  const skyline = [
    [-33, 6.5, 7.0, 5.0, 29.5, wallAlt],
    [-25, 9.8, 5.2, 4.6, 30.8, dark],
    [-17, 7.8, 6.2, 4.6, 29.8, wall],
    [-8, 12.2, 4.8, 4.2, 31.0, dark],
    [2, 11.0, 7.2, 5.4, 30.6, wallAlt],
    [13, 8.6, 5.6, 4.8, 29.7, wall],
    [23, 10.8, 6.4, 5.0, 30.8, dark],
    [33, 7.4, 7.2, 4.8, 29.9, wallAlt],
  ] as Array<[number, number, number, number, number, PBRMaterial | StandardMaterial]>;
  skyline.forEach(([x, h, w, d, z, material], i) => {
    addBox(`spaceport_skyline_${i}`, w, h, d, x, h * 0.5, z, material, 'SPACEPORT_SKYLINE');
    addBox(`spaceport_skyline_cap_${i}`, w * 0.72, 0.32, d * 0.72, x, h + 0.16, z, dark, 'SPACEPORT_SKYLINE');
  });

  // Antenna rhythm.
  [-30, -20, -5, 7, 20, 31].forEach((x, i) => {
    addBox(`spaceport_antenna_mast_${i}`, 0.18, 6.8 + (i % 3), 0.18, x, 6.0, 28.0 + (i % 2) * 1.4, dark, 'SPACEPORT_SKYLINE');
    addBox(`spaceport_antenna_tip_${i}`, 0.34, 0.34, 0.34, x, 11.8 + (i % 3), 28.0 + (i % 2) * 1.4, glowAmber, 'SPACEPORT_SKYLINE');
  });

  // ------------------------------------------------------------------
  // 2. Zone framing masses
  // ------------------------------------------------------------------
  // Hero ship backdrop.
  addBox('spaceport_hero_backdrop_wall', 14.5, 4.8, 0.42, -18.5, 2.4, 5.7, wallAlt, 'SPACEPORT_HERO_ZONE');
  addBox('spaceport_hero_backdrop_cap', 14.9, 0.34, 1.0, -18.5, 4.95, 5.7, dark, 'SPACEPORT_HERO_ZONE');
  addBox('spaceport_hero_side_fin', 0.65, 5.6, 4.2, -25.9, 2.8, 3.8, dark, 'SPACEPORT_HERO_ZONE');

  // Lift/cargo zone framing.
  addBox('spaceport_lift_backdrop_wall', 12.5, 5.6, 0.42, 18.6, 2.8, 17.3, wall, 'SPACEPORT_LIFT_ZONE');
  addBox('spaceport_lift_backdrop_cap', 13.0, 0.36, 1.0, 18.6, 5.78, 17.3, dark, 'SPACEPORT_LIFT_ZONE');
  addBox('spaceport_lift_side_mass', 3.8, 4.6, 5.0, 26.5, 2.3, 14.9, wallAlt, 'SPACEPORT_LIFT_ZONE');

  // CB1 framing wall so that bay reads as a dedicated parking pocket.
  addBox('spaceport_cb1_backdrop_wall', 9.5, 4.4, 0.42, 35.0, 2.2, 1.8, wallAlt, 'SPACEPORT_CB1_ZONE');
  addBox('spaceport_cb1_backdrop_cap', 10.0, 0.32, 0.92, 35.0, 4.58, 1.8, dark, 'SPACEPORT_CB1_ZONE');

  // ------------------------------------------------------------------
  // 3. Docking / zone strips to improve readability
  // ------------------------------------------------------------------
  addStrip('spaceport_hero_zone_strip', -19.0, -7.2, 10.0, 0.22, glowAmber, 'SPACEPORT_HERO_ZONE');
  addStrip('spaceport_lift_zone_strip', 18.7, 7.0, 8.0, 0.22, glowCold, 'SPACEPORT_LIFT_ZONE');
  addStrip('spaceport_cb1_zone_strip', 35.0, -10.7, 8.0, 0.22, glowAmber, 'SPACEPORT_CB1_ZONE');
  addStrip('spaceport_gate_zone_strip', 0.0, -25.2, 4.0, 0.18, glowCold, 'CAUSEWAY');

  // Small neutral composition braces / parking ticks.
  for (const [x, z] of [[-23, -5.5], [-15, -5.5], [14.5, 9], [22.5, 9], [31.5, -9], [38.5, -9]] as Array<[number, number]>) {
    addBox(`spaceport_zone_tick_${x}_${z}`, 0.22, 0.03, 1.5, x, 0.13, z, neutral, 'SPACEPORT_MARKING');
  }

  // ------------------------------------------------------------------
  // 4. Soft edge-mass props (noninteractive) to improve scale reading
  // ------------------------------------------------------------------
  const propPositions = [
    [-27.0, -2.5], [-24.0, 12.8], [-8.5, 14.0], [7.5, 15.2], [28.5, 13.6], [40.0, 4.8],
  ] as Array<[number, number]>;
  propPositions.forEach(([x, z], i) => {
    addBox(`spaceport_scale_prop_base_${i}`, 1.2, 1.1, 1.2, x, 0.55, z, dark, 'SPACEPORT_SCALE_PROP');
    addBox(`spaceport_scale_prop_head_${i}`, 0.8, 0.4, 0.8, x, 1.35, z, wall, 'SPACEPORT_SCALE_PROP');
    addBox(`spaceport_scale_prop_light_${i}`, 0.24, 0.16, 0.24, x, 1.66, z, i % 2 === 0 ? glowAmber : glowCold, 'SPACEPORT_SCALE_PROP');
  });

  // ------------------------------------------------------------------
  // 5. Complementary fill lights (very small budget)
  // ------------------------------------------------------------------
  addSoftLight('SpaceportHeroFill', -20.0, 4.6, -4.8, new Color3(0.70, 0.78, 1.0), 3.0, 12);
  addSoftLight('SpaceportLiftFill', 18.8, 5.4, 10.2, new Color3(0.65, 0.82, 1.0), 3.6, 13);
  addSoftLight('SpaceportCb1Fill', 35.0, 4.6, -8.2, new Color3(1.0, 0.70, 0.42), 2.7, 11);

  return { meshes, lights };
}
