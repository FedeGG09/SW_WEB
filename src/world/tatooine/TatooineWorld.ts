import { AbstractMesh, AnimationGroup, AssetContainer, Color3, Color4, DirectionalLight, DynamicTexture, HemisphericLight, LoadAssetContainerAsync, Material, Mesh, MeshBuilder, Observer, PBRMaterial, Scene, StandardMaterial, Texture, TransformNode, Vector3, VertexData } from '@babylonjs/core';
import { AssetLoader, ImportedAsset } from '../../assets/AssetLoader';
import { TrainingDummy } from '../../combat/TrainingDummy';
import { InteractionSystem } from '../../interaction/InteractionSystem';
import { PlayerController } from '../../player/PlayerController';
import { SceneId, SpawnId } from '../../game/GameState';
import { SimpleCollisionWorld } from '../SimpleCollisionWorld';
import { TatooineBounds, TatooineNavigation } from './TatooineNavigation';
import { tatooineAssetUrl, TatooineAssetKey, TatooineSceneId, TATOOINE_ZONES } from './TatooineCatalog';
import { TatooinePopulation } from './TatooinePopulation';
import { DialogueSystem } from '../../dialogue/DialogueSystem';
import { QuestSystem } from '../../quests/QuestSystem';
import { TATOOINE_VISUAL, TATOOINE_VISUAL_PROMOTED } from './TatooineVisualConfig';
import { W225_FIREFLY_SCALE, W225_PAD_FLOOR_Y, W225_PAD_SCALE, W225_PADS, W225_PRODUCTION_FIREFLY, W225_PRODUCTION_SPACEPORT, W225_PROMOTED, W225_STAGING_ASSETS } from './TatooineSpaceportConfig';
import { W225_1_ARRIVAL_SPAWN, W225_1_DOCK_SCALE, W225_1_DOCK_FOOTPRINT, W225_1_PADS, W225_1_PRODUCTION_SERVICE_DOCK, W225_1_PROMOTED, W225_1_RETURN_SPAWN, W225_1_STAGING_ASSETS } from './TatooineServiceDockConfig';
import { W226_ANTENNA, W226_APRON, W226_ARRIVAL_SPAWN, W226_DRESSING_ANCHORS, W226_DROID_PLACEMENTS, W226_PAD_CENTERS, W226_PROMOTED, W226_PRODUCTION_ASSETS, W226_STAGE_QUERY, W226_STAGING_ASSETS } from './TatooineW226Config';
import { createTatooineMacroArchitecture } from './TatooineMacroArchitecture';
import { normalizeNodeToFootprint, normalizeNodeToHeight, TATOOINE_TARGET_METERS } from './TatooineScaleCatalog';
import { W2271_ASSET_ROOT, W2271_SCENIC } from './TatooineW2271Config';
import { W2272_ASSET_ROOT, W2272_SCENIC } from './TatooineW2272Config';
import { W2273_ASSET_ROOT, W2273_GROUND } from './TatooineW2273Config';
import { W2273B_ASSET_ROOT, W2273B_FLAG_ASSET, W2273B_FLAGS } from './TatooineW2273BConfig';
import { W2273C_APRONS, W2273C_ASSET_ROOT, W2273C_FLAGS, W2273C_ROUTES } from './TatooineW2273CConfig';
import { createTatooineW2271Midground, createTatooineW2272FarCity } from './TatooineW2271Scenery';
import { freezeStaticMeshes, mergeStaticMeshes } from '../StaticMeshOptimizer';

export interface TatooineLivingOptions { enabled: boolean; stagedActors: boolean; dialogue?: DialogueSystem; quest?: QuestSystem }
function w2251Staged() {
  const query = typeof location === 'undefined' ? new URLSearchParams() : new URLSearchParams(location.search);
  return import.meta.env.DEV && (query.get('w2251Stage') === '1' || query.get(W226_STAGE_QUERY) === '1');
}
function w2251Active() { return W225_1_PROMOTED || w2251Staged(); }
function w226Staged() {
  const query = typeof location === 'undefined' ? new URLSearchParams() : new URLSearchParams(location.search);
  return import.meta.env.DEV && query.get(W226_STAGE_QUERY) === '1';
}
function w226Active() { return W226_PROMOTED || w226Staged(); }
function w227ScenicStaged() {
  const query = typeof location === 'undefined' ? new URLSearchParams() : new URLSearchParams(location.search);
  return import.meta.env.DEV && query.get('w227Stage') === '1';
}
function w2271ScenicStaged() {
  const query = typeof location === 'undefined' ? new URLSearchParams() : new URLSearchParams(location.search);
  return import.meta.env.DEV && query.get('w227Stage') === '1' && query.get('w2271Stage') === '1';
}
function w2272ScenicStaged() {
  const query = typeof location === 'undefined' ? new URLSearchParams() : new URLSearchParams(location.search);
  return import.meta.env.DEV && query.get('w226Stage') === '1' && query.get('w227Stage') === '1'
    && query.get('w2271Stage') === '1' && query.get('w2272Stage') === '1';
}
function w2273GroundStaged() {
  const query = typeof location === 'undefined' ? new URLSearchParams() : new URLSearchParams(location.search);
  return import.meta.env.DEV && query.get('w226Stage') === '1' && query.get('w227Stage') === '1'
    && query.get('w2271Stage') === '1' && query.get('w2272Stage') === '1' && query.get('w2273Stage') === '1';
}
function w2273bStaged() {
  const query = typeof location === 'undefined' ? new URLSearchParams() : new URLSearchParams(location.search);
  return import.meta.env.DEV && query.get('w226Stage') === '1' && query.get('w227Stage') === '1'
    && query.get('w2271Stage') === '1' && query.get('w2272Stage') === '1'
    && query.get('w2273Stage') === '1' && query.get('w2273bStage') === '1';
}
function w2273cStaged() {
  const query = typeof location === 'undefined' ? new URLSearchParams() : new URLSearchParams(location.search);
  return w2273bStaged() && import.meta.env.DEV && query.get('w2273cStage') === '1';
}
function w2273cGroundStaged() { return w2273cStaged() && typeof location !== 'undefined' && new URLSearchParams(location.search).get('w2273cGround') !== '0'; }
function w2273bGroundStaged() { return w2273bStaged() && typeof location !== 'undefined' && new URLSearchParams(location.search).get('w2273bGround') !== '0'; }
function w226Asset(path: 'maintenance_kit.glb' | 'crate1_low.glb' | 'pit_droid_spaceport_v1.glb' | 'antenna_7m.glb') {
  const stagedPaths = {
    'maintenance_kit.glb': 'maintenance/maintenance_kit.glb',
    'crate1_low.glb': 'kitbash/crate1_low.glb',
    'pit_droid_spaceport_v1.glb': 'creatures/pit_droid_spaceport_v1.glb',
    'antenna_7m.glb': 'landmarks/antenna_7m.glb',
  };
  return w226Staged() ? `${W226_STAGING_ASSETS}${stagedPaths[path]}` : `${W226_PRODUCTION_ASSETS}${path}`;
}

export interface TatooinePortal { label: string; destination: SceneId; spawn: SpawnId; position: Vector3 }
type W225ServicePad = Omit<(typeof W225_1_PADS)[number], 'x'> & { x: number };
/** Owns one sector. Original GLBs, character assets and shared controllers are immutable. */
export class TatooineWorld {
  readonly assets: ImportedAsset[] = [];
  readonly portals: TatooinePortal[] = [];
  readonly collision: SimpleCollisionWorld;
  navigation!: TatooineNavigation;
  trainingDummy?: TrainingDummy;
  population?: TatooinePopulation;
  get pyke() { return this.population?.pyke; }
  get rancor() { return this.population?.rancor; }
  private readonly meshes: AbstractMesh[] = [];
  private readonly materials: Array<StandardMaterial | PBRMaterial> = [];
  private readonly textures: Array<DynamicTexture | Texture> = [];
  private readonly lights: Array<HemisphericLight | DirectionalLight> = [];
  private readonly clonedRoots: TransformNode[] = [];
  private readonly flagContainers: AssetContainer[] = [];
  private readonly flagInstances: Array<{ dispose: () => void; animationGroups: AnimationGroup[]; rootNodes: Array<{ parent: unknown; getChildMeshes?: (directDescendantsOnly?: boolean) => AbstractMesh[] }> }> = [];
  private panel?: HTMLDivElement;
  private observer?: Observer<Scene>;
  private oldQuestDisplay = '';
  private readonly started = performance.now();
  private readonly previousSceneSettings: { clear: Color4; fogMode: number; fogDensity: number; fogStart: number; fogEnd: number; fogColor: Color3 };
  private readonly previousHardwareScalingLevel: number;
  loadMilliseconds = 0;
  private constructor(private readonly scene: Scene, private readonly loader: AssetLoader,
    private readonly player: PlayerController, private readonly interaction: InteractionSystem,
    readonly sceneId: TatooineSceneId, private readonly staged: boolean,
    private readonly travel: (scene: SceneId, spawn: SpawnId) => Promise<void>,
    private readonly canTravel: () => boolean, private readonly progress: (fraction: number, label: string) => void,
    private readonly living?: TatooineLivingOptions) {
    this.collision = new SimpleCollisionWorld(scene);
    this.previousSceneSettings = { clear: scene.clearColor.clone(), fogMode: scene.fogMode, fogDensity: scene.fogDensity,
      fogStart: scene.fogStart, fogEnd: scene.fogEnd, fogColor: scene.fogColor.clone() };
    const engine = scene.getEngine();
    this.previousHardwareScalingLevel = engine.getHardwareScalingLevel();
    if (w2272ScenicStaged() && sceneId === 'tatooineSpaceport') engine.setHardwareScalingLevel(this.previousHardwareScalingLevel * 1.12);
  }
  static async create(scene: Scene, loader: AssetLoader, player: PlayerController, interaction: InteractionSystem,
    id: TatooineSceneId, spawn: SpawnId, staged: boolean,
    travel: (scene: SceneId, spawn: SpawnId) => Promise<void>, canTravel: () => boolean,
    progress: (fraction: number, label: string) => void, living?: TatooineLivingOptions) {
    const world = new TatooineWorld(scene, loader, player, interaction, id, staged, travel, canTravel, progress, living);
    try { await world.build(spawn); return world; } catch (error) { world.dispose(); throw error; }
  }
  private material(name: string, color: Color3) {
    const material = new StandardMaterial(`w223_${name}`, this.scene);
    material.diffuseColor = color; material.specularColor = new Color3(0.03, 0.03, 0.03);
    this.materials.push(material); return material;
  }
  private visualTexture(root: string, name: string) {
    const version = root === W2272_ASSET_ROOT ? '?v=2272c' : '';
    const texture = new Texture(`${root}/${name}${version}`, this.scene, false, false);
    this.textures.push(texture);
    return texture;
  }
  private installDesertSky(textureRoot: string) {
    const sky = MeshBuilder.CreateSphere('w2241_sky', { diameter: 500, segments: 32 }, this.scene);
    sky.infiniteDistance = true; sky.isPickable = false;
    const material = this.material('w2241_sky', Color3.Black());
    material.backFaceCulling = false; material.disableDepthWrite = true;
    material.fogEnabled = false;
    material.emissiveTexture = this.visualTexture(textureRoot, 'tatooine_sky.png');
    sky.material = material; this.meshes.push(sky);
  }
  private installDesertSuns(textureRoot: string) {
    const texture = this.visualTexture(textureRoot, 'binary_sun.png');
    texture.hasAlpha = true;
    const material = this.material('w2241_binary_suns', Color3.White());
    material.diffuseTexture = texture; material.useAlphaFromDiffuseTexture = true;
    material.emissiveTexture = texture;
    if (w2272ScenicStaged() && this.sceneId === 'tatooineSpaceport') {
      material.diffuseColor = Color3.White(); material.emissiveColor = Color3.White(); material.disableLighting = true;
    } else material.diffuseColor = Color3.Black();
    material.disableDepthWrite = true; material.fogEnabled = false;
    material.transparencyMode = Material.MATERIAL_ALPHABLEND; material.backFaceCulling = false;
    for (let i = 0; i < 2; i++) {
      const w2272Spaceport = w2272ScenicStaged() && this.sceneId === 'tatooineSpaceport';
      const sun = MeshBuilder.CreatePlane(`w2241_sun_${i}`, { size: w2272Spaceport ? W2272_SCENIC.suns[i].size : (i ? 29 : 35) }, this.scene);
      if (w2272Spaceport) {
        const profile = W2272_SCENIC.suns[i]; sun.position.set(profile.x, profile.y, profile.z);
      } else sun.position.set(-18 + i * 26, 13 + i * 4, 120);
      sun.billboardMode = 7; sun.isPickable = false; sun.material = material; this.meshes.push(sun);
    }
  }
  private desertSand(textureRoot: string) {
    const w2273Material = (w2273GroundStaged() || w2273bGroundStaged()) && this.sceneId === 'tatooineSpaceport';
    const w2272Material = w2272ScenicStaged() && this.sceneId === 'tatooineSpaceport';
    const stagedMaterial = w2271ScenicStaged() && this.sceneId === 'tatooineSpaceport';
    const root = w2273Material ? W2273_ASSET_ROOT : w2272Material ? W2272_ASSET_ROOT : textureRoot;
    const albedo = this.visualTexture(root, w2273Material ? 'spaceport_sand_albedo.png' : 'sand_albedo.png');
    const normal = w2272Material ? undefined : this.visualTexture(root, 'sand_normal.png');
    const tileCount = w2273Material ? W2273_GROUND.sandTileCount : w2272Material ? W2272_SCENIC.sandTileCount : stagedMaterial ? W2271_SCENIC.sandTileCount : TATOOINE_VISUAL.sandTileCount;
    for (const texture of normal ? [albedo, normal] : [albedo]) {
      texture.uScale = tileCount; texture.vScale = tileCount;
      texture.wrapU = Texture.WRAP_ADDRESSMODE; texture.wrapV = Texture.WRAP_ADDRESSMODE;
      texture.anisotropicFilteringLevel = 4;
    }
    if (normal) normal.level = stagedMaterial ? W2271_SCENIC.sandBumpLevel : TATOOINE_VISUAL.sandBumpLevel;
    if (stagedMaterial) {
      const pbr = new PBRMaterial('w2271_sand_pbr', this.scene); pbr.albedoTexture = albedo; if (normal) pbr.bumpTexture = normal;
      pbr.albedoColor = Color3.White(); pbr.metallic = 0; pbr.roughness = 0.96; this.materials.push(pbr); return pbr;
    }
    const material = this.material('w2241_sand', Color3.White());
    material.diffuseTexture = albedo; if (normal) material.bumpTexture = normal;
    material.specularColor = new Color3(0.015, 0.012, 0.008);
    return material;
  }
  /** Visual-only W227.3 tire-worn routes. Geometry is independent of navigation/collision. */
  private installW2273GroundLanguage() {
    if (w2273cGroundStaged() && this.sceneId === 'tatooineSpaceport') { this.installW2273CGroundLanguage(); return; }
    if (!w2273GroundStaged() || this.sceneId !== 'tatooineSpaceport') return;
    const track = new Texture(`${w2273bGroundStaged() ? W2273B_ASSET_ROOT : W2273_ASSET_ROOT}/${w2273bGroundStaged() ? 'compacted_route_b.png?v=2273b' : 'compacted_route.png?v=2273a'}`, this.scene, false, false);
    track.hasAlpha = true; track.wrapU = Texture.CLAMP_ADDRESSMODE; track.wrapV = Texture.WRAP_ADDRESSMODE;
    track.uScale = 1; track.vScale = 1; track.anisotropicFilteringLevel = 4; this.textures.push(track);
    const routeMaterial = this.material('w2273_compacted_route', Color3.White());
    routeMaterial.diffuseTexture = track; routeMaterial.useAlphaFromDiffuseTexture = true;
    routeMaterial.transparencyMode = Material.MATERIAL_ALPHABLEND; routeMaterial.disableDepthWrite = true;
    routeMaterial.backFaceCulling = false; routeMaterial.specularColor = Color3.Black();
    routeMaterial.fogEnabled = false;

    const positions: number[] = [], indices: number[] = [], uvs: number[] = [];
    for (const route of W2273_GROUND.routes) {
      const points = route.points, firstVertex = positions.length / 3;
      let distance = 0;
      for (let i = 0; i < points.length; i++) {
        const point = points[i], previous = points[Math.max(0, i - 1)], next = points[Math.min(points.length - 1, i + 1)];
        const dx = next.x - previous.x, dz = next.z - previous.z;
        const length = Math.max(0.001, Math.hypot(dx, dz));
        const nx = -dz / length, nz = dx / length;
        if (i > 0) distance += Math.hypot(point.x - points[i - 1].x, point.z - points[i - 1].z);
        const taper = Math.min(1, 0.28 + Math.min(i, points.length - 1 - i) * 0.36);
        const halfWidth = point.width * 0.5 * taper;
        const edgeJitter = Math.sin(i * 2.17 + route.phase) * 0.22;
        const left = halfWidth + edgeJitter, right = halfWidth - edgeJitter;
        positions.push(point.x + nx * left, route.y, point.z + nz * left,
          point.x - nx * right, route.y, point.z - nz * right);
        uvs.push(0, distance / W2273_GROUND.textureRepeatMeters, 1, distance / W2273_GROUND.textureRepeatMeters);
        if (i < points.length - 1) {
          const base = firstVertex + i * 2;
          indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
        }
      }
    }
    const mesh = new Mesh('w2273_ground_routes_merged', this.scene);
    const normals: number[] = [];
    VertexData.ComputeNormals(positions, indices, normals);
    const vertexData = new VertexData(); vertexData.positions = positions; vertexData.indices = indices;
    vertexData.normals = normals; vertexData.uvs = uvs; vertexData.applyToMesh(mesh, false);
    mesh.material = routeMaterial; mesh.isPickable = false; mesh.checkCollisions = false;
    mesh.metadata = { w2273GroundDecal: true, cameraBlocker: false, navigationNeutral: true, sourcePaths: W2273_GROUND.routes.length };
    mesh.freezeWorldMatrix(); this.meshes.push(mesh);
  }
  /** W227.3C: organic visual road silhouette, merged to one non-colliding overlay mesh. */
  private installW2273CGroundLanguage() {
    if (!w2273cGroundStaged() || this.sceneId !== 'tatooineSpaceport') return;
    // W225 laid visual slabs over the independent navigation grid. Hide only
    // those render meshes in C so the irregular surface below can define the
    // road silhouette; no collision/navigation objects are changed.
    const legacyGroundNames = new Set([
      'service_dock_approach_A', 'service_dock_approach_B', 'service_dock_approach_C',
      'service_dock_cross_corridor', 'service_dock_city_corridor',
      'cross_corridor', 'city_corridor',
    ]);
    for (const mesh of this.scene.meshes) {
      if (legacyGroundNames.has(mesh.name)) {
        mesh.isVisible = false;
        mesh.isPickable = false;
        mesh.checkCollisions = false;
        mesh.metadata = { ...mesh.metadata, w2273cVisualGroundReplaced: true, navigationNeutral: true };
      }
    }
    const track = new Texture(`${W2273C_ASSET_ROOT}/compacted_route_b.png?v=2273c`, this.scene, false, false);
    track.hasAlpha = true; track.wrapU = Texture.CLAMP_ADDRESSMODE; track.wrapV = Texture.WRAP_ADDRESSMODE;
    track.uScale = 1; track.vScale = 1; track.anisotropicFilteringLevel = 4; this.textures.push(track);
    const material = this.material('w2273c_organic_compacted_ground', Color3.White());
    material.diffuseTexture = track; material.useAlphaFromDiffuseTexture = true;
    material.transparencyMode = Material.MATERIAL_ALPHABLEND; material.disableDepthWrite = true;
    material.backFaceCulling = false; material.specularColor = Color3.Black(); material.fogEnabled = false;
    material.diffuseColor = new Color3(0.88, 0.77, 0.62);

    const positions: number[] = [], indices: number[] = [], uvs: number[] = [], colors: number[] = [];
    const addApron = (points: readonly (readonly [number, number])[], y: number) => {
      const first = positions.length / 3;
      const centerX = points.reduce((sum, p) => sum + p[0], 0) / points.length;
      const centerZ = points.reduce((sum, p) => sum + p[1], 0) / points.length;
      const footprintScale = 0.68;
      const irregularPoints = points.map(([x, z]) => [centerX + (x - centerX) * footprintScale, centerZ + (z - centerZ) * footprintScale] as const);
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const [x, z] of irregularPoints) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
      positions.push(centerX, y, centerZ); uvs.push(0.5, 0.5); colors.push(0.91, 0.79, 0.63, 0.82);
      for (const [x, z] of irregularPoints) { positions.push(x, y, z); uvs.push((x - minX) / Math.max(1, maxX - minX), (z - minZ) / Math.max(1, maxZ - minZ)); colors.push(0.91, 0.79, 0.63, 0.82); }
      for (let i = 0; i < irregularPoints.length; i++) indices.push(first, first + 1 + i, first + 1 + ((i + 1) % irregularPoints.length));
    };
    for (const apron of W2273C_APRONS) addApron(apron.points as readonly (readonly [number, number])[], apron.y);

