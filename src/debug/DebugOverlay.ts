import { AbstractMesh, Color3, Engine, Material, Scene, StandardMaterial, Vector3 } from '@babylonjs/core';
import { PlayerController } from '../player/PlayerController';
import { InteractionSystem } from '../interaction/InteractionSystem';
import { GameState } from '../game/GameState';
import { LightsaberController } from '../player/LightsaberController';
import { LightsaberCombatController } from '../player/LightsaberCombatController';
import { PlayerPresentationController } from '../player/PlayerPresentationController';
import { DefenseController } from '../combat/DefenseController';
import { DuelCombatSystem } from '../combat/DuelCombatSystem';
import type { ShipExteriorScaleMetrics, ShipInteriorAudit, ShipInteriorScaleMetrics } from '../world/ShipInteriorSpatial';
import { ThirdPersonCamera } from '../player/ThirdPersonCamera';

interface ShipSpatialDebug {
  readonly shipInteriorAudit?: ShipInteriorAudit;
  readonly shipInteriorScaleMetrics?: ShipInteriorScaleMetrics;
  readonly shipInteriorScale: number;
  readonly shipInteriorNaraHeight: number;
  readonly shipCurrentRoom: string;
  readonly shipPlayerInsideBounds: boolean;
  readonly shipNaraInsideBounds: boolean;
  readonly shipNaraWorldPosition: { x: number; y: number; z: number };
  readonly shipExteriorAudit?: ShipInteriorAudit;
  readonly shipExteriorScaleMetrics?: ShipExteriorScaleMetrics;
  readonly shipExteriorEntryWorldPosition?: { x: number; y: number; z: number };
  readonly shipExteriorEntryDistance?: number;
  readonly shipExteriorEntryActive?: boolean;
  readonly shipExteriorRootPosition?: { x: number; y: number; z: number };
  readonly shipExteriorRootRotation?: { x: number; y: number; z: number };
  readonly shipExteriorRootScale?: { x: number; y: number; z: number };
  readonly shipCollisionProxyCount?: number;
  readonly shipCameraBlockerCount?: number;
  setCollisionDebugVisible?: (visible: boolean) => void;
}

export class DebugOverlay {
  private visible = false;
  private lightsaber?: LightsaberController;
  private combat?: LightsaberCombatController;
  private presentation?: PlayerPresentationController;
  private defense?: DefenseController;
  private duel?: DuelCombatSystem;
  private readonly title: HTMLElement | null;
  private materialCoverage = false;
  private savedFogEnabled = true;
  private readonly coverageMaterials = new Map<string, StandardMaterial>();
  private readonly savedCoverageMaterials = new Map<AbstractMesh, Material | null>();
  private shipSpatial?: ShipSpatialDebug;
  private camera?: ThirdPersonCamera;
  private lastUiUpdate = 0;
  constructor(private readonly scene: Scene, private readonly engine: Engine, private readonly player: PlayerController, private readonly content: HTMLElement, private readonly panel: HTMLElement, private readonly state?: GameState, private readonly interaction?: InteractionSystem) {
    this.title = panel.querySelector('.debug-title span');
    window.addEventListener('keydown', (event) => {
      if (event.key === 'F3') {
        event.preventDefault();
        this.visible = !this.visible;
        this.panel.classList.toggle('is-hidden', !this.visible);
        if (!this.visible) this.lightsaber?.setArmDebugVisible(false);
        this.shipSpatial?.setCollisionDebugVisible?.(this.visible);
      }
      if (event.key === 'F4') {
        event.preventDefault();
        this.toggleMaterialCoverage();
      }
    });
  }

  setLightsaber(lightsaber: LightsaberController) { this.lightsaber = lightsaber; }
  setCombat(combat: LightsaberCombatController) { this.combat = combat; }
  setPresentation(presentation: PlayerPresentationController) { this.presentation = presentation; }
  setDefense(defense: DefenseController) { this.defense = defense; }
  setShipSpatial(spatial: ShipSpatialDebug) { this.shipSpatial = spatial; }
  setCamera(camera: ThirdPersonCamera) { this.camera = camera; }
  setDuel(duel: DuelCombatSystem) { this.duel = duel; if (this.title) this.title.textContent = 'W2 DUEL TELEMETRY'; }
  show() { this.visible = true; this.panel.classList.remove('is-hidden'); }

