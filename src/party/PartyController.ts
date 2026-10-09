import {
  AnimationGroup,
  Observer,
  Scene,
  TransformNode,
  Vector3,
} from '@babylonjs/core';

import {
  AssetLoader,
  ImportedAsset,
} from '../assets/AssetLoader';

import {
  PlayerAnimationController,
  PlayerAnimationState,
} from '../player/PlayerAnimationController';

import {
  PlayerController,
} from '../player/PlayerController';

import {
  measureVisualBounds,
} from '../world/CharacterGrounding';

import {
  PartyCharacterId,
  partyRoster,
} from './PartyRoster';

const ELYRA_PARTY_ASSET_URL =
  '/assets/characters/lieutenant/lieutenant_blaster_v1.glb';

export const NARA_PARTY_ASSET_URL =
  '/assets/characters/nara/nara_voss_twilek_v1.glb';

const NARA_TARGET_HEIGHT =
  1.76;

const PARTY_LAYOUT_STORAGE_KEY =
  'nerathis.party.layout.v1';

const MAX_PARTY_SIZE =
  3;

type StoredPartyLayout = {
  active?: PartyCharacterId;
  companions?: PartyCharacterId[];
};

type PartyActor = {
  id: PartyCharacterId;
  label: string;
  asset: ImportedAsset;
  mount: TransformNode;
  followerRoot: TransformNode;
  localGroundOffset: Vector3;
  animator?: PlayerAnimationController;
  resetObserver?: Observer<Scene>;
  previousFollowerPosition: Vector3;
};

function isPartyCharacterId(
  value: unknown,
): value is PartyCharacterId {
  return (
    value === 'aren_vey' ||
    value === 'nara_voss' ||
    value === 'elyra_dane'
  );
}

function normalizeAngle(
  value: number,
) {
  return Math.atan2(
    Math.sin(value),
    Math.cos(value),
  );
}

export class PartyController {
  private readonly actors =
    new Map<
      PartyCharacterId,
      PartyActor
    >();

  private _activeId:
    PartyCharacterId =
      'aren_vey';

  private companionIds:
    PartyCharacterId[] = [];

  private initialized =
    false;

  private disposed =
    false;

  private activeClipOverride?:
    AnimationGroup;

  private activeClipOverrideActorId?:
    PartyCharacterId;

  private readonly recruitHandler =
    (
      event: Event,
    ) => {
      const custom =
        event as CustomEvent<{
          id?: PartyCharacterId;
        }>;

      const id =
        custom.detail?.id;

      if (
        !id ||
        !isPartyCharacterId(
          id,
        )
      ) {
        return;
      }

      void this.handleRecruitment(
        id,
      );
    };

  constructor(
    private readonly scene:
      Scene,

    private readonly loader:
      AssetLoader,

    private readonly player:
      PlayerController,

    private readonly arenVisual:
      ImportedAsset,
  ) {
    this.createArenActor();

    window.addEventListener(
      'nerathis:party-recruited',
      this.recruitHandler,
    );
  }

  async initialize() {
    await this.ensureRecruitedActors();

    this.restoreLayout();

    await this.ensureActor(
      this._activeId,
    );

    this.normalizeCompanions();

    this.applyLayout(
      true,
    );

    this.initialized =
      true;

    this.dispatchLayoutChanged();

    console.info(
      '[PARTY] W215 initialized',
      this.snapshot,
    );
  }

