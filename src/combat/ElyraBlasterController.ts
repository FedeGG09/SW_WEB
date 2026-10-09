import {
  Color3,
  Mesh,
  MeshBuilder,
  PickingInfo,
  PointLight,
  Ray,
  Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
} from '@babylonjs/core';

import { PlayerController } from '../player/PlayerController';
import { ThirdPersonCamera } from '../player/ThirdPersonCamera';
import { PartyController } from '../party/PartyController';

const MAX_RANGE = 75;
const SHOT_COOLDOWN_MS = 220;
const AIM_CLIP = 'aim_forward';

const AIM_CAMERA_SHOULDER = 0.82;
const AIM_CAMERA_FORWARD = 1.45;
const AIM_CAMERA_UP = 0.10;
const AIM_CAMERA_BLEND_SPEED = 11.5;

const BOLT_SPEED = 82;
const BOLT_LENGTH = 0.92;

const HUD_STYLE_ID = 'elyraBlasterHudStyle';
const HUD_ID = 'elyraBlasterHud';

function modalUiOpen() {
  const ids = [
    'nerathisPartyPauseMenu',
    'elyraRecruitmentDialogueOverlay',
    'dialogueOverlay',
  ];

  return ids.some((id) => {
    const element =
      document.getElementById(id);

    if (!element) {
      return false;
    }

    if (
      element.hidden ||
      element.classList.contains('is-hidden')
    ) {
      return false;
    }

    return (
      window.getComputedStyle(element).display !==
      'none'
    );
  });
}

function ensureHudStyles() {
  if (
    document.getElementById(HUD_STYLE_ID)
  ) {
    return;
  }

  const style =
    document.createElement('style');

  style.id =
    HUD_STYLE_ID;

  style.textContent = `
    #${HUD_ID} {
      position: fixed;
      inset: 0;
      z-index: 8000;
      pointer-events: none;
      font-family:
        "IBM Plex Mono",
        Consolas,
        monospace;
    }

    #${HUD_ID}[hidden] {
      display: none;
    }

    #${HUD_ID} .elyra-blaster-hint {
      position: absolute;
      left: 50%;
      bottom: 28px;
      transform: translateX(-50%);
      padding: 8px 13px;
      border: 1px solid rgba(118, 222, 239, 0.34);
      border-radius: 8px;
      background: rgba(4, 14, 19, 0.78);
      color: #bceef6;
      font-size: 11px;
      letter-spacing: 0.08em;
      white-space: nowrap;
      transition:
        opacity 120ms ease,
        transform 120ms ease;
    }

    #${HUD_ID}.is-aiming .elyra-blaster-hint {
      opacity: 0.56;
      transform:
        translateX(-50%)
        translateY(4px);
    }

    #${HUD_ID} .elyra-blaster-crosshair {
      position: absolute;
      left: 50%;
      top: 50%;
      width: 26px;
      height: 26px;
      transform:
        translate(-50%, -50%)
        scale(0.88);
      opacity: 0;
      transition:
        opacity 90ms ease,
        transform 90ms ease;
    }

    #${HUD_ID}.is-aiming .elyra-blaster-crosshair {
      opacity: 1;
      transform:
        translate(-50%, -50%)
        scale(1);
    }

    #${HUD_ID}.is-recoiling .elyra-blaster-crosshair {
      transform:
        translate(-50%, -53%)
        scale(1.08);
    }

    #${HUD_ID} .elyra-blaster-crosshair::before,
    #${HUD_ID} .elyra-blaster-crosshair::after {
      content: "";
      position: absolute;
      left: 50%;
      top: 50%;
      background: rgba(255, 74, 48, 0.96);
      box-shadow:
        0 0 7px rgba(255, 65, 40, 0.96),
        0 0 14px rgba(255, 52, 28, 0.42);
      transform: translate(-50%, -50%);
    }

    #${HUD_ID} .elyra-blaster-crosshair::before {
      width: 22px;
      height: 1px;
    }

    #${HUD_ID} .elyra-blaster-crosshair::after {
      width: 1px;
      height: 22px;
    }

    #${HUD_ID} .elyra-blaster-crosshair-dot {
      position: absolute;
      left: 50%;
      top: 50%;
      width: 4px;
      height: 4px;
      border-radius: 999px;
      background: #fff3ef;
      box-shadow:
        0 0 7px rgba(255, 85, 58, 1),
        0 0 12px rgba(255, 55, 32, 0.78);
      transform: translate(-50%, -50%);
    }
  `;

  document.head.appendChild(style);
}