  private toggleMaterialCoverage() {
    this.materialCoverage = !this.materialCoverage;
    this.visible = true;
    this.panel.classList.remove('is-hidden');
    if (this.materialCoverage) {
      this.savedFogEnabled = this.scene.fogEnabled;
      this.scene.fogEnabled = false;
      this.scene.meshes.forEach((mesh) => {
        const metadata = mesh.metadata as { materialFamily?: string; coverageExclude?: boolean; debugCollision?: boolean } | null;
        // Coverage is for playable exterior surfaces. Sky layers, invisible
        // collision helpers and other infinite-distance presentation meshes
        // are not world-surface gaps and must not flood the audit with
        // misleading magenta.
        if (metadata?.coverageExclude || metadata?.debugCollision || mesh.infiniteDistance || mesh.getTotalVertices() === 0) return;
        const family = metadata?.materialFamily ?? 'DEFAULT/OTHER';
        if (this.savedCoverageMaterials.has(mesh)) return;
        this.savedCoverageMaterials.set(mesh, mesh.material);
        mesh.material = this.getCoverageMaterial(family);
      });
    } else {
      this.scene.fogEnabled = this.savedFogEnabled;
      this.savedCoverageMaterials.forEach((material, mesh) => {
        if (!mesh.isDisposed()) mesh.material = material;
      });
      this.savedCoverageMaterials.clear();
    }
  }

  private getCoverageMaterial(family: string) {
    const normalizedFamily = family.startsWith('BASALT') ? 'BASALT' : family === 'INDUSTRIAL_GROUND' ? 'CONCRETE' : family === 'CABLE' ? 'METAL' : family === 'DARK_STEEL' ? 'METAL' : family === 'OIL' ? 'METAL' : family === 'WOOD' ? 'WOOD' : family === 'WARM_LIGHT' ? 'METAL' : family;
    const cached = this.coverageMaterials.get(normalizedFamily);
    if (cached) return cached;
    const colors: Record<string, Color3> = {
      METAL: new Color3(0.05, 0.3, 0.85),
      RUST: new Color3(0.65, 0.22, 0.08),
      CONCRETE: new Color3(0.95, 0.95, 0.95),
      BASALT: new Color3(0.38, 0.4, 0.44),
      MUD: new Color3(0.48, 0.22, 0.08),
      MOSS: new Color3(0.12, 0.65, 0.16),
      VEGETATION: new Color3(0.08, 0.8, 0.2),
      WATER: new Color3(0.02, 0.85, 0.9),
      WOOD: new Color3(0.34, 0.16, 0.06),
      CANVAS: new Color3(0.76, 0.62, 0.4),
      ROOF: new Color3(0.48, 0.14, 0.72),
      'DEFAULT/OTHER': new Color3(0.85, 0.02, 0.78),
    };
    const material = new StandardMaterial('NerathisCoverage_' + normalizedFamily, this.scene);
    material.diffuseColor = colors[normalizedFamily] ?? new Color3(0.7, 0.1, 0.7);
    material.emissiveColor = material.diffuseColor.scale(0.12);
    material.disableLighting = true;
    this.coverageMaterials.set(normalizedFamily, material);
    return material;
  }

