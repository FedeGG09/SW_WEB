import {
  Color3,
  DirectionalLight,
  HemisphericLight,
  MeshBuilder,
  Scene,
  StandardMaterial,
  Vector3,
} from '@babylonjs/core';
import { PlayerController } from '../player/PlayerController';
import { ThirdPersonCamera } from '../player/ThirdPersonCamera';
import { LightsaberController } from '../player/LightsaberController';
import { addDevPlayableCharacterSelector } from '../dev/kotor/DevPlayableCharacterSelector';

export type CharacterLabIdentity = {
  characterId: string;
  displayName: string;
  assetPath: string;
  actualSha256: string;
  animationProfile: string;
  skeletonType: string;
  jointCount: number;
  assertion: 'PASS' | 'NOT_AREN_TEST';
};

type LocomotionTrial = 'IDLE' | 'WALK' | 'RUN' | 'BACKWARD' | 'STRAFE_LEFT' | 'STRAFE_RIGHT' | 'STOPPED';
type JkaAttackPhase = 'START' | 'ATTACK' | 'RETURN';

export class CharacterLab {
  private readonly panel: HTMLDivElement;
  private readonly status: HTMLDivElement;
  private accumulator = 0;
  private trial: LocomotionTrial = 'IDLE';
  private trialDistance = 0;
  private totalDistance = 0;
  private previousPosition = Vector3.Zero();
  private trialStartedAt = 0;
  private trialTargetDistance = 30;
  private timedOut = false;
  private jkaReady = false;
  private jkaAttackPhase?: JkaAttackPhase;
  private jkaAttackElapsed = 0;
  private jkaPreviewClip = '';

  private get jkaPreviewGroups() {
    return this.player.characterDefinition.leaderCombatProfile?.groups
      ?? this.player.characterDefinition.characterLabJkaPreviewProfile?.groups;
  }

  private get hasJkaPreviewProfile() { return Boolean(this.jkaPreviewGroups); }
  private get hasJkaCombatProfile() { return Boolean(this.player.characterDefinition.leaderCombatProfile); }

