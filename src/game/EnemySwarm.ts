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
import { ENEMIES,MonsterDirector,bossHealth,type DirectorMode,type EnemyKind } from '../run/MonsterDirector';
import type { RunProgression } from '../run/RunProgression';
import { CombatPresentation } from '../vfx/CombatPresentation';
import { ENEMY_BEHAVIORS,type TelegraphPlan } from '../enemies/EnemyBehaviors';
import { ItemProcs } from '../items/ItemProcs';
import { CorpseDebris } from '../physics/CorpseDebris';
import { TacticalNavigation } from '../ai/TacticalNavigation';
import { AnimationStateMachine } from '../animation/AnimationStateMachine';
import { RagdollWorld } from '../physics/RagdollWorld';
import type { Skeleton } from '@babylonjs/core/Bones/skeleton';
import type { WeaponAudio } from '../audio/WeaponAudio';
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

type State='spawn'|'chase'|'windup'|'recover'|'dead';
interface Actor {id:number;kind:EnemyKind;variant:EnemyVariant;scale:number;push:Vector3;root:TransformNode;body:Mesh;visual:TransformNode;clips:Map<string,AnimationGroup>;machine:AnimationStateMachine;skeleton:Skeleton|undefined;laserSocket?:TransformNode;laserArm?:TransformNode;ragdoll:ReturnType<RagdollWorld['create']>;healthTrail:number;gait:number;lastPosePosition:Vector3;palette:PosePalette;health:Health;target:TrainingTarget;state:State;time:number;attack:number;locked:Vec3;direction:Heading;facing:Vector3;burn:number;burnClock:number;anim:number;hit:number;stagger:number;staggerCooldown:number;deathVelocity:Vector3;active:boolean;cooldown:number}
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
export interface DamageLabel {position:Vec3;amount:number;crit:boolean;time:number}
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
   * Onde caiu o último inimigo abatido pelo jogador. A recompensa da horda/evento é ejetada
   * neste ponto (ou no piso seguro mais próximo), em vez de um campo fixo no centro do mapa.
   */
  lastKill:{position:Vec3;kind:EnemyKind;age:number}|undefined;
  private harvestSequence=0;
  /** Cacos de casca/polpa/semente por espécie, derivados do corpo real. */
  readonly fragments:FruitFragments;
  private presentationTime=0;private procs:ItemProcs;private shadowClock=0;private shadowCasters:Mesh[]=[];
  populationCap=24;readonly budget=new PopulationBudget();benchmark=false;private retirementClock=0;private debris:CorpseDebris;private readonly ragdolls=new RagdollWorld();tactical:TacticalNavigation|undefined;navigationReady=false;audio:WeaponAudio|undefined;
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
  constructor(private readonly scene:Scene,private readonly world:{targets:TrainingTarget[];collision:CollisionWorld;surface?:EnemySurface},private readonly events:EventBus<GameEvents>,private readonly shadows:ShadowGenerator,private readonly player:PlayerMotor,private readonly progression:RunProgression,private readonly rng:RunRNG,readonly mode:DirectorMode='classic'){this.radial=radialSurfaceOf(world.surface);this.space=enemySpace(world.collision,world.surface);this.fragments=new FruitFragments(scene,world.collision);this.fragments.useSurface(world.surface);this.debris=new CorpseDebris(world.collision,world.surface);this.procs=new ItemProcs(progression,rng.stream('procs'));this.director=new MonsterDirector(rng.stream('director'),progression.stage,50,mode);this.effects=new CombatPresentation(scene);this.effects.useSurface(world.surface);this.lasers=new EnemyLaser(scene);this.elemental=new ElementalEffects(scene,world.collision,world.surface);for(let i=0;i<2;i++){const light=new PointLight('tomato-incendiary-charge-'+i,Vector3.Zero(),scene);light.diffuse=new Color3(1,.23,.025);light.range=4;light.intensity=0;this.chargeLights.push(light);}}
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
  async load(loader:(model:string)=>Promise<AssetContainer>=model=>LoadAssetContainerAsync(`/models/${model}.glb`,this.scene)):Promise<void>{try{for(const model of new Set(Object.values(ENEMIES).map(x=>x.model))){if(this.disposed)return;const container=await loader(model);if(this.disposed){container.dispose();return;}this.containers.set(model,container);}this.ready=true;}catch(error){if(!this.disposed)this.error=String(error);}}
  async prepareNavigation():Promise<void>{try{const tactical=await TacticalNavigation.create(this.world.collision,true);if(this.disposed){tactical.dispose();return;}this.tactical=tactical;this.navigationReady=true;}catch(error){this.error=String(error);}}
  /**
   * A grade de fluxo da fazenda é uma carta plana de 120 m em torno da origem: no planeta ela não
   * significa nada (e custaria 6 561 sondas de apoio para nascer inútil). Sem Detour e sem ela, a
   * perseguição radial usa direção tangente direta — continua perseguindo, atacando e morrendo.
   */
  initialize():void {if(this.tactical||this.navigation||this.space.radial)return;this.navigation=new FarmNavigation(this.world.collision);this.navigation.update(this.player.position);}
  nextStage():void {this.lasers.begin();this.elemental.clear();for(const l of this.chargeLights)l.intensity=0;this.burning.clear();this.debris.clear();this.fragments.clear();this.ragdolls.clear();this.tactical?.clear();this.scheduler.clear();this.tick.clear();this.chargeLightTargets.length=0;this.populationCap=this.budget.limit;this.benchmark=false;this.retirementClock=0;for(const a of this.actors){a.active=false;a.root.setEnabled(false);a.body.isPickable=false;}this.kills=0;this.boss=undefined;this.bossDeadTime=-1;this.effects.clear();this.labels.length=0;this.director=new MonsterDirector(this.rng.stream('director'),this.progression.stage,50,this.mode);}
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
      if(!a.active||a.health.dead||a.kind==='boss')continue;
      const d=this.distanceSquared(a.root.position,this.player.position);
      if(d>best){best=d;pick=a;}
    }
    return pick;
  }
  updateBudget(dt:number,frameMs:number):void {
    if(this.benchmark)return;this.budget.update(dt,frameMs);this.populationCap=this.budget.limit;
    this.retirementClock-=dt;if(this.count<=this.populationCap||this.retirementClock>0)return;
    const actor=this.farthestRetirable(18);
    if(actor){this.director.retireLivingEnemy();actor.active=false;actor.root.setEnabled(false);actor.body.isPickable=false;this.scheduler.remove(actor.id);this.tactical?.remove(actor.id);this.retirementClock=1;}
  }
  updateCameraVisibility(camera:Vec3,dt:number):void {for(const a of this.actors){if(!a.active)continue;const d=this.distance(a.root.position,camera);const desired=d<ENEMIES[a.kind].radius*ENEMY_AFFIXES[a.variant].scale+.9?0:1;for(const mesh of a.target.meshes??[a.body])mesh.visibility=Math.abs(desired-mesh.visibility)<.01?desired:mesh.visibility+(desired-mesh.visibility)*Math.min(1,dt*14);}}
  /**
   * Sem Detour E sem grade da fazenda (caso do planeta enquanto a carta assa) não existe oráculo de
   * alcançabilidade: aceitar o ponto é o certo, porque o apoio já foi medido pelo `SpawnPlanner` e
   * recusar tudo esvaziaria a horda. É a mesma decisão que o modo de treino já toma hoje.
   */
  private spawnPosition(min?:number,max?:number):Vec3|undefined {return chooseSpawnAround(this.player.position,this.rng.stream('spawn'),this.world.collision,p=>this.tactical?this.tactical.reachable(p,this.player.position):this.navigation?this.navigation.reachable(p):this.space.radial,p=>this.actors.some(a=>a.active&&!a.health.dead&&this.distance(p,a.root.position)<2),min,max,this.radial);}
  /** Chefe do último evento da expedição: nasce num anel um pouco maior, sempre em piso válido. */
  requestBoss():boolean {
    if(this.boss&&this.boss.active&&!this.boss.health.dead)return true;
    this.initialize();
    const at=this.spawnPosition(20,34);
    return at?this.spawn('boss',at):false;
  }
  /** Sem rota até o jogador (ou longe demais) o chefe deixa de ser um objetivo jogável. */
  get bossReachable():boolean {
    const boss=this.boss;
    if(!boss||!boss.active||boss.health.dead)return true;
    if(this.distance(boss.root.position,this.player.position)>110)return false;
    if(this.tactical)return this.tactical.reachable(boss.root.position,this.player.position);
    return this.navigation?.reachable(boss.root.position)??true;
  }
  /** Recuperação: recoloca o mesmo chefe em piso válido perto do jogador, sem recriar vida nem recompensa. */
  recoverBoss():boolean {
    const boss=this.boss;
    if(!boss||!boss.active||boss.health.dead)return false;
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
    if(kind==='boss'&&this.boss&&!this.boss.health.dead)return true;
    if(!this.ready||(this.count>=this.populationCap&&kind!=='boss'))return false;const at=position??this.spawnPosition();if(!at)return false;
    if(this.count>=this.populationCap){const retired=this.farthestRetirable(0);if(!retired)return false;this.director.retireLivingEnemy();retired.active=false;this.scheduler.remove(retired.id);this.tactical?.remove(retired.id);retired.root.setEnabled(false);for(const mesh of retired.target.meshes??[retired.body])mesh.isPickable=false;}
    const definition=ENEMIES[kind],affix=ENEMY_AFFIXES[variant];let actor=this.actors.find(a=>!a.active&&a.kind===kind);
    if(!actor){const container=this.containers.get(definition.model);if(!container)return false;const instance=container.instantiateModelsToScene(n=>`enemy-${this.nextId}-${n}`,false,{doNotInstantiate:true});const root=new TransformNode(`enemy-${this.nextId}`,this.scene),visual=new TransformNode(`enemy-visual-${this.nextId}`,this.scene);visual.parent=root;for(const node of instance.rootNodes)node.parent=visual;
      const meshes=visual.getChildMeshes();const body=meshes.filter(x=>x.getTotalVertices()>0).sort((a,b)=>b.getTotalVertices()-a.getTotalVertices())[0] as Mesh|undefined;if(!body){root.dispose();return false;}
      for(const mesh of meshes){mesh.isPickable=mesh.getTotalVertices()>0;mesh.receiveShadows=true;}body.isPickable=true;
      const id=this.nextId++,health=new Health(id,this.healthFor(kind,variant),this.events);const target:TrainingTarget={id,mesh:body,hits:0};const clips=new Map<string,AnimationGroup>();for(const clip of instance.animationGroups){clip.stop();for(const name of ['Spawn','Walk','Run','Idle','Hit','Death','Attack','Cast','Fly','Spit','Bite','Roll'])if(clip.name.endsWith(name))clips.set(name,clip);}
      target.meshes=meshes.filter(mesh=>mesh.getTotalVertices()>0) as Mesh[];
      actor={id,kind,variant,scale:definition.scale,push:Vector3.Zero(),root,visual,body,health,target,clips,machine:new AnimationStateMachine(clips),skeleton:instance.skeletons[0],ragdoll:undefined,healthTrail:health.maximum,gait:0,lastPosePosition:Vector3.FromArray([at.x,at.y,at.z]),palette:new PosePalette(instance.skeletons),state:'spawn',time:0,attack:0,locked:{...at},direction:{x:0,z:0},facing:new Vector3(0,0,1),burn:0,burnClock:0,anim:0,hit:0,stagger:0,staggerCooldown:0,deathVelocity:Vector3.Zero(),active:true,cooldown:0};const captured=actor;target.onHit=context=>this.hit(captured,context);if(kind==='carrot'){const nodes=visual.getChildTransformNodes(),hand=nodes.find(n=>n.name.endsWith('RightHand')),arm=nodes.find(n=>n.name.endsWith('RightArm'));if(hand&&arm){const socket=new TransformNode('carrot-right-palm-muzzle',this.scene);socket.parent=hand;socket.position.set(0,6,0);socket.rotationQuaternion=Quaternion.FromUnitVectorsToRef(Vector3.Forward(),Vector3.Up(),Quaternion.Identity());actor.laserSocket=socket;actor.laserArm=arm;}}this.actors.push(actor);this.byId.set(actor.id,actor);this.world.targets.push(target);
    }
    this.ragdolls.release(actor.ragdoll);actor.ragdoll=undefined;actor.machine.reset();actor.gait=0;actor.lastPosePosition.set(at.x,at.y,at.z);
    actor.variant=variant;actor.scale=definition.scale*affix.scale;actor.push.setAll(0);actor.active=true;actor.health=new Health(actor.id,this.healthFor(kind,variant),this.events);actor.healthTrail=actor.health.maximum;actor.state='spawn';actor.time=0;actor.burn=0;actor.hit=0;actor.stagger=0;actor.staggerCooldown=0;actor.cooldown=1;actor.direction={x:0,z:0};actor.attack=0;actor.root.position.set(at.x,at.y,at.z);this.space.faceAt(actor.root,actor.facing,at,this.player.position);actor.root.scaling.setAll(actor.scale);actor.visual.rotationQuaternion=null;actor.visual.rotation.set(0,0,0);actor.visual.position.set(0,-1,0);actor.body.isPickable=true;actor.root.setEnabled(true);
    for(const mesh of actor.target.meshes??[actor.body]){
      mesh.isPickable=true;mesh.setEnabled(true);
      if(mesh.material instanceof PBRMaterial){const baseName=mesh.material.name.split('::elite::')[0]!,baseKey=definition.model+':'+baseName;if(!this.eliteMaterials.has(baseKey))this.eliteMaterials.set(baseKey,mesh.material);const original=this.eliteMaterials.get(baseKey)!;original.maxSimultaneousLights=2;
        if(variant==='normal')mesh.material=original;else{const key=baseKey+variant;let material=this.eliteMaterials.get(key);if(!material){material=original.clone(baseName+'::elite::'+variant);const tint=Color3.FromHexString(affix.color);material.albedoColor=original.albedoColor.multiply(tint.scale(.45).add(new Color3(.55,.55,.55)));material.emissiveColor=tint.scale(variant==='charged'?.65:.14);this.eliteMaterials.set(key,material);}mesh.material=material;}
      }
    }
    this.world.collision.playerBodies.set(actor.id,{id:actor.id,position:actor.root.position,radius:definition.radius*affix.scale,height:actor.kind==='watermelon'?1.6:2,active:()=>actor!.active&&!actor!.health.dead&&actor!.kind!=='tomato'&&actor!.state!=='spawn'});
    this.tactical?.add(actor.id,at,definition.radius*affix.scale,definition.speed*affix.speed);this.audio?.enemy('spawn',kind,this.distance(at,this.player.position));
    const scheduled=actor;this.scheduler.add({id:actor.id,distance:()=>this.distance(scheduled.root.position,this.player.position),update:dt=>{if(scheduled.active&&!scheduled.health.dead)this.think(scheduled,dt);}});
    this.effects.burst(at,'soil',kind==='boss'?3:1);if(kind==='boss'){this.boss=actor;this.events.emit('BossSpawned',{entityId:actor.id,definitionId:'boss_fruit_abomination_01'});}return true;
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
  private hit(a:Actor,context:DamageContext):void {
    if(!a.active||a.health.dead)return;const stats=this.progression.stats,crit=context.procChainDepth===0&&this.rng.stream('run').next()<stats.crit;
    const rawDamage=context.procChainDepth>0?context.finalDamage:context.baseDamage*stats.damage*(context.damageTags.includes('skill')?stats.mp:1)*(crit?2:1);const finalDamage=rawDamage*100/(100+ENEMY_AFFIXES[a.variant].armor);const applied={...context,finalDamage,crit:context.crit||crit};
    if(!a.health.apply(applied))return;a.hit=.10;const {force,stagger}=enemyImpact(context,a.variant,a.kind,a.staggerCooldown);
    // O empurrão continua sendo TANGENTE ao chão onde o corpo está: no plano isso é zerar `y`, na
    // esfera é remover a componente radial. Um empurrão com componente vertical arrancaria a praga
    // do convés, e ela não tem integração vertical em nenhum estado vivo.
    if(force>.5){this.space.tangentInto(a.root.position,context.forceDirection,work0);a.push.set(work0.x*force,work0.y*force,work0.z*force);}
    if(stagger){a.stagger=.18;a.staggerCooldown=.85;if(a.state==='windup'){a.state='chase';a.time=0;a.cooldown=.4;}}
    this.audio?.enemy('hit',a.kind,this.distance(a.root.position,this.player.position));this.space.lift(a.root.position,1.8,work0);this.labels.push({position:{x:work0.x,y:work0.y,z:work0.z},amount:Math.round(finalDamage),crit:applied.crit,time:.7});if(this.labels.length>32)this.labels.shift();
    this.procs.onHit(context,{burn:seconds=>{a.burn=seconds;a.burnClock=0;this.effects.burst(a.root.position,'seed');},blast:radius=>{this.effects.burst(a.root.position,'seed',2);for(const other of this.actors)if(other!==a&&other.active&&!other.health.dead&&this.distance(other.root.position,a.root.position)<radius)this.hit(other,{...applied,victimId:other.id,baseDamage:finalDamage*.5,finalDamage:finalDamage*.5,procChainDepth:1,sourceProcId:'bomb'});}});
    if(a.health.dead){this.lastKill={position:{x:a.root.position.x,y:a.root.position.y,z:a.root.position.z},kind:a.kind,age:0};this.scheduler.remove(a.id);a.state='dead';a.time=0;this.tactical?.remove(a.id);a.palette.sync();a.ragdoll=this.ragdolls.create(a.skeleton,a.body,applied,a.scale);this.audio?.enemy('death',a.kind,this.distance(a.root.position,this.player.position));a.body.isPickable=false;this.launchCorpse(a,context.forceDirection,3,3);this.kills++;this.progression.reward(a.kind==='boss',ENEMY_AFFIXES[a.variant].gold);const heal=this.procs.onKill();this.player.hp=Math.min(this.player.maxHP,this.player.hp+heal);this.effects.burst(a.root.position,heal?'energy':'juice',a.kind==='boss'?4:1.2);this.fragments.burst(a.kind,a.root.position,context.forceDirection,a.body,a.kind==='boss'?1.6:1);
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
      if(a.kind==='boss'){this.debris.fracture(a.target.meshes??[a.body],a.body);for(const corpse of this.actors)if(corpse!==a&&corpse.active&&corpse.health.dead&&this.distance(corpse.root.position,a.root.position)<12){
        this.space.towardInto(a.root.position,corpse.root.position,work0);
        const push=this.distance(corpse.root.position,a.root.position)*.8;
        this.space.clearVertical(corpse.root.position,corpse.deathVelocity);
        corpse.deathVelocity.addInPlaceFromFloats(work0.x*push,work0.y*push,work0.z*push);
        this.space.raise(corpse.root.position,corpse.deathVelocity,5);
      }this.director.bossKilled();this.bossDeadTime=this.mode==='classic'?0:-1;this.events.emit('BossKilled',applied);if(this.mode!=='expedition')this.events.emit('StageCompleted',{stageId:String(this.progression.stage)});}
    }
  }
  /**
   * Impulso do cadáver: `tangential` metros por segundo na direção tangente de `direction` mais
   * `vertical` na vertical LOCAL do corpo. Na fazenda isso reproduz o `set(x, y, z)` de antes.
   */
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
    if(this.tactical)this.tactical.target(a.id,p,this.tick.rank(a.id),ranged,def.speed*ENEMY_AFFIXES[a.variant].speed);
    if(behavior.ranged){if(d<def.range*.55){a.direction.x*=-1;a.direction.z*=-1;if(a.direction.y!==undefined)a.direction.y*=-1;}else if(d<def.range)a.direction={x:0,z:0};}
    if(behavior.zigzag&&d>2&&d<10)this.space.rotateHeading(a.root.position,a.direction,Math.sin(this.director.time*3+a.id)*.65);
    a.cooldown=Math.max(0,a.cooldown-dt);
    // Alcance, altura, recarga e lotação são testes aritméticos; a varredura de linha de visão é a cara
    // do conjunto e agora só roda para quem já passou por todos eles — o `&&` avalia na ordem escrita.
    // A porta de altura é a diferença na vertical LOCAL: em `+Y` na fazenda, radial no planeta.
    if(!(d<=def.range&&Math.abs(this.space.heightGap(p,a.root.position))<3&&a.cooldown===0&&this.tick.windups(ranged)<(ranged?4:3)))return;
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
    if(this.lastKill)this.lastKill.age+=dt;
    // Cada OSSO de cada cadáver cai pela radial do ponto onde ele está, não pela do jogador: dois
    // corpos em ilhas diferentes têm gravidades diferentes, e é isso que a correção por corpo dá.
    // Na fazenda ninguém chama isto e a gravidade do ragdoll segue `(0,−18,0)`, intacta.
    if(this.radial)this.ragdolls.applyLocalGravity(this.localDown,dt);
    if(!this.ready||this.player.hp<=0)return;this.burning.update(dt,(owner,amount)=>{this.player.applyDamage({...this.damageContext(owner,amount,this.player.position,'incendiary_burn'),forceMagnitude:0,damageTags:['enemy','fire','dot']});});this.initialize();this.navigation?.update(this.player.position);this.buildTickCache();this.scheduler.update(dt);this.tactical?.step(dt,this.player.position);this.director.update(dt,this.kills,this.count,kind=>this.spawn(kind),this.populationCap);if(this.bossDeadTime>=0)this.bossDeadTime+=dt;
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
      if(a.state==='spawn'){this.tactical?.velocity(a.id,{x:0,y:0,z:0},0);const duration=a.kind==='carrot'?1.15:a.kind==='watermelon'?1.8:a.kind==='tomato'?1.6:1.5,t=Math.min(1,a.time/duration),ease=t*t*(3-2*t),depth=a.kind==='watermelon'?1.4:2;a.visual.position.y=-depth*(1-ease)+(a.kind==='tomato'?2*ease:a.kind==='carrot'?.18*Math.sin(t*Math.PI):0);if(a.time>=duration){a.state='chase';a.time=0;}continue;}
      const behavior=ENEMY_BEHAVIORS[a.kind];
      // Quem persegue cai no bloco do Detour lá embaixo, que refaz exatamente esta sincronização.
      // Repeti-la aqui custava um segundo `position()` + `groundAt` por ator por frame, sem efeito.
      // `driven` distingue "existe Detour E este ator tem agente" de "existe Detour". Uma carta de
      // ilha que ainda está assando devolve `position()` indefinido: sem isto o corpo congelaria
      // no lugar em vez de perseguir com deslocamento direto.
      const driven=this.tactical?this.tactical.position(a.id):undefined;
      if(!driven)undriven++;
      if(driven&&(a.state!=='chase'||a.push.lengthSquared()>.25))this.settleAt(a,driven);
      if(a.push.lengthSquared()>.25){if(driven)this.tactical!.velocity(a.id,a.push,a.push.length());else this.space.slide(a.root.position,{x:a.push.x*dt,y:a.push.y*dt,z:a.push.z*dt},ENEMIES[a.kind].radius,1.8,.5);a.push.scaleInPlace(Math.exp(-dt*8));continue;}
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
      if(p.impact&&landed){const impact={x:work2.x,y:work2.y,z:work2.z};if(p.impact.zone)this.effects.warning(impact,p.impact.zone==='acid'?4:2.3,.12,p.damage||18,p.owner,p.impact.zone);if(p.impact.summon&&(this.tactical?this.tactical.reachable(impact,this.player.position):this.navigation?this.navigation.reachable(impact):this.space.radial))this.spawn(p.impact.summon,impact);}
    }
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
    this.debris.update(dt);this.fragments.update(dt);this.effects.render(dt);this.shadowClock-=dt;
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
      let state=a.state==='dead'?'Death':a.state==='spawn'?'Spawn':a.stagger>0?'Hit':a.state==='windup'?'Cast':a.state==='recover'?'Attack':a.kind==='tomato'?'Fly':speed<.15?'Idle':speed>2.8?'Run':'Walk';
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
  dispose():void {this.fragments.dispose();this.lasers.dispose();for(const l of this.chargeLights)l.dispose();this.elemental.dispose();this.burning.clear();this.ragdolls.clear();this.tactical?.dispose();this.debris.clear();this.disposed=true;this.scheduler.clear();this.effects.clear();for(const a of this.actors){this.world.collision.playerBodies.delete(a.id);const i=this.world.targets.indexOf(a.target);if(i>=0)this.world.targets.splice(i,1);for(const clip of a.clips.values())clip.dispose();a.root.dispose();}for(const container of this.containers.values())container.dispose();this.actors.length=0;this.byId.clear();this.tick.clear();this.separationBuckets.clear();this.separationPool.length=0;this.nearestSlots.length=0;this.shadowCasters.length=0;this.chargeLightTargets.length=0;}
}










