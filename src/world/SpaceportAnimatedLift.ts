import { AbstractMesh, AnimationGroup, Vector3 } from '@babylonjs/core';
import { ImportedAsset } from '../assets/AssetLoader';

export const SPACEPORT_LIFT_URL = '/assets/w210/spaceport/rigged_sci-fi_lift_-_mobile_platform_-_elevator.glb';

export const SPACEPORT_LIFT = {
  center: new Vector3(18.5, 0, 11.5),
  // V3: 0.28 made the platform read too small next to the Ithorian. 0.44
  // restores it as a substantial cargo lift while keeping it below the V1
  // near-building scale.
  scale: 0.44,
  rotationY: 0,
  // Gameplay collision protects the pedestal/base. The animated arm is not a
  // moving gameplay obstacle yet; that can be authored separately if the lift
  // becomes interactable later.
  collisionSize: new Vector3(9.6, 4.6, 6.8),
  schedule: {
    movementSeconds: 80,
    initialBottomHoldSeconds: [120, 240] as const,
    bottomHoldSeconds: [240, 420] as const,
    topHoldSeconds: [180, 300] as const,
  },
} as const;

function worldBounds(meshes: AbstractMesh[]) {
  let min = new Vector3(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
  let max = new Vector3(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY);
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

function randomBetween([min, max]: readonly [number, number]) {
  return min + Math.random() * (max - min);
}

function segmentSpeed(group: AnimationGroup, from: number, to: number, desiredSeconds: number) {
  const sourceSeconds = Math.max(0.01, group.getLength(from, to));
  return Math.max(0.02, sourceSeconds / Math.max(0.1, desiredSeconds));
}

/**
 * The supplied `Demo` clip is a complete 10-second up/down cycle. Looping it
 * continuously made the spaceport machinery feel toy-like. V2 treats the
 * first half as ASCEND and the second half as DESCEND, then inserts long idle
 * periods at both endpoints.
 *
 * Runtime cadence (normal gameplay):
 *   bottom 4-7 min -> rise ~80 s -> top 3-5 min -> descend ~80 s -> repeat
 *
 * For visual testing only, `?liftDemo=1` compresses the waits to seconds.
 */
function startIndustrialDutyCycle(asset: ImportedAsset, demo: AnimationGroup) {
  const from = demo.from;
  const to = demo.to;
  const topFrame = from + (to - from) * 0.5;
  const quickDemo = new URLSearchParams(window.location.search).get('liftDemo') === '1';

  const movementSeconds = quickDemo ? 8 : SPACEPORT_LIFT.schedule.movementSeconds;
  const initialHoldRange: readonly [number, number] = quickDemo ? [2, 3] : SPACEPORT_LIFT.schedule.initialBottomHoldSeconds;
  const bottomHoldRange: readonly [number, number] = quickDemo ? [8, 12] : SPACEPORT_LIFT.schedule.bottomHoldSeconds;
  const topHoldRange: readonly [number, number] = quickDemo ? [10, 15] : SPACEPORT_LIFT.schedule.topHoldSeconds;

  let disposed = false;
  let timer: number | undefined;

  const clearTimer = () => {
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timer = undefined;
    }
  };

  asset.root.onDisposeObservable.addOnce(() => {
    disposed = true;
    clearTimer();
  });

  const schedule = (range: readonly [number, number], callback: () => void) => {
    if (disposed) return;
    clearTimer();
    const seconds = randomBetween(range);
    timer = window.setTimeout(() => {
      timer = undefined;
      if (!disposed) callback();
    }, seconds * 1000);
  };

  const playSegment = (segmentFrom: number, segmentTo: number, onComplete: () => void) => {
    if (disposed) return;
    demo.stop(true);
    const speed = segmentSpeed(demo, segmentFrom, segmentTo, movementSeconds);
    demo.onAnimationGroupEndObservable.addOnce(() => {
      if (!disposed) onComplete();
    });
    demo.start(false, speed, segmentFrom, segmentTo, false);
  };

  const announce = (state: 'BOTTOM_HOLD' | 'ASCENDING' | 'TOP_HOLD' | 'DESCENDING') => {
    window.dispatchEvent(new CustomEvent('nerathis:spaceport-lift-state', { detail: { state } }));
  };

  const descend = () => {
    announce('DESCENDING');
    console.info('[SPACEPORT] lift DESCEND');
    playSegment(topFrame, to, () => {
      announce('BOTTOM_HOLD');
      console.info('[SPACEPORT] lift BOTTOM HOLD');
      schedule(bottomHoldRange, ascend);
    });
  };

  const ascend = () => {
    announce('ASCENDING');
    console.info('[SPACEPORT] lift ASCEND');
    playSegment(from, topFrame, () => {
      announce('TOP_HOLD');
      console.info('[SPACEPORT] lift TOP HOLD');
      schedule(topHoldRange, descend);
    });
  };

  // Force the authored lower endpoint before beginning the long ambient wait.
  demo.stop(true);
  demo.start(false, 1, from, to, false);
  demo.pause();
  demo.goToFrame(from);

  announce('BOTTOM_HOLD');

  console.info('[SPACEPORT] lift duty cycle armed', {
    quickDemo,
    movementSeconds,
    initialBottomHoldSeconds: initialHoldRange,
    bottomHoldSeconds: bottomHoldRange,
    topHoldSeconds: topHoldRange,
    frameRange: [from, topFrame, to],
  });

  schedule(initialHoldRange, ascend);
}

/**
 * Places the Sketchfab lift by its measured world bounds instead of trusting
 * its donor origin. This keeps the imported rig centered on the authored
 * service bay and grounded on the Khepra landing deck.
 */
export function placeSpaceportAnimatedLift(asset: ImportedAsset, deckY = 0.13) {
  asset.root.scaling.setAll(SPACEPORT_LIFT.scale);
  asset.root.rotation.y = SPACEPORT_LIFT.rotationY;
  asset.root.position.set(0, 0, 0);
  asset.root.computeWorldMatrix(true);

  let bounds = worldBounds(asset.meshes);
  if (bounds) {
    const centerX = (bounds.min.x + bounds.max.x) * 0.5;
    const centerZ = (bounds.min.z + bounds.max.z) * 0.5;
    asset.root.position.x += SPACEPORT_LIFT.center.x - centerX;
    asset.root.position.z += SPACEPORT_LIFT.center.z - centerZ;
    asset.root.position.y += deckY - bounds.min.y;
    asset.root.computeWorldMatrix(true);
    bounds = worldBounds(asset.meshes);
  } else {
    asset.root.position.copyFrom(SPACEPORT_LIFT.center);
  }

  asset.meshes.forEach((mesh) => {
    mesh.isPickable = false;
    mesh.metadata = {
      ...(mesh.metadata ?? {}),
      zone: 'SPACEPORT_LIFT',
      materialFamily: 'DONOR_SCI_FI_LIFT',
    };
  });

  const demo = asset.animationGroups.find((group) => group.name.toLowerCase() === 'demo') ?? asset.animationGroups[0];
  if (demo) startIndustrialDutyCycle(asset, demo);

  const finalBounds = bounds ?? worldBounds(asset.meshes);
  console.info('[SPACEPORT] animated lift placed', {
    position: asset.root.position.asArray(),
    scale: SPACEPORT_LIFT.scale,
    animation: demo?.name ?? 'none',
    min: finalBounds?.min.asArray(),
    max: finalBounds?.max.asArray(),
  });

  return finalBounds;
}
