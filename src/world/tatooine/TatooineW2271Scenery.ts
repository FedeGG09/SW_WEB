import { Color3, Mesh, MeshBuilder, Scene, StandardMaterial } from '@babylonjs/core';

export interface TatooineW2271Midground { meshes: Mesh[]; materials: StandardMaterial[] }

/** Non-playable, fogged silhouette strip just outside the existing spaceport navigation bound. */
export function createTatooineW2271Midground(scene: Scene): TatooineW2271Midground {
  const materials = [
    new StandardMaterial('w2271_midground_adobe', scene),
    new StandardMaterial('w2271_midground_roof', scene),
    new StandardMaterial('w2271_midground_shadow', scene),
  ];
  materials[0].diffuseColor = new Color3(0.65, 0.52, 0.39);
  materials[1].diffuseColor = new Color3(0.48, 0.38, 0.28);
  materials[2].diffuseColor = new Color3(0.36, 0.31, 0.25);
  for (const material of materials) { material.specularColor = Color3.Black(); material.roughness = 1; }
  const groups = materials.map(() => [] as Mesh[]);
  const box = (name: string, x: number, y: number, z: number, w: number, h: number, d: number, group: number) => {
    const mesh = MeshBuilder.CreateBox(`w2271_mid_${name}`, { width: w, height: h, depth: d }, scene);
    mesh.position.set(x, y, z); mesh.material = materials[group]; mesh.isPickable = false; mesh.checkCollisions = false;
    mesh.applyFog = true; mesh.metadata = { w2271NonPlayableMidground: true, cameraBlocker: false, playable: false };
    groups[group].push(mesh);
  };
  const dome = (name: string, x: number, y: number, z: number, diameter: number, group: number) => {
    const mesh = MeshBuilder.CreateSphere(`w2271_mid_${name}`, { diameter, segments: 8, slice: 0.5 }, scene);
    mesh.position.set(x, y, z); mesh.scaling.y = 0.72; mesh.material = materials[group]; mesh.isPickable = false; mesh.checkCollisions = false;
    mesh.applyFog = true; mesh.metadata = { w2271NonPlayableMidground: true, cameraBlocker: false, playable: false };
    groups[group].push(mesh);
  };
  // Keep a broad gap on the central gate sightline and build stepped silhouettes on either side.
  const blocks = [
    [-108, -61, 9, 15, 11], [-83, -67, 13, 18, 13], [-57, -60, 7, 12, 9],
    [57, -63, 8, 13, 10], [83, -69, 15, 18, 14], [109, -60, 8, 15, 11],
  ] as const;
  blocks.forEach(([x, z, h, w, d], index) => {
    box(`block_${index}`, x, h / 2, z, w, h, d, index % 2 ? 0 : 0);
    box(`parapet_${index}`, x + (index % 2 ? 1.5 : -1.5), h + 0.38, z, w * 0.62, 0.76, d * 0.72, 1);
    if (index % 2 === 1) dome(`dome_${index}`, x, h + 1.5, z, 5.5, 0);
  });
  for (const [x, z, h] of [[-96, -73, 20], [-68, -67, 14], [68, -72, 16], [96, -76, 23]] as const) {
    const tower = MeshBuilder.CreateCylinder(`w2271_mid_tower_${x}`, { height: h, diameterTop: 2.8, diameterBottom: 4.6, tessellation: 7 }, scene);
    tower.position.set(x, h / 2, z); tower.material = materials[0]; tower.isPickable = false; tower.checkCollisions = false;
    tower.applyFog = true; tower.metadata = { w2271NonPlayableMidground: true, playable: false };
    groups[0].push(tower);
    box(`tower_cap_${x}`, x, h + 0.35, z, 4.2, 0.7, 4.2, 1);
  }
  const meshes: Mesh[] = [];
  for (let i = 0; i < groups.length; i++) {
    const sources = groups[i];
    // Some material groups are intentionally optional (for example the
    // shadow group in a sparse composition). Babylon cannot merge an empty
    // list, so an unused group must remain a no-op rather than aborting the
    // staged world load.
    if (sources.length === 0) continue;
    if (sources.length === 1) { meshes.push(sources[0]); continue; }
    let merged: Mesh | null = null;
    try { merged = Mesh.MergeMeshes(sources, true, true, undefined, false, false); }
    catch (error) {
      console.warn(`[W227.1] preserving midground group ${i} as ${sources.length} meshes after merge error`, error);
    }
    // Merge is only a draw-call optimization. If Babylon rejects a vertex
    // layout, keep valid source geometry so a visual pass is not lost.
    if (!merged) {
      meshes.push(...sources);
      continue;
    }
    merged.name = `w2271_midground_merged_${i}`; merged.material = materials[i]; merged.isPickable = false; merged.checkCollisions = false;
    merged.applyFog = true; merged.metadata = { w2271NonPlayableMidground: true, cameraBlocker: false, playable: false };
    meshes.push(merged);
  }
  return { meshes, materials };
}


