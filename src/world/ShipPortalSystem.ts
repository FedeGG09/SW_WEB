import { Vector3 } from '@babylonjs/core';
import { InteractionSystem } from '../interaction/InteractionSystem';

export const SHIP_ENTRY_RANGE = 2.1;
export const SHIP_EXIT_RANGE = 2.4;

/** Scene-local portal registration. SceneManager owns quest/state decisions;
 * this class only keeps entry/exit prompts and transition callbacks coherent. */
export class ShipPortalSystem {
  constructor(private readonly interaction: InteractionSystem) {}

  registerExteriorEntry(position: Vector3, enter: () => void) {
    this.interaction.register({ id: 'shipEntry', label: 'Entrar a la nave', position, radius: SHIP_ENTRY_RANGE, action: enter });
  }

  registerInteriorExit(position: Vector3, exit: () => void, enabled: () => boolean = () => true) {
    this.interaction.register({
      id: 'shipExit',
      label: 'Salir de la nave',
      position,
      radius: SHIP_EXIT_RANGE,
      enabled,
      action: exit,
    });
  }
}
