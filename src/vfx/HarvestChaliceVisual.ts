import {LoadAssetContainerAsync} from '@babylonjs/core/Loading/sceneLoader';
import type {AssetContainer} from '@babylonjs/core/assetContainer';
import type {Scene} from '@babylonjs/core/scene';
import type {AbstractMesh} from '@babylonjs/core/Meshes/abstractMesh';
import type {Mesh} from '@babylonjs/core/Meshes/mesh';
import type {Material} from '@babylonjs/core/Materials/material';
import {TransformNode} from '@babylonjs/core/Meshes/transformNode';
import {Matrix,Quaternion,Vector3} from '@babylonjs/core/Maths/math.vector';
import {Color3} from '@babylonjs/core/Maths/math.color';
import type {Vec3} from '../core/contracts';

export const CHALICE_MODEL_URL='/models/harvest-chalice.glb';
export const CHALICE_CONCEPT_IMAGE='/images/objectives/harvest-chalice-concept.png';

/** Nós autorais do GLB (scripts/build-harvest-chalice.py). */
export const CHALICE_NODES={root:'HarvestChalice',bowl:'ChaliceCrystalBowl',frame:'ChaliceBrassFrame',juice:'ChaliceJuice',droplet:'ChaliceDroplet',rim:'ChaliceRimAnchor',floor:'ChaliceJuiceFloorAnchor',glow:'ChaliceGlowAnchor'} as const;
/** Morph targets do líquido, do vazio ao cheio. */
export const CHALICE_MORPHS=['Fill20','Fill40','Fill60','Fill80','Fill100'] as const;
/**
 * Altura da superfície do suco em unidades do modelo. Índice 0 é a malha base (vazio) e cada
 * índice seguinte é o morph correspondente. Os degraus são proporcionais a VOLUME, não a altura:
 * numa taça que abre para cima o nível sobe depressa no começo e devagar no fim.
 * Espelha docs/harvest-chalice-asset.json — o teste de asset compara os dois.
 */
export const CHALICE_FILL_LEVELS=[.682,.9246,1.0414,1.1366,1.2213,1.3] as const;
export const CHALICE_RIM_HEIGHT=1.543;

const DROP_CAPACITY=28;          // teto rígido do pool de gotas; nada aloca depois da carga
const DROP_SECONDS=.62;
const DROP_ARC=1.15;
const FILL_SMOOTH=1.9;           // fração de enchimento por segundo na animação de acompanhamento
const PULSE_SECONDS=1.2;

export interface ChaliceVisualOptions {
  /** Padrão `CHALICE_MODEL_URL`. Aceita buffer para carga offline/teste. */
  source?:string|ArrayBufferView;
  /** Necessário quando `source` é buffer (ex.: `.glb`). */
  pluginExtension?:string;
  scale?:number;
  dropCapacity?:number;
}

interface Drop {from:Vector3;time:number;spin:number;size:number}

/**
 * Apresentação isolada do cálice da colheita.
 *
 * Só desenha: não conta mortes, não decide conclusão, não conhece objetivos. Quem integra chama
 * `setFill` com o valor autoritativo (suco/meta) e `splash` por morte creditada. Se o GLB demorar
 * ou falhar, todos os métodos continuam seguros e o progresso do marco não depende deste módulo.
 */
export class HarvestChaliceVisual {
  readonly root:TransformNode;
  ready=false;
  error='';
  private readonly source:string|ArrayBufferView;
  private readonly pluginExtension:string|undefined;
  private readonly scale:number;
  private readonly capacity:number;
  private container:AssetContainer|undefined;
  private loading:Promise<boolean>|undefined;
  private disposed=false;
  private juice:Mesh|undefined;
  private droplet:Mesh|undefined;
  private juiceMaterial:Material|undefined;
  private baseEmissive=Color3.Black();
  private matrices:Float32Array;
  private readonly pool:Drop[];
  private live=0;
  private readonly rimLocal=new Vector3(0,CHALICE_RIM_HEIGHT,0);
  private readonly rimWorld=new Vector3();
  private target=0;
  private shown=0;
  private pulseTime=0;
  private readonly scratch=Matrix.Identity();
  private readonly position=new Vector3();
  private readonly scaling=new Vector3();
  private readonly rotation=Quaternion.Identity();