    for (const route of W2273C_ROUTES) {
      const stations: Array<{ x: number; z: number; width: number }> = [];
      const points = route.points;
      for (let segment = 0; segment < points.length - 1; segment++) {
        const a = points[segment], b = points[segment + 1], steps = 5;
        for (let step = 0; step < steps; step++) {
          const t = step / steps;
          stations.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, width: a.width + (b.width - a.width) * t });
        }
      }
      const last = points[points.length - 1]; stations.push({ x: last.x, z: last.z, width: last.width });
      const first = positions.length / 3;
      let distance = 0;
      for (let i = 0; i < stations.length; i++) {
        const p = stations[i], prev = stations[Math.max(0, i - 1)], next = stations[Math.min(stations.length - 1, i + 1)];
        const dx = next.x - prev.x, dz = next.z - prev.z, length = Math.max(0.001, Math.hypot(dx, dz));
        if (i > 0) distance += Math.hypot(p.x - prev.x, p.z - prev.z);
        const nx = -dz / length, nz = dx / length;
        const wave = Math.sin(i * 0.47 + route.phase) * route.amplitude + Math.sin(i * 0.19 + route.phase * 2) * route.amplitude * 0.45;
        const centerX = p.x + nx * wave, centerZ = p.z + nz * wave;
        const width = p.width * (0.88 + 0.11 * Math.sin(i * 0.71 + route.phase));
        const left = width * (0.47 + 0.07 * Math.sin(i * 0.83 + route.phase)), right = width - left;
        positions.push(centerX + nx * left, route.y, centerZ + nz * left,
          centerX - nx * right, route.y, centerZ - nz * right);
        // A distinct but dusty warm value makes the compacted travel path read
        // from gameplay distance while letting the tile retain surface detail.
        colors.push(0.84, 0.72, 0.56, 0.94, 0.84, 0.72, 0.56, 0.94);
        uvs.push(0, distance / 17, 1, distance / 17);
        if (i < stations.length - 1) { const base = first + i * 2; indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2); }
      }
    }
    const mesh = new Mesh('w2273c_irregular_aprons_and_routes', this.scene);
    const normals: number[] = []; VertexData.ComputeNormals(positions, indices, normals);
    const data = new VertexData(); data.positions = positions; data.indices = indices; data.normals = normals; data.uvs = uvs; data.colors = colors; data.applyToMesh(mesh, false);
    mesh.useVertexColors = true; mesh.hasVertexAlpha = true;
    mesh.material = material; mesh.isPickable = false; mesh.checkCollisions = false;
    mesh.metadata = { w2273cGround: true, cameraBlocker: false, navigationNeutral: true, sourceAprons: 3, sourceRibbons: W2273C_ROUTES.length };
    mesh.freezeWorldMatrix(); this.meshes.push(mesh);
    console.info('[W227.3C] irregular visual ground installed', { meshes: 1, aprons: 3, routeRibbons: W2273C_ROUTES.length, collidersChanged: false });
  }

  /** W227.3C: one or two animated hero banners; all remaining banners share static instanced geometry/material. */
  private async installW2273CFlags() {
    const query = new URLSearchParams(location.search);
    const requested = Number(query.get('w2273cFlags') ?? '9');
    const count = requested >= 9 ? 9 : requested >= 6 ? 6 : 3;
    const heroCount = query.get('w2273cHeroes') === '2' ? 2 : 1;
    const placements = W2273C_FLAGS.slice(0, count);
    const container = await LoadAssetContainerAsync(W2273B_FLAG_ASSET, this.scene);
    this.flagContainers.push(container);
    const donorCloth = container.meshes.find(mesh => Boolean((mesh as Mesh).skeleton)) as Mesh | undefined;
    if (!donorCloth?.material) throw new Error('W227.3C: donor cloth/material missing');
    const sharedClothMaterial = donorCloth.material;
    sharedClothMaterial.backFaceCulling = false;
    const mastMaterial = this.material('w2273c_flag_mast', new Color3(0.25, 0.22, 0.18));
    let heroesLeft = heroCount;
    const cheap: typeof placements[number][] = [];
    const animated: typeof placements[number][] = [];
    for (const placement of placements) {
      if (placement.hero && heroesLeft > 0) { animated.push(placement); heroesLeft--; }
      else cheap.push(placement);
    }

    for (const placement of animated) {
      const entries = container.instantiateModelsToScene(name => `${name}_w2273c_${placement.id}`, false, { doNotInstantiate: true });
      this.flagInstances.push(entries);
      const wrapper = new TransformNode(`w2273c_hero_flag_${placement.id}`, this.scene);
      for (const node of entries.rootNodes) node.parent = wrapper;
      wrapper.rotation.set(0, placement.yaw, 0); wrapper.computeWorldMatrix(true);
      const importedMeshes = wrapper.getChildMeshes(false);
      const cloth = importedMeshes.find(mesh => Boolean((mesh as Mesh).skeleton));
      if (!cloth) throw new Error(`W227.3C: skinned cloth missing for ${placement.id}`);
      for (const mesh of importedMeshes) if (mesh !== cloth) { mesh.isVisible = false; mesh.isPickable = false; mesh.checkCollisions = false; }
      if (cloth.material) cloth.material.backFaceCulling = false;
      cloth.computeWorldMatrix(true);
      let bounds = cloth.getBoundingInfo().boundingBox;
      const sourceHeight = Math.max(0.001, bounds.maximumWorld.y - bounds.minimumWorld.y);
      const clothHeight = placement.targetHeight * 0.65;
      wrapper.scaling.setAll(clothHeight / sourceHeight); wrapper.computeWorldMatrix(true); cloth.computeWorldMatrix(true);
      bounds = cloth.getBoundingInfo().boundingBox;
      wrapper.position.set(placement.x - (bounds.minimumWorld.x + bounds.maximumWorld.x) * 0.5,
        placement.y + placement.targetHeight * 0.31 - bounds.minimumWorld.y,
        placement.z - (bounds.minimumWorld.z + bounds.maximumWorld.z) * 0.5);
      wrapper.computeWorldMatrix(true); wrapper.freezeWorldMatrix(); this.clonedRoots.push(wrapper);
      cloth.isPickable = false; cloth.checkCollisions = false;
      cloth.metadata = { ...cloth.metadata, w2273cFlagHero: true, cameraBlocker: false, navigationNeutral: true };
      const mast = MeshBuilder.CreateCylinder(`w2273c_hero_mast_${placement.id}`, { height: placement.targetHeight, diameter: 0.075, tessellation: 6 }, this.scene);
      mast.position.set(placement.x, placement.y + placement.targetHeight * 0.5, placement.z); mast.rotation.y = placement.yaw;
      mast.material = mastMaterial; mast.isPickable = false; mast.checkCollisions = false; mast.freezeWorldMatrix();
      mast.metadata = { w2273cFlagMast: true, cameraBlocker: false, navigationNeutral: true }; this.meshes.push(mast);
      for (const group of entries.animationGroups) {
        group.start(true, placement.speed, group.from, group.to);
        group.goToFrame(group.from + (group.to - group.from) * (placement.phase / 3.96 % 1));
      }
    }

    if (cheap.length) {
      const first = cheap[0], firstClothHeight = first.targetHeight * 0.65;
      const banner = MeshBuilder.CreatePlane('w2273c_shared_static_banner', { width: firstClothHeight * 0.72, height: firstClothHeight }, this.scene);
      banner.position.set(first.x, first.y + first.targetHeight * 0.31 + firstClothHeight * 0.5, first.z);
      banner.rotation.set(0, first.yaw, (cheap.length % 2 ? 0.025 : -0.025));
      banner.material = sharedClothMaterial; banner.isPickable = false; banner.checkCollisions = false;
      banner.metadata = { w2273cCheapFlagBatch: true, cameraBlocker: false, navigationNeutral: true };
      banner.freezeWorldMatrix(); this.meshes.push(banner);
      const mast = MeshBuilder.CreateCylinder('w2273c_shared_static_mast', { height: 1, diameter: 0.075, tessellation: 6 }, this.scene);
      mast.position.set(first.x, first.y + first.targetHeight * 0.5, first.z); mast.rotation.y = first.yaw; mast.scaling.y = first.targetHeight;
      mast.material = mastMaterial; mast.isPickable = false; mast.checkCollisions = false;
      mast.metadata = { w2273cCheapMastBatch: true, cameraBlocker: false, navigationNeutral: true };
      mast.freezeWorldMatrix(); this.meshes.push(mast);
      for (const placement of cheap.slice(1)) {
        const clothHeight = placement.targetHeight * 0.65;
        const flag = banner.createInstance(`w2273c_static_flag_${placement.id}`);
        flag.position.set(placement.x, placement.y + placement.targetHeight * 0.31 + clothHeight * 0.5, placement.z);
        flag.scaling.set(clothHeight / firstClothHeight, clothHeight / firstClothHeight, 1);
        flag.rotation.set(0, placement.yaw, ((Math.round(placement.phase * 100) % 2) ? 1 : -1) * 0.025);
        flag.isPickable = false; flag.checkCollisions = false;
        flag.metadata = { w2273cCheapFlag: true, cameraBlocker: false, navigationNeutral: true }; flag.freezeWorldMatrix(); this.meshes.push(flag);
        const pole = mast.createInstance(`w2273c_static_mast_${placement.id}`);
        pole.position.set(placement.x, placement.y + placement.targetHeight * 0.5, placement.z);
        pole.scaling.y = placement.targetHeight; pole.rotation.y = placement.yaw;
        pole.isPickable = false; pole.checkCollisions = false;
        pole.metadata = { w2273cCheapMast: true, cameraBlocker: false, navigationNeutral: true }; pole.freezeWorldMatrix(); this.meshes.push(pole);
      }
    }
    console.info('[W227.3C] economical flags installed', { count, animated: animated.length, cheapStatic: cheap.length, animationGroups: animated.length, sharedClothMaterial: true });
  }

  /** W227.3B flags: share one GLB container, animate independent cloth clones and replace donor-scale masts with meter-scaled runtime poles. */
  private async installW2273BFlags() {
    if (!w2273bStaged() || this.sceneId !== 'tatooineSpaceport') return;
    if (w2273cStaged()) { await this.installW2273CFlags(); return; }
    const query = new URLSearchParams(location.search);
    const requested = Number(query.get('w2273bFlags') ?? '9');
    const count = requested >= 9 ? 9 : requested >= 6 ? 6 : 3;
    const container = await LoadAssetContainerAsync(W2273B_FLAG_ASSET, this.scene);
    this.flagContainers.push(container);
    const placementReport: Array<{ id: string; scale: number; sourceClothHeight: number; targetClothHeight: number; bounds: number[]; renderableMeshes: number; hiddenDonorMeshes: number; animationGroups: number }> = [];
    const mastMaterial = this.material('w2273b_flag_mast', new Color3(0.25, 0.22, 0.18));
    for (const placement of W2273B_FLAGS.slice(0, count)) {
      const entries = container.instantiateModelsToScene(name => `${name}_w2273b_${placement.id}`, false, { doNotInstantiate: true });
      this.flagInstances.push(entries);
      const wrapper = new TransformNode(`w2273b_flag_${placement.id}`, this.scene);
      for (const node of entries.rootNodes) node.parent = wrapper;
      wrapper.rotation.set(0, placement.yaw, 0); wrapper.computeWorldMatrix(true);
      const importedMeshes = wrapper.getChildMeshes(false);
      const cloth = importedMeshes.find(mesh => Boolean((mesh as Mesh).skeleton));
      if (!cloth) throw new Error(`W227.3B: skinned cloth missing for ${placement.id}`);
      // The donor GLB contains an 18.6 m mast around a ~6 m cloth. Keep its animated cloth and replace both oversized static poles.
      for (const mesh of importedMeshes) if (mesh !== cloth) { mesh.isVisible = false; mesh.isPickable = false; mesh.checkCollisions = false; }
      // The donor cloth is already vertical on world Y, but its plane normal is X; facade yaw below turns its visible face toward the arrival (+Z) view.
      if (cloth.material) cloth.material.backFaceCulling = false;
      cloth.computeWorldMatrix(true);
      let bounds = cloth.getBoundingInfo().boundingBox;
      const sourceClothHeight = Math.max(0.001, bounds.maximumWorld.y - bounds.minimumWorld.y);
      const targetClothHeight = placement.targetHeight * 0.65;
      const scale = targetClothHeight / sourceClothHeight;
      wrapper.scaling.setAll(scale); wrapper.computeWorldMatrix(true); cloth.computeWorldMatrix(true);
      bounds = cloth.getBoundingInfo().boundingBox;
      const min = bounds.minimumWorld, max = bounds.maximumWorld;
      wrapper.position.set(placement.x - (min.x + max.x) * 0.5,
        placement.y + placement.targetHeight * 0.31 - min.y,
        placement.z - (min.z + max.z) * 0.5);
      wrapper.computeWorldMatrix(true); wrapper.freezeWorldMatrix(); this.clonedRoots.push(wrapper);
      cloth.isPickable = false; cloth.checkCollisions = false;
      cloth.metadata = { ...cloth.metadata, w2273bFlag: true, cameraBlocker: false, navigationNeutral: true };
      const mast = MeshBuilder.CreateCylinder(`w2273b_flag_mast_${placement.id}`, { height: placement.targetHeight, diameter: 0.085, tessellation: 6 }, this.scene);
      mast.position.set(placement.x, placement.y + placement.targetHeight * 0.5, placement.z);
      mast.material = mastMaterial; mast.isPickable = false; mast.checkCollisions = false;
      mast.metadata = { w2273bFlagMast: true, cameraBlocker: false, navigationNeutral: true };
      mast.freezeWorldMatrix(); this.meshes.push(mast);
      for (const group of entries.animationGroups) {
        const from = group.from, to = group.to; group.start(true, placement.speed, from, to);
        group.goToFrame(from + (to - from) * (placement.phase / 3.96 % 1));
      }      placementReport.push({ id: placement.id, scale: Number(scale.toFixed(5)), sourceClothHeight: Number(sourceClothHeight.toFixed(3)),
        targetClothHeight: Number(targetClothHeight.toFixed(3)), bounds: [Number(min.x.toFixed(2)), Number(min.y.toFixed(2)), Number(min.z.toFixed(2)),
          Number(max.x.toFixed(2)), Number(max.y.toFixed(2)), Number(max.z.toFixed(2))], renderableMeshes: 2, hiddenDonorMeshes: Math.max(0, importedMeshes.length - 1), animationGroups: entries.animationGroups.length });
    }
    console.info(`[W227.3B] animated flags ${JSON.stringify({ count, source: W2273B_FLAG_ASSET, sharedContainer: true, clothAnimationIndependent: true, instances: placementReport })}`);
  }
  private async place(key: TatooineAssetKey, position: Vector3, scale = 1, floorName?: string, floorY?: number) {
    this.progress(0.45, `Tatooine: ${key}`);
    const asset = await this.loader.load(tatooineAssetUrl(key, this.staged), this.scene);
    this.assets.push(asset); asset.animationGroups.forEach(group => group.stop());
    asset.root.scaling.setAll(scale);
    const candidates = floorName ? asset.meshes.filter(m => m.name.includes(floorName)) : asset.meshes.filter(m => m.getTotalVertices() > 0);
    if (!candidates.length) throw new Error(`Tatooine: missing floor ${floorName}`);
    const min = new Vector3(Infinity, Infinity, Infinity), max = new Vector3(-Infinity, -Infinity, -Infinity);
    for (const mesh of candidates) {
      mesh.computeWorldMatrix(true); const box = mesh.getBoundingInfo().boundingBox;
      min.minimizeInPlace(box.minimumWorld); max.maximizeInPlace(box.maximumWorld);
    }
    asset.root.position.set(position.x - (min.x + max.x) / 2, position.y - (floorY === undefined ? min.y : floorY * scale), position.z - (min.z + max.z) / 2);
    for (const mesh of asset.meshes) {
      mesh.computeWorldMatrix(true); mesh.isPickable = true;
      mesh.metadata = { ...mesh.metadata, cameraBlocker: true, w223Environment: true };
      if (['cantinaExterior', 'filler', 'market', 'boss', 'cantina'].includes(key) && mesh.material instanceof PBRMaterial && !mesh.material.albedoTexture) {
        mesh.material.albedoColor = new Color3(0.72, 0.55, 0.36); mesh.material.metallic = 0; mesh.material.roughness = 0.9;
      }
    }
    if (!floorName && !['outskirts', 'checkpoint', 'camp'].includes(key)) {
      const size = max.subtract(min);
      this.collision.addBox(`w223_${key}_footprint`, position.add(new Vector3(0, size.y / 2, 0)), new Vector3(size.x, size.y, size.z), true);
    }
    return asset;
  }
  private portal(label: string, destination: SceneId, position: Vector3, spawn: SpawnId = 'tatooineArrival') {
    this.portals.push({ label, destination, position, spawn });
  }
  private async placeW225Asset(kind: 'spaceport' | 'serviceDock' | 'firefly', position: Vector3, scale: number, floorHeight: number) {
    const query = typeof location === 'undefined' ? new URLSearchParams() : new URLSearchParams(location.search);
    const legacyStage = this.staged || (import.meta.env.DEV && query.get('w225Stage') === '1');
    const dockStage = w2251Staged();
    const url = kind === 'serviceDock'
      ? (dockStage ? `${W225_1_STAGING_ASSETS}service_dock.glb` : W225_1_PRODUCTION_SERVICE_DOCK)
      : legacyStage ? `${W225_STAGING_ASSETS}${kind === 'firefly' ? 'firefly_optimized' : 'spaceport'}.glb`
        : kind === 'spaceport' ? W225_PRODUCTION_SPACEPORT : W225_PRODUCTION_FIREFLY;
    const asset = await this.loader.load(url, this.scene); this.assets.push(asset); asset.root.scaling.setAll(scale);
    if (kind === 'serviceDock') {
      // This Sketchfab scene embeds two ships, sky, clouds and a Jawa. Keep the source GLB byte-identical;
      // hide those unrelated sub-assets per imported dock, retaining dock geometry and its own floor.
      const excluded = /^(Sky_|Clouds?_|jawa1_|Hull_|Hull2_|Joint_|Leg\.|Cables)/i;
      const wallMeshes: AbstractMesh[] = []; let floor: AbstractMesh | undefined;
      for (const mesh of asset.meshes) {
        if (!mesh.getTotalVertices()) continue;
        if (excluded.test(mesh.name)) { mesh.setEnabled(false); continue; }
        mesh.isPickable = true; mesh.metadata = { ...mesh.metadata, cameraBlocker: true, w225Environment: true, w225ServiceDock: true };
        if (mesh.name.includes('Ground_dockwalls')) wallMeshes.push(mesh);
        if (mesh.name.includes('Ground_sand')) floor = mesh;
      }
      if (!wallMeshes.length || !floor) throw new Error('W225.1: dock wall/floor geometry missing');
      const min = new Vector3(Infinity, Infinity, Infinity), max = new Vector3(-Infinity, -Infinity, -Infinity);
      for (const mesh of wallMeshes) {
        mesh.computeWorldMatrix(true); const box = mesh.getBoundingInfo().boundingBox;
        min.minimizeInPlace(box.minimumWorld); max.maximizeInPlace(box.maximumWorld);
      }
      floor.computeWorldMatrix(true); const floorY = floor.getBoundingInfo().boundingBox.minimumWorld.y;
      asset.root.position.set(position.x - (min.x + max.x) / 2, -floorY, position.z - (min.z + max.z) / 2);
      // #25 has no pedestrian opening. Cut a full-width service gate only in this
      // imported runtime mesh; the source/staged GLB bytes remain unchanged.
      for (const wall of wallMeshes) {
        const positions = wall.getVerticesData('position'), indices = wall.getIndices();
        if (!positions || !indices) throw new Error('W225.1: dock wall has no indexed geometry');
        const matrix = wall.computeWorldMatrix(true), worldBounds = wall.getBoundingInfo().boundingBox;
        const gateHalfWidth = w226Active() ? 7.5 : 5.5, gateHeight = 7.0, gateDepth = 3.8, gateZ = worldBounds.maximumWorld.z;
        const kept: number[] = [];
        for (let i = 0; i + 2 < indices.length; i += 3) {
          const a = Vector3.TransformCoordinates(Vector3.FromArray(positions, indices[i] * 3), matrix);
          const b = Vector3.TransformCoordinates(Vector3.FromArray(positions, indices[i + 1] * 3), matrix);
          const c = Vector3.TransformCoordinates(Vector3.FromArray(positions, indices[i + 2] * 3), matrix);
          const minX = Math.min(a.x,b.x,c.x), maxX = Math.max(a.x,b.x,c.x), minY = Math.min(a.y,b.y,c.y), maxY = Math.max(a.y,b.y,c.y), minZ = Math.min(a.z,b.z,c.z), maxZ = Math.max(a.z,b.z,c.z);
          const overlapsDoor = maxX > position.x - gateHalfWidth && minX < position.x + gateHalfWidth
            && maxY > -0.1 && minY < gateHeight && maxZ > gateZ - gateDepth && minZ < gateZ + 0.1;
          if (overlapsDoor) continue;
          kept.push(indices[i], indices[i + 1], indices[i + 2]);
        }
        wall.setIndices(kept, wall.getTotalVertices()); wall.refreshBoundingInfo(true, true);
        // W226.4 replaces only the imported wall visuals with a measured
        // procedural shell. Keep the original floor, asset bytes and historic
        // collision proxies so the stage flag remains reversible.
        if (w226Active()) wall.setEnabled(false);
      }
      return asset;
    }
    if (kind === 'spaceport') asset.root.rotation.y = Math.PI / 2; // W225 #24 source doorway is on +X
    const min = new Vector3(Infinity, Infinity, Infinity), max = new Vector3(-Infinity, -Infinity, -Infinity);
    for (const mesh of asset.meshes) {
      if (!mesh.getTotalVertices()) continue;
      mesh.computeWorldMatrix(true); const box = mesh.getBoundingInfo().boundingBox;
      min.minimizeInPlace(box.minimumWorld); max.maximizeInPlace(box.maximumWorld);
      mesh.isPickable = true; mesh.metadata = { ...mesh.metadata, cameraBlocker: true, w225Environment: true };
    }
    asset.root.position.set(position.x - (min.x + max.x) / 2, -floorHeight, position.z - (min.z + max.z) / 2);
    if (kind === 'firefly') {
      // Static exterior, seven source materials: collapse 149 draw meshes into
      // one mesh per material without changing the source GLB on disk.
      const groups = new Map<Material, Map<string, Mesh[]>>();
      for (const mesh of asset.meshes) if (mesh instanceof Mesh && mesh.getTotalVertices() && mesh.material) {
        const byFormat = groups.get(mesh.material) ?? new Map<string, Mesh[]>();
        const key = mesh.getVerticesDataKinds().sort().join('|');
        const list = byFormat.get(key) ?? []; list.push(mesh); byFormat.set(key, list); groups.set(mesh.material, byFormat);
      }
      for (const list of [...groups.values()].flatMap(byFormat => [...byFormat.values()])) {
        if (list.length < 2) continue;
        const merged = Mesh.MergeMeshes(list, true, true, undefined, false, false);
        if (!merged) throw new Error('W225: Firefly mesh merge failed');
        merged.metadata = { cameraBlocker: true, w225Environment: true };
        this.meshes.push(merged);
      }
    }
    return asset;
  }
  private box(name: string, position: Vector3, size: Vector3, color: Color3, solid = true, sharedMaterial?: StandardMaterial) {
    const mesh = MeshBuilder.CreateBox(`w225_${name}`, { width: size.x, height: size.y, depth: size.z }, this.scene);
    mesh.position.copyFrom(position); mesh.material = sharedMaterial ?? this.material(`w225_${name}`, color);
    mesh.isPickable = solid; mesh.metadata = { cameraBlocker: solid }; this.meshes.push(mesh);
    if (solid) this.collision.addBox(`w225_${name}`, position, size, true);
    return mesh;
  }
  private buildFireflyCabin() {
    const metal = new Color3(0.28, 0.29, 0.28), trim = new Color3(0.55, 0.43, 0.29);
    this.box('cabin_floor', new Vector3(0, -0.13, 0), new Vector3(12, 0.25, 20), metal, false);
    this.box('cabin_ceiling', new Vector3(0, 4.5, 0), new Vector3(12, 0.3, 20), metal, false);
    for (const x of [-6, 6]) {
      this.box(`cabin_wall_${x}`, new Vector3(x, 2.25, 0), new Vector3(0.4, 4.5, 20), metal);
      for (const z of [-7, -2, 3]) this.box(`cabin_rib_${x}_${z}`, new Vector3(x - Math.sign(x) * 0.27, 2.1, z), new Vector3(0.25, 3.7, 0.4), trim, false);
    }
    this.box('cabin_rear', new Vector3(0, 2.25, -10), new Vector3(12, 4.5, 0.4), metal);
    this.box('cabin_front_left', new Vector3(-4, 2.25, 10), new Vector3(4, 4.5, 0.4), metal);
    this.box('cabin_front_right', new Vector3(4, 2.25, 10), new Vector3(4, 4.5, 0.4), metal);
    for (const x of [-3.7, 3.7]) this.box(`cabin_cargo_${x}`, new Vector3(x, 0.55, -4), new Vector3(1.4, 1.1, 2), trim);
    const lampMaterial = this.material('w225_cabin_lamps', new Color3(0.68, 0.81, 0.8));
    lampMaterial.emissiveColor = new Color3(0.55, 0.7, 0.68);
    for (const z of [-5, 3]) {
      const lamp = MeshBuilder.CreateBox(`w225_cabin_lamp_${z}`, { width: 2, height: 0.05, depth: 0.45 }, this.scene);
      lamp.position.set(0, 4.28, z); lamp.material = lampMaterial; lamp.isPickable = false; this.meshes.push(lamp);
    }
  }
  private async buildSpaceport() {
    const query = typeof location === 'undefined' ? new URLSearchParams() : new URLSearchParams(location.search);
    const serviceDockMode = w2251Active();
    if (!serviceDockMode) {
      const requestedCount = import.meta.env.DEV ? Number(query.get('w225Pads') ?? 3) : 3;
      const pads = W225_PADS.slice(0, Math.max(1, Math.min(W225_PADS.length, Math.floor(requestedCount) || 3)));
      const first = pads[0];
      const asset = await this.placeW225Asset('spaceport', new Vector3(first.x, 0, first.z), W225_PAD_SCALE, W225_PAD_FLOOR_Y);
      // Babylon clones share source geometry/materials. The GLB is fetched and imported once.
      for (const pad of pads.slice(1)) {
        const clone = asset.root.clone(`w225_pad_${pad.id}`, null, false);
        if (!clone) throw new Error(`W225: could not clone pad ${pad.id}`);
        clone.position.x += pad.x - first.x; clone.position.z += pad.z - first.z;
        this.clonedRoots.push(clone);
      }
      const stone = new Color3(0.42, 0.34, 0.25), edge = new Color3(0.55, 0.43, 0.29);
      for (const pad of pads) {
        this.collision.addBox(`w225_terminal_${pad.id}`, new Vector3(pad.x, 2, pad.z), new Vector3(30, 4, 29), true);
        this.box(`pad_${pad.id}_apron`, new Vector3(pad.x, -0.06, 26), new Vector3(pad.id === 'A' ? 36 : 24, 0.12, 38), stone, false);
        const beaconX = pad.x + (pad.id === 'A' ? -12 : 12);
        this.box(`pad_${pad.id}_beacon`, new Vector3(beaconX, 1.25, 39), new Vector3(0.45, 2.5, 0.45), edge, false);
      }
      this.box('cross_corridor', new Vector3(0, -0.07, 49), new Vector3(108, 0.14, 8), stone, false);
      this.box('city_corridor', new Vector3(0, -0.07, 69), new Vector3(9, 0.14, 42), stone, false);
      for (const x of [-5, 5]) this.box(`city_rail_${x}`, new Vector3(x, 0.45, 69), new Vector3(0.35, 0.9, 40), edge, true);
      await this.placeW225Asset('firefly', new Vector3(first.x, 0, 14), W225_FIREFLY_SCALE, -1.756 * W225_FIREFLY_SCALE);
      const strut = new Color3(0.14, 0.15, 0.15);
      for (const x of [-3.2, 3.2]) for (const z of [9, 19]) {
        this.box(`firefly_landing_strut_${x}_${z}`, new Vector3(first.x + x, 0.65, z), new Vector3(0.42, 1.3, 0.42), strut, false);
        this.box(`firefly_landing_foot_${x}_${z}`, new Vector3(first.x + x, 0.06, z), new Vector3(1.1, 0.12, 1.1), strut, false);
      }
      this.collision.addBox('w225_firefly_body', new Vector3(first.x, 1.4, 13), new Vector3(6, 2.8, 11), true);
      this.portal('Subir a la Firefly', 'tatooineFireflyInterior', new Vector3(first.x, 0, 30), 'tatooineFireflyReturn');
      this.portal('Ir al poblado', 'tatooineHub', new Vector3(0, 0, 87), 'tatooineSpaceportReturn');
      return;
    }

    const requestedCount = import.meta.env.DEV ? Number(query.get('w2251Pads') ?? query.get('w225Pads') ?? 3) : 3;
    const pads = W225_1_PADS.slice(0, Math.max(1, Math.min(W225_1_PADS.length, Math.floor(requestedCount) || 3)))
      .map((pad, index) => w226Active() ? { ...pad, x: W226_PAD_CENTERS[index] } : pad);
    const first = pads[0], dock = await this.placeW225Asset('serviceDock', new Vector3(first.x, 0, first.z), W225_1_DOCK_SCALE, 0);
    for (const pad of pads.slice(1)) {
      const clone = dock.root.clone(`w2251_service_dock_${pad.id}`, null, false);
      if (!clone) throw new Error(`W225.1: could not clone dock ${pad.id}`);
      clone.position.x += pad.x - first.x; clone.position.z += pad.z - first.z; this.clonedRoots.push(clone);
    }
    const stone = new Color3(0.37, 0.31, 0.24), edge = new Color3(0.59, 0.43, 0.25);
    for (const pad of pads) {
      // Use inexpensive perimeter proxies instead of rasterizing all 8k source
      // triangles into the half-meter navigation grid. The +Z service gate is
      // intentionally left open for the Firefly boarding apron.
      const halfW = W225_1_DOCK_FOOTPRINT.width / 2, halfD = W225_1_DOCK_FOOTPRINT.depth / 2;
      const wallH = 8, wallT = 1.1, gateHalfWidth = w226Active() ? 7.5 : 5.8, sideHalf = halfW - gateHalfWidth;
      this.collision.addBox(`service_dock_wall_west_${pad.id}`, new Vector3(pad.x - halfW + wallT / 2, wallH / 2, pad.z), new Vector3(wallT, wallH, W225_1_DOCK_FOOTPRINT.depth), true);
      this.collision.addBox(`service_dock_wall_east_${pad.id}`, new Vector3(pad.x + halfW - wallT / 2, wallH / 2, pad.z), new Vector3(wallT, wallH, W225_1_DOCK_FOOTPRINT.depth), true);
      this.collision.addBox(`service_dock_wall_rear_${pad.id}`, new Vector3(pad.x, wallH / 2, pad.z - halfD + wallT / 2), new Vector3(W225_1_DOCK_FOOTPRINT.width, wallH, wallT), true);
      for (const side of [-1, 1]) this.collision.addBox(`service_dock_wall_gate_side_${pad.id}_${side}`,
        new Vector3(pad.x + side * (gateHalfWidth + sideHalf / 2), wallH / 2, pad.z + halfD - wallT / 2), new Vector3(sideHalf, wallH, wallT), true);
      this.box(`service_dock_approach_${pad.id}`, new Vector3(pad.x, -0.055, pad.z + 24), new Vector3(15, 0.11, 48), stone, false);
      // The W226 macro shell supplies a larger hangar opening in staging; keep
      // the old W225 frame only in the original layout to avoid a second small
      // doorway visually boxing in the Firefly.
      if (!w226Active()) {
        const gateZ = pad.z + W225_1_DOCK_FOOTPRINT.depth / 2 - 1;
        for (const side of [-1, 1]) this.box(`service_dock_gate_jamb_${pad.id}_${side}`, new Vector3(pad.x + side * 5.65, 3.5, gateZ), new Vector3(0.55, 7.0, 0.9), edge, false);
        this.box(`service_dock_gate_lintel_${pad.id}`, new Vector3(pad.x, 7.0, gateZ), new Vector3(11.8, 0.55, 0.9), edge, false);
      }
      const marker = this.box(`service_dock_beacon_${pad.id}`, new Vector3(pad.x + 9, 0.8, pad.z + 39), new Vector3(0.55, 1.6, 0.55), edge, false);
      marker.metadata = { ...marker.metadata, w2251PadId: pad.id, occupied: pad.occupied, shipId: pad.shipId ?? null,
        futureRole: pad.futureRole, npcSpawnPoints: pad.npcSpawnPoints, cargoSpawnPoints: pad.cargoSpawnPoints, questAnchor: pad.questAnchor };
    }
    this.box('service_dock_cross_corridor', new Vector3(0, -0.07, 49), new Vector3(190, 0.14, 10), stone, false);
    this.box('service_dock_city_corridor', new Vector3(0, -0.07, 71), new Vector3(12, 0.14, 36), stone, false);
    await this.placeW225Asset('firefly', new Vector3(first.x, 0, first.z), W225_FIREFLY_SCALE, -1.756 * W225_FIREFLY_SCALE);
    const strut = new Color3(0.14, 0.15, 0.15);
    for (const x of [-3.2, 3.2]) for (const z of [-5, 5]) {
      this.box(`service_firefly_landing_strut_${x}_${z}`, new Vector3(first.x + x, 0.65, first.z + z), new Vector3(0.42, 1.3, 0.42), strut, false);
      this.box(`service_firefly_landing_foot_${x}_${z}`, new Vector3(first.x + x, 0.06, first.z + z), new Vector3(1.1, 0.12, 1.1), strut, false);
    }
    this.collision.addBox('w2251_firefly_body', new Vector3(first.x, 1.4, first.z), new Vector3(6, 2.8, 11), true);
    if (w226Active()) await this.buildW226DistrictDressing(pads);
    if (w2272ScenicStaged() && this.sceneId === 'tatooineSpaceport') this.compactW2272StaticDocks();
    if (w2272ScenicStaged() && this.sceneId === 'tatooineSpaceport') await this.buildW227ScenicPass();
    else if (w227ScenicStaged()) await this.buildW227ScenicPass();
    this.portal('Subir a la Firefly', 'tatooineFireflyInterior', new Vector3(first.x, 0, first.z + 13), 'tatooineFireflyReturn');
    this.portal('Ir al poblado', 'tatooineHub', new Vector3(0, 0, 87), 'tatooineSpaceportReturn');
  }
  private compactW2272StaticDocks() {
    let sourceMeshes = 0, resultMeshes = 0;
    for (const asset of this.assets) {
      const candidates = asset.meshes.filter(mesh => mesh.getTotalVertices() > 0 && mesh.isEnabled()
        && (mesh.metadata as { w225ServiceDock?: boolean } | null)?.w225ServiceDock === true);
      if (candidates.length < 2) continue;
      const merged = mergeStaticMeshes(candidates, 'w2272_static_dock');
      const candidateSet = new Set(candidates);
      const untouched = asset.meshes.filter(mesh => !candidateSet.has(mesh));
      merged.forEach(mesh => {
        mesh.metadata = { ...mesh.metadata, w225ServiceDock: true, w2272StaticMerged: true, cameraBlocker: true };
      });
      asset.meshes.splice(0, asset.meshes.length, ...untouched, ...merged);
      sourceMeshes += candidates.length; resultMeshes += merged.length;
      freezeStaticMeshes(merged);
    }
    console.info('[W227.2 STAGE] static dock mesh compaction', { sourceMeshes, mergedMeshes: resultMeshes, savings: sourceMeshes - resultMeshes });
  }

  private async buildW227ScenicPass() {
    const w2272 = w2272ScenicStaged() && this.sceneId === 'tatooineSpaceport';
    const skyline = await this.loader.load('/docs/_audit_codex/w227_staging/assets/spaceport_skyline.glb', this.scene);
    this.assets.push(skyline); skyline.animationGroups.forEach(group => group.stop());
    const cityPieces = skyline.meshes.filter((mesh): mesh is Mesh => mesh instanceof Mesh && mesh.getTotalVertices() > 0);
    if (cityPieces.length > 1 && cityPieces.every(mesh => mesh.material === cityPieces[0].material)) {
      const mergedCity = Mesh.MergeMeshes(cityPieces, true, true, undefined, false, false);
      if (!mergedCity) throw new Error('W227: could not merge static skyline pieces');
      mergedCity.name = 'w227_non_playable_city_backdrop'; mergedCity.parent = skyline.root;
      skyline.meshes.splice(0, skyline.meshes.length, mergedCity);
    }
    const roots = skyline.root.getChildMeshes(false);
    let sourceMinY = Infinity, sourceMaxY = -Infinity, sourceMinX = Infinity, sourceMaxX = -Infinity, sourceMinZ = Infinity, sourceMaxZ = -Infinity;
    skyline.root.scaling.setAll(1); skyline.root.position.set(0, 0, 0); skyline.root.rotation.set(0, 0, 0); skyline.root.computeWorldMatrix(true);
    for (const mesh of roots) {
      mesh.computeWorldMatrix(true); const bounds = mesh.getBoundingInfo().boundingBox;
      sourceMinX = Math.min(sourceMinX, bounds.minimumWorld.x); sourceMaxX = Math.max(sourceMaxX, bounds.maximumWorld.x);
      sourceMinY = Math.min(sourceMinY, bounds.minimumWorld.y); sourceMaxY = Math.max(sourceMaxY, bounds.maximumWorld.y);
      sourceMinZ = Math.min(sourceMinZ, bounds.minimumWorld.z); sourceMaxZ = Math.max(sourceMaxZ, bounds.maximumWorld.z);
    }
    const sourceHeight = sourceMaxY - sourceMinY;
    if (!Number.isFinite(sourceHeight) || sourceHeight <= 0) throw new Error('W227: skyline bounds are invalid');
    const w2271 = w2271ScenicStaged();
    const layers = w2272 ? W2272_SCENIC.cityLayers : w2271 ? W2271_SCENIC.cityLayers : [{ id: 'single', x: 0, z: -128, height: 42, yaw: 0 }];
    const cityRoots: TransformNode[] = [skyline.root];
    for (const layer of layers.slice(1)) {
      const clone = skyline.root.clone(`${w2272 ? 'w2272' : 'w2271'}_city_layer_${layer.id}`, null, false);
      if (!clone) throw new Error(`W227: could not instance skyline layer ${layer.id}`);
      cityRoots.push(clone); this.clonedRoots.push(clone);
    }
    const reported = [] as Array<{ id: string; heightM: number; center: number[]; bounds: number[] }>;
    layers.forEach((layer, index) => {
      const root = cityRoots[index];
      root.scaling.setAll(layer.height / sourceHeight); root.rotation.y = layer.yaw; root.position.set(0, 0, 0); root.computeWorldMatrix(true);
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const mesh of root.getChildMeshes(false)) {
        mesh.computeWorldMatrix(true); const bounds = mesh.getBoundingInfo().boundingBox;
        minX = Math.min(minX, bounds.minimumWorld.x); maxX = Math.max(maxX, bounds.maximumWorld.x);
        minY = Math.min(minY, bounds.minimumWorld.y); maxY = Math.max(maxY, bounds.maximumWorld.y);
        minZ = Math.min(minZ, bounds.minimumWorld.z); maxZ = Math.max(maxZ, bounds.maximumWorld.z);
      }
      root.position.set(layer.x - (minX + maxX) * 0.5, -minY, layer.z - (minZ + maxZ) * 0.5); root.computeWorldMatrix(true);
      const contrast = w2272 && 'contrast' in layer ? layer.contrast : 1;
      const useFog = w2272 && 'fog' in layer ? layer.fog : true;
      const layerMaterials = new Map<Material, Material>();
      const actual = root.getChildMeshes(false); actual.forEach(mesh => {
        mesh.isPickable = false; mesh.checkCollisions = false; mesh.applyFog = useFog;
        if (contrast < 0.999 && mesh.material) {
          let toned = layerMaterials.get(mesh.material);
          if (!toned) {
            toned = mesh.material.clone(`w2272_city_${layer.id}_${mesh.material.name}`) ?? mesh.material;
            if (toned instanceof PBRMaterial) toned.albedoColor.scaleInPlace(contrast);
            else if (toned instanceof StandardMaterial) toned.diffuseColor.scaleInPlace(contrast);
            layerMaterials.set(mesh.material, toned);
            if (toned !== mesh.material && (toned instanceof PBRMaterial || toned instanceof StandardMaterial)) this.materials.push(toned);
          }
          mesh.material = toned;
        }
        mesh.metadata = { ...mesh.metadata, w227ScenicBackdrop: true, w227CityLayer: layer.id, playable: false };
      });
      reported.push({ id: layer.id, heightM: layer.height, center: [layer.x, 0, layer.z], bounds: [minX, maxX, minY, maxY, minZ, maxZ] });
    });
    if (w2271 && !w2272) {
      const midground = createTatooineW2271Midground(this.scene);
      this.meshes.push(...midground.meshes); this.materials.push(...midground.materials);
    }
    if (w2272) {
      // Haze is reserved for the city layers. The near gameplay layer keeps
      // material contrast and avoids compiling fog into every environment mesh.
      this.assets.filter(asset => asset !== skyline).forEach(asset => asset.meshes.forEach(mesh => { mesh.applyFog = false; }));
      this.meshes.forEach(mesh => { mesh.applyFog = false; });
      // Keep one 68k-triangle authored layer. Near and far parallax are merged
      // procedural silhouettes, avoiding two additional full GLB draws.
      const near = createTatooineW2272FarCity(this.scene, W2272_SCENIC.nearBand.centerX,
        W2272_SCENIC.nearBand.centerZ, W2272_SCENIC.nearBand.heightScale, 1);
      const far = createTatooineW2272FarCity(this.scene, W2272_SCENIC.distantBand.centerX,
        W2272_SCENIC.distantBand.centerZ, W2272_SCENIC.distantBand.heightScale, 2);
      near.materials.forEach(material => material.diffuseColor.scaleInPlace(0.94));
      far.materials.forEach(material => material.diffuseColor.scaleInPlace(0.70));
      const nearMeshes = near.meshes;
      const farMeshes = far.meshes;
      this.meshes.push(...nearMeshes, ...farMeshes); this.materials.push(...near.materials, ...far.materials);
      const staticBackdrops = cityRoots.flatMap(root => root.getChildMeshes(false)).concat(nearMeshes, farMeshes);
      freezeStaticMeshes(staticBackdrops);
    }
    console.info('[W227 STAGE] non-playable city backdrop', { variant: w2272 ? 'W227.2' : w2271 ? 'W227.1' : 'W227', layers: reported,
      sourceHeight, sourceWidth: sourceMaxX - sourceMinX, sourceDepth: sourceMaxZ - sourceMinZ,
      sourceMeshes: cityPieces.length, meshCountAfterMerge: skyline.meshes.length, additionalLayers: cityRoots.length - 1,
      farSilhouetteMergedMeshes: w2272 ? 6 : 0 });
  }
  private async buildW226DistrictDressing(pads: readonly W225ServicePad[]) {
    const activePads = new Set(pads.map(pad => pad.id));
    let plasterTexture: Texture | undefined, plasterNormal: Texture | undefined;
    if (w227ScenicStaged() && typeof window !== 'undefined') {
      const assetRoot = w2272ScenicStaged() ? W2272_ASSET_ROOT : w2271ScenicStaged() ? W2271_ASSET_ROOT : '/docs/_audit_codex/w227_staging/assets';
      const assetName = w2271ScenicStaged() ? 'plaster_albedo.png' : 'adobe_plaster_tile.png';
      plasterTexture = new Texture(`${assetRoot}/${w2272ScenicStaged() ? 'plaster_albedo.png?v=2272c' : assetName}`, this.scene);
      plasterTexture.uScale = plasterTexture.vScale = w2272ScenicStaged() ? W2272_SCENIC.plasterTileCount : w2271ScenicStaged() ? W2271_SCENIC.plasterTileCount : 3; this.textures.push(plasterTexture);
      if (w2271ScenicStaged() && !w2272ScenicStaged()) {
        plasterNormal = new Texture(`${assetRoot}/plaster_normal.png`, this.scene);
        plasterNormal.uScale = plasterNormal.vScale = w2272ScenicStaged() ? W2272_SCENIC.plasterTileCount : W2271_SCENIC.plasterTileCount; plasterNormal.level = w2272ScenicStaged() ? 0.10 : 0.16; this.textures.push(plasterNormal);
      }
    }
    const macro = createTatooineMacroArchitecture(this.scene, pads.map(pad => ({
      id: pad.id, centerX: pad.x, centerZ: pad.z,
      role: pad.id === 'A' ? 'arrival' as const : pad.id === 'B' ? 'service' as const : 'future' as const,
    })), { plasterTexture, plasterNormal, detailedFinish: w2271ScenicStaged(), w2272Finish: w2272ScenicStaged() });
    this.meshes.push(...macro.meshes);
    if (w2272ScenicStaged()) macro.meshes.forEach(mesh => { mesh.applyFog = false; });
    this.materials.push(...macro.materials);

    // Keep the W226.1 apron and route footprints; the new shell is visual-only.
    const sandStone = new Color3(0.57, 0.47, 0.35);
    const aprons = this.material('w226_service_apron', sandStone);
    if ((w2271ScenicStaged() || w2272ScenicStaged() || w2273GroundStaged() || w2273bGroundStaged()) && this.sceneId === 'tatooineSpaceport') {
      // The W226 aprons/spine are large overlays over the textured terrain.
      // Give them a compacted-sand finish in this staged spaceport only, so
      // the broad route no longer reads as one flat brown slab.
      const textureRoot = (w2273GroundStaged() || w2273bGroundStaged()) ? (w2273bGroundStaged() ? W2273B_ASSET_ROOT : W2273_ASSET_ROOT) : w2272ScenicStaged() ? W2272_ASSET_ROOT : W2271_ASSET_ROOT;
      const roadAlbedo = w2273GroundStaged() || w2273bGroundStaged();
      const albedoName = roadAlbedo ? (w2273bGroundStaged() ? 'compacted_apron_b.png' : 'spaceport_sand_albedo.png') : 'sand_albedo.png';
      const albedo = new Texture(`${textureRoot}/${albedoName}${w2273bGroundStaged() ? '?v=2273b' : roadAlbedo ? '?v=2273a' : w2272ScenicStaged() ? '?v=2272c' : ''}`, this.scene);
      albedo.uScale = w2273bGroundStaged() ? 2.2 : w2272ScenicStaged() ? W2272_SCENIC.apronTileU : 8; albedo.vScale = w2273bGroundStaged() ? 1.35 : w2272ScenicStaged() ? W2272_SCENIC.apronTileV : 3; albedo.wrapU = Texture.WRAP_ADDRESSMODE; albedo.wrapV = Texture.WRAP_ADDRESSMODE;
      albedo.anisotropicFilteringLevel = 4; this.textures.push(albedo);
      const normal = w2272ScenicStaged() ? undefined : new Texture(`${textureRoot}/sand_normal.png`, this.scene);
      if (normal) {
        normal.uScale = 8; normal.vScale = 3; normal.wrapU = Texture.WRAP_ADDRESSMODE; normal.wrapV = Texture.WRAP_ADDRESSMODE;
        normal.level = 0.08; this.textures.push(normal);
      }
      aprons.diffuseColor = w2272ScenicStaged() ? new Color3(0.82, 0.73, 0.59) : new Color3(0.88, 0.79, 0.65);
      aprons.diffuseTexture = albedo; if (normal) aprons.bumpTexture = normal;
      aprons.specularColor = new Color3(0.012, 0.009, 0.006);
      if (w2272ScenicStaged()) {
        const routeMeshes = this.meshes.filter(mesh => mesh.name === 'w225_service_dock_cross_corridor' || mesh.name === 'w225_service_dock_city_corridor');
        routeMeshes.forEach(mesh => { mesh.material = aprons; mesh.isPickable = false; });
      }
    }
    if (!w2273cGroundStaged()) {
    for (const pad of pads) {
      const apronZ = pad.z + W226_APRON.zOffset;
      this.box(`w226_apron_${pad.id}`, new Vector3(pad.x, -0.105, apronZ), new Vector3(W226_APRON.width, 0.12, W226_APRON.depth), sandStone, false, aprons);
      this.box(`w226_apron_connector_${pad.id}`, new Vector3(pad.x, -0.035, 42), new Vector3(19, 0.08, 15), sandStone, false, aprons);
    }
    // Keep the shared route open for a three-person party and future foot traffic.
    this.box('w226_wide_district_spine', new Vector3(0, -0.035, 53), new Vector3(190, 0.08, 14), sandStone, false, aprons);
    }

    // The three bays share one visual language and readable wayfinding instead of
    // relying on isolated arches. Signs face the arrival apron (+Z).
    const makeSign = (id: string, label: string, x: number, y: number, z: number, width: number) => {
      const material = this.material(`w226_sign_${id}`, Color3.White());
      material.disableLighting = true;
      let sign: Mesh;
      if (typeof document !== 'undefined') {
        const texture = new DynamicTexture(`w226_sign_texture_${id}`, { width: 512, height: 128 }, this.scene, false);
        const context = texture.getContext() as CanvasRenderingContext2D;
        context.fillStyle = '#403126'; context.fillRect(0, 0, 512, 128);
        context.strokeStyle = '#c6a36c'; context.lineWidth = 8; context.strokeRect(5, 5, 502, 118);
        context.fillStyle = '#ead3a4'; context.font = 'bold 56px Arial'; context.textAlign = 'center'; context.textBaseline = 'middle';
        context.fillText(label, 256, 66, 470); texture.update(false); this.textures.push(texture);
        material.diffuseTexture = texture;
        sign = MeshBuilder.CreatePlane(`w226_sign_${id}`, { width, height: 1.35 }, this.scene);
      } else {
        // NullEngine has no canvas; preserve the framing/wayfinding volume in
        // physical navigation checks without requiring a browser canvas shim.
        sign = MeshBuilder.CreateBox(`w226_sign_${id}`, { width, height: 1.35, depth: 0.16 }, this.scene);
        material.diffuseColor.set(0.25, 0.19, 0.14);
        material.emissiveColor.set(0.08, 0.055, 0.035);
      }
      sign.position.set(x, y, z); sign.material = material; sign.isPickable = false; this.meshes.push(sign);
    };
    for (const pad of pads) {
      const label = pad.id === 'A' ? 'A  ·  FIREFLY' : pad.id === 'B' ? 'B  ·  SERVICE' : 'C  ·  FUTURE';
      const facadeZ = pad.z + W225_1_DOCK_FOOTPRINT.depth / 2 + 1.15;
      makeSign(`dock_${pad.id}`, label, pad.x, 12.5, facadeZ, 12.0);
    }
    makeSign('settlement', 'POBLADO', 0, 12.0, 81.0, 10.5);

    // W226.2 sector identity: low, non-colliding service dressing. These stay
    // around the apron edges, leaving boarding and the shared spine clear.
    const crateBody = this.material('w226_dressing_crate', new Color3(0.38, 0.27, 0.17));
    const metalDark = this.material('w226_dressing_metal_dark', new Color3(0.24, 0.22, 0.19));
    const metalWarm = this.material('w226_dressing_metal_warm', new Color3(0.47, 0.34, 0.22));
    const canvasTerracotta = this.material('w226_dressing_canvas_terracotta', new Color3(0.48, 0.27, 0.18));
    const beacon = this.material('w226_dressing_beacon', new Color3(0.76, 0.54, 0.28));
    const dressingMeshes: Mesh[] = [];
    const dressingBox = (name: string, position: Vector3, size: Vector3, color: Color3, material: StandardMaterial) => {
      const mesh = this.box(name, position, size, color, false, material);
      mesh.metadata = { ...mesh.metadata, w226BuiltDressing: true, cameraBlocker: false };
      dressingMeshes.push(mesh); return mesh;
    };
    const cylinder = (name: string, x: number, y: number, z: number, diameter: number, height: number, material: StandardMaterial, tessellation = 10) => {
      const mesh = MeshBuilder.CreateCylinder(`w226_${name}`, { diameter, height, tessellation }, this.scene);
      mesh.position.set(x, y + height / 2, z); mesh.material = material; mesh.isPickable = false;
      mesh.metadata = { w226ServiceDressing: true, w226BuiltDressing: true, cameraBlocker: false }; this.meshes.push(mesh); dressingMeshes.push(mesh);
      return mesh;
    };
    const pipe = (name: string, x: number, y: number, z: number, length: number, diameter: number, yaw = 0) => {
      const mesh = cylinder(name, x, y, z, diameter, length, metalDark, 8);
      mesh.rotation.z = Math.PI / 2; mesh.rotation.y = yaw;
      return mesh;
    };

    const measuredBounds = (asset: ImportedAsset) => {
      const min = new Vector3(Infinity, Infinity, Infinity), max = new Vector3(-Infinity, -Infinity, -Infinity);
      for (const mesh of asset.meshes) {
        mesh.computeWorldMatrix(true);
        const bounds = mesh.getBoundingInfo().boundingBox;
        min.minimizeInPlace(bounds.minimumWorld); max.maximizeInPlace(bounds.maximumWorld);
      }
      return { min, max, width: max.x - min.x, height: max.y - min.y, depth: max.z - min.z };
    };
    const warmTintAsset = (asset: ImportedAsset, tint: Color3) => {
      const clones = new Map<Material, Material>();
      for (const mesh of asset.meshes) {
        const source = mesh.material;
        if (!source) continue;
        let target = clones.get(source);
        if (!target) {
          const cloned = source.clone(`${source.name}_w2265_warm`);
          if (!cloned) continue;
          target = cloned;
          if (target instanceof PBRMaterial) {
            target.albedoColor = target.albedoColor.multiply(tint); target.metallic = 0; target.roughness = 1;
          } else if (target instanceof StandardMaterial) {
            target.diffuseColor = target.diffuseColor.multiply(tint); target.specularColor = Color3.Black();
          }
          clones.set(source, target); this.materials.push(target as StandardMaterial | PBRMaterial);
        }
        mesh.material = target;
      }
    };
    const normalizeAndPlace = (asset: ImportedAsset, x: number, z: number, targetHeight: number, yaw: number) => {
      asset.root.position.set(0, 0, 0); asset.root.scaling.setAll(1); asset.root.rotation.y = yaw;
      const before = measuredBounds(asset);
      const scale = normalizeNodeToHeight(asset.root, { height: before.height }, targetHeight);
      const after = measuredBounds(asset);
      asset.root.position.set(x - (after.min.x + after.max.x) / 2, -after.min.y, z - (after.min.z + after.max.z) / 2);
      asset.root.computeWorldMatrix(true);
      asset.meshes.forEach(mesh => { mesh.isPickable = false; mesh.metadata = { ...mesh.metadata, w226ServiceDressing: true, cameraBlocker: false }; });
      return { scale, measuredSourceHeight: before.height };
    };
    const mergeKitMeshes = (asset: ImportedAsset, name: string) => {
      const sources = asset.meshes.filter((mesh): mesh is Mesh => mesh instanceof Mesh && mesh.getTotalVertices() > 0);
      if (sources.length < 2) return sources;
      // The maintenance kit has distinct original materials; keep their
      // sub-materials while representing its grouped geometry as one mesh.
      let merged: Mesh | null;
      try { merged = Mesh.MergeMeshes(sources, true, true, undefined, true, true); }
      catch {
        console.info(`[W226.5 STAGE] preserved ${name} as ${sources.length} source meshes; vertex layouts are not merge-compatible`);
        return sources;
      }
      if (!merged) return sources;
      merged.name = name; merged.isPickable = false;
      merged.metadata = { w226ServiceDressing: true, w226BuiltDressing: true, cameraBlocker: false };
      this.meshes.push(merged);
      return [merged];
    };

    const a = W226_DRESSING_ANCHORS.maintenance;
    // CLUSTER A — Firefly maintenance. The bench, tanks, pipe run and crate
    // footprint hug the east service wall; the centerline to the boarding
    // trigger remains open. Tabletop height follows the meter catalog.
    const tableTopY = TATOOINE_TARGET_METERS.tableHeight;
    dressingBox('w226_a_bench_top', new Vector3(a.x, tableTopY - 0.06, a.z), new Vector3(2.8, 0.12, 1.05), new Color3(0.47, 0.34, 0.22), metalWarm);
    for (const dx of [-1.2, 1.2]) for (const dz of [-0.38, 0.38])
      dressingBox(`w226_a_bench_leg_${dx}_${dz}`, new Vector3(a.x + dx, 0.32, a.z + dz), new Vector3(0.13, 0.64, 0.13), new Color3(0.24, 0.22, 0.19), metalDark);
    dressingBox('w226_a_terminal_body', new Vector3(a.x + 0.92, 1.05, a.z - 0.18), new Vector3(0.42, 0.56, 0.16), new Color3(0.24, 0.22, 0.19), metalDark);
    dressingBox('w226_a_terminal_screen', new Vector3(a.x + 0.92, 1.08, a.z - 0.275), new Vector3(0.30, 0.28, 0.025), new Color3(0.76, 0.54, 0.28), beacon);
    cylinder('a_fuel_tank', a.x - 2.55, 0, a.z + 0.1, 0.8, 1.55, metalWarm);
    pipe('a_wall_pipe_upper', a.x, 2.05, a.z - 0.72, 3.4, 0.14);
    pipe('a_wall_pipe_lower', a.x - 0.2, 1.75, a.z - 0.72, 2.0, 0.09);

    const maintenanceKit = await this.loader.load(w226Asset('maintenance_kit.glb'), this.scene);
    this.assets.push(maintenanceKit); maintenanceKit.animationGroups.forEach(group => group.stop());
    warmTintAsset(maintenanceKit, new Color3(0.94, 0.87, 0.73));
    maintenanceKit.root.position.set(0, 0, 0); maintenanceKit.root.scaling.setAll(1);
    const maintenanceBounds = measuredBounds(maintenanceKit);
    const maintenanceScale = normalizeNodeToFootprint(maintenanceKit.root,
      { width: maintenanceBounds.width, depth: maintenanceBounds.depth }, { width: 4.0, depth: 2.0, fit: 'contain' });
    const maintenanceAfter = measuredBounds(maintenanceKit);
    maintenanceKit.root.position.set(a.x + 3.0 - (maintenanceAfter.min.x + maintenanceAfter.max.x) / 2,
      -maintenanceAfter.min.y, a.z - 0.2 - (maintenanceAfter.min.z + maintenanceAfter.max.z) / 2);
    maintenanceKit.root.computeWorldMatrix(true);
    const maintenanceMeshes = mergeKitMeshes(maintenanceKit, 'w226_cluster_a_maintenance_kit');
    maintenanceMeshes.forEach(mesh => { mesh.metadata = { ...mesh.metadata, w226Cluster: 'A-maintenance' }; });
    console.info('[W226.5 STAGE] cluster A normalized kit', { maintenanceFootprintScale: maintenanceScale });

    const b = W226_DRESSING_ANCHORS.cargo;
    // CLUSTER B — cargo/service. Two visibly distinct stacks sit on one side;
    // the table stays at human service height and clear of the route.
    if (activePads.has('B')) {
    dressingBox('w226_b_table_top', new Vector3(b.x + 5.0, tableTopY - 0.06, b.z + 1.0), new Vector3(2.0, 0.12, 0.9), new Color3(0.47, 0.34, 0.22), metalWarm);
    for (const dx of [4.25, 5.75]) for (const dz of [0.7, 1.3])
      dressingBox(`w226_b_table_leg_${dx}_${dz}`, new Vector3(b.x + dx, 0.32, b.z + dz), new Vector3(0.12, 0.64, 0.12), new Color3(0.24, 0.22, 0.19), metalDark);
    dressingBox('w226_b_terminal', new Vector3(b.x + 5.65, 1.05, b.z + 0.72), new Vector3(0.34, 0.56, 0.14), new Color3(0.24, 0.22, 0.19), metalDark);
    dressingBox('w226_b_cargo_bulkhead', new Vector3(b.x + 8.3, 2.25, b.z - 0.4), new Vector3(0.45, 4.5, 5.8), new Color3(0.57, 0.47, 0.35), crateBody);
    // A single broad, low-cost canvas canopy gives the cargo bench a clear
    // service function without importing the kit's visually awkward tarp.
    dressingBox('w226_b_canvas_canopy', new Vector3(b.x + 4.0, 3.15, b.z + 1.0), new Vector3(6.4, 0.16, 3.2), new Color3(0.48, 0.27, 0.18), canvasTerracotta);
    for (const dx of [1.0, 7.0])
      dressingBox(`w226_b_canopy_post_${dx}`, new Vector3(b.x + dx, 1.55, b.z + 1.0), new Vector3(0.16, 3.1, 0.16), new Color3(0.24, 0.22, 0.19), metalDark);
    }

    const c = W226_DRESSING_ANCHORS.communications;
    // CLUSTER C — communications. The 7 m normalized antenna is tied into a
    // compact relay wall with a cabinet, paired conduits and a shared base.
    if (activePads.has('C')) {
    dressingBox('w226_c_relay_cabinet', new Vector3(c.x - 2.4, 1.15, c.z), new Vector3(1.55, 2.3, 1.0), new Color3(0.24, 0.22, 0.19), metalDark);
    dressingBox('w226_c_relay_face', new Vector3(c.x - 2.4, 1.4, c.z - 0.53), new Vector3(0.78, 0.88, 0.08), new Color3(0.76, 0.54, 0.28), beacon);
    dressingBox('w226_c_relay_wall', new Vector3(c.x, 1.45, c.z - 3.5), new Vector3(5.8, 2.9, 0.42), new Color3(0.57, 0.47, 0.35), crateBody);
    dressingBox('w226_c_power_box', new Vector3(c.x + 2.0, 0.9, c.z - 2.8), new Vector3(0.72, 1.8, 0.72), new Color3(0.24, 0.22, 0.19), metalDark);
    pipe('c_relay_conduit_upper', c.x - 0.8, 2.4, c.z - 3.0, 2.8, 0.12);
    pipe('c_relay_conduit_lower', c.x - 0.8, 2.1, c.z - 3.0, 2.4, 0.08);
    }

    // Subtle vertical beacon reinforces the existing city gateway from the
    // spaceport approach. It is dressing only; the portal trigger is unchanged.
    for (const side of [-1, 1]) {
      dressingBox(`w226_city_beacon_${side}`, new Vector3(side * 6.35, 2.1, W226_DRESSING_ANCHORS.settlementBeacon.z), new Vector3(0.28, 4.2, 0.28), new Color3(0.47, 0.34, 0.22), metalWarm);
      dressingBox(`w226_city_beacon_cap_${side}`, new Vector3(side * 6.35, 4.3, W226_DRESSING_ANCHORS.settlementBeacon.z), new Vector3(0.62, 0.3, 0.62), new Color3(0.76, 0.54, 0.28), beacon);
    }

    // #14's physically normalized 1 m crate is imported once, cloned for all
    // three work areas, then merged per cluster (same geometry/material).
    const crateAsset = await this.loader.load(w226Asset('crate1_low.glb'), this.scene);
    this.assets.push(crateAsset); crateAsset.animationGroups.forEach(group => group.stop());
    const crateSourceSize = measuredBounds(crateAsset);
    const crateScale = normalizeNodeToHeight(crateAsset.root, { height: crateSourceSize.height }, 1.0);
    const crateBase = { x: -59.8, z: -15.0 };
    crateAsset.root.position.set(crateBase.x, 0, crateBase.z); crateAsset.root.computeWorldMatrix(true);
    const crateMeshesByCluster: Record<'A' | 'B' | 'C', Mesh[]> = { A: [], B: [], C: [] };
    const crateSets = {
      A: [{ x: -59.8, z: -15.0, y: 0 }, { x: -58.8, z: -14.8, y: 0 }, { x: -59.3, z: -14.9, y: 0.95 }],
      B: [{ x: 12.0, z: -4.0, y: 0 }, { x: 13.0, z: -4.0, y: 0 }, { x: 12.0, z: -4.0, y: 0.95 }, { x: 14.2, z: -3.0, y: 0 }],
      C: [{ x: 77.0, z: -1.5, y: 0 }, { x: 78.0, z: -1.5, y: 0 }],
    } as const;
    const firstCrateMeshes = crateAsset.meshes.filter((mesh): mesh is Mesh => mesh instanceof Mesh && mesh.getTotalVertices() > 0);
    if (activePads.has('A')) crateMeshesByCluster.A.push(...firstCrateMeshes);
    for (const clusterId of ['A', 'B', 'C'] as const) {
      if (!activePads.has(clusterId)) continue;
      const placements = crateSets[clusterId];
      for (let index = clusterId === 'A' ? 1 : 0; index < placements.length; index++) {
        const spot = placements[index];
        const root = crateAsset.root.clone(`w226_crate_${clusterId}_${index}`, null, false);
        if (!root) throw new Error(`W226.5: could not clone kitbash crate ${clusterId}/${index}`);
        root.position.set(spot.x, spot.y, spot.z); root.rotation.y = (index % 2 ? 0.06 : -0.04);
        this.clonedRoots.push(root);
        crateMeshesByCluster[clusterId].push(...root.getChildMeshes(false).filter((mesh): mesh is Mesh => mesh instanceof Mesh && mesh.getTotalVertices() > 0));
      }
    }
    console.info('[W226.5 STAGE] #14 crate normalization', { measuredSourceHeightM: crateSourceSize.height, targetHeightM: 1.0, scale: crateScale });
    for (const clusterId of ['A', 'B', 'C'] as const) {
      if (!activePads.has(clusterId)) continue;
      const sources = crateMeshesByCluster[clusterId];
      const merged = sources.length > 1 ? Mesh.MergeMeshes(sources, true, true, undefined, false, false) : sources[0];
      if (merged) {
        merged.name = `w226_cluster_${clusterId}_kitbash_crates`; merged.isPickable = false;
        merged.metadata = { w226ServiceDressing: true, w226BuiltDressing: true, w226Cluster: `${clusterId}-service`, cameraBlocker: false };
        this.meshes.push(merged);
      }
    }

    // Merge these immobile dressing pieces by shared material/vertex layout:
    // the clusters stay distinct in world space without adding one draw call
    // per crate slat or cylinder.
    const grouped = new Map<string, Mesh[]>();
    for (const mesh of dressingMeshes) {
      const layout = mesh.getVerticesDataKinds().sort().join('|');
      const groupKey = `${mesh.material?.uniqueId ?? 'none'}:${layout}`;
      const group = grouped.get(groupKey) ?? []; group.push(mesh); grouped.set(groupKey, group);
    }
    const mergedSources = new Set<Mesh>(), mergedDressing: Mesh[] = [];
    for (const group of grouped.values()) if (group.length > 1) {
      const merged = Mesh.MergeMeshes(group, true, true, undefined, false, false);
      if (merged) {
        merged.name = `w226_dressing_merged_${mergedDressing.length}`;
        merged.metadata = { w226ServiceDressing: true, w226BuiltDressing: true, cameraBlocker: false };
        merged.isPickable = false; mergedDressing.push(merged); group.forEach(mesh => mergedSources.add(mesh));
      }
    }
    if (mergedSources.size) {
      for (let index = this.meshes.length - 1; index >= 0; index--) if (mergedSources.has(this.meshes[index] as Mesh)) this.meshes.splice(index, 1);
      this.meshes.push(...mergedDressing);
    }

    const droid = await this.loader.load(w226Asset('pit_droid_spaceport_v1.glb'), this.scene);
    this.assets.push(droid); droid.animationGroups.forEach(group => group.stop());
    const droidPlacements = W226_DROID_PLACEMENTS.filter(spot => activePads.has(spot.pad));
    if (droidPlacements.length) {
      const firstSpot = droidPlacements[0];
      const droidScale = normalizeAndPlace(droid, firstSpot.x, firstSpot.z, TATOOINE_TARGET_METERS.pitDroidHeight, firstSpot.yaw);
      const initialHeight = measuredBounds(droid).height;
      if (Math.abs(initialHeight - TATOOINE_TARGET_METERS.pitDroidHeight) > 0.02) throw new Error('W226.5: normalized pit droid height preflight failed');
      droid.meshes.forEach(mesh => { mesh.metadata = { ...mesh.metadata, w226PitDroid: true, actorId: firstSpot.id, role: 'static_ambient_prop', targetHeightMeters: TATOOINE_TARGET_METERS.pitDroidHeight }; });
      for (const mesh of droid.meshes) if (mesh instanceof Mesh) mesh.isPickable = false;
      for (const spot of droidPlacements.slice(1)) {
        const clone = droid.root.clone(`w226_pit_droid_${spot.id}`, null, false);
        if (!clone) throw new Error(`W226.5: cannot clone optimized pit droid ${spot.id}`);
        clone.position.x += spot.x - firstSpot.x; clone.position.z += spot.z - firstSpot.z; clone.rotation.y = spot.yaw;
        clone.getChildMeshes(false).forEach(mesh => { mesh.isPickable = false; mesh.metadata = { ...mesh.metadata, w226PitDroid: true, actorId: spot.id, role: 'static_ambient_prop', targetHeightMeters: TATOOINE_TARGET_METERS.pitDroidHeight }; });
        this.clonedRoots.push(clone);
      }
      console.info('[W226.5 STAGE] optimized pit droids', { placements: droidPlacements.map(spot => spot.id), measuredHeightM: initialHeight, normalizationScale: droidScale.scale, meshesPerActor: droid.meshes.length });
    }

    if (pads.length > 2) {
      const antenna = await this.loader.load(w226Asset('antenna_7m.glb'), this.scene);
      this.assets.push(antenna); antenna.animationGroups.forEach(group => group.stop());
      const antennaConfig = w2272ScenicStaged() ? W2272_SCENIC.antennaPosition : W226_ANTENNA;
      const antennaHeight = w2272ScenicStaged() ? W2272_SCENIC.antennaHeight : w2271ScenicStaged() ? W2271_SCENIC.antennaHeight : TATOOINE_TARGET_METERS.antennaHeight;
      const antennaScale = normalizeAndPlace(antenna, antennaConfig.x, antennaConfig.z, antennaHeight, antennaConfig.yaw);
      antenna.meshes.forEach(mesh => { mesh.isPickable = false; mesh.metadata = { ...mesh.metadata, w226ServiceLandmark: true }; });
      console.info('[W226.5 STAGE] normalized communications antenna', { heightM: measuredBounds(antenna).height, scale: antennaScale.scale, x: antennaConfig.x, z: antennaConfig.z });
    }

    // Static W226 box architecture has no individual gameplay/collision role;
    // merge it by shared material to cap staging draw calls. Navigation uses
    // the existing collision/navigation proxies, not these render meshes.
    const staticArchitecture = this.meshes.filter((mesh): mesh is Mesh => mesh instanceof Mesh
      && mesh.name.startsWith('w225_w226_') && mesh.metadata?.cameraBlocker === false);
    const architectureGroups = new Map<string, Mesh[]>();
    for (const mesh of staticArchitecture) {
      const layout = mesh.getVerticesDataKinds().sort().join('|');
      const key = `${mesh.material?.uniqueId ?? 'none'}:${layout}`;
      const group = architectureGroups.get(key) ?? []; group.push(mesh); architectureGroups.set(key, group);
    }
    const oldArchitecture = new Set<Mesh>(), mergedArchitecture: Mesh[] = [];
    for (const group of architectureGroups.values()) if (group.length > 1) {
      const merged = Mesh.MergeMeshes(group, true, true, undefined, false, false);
      if (merged) {
        merged.name = `w226_architecture_merged_${mergedArchitecture.length}`;
        merged.metadata = { w226StaticArchitecture: true, cameraBlocker: false };
        merged.isPickable = false; mergedArchitecture.push(merged); group.forEach(mesh => oldArchitecture.add(mesh));
      }
    }
    if (oldArchitecture.size) {
      for (let index = this.meshes.length - 1; index >= 0; index--) if (oldArchitecture.has(this.meshes[index] as Mesh)) this.meshes.splice(index, 1);
      this.meshes.push(...mergedArchitecture);
    }
  }
  private placeW226Imported(asset: ImportedAsset, x: number, z: number, scale: number, yaw: number) {
    asset.root.scaling.setAll(scale); asset.root.rotation.y = yaw;
    let min = new Vector3(Infinity, Infinity, Infinity), max = new Vector3(-Infinity, -Infinity, -Infinity);
    for (const mesh of asset.meshes) {
      mesh.computeWorldMatrix(true); const bounds = mesh.getBoundingInfo().boundingBox;
      min.minimizeInPlace(bounds.minimumWorld); max.maximizeInPlace(bounds.maximumWorld);
    }
    asset.root.position.set(x - (min.x + max.x) / 2, -min.y, z - (min.z + max.z) / 2);
    asset.root.computeWorldMatrix(true);
  }
  private async build(spawn: SpawnId) {
    const interior = this.sceneId === 'tatooineCantina' || this.sceneId === 'tatooineFireflyInterior';
    const visualStage = import.meta.env.DEV && new URLSearchParams(location.search).get('tatooineVisualStage') === '1';
    const w2272Spaceport = w2272ScenicStaged() && this.sceneId === 'tatooineSpaceport';
    const w2271Spaceport = w2271ScenicStaged() && this.sceneId === 'tatooineSpaceport';
    // The boss room is a roofed GLB interior; a hidden sky dome costs GPU time there.
    const visual = typeof window !== 'undefined' && !interior && this.sceneId !== 'tatooineBoss'
      && (TATOOINE_VISUAL_PROMOTED || visualStage || w2272Spaceport);
    const textureRoot = w2272Spaceport ? W2272_ASSET_ROOT : w2271Spaceport ? W2271_ASSET_ROOT : visualStage ? TATOOINE_VISUAL.stagingTextureRoot : TATOOINE_VISUAL.productionTextureRoot;
    this.scene.clearColor = interior ? new Color4(0.1, 0.065, 0.04, 1) : w2272Spaceport
      ? new Color4(0.48, 0.60, 0.68, 1) : visual ? new Color4(...TATOOINE_VISUAL.clearColor, 1) : new Color4(0.72, 0.77, 0.78, 1);
    this.scene.fogMode = visual ? Scene.FOGMODE_LINEAR : Scene.FOGMODE_EXP2;
    this.scene.fogDensity = interior ? 0 : 0.0025;
    if (visual) { this.scene.fogStart = w2272Spaceport ? W2272_SCENIC.fogStart : w2271Spaceport ? W2271_SCENIC.fogStart : TATOOINE_VISUAL.fogStart; this.scene.fogEnd = w2272Spaceport ? W2272_SCENIC.fogEnd : w2271Spaceport ? W2271_SCENIC.fogEnd : TATOOINE_VISUAL.fogEnd; }
    this.scene.fogColor = visual ? (w2272Spaceport ? new Color3(0.82, 0.73, 0.60) : w2271Spaceport ? new Color3(0.78, 0.70, 0.58) : new Color3(...TATOOINE_VISUAL.fogColor)) : new Color3(0.77, 0.66, 0.48);
    const fill = new HemisphericLight('w223_fill', new Vector3(0, 1, 0), this.scene);
    fill.intensity = interior ? 0.8 : visual ? (w2272Spaceport ? 0.79 : w2271Spaceport ? 0.69 : TATOOINE_VISUAL.fillIntensity) : 0.6;
    fill.groundColor = visual ? new Color3(0.23, 0.18, 0.13) : new Color3(0.18, 0.13, 0.08);
    if (visual) fill.diffuse = new Color3(0.84, 0.9, 0.94);
    const sun = new DirectionalLight('w223_sun', new Vector3(-0.5, -1, 0.3), this.scene);
    sun.intensity = interior ? 0.3 : visual ? (w2272Spaceport ? 0.88 : w2271Spaceport ? 0.83 : TATOOINE_VISUAL.sunIntensity) : 0.7;
    sun.diffuse = visual ? new Color3(1, 0.91, 0.75) : new Color3(1, 0.92, 0.8); this.lights.push(fill, sun);
    if (visual) this.installDesertSky(textureRoot);
    let bounds: TatooineBounds, desired = new Vector3(0, 0, -25), detailed: AbstractMesh[] = [];
    if (this.sceneId === 'tatooineFireflyInterior') {
      bounds = { minX: -5.8, maxX: 5.8, minZ: -9.5, maxZ: 9.5 }; desired.set(0, 0, -3);
      this.buildFireflyCabin();
      this.portal('Salir al espaciopuerto', 'tatooineSpaceport', new Vector3(0, 0, 7), 'tatooineArrival');
    } else if (this.sceneId === 'tatooineSpaceport') {
      const serviceDockMode = w2251Active();
      bounds = serviceDockMode ? { minX: -112, maxX: 112, minZ: -50, maxZ: 106 } : { minX: -67, maxX: 67, minZ: -35, maxZ: 91 };
      desired.set(serviceDockMode ? (spawn === 'tatooineSpaceportReturn' ? W225_1_RETURN_SPAWN.x : w226Active() ? W226_ARRIVAL_SPAWN.x : W225_1_ARRIVAL_SPAWN.x) : (spawn === 'tatooineSpaceportReturn' ? 0 : -34), 0,
        serviceDockMode ? (spawn === 'tatooineSpaceportReturn' ? W225_1_RETURN_SPAWN.z : w226Active() ? W226_ARRIVAL_SPAWN.z : W225_1_ARRIVAL_SPAWN.z) : (spawn === 'tatooineSpaceportReturn' ? 83 : 43));
      await this.buildSpaceport();
    } else if (this.sceneId === 'tatooineHub') {
      bounds = { minX: -45, maxX: 45, minZ: -30, maxZ: 55 }; desired.z = -20;
      await this.place('kit', new Vector3(-22, 0, 8));
      await this.place('house', new Vector3(16, 0, -9), 0.8);
      await this.place('market', new Vector3(14, 0, 18), 0.34);
      await this.place('periphery', new Vector3(26, 0, 31), 0.8);
      await this.place('cantinaExterior', new Vector3(-17, 0, 35), 0.28);
      await this.place('filler', new Vector3(12, 0, 42), 0.16);
      this.portal('Entrar a la cantina', 'tatooineCantina', new Vector3(-17, 0, 26));
      this.portal('Salir a las afueras', 'tatooineOutskirts', new Vector3(0, 0, 48));
      if (W225_PROMOTED || (import.meta.env.DEV && new URLSearchParams(location.search).get('w225Stage') === '1'))
        this.portal('Volver al espaciopuerto', 'tatooineSpaceport', new Vector3(0, 0, -26), 'tatooineSpaceportReturn');
      else this.portal('Volver a la nave', 'shipInterior', new Vector3(0, 0, -26), 'shipStart');
      if (spawn === 'tatooineCantinaReturn') desired.set(-17, 0, 24);
      else if (spawn === 'tatooineReturn') desired.set(0, 0, 43);
      else if (spawn === 'tatooineSpaceportReturn') desired.set(0, 0, -20);
    } else if (this.sceneId === 'tatooineCantina') {
      const asset = await this.place('cantina', Vector3.Zero(), 1, 'Ground_lambert3_0');
      for (const mesh of asset.meshes) if (/Forge|Tongs|Targets|Meditation|Rock[2-5]/i.test(mesh.name)) mesh.setEnabled(false);
      const floor = asset.meshes.find(m => m.name.includes('Ground_lambert3_0'))!.getBoundingInfo().boundingBox;
      bounds = { minX: floor.minimumWorld.x + 1, maxX: floor.maximumWorld.x - 1, minZ: floor.minimumWorld.z + 1, maxZ: floor.maximumWorld.z - 1 };
      desired.set(-2, 0, 12); detailed = asset.meshes;
      this.portal('Volver al poblado', 'tatooineHub', new Vector3(-2, 0, 15), 'tatooineCantinaReturn');
    } else if (this.sceneId === 'tatooineBoss') {
      const asset = await this.place('boss', Vector3.Zero(), 1, 'Base_lambert1_0');
      bounds = { minX: -13.2, maxX: 13.2, minZ: -13.2, maxZ: 13.2 };
      desired.set(3, 0, -10); detailed = asset.meshes;
      this.portal('Volver al campamento', 'tatooineCamp', new Vector3(3, 0, -11), 'tatooineReturn');
    } else {
      bounds = { minX: -8, maxX: 8, minZ: -30, maxZ: 30 };
      if (spawn === 'tatooineReturn') desired.z = 24;
      const routes = {
        tatooineOutskirts: { key: 'outskirts', x: -32, scale: 0.48, floor: 0.38, previous: 'tatooineHub', next: 'tatooineCheckpoint' },
        tatooineCheckpoint: { key: 'checkpoint', x: -27, scale: 0.5, floor: 0.01, previous: 'tatooineOutskirts', next: 'tatooineCamp' },
        tatooineCamp: { key: 'camp', x: -46, scale: 0.4, floor: -0.16, previous: 'tatooineCheckpoint', next: 'tatooineBoss' },
      } as const;
      const route = routes[this.sceneId];
      await this.place(route.key, new Vector3(route.x, 0, 8), route.scale, undefined, route.floor);
      // Close landmarks make each checkpoint readable from the protected
      // route without requiring navigation over the donor's uneven terrain.
      if (this.sceneId === 'tatooineCheckpoint') await this.place('filler', new Vector3(5, 0, 9), 0.12);
      if (this.sceneId === 'tatooineCamp') await this.place('house', new Vector3(4.7, 0, 12), 0.55);
      const supplyMaterial = this.material('route_supplies', new Color3(0.32, 0.28, 0.21));
      if (this.sceneId === 'tatooineCamp') for (let i = 0; i < 3; i++) {
        const crate = MeshBuilder.CreateBox(`w223_supply_${i}`, { size: 0.8 }, this.scene);
        crate.position.set(4 + i * 0.9, 0.4, 17); crate.material = supplyMaterial; crate.isPickable = true;
        crate.metadata = { cameraBlocker: true }; this.meshes.push(crate);
        this.collision.addBox(`w223_supply_collision_${i}`, crate.position, new Vector3(0.8, 0.8, 0.8), true);
      }
      const edgeMaterial = this.material('path_edges', new Color3(0.43, 0.30, 0.17));
      for (const x of [-8, 8]) {
        const curb = MeshBuilder.CreateBox('w223_path_edge', { width: 0.25, height: 0.15, depth: 60 }, this.scene);
        curb.position.set(x, 0.075, 0); curb.material = edgeMaterial; curb.isPickable = false; this.meshes.push(curb);
        for (let z = -24; z <= 24; z += 8) {
          const post = MeshBuilder.CreateCylinder('w223_route_beacon', { height: 1, diameter: 0.25, tessellation: 6 }, this.scene);
          post.position.set(x, 0.5, z); post.material = edgeMaterial; post.isPickable = false; this.meshes.push(post);
        }
      }
      this.portal('Volver al tramo anterior', route.previous, new Vector3(0, 0, -27), 'tatooineReturn');
      this.portal(`Continuar: ${TATOOINE_ZONES[route.next].title}`, route.next, new Vector3(0, 0, 27));
      const rockMaterial = this.material('rocks', new Color3(0.55, 0.36, 0.20));
      for (let i = 0; i < 8; i++) {
        const rock = MeshBuilder.CreateSphere(`w223_rock_${i}`, { diameter: 1, segments: 4 }, this.scene);
        rock.scaling.set(7 + i % 3, 5 + i % 4, 8); rock.position.set(13 + i % 2 * 4, 1.5, -28 + i * 8);
        rock.material = rockMaterial; rock.isPickable = true; rock.metadata = { cameraBlocker: true }; this.meshes.push(rock);
      }
    }
    if (!interior && this.sceneId !== 'tatooineBoss') {
      const ground = MeshBuilder.CreateGround('w223_sand', { width: 220, height: 220, subdivisions: 1 }, this.scene);
      ground.position.y = -0.015;
      ground.material = visual ? this.desertSand(textureRoot) : this.material('sand', new Color3(0.74, 0.55, 0.32));
      ground.isPickable = false;
      if (w2272ScenicStaged() && this.sceneId === 'tatooineSpaceport') ground.applyFog = false;
      this.meshes.push(ground);
      const duneMaterial = this.material('dunes', visual ? new Color3(0.73, 0.61, 0.45) : new Color3(0.75, 0.57, 0.34));
      for (let i = 0; i < 12; i++) {
        const dune = MeshBuilder.CreateSphere(`w223_dune_${i}`, { diameter: 1, segments: 12 }, this.scene);
        if (w2272Spaceport) dune.scaling.set(44 + i % 3 * 6, 3.2 + i % 3 * 0.5, 23);
        else dune.scaling.set(40 + i % 3 * 9, 7 + i % 4 * 3, 30);
        const angle = i / 12 * Math.PI * 2;
        const radius = w2272Spaceport ? 168 : 100;
        dune.position.set(Math.cos(angle) * radius, -3, Math.sin(angle) * radius);
        dune.material = duneMaterial; dune.isPickable = false;
        if (w2272Spaceport) dune.applyFog = false;
        this.meshes.push(dune);
      }
      if (visual) this.installDesertSuns(textureRoot);
      else {
        const sunMaterial = this.material('binary_suns', new Color3(1, 0.84, 0.53)); sunMaterial.emissiveColor.set(1, 0.7, 0.35); sunMaterial.disableLighting = true;
        for (let i = 0; i < 2; i++) {
          const sphere = MeshBuilder.CreateSphere(`w223_sun_disc_${i}`, { diameter: i ? 10 : 16, segments: 16 }, this.scene);
          sphere.position.set(-70 + i * 22, 60 - i * 10, 140); sphere.material = sunMaterial; sphere.isPickable = false; this.meshes.push(sphere);
        }
      }
    }
    this.installW2273GroundLanguage();
    await this.installW2273BFlags();
    this.navigation = new TatooineNavigation(this.collision, bounds, desired, detailed);
    if (Vector3.Distance(this.navigation.spawn, desired) > 6) throw new Error(`Tatooine: unsafe requested spawn (${this.sceneId})`);
    for (const portal of this.portals) {
      const safe = this.navigation.nearest(portal.position);
      const reachable = Vector3.Distance(safe, portal.position) <= 6 && this.navigation.pathTo(safe).length > 0;
      if (!reachable) {
        throw new Error(`Tatooine: unreachable portal ${portal.label}`);
      }
      portal.position.copyFrom(safe); this.markPortal(portal);
      this.interaction.register({ id: `w223_${portal.destination}`, label: portal.label, position: portal.position,
        radius: 2.3, enabled: () => this.canTravel(), action: () => {
          if (!this.canTravel()) return;
          void this.travel(portal.destination, portal.spawn).catch(error => { console.error('[W223] portal failed', error); });
        } });
    }
    if (this.sceneId === 'tatooineBoss') this.trainingDummy = new TrainingDummy(this.scene, this.navigation.nearest(new Vector3(3, 0, 3)), { maxHealth: 200 });
    if (this.living?.enabled) {
      this.progress(0.88, 'Tatooine: habitantes');
      this.population = await TatooinePopulation.create(this.sceneId, this.scene, this.loader, this.interaction,
        this.navigation, this.living.stagedActors, () => this.player.position, this.living.dialogue, this.living.quest);
      const quest = this.living.quest;
      if (this.sceneId === 'tatooineFireflyInterior') quest?.markTatooineEvent('ARRIVED_AT_SPACEPORT');
      if (this.sceneId === 'tatooineSpaceport') { quest?.markTatooineEvent('ARRIVED_AT_SPACEPORT'); quest?.markTatooineEvent('LEFT_FIREFLY'); }
      if (this.sceneId === 'tatooineHub') {
        quest?.markTatooineEvent('ARRIVED_AT_SPACEPORT'); quest?.markTatooineEvent('LEFT_FIREFLY'); quest?.markTatooineEvent('REACHED_SETTLEMENT');
        quest?.markTatooineEvent('ARRIVED_TATOOINE');
        if (quest?.tatooineMissionEvents.includes('DEFEATED_RANCOR')) quest.markTatooineEvent('RETURNED_TO_HUB');
      }
      if (this.sceneId === 'tatooineCantina') quest?.markTatooineEvent('VISITED_CANTINA');
      if (this.sceneId === 'tatooineOutskirts') quest?.markTatooineEvent('LEFT_SETTLEMENT');
      if (this.sceneId === 'tatooineCheckpoint') quest?.markTatooineEvent('REACHED_CHECKPOINT');
      if (this.sceneId === 'tatooineCamp') quest?.markTatooineEvent('REACHED_CAMP');
      if (this.sceneId === 'tatooineBoss') quest?.markTatooineEvent('ENTERED_ARENA');
    }
    this.player.setCollisionResolver(position => { this.navigation.resolve(position); this.population?.resolvePlayer(position); this.navigation.resolve(position); });
    this.player.setPosition(this.navigation.spawn); this.player.setFacingYaw(interior || spawn === 'tatooineReturn' || this.sceneId === 'tatooineSpaceport' ? Math.PI : 0);
    this.loadMilliseconds = performance.now() - this.started; this.makePanel();
    console.info('[W223] ZONE READY', { scene: this.sceneId, assetCount: this.assets.length, walkableCells: this.navigation.walkableCells,
      spawn: this.navigation.spawn.asArray(), portals: this.portals.map(p => ({ label: p.label, position: p.position.asArray() })), loadMilliseconds: this.loadMilliseconds });
  }
  private markPortal(portal: TatooinePortal) {
    const marker = MeshBuilder.CreateTorus(`w223_portal_${portal.destination}`, { diameter: 2, thickness: 0.09, tessellation: 32 }, this.scene);
    marker.position.copyFrom(portal.position).y = 0.08; marker.isPickable = false;
    const material = this.material(`portal_${portal.destination}`, new Color3(0.2, 0.75, 0.87)); material.emissiveColor.set(0.08, 0.4, 0.5); marker.material = material; this.meshes.push(marker);
    if (typeof document === 'undefined') return;
    const texture = new DynamicTexture(`w223_sign_${portal.destination}`, { width: 512, height: 128 }, this.scene, false);
    texture.drawText(portal.label, null, 76, 'bold 24px sans-serif', '#fff3d0', '#382616', true);
    const signMaterial = this.material(`sign_${portal.destination}`, Color3.White()); signMaterial.diffuseTexture = texture; signMaterial.emissiveColor.set(0.6, 0.6, 0.6); signMaterial.backFaceCulling = false;
    const sign = MeshBuilder.CreatePlane(`w223_sign_${portal.destination}`, { width: 2.2, height: 0.55 }, this.scene);
    sign.position.copyFrom(portal.position).addInPlace(new Vector3(2.2, 1.5, 0)); sign.material = signMaterial; sign.billboardMode = 7; sign.isPickable = false;
    this.meshes.push(sign); this.textures.push(texture);
  }
  private makePanel() {
    if (typeof document === 'undefined') return;
    const quest = document.getElementById('questHud'); if (quest) { this.oldQuestDisplay = quest.style.display; quest.style.display = 'none'; }
    this.panel = document.createElement('div'); this.panel.id = 'tatooineWorldHud';
    Object.assign(this.panel.style, { position: 'fixed', left: '16px', top: '82px', zIndex: '30', maxWidth: '330px', padding: '10px', background: '#21180dcc', color: '#f8e6bd', font: '13px sans-serif', border: '1px solid #c8a768' });
    const title = document.createElement('strong'); title.textContent = TATOOINE_ZONES[this.sceneId].title; this.panel.append(title);
    const objective = document.createElement('p'); objective.textContent = TATOOINE_ZONES[this.sceneId].objective; this.panel.append(objective);
    const boss = this.population?.rancor ? document.createElement('div') : undefined;
    const bossLabel = boss ? document.createElement('span') : undefined;
    const bossFill = boss ? document.createElement('div') : undefined;
    if (boss && bossFill && bossLabel) {
      boss.id = 'w224RancorHealth'; bossLabel.textContent = 'RANCOR · 500 / 500 HP';
      boss.style.cssText = 'margin:8px 0;padding:6px;border:1px solid #bb6c56;color:#fff2d8';
      bossFill.style.cssText = 'height:8px;background:#c44835;width:100%;margin-top:5px';
      boss.append(bossLabel, bossFill); this.panel.append(boss);
    }
    const controls = document.createElement('p'); controls.textContent = 'WASD · Shift correr · E viajar · Q sable · LMB combo · J heavy · RMB bloquear · ESC party'; this.panel.append(controls);
    const status = document.createElement('div'); status.id = 'tatooineWorldStatus'; this.panel.append(status);
    const debug = new URLSearchParams(location.search).get('tatooineDebug') === '1';
    if (debug) for (const portal of this.portals) {
      const button = document.createElement('button'); button.textContent = `Situar frente a: ${portal.label}`; button.style.display = 'block'; button.style.marginTop = '4px';
      button.onclick = () => { if (this.canTravel()) this.player.setPosition(portal.position); };
      this.panel.append(button);
    }
    const debugPads = w2251Active()
      ? W225_1_PADS.map((pad, index) => w226Active() ? { ...pad, x: W226_PAD_CENTERS[index] } : pad)
      : W225_PADS;
    if (debug && this.sceneId === 'tatooineSpaceport') for (const pad of debugPads) {
      const button = document.createElement('button'); button.textContent = `Situar en muelle ${pad.id}`;
      button.style.display = 'block'; button.style.marginTop = '4px';
      button.onclick = () => {
        if (!this.canTravel()) return;
        const clusterView = w226Active()
          ? pad.id === 'A' ? new Vector3(W226_DRESSING_ANCHORS.maintenance.x + 3, 0, W226_DRESSING_ANCHORS.maintenance.z + 5)
            : pad.id === 'B' ? new Vector3(W226_DRESSING_ANCHORS.cargo.x + 1, 0, W226_DRESSING_ANCHORS.cargo.z + 5)
              : new Vector3(W226_DRESSING_ANCHORS.communications.x - 6, 0, W226_DRESSING_ANCHORS.communications.z + 5)
          : new Vector3(pad.x, 0, w2251Active() ? pad.z + 24 : 46);
        const target = !w226Active() ? new Vector3(pad.x, 0, pad.z)
          : pad.id === 'A' ? new Vector3(W225_1_PADS[0].x, 0, W225_1_PADS[0].z)
            : pad.id === 'B' ? new Vector3(W226_DRESSING_ANCHORS.cargo.x + 5, 0, W226_DRESSING_ANCHORS.cargo.z + 1)
              : new Vector3(w2272ScenicStaged() ? W2272_SCENIC.antennaPosition.x : W226_ANTENNA.x, 0, w2272ScenicStaged() ? W2272_SCENIC.antennaPosition.z : W226_ANTENNA.z);
        this.player.setPosition(this.navigation.nearest(clusterView));
        this.player.setFacingYaw(Math.atan2(target.x - clusterView.x, target.z - clusterView.z));
      };
      this.panel.append(button);
    }
    if (debug && this.trainingDummy) {
      const button = document.createElement('button'); button.textContent = 'Acercarse al blanco de entrenamiento';
      button.style.display = 'block'; button.style.marginTop = '4px';
      button.onclick = () => {
        if (!this.canTravel() || !this.trainingDummy) return;
        this.player.setPosition(this.navigation.nearest(this.trainingDummy.position.add(new Vector3(0, 0, -1.1))));
        this.player.setFacingYaw(0);
      };
      this.panel.append(button);
    }
    if (debug && this.population) for (const actor of this.population.actors.filter(actor => actor.placement.interaction || actor.placement.actor === 'pyke' || actor.placement.actor === 'rancor')) {
      const button = document.createElement('button'); button.textContent = `Acercarse a ${actor.placement.id}`;
      button.style.display = 'block'; button.style.marginTop = '4px';
      button.onclick = () => {
        if (!this.canTravel() || !actor.isAlive) return;
        this.player.setPosition(this.navigation.nearest(actor.position.add(new Vector3(0, 0, -actor.radius - 0.65))));
        this.player.setFacingYaw(0);
      };
      this.panel.append(button);
    }
    document.body.append(this.panel);
    this.observer = this.scene.onBeforeRenderObservable.add(() => {
      const dt = this.scene.getEngine().getDeltaTime() / 1000;
      this.trainingDummy?.update(dt); this.population?.update(dt);
      if (this.living?.enabled) {
        const directZone = !this.living.quest?.tatooineMissionEvents.includes('ARRIVED_TATOOINE');
        const text = directZone ? this.sceneId === 'tatooineBoss' ? 'Derrotá al Rancor (encuentro provisional)'
          : TATOOINE_ZONES[this.sceneId].objective
          : this.living.quest?.tatooineObjective ?? TATOOINE_ZONES[this.sceneId].objective;
        objective.textContent = `Misión de prueba: ${text}`;
      }
      if (bossFill && this.population?.rancor) bossFill.style.width = `${100 * this.population.rancor.currentHealth / this.population.rancor.maxHealth}%`;
      if (bossLabel && this.population?.rancor) bossLabel.textContent = `RANCOR · ${this.population.rancor.currentHealth} / ${this.population.rancor.maxHealth} HP`;
      status.textContent = `READY ${this.sceneId}${this.trainingDummy ? ` · Blanco ${this.trainingDummy.currentHealth}/200 HP` : ''}${this.population?.pyke ? ` · Pyke ${this.population.pyke.currentHealth}/${this.population.pyke.maxHealth} HP` : ''}${debug ? ` · ${Math.round(this.scene.getEngine().getFps())} FPS · ${this.scene.meshes.length} meshes · ${(this.loadMilliseconds / 1000).toFixed(2)} s · posición ${this.player.position.asArray().map(v => v.toFixed(1)).join(',')}` : ''}`;
    });
  }
  dispose() {
    if (this.observer) this.scene.onBeforeRenderObservable.remove(this.observer);
    this.panel?.remove();
    if (typeof document !== 'undefined') { const quest = document.getElementById('questHud'); if (quest) quest.style.display = this.oldQuestDisplay; }
    this.population?.dispose(); this.trainingDummy?.dispose(); this.flagInstances.forEach(instance => instance.dispose()); this.clonedRoots.forEach(root => root.dispose(false, false)); this.flagContainers.forEach(container => container.dispose()); this.assets.forEach(asset => asset.dispose());
    this.meshes.forEach(mesh => mesh.dispose()); this.materials.forEach(material => material.dispose()); this.textures.forEach(texture => texture.dispose());
    this.lights.forEach(light => light.dispose()); this.collision.dispose();
    this.scene.clearColor = this.previousSceneSettings.clear;
    this.scene.fogMode = this.previousSceneSettings.fogMode; this.scene.fogDensity = this.previousSceneSettings.fogDensity;
    this.scene.fogStart = this.previousSceneSettings.fogStart; this.scene.fogEnd = this.previousSceneSettings.fogEnd;
    this.scene.fogColor = this.previousSceneSettings.fogColor;
    this.scene.getEngine().setHardwareScalingLevel(this.previousHardwareScalingLevel);
  }
}


