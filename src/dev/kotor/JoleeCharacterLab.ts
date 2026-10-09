import {
  ArcRotateCamera, Color3, Color4, Engine, HemisphericLight, MeshBuilder,
  Scene, SceneLoader, StandardMaterial, Vector3, Material,
} from '@babylonjs/core';
import '@babylonjs/loaders/glTF';

type JoleeLabState = {
  loaded: boolean; error?: string; meshes: number; transformNodes: number;
  skeletons: Array<{ name: string; joints: number }>; animationGroups: string[];
  currentAnimation: string | null; animationTime: number | null; height: number | null;
  hooksFound: string[]; fpsApprox: number | null; loadMs: number | null;
  equipment: { loaded: boolean; model: string; socket: string | null; attachment: string; roots: string[]; handCandidates?: string[]; gripDistance?: number | null; bladeScale?: [number,number,number] | null; bladeLength?: number | null };
  face: { mode: string; activeClip: string | null; frozenFraction: number | null };
  animationResolution?: Record<string, unknown>;
  headAttachmentAudit?: Record<string, unknown>;
  hookDiscrepancy: string;
  faceMeshes?: Array<{name:string;parent:string|null;center:[number,number,number];size:[number,number,number]}>;
  materialCount: number; textureCount: number;
};

declare global { interface Window { __joleeLabState?: JoleeLabState; __joleeAnimationTrace?: Record<string, unknown> } }
const candidate = new URLSearchParams(location.search).get('joleeCandidate');
const CHARACTER_URL = candidate === '2' ? '/_lab/kotor/characters/jolee/jolee_bindo_kotor1_w231_4b_candidate.glb' : candidate === '1' ? '/_lab/kotor/characters/jolee/jolee_bindo_kotor1_w231_4_candidate.glb' : '/_lab/kotor/characters/jolee/jolee_bindo_kotor1.glb';
const WEAPON_URL = '/_lab/kotor/characters/jolee/jolee_kotor1_lightsaber.glb';
const HOOK_NAMES = ['LightsaberHook','DeflectHook','handconjure','headconjure','impact_bolt','Impact','camerahook','FreeLookHook','headhook','MaskHook','GoggleHook'];
const QUICK_CLIPS: Array<[string,string,string]> = [
  ['IDLE','pause1','EXPLORATION_IDLE'],
  ['WALK','walkss','EXPLORATION_WALK'],
  ['WALK CANDIDATE','walk','WALK_CLIP_CANDIDATE'],
  ['RUN','run','EXPLORATION_RUN'],
  ['SABER WALK','walkss','SABER_WALK'],
  ['SABER RUN','runss','SABER_RUN'],
  ['JEDI READY','g2r1','SABER_READY'],
  ['ATTACK 1','c2a1','SABER_ATTACK_1'],['ATTACK 2','c2a2','SABER_ATTACK_2'],['ATTACK 3','c2a3','SABER_ATTACK_3'],
  ['PARRY','c2p1','SABER_PARRY'],['DEFLECT','c2n1','SABER_DEFLECT'],['HIT','c2d1','SABER_HIT'],
  ['FORCE','castout1','FORCE_CAST_CANDIDATE'],['TALK','talk','TALK'],['PAUSE1','pause1','PAUSE1'],['DIE','die','DEATH'],
];
const SOURCE_SUPERMODEL_BY_CLIP: Record<string,string> = {
  pause1:'P_JoleeBB', walk:'S_Male02', walkss:'S_Male02', run:'S_Male02', runss:'S_Male02',
  g2r1:'S_Male02', c2a1:'S_Male02', c2a2:'S_Male02', c2a3:'S_Male02', c2p1:'S_Male01',
  c2n1:'S_Male02', c2d1:'S_Male01', castout1:'S_Male02', talk:'S_Male02', die:'S_Male02',
};
const JOLEE_HEAD_AUDIT = {
  sourceReport:'docs/_audit_codex/w231_4b_head_neck_measurements.json',
  classification:'SMALL_SOURCE_SEAM',
  rootCause:'SOURCE_MESH_BOUNDARY_SEPARATION',
  bodyHeadReference:'Armature_P_JoleeBB.pose.bones[head_g]',
  headRootReference:'Armature_P_JoleeBB/head_g → P_JoleeH',
  bindTranslationM:[0,0,-0.0000001],
  bindQuaternionWXYZ:[1,0,0,0],
  bindScale:[1,1,0.9999999],
  maxAttachmentPositionErrorM:0,
  maxAttachmentAngularErrorDeg:0,
  surfaceSeamMeters:{pause1:{min:0.024423,mean:0.060623,max:0.102753},walk:{min:0.027537,mean:0.057387,max:0.090828},run:{min:0.037913,mean:0.059655,max:0.085460},walkss:{min:0.027537,mean:0.057387,max:0.090828},runss:{min:0.037764,mean:0.059666,max:0.085643},g2r1:{min:0.038456,mean:0.058424,max:0.102241},c2a1:{min:0.017301,mean:0.060909,max:0.102241},c2a2:{min:0.025986,mean:0.060322,max:0.103630},c2a3:{min:0.022295,mean:0.058966,max:0.102241},c2p1:{min:0.035860,mean:0.063200,max:0.103410},c2n1:{min:0.030673,mean:0.056035,max:0.102807},castout1:{min:0.023960,mean:0.057304,max:0.092909},talk:{min:0.026971,mean:0.056183,max:0.092909},die:{min:0.019845,mean:0.060498,max:0.105733}},
  offsetsApplied:0,
};

