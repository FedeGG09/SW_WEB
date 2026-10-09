import { AbstractMesh, AnimationGroup, Light, Scene, SceneLoader, TransformNode } from '@babylonjs/core';
import '@babylonjs/loaders/glTF';

export interface ImportedAsset {
  root: TransformNode;
  meshes: AbstractMesh[];
  animationGroups: AnimationGroup[];
  resetAnimatedRoots: (owner?: string) => void;
  setAnimatedRootsResetEnabled: (enabled: boolean) => void;
  requestAnimatedRootResetSnapshot: (label: string) => void;
  animatedRootResetDiagnostics: () => {
    enabled: boolean;
    callCount: number;
    skippedCallCount: number;
    nodeNames: string[];
    observerCount: number;
    observerOwners: string[];
    latestSnapshot: Record<string, unknown> | null;
  };
  registerAnimatedRootResetObserver: (scene: Scene, owner: string) => () => void;
  dispose: () => void;
}

function splitUrl(url: string) {
  const slash = url.lastIndexOf('/');
  return { rootUrl: slash >= 0 ? url.slice(0, slash + 1) : '/', fileName: url.slice(slash + 1) };
}

export class AssetLoader {
  async load(url: string, scene: Scene, onProgress?: (value: number) => void): Promise<ImportedAsset> {
    const { rootUrl, fileName } = splitUrl(url);
    const result = await SceneLoader.ImportMeshAsync(null, rootUrl, fileName, scene, (event) => {
      if (event.lengthComputable && onProgress) onProgress(event.loaded / event.total);
    });
    // Donor GLBs may carry authoring lights. Keep W0/W1 lighting deterministic
    // and below the WebGL uniform-buffer limit by disabling and owning them here.
    const importedLights: Light[] = (result as typeof result & { lights?: Light[] }).lights ?? [];
    importedLights.forEach((light) => light.setEnabled(false));
    const root = new TransformNode(`${fileName.replace(/[^a-z0-9]/gi, '_')}_root`, scene);
    const allNodes = [...result.transformNodes, ...result.meshes];
    const topLevelNodes = allNodes.filter((node) => !node.parent || !allNodes.some((candidate) => candidate === node.parent)) as Array<AbstractMesh | TransformNode>;
    topLevelNodes.forEach((node) => { node.parent = root; });
    const basePositions = new Map<AbstractMesh | TransformNode, { x: number; y: number; z: number }>();
    topLevelNodes.forEach((node) => basePositions.set(node, { x: node.position.x, y: node.position.y, z: node.position.z }));
    const resetNodes = [...basePositions.keys()];
    let animatedRootsResetEnabled = true;
    let animatedRootsResetDiagnosticsEnabled = false;
    let animatedRootsResetCallCount = 0;
    let animatedRootsResetSkippedCallCount = 0;
    let nextResetSnapshotLabel: string | null = null;
    let latestResetSnapshot: Record<string, unknown> | null = null;
    let nextObserverId = 0;
    const resetObservers = new Map<number, { owner: string; observer: ReturnType<Scene['onAfterAnimationsObservable']['add']> }>();
    const auditedBoneNames = [
      'model_root', 'pelvis', 'lower_lumbar', 'upper_lumbar', 'thoracic', 'cervical', 'cranium',
      'lhumerus', 'rhumerus', 'lhand', 'rhand',
    ];
    let auditedNodes: Map<string, TransformNode> | null = null;
    const getAuditedNodes = () => {
      if (auditedNodes) return auditedNodes;
      auditedNodes = new Map<string, TransformNode>();
      for (const node of [...result.transformNodes, ...result.meshes]) {
        const key = node.name.toLowerCase();
        if (auditedBoneNames.includes(key)) auditedNodes.set(key, node as TransformNode);
      }
      for (const skeleton of [...new Set(result.meshes.map(mesh => mesh.skeleton).filter(Boolean))]) {
        for (const bone of skeleton!.bones) {
          const transform = bone.getTransformNode?.();
          const key = bone.name.toLowerCase();
          if (transform && auditedBoneNames.includes(key)) auditedNodes.set(key, transform);
        }
      }
      return auditedNodes;
    };
    const snapshot = () => Object.fromEntries(auditedBoneNames.map(name => {
      const node = getAuditedNodes().get(name);
      if (!node) return [name, null];
      return [name, {
        nodeName: node.name,
        uniqueId: node.uniqueId,
        position: node.position.asArray(),
        rotationQuaternion: node.rotationQuaternion?.asArray() ?? null,
        rotation: node.rotation.asArray(),
        scaling: node.scaling.asArray(),
        parentName: node.parent?.name ?? null,
        parentUniqueId: node.parent?.uniqueId ?? null,
      }];
    }));
    const resetAnimatedRoots = (owner = 'DIRECT') => {
      const label = nextResetSnapshotLabel;
      const before = label && animatedRootsResetDiagnosticsEnabled ? snapshot() : null;
      if (animatedRootsResetEnabled) {
        if (animatedRootsResetDiagnosticsEnabled) animatedRootsResetCallCount++;
        basePositions.forEach((position, node) => node.position.set(position.x, position.y, position.z));
      } else {
        if (animatedRootsResetDiagnosticsEnabled) animatedRootsResetSkippedCallCount++;
      }
      if (label && animatedRootsResetDiagnosticsEnabled) {
        const after = snapshot();
        latestResetSnapshot = { label, owner, enabled: animatedRootsResetEnabled, nodeNames: auditedBoneNames,
          before, after, changed: JSON.stringify(before) !== JSON.stringify(after) };
        nextResetSnapshotLabel = null;
      }
    };
    const registerAnimatedRootResetObserver = (targetScene: Scene, owner: string) => {
      const id = ++nextObserverId;
      const observer = targetScene.onAfterAnimationsObservable.add(() => resetAnimatedRoots(owner));
      resetObservers.set(id, { owner, observer });
      let disposed = false;
      return () => {
        if (disposed) return;
        disposed = true;
        targetScene.onAfterAnimationsObservable.remove(observer);
        resetObservers.delete(id);
      };
    };
    const dispose = () => {
      animationGroupsDispose(result.animationGroups);
      importedLights.forEach((light) => light.dispose());
      root.dispose(false, true);
    };
    return {
      root,
      meshes: result.meshes,
      animationGroups: result.animationGroups,
      resetAnimatedRoots,
      setAnimatedRootsResetEnabled: (enabled: boolean) => { animatedRootsResetDiagnosticsEnabled = true; animatedRootsResetEnabled = enabled; },
      requestAnimatedRootResetSnapshot: (label: string) => { animatedRootsResetDiagnosticsEnabled = true; nextResetSnapshotLabel = label; },
      animatedRootResetDiagnostics: () => ({
        enabled: animatedRootsResetEnabled,
        callCount: animatedRootsResetCallCount,
        skippedCallCount: animatedRootsResetSkippedCallCount,
        nodeNames: resetNodes.map(node => node.name),
        observerCount: resetObservers.size,
        observerOwners: [...resetObservers.values()].map(row => row.owner),
        latestSnapshot: latestResetSnapshot,
      }),
      registerAnimatedRootResetObserver,
      dispose,
    };
  }
}

function animationGroupsDispose(groups: AnimationGroup[]) {
  groups.forEach((group) => { group.stop(); group.dispose(); });
}
