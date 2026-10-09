import { isTatooineScene, resolveTatooineScene } from '../world/tatooine/TatooineCatalog';
import { W225_PROMOTED } from '../world/tatooine/TatooineSpaceportConfig';
import { Color3, Engine, MeshBuilder, Scene, StandardMaterial, TransformNode, Vector3 } from '@babylonjs/core';
import { AssetLoader } from '../assets/AssetLoader';
import { DebugOverlay } from '../debug/DebugOverlay';
import { DialogueSystem } from '../dialogue/DialogueSystem';
import { InteractionSystem } from '../interaction/InteractionSystem';
import { PlayerController } from '../player/PlayerController';
import { ThirdPersonCamera } from '../player/ThirdPersonCamera';
import { WeaponAttachment } from '../player/WeaponAttachment';
import { LightsaberController } from '../player/LightsaberController';
import { LightsaberCombatController } from '../player/LightsaberCombatController';
import { PlayerPresentationController } from '../player/PlayerPresentationController';
import { PLAYER_CHARACTERS, resolvePlayerCharacter } from '../player/PlayerCharacterConfig';
import { TrainingDummy } from '../combat/TrainingDummy';
import { AttackDirection } from '../combat/AttackDirectionResolver';
import { DefenseController } from '../combat/DefenseController';
import { DuelCombatSystem } from '../combat/DuelCombatSystem';
import { DuelistAI } from '../combat/DuelistAI';
import { QuestSystem } from '../quests/QuestSystem';
import { GameState, SceneId, SpawnId } from './GameState';
import { SceneManager } from './SceneManager';
import { CharacterLab } from '../lab/CharacterLab';
import { PartyController } from '../party/PartyController';
import { PartyPauseMenu } from '../party/PartyPauseMenu';
import { partyRoster } from '../party/PartyRoster';
import { NaraJediController } from '../party/NaraJediController';
import { ElyraBlasterController } from '../combat/ElyraBlasterController';
import { combatTrace } from '../debug/CombatTrace';
import { HostileMercenaryTarget } from '../combat/HostileMercenaryTarget';
import { HOSTILE_MERCENARY_JKA_V1 } from '../party/tactical/HostileMercenaryProfile';
import { BlasterWeaponAttachment } from '../combat/BlasterWeaponAttachment';
import { BlasterProjectileActor, createSceneWorldHitTest } from '../combat/BlasterProjectile';
import { SingleBlasterFireController } from '../combat/SingleBlasterFireController';
import { SaberProjectileInterceptor } from '../combat/SaberProjectileInterceptor';
import { alignVisualFeetToGround, measureVisualBounds } from '../world/CharacterGrounding';

