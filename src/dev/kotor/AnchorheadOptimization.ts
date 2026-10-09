import { AbstractMesh, Matrix, Mesh, Scene, TransformNode, Vector3, VertexData } from '@babylonjs/core';

export type AnchorheadOptimizationMode = 'none' | 'merge' | 'vis' | 'merge-vis';

export type RoomCostRow = {
  room: string;
  meshCountBefore: number;
  meshCountAfter: number;
  lightmappedMeshesBefore: number;
  lightmappedMeshesAfter: number;
  nonLightmappedMeshesBefore: number;
  trianglesBefore: number;
  trianglesAfter: number;
  shaderMaterialCountBefore: number;
  shaderMaterialCountAfter: number;
  diffuseCountBefore: number;
  diffuseCountAfter: number;
  lightmapCountBefore: number;
  lightmapCountAfter: number;
  bounds: { min: number[]; max: number[] } | null;
  visNeighbors: string[];
};

export type MergeLineageRow = {
  optimizedMesh: string;
  room: string;
  materialKey: string;
  alphaMode: string;
  sourceMeshes: string[];
  sourceStableIds: string[];
  sourceTriangleCount: number;
  resultTriangleCount: number;
  preservedAttributes: { positions: boolean; normals: boolean; uv0: boolean; uv1: boolean; indices: boolean };
};

export type VisValidation = {
  sourceRoomCount: number;
  roomRootCount: number;
  renderableRoomCount: number;
  edges: number;
  normalizedEdges: number;
  unresolvedSources: string[];
  unresolvedReferences: string[];
  aliasesApplied: Array<{ source: string; target: string }>;
  nonRenderableTargetsIgnored: Array<{ target: string; occurrences: number; reason: string }>;
  visibleRoomsByRoom: Record<string, string[]>;
  fallbackPolicy: string;
};

export type AnchorheadOptimizationResult = {
  mode: AnchorheadOptimizationMode;
  sourceMeshCount: number;
  optimizedMeshCount: number;
  mergedSourceMeshes: number;
  mergeGroups: number;
  opaqueMerged: number;
  maskMerged: number;
  blendMerged: number;
  totalTrianglesBefore: number;
  totalTrianglesAfter: number;
  roomCosts: RoomCostRow[];
  mergeLineage: MergeLineageRow[];
  vis: VisValidation;
  currentRoomDetection: string;
  freezeWorldMatrices: number;
  freezeMaterials: number;
  fallbackCount: number;
  materialSampleRegression: { sampleCount: number; passCount: number; failCount: number; failures: string[] };
};

type RoomEntry = { id: string; node: TransformNode; meshes: AbstractMesh[]; bounds: { min: Vector3; max: Vector3 } | null };

const VIS_ALIASES: Record<string, string> = { m17aa11b: 'm17aa_11b' };
const INTENTIONALLY_NON_RENDERED_VIS_TARGETS = new Set(['m17aa_09w']);
const NON_INTERACTIVE_MESH_PATTERN = /(?:^|[_\-])(debug|marker|trigger|waypoint|npc|placeable|collider)(?:[_\-]|$)/i;

function roomIdOf(mesh: AbstractMesh): string | null {
  let node = mesh.parent;
  while (node) {
    if (node.name.startsWith('GLB_Room_')) return node.name.replace(/^GLB_Room_/, '');
    node = node.parent;
  }
  return null;
}

function roomNodeOf(mesh: AbstractMesh): TransformNode | null {
  let node = mesh.parent;
  while (node) {
    if (node.name.startsWith('GLB_Room_')) return node as TransformNode;
    node = node.parent;
  }
  return null;
}

function isRenderable(mesh: AbstractMesh): boolean {
  return !mesh.isDisposed() && mesh.getTotalVertices() > 0 && Boolean(mesh.getVerticesData('position'));
}