  update() {
    if (!this.visible) return;
    const now = performance.now();
    // F3 is diagnostic UI, not a per-frame render workload. Rebuilding the
    // full DOM every frame can dominate integrated-GPU measurements.
    if (now - this.lastUiUpdate < 100) return;
    this.lastUiUpdate = now;
    const p = this.player.position;
    const activeMeshes = this.scene.getActiveMeshes().data;
    const triangles = activeMeshes.reduce((sum, mesh) => sum + Math.floor(mesh.getTotalIndices() / 3), 0);
    const activeMaterials = new Set(activeMeshes.map((mesh) => mesh.material).filter(Boolean)).size;
    const particleCount = this.scene.particleSystems.reduce((sum, system) => sum + system.getCapacity(), 0);
    const row = (label: string, value: string) => `<div class="debug-row"><span>${label}</span><span>${value}</span></div>`;
    this.content.innerHTML = [
      row('FPS', `${this.engine.getFps().toFixed(0)}`),
      row('DELTA', `${this.engine.getDeltaTime().toFixed(1)} ms`),
      row('PLAYER', `${p.x.toFixed(1)} / ${p.y.toFixed(1)} / ${p.z.toFixed(1)}`),
      row('SPEED', `${this.player.horizontalSpeed.toFixed(1)} m/s`),
      row('STATE', this.player.animationState),
      row('SCENE', this.state?.currentScene ?? 'shipInterior'),
      row('SPAWN', this.state?.currentSpawn ?? 'shipStart'),
      row('QUEST', `${this.state?.questStage ?? 1}`),
      row('TARGET', this.interaction?.currentTargetLabel ?? 'none'),
      row('CAMERA', this.scene.activeCamera?.name ?? 'none'),
      row('MESHES', `${this.scene.meshes.length}`),
      row('ACTIVE', `${activeMeshes.length}`),
      row('MATERIALS', `${activeMaterials}`),
      row('TRIS ~', `${triangles.toLocaleString()}`),
      row('LIGHTS', `${this.scene.lights.length}`),
      row('PARTICLES', `${particleCount}`),
      row('RENDERER', 'WebGL'),
      ...(this.camera ? [
        row('CAMERA DISTANCE', `${this.camera.actualDistance.toFixed(2)} m`),
        row('CAMERA POS', formatVector(this.camera.camera.position)),
        row('CAMERA BLOCKED', this.camera.isBlocked ? 'YES' : 'NO'),
        row('CAMERA BLOCKER', this.camera.activeBlockerName),
      ] : []),
      ...(this.state?.currentScene === 'shipInterior' && this.shipSpatial?.shipInteriorAudit ? [
        row('PLAYER POS', `${p.x.toFixed(2)} / ${p.y.toFixed(2)} / ${p.z.toFixed(2)}`),
        row('NARA POS', formatVector(this.shipSpatial.shipNaraWorldPosition)),
        row('SHIP ROOT', `${this.shipSpatial.shipInteriorAudit.rootPosition.x.toFixed(2)} / ${this.shipSpatial.shipInteriorAudit.rootPosition.y.toFixed(2)} / ${this.shipSpatial.shipInteriorAudit.rootPosition.z.toFixed(2)}`),
        row('SHIP BOUNDS', `${formatVector(this.shipSpatial.shipInteriorAudit.min)} → ${formatVector(this.shipSpatial.shipInteriorAudit.max)}`),
        row('PLAYER INSIDE BOUNDS', this.shipSpatial.shipPlayerInsideBounds ? 'YES' : 'NO'),
        row('NARA INSIDE BOUNDS', this.shipSpatial.shipNaraInsideBounds ? 'YES' : 'NO'),
        row('CURRENT ROOM', this.shipSpatial.shipCurrentRoom),
        row('PLAYER HEIGHT', `${(this.shipSpatial.shipInteriorScaleMetrics?.playerHeight ?? 1.83).toFixed(2)} m`),
        row('NARA HEIGHT', `${this.shipSpatial.shipInteriorNaraHeight.toFixed(2)} m`),
        row('SHIP SCALE', this.shipSpatial.shipInteriorScale.toFixed(3)),
        row('FLOOR Y', `${(this.shipSpatial.shipInteriorScaleMetrics?.floorY ?? this.shipSpatial.shipInteriorAudit.floorCandidates[0]?.max.y ?? this.shipSpatial.shipInteriorAudit.min.y).toFixed(3)}`),
        row('ROOM CLEAR HEIGHT', `${(this.shipSpatial.shipInteriorScaleMetrics?.clearHeight ?? 0).toFixed(2)} m`),
        row('CEILING Y', `${(this.shipSpatial.shipInteriorScaleMetrics?.ceilingY ?? this.shipSpatial.shipInteriorAudit.max.y).toFixed(3)}`),
        row('DOOR HEIGHT', `${(this.shipSpatial.shipInteriorScaleMetrics?.doorHeight ?? 0).toFixed(2)} m`),
        row('CORRIDOR WIDTH', `${(this.shipSpatial.shipInteriorScaleMetrics?.corridorWidth ?? 0).toFixed(2)} m`),
        row('CONSOLE HEIGHT', `${(this.shipSpatial.shipInteriorScaleMetrics?.consoleHeight ?? 0).toFixed(2)} m`),
        row('HEAD CLEARANCE', `${(this.shipSpatial.shipInteriorScaleMetrics?.headClearance ?? 0).toFixed(2)} m`),
        row('ROOM FLOOR SIZE', `${(this.shipSpatial.shipInteriorScaleMetrics?.roomWidth ?? 0).toFixed(2)} × ${(this.shipSpatial.shipInteriorScaleMetrics?.roomDepth ?? 0).toFixed(2)} m`),
        row('FLOOR CANDIDATES', `${this.shipSpatial.shipInteriorAudit.floorCandidates.length}`),
        row('SHIP COLLIDERS', `${this.shipSpatial.shipCollisionProxyCount ?? 0}`),
        row('CAMERA BLOCKERS', `${this.shipSpatial.shipCameraBlockerCount ?? 0}`),
        row('DISTANCE TO ENTRY', `${distanceBetween(this.player.position, this.shipSpatial.shipExteriorEntryWorldPosition ?? this.player.position).toFixed(2)} m`),
      ] : this.state?.currentScene === 'nerathisExterior' && this.shipSpatial?.shipExteriorAudit ? [
        row('SHIP EXTERIOR POS', formatVector(this.shipSpatial.shipExteriorRootPosition ?? Vector3.Zero())),
        row('SHIP EXTERIOR ROT', formatVector(this.shipSpatial.shipExteriorRootRotation ?? Vector3.Zero())),
        row('SHIP EXTERIOR SCALE', formatVector(this.shipSpatial.shipExteriorRootScale ?? Vector3.One())),
        row('SHIP EXTERIOR BOUNDS', `${formatVector(this.shipSpatial.shipExteriorAudit.min)} → ${formatVector(this.shipSpatial.shipExteriorAudit.max)}`),
        row('PLAYER HEIGHT', `${(this.shipSpatial.shipExteriorScaleMetrics?.playerHeight ?? this.player.visualInfo.height).toFixed(2)} m`),
        row('SHIP WIDTH', `${(this.shipSpatial.shipExteriorScaleMetrics?.width ?? this.shipSpatial.shipExteriorAudit.size.x).toFixed(2)} m`),
        row('SHIP HEIGHT', `${(this.shipSpatial.shipExteriorScaleMetrics?.height ?? this.shipSpatial.shipExteriorAudit.size.y).toFixed(2)} m`),
        row('SHIP LENGTH', `${(this.shipSpatial.shipExteriorScaleMetrics?.length ?? this.shipSpatial.shipExteriorAudit.size.z).toFixed(2)} m`),
        row('ENTRY HEIGHT', `${(this.shipSpatial.shipExteriorScaleMetrics?.entryHeight ?? 2.5).toFixed(2)} m`),
        row('ENTRY WIDTH', `${(this.shipSpatial.shipExteriorScaleMetrics?.entryWidth ?? 2.6).toFixed(2)} m`),
        row('PLAYER / SHIP HEIGHT', `${(this.shipSpatial.shipExteriorScaleMetrics?.playerToShipHeightRatio ?? 0).toFixed(3)}`),
        row('SUPPORT', this.shipSpatial.shipExteriorScaleMetrics?.supportReference ?? 'n/a'),
        row('DISTANCE TO ENTRY', `${(this.shipSpatial.shipExteriorEntryDistance ?? 0).toFixed(2)} m`),
        row('ENTRY ACTIVE', this.shipSpatial.shipExteriorEntryActive ? 'YES' : 'NO'),
        row('SHIP COLLIDERS', `${this.shipSpatial.shipCollisionProxyCount ?? 0}`),
        row('CAMERA BLOCKERS', `${this.shipSpatial.shipCameraBlockerCount ?? 0}`),
      ] : []),
      row('MATERIAL COVERAGE', this.materialCoverage ? 'ON / F4' : 'OFF / F4'),
      row('SABER', this.lightsaber?.currentState ?? 'OFF'),
      row('SOCKET BONE', this.lightsaber?.socketBone ?? 'NOT_FOUND'),
      row('PRESENTATION', this.presentation?.currentState ?? 'IDLE_UNARMED'),
      row('COMBAT ANIMATION', this.player.combatAnimationState),
      row('ANIMATION TIME', `${(this.combat?.attackProgress ?? 0).toFixed(2)}`),
      ...(this.lightsaber ? [
        row('RIGHT ARM CHAIN', this.lightsaber.attachmentDebug?.valid ? 'VALID' : 'INVALID'),
        row('ARM BONES', this.lightsaber.attachmentDebug ? `${this.lightsaber.attachmentDebug.names.shoulder} → ${this.lightsaber.attachmentDebug.names.upperArm} → ${this.lightsaber.attachmentDebug.names.forearm} → ${this.lightsaber.attachmentDebug.names.hand}` : 'NOT_FOUND'),
        row('HAND → HILT', this.lightsaber.attachmentDebug ? `${this.lightsaber.attachmentDebug.handHiltDistance.toFixed(3)} m` : 'n/a'),
        row('SABER ATTACHED', this.lightsaber.attachmentDebug ? 'YES' : 'NO'),
      ] : []),
      row('MODE', this.combat?.combatMode ?? 'EXPLORATION'),
      row('ATTACK', `${this.combat?.currentState ?? 'READY'} / ${this.combat?.currentAttackId ?? 'NONE'}`),
      row('ATTACK DIR', this.combat?.currentDirection ?? 'CENTER'),
      row('ATTACK INPUT', this.combat?.lastInputLabel ?? 'NONE'),
      row('ATTACK PHASE', `${this.combat?.currentPhase ?? 'READY'} ${(this.combat?.attackProgress ?? 0).toFixed(2)}`),
      row('ATTACK PROFILE', this.combat?.currentAttackId ?? 'NONE'),
      row('ARM POSE ACTIVE', this.lightsaber?.armPoseDebug?.active ? 'YES' : 'NO'),
      ...(this.lightsaber?.armPoseDebug ? [
        row('ARM WEIGHTS', `S ${(this.lightsaber.armPoseDebug.shoulder).toFixed(2)} / U ${(this.lightsaber.armPoseDebug.upperArm).toFixed(2)} / F ${(this.lightsaber.armPoseDebug.forearm).toFixed(2)} / H ${(this.lightsaber.armPoseDebug.hand).toFixed(2)}`),
      ] : []),
      row('SABER SPEED', `${(this.combat?.saberSpeed ?? 0).toFixed(1)} m/s`),
      row('HITBOX', this.combat?.hitboxActive ? 'ACTIVE' : 'OFF'),
      row('SWEEP ACTIVE', this.combat?.hitboxActive ? 'YES' : 'NO'),
      row('ATTACK COUNTS', `${this.combat?.executedAttackCount ?? 0} exec / ${this.combat?.droppedAttackCount ?? 0} dropped`),
      row('LAST CONTACT', this.combat?.lastContactInfo?.targetId ?? 'none'),
      ...(this.duel ? [
        row('DUEL AI', this.duel.duelist.isAIEnabled ? 'ON' : 'OFF'),
        row('DISTANCE', `${this.duel.duelist.currentDistance.toFixed(2)} m`),
        row('PLAYER ATTACK', `${this.duel.playerAttackDirection} / ${this.duel.playerAttackPhase}`),
        row('DEFENSE', this.defense?.currentState ?? 'NONE'),
        row('PARRY', this.defense?.isParryWindow ? 'OPEN' : 'CLOSED'),
        row('ENEMY STATE', this.duel.duelist.combatState),
        row('ENEMY POS', `${this.duel.duelist.position.x.toFixed(1)} / ${this.duel.duelist.position.z.toFixed(1)}`),
        row('ENEMY BOUNDS', `${this.duel.duelist.visualInfo.minY.toFixed(2)}–${this.duel.duelist.visualInfo.maxY.toFixed(2)} (${this.duel.duelist.visualInfo.enabled})`),
        row('PLAYER FEET', `${this.player.visualInfo.feetY.toFixed(2)} / ground Δ ${(this.player.visualInfo.feetY - 0.02).toFixed(3)}`),
        row('DUELIST FEET', `${this.duel.duelist.visualInfo.feetY.toFixed(2)} / ground Δ ${this.duel.duelist.visualInfo.groundError.toFixed(3)}`),
        row('HEIGHTS', `player ${this.player.visualInfo.height.toFixed(2)} / duelist ${this.duel.duelist.visualInfo.height.toFixed(2)} m`),
        row('SCALE RATIO', `${(this.duel.duelist.visualInfo.height / Math.max(0.001, this.player.visualInfo.height)).toFixed(3)}`),
        row('ENEMY TRIS', `${this.duel.duelist.visualInfo.triangles} ${this.duel.duelist.visualInfo.names}`),
        row('ENEMY MESH POS', `${this.duel.duelist.visualInfo.firstPosition.x.toFixed(1)} / ${this.duel.duelist.visualInfo.firstPosition.y.toFixed(1)} / ${this.duel.duelist.visualInfo.firstPosition.z.toFixed(1)}`),
        row('ENEMY BONE', this.duel.duelist.visualInfo.bone),
        row('ENEMY BLADE', this.duel.duelist.saberInfo),
        row('ENEMY ATTACK', `${this.duel.duelist.currentAttackId} / ${this.duel.duelist.currentAttackPhase}`),
        row('CLASH', `${this.duel.currentResult} @ ${this.duel.clashDistance.toFixed(2)}m`),
        row('LAST RESULT', this.duel.currentResult),
        row('PLAYER SABER SPEED', `${this.duel.playerSaberSpeed.toFixed(1)} m/s`),
        row('ENEMY SABER SPEED', `${this.duel.enemySaberSpeed.toFixed(1)} m/s`),
      ] : []),
    ].join('');
  }
}

function formatVector(value: { x: number; y: number; z: number }) {
  return `${value.x.toFixed(2)} / ${value.y.toFixed(2)} / ${value.z.toFixed(2)}`;
}

function distanceBetween(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}
