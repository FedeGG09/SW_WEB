import { AnimationGroup, Scene, Vector3 } from '@babylonjs/core';
import { AssetLoader, ImportedAsset } from '../assets/AssetLoader';
import { PlayerController } from '../player/PlayerController';
import { SaberHitVolume } from '../combat/SaberHitVolume';
import { SaberSweepDetector } from '../combat/SaberSweepDetector';
import { HitReceiver } from '../combat/HitReceiver';
import { PartyController } from './PartyController';
import { NaraSaberAttachment } from './NaraSaberAttachment';

type BladeState = 'OFF' | 'IGNITING' | 'ON' | 'RETRACTING';
type Phase = 'READY' | 'WINDUP' | 'ACTIVE' | 'RECOVERY';
type Profile = { clip:string; duration:number; activeStart:number; activeEnd:number; damage:number; movement:number };
export const NARA_COMBAT_PROFILES: readonly Profile[] = [
  {clip:'slash_right',duration:.64,activeStart:.22,activeEnd:.38,damage:12,movement:.48},
  {clip:'slash_left',duration:.64,activeStart:.22,activeEnd:.38,damage:14,movement:.48},
  {clip:'slash_forward',duration:.62,activeStart:.21,activeEnd:.40,damage:18,movement:.42},
];
const HEAVY:Profile={clip:'heavy_overhead',duration:1,activeStart:.45,activeEnd:.66,damage:28,movement:.28};
type Target={id:string;receiver:HitReceiver;position:()=>Vector3;radius:number;partyMember?:boolean;enabled?:()=>boolean};
const PARTY_IDS=new Set(['aren_vey','nara_voss','elyra_dane']);
function modalOpen(){
  return ['nerathisPartyPauseMenu','elyraRecruitmentDialogueOverlay','dialogueOverlay'].some(id=>{
    const e=document.getElementById(id);
    return !!e&&!e.hidden&&!e.classList.contains('is-hidden')&&window.getComputedStyle(e).display!=='none';
  });
}
/** Nara's existing direct-control layer. One gameplay clock; no follower combat AI. */
export class NaraJediController {
  private attachment?:NaraSaberAttachment;
  private attachmentAsset?:ImportedAsset;
  private attaching?:Promise<void>;
  private bladeState:BladeState='OFF';
  private bladeProgress=0;
  private attack?:{profile:Profile;index:number;elapsed:number;id:string;hits:Set<string>;activeStarted:boolean};
  private group?:AnimationGroup;
  private blockElapsed?:number;
  private readyActive=false;
  private ownsControl=false;
  private clock=0;
  private comboNext=0;
  private comboDeadline=0;
  private buffered=false;
  private lastClick=-Infinity;
  private serial=0;
  private executed=0;
  private pointerDown?:{x:number;y:number};
  private disposed=false;
  private readonly targets=new Map<string,Target>();
  readonly hitVolume=new SaberHitVolume();
  private readonly sweep=new SaberSweepDetector();
  private readonly listeners:Array<[string,EventListener]>=[];
  private readonly layoutHandler=()=>{if(!this.party.activeIsNara)this.forceNeutral();void this.syncActor();};
  constructor(private readonly scene:Scene,private readonly loader:AssetLoader,private readonly player:PlayerController,private readonly party:PartyController){
    this.listen('nerathis:party-layout-changed',this.layoutHandler);
    this.listen('nerathis:party-recruited',()=>void this.syncActor());
    this.installInput();void this.syncActor();
  }
  private listen(type:string,handler:EventListener){window.addEventListener(type,handler,true);this.listeners.push([type,handler]);}
  private allowed(){return !this.disposed&&this.party.activeIsNara&&this.player.playerCanControl&&!this.player.isActionLocked&&!modalOpen();}
  private trace(label:string,data:object){if(new URLSearchParams(window.location.search).get('combatTrace')==='1')console.info('[NARA COMBAT TRACE] '+label,JSON.stringify(data));}
  private installInput(){
    this.listen('keydown',((e:KeyboardEvent)=>{
      if(e.repeat||!this.allowed())return;const key=e.key.toLowerCase();
      if(key==='q'){e.preventDefault();void this.toggleBlade();}
      if(key==='j'){e.preventDefault();this.startHeavy();}
    })as EventListener);
    this.listen('pointerdown',((e:PointerEvent)=>{
      if(!this.allowed()||(e.target as HTMLElement|null)?.closest('button,input,textarea,#dialogueOverlay,#elyraRecruitmentDialogueOverlay,#nerathisPartyPauseMenu'))return;
      if(e.button===0)this.pointerDown={x:e.clientX,y:e.clientY};
      if(e.button===2){e.preventDefault();this.beginBlock();}
    })as EventListener);
    this.listen('pointermove',((e:PointerEvent)=>{if(this.pointerDown&&Math.hypot(e.clientX-this.pointerDown.x,e.clientY-this.pointerDown.y)>7)this.pointerDown=undefined;})as EventListener);
    this.listen('pointerup',((e:PointerEvent)=>{
      if(e.button===0){const click=!!this.pointerDown;this.pointerDown=undefined;if(click&&this.allowed()){e.preventDefault();this.startLight();}}
      if(e.button===2)this.endBlock();
    })as EventListener);
    this.listen('pointercancel',()=>{this.pointerDown=undefined;this.endBlock();});
    this.listen('blur',()=>{this.pointerDown=undefined;this.cancelAction();});
    this.listen('contextmenu',e=>{if(this.party.activeIsNara)e.preventDefault();});
  }
  private async syncActor(){
    const asset=this.party.getActorAsset('nara_voss');if(!asset)return;
    if(this.attachmentAsset===asset){await this.attaching;return;}
    this.attachment?.dispose();this.attachmentAsset=asset;
    const attachment=new NaraSaberAttachment(this.scene,this.loader,asset);this.attachment=attachment;
    this.attaching=attachment.attach().then(()=>{if(this.attachment===attachment)attachment.setBladeExtension(0);});await this.attaching;
  }
  private async toggleBlade(){
    if(!this.allowed()||this.attack||this.blockElapsed!==undefined)return;await this.syncActor();
    if(!this.allowed()||!this.attachment?.isAttached||this.attack||this.blockElapsed!==undefined)return;
    this.bladeState=this.bladeState==='ON'||this.bladeState==='IGNITING'?'RETRACTING':'IGNITING';this.trace('SABER',{state:this.bladeState});
  }
  update(dt:number){
    if(this.disposed)return;this.clock+=Math.max(0,dt);
    if(!this.party.activeIsNara){if(this.bladeState!=='OFF'||this.attack||this.ownsControl)this.forceNeutral();return;}
    this.updateBlade(dt);
    if(!this.allowed()){this.cancelAction();this.attachment?.finalizeGrip();return;}
    if(this.attack){
      this.attack.elapsed=Math.min(this.attack.profile.duration,this.attack.elapsed+dt);this.seek(this.attack.elapsed/this.attack.profile.duration);
      this.attachment?.finalizeGrip();this.updateDamage(dt);if(this.attack.elapsed>=this.attack.profile.duration)this.finishAttack();
    }else if(this.blockElapsed!==undefined){this.blockElapsed=Math.min(.24,this.blockElapsed+dt);this.seek(this.blockElapsed/.24);}else this.updateReady();
    this.attachment?.finalizeGrip();
  }
  private updateBlade(dt:number){
    if(this.bladeState==='ON')this.bladeProgress=1;else if(this.bladeState==='OFF')this.bladeProgress=0;
    else{const sign=this.bladeState==='IGNITING'?1:-1;this.bladeProgress=Math.max(0,Math.min(1,this.bladeProgress+sign*dt/(sign>0?.26:.21)));
      if(sign>0&&this.bladeProgress===1)this.bladeState='ON';if(sign<0&&this.bladeProgress===0)this.bladeState='OFF';}
    this.attachment?.setBladeExtension(this.bladeProgress*this.bladeProgress*(3-2*this.bladeProgress));
  }
  private play(name:string){
    if(!this.party.activeIsNara||!this.party.playActiveClipOverride(name,false,1))return false;
    this.group=this.attachmentAsset?.animationGroups.find(g=>g.name===name);if(!this.group)return false;
    this.group.pause();this.seek(0);this.readyActive=false;return true;
  }
  private seek(progress:number){const g=this.group;if(g)g.goToFrame(g.from+(g.to-g.from)*Math.max(0,Math.min(1,progress)));}
  private startLight(){
    if(!this.allowed()||this.bladeState!=='ON'||this.blockElapsed!==undefined||this.clock-this.lastClick<.10)return;this.lastClick=this.clock;
    if(this.attack){if(this.attack.index>=0&&this.attack.index<2&&this.currentPhase==='RECOVERY'&&!this.buffered){this.buffered=true;this.trace('COMBO BUFFER',{next:this.attack.index+1});}return;}
    if(this.clock>this.comboDeadline)this.comboNext=0;this.startAttack(NARA_COMBAT_PROFILES[this.comboNext],this.comboNext);
  }
  private startHeavy(){if(this.allowed()&&this.bladeState==='ON'&&!this.attack&&this.blockElapsed===undefined){this.comboNext=0;this.startAttack(HEAVY,-1);}}
  private startAttack(profile:Profile,index:number){
    if(!this.play(profile.clip))return;
    this.attack={profile,index,elapsed:0,id:`NARA_${profile.clip}_${++this.serial}`,hits:new Set(),activeStarted:false};this.executed++;this.buffered=false;
    this.player.setCombatControl(profile.movement,Math.PI*.72,Vector3.Zero());this.ownsControl=true;this.trace('ATTACK START',{clip:profile.clip,index,profile});
  }
  private finishAttack(){
    const old=this.attack!;const chain=this.buffered&&old.index>=0&&old.index<2;
    this.trace('ATTACK END',{clip:old.profile.clip,frame:this.currentFrame,hits:[...old.hits]});
    this.attack=undefined;this.hitVolume.endFrame();this.comboNext=old.index>=0&&old.index<2?old.index+1:0;this.comboDeadline=this.clock+.60;this.buffered=false;this.releasePose();
    if(chain)this.startAttack(NARA_COMBAT_PROFILES[this.comboNext],this.comboNext);else this.updateReady();
  }
  private beginBlock(){
    if(!this.allowed()||this.bladeState!=='ON'||this.attack||this.blockElapsed!==undefined||!this.play('block_center'))return;
    this.comboNext=0;this.blockElapsed=0;this.player.setCombatControl(.46,Math.PI,Vector3.Zero());this.ownsControl=true;
  }
  private endBlock(){if(this.blockElapsed===undefined)return;this.blockElapsed=undefined;this.releasePose();if(this.allowed())this.updateReady();}
  private updateReady(){const ready=this.bladeState==='ON'&&this.player.horizontalSpeed<.12;
    if(ready&&!this.readyActive&&this.play('combat_ready'))this.readyActive=true;if(!ready&&this.readyActive)this.releasePose();}
  private releasePose(){this.group=undefined;this.readyActive=false;if(this.party.activeIsNara)this.party.clearActiveClipOverride();if(this.ownsControl){this.player.clearCombatControl();this.ownsControl=false;}}
  private cancelAction(){this.attack=undefined;this.blockElapsed=undefined;this.buffered=false;this.comboNext=0;this.pointerDown=undefined;this.hitVolume.endFrame();if(this.group||this.ownsControl)this.releasePose();}
  private forceNeutral(){this.cancelAction();this.bladeState='OFF';this.bladeProgress=0;this.attachment?.setBladeExtension(0);}
  registerTarget(target:Target){if(!target.partyMember&&!PARTY_IDS.has(target.id))this.targets.set(target.id,target);}
  unregisterTarget(id:string){this.targets.delete(id);}
  private updateDamage(dt:number){
    const attack=this.attack;if(!attack||this.currentPhase!=='ACTIVE'||!this.attachment){this.hitVolume.endFrame();return;}
    const segment=this.attachment.getBladeSegment();if(!segment)return;
    if(!attack.activeStarted){this.sweep.begin();attack.activeStarted=true;}
    this.hitVolume.begin(attack.id);this.hitVolume.updateFromAttachment(this.attachment);this.sweep.update(segment.start,segment.end,dt);
    for(const target of this.targets.values()){
      if(attack.hits.has(target.id)||target.partyMember||PARTY_IDS.has(target.id)||target.enabled?.()===false)continue;
      if(!this.hitVolume.intersectsSphere(target.position(),target.radius)&&!this.sweep.intersectsSphere(target.position(),target.radius))continue;
      const e=this.hitVolume.toEvent('nara_voss',attack.index<0?2:1);if(!e)continue;
      e.damage=attack.profile.damage;attack.hits.add(target.id);target.receiver.receiveSaberHit(e);
      this.trace('DAMAGE',{target:target.id,power:e.power,damage:e.damage,phase:this.currentPhase,attack:e.attackId});
    }
  }
  dispose(){if(this.disposed)return;this.forceNeutral();this.disposed=true;this.listeners.forEach(([type,h])=>window.removeEventListener(type,h,true));this.attachment?.dispose();this.targets.clear();}
  get currentBladeState(){return this.bladeState;}
  get isBladeOn(){return this.bladeState==='ON'||this.bladeState==='IGNITING';}
  get currentPhase():Phase{if(!this.attack)return 'READY';const{elapsed,profile}=this.attack;return elapsed<profile.activeStart?'WINDUP':elapsed<profile.activeEnd?'ACTIVE':'RECOVERY';}
  get currentClip(){return this.group?.name;}
  get currentFrame(){return this.group?this.group.from+(this.group.to-this.group.from)*(this.attack?this.attack.elapsed/this.attack.profile.duration:this.blockElapsed!==undefined?this.blockElapsed/.24:0):undefined;}
  get currentBlockState(){return this.blockElapsed===undefined?'NONE':this.blockElapsed<.24?'ENTRY':'HOLD';}
  get executedAttackCount(){return this.executed;}
}