  update(
    deltaSeconds: number,
  ) {
    if (
      !this.initialized ||
      this.disposed
    ) {
      return;
    }

    this.updateActiveAnimation();

    const activePosition =
      this.player.position;

    const yaw =
      this.player.visualRoot
        .rotation.y;

    const forward =
      new Vector3(
        Math.sin(yaw),
        0,
        Math.cos(yaw),
      );

    const right =
      new Vector3(
        Math.cos(yaw),
        0,
        -Math.sin(yaw),
      );

    const companions =
      this.companionIds
        .map(
          (id) =>
            this.actors.get(
              id,
            ),
        )
        .filter(
          (
            actor,
          ): actor is PartyActor =>
            Boolean(actor),
        );

    companions.forEach(
      (
        actor,
        index,
      ) => {
        const side =
          index === 0
            ? 0.85
            : -0.85;

        const back =
          index === 0
            ? 1.55
            : 2.05;

        const target =
          activePosition
            .subtract(
              forward.scale(
                back,
              ),
            )
            .add(
              right.scale(
                side,
              ),
            );

        target.y =
          activePosition.y;

        const current =
          actor.followerRoot.position;

        const delta =
          target.subtract(
            current,
          );

        const distance =
          delta.length();

        actor.previousFollowerPosition.copyFrom(
          current,
        );

        if (
          distance > 8
        ) {
          current.copyFrom(
            target,
          );
        } else if (
          distance > 0.04
        ) {
          const speed =
            distance > 3.0
              ? 7.0
              : distance > 1.7
                ? 4.8
                : 3.0;

          const step =
            Math.min(
              distance,
              speed *
                deltaSeconds,
            );

          current.addInPlace(
            delta.normalizeToNew()
              .scale(
                step,
              ),
          );
        }

        const travelled =
          Vector3.Distance(
            actor.previousFollowerPosition,
            current,
          );

        if (
          travelled > 0.001
        ) {
          const direction =
            current.subtract(
              actor.previousFollowerPosition,
            );

          const targetYaw =
            Math.atan2(
              direction.x,
              direction.z,
            );

          const currentYaw =
            actor.followerRoot
              .rotation.y;

          const turn =
            normalizeAngle(
              targetYaw -
                currentYaw,
            );

          actor.followerRoot.rotation.y =
            currentYaw +
            turn *
              Math.min(
                1,
                deltaSeconds *
                  8,
              );
        }

        const followerSpeed =
          deltaSeconds > 0.0001
            ? travelled /
              deltaSeconds
            : 0;

        this.updateFollowerAnimation(
          actor,
          followerSpeed,
        );
      },
    );
  }

  async setActive(
    id: PartyCharacterId,
  ) {
    if (
      id === this._activeId ||
      !partyRoster.isRecruited(
        id,
      )
    ) {
      return;
    }

    await this.ensureActor(
      id,
    );

    this.clearActiveClipOverride();

    const previous =
      this._activeId;

    this._activeId =
      id;

    this.companionIds =
      this.companionIds.filter(
        (candidate) =>
          candidate !==
          id,
      );

    if (
      previous !== id &&
      partyRoster.isRecruited(
        previous,
      ) &&
      !this.companionIds.includes(
        previous,
      )
    ) {
      this.companionIds.unshift(
        previous,
      );
    }

    this.normalizeCompanions();

    this.player.clearCombatAnimation();

    this.player.visualRoot.rotation.x =
      0;

    this.player.visualRoot.rotation.z =
      0;

    this.applyLayout(
      true,
    );

    this.persistLayout();
    this.dispatchLayoutChanged();

    console.info(
      '[PARTY] active character',
      id,
      this.snapshot,
    );
  }

  async cycleActive() {
    const candidates =
      [
        this._activeId,
        ...this.companionIds,
      ].filter(
        (
          value,
          index,
          values,
        ) =>
          values.indexOf(
            value,
          ) ===
          index,
      );

    if (
      candidates.length <
      2
    ) {
      return;
    }

    const currentIndex =
      candidates.indexOf(
        this._activeId,
      );

    const next =
      candidates[
        (
          currentIndex +
          1
        ) %
        candidates.length
      ];

    await this.setActive(
      next,
    );
  }

  toggleCompanion(
    id: PartyCharacterId,
  ) {
    if (
      id === this._activeId ||
      !partyRoster.isRecruited(
        id,
      )
    ) {
      return;
    }

    const existing =
      this.companionIds.indexOf(
        id,
      );

    if (
      existing >= 0
    ) {
      this.companionIds.splice(
        existing,
        1,
      );
    } else {
      if (
        this.companionIds.length >=
        MAX_PARTY_SIZE - 1
      ) {
        this.companionIds.pop();
      }

      this.companionIds.push(
        id,
      );
    }

    this.normalizeCompanions();
    this.applyLayout(
      true,
    );
    this.persistLayout();
    this.dispatchLayoutChanged();
  }

  isCompanion(
    id: PartyCharacterId,
  ) {
    return this.companionIds.includes(
      id,
    );
  }

  get activeId() {
    return this._activeId;
  }

  get activeIsAren() {
    return (
      this._activeId ===
      'aren_vey'
    );
  }

  get activeIsNara() {
    return (
      this._activeId ===
      'nara_voss'
    );
  }

  get activeIsJedi() {
    return (
      this._activeId === 'aren_vey' ||
      this._activeId === 'nara_voss'
    );
  }

  get companions() {
    return [
      ...this.companionIds,
    ];
  }

  get recruited() {
    return partyRoster.list();
  }

  get snapshot() {
    return {
      active:
        this._activeId,

      companions:
        this.companions,

      recruited:
        this.recruited,
    };
  }

  getActorAsset(
    id: PartyCharacterId,
  ) {
    return this.actors.get(
      id,
    )?.asset;
  }

