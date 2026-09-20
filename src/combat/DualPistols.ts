import {CreateBox} from '@babylonjs/core/Meshes/Builders/boxBuilder';
import {PBRMaterial} from '@babylonjs/core/Materials/PBR/pbrMaterial';
import type {Mesh} from '@babylonjs/core/Meshes/mesh';
import {PistolMagazine} from './PistolMagazine';
import {ShellCasings} from '../vfx/ShellCasings';
import {RicochetFan,rotateAboutAxis,stablePerpendicular} from './RicochetFan';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader';
import { Vector3,Quaternion } from '@babylonjs/core/Maths/math.vector';
import type { AssetContainer } from '@babylonjs/core/assetContainer';
import { PointLight } from '@babylonjs/core/Lights/pointLight';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Ray } from '@babylonjs/core/Culling/ray';
import type { Scene } from '@babylonjs/core/scene';
import type { RandomStream } from '../core/RunRNG';
import type { EventBus } from '../core/EventBus';
import type { DamageContext,GameEvents,Vec3 } from '../core/contracts';
import {destructionHit,NO_DESTRUCTION,type DestructionPort} from '../planet-game/PlanetDestruction';
import type { CharacterVisual } from '../animation/CharacterVisual';
import type { TrainingYard, TrainingTarget } from '../world/TrainingYard';
import { isAutoAimTarget } from '../world/TrainingYard';
import type { MPTier } from './MPCharge';
import type { WeaponAudio } from '../audio/RecordedAudio';
import { ShotEffects } from '../vfx/ShotEffects';
import {PickingInfo} from '@babylonjs/core/Collisions/pickingInfo';
import {sweepBox,type CollisionWorld} from '../physics/CollisionWorld';
import { PistolCadence } from './PistolCadence';
import type { CombatContact,CombatHitSpec,CombatServices,CombatSweep } from './CombatServices';
import { PISTOL_TUNING as t } from '../player/PlayerTuning';

/** Base ortonormal local. Convenção de mão-esquerda do jogo: `right = up × forward`. */
export interface CombatBasis {up:Vector3;right:Vector3;forward:Vector3}

/**
 * Onde é "para cima" e onde o corpo realmente está.
 *
 * O combate autoral nasceu num mapa plano e por isso escrevia `+Y` e `visual.position` direto no
 * meio das contas. Num mapa esférico as duas coisas deixam de ser constantes — mas NADA mais muda:
 * cadência, dano, munição, recarga, os três MP, o ricochete, os eventos e o áudio continuam sendo
 * o mesmo código. Este contrato existe só para essas duas perguntas.
 *
 * O padrão `WORLD_SPACE` é a identidade: quem não passa nada continua no jogo plano, bit a bit.
 *
 * `result` é um destino OPCIONAL para evitar alocação por quadro; quem implementa pode ignorá-lo.
 * Quem chama nunca guarda a referência devolvida além do quadro.
 */
export interface CombatSpace {
  /** Vertical local unitária no ponto. Padrão: `+Y` em qualquer lugar. */
  upAt(point:Vector3,result?:Vector3):Vector3;
  /**
   * Base local no ponto. `forwardHint` só orienta o plano tangente num espaço CURVO; no espaço
   * plano padrão a base é a do MUNDO (X, Y, Z) — que é exatamente o referencial em que os offsets
   * autorais do coldre e do arremesso do carregador foram escritos.
   */
  frameAt(point:Vector3,forwardHint:Vector3,result?:CombatBasis):CombatBasis;
  /** Posição de MUNDO do corpo, a partir de `visual.position`. Padrão: cópia. */
  toWorld(local:Vector3,result?:Vector3):Vector3;
}

/** O espaço do jogo plano: `+Y` para cima, eixos de mundo, `visual.position` já é de mundo. */
export const WORLD_SPACE:CombatSpace={
  upAt:(_point,result=new Vector3())=>result.copyFromFloats(0,1,0),
  frameAt:(_point,_forwardHint,result={up:new Vector3(),right:new Vector3(),forward:new Vector3()})=>{
    result.up.copyFromFloats(0,1,0);result.right.copyFromFloats(1,0,0);result.forward.copyFromFloats(0,0,1);return result;
  },
  toWorld:(local,result=new Vector3())=>result.copyFrom(local),
};

/**
 * A câmera vista pelo combate — estrutural, não nominal.
 *
 * `ThirdPersonCamera` satisfaz isto como está, sem cast. `camera.rotation` ficou DE FORA de
 * propósito: o único uso era o eixo do rodopio da arma na recarga, que virou `up × forward` — no
 * jogo plano o mesmo `(cos yaw, 0, −sin yaw)` de antes, e válido em qualquer polo.
 */
export interface CombatCamera {
  /** Direção de visão unitária, em MUNDO, já com o pitch. */
  readonly forward:Vector3;
  /** Olho da mira. Só a posição de mundo é lida. */
  readonly camera:{readonly position:Vector3};
  /** Tranco do disparo básico. */
  impulse(strength:number):void;
}

/**
 * Colisão radial crua, com ÍNDICE DE TRIÂNGULO. `PlanetCollision` satisfaz por estrutura.
 *
 * O triângulo é o que deixa a destruição resolver o prop por intervalo, sem busca espacial; e é
 * este backend — não a lista plana — que já ignora triângulos desativados, então um corpo que
 * quebrou deixa de barrar a bala no mesmo quadro.
 */
export interface CombatTriangleCollision {
  raycast(origin:Vec3,direction:Vec3,maxDistance:number):{distance:number;point:Vec3;normal:Vec3;triangle:number}|undefined;
}

/**
 * Subconjunto de `SurfaceFrame` repassado ao `ShellCasings` (4º argumento do contrato de inimigos).
 *
 * Declarado aqui por estrutura, e não importado, exatamente pelo motivo que o dono da horda deu no
 * `.temp/real-game-enemy-api.md`: sem import cruzado não há ordem de merge. `SurfaceFrame` e
 * `EnemySurface` satisfazem os dois lados.
 */
