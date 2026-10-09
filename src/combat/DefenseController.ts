import { Vector3 } from '@babylonjs/core';
import { GuardState } from './CombatActor';
import { LightsaberController } from '../player/LightsaberController';
import { PlayerController } from '../player/PlayerController';
import { WeaponAttachment } from '../player/WeaponAttachment';
import { combatTrace } from '../debug/CombatTrace';

export class DefenseController {
  private state: GuardState = 'NONE';
  private pressedAt = 0;
  private staggerRemaining = 0;
  private authoredDefenseAnimation = false;
  private parryVisualRemaining = 0;
  private readonly defenseOffset = new Vector3(-0.22, 0.34, -0.18);
  private readonly defensePose = new Vector3(-0.24, 0.22, -0.12);

  constructor(private readonly player: PlayerController, private readonly attachment: WeaponAttachment, private readonly lightsaber: LightsaberController, private readonly isAttackBusy: () => boolean) {
    window.addEventListener('pointerdown', (event) => {
      if (event.button !== 2) return;
      event.preventDefault();
      const clipFound = this.player.combatAnimations.hasExact('block_center');
      combatTrace.log('BLOCK INPUT', {
        pointerDown: true,
        pointerUp: false,
        saberState: this.lightsaber.currentState,
        defenseState: this.state,
        clipSelected: 'block_center',
        animationGroupFound: clipFound,
      });
      if (!this.lightsaber.isOn || this.isAttackBusy()) {
        combatTrace.log('BLOCK INPUT REJECTED', {
          reason: !this.lightsaber.isOn ? `saberState=${this.lightsaber.currentState}` : 'attackInProgress=true',
          combatPhase: this.player.isActionLocked ? 'PLAYER_ACTION_LOCKED' : 'COMBAT_BUSY',
        });
        return;
      }
      this.pressedAt = performance.now();
      this.state = 'PARRY_WINDOW';
      combatTrace.log('BLOCK INPUT ACCEPTED', { defenseState: this.state, saberState: this.lightsaber.currentState });
    });
    window.addEventListener('pointerup', (event) => {
      if (event.button !== 2) return;
      combatTrace.log('BLOCK INPUT', {
        pointerDown: this.state !== 'NONE',
        pointerUp: true,
        saberState: this.lightsaber.currentState,
        defenseState: this.state,
        clipSelected: 'block_center',
        animationGroupFound: this.player.combatAnimations.hasExact('block_center'),
      });
      this.release();
    });
    window.addEventListener('pointercancel', (event) => {
      if ((event as PointerEvent).button === 2) combatTrace.log('BLOCK INPUT', { pointerDown: this.state !== 'NONE', pointerUp: false, canceled: true, saberState: this.lightsaber.currentState, defenseState: this.state });
      this.release();
    });
    window.addEventListener('contextmenu', (event) => event.preventDefault());
  }

  update(deltaSeconds: number) {
    this.parryVisualRemaining = Math.max(0, this.parryVisualRemaining - deltaSeconds);

    if (this.staggerRemaining > 0) {
      this.staggerRemaining = Math.max(0, this.staggerRemaining - deltaSeconds);
      this.state = this.staggerRemaining > 0 ? 'BLOCK_STAGGER' : 'NONE';
    }

    // Combat owns the upper-body pose during a swing. This controller runs
    // after LightsaberCombatController, so clearing the attachment here
    // would silently erase the attack arm/hand/hilt transform every frame.
    if (this.isAttackBusy()) {
      if (this.state !== 'NONE') this.release();
      return;
    }
    if (!this.lightsaber.isOn || this.staggerRemaining > 0 || this.state === 'NONE') {
      if (this.state === 'BLOCK_STAGGER') return;
      if (this.state !== 'NONE' && !this.lightsaber.isOn) this.release();
      this.leaveAuthoredDefenseAnimation();
      this.attachment.clearCombatOffset();
      this.attachment.clearCombatPose();
      return;
    }
    if (this.state === 'PARRY_WINDOW' && performance.now() - this.pressedAt > 180) this.state = 'BLOCKING';
    if (this.player.hasAuthoredCombatAnimations) {
      this.attachment.setAuthoredAnimationActive(true);

      // PARRY_WINDOW is a timing/gameplay state, not a command to throw the
      // arm into a parry pose every time RMB is pressed.  Visually we enter
      // a stable guard immediately and only play the authored parry when an
      // actual saber contact is resolved as PARRY by DuelCombatSystem.
      if (this.parryVisualRemaining > 0) this.player.combatAnimations.playParry();
      else {
        this.player.combatAnimations.playBlock();
        this.player.combatAnimations.holdBlockAtTime((performance.now() - this.pressedAt) / 1000);
      }


      this.authoredDefenseAnimation = true;
    }
    this.player.setCombatControl(0.54, Math.PI, Vector3.Zero());
    this.attachment.setCombatOffset(this.defenseOffset);
    this.attachment.setCombatPose(this.defensePose);
  }

  applyStagger(duration = 0.38) {
    this.parryVisualRemaining = 0;
    this.release();
    this.staggerRemaining = duration;
    this.state = 'BLOCK_STAGGER';
  }

  release() {
    this.state = 'NONE';
    this.pressedAt = 0;
    if (!this.isAttackBusy()) this.leaveAuthoredDefenseAnimation();
  }

  private leaveAuthoredDefenseAnimation() {
    if (!this.authoredDefenseAnimation) return;
    this.authoredDefenseAnimation = false;
    this.attachment.setAuthoredAnimationActive(false);
    this.player.clearCombatAnimation();
  }


  triggerParryVisual(duration = 0.16) {
    if (!this.lightsaber.isOn || this.isAttackBusy()) return;
    this.parryVisualRemaining = Math.max(this.parryVisualRemaining, duration);
  }

  debugSetBlocking() {
    if (!this.lightsaber.isOn) return;
    this.pressedAt = performance.now() - 250;
    this.state = 'BLOCKING';
  }

  debugSetParryWindow() {
    if (!this.lightsaber.isOn) return;
    this.pressedAt = performance.now();
    this.state = 'PARRY_WINDOW';
  }

  get currentState() { return this.state; }
  get isBlocking() { return this.state === 'BLOCKING' || this.state === 'PARRY_WINDOW'; }
  get isParryWindow() { return this.state === 'PARRY_WINDOW'; }
  get parryAgeMs() { return this.pressedAt ? performance.now() - this.pressedAt : 0; }
}