  constructor(scene:Scene,options:ChaliceVisualOptions={}){
    this.source=options.source??CHALICE_MODEL_URL;
    this.pluginExtension=options.pluginExtension;
    this.scale=options.scale??1;
    this.capacity=Math.max(1,Math.floor(options.dropCapacity??DROP_CAPACITY));
    this.matrices=new Float32Array(this.capacity*16);
    // Pool fechado: as gotas são reaproveitadas, nada é alocado durante o combate.
    this.pool=Array.from({length:this.capacity},()=>({from:new Vector3(),time:0,spin:0,size:1}));
    // Nó vazio desde o primeiro quadro: nada de proxy branco enquanto o GLB não chega.
    this.root=new TransformNode('harvest-chalice',scene);
    this.root.scaling.setAll(this.scale);
  }

  /** Fração exibida (suavizada). */
  get fill():number{return this.shown;}
  /** Fração pedida pela lógica do marco. */
  get requestedFill():number{return this.target;}
  get activeDrops():number{return this.live;}
  get dropCapacity():number{return this.capacity;}

  /** Posiciona o cálice. Vale antes ou depois da carga. */
  place(position:Vec3,yaw=0):void{
    this.root.position.set(position.x,position.y,position.z);
    this.root.rotation.y=yaw;
  }

  /** Onde as gotas devem cair, em mundo. Útil para o áudio/VFX de quem integra. */
  rimPoint(out=new Vector3()):Vector3{
    out.copyFrom(this.rimLocal).scaleInPlace(this.scale).addInPlace(this.root.position);
    return out;
  }

  /** Altura em mundo da superfície do suco para uma fração 0..1. */
  surfaceHeight(fill=this.shown):number{
    const levels=CHALICE_FILL_LEVELS;
    const p=Math.min(1,Math.max(0,fill))*(levels.length-1);
    const index=Math.min(levels.length-2,Math.floor(p));
    const u=p-index;
    const low=levels[index]??levels[0],high=levels[index+1]??low;
    return this.root.position.y+(low+(high-low)*u)*this.scale;
  }

  /** Nível autoritativo do marco (suco/meta). Guardado e reaplicado quando o GLB chegar. */
  setFill(fraction:number,immediate=false):void{
    this.target=Math.min(1,Math.max(0,Number.isFinite(fraction)?fraction:0));
    if(immediate)this.shown=this.target;
    this.applyFill();
  }

  setVisible(visible:boolean):void{this.root.setEnabled(visible);}

  /**
   * Arco de suco saindo da morte creditada. Puramente ilustrativo: se o pool estiver cheio, ou o
   * modelo ainda não tiver carregado, a gota é descartada sem afetar o progresso.
   */
  splash(from:Vec3,size=1):void{
    const drop=this.ready?this.pool[this.live]:undefined;
    if(!drop)return;
    this.live++;
    drop.from.set(from.x,from.y,from.z);
    drop.time=0;
    drop.spin=(this.live%7)*.9;
    drop.size=Math.min(1.8,Math.max(.45,size));
  }

  /** Pulso de conclusão. Idempotente e sem efeito colateral na lógica. */
  pulse():void{this.pulseTime=PULSE_SECONDS;}

  async load():Promise<boolean>{
    if(this.loading)return this.loading;
    this.loading=this.loadOnce();
    return this.loading;
  }