  constructor(
    private readonly scene: Scene,
    private readonly player: PlayerController,
    private readonly camera: ThirdPersonCamera,
    private readonly identity: CharacterLabIdentity,
    private readonly lightsaber?: LightsaberController,
  ) {
    this.scene.clearColor.set(0.018, 0.026, 0.034, 1);
    this.scene.fogMode = Scene.FOGMODE_NONE;

    const ambient = new HemisphericLight('CharacterLabAmbient', new Vector3(0, 1, 0), scene);
    ambient.intensity = 0.72;
    ambient.diffuse = new Color3(0.62, 0.72, 0.82);
    ambient.groundColor = new Color3(0.05, 0.06, 0.07);
    const key = new DirectionalLight('CharacterLabKey', new Vector3(-0.5, -1, 0.4), scene);
    key.intensity = 1.25;
    key.diffuse = new Color3(0.88, 0.93, 1);

    const floor = MeshBuilder.CreateGround('CharacterLabFloor', { width: 120, height: 120, subdivisions: 1 }, scene);
    const floorMaterial = new StandardMaterial('CharacterLabFloorMaterial', scene);
    floorMaterial.diffuseColor = new Color3(0.075, 0.095, 0.11);
    floorMaterial.specularColor = new Color3(0.18, 0.2, 0.22);
    floor.material = floorMaterial;
    floor.isPickable = false;

    for (let i = -5; i <= 5; i += 1) {
      const lineX = MeshBuilder.CreateBox(`LabGridX_${i}`, { width: 0.02, height: 0.004, depth: 120 }, scene);
      lineX.position.set(i * 10, 0.004, 0);
      const lineZ = MeshBuilder.CreateBox(`LabGridZ_${i}`, { width: 120, height: 0.004, depth: 0.02 }, scene);
      lineZ.position.set(0, 0.004, i * 10);
      const mat = new StandardMaterial(`LabGridMaterial_${i}`, scene);
      mat.emissiveColor = new Color3(0.035, 0.11, 0.14);
      lineX.material = mat;
      lineZ.material = mat;
      lineX.isPickable = false;
      lineZ.isPickable = false;
    }

    this.player.setPosition(new Vector3(0, 0, 0));
    this.player.setFacingYaw(Math.PI);
    this.player.setCollisionResolver((position) => { position.y = 0; });
    this.camera.setInteriorProfile(false);
    this.camera.yaw = 0;
    this.camera.pitch = 0.18;
    this.camera.distance = 5.4;

    this.panel = document.createElement('div');
    this.panel.id = 'characterLabPanel';
    Object.assign(this.panel.style, {
      position: 'fixed', left: '8px', top: '8px', zIndex: '50', width: 'min(440px, calc(100vw - 16px))',
      boxSizing: 'border-box', padding: '8px 9px', background: 'rgba(3, 10, 16, .9)', border: '1px solid rgba(103, 211, 238, .48)',
      borderRadius: '8px', color: '#d8edf3', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: '10px', lineHeight: '1.32', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', pointerEvents: 'auto',
      maxHeight: '45vh', overflowY: 'auto', overscrollBehavior: 'contain',
    });
    document.body.appendChild(this.panel);

    const title = document.createElement('div');
    title.textContent = identity.characterId === 'AREN_JKA_PROTOTYPE_V0'
      ? 'W237.2C.2 — NATIVE JKA AREN PROTOTYPE'
      : identity.characterId === 'AREN_CALEB_JKA_CANDIDATE'
        ? 'W237.2D.1 — CALEB JKA DONOR CANDIDATE'
        : identity.characterId === 'NARA_MEETRA_JKA_CANDIDATE'
          ? 'W237.2D.1 — MEETRA JKA FOLLOWER CANDIDATE'
          : 'CHARACTER LAB — AREN ORIGINAL';
    title.style.cssText = 'font-weight:700;color:#7de4ff;margin-bottom:4px';
    this.panel.appendChild(title);
    const identityBox = document.createElement('pre');
    identityBox.style.cssText = 'white-space:pre-wrap;margin:0 0 5px;color:#c4d5dc;font-size:9px;line-height:1.25';
    identityBox.textContent = [
      `CHARACTER_ID  ${identity.characterId}`,
      `DISPLAY       ${identity.displayName}`,
      `ASSET_PATH    ${identity.assetPath}`,
      `ASSET_SHA256  ${identity.actualSha256}`,
      `ANIM_PROFILE ${identity.animationProfile}`,
      `SKELETON      ${identity.skeletonType} · ${identity.jointCount} joints`,
      `ASSERTION     ${identity.assertion}`,
    ].join('\n');
    this.panel.appendChild(identityBox);

    if (identity.characterId.startsWith('AREN') || identity.characterId.startsWith('NARA')) {
      this.addArenVariantSelector(this.panel, identity.characterId);
    }

    const controls = document.createElement('div');
    controls.style.cssText = 'display:flex;flex-wrap:wrap;gap:5px;margin-bottom:7px';
    this.panel.appendChild(controls);
    this.addButton(controls, 'WALK · 30 m', () => this.startTrial('WALK'));
    this.addButton(controls, 'RUN · 30 m', () => this.startTrial('RUN'));
    if (this.hasJkaPreviewProfile && this.player.characterDefinition.exactLocomotion?.backward) {
      this.addButton(controls, 'BACK · 3 m', () => this.startTrial('BACKWARD'));
      this.addButton(controls, 'STRAFE L · 3 m', () => this.startTrial('STRAFE_LEFT'));
      this.addButton(controls, 'STRAFE R · 3 m', () => this.startTrial('STRAFE_RIGHT'));
    }
    this.addButton(controls, 'STOP', () => this.finishTrial(false));
    this.addButton(controls, 'RESET', () => this.resetTrial());
    if (this.hasJkaPreviewProfile) {
      this.addButton(controls, this.jkaReady ? 'EXPLORE' : 'SABER READY', () => this.toggleJkaReady());
      if (this.hasJkaCombatProfile) this.addButton(controls, 'FIRST ATTACK · NO DAMAGE', () => this.startJkaAttack());
      this.addButton(controls, 'SABER ON/OFF', () => this.toggleJkaSaber());
      if (this.hasJkaCombatProfile) {
        const hints = document.createElement('div');
        hints.textContent = 'WASD move · Shift forward run · R ready toggle · 1 visual attack';
        hints.style.cssText = 'flex-basis:100%;color:#87aeb8;font-size:9px;padding:2px 0';
        controls.appendChild(hints);
      }
      window.addEventListener('keydown', this.onJkaLabKeyDown);
      void this.ensureJkaSaberOn();
    }

    this.status = document.createElement('div');
    this.status.style.cssText = 'color:#b7efca;font-size:10px';
    this.panel.appendChild(this.status);

    if (identity.characterId !== 'AREN') {
      const characterSwitch = document.createElement('div');
      characterSwitch.style.cssText = 'position:fixed;right:14px;top:14px;z-index:55;pointer-events:auto';
      document.body.appendChild(characterSwitch);
      addDevPlayableCharacterSelector(characterSwitch, this.player.characterDefinition.id, {
        title: 'Switch the generic PlayerController profile; reload releases the old actor and camera.',
      });
    }
    document.getElementById('hud')?.style.setProperty('display', 'none');
    document.getElementById('questHud')?.style.setProperty('display', 'none');
    document.getElementById('loadingOverlay')?.classList.add('is-hidden');
    this.previousPosition.copyFrom(this.player.position);
    this.updateStatus();
  }