function materialAlphaMode(material: any): string {
  const metadataMode = String(material?.metadata?.__anchorheadAlphaMode ?? material?.metadata?.gltf?.alphaMode ?? material?.metadata?.alphaMode ?? '').toUpperCase();
  if (metadataMode === 'BLEND' || metadataMode === 'ODYSSEY_BLEND') return 'BLEND';
  if (metadataMode === 'MASK' || metadataMode === 'ODYSSEY_MASK') return 'MASK';
  if (metadataMode === 'OPAQUE' || metadataMode === 'ODYSSEY_OPAQUE') return 'OPAQUE';
  // Babylon transparencyMode=1 is also a loader default; canonical GLB bindings are OPAQUE per W228.2J.
  const alphaCutoff = Number(material?.metadata?.gltf?.alphaCutoff ?? 0);
  if (Number(material?.alpha ?? 1) < 0.999 || material?.transparencyMode === 2) return 'BLEND';
  if (alphaCutoff > 0) return 'MASK';
  return 'OPAQUE';
}
function getTextureIdentity(material: any, sampler: string): string {
  const texture = material?.getTexture?.(sampler);
  if (!texture) return 'none';
  const internalId = texture.getInternalTexture?.()?.uniqueId;
  return String(texture.url ?? texture.name ?? internalId ?? texture.uniqueId ?? 'texture');
}

function canonicalMaterialKey(material: any, mesh: AbstractMesh): string {
  const stored = material?.metadata?.__anchorheadCanonicalKey;
  if (stored) return String(stored);
  const factor = material?.metadata?.__anchorheadBaseColorFactor
    ?? material?.albedoColor?.asArray?.()
    ?? material?.diffuseColor?.asArray?.()
    ?? [1, 1, 1, 1];
  const alphaMode = materialAlphaMode(material);
  const alphaCutoff = material?.metadata?.__anchorheadAlphaCutoff ?? material?.alphaCutOff ?? material?.alphaCutoff ?? 0;
  const doubleSided = material?.backFaceCulling === false;
  return JSON.stringify({
    diffuse: getTextureIdentity(material, 'diffuseSampler') !== 'none'
      ? getTextureIdentity(material, 'diffuseSampler')
      : getTextureIdentity(material, 'albedoTexture'),
    lightmap: getTextureIdentity(material, 'lightmapSampler'),
    factor,
    alphaMode,
    alphaCutoff,
    doubleSided,
    shader: material?.getClassName?.() ?? material?.constructor?.name ?? 'none',
    meshAttributes: ['position', 'normal', 'uv', 'uv2'].map((kind) => Boolean(mesh.getVerticesData(kind))),
  });
}

function boundsOf(meshes: AbstractMesh[]): { min: Vector3; max: Vector3 } | null {
  const populated = meshes.filter(isRenderable);
  if (!populated.length) return null;
  const min = new Vector3(Infinity, Infinity, Infinity);
  const max = new Vector3(-Infinity, -Infinity, -Infinity);
  for (const mesh of populated) {
    mesh.computeWorldMatrix(true);
    const box = mesh.getBoundingInfo().boundingBox;
    min.minimizeInPlace(box.minimumWorld);
    max.maximizeInPlace(box.maximumWorld);
  }
  return { min, max };
}

function makeRoomEntries(scene: Scene, meshes: AbstractMesh[]): RoomEntry[] {
  const nodes = new Map<string, TransformNode>();
  for (const node of [...scene.transformNodes, ...scene.meshes]) {
    if (node.name.startsWith('GLB_Room_')) nodes.set(node.name.replace(/^GLB_Room_/, ''), node as TransformNode);
  }
  const roomMeshes = new Map<string, AbstractMesh[]>();
  for (const mesh of meshes) {
    const id = roomIdOf(mesh);
    if (id) {
      const values = roomMeshes.get(id) ?? [];
      values.push(mesh);
      roomMeshes.set(id, values);
    }
  }
  return [...nodes.entries()].map(([id, node]) => {
    const childMeshes = roomMeshes.get(id) ?? [];
    return { id, node, meshes: childMeshes, bounds: boundsOf(childMeshes) };
  });
}

function alphaChannelSignature(mesh: AbstractMesh): string {
  return ['position', 'normal', 'uv', 'uv2'].map((kind) => kind + ':' + Boolean(mesh.getVerticesData(kind))).join('|');
}