  private async loadOnce():Promise<boolean>{
    const scene=this.root.getScene();
    try {
      const container=await LoadAssetContainerAsync(this.source,scene,this.pluginExtension?{pluginExtension:this.pluginExtension}:undefined);
      if(this.disposed){container.dispose();return false;}
      // glTF 9.25 raises ALL scene materials to the light count after each import. Clamp in
      // this microtask, before executeWhenReady can compile 18 light UBOs on a 12-UBO device.
      for(const material of [...scene.materials,...container.materials]){
        const lit=material as Material&{maxSimultaneousLights?:number};
        if(lit.maxSimultaneousLights!==undefined&&lit.maxSimultaneousLights>4){lit.unfreeze();lit.maxSimultaneousLights=4;}
      }
      this.container=container;
      container.addAllToScene();
      for(const node of [...container.meshes,...container.transformNodes])if(!node.parent)node.parent=this.root;
      const find=(name:string)=>container.meshes.find(mesh=>mesh.name===name);
      this.juice=find(CHALICE_NODES.juice) as Mesh|undefined;
      this.droplet=find(CHALICE_NODES.droplet) as Mesh|undefined;
      const rim=container.transformNodes.find(node=>node.name===CHALICE_NODES.rim);
      if(rim)this.rimLocal.copyFrom(rim.position);
      for(const mesh of container.meshes){mesh.isPickable=false;mesh.alwaysSelectAsActiveMesh=false;}
      this.dressMaterials(container);
      this.prepareDroplets();
      if(this.juice&&!this.juice.morphTargetManager)this.error='ChaliceJuice sem morph targets: nível do suco fica fixo';
      this.ready=true;
      this.applyFill();
      return true;
    } catch(error){
      this.error=String(error);
      return false;
    }
  }

  /**
   * Um único material transparente (o cristal) e ele desenha depois do suco opaco. O vidro usa
   * culling normal com passe separado de face traseira: sem refração, custo previsível ao ar livre.
   */
  private dressMaterials(container:AssetContainer):void{
    for(const material of container.materials){
      const surface=material as Material&{emissiveColor?:Color3};
      if(material.name==='Chalice crystal'){
        material.backFaceCulling=true;
        material.separateCullingPass=true;      // casca traseira antes da frontal: vidro sem inversão
      }
      if(material.name==='Harvest juice'){
        this.juiceMaterial=material;
        if(surface.emissiveColor)this.baseEmissive=surface.emissiveColor.clone();
      }
    }
    for(const mesh of container.meshes){
      if(mesh.name===CHALICE_NODES.droplet)continue;
      mesh.receiveShadows=true;
      // O suco é opaco e desenha no passe opaco; só o cristal entra no passe transparente.
      mesh.alphaIndex=mesh.name===CHALICE_NODES.bowl?10:0;
    }
  }

  /** Pool fixo de gotas por thin instances da malha autoral: zero alocação em combate. */
  private prepareDroplets():void{
    const droplet=this.droplet;
    if(!droplet)return;
    droplet.setParent(null);
    droplet.position.setAll(0);
    droplet.rotationQuaternion=null;
    droplet.rotation.setAll(0);
    droplet.scaling.setAll(1);
    droplet.receiveShadows=false;
    droplet.alwaysSelectAsActiveMesh=true;
    droplet.thinInstanceSetBuffer('matrix',this.matrices,16,false);
    droplet.thinInstanceCount=0;
    droplet.isVisible=false;
  }

  private applyFill():void{
    const manager=this.juice?.morphTargetManager;
    if(!manager||manager.numTargets<1)return;
    const p=Math.min(1,Math.max(0,this.shown))*manager.numTargets;
    const index=Math.min(manager.numTargets-1,Math.floor(p));
    const u=p-index;
    for(let i=0;i<manager.numTargets;i++){
      const target=manager.getTarget(i);
      // Somatório das influências = 1, então a mistura entre dois níveis é interpolação linear
      // de verdade — cada nível autorado encosta na parede do vidro na altura certa.
      target.influence=index===0?(i===0?u:0):(i===index-1?1-u:i===index?u:0);
    }
  }

