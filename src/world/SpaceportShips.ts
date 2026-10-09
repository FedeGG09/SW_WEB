import { AbstractMesh, AnimationGroup, Vector3 } from '@babylonjs/core';
import { ImportedAsset } from '../assets/AssetLoader';

export const SPACEPORT_PARKED_SHIP_URL = '/assets/w210/spaceport/spaceship_-_cb1.glb';
export const SPACEPORT_CARGO_SHIP_URL = '/assets/w210/spaceport/spaceship_-_cargo.glb';

export const SPACEPORT_PARKED_SHIP = {
  center: new Vector3(35, 0, -5.5),
  scale: 0.20,
  rotationY: -Math.PI * 0.5,
  collisionSize: new Vector3(11.8, 3.0, 11.2),
} as const;

export const SPACEPORT_CARGO_SHIP = {
  // Independent sky landmark. No longer tied to the old service lift.
  // Positioned toward the center/north of the apron and substantially higher
  // so its silhouette reads clearly against the Nerathis storm.
  center: new Vector3(6.5, 0, 14.0),
  scale: 0.40,
  rotationY: -0.20,
  undersideY: 16.5,
} as const;

type WorldBounds = { min: Vector3; max: Vector3 };

function worldBounds(meshes: AbstractMesh[]): WorldBounds | undefined {
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

  for (const mesh of meshes) {
    mesh.computeWorldMatrix(true);

    const box = mesh.getBoundingInfo().boundingBox;
    const meshMin = box.minimumWorld;
    const meshMax = box.maximumWorld;

    if (!Number.isFinite(meshMin.x) || !Number.isFinite(meshMax.x)) continue;

    min = Vector3.Minimize(min, meshMin);
    max = Vector3.Maximize(max, meshMax);
    found = true;
  }

  return found ? { min, max } : undefined;
}

function centerAndPlace(
  asset: ImportedAsset,
  center: Vector3,
  scale: number,
  rotationY: number,
  bottomY: number,
) {
  asset.root.scaling.setAll(scale);
  asset.root.rotation.y = rotationY;
  asset.root.position.set(0, 0, 0);
  asset.root.computeWorldMatrix(true);

  let bounds = worldBounds(asset.meshes);

  if (!bounds) {
    asset.root.position.set(center.x, bottomY, center.z);
    return undefined;
  }

  const centerX = (bounds.min.x + bounds.max.x) * 0.5;
  const centerZ = (bounds.min.z + bounds.max.z) * 0.5;

  asset.root.position.x += center.x - centerX;
  asset.root.position.z += center.z - centerZ;
  asset.root.position.y += bottomY - bounds.min.y;

  asset.root.computeWorldMatrix(true);

  bounds = worldBounds(asset.meshes);

  return bounds;
}

function tagMeshes(
  asset: ImportedAsset,
  zone: string,
  family: string,
) {
  asset.meshes.forEach((mesh) => {
    mesh.isPickable = false;

    mesh.metadata = {
      ...(mesh.metadata ?? {}),
      zone,
      materialFamily: family,
    };
  });
}

function holdAtStart(group: AnimationGroup) {
  group.stop(true);
  group.start(false, 1, group.from, group.to, false);
  group.pause();
  group.goToFrame(group.from);
}

export function placeSpaceportParkedShip(
  asset: ImportedAsset,
  deckY = 0.13,
) {
  const bounds = centerAndPlace(
    asset,
    SPACEPORT_PARKED_SHIP.center,
    SPACEPORT_PARKED_SHIP.scale,
    SPACEPORT_PARKED_SHIP.rotationY,
    deckY,
  );

  tagMeshes(
    asset,
    'SPACEPORT_PARKED_CB1',
    'DONOR_CB1_SHIP',
  );

  asset.animationGroups.forEach(holdAtStart);

  console.info('[SPACEPORT] parked CB1 placed', {
    position: asset.root.position.asArray(),
    scale: SPACEPORT_PARKED_SHIP.scale,
    min: bounds?.min.asArray(),
    max: bounds?.max.asArray(),
  });

  return bounds;
}

export function placeSpaceportCargoShip(
  asset: ImportedAsset,
) {
  const bounds = centerAndPlace(
    asset,
    SPACEPORT_CARGO_SHIP.center,
    SPACEPORT_CARGO_SHIP.scale,
    SPACEPORT_CARGO_SHIP.rotationY,
    SPACEPORT_CARGO_SHIP.undersideY,
  );

  tagMeshes(
    asset,
    'SPACEPORT_CARGO_SHIP',
    'DONOR_CARGO_SHIP',
  );

  // The cargo ship is now independent from the removed lift.
  // Preserve a very slow authored mechanical cycle so it feels alive
  // without looking like an arcade animation.
  const group = asset.animationGroups[0];

  if (group) {
    group.stop(true);
    group.start(
      true,
      0.012,
      group.from,
      group.to,
      false,
    );
  }

  console.info('[SPACEPORT] sky cargo ship placed', {
    position: asset.root.position.asArray(),
    scale: SPACEPORT_CARGO_SHIP.scale,
    undersideY: SPACEPORT_CARGO_SHIP.undersideY,
    animation: group?.name ?? 'none',
    min: bounds?.min.asArray(),
    max: bounds?.max.asArray(),
  });

  return bounds;
}