function mergeGroupToRoomLocal(group: AbstractMesh[], room: RoomEntry, scene: Scene, name: string): Mesh {
  const positions: number[] = [];
  const normals: number[] = [];
  const uv0: number[] = [];
  const uv1: number[] = [];
  const indices: number[] = [];
  const hasNormals = Boolean(group[0].getVerticesData('normal'));
  const hasUv0 = Boolean(group[0].getVerticesData('uv'));
  const hasUv1 = Boolean(group[0].getVerticesData('uv2'));
  const roomWorld = room.node.computeWorldMatrix(true).clone();
  const inverseRoomWorld = roomWorld.clone();
  inverseRoomWorld.invert();
  const normalMatrixFor = (relative: Matrix) => relative.clone().invert().transpose();

  for (const source of group) {
    const sourcePositions = source.getVerticesData('position');
    const sourceIndices = source.getIndices();
    if (!sourcePositions || !sourceIndices) throw new Error('Merge candidate lacks positions or indices: ' + source.name);
    source.computeWorldMatrix(true);
    const relative = source.getWorldMatrix().multiply(inverseRoomWorld);
    const normalMatrix = normalMatrixFor(relative);
    const baseVertex = positions.length / 3;
    for (let i = 0; i < sourcePositions.length; i += 3) {
      const p = Vector3.TransformCoordinates(new Vector3(sourcePositions[i], sourcePositions[i + 1], sourcePositions[i + 2]), relative);
      positions.push(p.x, p.y, p.z);
    }
    if (hasNormals) {
      const sourceNormals = source.getVerticesData('normal');
      if (!sourceNormals) throw new Error('Merge group has mismatched normal attributes.');
      for (let i = 0; i < sourceNormals.length; i += 3) {
        const n = Vector3.TransformNormal(new Vector3(sourceNormals[i], sourceNormals[i + 1], sourceNormals[i + 2]), normalMatrix).normalize();
        normals.push(n.x, n.y, n.z);
      }
    }
    if (hasUv0) {
      const values = source.getVerticesData('uv');
      if (!values) throw new Error('Merge group has mismatched UV0 attributes.');
      uv0.push(...values);
    }
    if (hasUv1) {
      const values = source.getVerticesData('uv2');
      if (!values) throw new Error('Merge group has mismatched UV1 attributes.');
      uv1.push(...values);
    }
    for (const index of sourceIndices) indices.push(baseVertex + index);
  }

  const merged = new Mesh(name, scene);
  const data = new VertexData();
  data.positions = positions;
  data.indices = indices;
  if (hasNormals) data.normals = normals;
  if (hasUv0) data.uvs = uv0;
  if (hasUv1) data.uvs2 = uv1;
  data.applyToMesh(merged, true);
  merged.parent = room.node;
  merged.material = group[0].material;
  merged.isPickable = false;
  merged.metadata = {
    __anchorheadOptimized: true,
    __anchorheadRoom: room.id,
    __anchorheadMergedSourceStableIds: group.map((mesh) => String((mesh.metadata as any)?.__anchorheadOdysseyBinding?.sourceStableId ?? (room.id + '::' + mesh.name))),
    __anchorheadDiffuseImages: [...new Set(group.map((mesh) => (mesh.metadata as any)?.__anchorheadOdysseyBinding?.diffuse).filter(Boolean))],
    __anchorheadLightmaps: [...new Set(group.map((mesh) => (mesh.metadata as any)?.__anchorheadOdysseyBinding?.lightmap).filter(Boolean))],
    __anchorheadMergedLightmappedSourceCount: group.filter((mesh) => Boolean((mesh.metadata as any)?.__anchorheadOdysseyBinding)).length,
  };
  merged.computeWorldMatrix(true);
  return merged;
}

