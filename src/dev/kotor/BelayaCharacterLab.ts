import {
  ArcRotateCamera, Color3, Color4, Engine, HemisphericLight, Mesh,
  MeshBuilder, Scene, SceneLoader, StandardMaterial, Vector3,
} from '@babylonjs/core';
import '@babylonjs/loaders/glTF';

type LabState = {
  loaded: boolean; error?: string; asset: string; sourceCharacter: 'BELAYA'; runtimeRole: 'NARA';
  meshes: number; transformNodes: number; skeletons: Array<{name:string;joints:number}>;
  animationGroups: string[]; currentAnimation: string | null; animationTime: number | null;
  height: number | null; fpsApprox: number | null; loadMs: number | null;
  headAttachment: {bodyNode:'headhook'; found:boolean; relatedNodes:string[]};
  faceTelemetry: Record<string, number | null>; eyeAudit: Record<string, boolean>;
  voice: {dialogue:'dan13_belaya';activeResRef:string|null;lipResource:string|null;lipRuntime:'NOT_IMPLEMENTED'};
  textureVariant: {selected:'BELAYA_VANILLA';naraReskin:'NOT_CREATED';donorGlbModified:false};
};
declare global { interface Window { __belayaLabState?: LabState } }

const BELAYA_URL = '/_lab/kotor/characters/belaya/belaya_kotor1_donor.glb';
const QUICK_CLIPS: Array<[string,string]> = [
  ['IDLE','pause1'],['WALK','walk'],['RUN','run'],['TALK','talk'],['SALUTE','salute'],
  ['JEDI READY','g2r1'],['SABER WALK','walkss'],['SABER RUN','runss'],
  ['ATTACK 1','c2a1'],['ATTACK 2','c2a2'],['ATTACK 3','f2a1'],
  ['PARRY','c2p1'],['DEFLECT','c2n1'],['FORCE','castout1'],['DIE','die'],
];
const VOICE_SAMPLES = [
  { label:'TRIAL COMPLETE', resref:'nm13aabela05048_', lip:'nm13aabela05048_', text:'Felicidades, joven padawan. Seguro que te va bien con tu entrenamiento.' },
  { label:'JEDI KNIGHT', resref:'nm13aabela05045_', lip:'nm13aabela05045_', text:'El Maestro Zhar me ha dicho que has completado las pruebas satisfactoriamente. Ya eres un verdadero Jedi. Felicidades.' },
  { label:'ENCOURAGEMENT', resref:'nm13aabela05046_', lip:'nm13aabela05046_', text:'Deberías estar orgulloso de ti mismo... pero recuerda que todavía te queda mucho que aprender.' },
];
const FACE_NODES = ['f_jaw_g','f_Llm_g','f_Rlm_g','f_lmc_g','f_rmc_g','f_tonguetip_g','f_um_g','eyeLA','eyeRA','eyeLlid','eyeRlid'];
const norm = (s:string) => s.toLowerCase();

