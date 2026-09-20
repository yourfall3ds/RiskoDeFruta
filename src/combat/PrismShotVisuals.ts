import {RocketExplosion} from './RocketExplosion';
import {Vector3,Quaternion} from '@babylonjs/core/Maths/math.vector';
import {TransformNode} from '@babylonjs/core/Meshes/transformNode';
import {LoadAssetContainerAsync} from '@babylonjs/core/Loading/sceneLoader';
import type {AssetContainer} from '@babylonjs/core/assetContainer';
import type {Scene} from '@babylonjs/core/scene';
import type {PrismMode} from './PrismTuning';

/** Nós autorais exportados por `scripts/author-prism-shots.py` em `prism-shots.glb`. */
const TEMPLATES=['Pulse','Lance','Grenade','Impact','Spark','Nova','Debris','Smoke','Ember'] as const;
/** Teto de clones vivos. Estourou, o mais antigo é descartado — nunca cresce sem limite. */
const LIVE_CAP=96;

interface Live {node:TransformNode;age:number;life:number;step:(t:number,node:TransformNode)=>void}

/**
 * Projéteis e impactos AUTORAIS da PRISM, em jogo.
 *
 * Usa os modelos exportados (`prism-shots.glb`) — pulso, lança, cápsula, nova, fumaça, brasa e
 * estilhaço — e NÃO a classe de prévia da oficina (`PrismShotPreview`), que inventa o impacto a uma
 * distância fixa porque ali não existe mundo. Aqui cada posição vem do jogo: o rastro termina no
 * ponto que o raio realmente acertou, e a cápsula é desenhada onde a balística diz que ela está.
 *
 * Falhar a carga não derruba nada: `ready` fica `false`, `error` é anunciado no diagnóstico e o
 * combate segue com os efeitos genéricos do `ShotEffects`, que já existiam.
 */
