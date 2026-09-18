import {LoadAssetContainerAsync} from '@babylonjs/core/Loading/sceneLoader';
import {TransformNode} from '@babylonjs/core/Meshes/transformNode';
import {Matrix,Quaternion,Vector3} from '@babylonjs/core/Maths/math.vector';
import type {Scene} from '@babylonjs/core/scene';
import type {AssetContainer} from '@babylonjs/core/assetContainer';
import type {AnimationGroup} from '@babylonjs/core/Animations/animationGroup';
import {PBRMaterial} from '@babylonjs/core/Materials/PBR/pbrMaterial';
import type {Color3} from '@babylonjs/core/Maths/math.color';
import type {CharacterVisual} from '../animation/CharacterVisual';
import {PrismWeaponAudio,type PrismSound} from '../tools/PrismWeaponAudio';

const PHASES=['Assault','Sniper','Grenade'] as const;
const CHANGES=['Assault_to_Sniper','Sniper_to_Grenade','Grenade_to_Assault'] as const;
/** Authored weapon presentation, sampled by game time rather than a second animation clock. */
export class PrismRig {
 readonly root:TransformNode;
 ready=false;
 mode:0|1|2=0;
 private visible=false;
 private disposed=false;
 private asset:AssetContainer|undefined;
 private audio:PrismWeaponAudio|undefined;
 private clips=new Map<string,AnimationGroup>();
 private active:AnimationGroup|undefined;
 private action:'idle'|'fire'|'transform'|'reload'='idle';
 private clock=0;
 private reloadPosition=-1;
 private muzzleNode:TransformNode|undefined;
 private support:TransformNode|undefined;
 private magazine:TransformNode|undefined;
 private aligned=false;
 private charge:TransformNode|undefined;
 private luminous:{material:PBRMaterial;base:Color3}[]=[];
 private volume=.55;
 constructor(private scene:Scene,private visual:CharacterVisual){this.root=new TransformNode('prism-equipped',scene);this.root.setEnabled(false);}
 get busy():boolean{return this.action==='transform';}
 get enabled():boolean{return this.visible;}
 set enabled(value:boolean){const changed=this.visible!==value;this.visible=value;this.visual.rifleEquipped=value;this.root.setEnabled(value&&this.ready);if(changed&&!value)this.audio?.stop();}
 get muzzle():Vector3|undefined {this.muzzleNode?.computeWorldMatrix(true);return this.muzzleNode?.getAbsolutePosition().clone();}
 async load():Promise<void>{
  const asset=await LoadAssetContainerAsync('/models/weapons/prism-triform.glb?v=fitted-magazine-5',this.scene);
  if(this.disposed){asset.dispose();return;}
  this.asset=asset;asset.addAllToScene();
  for(const node of asset.rootNodes)node.parent=this.root;
  for(const mesh of asset.meshes){mesh.isPickable=false;mesh.receiveShadows=true;}
  for(const clip of asset.animationGroups){clip.stop();this.clips.set(clip.name,clip);}
  this.muzzleNode=asset.transformNodes.find(n=>n.name==='SOCKET_muzzle');
  this.support=asset.transformNodes.find(n=>n.name==='SOCKET_hand_L');
  this.magazine=asset.transformNodes.find(n=>n.name==='Magazine_reload');
  this.charge=asset.transformNodes.find(n=>n.name==='FX_charge');
  this.luminous=asset.materials.filter((m):m is PBRMaterial=>m instanceof PBRMaterial&&m.emissiveColor.r+m.emissiveColor.g+m.emissiveColor.b>0).map(material=>({material,base:material.emissiveColor.clone()}));
  this.root.scaling.setAll(.16);
  // Babylon's left-handed glTF conversion reflects X: -X becomes grip +Z.
  this.root.rotationQuaternion=Quaternion.RotationYawPitchRoll(Math.PI/2,0,0);
  this.ready=true;this.setMode(0);this.root.setEnabled(this.visible);
  this.audio=new PrismWeaponAudio();
  this.audio.volume(this.volume);
  try{await this.audio.load();}catch(error){console.warn('PRISM audio unavailable',error);}
 }
 private sample(name:string,progress:number):void {
  const group=this.clips.get(name);if(!group)return;
  if(this.active!==group){this.active?.stop();group.start(false);group.pause();this.active=group;}
  group.goToFrame(group.from+(group.to-group.from)*Math.max(0,Math.min(1,progress)));
 }
 private sound(name:PrismSound):void {void this.audio?.resume().then(()=>{if(!this.disposed&&this.visible)this.audio?.play(name);}).catch(()=>{});}
 private idle():void {this.sample(CHANGES[this.mode],0);}
 setMode(mode:0|1|2):void {this.mode=mode;this.action='idle';this.clock=0;this.reloadPosition=-1;this.audio?.stop();this.idle();}
 transform():boolean {
  if(!this.ready||!this.visible||this.busy||this.action==='reload')return false;
  this.audio?.stop();this.action='transform';this.clock=0;this.sample(CHANGES[this.mode],0);this.sound('user-transform');return true;
 }
 fire():void {if(!this.ready||!this.visible||this.busy)return;this.action='fire';this.clock=0;this.sample(PHASES[this.mode]+'_Fire',0);this.sound((['assault','sniper','grenade'] as const)[this.mode]);}
 impact(mode:0|1|2):void {void this.audio?.resume().then(()=>{if(!this.disposed)this.audio?.play((['impact-small','impact-ion','explosion'] as const)[mode]);}).catch(()=>{});}
 setVolume(value:number):void {this.volume=Math.max(0,Math.min(1,value));this.audio?.volume(this.volume);}
 stopAudio():void {this.audio?.stop();}
 reload(progress:number):void {
  if(this.busy)return;
  if(progress<0){if(this.action==='reload'){this.action='idle';this.idle();}this.reloadPosition=-1;return;}
  if(!this.ready||!this.visible)return;
  for(const [at,sound] of [[.1,'eject'],[.34,'servo'],[.9,'insert'],[.97,'lock']] as const)if(this.reloadPosition<at&&progress>=at)this.sound(sound);
  this.reloadPosition=progress;this.action='reload';this.sample(PHASES[this.mode]+'_Reload',progress);
 }
 update(dt:number):void {
  if(!this.ready||!this.visible)return;
  const grip=this.visual.grips[0];if(!grip)return;
  this.visual.poseRifleGrip();
  this.root.parent=grip;
  if(!this.aligned){
   this.root.position.setAll(0);this.root.computeWorldMatrix(true);
   const socket=this.asset?.transformNodes.find(n=>n.name==='SOCKET_hand_R');
   if(socket){socket.position.x=-.5;socket.computeWorldMatrix(true);this.root.position.copyFrom(Vector3.TransformCoordinates(socket.getAbsolutePosition(),Matrix.Invert(grip.computeWorldMatrix(true))).negate());}
   this.aligned=true;
  }
  if(this.action==='fire'||this.action==='transform'){
   const transforming=this.action==='transform';
   const name=transforming?CHANGES[this.mode]:PHASES[this.mode]+'_Fire';
   const clip=this.clips.get(name);const fps=clip?.targetedAnimations[0]?.animation.framePerSecond??30;
   const duration=clip?(clip.to-clip.from)/fps:1;
   this.clock+=Math.max(0,dt);this.sample(name,this.clock/duration);
   if(this.clock>=duration){if(transforming){this.audio?.stop();this.mode=((this.mode+1)%3) as 0|1|2;}this.action='idle';this.idle();}
  }
  this.root.computeWorldMatrix(true);
  const energy=Math.max(0,Math.min(1,this.charge?.position.x??0));
  for(const {material,base} of this.luminous)base.scaleToRef(1+energy*2,material.emissiveColor);
  if(this.support){
   this.support.computeWorldMatrix(true);const target=this.support.getAbsolutePosition().clone();
   if(this.action==='reload'&&this.magazine){
    this.magazine.computeWorldMatrix(true);
    const p=this.reloadPosition,t=Math.max(0,Math.min(1,p/.18,(1-p)/.12)),blend=t*t*(3-2*t);
    Vector3.LerpToRef(target,this.magazine.getAbsolutePosition(),blend,target);
   }
   const direction=Vector3.TransformNormal(Vector3.Forward(),grip.getWorldMatrix()).normalize();this.visual.poseRifleSupport(target,direction);
  }
 }
 reset():void {this.setMode(0);this.aligned=false;}
 dispose():void {this.disposed=true;this.audio?.dispose();this.asset?.dispose();this.root.dispose();this.visual.rifleEquipped=false;}
}
