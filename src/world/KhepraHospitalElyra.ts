import {
  AnimationGroup,
  Vector3,
} from '@babylonjs/core';

import { ImportedAsset } from '../assets/AssetLoader';


export const ELYRA_HOSPITAL_ASSET_URL =
  '/assets/characters/lieutenant/lieutenant_blaster_v1.glb';


export const ELYRA_HOSPITAL_PLACEMENT = {
  // Entrada de Clínica 2, apenas hacia adentro
  // para no bloquear el pasillo central.
  position: new Vector3(
    3.0,
    0.46,
    -54.2,
  ),

  // Mirando hacia la aproximación Spaceport -> Hospital.
  rotationY: Math.PI,

  targetHeight: 1.72,
} as const;


type Bounds = {
  min: Vector3;
  max: Vector3;
  height: number;
};


function worldBounds(
  asset: ImportedAsset,
): Bounds | undefined {

  let min = new Vector3(
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
  );

  let max = new Vector3(
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  );

  let found = false;


  for (const mesh of asset.meshes) {

    mesh.computeWorldMatrix(true);

    const box =
      mesh.getBoundingInfo().boundingBox;

    const meshMin =
      box.minimumWorld;

    const meshMax =
      box.maximumWorld;


    if (
      !Number.isFinite(meshMin.x) ||
      !Number.isFinite(meshMax.x)
    ) {
      continue;
    }


    min =
      Vector3.Minimize(
        min,
        meshMin,
      );

    max =
      Vector3.Maximize(
        max,
        meshMax,
      );

    found = true;
  }


  if (!found) {
    return undefined;
  }


  return {
    min,
    max,
    height:
      max.y - min.y,
  };
}


function findAnimation(
  asset: ImportedAsset,
  name: string,
): AnimationGroup | undefined {

  const expected =
    name.toLowerCase();


  return asset.animationGroups.find(
    (group) =>
      group.name.toLowerCase() ===
      expected,
  );
}


function stopAllAnimations(
  asset: ImportedAsset,
): void {

  for (
    const group
    of asset.animationGroups
  ) {
    group.stop();
  }
}


function startIdle(
  asset: ImportedAsset,
): AnimationGroup | undefined {

  stopAllAnimations(
    asset,
  );


  const idle =
    findAnimation(
      asset,
      'idle_v2',
    );


  if (!idle) {

    console.warn(
      '[ELYRA] idle_v2 not found',
      asset.animationGroups.map(
        (group) => group.name,
      ),
    );

    return undefined;
  }


  idle.start(
    true,
    1.0,
    idle.from,
    idle.to,
    false,
  );


  return idle;
}


export function placeKhepraHospitalElyra(
  asset: ImportedAsset,
) {

  const placement =
    ELYRA_HOSPITAL_PLACEMENT;


  // ============================================================
  // RESET
  // ============================================================

  asset.resetAnimatedRoots();


  asset.root.position.set(
    0,
    0,
    0,
  );


  asset.root.rotation.set(
    0,
    placement.rotationY,
    0,
  );


  asset.root.scaling.setAll(
    1,
  );


  asset.root.computeWorldMatrix(
    true,
  );


  // ============================================================
  // VERIFY SCALE
  // ============================================================

  let bounds =
    worldBounds(
      asset,
    );


  if (
    bounds &&
    bounds.height > 0.001
  ) {

    const scale =
      placement.targetHeight /
      bounds.height;


    // Protección contra un GLB roto/helper enorme.
    const safeScale =
      Math.min(
        2.0,
        Math.max(
          0.5,
          scale,
        ),
      );


    asset.root.scaling.setAll(
      safeScale,
    );


    asset.root.computeWorldMatrix(
      true,
    );


    bounds =
      worldBounds(
        asset,
      );
  }


  // ============================================================
  // PLACE / GROUND
  // ============================================================

  if (bounds) {

    const centerX =
      (
        bounds.min.x +
        bounds.max.x
      ) * 0.5;


    const centerZ =
      (
        bounds.min.z +
        bounds.max.z
      ) * 0.5;


    asset.root.position.x +=
      placement.position.x -
      centerX;


    asset.root.position.z +=
      placement.position.z -
      centerZ;


    asset.root.position.y +=
      placement.position.y -
      bounds.min.y;

  } else {

    asset.root.position.copyFrom(
      placement.position,
    );
  }


  asset.root.computeWorldMatrix(
    true,
  );


  // ============================================================
  // NPC METADATA
  // ============================================================

  for (
    const mesh
    of asset.meshes
  ) {

    // En W213 todavía NO es interactuable.
    mesh.isPickable = false;


    mesh.metadata = {
      ...(mesh.metadata ?? {}),

      actor: 'ELYRA_DANE',

      npc: true,

      zone: 'CLINICA_2',

      storyRole:
        'LIEUTENANT',

      coverageExclude:
        true,
    };
  }


  // ============================================================
  // IDLE
  // ============================================================

  const idle =
    startIdle(
      asset,
    );


  const finalBounds =
    worldBounds(
      asset,
    );


  console.info(
    '[ELYRA] Clinica 2 NPC placed',
    {
      position:
        asset.root.position.asArray(),

      rotationY:
        asset.root.rotation.y,

      scale:
        asset.root.scaling.x,

      height:
        finalBounds?.height ?? 0,

      animation:
        idle?.name ?? 'NONE',

      animations:
        asset.animationGroups.map(
          (group) =>
            group.name,
        ),
    },
  );


  return {
    asset,
    idle,

    position:
      placement.position.clone(),
  };
}