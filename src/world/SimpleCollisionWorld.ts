import { AbstractMesh, Color3, MeshBuilder, Scene, StandardMaterial, Vector3 } from '@babylonjs/core';

export type CollisionCategory = 'floor' | 'wall' | 'obstacle' | 'camera' | 'trigger';

export interface CollisionBoxOptions {
  category?: CollisionCategory;
  blocksPlayer?: boolean;
  cameraBlocker?: boolean;
}

interface Collider {
  mesh: AbstractMesh;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  blocksPlayer: boolean;
  cameraBlocker: boolean;
  category: CollisionCategory;
}

export class SimpleCollisionWorld {
  private readonly colliders: Collider[] = [];
  private readonly ground: AbstractMesh;

  constructor(private readonly scene: Scene, private readonly groundY = 0) {
    this.ground = MeshBuilder.CreateGround('simple_walkable_ground', { width: 260, height: 260 }, scene);
    this.ground.position.y = groundY;
    this.ground.isVisible = false;
    this.ground.isPickable = false;
  }

  addBox(name: string, center: Vector3, size: Vector3, cameraBlocker = false, options: CollisionBoxOptions = {}) {
    const resolvedCameraBlocker = options.cameraBlocker ?? cameraBlocker;
    const blocksPlayer = options.blocksPlayer ?? true;
    const category = options.category ?? 'wall';
    const mesh = MeshBuilder.CreateBox(name, { width: size.x, height: size.y, depth: size.z }, this.scene);
    mesh.position.copyFrom(center);
    mesh.metadata = { collisionCategory: category, cameraBlocker: resolvedCameraBlocker, debugCollision: true };
    const debugMaterial = new StandardMaterial(`${name}_debug_material`, this.scene);
    debugMaterial.diffuseColor = new Color3(0.9, 0.16, 0.12);
    debugMaterial.emissiveColor = new Color3(0.16, 0.02, 0.01);
    debugMaterial.alpha = 0.55;
    debugMaterial.wireframe = true;
    debugMaterial.disableLighting = true;
    mesh.material = debugMaterial;
    mesh.isVisible = resolvedCameraBlocker;
    mesh.visibility = 0;
    mesh.isPickable = resolvedCameraBlocker;
    this.colliders.push({ mesh, minX: center.x - size.x / 2, maxX: center.x + size.x / 2, minZ: center.z - size.z / 2, maxZ: center.z + size.z / 2, blocksPlayer, cameraBlocker: resolvedCameraBlocker, category });
  }

  resolve(position: Vector3, radius = 0.34) {
    position.y = this.groundY;
    for (const collider of this.colliders) {
      if (!collider.blocksPlayer) continue;
      const insideX = position.x > collider.minX - radius && position.x < collider.maxX + radius;
      const insideZ = position.z > collider.minZ - radius && position.z < collider.maxZ + radius;
      if (!insideX || !insideZ) continue;
      const pushLeft = Math.abs(position.x - (collider.minX - radius));
      const pushRight = Math.abs((collider.maxX + radius) - position.x);
      const pushBack = Math.abs(position.z - (collider.minZ - radius));
      const pushForward = Math.abs((collider.maxZ + radius) - position.z);
      const smallest = Math.min(pushLeft, pushRight, pushBack, pushForward);
      if (smallest === pushLeft) position.x = collider.minX - radius;
      else if (smallest === pushRight) position.x = collider.maxX + radius;
      else if (smallest === pushBack) position.z = collider.minZ - radius;
      else position.z = collider.maxZ + radius;
    }
  }

  setDebugVisible(visible: boolean) {
    for (const collider of this.colliders) {
      collider.mesh.visibility = visible ? 0.16 : 0;
      collider.mesh.isVisible = visible || collider.cameraBlocker;
      collider.mesh.isPickable = collider.cameraBlocker;
      const material = collider.mesh.material as { wireframe?: boolean; diffuseColor?: { set: (r: number, g: number, b: number) => void }; emissiveColor?: { set: (r: number, g: number, b: number) => void } } | null;
      if (!material) continue;
      material.wireframe = true;
      const color = collider.category === 'floor'
        ? [0.15, 0.9, 0.25]
        : collider.category === 'camera'
          ? [1, 0.78, 0.12]
          : collider.category === 'trigger'
            ? [0.15, 0.9, 1]
            : [0.95, 0.16, 0.12];
      material.diffuseColor?.set(color[0], color[1], color[2]);
      material.emissiveColor?.set(color[0] * 0.2, color[1] * 0.2, color[2] * 0.2);
    }
  }

  get colliderCount() { return this.colliders.length; }
  get cameraBlockerCount() { return this.colliders.filter((collider) => collider.cameraBlocker).length; }
  get colliderNames() { return this.colliders.map((collider) => collider.mesh.name); }

  dispose() {
    this.ground.dispose();
    this.colliders.forEach((collider) => {
      collider.mesh.material?.dispose();
      collider.mesh.dispose();
    });
    this.colliders.length = 0;
  }
}