  playActiveClipOverride(
    name: string,
    loop = true,
    speedRatio = 1,
  ) {
    const actor =
      this.actors.get(
        this._activeId,
      );

    if (!actor) {
      return false;
    }

    const group =
      actor.asset.animationGroups.find(
        (candidate) =>
          candidate.name.trim().toLowerCase() ===
          name.trim().toLowerCase(),
      );

    if (!group) {
      console.warn(
        '[PARTY] active clip override not found',
        {
          actor:
            this._activeId,
          requested:
            name,
          available:
            actor.asset.animationGroups.map(
              (candidate) =>
                candidate.name,
            ),
        },
      );

      return false;
    }

    actor.asset.animationGroups.forEach(
      (candidate) =>
        candidate.stop(),
    );

    group.start(
      loop,
      speedRatio,
      group.from,
      group.to,
    );

    this.activeClipOverride =
      group;

    this.activeClipOverrideActorId =
      this._activeId;

    return true;
  }

  clearActiveClipOverride() {
    this.activeClipOverride?.stop();

    const actor =
      this.activeClipOverrideActorId
        ? this.actors.get(
            this.activeClipOverrideActorId,
          )
        : undefined;

    this.activeClipOverride =
      undefined;

    this.activeClipOverrideActorId =
      undefined;

    actor?.animator?.setState(
      this.player.animationState,
    );
  }

  dispose() {
    if (
      this.disposed
    ) {
      return;
    }

    this.disposed =
      true;

    this.clearActiveClipOverride();

    window.removeEventListener(
      'nerathis:party-recruited',
      this.recruitHandler,
    );

    for (
      const actor
      of this.actors.values()
    ) {
      if (
        actor.id !==
        'aren_vey'
      ) {
        if (
          actor.resetObserver
        ) {
          this.scene
            .onAfterAnimationsObservable
            .remove(
              actor.resetObserver,
            );
        }

        actor.asset.dispose();
      }

      actor.mount.dispose();
      actor.followerRoot.dispose();
    }

    this.actors.clear();
  }

  private createArenActor() {
    const oldPosition =
      this.player.visualRoot
        .position.clone();

    const oldScaling =
      this.player.visualRoot
        .scaling.clone();

    const mount =
      new TransformNode(
        'PartyMount_ArenVey',
        this.scene,
      );

    mount.parent =
      this.player.visualRoot;

    mount.position.copyFrom(
      oldPosition,
    );

    mount.scaling.copyFrom(
      oldScaling,
    );

    this.arenVisual.root.parent =
      mount;

    this.player.visualRoot.position.set(
      0,
      0,
      0,
    );

    this.player.visualRoot.scaling.set(
      1,
      1,
      1,
    );

    const followerRoot =
      new TransformNode(
        'PartyFollower_ArenVey',
        this.scene,
      );

    followerRoot.position.copyFrom(
      this.player.position,
    );

    const actor:
      PartyActor = {
        id:
          'aren_vey',

        label:
          'Aren Vey',

        asset:
          this.arenVisual,

        mount,

        followerRoot,

        localGroundOffset:
          mount.position.clone(),

        previousFollowerPosition:
          followerRoot.position.clone(),
      };

    this.actors.set(
      actor.id,
      actor,
    );
  }

  private async ensureRecruitedActors() {
    for (
      const id
      of partyRoster.list()
    ) {
      await this.ensureActor(
        id,
      );
    }
  }

  private async ensureActor(
    id: PartyCharacterId,
  ) {
    const existing =
      this.actors.get(
        id,
      );

    if (existing) {
      return existing;
    }

    if (id === 'nara_voss') {
      return this.createNaraActor();
    }

    if (id === 'elyra_dane') {
      return this.createElyraActor();
    }

    throw new Error(
      `No party actor definition for ${id}`,
    );
  }