export class PrismShotVisuals {
  private readonly templates=new Map<string,TransformNode>();
  private readonly live:Live[]=[];
  /** Cápsulas desenhadas, por id da granada em voo. */
  private readonly capsules=new Map<number,TransformNode>();
  private container:AssetContainer|undefined;
  private disposed=false;
  ready=false;
  error='';
  private readonly rocket:RocketExplosion;
  constructor(private readonly scene:Scene){this.rocket=new RocketExplosion(scene);}
  async load():Promise<void> {
    try{
      const container=await LoadAssetContainerAsync('/models/weapons/prism-shots.glb?v=incendiary-2',this.scene);
      if(this.disposed){container.dispose();return;}
      this.container=container;container.addAllToScene();
      for(const name of TEMPLATES){
        const node=container.transformNodes.find(n=>n.name===name);
        if(!node)throw Error(`Projétil PRISM ausente: ${name}`);
        node.setEnabled(false);
        for(const mesh of node.getChildMeshes())mesh.isPickable=false;
        this.templates.set(name,node);
      }
      this.ready=true;
    }catch(error){if(!this.disposed)this.error=error instanceof Error?error.message:'Falha nos projéteis PRISM';}
  }
  private clone(name:string,position:Vector3,direction:Vector3):TransformNode|undefined {
    const template=this.templates.get(name);
    if(!template)return undefined;
    const node=template.clone(`prism-fx-${name}`,null);
    if(!node)return undefined;
    node.position.copyFrom(position);
    // O eixo autoral do cano é +X (ver `docs/prism-triform.md`); alinhar a ele é o que faz o
    // projétil apontar para onde ele viaja.
    node.rotationQuaternion=Quaternion.FromUnitVectorsToRef(Vector3.Right(),safeDirection(direction),new Quaternion());
    node.setEnabled(true);
    for(const mesh of node.getChildMeshes())mesh.isPickable=false;
    return node;
  }
  private emit(name:string,position:Vector3,direction:Vector3,life:number,step:Live['step']):void {
    const node=this.clone(name,position,direction);
    if(!node)return;
    while(this.live.length>=LIVE_CAP)this.live.shift()!.node.dispose();
    step(0,node);
    this.live.push({node,age:0,life:Math.max(.01,life),step});
  }
  /**
   * Rastro do tiro instantâneo, do cano até o ponto REAL do acerto.
   * O pulso do assault e a lança do sniper viajam o segmento inteiro e somem ao chegar.
   */
  tracer(mode:PrismMode,from:Vector3,to:Vector3):void {
    if(!this.ready||mode===2)return;
    const travel=to.subtract(from);
    const distance=travel.length();
    if(!(distance>.05))return;
    const direction=travel.scale(1/distance);
    const origin=from.clone(),end=to.clone();
    // Velocidade autoral alta: o rastro existe para ser lido, não para virar tempo de voo.
    const life=Math.min(.22,Math.max(.045,distance/(mode===1?900:520)));
    this.emit(mode===1?'Lance':'Pulse',origin,direction,life,(t,node)=>{
      Vector3.LerpToRef(origin,end,t,node.position);
      if(mode===1)node.scaling.x=1+Math.sin(Math.PI*Math.min(1,t))*6;
    });
  }
  /** A cápsula em voo entra em cena. Uma por granada viva; a posição é escrita por `moveCapsule`. */
  spawnCapsule(id:number,position:Vector3,direction:Vector3):void {
    if(!this.ready||this.capsules.has(id))return;
    const node=this.clone('Grenade',position,direction);
    if(!node)return;
    // Workshop previews are enlarged; a gameplay capsule must fit the equipped barrel.
    node.scaling.setAll(.4);
    this.capsules.set(id,node);
  }
  moveCapsule(id:number,position:Vector3,direction:Vector3,spin:number):void {
    const node=this.capsules.get(id);
    if(!node)return;
    node.position.copyFrom(position);
    node.rotationQuaternion=Quaternion.FromUnitVectorsToRef(Vector3.Right(),safeDirection(direction),new Quaternion())
      .multiply(Quaternion.RotationAxis(Vector3.Right(),spin));
  }
  removeCapsule(id:number):void {this.capsules.get(id)?.dispose();this.capsules.delete(id);}
  /** Faísca curta do acerto instantâneo, no ponto e na normal reais. */
  impact(mode:PrismMode,point:Vector3,normal:Vector3):void {
    if(!this.ready)return;
    const radius=mode===1?.85:.4;
    const at=point.clone();
    this.emit('Impact',at,normal,.3,(t,node)=>{
      node.position.copyFrom(at);
      node.scaling.set(.5*(1-t)+.03,radius*(.2+t),radius*(.2+t));
      for(const mesh of node.getChildMeshes())mesh.visibility=1-t;
    });
    const count=mode===1?7:4;
    for(let i=0;i<count;i++){
      const spread=spoke(i,count,normal,radius);
      const origin=at.clone();
      this.emit('Spark',origin,spread,.35+(i%3)*.09,(t,node)=>{
        node.position.copyFrom(origin).addInPlace(spread.scale(t));
        node.scaling.setAll(Math.max(.02,1-t));
      });
    }
  }
  /**
   * Bola de fogo incendiária no ponto da detonação.
   *
   * `up` é a vertical LOCAL do ponto: no planeta a fumaça tem de subir pela radial de lá, não pelo
   * `+Y` do mundo. `radius` é o MESMO raio que o dano usou, então o que se vê é o que machuca.
   */
  explosion(point:Vector3,up:Vector3,radius:number):void {
    if(!this.ready)return;
    const at=point.clone(),vertical=safeDirection(up);
    this.rocket.emit(at,vertical,radius);
    for(let i=0;i<14;i++){
      const spread=spoke(i,14,vertical,radius*.85);
      const origin=at.clone();
      this.emit(i%3===0?'Debris':'Ember',origin,spread,.9,(t,node)=>{
        node.position.copyFrom(origin).addInPlace(spread.scale(t)).subtractInPlace(vertical.scale(t*t*.8));
        node.scaling.setAll(Math.max(.02,1-t));
      });
    }
  }
  update(dt:number):void {
    if(dt<=0)return;
    this.rocket.update(dt);
    for(let i=this.live.length-1;i>=0;i--){
      const fx=this.live[i]!;
      fx.age+=dt;
      const t=Math.min(1,fx.age/fx.life);
      fx.step(t,fx.node);
      if(fx.age>=fx.life){fx.node.dispose();this.live.splice(i,1);}
    }
  }
  /** Some com tudo que está vivo. Morte, reinício de tentativa e troca de estágio. */
  clear():void {
    this.rocket.clear();
    for(const fx of this.live)fx.node.dispose();
    this.live.length=0;
    for(const node of this.capsules.values())node.dispose();
    this.capsules.clear();
  }
  dispose():void {this.disposed=true;this.clear();this.rocket.dispose();this.container?.dispose();this.container=undefined;this.templates.clear();this.ready=false;}
}

/** Direção unitária utilizável; `+X` quando o vetor é degenerado. */
function safeDirection(v:Vector3):Vector3 {
  const length=v.length();
  return length>1e-6?v.scale(1/length):Vector3.Right();
}

/**
 * `index`-ésimo raio de um leque em volta de `axis`, com comprimento `radius`.
 * Determinístico: os estilhaços não sorteiam direção, então a explosão é reproduzível no replay.
 */
function spoke(index:number,count:number,axis:Vector3,radius:number):Vector3 {
  const up=safeDirection(axis);
  const reference=Math.abs(up.y)<.9?Vector3.Up():Vector3.Right();
  const right=Vector3.Cross(up,reference);
  const rightLength=right.length();
  if(rightLength<1e-6)return up.scale(radius);
  right.scaleInPlace(1/rightLength);
  const forward=Vector3.Cross(up,right).normalize();
  const angle=index*Math.PI*2/Math.max(1,count);
  const lift=.25+.5*((index%3)/2);
  return right.scale(Math.cos(angle)).addInPlace(forward.scale(Math.sin(angle))).addInPlace(up.scale(lift)).normalize().scale(radius);
}
