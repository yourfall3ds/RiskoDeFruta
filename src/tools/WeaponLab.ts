import {Engine} from '@babylonjs/core/Engines/engine';
import {Scene} from '@babylonjs/core/scene';
import {ArcRotateCamera} from '@babylonjs/core/Cameras/arcRotateCamera';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {Color4} from '@babylonjs/core/Maths/math.color';
import {HemisphericLight} from '@babylonjs/core/Lights/hemisphericLight';
import {DirectionalLight} from '@babylonjs/core/Lights/directionalLight';
import {HDRCubeTexture} from '@babylonjs/core/Materials/Textures/hdrCubeTexture';
import {LoadAssetContainerAsync} from '@babylonjs/core/Loading/sceneLoader';
import '@babylonjs/loaders/glTF';

const canvas=document.querySelector<HTMLCanvasElement>('#view')!;
const engine=new Engine(canvas,true),scene=new Scene(engine);
scene.useRightHandedSystem=true;
scene.clearColor=new Color4(.045,.055,.085,1);
const camera=new ArcRotateCamera('orbit',-Math.PI/2-.2,1.23,10,new Vector3(1,1,0),scene);
camera.lowerRadiusLimit=4;camera.upperRadiusLimit=17;camera.wheelPrecision=35;camera.attachControl(canvas,true);
const hemi=new HemisphericLight('fill',new Vector3(0,1,0),scene);hemi.intensity=.85;
const key=new DirectionalLight('key',new Vector3(-.3,-1,.7),scene);key.intensity=2;
scene.environmentTexture=new HDRCubeTexture('/environment/field-sky.hdr',scene,128,false,true,false,true);
scene.environmentIntensity=.55;
const status=document.querySelector<HTMLElement>('#status')!,title=document.querySelector<HTMLElement>('#mode')!;
const buttons=[...document.querySelectorAll<HTMLButtonElement>('button')];
const labels=['Assault rifle','Sniper','Lança-granadas'];
const phases=['Assault','Sniper','Grenade'];
const changes=['Assault_to_Sniper','Sniper_to_Grenade','Grenade_to_Assault'];
let mode=0,busy=false;
function state(){title.textContent=labels[mode]!;for(const b of buttons){b.disabled=busy;b.dataset.active=String(b.dataset.mode===String(mode));}}
buttons.forEach(b=>b.disabled=true);
try{
 const model=await LoadAssetContainerAsync('/models/weapons/prism-triform.glb',scene);model.addAllToScene();
 for(const group of model.animationGroups)group.stop();
 const byName=new Map(model.animationGroups.map(g=>[g.name,g]));
 const initial=byName.get('Assault_to_Sniper')!;initial.start(false);initial.goToFrame(initial.from);initial.pause();
 const play=(name:string)=>new Promise<void>((resolve,reject)=>{
  const group=byName.get(name);if(!group){reject(new Error(`Animação ausente: ${name}`));return;}
  for(const other of model.animationGroups)other.stop();
  group.onAnimationGroupEndObservable.addOnce(()=>resolve());group.start(false,1,group.from,group.to);
 });
 async function perform(action:()=>Promise<void>){if(busy)return;busy=true;state();try{await action();status.textContent='Pronta · 9 animações';}catch(e){status.textContent=String(e);}finally{busy=false;state();}}
 for(const button of buttons.filter(b=>b.dataset.mode!==undefined))button.onclick=()=>void perform(async()=>{
  const wanted=Number(button.dataset.mode);
  while(mode!==wanted){status.textContent='Transformando…';await play(changes[mode]!);mode=(mode+1)%3;state();}
 });
 document.querySelector<HTMLButtonElement>('#fire')!.onclick=()=>void perform(async()=>{status.textContent='Disparando…';await play(phases[mode]+'_Fire');});
 document.querySelector<HTMLButtonElement>('#reload')!.onclick=()=>void perform(async()=>{status.textContent='Recarregando…';await play(phases[mode]+'_Reload');});
 status.textContent='Pronta · 9 animações';state();
}catch(e){status.textContent='Falha ao carregar: '+String(e);}
engine.runRenderLoop(()=>scene.render());window.addEventListener('resize',()=>engine.resize());