function mergeRoomMeshes(entries: RoomEntry[], sourceMeshes: AbstractMesh[], scene: Scene, lineage: MergeLineageRow[]) {
  let mergedSourceMeshes = 0;
  let opaqueMerged = 0;
  let maskMerged = 0;
  let blendMerged = 0;
  let groupCount = 0;

  for (const room of entries) {
    const groups = new Map<string, AbstractMesh[]>();
    for (const mesh of room.meshes) {
      if (!isRenderable(mesh) || !(mesh instanceof Mesh) || mesh.skeleton) continue;
      if (mesh.metadata?.futureInteractive || mesh.metadata?.debug || mesh.metadata?.isDebug) continue;
      if (NON_INTERACTIVE_MESH_PATTERN.test(mesh.name)) continue;
      if (!mesh.getIndices()) continue;
      const alphaMode = materialAlphaMode(mesh.material);
      if (alphaMode === 'BLEND') {
        blendMerged++;
        continue;
      }
      const key = JSON.stringify({
        room: room.id,
        parent: mesh.parent?.uniqueId,
        material: canonicalMaterialKey(mesh.material, mesh),
        alphaMode,
        doubleSided: mesh.material?.backFaceCulling === false,
        alphaCutoff: mesh.material?.metadata?.__anchorheadAlphaCutoff ?? (mesh.material as any)?.alphaCutOff ?? (mesh.material as any)?.alphaCutoff ?? 0,
        attributes: alphaChannelSignature(mesh),
      });
      const candidates = groups.get(key) ?? [];
      candidates.push(mesh);
      groups.set(key, candidates);
    }

    let groupIndex = 0;
    for (const [key, candidates] of groups) {
      if (candidates.length < 2) continue;
      const material = candidates[0].material;
      const alphaMode = materialAlphaMode(material);
      const triangles = candidates.reduce((sum, mesh) => sum + mesh.getTotalIndices() / 3, 0);
      const name = 'AnchorheadMerged_' + room.id + '_' + groupIndex++;
      const merged = mergeGroupToRoomLocal(candidates, room, scene, name);
      const resultTriangles = merged.getTotalIndices() / 3;
      if (Math.abs(resultTriangles - triangles) > 0.0001) {
        merged.dispose(false, false);
        throw new Error('Triangle count changed while merging ' + room.id + ': ' + triangles + ' -> ' + resultTriangles);
      }
      const sourceStableIds = candidates.map((mesh) => String((mesh.metadata as any)?.__anchorheadOdysseyBinding?.sourceStableId ?? (room.id + '::' + mesh.name)));
      lineage.push({
        optimizedMesh: name,
        room: room.id,
        materialKey: key,
        alphaMode,
        sourceMeshes: candidates.map((mesh) => mesh.name),
        sourceStableIds,
        sourceTriangleCount: triangles,
        resultTriangleCount: resultTriangles,
        preservedAttributes: {
          positions: merged.getTotalVertices() === candidates.reduce((sum, mesh) => sum + mesh.getTotalVertices(), 0),
          normals: candidates.every((mesh) => Boolean(mesh.getVerticesData('normal')) === Boolean(merged.getVerticesData('normal'))),
          uv0: candidates.every((mesh) => Boolean(mesh.getVerticesData('uv')) === Boolean(merged.getVerticesData('uv'))),
          uv1: candidates.every((mesh) => Boolean(mesh.getVerticesData('uv2')) === Boolean(merged.getVerticesData('uv2'))),
          indices: merged.getTotalIndices() === candidates.reduce((sum, mesh) => sum + mesh.getTotalIndices(), 0),
        },
      });
      for (const source of candidates) source.dispose(false, false);
      mergedSourceMeshes += candidates.length;
      groupCount += 1;
      if (alphaMode === 'MASK') maskMerged += candidates.length;
      else opaqueMerged += candidates.length;
    }
  }
  return { mergedSourceMeshes, opaqueMerged, maskMerged, blendMerged, groupCount };
}

