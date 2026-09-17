import {Engine} from '@babylonjs/core/Engines/engine';
import {Scene} from '@babylonjs/core/scene';
import {ArcRotateCamera} from '@babylonjs/core/Cameras/arcRotateCamera';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {Color4} from '@babylonjs/core/Maths/math.color';
import {HemisphericLight} from '@babylonjs/core/Lights/hemisphericLight';
import {DirectionalLight} from '@babylonjs/core/Lights/directionalLight';
import {HDRCubeTexture} from '@babylonjs/core/Materials/Textures/hdrCubeTexture';
import {LoadAssetContainerAsync} from '@babylonjs/core/Loading/sceneLoader';
import {GlowLayer} from '@babylonjs/core/Layers/glowLayer';
import {PBRMaterial} from '@babylonjs/core/Materials/PBR/pbrMaterial';
import {Texture} from '@babylonjs/core/Materials/Textures/texture';
import '@babylonjs/loaders/glTF';
import {PrismShotPreview,PRISM_SHOTS} from './PrismShotPreview';
import {PrismWeaponAudio,TRANSFORM_SOUNDS,type TransformSound,type PrismSound} from './PrismWeaponAudio';

const canvas=document.querySelector<HTMLCanvasElement>('#view')!;
const engine=new Engine(canvas,true),scene=new Scene(engine);
scene.useRightHandedSystem=true;
scene.clearColor=new Color4(.045,.055,.085,1);
const camera=new ArcRotateCamera('orbit',-Math.PI/2-.2,1.23,10,new Vector3(1,1,0),scene);
camera.lowerRadiusLimit=4;camera.upperRadiusLimit=26;camera.wheelPrecision=35;camera.attachControl(canvas,true);
const hemi=new HemisphericLight('fill',new Vector3(0,1,0),scene);hemi.intensity=.85;
const key=new DirectionalLight('key',new Vector3(-.3,-1,.7),scene);key.intensity=2;
scene.environmentTexture=new HDRCubeTexture('/environment/field-sky.hdr',scene,128,false,true,false,true);
scene.environmentIntensity=.55;
const glow=new GlowLayer('PRISM energy bloom',scene,{mainTextureFixedSize:512,blurKernelSize:32});
glow.intensity=.48;
const status=document.querySelector<HTMLElement>('#status')!,title=document.querySelector<HTMLElement>('#mode')!;
const buttons=[...document.querySelectorAll<HTMLButtonElement>('button')].filter(b=>b.id!=='pause');
const pause=document.querySelector<HTMLButtonElement>('#pause')!,scrub=document.querySelector<HTMLInputElement>('#scrub')!;
const labels=['Assault rifle','Sniper','Lança-granadas'];
const phases=['Assault','Sniper','Grenade'];
const changes=['Assault_to_Sniper','Sniper_to_Grenade','Grenade_to_Assault'];
let mode=0,busy=false;
function state(){title.textContent=labels[mode]!;document.querySelector('#shot-description')!.textContent=PRISM_SHOTS[mode]!.name+' · '+PRISM_SHOTS[mode]!.detail;for(const b of buttons){b.disabled=busy;b.dataset.active=String(b.dataset.mode===String(mode));}}
buttons.forEach(b=>b.disabled=true);
try{
 const model=await LoadAssetContainerAsync('/models/weapons/prism-triform.glb?v=fitted-magazine-5',scene);model.addAllToScene();
 const shots=await PrismShotPreview.create(scene);
 const audio=new PrismWeaponAudio();await audio.load();
 const soundChoice=document.querySelector<HTMLSelectElement>('#transform-sound')!;
 let transformSound:TransformSound='user-transform';
 try{const saved=localStorage.getItem('prism-transform-sound');if(TRANSFORM_SOUNDS.includes(saved as TransformSound))transformSound=saved as TransformSound;}catch{}
 soundChoice.value=transformSound;
 soundChoice.onchange=()=>{transformSound=soundChoice.value as TransformSound;audio.stop();try{localStorage.setItem('prism-transform-sound',transformSound);}catch{}};
 const volume=document.querySelector<HTMLInputElement>('#volume')!;
 volume.oninput=()=>audio.volume(Number(volume.value)/100);
 const speed=()=>Number(document.querySelector<HTMLSelectElement>('#speed')!.value);
 shots.onImpact=mode=>audio.play((['impact-small','impact-ion','explosion'] as const)[mode]!,speed());
 const muzzle=model.transformNodes.find(n=>n.name==='SOCKET_muzzle')!;
 const charge=model.transformNodes.find(node=>node.name==='FX_charge');
 const luminous=model.materials.filter((material):material is PBRMaterial=>material instanceof PBRMaterial&&material.emissiveColor.r+material.emissiveColor.g+material.emissiveColor.b>0);
 const baseline=luminous.map(material=>material.emissiveColor.clone());
 // Keep the atlas sampling inside the liquid quadrant; never move shared metal UVs.
 const liquids=luminous.filter(m=>m.name.startsWith('06')||m.name.startsWith('07')).map(material=>{
  const source=material.albedoTexture;
  if(!(source instanceof Texture))return undefined;
  const texture=source.clone();if(!texture)return undefined;
  material.albedoTexture=texture;material.emissiveTexture=texture;
  return {texture,u:texture.uOffset,v:texture.vOffset};
 });
 let flowTime=0;
 scene.onBeforeRenderObservable.add(()=>{
  flowTime+=Math.min(engine.getDeltaTime(),50)/1000;
  for(const liquid of liquids)if(liquid){liquid.texture.uOffset=liquid.u+Math.sin(flowTime*.38)*.012;liquid.texture.vOffset=liquid.v+Math.cos(flowTime*.29)*.012;}
  const energy=Math.max(0,Math.min(1,charge?.position.x??0));
  glow.intensity=.48+energy*.9;
  luminous.forEach((material,i)=>baseline[i]!.scaleToRef(1+energy*2,material.emissiveColor));
 });
 for(const group of model.animationGroups)group.stop();
 const byName=new Map(model.animationGroups.map(g=>[g.name,g]));
 let active:typeof model.animationGroups[number]|undefined;
 let cues:Array<{at:number;sound:PrismSound;played:boolean}>=[];
 scene.onBeforeRenderObservable.add(()=>{
  const paused=active&&!active.isPlaying;
  if(!paused)shots.update(Math.min(engine.getDeltaTime(),50)/1000*Number(document.querySelector<HTMLSelectElement>('#speed')!.value));
  if(active?.isPlaying){
   const progress=(active.getCurrentFrame()-active.from)/(active.to-active.from);
   for(const cue of cues)if(!cue.played&&progress>=cue.at){cue.played=true;audio.play(cue.sound,speed());}
  }
 });
 pause.disabled=true;scrub.disabled=true;
 pause.onclick=()=>{if(!active)return;if(active.isPlaying){active.pause();audio.stop();pause.textContent='Continuar';}else{active.play(false);pause.textContent='Pausar';}};
 scrub.oninput=()=>{if(!active)return;active.pause();audio.stop();const t=Number(scrub.value)/100;active.goToFrame(active.from+(active.to-active.from)*t);for(const cue of cues)cue.played=cue.at<=t;pause.textContent='Continuar';};
 const initial=byName.get('Assault_to_Sniper')!;initial.start(false);initial.goToFrame(initial.from);initial.pause();
 const play=(name:string,rate=1)=>new Promise<void>((resolve,reject)=>{
  const group=byName.get(name);if(!group){reject(new Error(`Animação ausente: ${name}`));return;}
  for(const other of model.animationGroups)other.stop();
  const sequence:Array<[number,PrismSound]>=name.endsWith('Reload')?[[.10,'eject'],[.34,'servo'],[.9,'insert'],[.97,'lock']]:name.includes('_to_')?[[0,transformSound]]:[[0,(['assault','sniper','grenade'] as const)[mode]!]];
  cues=sequence.map(([at,sound])=>({at,sound,played:false}));
  active=group;pause.disabled=false;scrub.disabled=false;pause.textContent='Pausar';scrub.value='0';
  group.onAnimationGroupEndObservable.addOnce(()=>{
   if(name.includes('_to_'))audio.stop();
   else for(const cue of cues)if(!cue.played&&cue.at>=.85){cue.played=true;audio.play(cue.sound,speed());}
   active=undefined;pause.disabled=true;scrub.disabled=true;pause.textContent='Pausar';resolve();
  });group.start(false,rate*Number(document.querySelector<HTMLSelectElement>('#speed')!.value),group.from,group.to);
 });
 async function perform(action:()=>Promise<void>){if(busy)return;busy=true;state();try{await audio.resume();await action();status.textContent='Pronta · 9 animações';}catch(e){status.textContent=String(e);}finally{busy=false;state();}}
 for(const button of buttons.filter(b=>b.dataset.mode!==undefined))button.onclick=()=>void perform(async()=>{
  const wanted=Number(button.dataset.mode);
  camera.setTarget(new Vector3(1,1,0));camera.radius=10;
  while(mode!==wanted){status.textContent='Transformando…';await play(changes[mode]!);mode=(mode+1)%3;state();}
 });
 document.querySelector<HTMLButtonElement>('#fire')!.onclick=()=>void perform(async()=>{
  status.textContent=PRISM_SHOTS[mode]!.name;
  camera.setTarget(new Vector3(4,1,0));camera.radius=18;
  for(let i=0;i<(mode===0?3:1);i++){
   muzzle.computeWorldMatrix(true);
   shots.fire(mode,muzzle.getAbsolutePosition().clone(),Vector3.TransformNormal(Vector3.Right(),muzzle.getWorldMatrix()).normalize());
   await play(phases[mode]+'_Fire',mode===0?3:1);
  }
 });
 document.querySelector<HTMLButtonElement>('#reload')!.onclick=()=>void perform(async()=>{status.textContent='Recarregando…';await play(phases[mode]+'_Reload');});
 document.querySelector<HTMLButtonElement>('#impact')!.onclick=()=>void perform(async()=>{camera.setTarget(new Vector3(4,1,0));camera.radius=18;shots.impact(mode,new Vector3(8,1,0),Vector3.Right());});
 document.querySelector<HTMLButtonElement>('#listen-transform')!.onclick=()=>void perform(async()=>{audio.stop();audio.play(transformSound);});
 document.querySelector<HTMLButtonElement>('#stop-sound')!.onclick=()=>audio.stop();
 status.textContent='Pronta · 9 animações';state();
}catch(e){status.textContent='Falha ao carregar: '+String(e);}
engine.runRenderLoop(()=>scene.render());window.addEventListener('resize',()=>engine.resize());




