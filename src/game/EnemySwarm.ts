import type {HitClaim} from '../net/HitClaim';
import {chooseSpawnAround} from '../ai/SpawnPlanner';
import {EnemyLaser} from '../vfx/EnemyLaser';
import {aimArmAt} from '../animation/AimArm';
import {PointLight} from '@babylonjs/core/Lights/pointLight';
import {ElementalEffects} from '../vfx/ElementalEffects';
import {BurningStatus} from '../combat/BurningStatus';
import {enemyImpact,corpseLaunch} from '../enemies/EnemyImpact';
import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader';
import type { AssetContainer } from '@babylonjs/core/assetContainer';
import type { AnimationGroup } from '@babylonjs/core/Animations/animationGroup';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { Vector3,Quaternion } from '@babylonjs/core/Maths/math.vector';
import type { Scene } from '@babylonjs/core/scene';
import type { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import { Health } from '../combat/Health';
import type { EventBus } from '../core/EventBus';
import type { DamageContext,GameEvents,Vec3 } from '../core/contracts';
import type { RunRNG } from '../core/RunRNG';
import type { CollisionWorld } from '../physics/CollisionWorld';
import type { PlayerMotor } from '../player/PlayerMotor';
import type { TrainingTarget } from '../world/TrainingYard';
import { FarmNavigation } from '../ai/FarmNavigation';
import { AIScheduler } from '../ai/AIScheduler';
import { ENEMIES,ENEMY_VISUAL_DROP,MonsterDirector,bossHealth,killBounty,isSaucerSpecies,type DirectorMode,type EnemyKind } from '../run/MonsterDirector';
import { WEAK_POINTS,resolveWeakPoint,weakPointDamageMultiplier,weakPointEligible,type WeakPointSphere,type WeakPointZone } from '../combat/WeakPoints';
import { INCENDIARY_SECONDS,INCENDIARY_TAG } from '../combat/PrismSkills';
import { normalizeAnimatedCharacter,type NormalizedCharacter } from '../world/AnimatedCharacter';
import { ALIEN_PROFILES } from '../enemies/AlienProfiles';
import type { RunProgression } from '../run/RunProgression';
import { CombatPresentation } from '../vfx/CombatPresentation';
import { ENEMY_BEHAVIORS,type TelegraphPlan } from '../enemies/EnemyBehaviors';
import { ItemProcs } from '../items/ItemProcs';
import { CorpseDebris } from '../physics/CorpseDebris';
import { TacticalNavigation } from '../ai/TacticalNavigation';
import { AnimationStateMachine } from '../animation/AnimationStateMachine';
import { RagdollWorld } from '../physics/RagdollWorld';
import type { Skeleton } from '@babylonjs/core/Bones/skeleton';
import type { WeaponAudio } from '../audio/RecordedAudio';
import '@babylonjs/core/Rendering/outlineRenderer';
import '@babylonjs/core/Shaders/outline.vertex';
import '@babylonjs/core/Shaders/outline.fragment';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { ENEMY_AFFIXES,chooseVariant,type EnemyVariant } from '../enemies/EnemyAffixes';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { PopulationBudget } from '../run/PopulationBudget';
import { PosePalette } from '../animation/PosePalette';
import { FruitFragments } from '../vfx/FruitFragments';
import { HordeTickCache } from './HordeTickCache';
import { enemySpace,radialSurfaceOf,type EnemySpace,type EnemySurface,type Heading } from '../enemies/EnemySpace';
import { mark,section } from '../debug/FreezeTrace';
import { GroundFireField,GROUND_FIRE } from '../combat/GroundFire';

type State='spawn'|'chase'|'windup'|'recover'|'flee'|'dead';
/**
 * Uma linha da horda AUTORITATIVA, já decodificada do schema.
 *
 * Declarada aqui, e não importada do servidor, para a apresentação não passar a depender de
 * `server/`: o cliente recebe números e desenha. `targetPlayerId` vem junto de propósito — quem o
 * inimigo está caçando é decisão do servidor, e sem o campo o cliente teria de adivinhar (e duas
 * telas adivinhariam diferente, que é o bug que este bloco fecha).
 */
export interface ReplicatedEnemy {
  id:number;kind:EnemyKind;variant:EnemyVariant;scale:number;
  x:number;y:number;z:number;yaw:number;hp:number;maxHP:number;
  state:State;time:number;burn:number;stagger:number;targetPlayerId:number;alive:boolean;
}
/** Amostras guardadas para desenhar o corpo UM patch no passado (contrato §13). */
interface ReplicaTrack {previous:Vec3;target:Vec3;yawPrevious:number;yawTarget:number;elapsed:number;interval:number;rx:number;ry:number;rz:number;ryaw:number}
interface Actor {id:number;kind:EnemyKind;variant:EnemyVariant;scale:number;push:Vector3;root:TransformNode;body:Mesh;visual:TransformNode;clips:Map<string,AnimationGroup>;machine:AnimationStateMachine;skeleton:Skeleton|undefined;laserSocket?:TransformNode;laserArm?:TransformNode;
  /** Id do corpo no servidor, quando a horda é replicada. Ausente = corpo decidido localmente. */
  serverId?:number;replica?:ReplicaTrack;
  /** Quem este corpo está caçando, segundo o SERVIDOR. Apresentação; nunca recalculado aqui. */
  targetPlayerId?:number;
  /** Nós do rig que formam o ponto fraco da espécie, resolvidos uma vez. `[]` = espécie sem zona. */
  weakNodes?:TransformNode[];ragdoll:ReturnType<RagdollWorld['create']>;healthTrail:number;gait:number;lastPosePosition:Vector3;palette:PosePalette;health:Health;target:TrainingTarget;state:State;time:number;attack:number;locked:Vec3;direction:Heading;facing:Vector3;burn:number;burnClock:number;anim:number;hit:number;stagger:number;staggerCooldown:number;deathVelocity:Vector3;active:boolean;cooldown:number}
/**
 * Vetores de rascunho da horda. O laço roda a 60 Hz com até 80 atores: cada `new Vector3` aqui
 * dentro seria lixo por ator por quadro. Nenhum deles sobrevive à chamada que o usa.
 */
const work0=new Vector3(),work1=new Vector3(),work2=new Vector3(),work3=new Vector3();
const workVec:Vec3={x:0,y:0,z:0};
const heading=(v:Vector3):Heading=>({x:v.x,y:v.y,z:v.z});
const headingLength=(d:Heading):number=>Math.hypot(d.x,d.y??0,d.z);
/** Cores de overlay compartilhadas: eram duas alocações (uma delas com parse de hexadecimal) por malha por frame. */
const HIT_OVERLAY=Color3.FromHexString('#fff0bc'),CHARGE_OVERLAY=new Color3(1,.25,.025);
/** Mesmo teto de antes: só os quatro corpos mais próximos projetam sombra. */
const SHADOW_CASTERS=4;
/**
 * Coleira da horda, em metros CAMINHÁVEIS (arco no planeta).
 *
 * Além disto o corpo não alcança, não atira, não é ouvido e é um pixel na tela: seguir o jogador
 * por ilhas afora só queima IA, agente do Detour, sonda de colisão e — o que dói de verdade — a
 * vaga de população que um hostil perto poderia estar ocupando. O valor fica acima do dobro do anel
 * de spawn (`SPAWN_RING_MAX`=35) e acima da faixa "longe" do `AIScheduler` (60), então nada que
 * ainda esteja em combate, ou que acabou de nascer, é recolhido.
 */
export const STRAY_DISTANCE=72;
/**
 * Uma reposição por vez. Recolher oito retardatários de uma vez é barato e é o objetivo; devolvê-los
 * todos no mesmo segundo em volta do jogador seria uma emboscada que ninguém pediu.
 */
export const STRAY_REPLACEMENT_INTERVAL=1.1;
/** Distância mínima para a aposentadoria por ORÇAMENTO (quadro pesado), que é outra coisa. */
const RETIREMENT_DISTANCE=18;
/**
 * Quantos cadáveres ARTICULADOS podem nascer num único passo fixo.
 *
 * `RagdollWorld.create` monta ~19 corpos de Havok com junções: é o trabalho mais caro do caminho de
 * morte, e uma explosão de item (`bomb`) mata vários hostis no MESMO quadro. Sem teto, um estouro
 * em cadeia perto da Praga Alfa pedia cinco ragdolls de uma vez. Quem não couber cai no clipe
 * rígido de morte que já existe — o mesmo comportamento de quando o modelo não tem esqueleto — e
 * nenhuma recompensa, abate, colheita ou evento muda por isso. A Praga Alfa fura o teto (o cadáver
 * dela é a cena que o jogador está esperando), mas ainda consome a vaga do passo.
 */
export const RAGDOLL_SPAWNS_PER_STEP=1;
export interface DamageLabel {position:Vec3;amount:number;crit:boolean;time:number;
  /**
   * `true` quando o número veio de um acerto direto no ponto fraco da espécie.
   * Opcional para não quebrar quem monta rótulos de fora (QA, testes de HUD): ausente = normal.
   */
  weak?:boolean}
/**
 * A que distância as espécies dos discos voadores DESISTEM da caçada.
 *
 * Elas não podem entrar no recolhimento comum: `recycleStrays` promete REPOSIÇÃO, e repor um corpo
 * da represália perto do jogador seria a invasão renascendo sozinha do outro lado do mapa. Elas
 * também não podem simplesmente evaporar no lugar — o pedido é que elas CORRAM e sumam.
 *
 * O número é menor que `STRAY_DISTANCE` (72 m) de propósito: a desistência tem de acontecer
 * enquanto o corpo ainda é visível, senão a corrida de saída não seria vista por ninguém.
 */
export const SAUCER_FLEE_DISTANCE=46;
/** A partir daqui o fugitivo já está fora de alcance e some de vez. */
export const SAUCER_VANISH_DISTANCE=78;
/** Teto de tempo da fuga: quem ficou preso em geometria some mesmo assim, em vez de correr para sempre. */
export const SAUCER_FLEE_SECONDS=9;
/** A retirada é mais rápida que a perseguição — elas fogem de verdade. */
export const SAUCER_FLEE_SPEED=1.45;
/** Simulation, AI scheduling and presentation share stable actor IDs; visuals are recycled. */
export class EnemySwarm {
  private readonly lasers:EnemyLaser;private readonly chargeLights:PointLight[]=[];readonly burning=new BurningStatus();private readonly elemental:ElementalEffects;private flameClock=0;readonly actors:Actor[]=[];readonly scheduler=new AIScheduler();readonly effects:CombatPresentation;readonly labels:DamageLabel[]=[];
  director:MonsterDirector;private navigation:FarmNavigation|undefined;private containers=new Map<string,AssetContainer>();private readonly eliteMaterials=new Map<string,PBRMaterial>();private disposed=false;private nextId=200;
  /** Fila de ataque e contagem de `windup` montadas uma vez por tique, em vez de uma vez por ator. */
  readonly tick=new HordeTickCache();
  private readonly byId=new Map<number,Actor>();
  private readonly separationBuckets=new Map<number,Actor[]>();private readonly separationPool:Actor[][]=[];
  private readonly nearestSlots:{actor:Actor|undefined;distance:number}[]=[];
  /** Ator que cada luz de carga já está filtrando, para não reatribuir `includedOnlyMeshes` por quadro. */
  private readonly chargeLightTargets:(Actor|undefined)[]=[];
  private readonly isChargingTomato=(a:Actor):boolean=>a.active&&!a.health.dead&&a.kind==='tomato'&&a.state==='windup';
  private readonly isLiveActor=(a:Actor):boolean=>a.active&&!a.health.dead;
  ready=false;error='';kills=0;boss:Actor|undefined;bossDeadTime=-1;message='';
  /**
   * QUEM DECIDE esta horda.
   *
   * `local` é a fazenda de sempre: diretor, nascimento, IA, vida e morte saem daqui. `server` é o
   * cooperativo: o dono é `EnemySimulation`, e este objeto vira APRESENTAÇÃO — malha, pose, ragdoll,
   * som e rótulo. Nunca os dois (contrato §18.8): a primeira chamada de `replicate` desliga a
   * decisão local no mesmo passo, em vez de deixá-la rodando em paralelo duplicando entidade.
   */
  private authority:'local'|'server'='local';
  get replicated():boolean {return this.authority==='server';}
  /** Só `replicate` pode criar corpo depois da virada; `spawn` externo é recusado. */
  private applyingReplica=false;
  private readonly byServerId=new Map<number,Actor>();
  /**
   * Id do último ator que `spawn` colocou em campo, ou −1 se a última chamada falhou.
   *
   * Existe para quem precisa acompanhar UM inimigo específico depois de pedir o nascimento dele —
   * é assim que a represália dos discos sabe qual corpo deve largar o item raro ao morrer.
   */
  lastSpawnedId=-1;
  /** Espécies cujo relatório de importação já foi impresso: um por espécie, não um por corpo. */
  private readonly reported=new Set<EnemyKind>();
  /**
   * Onde caiu o último inimigo abatido pelo jogador. A recompensa da horda/evento é ejetada
   * neste ponto (ou no piso seguro mais próximo), em vez de um campo fixo no centro do mapa.
   */
  lastKill:{position:Vec3;kind:EnemyKind;age:number}|undefined;
  private harvestSequence=0;
  /** Cacos de casca/polpa/semente por espécie, derivados do corpo real. */
  readonly fragments:FruitFragments;
  private presentationTime=0;private procs:ItemProcs;private shadowClock=0;private shadowCasters:Mesh[]=[];
  populationCap=24;readonly budget=new PopulationBudget();benchmark=false;private retirementClock=0;
  /** Relógio e fila da reciclagem por distância. Ver `recycleStrays`. */
  private replacementClock=0;private readonly replacements:EnemyKind[]=[];
  /**
   * Quantos corpos a coleira recolheu e quantos já voltaram perto do jogador. São contadores de
   * diagnóstico: nenhum deles conta abate, paga recompensa ou aparece como progresso de objetivo.
   */
  strays=0;recycled=0;
  /**
   * Avisa quem cuida da represália que um corpo dela desistiu e sumiu.
   *
   * Sem este aviso `SaucerRaid` ficaria parado em `luta-et`/`onda-ativa` esperando um `EnemyKilled`
   * que nunca chega, e aquele disco nunca mais poderia ser provocado.
   */
  onSaucerDeparted:((id:number)=>void)|undefined;
  private debris:CorpseDebris;private readonly ragdolls=new RagdollWorld();tactical:TacticalNavigation|undefined;navigationReady=false;audio:WeaponAudio|undefined;
  /**
   * Quem responde "para cima". Sem `world.surface` isto é o `FlatSpace`, que chama exatamente as
   * mesmas funções de colisão de antes — a fazenda não muda um bit. Com superfície, a horda INTEIRA
   * (ataques, avisos, projéteis, cadáveres, separação) passa a medir arco e apoiar por radial, sem
   * nenhum comportamento, afixo, som ou evento alterado.
   */
  private space:EnemySpace;
  /**
   * A superfície que REALMENTE muda o referencial. O `GameWorld` entrega `collision.surface`
   * sempre, e na fazenda isso é um `FlatSurface` — que aqui vira `undefined`, para o caminho plano
   * continuar sendo o código plano literal. Trava em `tests/enemy-flat-surface-parity.test.ts`.
   */
  private radial:EnemySurface|undefined;
  /**
   * O referencial que a horda está usando, ou `undefined` na fazenda.
   *
   * É por aqui que a APRESENTAÇÃO externa (HUD) descobre para onde é "para cima" sem precisar de
   * fiação nova na integração: quem já tem o `EnemySwarm` já tem a superfície dele. O valor já vem
   * filtrado por `radialSurfaceOf`, então um `FlatSurface` aparece como `undefined`.
   */
  get surface():EnemySurface|undefined {return this.radial;}
  constructor(private readonly scene:Scene,private readonly world:{targets:TrainingTarget[];collision:CollisionWorld;surface?:EnemySurface},private readonly events:EventBus<GameEvents>,private readonly shadows:ShadowGenerator,private readonly player:PlayerMotor,private readonly progression:RunProgression,private readonly rng:RunRNG,readonly mode:DirectorMode='classic'){this.radial=radialSurfaceOf(world.surface);this.space=enemySpace(world.collision,world.surface);this.fragments=new FruitFragments(scene,world.collision);this.fragments.useSurface(world.surface);this.debris=new CorpseDebris(world.collision,world.surface);this.procs=new ItemProcs(progression,rng.stream('procs'));this.director=new MonsterDirector(rng.stream('director'),progression.stage,50,mode);this.effects=new CombatPresentation(scene);void this.effects.loadCob();this.effects.useSurface(world.surface);this.lasers=new EnemyLaser(scene);this.elemental=new ElementalEffects(scene,world.collision,world.surface);for(let i=0;i<2;i++){const light=new PointLight('tomato-incendiary-charge-'+i,Vector3.Zero(),scene);light.diffuse=new Color3(1,.23,.025);light.range=4;light.intensity=0;this.chargeLights.push(light);}}
  /**
   * Liga (ou desliga) o referencial esférico depois da construção. Nenhuma posição precisa ser
   * convertida: `Vec3` de gameplay já é coordenada de MUNDO nos dois modos.
   */
  configureSurface(surface:EnemySurface|undefined):void {
    this.radial=radialSurfaceOf(surface);this.space=enemySpace(this.world.collision,surface);
    this.effects.useSurface(surface);this.fragments.useSurface(surface);this.debris.useSurface(surface);this.elemental.useSurface(surface);
    if(surface&&this.navigation)this.navigation=undefined;
  }
  /** Distância CAMINHÁVEL — planar na fazenda, arco no planeta. */
  private distance(a:Vec3,b:Vec3):number {return this.space.distance(a,b);}
  private distanceSquared(a:Vec3,b:Vec3):number {return this.space.distanceSquared(a,b);}
  /**
   * "Para baixo" NO PONTO pedido. Fechada uma vez e reusada: o ragdoll pergunta isto uma vez por
   * osso por quadro, e uma closure nova por quadro seria lixo garantido.
   */
  private readonly localDown=(p:Vec3):Vec3=>{
    const up=this.radial?.up(p);
    // `workVec` é lido pelo chamador antes de qualquer outra chamada — nada escapa daqui.
    workVec.x=up?-up.x:0;workVec.y=up?-up.y:-1;workVec.z=up?-up.z:0;
    return workVec;
  };
  /** Direção tangente do ator até o jogador, usada quando não há Detour nem grade da fazenda. */
  private headingToward(from:Vec3,to:Vec3):Heading {this.space.towardInto(from,to,work0);return heading(work0);}
  /**
   * `models` vazio é mapa SEM HORDA (o laboratório): nenhum GLB baixado, pronto na hora. Eram 17 s
   * de carga — o maior custo do Test Map inteiro — para um elenco que nunca entra em campo lá. Um
   * corpo replicado de um modelo que não veio simplesmente não nasce: `spawn` devolve `false`.
   */
  async load(loader:(model:string)=>Promise<AssetContainer>=model=>LoadAssetContainerAsync(`/models/${model}.glb`,this.scene),models:Iterable<string>=new Set(Object.values(ENEMIES).map(x=>x.model))):Promise<void>{try{for(const model of models){if(this.disposed)return;const container=await loader(model);if(this.disposed){container.dispose();return;}this.containers.set(model,container);}this.ready=true;}catch(error){if(!this.disposed)this.error=String(error);}}
  async prepareNavigation():Promise<void>{try{const tactical=await TacticalNavigation.create(this.world.collision,true);if(this.disposed){tactical.dispose();return;}this.tactical=tactical;this.navigationReady=true;}catch(error){this.error=String(error);}}
  /**
   * A grade de fluxo da fazenda é uma carta plana de 120 m em torno da origem: no planeta ela não
   * significa nada (e custaria 6 561 sondas de apoio para nascer inútil). Sem Detour e sem ela, a
   * perseguição radial usa direção tangente direta — continua perseguindo, atacando e morrendo.
   */
  initialize():void {if(this.tactical||this.navigation||this.space.radial)return;this.navigation=new FarmNavigation(this.world.collision);this.navigation.update(this.player.position);}
  nextStage():void {this.lasers.begin();this.elemental.clear();for(const l of this.chargeLights)l.intensity=0;this.burning.clear();this.groundFire.clear();this.debris.clear();this.fragments.clear();this.ragdolls.clear();this.tactical?.clear();this.scheduler.clear();this.tick.clear();this.chargeLightTargets.length=0;this.populationCap=this.budget.limit;this.benchmark=false;this.retirementClock=0;
    this.replacementClock=0;this.replacements.length=0;this.strays=0;this.recycled=0;
    this.weakHits=0;this.lastWeakPoint='';this.ragdollsSkipped=0;this.ragdollBudget=RAGDOLL_SPAWNS_PER_STEP;
    for(const a of this.actors){a.active=false;a.root.setEnabled(false);a.body.isPickable=false;}this.kills=0;this.boss=undefined;this.bossDeadTime=-1;this.effects.clear();this.labels.length=0;this.director=new MonsterDirector(this.rng.stream('director'),this.progression.stage,50,this.mode);}
  get count():number{let live=0;for(const a of this.actors)if(a.active&&!a.health.dead)live++;return live;}
  get status():string{return `${this.count} hostis · ${this.kills} abatidos`;}
  get bossHP():number{return this.boss?.health.current??0;}
  get bossMaxHP():number{return this.boss?.health.maximum??1;}
  get ragdollCount():number{return this.ragdolls.count;}
  /**
   * Os `count` atores aceitos mais próximos do jogador, dentro de `maximum` metros, por seleção direta:
   * O(n × count) sem alocar lista nem ordenar a horda inteira. Empate mantém a ordem da lista, igual
   * ao `sort` estável que existia antes. O resultado é um buffer reaproveitado — só os `count` primeiros
   * slots valem, e valem só até a próxima chamada.
   */
  private nearest(count:number,maximum:number,accept:(a:Actor)=>boolean):readonly {actor:Actor|undefined;distance:number}[] {
    const slots=this.nearestSlots;
    while(slots.length<count)slots.push({actor:undefined,distance:Number.POSITIVE_INFINITY});
    for(let i=0;i<count;i++){slots[i]!.actor=undefined;slots[i]!.distance=Number.POSITIVE_INFINITY;}
    const limit=maximum*maximum;
    for(const a of this.actors){
      if(!accept(a))continue;
      const d=this.distanceSquared(a.root.position,this.player.position);
      if(!(d<limit))continue;
      for(let i=0;i<count;i++){
        if(!(d<slots[i]!.distance))continue;
        for(let j=count-1;j>i;j--){slots[j]!.actor=slots[j-1]!.actor;slots[j]!.distance=slots[j-1]!.distance;}
        slots[i]!.actor=a;slots[i]!.distance=d;break;
      }
    }
    return slots;
  }
  /** O mais distante que pode ser aposentado, num único varrimento: antes era `filter` + `sort` completos. */
  private farthestRetirable(minimum:number):Actor|undefined {
    // `-1` quando não há distância mínima: um ator exatamente em cima do jogador continua elegível.
    let pick:Actor|undefined,best=minimum>0?minimum*minimum:-1;
    for(const a of this.actors){
      // O chefe nunca é aposentado, e os corpos da represália alienígena também não: são um evento
      // AUTORADO, não população de preenchimento. Aposentar um deles some com ele em silêncio —
      // sem morte, sem `onSaucerDeparted` — e a contagem da onda nunca fecharia, deixando o disco
      // preso em `onda-ativa` para sempre e o item raro inalcançável.
      if(!a.active||a.health.dead||a.kind==='boss'||isSaucerSpecies(a.kind))continue;
      const d=this.distanceSquared(a.root.position,this.player.position);
      if(d>best){best=d;pick=a;}
    }
    return pick;
  }
  /**
   * Tira um corpo VIVO de cena e devolve tudo o que ele segurava: a vaga de população, o agente do
   * Detour, o emprego no escalonador, os alvos clicáveis e os avisos/projéteis que ele tinha no ar.
   * Depois disto ele é invisível para `fixedUpdate`, `update`, `buildTickCache`, `separate`,
   * `updateCameraVisibility` e `nearest` — o corpo para de custar.
   *
   * NÃO conta abate, NÃO paga recompensa, NÃO emite colheita e NÃO toca no chefe. Quem chama decide
   * o que fazer com a vaga: `retire` devolve orçamento ao diretor, `recycleStrays` promete reposição.
   */
  private release(a:Actor):void {
    a.active=false;a.push.setAll(0);a.direction={x:0,z:0};
    this.world.collision.playerBodies.delete(a.id);
    a.root.setEnabled(false);a.body.isPickable=false;
    for(const mesh of a.target.meshes??[a.body])mesh.isPickable=false;
    this.scheduler.remove(a.id);this.tactical?.remove(a.id);
    this.cancelEffectsOf(a.id);
  }
  /**
   * Avisos e projéteis órfãos do corpo que saiu. Sem isto uma faixa ou uma bomba de quem foi
   * recolhido continuava viva, ocupando slot do pool e — no caso do aviso com dano — ferindo o
   * jogador em nome de um hostil que não existe mais. Mesmo protocolo de liberação que o vencimento
   * natural usa: desativar e desligar a malha, que devolve o mesh auxiliar ao pool.
   */
  private cancelEffectsOf(owner:number):void {
    for(const w of this.effects.warnings)if(w.active&&w.owner===owner){w.active=false;w.remaining=0;w.damage=0;w.pulses=0;w.mesh.setEnabled(false);}
    for(const p of this.effects.projectiles)if(p.active&&p.owner===owner){p.active=false;p.mesh.setEnabled(false);}
  }
  /** Aposentadoria pura: o corpo sai e a vaga vira orçamento do diretor, que repõe no ritmo dele. */
  private retire(a:Actor):void {this.director.retireLivingEnemy();this.release(a);}
  /**
   * Reciclagem por distância — o que resolve a horda que atravessa o arquipélago atrás do jogador.
   *
   * Recolhe TODOS os retardatários além da coleira no mesmo quadro (parar o trabalho caro é o
   * objetivo, e um corpo a 72 m não está fazendo nada que o jogador possa ver) e devolve UM por
   * intervalo, perto do jogador, pelo mesmo anel e pelas mesmas validações de piso do diretor.
   *
   * A vaga recolhida nunca evapora: ou volta como corpo novo perto do jogador — e aí a cota da onda
   * e os créditos da expedição não mudam, porque a população continua a mesma — ou é devolvida ao
   * diretor por `retireLivingEnemy`, que é exatamente a contabilidade que o modo horda (`spawned`)
   * e a expedição (crédito) já sabem tratar. Abate, XP, ouro, colheita e o chefe ficam de fora.
   */
  private recycleStrays(dt:number):void {
    const leash=STRAY_DISTANCE*STRAY_DISTANCE;
    for(const a of this.actors){
      if(!a.active||a.health.dead||a.kind==='boss')continue;
      // Espécies de disco voador nunca entram no recolhimento com reposição: elas têm a própria
      // desistência, que é CORRER para longe e sumir, e nenhuma delas pode voltar sem novo evento.
      if(isSaucerSpecies(a.kind)){
        if(a.state!=='flee'&&this.distanceSquared(a.root.position,this.player.position)>SAUCER_FLEE_DISTANCE*SAUCER_FLEE_DISTANCE){
          a.state='flee';a.time=0;a.cooldown=0;a.direction={x:0,z:0};this.tactical?.velocity(a.id,{x:0,y:0,z:0},0);
        }
        continue;
      }
      if(this.distanceSquared(a.root.position,this.player.position)<=leash)continue;
      const kind=a.kind;
      this.release(a);this.strays++;
      // A fila de reposição nunca passa do teto: mais do que isso é população que não caberia de volta.
      if(this.replacements.length<this.populationCap)this.replacements.push(kind);
      else this.director.retireLivingEnemy();
    }
    // Reservas também contam como população; fim de fase/morte nunca pode gerar reforços.
    if(this.director.stopped||this.player.hp<=0){
      for(const _kind of this.replacements)this.director.retireLivingEnemy();
      this.replacements.length=0;return;
    }
    this.replacementClock=Math.max(0,this.replacementClock-dt);
    if(!this.replacements.length||this.replacementClock>0)return;
    this.replacementClock=STRAY_REPLACEMENT_INTERVAL;
    const kind=this.replacements.shift()!;
    // Sem vaga livre (ou sem piso válido no anel) a reposição vira orçamento: o diretor decide quando.
    if(this.count<this.populationCap&&this.spawn(kind))this.recycled++;
    else this.director.retireLivingEnemy();
  }
  updateBudget(dt:number,frameMs:number):void {
    // Aposentar e reciclar TIRA corpo de campo: é decisão de população, e com o servidor no comando
    // ela é dele. Um cliente lento não pode fazer um inimigo sumir da tela dele e não da do outro.
    if(this.authority==='server')return;
    if(this.benchmark)return;this.budget.update(dt,frameMs);this.populationCap=this.budget.limit;
    this.recycleStrays(dt);
    this.retirementClock-=dt;if(this.count<=this.populationCap||this.retirementClock>0)return;
    const actor=this.farthestRetirable(RETIREMENT_DISTANCE);
    if(actor){this.retire(actor);this.retirementClock=1;}
  }
  updateCameraVisibility(camera:Vec3,dt:number):void {for(const a of this.actors){if(!a.active)continue;const d=this.distance(a.root.position,camera);const desired=d<ENEMIES[a.kind].radius*ENEMY_AFFIXES[a.variant].scale+.9?0:1;for(const mesh of a.target.meshes??[a.body])mesh.visibility=Math.abs(desired-mesh.visibility)<.01?desired:mesh.visibility+(desired-mesh.visibility)*Math.min(1,dt*14);}}
  /**
   * Sem Detour E sem grade da fazenda (caso do planeta enquanto a carta assa) não existe oráculo de
   * alcançabilidade: aceitar o ponto é o certo, porque o apoio já foi medido pelo `SpawnPlanner` e
   * recusar tudo esvaziaria a horda. É a mesma decisão que o modo de treino já toma hoje.
   *
   * `enemySpawn`: domínio próprio da horda. O antigo `spawn` era partilhado com o nascimento do
   * jogador e com a ilha-casa do planeta, e quem puxasse número lá movia corpo aqui. Ver `core/RunRNG`.
   */
  private spawnPosition(min?:number,max?:number):Vec3|undefined {return chooseSpawnAround(this.player.position,this.rng.stream('enemySpawn'),this.world.collision,p=>this.tactical?this.tactical.reachable(p,this.player.position):this.navigation?this.navigation.reachable(p):this.space.radial,p=>this.actors.some(a=>a.active&&!a.health.dead&&this.distance(p,a.root.position)<2),min,max,this.radial);}
  /** Chefe do último evento da expedição: nasce num anel um pouco maior, sempre em piso válido. */
  requestBoss():boolean {
    if(this.boss&&this.boss.active&&!this.boss.health.dead)return true;
    // Online o chefe é do servidor: sortear piso e pedir rota ao Detour a cada 1,5 s só para o
    // `spawn` recusar no fim era custo puro, em pico, no meio da luta.
    if(this.authority==='server')return false;
    this.initialize();
    const at=this.spawnPosition(20,34);
    return at?this.spawn('boss',at):false;
  }
  /** Sem rota até o jogador (ou longe demais) o chefe deixa de ser um objetivo jogável. */
  get bossReachable():boolean {
    const boss=this.boss;
    if(!boss||!boss.active||boss.health.dead)return true;
    if(this.authority==='server')return true;   // rota e recuperação do chefe são do servidor
    if(this.distance(boss.root.position,this.player.position)>110)return false;
    if(this.tactical)return this.tactical.reachable(boss.root.position,this.player.position);
    return this.navigation?.reachable(boss.root.position)??true;
  }
  /** Recuperação: recoloca o mesmo chefe em piso válido perto do jogador, sem recriar vida nem recompensa. */
  recoverBoss():boolean {
    const boss=this.boss;
    if(!boss||!boss.active||boss.health.dead||this.authority==='server')return false;
    const at=this.spawnPosition(18,28);
    if(!at)return false;
    boss.root.position.set(at.x,at.y,at.z);boss.push.setAll(0);boss.state='chase';boss.time=0;boss.cooldown=1;boss.direction={x:0,z:0};
    // No planeta a recolocação pode cair numa ilha com outra vertical: sem repor a pose radial o
    // chefe ficaria deitado. Na fazenda a rotação nunca era tocada aqui, e continua não sendo.
    if(this.space.radial)this.space.faceAt(boss.root,boss.facing,at,this.player.position);
    this.tactical?.remove(boss.id);this.tactical?.add(boss.id,at,ENEMIES.boss.radius*ENEMY_AFFIXES[boss.variant].scale,ENEMIES.boss.speed);
    this.effects.burst(at,'soil',3);this.audio?.enemy('spawn','boss',this.distance(at,this.player.position));
    return true;
  }
  /**
   * Vida do corpo que vai nascer. A Praga Alfa usa `bossHealth`, que escala por estágio E por nível
   * em vez do valor fixo de catálogo; o resto mantém exatamente a fórmula anterior.
   */
  private healthFor(kind:EnemyKind,variant:EnemyVariant):number {
    if(kind==='boss')return bossHealth(this.progression.stage,this.progression.level)*this.director.healthMultiplier;
    return ENEMIES[kind].hp*ENEMY_AFFIXES[variant].health*(1+(this.progression.stage-1)*.35)*this.director.healthMultiplier;
  }
  spawn(kind:EnemyKind,position?:Vec3,variant:EnemyVariant=kind==='boss'?'normal':chooseVariant(this.rng.stream('elite').next(),this.director.time)):boolean {
    this.lastSpawnedId=-1;
    // Com o servidor no comando, NASCER é decisão dele. Recusar aqui (em vez de confiar em quem
    // chama) é o que garante que nenhum caminho antigo — represália, invocação do chefe, QA —
    // consiga criar um corpo que o outro cliente não tem.
    if(this.authority==='server'&&!this.applyingReplica)return false;
    if(kind==='boss'&&this.boss&&!this.boss.health.dead)return true;
    /**
     * O teto de população é um ORÇAMENTO DE DESEMPENHO, não regra de jogo. O chefe sempre nasce, e
     * os corpos da represália também: o feixe já desceu, o `SaucerRaid` já descontou o despejo e o
     * jogador está vendo a cápsula pousar. Recusar o nascimento aqui perderia o corpo em silêncio e
     * a onda nunca fecharia — no pior caso os dez falhariam e o evento ficaria preso sem item.
     * São no máximo onze corpos autorados por investida, e eles são o evento inteiro.
     */
    // Réplica do servidor também é isenta: o teto local é orçamento de GPU, e recusar um corpo que o
    // servidor TEM o deixava invisível aqui — atacando de onde ninguém via — e tentando nascer de novo
    // a cada passo. Aposentar outro para abrir espaço também não serve: seria sumir com um corpo vivo.
    const exempt=kind==='boss'||isSaucerSpecies(kind)||this.applyingReplica;
    if(!this.ready||(this.count>=this.populationCap&&!exempt))return false;const at=position??this.spawnPosition();if(!at)return false;
    // Isento no teto: abre espaço aposentando o corpo comum mais distante, como o chefe sempre fez.
    // A diferença é o caso em que NÃO há ninguém aposentável (só corpos da represália em campo):
    // antes isso recusava o nascimento, e agora o corpo autorado nasce mesmo assim.
    if(this.count>=this.populationCap&&!this.applyingReplica){const retired=this.farthestRetirable(0);if(retired)this.retire(retired);else if(!exempt)return false;}
    const definition=ENEMIES[kind],affix=ENEMY_AFFIXES[variant];let actor=this.actors.find(a=>!a.active&&a.kind===kind);
    if(!actor){const container=this.containers.get(definition.model);if(!container)return false;
      const root=new TransformNode(`enemy-${this.nextId}`,this.scene),visual=new TransformNode(`enemy-visual-${this.nextId}`,this.scene);visual.parent=root;
      // Espécies de disco voador entram pelo importador: ele resolve orientação, escala e apoio no
      // chão MEDINDO a pose animada, e pendura a hierarquia original intocada sob dois nós próprios
      // (`placement` e `orientation`) abaixo do `visual` que o enxame já controla. Os cinco originais
      // do jogo continuam no caminho antigo, que funciona e não precisa mudar.
      const profile=ALIEN_PROFILES[kind];
      let normalized:NormalizedCharacter|undefined;
      let instance:ReturnType<AssetContainer['instantiateModelsToScene']>|undefined;
      if(profile){
        normalized=normalizeAnimatedCharacter(container,this.scene,profile,this.nextId,visual);
        if(!normalized){root.dispose();return false;}
        if(!this.reported.has(kind)){this.reported.add(kind);console.info(normalized.report);}
      } else {
        instance=container.instantiateModelsToScene(n=>`enemy-${this.nextId}-${n}`,false,{doNotInstantiate:true});
        for(const node of instance.rootNodes)node.parent=visual;
      }
      const meshes=visual.getChildMeshes();const body=meshes.filter(x=>x.getTotalVertices()>0).sort((a,b)=>b.getTotalVertices()-a.getTotalVertices())[0] as Mesh|undefined;if(!body){root.dispose();return false;}
      for(const mesh of meshes){mesh.isPickable=mesh.getTotalVertices()>0;mesh.receiveShadows=true;}body.isPickable=true;
      const id=this.nextId++,health=new Health(id,this.healthFor(kind,variant),this.events);const target:TrainingTarget={id,mesh:body,hits:0};
      const clips=normalized?normalized.clips:new Map<string,AnimationGroup>();
      if(instance)for(const clip of instance.animationGroups){clip.stop();for(const name of ['Spawn','Walk','Run','Idle','Hit','Death','Attack','Cast','Fly','Spit','Bite','Roll'])if(clip.name.endsWith(name))clips.set(name,clip);}
      const skeletons=normalized?normalized.skeletons:instance!.skeletons;
      target.meshes=meshes.filter(mesh=>mesh.getTotalVertices()>0) as Mesh[];
      actor={id,kind,variant,scale:definition.scale,push:Vector3.Zero(),root,visual,body,health,target,clips,machine:new AnimationStateMachine(clips),skeleton:skeletons[0],ragdoll:undefined,healthTrail:health.maximum,gait:0,lastPosePosition:Vector3.FromArray([at.x,at.y,at.z]),palette:new PosePalette(skeletons),state:'spawn',time:0,attack:0,locked:{...at},direction:{x:0,z:0},facing:new Vector3(0,0,1),burn:0,burnClock:0,anim:0,hit:0,stagger:0,staggerCooldown:0,deathVelocity:Vector3.Zero(),active:true,cooldown:0};const captured=actor;target.onHit=context=>this.hit(captured,context);if(kind==='carrot'){const nodes=visual.getChildTransformNodes(),hand=nodes.find(n=>n.name.endsWith('RightHand')),arm=nodes.find(n=>n.name.endsWith('RightArm'));if(hand&&arm){const socket=new TransformNode('carrot-right-palm-muzzle',this.scene);socket.parent=hand;socket.position.set(0,6,0);socket.rotationQuaternion=Quaternion.FromUnitVectorsToRef(Vector3.Forward(),Vector3.Up(),Quaternion.Identity());actor.laserSocket=socket;actor.laserArm=arm;}}this.actors.push(actor);this.byId.set(actor.id,actor);this.world.targets.push(target);
    }
    this.ragdolls.release(actor.ragdoll);actor.ragdoll=undefined;actor.machine.reset();actor.gait=0;actor.lastPosePosition.set(at.x,at.y,at.z);
    actor.variant=variant;actor.scale=definition.scale*affix.scale;actor.push.setAll(0);actor.active=true;actor.health=new Health(actor.id,this.healthFor(kind,variant),this.events);actor.healthTrail=actor.health.maximum;actor.state='spawn';actor.time=0;actor.burn=0;actor.hit=0;actor.stagger=0;actor.staggerCooldown=0;actor.cooldown=1;actor.direction={x:0,z:0};actor.attack=0;actor.root.position.set(at.x,at.y,at.z);this.space.faceAt(actor.root,actor.facing,at,this.player.position);actor.root.scaling.setAll(actor.scale);actor.visual.rotationQuaternion=null;actor.visual.rotation.set(0,0,0);actor.visual.position.set(0,isSaucerSpecies(kind)?0:-(ENEMY_VISUAL_DROP[kind]??1),0);actor.body.isPickable=true;actor.root.setEnabled(true);
    for(const mesh of actor.target.meshes??[actor.body]){
      mesh.isPickable=true;mesh.setEnabled(true);
      if(mesh.material instanceof PBRMaterial){const baseName=mesh.material.name.split('::elite::')[0]!,baseKey=definition.model+':'+baseName;if(!this.eliteMaterials.has(baseKey))this.eliteMaterials.set(baseKey,mesh.material);const original=this.eliteMaterials.get(baseKey)!;original.maxSimultaneousLights=2;
        if(variant==='normal')mesh.material=original;else{const key=baseKey+variant;let material=this.eliteMaterials.get(key);if(!material){material=original.clone(baseName+'::elite::'+variant);const tint=Color3.FromHexString(affix.color);material.albedoColor=original.albedoColor.multiply(tint.scale(.45).add(new Color3(.55,.55,.55)));material.emissiveColor=tint.scale(variant==='charged'?.65:.14);this.eliteMaterials.set(key,material);}mesh.material=material;}
      }
    }
    this.world.collision.playerBodies.set(actor.id,{id:actor.id,position:actor.root.position,radius:definition.radius*affix.scale,height:actor.kind==='watermelon'?1.6:2,active:()=>actor!.active&&!actor!.health.dead&&actor!.kind!=='tomato'&&actor!.state!=='spawn'});
    if(!this.applyingReplica)this.tactical?.add(actor.id,at,definition.radius*affix.scale,definition.speed*affix.speed);this.audio?.enemy('spawn',kind,this.distance(at,this.player.position));
    const scheduled=actor;this.scheduler.add({id:actor.id,distance:()=>this.distance(scheduled.root.position,this.player.position),update:dt=>{if(scheduled.active&&!scheduled.health.dead)this.think(scheduled,dt);}});
    this.effects.burst(at,'soil',kind==='boss'?3:1);if(kind==='boss'){this.boss=actor;this.events.emit('BossSpawned',{entityId:actor.id,definitionId:'boss_fruit_abomination_01'});}
    this.lastSpawnedId=actor.id;return true;
  }
  /**
   * Empurrão e normal de impacto são vetores de MUNDO: a direção sai tangente à superfície onde o
   * golpe acontece e a normal é a vertical local, em vez de `+Y` fixo. Na fazenda os dois voltam
   * a ser exatamente `(dx,0,dz)` normalizado e `(0,1,0)`.
   */
  private damageContext(id:number,damage:number,position:Vec3,source:string):DamageContext{const actor=this.byId.get(id),from=actor?.root.position??position,multiplier=actor?ENEMY_AFFIXES[actor.variant].damage:1;
    this.space.towardInto(from,this.player.position,work0);
    this.space.upInto(position,work1);
    return{attackerId:id,victimId:1,sourceId:source,attackId:source,baseDamage:damage,finalDamage:damage*multiplier*(1+.15*(this.progression.stage-1))*this.director.damageMultiplier,crit:false,procCoefficient:0,procChainDepth:0,damageTags:['enemy'],hitPosition:{x:position.x,y:position.y,z:position.z},hitNormal:{x:work1.x,y:work1.y,z:work1.z},forceDirection:{x:work0.x,y:work0.y,z:work0.z},forceMagnitude:3*multiplier};}
  /**
   * Esferas VIVAS do ponto fraco da espécie, em MUNDO.
   *
   * O centro sai do nó do rig, então ele acompanha a animação (a asa batendo, a cabeça virando) e o
   * referencial radial do planeta de graça: `getAbsolutePosition` já compõe raiz radial → escala →
   * pose do clipe. Não existe nenhum deslocamento fixo em `+Y` nem conversão manual de espaço aqui —
   * era exatamente aí que a versão "offset no modelo" erraria fora do polo norte.
   *
   * Limite honesto: para atores a mais de 24 m a pose é amostrada a 1/30 ou 1/15 s (LOD de animação
   * de `update`), então a esfera pode estar até um quadro de animação atrasada. A essa distância a
   * asa ocupa poucos pixels e o erro não é perceptível.
   */
  private readonly weakSpheres:WeakPointSphere[]=[];
  /** Acertos diretos em ponto fraco nesta tentativa, e a última zona atingida. Diagnóstico e HUD. */
  weakHits=0;lastWeakPoint='';

  /**
   * Chão em chamas — as poças acesas por explosão e pela bomba do tomate.
   *
   * Mora na horda porque é ela que tem os corpos: o campo é puro e não conhece ator nenhum, então
   * quem varre os hostis e traduz "pisou" em dano é este arquivo.
   */
  readonly groundFire=new GroundFireField();
  /** Porta de chama para quem desenha as pocas: so o , nada mais do sistema elemental. */
  get flames():{emit(kind:"fire",at:Vector3,power:number):void} {return this.elemental;}
  /** Corpos consultáveis pelo fogo, remontados por passo sem alocar por ator. */
  private readonly burnable:{id:number;position:Vec3}[]=[];

  /**
   * Acende o chão. `owner` é quem atirou — `1` é o jogador.
   *
   * Poça de DONO INIMIGO é só apresentação: quem cobra o pedágio do jogador continua sendo a zona
   * de aviso que a bomba do tomate já pintava, e deixar o campo cobrar também dobraria o dano. E
   * hostil não queima hostil — fogo amigo entre pragas nunca foi regra deste jogo.
   */
  igniteGround(centre:Vec3,radius:number,owner=1,seconds=GROUND_FIRE.seconds):void {
    this.space.upInto(centre,work1);
    this.groundFire.ignite(centre,{x:work1.x,y:work1.y,z:work1.z},radius,owner,seconds);
  }

  /** Um passo do fogo: envelhece as poças e cobra de quem está dentro das do JOGADOR. */
  private updateGroundFire(dt:number):void {
    if(this.groundFire.count===0)return;
    const bodies=this.burnable;bodies.length=0;
    for(const a of this.actors)if(a.active&&!a.health.dead)
      bodies.push({id:a.id,position:{x:a.root.position.x,y:a.root.position.y,z:a.root.position.z}});
    this.groundFire.update(dt,bodies,(body,amount,patch)=>{
      if(patch.owner!==1)return;
      const victim=this.byId.get(body.id);
      if(!victim||!victim.active||victim.health.dead)return;
      this.hit(victim,{attackerId:1,victimId:victim.id,sourceId:'ground_fire',attackId:'ground_fire',
        baseDamage:amount,finalDamage:amount,crit:false,procCoefficient:0,procChainDepth:1,
        damageTags:['fire','dot','skill'],
        hitPosition:{...body.position},hitNormal:{x:patch.up.x,y:patch.up.y,z:patch.up.z},
        forceDirection:{x:patch.up.x,y:patch.up.y,z:patch.up.z},
        hitDirection:{x:-patch.up.x,y:-patch.up.y,z:-patch.up.z},forceMagnitude:0});
    });
  }
  private weakNodesOf(a:Actor,zone:WeakPointZone):readonly TransformNode[] {
    if(a.weakNodes)return a.weakNodes;
    // A instanciação renomeia cada nó para `enemy-<id>-<nome original>`; o sufixo é a identidade.
    const nodes=a.visual.getChildTransformNodes(),found:TransformNode[]=[];
    for(const bone of zone.bones){const node=nodes.find(n=>n.name.endsWith(bone));if(node)found.push(node);}
    a.weakNodes=found;return found;
  }
  /**
   * Zona atingida por ESTE disparo, ou `undefined`.
   *
   * O teste é o SEGMENTO da bala — origem `hitPosition`, direção `hitDirection` (a do raio real que
   * o cano disparou) — contra as esferas dos ossos. Não é distância ao corpo: um tiro no tronco
   * passa longe da esfera da cabeça e não vira crítico.
   */
  private weakPointOf(a:Actor,context:DamageContext):WeakPointZone|undefined {
    if(!weakPointEligible(context.attackerId,context.procChainDepth,context.damageTags))return undefined;
    const zone=WEAK_POINTS[a.kind];if(!zone)return undefined;
    const nodes=this.weakNodesOf(a,zone);if(nodes.length===0)return undefined;
    const spheres=this.weakSpheres;spheres.length=0;
    const radius=zone.radius*a.scale;
    for(const node of nodes){
      node.computeWorldMatrix(true);
      const p=node.getAbsolutePosition();
      spheres.push({centre:{x:p.x,y:p.y,z:p.z},radius});
    }
    // `hitDirection` é o raio do CANO; `forceDirection` é o rumo da câmera e diverge a poucos
    // metros. Sem o primeiro, o segundo é a melhor informação disponível.
    const direction=context.hitDirection??context.forceDirection;
    return resolveWeakPoint(context.hitPosition,direction,spheres)>=0?zone:undefined;
  }
  /**
   * Para onde vão os pedidos de acerto online (`NetworkSession` → servidor). Sem ele, com a
   * autoridade no servidor, o acerto local seria descartado como antes.
   */
  onServerHit:((claim:HitClaim)=>void)|undefined;
  private claimSequence=0;
  /**
   * O ACERTO ONLINE: pedido ao servidor + retorno IMEDIATO na tela.
   *
   * O servidor decide vida, crítico, morte e loot; mas o atirador precisa SENTIR o acerto no mesmo
   * quadro — piscar, som, número e MP —, que é o que faz o combate parecer tempo real. O número é
   * uma estimativa (itens e ponto fraco, sem o dado de crítico); a barra de vida e a morte chegam
   * do servidor ~1 patch depois. O `EnemyHit` local alimenta o MP e o som de impacto da classe.
   */
  private claimServerHit(a:Actor,context:DamageContext):void {
    if(a.serverId===undefined||!this.onServerHit)return;
    const weak=context.procChainDepth===0?this.weakPointOf(a,context):undefined;
    const skill=context.damageTags.includes('skill');
    this.onServerHit({
      enemy:a.serverId,base:context.baseDamage,tags:[...context.damageTags],source:context.sourceId,
      attack:`${context.attackId}#${++this.claimSequence}`,weak:weak!==undefined,proc:context.procChainDepth,
      point:{x:context.hitPosition.x,y:context.hitPosition.y,z:context.hitPosition.z},
      force:{x:context.forceDirection.x,y:context.forceDirection.y,z:context.forceDirection.z},forceMagnitude:context.forceMagnitude,
    });
    const stats=this.progression.stats;
    const estimate=context.baseDamage*stats.damage*(skill?stats.mp:1)*(weak?2:1)*100/(100+ENEMY_AFFIXES[a.variant].armor);
    a.hit=.10;
    this.audio?.enemy('hit',a.kind,this.distance(a.root.position,this.player.position));
    this.space.lift(a.root.position,1.8,work0);
    this.labels.push({position:{x:work0.x,y:work0.y,z:work0.z},amount:Math.round(estimate),crit:weak!==undefined,weak:weak!==undefined,time:.7});if(this.labels.length>32)this.labels.shift();
    if(weak)this.effects.burst(context.hitPosition,'energy',.6);
    if(context.procChainDepth===0)this.events.emit('EnemyHit',{...context,victimId:a.id,finalDamage:estimate});
  }
  private hit(a:Actor,context:DamageContext):void {
    if(!a.active||a.health.dead)return;
    // Vida, crítico, proc e morte são do servidor. Aceitar o acerto aqui faria a barra descer duas
    // vezes no atirador e uma só no companheiro — dois donos da mesma regra. O acerto vira PEDIDO.
    if(this.authority==='server'){this.claimServerHit(a,context);return;}
    const stats=this.progression.stats;
    const weak=this.weakPointOf(a,context);
    // Acerto direto JÁ é crítico. O dado do crítico aleatório nem é rolado quando a zona acertou:
    // sem isso o multiplicador empilharia (×2 × ×2,4) e o mesmo golpe contaria dois críticos.
    const crit=weak===undefined&&context.procChainDepth===0&&this.rng.stream('run').next()<stats.crit;
    const rawDamage=context.procChainDepth>0?context.finalDamage
      :context.baseDamage*stats.damage*(context.damageTags.includes('skill')?stats.mp:1)*(weak&&context.sourceId==='prism_sniper'?2:weakPointDamageMultiplier(weak!==undefined,crit));
    const finalDamage=rawDamage*100/(100+ENEMY_AFFIXES[a.variant].armor);const applied={...context,finalDamage,crit:context.crit||crit||weak!==undefined};
    if(!a.health.apply(applied))return;a.hit=.10;const {force,stagger}=enemyImpact(context,a.variant,a.kind,a.staggerCooldown);
    // O empurrão continua sendo TANGENTE ao chão onde o corpo está: no plano isso é zerar `y`, na
    // esfera é remover a componente radial. Um empurrão com componente vertical arrancaria a praga
    // do convés, e ela não tem integração vertical em nenhum estado vivo.
    if(force>.5){this.space.tangentInto(a.root.position,context.forceDirection,work0);work0.normalize();a.push.set(work0.x*force,work0.y*force,work0.z*force);}
    if(stagger){a.stagger=.18;a.staggerCooldown=.85;if(a.state==='windup'){a.state='chase';a.time=0;a.cooldown=.4;}}
    this.audio?.enemy('hit',a.kind,this.distance(a.root.position,this.player.position));this.space.lift(a.root.position,1.8,work0);this.labels.push({position:{x:work0.x,y:work0.y,z:work0.z},amount:Math.round(finalDamage),crit:applied.crit,weak:weak!==undefined,time:.7});if(this.labels.length>32)this.labels.shift();
    // Retorno legível do acerto direto, com o pool de estilhaços que já existe — nenhuma arte nova.
    if(weak){this.weakHits++;this.lastWeakPoint=weak.label;this.effects.burst(context.hitPosition,'energy',.6);}
    // Incendiário da salva do soldado: a MESMA queimadura que o item de seiva já acende (5 de dano
    // a cada 0,5 s enquanto `burn` durar). Renova, nunca empilha — `Math.max` mantém o teto em
    // `INCENDIARY_SECONDS`, então acertar o mesmo bicho com cinco cápsulas não faz cinco fogueiras.
    if(applied.damageTags.includes(INCENDIARY_TAG)&&!a.health.dead){
      a.burn=Math.max(a.burn,INCENDIARY_SECONDS);a.burnClock=0;
      this.effects.burst(a.root.position,'seed',.5);
    }
    this.procs.onHit(context,{burn:seconds=>{a.burn=seconds;a.burnClock=0;this.effects.burst(a.root.position,'seed');},blast:radius=>{this.effects.burst(a.root.position,'seed',2);for(const other of this.actors)if(other!==a&&other.active&&!other.health.dead&&this.distance(other.root.position,a.root.position)<radius)this.hit(other,{...applied,victimId:other.id,baseDamage:finalDamage*.5,finalDamage:finalDamage*.5,procChainDepth:1,sourceProcId:'bomb'});}});
    if(a.health.dead){this.lastKill={position:{x:a.root.position.x,y:a.root.position.y,z:a.root.position.z},kind:a.kind,age:0};this.scheduler.remove(a.id);a.state='dead';a.time=0;this.tactical?.remove(a.id);a.palette.sync();a.ragdoll=this.takeRagdoll(a,applied);this.audio?.enemy('death',a.kind,this.distance(a.root.position,this.player.position));a.body.isPickable=false;this.launchCorpse(a,context.forceDirection,3,3);this.kills++;
      // Pagamento por ESPÉCIE (ver `killBounty`); o chefe continua no caminho de elite de sempre.
      this.progression.reward(a.kind==='boss',ENEMY_AFFIXES[a.variant].gold,a.kind==='boss'?undefined:killBounty(a.kind,this.progression.stage));const heal=this.procs.onKill();this.player.heal(heal);this.effects.burst(a.root.position,heal?'energy':'juice',a.kind==='boss'?4:1.2);this.fragments.burst(a.kind,a.root.position,context.forceDirection,a.body,a.kind==='boss'?1.6:1);
      // `corpseLaunch` devolve o impulso no referencial do golpe (tangente + vertical). No planeta a
      // parte vertical tem de subir pela RADIAL do corpo, não por `+Y` do mundo.
      const launch=corpseLaunch(applied);
      this.launchCorpse(a,launch,Math.hypot(launch.x,launch.z),launch.y);
      if(applied.damageTags.includes('melee_heavy')&&applied.forceMagnitude>=8)this.audio?.meleeLaunch(this.distance(a.root.position,this.player.position));
      for(const mesh of a.target.meshes??[a.body])mesh.isPickable=false;
      if(context.attackerId===1&&!context.damageTags.some(tag=>tag==='qa'||tag==='debug')&&!/^(qa|debug)/i.test(context.sourceId)){
        this.space.lift(a.root.position,1,work0);
        this.events.emit('FruitHarvested',{sequence:++this.harvestSequence,entityId:a.id,kind:a.kind,position:{x:work0.x,y:work0.y,z:work0.z}});
      }
      if(a.kind==='boss'){mark('chefe morreu · início do bloco');
      section('chefe:fracture',()=>this.debris.fracture(a.target.meshes??[a.body],a.body));
      section('chefe:empurrão de cadáveres',()=>{for(const corpse of this.actors)if(corpse!==a&&corpse.active&&corpse.health.dead&&this.distance(corpse.root.position,a.root.position)<12){
        this.space.towardInto(a.root.position,corpse.root.position,work0);
        const push=this.distance(corpse.root.position,a.root.position)*.8;
        this.space.clearVertical(corpse.root.position,corpse.deathVelocity);
        corpse.deathVelocity.addInPlaceFromFloats(work0.x*push,work0.y*push,work0.z*push);
        this.space.raise(corpse.root.position,corpse.deathVelocity,5);
      }});
      section('chefe:director.bossKilled',()=>this.director.bossKilled());this.bossDeadTime=this.mode==='classic'?0:-1;
      section('chefe:evento BossKilled',()=>this.events.emit('BossKilled',applied));
      if(this.mode!=='expedition')section('chefe:evento StageCompleted',()=>this.events.emit('StageCompleted',{stageId:String(this.progression.stage)}));
      mark('chefe morreu · fim do bloco');}
    }
  }
  /**
   * Impulso do cadáver: `tangential` metros por segundo na direção tangente de `direction` mais
   * `vertical` na vertical LOCAL do corpo. Na fazenda isso reproduz o `set(x, y, z)` de antes.
   */
  /**
   * Cadáver articulado dentro do orçamento do passo. Ver `RAGDOLL_SPAWNS_PER_STEP`.
   * `undefined` ⇒ o corpo morre pelo clipe rígido, que é o caminho que já existia.
   */
  private ragdollBudget=RAGDOLL_SPAWNS_PER_STEP;
  /** Mortes que ficaram sem cadáver articulado por orçamento. Diagnóstico honesto do limite. */
  ragdollsSkipped=0;
  private takeRagdoll(a:Actor,applied:DamageContext):ReturnType<RagdollWorld['create']> {
    const boss=a.kind==='boss';
    if(!boss&&this.ragdollBudget<=0){this.ragdollsSkipped++;return undefined;}
    this.ragdollBudget--;
    return section(boss?'chefe:ragdoll de Havok':'ragdoll de Havok',()=>this.ragdolls.create(a.skeleton,a.body,applied,a.scale));
  }
  private launchCorpse(a:Actor,direction:Vec3,tangential:number,vertical:number):void {
    this.space.tangentInto(a.root.position,direction,work0);
    const length=work0.length()||1;
    a.deathVelocity.set(work0.x/length*tangential,work0.y/length*tangential,work0.z/length*tangential);
    this.space.raise(a.root.position,a.deathVelocity,vertical);
  }
  /** Monta a fila de ataque e a contagem de `windup` uma única vez, antes de qualquer pensamento do tique. */
  private buildTickCache():void {
    this.tick.begin();
    const p=this.player.position;
    for(const a of this.actors)if(a.active&&!a.health.dead)
      this.tick.add(a.id,Boolean(ENEMY_BEHAVIORS[a.kind].ranged),this.distanceSquared(a.root.position,p),a.state==='windup');
    this.tick.finish();
  }
  private think(a:Actor,dt:number):void {
    if(a.state!=='chase'||a.push.lengthSquared()>.25)return;const p=this.player.position,d=this.distance(a.root.position,p),def=ENEMIES[a.kind];
    a.direction=this.navigation?this.navigation.direction(a.root.position,p):this.space.radial&&!this.tactical?this.headingToward(a.root.position,p):{x:0,z:0};
    const behavior=ENEMY_BEHAVIORS[a.kind],ranged=Boolean(behavior.ranged);
    /**
     * Alcance de ENGAJAMENTO do ataque que vem a seguir, e não mais o `range` único de catálogo.
     * Para quem atira os dois números são o mesmo (o posto de tiro continua idêntico); para quem
     * bate, é o impulso que a faixa do windup desenha — o chefe deixou de anunciar uma varredura de
     * 7 m parado a 18 m do jogador. Consultado ANTES de `a.attack++`, que é o contrato do `engage`.
     */
    const engagement=behavior.engage(a);
    if(this.tactical)this.tactical.target(a.id,p,this.tick.rank(a.id),ranged,def.speed*ENEMY_AFFIXES[a.variant].speed);
    if(behavior.ranged){if(d<engagement*.55){a.direction.x*=-1;a.direction.z*=-1;if(a.direction.y!==undefined)a.direction.y*=-1;}else if(d<engagement)a.direction={x:0,z:0};}
    if(behavior.zigzag&&d>2&&d<10)this.space.rotateHeading(a.root.position,a.direction,Math.sin(this.director.time*3+a.id)*.65);
    a.cooldown=Math.max(0,a.cooldown-dt);
    // Alcance, altura, recarga e lotação são testes aritméticos; a varredura de linha de visão é a cara
    // do conjunto e agora só roda para quem já passou por todos eles — o `&&` avalia na ordem escrita.
    // A porta de altura é a diferença na vertical LOCAL: em `+Y` na fazenda, radial no planeta.
    if(!(d<=engagement&&Math.abs(this.space.heightGap(p,a.root.position))<3&&a.cooldown===0&&this.tick.windups(ranged)<(ranged?4:3)))return;
    this.space.lift(a.root.position,1.1,work0);
    workVec.x=p.x-a.root.position.x;workVec.y=p.y-a.root.position.y;workVec.z=p.z-a.root.position.z;
    if(this.space.sweepTime(work0,workVec,.05)!==undefined)return;
    a.state='windup';a.time=0;this.tick.noteWindup(ranged);this.tactical?.velocity(a.id,{x:0,y:0,z:0},0);this.audio?.enemy('windup',a.kind,d);a.locked={...p};a.attack++;a.direction={x:0,z:0};this.telegraph(a,behavior.telegraph(a,this.space),behavior.windup);
  }
  /** Piso para um decalque em `point`, sondado a partir da altura de `reference`. */
  private groundLevel(point:Vec3,reference:Vec3,out:Vector3):Vector3 {return this.space.decal(point,reference,out);}
  /**
   * Um windup desenha só a forma do ataque que vai sair: nada de anel genérico de área.
   * Investida usa o impulso comprometido inteiro com a largura de contato real, laser usa a linha
   * real do feixe (parada na parede) e círculo só aparece onde existe zona de dano de verdade.
   */
  private telegraph(a:Actor,plan:TelegraphPlan,seconds:number):void {
    if(plan.shape==='none')return;
    const from=a.root.position;
    if(plan.shape==='circle'){this.effects.warning(this.groundLevel(a.locked,a.locked,work1),plan.radius,seconds,0,a.id,plan.kind);return;}
    if(plan.shape==='cone'){this.effects.cone(from,a.locked,plan.radius,seconds,a.id);return;}
    if(plan.shape==='beam'){
      const path=this.laserPath(a);
      // A linha do feixe parte da altura do corpo e termina encostada no convés, como antes.
      work2.copyFromFloats(path.from.x,path.from.y,path.from.z);this.landAt(work2,from);
      this.effects.line(work2,this.groundLevel(path.to,from,work1),plan.width,seconds,a.id);return;
    }
    // Direção travada, já tangente à superfície onde o corpo está.
    this.space.towardInto(from,a.locked,work0);
    const direction={x:work0.x,y:work0.y,z:work0.z};
    const reach=plan.shape==='band'?this.rushReach(a,direction,plan.reach):plan.length;
    work1.copyFromFloats(from.x+work0.x*reach,from.y+work0.y*reach,from.z+work0.z*reach);
    workVec.x=work1.x;workVec.y=work1.y;workVec.z=work1.z;
    this.effects.line(from,this.groundLevel(workVec,from,work1),plan.width,seconds,a.id,plan.shape==='aim'?'aim':'band');
  }
  /**
   * Encaixa o corpo no apoio sob a posição que o Detour devolveu. Sem apoio medido, o corpo fica
   * onde a multidão o colocou — exatamente o `Number.isFinite(ground)?ground:p.y` de antes.
   */
  private settleAt(a:Actor,p:Vec3):void {
    if(this.space.groundUnder(p,.55,work0))a.root.position.copyFrom(work0);
    else a.root.position.set(p.x,p.y,p.z);
  }
  /** Coloca `point` na altura vertical local de `reference`, sem mexer na posição tangencial. */
  private landAt(point:Vector3,reference:Vec3):void {
    const gap=this.space.heightGap(point,reference);
    this.space.upInto(point,work3);
    point.set(point.x-work3.x*gap,point.y-work3.y*gap,point.z-work3.z*gap);
  }
  /**
   * A investida não para no alvo inicial: quem recua ou desvia continua dentro do trajeto, porque
   * o impulso do `recover` segue até acabar (velocidade × duração) ou até bater em parede.
   * O corte usa o mesmo `move` do deslocamento real — raio do corpo, altura 1.8 e degrau .8 — e
   * mede quanto do impulso sobrou projetado na direção travada.
   */
  private rushReach(a:Actor,direction:Vec3,reach:number):number {
    const start=a.root.position,radius=ENEMIES[a.kind].radius*ENEMY_AFFIXES[a.variant].scale,probe={x:start.x,y:start.y,z:start.z};
    this.space.slide(probe,{x:direction.x*reach,y:(direction.y??0)*reach,z:direction.z*reach},radius,1.8,.8);
    return Math.max(0,Math.min(reach,(probe.x-start.x)*direction.x+(probe.y-start.y)*(direction.y??0)+(probe.z-start.z)*direction.z));
  }
  /** Ponto de mira do feixe/projétil: 0,9 m acima do alvo na vertical LOCAL dele. */
  private aimPoint(at:Vec3,out:Vector3):Vector3 {return this.space.lift(at,.9,out);}
  private laserPath(a:Actor):{from:Vector3;to:Vector3}{
    const from=a.laserSocket?.getAbsolutePosition().clone()??this.space.lift(a.root.position,1.3,new Vector3());
    const direction=this.aimPoint(a.locked,new Vector3()).subtract(from).normalize(),delta=direction.scale(24);
    const wall=this.space.sweepTime(from,delta,.04);
    return{from,to:from.add(delta.scale(wall!==undefined?Math.max(0,wall):1))};
  }
  private fireLaser(a:Actor,damage:number):void{const {from,to}=this.laserPath(a),delta=to.subtract(from),target=this.aimPoint(this.player.position,new Vector3()),t=Vector3.Dot(target.subtract(from),delta)/Math.max(.0001,delta.lengthSquared());if(t>=0&&t<=1&&Vector3.DistanceSquared(from.add(delta.scale(t)),target)<.5*.5)this.player.applyDamage({...this.damageContext(a.id,damage,target,'carrot_hand_laser'),damageTags:['enemy','laser'],forceMagnitude:2});this.elemental.emit('electricity',to,.5);}
  private attack(a:Actor):void {
    this.audio?.enemy('attack',a.kind,this.distance(a.root.position,this.player.position));
    if(a.variant==='charged'&&a.attack%2===0){this.effects.warning(a.locked,2.1,.7,15,a.id,'root');}
    let nearby=0;for(const other of this.actors)if(other.active&&other!==a&&this.distanceSquared(other.root.position,a.root.position)<16)nearby++;
    ENEMY_BEHAVIORS[a.kind].perform({actor:a,player:this.player.position,effects:this.effects,space:this.space,laser:damage=>this.fireLaser(a,damage),spawn:(kind,p)=>this.spawn(kind,p),nearby,hurt:(damage,source,knockback=0)=>{const hp=this.player.hp;this.player.applyDamage(this.damageContext(a.id,damage,this.player.position,source));if(this.player.hp<hp&&knockback){
      // O empurrão do jogador é TANGENTE ao chão dele: nunca o arranca do convés nem o enterra.
      this.space.towardInto(a.root.position,this.player.position,work0);
      this.player.velocity.x+=work0.x*knockback;this.player.velocity.y+=work0.y*knockback;this.player.velocity.z+=work0.z*knockback;
    }}});
  }
  /**
   * Separação local (só no caminho sem Detour): mesma grade de 3 m e o mesmo teto de 8 pares por ator
   * de antes. O que mudou é o custo de montagem — chave numérica em vez de `template string`, e
   * `Map` + listas reaproveitados entre tiques em vez de recriados a cada passo fixo.
   */
  private separate(dt:number):void {
    const buckets=this.separationBuckets,pool=this.separationPool;
    for(const list of buckets.values()){list.length=0;pool.push(list);}
    buckets.clear();
    for(const a of this.actors)if(a.active&&!a.health.dead){
      const key=this.space.bucketKey(a.root.position);
      let list=buckets.get(key);
      if(!list){list=pool.pop()??[];buckets.set(key,list);}
      list.push(a);
    }
    for(const a of this.actors)if(a.active&&a.state==='chase'){
      let remainingPairs=8;
      this.space.neighbourhood(a.root.position,key=>{
        if(remainingPairs<0)return;
        const list=buckets.get(key);if(!list)return;
        for(const b of list){
          if(a.id>=b.id)continue;
          if(--remainingPairs<0)return;
          const d=this.distance(a.root.position,b.root.position),min=ENEMIES[a.kind].radius+ENEMIES[b.kind].radius;
          if(d>.01&&d<min){
            // Direção de afastamento tangente: na fazenda é o mesmo `(dx,dz)/d` de antes.
            this.space.towardInto(b.root.position,a.root.position,work0);
            const push=(min-d)*dt*2,px=work0.x*push,py=work0.y*push,pz=work0.z*push;
            this.space.slide(a.root.position,{x:px,y:py,z:pz},.4,1.8,.8);
            this.space.slide(b.root.position,{x:-px,y:-py,z:-pz},.4,1.8,.8);
          }
        }
      });
    }
  }
  fixedUpdate(dt:number):void {
    // Vaga de cadáver articulado deste passo. As armas disparam ANTES da horda no passo fixo da
    // cena, então o orçamento reposto aqui é o que os acertos do próximo passo vão gastar.
    this.ragdollBudget=RAGDOLL_SPAWNS_PER_STEP;
    if(this.lastKill)this.lastKill.age+=dt;
    // Cada OSSO de cada cadáver cai pela radial do ponto onde ele está, não pela do jogador: dois
    // corpos em ilhas diferentes têm gravidades diferentes, e é isso que a correção por corpo dá.
    // Na fazenda ninguém chama isto e a gravidade do ragdoll segue `(0,−18,0)`, intacta.
    if(this.radial)this.ragdolls.applyLocalGravity(this.localDown,dt);
    /**
     * A VIRADA DE DONO, num `return`.
     *
     * Daqui para baixo está TUDO que decide: queimadura, diretor, nascimento, escalonador de IA,
     * windup, ataque, dano ao jogador, avisos e projéteis. Com o servidor no comando nada disso
     * roda — o corpo é colocado por `replicate`. O que ficou acima é cosmético (gravidade dos
     * cadáveres, idade do último abate) e continua valendo nos dois modos.
     */
    if(this.authority==='server')return;
    if(!this.ready||this.player.hp<=0)return;this.burning.update(dt,(owner,amount)=>{this.player.applyDamage({...this.damageContext(owner,amount,this.player.position,'incendiary_burn'),forceMagnitude:0,damageTags:['enemy','fire','dot']});});this.initialize();this.navigation?.update(this.player.position);this.buildTickCache();this.scheduler.update(dt);this.tactical?.step(dt,this.player.position);this.director.update(dt,this.kills,this.count+this.replacements.length,kind=>this.spawn(kind),this.populationCap);if(this.bossDeadTime>=0)this.bossDeadTime+=dt;
    let undriven=0;
    for(const a of this.actors){if(!a.active)continue;a.time+=dt;a.hit=Math.max(0,a.hit-dt);a.stagger=Math.max(0,a.stagger-dt);a.staggerCooldown=Math.max(0,a.staggerCooldown-dt);
      if(a.state==='dead'&&a.ragdoll){if(a.time>7){this.ragdolls.release(a.ragdoll);a.active=false;a.root.setEnabled(false);}continue;}
      if(a.state==='dead'){
        // Cadáver cai na vertical LOCAL dele e assenta no convés que estiver por baixo — no planeta
        // isso é a radial do próprio corpo, não o `−Y` do mundo.
        this.space.gravity(a.root.position,a.deathVelocity,12,dt);
        a.root.position.addInPlaceFromFloats(a.deathVelocity.x*dt,a.deathVelocity.y*dt,a.deathVelocity.z*dt);
        if(this.space.fallGround(a.root.position,work0)&&this.space.heightGap(a.root.position,work0)<0){
          a.root.position.copyFrom(work0);a.deathVelocity.scaleInPlace(.7);this.space.clearVertical(a.root.position,a.deathVelocity);
        }
        a.visual.rotation.z=Math.min(1.45,a.time*2.5);if(a.time>7){a.active=false;a.root.setEnabled(false);}continue;}
      if(a.burn>0){a.burn-=dt;a.burnClock-=dt;if(a.burnClock<=0){a.burnClock=.5;this.effects.burst(a.root.position,'seed',.35);this.hit(a,{...this.damageContext(1,5,a.root.position,'burn'),victimId:a.id,procChainDepth:1,sourceProcId:'burn'});}if(a.health.dead)continue;}
      // Nascimento: os originais brotam da terra, afundados, e sobem. As espécies de disco voador
      // NÃO nascem do chão — elas são depositadas pelo feixe e já chegam de pé. Aplicar o
      // afundamento nelas é exatamente o que as fazia aparecer enterradas.
      if(a.state==='spawn'){this.tactical?.velocity(a.id,{x:0,y:0,z:0},0);
        const saucer=isSaucerSpecies(a.kind);
        const duration=saucer?.45:a.kind==='carrot'?1.15:a.kind==='watermelon'?1.8:a.kind==='tomato'?1.6:1.5;
        const t=Math.min(1,a.time/duration),ease=t*t*(3-2*t),depth=a.kind==='watermelon'?1.4:2;
        a.visual.position.y=saucer?0:-depth*(1-ease)+(a.kind==='tomato'?2*ease:a.kind==='carrot'?.18*Math.sin(t*Math.PI):0);
        if(a.time>=duration){a.state='chase';a.time=0;}continue;}
      /**
       * Retirada: o jogador fugiu longe demais e a espécie do disco desiste.
       *
       * Corre na tangente OPOSTA ao jogador, mais rápido do que perseguia, e some quando já está
       * fora de alcance — ou quando o teto de tempo estoura, que é a saída de quem encostou numa
       * parede. A vaga NÃO vira reposição: `departed` avisa o roteiro do disco para ele não ficar
       * esperando uma morte que não vem.
       */
      if(a.state==='flee'){
        const away=this.headingToward(this.player.position,a.root.position);
        a.direction=away;
        const fleeSpeed=ENEMIES[a.kind].speed*ENEMY_AFFIXES[a.variant].speed*SAUCER_FLEE_SPEED;
        if(this.tactical)this.tactical.velocity(a.id,{x:away.x*fleeSpeed,y:(away.y??0)*fleeSpeed,z:away.z*fleeSpeed},fleeSpeed,true);
        const before=a.root.position.clone();
        this.space.slide(a.root.position,{x:away.x*fleeSpeed*dt,y:(away.y??0)*fleeSpeed*dt,z:away.z*fleeSpeed*dt},ENEMIES[a.kind].radius,1.8,.8);
        if(this.space.groundUnder(a.root.position,.85,work0))a.root.position.copyFrom(work0);else a.root.position.copyFrom(before);
        if(headingLength(away)){workVec.x=away.x;workVec.y=away.y??0;workVec.z=away.z;this.space.face(a.root,a.facing,a.root.position,workVec,Math.min(1,dt*10));}
        const gone=this.distanceSquared(a.root.position,this.player.position)>SAUCER_VANISH_DISTANCE*SAUCER_VANISH_DISTANCE;
        if(gone||a.time>SAUCER_FLEE_SECONDS){const id=a.id;this.release(a);this.director.retireLivingEnemy();this.onSaucerDeparted?.(id);}
        continue;
      }
      const behavior=ENEMY_BEHAVIORS[a.kind];
      // Quem persegue cai no bloco do Detour lá embaixo, que refaz exatamente esta sincronização.
      // Repeti-la aqui custava um segundo `position()` + `groundAt` por ator por frame, sem efeito.
      // `driven` distingue "existe Detour E este ator tem agente" de "existe Detour". Uma carta de
      // ilha que ainda está assando devolve `position()` indefinido: sem isto o corpo congelaria
      // no lugar em vez de perseguir com deslocamento direto.
      const driven=this.tactical?this.tactical.position(a.id):undefined;
      if(!driven)undriven++;
      if(driven&&(a.state!=='chase'||a.push.lengthSquared()>.25))this.settleAt(a,driven);
      if(a.push.lengthSquared()>.25){if(driven)this.tactical!.velocity(a.id,a.push,a.push.length(),true);else this.space.slide(a.root.position,{x:a.push.x*dt,y:a.push.y*dt,z:a.push.z*dt},ENEMIES[a.kind].radius,1.8,.5);a.push.scaleInPlace(Math.exp(-dt*8));continue;}
      if(a.state==='windup'){this.space.towardInto(a.root.position,this.player.position,work0);this.space.face(a.root,a.facing,a.root.position,work0,Math.min(1,dt*10));if(a.time>=behavior.windup){this.attack(a);a.state='recover';a.time=0;}continue;}
      let speed=ENEMIES[a.kind].speed*ENEMY_AFFIXES[a.variant].speed;if(a.state==='recover'){speed=behavior.recoverySpeed(a);if(speed&&this.distance(a.root.position,this.player.position)<ENEMIES[a.kind].radius+.55){this.player.applyDamage({...this.damageContext(a.id,behavior.contactDamage,this.player.position,a.kind+'_rush'),forceMagnitude:a.kind==='eggplant'?10:6});a.direction={x:0,z:0};}if(a.time>1.15){a.state='chase';a.time=0;a.cooldown=a.kind==='boss'?1.7:1.5+(a.id%5)*.17;}}
      if(driven){if(a.state==='recover')this.tactical!.velocity(a.id,{x:a.direction.x*speed,y:(a.direction.y??0)*speed,z:a.direction.z*speed},speed,speed>0);const v=this.tactical!.motion(a.id);this.settleAt(a,driven);if(v&&this.space.planarSpeed(a.root.position,v)>.15)this.space.face(a.root,a.facing,a.root.position,v,Math.min(1,dt*9));continue;}
      const before=a.root.position.clone();this.space.slide(a.root.position,{x:a.direction.x*speed*dt,y:(a.direction.y??0)*speed*dt,z:a.direction.z*speed*dt},ENEMIES[a.kind].radius,1.8,.8);if(this.space.groundUnder(a.root.position,.85,work0))a.root.position.copyFrom(work0);else a.root.position.copyFrom(before);
      if(headingLength(a.direction)){workVec.x=a.direction.x;workVec.y=a.direction.y??0;workVec.z=a.direction.z;this.space.face(a.root,a.facing,a.root.position,workVec,Math.min(1,dt*10));}
    }
    // Sem Detour a separação local é quem impede a horda de virar uma pilha. Ela também vale para
    // quem está SEM agente com o Detour ligado — o caso de uma carta de ilha que não carregou.
    // Na fazenda todo ator vivo tem agente, `undriven` é zero, e nada muda.
    if(!this.tactical||undriven>0)this.separate(dt);
    for(const w of this.effects.warnings)if(w.active){
      w.remaining-=dt;if(w.remaining>0)continue;
      const {position,radius,kind,pulses,damage,owner}=w;w.active=false;w.mesh.setEnabled(false);
      if(!damage)continue;
      if(kind==='root')this.effects.eruption(position,radius);
      if(!kind.startsWith('fire'))this.effects.burst(position,kind.startsWith('acid')?'energy':'seed',radius*.5);
      if(this.distance(position,this.player.position)<radius+.25&&Math.abs(this.space.heightGap(position,this.player.position))<2.1){const before=this.player.hp;this.player.applyDamage(this.damageContext(owner,damage,position,kind));if(kind.startsWith('fire')&&this.player.hp<before)this.burning.ignite(owner,1.2);}
      if(pulses>0){const pool=this.effects.warning(position,radius,.6,kind.includes('pool')?damage:damage*.18,owner,kind.startsWith('acid')?'acid-pool':'fire-pool');if(pool)pool.pulses=pulses-1;}
    }
    for(const p of this.effects.projectiles)if(p.active){
      if(p.delay>0){p.delay-=dt;if(p.delay<=0)p.mesh.setEnabled(true);continue;}
      // Cada projétil cai pela vertical local DELE: dois tiros em ilhas opostas do globo têm
      // gravidades opostas, e é por isso que a integração não pode ser global.
      const previous=p.position.clone();p.remaining-=dt;this.space.gravity(p.position,p.velocity,p.gravity,dt);p.position.addInPlace(p.velocity.scale(dt));p.mesh.position.copyFrom(p.position);
      const playerTarget=this.aimPoint(this.player.position,new Vector3()),segment=p.position.subtract(previous),length=segment.lengthSquared();
      const along=length?Math.max(0,Math.min(1,Vector3.Dot(playerTarget.subtract(previous),segment)/length)):0;
      const hit=Vector3.DistanceSquared(previous.add(segment.scale(along)),playerTarget)<.65*.65;
      // `work2` e não `work0`: o `damageContext` logo abaixo escreve em `work0`, e o ponto de
      // impacto ainda precisa sobreviver para criar a poça e a invocação.
      const landed=this.space.fallGround(p.position,work2),wall=this.space.sweepTime(previous,segment,.15)!==undefined;
      if(!(hit||wall||(landed&&this.space.heightGap(p.position,work2)<0)||p.remaining<=0))continue;
      p.active=false;p.mesh.setEnabled(false);if(p.impact?.zone==='fire'){this.elemental.emit('explosion',p.position,.85);this.audio?.impact(true);}else this.effects.burst(p.position,'seed',p.impact?1:.3);
      if(hit&&p.damage){const before=this.player.hp;this.player.applyDamage(this.damageContext(p.owner,p.damage,p.position,p.impact?.zone==='fire'?'incendiary_projectile':'seed_projectile'));if(p.impact?.zone==='fire'&&this.player.hp<before)this.burning.ignite(p.owner);}
      if(p.impact&&landed){const impact={x:work2.x,y:work2.y,z:work2.z};if(p.impact.zone)this.effects.warning(impact,p.impact.zone==='acid'?4:2.3,.12,p.damage||18,p.owner,p.impact.zone);if(p.impact.zone==='fire')this.igniteGround(impact,2.3,p.owner);if(p.impact.summon&&(this.tactical?this.tactical.reachable(impact,this.player.position):this.navigation?this.navigation.reachable(impact):this.space.radial))this.spawn(p.impact.summon,impact);}
    }
  }
  /**
   * A HORDA REPLICADA — apresentação pura.
   *
   * Recebe a lista autoritativa e reconcilia o pool visual contra ela: quem chegou nasce, quem
   * sumiu sai, quem morreu cai. **Nada aqui decide**: posição, vida, estado e alvo vêm prontos.
   *
   * Os corpos são desenhados UM PATCH NO PASSADO (contrato §13): cada amostra nova vira o novo
   * destino e a anterior vira a origem, e o quadro interpola entre as duas pelo intervalo REAL
   * medido entre amostras. Desenhar a última posição crua daria o teleporte a 30 Hz que o contrato
   * proíbe; extrapolar daria o corpo atravessando parede quando um pacote atrasa.
   */
  private readonly replicaSeen=new Set<number>();
  replicate(rows:readonly ReplicatedEnemy[],dt:number):void {
    this.authority='server';
    // Conjunto reaproveitado: isto roda a cada passo fixo, até 5 vezes num quadro atrasado.
    const seen=this.replicaSeen;seen.clear();
    for(const row of rows){
      let a=this.byServerId.get(row.id);
      if(!a){
        a=this.adoptReplica(row);
        if(!a)continue;               // GLB ainda carregando: o corpo entra no próximo patch
      }
      seen.add(row.id);               // só corpos ADOTADOS: a limpeza abaixo compara tamanhos
      const track=a.replica!;
      // Assinatura da amostra: só o que MUDA por tique. Sem ela, um corpo parado reiniciaria a
      // interpolação a cada quadro e nunca chegaria ao destino.
      // Números, não uma string por corpo por passo: a comparação era lixo para o GC a 60 Hz.
      if(row.x!==track.rx||row.y!==track.ry||row.z!==track.rz||row.yaw!==track.ryaw){
        track.previous={x:a.root.position.x,y:a.root.position.y,z:a.root.position.z};
        track.yawPrevious=a.root.rotation.y;
        track.target={x:row.x,y:row.y,z:row.z};track.yawTarget=row.yaw;
        // Intervalo real entre amostras, com piso: a sala publica a 30 Hz, mas jitter acontece.
        track.interval=Math.max(1/120,Math.min(.5,track.elapsed));
        track.elapsed=0;track.rx=row.x;track.ry=row.y;track.rz=row.z;track.ryaw=row.yaw;
      }
      track.elapsed+=dt;
      const t=Math.min(1,track.elapsed/track.interval);
      a.root.position.set(
        track.previous.x+(track.target.x-track.previous.x)*t,
        track.previous.y+(track.target.y-track.previous.y)*t,
        track.previous.z+(track.target.z-track.previous.z)*t,
      );
      // Ângulo pelo caminho curto: sem isto o corpo gira 350° ao cruzar ±π.
      const turn=Math.atan2(Math.sin(track.yawTarget-track.yawPrevious),Math.cos(track.yawTarget-track.yawPrevious));
      a.root.rotation.y=track.yawPrevious+turn*t;
      a.health.current=row.hp;a.time=row.time;a.burn=row.burn;a.stagger=row.stagger;
      a.targetPlayerId=row.targetPlayerId;
      if(row.alive){a.state=row.state==='dead'?'chase':row.state;continue;}
      // MORTE: uma transição, uma vez. Os dois clientes veem a mesma, porque os dois recebem a
      // mesma linha virar `alive:false` — nenhum deles decide "agora morreu".
      if(a.state!=='dead')this.presentDeath(a);
    }
    // Quem o servidor tirou de campo sai aqui — com o cadáver articulado devolvido ao pool, que é
    // o que `fixedUpdate` fazia aos 7 s e não faz mais neste modo.
    if(this.byServerId.size>seen.size)for(const [id,a] of [...this.byServerId]) if(!seen.has(id)){
      this.ragdolls.release(a.ragdoll);a.ragdoll=undefined;
      this.release(a);this.byServerId.delete(id);
    }
  }

  /** Cria o corpo visual de uma linha nova, reusando o pool e o caminho de nascimento existentes. */
  private adoptReplica(row:ReplicatedEnemy):Actor|undefined {
    this.applyingReplica=true;
    const born=this.spawn(row.kind,{x:row.x,y:row.y,z:row.z},row.variant);
    this.applyingReplica=false;
    if(!born||this.lastSpawnedId<0)return undefined;
    const a=this.byId.get(this.lastSpawnedId);
    if(!a)return undefined;
    a.serverId=row.id;
    // A vida é a do SERVIDOR, inclusive o máximo: a fórmula local não conhece o multiplicador de
    // onda nem o nível da sala, e uma barra com denominador diferente mostraria progresso errado.
    a.health=new Health(a.id,row.maxHP,this.events);
    a.health.current=row.hp;
    a.replica={previous:{x:row.x,y:row.y,z:row.z},target:{x:row.x,y:row.y,z:row.z},yawPrevious:row.yaw,yawTarget:row.yaw,elapsed:0,interval:1/30,rx:NaN,ry:NaN,rz:NaN,ryaw:NaN};
    a.root.rotation.y=row.yaw;
    // O escalonador de IA é do servidor: um emprego local aqui faria `think` decidir windup.
    this.scheduler.remove(a.id);
    this.byServerId.set(row.id,a);
    return a;
  }

  /**
   * A cena de morte, sem nenhuma consequência de jogo.
   *
   * O que `hit` fazia aqui e NÃO acontece mais: recompensa, XP, ouro, colheita, `director.bossKilled`
   * e `StageCompleted`. Todos são do servidor. Ficam o ragdoll, os cacos, o cadáver e o som — que
   * são justamente o que pode divergir entre telas sem consequência nenhuma.
   */
  private presentDeath(a:Actor):void {
    a.state='dead';a.time=0;
    this.lastKill={position:{x:a.root.position.x,y:a.root.position.y,z:a.root.position.z},kind:a.kind,age:0};
    this.scheduler.remove(a.id);this.tactical?.remove(a.id);a.palette.sync();
    const context=this.damageContext(a.id,0,a.root.position,'replicated_death');
    a.ragdoll=this.takeRagdoll(a,context);
    this.audio?.enemy('death',a.kind,this.distance(a.root.position,this.player.position));
    a.body.isPickable=false;
    for(const mesh of a.target.meshes??[a.body])mesh.isPickable=false;
    this.launchCorpse(a,context.forceDirection,3,3);
    this.effects.burst(a.root.position,'juice',a.kind==='boss'?4:1.2);
    this.fragments.burst(a.kind,a.root.position,context.forceDirection,a.body,a.kind==='boss'?1.6:1);
    // Contador de tela: o abate já foi contado no servidor, aqui é só o número que o HUD mostra.
    this.kills++;
    if(a.kind==='boss')this.bossDeadTime=this.mode==='classic'?0:-1;
  }

  update(dt:number):void {
    this.lasers.begin();this.presentationTime+=dt;this.elemental.update(dt);this.flameClock-=dt;if(this.flameClock<=0&&dt>0){this.flameClock=.11;for(const p of this.effects.projectiles)if(p.active&&p.delay<=0&&p.impact?.zone==='fire')this.elemental.emit('fire',p.position,.65);let fields=0;for(const w of this.effects.warnings)if(w.active&&w.kind.startsWith('fire')&&fields++<3){for(let i=0;i<2;i++){const a=this.presentationTime+i*3.14;this.elemental.emit('fire',this.space.ringPoint(w.position,a,w.radius*.4,.06,new Vector3()),.8);}}}
    this.elemental.aura('fire',this.burning.remaining>0?[this.space.lift(this.player.position,.6,new Vector3())]:[],this.presentationTime,this.burning.remaining>0?.65:0);
    const lights=this.chargeLights.length,charging=this.nearest(lights,Number.POSITIVE_INFINITY,this.isChargingTomato);
    for(let i=0;i<lights;i++){
      const light=this.chargeLights[i]!,actor=charging[i]!.actor;
      light.intensity=actor?Math.pow(Math.min(1,actor.time/ENEMY_BEHAVIORS.tomato.windup),2)*3:0;
      if(!actor)continue;
      this.space.lift(actor.root.position,3,light.position);
      // O `set includedOnlyMeshes` do Babylon chama `_hookArrayForIncludedOnly` → `_resyncMeshes`,
      // que percorre TODAS as malhas da cena. Reatribuir a mesma lista a cada quadro custava uma
      // varredura completa da cena por luz, por quadro. A lista de malhas de um ator é fixa desde a
      // criação (inclusive quando o corpo é reciclado), então só a troca de ator muda a filiação.
      // Luz sem ator fica só com `intensity=0`: esvaziar a lista significaria iluminar o mundo inteiro.
      if(this.chargeLightTargets[i]===actor)continue;
      this.chargeLightTargets[i]=actor;
      light.includedOnlyMeshes=[...(actor.target.meshes??[actor.body])];
    }
    this.updateGroundFire(dt);this.debris.update(dt);this.fragments.update(dt);this.effects.render(dt);this.shadowClock-=dt;
    if(this.shadowClock<=0){this.shadowClock=.5;for(const mesh of this.shadowCasters)this.shadows.removeShadowCaster(mesh);
      const picks=this.nearest(SHADOW_CASTERS,24,this.isLiveActor);this.shadowCasters.length=0;
      for(let i=0;i<SHADOW_CASTERS;i++){const actor=picks[i]!.actor;if(actor)this.shadowCasters.push(actor.body);}
      for(const mesh of this.shadowCasters)this.shadows.addShadowCaster(mesh);}
    for(let i=this.labels.length-1;i>=0;i--){this.labels[i]!.time-=dt;if(this.labels[i]!.time<=0)this.labels.splice(i,1);}
    for(const a of this.actors){
      if(!a.active)continue;a.healthTrail+=(a.health.current-a.healthTrail)*Math.min(1,dt*4);
      // O caso comum é "sem overlay e já estava sem": sair cedo evita reescrever cor/alfa de cada malha
      // de cada ator a cada frame. A cor deixou de ser recriada (e reparseada do hexadecimal) por malha.
      const charge=a.kind==='tomato'&&a.state==='windup'&&!a.health.dead?Math.min(1,a.time/ENEMY_BEHAVIORS.tomato.windup):0;
      const overlay=(a.hit>0||charge>0)&&!a.health.dead,overlayColor=charge>0?CHARGE_OVERLAY:HIT_OVERLAY,overlayAlpha=charge>0?.65*charge:Math.min(.48,a.hit*5);
      for(const mesh of a.target.meshes??[a.body]){if(!overlay&&!mesh.renderOverlay)continue;mesh.renderOverlay=overlay;mesh.overlayColor=overlayColor;mesh.overlayAlpha=overlayAlpha;}
      if(a.state==='dead'&&a.ragdoll)continue;
      const d=this.distance(a.root.position,this.player.position);a.anim+=dt;if(d>=24&&a.anim<(d<45?1/30:1/15))continue;
      const elapsed=a.anim;a.anim=0;const moved=this.distance(a.root.position,a.lastPosePosition);a.lastPosePosition.copyFrom(a.root.position);
      const speed=moved/Math.max(.001,elapsed),stride=(a.kind==='watermelon'?1.55:speed>2.8?2.4:1.5)*a.scale;a.gait+=moved/stride;
      // Quem está fugindo corre, sempre: é a leitura que o jogador tem de "desistiram de mim".
      let state=a.state==='dead'?'Death':a.state==='spawn'?'Spawn':a.state==='flee'?'Run':a.stagger>0?'Hit':a.state==='windup'?'Cast':a.state==='recover'?'Attack':a.kind==='tomato'?'Fly':speed<.15?'Idle':speed>2.8?'Run':'Walk';
      if(a.state==='recover'&&a.stagger===0){if(a.kind==='watermelon')state=a.attack%3===1?'Roll':a.attack%3===2?'Spit':'Bite';if(a.kind==='tomato')state='Spit';if(a.kind==='eggplant'&&ENEMY_BEHAVIORS.eggplant.recoverySpeed(a)>0)state='Run';}
      const clipName=a.clips.has(state)?state:'Walk',clip=a.clips.get(clipName);
      if(clip){const seconds=Math.max(.01,(clip.to-clip.from)/60);
        const progress=a.state==='spawn'?Math.min(1,a.time/(a.kind==='carrot'?1.15:a.kind==='watermelon'?1.8:a.kind==='tomato'?1.6:1.5)):a.state==='dead'?Math.min(1,a.time/seconds):a.stagger>0?1-a.stagger/.18:a.state==='windup'?Math.min(1,a.time/ENEMY_BEHAVIORS[a.kind].windup):a.state==='recover'?(state==='Run'?a.gait%1:Math.min(1,a.time/seconds)):state==='Idle'?(clipName==='Walk'?.12:(a.time/seconds)%1):state==='Fly'?((this.presentationTime+a.id*.073)/.44)%1:a.gait%1;
        a.machine.sample(state,progress,elapsed,()=>true,clipName);
        // Wing beats remain continuous while the mouth performs its attack layer.
        if(a.kind==='tomato'&&a.state!=='dead'&&state!=='Fly'){const fly=a.clips.get('Fly');if(fly){const frame=fly.from+(fly.to-fly.from)*(((this.presentationTime+a.id*.073)/.44)%1);for(const track of fly.targetedAnimations)if(/Bone_04[012345]$/.test(track.target.name))track.target.rotationQuaternion=track.animation.evaluate(frame).clone();}}
      }
      if(a.state!=='dead'&&a.state!=='spawn'){
        const roll=a.state==='recover'?(ENEMY_BEHAVIORS[a.kind].roll?.(a)??0):0;
        a.visual.position.y=(a.state==='recover'||a.kind==='tomato'?(ENEMY_BEHAVIORS[a.kind].hover?.(a,this.director.time)??0):0)+(roll?.8*(1-Math.cos(roll)):0);
        a.visual.position.z=roll?-.8*Math.sin(roll):0;a.visual.rotation.z=a.hit>0?Math.sin(a.hit*40)*.06:0;a.visual.rotation.x=roll+(a.kind==='eggplant'?(a.state==='windup'?-.18*Math.min(1,a.time/.9):a.state==='recover'&&ENEMY_BEHAVIORS.eggplant.recoverySpeed(a)>0?.24:0):0);
      }
      // A prévia do feixe é o aviso de direção da cenoura: não pode depender do socket existir no rig.
      if(a.kind==='carrot'&&(a.state==='windup'||a.state==='recover'&&a.time<.4)){if(a.laserArm&&a.laserSocket){const direction=this.aimPoint(a.locked,new Vector3()).subtract(a.laserSocket.getAbsolutePosition()).normalize();aimArmAt(a.laserArm,a.laserSocket,direction);}const path=this.laserPath(a);this.lasers.show(path.from,path.to,a.state==='windup'?.09+.10*a.time:1-a.time/.4);}
      a.palette.sync();a.root.computeWorldMatrix(true);
    }
  }
  dispose():void {this.fragments.dispose();this.lasers.dispose();for(const l of this.chargeLights)l.dispose();this.elemental.dispose();this.burning.clear();this.groundFire.clear();this.ragdolls.clear();this.tactical?.dispose();this.debris.clear();this.disposed=true;this.scheduler.clear();this.effects.dispose();for(const a of this.actors){this.world.collision.playerBodies.delete(a.id);const i=this.world.targets.indexOf(a.target);if(i>=0)this.world.targets.splice(i,1);for(const clip of a.clips.values())clip.dispose();a.root.dispose();}for(const container of this.containers.values())container.dispose();this.actors.length=0;this.byId.clear();this.replacements.length=0;this.tick.clear();this.separationBuckets.clear();this.separationPool.length=0;this.nearestSlots.length=0;this.shadowCasters.length=0;this.chargeLightTargets.length=0;}
}