export async function startBelayaLab(): Promise<void> {
  for (const id of ['hud','questHud','debugOverlay','loadingOverlay']) document.getElementById(id)?.classList.add('is-hidden');
  document.getElementById('belayaLabPanel')?.remove();
  const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement | null;
  if (!canvas) throw new Error('BELAYA_LAB_RENDER_CANVAS_MISSING');
  canvas.style.cssText = 'display:block;position:fixed;inset:0;width:100vw;height:100vh;touch-action:none';
  const engine = new Engine(canvas,true,{preserveDrawingBuffer:true,stencil:true,antialias:true});
  const scene = new Scene(engine); scene.clearColor = new Color4(.11,.12,.13,1);
  const camera = new ArcRotateCamera('BelayaLabCamera',-Math.PI/2,1.2,4.6,new Vector3(0,.9,0),scene);
  camera.attachControl(canvas,true); camera.wheelPrecision=55; camera.lowerRadiusLimit=.35; camera.upperRadiusLimit=20; camera.panningSensibility=0;
  const key = new HemisphericLight('BelayaLabKey',new Vector3(.1,1,.1),scene); key.intensity=1.05; key.groundColor=new Color3(.18,.19,.22);
  const fill = new HemisphericLight('BelayaLabFill',new Vector3(0,-.6,-1),scene); fill.intensity=.35;
  const ground=MeshBuilder.CreateGround('BelayaLabGround',{width:16,height:16},scene), groundMat=new StandardMaterial('BelayaLabGroundMat',scene);
  groundMat.diffuseColor=new Color3(.19,.21,.23);groundMat.specularColor=new Color3(.08,.08,.08);ground.material=groundMat;
  const panel=document.createElement('section');panel.id='belayaLabPanel';
  panel.style.cssText='position:fixed;z-index:50;left:16px;top:16px;width:min(430px,calc(100vw - 32px));max-height:calc(100vh - 32px);overflow:auto;padding:14px;color:#eee8dc;background:#14191eef;border:1px solid #a07b48;border-radius:10px;font:12px/1.45 system-ui,sans-serif';
  panel.innerHTML=`<h2 style="margin:0 0 4px">BELAYA VANILLA · NARA DONOR LAB</h2><div>Source: dan13_belaya · KOTOR I · Nara runtime role · texture reskin not applied</div><div id="belayaStatus" style="margin:7px 0">Loading donor…</div><div id="belayaQuick" style="display:flex;flex-wrap:wrap;gap:5px;margin:8px 0"></div><div style="display:flex;gap:5px;flex-wrap:wrap"><button id="belayaFace">FACE CLOSEUP</button><button id="belayaReset">FULL BODY</button><button id="belayaTalk">TALK LOOP</button><button id="belayaPause">PAUSE1 LOOP</button></div><label style="display:block;margin-top:8px">Clip <select id="belayaClip"></select></label><button id="belayaPlay">PLAY SELECTED</button><div id="belayaFreeze" style="display:flex;gap:4px;margin:8px 0"></div><label>DLG sample <select id="belayaVoice"></select></label><div id="belayaLine" style="margin:5px 0;color:#ddd"></div><button id="belayaVoicePlay">PLAY VO + TALK</button><button id="belayaUvInfo">UV / RESKIN STATUS</button><pre id="belayaMetrics" style="white-space:pre-wrap;max-height:34vh;overflow:auto"></pre>`;
  document.body.appendChild(panel);
  const state:LabState={loaded:false,asset:BELAYA_URL,sourceCharacter:'BELAYA',runtimeRole:'NARA',meshes:0,transformNodes:0,skeletons:[],animationGroups:[],currentAnimation:null,animationTime:null,height:null,fpsApprox:null,loadMs:null,headAttachment:{bodyNode:'headhook',found:false,relatedNodes:[]},faceTelemetry:{},eyeAudit:{},voice:{dialogue:'dan13_belaya',activeResRef:null,lipResource:null,lipRuntime:'NOT_IMPLEMENTED'},textureVariant:{selected:'BELAYA_VANILLA',naraReskin:'NOT_CREATED',donorGlbModified:false}};
  window.__belayaLabState=state;
  let imported: Awaited<ReturnType<typeof SceneLoader.ImportMeshAsync>> | null=null, active: import('@babylonjs/core').AnimationGroup | null=null;
  let baseline=new Map<string,Vector3>();
  const status=panel.querySelector('#belayaStatus') as HTMLDivElement, metrics=panel.querySelector('#belayaMetrics') as HTMLPreElement;
  const publish=()=>{if(imported){state.meshes=imported.meshes.filter(m=>!m.name.toLowerCase().includes('root')).length;state.transformNodes=imported.transformNodes.length;state.skeletons=imported.skeletons.map(s=>({name:s.name,joints:s.bones.length}));state.animationGroups=imported.animationGroups.map(g=>g.name);const head=imported.meshes.filter(m=>/head|comm_w_f/i.test(m.name));if(head.length){head.forEach(m=>m.computeWorldMatrix(true));const bounds=head.map(m=>m.getBoundingInfo().boundingBox),minY=Math.min(...bounds.map(b=>b.minimumWorld.y)),maxY=Math.max(...bounds.map(b=>b.maximumWorld.y));camera.target.set(bounds[0].centerWorld.x,(minY+maxY)/2,bounds[0].centerWorld.z);}}window.__belayaLabState={...state,skeletons:[...state.skeletons],animationGroups:[...state.animationGroups],faceTelemetry:{...state.faceTelemetry},eyeAudit:{...state.eyeAudit},voice:{...state.voice},textureVariant:{...state.textureVariant}};metrics.textContent=JSON.stringify(window.__belayaLabState,null,2);};
  const findNode=(name:string)=>imported?.transformNodes.find(n=>norm(n.name)===norm(name))??imported?.meshes.find(n=>norm(n.name)===norm(name))??null;
  const play=(name:string,loop=true)=>{if(!imported)return;const group=imported.animationGroups.find(g=>norm(g.name)===norm(name));if(!group){status.textContent=`Animation unavailable: ${name}`;return;}active?.stop();baseline.clear();for(const nodeName of FACE_NODES){const n=findNode(nodeName);if(n){n.computeWorldMatrix(true);baseline.set(nodeName,n.getAbsolutePosition().clone());}}active=group;state.currentAnimation=group.name;const target=group.targetedAnimations.flatMap(t=>t.animation.getKeys());state.animationTime=target.length?Number((Math.max(...target.map(k=>k.frame))-Math.min(...target.map(k=>k.frame))).toFixed(4)):null;state.voice.activeResRef=null;state.voice.lipResource=null;group.start(loop,1);status.textContent=`Playing ${group.name}${loop?' · loop':''}`;publish();};
  const readFace=()=>{for(const n of FACE_NODES){const node=findNode(n),base=baseline.get(n);if(node&&base){node.computeWorldMatrix(true);state.faceTelemetry[n]=Number(Vector3.Distance(base,node.getAbsolutePosition()).toFixed(6));}}};
  try {
    const started=performance.now();imported=await SceneLoader.ImportMeshAsync('', '', BELAYA_URL, scene);state.loadMs=Number((performance.now()-started).toFixed(1));state.loaded=true;
    const renderables=imported.meshes.filter(m=>m.getTotalVertices()>0);if(renderables.length){const boxes=renderables.map(m=>{m.computeWorldMatrix(true);return m.getBoundingInfo().boundingBox;}),minY=Math.min(...boxes.map(b=>b.minimumWorld.y)),maxY=Math.max(...boxes.map(b=>b.maximumWorld.y));state.height=Number((maxY-minY).toFixed(4));camera.target.set(0,(maxY+minY)/2,0);camera.radius=Math.max(2.6,state.height*2.3);}
    state.headAttachment.found=Boolean(findNode('headhook'));state.headAttachment.relatedNodes=imported.transformNodes.filter(n=>/head|eye|f_jaw|f_.*lm|tongue/i.test(n.name)).map(n=>n.name);
    for(const n of ['eyeLA','eyeRA','eyeLlid','eyeRlid'])state.eyeAudit[n]=Boolean(findNode(n));
    const select=panel.querySelector('#belayaClip') as HTMLSelectElement;for(const g of imported.animationGroups){const o=document.createElement('option');o.value=g.name;o.textContent=g.name;select.appendChild(o);}
    for(const [label,clip] of QUICK_CLIPS){const b=document.createElement('button');b.textContent=label;b.title=`Exact source clip: ${clip}`;b.onclick=()=>play(clip,true);(panel.querySelector('#belayaQuick') as HTMLDivElement).append(b);}
    (panel.querySelector('#belayaPlay') as HTMLButtonElement).onclick=()=>play(select.value,true);
    (panel.querySelector('#belayaTalk') as HTMLButtonElement).onclick=()=>play('talk',true);
    (panel.querySelector('#belayaPause') as HTMLButtonElement).onclick=()=>play('pause1',true);
    (panel.querySelector('#belayaFace') as HTMLButtonElement).onclick=()=>{const head=imported!.meshes.find(m=>/^(Head|comm_w_f)/i.test(m.name))??imported!.meshes.find(m=>/head/i.test(m.name));if(head){head.computeWorldMatrix(true);camera.target.copyFrom(head.getBoundingInfo().boundingBox.centerWorld);camera.radius=1.25;}};
    (panel.querySelector('#belayaReset') as HTMLButtonElement).onclick=()=>{camera.alpha=-Math.PI/2;camera.beta=1.2;camera.radius=Math.max(2.6,(state.height??1.7)*2.3);camera.target.set(0,(state.height??1.7)/2,0);};
    const freeze=panel.querySelector('#belayaFreeze') as HTMLDivElement;for(const fraction of [0,.25,.5,.75,1]){const b=document.createElement('button');b.textContent=`FREEZE ${Math.round(fraction*100)}%`;b.onclick=()=>{if(!active)return;active.pause();active.goToFrame(active.from+(active.to-active.from)*fraction);state.currentAnimation=active.name;status.textContent=`${active.name} · ${Math.round(fraction*100)}%`;publish();};freeze.append(b);}
    const voice=panel.querySelector('#belayaVoice') as HTMLSelectElement;for(const s of VOICE_SAMPLES){const o=document.createElement('option');o.value=s.resref;o.textContent=s.label;voice.append(o);}const showVoice=()=>{const s=VOICE_SAMPLES.find(x=>x.resref===voice.value)!;(panel.querySelector('#belayaLine') as HTMLDivElement).textContent=s.text;};voice.addEventListener('change',showVoice);showVoice();
    (panel.querySelector('#belayaVoicePlay') as HTMLButtonElement).onclick=()=>{const s=VOICE_SAMPLES.find(x=>x.resref===voice.value)!;state.voice.activeResRef=s.resref;state.voice.lipResource=s.lip;play('talk',true);const audio=new Audio(`/_lab/kotor/characters/belaya/audio/${s.resref}.wav`);audio.onended=()=>{state.voice.activeResRef=null;publish();};void audio.play().catch(e=>{state.error=`VOICE_PLAYBACK_FAILED:${String(e)}`;status.textContent=state.error;});publish();};
    (panel.querySelector('#belayaUvInfo') as HTMLButtonElement).onclick=()=>{status.textContent='Belaya vanilla textures active. Supplied Nara head/body atlases are preserved as references; UV compatibility UNKNOWN; reskin textures not authored.';};
    play('pause1',true);publish();
    let last=0;engine.runRenderLoop(()=>{scene.render();const now=performance.now();if(now-last>200){last=now;state.fpsApprox=Number(engine.getFps().toFixed(1));readFace();publish();}});
    window.addEventListener('resize',()=>engine.resize());
  } catch(error){state.error=error instanceof Error?`${error.message}\n${error.stack??''}`:String(error);status.textContent=state.error;publish();throw error;}
}