function roomMetrics(entries: RoomEntry[], vis: VisValidation, after: boolean, scene: Scene): RoomCostRow[] {
  return entries.filter((entry) => scene.meshes.some((mesh) => isRenderable(mesh) && roomIdOf(mesh) === entry.id) || entry.meshes.some(isRenderable)).map((entry) => {
    const meshes = entry.meshes.filter(isRenderable);
    const currentChildren = scene.meshes.filter((mesh) => isRenderable(mesh) && roomIdOf(mesh) === entry.id);
    const bounds = boundsOf(meshes);
    const uniqueMaterials = (list: AbstractMesh[]) => new Set(list.map((mesh) => mesh.material).filter((material: any) => material?.getClassName?.() === 'ShaderMaterial'));
    const beforeMaterials = uniqueMaterials(meshes);
    const afterMaterials = uniqueMaterials(currentChildren);
    const textureNames = (list: AbstractMesh[], key: '__anchorheadDiffuseImages' | '__anchorheadLightmaps', bindingKey: 'diffuse' | 'lightmap') => {
      const result = new Set<string>();
      for (const mesh of list) {
      const metadata: any = mesh.metadata ?? {};
        const values = metadata.__anchorheadOptimized ? metadata[key] ?? [] : [metadata.__anchorheadOdysseyBinding?.[bindingKey]];
        for (const value of values) if (value) result.add(String(value));
      }
      return result;
    };
    const diffuseBefore = textureNames(meshes, '__anchorheadDiffuseImages', 'diffuse');
    const diffuseAfter = textureNames(currentChildren, '__anchorheadDiffuseImages', 'diffuse');
    const lightmapsBefore = textureNames(meshes, '__anchorheadLightmaps', 'lightmap');
    const lightmapsAfter = textureNames(currentChildren, '__anchorheadLightmaps', 'lightmap');
    const row: RoomCostRow = {
      room: entry.id,
      meshCountBefore: meshes.length,
      meshCountAfter: currentChildren.length,
      lightmappedMeshesBefore: meshes.filter((mesh) => Boolean((mesh.metadata as any)?.__anchorheadOdysseyBinding)).length,
      lightmappedMeshesAfter: currentChildren.filter((mesh) => Boolean((mesh.metadata as any)?.__anchorheadOdysseyBinding) || Number((mesh.metadata as any)?.__anchorheadMergedLightmappedSourceCount) > 0).length,
      nonLightmappedMeshesBefore: meshes.filter((mesh) => !(mesh.metadata as any)?.__anchorheadOdysseyBinding).length,
      trianglesBefore: meshes.reduce((sum, mesh) => sum + mesh.getTotalIndices() / 3, 0),
      trianglesAfter: currentChildren.reduce((sum, mesh) => sum + mesh.getTotalIndices() / 3, 0),
      shaderMaterialCountBefore: beforeMaterials.size,
      shaderMaterialCountAfter: afterMaterials.size,
      diffuseCountBefore: diffuseBefore.size,
      diffuseCountAfter: diffuseAfter.size,
      lightmapCountBefore: lightmapsBefore.size,
      lightmapCountAfter: lightmapsAfter.size,
      bounds: bounds ? { min: bounds.min.asArray(), max: bounds.max.asArray() } : null,
      visNeighbors: vis.visibleRoomsByRoom[entry.id] ?? [],
    };
    return row;
  });
}

