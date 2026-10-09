import { Ray, Scene, Vector3 } from '@babylonjs/core';
import { PlayerController } from '../player/PlayerController';
import { ThirdPersonCamera } from '../player/ThirdPersonCamera';

export interface InteractionTarget {
  id: string;
  label: string;
  position: Vector3 | (() => Vector3);
  radius?: number;
  enabled?: () => boolean;
  /** Companion interactions survive scene-local target cleanup. */
  persistent?: boolean;
  action: () => void;
}

export class InteractionSystem {
  private readonly targets: InteractionTarget[] = [];
  private current?: InteractionTarget;
  private readonly prompt: HTMLElement;

  constructor(private readonly scene: Scene, private readonly player: PlayerController, private readonly camera: ThirdPersonCamera) {
    this.prompt = document.getElementById('interactionPrompt')!;
    window.addEventListener('keydown', this.onKeyDown);
  }

  clear() {
    for (let index = this.targets.length - 1; index >= 0; index--) {
      if (!this.targets[index].persistent) this.targets.splice(index, 1);
    }
    this.current = undefined;
    this.prompt.classList.add('is-hidden');
  }

  register(target: InteractionTarget) { this.targets.push(target); }

  update() {
    if (document.getElementById('dialogueOverlay')?.classList.contains('is-hidden') === false) {
      this.current = undefined;
      this.prompt.classList.add('is-hidden');
      return;
    }
    let closest: InteractionTarget | undefined;
    let closestDistance = Number.POSITIVE_INFINITY;
    for (const target of this.targets) {
      if (target.enabled && !target.enabled()) continue;
      const position = typeof target.position === 'function' ? target.position() : target.position;
      const distance = Vector3.Distance(this.player.position, position);
      if (distance > (target.radius ?? 2.35) || distance >= closestDistance || !this.hasLineOfSight(target, position)) continue;
      closest = target;
      closestDistance = distance;
    }
    this.current = closest;
    if (closest) {
      this.prompt.textContent = `[E] ${closest.label}`;
      this.prompt.classList.remove('is-hidden');
    } else this.prompt.classList.add('is-hidden');
  }

  private hasLineOfSight(interaction: InteractionTarget, target: Vector3) {
    if (interaction.id === 'nara' || interaction.id === 'shipEntry' || interaction.id === 'shipExit') return true;
    const origin = this.player.position.add(new Vector3(0, 1.15, 0));
    const direction = target.add(new Vector3(0, 0.9, 0)).subtract(origin);
    const distance = direction.length();
    const hit = this.scene.pickWithRay(new Ray(origin, direction.normalize(), distance), (mesh) => mesh.isPickable && mesh.isVisible && !mesh.name.includes('GameplayBody'));
    return !hit?.hit || !hit.pickedMesh || hit.distance > distance - 0.1;
  }

  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (event.key.toLowerCase() !== 'e' || event.repeat || !this.current) return;
    event.preventDefault();
    const action = this.current.action;
    this.current = undefined;
    action();
  };

  get currentTargetId() { return this.current?.id ?? 'none'; }
  get currentTargetLabel() { return this.current?.label ?? 'none'; }
}