export async function startJoleeLab(): Promise<void> {
  document.getElementById('hud')?.classList.add('is-hidden');
  document.getElementById('questHud')?.classList.add('is-hidden');
  document.getElementById('debugOverlay')?.classList.add('is-hidden');
  document.getElementById('loadingOverlay')?.classList.add('is-hidden');
  document.getElementById('joleeLabPanel')?.remove();
  const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement | null;
  if (!canvas) throw new Error('JOLEE_LAB_RENDER_CANVAS_MISSING');
  canvas.style.display = 'block'; canvas.style.width = '100vw'; canvas.style.height = '100vh'; canvas.style.touchAction = 'none';
  const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true, antialias: true });
  const scene = new Scene(engine); scene.clearColor = new Color4(0.105,0.118,0.135,1);
  const camera = new ArcRotateCamera('JoleeLabCamera', -Math.PI/2, 1.18, 4.5, new Vector3(0,0.9,0), scene);
  camera.attachControl(canvas,true); camera.wheelPrecision=55; camera.lowerRadiusLimit=0.35; camera.upperRadiusLimit=20; camera.panningSensibility=0;
  const light = new HemisphericLight('JoleeLabKey',new Vector3(0.1,1,0.1),scene); light.intensity=1.05; light.groundColor=new Color3(0.18,0.19,0.22);
  const fill = new HemisphericLight('JoleeLabFill',new Vector3(0,-0.6,-1),scene); fill.intensity=0.35;
  const ground = MeshBuilder.CreateGround('LabGround',{width:16,height:16},scene); ground.position.y=-0.015;
  const groundMat = new StandardMaterial('LabGroundMat',scene); groundMat.diffuseColor=new Color3(0.19,0.21,0.23); groundMat.specularColor=new Color3(0.08,0.08,0.08); ground.material=groundMat;
  const state: JoleeLabState={loaded:false,meshes:0,transformNodes:0,skeletons:[],animationGroups:[],currentAnimation:null,animationTime:null,height:null,hooksFound:[],fpsApprox:null,loadMs:null,equipment:{loaded:false,model:'w_lghtsbr_003',socket:null,attachment:'NOT_ATTACHED',roots:[]},materialCount:0,textureCount:0,face:{mode:'FULL_BODY',activeClip:null,frozenFraction:null},animationResolution:{requestedSemantic:null,requestedClipName:null,resolvedAnimationGroup:null,animationGroupIndex:null,durationSeconds:null,sourceSupermodel:null,loopState:null,blendState:null,previousAnimation:null,nextAnimation:null,exactLookup:true},headAttachmentAudit:{...JOLEE_HEAD_AUDIT,activeClipSeamMeters:null},hookDiscrepancy:'MaskHook present in GLB; old runtime list incorrectly requested absent impact_bolt'};
  window.__joleeLabState=state;
  const panel=document.createElement('section'); panel.id='joleeLabPanel';
  panel.innerHTML=`<style>#joleeLabPanel{position:fixed;z-index:50;left:16px;top:16px;width:min(380px,calc(100vw - 32px));max-height:calc(100vh - 32px);overflow:auto;padding:14px 16px;color:#eee8dc;background:#14191eeF;border:1px solid #a07b48;border-radius:10px;font:12px/1.45 system-ui,sans-serif;box-shadow:0 9px 36px #0009}#joleeLabPanel h1{font-size:15px;margin:0 0 8px;color:#e1bf84}#joleeLabPanel .jstatus{white-space:pre-wrap;color:#c9d7d0;font:11px/1.45 ui-monospace,monospace;margin:9px 0}#joleeLabPanel .jbuttons{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:5px;margin:9px 0}#joleeLabPanel button,#joleeLabPanel select{width:100%;padding:8px;color:#f3eee6;background:#373b3e;border:1px solid #666;border-radius:5px;cursor:pointer}#joleeLabPanel button:hover{background:#63513c}#joleeLabPanel .jrow{display:flex;gap:6px;margin:7px 0}#joleeLabPanel small{color:#bdb7ac}</style><h1>JOLEE BINDO — KOTOR I LAB</h1><small>DEV only · original geometry and animation clips · no game integration</small><div class="jbuttons" id="joleeQuick"></div><div class="jrow"><select id="joleeAllClips"><option>Loading clips…</option></select><button id="joleePlaySelected">PLAY</button></div><div class="jrow"><button id="joleeWeapon">SHOW ORIGINAL LIGHTSABER</button><button id="joleeReset">RESET CAMERA</button></div><div class="jrow"><button id="joleeFace">FACE CLOSEUP</button><button id="joleeHooks">SHOW HOOKS</button></div><div class="jrow" id="joleeFreeze"></div><div class="jstatus" id="joleeMetrics"></div><div class="jstatus" id="joleeStatus">Loading Jolee…</div>`;
  document.body.append(panel);
  const status=panel.querySelector('#joleeStatus') as HTMLDivElement;
  const refresh=()=>{ const clip=state.currentAnimation??'';state.headAttachmentAudit={...JOLEE_HEAD_AUDIT,activeClipSeamMeters:(JOLEE_HEAD_AUDIT.surfaceSeamMeters as Record<string,unknown>)[clip]??null};window.__joleeLabState={...state,equipment:{...state.equipment}};window.__joleeAnimationTrace={...state.animationResolution};status.textContent=JSON.stringify({loaded:state.loaded,error:state.error,meshes:state.meshes,joints:state.skeletons,animationGroupCount:state.animationGroups.length,currentAnimation:state.currentAnimation,animationResolution:state.animationResolution,headAttachmentAudit:state.headAttachmentAudit,hooks:state.hooksFound.length,asset:CHARACTER_URL,equipment:state.equipment,face:state.face,fps:state.fpsApprox},null,2); };
  const loadedAt=performance.now();
  try {
    const imported=await SceneLoader.ImportMeshAsync('', '/_lab/kotor/characters/jolee/', CHARACTER_URL.split('/').at(-1)!, scene);
    state.loadMs=Math.round(performance.now()-loadedAt); state.loaded=true;
    state.meshes=imported.meshes.length; state.transformNodes=imported.transformNodes.length;
    state.skeletons=imported.skeletons.map(s=>({name:s.name,joints:s.bones.length}));
    state.animationGroups=imported.animationGroups.map(g=>g.name);
    state.materialCount=scene.materials.length; state.textureCount=scene.textures.length;
    state.hooksFound=HOOK_NAMES.filter(n=>scene.getNodeByName(n)!==null);
    let min=new Vector3(Infinity,Infinity,Infinity),max=new Vector3(-Infinity,-Infinity,-Infinity);
    for(const mesh of imported.meshes){ if(!mesh.getTotalVertices()) continue; mesh.computeWorldMatrix(true); const b=mesh.getBoundingInfo().boundingBox; min=Vector3.Minimize(min,b.minimumWorld); max=Vector3.Maximize(max,b.maximumWorld); }
    if(Number.isFinite(min.y)&&Number.isFinite(max.y)){state.height=max.y-min.y;const center=min.add(max).scale(0.5);camera.target.copyFrom(center);camera.radius=Math.max(2,state.height*2.8);camera.lowerRadiusLimit=Math.max(0.25,state.height*0.22);camera.upperRadiusLimit=Math.max(8,state.height*8); ground.position.y=min.y-0.02;}
    const clipSelect=panel.querySelector('#joleeAllClips') as HTMLSelectElement; clipSelect.innerHTML='';
    const groupByName=new Map(imported.animationGroups.map(g=>[g.name,g]));
    for(const name of state.animationGroups){const o=document.createElement('option');o.value=name;o.textContent=name;clipSelect.append(o);}
    let activeGroup=imported.animationGroups[0];
    const play=(clip:string,loop=true,requestedSemantic='MANUAL_CLIP')=>{const previous=activeGroup?.name??null;const g=groupByName.get(clip);if(!g){state.error=`CLIP_NOT_FOUND_EXACT:${clip}`;state.animationResolution={requestedSemantic,requestedClipName:clip,resolvedAnimationGroup:null,animationGroupIndex:-1,durationSeconds:null,sourceSupermodel:SOURCE_SUPERMODEL_BY_CLIP[clip]??null,loopState:'MISSING_EXACT_GROUP',blendState:'NO_SWITCH',previousAnimation:previous,nextAnimation:null,exactLookup:true};refresh();return;}for(const other of imported.animationGroups)other.stop();g.start(loop,1);activeGroup=g;state.currentAnimation=g.name;state.face.activeClip=g.name;state.face.frozenFraction=null;const durationSeconds=Math.max(0,...g.targetedAnimations.map(t=>{const keys=t.animation.getKeys();const fps=Math.max(1,t.animation.framePerSecond||30);return keys.length>1?(Number(keys.at(-1)?.frame??0)-Number(keys[0]?.frame??0))/fps:0;}));state.animationTime=durationSeconds;state.animationResolution={requestedSemantic,requestedClipName:clip,resolvedAnimationGroup:g.name,animationGroupIndex:imported.animationGroups.indexOf(g),durationSeconds:Number(durationSeconds.toFixed(6)),sourceSupermodel:SOURCE_SUPERMODEL_BY_CLIP[clip]??null,loopState:loop?'LOOPED':'ONCE',blendState:'DIRECT_ANIMATION_GROUP_START',previousAnimation:previous,nextAnimation:g.name,exactLookup:true,source:'exact case-sensitive AnimationGroup name; W231 winning-source/table semantics'};refresh();};
    const quick=panel.querySelector('#joleeQuick') as HTMLDivElement;
    for(const [label,clip,semantic] of QUICK_CLIPS){const b=document.createElement('button');b.textContent=label;b.title=`Exact source clip: ${clip} · ${semantic}`;b.onclick=()=>play(clip,true,semantic);quick.append(b);}
    (panel.querySelector('#joleePlaySelected') as HTMLButtonElement).onclick=()=>play(clipSelect.value,true,'MANUAL_CLIP_SELECTION');
    (panel.querySelector('#joleeReset') as HTMLButtonElement).onclick=()=>{camera.alpha=-Math.PI/2;camera.beta=1.18;camera.radius=Math.max(2,(state.height??1.7)*2.8);state.face.mode='FULL_BODY';refresh();};
    (panel.querySelector('#joleeFace') as HTMLButtonElement).onclick=()=>{const head=scene.getMeshByName('Head');if(head){head.computeWorldMatrix(true);camera.target.copyFrom(head.getBoundingInfo().boundingBox.centerWorld);camera.radius=1.5;camera.lowerRadiusLimit=0.75;state.face.mode='FACE_CLOSEUP';refresh();}};
    const hookMarkers: ReturnType<typeof MeshBuilder.CreateSphere>[]=[];let hooksVisible=false;
    (panel.querySelector('#joleeHooks') as HTMLButtonElement).onclick=()=>{hooksVisible=!hooksVisible;if(hooksVisible&&!hookMarkers.length){for(const name of HOOK_NAMES){const node=scene.getNodeByName(name);if(!node)continue;const marker=MeshBuilder.CreateSphere('HookMarker_'+name,{diameter:0.025},scene);const mat=new StandardMaterial('HookMarkerMat_'+name,scene);mat.emissiveColor=new Color3(1,0.4,0.1);marker.material=mat;marker.metadata={sourceNode:node};hookMarkers.push(marker);}}for(const marker of hookMarkers)marker.setEnabled(hooksVisible);refresh();};
    for(const fraction of [0,0.25,0.5,0.75,1]){const b=document.createElement('button');b.textContent=`${Math.round(fraction*100)}%`;b.onclick=()=>{if(!activeGroup)return;activeGroup.pause();const from=activeGroup.from,to=activeGroup.to;activeGroup.goToFrame(from+(to-from)*fraction);state.face.frozenFraction=fraction;refresh();};(panel.querySelector('#joleeFreeze') as HTMLDivElement).append(b);}
    let weaponPromise:Promise<void>|null=null;
    (panel.querySelector('#joleeWeapon') as HTMLButtonElement).onclick=()=>{
      if(weaponPromise)return;
      weaponPromise=(async()=>{
        const handCandidates=[...imported.transformNodes,...imported.meshes].filter(n=>n.name.toLowerCase()==='rhand');
        state.equipment.handCandidates=handCandidates.map(n=>{const chain=[];let p=n.parent;while(p){chain.push(p.name);p=p.parent;}return `${n.name} <- ${chain.join(' <- ')}`;});
        const socket=handCandidates.find(n=>{let p=n.parent;while(p){if(p.name.toLowerCase()==='rhand_g')return true;p=p.parent;}return false;});
        if(!socket){state.equipment.socket=null;state.equipment.attachment='SOURCE_RHAND_NODE_NOT_EXPORTED';refresh();return;}
        state.equipment.socket=socket.name;
        const weapon=await SceneLoader.ImportMeshAsync('', '/_lab/kotor/characters/jolee/', WEAPON_URL.split('/').at(-1)!, scene);
        // w_lsabregren01.tpc carries Odyssey TXI `blending 1; decal 1`.
        // Restore that source additive rendering on the original four blade planes.
        for(const blade of weapon.meshes.filter(m=>/^plane22[7-9]$|^plane230$/.test(m.name))){if(blade.material){blade.material.transparencyMode=Material.MATERIAL_ALPHABLEND;blade.material.alphaMode=Engine.ALPHA_ADD;blade.material.alpha=0.999;blade.material.disableDepthWrite=true;blade.material.backFaceCulling=false;}}
        const nodes=[...weapon.transformNodes,...weapon.meshes];
        const roots=nodes.filter(n=>!n.parent);
        for(const root of roots) root.parent=socket;
        const powerup=weapon.animationGroups.find(g=>g.name.toLowerCase()==='powerup');if(powerup){powerup.start(false,1);powerup.goToFrame(powerup.to);powerup.pause();}
        state.equipment.roots=roots.map(n=>n.name);state.equipment.loaded=true;state.equipment.attachment='ORIGINAL_MODEL_ROOT_PARENTED_TO_RHAND_CHILD_OF_RHAND_G_NO_OFFSET';refresh();
      })().catch(e=>{state.error=`LIGHTSABER_LOAD_FAILED:${e instanceof Error?e.message:String(e)}`;refresh();}).finally(()=>{weaponPromise=null;});
    };
    for(const group of imported.animationGroups){const target=group.targetedAnimations.find(a=>a.animation.getKeys().length>1);if(target){const keys=target.animation.getKeys();state.animationTime=Number(keys.at(-1)?.frame??0);break;}}
    play('pause1',true); refresh();
    let last=performance.now();engine.runRenderLoop(()=>{for(const marker of hookMarkers){if(marker.isEnabled()){const node=marker.metadata.sourceNode;marker.position.copyFrom(node.getAbsolutePosition());}}if(state.equipment.loaded){const socket=[...imported.transformNodes,...imported.meshes].find(n=>n.name.toLowerCase()==='rhand'&&n.parent?.name.toLowerCase()==='rhand_g');const hilt=scene.getMeshByName('lshandle07');if(socket&&hilt){hilt.computeWorldMatrix(true);state.equipment.gripDistance=Number(Vector3.Distance(socket.getAbsolutePosition(),hilt.getBoundingInfo().boundingBox.centerWorld).toFixed(4));const blade=scene.getMeshByName('plane227');if(blade){blade.computeWorldMatrix(true);state.equipment.bladeScale=[blade.scaling.x,blade.scaling.y,blade.scaling.z].map(v=>Number(v.toFixed(4))) as [number,number,number];const ex=blade.getBoundingInfo().boundingBox.extendSizeWorld;state.equipment.bladeLength=Number((Math.max(ex.x,ex.y,ex.z)*2).toFixed(4));}}}scene.render();const now=performance.now();if(now-last>250){state.fpsApprox=Math.round(engine.getFps()*100)/100;last=now;state.faceMeshes=imported.meshes.filter(m=>['Head','Hood','eyeLA','eyeRA','eyeLlid','eyeRlid','tongue','teethLa01','teethUa01'].some(n=>m.name===n||m.name.startsWith(n+'.'))).map(m=>{m.computeWorldMatrix(true);const b=m.getBoundingInfo().boundingBox;return{name:m.name,parent:m.parent?.name??null,center:[b.centerWorld.x,b.centerWorld.y,b.centerWorld.z].map(v=>Number(v.toFixed(4))) as [number,number,number],size:[b.extendSizeWorld.x*2,b.extendSizeWorld.y*2,b.extendSizeWorld.z*2].map(v=>Number(v.toFixed(4))) as [number,number,number]};});window.__joleeLabState={...state,equipment:{...state.equipment}};(panel.querySelector('#joleeMetrics') as HTMLDivElement).textContent=JSON.stringify({clip:state.currentAnimation,grip:state.equipment.gripDistance,bladeScale:state.equipment.bladeScale,bladeLength:state.equipment.bladeLength,faceMeshes:state.faceMeshes},null,2);}});
    window.addEventListener('resize',()=>engine.resize());
  } catch(error) { state.error=error instanceof Error?`${error.message}\n${error.stack??''}`:String(error); refresh(); throw error; }
}