async function hashAssetSha256(url: string) {
  const response = await fetch(url, { cache: 'no-cache' });
  if (!response.ok) {
    throw new Error(`Character identity assertion could not read ${url}: HTTP ${response.status}`);
  }
  const bytes = await response.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

export class Game {
  private readonly engine: Engine;
  private readonly scene: Scene;
  private readonly loader = new AssetLoader();

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true, adaptToDeviceRatio: true });
    // Integrated-GPU baseline: keep the CSS viewport native while rendering at
    // a modest internal scale so the vertical slice remains responsive.
    this.engine.setHardwareScalingLevel(window.innerWidth < 800 ? 2 : 1.25);
    this.scene = new Scene(this.engine);
  }

  async start(onProgress: (value: number, message: string) => void) {
    // W217.5 — Aren Vey becomes the default playable protagonist.
    //
    // The Ithorian is deliberately preserved as an alternate development
    // character instead of being renamed, moved or deleted.
    //
    // Useful overrides:
    //   ?player=ithorian  -> run the normal game with the preserved Ithorian
    //   ?arenLab=1        -> Aren Character Lab
    //   ?ithorianLab=1    -> preserved Ithorian Character Lab
    const search = new URLSearchParams(window.location.search);
    const arenLabMode = search.get('arenLab') === '1';
    const ithorianLabMode = search.get('ithorianLab') === '1';
    const characterLabMode = import.meta.env.DEV && (
      search.get('characterLab') === '1'
      || arenLabMode
      || ithorianLabMode
    );

    const playerCharacter =
      arenLabMode
        ? PLAYER_CHARACTERS.aren
        : ithorianLabMode
          ? PLAYER_CHARACTERS.ithorian
          : resolvePlayerCharacter(search);

    const playerVisual = await this.loader.load(
      playerCharacter.assetPath,
      this.scene,
      (fraction) =>
        onProgress(
          fraction * 0.22,
          playerCharacter.loadingMessage,
      ),
    );
    let characterLabIdentity: {
      characterId: string;
      displayName: string;
      assetPath: string;
      actualSha256: string;
      animationProfile: string;
      skeletonType: string;
      jointCount: number;
      assertion: 'PASS' | 'NOT_AREN_TEST';
    } | undefined;
    if (characterLabMode) {
      const identityChecked = Boolean(playerCharacter.expectedAssetSha256);
      const actualSha256 = identityChecked
        ? await hashAssetSha256(playerCharacter.assetPath)
        : 'NOT_CHECKED_NON_AREN_TEST';
      const loadedSkeletons = [...new Set(playerVisual.meshes.map((mesh) => mesh.skeleton).filter((skeleton): skeleton is NonNullable<typeof skeleton> => skeleton !== null))];
      const jointCount = loadedSkeletons.length === 1 ? loadedSkeletons[0].bones.length : -1;
      const animationProfile = playerCharacter.leaderCombatProfile
        ? (playerCharacter.id === 'aren-jka-prototype' ? 'JKA_NATIVE_LEADER_V0 · exact clip groups' : 'JKA_NATIVE_DONOR_COMBAT_CANDIDATE · exact source groups')
        : playerCharacter.characterLabJkaPreviewProfile
          ? 'JKA_NATIVE_COMPANION_PRESENTATION · DEV preview only'
        : playerCharacter.exactLocomotion
          ? `EXACT ${playerCharacter.exactLocomotion.idle ?? '—'} / ${playerCharacter.exactLocomotion.walk} / ${playerCharacter.exactLocomotion.run}`
          : 'LEGACY_AUTHORED_NAME_RESOLVER';
      const identityMatches = identityChecked
        && actualSha256 === playerCharacter.expectedAssetSha256;
      if (identityChecked && !identityMatches) {
        throw new Error(
          `CHARACTER_IDENTITY_ASSERTION_FAILED: id=${playerCharacter.id}; asset=${playerCharacter.assetPath}; expected=${playerCharacter.expectedAssetSha256}; actual=${actualSha256}`,
        );
      }
      characterLabIdentity = {
        characterId: playerCharacter.id === 'aren-jka-prototype' ? 'AREN_JKA_PROTOTYPE_V0' : playerCharacter.id.replace(/-/g, '_').toUpperCase(),
        displayName: playerCharacter.displayName,
        assetPath: playerCharacter.assetPath,
        actualSha256,
        animationProfile,
        skeletonType: jointCount === 53 ? 'JKA_HUMANOID' : loadedSkeletons.length ? 'SKELETON_PRESENT' : 'NO_SKELETON',
        jointCount,
        assertion: identityChecked ? 'PASS' : 'NOT_AREN_TEST',
      };
    }
    if (playerCharacter.id === 'aren') {
      combatTrace.playerAssetLoaded(playerVisual.animationGroups);
    }

    let player!: PlayerController;
    let duelOpponent: DuelistAI | undefined;
    const camera = new ThirdPersonCamera(this.scene, this.canvas, () => {
      if (duelOpponent) return Vector3.Lerp(player.position, duelOpponent.position, 0.5).add(new Vector3(0, 1.05, 0));
      return player ? player.position.add(new Vector3(0, 1.2, 0)) : Vector3.Zero();
    });
    player = new PlayerController(this.scene, playerVisual, camera, playerCharacter);
    const weaponAttachment = new WeaponAttachment(
      this.scene,
      playerVisual,
      this.loader,
      playerCharacter.leaderCombatProfile?.saberAttachmentNode ?? playerCharacter.weaponAttachmentNode,
      playerCharacter.weaponPresentation,
    );
    const lightsaber = new LightsaberController(this.scene, weaponAttachment, document.getElementById('saberHint') ?? undefined);
    const combat = new LightsaberCombatController(player, weaponAttachment, lightsaber);
    const presentation = new PlayerPresentationController(player, weaponAttachment);
    const defense = new DefenseController(player, weaponAttachment, lightsaber, () => combat.isBusy);
    if (characterLabMode) {
      const lab = new CharacterLab(this.scene, player, camera, characterLabIdentity!, lightsaber);
      this.scene.activeCamera = camera.camera;
      this.scene.onBeforeRenderObservable.add(() => {
        const deltaSeconds = Math.min(0.05, this.engine.getDeltaTime() / 1000);
        player.update(deltaSeconds);
        lightsaber.update(deltaSeconds);
        presentation.update(deltaSeconds, lightsaber.currentState, combat.currentState);
        combat.update(deltaSeconds);
        defense.update(deltaSeconds);
        weaponAttachment.finalizeCombatPose();
        weaponAttachment.updateArmDebug();
        camera.update();
        lab.update(deltaSeconds);
      });
      window.addEventListener('resize', () => this.engine.resize());
      this.engine.runRenderLoop(() => this.scene.render());
      onProgress(
        1,
        playerCharacter.labReadyMessage,
      );
      return;
    }

    const state = new GameState();

    // W218 — Party roster persists independently from the lightweight quest
    // state. If Nara was already recruited in a previous session, do not put
    // the player back behind the ship-exit gate or ask them to recruit her a
    // second time. Party recruitment is the persistent authority; a full
    // new-game reset can clear the party localStorage in a later save-system pass.
    if (
      partyRoster.isRecruited('nara_voss')
    ) {
      state.questStarted = true;
      state.naraConversationCompleted = true;
      state.questStage = Math.max(
        state.questStage,
        2,
      );
    }

    const captureMode = search.get('w1capture');
    const w15Capture = search.get('w15capture');
    const w16Capture = search.get('w16capture');
    const requestedScene = search.get('scene') as SceneId | null;
    const requestedSpawn = search.get('spawn') as SpawnId | null;
    const w17Capture = search.get('w17capture');
    const w19Capture = search.get('w19capture');
    const w19Arena = search.get('w19arena') === '1' || Boolean(w19Capture);
    const w20Capture = search.get('w20capture');
    const w20Duel = search.get('w20duel') === '1' || Boolean(w20Capture);
    const w203Capture = search.get('w203capture');
    const w203AttackFrame = search.get('w203attackframe');
    const w203Duel = search.get('w203') === '1' || Boolean(w203Capture) || Boolean(w203AttackFrame);
    const w205Capture = search.get('w205Capture');
    const w206Capture = search.get('w206Capture');
    const w2061Audit = search.get('w2061Audit') === '1';
    const w2062ScaleDebug = search.has('w2062scale');
    const w2064ShipScaleDebug = search.has('w2064shipscale');
    const w208aPerf = search.get('w208aPerf') === '1';
    const w208bCapture = search.get('w208bCapture');
    const w209Capture = search.get('w209Capture');
    const w210Capture = search.get('w210Capture');
    if (w2062ScaleDebug) {
      state.currentScene = 'shipInterior';
      state.currentSpawn = 'shipStart';
      state.questStarted = true;
      state.questStage = 1;
      state.naraConversationCompleted = false;
    }
    if (captureMode === 'exteriorLanding' || captureMode === 'city' || captureMode === 'cantinaExterior') { state.currentScene = 'nerathisExterior'; state.currentSpawn = captureMode === 'city' ? 'city' : captureMode === 'cantinaExterior' ? 'cantinaReturn' : 'landing'; state.questStage = 3; }
    if (captureMode === 'cantinaInterior') { state.currentScene = 'cantinaInterior'; state.currentSpawn = 'cantinaInterior'; state.questStage = 3; }
    if (w15Capture && w15Capture !== 'saber') { state.currentScene = 'nerathisExterior'; state.currentSpawn = w15Capture === 'cityMountains' || w15Capture === 'cityStreet' ? 'city' : w15Capture === 'waterfront' ? 'waterfront' : 'landing'; state.questStage = 3; }
    if (w17Capture) { state.currentScene = 'nerathisExterior'; state.currentSpawn = 'landing'; state.questStage = 3; }
    if (w19Arena) { state.currentScene = 'nerathisExterior'; state.currentSpawn = 'landing'; state.questStage = 3; }
    if (w20Duel) { state.currentScene = 'nerathisExterior'; state.currentSpawn = 'landing'; state.questStage = 3; }
    if (w203Duel) { state.currentScene = 'nerathisExterior'; state.currentSpawn = 'landing'; state.questStage = 3; }
    if (w205Capture) {
      state.currentScene = 'nerathisExterior';
      state.currentSpawn = w205Capture === 'city' || w205Capture === 'terrain' || w205Capture === 'mountains' || w205Capture === 'residential' || w205Capture === 'industrial' ? 'city' : w205Capture === 'water' || w205Capture === 'waterfront' ? 'waterfront' : 'landing';
      state.questStage = 3;
    }
    if (w206Capture) {
      const shipCapture = w206Capture === 'ship' || w206Capture === 'nara' || w206Capture === 'shipExit';
      state.currentScene = shipCapture ? 'shipInterior' : w206Capture === 'cantina' ? 'nerathisExterior' : 'nerathisExterior';
      state.currentSpawn = shipCapture
        ? w206Capture === 'shipExit' ? 'shipExit' : 'shipStart'
        : w206Capture === 'cantina' ? 'cantinaReturn' : w206Capture === 'waterfront' ? 'waterfront' : w206Capture === 'city' || w206Capture === 'cityMountains' ? 'city' : 'landing';
      state.questStage = shipCapture ? 1 : 3;
    }
    if (w16Capture) { state.currentScene = 'nerathisExterior'; state.currentSpawn = w16Capture === 'waterfront' ? 'waterfront' : w16Capture === 'cityMountains' || w16Capture === 'cityStreet' ? 'city' : 'landing'; state.questStage = 3; }
    if (requestedScene === 'nerathisExterior') { state.currentScene = requestedScene; state.currentSpawn = requestedSpawn === 'shipExitExterior' || requestedSpawn === 'cantinaReturn' || requestedSpawn === 'city' || requestedSpawn === 'waterfront' ? requestedSpawn : 'landing'; state.questStage = 3; }
    if (requestedScene === 'shipInterior') { state.currentScene = requestedScene; state.currentSpawn = requestedSpawn === 'shipEntryInterior' ? 'shipEntryInterior' : requestedSpawn === 'shipExit' ? 'shipExit' : 'shipStart'; }
    if (requestedScene === 'cantinaInterior') { state.currentScene = requestedScene; state.currentSpawn = requestedSpawn === 'cantinaExit' ? 'cantinaExit' : 'cantinaInterior'; state.questStage = 3; }
    if (search.get('reset') === '1') {
      state.currentScene = 'shipInterior';
      state.currentSpawn = 'shipStart';
      state.questStarted = true;
      state.questStage = 1;
      state.naraConversationCompleted = false;
    }
    if (w2064ShipScaleDebug) {
      state.currentScene = 'nerathisExterior';
      state.currentSpawn = 'shipExitExterior';
      state.questStarted = true;
      state.questStage = 3;
      state.naraConversationCompleted = true;
    }
    if (w208bCapture) {
      state.currentScene = 'nerathisExterior';
      state.currentSpawn = 'landing';
      state.questStage = 3;
    }
    if (w209Capture) {
      state.currentScene = 'nerathisExterior';
      state.currentSpawn = 'landing';
      state.questStage = 3;
    }
    if (w210Capture) {
      const shipInteriorCapture = w210Capture === 'shipInterior';
      const cantinaInteriorCapture = w210Capture === 'cantinaInterior';
      state.currentScene = shipInteriorCapture ? 'shipInterior' : cantinaInteriorCapture ? 'cantinaInterior' : 'nerathisExterior';
      state.currentSpawn = shipInteriorCapture
        ? 'shipStart'
        : cantinaInteriorCapture
          ? 'cantinaInterior'
          : w210Capture === 'shipEntry'
            ? 'shipExitExterior'
            : w210Capture === 'cantinaExterior'
              ? 'cantinaReturn'
              : w210Capture === 'cityDepth' || w210Capture === 'attackedZone'
                ? 'city'
                : w210Capture === 'swampPath'
                  ? 'waterfront'
                  : 'landing';
      state.questStarted = true;
      state.questStage = shipInteriorCapture ? 1 : 3;
      state.naraConversationCompleted = !shipInteriorCapture;
    }
    const tatooineMode = search.get('world') === 'tatooine';
    if (tatooineMode) {
      const requestedZone = search.get('tatooineZone');
      const stagedW225 = import.meta.env.DEV && search.get('w225Stage') === '1';
      state.currentScene = requestedZone ? resolveTatooineScene(requestedZone)
        : (W225_PROMOTED || stagedW225) ? 'tatooineSpaceport' : 'tatooineHub';
      state.currentSpawn = 'tatooineArrival';
    }
    const quest = new QuestSystem(state, document.getElementById('questObjective')!);
    const dialogue = new DialogueSystem(quest, () => undefined);
    const interaction = new InteractionSystem(this.scene, player, camera);
    const manager = new SceneManager(this.scene, this.loader, player, state, quest, interaction, dialogue, onProgress, (sceneId, transitioned) => {
      const interiorScene = sceneId === 'shipInterior' || sceneId === 'cantinaInterior' || sceneId === 'tatooineCantina' || sceneId === 'tatooineFireflyInterior';
      camera.setInteriorProfile(interiorScene, sceneId === 'shipInterior' ? manager.shipInteriorCameraYaw : Math.PI);
      if (isTatooineScene(sceneId)) { camera.yaw = interiorScene || sceneId === 'tatooineSpaceport' ? 0 : Math.PI; camera.pitch = 0.24; if (!interiorScene) camera.distance = 6; }
      if (sceneId === 'nerathisExterior' && transitioned) camera.beginWorldReveal();
    });
    await manager.loadScene(state.currentScene, state.currentSpawn, false);
    if (w2061Audit) manager.enableShipDebugVisualization();
    if (w2062ScaleDebug) manager.enableShipScaleDebugVisualization();
    if (w2064ShipScaleDebug) {
      manager.enableShipExteriorScaleDebugVisualization();
      camera.setExteriorDebugProfile(24);
      camera.yaw = Math.PI * 0.5;
      camera.pitch = 0.24;
      camera.distance = 24;
    }
    // Keep the real handle/socket present while OFF; Q only extends/retracts
    // the blade and does not rebuild the attachment on every toggle.
    await weaponAttachment.attach();

    // ============================================================
    // W215 — KOTOR-STYLE PARTY
    //
    // One directly controlled leader + up to two physical followers.
    // The original Ithorian visual remains Aren's party actor; Elyra
    // is loaded only after she has been recruited in W214.
    // ============================================================

    const party =
      new PartyController(
        this.scene,
        this.loader,
        player,
        playerVisual,
      );

    await party.initialize();

    const naraJedi =
      new NaraJediController(
        this.scene,
        this.loader,
        player,
        party,
      );

    // Once Nara has joined the group, keep her dialogue/history accessible
    // from the physical companion actor instead of the old static ship NPC.
    interaction.register({
      id: 'nara',
      persistent: true,
      label: 'Hablar con Nara',
      position: () =>
        party
          .getActorAsset('nara_voss')
          ?.root
          .getAbsolutePosition()
        ?? new Vector3(
          9999,
          -9999,
          9999,
        ),
      radius: 1.75,
      enabled: () =>
        partyRoster.isRecruited(
          'nara_voss',
        ) &&
        party.activeId !==
          'nara_voss',
      action: () =>
        dialogue.openNara(),
    });

    lightsaber.setInputEnabled(
      party.activeIsAren,
    );

    const partyPause =
      new PartyPauseMenu(
        player,
        party,
      );

    void partyPause;

    // W216 — Elyra / E-11 player combat.
    const elyraBlaster =
      new ElyraBlasterController(
        this.scene,
        player,
        camera,
        party,
      );

    window.addEventListener(
      'nerathis:party-layout-changed',
      () => {
        // W215 exploration rule:
        // Aren owns the current saber combat stack.
        // When Elyra is directly controlled, keep the saber retracted
        // on the follower and reserve blaster combat for the next pass.
        lightsaber.setInputEnabled(
          party.activeIsAren,
        );

        if (
          !party.activeIsAren &&
          lightsaber.isOn
        ) {
          void lightsaber.toggle();
        }

        player.clearCombatAnimation();
        player.visualRoot.rotation.x = 0;
        player.visualRoot.rotation.z = 0;
      },
    );
    if (w206Capture === 'worldReveal') camera.beginWorldReveal();
    if (w19Capture) { camera.yaw = 0; camera.pitch = 0.22; camera.distance = 6; }
    const trainingDummy = w19Arena && state.currentScene === 'nerathisExterior' ? new TrainingDummy(this.scene, new Vector3(0, 0, -1.35)) : undefined;
    if (trainingDummy) {
      combat.registerTarget({ id: 'training_dummy', receiver: trainingDummy, position: () => trainingDummy.position, radius: trainingDummy.radius });
      naraJedi.registerTarget({ id: 'training_dummy', receiver: trainingDummy, position: () => trainingDummy.position.add(new Vector3(0, 1, 0)), radius: trainingDummy.radius, enabled: () => trainingDummy.isVisible });
    }
    if (tatooineMode) {
      manager.setTatooineTravelGuard(() => player.playerCanControl && !combat.isBusy && !/^(block_|parry_)/.test(player.combatAnimationState) && naraJedi.currentPhase === 'READY' && naraJedi.currentBlockState === 'NONE');
      const receiver = { receiveSaberHit: (event: import('../combat/HitReceiver').SaberHitEvent) => manager.tatooineTrainingDummy?.receiveSaberHit(event) };
      const position = () => manager.tatooineTrainingDummy?.position.add(new Vector3(0, 1, 0)) ?? new Vector3(9999, 9999, 9999);
      const enabled = () => !!manager.tatooineTrainingDummy?.isVisible;
      combat.registerTarget({ id: 'w223_training_dummy', receiver, position, radius: 0.62 });
      naraJedi.registerTarget({ id: 'w223_training_dummy', receiver, position, radius: 0.62, enabled });
      for (const hostile of [
        { id: 'w224_pyke', get: () => manager.tatooinePyke },
        { id: 'w224_rancor', get: () => manager.tatooineRancor },
      ]) {
        const receiver = { receiveSaberHit: (event: import('../combat/HitReceiver').SaberHitEvent) => hostile.get()?.receiveSaberHit(event) };
        const position = () => hostile.get()?.position.add(new Vector3(0, 1, 0)) ?? new Vector3(9999, 9999, 9999);
        const enabled = () => !!hostile.get()?.isAlive;
        // Human vertical extent needs a larger hit sphere than its horizontal collision proxy.
        const radius = hostile.id === 'w224_rancor' ? 2.0 : 0.9;
        combat.registerTarget({ id: hostile.id, receiver, position, radius });
        naraJedi.registerTarget({ id: hostile.id, receiver, position, radius, enabled });
      }
    }
    // Explicit DEV-only hostile actor probe.  This does not populate any
    // canonical Tatooine encounter; it only proves the actor-generic target
    // contract against the existing normal-game saber receivers.
    if (import.meta.env.DEV && tatooineMode && search.get('jkaHostile') === '1') {
      void (async () => {
        const hostileAsset = await this.loader.load(HOSTILE_MERCENARY_JKA_V1.assetPath, this.scene);
      const facing = player.visualRoot.rotation.y;
      const floor = player.position.add(new Vector3(Math.sin(facing) * 1.7, 0, Math.cos(facing) * 1.7));
      const hostile = new HostileMercenaryTarget(this.scene, HOSTILE_MERCENARY_JKA_V1.id, HOSTILE_MERCENARY_JKA_V1, hostileAsset, floor);
      const visualRoot = new TransformNode('TatooineDevHostileVisualRoot', this.scene);
      visualRoot.parent = hostile.root;
      hostileAsset.root.parent = visualRoot;
      const bounds = measureVisualBounds(hostileAsset.meshes);
      if (bounds.height > 0) visualRoot.scaling.setAll(HOSTILE_MERCENARY_JKA_V1.targetHeightM / bounds.height);
      alignVisualFeetToGround(visualRoot, hostileAsset.meshes, floor.y + 0.02);
      const blaster = new BlasterWeaponAttachment(this.scene, this.loader, HOSTILE_MERCENARY_JKA_V1);
      await blaster.attachTo(hostileAsset);
      hostile.reset();
      const asPhysicalHit = (event: import('../combat/HitReceiver').SaberHitEvent) => ({
        attackInstanceId: event.attackId, attackerId: event.sourceId, targetId: hostile.targetId,
        worldPoint: event.position.clone(), bladeT: 0, timestamp: performance.now(),
      });
      const receiver = { receiveSaberHit: (event: import('../combat/HitReceiver').SaberHitEvent) => {
        hostile.applyHit(asPhysicalHit(event), event.damage ?? Math.max(1, event.power));
      }};
      combat.registerTarget({ id: hostile.targetId, receiver, position: () => hostile.collider.center, radius: hostile.collider.radius });
      naraJedi.registerTarget({ id: hostile.targetId, receiver, position: () => hostile.collider.center, radius: hostile.collider.radius, enabled: () => hostile.targetable });
      const naraPartyActor = (party as any).actors?.get?.('nara_voss');
      const rangedHealth = new Map<string, number>([['AREN_NATIVE_JKA_V1', 100], ['NARA_NATIVE_JKA_V1', 100]]);
      let devBlockEligible = false;
      const rangedActors: BlasterProjectileActor[] = [
        { actorId: 'AREN_NATIVE_JKA_V1', faction: 'PARTY', targetable: () => (rangedHealth.get('AREN_NATIVE_JKA_V1') ?? 0) > 0, position: () => player.position.add(new Vector3(0, 1.02, 0)), radius: .55, receiveBlasterHit: event => { const before = rangedHealth.get('AREN_NATIVE_JKA_V1') ?? 0; if (before <= 0) return false; rangedHealth.set('AREN_NATIVE_JKA_V1', Math.max(0, before - event.damage)); return true; } },
        { actorId: 'NARA_NATIVE_JKA_V1', faction: 'PARTY', targetable: () => (rangedHealth.get('NARA_NATIVE_JKA_V1') ?? 0) > 0, position: () => (naraPartyActor?.followerRoot?.getAbsolutePosition?.() ?? new Vector3(9999, 9999, 9999)).add(new Vector3(0, 1.02, 0)), radius: .55, receiveBlasterHit: event => { const before = rangedHealth.get('NARA_NATIVE_JKA_V1') ?? 0; if (before <= 0) return false; rangedHealth.set('NARA_NATIVE_JKA_V1', Math.max(0, before - event.damage)); return true; } },
      ];
      const worldHit = createSceneWorldHitTest(this.scene, [player.visualRoot, hostile.root, blaster.rootNode!], this.scene.meshes);
      const interceptor = new SaberProjectileInterceptor(.08, 180);
      interceptor.registerDefender({ actorId: 'AREN_NATIVE_JKA_V1', blade: { active: false }, blockEligible: () => devBlockEligible, alive: () => (rangedHealth.get('AREN_NATIVE_JKA_V1') ?? 0) > 0, facing: () => player.visualRoot.getDirection(Vector3.Forward()).normalize() });
      const fire = new SingleBlasterFireController(this.scene, hostile.targetId, hostileAsset, blaster, HOSTILE_MERCENARY_JKA_V1, { isShooterAlive: () => hostile.alive, isTargetAlive: id => (rangedHealth.get(id) ?? 0) > 0, onRelease: () => updateHud() });
      const hud = document.createElement('div');
      hud.id = 'jkaHostileTatooineDevHud';
      hud.style.cssText = 'position:fixed;top:64px;right:12px;z-index:42;padding:8px;background:#101922ee;color:#ffd7ad;font:12px monospace;pointer-events:auto;white-space:pre';
      document.body.appendChild(hud);
      const enableDevBlock = async () => { if (!lightsaber.isOn) { await lightsaber.toggle(); await new Promise<void>(resolve => { const started = performance.now(); const poll = () => lightsaber.isOn || performance.now() - started > 1000 ? resolve() : window.setTimeout(poll, 16); poll(); }); } devBlockEligible = true; defense.debugSetBlocking(); updateHud(); };
      const updateHud = () => { if (!hud.dataset.bound) { hud.innerHTML = `DEV HOSTILE · ${HOSTILE_MERCENARY_JKA_V1.id}<br><span id="jkaTatooineHostileStats"></span><br><button id="jkaTatooineFireAren">FIRE AT AREN</button> <button id="jkaTatooineFireArenBlade">FIRE THROUGH AREN BLADE</button> <button id="jkaTatooineFireNara">FIRE AT NARA</button> <button id="jkaTatooineBlockAren">AREN BLOCK ON</button> <button id="jkaTatooineBlockOff">AREN BLOCK OFF</button> <button id="jkaTatooinePauseFire">PAUSE FIRE</button> <button id="jkaTatooineResumeFire">RESUME FIRE</button>`; (hud.querySelector('#jkaTatooineFireAren') as HTMLElement)?.addEventListener('click', () => fire.requestSingleShot('AREN_NATIVE_JKA_V1', player.position.add(new Vector3(0, 1.02, 0)))); (hud.querySelector('#jkaTatooineFireArenBlade') as HTMLElement)?.addEventListener('click', () => { const blade = weaponAttachment.getBladeSegment(); const target = blade ? blade.start.add(blade.end).scale(0.5) : player.position.add(new Vector3(0, 1.02, 0)); fire.requestSingleShot('AREN_NATIVE_JKA_V1', target); }); (hud.querySelector('#jkaTatooineFireNara') as HTMLElement)?.addEventListener('click', () => fire.requestSingleShot('NARA_NATIVE_JKA_V1', (naraPartyActor?.followerRoot?.getAbsolutePosition?.() ?? new Vector3(9999, 9999, 9999)).add(new Vector3(0, 1.02, 0)))); (hud.querySelector('#jkaTatooineBlockAren') as HTMLElement)?.addEventListener('click', () => { void enableDevBlock(); }); (hud.querySelector('#jkaTatooineBlockOff') as HTMLElement)?.addEventListener('click', () => { devBlockEligible = false; defense.release(); }); (hud.querySelector('#jkaTatooinePauseFire') as HTMLElement)?.addEventListener('click', () => { firePaused = true; }); (hud.querySelector('#jkaTatooineResumeFire') as HTMLElement)?.addEventListener('click', () => { firePaused = false; }); hud.dataset.bound = '1'; } const stats = hud.querySelector('#jkaTatooineHostileStats'); if (stats) stats.textContent = `HP ${hostile.health}/${hostile.initialHealth} · TARGETABLE ${hostile.targetable}\nRODIAN FIRE ${fire.phase} · BOLT ${fire.projectileManager.activeCount} · REQ ${fire.requestCount} · REL ${fire.releaseCount}\nAREN HP ${rangedHealth.get('AREN_NATIVE_JKA_V1')} · NARA HP ${rangedHealth.get('NARA_NATIVE_JKA_V1')} · NARA_PRESENT ${Boolean(naraPartyActor)}\nAREN BLOCK ${devBlockEligible} · INTERCEPTS ${interceptor.blocked} · DEFENDER_ACTIVE ${interceptor.telemetry().defenders[0]?.active ?? false}\\nBLADE ${interceptor.telemetry().defenders[0]?.current ? JSON.stringify(interceptor.telemetry().defenders[0].current) : "NONE"}\\nLAST ${fire.telemetry().projectiles.recent[0]?.outcome ?? 'NONE'} · ACTOR_HITS ${fire.telemetry().projectiles.actorHitCount} · WORLD_HITS ${fire.telemetry().projectiles.worldHitCount} · SABER_BLOCKS ${fire.telemetry().projectiles.saberBlockCount}`; };
      const hudObserver = this.scene.onBeforeRenderObservable.add(updateHud);
      let firePaused = false;
      const fireObserver = this.scene.onBeforeRenderObservable.add(() => { const dt = Math.min(.05, this.engine.getDeltaTime() / 1000); if (!firePaused) interceptor.updateBlade('AREN_NATIVE_JKA_V1', weaponAttachment.getBladeSegment(), true); fire.update(dt, firePaused); fire.updateProjectile(dt, rangedActors, worldHit, firePaused, interceptor); });
      this.scene.onDisposeObservable.addOnce(() => { this.scene.onBeforeRenderObservable.remove(hudObserver); this.scene.onBeforeRenderObservable.remove(fireObserver); hud.remove(); fire.dispose(); blaster.dispose(); hostile.dispose(); hostileAsset.dispose(); });
      (window as any).__w2372G4TatooineHostile = { actorId: hostile.targetId, faction: 'HOSTILE', assetPath: HOSTILE_MERCENARY_JKA_V1.assetPath, health: () => hostile.health, targetable: () => hostile.targetable, floor: floor.asArray(), weaponSocket: 'rhand_tag_bone', fire, blaster, interceptor, rangedHealth, pause: () => { firePaused = true; }, resume: () => { firePaused = false; }, fireAtAren: () => fire.requestSingleShot('AREN_NATIVE_JKA_V1', player.position.add(new Vector3(0, 1.02, 0))), fireAtArenBlade: () => { const blade = weaponAttachment.getBladeSegment(); return fire.requestSingleShot('AREN_NATIVE_JKA_V1', blade ? blade.start.add(blade.end).scale(0.5) : player.position.add(new Vector3(0, 1.02, 0))); }, fireAtNara: () => fire.requestSingleShot('NARA_NATIVE_JKA_V1', (naraPartyActor?.followerRoot?.getAbsolutePosition?.() ?? new Vector3(9999, 9999, 9999)).add(new Vector3(0, 1.02, 0))), setBlock: (enabled: boolean) => { if (enabled) void enableDevBlock(); else { devBlockEligible = false; defense.release(); } return enabled; } };
        updateHud();
      })();
    }
    // Optional normal-game target; no narrative actor or companion combat AI.
    const naraTestDummy = search.get('naraCombatTest') === '1'
      ? new TrainingDummy(this.scene, player.position.add(new Vector3(Math.sin(player.visualRoot.rotation.y), 0, Math.cos(player.visualRoot.rotation.y)).scale(1.25)), { maxHealth: 200 }) : undefined;
    if (naraTestDummy) naraJedi.registerTarget({ id: 'nara_training_dummy', receiver: naraTestDummy,
      position: () => naraTestDummy.position.add(new Vector3(0, 1, 0)), radius: naraTestDummy.radius,
      enabled: () => naraTestDummy.isVisible });
    const naraDamageReadout = naraTestDummy ? document.createElement('div') : undefined;
    if (naraDamageReadout) {
      naraDamageReadout.id = 'naraDamageDebug';
      naraDamageReadout.style.cssText = 'position:fixed;top:65px;left:12px;padding:8px;background:#17211ddd;color:#bfffc9;z-index:40;pointer-events:none;font:13px monospace';
      document.body.appendChild(naraDamageReadout);
    }
    let duelist: DuelistAI | undefined;
    let duel: DuelCombatSystem | undefined;
    if ((w20Duel || w203Duel) && state.currentScene === 'nerathisExterior') {
      // W2 showcase duel: keep the mechanics unchanged but stage the actors
      // on the wet causeway so water, city lights and ridges share the frame.
      const duelPlayerSpawn = new Vector3(-0.85, 0, -49);
      const duelSpawn = new Vector3(0.85, 0, -49);
      player.setPosition(duelPlayerSpawn);
      duelist = await DuelistAI.create(this.scene, player, this.loader, duelSpawn);
      duelOpponent = duelist;
      duel = new DuelCombatSystem(this.scene, player, weaponAttachment, combat, defense, duelist, camera);
      window.addEventListener('keydown', (event) => {
        if (event.repeat || event.key.toLowerCase() !== 'k') return;
        event.preventDefault();
        duelist?.toggleAI();
      });
      window.addEventListener('keydown', (event) => {
        if (event.repeat || event.key.toLowerCase() !== 'r') return;
        event.preventDefault();
        duelist?.reset(duelSpawn);
        player.setPosition(duelPlayerSpawn);
        defense.release();
      });
    }
    if (w15Capture === 'waterfront') player.setPosition(new Vector3(0, 0, -55));
    if (w15Capture === 'cityStreet') player.setPosition(new Vector3(0, 0, -100));
    const capture = search.get('capture') ?? (captureMode === 'city' ? 'city' : captureMode === 'cantinaExterior' ? 'cantina-exterior' : captureMode === 'cantinaInterior' ? 'cantina-interior' : captureMode === 'exteriorLanding' ? 'landing' : captureMode === 'ship' || captureMode === 'nara' || captureMode === 'dialogue' ? 'overview' : null);
    if (capture === 'enemy') { camera.yaw = 0; camera.pitch = 0.28; camera.distance = 4.5; }
    if (capture === 'environment') { camera.yaw = 0.25; camera.pitch = 0.18; camera.distance = 7; }
    if (capture === 'overview' || capture === 'landing') { camera.yaw = 0; camera.pitch = 0.24; camera.distance = 6; }
    if (capture === 'city') { camera.yaw = 0; camera.pitch = 0.2; camera.distance = 9; }
    if (capture === 'cantina-exterior') { camera.yaw = 0; camera.pitch = 0.25; camera.distance = 8; }
    if (capture === 'cantina-interior') { camera.yaw = 0; camera.pitch = 0.2; camera.distance = 5; }
    if (w15Capture === 'landing' || w15Capture === 'spaceport') { camera.yaw = 0; camera.pitch = 0.22; camera.distance = w15Capture === 'spaceport' ? 12 : 15; }
    if (w15Capture === 'waterfront') { camera.yaw = 0; camera.pitch = 0.2; camera.distance = 10; }
    if (w15Capture === 'cityMountains') { camera.yaw = 0; camera.pitch = 0.18; camera.distance = 13; }
    if (w15Capture === 'cityStreet') { camera.yaw = 0; camera.pitch = 0.2; camera.distance = 11; }
    if (w15Capture === 'overview') { camera.yaw = 0; camera.pitch = 0.24; camera.distance = 24; }
    if (w17Capture === 'off' || w17Capture === 'on' || w17Capture === 'nerathis') { camera.yaw = 0; camera.pitch = 0.22; camera.distance = 7; }
    if (w17Capture === 'front') { camera.yaw = Math.PI; camera.pitch = 0.2; camera.distance = 5.2; }
    if (w17Capture === 'walk') { camera.yaw = 0.22; camera.pitch = 0.2; camera.distance = 7.5; }
    if (w20Duel) { camera.yaw = 0; camera.pitch = 0.2; camera.distance = 6; }
    if (w203Duel) {
      camera.yaw = w203Capture === 'attack' || Boolean(w203AttackFrame) ? 0.12 : 0;
      camera.pitch = w203Capture === 'hero' || w203Capture === 'overview' ? 0.18 : 0.2;
      camera.distance = w203Capture === 'attack' || Boolean(w203AttackFrame) ? 5.2 : 8;
    }
    if (w205Capture === 'hero') { camera.yaw = 0; camera.pitch = 0.18; camera.distance = 30; }
    if (w205Capture === 'spaceport') { camera.yaw = 0.18; camera.pitch = 0.22; camera.distance = 14; }
    if (w205Capture === 'water' || w205Capture === 'waterfront') { camera.yaw = 0.05; camera.pitch = 0.2; camera.distance = 11; }
    if (w205Capture === 'terrain' || w205Capture === 'mountains') { camera.yaw = 0; camera.pitch = 0.14; camera.distance = 22; }
    if (w205Capture === 'residential') { camera.yaw = 0.28; camera.pitch = 0.22; camera.distance = 9; }
    if (w205Capture === 'industrial') { camera.yaw = -0.22; camera.pitch = 0.18; camera.distance = 14; }
    if (w205Capture === 'coverage') { camera.yaw = 0; camera.pitch = 0.2; camera.distance = 16; }
    if (w16Capture === 'landingHero') { camera.yaw = 0; camera.pitch = 0.15; camera.distance = 28; }
    if (w16Capture === 'spaceportDetail') { camera.yaw = 0.35; camera.pitch = 0.26; camera.distance = 8; }
    if (w16Capture === 'waterfront') { camera.yaw = 0; camera.pitch = 0.2; camera.distance = 10; }
    if (w16Capture === 'cityMountains') { camera.yaw = 0; camera.pitch = 0.18; camera.distance = 13; }
    if (w16Capture === 'cityStreet') { camera.yaw = 0.18; camera.pitch = 0.2; camera.distance = 11; }
    this.scene.activeCamera = camera.camera;
    const debug = new DebugOverlay(this.scene, this.engine, player, document.getElementById('debugContent')!, document.getElementById('debugOverlay')!, state, interaction);
    debug.setLightsaber(lightsaber);
    debug.setCombat(combat);
    debug.setPresentation(presentation);
    debug.setDefense(defense);
    debug.setShipSpatial(manager);
    debug.setCamera(camera);
    if (duel) debug.setDuel(duel);
    this.scene.onBeforeRenderObservable.add(() => {
      const deltaSeconds = Math.min(0.05, this.engine.getDeltaTime() / 1000);
      player.update(deltaSeconds);

      // Complete a requested retraction even after Aren becomes a follower.
      // This updates the blade/effects only; combat remains leader-owned.
      lightsaber.update(deltaSeconds);

      if (
        party.activeIsAren
      ) {
        presentation.update(
          deltaSeconds,
          lightsaber.currentState,
          combat.currentState,
        );

        // Final order for Aren:
        // animation/movement -> presentation -> saber combat.
        combat.update(
          deltaSeconds,
        );

        defense.update(
          deltaSeconds,
        );

        duel?.update(
          deltaSeconds,
        );

        weaponAttachment.finalizeCombatPose();

        weaponAttachment.updateArmDebug();
      } else {
        // Elyra W215 is fully controllable for exploration and keeps
        // her authored E-11 in the GLB. Blaster firing/AI combat is the
        // next isolated pass, so the Jedi-only saber stack is dormant.
        player.visualRoot.rotation.x =
          0;

        player.visualRoot.rotation.z =
          0;
      }

      naraJedi.update(
        deltaSeconds,
      );

      elyraBlaster.update(
        deltaSeconds,
      );

      party.update(
        deltaSeconds,
      );
      naraTestDummy?.update(deltaSeconds);
      if (naraDamageReadout) naraDamageReadout.textContent = `NARA TEST TARGET HP: ${naraTestDummy!.currentHealth} / 200`;

      if (trainingDummy) {
        trainingDummy.setEnabled(state.currentScene === 'nerathisExterior');
        trainingDummy.update(deltaSeconds);
      }
      interaction.update();

      // Keep the existing third-person camera solver as the authority,
      // then add W216.1's temporary shoulder composition on top.
      camera.update();

      elyraBlaster.applyCameraPostUpdate(
        deltaSeconds,
      );

      debug.update();
    });
    window.addEventListener('resize', () => this.engine.resize());
    this.engine.runRenderLoop(() => this.scene.render());
    if (w208aPerf) {
      window.setInterval(() => {
        const activeMeshes = this.scene.getActiveMeshes().data;
        const triangles = activeMeshes.reduce((sum, mesh) => sum + Math.floor(mesh.getTotalIndices() / 3), 0);
        const materials = new Set(activeMeshes.map((mesh) => mesh.material).filter(Boolean)).size;
        console.info(`[W2.0.8A] F3 OFF sample FPS=${this.engine.getFps().toFixed(1)} ACTIVE_MESHES=${activeMeshes.length} TRIS=${triangles} MATERIALS=${materials} TEXTURES=${this.scene.textures.length}`);
      }, 1000);
    }
    // Headless/browser capture routes are finite by design: after the scene
    // has settled, stop the render loop so Chromium can flush a PNG and exit.
    // Normal gameplay URLs never set w205Capture and remain continuous.
    if (w205Capture) window.setTimeout(() => this.engine.stopRenderLoop(), 3000);
    if (search.get('dialogue') === '1' || captureMode === 'dialogue') window.setTimeout(() => dialogue.openNara(), 700);
    if (captureMode === 'saber') window.setTimeout(() => void weaponAttachment.toggle(), 900);
    if (w17Capture === 'on' || w17Capture === 'front' || w17Capture === 'walk' || w17Capture === 'nerathis') window.setTimeout(() => void lightsaber.toggle(), 900);
    if (w20Duel) window.setTimeout(() => void lightsaber.toggle(), 700);
    if (w203Duel) window.setTimeout(() => void lightsaber.toggle(), 700);
    if (w203AttackFrame) {
      window.setTimeout(() => {
        if (w203AttackFrame === 'heavy') combat.requestDirectionalHeavy(AttackDirection.FORWARD);
        else combat.requestDirectionalLight(AttackDirection.FORWARD);
      }, 1250);
    }
    if (w205Capture === 'coverage') window.setTimeout(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F4' })), 900);
    if (w208bCapture === 'lightning' || w208bCapture === 'hero') window.setTimeout(() => manager.triggerSkyLightning(), 850);
    if (w209Capture === 'landingHero' || w209Capture === 'worldReveal' || w209Capture === 'hero' || w209Capture === 'sky') window.setTimeout(() => manager.triggerSkyLightning(), 900);
    if (w210Capture === 'landingHero' || w210Capture === 'worldReveal' || w210Capture === 'sky') window.setTimeout(() => manager.triggerSkyLightning(), 900);
    if (w206Capture === 'sky' || w206Capture === 'worldReveal' || w206Capture === 'spaceport') {
      camera.yaw = w206Capture === 'worldReveal' ? 1.0 : w206Capture === 'spaceport' ? 1.2 : 0.28;
      camera.pitch = w206Capture === 'sky' ? -0.08 : 0.08;
      camera.distance = w206Capture === 'worldReveal' ? 15 : w206Capture === 'sky' ? 18 : 12;
    }
    if (w206Capture === 'waterfront') { player.setPosition(new Vector3(0, 0, -55)); camera.yaw = 0.1; camera.pitch = 0.15; camera.distance = 11; }
    if (w206Capture === 'city') { player.setPosition(new Vector3(0, 0, -86)); camera.yaw = 0.12; camera.pitch = 0.16; camera.distance = 10; }
    if (w206Capture === 'cityMountains') { player.setPosition(new Vector3(0, 0, -86)); camera.yaw = 0.02; camera.pitch = 0.08; camera.distance = 20; }
    if (w206Capture === 'cantina') { player.setPosition(new Vector3(7, 0, -99)); camera.yaw = 0; camera.pitch = 0.2; camera.distance = 8; }
    if (w206Capture === 'ship') { camera.yaw = 0; camera.pitch = 0.16; camera.distance = 7; }
    if (w206Capture === 'nara') { camera.yaw = -0.42; camera.pitch = 0.2; camera.distance = 4.8; }
    if (w206Capture === 'shipExit') { camera.yaw = 0; camera.pitch = 0.16; camera.distance = 5.5; }
    if (w208bCapture === 'sky') { camera.yaw = 0.28; camera.pitch = -0.08; camera.distance = 18; }
    if (w208bCapture === 'planet_clouds') { camera.yaw = 0.34; camera.pitch = -0.03; camera.distance = 18; }
    if (w208bCapture === 'horizon' || w208bCapture === 'city_skyline') { camera.yaw = 0.12; camera.pitch = 0.08; camera.distance = 24; }
    if (w208bCapture === 'mountains') { camera.yaw = 0.42; camera.pitch = 0.07; camera.distance = 25; }
    if (w208bCapture === 'lightning') { camera.yaw = 0.26; camera.pitch = 0.02; camera.distance = 22; }
    if (w208bCapture === 'world_reveal' || w208bCapture === 'hero') { camera.yaw = 0.72; camera.pitch = 0.1; camera.distance = 26; }
    if (w209Capture === 'landingHero') { camera.yaw = -0.16; camera.pitch = 0.18; camera.distance = 22; }
    if (w209Capture === 'shipToCity') { camera.yaw = 0.12; camera.pitch = 0.16; camera.distance = 25; }
    if (w209Capture === 'waterfront') { player.setPosition(new Vector3(0, 0, -50)); camera.yaw = 0; camera.pitch = 0.055; camera.distance = 24; }
    if (w209Capture === 'cityDepth') { player.setPosition(new Vector3(0, 0, -52)); camera.yaw = 0; camera.pitch = 0.04; camera.distance = 27; }
    if (w209Capture === 'cliffs') { player.setPosition(new Vector3(0, 0, -70)); camera.yaw = 0; camera.pitch = -0.015; camera.distance = 30; }
    if (w209Capture === 'sky') { camera.yaw = 0.22; camera.pitch = -0.22; camera.distance = 22; }
    if (w209Capture === 'worldReveal') { camera.yaw = 0.12; camera.pitch = 0.18; camera.distance = 30; }
    if (w209Capture === 'hero') { camera.yaw = -0.16; camera.pitch = 0.18; camera.distance = 24; }
    if (w210Capture === 'shipExterior') { player.setPosition(manager.shipExteriorEntryWorldPosition.add(new Vector3(2.4, 0, 0))); camera.yaw = 1.05; camera.pitch = 0.18; camera.distance = 32; }
    if (w210Capture === 'shipEntry') { player.setPosition(manager.shipExteriorEntryWorldPosition.add(new Vector3(1.45, 0, 0))); camera.yaw = Math.PI * 0.5; camera.pitch = 0.2; camera.distance = 6.5; }
    if (w210Capture === 'shipInterior') { camera.yaw = manager.shipInteriorCameraYaw; camera.pitch = 0.2; camera.distance = 3.05; }
    if (w210Capture === 'worldReveal') { camera.yaw = 0.32; camera.pitch = 0.16; camera.distance = 30; }
    if (w210Capture === 'landingHero') { camera.yaw = 0.38; camera.pitch = 0.17; camera.distance = 27; }
    if (w210Capture === 'spaceport') { camera.yaw = 0.05; camera.pitch = 0.16; camera.distance = 26; }
    if (w210Capture === 'cityDepth') { player.setPosition(new Vector3(0, 0, -54)); camera.yaw = 0; camera.pitch = 0.07; camera.distance = 26; }
    if (w210Capture === 'cantinaExterior') { player.setPosition(new Vector3(7, 0, -99)); camera.yaw = 0; camera.pitch = 0.18; camera.distance = 8; }
    if (w210Capture === 'cantinaInterior') { camera.yaw = Math.PI; camera.pitch = 0.18; camera.distance = 3.7; }
    if (w210Capture === 'attackedZone') { player.setPosition(new Vector3(-18, 0, -97)); camera.yaw = 0; camera.pitch = 0.15; camera.distance = 14; }
    if (w210Capture === 'swampPath') { player.setPosition(new Vector3(-31, 0, -52)); camera.yaw = -0.1; camera.pitch = 0.13; camera.distance = 13; }
    if (w210Capture === 'sky') { player.setPosition(new Vector3(0, 0, 8)); camera.yaw = 0.18; camera.pitch = -0.19; camera.distance = 4; }
    // W226 staging-only capture presets. They do not change normal gameplay and
    // are gated by both DEV and the explicit W226 stage query.
    const w226View = import.meta.env.DEV && search.get('w226Stage') === '1' ? search.get('w226View') : null;
    const w226CaptureViews: Record<string, { position: Vector3; distance: number; yaw: number; pitch: number; fov?: number }> = {
      arrival: { position: new Vector3(-50, 0, 26), distance: 9, yaw: 0, pitch: 0.18 },
      docks: { position: new Vector3(-25, 0, 60), distance: 80, yaw: 0, pitch: 0.1, fov: 1.9 },
      overview: { position: new Vector3(0, 0, 80), distance: 140, yaw: 0, pitch: 0.12, fov: 1.9 },
      city: { position: new Vector3(0, 0, 68), distance: 34, yaw: 0, pitch: 0.22 },
    };
    const w226CaptureView = w226View ? w226CaptureViews[w226View] : undefined;
    if (w226CaptureView) {
      player.setPosition(w226CaptureView.position);
      camera.setExteriorDebugProfile(w226CaptureView.distance);
      camera.yaw = w226CaptureView.yaw; camera.pitch = w226CaptureView.pitch; camera.distance = w226CaptureView.distance;
      camera.camera.fov = w226CaptureView.fov ?? 1.05;
      document.getElementById('hud')?.style.setProperty('display', 'none');
      document.getElementById('tatooineWorldHud')?.style.setProperty('display', 'none');
    }
    if (w20Capture) {
      if (w20Capture === 'approach' || w20Capture === 'clash' || w20Capture === 'block' || w20Capture === 'parry') window.setTimeout(() => duelist?.startAI(), 950);
      if (w20Capture === 'body_hit') window.setTimeout(() => { duelist?.stopAI(); combat.requestDirectionalLight(AttackDirection.FORWARD); }, 1250);
      if (w20Capture === 'clash') window.setTimeout(() => combat.requestDirectionalLight(AttackDirection.FORWARD), 2200);
      if (w20Capture === 'block') window.setTimeout(() => defense.debugSetBlocking(), 1150);
      if (w20Capture === 'parry') window.setTimeout(() => defense.debugSetParryWindow(), 1150);
      if (w20Capture === 'stagger') window.setTimeout(() => duelist?.applyStagger('PARRY'), 1150);
      window.setTimeout(() => debug.show(), 1050);
    }
    if (w19Capture) {
      window.setTimeout(() => void lightsaber.toggle(), 650);
      const lightCapture: Record<string, AttackDirection> = {
        forward_attack: AttackDirection.FORWARD,
        left_attack: AttackDirection.LEFT,
        right_attack: AttackDirection.RIGHT,
        sweep_debug: AttackDirection.FORWARD,
        training_dummy_hit: AttackDirection.FORWARD,
      };
      const direction = lightCapture[w19Capture];
      if (direction) window.setTimeout(() => combat.requestDirectionalLight(direction), 1050);
      if (w19Capture === 'heavy_attack') window.setTimeout(() => combat.requestDirectionalHeavy(AttackDirection.FORWARD), 1050);
      if (w19Capture === 'sweep_debug') window.setTimeout(() => debug.show(), 1020);
    }
  }
}