export interface CombatSurface {
  up(p:Vec3):Vec3;
  support(p:Vec3,above:number,below:number):{point:Vec3;normal:Vec3;offset:number;slopeDegrees:number}|undefined;
  slide(p:Vec3,delta:Vec3,radius:number,height:number,step:number):void;
  sweep(from:Vec3,delta:Vec3,radius:number):{time:number;normal:Vec3}|undefined;
  planarDistance(a:Vec3,b:Vec3):number;
  heightGap(a:Vec3,b:Vec3):number;
  basis(p:Vec3,forwardHint:Vec3):{up:Vec3;forward:Vec3;right:Vec3};
}

/**
 * Porta estreita do mundo estático: é tudo que o combate consome dele.
 *
 * O sweep contra ATOR continua sendo `sweepBox` sobre a bounding box — função pura, não passa por
 * aqui. `CollisionWorld` satisfaz a porta como está.
 *
 * **`spherical` é a correção de um defeito real.** A guarda antiga decidia "tem backend?" olhando
 * `geometry`, mas `CollisionWorld.configurePlanet` NÃO preenche `geometry` (um mundo esférico não
 * registra as listas planas). Resultado: no planeta o `worldPick` caía calado no
 * `scene.pickWithRay` e o terreno ficava vazado para bala. A decisão passou a ser a flag
 * explícita do dono da física — sem inventar arrays de geometria falsa só para satisfazer o `if`.
 */
export interface CombatCollision {
  readonly geometry?:{positions:number[];indices:number[]}|undefined;
  raycast(ray:Ray):{distance:number;point:Vector3;normal:Vector3}|undefined;
  /** `true` depois de `configurePlanet`. Ausente/`false` ⇒ mundo plano, caminho de hoje. */
  readonly spherical?:boolean|undefined;
  /** Serviço radial cru, publicado pela física para destruição/ragdoll/navegação. */
  readonly planet?:{collision:CombatTriangleCollision}|undefined;
  /** Referencial de superfície, repassado ao `ShellCasings`. */
  readonly surface?:CombatSurface|undefined;
}

/**
 * O mundo estático aceito pelo combate.
 *
 * A união (em vez de só a porta) existe porque os CASCOS consultam `groundAt`, que a porta estreita
 * não tem e que só o `CollisionWorld` completo responde. Quem passa a classe inteira continua com
 * casco quicando no chão; quem passa só a porta perde o quique — detalhe cosmético do jogo plano,
 * nenhum efeito em mira, dano ou linha de visão.
 */
export type CombatWorld=CollisionWorld|CombatCollision;

/**
 * `origin` deslocado na base local. No espaço padrão a base é a do mundo, então isto é literalmente
 * o `origin.add(new Vector3(right,up,forward))` que o código sempre escreveu.
 */
function offsetInFrame(origin:Vector3,frame:CombatBasis,right:number,up:number,forward:number):Vector3 {
  return origin.add(frame.right.scale(right)).addInPlace(frame.up.scale(up)).addInPlace(frame.forward.scale(forward));
}