export class ElyraBlasterController {
  private readonly hud:
    HTMLDivElement;

  private aiming =
    false;

  private aimBlend =
    0;

  private recoilKick =
    0;

  private lastShotAt =
    -Infinity;

  private rightHandTransform?:
    TransformNode;

  private cachedPartyAssetId =
    '';

  private disposed =
    false;

  private readonly pointerDownHandler =
    (event: PointerEvent) => {
      if (
        !this.isElyraControlled()
      ) {
        return;
      }

      const target =
        event.target as
          HTMLElement |
          null;

      if (
        target?.closest(
          'button, input, textarea, #nerathisPartyPauseMenu, #elyraRecruitmentDialogueOverlay, #dialogueOverlay',
        ) ||
        modalUiOpen()
      ) {
        return;
      }

      if (
        event.button === 2
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();

        this.setAiming(true);
        return;
      }

      if (
        event.button === 0
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();

        if (
          this.aiming
        ) {
          this.fire();
        }
      }
    };

  private readonly pointerUpHandler =
    (event: PointerEvent) => {
      if (
        event.button !== 2 ||
        !this.aiming
      ) {
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();

      this.setAiming(false);
    };

  private readonly contextMenuHandler =
    (event: MouseEvent) => {
      if (
        this.isElyraControlled()
      ) {
        event.preventDefault();
      }
    };

  private readonly partyLayoutHandler =
    () => {
      if (
        !this.isElyraControlled()
      ) {
        this.setAiming(false);
      }

      this.updateHudVisibility();
      this.resolveRightHandTransform(true);
    };

  constructor(
    private readonly scene:
      Scene,

    private readonly player:
      PlayerController,

    private readonly camera:
      ThirdPersonCamera,

    private readonly party:
      PartyController,
  ) {
    ensureHudStyles();

    document.getElementById(
      HUD_ID,
    )?.remove();

    this.hud =
      document.createElement('div');

    this.hud.id =
      HUD_ID;

    this.hud.innerHTML = `
      <div class="elyra-blaster-crosshair">
        <div class="elyra-blaster-crosshair-dot"></div>
      </div>

      <div class="elyra-blaster-hint">
        RMB APUNTAR · LMB DISPARAR · E-11
      </div>
    `;

    document.body.appendChild(
      this.hud,
    );

    window.addEventListener(
      'pointerdown',
      this.pointerDownHandler,
      true,
    );

    window.addEventListener(
      'pointerup',
      this.pointerUpHandler,
      true,
    );

    window.addEventListener(
      'pointercancel',
      this.pointerUpHandler,
      true,
    );

    window.addEventListener(
      'contextmenu',
      this.contextMenuHandler,
      true,
    );

    window.addEventListener(
      'nerathis:party-layout-changed',
      this.partyLayoutHandler,
    );

    window.addEventListener(
      'nerathis:party-recruited',
      this.partyLayoutHandler,
    );

    this.updateHudVisibility();
  }

  /**
   * Gameplay-side update.
   *
   * Camera shoulder composition is deliberately applied in
   * applyCameraPostUpdate(), AFTER ThirdPersonCamera.update().
   * This keeps the existing camera solver untouched.
   */
  update(
    deltaSeconds: number,
  ) {
    if (
      this.disposed
    ) {
      return;
    }

    this.recoilKick =
      Math.max(
        0,
        this.recoilKick -
          deltaSeconds * 6.8,
      );

    this.hud.classList.toggle(
      'is-recoiling',
      this.recoilKick > 0.20,
    );

    if (
      !this.isElyraControlled()
    ) {
      if (
        this.aiming
      ) {
        this.setAiming(false);
      }

      return;
    }

    if (
      modalUiOpen() &&
      this.aiming
    ) {
      this.setAiming(false);
      return;
    }

    if (
      !this.aiming
    ) {
      return;
    }

    const ray =
      this.camera.camera
        .getForwardRay(
          MAX_RANGE,
        );

    this.player.setFacingYaw(
      Math.atan2(
        ray.direction.x,
        ray.direction.z,
      ),
    );

    // Small full-body kick on every E-11 shot.
    // Game.ts resets X/Z each frame before this controller runs,
    // so recoil never accumulates permanently.
    this.player.visualRoot.rotation.x =
      -0.032 *
      this.recoilKick;

    this.player.visualRoot.rotation.z =
      0.009 *
      this.recoilKick;
  }

  /**
   * W216.1 shoulder camera pass.
   *
   * Call this immediately AFTER ThirdPersonCamera.update().
   * We do not change ThirdPersonCamera.ts and we do not create a second camera.
   */
  applyCameraPostUpdate(
    deltaSeconds: number,
  ) {
    if (
      this.disposed
    ) {
      return;
    }

    const targetBlend =
      this.aiming &&
      this.isElyraControlled() &&
      !modalUiOpen()
        ? 1
        : 0;

    const blend =
      Math.min(
        1,
        deltaSeconds *
          AIM_CAMERA_BLEND_SPEED,
      );

    this.aimBlend +=
      (
        targetBlend -
        this.aimBlend
      ) *
      blend;

    if (
      this.aimBlend < 0.001 &&
      this.recoilKick < 0.001
    ) {
      this.aimBlend =
        0;

      return;
    }

    const camera =
      this.camera.camera;

    const forward =
      camera
        .getForwardRay(1)
        .direction
        .normalize();

    let right =
      Vector3.Cross(
        Vector3.Up(),
        forward,
      );

    if (
      right.lengthSquared() <
      0.0001
    ) {
      right =
        new Vector3(
          1,
          0,
          0,
        );
    } else {
      right.normalize();
    }

    const up =
      Vector3.Up();

    // Camera goes to Elyra's right side, which puts Elyra on the
    // left third of the screen and leaves the reticle unobstructed.
    const shoulderShift =
      right.scale(
        AIM_CAMERA_SHOULDER *
        this.aimBlend,
      );

    // Move closer without changing the base yaw/pitch solver.
    const forwardShift =
      forward.scale(
        AIM_CAMERA_FORWARD *
        this.aimBlend,
      );

    const upShift =
      up.scale(
        AIM_CAMERA_UP *
        this.aimBlend,
      );

    // Tiny physical camera recoil.
    const recoilBack =
      forward.scale(
        -0.065 *
        this.recoilKick,
      );

    camera.position.addInPlace(
      shoulderShift
        .add(
          forwardShift,
        )
        .add(
          upShift,
        )
        .add(
          recoilBack,
        ),
    );

    // Preserve the underlying camera direction, then add a very small
    // vertical kick. This makes the shot feel physical without causing
    // camera drift because ThirdPersonCamera rebuilds the base next frame.
    const target =
      camera.position
        .add(
          forward.scale(
            100,
          ),
        )
        .add(
          up.scale(
            0.15 *
            this.recoilKick,
          ),
        );

    camera.setTarget(
      target,
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

    this.setAiming(false);

    window.removeEventListener(
      'pointerdown',
      this.pointerDownHandler,
      true,
    );

    window.removeEventListener(
      'pointerup',
      this.pointerUpHandler,
      true,
    );

    window.removeEventListener(
      'pointercancel',
      this.pointerUpHandler,
      true,
    );

    window.removeEventListener(
      'contextmenu',
      this.contextMenuHandler,
      true,
    );

    window.removeEventListener(
      'nerathis:party-layout-changed',
      this.partyLayoutHandler,
    );

    window.removeEventListener(
      'nerathis:party-recruited',
      this.partyLayoutHandler,
    );

    this.hud.remove();
  }

  private isElyraControlled() {
    return (
      this.party.activeId ===
      'elyra_dane'
    );
  }

  private setAiming(
    next: boolean,
  ) {
    if (
      this.aiming ===
      next
    ) {
      return;
    }

    if (
      next &&
      (
        !this.isElyraControlled() ||
        modalUiOpen()
      )
    ) {
      return;
    }

    this.aiming =
      next;

    this.hud.classList.toggle(
      'is-aiming',
      this.aiming,
    );

    if (
      this.aiming
    ) {
      this.player.setActionLocked(
        true,
      );

      const started =
        this.party.playActiveClipOverride(
          AIM_CLIP,
          true,
          1,
        );

      if (
        !started
      ) {
        console.warn(
          '[ELYRA E11] aim_forward was not available',
        );
      }

      this.resolveRightHandTransform(
        true,
      );

      return;
    }

    this.party.clearActiveClipOverride();

    this.player.visualRoot.rotation.x =
      0;

    this.player.visualRoot.rotation.z =
      0;

    this.recoilKick =
      0;

    this.hud.classList.remove(
      'is-recoiling',
    );

    if (
      !modalUiOpen()
    ) {
      this.player.setActionLocked(
        false,
      );
    }
  }

  private fire() {
    if (
      !this.aiming ||
      !this.isElyraControlled()
    ) {
      return;
    }

    const now =
      performance.now();

    if (
      now -
        this.lastShotAt <
      SHOT_COOLDOWN_MS
    ) {
      return;
    }

    this.lastShotAt =
      now;

    // Kick both camera and body.
    this.recoilKick =
      Math.min(
        1.35,
        this.recoilKick +
          0.92,
      );

    const ray =
      this.camera.camera
        .getForwardRay(
          MAX_RANGE,
        );

    const pick =
      this.pickShot(
        ray,
      );

    const rayEnd =
      ray.origin.add(
        ray.direction.scale(
          MAX_RANGE,
        ),
      );

    const hitPoint =
      pick?.hit &&
      pick.pickedPoint
        ? pick.pickedPoint.clone()
        : rayEnd;

    const muzzle =
      this.getMuzzlePosition(
        hitPoint,
      );

    this.spawnMuzzleFlash(
      muzzle,
    );

    this.spawnTravelingBolt(
      muzzle,
      hitPoint,
    );

    if (
      pick?.hit &&
      pick.pickedPoint
    ) {
      this.spawnImpact(
        pick.pickedPoint,
      );
    }

    window.dispatchEvent(
      new CustomEvent(
        'nerathis:elyra-blaster-shot',
        {
          detail: {
            source:
              'elyra_dane',

            origin:
              muzzle.asArray(),

            destination:
              hitPoint.asArray(),

            hit:
              Boolean(
                pick?.hit,
              ),

            meshName:
              pick?.pickedMesh
                ?.name ??
              null,
          },
        },
      ),
    );

    console.info(
      '[ELYRA E11] shot',
      {
        hit:
          Boolean(
            pick?.hit,
          ),

        mesh:
          pick?.pickedMesh
            ?.name ??
          'NONE',

        distance:
          Vector3.Distance(
            muzzle,
            hitPoint,
          ).toFixed(2),
      },
    );
  }

  /**
   * Scene meshes in Nerathis are often intentionally isPickable=false.
   * For blaster fire we therefore intersect visible geometry directly
   * instead of depending on UI picking flags.
   */
  private pickShot(
    ray: Ray,
  ) {
    let best:
      PickingInfo |
      undefined;

    for (
      const mesh
      of this.scene.meshes
    ) {
      if (
        !mesh.isEnabled() ||
        !mesh.isVisible ||
        mesh.visibility <=
          0.01
      ) {
        continue;
      }

      if (
        /^ElyraE11_/i.test(
          mesh.name,
        ) ||
        /GameplayBody|PlayerContactShadow/i.test(
          mesh.name,
        )
      ) {
        continue;
      }

      const metadata =
        mesh.metadata as
          Record<
            string,
            unknown
          > |
          null;

      if (
        metadata?.partyMember ===
          true ||
        metadata?.actor ===
          'PLAYER' ||
        metadata?.actor ===
          'PARTY_ELYRA_DANE' ||
        metadata?.actor ===
          'SABER'
      ) {
        continue;
      }

      const pick =
        ray.intersectsMesh(
          mesh,
          false,
        );

      if (
        !pick.hit ||
        !pick.pickedPoint ||
        pick.distance <
          0.30 ||
        pick.distance >
          MAX_RANGE
      ) {
        continue;
      }

      if (
        !best ||
        pick.distance <
          best.distance
      ) {
        best =
          pick;
      }
    }

    return best;
  }

  private getMuzzlePosition(
    target:
      Vector3,
  ) {
    const hand =
      this.resolveRightHandTransform();

    const origin =
      hand
        ? hand
            .getAbsolutePosition()
            .clone()
        : this.player.position.add(
            new Vector3(
              0,
              1.22,
              0,
            ),
          );

    const direction =
      target.subtract(
        origin,
      );

    if (
      direction.lengthSquared() <
      0.0001
    ) {
      return origin;
    }

    direction.normalize();

    // Final E-11 is ~0.53 m. Start the bolt near the visible muzzle
    // without changing the authored GLB.
    return origin
      .add(
        direction.scale(
          0.42,
        ),
      )
      .add(
        new Vector3(
          0,
          0.015,
          0,
        ),
      );
  }

  private resolveRightHandTransform(
    force = false,
  ) {
    const asset =
      this.party.getActorAsset(
        'elyra_dane',
      );

    if (
      !asset
    ) {
      this.rightHandTransform =
        undefined;

      this.cachedPartyAssetId =
        '';

      return undefined;
    }

    const assetId =
      asset.root.name;

    if (
      !force &&
      this.cachedPartyAssetId ===
        assetId &&
      this.rightHandTransform
    ) {
      return this.rightHandTransform;
    }

    this.cachedPartyAssetId =
      assetId;

    this.rightHandTransform =
      undefined;

    for (
      const mesh
      of asset.meshes
    ) {
      if (
        !(mesh instanceof Mesh) ||
        !mesh.skeleton
      ) {
        continue;
      }

      const bone =
        mesh.skeleton.bones.find(
          (candidate) =>
            /right.?hand/i.test(
              candidate.name,
            ),
        );

      const transform =
        bone?.getTransformNode();

      if (
        transform
      ) {
        this.rightHandTransform =
          transform;

        break;
      }
    }

    return this.rightHandTransform;
  }

  private spawnMuzzleFlash(
    position:
      Vector3,
  ) {
    const flash =
      MeshBuilder.CreateSphere(
        'ElyraE11_MuzzleFlash',
        {
          diameter:
            0.12,

          segments:
            6,
        },
        this.scene,
      );

    flash.position.copyFrom(
      position,
    );

    flash.isPickable =
      false;

    const material =
      new StandardMaterial(
        'ElyraE11_MuzzleFlashMaterial',
        this.scene,
      );

    material.disableLighting =
      true;

    material.diffuseColor =
      new Color3(
        1,
        0.055,
        0.018,
      );

    material.emissiveColor =
      new Color3(
        1,
        0.18,
        0.045,
      );

    flash.material =
      material;

    const light =
      new PointLight(
        'ElyraE11_MuzzleLight',
        position,
        this.scene,
      );

    light.diffuse =
      new Color3(
        1,
        0.12,
        0.025,
      );

    light.intensity =
      2.7;

    light.range =
      4.4;

    window.setTimeout(
      () => {
        light.dispose();
        material.dispose();
        flash.dispose();
      },
      78,
    );
  }

  /**
   * Short, thick blaster bolt that visibly TRAVELS through the world.
   * This replaces W216's almost-instant full-length line.
   */
  private spawnTravelingBolt(
    origin:
      Vector3,

    destination:
      Vector3,
  ) {
    const delta =
      destination.subtract(
        origin,
      );

    const distance =
      delta.length();

    if (
      distance <
      0.08
    ) {
      return;
    }

    const direction =
      delta.scale(
        1 /
        distance,
      );

    const length =
      Math.min(
        BOLT_LENGTH,
        Math.max(
          0.28,
          distance *
            0.35,
        ),
      );

    const core =
      MeshBuilder.CreateBox(
        'ElyraE11_BoltCore',
        {
          width:
            0.030,

          height:
            0.030,

          depth:
            length,
        },
        this.scene,
      );

    const aura =
      MeshBuilder.CreateBox(
        'ElyraE11_BoltAura',
        {
          width:
            0.070,

          height:
            0.070,

          depth:
            length +
            0.12,
        },
        this.scene,
      );

    aura.parent =
      core;

    aura.position.set(
      0,
      0,
      0,
    );

    core.isPickable =
      false;

    aura.isPickable =
      false;

    const coreMaterial =
      new StandardMaterial(
        'ElyraE11_BoltCoreMaterial',
        this.scene,
      );

    coreMaterial.disableLighting =
      true;

    coreMaterial.diffuseColor =
      new Color3(
        1,
        0.82,
        0.74,
      );

    coreMaterial.emissiveColor =
      new Color3(
        1,
        0.30,
        0.16,
      );

    const auraMaterial =
      new StandardMaterial(
        'ElyraE11_BoltAuraMaterial',
        this.scene,
      );

    auraMaterial.disableLighting =
      true;

    auraMaterial.diffuseColor =
      new Color3(
        1,
        0.035,
        0.012,
      );

    auraMaterial.emissiveColor =
      new Color3(
        1,
        0.055,
        0.018,
      );

    auraMaterial.alpha =
      0.48;

    auraMaterial.backFaceCulling =
      false;

    core.material =
      coreMaterial;

    aura.material =
      auraMaterial;

    const startCenter =
      origin.add(
        direction.scale(
          length *
          0.5,
        ),
      );

    const endCenter =
      distance <=
        length
        ? origin.add(
            direction.scale(
              distance *
              0.5,
            ),
          )
        : destination.subtract(
            direction.scale(
              length *
              0.5,
            ),
          );

    core.position.copyFrom(
      startCenter,
    );

    core.lookAt(
      destination,
    );

    const durationMs =
      Math.max(
        70,
        Math.min(
          230,
          (
            distance /
            BOLT_SPEED
          ) *
          1000,
        ),
      );

    const startedAt =
      performance.now();

    const animate =
      () => {
        if (
          core.isDisposed()
        ) {
          return;
        }

        const t =
          Math.min(
            1,
            (
              performance.now() -
              startedAt
            ) /
            durationMs,
          );

        // Slight ease-in keeps close shots from looking like a static beam.
        const eased =
          t *
          (
            2 -
            t
          );

        core.position.copyFrom(
          Vector3.Lerp(
            startCenter,
            endCenter,
            eased,
          ),
        );

        if (
          t <
          1
        ) {
          window.requestAnimationFrame(
            animate,
          );

          return;
        }

        coreMaterial.dispose();
        auraMaterial.dispose();
        aura.dispose();
        core.dispose();
      };

    window.requestAnimationFrame(
      animate,
    );
  }

  private spawnImpact(
    position:
      Vector3,
  ) {
    const impact =
      MeshBuilder.CreateSphere(
        'ElyraE11_Impact',
        {
          diameter:
            0.10,

          segments:
            6,
        },
        this.scene,
      );

    impact.position.copyFrom(
      position,
    );

    impact.isPickable =
      false;

    const material =
      new StandardMaterial(
        'ElyraE11_ImpactMaterial',
        this.scene,
      );

    material.disableLighting =
      true;

    material.diffuseColor =
      new Color3(
        0.85,
        0.035,
        0.012,
      );

    material.emissiveColor =
      new Color3(
        1,
        0.16,
        0.035,
      );

    impact.material =
      material;

    const light =
      new PointLight(
        'ElyraE11_ImpactLight',
        position,
        this.scene,
      );

    light.diffuse =
      new Color3(
        1,
        0.10,
        0.02,
      );

    light.intensity =
      1.35;

    light.range =
      2.6;

    window.setTimeout(
      () => {
        light.dispose();
        material.dispose();
        impact.dispose();
      },
      360,
    );
  }

  private updateHudVisibility() {
    this.hud.hidden =
      !this.isElyraControlled();

    if (
      this.hud.hidden
    ) {
      this.hud.classList.remove(
        'is-aiming',
        'is-recoiling',
      );
    }
  }
}