function validateVis(entries: RoomEntry[], metadata: any): VisValidation {
  const rawRooms = metadata?.visibility?.rooms ?? {};
  const allRootIds = new Set(entries.map((entry) => entry.id));
  const renderableIds = new Set(entries.filter((entry) => entry.meshes.some(isRenderable)).map((entry) => entry.id));
  const normalized: Record<string, string[]> = {};
  const unresolvedSources: string[] = [];
  const unresolvedReferences: string[] = [];
  const aliasesApplied: Array<{ source: string; target: string }> = [];
  const externalCounts = new Map<string, number>();
  let edges = 0;
  let normalizedEdges = 0;

  for (const [source, rawTargets] of Object.entries(rawRooms) as Array<[string, string[]]>) {
    if (!allRootIds.has(source)) unresolvedSources.push(source);
    const output = new Set<string>();
    for (const rawTarget of rawTargets) {
      edges++;
      const target = VIS_ALIASES[rawTarget] ?? rawTarget;
      if (target !== rawTarget) aliasesApplied.push({ source: rawTarget, target });
      if (allRootIds.has(target)) {
        if (renderableIds.has(target)) output.add(target);
        normalizedEdges++;
      } else if (INTENTIONALLY_NON_RENDERED_VIS_TARGETS.has(rawTarget)) {
        externalCounts.set(rawTarget, (externalCounts.get(rawTarget) ?? 0) + 1);
        normalizedEdges++;
      } else {
        unresolvedReferences.push(source + ' -> ' + rawTarget);
      }
    }
    normalized[source] = [...output].sort();
  }

  return {
    sourceRoomCount: Object.keys(rawRooms).length,
    roomRootCount: allRootIds.size,
    renderableRoomCount: renderableIds.size,
    edges,
    normalizedEdges,
    unresolvedSources: [...new Set(unresolvedSources)].sort(),
    unresolvedReferences: [...new Set(unresolvedReferences)].sort(),
    aliasesApplied: [...new Map(aliasesApplied.map((row) => [row.source + '=>' + row.target, row])).values()],
    nonRenderableTargetsIgnored: [...externalCounts].map(([target, occurrences]) => ({
      target,
      occurrences,
      reason: 'Present in KOTOR1 source resource index but absent from this LYT/GLB room set; no renderable room can be enabled.',
    })),
    visibleRoomsByRoom: normalized,
    fallbackPolicy: 'If current room detection fails or VIS references cannot be resolved, enable all 52 renderable rooms; never show an empty world.',
  };
}

export function findCurrentRoom(position: Vector3, entries: RoomEntry[], walkmeshGeometry: any): string | null {
  const renderable = entries.filter((entry) => entry.meshes.some(isRenderable) && entry.bounds);
  const boundsContains = (entry: RoomEntry) => {
    const b = entry.bounds!;
    return position.x >= b.min.x - 1 && position.x <= b.max.x + 1 && position.z >= b.min.z - 1 && position.z <= b.max.z + 1;
  };
  let candidates = renderable.filter(boundsContains);
  const rows = walkmeshGeometry?.walkmeshes ?? [];
  const testWalkmesh = (entry: RoomEntry) => {
    const row = rows.find((item: any) => String(item.room ?? item.resref ?? '').replace(/^GLB_Room_/, '') === entry.id
      || String(item.resref ?? '').startsWith(entry.id));
    if (!row) return false;
    for (const face of row.faces ?? []) {
      const vertices = (face.v ?? []).map((index: number) => row.vertices?.[index]).filter(Boolean);
      if (vertices.length !== 3) continue;
      const pts = vertices.map((v: number[]) => [-Number(v[0]), -Number(v[1])] as [number, number]);
      if (pointInTriangleXZ(position.x, position.z, pts[0], pts[1], pts[2])) return true;
    }
    return false;
  };
  if (candidates.length) {
    const walkmeshMatches = candidates.filter(testWalkmesh);
    if (walkmeshMatches.length) candidates = walkmeshMatches;
    candidates.sort((a, b) => footprint(a) - footprint(b));
    return candidates[0].id;
  }
  const walkmeshMatches = renderable.filter(testWalkmesh);
  if (walkmeshMatches.length) {
    walkmeshMatches.sort((a, b) => footprint(a) - footprint(b));
    return walkmeshMatches[0].id;
  }
  return null;
}

function footprint(entry: RoomEntry): number {
  if (!entry.bounds) return Infinity;
  return (entry.bounds.max.x - entry.bounds.min.x) * (entry.bounds.max.z - entry.bounds.min.z);
}

function pointInTriangleXZ(x: number, z: number, a: [number, number], b: [number, number], c: [number, number]): boolean {
  const denominator = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
  if (Math.abs(denominator) < 1e-9) return false;
  const u = ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (z - c[1])) / denominator;
  const v = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (z - c[1])) / denominator;
  const w = 1 - u - v;
  return u >= -1e-4 && v >= -1e-4 && w >= -1e-4;
}