  update(dt:number):void{
    if(this.disposed||!(dt>0))return;
    if(this.shown!==this.target){
      const step=FILL_SMOOTH*dt;
      this.shown=Math.abs(this.target-this.shown)<=step?this.target:this.shown+Math.sign(this.target-this.shown)*step;
      this.applyFill();
    }
    this.advanceDrops(dt);
    this.advancePulse(dt);
  }

  private advanceDrops(dt:number):void{
    const droplet=this.droplet;
    if(!droplet)return;
    const rim=this.rimPoint(this.rimWorld);
    const drown=rim.y-this.surfaceHeight();
    let written=0;
    for(let i=this.live-1;i>=0;i--){
      const drop=this.pool[i],last=this.pool[this.live-1];
      if(!drop||!last)continue;
      drop.time+=dt;
      const t=drop.time/DROP_SECONDS;
      if(t>=1){                                   // troca com o último vivo: remoção O(1), sem lixo
        this.pool[i]=last;
        this.pool[this.live-1]=drop;
        this.live--;
        continue;
      }
      this.position.set(drop.from.x+(rim.x-drop.from.x)*t,drop.from.y+(rim.y-drop.from.y)*t,drop.from.z+(rim.z-drop.from.z)*t);
      this.position.y+=Math.sin(Math.PI*t)*DROP_ARC*this.scale;
      this.position.y-=Math.max(0,t-.82)/.18*drown;
      const size=drop.size*this.scale*(1.15-.35*t);
      this.scaling.set(size,size*(1+.45*t),size);
      Quaternion.RotationYawPitchRollToRef(drop.spin+t*2.4,Math.PI*.5*t,0,this.rotation);
      Matrix.ComposeToRef(this.scaling,this.rotation,this.position,this.scratch);
      this.scratch.copyToArray(this.matrices,written*16);
      written++;
    }
    droplet.thinInstanceCount=written;
    droplet.isVisible=written>0;
    if(written>0)droplet.thinInstanceBufferUpdated('matrix');
  }

  private advancePulse(dt:number):void{
    if(this.pulseTime<=0)return;
    this.pulseTime=Math.max(0,this.pulseTime-dt);
    const wave=Math.sin(Math.PI*(1-this.pulseTime/PULSE_SECONDS));
    const surface=this.juiceMaterial as (Material&{emissiveColor?:Color3})|undefined;
    if(surface?.emissiveColor)surface.emissiveColor.copyFrom(this.baseEmissive).scaleInPlace(1+3.2*wave);
    this.root.scaling.setAll(this.scale*(1+.045*wave));
    if(this.pulseTime<=0){
      if(surface?.emissiveColor)surface.emissiveColor.copyFrom(this.baseEmissive);
      this.root.scaling.setAll(this.scale);
    }
  }

  /** Recomeço de tentativa: esvazia sem recarregar o modelo. */
  reset():void{
    this.live=0;
    this.pulseTime=0;
    this.target=0;
    this.shown=0;
    this.root.scaling.setAll(this.scale);
    const surface=this.juiceMaterial as (Material&{emissiveColor?:Color3})|undefined;
    if(surface?.emissiveColor)surface.emissiveColor.copyFrom(this.baseEmissive);
    if(this.droplet){this.droplet.thinInstanceCount=0;this.droplet.isVisible=false;}
    this.applyFill();
  }

  /** Idempotente e seguro mesmo se chamado durante a carga. */
  dispose():void{
    this.disposed=true;
    this.ready=false;
    this.live=0;
    this.droplet=undefined;
    this.juice=undefined;
    this.juiceMaterial=undefined;
    this.container?.dispose();
    this.container=undefined;
    this.root.dispose();
  }

  /** Só para diagnóstico/teste: malhas vivas deste cálice. */
  get meshes():AbstractMesh[]{return this.container?.meshes??[];}
}