export interface TatooineW2272FarCity { meshes: Mesh[]; materials: StandardMaterial[] }

/** Three merged, non-playable silhouette groups form a distant skyline without another GLB copy. */
export function createTatooineW2272FarCity(scene: Scene, centerX: number, centerZ: number, scale = 1, variant = 0): TatooineW2272FarCity {
  const materials = [
    new StandardMaterial('w2272_far_city_adobe', scene),
    new StandardMaterial('w2272_far_city_terrace', scene),
    new StandardMaterial('w2272_far_city_tower', scene),
  ];
  materials[0].diffuseColor = new Color3(0.70, 0.58, 0.44);
  materials[1].diffuseColor = new Color3(0.60, 0.48, 0.37);
  materials[2].diffuseColor = new Color3(0.66, 0.54, 0.40);
  for (const material of materials) {
    material.specularColor = Color3.Black();
    material.roughness = 1;
  }
  const groups = materials.map(() => [] as Mesh[]);
  const box = (name: string, x: number, w: number, h: number, d: number, materialIndex: number, y = 0, depthOffset = 0) => {
    const mesh = MeshBuilder.CreateBox(`w2272_far_${name}`, { width: w * scale, height: h * scale, depth: d * scale }, scene);
    mesh.position.set(centerX + x * scale, y + h * scale * 0.5, centerZ + depthOffset * scale);
    mesh.material = materials[materialIndex];
    mesh.isPickable = false;
    mesh.checkCollisions = false;
    mesh.applyFog = true;
    mesh.metadata = { w2272NonPlayableBackdrop: true, playable: false, cameraBlocker: false };
    groups[materialIndex].push(mesh);
  };
  const towers = [
    [-112, 12, 54, 14, -18], [-89, 10, 40, 13, 10], [-66, 15, 66, 16, -7], [-39, 11, 47, 14, 22],
    [-12, 17, 76, 18, -24], [21, 12, 55, 14, 13], [47, 18, 83, 19, -12], [78, 13, 60, 15, 25], [107, 15, 71, 17, -2],
  ] as const;
  for (let i = 0; i < towers.length; i++) {
    const [baseX, width, baseHeight, depth, depthOffset] = towers[i];
    const x = baseX + variant * (i % 2 ? -3.6 : 2.4);
    const height = baseHeight * (variant === 1 ? (i % 3 === 0 ? 0.8 : 0.65) : variant === 2 ? (i % 3 === 1 ? 1.12 : 0.88) : 1);
    box(`tower_${variant}_${i}`, x, width, height, depth, 0, 0, depthOffset);
    box(`crown_${variant}_${i}`, x + (i % 2 ? 1.1 : -0.8), width * 0.76, 1.1, depth * 0.82, 1, height * scale - 0.55 * scale, depthOffset);
    if (i % 2 === 0) box(`spire_${variant}_${i}`, x, width * 0.22, height * 0.2, depth * 0.22, 2, height * scale, depthOffset);
  }
  // Wider low-rise city blocks and domes fill gaps while preserving an uneven skyline.
  const blocks = [
    [-129, 24, 23, 19, 12], [-98, 21, 28, 22, -8], [-72, 25, 31, 20, 25], [-44, 23, 25, 18, -21],
    [-17, 26, 34, 22, 8], [13, 22, 27, 20, -14], [42, 27, 32, 23, 19], [73, 23, 29, 19, -25], [120, 25, 26, 22, 5],
  ] as const;
  blocks.forEach(([baseX, width, baseHeight, depth, depthOffset], i) => {
    const x = baseX + variant * (i % 2 ? 2.0 : -1.6);
    const height = baseHeight * (variant === 1 ? 0.76 : variant === 2 ? 1.08 : 1);
    box(`block_${variant}_${i}`, x, width, height, depth, i % 2 ? 0 : 1, 0, depthOffset);
    if (i % 3 === 1) {
      const dome = MeshBuilder.CreateSphere(`w2272_far_dome_${variant}_${i}`, { diameter: 13 * scale, segments: 7, slice: 0.5 }, scene);
      dome.position.set(centerX + x * scale, (height + 4.5) * scale, centerZ + (depthOffset + 2) * scale);
      dome.scaling.y = 0.67; dome.material = materials[1]; dome.isPickable = false;
      dome.checkCollisions = false; dome.applyFog = true;
      dome.metadata = { w2272NonPlayableBackdrop: true, playable: false, cameraBlocker: false };
      groups[1].push(dome);
    }
  });
  const meshes: Mesh[] = [];
  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    const merged = group.length === 1 ? group[0] : Mesh.MergeMeshes(group, true, true, undefined, false, false);
    if (!merged) throw new Error(`W227.2: failed to merge far city material group ${i}`);
    merged.name = `w2272_far_city_merged_${i}`;
    merged.material = materials[i]; merged.isPickable = false; merged.checkCollisions = false; merged.applyFog = true;
    merged.metadata = { w2272NonPlayableBackdrop: true, playable: false, cameraBlocker: false };
    meshes.push(merged);
  }
  return { meshes, materials };
}