export function applyAnchorheadOptimization(
  sourceMeshes: AbstractMesh[],
  scene: Scene,
  metadata: any,
  mode: AnchorheadOptimizationMode,
  freezeWorldMatrices: boolean,
  freezeMaterials: boolean,
  validatedSamples: readonly any[] = [],
  roomResolver?: (position: Vector3) => string | null,
) {
  const sourceRenderable = sourceMeshes.filter(isRenderable);
  const entries = makeRoomEntries(scene, sourceMeshes);
  const vis = validateVis(entries, metadata);
  const before = roomMetrics(entries, vis, false, scene);
  const trianglesBefore = sourceRenderable.reduce((sum, mesh) => sum + mesh.getTotalIndices() / 3, 0);
  const lineage: MergeLineageRow[] = [];
  const shouldMerge = mode === 'merge' || mode === 'merge-vis';
  const shouldCull = mode === 'vis' || mode === 'merge-vis';
  const merge = shouldMerge
    ? mergeRoomMeshes(entries, sourceMeshes, scene, lineage)
    : { mergedSourceMeshes: 0, opaqueMerged: 0, maskMerged: 0, blendMerged: 0, groupCount: 0 };
  const optimizedMeshes = sourceMeshes.filter((mesh) => !mesh.isDisposed() && isRenderable(mesh)).concat(
    scene.meshes.filter((mesh) => Boolean(mesh.metadata?.__anchorheadOptimized) && !mesh.isDisposed() && isRenderable(mesh)),
  );
  const trianglesAfter = optimizedMeshes.reduce((sum, mesh) => sum + mesh.getTotalIndices() / 3, 0);
  if (Math.abs(trianglesBefore - trianglesAfter) > 0.001) throw new Error('Total triangle count changed: ' + trianglesBefore + ' -> ' + trianglesAfter);
  const after = roomMetrics(entries, vis, true, scene);
  const liveSceneRenderMeshes = scene.meshes.filter((mesh) => !mesh.isDisposed() && isRenderable(mesh));
  const sampleRows = validatedSamples.slice(0, 40);
  const sampleFailures: string[] = [];
  let samplePasses = 0;
  for (const sample of sampleRows) {
    const sourceStableId = String(sample.stableId ?? '');
    const matching = liveSceneRenderMeshes.find((mesh) => {
      const meshMetadata = mesh.metadata as any;
      if (meshMetadata?.__anchorheadOdysseyBinding?.sourceStableId === sourceStableId) return true;
      return (meshMetadata?.__anchorheadMergedSourceStableIds ?? []).includes(sourceStableId);
    });
    const expectedRoom = String(sample.room ?? '');
    const actualRoom = matching ? roomIdOf(matching) ?? (matching.metadata as any)?.__anchorheadRoom : null;
    const uv0Pass = !sample.uv0 || Boolean(matching?.getVerticesData('uv'));
    const uv1Pass = !sample.uv1 || Boolean(matching?.getVerticesData('uv2'));
    if (matching && actualRoom === expectedRoom && uv0Pass && uv1Pass) samplePasses++;
    else sampleFailures.push(sourceStableId + ' (room=' + String(actualRoom) + ', uv0=' + uv0Pass + ', uv1=' + uv1Pass + ')');
  }
  const materialSampleRegression = { sampleCount: sampleRows.length, passCount: samplePasses, failCount: sampleFailures.length, failures: sampleFailures };
  const roomsAfterMerge = entries.filter((entry) => entry.node.getChildMeshes(true).some(isRenderable));
  (window as any).__anchorheadOptimizationDebug = { sourceMeshes: sourceRenderable.length, mergedSourceMeshes: merge.mergedSourceMeshes, mergeGroups: merge.groupCount, roomsBefore: entries.filter((entry) => entry.meshes.some(isRenderable)).map((entry) => entry.id), roomsAfter: roomsAfterMerge.map((entry) => entry.id), trianglesBefore, trianglesAfter, roomChildMeshesAfter: entries.map((entry) => ({ room: entry.id, children: entry.node.getChildMeshes(true).filter(isRenderable).length })) };
  if (roomsAfterMerge.length !== 52) throw new Error('Expected 52 renderable rooms after merge, found ' + roomsAfterMerge.length);
  if (vis.unresolvedSources.length || vis.unresolvedReferences.length) {
    throw new Error('VIS metadata contains unresolved room references: ' + JSON.stringify({ sources: vis.unresolvedSources, targets: vis.unresolvedReferences }));
  }

  let frozenMeshes = 0;
  let frozenMaterialCount = 0;
  if (freezeWorldMatrices && shouldMerge) {
    for (const mesh of optimizedMeshes) {
      if (!mesh.metadata?.__anchorheadOptimized) continue;
      mesh.freezeWorldMatrix();
      frozenMeshes++;
    }
  }
  if (freezeMaterials && (shouldMerge || shouldCull)) {
    const materials = new Set(optimizedMeshes.map((mesh) => mesh.material).filter(Boolean) as any[]);
    for (const material of materials) {
      if (typeof material.freeze === 'function') {
        material.freeze();
        frozenMaterialCount++;
      }
    }
  }

  let currentRoom: string | null = null;
  let fallbackCount = 0;
  let inFallback = false;
  let lastUpdate = 0;
  let result!: AnchorheadOptimizationResult;
  const activeRenderable = entries.filter((entry) => entry.node.getChildMeshes(true).some(isRenderable));
  const updateVisibility = (position: Vector3, force = false) => {
    if (!shouldCull) return { currentRoom: null, enabledRooms: activeRenderable.length, fallback: false };
    const now = performance.now();
    if (!force && now - lastUpdate < 250) return { currentRoom, enabledRooms: activeRenderable.filter((entry) => entry.node.isEnabled()).length, fallback: inFallback };
    lastUpdate = now;
    const next = roomResolver ? roomResolver(position) : findCurrentRoom(position, entries, metadata?.walkmeshGeometry);
    if (!next) {
      if (!inFallback) fallbackCount++;
      result.fallbackCount = fallbackCount;
      inFallback = true;
      currentRoom = null;
      activeRenderable.forEach((entry) => entry.node.setEnabled(true));
      return { currentRoom, enabledRooms: activeRenderable.length, fallback: true };
    }
    inFallback = false;
    currentRoom = next;
    const enabled = new Set([next, ...(vis.visibleRoomsByRoom[next] ?? [])]);
    if (vis.unresolvedReferences.length) {
      activeRenderable.forEach((entry) => entry.node.setEnabled(true));
      return { currentRoom: next, enabledRooms: activeRenderable.length, fallback: true };
    }
    activeRenderable.forEach((entry) => entry.node.setEnabled(enabled.has(entry.id)));
    return { currentRoom: next, enabledRooms: enabled.size, fallback: false };
  };
  if (!shouldCull) activeRenderable.forEach((entry) => entry.node.setEnabled(true));

  const roomAfterByName = new Map(after.map((row) => [row.room, row.meshCountAfter]));
  result = {
    mode,
    sourceMeshCount: sourceRenderable.length,
    optimizedMeshCount: sourceRenderable.length - merge.mergedSourceMeshes + merge.groupCount,
    mergedSourceMeshes: merge.mergedSourceMeshes,
    mergeGroups: merge.groupCount,
    opaqueMerged: merge.opaqueMerged,
    maskMerged: merge.maskMerged,
    blendMerged: merge.blendMerged,
    totalTrianglesBefore: trianglesBefore,
    totalTrianglesAfter: trianglesAfter,
    roomCosts: before.map((row) => ({ ...row, meshCountAfter: roomAfterByName.get(row.room) ?? row.meshCountAfter,
      lightmappedMeshesAfter: after.find((next) => next.room === row.room)?.lightmappedMeshesAfter ?? row.lightmappedMeshesAfter,
      trianglesAfter: after.find((next) => next.room === row.room)?.trianglesAfter ?? row.trianglesAfter })),
    mergeLineage: lineage,
    vis,
    currentRoomDetection: roomResolver ? 'W228.5 BWM walkable XZ triangle + resolved height; semantic bounds fallback; enables all rooms when unresolved.' : 'Walkmesh XZ point-in-triangle with room-bounds broadphase; room-bounds footprint fallback; enables all rooms when unresolved.',
    freezeWorldMatrices: frozenMeshes,
    freezeMaterials: frozenMaterialCount,
    fallbackCount,
    materialSampleRegression,
  };
  return { result, updateVisibility, entries };
}


