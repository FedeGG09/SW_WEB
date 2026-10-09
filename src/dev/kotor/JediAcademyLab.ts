import {
  ArcRotateCamera, Color3, Color4, Engine, FreeCamera, LinesMesh, Mesh,
  MeshBuilder, Scene, SceneLoader, StandardMaterial, Vector3,
} from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import { applyJediEnclaveMaterials, setJediEnclaveMaterialView, type JediEnclaveMaterialView } from './JediEnclaveMaterialPipeline';

const BASE = '/_lab/kotor/worlds/jedi_enclave/';
type Point = [number, number, number];
type Face = { face:number; vertices:[Point,Point,Point]; walkability:string; material:string; transitions:(number|null)[] };
type NavRoom = {resref:string; faces:Face[]; validEmpty:boolean};
type PthNode = {id:number; position:Point; room:string; wokFace:number};
type PthEdge = {from:number;to:number;fromRoom:string;toRoom:string;distance:number;transitionType:string};
type Nav = {rooms:NavRoom[];pth:PthNode[];pthEdges:PthEdge[];roomLinks:{fromRoom:string;toRoom:string}[]};
type World = {rooms:{resref:string;renderable:boolean;renderBounds:{min:Point;max:Point}|null}[];doors:{instanceId:string;position:Point;doorClassification:string}[];placeables:{position:Point}[];waypoints:{templateResRef:string;rawFields:Record<string,number>}[];visibility:Record<string,string[]>;doorhooks:{position:Point}[];npcMarkers:{position:Point|null}[];triggers:{position:Point|null}[]};
type Hit={room:string;face:number;point:Point};
const toB=(p:Point)=>new Vector3(p[0],p[2],-p[1]);
const fromB=(p:Vector3):Point=>[p.x,-p.z,p.y];
function inside(p:Point,v:[Point,Point,Point]){
  const [a,b,c]=v, den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);
  if(Math.abs(den)<1e-9)return false;
  const s=((b[1]-c[1])*(p[0]-c[0])+(c[0]-b[0])*(p[1]-c[1]))/den;
  const t=((c[1]-a[1])*(p[0]-c[0])+(a[0]-c[0])*(p[1]-c[1]))/den;
  return s>=-1e-5&&t>=-1e-5&&s+t<=1+1e-5;
}
function project(p:Point,nav:Nav,limit=1.2,rooms?:string[]):Hit|null{
  let best:{hit:Hit;dz:number}|null=null;
  for(const room of nav.rooms){
    if(rooms&&!rooms.includes(room.resref))continue;
    for(const face of room.faces){
      if(face.walkability!=='WALKABLE'||!inside(p,face.vertices))continue;
      const [a,b,c]=face.vertices;
      const den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);
      const s=((b[1]-c[1])*(p[0]-c[0])+(c[0]-b[0])*(p[1]-c[1]))/den;
      const t=((c[1]-a[1])*(p[0]-c[0])+(a[0]-c[0])*(p[1]-c[1]))/den;
      const z=s*a[2]+t*b[2]+(1-s-t)*c[2],dz=Math.abs(z-p[2]);
      if(dz>limit||best&&best.dz<=dz)continue;
      best={hit:{room:room.resref,face:face.face,point:[p[0],p[1],z]},dz};
    }
  }
  return best?.hit??null;
}
function marker(scene:Scene,name:string,pos:Point,color:Color3,size=.24){
  const mesh=MeshBuilder.CreateSphere(name,{diameter:size,segments:6},scene);
  mesh.position.copyFrom(toB(pos));mesh.isPickable=false;
  const material=new StandardMaterial(name+'Material',scene);
  material.disableLighting=true;material.emissiveColor=color;mesh.material=material;
  return mesh;
}
function line(scene:Scene,name:string,a:Point,b:Point,color:Color3):LinesMesh{
  const mesh=MeshBuilder.CreateLines(name,{points:[toB(a),toB(b)]},scene);
  mesh.color=color;mesh.isPickable=false;return mesh;
}
function requireJson<T>(name:string):Promise<T>{
  return fetch(BASE+name).then(async r=>{if(!r.ok)throw new Error(`${name}: HTTP ${r.status}`);return r.json() as Promise<T>;});
}

