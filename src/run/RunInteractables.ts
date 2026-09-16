import {waveRewardSite} from './WaveRewardSite';
import {resolveRewardPlacement,type RewardSource} from './RewardAnchor';
import type {Vec3} from '../core/contracts';
import {DistrictContracts} from './DistrictContracts';
import {BARN_CHESTS,barnChestColliders,CITY_CHESTS,cityChestColliders,FRONTIER_CHESTS,frontierChestColliders,HIGHLAND_CHESTS,highlandChestColliders,ROOTWOOD_CHESTS,rootwoodChestColliders} from '../world/ExplorationSites';
import type {BoxCollider} from '../physics/CollisionWorld';
import {LootDrops} from './LootDrops';
import type {CollisionWorld} from '../physics/CollisionWorld';
import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader';
import type { AssetContainer } from '@babylonjs/core/assetContainer';
import type {AnimationGroup} from '@babylonjs/core/Animations/animationGroup';
import {Quaternion,Vector3} from '@babylonjs/core/Maths/math.vector';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { CreateTorus } from '@babylonjs/core/Meshes/Builders/torusBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { PointLight } from '@babylonjs/core/Lights/pointLight';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { CreateDisc } from '@babylonjs/core/Meshes/Builders/discBuilder';
import type { Scene } from '@babylonjs/core/scene';
import type { PlayerMotor } from '../player/PlayerMotor';
import type { EventBus } from '../core/EventBus';
import type { GameEvents } from '../core/contracts';
import type { RandomStream } from '../core/RunRNG';
import { type ItemDefinition,type RunProgression } from './RunProgression';

