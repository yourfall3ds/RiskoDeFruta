import {chooseSpawnAround} from '../ai/SpawnPlanner';
import {EnemyLaser} from '../vfx/EnemyLaser';
import {aimArmAt} from '../animation/AimArm';
import {PointLight} from '@babylonjs/core/Lights/pointLight';
import {ElementalEffects} from '../vfx/ElementalEffects';
import {BurningStatus} from '../combat/BurningStatus';
import {enemyImpact} from '../enemies/EnemyImpact';
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
import { ENEMIES,MonsterDirector,type DirectorMode,type EnemyKind } from '../run/MonsterDirector';
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
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { ENEMY_AFFIXES,chooseVariant,type EnemyVariant } from '../enemies/EnemyAffixes';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { PopulationBudget } from '../run/PopulationBudget';
import { PosePalette } from '../animation/PosePalette';
import { FruitFragments } from '../vfx/FruitFragments';
import { HordeTickCache } from './HordeTickCache';

type State='spawn'|'chase'|'windup'|'recover'|'dead';
interface Actor {id:number;kind:EnemyKind;variant:EnemyVariant;scale:number;push:Vector3;root:TransformNode;body:Mesh;visual:TransformNode;clips:Map<string,AnimationGroup>;machine:AnimationStateMachine;skeleton:Skeleton|undefined;laserSocket?:TransformNode;laserArm?:TransformNode;ragdoll:ReturnType<RagdollWorld['create']>;healthTrail:number;gait:number;lastPosePosition:Vector3;palette:PosePalette;health:Health;target:TrainingTarget;state:State;time:number;attack:number;locked:Vec3;direction:{x:number;z:number};burn:number;burnClock:number;anim:number;hit:number;stagger:number;staggerCooldown:number;deathVelocity:Vector3;active:boolean;cooldown:number}
const distance=(a:Vec3,b:Vec3)=>Math.hypot(a.x-b.x,a.z-b.z);
const distanceSquared=(a:Vec3,b:Vec3)=>{const dx=a.x-b.x,dz=a.z-b.z;return dx*dx+dz*dz;};
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
  constructor(private readonly scene:Scene,private readonly world:{targets:TrainingTarget[];collision:CollisionWorld},private readonly events:EventBus<GameEvents>,private readonly shadows:ShadowGenerator,private readonly player:PlayerMotor,private readonly progression:RunProgression,private readonly rng:RunRNG,readonly mode:DirectorMode='classic'){this.fragments=new FruitFragments(scene,world.collision);this.debris=new CorpseDebris(world.collision);this.procs=new ItemProcs(progression,rng.stream('procs'));this.director=new MonsterDirector(rng.stream('director'),progression.stage,50,mode);this.effects=new CombatPresentation(scene);this.lasers=new EnemyLaser(scene);this.elemental=new ElementalEffects(scene,world.collision);for(let i=0;i<2;i++){const light=new PointLight('tomato-incendiary-charge-'+i,Vector3.Zero(),scene);light.diffuse=new Color3(1,.23,.025);light.range=4;light.intensity=0;this.chargeLights.push(light);}}
  async load(loader:(model:string)=>Promise<AssetContainer>=model=>LoadAssetContainerAsync(`/models/${model}.glb`,this.scene)):Promise<void>{try{for(const model of new Set(Object.values(ENEMIES).map(x=>x.model))){if(this.disposed)return;const container=await loader(model);if(this.disposed){container.dispose();return;}this.containers.set(model,container);}this.ready=true;}catch(error){if(!this.disposed)this.error=String(error);}}
  async prepareNavigation():Promise<void>{try{const tactical=await TacticalNavigation.create(this.world.collision,true);if(this.disposed){tactical.dispose();return;}this.tactical=tactical;this.navigationReady=true;}catch(error){this.error=String(error);}}
  initialize():void {if(this.tactical||this.navigation)return;this.navigation=new FarmNavigation(this.world.collision);this.navigation.update(this.player.position);}
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
      const d=distanceSquared(a.root.position,this.player.position);
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
      const d=distanceSquared(a.root.position,this.player.position);
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
  updateCameraVisibility(camera:Vec3,dt:number):void {for(const a of this.actors){if(!a.active)continue;const d=Math.hypot(a.root.position.x-camera.x,a.root.position.z-camera.z);const desired=d<ENEMIES[a.kind].radius*ENEMY_AFFIXES[a.variant].scale+.9?0:1;for(const mesh of a.target.meshes??[a.body])mesh.visibility=Math.abs(desired-mesh.visibility)<.01?desired:mesh.visibility+(desired-mesh.visibility)*Math.min(1,dt*14);}}
  private spawnPosition(min?:number,max?:number):Vec3|undefined {return chooseSpawnAround(this.player.position,this.rng.stream('spawn'),this.world.collision,p=>Boolean(this.tactical?this.tactical.reachable(p,this.player.position):this.navigation?.reachable(p)),p=>this.actors.some(a=>a.active&&!a.health.dead&&distance(p,a.root.position)<2),min,max);}
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
    if(distance(boss.root.position,this.player.position)>110)return false;
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
    this.tactical?.remove(boss.id);this.tactical?.add(boss.id,at,ENEMIES.boss.radius*ENEMY_AFFIXES[boss.variant].scale,ENEMIES.boss.speed);
    this.effects.burst(at,'soil',3);this.audio?.enemy('spawn','boss',distance(at,this.player.position));
    return true;
  }
  spawn(kind:EnemyKind,position?:Vec3,variant:EnemyVariant=kind==='boss'?'normal':chooseVariant(this.rng.stream('elite').next(),this.director.time)):boolean {
    if(kind==='boss'&&this.boss&&!this.boss.health.dead)return true;
    if(!this.ready||(this.count>=this.populationCap&&kind!=='boss'))return false;const at=position??this.spawnPosition();if(!at)return false;
    if(this.count>=this.populationCap){const retired=this.farthestRetirable(0);if(!retired)return false;this.director.retireLivingEnemy();retired.active=false;this.scheduler.remove(retired.id);this.tactical?.remove(retired.id);retired.root.setEnabled(false);for(const mesh of retired.target.meshes??[retired.body])mesh.isPickable=false;}
    const definition=ENEMIES[kind],affix=ENEMY_AFFIXES[variant];let actor=this.actors.find(a=>!a.active&&a.kind===kind);
    if(!actor){const container=this.containers.get(definition.model);if(!container)return false;const instance=container.instantiateModelsToScene(n=>`enemy-${this.nextId}-${n}`,false,{doNotInstantiate:true});const root=new TransformNode(`enemy-${this.nextId}`,this.scene),visual=new TransformNode(`enemy-visual-${this.nextId}`,this.scene);visual.parent=root;for(const node of instance.rootNodes)node.parent=visual;
      const meshes=visual.getChildMeshes();const body=meshes.filter(x=>x.getTotalVertices()>0).sort((a,b)=>b.getTotalVertices()-a.getTotalVertices())[0] as Mesh|undefined;if(!body){root.dispose();return false;}
      for(const mesh of meshes){mesh.isPickable=mesh.getTotalVertices()>0;mesh.receiveShadows=true;}body.isPickable=true;
      const id=this.nextId++,health=new Health(id,definition.hp*(1+(this.progression.stage-1)*.35),this.events);const target:TrainingTarget={id,mesh:body,hits:0};const clips=new Map<string,AnimationGroup>();for(const clip of instance.animationGroups){clip.stop();for(const name of ['Spawn','Walk','Run','Idle','Hit','Death','Attack','Cast','Fly','Spit','Bite','Roll'])if(clip.name.endsWith(name))clips.set(name,clip);}
      target.meshes=meshes.filter(mesh=>mesh.getTotalVertices()>0) as Mesh[];
      actor={id,kind,variant,scale:definition.scale,push:Vector3.Zero(),root,visual,body,health,target,clips,machine:new AnimationStateMachine(clips),skeleton:instance.skeletons[0],ragdoll:undefined,healthTrail:health.maximum,gait:0,lastPosePosition:Vector3.FromArray([at.x,at.y,at.z]),palette:new PosePalette(instance.skeletons),state:'spawn',time:0,attack:0,locked:{...at},direction:{x:0,z:0},burn:0,burnClock:0,anim:0,hit:0,stagger:0,staggerCooldown:0,deathVelocity:Vector3.Zero(),active:true,cooldown:0};const captured=actor;target.onHit=context=>this.hit(captured,context);if(kind==='carrot'){const nodes=visual.getChildTransformNodes(),hand=nodes.find(n=>n.name.endsWith('RightHand')),arm=nodes.find(n=>n.name.endsWith('RightArm'));if(hand&&arm){const socket=new TransformNode('carrot-right-palm-muzzle',this.scene);socket.parent=hand;socket.position.set(0,6,0);socket.rotationQuaternion=Quaternion.FromUnitVectorsToRef(Vector3.Forward(),Vector3.Up(),Quaternion.Identity());actor.laserSocket=socket;actor.laserArm=arm;}}this.actors.push(actor);this.byId.set(actor.id,actor);this.world.targets.push(target);
    }
    this.ragdolls.release(actor.ragdoll);actor.ragdoll=undefined;actor.machine.reset();actor.gait=0;actor.lastPosePosition.set(at.x,at.y,at.z);
    actor.variant=variant;actor.scale=definition.scale*affix.scale;actor.push.setAll(0);actor.active=true;actor.health=new Health(actor.id,definition.hp*affix.health*(1+(this.progression.stage-1)*.35)*this.director.healthMultiplier,this.events);actor.healthTrail=actor.health.maximum;actor.state='spawn';actor.time=0;actor.burn=0;actor.hit=0;actor.stagger=0;actor.staggerCooldown=0;actor.cooldown=1;actor.direction={x:0,z:0};actor.attack=0;actor.root.position.set(at.x,at.y,at.z);actor.root.rotation.set(0,Math.atan2(this.player.position.x-at.x,this.player.position.z-at.z),0);actor.root.scaling.setAll(actor.scale);actor.visual.rotationQuaternion=null;actor.visual.rotation.set(0,0,0);actor.visual.position.set(0,-1,0);actor.body.isPickable=true;actor.root.setEnabled(true);
    for(const mesh of actor.target.meshes??[actor.body]){
      mesh.isPickable=true;mesh.setEnabled(true);
      if(mesh.material instanceof PBRMaterial){const baseName=mesh.material.name.split('::elite::')[0]!,baseKey=definition.model+':'+baseName;if(!this.eliteMaterials.has(baseKey))this.eliteMaterials.set(baseKey,mesh.material);const original=this.eliteMaterials.get(baseKey)!;original.maxSimultaneousLights=2;
        if(variant==='normal')mesh.material=original;else{const key=baseKey+variant;let material=this.eliteMaterials.get(key);if(!material){material=original.clone(baseName+'::elite::'+variant);const tint=Color3.FromHexString(affix.color);material.albedoColor=original.albedoColor.multiply(tint.scale(.45).add(new Color3(.55,.55,.55)));material.emissiveColor=tint.scale(variant==='charged'?.65:.14);this.eliteMaterials.set(key,material);}mesh.material=material;}
      }
    }
    this.world.collision.playerBodies.set(actor.id,{id:actor.id,position:actor.root.position,radius:definition.radius*affix.scale,height:actor.kind==='watermelon'?1.6:2,active:()=>actor!.active&&!actor!.health.dead&&actor!.kind!=='tomato'&&actor!.state!=='spawn'});
    this.tactical?.add(actor.id,at,definition.radius*affix.scale,definition.speed*affix.speed);this.audio?.enemy('spawn',kind,distance(at,this.player.position));
    const scheduled=actor;this.scheduler.add({id:actor.id,distance:()=>distance(scheduled.root.position,this.player.position),update:dt=>{if(scheduled.active&&!scheduled.health.dead)this.think(scheduled,dt);}});
    this.effects.burst(at,'soil',kind==='boss'?3:1);if(kind==='boss'){this.boss=actor;this.events.emit('BossSpawned',{entityId:actor.id,definitionId:'boss_fruit_abomination_01'});}return true;
  }
  private damageContext(id:number,damage:number,position:Vec3,source:string):DamageContext{const actor=this.byId.get(id),from=actor?.root.position??position,dx=this.player.position.x-from.x,dz=this.player.position.z-from.z,length=Math.hypot(dx,dz)||1,multiplier=actor?ENEMY_AFFIXES[actor.variant].damage:1;return{attackerId:id,victimId:1,sourceId:source,attackId:source,baseDamage:damage,finalDamage:damage*multiplier*(1+.15*(this.progression.stage-1))*this.director.damageMultiplier,crit:false,procCoefficient:0,procChainDepth:0,damageTags:['enemy'],hitPosition:{x:position.x,y:position.y,z:position.z},hitNormal:{x:0,y:1,z:0},forceDirection:{x:dx/length,y:0,z:dz/length},forceMagnitude:3*multiplier};}
  private hit(a:Actor,context:DamageContext):void {
    if(!a.active||a.health.dead)return;const stats=this.progression.stats,crit=context.procChainDepth===0&&this.rng.stream('run').next()<stats.crit;
    const rawDamage=context.procChainDepth>0?context.finalDamage:context.baseDamage*stats.damage*(context.damageTags.includes('skill')?stats.mp:1)*(crit?2:1);const finalDamage=rawDamage*100/(100+ENEMY_AFFIXES[a.variant].armor);const applied={...context,finalDamage,crit:context.crit||crit};
    if(!a.health.apply(applied))return;a.hit=.10;const {force,stagger}=enemyImpact(context,a.variant,a.kind,a.staggerCooldown);
    if(force>.5)a.push.set(context.forceDirection.x*force,0,context.forceDirection.z*force);
    if(stagger){a.stagger=.18;a.staggerCooldown=.85;if(a.state==='windup'){a.state='chase';a.time=0;a.cooldown=.4;}}
    this.audio?.enemy('hit',a.kind,distance(a.root.position,this.player.position));this.labels.push({position:{x:a.root.position.x,y:a.root.position.y+1.8,z:a.root.position.z},amount:Math.round(finalDamage),crit:applied.crit,time:.7});if(this.labels.length>32)this.labels.shift();
    this.procs.onHit(context,{burn:seconds=>{a.burn=seconds;a.burnClock=0;this.effects.burst(a.root.position,'seed');},blast:radius=>{this.effects.burst(a.root.position,'seed',2);for(const other of this.actors)if(other!==a&&other.active&&!other.health.dead&&distance(other.root.position,a.root.position)<radius)this.hit(other,{...applied,victimId:other.id,baseDamage:finalDamage*.5,finalDamage:finalDamage*.5,procChainDepth:1,sourceProcId:'bomb'});}});
    if(a.health.dead){this.lastKill={position:{x:a.root.position.x,y:a.root.position.y,z:a.root.position.z},kind:a.kind,age:0};this.scheduler.remove(a.id);a.state='dead';a.time=0;this.tactical?.remove(a.id);a.palette.sync();a.ragdoll=this.ragdolls.create(a.skeleton,a.body,applied,a.scale);this.audio?.enemy('death',a.kind,distance(a.root.position,this.player.position));a.body.isPickable=false;a.deathVelocity.set(context.forceDirection.x*3,3,context.forceDirection.z*3);this.kills++;this.progression.reward(a.kind==='boss',ENEMY_AFFIXES[a.variant].gold);const heal=this.procs.onKill();this.player.hp=Math.min(this.player.maxHP,this.player.hp+heal);this.effects.burst(a.root.position,heal?'energy':'juice',a.kind==='boss'?4:1.2);this.fragments.burst(a.kind,a.root.position,context.forceDirection,a.body,a.kind==='boss'?1.6:1);
      for(const mesh of a.target.meshes??[a.body])mesh.isPickable=false;
      if(context.attackerId===1&&!context.damageTags.some(tag=>tag==='qa'||tag==='debug')&&!/^(qa|debug)/i.test(context.sourceId))
        this.events.emit('FruitHarvested',{sequence:++this.harvestSequence,entityId:a.id,kind:a.kind,position:{x:a.root.position.x,y:a.root.position.y+1,z:a.root.position.z}});
      if(a.kind==='boss'){this.debris.fracture(a.target.meshes??[a.body],a.body);for(const corpse of this.actors)if(corpse!==a&&corpse.active&&corpse.health.dead&&distance(corpse.root.position,a.root.position)<12){corpse.deathVelocity.x+=(corpse.root.position.x-a.root.position.x)*.8;corpse.deathVelocity.z+=(corpse.root.position.z-a.root.position.z)*.8;corpse.deathVelocity.y=5;}this.director.bossKilled();this.bossDeadTime=this.mode==='classic'?0:-1;this.events.emit('BossKilled',applied);this.events.emit('StageCompleted',{stageId:String(this.progression.stage)});}
    }
  }
  /** Monta a fila de ataque e a contagem de `windup` uma única vez, antes de qualquer pensamento do tique. */
  private buildTickCache():void {
    this.tick.begin();
    const p=this.player.position;
    for(const a of this.actors)if(a.active&&!a.health.dead)
      this.tick.add(a.id,Boolean(ENEMY_BEHAVIORS[a.kind].ranged),distanceSquared(a.root.position,p),a.state==='windup');
    this.tick.finish();
  }
  private think(a:Actor,dt:number):void {
    if(a.state!=='chase'||a.push.lengthSquared()>.25)return;const p=this.player.position,d=distance(a.root.position,p),def=ENEMIES[a.kind];a.direction=this.navigation?.direction(a.root.position,p)??{x:0,z:0};
    const behavior=ENEMY_BEHAVIORS[a.kind],ranged=Boolean(behavior.ranged);
    if(this.tactical)this.tactical.target(a.id,p,this.tick.rank(a.id),ranged,def.speed*ENEMY_AFFIXES[a.variant].speed);
    if(behavior.ranged){if(d<def.range*.55){a.direction.x*=-1;a.direction.z*=-1;}else if(d<def.range)a.direction={x:0,z:0};}
    if(behavior.zigzag&&d>2&&d<10){const angle=Math.sin(this.director.time*3+a.id)*.65;const x=a.direction.x;a.direction.x=x*Math.cos(angle)-a.direction.z*Math.sin(angle);a.direction.z=x*Math.sin(angle)+a.direction.z*Math.cos(angle);}
    a.cooldown=Math.max(0,a.cooldown-dt);
    // Alcance, altura, recarga e lotação são testes aritméticos; a varredura de linha de visão é a cara
    // do conjunto e agora só roda para quem já passou por todos eles — o `&&` avalia na ordem escrita.
    if(!(d<=def.range&&Math.abs(p.y-a.root.position.y)<3&&a.cooldown===0&&this.tick.windups(ranged)<(ranged?4:3)))return;
    if(this.world.collision.sweepSphere({x:a.root.position.x,y:a.root.position.y+1.1,z:a.root.position.z},{x:p.x-a.root.position.x,y:p.y-a.root.position.y,z:p.z-a.root.position.z},.05))return;
    a.state='windup';a.time=0;this.tick.noteWindup(ranged);this.tactical?.velocity(a.id,{x:0,y:0,z:0},0);this.audio?.enemy('windup',a.kind,d);a.locked={...p};a.attack++;a.direction={x:0,z:0};this.telegraph(a,behavior.telegraph(a),behavior.windup);
  }
  private groundLevel(x:number,z:number,fallback:number):number {const y=this.world.collision.groundAt(x,z,fallback+.5);return Number.isFinite(y)?y:fallback;}
  /**
   * Um windup desenha só a forma do ataque que vai sair: nada de anel genérico de área.
   * Investida usa o impulso comprometido inteiro com a largura de contato real, laser usa a linha
   * real do feixe (parada na parede) e círculo só aparece onde existe zona de dano de verdade.
   */
  private telegraph(a:Actor,plan:TelegraphPlan,seconds:number):void {
    if(plan.shape==='none')return;
    const from=a.root.position,dx=a.locked.x-from.x,dz=a.locked.z-from.z,span=Math.hypot(dx,dz)||1;
    if(plan.shape==='circle'){this.effects.warning({x:a.locked.x,y:this.groundLevel(a.locked.x,a.locked.z,a.locked.y),z:a.locked.z},plan.radius,seconds,0,a.id,plan.kind);return;}
    if(plan.shape==='cone'){this.effects.cone(from,a.locked,plan.radius,seconds,a.id);return;}
    if(plan.shape==='beam'){const path=this.laserPath(a);this.effects.line({x:path.from.x,y:from.y,z:path.from.z},{x:path.to.x,y:this.groundLevel(path.to.x,path.to.z,from.y),z:path.to.z},plan.width,seconds,a.id);return;}
    const heading={x:dx/span,z:dz/span};
    const reach=plan.shape==='band'?this.rushReach(a,heading,plan.reach):plan.length,x=from.x+heading.x*reach,z=from.z+heading.z*reach;
    this.effects.line(from,{x,y:this.groundLevel(x,z,from.y),z},plan.width,seconds,a.id,plan.shape==='aim'?'aim':'band');
  }
  /**
   * A investida não para no alvo inicial: quem recua ou desvia continua dentro do trajeto, porque
   * o impulso do `recover` segue até acabar (velocidade × duração) ou até bater em parede.
   * O corte usa o mesmo `move` do deslocamento real — raio do corpo, altura 1.8 e degrau .8 — e
   * mede quanto do impulso sobrou projetado na direção travada.
   */
  private rushReach(a:Actor,heading:{x:number;z:number},reach:number):number {
    const start=a.root.position,radius=ENEMIES[a.kind].radius*ENEMY_AFFIXES[a.variant].scale,probe={x:start.x,y:start.y,z:start.z};
    this.world.collision.move(probe,heading.x*reach,heading.z*reach,radius,1.8,.8);
    return Math.max(0,Math.min(reach,(probe.x-start.x)*heading.x+(probe.z-start.z)*heading.z));
  }
  private laserPath(a:Actor):{from:Vector3;to:Vector3}{const from=a.laserSocket?.getAbsolutePosition().clone()??a.root.position.add(new Vector3(0,1.3,0)),direction=new Vector3(a.locked.x,a.locked.y+.9,a.locked.z).subtract(from).normalize(),delta=direction.scale(24),wall=this.world.collision.sweepSphere(from,delta,.04);return{from,to:from.add(delta.scale(wall?Math.max(0,wall.time):1))};}
  private fireLaser(a:Actor,damage:number):void{const {from,to}=this.laserPath(a),delta=to.subtract(from),target=new Vector3(this.player.position.x,this.player.position.y+.9,this.player.position.z),t=Vector3.Dot(target.subtract(from),delta)/Math.max(.0001,delta.lengthSquared());if(t>=0&&t<=1&&Vector3.DistanceSquared(from.add(delta.scale(t)),target)<.5*.5)this.player.applyDamage({...this.damageContext(a.id,damage,target,'carrot_hand_laser'),damageTags:['enemy','laser'],forceMagnitude:2});this.elemental.emit('electricity',to,.5);}
  private attack(a:Actor):void {
    this.audio?.enemy('attack',a.kind,distance(a.root.position,this.player.position));
    if(a.variant==='charged'&&a.attack%2===0){this.effects.warning(a.locked,2.1,.7,15,a.id,'root');}
    let nearby=0;for(const other of this.actors)if(other.active&&other!==a&&distanceSquared(other.root.position,a.root.position)<16)nearby++;
    ENEMY_BEHAVIORS[a.kind].perform({actor:a,player:this.player.position,effects:this.effects,laser:damage=>this.fireLaser(a,damage),spawn:(kind,p)=>this.spawn(kind,p),nearby,hurt:(damage,source,knockback=0)=>{const hp=this.player.hp;this.player.applyDamage(this.damageContext(a.id,damage,this.player.position,source));if(this.player.hp<hp&&knockback){const d=distance(a.root.position,this.player.position)||1;this.player.velocity.x+=(this.player.position.x-a.root.position.x)/d*knockback;this.player.velocity.z+=(this.player.position.z-a.root.position.z)/d*knockback;}}});
  }
  /**
   * Separação local (só no caminho sem Detour): mesma grade de 3 m e o mesmo teto de 8 pares por ator
   * de antes. O que mudou é o custo de montagem — chave numérica em vez de `template string`, e
   * `Map` + listas reaproveitados entre tiques em vez de recriados a cada passo fixo.
   */
  private static bucketKey(x:number,z:number):number{return Math.floor(x/3)*1048576+Math.floor(z/3);}
  private separate(dt:number):void {
    const buckets=this.separationBuckets,pool=this.separationPool;
    for(const list of buckets.values()){list.length=0;pool.push(list);}
    buckets.clear();
    for(const a of this.actors)if(a.active&&!a.health.dead){
      const key=EnemySwarm.bucketKey(a.root.position.x,a.root.position.z);
      let list=buckets.get(key);
      if(!list){list=pool.pop()??[];buckets.set(key,list);}
      list.push(a);
    }
    for(const a of this.actors)if(a.active&&a.state==='chase'){
      const x=Math.floor(a.root.position.x/3),z=Math.floor(a.root.position.z/3);let remainingPairs=8;
      neighbors:for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++){
        const list=buckets.get((x+dx)*1048576+(z+dz));if(!list)continue;
        for(const b of list){
          if(a.id>=b.id)continue;
          if(--remainingPairs<0)break neighbors;
          const d=distance(a.root.position,b.root.position),min=ENEMIES[a.kind].radius+ENEMIES[b.kind].radius;
          if(d>.01&&d<min){const push=(min-d)*dt*2,px=(a.root.position.x-b.root.position.x)/d*push,pz=(a.root.position.z-b.root.position.z)/d*push;
            this.world.collision.move(a.root.position,px,pz,.4,1.8,.8);this.world.collision.move(b.root.position,-px,-pz,.4,1.8,.8);}
        }
      }
    }
  }
  fixedUpdate(dt:number):void {
    if(this.lastKill)this.lastKill.age+=dt;
    if(!this.ready||this.player.hp<=0)return;this.burning.update(dt,(owner,amount)=>{this.player.applyDamage({...this.damageContext(owner,amount,this.player.position,'incendiary_burn'),forceMagnitude:0,damageTags:['enemy','fire','dot']});});this.initialize();this.navigation?.update(this.player.position);this.buildTickCache();this.scheduler.update(dt);this.tactical?.step(dt,this.player.position);this.director.update(dt,this.kills,this.count,kind=>this.spawn(kind),this.populationCap);if(this.bossDeadTime>=0)this.bossDeadTime+=dt;
    for(const a of this.actors){if(!a.active)continue;a.time+=dt;a.hit=Math.max(0,a.hit-dt);a.stagger=Math.max(0,a.stagger-dt);a.staggerCooldown=Math.max(0,a.staggerCooldown-dt);
      if(a.state==='dead'&&a.ragdoll){if(a.time>7){this.ragdolls.release(a.ragdoll);a.active=false;a.root.setEnabled(false);}continue;}
      if(a.state==='dead'){a.deathVelocity.y-=12*dt;a.root.position.addInPlace(a.deathVelocity.scale(dt));const ground=this.world.collision.groundAt(a.root.position.x,a.root.position.z,6);if(a.root.position.y<ground){a.root.position.y=ground;a.deathVelocity.scaleInPlace(.7);a.deathVelocity.y=0;}a.visual.rotation.z=Math.min(1.45,a.time*2.5);if(a.time>7){a.active=false;a.root.setEnabled(false);}continue;}
      if(a.burn>0){a.burn-=dt;a.burnClock-=dt;if(a.burnClock<=0){a.burnClock=.5;this.effects.burst(a.root.position,'seed',.35);this.hit(a,{...this.damageContext(1,5,a.root.position,'burn'),victimId:a.id,procChainDepth:1,sourceProcId:'burn'});}if(a.health.dead)continue;}
      if(a.state==='spawn'){this.tactical?.velocity(a.id,{x:0,y:0,z:0},0);const duration=a.kind==='carrot'?1.15:a.kind==='watermelon'?1.8:a.kind==='tomato'?1.6:1.5,t=Math.min(1,a.time/duration),ease=t*t*(3-2*t),depth=a.kind==='watermelon'?1.4:2;a.visual.position.y=-depth*(1-ease)+(a.kind==='tomato'?2*ease:a.kind==='carrot'?.18*Math.sin(t*Math.PI):0);if(a.time>=duration){a.state='chase';a.time=0;}continue;}
      const behavior=ENEMY_BEHAVIORS[a.kind];
      // Quem persegue cai no bloco do Detour lá embaixo, que refaz exatamente esta sincronização.
      // Repeti-la aqui custava um segundo `position()` + `groundAt` por ator por frame, sem efeito.
      if(this.tactical&&(a.state!=='chase'||a.push.lengthSquared()>.25)){const p=this.tactical.position(a.id);if(p){const ground=this.world.collision.groundAt(p.x,p.z,p.y+.55);a.root.position.set(p.x,Number.isFinite(ground)?ground:p.y,p.z);}}
      if(a.push.lengthSquared()>.25){if(this.tactical)this.tactical.velocity(a.id,a.push,a.push.length());else this.world.collision.move(a.root.position,a.push.x*dt,a.push.z*dt,ENEMIES[a.kind].radius,1.8,.5);a.push.scaleInPlace(Math.exp(-dt*8));continue;}
      if(a.state==='windup'){const yaw=Math.atan2(this.player.position.x-a.root.position.x,this.player.position.z-a.root.position.z);a.root.rotation.y+=Math.atan2(Math.sin(yaw-a.root.rotation.y),Math.cos(yaw-a.root.rotation.y))*Math.min(1,dt*10);if(a.time>=behavior.windup){this.attack(a);a.state='recover';a.time=0;}continue;}
      let speed=ENEMIES[a.kind].speed*ENEMY_AFFIXES[a.variant].speed;if(a.state==='recover'){speed=behavior.recoverySpeed(a);if(speed&&distance(a.root.position,this.player.position)<ENEMIES[a.kind].radius+.55){this.player.applyDamage({...this.damageContext(a.id,behavior.contactDamage,this.player.position,a.kind+'_rush'),forceMagnitude:a.kind==='eggplant'?10:6});a.direction={x:0,z:0};}if(a.time>1.15){a.state='chase';a.time=0;a.cooldown=a.kind==='boss'?1.7:1.5+(a.id%5)*.17;}}
      if(this.tactical){if(a.state==='recover')this.tactical.velocity(a.id,{x:a.direction.x*speed,y:0,z:a.direction.z*speed},speed,speed>0);const p=this.tactical.position(a.id),v=this.tactical.motion(a.id);if(p){const ground=this.world.collision.groundAt(p.x,p.z,p.y+.55);a.root.position.set(p.x,Number.isFinite(ground)?ground:p.y,p.z);}if(v&&Math.hypot(v.x,v.z)>.15){const yaw=Math.atan2(v.x,v.z);a.root.rotation.y+=Math.atan2(Math.sin(yaw-a.root.rotation.y),Math.cos(yaw-a.root.rotation.y))*Math.min(1,dt*9);}continue;}
      const before=a.root.position.clone();this.world.collision.move(a.root.position,a.direction.x*speed*dt,a.direction.z*speed*dt,ENEMIES[a.kind].radius,1.8,.8);const ground=this.world.collision.groundAt(a.root.position.x,a.root.position.z,a.root.position.y+.85);if(Number.isFinite(ground))a.root.position.y=ground;else a.root.position.copyFrom(before);
      if(a.direction.x||a.direction.z){const yaw=Math.atan2(a.direction.x,a.direction.z);a.root.rotation.y+=Math.atan2(Math.sin(yaw-a.root.rotation.y),Math.cos(yaw-a.root.rotation.y))*Math.min(1,dt*10);}
    }
    if(!this.tactical)this.separate(dt);
    for(const w of this.effects.warnings)if(w.active){
      w.remaining-=dt;if(w.remaining>0)continue;
      const {position,radius,kind,pulses,damage,owner}=w;w.active=false;w.mesh.setEnabled(false);
      if(!damage)continue;
      if(kind==='root')this.effects.eruption(position,radius);
      if(!kind.startsWith('fire'))this.effects.burst(position,kind.startsWith('acid')?'energy':'seed',radius*.5);
      if(distance(position,this.player.position)<radius+.25&&Math.abs(position.y-this.player.position.y)<2.1){const before=this.player.hp;this.player.applyDamage(this.damageContext(owner,damage,position,kind));if(kind.startsWith('fire')&&this.player.hp<before)this.burning.ignite(owner,1.2);}
      if(pulses>0){const pool=this.effects.warning(position,radius,.6,kind.includes('pool')?damage:damage*.18,owner,kind.startsWith('acid')?'acid-pool':'fire-pool');if(pool)pool.pulses=pulses-1;}
    }
    for(const p of this.effects.projectiles)if(p.active){
      if(p.delay>0){p.delay-=dt;if(p.delay<=0)p.mesh.setEnabled(true);continue;}
      const previous=p.position.clone();p.remaining-=dt;p.velocity.y-=p.gravity*dt;p.position.addInPlace(p.velocity.scale(dt));p.mesh.position.copyFrom(p.position);
      const playerTarget=new Vector3(this.player.position.x,this.player.position.y+.9,this.player.position.z),segment=p.position.subtract(previous),length=segment.lengthSquared();
      const along=length?Math.max(0,Math.min(1,Vector3.Dot(playerTarget.subtract(previous),segment)/length)):0;
      const hit=Vector3.DistanceSquared(previous.add(segment.scale(along)),playerTarget)<.65*.65;
      const ground=this.world.collision.groundAt(p.position.x,p.position.z,6),wall=this.world.collision.sweepSphere(previous,segment,.15);
      if(!(hit||wall||p.position.y<ground||p.remaining<=0))continue;
      p.active=false;p.mesh.setEnabled(false);if(p.impact?.zone==='fire'){this.elemental.emit('explosion',p.position,.85);this.audio?.impact(true);}else this.effects.burst(p.position,'seed',p.impact?1:.3);
      if(hit&&p.damage){const before=this.player.hp;this.player.applyDamage(this.damageContext(p.owner,p.damage,p.position,p.impact?.zone==='fire'?'incendiary_projectile':'seed_projectile'));if(p.impact?.zone==='fire'&&this.player.hp<before)this.burning.ignite(p.owner);}
      if(p.impact&&Number.isFinite(ground)){const impact={x:p.position.x,y:ground,z:p.position.z};if(p.impact.zone)this.effects.warning(impact,p.impact.zone==='acid'?4:2.3,.12,p.damage||18,p.owner,p.impact.zone);if(p.impact.summon&&(this.tactical?this.tactical.reachable(impact,this.player.position):this.navigation?.reachable(impact)))this.spawn(p.impact.summon,impact);}
    }
  }
  update(dt:number):void {
    this.lasers.begin();this.presentationTime+=dt;this.elemental.update(dt);this.flameClock-=dt;if(this.flameClock<=0&&dt>0){this.flameClock=.11;for(const p of this.effects.projectiles)if(p.active&&p.delay<=0&&p.impact?.zone==='fire')this.elemental.emit('fire',p.position,.65);let fields=0;for(const w of this.effects.warnings)if(w.active&&w.kind.startsWith('fire')&&fields++<3){for(let i=0;i<2;i++){const a=this.presentationTime+i*3.14;this.elemental.emit('fire',new Vector3(w.position.x+Math.sin(a)*w.radius*.4,w.position.y+.06,w.position.z+Math.cos(a)*w.radius*.4),.8);}}}
    this.elemental.aura('fire',this.burning.remaining>0?[new Vector3(this.player.position.x,this.player.position.y+.6,this.player.position.z)]:[],this.presentationTime,this.burning.remaining>0?.65:0);
    const lights=this.chargeLights.length,charging=this.nearest(lights,Number.POSITIVE_INFINITY,this.isChargingTomato);
    for(let i=0;i<lights;i++){
      const light=this.chargeLights[i]!,actor=charging[i]!.actor;
      light.intensity=actor?Math.pow(Math.min(1,actor.time/ENEMY_BEHAVIORS.tomato.windup),2)*3:0;
      if(!actor)continue;
      light.position.copyFrom(actor.root.position).addInPlaceFromFloats(0,3,0);
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
      const d=distance(a.root.position,this.player.position);a.anim+=dt;if(d>=24&&a.anim<(d<45?1/30:1/15))continue;
      const elapsed=a.anim;a.anim=0;const moved=distance(a.root.position,a.lastPosePosition);a.lastPosePosition.copyFrom(a.root.position);
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
      if(a.kind==='carrot'&&(a.state==='windup'||a.state==='recover'&&a.time<.4)){if(a.laserArm&&a.laserSocket){const direction=new Vector3(a.locked.x,a.locked.y+.9,a.locked.z).subtract(a.laserSocket.getAbsolutePosition()).normalize();aimArmAt(a.laserArm,a.laserSocket,direction);}const path=this.laserPath(a);this.lasers.show(path.from,path.to,a.state==='windup'?.09+.10*a.time:1-a.time/.4);}
      a.palette.sync();a.root.computeWorldMatrix(true);
    }
  }
  dispose():void {this.fragments.dispose();this.lasers.dispose();for(const l of this.chargeLights)l.dispose();this.elemental.dispose();this.burning.clear();this.ragdolls.clear();this.tactical?.dispose();this.debris.clear();this.disposed=true;this.scheduler.clear();this.effects.clear();for(const a of this.actors){this.world.collision.playerBodies.delete(a.id);const i=this.world.targets.indexOf(a.target);if(i>=0)this.world.targets.splice(i,1);for(const clip of a.clips.values())clip.dispose();a.root.dispose();}for(const container of this.containers.values())container.dispose();this.actors.length=0;this.byId.clear();this.tick.clear();this.separationBuckets.clear();this.separationPool.length=0;this.nearestSlots.length=0;this.shadowCasters.length=0;this.chargeLightTargets.length=0;}
}