export async function startJediAcademyLab(){
  const canvas=document.getElementById('renderCanvas') as HTMLCanvasElement;
  const overlay=document.getElementById('loadingOverlay');
  for(const id of ['hud','questHud']){const element=document.getElementById(id);if(element)element.style.display='none';}
  const errors:string[]=[];
  window.addEventListener('error',event=>errors.push(event.message));
  window.addEventListener('unhandledrejection',event=>errors.push(String(event.reason)));
  const engine=new Engine(canvas,true,{preserveDrawingBuffer:true,stencil:true});
  const scene=new Scene(engine);scene.useRightHandedSystem=true;scene.clearColor=new Color4(.045,.055,.065,1);
  const started=performance.now();
  const [world,nav,materials,routes]=await Promise.all([
    requireJson<World>('jedi_enclave_world.json'),requireJson<Nav>('jedi_enclave_navigation.json'),
    requireJson<{meshes:any[]}>('jedi_enclave_materials.json'),
    requireJson<{routes:{pthNodes:number[];distance:number;startRoom:string;endRoom:string}[]}>('jedi_enclave_route_tests.json'),
  ]);
  const sourceRows=materials.meshes.map(row=>({...row,sourceClassification:row.classification}));
  const loaded=await SceneLoader.ImportMeshAsync('',BASE,'jedi_enclave_danm13_kotor1.glb',scene);
  const render=loaded.meshes.filter(mesh=>mesh.getTotalVertices()>0);
  const materialStats=applyJediEnclaveMaterials(render,materials,{rows:sourceRows},scene,3);
  const byRoom=new Map<string,Mesh[]>();
  for(const mesh of render){
    const match=/^Room_(m13aa_[a-z0-9]+)::/i.exec(mesh.name);
    if(!match)continue;
    const key=match[1].toLowerCase(),list=byRoom.get(key)??[];
    list.push(mesh as Mesh);byRoom.set(key,list);
  }
  const entry=world.waypoints.find(w=>w.templateResRef==='wp_pc_start')?.rawFields;
  const entryPoint:Point=entry?[entry.XPosition,entry.YPosition,entry.ZPosition]:nav.pth[0].position;
  let spawn=project(entryPoint,nav,3);
  if(!spawn){
    const nearest=nav.pth.slice().sort((a,b)=>Math.hypot(a.position[0]-entryPoint[0],a.position[1]-entryPoint[1])-Math.hypot(b.position[0]-entryPoint[0],b.position[1]-entryPoint[1]))[0];
    spawn=project(nearest.position,nav,2,[nearest.room]);
  }
  if(!spawn)throw new Error('No source-valid WOK spawn near wp_pc_start');
  let walkerHit:Hit=spawn,walkerDistance=0,blockedCuts=0,teleports=0,roomTransitions=0,visited=new Set([spawn.room]);
  const validLinks=new Set(nav.roomLinks.map(x=>[x.fromRoom,x.toRoom].sort().join('|')));
  const walker=MeshBuilder.CreateCylinder('JediTechnicalWalker',{height:1.65,diameterTop:.3,diameterBottom:.4},scene);
  const walkerMat=new StandardMaterial('JediTechnicalWalkerMat',scene);
  walkerMat.disableLighting=true;walkerMat.emissiveColor=new Color3(1,.7,.2);walker.material=walkerMat;
  walker.position.copyFrom(toB(spawn.point).add(new Vector3(0,.83,0)));
  const pivot=toB(spawn.point);
  const orbit=new ArcRotateCamera('JediEnclaveOrbit',Math.PI/2,1.18,8,pivot.add(new Vector3(0,1,0)),scene);
  orbit.attachControl(canvas,true);orbit.lowerRadiusLimit=1;orbit.upperRadiusLimit=250;orbit.minZ=.05;orbit.maxZ=1000;
  const free=new FreeCamera('JediEnclaveFree',toB([spawn.point[0],spawn.point[1],spawn.point[2]+1.7]),scene);
  free.speed=.3;free.keysUp=[87];free.keysDown=[83];free.keysLeft=[65];free.keysRight=[68];
  let activeCamera:'ORBIT'|'FREE'='ORBIT';scene.activeCamera=orbit;
  const overlays:{[key:string]:Mesh[]}={WOK:[],PTH:[],DOORS:[],ENTITIES:[]};
  for(const room of nav.rooms)for(const face of room.faces){
    if(face.walkability!=='WALKABLE')continue;
    const color=new Color3(.2,.8,.4),v=face.vertices;
    for(let i=0;i<3;i++){const a=[v[i][0],v[i][1],v[i][2]+.035] as Point,b=[v[(i+1)%3][0],v[(i+1)%3][1],v[(i+1)%3][2]+.035] as Point;
      overlays.WOK.push(line(scene,'WOK_'+room.resref+'_'+face.face+'_'+i,a,b,color));}
  }
  for(const edge of nav.pthEdges){
    const a=nav.pth[edge.from].position,b=nav.pth[edge.to].position;
    overlays.PTH.push(line(scene,'PTH_'+edge.from+'_'+edge.to,[a[0],a[1],a[2]+.12],[b[0],b[1],b[2]+.12],new Color3(.95,.54,.16)));
  }
  for(const door of world.doors)if(door.position)overlays.DOORS.push(marker(scene,door.instanceId,door.position,new Color3(.85,.25,.2),.45));
  for(const p of world.placeables)if(p.position)overlays.ENTITIES.push(marker(scene,'SourcePlaceable',p.position,new Color3(.25,.7,1)));
  for(const p of world.npcMarkers)if(p.position)overlays.ENTITIES.push(marker(scene,'SourceNpcMarker',p.position,new Color3(.8,.45,1)));
  for(const p of world.triggers)if(p.position)overlays.ENTITIES.push(marker(scene,'SourceTrigger',p.position,new Color3(1,.85,.2)));
  const enabled={WOK:false,PTH:false,DOORS:false,ENTITIES:false,VIS:true,WALKER:false,HUD:true};
  const setOverlay=(key:'WOK'|'PTH'|'DOORS'|'ENTITIES',value:boolean)=>{enabled[key]=value;for(const m of overlays[key])m.setEnabled(value);};
  for(const key of ['WOK','PTH','DOORS','ENTITIES'] as const)setOverlay(key,false);
  walker.setEnabled(false);
  const ui=document.createElement('div');ui.id='jediAcademyLabPanel';
  ui.style.cssText='position:absolute;top:14px;left:14px;z-index:50;background:#101922e8;color:#f2ead4;padding:14px;border:1px solid #8c7650;border-radius:8px;font:13px system-ui;max-width:330px;max-height:90vh;overflow:auto';
  document.body.appendChild(ui);
  const title=document.createElement('div');title.textContent='KOTOR I · Jedi Enclave / danm13';title.style.cssText='font-weight:700;font-size:17px;margin-bottom:8px';ui.appendChild(title);
  const status=document.createElement('div');status.style.cssText='font:12px monospace;white-space:pre-wrap;margin:7px 0 10px';ui.appendChild(status);
  const controls=document.createElement('div');controls.style.cssText='display:grid;grid-template-columns:repeat(2,minmax(100px,1fr));gap:5px';ui.appendChild(controls);
  const button=(label:string,action:()=>void)=>{const b=document.createElement('button');b.textContent=label;b.style.cssText='background:#253847;color:#fff;border:1px solid #657f8a;border-radius:4px;padding:7px;cursor:pointer';b.onclick=action;controls.appendChild(b);return b;};
  const toggle=(key:'WOK'|'PTH'|'DOORS'|'ENTITIES')=>setOverlay(key,!enabled[key]);
  button('CLEAN',()=>{for(const key of ['WOK','PTH','DOORS','ENTITIES'] as const)setOverlay(key,false);enabled.WALKER=false;walker.setEnabled(false);enabled.HUD=false;ui.style.display='none';});
  button('DEBUG HUD',()=>{enabled.HUD=true;ui.style.display='block';});
  button('WOK / F2',()=>toggle('WOK'));button('PTH / F3',()=>toggle('PTH'));
  button('VIS / F4',()=>{enabled.VIS=!enabled.VIS;updateVis();});
  button('DOORS / F5',()=>toggle('DOORS'));
  button('SOURCE ENTITIES / F7',()=>toggle('ENTITIES'));
  button('WALKER',()=>{enabled.WALKER=!enabled.WALKER;walker.setEnabled(enabled.WALKER);});
  button('ORBIT / FREE',()=>{if(activeCamera==='ORBIT'){orbit.detachControl();free.position.copyFrom(orbit.position);scene.activeCamera=free;free.attachControl(canvas,true);activeCamera='FREE';}else{free.detachControl();scene.activeCamera=orbit;orbit.attachControl(canvas,true);activeCamera='ORBIT';}});
  const select=document.createElement('select');select.style.cssText='width:100%;margin-top:7px;padding:5px;background:#253847;color:white';
  for(const mode of ['combined','diffuse','lightmap','source','normals','uv0','uv1','class'] as JediEnclaveMaterialView[]){const o=document.createElement('option');o.value=mode;o.textContent='MATERIAL '+mode.toUpperCase();select.appendChild(o);}select.value='combined';
  select.onchange=()=>setJediEnclaveMaterialView(render,scene,select.value as JediEnclaveMaterialView);ui.appendChild(select);
  const roomSelect=document.createElement('select');roomSelect.style.cssText=select.style.cssText;
  for(const room of world.rooms.filter(r=>r.renderable)){const o=document.createElement('option');o.value=room.resref;o.textContent='ROOM '+room.resref;roomSelect.appendChild(o);}ui.appendChild(roomSelect);
  button('FOCUS ROOM',()=>{
    const room=world.rooms.find(r=>r.resref===roomSelect.value);if(!room?.renderBounds)return;
    const a=room.renderBounds.min,b=room.renderBounds.max,center:[number,number]=[(a[0]+b[0])/2,(a[1]+b[1])/2];
    const anchor=nav.pth.filter(n=>n.room===room.resref).sort((x,y)=>
      Math.hypot(x.position[0]-center[0],x.position[1]-center[1])-
      Math.hypot(y.position[0]-center[0],y.position[1]-center[1]))[0];
    if(!anchor)return;
    orbit.target.copyFrom(toB([anchor.position[0],anchor.position[1],anchor.position[2]+1.25]));
    orbit.radius=Math.min(10,Math.max(4,Math.min(b[0]-a[0],b[1]-a[1])*.28));
    updateVis();
  });
  const route=routes.routes.slice().sort((a,b)=>b.distance-a.distance)[0];
  function moveSample(p:Point):boolean{
    const allow=nav.rooms.map(r=>r.resref);
    const hit=project(p,nav,3,allow);
    if(!hit){blockedCuts++;return false;}
    if(hit.room!==walkerHit.room){const link=[hit.room,walkerHit.room].sort().join('|');if(!validLinks.has(link)){blockedCuts++;return false;}roomTransitions++;}
    walkerDistance+=Math.hypot(hit.point[0]-walkerHit.point[0],hit.point[1]-walkerHit.point[1]);
    walkerHit=hit;visited.add(hit.room);walker.position.copyFrom(toB(hit.point).add(new Vector3(0,.83,0)));
    if(activeCamera==='ORBIT')orbit.target.copyFrom(toB(hit.point).add(new Vector3(0,1,0)));
    return true;
  }
  function runSourceRoute(){
    if(!route?.pthNodes?.length)return {pass:false,reason:'NO_SOURCE_ROUTE'};
    const first=nav.pth[route.pthNodes[0]];
    const sameStart=Math.hypot(first.position[0]-walkerHit.point[0],first.position[1]-walkerHit.point[1])<5;
    if(!sameStart)return {pass:false,reason:'WALKER_NOT_AT_SOURCE_ROUTE_START',walker:walkerHit,routeStart:first};
    const before=walkerDistance,blockedBefore=blockedCuts;
    for(let i=0;i<route.pthNodes.length;i++){
      const target=nav.pth[route.pthNodes[i]];
      const a=walkerHit.point,b=target.position,d=Math.hypot(b[0]-a[0],b[1]-a[1]),steps=Math.max(1,Math.ceil(d/.1));
      for(let k=1;k<=steps;k++){
        const t=k/steps,p:[number,number,number]=[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t];
        if(!moveSample(p))return {pass:false,failedNode:target.id,blockedCuts:blockedCuts-blockedBefore,distance:walkerDistance-before,rooms:[...visited]};
      }
    }
    return {pass:walkerDistance-before>=100&&visited.size>=5&&blockedCuts===blockedBefore,
      distance:walkerDistance-before,rooms:[...visited],roomCount:visited.size,
      transitions:roomTransitions,blockedCuts:blockedCuts-blockedBefore,teleports};
  }
  button('RUN SOURCE ROUTE',()=>{enabled.WALKER=true;walker.setEnabled(true);(window as any).__jediAcademyRouteProof=runSourceRoute();});
  let visFallback=0,visRoom='';
  let lastPick:any=null;
  canvas.addEventListener('pointerup',ev=>{
    const rect=canvas.getBoundingClientRect();
    const hit=scene.pick(ev.clientX-rect.left,ev.clientY-rect.top,m=>render.includes(m as Mesh));
    const mesh=hit?.pickedMesh as Mesh|undefined;
    if(!mesh)return;
    lastPick={mesh:mesh.name,position:hit.pickedPoint?.asArray()??null,
      uv0:hit.getTextureCoordinates('uv')?.asArray()??null,
      uv1:hit.getTextureCoordinates('uv2')?.asArray()??null,
      sourceBinding:(mesh.metadata as any)?.__jediEnclaveBinding??null,
      material:mesh.material?.name??null};
  });
  function updateVis(){
    if(!enabled.VIS){for(const list of byRoom.values())for(const m of list)m.setEnabled(true);return;}
    const point=enabled.WALKER?walkerHit.point:fromB(activeCamera==='ORBIT'?orbit.target:free.position);
    const hit=project(point,nav,100),room=hit?.room??walkerHit.room;
    const visible=world.visibility[room];
    if(!visible){visFallback++;for(const list of byRoom.values())for(const m of list)m.setEnabled(true);return;}
    visRoom=room;const set=new Set([room,...visible]);
    for(const [name,list] of byRoom)for(const m of list)m.setEnabled(set.has(name));
  }
  let yaw=0,last=performance.now(),lastUi=0;
  const keys=new Set<string>();
  window.addEventListener('keydown',ev=>{
    if(/^F[1-7]$/.test(ev.key))ev.preventDefault();
    if(ev.key==='F1'){enabled.HUD=!enabled.HUD;ui.style.display=enabled.HUD?'block':'none';}
    if(ev.key==='F2')toggle('WOK');if(ev.key==='F3')toggle('PTH');
    if(ev.key==='F4'){enabled.VIS=!enabled.VIS;updateVis();}
    if(ev.key==='F5')toggle('DOORS');if(ev.key==='F7')toggle('ENTITIES');
    keys.add(ev.key.toLowerCase());
  });
  window.addEventListener('keyup',ev=>keys.delete(ev.key.toLowerCase()));
  const state=()=>({status:'READY',worldId:'jedi_enclave_danm13',module:'danm13',area:'m13aa',
    roomCount:world.rooms.length,renderedRooms:byRoom.size,meshCount:render.length,
    camera:{position:scene.activeCamera?.position.asArray(),target:orbit.target.asArray(),radius:orbit.radius},
    activeMeshes:scene.getActiveMeshes().length,enabledMeshes:render.filter(m=>m.isEnabled()).length,
    sampleMesh:{name:render[0]?.name,bounds:render[0]?.getBoundingInfo().boundingBox.centerWorld.asArray(),enabled:render[0]?.isEnabled(),visible:render[0]?.isVisible},
    materialStats,walker:{position:walkerHit.point,room:walkerHit.room,face:walkerHit.face,
      distance:walkerDistance,visitedRooms:[...visited],roomTransitions,blockedCuts,teleports},
    vis:{enabled:enabled.VIS,currentRoom:visRoom,fallbackCount:visFallback},
    visibleRooms:[...byRoom].filter(([,list])=>list.some(m=>m.isEnabled())).map(([name])=>name),
    lastPick,
    overlays:{...enabled},loadTimeMs:Math.round(performance.now()-started),fps:Math.round(engine.getFps()),
    consoleErrors:errors,routeProof:(window as any).__jediAcademyRouteProof??null});
  (window as any).__jediAcademyLabState=state;
  (window as any).__jediAcademyLabTest={state,runSourceRoute};
  updateVis();
  engine.runRenderLoop(()=>{
    const now=performance.now(),dt=Math.min(.05,(now-last)/1000);last=now;
    if(enabled.WALKER){
      if(keys.has('a'))yaw+=1.8*dt;if(keys.has('d'))yaw-=1.8*dt;
      const dir=(keys.has('w')?1:0)-(keys.has('s')?1:0);
      if(dir){const step=2.7*dt*dir,p=walkerHit.point;
        moveSample([p[0]+Math.cos(yaw)*step,p[1]+Math.sin(yaw)*step,p[2]]);}
    }
    if(now-lastUi>200){lastUi=now;updateVis();status.textContent=`Room: ${walkerHit.room} · VIS: ${visRoom}\nWalker: ${walkerDistance.toFixed(1)} m · ${visited.size} rooms\nMeshes: ${render.length} · FPS: ${Math.round(engine.getFps())}`;ui.dataset.state=JSON.stringify(state());}
    scene.render();
  });
  window.addEventListener('resize',()=>engine.resize());
  await scene.whenReadyAsync();
  overlay?.classList.add('is-hidden');
  return state();
}