  private async createNaraActor() {
    const asset =
      await this.loader.load(
        NARA_PARTY_ASSET_URL,
        this.scene,
      );

    asset.animationGroups.forEach(
      (group) => group.stop(),
    );

    asset.meshes.forEach(
      (mesh) => {
        mesh.isPickable = false;
        mesh.metadata = {
          ...(mesh.metadata ?? {}),
          coverageExclude: true,
          actor: 'PARTY_NARA_VOSS',
          partyMember: true,
        };
      },
    );

    const followerRoot =
      new TransformNode(
        'PartyFollower_NaraVoss',
        this.scene,
      );

    const mount =
      new TransformNode(
        'PartyMount_NaraVoss',
        this.scene,
      );

    mount.parent = followerRoot;
    asset.root.parent = mount;
    asset.root.position.set(0, 0, 0);
    asset.root.rotation.set(0, 0, 0);
    asset.root.scaling.setAll(1);

    const sourceHeight =
      measureVisualBounds(
        asset.meshes,
      ).height;

    const scale =
      sourceHeight > 0.001
        ? NARA_TARGET_HEIGHT /
          sourceHeight
        : 1;

    mount.position.set(
      0,
      0.02,
      0,
    );

    mount.scaling.setAll(
      scale,
    );

    followerRoot.position.copyFrom(
      this.player.position,
    );

    const animator =
      new PlayerAnimationController(
        asset.animationGroups,
      );

    animator.setState(
      'IDLE',
    );

    const resetObserver =
      this.scene
        .onAfterAnimationsObservable
        .add(
          () =>
            asset.resetAnimatedRoots(),
        );

    const actor: PartyActor = {
      id: 'nara_voss',
      label: 'Maestra Nara Voss',
      asset,
      mount,
      followerRoot,
      localGroundOffset:
        mount.position.clone(),
      animator,
      resetObserver,
      previousFollowerPosition:
        followerRoot.position.clone(),
    };

    this.actors.set(
      actor.id,
      actor,
    );

    console.info(
      '[PARTY] Nara actor ready',
      {
        scale,
        sourceHeight,
        animations:
          asset.animationGroups.map(
            (group) => group.name,
          ),
      },
    );

    return actor;
  }

  private async createElyraActor() {
    const asset =
      await this.loader.load(
        ELYRA_PARTY_ASSET_URL,
        this.scene,
      );

    asset.animationGroups.forEach(
      (group) =>
        group.stop(),
    );

    asset.meshes.forEach(
      (mesh) => {
        mesh.isPickable = false;

        mesh.metadata = {
          ...(mesh.metadata ?? {}),

          coverageExclude:
            true,

          actor:
            'PARTY_ELYRA_DANE',

          partyMember:
            true,
        };
      },
    );

    const followerRoot =
      new TransformNode(
        'PartyFollower_ElyraDane',
        this.scene,
      );

    const mount =
      new TransformNode(
        'PartyMount_ElyraDane',
        this.scene,
      );

    mount.parent =
      followerRoot;

    asset.root.parent =
      mount;

    asset.root.position.set(
      0,
      0,
      0,
    );

    asset.root.rotation.set(
      0,
      0,
      0,
    );

    asset.root.scaling.setAll(
      1,
    );

    // W212 exports Elyra normalized to 1.72 m with the feet at Y=0.
    // Keep that authored size; the gameplay capsule remains owned by
    // PlayerController and is intentionally not character-specific yet.
    mount.position.set(
      0,
      0.02,
      0,
    );

    mount.scaling.setAll(
      1,
    );

    followerRoot.position.copyFrom(
      this.player.position,
    );

    const animator =
      new PlayerAnimationController(
        asset.animationGroups,
      );

    animator.setState(
      'IDLE',
    );

    const resetObserver =
      this.scene
        .onAfterAnimationsObservable
        .add(
          () =>
            asset.resetAnimatedRoots(),
        );

    const actor:
      PartyActor = {
        id:
          'elyra_dane',

        label:
          'Teniente Elyra Dane',

        asset,

        mount,

        followerRoot,

        localGroundOffset:
          mount.position.clone(),

        animator,

        resetObserver,

        previousFollowerPosition:
          followerRoot.position.clone(),
      };

    this.actors.set(
      actor.id,
      actor,
    );

    return actor;
  }

  private async handleRecruitment(
    id: PartyCharacterId,
  ) {
    await this.ensureActor(
      id,
    );

    if (
      id !== this._activeId &&
      !this.companionIds.includes(
        id,
      )
    ) {
      if (
        this.companionIds.length <
        MAX_PARTY_SIZE - 1
      ) {
        this.companionIds.push(
          id,
        );
      }
    }

    this.normalizeCompanions();

    this.applyLayout(
      true,
    );

    this.persistLayout();
    this.dispatchLayoutChanged();
  }