export interface Interactable {id:string;name:string;kind:'supply'|'shop'|'altar';x:number;z:number;y:number;cost:number;used:boolean;loot?:ItemDefinition;ejected?:boolean;root?:TransformNode;openClips?:AnimationGroup[];opening?:number}
export class RunInteractables {
  readonly entries:Interactable[]=[];nearest:Interactable|undefined;message='';messageTime=0;ready=false;error='';private disposed=false;private rewardRetry=0;
  private readonly rift:TransformNode;private riftLight:PointLight;private time=0;
  readonly drops:LootDrops;
  readonly contracts=new DistrictContracts();
  get districtContract(){return this.contracts.nearest(this.player.position);}
  get waveRewardGuide(){
    const drop=this.drops.active.filter(d=>d.waveField).sort((a,b)=>Math.hypot(a.landing.x-this.player.position.x,a.landing.z-this.player.position.z)-Math.hypot(b.landing.x-this.player.position.x,b.landing.z-this.player.position.z))[0];
    return drop?{drop,distance:Math.hypot(drop.landing.x-this.player.position.x,drop.landing.z-this.player.position.z)}:undefined;
  }
  get nearestLoot(){return this.drops.nearest(this.player.position);}
  private readonly extraColliders:BoxCollider[]=[];
  private container:AssetContainer|undefined;
  private altarContainer:AssetContainer|undefined;
  private portal:ShaderMaterial;
  constructor(scene:Scene,private readonly player:PlayerMotor,private readonly run:RunProgression,private readonly events:EventBus<GameEvents>,private readonly rng:RandomStream,private readonly world:CollisionWorld){
    this.drops=new LootDrops(scene,world);
    for(const [index,x,z,y,kind] of [[0,-5,-13,0,'supply'],[1,5,1,0,'shop'],[2,-9,29,5,'altar'],[3,7,29,5,'supply'],[4,-45,3,0,'supply'],[5,44,10,2,'shop']] as const){this.entries.push({id:`${kind}-${index}`,name:kind==='supply'?'Caixa de suprimentos':kind==='shop'?'Baú reforçado':'Altar de risco',kind,x,z,y,cost:kind==='altar'?25:kind==='shop'?45:30,used:false});}
    for(const site of [...CITY_CHESTS,...FRONTIER_CHESTS,...HIGHLAND_CHESTS,...ROOTWOOD_CHESTS,...BARN_CHESTS])this.entries.push({...site,name:site.kind==='shop'?'Baú reforçado':'Caixa de suprimentos',cost:site.kind==='shop'?45:30,used:false});
    this.extraColliders.push(...cityChestColliders(),...frontierChestColliders(),...highlandChestColliders(),...rootwoodChestColliders(),...barnChestColliders());world.movingBoxes.push(...this.extraColliders);
    this.rift=new TransformNode('stage-wormhole',scene);this.rift.position.set(0,7.6,33);const material=new StandardMaterial('rift-energy',scene);material.emissiveColor=new Color3(.34,.07,1);material.disableLighting=true;
    for(let i=0;i<4;i++){const ring=CreateTorus('wormhole-ring',{diameter:4+i*.13,thickness:.065,tessellation:80},scene);ring.parent=this.rift;ring.rotation.x=Math.PI/2+i*.08;ring.material=material;ring.isPickable=false;}
    this.portal=new ShaderMaterial('wormhole-depth',scene,{vertexSource:'precision highp float;attribute vec3 position;attribute vec2 uv;uniform mat4 worldViewProjection;varying vec2 vUV;void main(){vUV=uv;gl_Position=worldViewProjection*vec4(position,1.0);}',fragmentSource:'precision highp float;varying vec2 vUV;uniform sampler2D cosmos;uniform float time;void main(){vec2 p=(vUV-.5)*2.;float r=length(p);float a=atan(p.y,p.x)+time*.15-r*5.;vec2 q=vec2(.36,.27)+vec2(cos(a),sin(a))*(.04+r*.1);vec3 c=texture2D(cosmos,q).rgb;float rim=pow(r,6.);c=c*vec3(.28,.18,.5)+vec3(.18,.015,.45)*rim;gl_FragColor=vec4(c,1.-smoothstep(.95,1.,r));}'},{attributes:['position','uv'],uniforms:['worldViewProjection','time'],samplers:['cosmos'],needAlphaBlending:true});this.portal.backFaceCulling=false;this.portal.setTexture('cosmos',new Texture('/environment/cosmic-sky-v3.png',scene));
    const depth=CreateDisc('wormhole-inner-depth',{radius:2.13,tessellation:80},scene);depth.parent=this.rift;depth.material=this.portal;depth.isPickable=false;
    this.riftLight=new PointLight('wormhole-light',this.rift.position.clone(),scene);this.riftLight.diffuse=new Color3(.53,.19,1);this.riftLight.range=12;this.riftLight.intensity=0;this.rift.setEnabled(false);
  }
  async load(scene:Scene):Promise<void>{try{
    const crate=await LoadAssetContainerAsync('/models/interactive-chest.glb',scene);if(this.disposed){crate.dispose();return;}this.container=crate;
    const altar=await LoadAssetContainerAsync('/models/farm-barrels.glb',scene);if(this.disposed){altar.dispose();return;}this.altarContainer=altar;
    const offering=new StandardMaterial('offering-energy',scene);offering.emissiveColor=new Color3(.44,.08,.75);offering.disableLighting=true;
    for(const entry of this.entries){const root=new TransformNode(entry.id,scene);entry.openClips=[];entry.opening=0;root.position.set(entry.x,entry.y,entry.z);
      for(let i=0;i<1;i++){const instance=(entry.kind==='altar'?altar:crate).instantiateModelsToScene(n=>`${entry.id}-${i}-${n}`,false);for(const clip of instance.animationGroups){clip.stop();entry.openClips.push(clip);}for(const child of instance.rootNodes){child.parent=root;}}
      if(entry.kind==='altar'){const halo=CreateTorus('altar-offering',{diameter:1.45,thickness:.035,tessellation:36},scene);halo.parent=root;halo.position.y=1.55;halo.material=offering;}
      entry.root=root;for(const mesh of root.getChildMeshes()){mesh.isPickable=false;mesh.receiveShadows=true;}
    }this.ready=true;
  }catch(error){this.error=String(error);}}
  private lid(entry:Interactable,progress:number):void{for(const clip of entry.openClips??[])for(const track of clip.targetedAnimations){const value=track.animation.evaluate(clip.from+(clip.to-clip.from)*progress);if(value instanceof Quaternion)track.target.rotationQuaternion=value.clone();else if(value instanceof Vector3)track.target.position.copyFrom(value);}}
  update(dt:number,riftReady:boolean):void {this.rewardRetry=Math.max(0,this.rewardRetry-dt);for(const e of this.entries)if(e.used&&(e.opening??0)<1){e.opening=Math.min(1,(e.opening??0)+dt/ .8);this.lid(e,e.opening);if(e.opening>=.4&&e.loot&&!e.ejected){this.drops.eject(e.loot,{x:e.x,y:e.y,z:e.z},this.player.position);e.ejected=true;}}this.drops.update(dt);this.time+=dt;this.portal.setFloat('time',this.time);this.messageTime=Math.max(0,this.messageTime-dt);this.nearest=this.entries.filter(e=>!e.used&&Math.hypot(e.x-this.player.position.x,e.z-this.player.position.z)<3&&Math.abs(e.y-this.player.position.y)<2).sort((a,b)=>Math.hypot(a.x-this.player.position.x,a.z-this.player.position.z)-Math.hypot(b.x-this.player.position.x,b.z-this.player.position.z))[0];this.rift.setEnabled(riftReady);this.riftLight.intensity=riftReady?3:0;if(riftReady){this.rift.rotation.z=this.time*.16;this.rift.scaling.setAll(1+Math.sin(this.time*2)*.025);}}
  /**
   * A recompensa cai onde morreu o monstro que concluiu o evento; se aquele ponto não tiver piso
   * seguro (morte no ar, em beirada), escorrega para o anel seguro mais próximo. Sem abate válido
   * — evento concluído só por tempo — usa a âncora do objetivo e, por último, o campo mais próximo.
   * Nada disso exige eliminar todos os inimigos.
   */
  deliverWaveReward(rng:RandomStream,anchors:{position:Vec3|undefined;source:RewardSource}[]=[]):boolean {
    if(this.rewardRetry>0)return false;
    const placement=resolveRewardPlacement(this.world,anchors);
    const site=placement?{name:placement.source==='kill'?'Onde a praga caiu':'Área do objetivo',position:placement.position}:waveRewardSite(this.world,this.player.position);
    if(!site){this.rewardRetry=1;return false;}
    const item=this.run.randomItem(rng);
    this.drops.eject(item,site.position,{x:site.position.x,y:site.position.y,z:site.position.z+1}).waveField=site.name;
    this.message='RECOMPENSA · '+site.name+' · recolha '+item.name+' no chão';this.messageTime=7;
    return true;
  }
  reset():void {this.rewardRetry=0;this.contracts.reset();this.drops.clear();this.nearest=undefined;this.messageTime=0;for(const e of this.entries){e.used=false;e.opening=0;delete e.loot;e.ejected=false;this.lid(e,0);e.cost=Math.round((e.kind==='altar'?25:e.kind==='shop'?45:30)*(1+(this.run.stage-1)*.3));}this.rift.setEnabled(false);}
  get atRift():boolean{return Math.hypot(this.player.position.x,this.player.position.z-33)<3&&this.player.position.y>3;}
  buy(_option=0):boolean {
    const collected=this.drops.take(this.player.position);
    if(collected){this.run.addItem(collected.id);this.message=collected.name+' recolhido';this.messageTime=3;return true;}
    const entry=this.nearest;
    if(!entry||entry.used||Math.hypot(entry.x-this.player.position.x,entry.z-this.player.position.z)>=3||Math.abs(entry.y-this.player.position.y)>=2)return false;
    if(this.run.credits<entry.cost){this.message='Créditos insuficientes';this.messageTime=2;return false;}
    this.run.credits-=entry.cost;
    if(entry.kind==='altar'){entry.cost=Math.ceil(entry.cost*1.6);if(this.rng.next()<.58){const item=this.run.randomItem(this.rng);this.drops.eject(item,{x:entry.x,y:entry.y,z:entry.z},this.player.position);this.message='O altar concedeu um item';}else this.message='O altar consumiu a oferta';}
    else{entry.used=true;entry.opening=0;entry.ejected=false;entry.loot=this.run.randomItem(this.rng);this.message='Baú aberto · recolha o item quando cair';}
    if(entry.kind!=='altar'){const contract=this.contracts.recordOpened(entry.id);if(contract){const reward=this.run.randomItem(this.rng);this.drops.eject(reward,{x:entry.x,y:entry.y,z:entry.z},{x:2*entry.x-this.player.position.x,y:entry.y,z:2*entry.z-this.player.position.z});this.message=contract.name+' · contrato concluído! Recolha o item bônus no chão';}}
    this.events.emit('InteractableUsed',{entityId:1,interactableId:entry.id});this.messageTime=3;return true;
  }
  dispose():void {this.disposed=true;for(const box of this.extraColliders){const index=this.world.movingBoxes.indexOf(box);if(index>=0)this.world.movingBoxes.splice(index,1);}this.drops.dispose();for(const e of this.entries)e.root?.dispose();this.container?.dispose();this.altarContainer?.dispose();this.rift.dispose();this.riftLight.dispose();}
}





