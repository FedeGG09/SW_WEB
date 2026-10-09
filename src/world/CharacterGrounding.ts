import { AbstractMesh, TransformNode, Vector3 } from '@babylonjs/core';

export type VisualBounds = {
  minY: number;
  maxY: number;
  height: number;
  feetY: number;
};

export type FootSoleSideMeasurement = {
  footBones: string[];
  vertexCount: number;
  lowestY: number | null;
};

export type FootSoleMeasurement = {
  method: string;
  influenceThreshold: number;
  left: FootSoleSideMeasurement;
  right: FootSoleSideMeasurement;
  lowestY: number | null;
};

export function measureVisualBounds(meshes: AbstractMesh[]): VisualBounds {
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  meshes.forEach((mesh) => {
    if (!mesh.isEnabled()) return;
    mesh.computeWorldMatrix(true);
    const box = mesh.getBoundingInfo().boundingBox;
    minY = Math.min(minY, box.minimumWorld.y);
    maxY = Math.max(maxY, box.maximumWorld.y);
  });
  if (!Number.isFinite(minY) || !Number.isFinite(maxY)) return { minY: 0, maxY: 0, height: 0, feetY: 0 };
  return { minY, maxY, height: Math.max(0, maxY - minY), feetY: minY };
}

/**
 * Measure posed boot/foot vertices rather than the whole character silhouette.
 * Vertices are selected from skin weights that address the actor-local talus,
 * foot, ankle, or toe bones; robe/cloak vertices with no such influence are
 * deliberately excluded. The returned Y values are world-space.
 */
export function measureSkinnedFootSoles(meshes: AbstractMesh[], influenceThreshold = 0.2): FootSoleMeasurement {
  const sides = {
    left: { ids: new Set<number>(), names: new Set<string>(), vertexCount: 0, lowestY: Number.POSITIVE_INFINITY },
    right: { ids: new Set<number>(), names: new Set<string>(), vertexCount: 0, lowestY: Number.POSITIVE_INFINITY },
  };
  const readFootBones = (skeleton: any) => {
    for (let i = 0; i < (skeleton?.bones?.length ?? 0); i++) {
      const bone = skeleton.bones[i];
      const name = String(bone.name ?? "");
      const normalized = name.toLowerCase().replace(/[^a-z0-9]/g, "");
      const index = Number(bone.getIndex?.() ?? i);
      if (/^(?:l|left)(?:talus|foot|ankle|toe)/.test(normalized)) {
        sides.left.ids.add(index); sides.left.names.add(name);
      }
      if (/^(?:r|right)(?:talus|foot|ankle|toe)/.test(normalized)) {
        sides.right.ids.add(index); sides.right.names.add(name);
      }
    }
  };
  for (const mesh of meshes) if (mesh.isEnabled() && mesh.skeleton) readFootBones(mesh.skeleton);

  for (const mesh of meshes) {
    if (!mesh.isEnabled() || !mesh.skeleton) continue;
    const matricesIndices = mesh.getVerticesData("matricesIndices");
    const matricesWeights = mesh.getVerticesData("matricesWeights");
    const extraIndices = mesh.getVerticesData("matricesIndicesExtra");
    const extraWeights = mesh.getVerticesData("matricesWeightsExtra");
    const positions = (mesh as any).getPositionData?.(true, false) ?? mesh.getVerticesData("position");
    if (!matricesIndices || !matricesWeights || !positions) continue;
    mesh.computeWorldMatrix(true);
    const world = mesh.getWorldMatrix();
    const vertexCount = Math.min(Math.floor(positions.length / 3), Math.floor(matricesIndices.length / 4), Math.floor(matricesWeights.length / 4));
    for (let vertex = 0; vertex < vertexCount; vertex++) {
      let leftInfluence = 0, rightInfluence = 0;
      for (let influence = 0; influence < 4; influence++) {
        const boneIndex = Math.round(matricesIndices[vertex * 4 + influence]);
        const weight = Number(matricesWeights[vertex * 4 + influence] ?? 0);
        if (sides.left.ids.has(boneIndex)) leftInfluence += weight;
        if (sides.right.ids.has(boneIndex)) rightInfluence += weight;
        if (extraIndices && extraWeights) {
          const extraBoneIndex = Math.round(extraIndices[vertex * 4 + influence]);
          const extraWeight = Number(extraWeights[vertex * 4 + influence] ?? 0);
          if (sides.left.ids.has(extraBoneIndex)) leftInfluence += extraWeight;
          if (sides.right.ids.has(extraBoneIndex)) rightInfluence += extraWeight;
        }
      }
      if (leftInfluence < influenceThreshold && rightInfluence < influenceThreshold) continue;
      const position = Vector3.TransformCoordinates(new Vector3(positions[vertex * 3], positions[vertex * 3 + 1], positions[vertex * 3 + 2]), world);
      if (leftInfluence >= influenceThreshold) {
        sides.left.vertexCount++;
        sides.left.lowestY = Math.min(sides.left.lowestY, position.y);
      }
      if (rightInfluence >= influenceThreshold) {
        sides.right.vertexCount++;
        sides.right.lowestY = Math.min(sides.right.lowestY, position.y);
      }
    }
  }
  const finish = (side: typeof sides.left): FootSoleSideMeasurement => ({
    footBones: [...side.names], vertexCount: side.vertexCount,
    lowestY: Number.isFinite(side.lowestY) ? side.lowestY : null,
  });
  const left = finish(sides.left), right = finish(sides.right);
  const candidates = [left.lowestY, right.lowestY].filter((value): value is number => value != null);
  return {
    method: "POSED_SKINNED_VERTICES_WITH_ACTOR_LOCAL_FOOT_JOINT_INFLUENCE",
    influenceThreshold,
    left,
    right,
    lowestY: candidates.length ? Math.min(...candidates) : null,
  };
}

export function alignVisualFeetToGround(visualRoot: TransformNode, meshes: AbstractMesh[], groundY = 0.02) {
  const before = measureVisualBounds(meshes);
  if (before.height > 0) visualRoot.position.y += groundY - before.feetY;
  const after = measureVisualBounds(meshes);
  return { before, after, offset: visualRoot.position.y };
}