export class DualPistols implements CombatServices {
  readonly magazine=new PistolMagazine();private readonly casings:ShellCasings;
  readonly cadence=new PistolCadence();
  readonly effects: ShotEffects;
  private readonly reloadMagazines:Mesh[]=[];private readonly tossStarts:({position:Vector3;rotation:Quaternion}|undefined)[]=[];
  private readonly weapons: TransformNode[]=[];
  private readonly muzzle: TransformNode[]=[];
  private readonly recoil=[0,0];
  private readonly gripRotations: (Quaternion | undefined)[]=[];
  private readonly flashLights:PointLight[]=[];
  private container: AssetContainer | undefined;
  private disposed=false;
  ready=false;
  error='';
  hitTime=0;
  hits=0;
  lastImpact='—';
  lastSide: 0 | 1=0;
  stormRemaining=0;
  skillShots=0;
  /** Pistolas guardadas durante o combate desarmado: somem das mãos e não disparam. */
  holstered=false;
  /**
   * Pistolas ESCONDIDAS porque outra arma está equipada (a PRISM).
   *
   * Diferente de `holstered` de propósito: guardar é um estado de JOGO (o exterminador sacou os
   * punhos) e desliga o disparo; esconder é só apresentação. O backend continua inteiro — é ele
   * que atende as três habilidades de MP, que continuam sendo de pistola por autoria (leque,
   * barragem e tempestade têm clipe, voz e coreografia próprios). Ver `skillActive`: enquanto uma
   * habilidade está no ar a cena volta a mostrar as pistolas, senão a cinemática tocaria com as
   * mãos vazias.
   */
  concealed=false;
  /** `true` enquanto qualquer uma das três habilidades de MP ainda está produzindo disparo. */
  get skillActive():boolean {
    return this.stormRemaining>0||this.barrageIndex<this.barrageTotal||this.fanIndex<this.fanTotal||this.fan.bullets.length>0;
  }
  /**
   * Destruição de cenário. Trocável a quente porque a fachada só existe depois do manifesto e do
   * GLB: até lá é `NO_DESTRUCTION` e o tiro funciona EXATAMENTE como sempre funcionou, sem nenhum
   * caminho novo. Quem chama `update`/`reset` é a cena, que é dona da fachada (ela é compartilhada
   * com o soco e com os outros emissores de dano).
   */
  destruction:DestructionPort=NO_DESTRUCTION;
  /** Acertos que viraram dano em cenário. Diagnóstico — NUNCA entra em `hits` nem paga MP. */
  sceneryHits=0;
  /** Triângulo de colisão do último acerto de mundo, por `PickingInfo`. Só o backend radial preenche. */
  private readonly pickTriangle=new WeakMap<PickingInfo,number>();
  private actionClock:(()=>number)|undefined;private actionDuration=0;private fanTotal=10;private barrageTotal=14;private fanInterval=.055;private barrageInterval=.6/14;
  private stormClock=0;
  private stormTarget=0;private barrageIndex=14;private barrageClock=0;private barrageDirection=Vector3.Forward();private fanIndex=10;private fanClock=0;private fanDirection=Vector3.Forward();readonly fan:RicochetFan;
  /** Destinos reutilizados do espaço; nenhum deles sobrevive ao quadro em que é lido. */
  private readonly bodyWorld=new Vector3();private readonly localUp=new Vector3(0,1,0);
  private readonly localFrame:CombatBasis={up:new Vector3(0,1,0),right:new Vector3(1,0,0),forward:new Vector3(0,0,1)};
  constructor(private readonly scene: Scene,private readonly camera: CombatCamera,private readonly visual: CharacterVisual,private readonly yard: Pick<TrainingYard,'targets'>&{collision?:CombatWorld},private readonly rng: RandomStream,private readonly events: EventBus<GameEvents>,private readonly audio: WeaponAudio,private readonly space: CombatSpace=WORLD_SPACE) {
    // Narrowing de verdade, não elenco: só o `CollisionWorld` completo sabe responder `groundAt`.
    // O 4º argumento é o porto de superfície do contrato de inimigos: hoje o `ShellCasings` tem
    // três parâmetros e simplesmente o ignora; quando o dono da horda acrescentar o dele, o valor
    // JÁ está sendo passado. Atribuir a classe a um construtor de aridade maior é assinatura
    // normal de TypeScript, não elenco — e no planeta o casco não é rebaixado para `undefined`.
    const casings:new(scene:Scene,world:CollisionWorld|undefined,audio:WeaponAudio,surface?:CombatSurface)=>ShellCasings=ShellCasings;
    this.effects=new ShotEffects(scene);
    this.casings=new casings(scene,yard.collision&&'groundAt' in yard.collision?yard.collision:undefined,audio,yard.collision?.surface);
    this.fan=new RicochetFan((ray,ignore)=>{
      let hit=this.worldPick(ray);let targetId:number|undefined;
      for(const target of this.yard.targets){if(ignore.has(target.id)||!target.mesh.isPickable||!target.mesh.isEnabled()||!isAutoAimTarget(target.id))continue;const candidate=this.targetPick(ray,target,.65);if(candidate.hit&&(!hit||candidate.distance<hit.distance)){hit=candidate;targetId=target.id;}}
      // O ricochete já elegia o contato MAIS PRÓXIMO entre mundo e atores; é isso que impede a
      // bala de quebrar um prop atrás do terreno ou atrás de um inimigo. O triângulo só sobrevive
      // quando o vencedor foi o mundo — se um ator ganhou, `targetId` está definido e não há prop.
      if(!hit?.hit||!hit.pickedPoint)return;
      const triangle=targetId===undefined?this.pickTriangle.get(hit):undefined;
      return{point:hit.pickedPoint,normal:hit.getNormal(true)??ray.direction.negate(),distance:hit.distance,
        ...(targetId===undefined?{}:{targetId}),...(triangle===undefined?{}:{triangle})};
    },(hit,dir)=>{
      const target=hit.targetId===undefined?undefined:this.yard.targets.find(t=>t.id===hit.targetId);
      if(target){this.damageTarget(target,hit.point,dir,18,'ricochet_fan');return;}
      if(this.destroyScenery(hit.point,hit.normal,dir,18,hit.triangle))return;
      this.effects.mark(hit.point,hit.normal);this.effects.impact(hit.point,hit.normal);
    },(from,to)=>this.effects.arcTrail(from,to));
    const magazineMaterial=new PBRMaterial('pistol-magazine-steel',scene);magazineMaterial.albedoColor=new Color3(.11,.13,.13);magazineMaterial.metallic=.85;magazineMaterial.roughness=.36;
    for(let side=0;side<2;side++) {
      const magazine=CreateBox('replacement-magazine-'+side,{width:.045,height:.13,depth:.06},scene);magazine.material=magazineMaterial;magazine.isPickable=false;magazine.setEnabled(false);this.reloadMagazines.push(magazine);
      const root=new TransformNode(`pistol-${side}`,scene);this.weapons.push(root);
      const muzzle=new TransformNode(`muzzle-${side}`,scene);muzzle.parent=root;muzzle.position.set(0,.154,.341);this.muzzle.push(muzzle);
      const light=new PointLight(`muzzle-light-${side}`,Vector3.Zero(),scene);light.parent=muzzle;light.diffuse=new Color3(1,.65,.25);light.range=2;light.intensity=0;this.flashLights.push(light);
    }
  }
  async load(): Promise<void> {
    try {
      const container=await LoadAssetContainerAsync('/models/pistol.glb',this.scene);
      if(this.disposed){container.dispose();return;}this.container=container;
      for(let side=0;side<2;side++) {
        const instance=container.instantiateModelsToScene(name=>`pistol-${side}-${name}`,false,{doNotInstantiate:true});
        for(const node of instance.rootNodes)node.parent=this.weapons[side]!;
        for(const root of instance.rootNodes)for(const mesh of root.getChildMeshes()){mesh.isPickable=false;mesh.receiveShadows=true;}
      }
      this.ready=true;
    }catch(error){if(!this.disposed)this.error=error instanceof Error?error.message:'Falha na pistola';}
  }
  muzzlePose(side:0|1):{position:Vector3;direction:Vector3}{const node=this.muzzle[side]!;node.computeWorldMatrix(true);return{position:node.getAbsolutePosition(),direction:node.getDirection(Vector3.Forward())};}
  requestReload():boolean{if(this.barrageIndex<this.barrageTotal||this.stormRemaining>0||this.fanIndex<this.fanTotal)return false;if(!this.magazine.request())return false;this.audio.reload?.();return true;}
  /**
   * Posição de MUNDO do corpo. Vetor reutilizado: válido só até a próxima chamada.
   *
   * A guarda existe porque o rig pode ainda não ter posição (e porque a varredura do MP II nunca
   * precisou do corpo no jogo plano — só do eixo vertical, que o espaço padrão responde sem olhar
   * para o ponto). Sem corpo conhecido o ponto de consulta é a origem; no espaço padrão isso não
   * altera nada, já que `upAt` e `frameAt` ignoram o ponto.
   */
  private body():Vector3 {const local=this.visual.position;return local?this.space.toWorld(local,this.bodyWorld):this.bodyWorld.setAll(0);}
  /** Vertical local no corpo. Vetor reutilizado. */
  private up():Vector3 {return this.space.upAt(this.body(),this.localUp);}
  /** Base local no corpo, orientada pela mira. Objeto reutilizado. */
  private frame():CombatBasis {return this.space.frameAt(this.body(),this.camera.forward,this.localFrame);}
  /**
   * Eixo do rodopio da arma no ar durante a recarga.
   *
   * `up × forward` vale, no jogo plano, exatamente `(cos yaw, 0, −sin yaw)` — o vetor que a versão
   * anterior montava a partir de `camera.rotation.y`. O fallback só existe para mira exatamente
   * vertical, que o clamp de pitch do jogador (±1,1 rad) nunca produz.
   */
  private tumbleAxis(frame:CombatBasis):Vector3 {
    const axis=Vector3.Cross(frame.up,this.camera.forward);
    return axis.lengthSquared()<1e-8?stablePerpendicular(frame.up):axis.normalize();
  }
  /** Existing pistol nodes borrowed by the physical corpse until the attempt resets. */
  corpseEquipment(): readonly {node: TransformNode; bone: string}[] {
    if(this.holstered||this.concealed)return [];
    return this.weapons.map((node,index)=>({node,bone:index===0?'RightHand':'LeftHand'}));
  }

