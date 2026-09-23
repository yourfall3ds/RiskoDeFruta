import {LoadAssetContainerAsync} from '@babylonjs/core/Loading/sceneLoader';
import {TransformNode} from '@babylonjs/core/Meshes/transformNode';
import {Matrix,Quaternion,Vector3} from '@babylonjs/core/Maths/math.vector';
import type {Scene} from '@babylonjs/core/scene';
import type {AssetContainer} from '@babylonjs/core/assetContainer';
import type {AnimationGroup} from '@babylonjs/core/Animations/animationGroup';
import type {CharacterVisual} from '../animation/CharacterVisual';

/**
 * O rig autoral da SUBMETRALHADORA DE SEDA, nas mãos do jogador.
 *
 * Mesmo desenho do `PrismRig` e pelo mesmo motivo: a APRESENTAÇÃO da arma (pose, clipes, boca do
 * cano) mora aqui, e o backend (`MarijuanoWeapon`) não toca em nada disto por dentro. Não herda do
 * `PrismRig` de propósito — aquele rig tem três formas, transformação e áudio próprio, e espremer
 * uma arma de forma única dentro daquele contrato só acrescentaria estados mortos.
 *
 * ## O que o GLB entrega (medido, não suposto)
 *
 * `public/models/weapons/paper-smg.glb` tem **cinco ossos** — `Root`, `Weapon`, `Magazine`,
 * `Trigger`, `Muzzle` — e **três clipes**: `Idle` (2,03 s), `Fire` (0,43 s) e `Reload` (2,63 s).
 * O cano aponta no **+X local** (o osso `Muzzle` está em `x = 3,66` do espaço de osso) e o rig raiz
 * já traz `scaling = 0,11`, que é o que põe a arma nos ~60 cm autorais. Por isso este módulo NÃO
 * reescala nada: o GLB já está em escala de mundo, como o `pistol.glb`.
 *
 * ## Os clipes são AMOSTRADOS, não tocados
 *
 * Como na PRISM: o clipe é posicionado por `goToFrame` a partir do relógio do JOGO. Deixar o
 * `AnimationGroup` correr sozinho criaria um segundo relógio — a recarga da animação terminaria
 * num instante e a do carregador noutro, e a arma encheria com o pente ainda no ar.
 */
export class SmgRig {
 readonly root:TransformNode;
 ready=false;
 private visible=false;
 private disposed=false;
 private asset:AssetContainer|undefined;
 private clips=new Map<string,AnimationGroup>();
 private active:AnimationGroup|undefined;
 private action:'idle'|'fire'|'reload'='idle';
 private clock=0;
 private idleClock=0;
 private reloadPosition=-1;
 private muzzleNode:TransformNode|undefined;
 private magazine:TransformNode|undefined;
 private trigger:TransformNode|undefined;
 private aligned=false;
 constructor(private scene:Scene,private visual:CharacterVisual){
  this.root=new TransformNode('marijuano-smg',scene);
  this.root.setEnabled(false);
 }
 /** A submetralhadora nunca se transforma: nada aqui trava o disparo. Existe pela mesma porta. */
 get busy():boolean{return false;}
 get firing():boolean{return this.visual.rifleFiring;}
 set firing(value:boolean){this.visual.rifleFiring=value;}
 get enabled():boolean{return this.visible;}
 set enabled(value:boolean){
  this.visible=value;
  this.visual.rifleEquipped=value;
  this.root.setEnabled(value&&this.ready);
 }
 /** Boca do cano em MUNDO. `undefined` antes da carga ou com o rig escondido. */
 get muzzle():Vector3|undefined {
  this.muzzleNode?.computeWorldMatrix(true);
  return this.muzzleNode?.getAbsolutePosition().clone();
 }

 async load():Promise<void>{
  const asset=await LoadAssetContainerAsync('/models/weapons/paper-smg.glb',this.scene);
  if(this.disposed){asset.dispose();return;}
  this.asset=asset;asset.addAllToScene();
  for(const node of asset.rootNodes)node.parent=this.root;
  for(const mesh of asset.meshes){mesh.isPickable=false;mesh.receiveShadows=true;}
  for(const clip of asset.animationGroups){clip.stop();this.clips.set(clip.name,clip);}
  this.muzzleNode=asset.transformNodes.find(n=>n.name==='Muzzle');
  this.magazine=asset.transformNodes.find(n=>n.name==='Magazine');
  this.trigger=asset.transformNodes.find(n=>n.name==='Trigger');
  // O cano autoral é +X e a mão do jogador aponta +Z (a mesma correção da PRISM, pelo mesmo
  // motivo: a conversão canhota do glTF do Babylon reflete o X).
  this.root.rotationQuaternion=Quaternion.RotationYawPitchRoll(Math.PI/2,0,0);
  this.ready=true;
  this.sample('Idle',0);
  this.root.setEnabled(this.visible);
 }