  private applyLayout(
    snapFollowers: boolean,
  ) {
    const recruited =
      new Set(
        partyRoster.list(),
      );

    for (
      const actor
      of this.actors.values()
    ) {
      const isActive =
        actor.id ===
        this._activeId;

      const isCompanion =
        this.companionIds.includes(
          actor.id,
        );

      const enabled =
        recruited.has(
          actor.id,
        ) &&
        (
          isActive ||
          isCompanion
        );

      actor.mount.setEnabled(
        enabled,
      );

      if (
        !enabled
      ) {
        continue;
      }

      if (
        isActive
      ) {
        actor.mount.parent =
          this.player.visualRoot;

        actor.mount.position.copyFrom(
          actor.localGroundOffset,
        );

        actor.mount.rotation.set(
          0,
          0,
          0,
        );
      } else {
        actor.mount.parent =
          actor.followerRoot;

        actor.mount.position.copyFrom(
          actor.localGroundOffset,
        );

        actor.mount.rotation.set(
          0,
          0,
          0,
        );

        if (
          snapFollowers
        ) {
          const index =
            this.companionIds.indexOf(
              actor.id,
            );

          const yaw =
            this.player.visualRoot
              .rotation.y;

          const forward =
            new Vector3(
              Math.sin(yaw),
              0,
              Math.cos(yaw),
            );

          const right =
            new Vector3(
              Math.cos(yaw),
              0,
              -Math.sin(yaw),
            );

          const side =
            index === 0
              ? 0.85
              : -0.85;

          const back =
            index === 0
              ? 1.55
              : 2.05;

          actor.followerRoot.position.copyFrom(
            this.player.position
              .subtract(
                forward.scale(
                  back,
                ),
              )
              .add(
                right.scale(
                  side,
                ),
              ),
          );

          actor.followerRoot.position.y =
            this.player.position.y;

          actor.followerRoot.rotation.y =
            yaw;

          actor.previousFollowerPosition.copyFrom(
            actor.followerRoot.position,
          );
        }
      }
    }
  }

  private updateActiveAnimation() {
    const active =
      this.actors.get(
        this._activeId,
      );

    if (
      !active?.animator
    ) {
      return;
    }

    if (
      this.activeClipOverride &&
      this.activeClipOverrideActorId ===
        this._activeId
    ) {
      return;
    }

    active.animator.setLocomotionState(
      this.player
        .detailedLocomotionState,

      this.player
        .horizontalSpeed,
    );
  }

  private updateFollowerAnimation(
    actor: PartyActor,
    speed: number,
  ) {
    if (
      !actor.animator
    ) {
      return;
    }

    const state:
      PlayerAnimationState =
        speed > 4.8
          ? 'RUN'
          : speed > 0.18
            ? 'WALK'
            : 'IDLE';

    actor.animator.setState(
      state,
    );
  }

  private normalizeCompanions() {
    const recruited =
      partyRoster.list();

    this.companionIds =
      this.companionIds.filter(
        (
          id,
          index,
          values,
        ) =>
          id !==
            this._activeId &&
          recruited.includes(
            id,
          ) &&
          values.indexOf(
            id,
          ) ===
            index,
      );

    for (
      const id
      of recruited
    ) {
      if (
        id ===
          this._activeId ||
        this.companionIds.includes(
          id,
        )
      ) {
        continue;
      }

      if (
        this.companionIds.length >=
        MAX_PARTY_SIZE - 1
      ) {
        break;
      }

      this.companionIds.push(
        id,
      );
    }

    this.companionIds =
      this.companionIds.slice(
        0,
        MAX_PARTY_SIZE - 1,
      );
  }

  private restoreLayout() {
    try {
      const raw =
        window.localStorage.getItem(
          PARTY_LAYOUT_STORAGE_KEY,
        );

      if (!raw) {
        this._activeId =
          'aren_vey';

        this.companionIds =
          [];

        return;
      }

      const parsed =
        JSON.parse(
          raw,
        ) as StoredPartyLayout;

      if (
        parsed.active &&
        isPartyCharacterId(
          parsed.active,
        ) &&
        partyRoster.isRecruited(
          parsed.active,
        )
      ) {
        this._activeId =
          parsed.active;
      }

      this.companionIds =
        (
          parsed.companions ??
          []
        ).filter(
          (
            value,
          ): value is PartyCharacterId =>
            isPartyCharacterId(
              value,
            ) &&
            partyRoster.isRecruited(
              value,
            ),
        );
    } catch (error) {
      console.warn(
        '[PARTY] Could not restore party layout',
        error,
      );

      this._activeId =
        'aren_vey';

      this.companionIds =
        [];
    }
  }

  private persistLayout() {
    try {
      const payload:
        StoredPartyLayout = {
          active:
            this._activeId,

          companions:
            this.companionIds,
        };

      window.localStorage.setItem(
        PARTY_LAYOUT_STORAGE_KEY,
        JSON.stringify(
          payload,
        ),
      );
    } catch (error) {
      console.warn(
        '[PARTY] Could not persist party layout',
        error,
      );
    }
  }

  private dispatchLayoutChanged() {
    window.dispatchEvent(
      new CustomEvent(
        'nerathis:party-layout-changed',
        {
          detail:
            this.snapshot,
        },
      ),
    );
  }
}