  private addButton(parent: HTMLDivElement, label: string, action: () => void) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.style.cssText = 'border:1px solid #55aec2;border-radius:5px;background:#102b36;color:#e9fbff;padding:5px 8px;font:600 10px ui-monospace,monospace;cursor:pointer';
    button.addEventListener('click', action);
    parent.appendChild(button);
  }

  private addArenVariantSelector(parent: HTMLDivElement, selected: string) {
    const label = document.createElement('label');
    label.textContent = selected.startsWith('NARA') ? 'NARA VARIANT  ' : 'AREN VARIANT  ';
    label.style.cssText = 'display:block;margin:2px 0 6px;color:#92bdc7;font-size:9px';
    const select = document.createElement('select');
    select.setAttribute('aria-label', 'Aren Character Lab variant');
    select.style.cssText = 'border:1px solid #477986;border-radius:4px;background:#10232c;color:#e8fbff;padding:3px 5px;font:600 9px ui-monospace,monospace';
    const options = selected.startsWith('NARA') ? [
      { player: 'nara-original', label: 'NARA ORIGINAL' },
      { player: 'nara-belaya', label: 'NARA BELAYA VANILLA' },
      { player: 'nara-meetra-jka-candidate', label: 'NARA MEETRA JKA CANDIDATE' },
    ] : [
      { player: 'aren', label: 'AREN ORIGINAL' },
      { player: 'aren-jka-prototype', label: 'AREN JKA BASELINE' },
      { player: 'aren-caleb-jka-candidate', label: 'AREN CALEB JKA CANDIDATE' },
    ];
    for (const option of options) {
      const element = document.createElement('option');
      element.value = option.player;
      element.textContent = option.label;
      element.selected = selected === option.player || selected === option.player.toUpperCase().replace(/-/g, '_');
      select.appendChild(element);
    }
    select.addEventListener('change', () => {
      window.location.assign(`${window.location.pathname}?characterLab=1&player=${encodeURIComponent(select.value)}`);
    });
    label.appendChild(select);
    parent.appendChild(label);
  }

  private get jkaProfile() {
    return this.player.characterDefinition.leaderCombatProfile;
  }

  private playJkaPresentationClip(name: string, loop: boolean) {
    return this.jkaProfile
      ? this.player.playLeaderProfileClip(name, loop)
      : this.player.playCharacterLabClip(name, loop);
  }

  private async ensureJkaSaberOn() {
    if (!this.lightsaber || this.lightsaber.currentState !== 'OFF') return;
    try { await this.lightsaber.toggle(); }
    catch (error) { console.error('JKA PROTOTYPE SABER ATTACHMENT FAILED', error); }
  }

  private toggleJkaSaber() {
    if (!this.lightsaber || this.lightsaber.currentState === 'IGNITING' || this.lightsaber.currentState === 'RETRACTING') return;
    void this.lightsaber.toggle();
  }

  private toggleJkaReady() {
    this.jkaReady = !this.jkaReady;
    this.jkaAttackPhase = undefined;
    this.jkaAttackElapsed = 0;
    this.jkaPreviewClip = '';
    if (this.jkaReady) void this.ensureJkaSaberOn();
    else this.player.clearCharacterLabClip();
    this.updateStatus();
  }

  private startJkaAttack() {
    const profile = this.jkaProfile;
    if (!profile) return;
    this.jkaReady = true;
    void this.ensureJkaSaberOn();
    this.jkaAttackPhase = 'START';
    this.jkaAttackElapsed = 0;
    this.playJkaAttackPhase();
  }

  private playJkaAttackPhase() {
    const profile = this.jkaProfile;
    if (!profile || !this.jkaAttackPhase) return;
    const key = this.jkaAttackPhase === 'START'
      ? 'attackStart'
      : this.jkaAttackPhase === 'ATTACK'
        ? 'attack'
        : 'attackReturn';
    const clip = profile.groups[key];
    if (this.player.playLeaderProfileClip(clip, false)) this.jkaPreviewClip = clip;
    else console.error(`JKA prototype clip missing: ${clip}`);
  }

  private updateJkaPreview(deltaSeconds: number) {
    const profile = this.jkaProfile;
    const groups = this.jkaPreviewGroups;
    if (!groups) return;
    if (this.jkaAttackPhase) {
      if (!profile) return;
      this.jkaAttackElapsed += deltaSeconds;
      const sourceKey = this.jkaAttackPhase === 'START'
        ? 'attackStart'
        : this.jkaAttackPhase === 'ATTACK'
          ? 'attack'
          : 'attackReturn';
      const clip = profile.groups[sourceKey];
      const duration = (this.player.characterDefinition.leaderCombatProfile?.sourceSymbols[sourceKey] === 'BOTH_S1_S1_T_' ? 6 / 20
        : sourceKey === 'attack' ? 8 / 30 : 5 / 30);
      if (this.jkaAttackElapsed >= duration) {
        if (this.jkaAttackPhase === 'START') this.jkaAttackPhase = 'ATTACK';
        else if (this.jkaAttackPhase === 'ATTACK') this.jkaAttackPhase = 'RETURN';
        else {
          this.jkaAttackPhase = undefined;
          this.jkaReady = true;
          this.jkaPreviewClip = '';
        }
        this.jkaAttackElapsed = 0;
        if (this.jkaAttackPhase) this.playJkaAttackPhase();
      }
      return;
    }
    if (!this.jkaReady) {
      if (this.jkaPreviewClip) {
        this.jkaPreviewClip = '';
        this.player.clearCharacterLabClip();
      }
      return;
    }

    const state = this.player.detailedLocomotionState;
    const clip = state === 'RUN_FORWARD'
      ? groups.forwardRun
      : state === 'WALK_FORWARD' || state === 'FORWARD_LEFT' || state === 'FORWARD_RIGHT'
        ? groups.forwardWalk
        : state === 'BACKPEDAL' || state === 'BACK_LEFT' || state === 'BACK_RIGHT'
          ? groups.backwardWalk
          : state === 'STRAFE_LEFT'
            ? groups.strafeLeft
            : state === 'STRAFE_RIGHT'
              ? groups.strafeRight
              : groups.saberReady;
    if (clip !== this.jkaPreviewClip) {
      if (this.playJkaPresentationClip(clip, true)) this.jkaPreviewClip = clip;
      else console.error(`JKA prototype movement clip missing: ${clip}`);
    }
  }

  private readonly onJkaLabKeyDown = (event: KeyboardEvent) => {
    if (event.repeat || !this.hasJkaPreviewProfile) return;
    const key = event.key.toLowerCase();
    if (key === 'r') {
      event.preventDefault();
      this.toggleJkaReady();
    } else if (key === '1') {
      if (!this.hasJkaCombatProfile) return;
      event.preventDefault();
      this.startJkaAttack();
    }
  };

  private startTrial(trial: 'WALK' | 'RUN' | 'BACKWARD' | 'STRAFE_LEFT' | 'STRAFE_RIGHT') {
    this.releaseMovementKeys();
    this.trial = trial;
    this.trialDistance = 0;
    this.trialTargetDistance = trial === 'WALK' || trial === 'RUN' ? 30 : 3;
    this.trialStartedAt = performance.now();
    this.timedOut = false;
    const movementKey = trial === 'BACKWARD' ? 's' : trial === 'STRAFE_LEFT' ? 'a' : trial === 'STRAFE_RIGHT' ? 'd' : 'w';
    this.dispatchKey(movementKey, true);
    if (trial === 'RUN') this.dispatchKey('shift', true);
    this.updateStatus();
  }

  private dispatchKey(key: string, down: boolean) {
    window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { key, bubbles: true }));
  }

  private releaseMovementKeys() {
    for (const key of ['w', 'a', 's', 'd', 'shift']) this.dispatchKey(key, false);
  }

  private finishTrial(completed: boolean, timedOut = false) {
    this.releaseMovementKeys();
    this.trial = completed ? this.trial : 'STOPPED';
    this.timedOut = timedOut;
    this.updateStatus(completed ? 'TARGET DISTANCE REACHED' : 'STOPPED');
  }

  private resetTrial() {
    this.releaseMovementKeys();
    this.jkaReady = false;
    this.jkaAttackPhase = undefined;
    this.jkaPreviewClip = '';
    if (this.hasJkaPreviewProfile) this.player.clearCharacterLabClip();
    else this.player.clearLeaderProfileClip();
    this.player.setPosition(new Vector3(0, 0, 0));
    this.player.setFacingYaw(Math.PI);
    this.trial = 'IDLE';
    this.trialTargetDistance = 30;
    this.trialDistance = 0;
    this.totalDistance = 0;
    this.previousPosition.copyFrom(this.player.position);
    this.updateStatus('RESET');
  }

  private updateStatus(note?: string) {
    const velocity = this.player.movementVelocity;
    const clips = this.player.animations.availableClips;
    this.status.textContent = [
      `TRIAL ${this.trial}${this.timedOut ? ' / SAFETY TIMEOUT' : ''}${note ? ` / ${note}` : ''} · ${this.trialDistance.toFixed(1)} / ${this.trialTargetDistance} m`,
      `CLIPS ${clips.idle} / ${clips.walk} / ${clips.run}`,
      ...(this.hasJkaPreviewProfile ? [`JKA ${this.jkaReady ? 'SABER_READY' : 'EXPLORATION'} · ${this.jkaAttackPhase ?? 'READY'} · ${this.jkaPreviewClip || this.player.combatAnimationState}`] : []),
      ...(this.hasJkaPreviewProfile ? [`SABER ${this.lightsaber?.currentState ?? 'UNAVAILABLE'} · INSTANCES ${this.lightsaber?.isAttached ? 1 : 0} · SOCKET ${this.lightsaber?.socketBone ?? 'NONE'}`] : []),
      `ACTIVE ${this.player.animations.availableAnimation} · ${this.player.detailedLocomotionState} · ${this.player.horizontalSpeed.toFixed(2)} m/s (v ${Math.hypot(velocity.x, velocity.z).toFixed(2)})`,
      `DIST ${this.trialDistance.toFixed(2)} m · TOTAL ${this.totalDistance.toFixed(2)} m · POS ${this.player.position.x.toFixed(2)}, ${this.player.position.y.toFixed(2)}, ${this.player.position.z.toFixed(2)}`,
    ].join('\n');
  }

  update(deltaSeconds: number) {
    const moved = Vector3.Distance(this.previousPosition, this.player.position);
    if (Number.isFinite(moved)) {
      this.totalDistance += moved;
      if (this.trial !== 'IDLE' && this.trial !== 'STOPPED') this.trialDistance += moved;
    }
    this.previousPosition.copyFrom(this.player.position);

    if (this.trial !== 'IDLE' && this.trial !== 'STOPPED' && this.trialDistance >= this.trialTargetDistance) {
      this.finishTrial(true);
    } else if (this.trial !== 'IDLE' && this.trial !== 'STOPPED' && performance.now() - this.trialStartedAt > 20_000) {
      this.finishTrial(false, true);
    }

    this.updateJkaPreview(deltaSeconds);

    this.accumulator += deltaSeconds;
    if (this.accumulator < 0.1) return;
    this.accumulator = 0;
    this.updateStatus();
  }
}