  // ------------------------------------------------------------------ serviços de combate
  //
  // A porta `CombatServices`, satisfeita por estrutura. São ENVELOPES dos métodos privados que o
  // tiro já usava — nenhuma regra nova de mira, colisão, destruição ou dano nasce aqui, e é
  // exatamente esse o ponto: a arma nova herda a física da antiga em vez de reescrevê-la.

  /** Alvos atingíveis do mapa; a lista viva da horda. */
  get combatTargets():readonly TrainingTarget[] {return this.yard.targets;}
  /** Contato do mundo estático, com o triângulo quando o backend radial o conhece. */
  traceWorld(origin:Vector3,direction:Vector3,range:number):CombatContact|undefined {
    const hit=this.worldPick(new Ray(origin,direction,range));
    if(!hit?.hit||!hit.pickedPoint)return undefined;
    return {point:hit.pickedPoint,normal:hit.getNormal(true)??direction.negate(),distance:hit.distance,
      target:undefined,triangle:this.pickTriangle.get(hit)};
  }
  /**
   * Mundo + atores na frente dele, ordenados. O recorte por `world.distance` é o MESMO que o tiro
   * comum já fazia: um inimigo atrás da parede não entra na lista, então nenhum consumidor precisa
   * lembrar de conferir cobertura.
   */
  sweep(origin:Vector3,direction:Vector3,range:number,padding=0):CombatSweep {
    const world=this.traceWorld(origin,direction,range);
    const limit=world?world.distance:range;
    const ray=new Ray(origin,direction,range);
    const actors:CombatContact[]=[];
    for(const target of this.yard.targets){
      if(!target.mesh.isPickable||!target.mesh.isEnabled())continue;
      const hit=this.targetPick(ray,target,padding);
      if(!hit.hit||!hit.pickedPoint||hit.distance>=limit)continue;
      actors.push({point:hit.pickedPoint,normal:hit.getNormal(true)??direction.negate(),distance:hit.distance,
        target,triangle:undefined});
    }
    actors.sort((a,b)=>a.distance-b.distance);
    return {world,actors};
  }
  /** Dano num ator pela porta de sempre; o contador de acertos do jogador é compartilhado. */
  applyHit(target:TrainingTarget,spec:CombatHitSpec):void {
    const context:DamageContext={attackerId:1,victimId:target.id,sourceId:spec.sourceId,attackId:spec.attackId,
      baseDamage:spec.damage,finalDamage:spec.damage,crit:false,procCoefficient:spec.procCoefficient,procChainDepth:0,
      damageTags:spec.tags,
      hitPosition:{x:spec.point.x,y:spec.point.y,z:spec.point.z},
      hitNormal:{x:-spec.ray.x,y:-spec.ray.y,z:-spec.ray.z},
      forceDirection:{x:spec.force.x,y:spec.force.y,z:spec.force.z},
      hitDirection:{x:spec.ray.x,y:spec.ray.y,z:spec.ray.z},
      forceMagnitude:spec.forceMagnitude};
    this.events.emit('DamageDealt',context);target.onHit?.(context);
    target.hits++;this.hits++;this.hitTime=.12;target.ring?.scaling.setAll(1.1);
  }
  /** Mesma porta de destruição do tiro e do soco. */
  damageScenery(point:Vector3,normal:Vector3,direction:Vector3,damage:number,triangle:number|undefined):boolean {
    return this.destroyScenery(point,normal,direction,damage,triangle);
  }
  updatePose(dt: number): void {
    const body=this.body(),frame=this.frame();
    for(let side=0;side<2;side++) {
      this.recoil[side]=Math.max(0,this.recoil[side]!-dt);
      const root=this.weapons[side]!;const hand=this.visual.hands[side];
      root.setEnabled(this.visual.ready&&!this.holstered&&!this.concealed);
      if(this.holstered||this.concealed){this.reloadMagazines[side]!.setEnabled(false);this.flashLights[side]!.intensity=0;continue;}
      const grip=this.visual.grips?.[side];
      const intensity=this.recoil[side]!/t.recoilSeconds;
      this.flashLights[side]!.intensity=intensity>.6?(intensity-.6)*4:0;
      if(grip){
        const p=this.magazine.progress,air=this.magazine.reloading&&p>.18&&p<.84;grip.computeWorldMatrix(true);const gripPosition=grip.getAbsolutePosition(),gripRotation=Quaternion.Identity();grip.getWorldMatrix().decompose(undefined,gripRotation);
        if(air){let start=this.tossStarts[side];if(!start){start={position:gripPosition.subtract(body),rotation:gripRotation.clone()};this.tossStarts[side]=start;}const flight=(p-.18)/.66;
          // O arco do arremesso sobe na vertical LOCAL. No jogo plano `up` é `+Y` e a soma é a mesma de sempre.
          root.parent=null;Vector3.LerpToRef(start.position.add(body),gripPosition,flight*flight,root.position);root.position.addInPlace(frame.up.scale(Math.sin(Math.PI*flight)*1.12));root.rotationQuaternion=Quaternion.RotationAxis(this.tumbleAxis(frame),flight*Math.PI*4).multiply(Quaternion.Slerp(start.rotation,gripRotation,flight));
        }else{this.tossStarts[side]=undefined;root.parent=grip;root.position.setAll(0);root.rotationQuaternion=Quaternion.Identity();}
        root.computeWorldMatrix(true);const magazine=this.reloadMagazines[side]!;magazine.setEnabled(air&&p>.38&&p<.66);
        if(magazine.isEnabled()){const phase=(p-.38)/.28;Vector3.LerpToRef(offsetInFrame(body,frame,side===0?.25:-.25,.88,.08),root.getAbsolutePosition(),phase,magazine.position);magazine.rotationQuaternion=root.rotationQuaternion?.clone()??Quaternion.Identity();}
        continue;
      }
      root.position.copyFrom(hand?.getAbsolutePosition()??offsetInFrame(body,frame,side===0?.35:-.35,1.2,.3));
      const kick=this.recoil[side]!/t.recoilSeconds;
      this.flashLights[side]!.intensity=kick>.6?(kick-.6)*4:0;
      root.rotationQuaternion??=Quaternion.Identity();
      if(this.visual.dodging&&hand&&this.gripRotations[side]) {
        const handRotation=Quaternion.Identity();hand.getWorldMatrix().decompose(undefined,handRotation);
        root.rotationQuaternion.copyFrom(handRotation.multiply(this.gripRotations[side]!));
      }else {
        root.lookAt(root.position.add(this.camera.forward).addInPlace(frame.up.scale(kick*.035)));
        if(hand){const handRotation=Quaternion.Identity();hand.getWorldMatrix().decompose(undefined,handRotation);this.gripRotations[side]=handRotation.conjugate().multiply(root.rotationQuaternion);}
      }
      root.position.addInPlace(Vector3.Forward().applyRotationQuaternion(root.rotationQuaternion).scale(.045));root.computeWorldMatrix(true);
    }
    this.hitTime=Math.max(0,this.hitTime-dt);this.effects.update(dt);this.casings.update(dt);
  }
  fixedUpdate(dt: number,fire: boolean): void {
    // Escondida, a pistola NÃO conta o relógio do carregador nem se recarrega sozinha. Sem esta
    // guarda, equipar a PRISM encheria as duas armas ao mesmo tempo — a recarga de graça que a
    // troca de arma não pode conceder. As habilidades de MP continuam correndo normalmente: elas
    // pagam MP, não munição.
    if(this.concealed)this.visual.reloadProgress=-1;
    else {
      this.magazine.update(dt);this.visual.reloadProgress=this.magazine.reloading?this.magazine.progress:-1;
      if(this.magazine.ammo===0&&!this.magazine.reloading)this.requestReload();
    }
    this.cadence.update(dt,fire&&!this.magazine.reloading&&this.magazine.ammo>0&&this.visual.ready&&this.barrageIndex>=this.barrageTotal&&this.stormRemaining<=0&&this.fanIndex>=this.fanTotal,side=>this.shoot(side));
    if(this.actionClock&&this.actionClock()>=this.actionDuration){this.fanIndex=this.fanTotal;this.barrageIndex=this.barrageTotal;this.stormRemaining=0;}
    // MP I e MP II: cada NOVO disparo copia a mira atual.
    // Interpolar vetores por lerp normalizado NÃO resolve giro de 180°: com direções antipodais o
    // resultado degenera e a sequência continuava saindo para o lado inicial. Balas já em voo
    // conservam a própria trajetória; só o próximo tiro muda de direção.
    if(this.fanIndex<this.fanTotal){
      this.fanDirection.copyFrom(this.camera.forward);
      this.fanClock-=dt;if(this.actionClock)this.fanClock=this.fanIndex*this.fanInterval-this.actionClock();
      if(this.fanClock<=0){this.launchFanBullet(this.fanIndex++);this.fanClock+=this.fanInterval;}
    }
    this.fan.update(dt);
    if(this.barrageIndex<this.barrageTotal){
      this.barrageDirection.copyFrom(this.camera.forward);
      this.barrageClock-=dt;if(this.actionClock)this.barrageClock=this.barrageIndex*this.barrageInterval-this.actionClock();
      // A varredura gira em torno da vertical LOCAL. Em torno de `+Y` o Rodrigues devolve termo a
      // termo a guinada literal de antes (`x·cos+z·sin`, `y` intacto, `z·cos−x·sin`); num planeta
      // ela deixa de abrir num plano errado fora do polo norte.
      if(this.barrageClock<=0){const i=this.barrageIndex++,angle=(i/Math.max(1,this.barrageTotal-1)-.5)*.75,dir=rotateAboutAxis(this.barrageDirection,this.up(),angle);dir.normalize();this.skillRay((i%2) as 0|1,dir,'backflip_barrage',24,false);this.barrageClock+=this.barrageInterval;}
    }

    if(this.stormRemaining<=0)return;
    this.stormRemaining=this.actionClock?Math.max(0,this.actionDuration-this.actionClock()):Math.max(0,this.stormRemaining-dt);this.stormClock-=dt;
    if(this.stormClock>0)return;this.stormClock+=1/20;
    const origin=this.body().add(this.up().scale(1.3));
    const side=(this.skillShots%2) as 0|1;
    // MP III: só alvos com alcance, ângulo e linha de visão reais entram no rodízio.
    const candidates=this.yard.targets.filter(target=>{
      if(!target.mesh.isPickable||!target.mesh.isEnabled()||!isAutoAimTarget(target.id))return false;
      const centre=target.mesh.getBoundingInfo().boundingBox.centerWorld,offset=centre.subtract(origin),distance=offset.length();
      if(distance>60||Vector3.Dot(offset.normalizeToNew(),this.camera.forward)<=.35)return false;
      const cover=this.worldPick(new Ray(origin,offset.normalizeToNew(),distance-.35));
      return !cover?.hit;
    });
    // Sem alvo válido a tempestade continua disparando para a frente — nunca fica em silêncio.
    if(!candidates.length){this.skillRay(side,this.camera.forward.clone(),'harvest_storm',18,false);return;}
    const target=candidates[this.stormTarget++%candidates.length]!;
    const aimPosition=target.mesh.getBoundingInfo().boundingBox.centerWorld;this.visual.stormAim(side,aimPosition);
    this.skillRay(side,aimPosition.subtract(origin).normalize(),'harvest_storm',18,false,aimPosition);
  }
  releaseSkill(tier: Exclude<MPTier,0>,prepared=false,duration?:number,clock?:()=>number): void {
    this.fanIndex=this.fanTotal;this.barrageIndex=this.barrageTotal;this.stormRemaining=0;this.actionClock=clock;this.actionDuration=duration??0;this.visual.release();
    const id=tier===1?'ricochet_fan':tier===2?'backflip_barrage':'harvest_storm';
    this.events.emit('SkillUsed',{entityId:1,skillId:id});
    if(tier===3){this.stormRemaining=duration??3;this.stormClock=0;return;}
    if(tier===1){this.fanTotal=duration?48:10;this.fanInterval=duration?duration/this.fanTotal:.055;this.fanDirection.copyFrom(this.camera.forward);this.fanIndex=0;this.fanClock=prepared?0:.18;this.visual.beginFanCast?.(prepared);return;}
    this.barrageTotal=duration?Math.min(48,Math.round(duration*14)):14;this.barrageInterval=duration?duration/this.barrageTotal:.6/14;this.barrageIndex=0;this.barrageClock=0;this.barrageDirection.copyFrom(this.camera.forward);
  }
  resetAttempt():void {this.cancelSkills();this.magazine.ammo=this.magazine.capacity;this.cadence.reset();this.casings.clear();this.effects.clear();this.hits=0;this.skillShots=0;this.sceneryHits=0;this.hitTime=0;this.lastImpact="—";this.recoil.fill(0);for(const light of this.flashLights)light.intensity=0;for(const m of this.reloadMagazines)m.setEnabled(false);}
  cancelSkills():void {this.magazine.cancel();this.visual.reloadProgress=-1;this.actionClock=undefined;this.fan.clear();this.fanIndex=this.fanTotal;this.barrageIndex=this.barrageTotal;this.stormRemaining=0;}
  private launchFanBullet(index:number):void {
    const side=(index%2) as 0|1,muzzle=this.muzzle[side]!;muzzle.computeWorldMatrix(true);const origin=muzzle.getAbsolutePosition().clone();
    const up=this.up().clone(),chest=this.body().add(up.scale(1.3)),toMuzzle=origin.subtract(chest),obstruction=this.worldPick(new Ray(chest,toMuzzle.normalizeToNew(),toMuzzle.length()));
    if(obstruction?.pickedPoint)origin.copyFrom(obstruction.pickedPoint).addInPlace((obstruction.getNormal(true)??this.fanDirection.negate()).scale(.04));
    // O leque abre no plano perpendicular à vertical LOCAL: horizontal no equador, no polo e de cabeça para baixo.
    const direction=this.fan.launch(origin,this.fanDirection,index,this.fanTotal,up);this.visual.fanAim?.(side,direction);this.visual.fire(side);this.effects.muzzle(origin);this.casings.eject(origin,this.camera.forward,side);this.recoil[side]=t.recoilSeconds;this.skillShots++;this.audio.shot(false);
  }
  /**
   * Backend radial cru, quando a física o publicou. `undefined` no mundo plano.
   *
   * A decisão é a flag EXPLÍCITA `spherical`, não a presença de `geometry`: `configurePlanet` só
   * troca o `surface` e nunca preenche `geometry`, então a guarda antiga mandava o planeta inteiro
   * para o `scene.pickWithRay` — que não enxerga o terreno de colisão — e a bala atravessava o
   * chão calada. Nenhum array de triângulo falso é alocado para contornar isso.
   */
  private planetPick():CombatTriangleCollision|undefined {
    const collision=this.yard.collision;return collision?.spherical?collision.planet?.collision:undefined;
  }
  private worldPick(ray:Ray):PickingInfo|null {
    const planet=this.planetPick();
    if(planet){
      const hit=planet.raycast(ray.origin,ray.direction,ray.length);if(!hit)return null;
      const result=new PickingInfo();result.hit=true;result.distance=hit.distance;
      result.pickedPoint=new Vector3(hit.point.x,hit.point.y,hit.point.z);
      const normal=new Vector3(hit.normal.x,hit.normal.y,hit.normal.z);result.getNormal=()=>normal;
      // Só este caminho conhece triângulo; o plano e o picking de cena não têm o que registrar.
      this.pickTriangle.set(result,hit.triangle);return result;
    }
    if(!this.yard.collision?.geometry){const hit=this.scene.pickWithRay(ray,mesh=>mesh.isPickable&&!this.yard.targets.some(t=>t.mesh===mesh||t.meshes?.includes(mesh as typeof t.mesh)));return hit?.hit?hit:null;}
    const hit=this.yard.collision.raycast(ray);if(!hit)return null;const result=new PickingInfo();result.hit=true;result.distance=hit.distance;result.pickedPoint=hit.point;result.getNormal=()=>hit.normal;return result;
  }
  /**
   * Oferece um acerto de CENÁRIO à destruição. Único ponto de entrada, para os quatro emissores.
   * `true` quando a fachada assumiu o corpo — e então a MARCA genérica de bala é omitida, porque a
   * rachadura progressiva e o som do material do subsistema já são o retorno autoral.
   *
   * Nada aqui emite `DamageDealt` nem toca em `Health`, então **prop nenhum paga MP**: a barra
   * continua sendo paga só por `EnemyHit`, que só a vida de uma praga emite. `hits` também não
   * cresce — o contador de acerto do jogador continua contando inimigo.
   *
   * Sem fachada (mundo plano, manifesto ausente, carga falhada) o retorno é `false` e cada emissor
   * faz exatamente o que sempre fez.
   */
  private destroyScenery(point:Vector3,normal:Vector3,direction:Vector3,damage:number,triangle:number|undefined):boolean {
    const outcome=this.destruction.hit(destructionHit(
      {x:point.x,y:point.y,z:point.z},{x:direction.x,y:direction.y,z:direction.z},damage,triangle,
      {x:normal.x,y:normal.y,z:normal.z}));
    if(!outcome)return false;
    this.sceneryHits++;return true;
  }
  /**
   * Erro COMPARTILHADO.
   *
   * `targetPick` é chamado uma vez por ator por raio, e um disparo comum já lança dois raios
   * (mira da câmera e raio do cano) — com a horda cheia isso eram dezenas de `PickingInfo` e de
   * `Vector3` descartados por tiro, a 6,6 tiros por segundo, só para todos responderem "não
   * acertei". Nenhum chamador guarda um `PickingInfo` que não acertou (todos testam `.hit` antes),
   * então o caso de erro devolve sempre o mesmo objeto e nada é alocado.
   */
  private static readonly MISS=new PickingInfo();
  /** Rascunhos do teste de caixa; nenhum deles sobrevive à chamada. */
  private readonly boxMin=new Vector3();private readonly boxMax=new Vector3();private readonly travel=new Vector3();
  private targetPick(ray:Ray,target:TrainingTarget,padding=0):PickingInfo {
    // Bounding volumes are updated by the animated actor. No per-shot CPU skinning or triangle walk.
    const box=target.mesh.getBoundingInfo().boundingBox;
    this.boxMin.copyFromFloats(box.minimumWorld.x-padding,box.minimumWorld.y-padding,box.minimumWorld.z-padding);
    this.boxMax.copyFromFloats(box.maximumWorld.x+padding,box.maximumWorld.y+padding,box.maximumWorld.z+padding);
    ray.direction.scaleToRef(ray.length,this.travel);
    const hit=sweepBox(ray.origin,this.travel,{id:String(target.id),min:this.boxMin,max:this.boxMax});
    if(!hit)return DualPistols.MISS;
    if(padding>0){const contact=ray.origin.add(ray.direction.scale(hit.time*ray.length)),surface=Vector3.Clamp(contact,box.minimumWorld,box.maximumWorld),delta=surface.subtract(ray.origin),length=delta.length();if(length>.001){const cover=this.worldPick(new Ray(ray.origin,delta.scale(1/length),length));if(cover&&cover.distance<length-.015)return DualPistols.MISS;}}
    const result=new PickingInfo();
    result.hit=true;result.distance=hit.time*ray.length;result.pickedMesh=target.mesh;result.pickedPoint=ray.origin.add(ray.direction.scale(result.distance));result.getNormal=()=>new Vector3(hit.normal.x,hit.normal.y,hit.normal.z);return result;
  }
  private aimPick(ray:Ray):PickingInfo|null {
    let hit=this.worldPick(ray);for(const target of this.yard.targets){if(!target.mesh.isPickable||!target.mesh.isEnabled())continue;const candidate=this.targetPick(ray,target);if(candidate.hit&&(!hit||candidate.distance<hit.distance))hit=candidate;}return hit;
  }
  private skillRay(side:0|1,dir:Vector3,id:string,damage:number,pierce:boolean,aimPoint?:Vector3): void {
    const muzzle=this.muzzle[side]!;muzzle.computeWorldMatrix(true);const origin=muzzle.getAbsolutePosition().clone();
    if(aimPoint)dir=aimPoint.subtract(origin).normalize();
    else {
      const aim=this.aimPick(new Ray(this.camera.camera.position,dir,t.range));
      dir=(aim?.pickedPoint??this.camera.camera.position.add(dir.scale(t.range))).subtract(origin).normalize();
    }
    const ray=new Ray(origin,dir,t.range);
    const obstruction=this.worldPick(ray);
    const distance=obstruction?.hit?obstruction.distance:t.range;
    const targets=this.yard.targets.filter(target=>target.mesh.isPickable&&isAutoAimTarget(target.id)).map(target=>({target,hit:this.targetPick(ray,target,id==='backflip_barrage'?.85:0)})).filter(result=>result.hit.hit&&result.hit.distance<distance).sort((a,b)=>a.hit.distance-b.hit.distance);
    for(const {target,hit} of pierce?targets:targets.slice(0,1))this.damageTarget(target,hit.pickedPoint!,dir,damage,id);
    const end=!pierce&&targets[0]?.hit.pickedPoint?targets[0].hit.pickedPoint:origin.add(dir.scale(distance));
    // Cenário só leva dano quando NENHUM ator ficou na frente: `targets` já foi filtrado por
    // `hit.distance < distance`, então um inimigo entre o cano e o prop consome o tiro e o prop
    // continua inteiro. Mesmo teste que já decidia onde sai a marca de bala.
    if(obstruction?.hit&&(pierce||targets.length===0)&&!this.destroyScenery(end,obstruction.getNormal(true)??dir.negate(),dir,damage,this.pickTriangle.get(obstruction))){this.effects.mark(end,obstruction.getNormal(true)??dir.negate());this.effects.impact(end,obstruction.getNormal(true)??dir.negate());}
    if(pierce)this.effects.piercer(origin,end);else this.effects.tracer(origin,end);this.effects.muzzle(origin);this.casings.eject(origin,this.camera.forward,side);this.visual.fire(side);this.recoil[side]=t.recoilSeconds;this.skillShots++;
    this.audio.shot(targets.length>0);
  }
  private damageTarget(target:TrainingTarget,hit:Vector3,dir:Vector3,damage:number,id:string): void {
    // `hitDirection` é o MESMO raio que produziu `hit`, e é o par que o teste de ponto fraco usa.
    const context:DamageContext={attackerId:1,victimId:target.id,sourceId:id,attackId:id,baseDamage:damage,finalDamage:damage,crit:false,procCoefficient:id==='ricochet_fan'?.3:1,procChainDepth:0,damageTags:['bullet','skill'],hitPosition:{x:hit.x,y:hit.y,z:hit.z},hitNormal:{x:-dir.x,y:-dir.y,z:-dir.z},forceDirection:{x:dir.x,y:dir.y,z:dir.z},hitDirection:{x:dir.x,y:dir.y,z:dir.z},forceMagnitude:5};
    this.events.emit('DamageDealt',context);target.onHit?.(context);target.hits++;this.hits++;this.hitTime=.12;target.ring?.scaling.setAll(1.15);this.effects.impact(hit,dir.negate());
    // Impacto audível por habilidade: o som do disparo não substitui o do acerto.
    this.audio.skillImpact?.(id);
  }
  private shoot(side: 0 | 1): void {
    if(!this.magazine.consume())return;
    this.lastSide=side;this.recoil[side]=t.recoilSeconds;this.visual.fire(side);
    const spread=t.spreadDegrees*Math.PI/180;
    const dir=this.camera.forward.clone();dir.x+=this.rng.range(-spread,spread);dir.y+=this.rng.range(-spread,spread);dir.normalize();
    const aim=this.aimPick(new Ray(this.camera.camera.position,dir,t.range));
    const aimPoint=aim?.pickedPoint??this.camera.camera.position.add(dir.scale(t.range));
    const muzzle=this.muzzle[side]!;muzzle.computeWorldMatrix(true);const origin=muzzle.getAbsolutePosition().clone();
    const shot=aimPoint.subtract(origin);const ray=new Ray(origin,shot.normalize(),Vector3.Distance(origin,aimPoint)+.05);
    const result=this.aimPick(ray);
    this.lastImpact=result?.pickedMesh?.name??'céu';
    const hit=result?.pickedPoint??aimPoint;
    this.effects.muzzle(origin);this.casings.eject(origin,this.camera.forward,side);this.effects.tracer(origin,hit);
    if(result?.hit)this.effects.impact(hit,result.getNormal(true)??dir.negate());
    this.camera.impulse(.009);
    const target=this.yard.targets.find(target=>target.mesh===result?.pickedMesh||!!result?.pickedMesh&&target.meshes?.includes(result.pickedMesh as typeof target.mesh));
    // `aimPick` já elegeu o contato mais próximo entre mundo e atores: se um inimigo venceu, o
    // cenário atrás dele não é tocado. O `impact` logo acima continua saindo nos dois casos, como
    // sempre saiu (ele também sai em inimigo); o que a destruição substitui é só a MARCA de bala.
    if(result?.hit&&!target&&!this.destroyScenery(hit,result.getNormal(true)??dir.negate(),dir,t.damage,this.pickTriangle.get(result)))this.effects.mark(hit,result.getNormal(true)??dir.negate());
    if(target) {
      const normal=result?.getNormal(true)??this.space.upAt(hit);
      // `forceDirection` continua sendo o rumo da CÂMERA (é o tranco, e nada mudou nele);
      // `hitDirection` é o raio que saiu do CANO — o mesmo que produziu `hit`. A poucos metros os
      // dois diferem em graus, e é o segundo que diz de que lado a bala entrou no corpo.
      const context: DamageContext={attackerId:1,victimId:target.id,sourceId:'dual_pistols',attackId:side===0?'right':'left',baseDamage:t.damage,finalDamage:t.damage,crit:false,procCoefficient:1,procChainDepth:0,damageTags:['bullet'],hitPosition:{x:hit.x,y:hit.y,z:hit.z},hitNormal:{x:normal.x,y:normal.y,z:normal.z},forceDirection:{x:dir.x,y:dir.y,z:dir.z},hitDirection:{x:ray.direction.x,y:ray.direction.y,z:ray.direction.z},forceMagnitude:2};
      this.events.emit('DamageDealt',context);target.onHit?.(context);target.hits++;this.hits++;this.hitTime=.12;
      target.ring?.scaling.setAll(1.08);
    }
    this.audio.shot(Boolean(target));
  }
  dispose(): void {this.disposed=true;this.cancelSkills();this.effects.dispose();this.casings.dispose();for(const magazine of this.reloadMagazines)magazine.dispose();for(const root of this.weapons)root.dispose();this.container?.dispose();}
}