 private sample(name:string,progress:number):void {
  const group=this.clips.get(name);if(!group)return;
  if(this.active!==group){this.active?.stop();group.start(false);group.pause();this.active=group;}
  group.goToFrame(group.from+(group.to-group.from)*Math.max(0,Math.min(1,progress)));
 }

 /** Duração real de um clipe, em segundos. Lida do GLB — nunca chutada. */
 private duration(name:string):number {
  const clip=this.clips.get(name);
  if(!clip)return 1;
  const fps=clip.targetedAnimations[0]?.animation.framePerSecond??30;
  return Math.max(.01,(clip.to-clip.from)/fps);
 }

 fire():void {
  if(!this.ready||!this.visible)return;
  this.visual.fireRifle();
  this.action='fire';this.clock=0;this.sample('Fire',0);
 }

 /** Amostra o clipe de recarga; `-1` restaura a pose de repouso. */
 reload(progress:number):void {
  if(progress<0){
   if(this.action==='reload'){this.action='idle';this.clock=0;this.sample('Idle',0);}
   this.reloadPosition=-1;return;
  }
  if(!this.ready||!this.visible)return;
  this.reloadPosition=progress;this.action='reload';this.sample('Reload',progress);
 }

 update(dt:number):void {
  if(!this.ready||!this.visible)return;
  const grip=this.visual.grips[0];if(!grip)return;
  this.visual.poseRifleGrip();
  this.root.parent=grip;
  // A arma é pendurada pelo GATILHO, que é onde o dedo do jogador está. Sem este ajuste ela
  // nasceria pela raiz do rig — que fica atrás da coronha — e o punho apareceria no ar.
  if(!this.aligned&&this.trigger){
   this.root.position.setAll(0);this.root.computeWorldMatrix(true);
   this.trigger.computeWorldMatrix(true);
   const local=Vector3.TransformCoordinates(this.trigger.getAbsolutePosition(),Matrix.Invert(grip.computeWorldMatrix(true)));
   this.root.position.copyFrom(local.negate());
   this.aligned=true;
  }
  if(this.action==='fire'){
   const duration=this.duration('Fire');
   this.clock+=Math.max(0,dt);this.sample('Fire',this.clock/duration);
   if(this.clock>=duration){this.action='idle';this.clock=0;}
  } else if(this.action==='idle'){
   // Repouso em CICLO: o clipe `Idle` é a respiração da arma, e ele volta ao começo sozinho.
   const duration=this.duration('Idle');
   this.idleClock=(this.idleClock+Math.max(0,dt))%duration;
   this.sample('Idle',this.idleClock/duration);
  }
  this.root.computeWorldMatrix(true);
  // Mão de apoio: no punho dianteiro em repouso, no PENTE enquanto a recarga anda. É o mesmo
  // gesto que a PRISM faz — a mão esquerda acompanha o carregador em vez de ficar plantada no ar.
  const muzzle=this.muzzle;
  if(muzzle){
   const base=grip.getAbsolutePosition();
   const target=Vector3.Lerp(base,muzzle,SUPPORT_ALONG_BARREL);
   if(this.action==='reload'&&this.magazine){
    this.magazine.computeWorldMatrix(true);
    const p=this.reloadPosition;
    const t=Math.max(0,Math.min(1,p/.18,(1-p)/.12)),blend=t*t*(3-2*t);
    Vector3.LerpToRef(target,this.magazine.getAbsolutePosition(),blend,target);
   }
   const direction=Vector3.TransformNormal(Vector3.Forward(),grip.getWorldMatrix()).normalize();
   this.visual.poseRifleSupport(target,direction);
  }
 }

 /** Reinício de tentativa: repouso e alinhamento refeito (o rig pode ter trocado de mão). */
 reset():void {this.action='idle';this.clock=0;this.idleClock=0;this.reloadPosition=-1;this.aligned=false;if(this.ready)this.sample('Idle',0);}

 dispose():void {
  this.disposed=true;
  this.asset?.dispose();
  this.root.dispose();
  this.visual.rifleEquipped=false;
 }
}

/**
 * Onde a mão de apoio pega o cano, como fração da distância punho→boca.
 *
 * 0,55 é o punho dianteiro: adiante do carregador e atrás do cano quente. Mais perto de 1 e a mão
 * apareceria dentro do fogacho; mais perto de 0 e as duas mãos se sobreporiam.
 */
const SUPPORT_ALONG_BARREL=.55;
