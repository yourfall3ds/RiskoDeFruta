import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {chooseSpawnAround} from '../src/ai/SpawnPlanner';
import {AIScheduler} from '../src/ai/AIScheduler';
import {Health} from '../src/combat/Health';
import {BurningStatus} from '../src/combat/BurningStatus';
import {enemyImpact} from '../src/enemies/EnemyImpact';
import type {EventBus} from '../src/core/EventBus';
import type {DamageContext,GameEvents,Vec3} from '../src/core/contracts';
import type {RunRNG} from '../src/core/RunRNG';
import type {CollisionWorld} from '../src/physics/CollisionWorld';
import {ENEMIES,MonsterDirector,bossHealth,killBounty,isSaucerSpecies,type DirectorMode,type EnemyKind} from '../src/run/MonsterDirector';
import {ENEMY_AFFIXES,chooseVariant,type EnemyVariant} from '../src/enemies/EnemyAffixes';
import {ENEMY_BEHAVIORS,type TelegraphPlan} from '../src/enemies/EnemyBehaviors';
import {enemySpace,type EnemySpace,type EnemySurface,type Heading} from '../src/enemies/EnemySpace';
import {CombatField} from '../src/vfx/CombatField';
import {
  NO_TARGET,acquireTarget,invalidation,newTargetingState,noteThreat,
  type TargetPolicy,type TargetablePlayer,type TargetingState,
} from '../src/enemies/EnemyTargeting';

/**
 * A HORDA, SEM RENDERIZAÇÃO NENHUMA.
 *
 * Isto é a metade de GAMEPLAY do `EnemySwarm`: diretor, nascimento, aquisição de alvo, perseguição,
 * windup, ataque, dano, vida e morte. Nenhum `TransformNode`, nenhum material, nenhum clipe de
 * animação, nenhum ragdoll — a posição é um `Vec3` simples e a orientação é um `yaw` em radianos.
 *
 * Por que ela existe (contrato §1 e §9): enquanto o cliente decidia spawn e IA, cada cliente tinha
 * a própria horda privada — o mesmo alien atacava jogadores diferentes em telas diferentes, e dois
 * jogadores nunca matavam o mesmo inimigo. O dono passa a ser um só, aqui.
 *
 * **O alvo não é "o vivo mais próximo".** Ver `EnemyTargeting`: cada corpo tem `targetPlayerId`
 * próprio, adquirido por política do arquétipo (`STICKY_NEAREST` nos comuns), mantido enquanto for
 * válido e invalidado por condição explícita. "Mais próximo" é candidato inicial e fallback.
 *
 * Navegação: o servidor usa o deslocamento tangente direto com deslizamento em parede — o MESMO
 * ramo `!driven` que o `EnemySwarm` já executa quando não há agente do Detour. Recast é um índice
 * de apresentação/desempenho, não uma regra: fazer o servidor depender dele tornaria a autoridade
 * refém de uma carta de navegação que pode ainda estar assando.
 */

/** Política de alvo por espécie. Os comuns são grudentos; é isso que dá vida útil à perseguição. */
export const TARGET_POLICIES:Record<EnemyKind,TargetPolicy>={
  // Corpo a corpo comum: agarra um jogador e SEGURA. Sem isto a horda inteira pisca entre alvos.
  eggplant:'STICKY_NEAREST',
  watermelon:'STICKY_NEAREST',
  // Atiradores espalham por construção: quatro milhos mirando o mesmo alvo é uma execução, não uma
  // luta. O sorteio é do servidor (RNG de gameplay), nunca do cliente.
  corn:'RANDOM_LIVING',
  tomato:'RANDOM_LIVING',
  carrot:'STICKY_NEAREST',
  // A Praga Alfa vai atrás de quem mais a machucou: recompensa foco de fogo e pune o carrasco.
  boss:'THREAT',
  grey:'STICKY_NEAREST',
  invader:'STICKY_NEAREST',
  demon:'STICKY_NEAREST',
  predator:'STICKY_NEAREST',
  strutter:'RANDOM_LIVING',
  hound:'STICKY_NEAREST',
};

/** Segundos sem conseguir encostar no alvo antes de a rota ser declarada morta e o alvo, inválido. */
export const UNREACHABLE_SECONDS=12;
/** Distância além da qual o corpo é recolhido (a mesma coleira do cliente). */
export const STRAY_DISTANCE=72;

export type EnemyPhase='spawn'|'chase'|'windup'|'recover'|'flee'|'dead';

/** Um jogador, como a horda o enxerga. A simulação de jogadores continua sendo de quem é dela. */
export interface SimulatedPlayer extends TargetablePlayer {
  hp:number;
  /** Aplica dano ao motor DESTE jogador. O servidor resolve; o cliente nunca. */
  applyDamage(context:DamageContext):void;
  /** Empurrão do golpe, em metros por segundo somados à velocidade. */
  push(x:number,y:number,z:number):void;
}

/** Um corpo. Tudo aqui é número ou `Vec3`; nada disto sabe o que é um mesh. */
export interface EnemyActor extends TargetingState {
  id:number;kind:EnemyKind;variant:EnemyVariant;scale:number;
  position:Vec3;yaw:number;push:Vec3;
  health:Health;
  state:EnemyPhase;time:number;attack:number;locked:Vec3;direction:Heading;
  burn:number;burnClock:number;stagger:number;staggerCooldown:number;cooldown:number;
  deathVelocity:Vector3;active:boolean;
  /** Há quanto tempo o corpo não reduz a distância até o alvo. Alimenta a invalidação por rota. */
  unreachableFor:number;
  closestApproach:number;
}

/** A linha que viaja na rede. `mirror()` só COPIA isto — não recalcula nada (contrato §18.9). */
export interface EnemyRow {
  id:number;kind:EnemyKind;variant:EnemyVariant;scale:number;
  x:number;y:number;z:number;yaw:number;
  hp:number;maxHP:number;state:EnemyPhase;time:number;burn:number;stagger:number;
  targetPlayerId:number;targetLockTime:number;lastTargetSwitchTime:number;alive:boolean;
}

/** Rascunhos: 60 Hz × dezenas de corpos não pode alocar um `Vector3` por método por quadro. */
const work0=new Vector3(),work1=new Vector3();
const workVec:Vec3={x:0,y:0,z:0};
const headingLength=(d:Heading):number=>Math.hypot(d.x,d.y??0,d.z);

export interface EnemySimulationOptions {
  collision:CollisionWorld;
  events:EventBus<GameEvents>;
  rng:RunRNG;
  /** Contadores da SALA (estágio, nível, recompensa). Itens e stats são de cada jogador. */
  progression:{stage:number;level:number;reward(elite?:boolean,multiplier?:number,bounty?:{credits:number;xp:number}):void};
  /** Quem está vivo AGORA. Uma função, e não uma lista fixa: a corrida perde e ganha jogadores. */
  players:()=>readonly SimulatedPlayer[];
  mode?:DirectorMode;
  surface?:EnemySurface;
  /** Teto de população. No servidor não há malha, então ele é regra de jogo, não orçamento de GPU. */
  populationCap?:number;
}

export class EnemySimulation {
  readonly actors:EnemyActor[]=[];
  readonly scheduler=new AIScheduler();
  readonly effects=new CombatField();
  readonly burning=new BurningStatus();
  director:MonsterDirector;
  kills=0;
  boss:EnemyActor|undefined;
  bossDeadTime=-1;
  lastSpawnedId=-1;
  populationCap:number;
  time=0;
  private nextId=200;
  private readonly byId=new Map<number,EnemyActor>();
  private readonly space:EnemySpace;
  private readonly radial:EnemySurface|undefined;
  /** Cursor da referência de spawn. O Director NÃO fixa um jogador: ele roda entre os vivos. */
  private spawnReference=0;

  constructor(private readonly options:EnemySimulationOptions){
    this.space=enemySpace(options.collision,options.surface);
    this.radial=options.surface&&(options.surface as {kind?:string}).kind!=='flat'?options.surface:undefined;
    this.effects.useSurface(options.surface);
    this.populationCap=options.populationCap??24;
    this.director=new MonsterDirector(options.rng.stream('director'),options.progression.stage,50,options.mode??'classic');
  }

  private get players():readonly SimulatedPlayer[] {return this.options.players();}
  private living():readonly SimulatedPlayer[] {return this.players.filter(p=>p.alive&&p.eligible);}

  get count():number {let live=0;for(const a of this.actors)if(a.active&&!a.health.dead)live++;return live;}
  actor(id:number):EnemyActor|undefined {return this.byId.get(id);}

  /** O que a sala replica. Só corpos em campo: quem saiu não tem linha. */
  rows():EnemyRow[] {
    const out:EnemyRow[]=[];
    for(const a of this.actors){
      if(!a.active)continue;
      out.push({
        id:a.id,kind:a.kind,variant:a.variant,scale:a.scale,
        x:a.position.x,y:a.position.y,z:a.position.z,yaw:a.yaw,
        hp:a.health.current,maxHP:a.health.maximum,state:a.state,time:a.time,burn:a.burn,stagger:a.stagger,
        targetPlayerId:a.targetPlayerId,targetLockTime:a.targetLockTime,lastTargetSwitchTime:a.lastTargetSwitchTime,
        alive:!a.health.dead,
      });
    }
    return out;
  }

  // ---------------------------------------------------------------------------------------------
  // Nascimento
  // ---------------------------------------------------------------------------------------------

  /**
   * A referência de spawn RODA entre os vivos (contrato §18.6).
   *
   * Fixar `players[0]` faria toda a horda nascer em volta de um jogador só — e o §9 é explícito:
   * o alvo/referência deve VARIAR. E referência de spawn não é alvo: depois de nascer, o corpo
   * adquire o próprio alvo pela política dele.
   */
  private referencePlayer():SimulatedPlayer|undefined {
    const living=this.living();
    if(!living.length)return undefined;
    this.spawnReference=(this.spawnReference+1)%living.length;
    return living[this.spawnReference];
  }

  private spawnPosition(reference:Vec3,min?:number,max?:number):Vec3|undefined {
    return chooseSpawnAround(
      reference,this.options.rng.stream('spawn'),this.options.collision,
      ()=>true,
      p=>this.actors.some(a=>a.active&&!a.health.dead&&this.space.distance(p,a.position)<2),
      min,max,this.radial,
    );
  }

  private healthFor(kind:EnemyKind,variant:EnemyVariant):number {
    const {stage,level}=this.options.progression;
    if(kind==='boss')return bossHealth(stage,level)*this.director.healthMultiplier;
    return ENEMIES[kind].hp*ENEMY_AFFIXES[variant].health*(1+(stage-1)*.35)*this.director.healthMultiplier;
  }

  /**
   * Nasce um corpo. **Toda a aleatoriedade de gameplay é daqui** — posição no anel e sorteio de
   * variante/elite saem dos streams do servidor. Contrato §6: seed igual NÃO basta, porque cada
   * cliente consome os streams um número diferente de vezes.
   */
  spawn(kind:EnemyKind,position?:Vec3,variant?:EnemyVariant):boolean {
    this.lastSpawnedId=-1;
    if(kind==='boss'&&this.boss&&!this.boss.health.dead)return true;
    const reference=this.referencePlayer();
    if(!position&&!reference)return false;
    const exempt=kind==='boss'||isSaucerSpecies(kind);
    if(this.count>=this.populationCap&&!exempt)return false;
    const at=position??this.spawnPosition(reference!.position);
    if(!at)return false;
    if(this.count>=this.populationCap){
      const retired=this.farthestRetirable(0);
      if(retired)this.retire(retired);
      else if(!exempt)return false;
    }
    const rolled=variant??(kind==='boss'?'normal':chooseVariant(this.options.rng.stream('elite').next(),this.director.time));
    const affix=ENEMY_AFFIXES[rolled],definition=ENEMIES[kind];
    const recycled=this.actors.find(a=>!a.active&&a.kind===kind);
    const id=recycled?recycled.id:this.nextId++;
    const actor:EnemyActor={
      ...(recycled??newTargetingState()),
      id,kind,variant:rolled,scale:definition.scale*affix.scale,
      position:{x:at.x,y:at.y,z:at.z},yaw:0,push:{x:0,y:0,z:0},
      health:new Health(id,this.healthFor(kind,rolled),this.options.events),
      state:'spawn',time:0,attack:0,locked:{...at},direction:{x:0,z:0},
      burn:0,burnClock:0,stagger:0,staggerCooldown:0,cooldown:1,
      deathVelocity:new Vector3(),active:true,
      // Alvo e ameaça começam LIMPOS mesmo num corpo reciclado: herdar o alvo do cadáver anterior
      // faria o corpo novo nascer já perseguindo alguém que ele nunca viu.
      targetPlayerId:NO_TARGET,targetLockTime:0,lastTargetSwitchTime:this.time,aggroSource:NO_TARGET,threat:new Map(),
      unreachableFor:0,closestApproach:Number.POSITIVE_INFINITY,
    };
    if(reference)actor.yaw=Math.atan2(reference.position.x-at.x,reference.position.z-at.z);
    if(recycled)Object.assign(recycled,actor);
    else {this.actors.push(actor);}
    const live=recycled??actor;
    this.byId.set(id,live);
    this.scheduler.remove(id);
    this.scheduler.add({
      id,
      distance:()=>this.distanceToTarget(live),
      update:dt=>{if(live.active&&!live.health.dead)this.think(live,dt);},
    });
    if(kind==='boss'){this.boss=live;this.options.events.emit('BossSpawned',{entityId:id,definitionId:'boss_fruit_abomination_01'});}
    this.lastSpawnedId=id;
    return true;
  }

  // ---------------------------------------------------------------------------------------------
  // Alvo
  // ---------------------------------------------------------------------------------------------

  /** O jogador que este corpo está caçando, ou `undefined`. Nunca recalculado por quem lê. */
  targetOf(a:EnemyActor):SimulatedPlayer|undefined {
    return a.targetPlayerId===NO_TARGET?undefined:this.players.find(p=>p.entityId===a.targetPlayerId);
  }

  private distanceToTarget(a:EnemyActor):number {
    const target=this.targetOf(a);
    return target?this.space.distance(a.position,target.position):Number.POSITIVE_INFINITY;
  }

  /**
   * Passo de alvo de UM corpo. Aqui não se reseleciona nada: `acquireTarget` mantém o alvo vigente
   * e só troca sob a condição da política. O que este método faz é medir a rota (para a invalidação
   * por inalcançável) e repassar o relógio.
   */
  private updateTarget(a:EnemyActor,dt:number):SimulatedPlayer|undefined {
    const players=this.players;
    const before=a.targetPlayerId;
    const target=this.targetOf(a);
    if(target){
      const d=this.space.distance(a.position,target.position);
      // "Inalcançável" é não conseguir CHEGAR MAIS PERTO do que já chegou, não estar longe: um
      // corpo do outro lado de um muro fica preso no mesmo raio e perde o alvo; um que ainda avança
      // nunca perde, por mais longe que esteja.
      if(d<a.closestApproach-.5){a.closestApproach=d;a.unreachableFor=0;}
      else a.unreachableFor+=dt;
    }
    const chosen=acquireTarget(a,{
      policy:TARGET_POLICIES[a.kind],
      players,position:a.position,
      distance:(x,y)=>this.space.distance(x,y),
      now:this.time,
      random:()=>this.options.rng.stream('director').next(),
      unreachableFor:a.unreachableFor,unreachableLimit:UNREACHABLE_SECONDS,
    },dt);
    if(chosen!==before){a.unreachableFor=0;a.closestApproach=Number.POSITIVE_INFINITY;}
    return chosen===NO_TARGET?undefined:players.find(p=>p.entityId===chosen);
  }

  /** Motivo pelo qual o alvo atual deixaria de valer — usado pelos testes e pelo diagnóstico. */
  targetInvalidation(a:EnemyActor):string {
    return invalidation(a,this.players,a.unreachableFor,UNREACHABLE_SECONDS);
  }

  // ---------------------------------------------------------------------------------------------
  // Dano e morte
  // ---------------------------------------------------------------------------------------------

  /**
   * Único caminho de dano a um inimigo. O cliente NUNCA chama isto: ele manda intenção de tiro e o
   * servidor resolve (bloco E). Aqui ele já é a entrada autoritativa, usada pelos testes e pelos
   * efeitos de área do próprio servidor.
   */
  applyDamage(id:number,context:DamageContext):boolean {
    const a=this.byId.get(id);
    if(!a||!a.active||a.health.dead)return false;
    const finalDamage=context.finalDamage*100/(100+ENEMY_AFFIXES[a.variant].armor);
    const applied={...context,victimId:a.id,finalDamage};
    if(!a.health.apply(applied))return false;
    // Foco de fogo vira ameaça e, para quem usa `THREAT`, vira alvo. Também é o gancho de aggro.
    noteThreat(a,context.attackerId,finalDamage);
    const {force,stagger}=enemyImpact(context,a.variant,a.kind,a.staggerCooldown);
    if(force>.5){
      this.space.tangentInto(a.position,context.forceDirection,work0);work0.normalize();
      a.push.x=work0.x*force;a.push.y=work0.y*force;a.push.z=work0.z*force;
    }
    if(stagger){
      a.stagger=.18;a.staggerCooldown=.85;
      if(a.state==='windup'){a.state='chase';a.time=0;a.cooldown=.4;}
    }
    if(a.health.dead)this.die(a,applied);
    return true;
  }

  private die(a:EnemyActor,applied:DamageContext):void {
    this.scheduler.remove(a.id);
    a.state='dead';a.time=0;a.targetPlayerId=NO_TARGET;
    this.kills++;
    const {stage}=this.options.progression;
    this.options.progression.reward(a.kind==='boss',ENEMY_AFFIXES[a.variant].gold,a.kind==='boss'?undefined:killBounty(a.kind,stage));
    if(a.kind==='boss'){
      this.director.bossKilled();
      this.bossDeadTime=this.director.mode==='classic'?0:-1;
      this.options.events.emit('BossKilled',applied);
      if(this.director.mode!=='expedition')this.options.events.emit('StageCompleted',{stageId:String(stage)});
    }
  }

  /** Contexto de dano de um golpe DESTE corpo contra UM jogador concreto. */
  private damageContext(a:EnemyActor,victim:SimulatedPlayer,damage:number,position:Vec3,source:string):DamageContext {
    const multiplier=ENEMY_AFFIXES[a.variant].damage,{stage}=this.options.progression;
    this.space.towardInto(a.position,victim.position,work0);
    this.space.upInto(position,work1);
    return {
      attackerId:a.id,
      // O victimId é o jogador ATINGIDO, e não o `1` fixo de antes — era isso que deixava os
      // jogadores 2..4 imortais (armadilha 8.1 do plano).
      victimId:victim.entityId,
      sourceId:source,attackId:source,baseDamage:damage,
      finalDamage:damage*multiplier*(1+.15*(stage-1))*this.director.damageMultiplier,
      crit:false,procCoefficient:0,procChainDepth:0,damageTags:['enemy'],
      hitPosition:{x:position.x,y:position.y,z:position.z},
      hitNormal:{x:work1.x,y:work1.y,z:work1.z},
      forceDirection:{x:work0.x,y:work0.y,z:work0.z},
      forceMagnitude:3*multiplier,
    };
  }

  /** Quem está dentro do raio de um efeito de área. Todos os vivos, não "o jogador". */
  private playersWithin(position:Vec3,radius:number,heightGap:number):SimulatedPlayer[] {
    return this.living().filter(p=>
      this.space.distance(position,p.position)<radius&&Math.abs(this.space.heightGap(position,p.position))<heightGap);
  }

  // ---------------------------------------------------------------------------------------------
  // Recolhimento
  // ---------------------------------------------------------------------------------------------

  private release(a:EnemyActor):void {
    a.active=false;a.push.x=a.push.y=a.push.z=0;a.direction={x:0,z:0};
    a.targetPlayerId=NO_TARGET;
    this.options.collision.playerBodies.delete(a.id);
    this.scheduler.remove(a.id);
    this.effects.cancelOwner(a.id);
  }

  private retire(a:EnemyActor):void {this.director.retireLivingEnemy();this.release(a);}

  /** O comum mais distante de QUALQUER jogador vivo — nunca "do jogador". */
  private farthestRetirable(minimum:number):EnemyActor|undefined {
    const living=this.living();
    if(!living.length)return undefined;
    let pick:EnemyActor|undefined,best=minimum>0?minimum:-1;
    for(const a of this.actors){
      if(!a.active||a.health.dead||a.kind==='boss'||isSaucerSpecies(a.kind))continue;
      let nearest=Number.POSITIVE_INFINITY;
      for(const p of living)nearest=Math.min(nearest,this.space.distance(a.position,p.position));
      if(nearest>best){best=nearest;pick=a;}
    }
    return pick;
  }

  /** A coleira mede a distância ao jogador vivo MAIS PRÓXIMO: só é retardatário quem sumiu de todos. */
  private recycleStrays():void {
    const living=this.living();
    if(!living.length)return;
    for(const a of this.actors){
      if(!a.active||a.health.dead||a.kind==='boss'||isSaucerSpecies(a.kind))continue;
      let nearest=Number.POSITIVE_INFINITY;
      for(const p of living)nearest=Math.min(nearest,this.space.distance(a.position,p.position));
      if(nearest>STRAY_DISTANCE)this.retire(a);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Passo
  // ---------------------------------------------------------------------------------------------

  /**
   * Um passo fixo da horda inteira.
   *
   * Sem jogador vivo nada é decidido: o diretor não acumula, nada nasce e nada persegue. É o mesmo
   * `player.hp<=0` do cliente, generalizado para N jogadores.
   */
  step(dt:number):void {
    this.time+=dt;
    const living=this.living();
    this.burning.update(dt,(owner,amount)=>{
      const source=this.byId.get(owner);
      for(const p of living){
        const context=source
          ?this.damageContext(source,p,amount,p.position,'incendiary_burn')
          :undefined;
        if(context)p.applyDamage({...context,forceMagnitude:0,damageTags:['enemy','fire','dot']});
      }
    });
    if(!living.length)return;

    this.scheduler.update(dt);
    this.director.update(dt,this.kills,this.count,kind=>this.spawn(kind),this.populationCap);
    if(this.bossDeadTime>=0)this.bossDeadTime+=dt;

    for(const a of this.actors){
      if(!a.active)continue;
      a.time+=dt;
      a.stagger=Math.max(0,a.stagger-dt);
      a.staggerCooldown=Math.max(0,a.staggerCooldown-dt);
      if(a.state==='dead'){
        // Sem malha o cadáver não precisa cair nem rolar: ele só precisa SUMIR no mesmo prazo, para
        // a vaga de população voltar quando o cliente já terminou a cena de morte.
        if(a.time>7)this.release(a);
        continue;
      }
      if(a.burn>0){
        a.burn-=dt;a.burnClock-=dt;
        if(a.burnClock<=0){
          a.burnClock=.5;
          this.applyDamage(a.id,{
            attackerId:a.id,victimId:a.id,sourceId:'burn',attackId:'burn',baseDamage:5,finalDamage:5,
            crit:false,procCoefficient:0,procChainDepth:1,sourceProcId:'burn',damageTags:['fire','dot'],
            hitPosition:{...a.position},hitNormal:{x:0,y:1,z:0},forceDirection:{x:0,y:0,z:0},forceMagnitude:0,
          });
        }
        if(a.health.dead)continue;
      }
      if(a.state==='spawn'){
        const duration=isSaucerSpecies(a.kind)?.45:a.kind==='carrot'?1.15:a.kind==='watermelon'?1.8:a.kind==='tomato'?1.6:1.5;
        if(a.time>=duration){a.state='chase';a.time=0;}
        continue;
      }
      // Alvo ANTES do movimento: perseguir sem saber de quem é o alvo seria a regra antiga.
      const target=this.updateTarget(a,dt);
      if(!target){a.direction={x:0,z:0};continue;}
      if(Math.hypot(a.push.x,a.push.y,a.push.z)>.5){
        this.space.slide(a.position,{x:a.push.x*dt,y:a.push.y*dt,z:a.push.z*dt},ENEMIES[a.kind].radius,1.8,.5);
        const decay=Math.exp(-dt*8);
        a.push.x*=decay;a.push.y*=decay;a.push.z*=decay;
        continue;
      }
      if(a.state==='windup'){
        this.space.towardInto(a.position,target.position,work0);
        this.faceTo(a,work0,Math.min(1,dt*10));
        if(a.time>=ENEMY_BEHAVIORS[a.kind].windup){this.attack(a,target);a.state='recover';a.time=0;}
        continue;
      }
      let speed=ENEMIES[a.kind].speed*ENEMY_AFFIXES[a.variant].speed;
      if(a.state==='recover'){
        const behavior=ENEMY_BEHAVIORS[a.kind];
        speed=behavior.recoverySpeed(this.attacking(a));
        // Dano de contato da investida: em TODO jogador vivo que ela atravessar, não só no alvo.
        if(speed)for(const victim of this.playersWithin(a.position,ENEMIES[a.kind].radius+.55,3)){
          victim.applyDamage({...this.damageContext(a,victim,behavior.contactDamage,victim.position,a.kind+'_rush'),forceMagnitude:a.kind==='eggplant'?10:6});
          a.direction={x:0,z:0};
        }
        if(a.time>1.15){a.state='chase';a.time=0;a.cooldown=a.kind==='boss'?1.7:1.5+(a.id%5)*.17;}
      }
      const before={x:a.position.x,y:a.position.y,z:a.position.z};
      this.space.slide(a.position,{x:a.direction.x*speed*dt,y:(a.direction.y??0)*speed*dt,z:a.direction.z*speed*dt},ENEMIES[a.kind].radius,1.8,.8);
      if(this.space.groundUnder(a.position,.85,work0))a.position.x=work0.x,a.position.y=work0.y,a.position.z=work0.z;
      else {a.position.x=before.x;a.position.y=before.y;a.position.z=before.z;}
      if(headingLength(a.direction)){
        workVec.x=a.direction.x;workVec.y=a.direction.y??0;workVec.z=a.direction.z;
        this.faceTo(a,workVec,Math.min(1,dt*10));
      }
    }
    this.updateWarnings(dt);
    this.updateProjectiles(dt);
    this.recycleStrays();
  }

  /** Giro incremental para `heading`, a mesma fração do cliente — só que em `yaw`, sem nó de cena. */
  private faceTo(a:EnemyActor,heading:Vec3,blend:number):void {
    if(!heading.x&&!heading.z)return;
    const wanted=Math.atan2(heading.x,heading.z);
    a.yaw+=Math.atan2(Math.sin(wanted-a.yaw),Math.cos(wanted-a.yaw))*blend;
  }

  /** Vista de `AttackingEnemy` sobre o corpo: as receitas leem `root.position`, aqui é a posição. */
  private attacking(a:EnemyActor):{id:number;attack:number;locked:Vec3;direction:Heading;root:{position:Vec3};time:number} {
    return {id:a.id,attack:a.attack,locked:a.locked,direction:a.direction,root:{position:a.position},time:a.time};
  }

  /**
   * Decide se este corpo COMPROMETE o próximo ataque. É o `think` do cliente, com o alvo vindo do
   * estado do inimigo em vez do `this.player` único.
   */
  private think(a:EnemyActor,dt:number):void {
    if(a.state!=='chase'||Math.hypot(a.push.x,a.push.y,a.push.z)>.5)return;
    const target=this.targetOf(a);
    if(!target||!target.alive)return;
    const p=target.position,d=this.space.distance(a.position,p);
    const behavior=ENEMY_BEHAVIORS[a.kind],ranged=Boolean(behavior.ranged);
    const view=this.attacking(a);
    const engagement=behavior.engage(view);
    /**
     * O alvo é uma ENTRADA, não a ordem "corra reto até ele". Cada arquétipo decide o que fazer com
     * a distância: quem atira recua se estiver perto demais, mantém o posto no alcance ideal e só
     * se aproxima quando está longe; quem bate persegue.
     */
    this.space.towardInto(a.position,p,work0);
    a.direction={x:work0.x,y:work0.y,z:work0.z};
    if(ranged){
      if(d<engagement*.55){a.direction.x*=-1;a.direction.z*=-1;if(a.direction.y!==undefined)a.direction.y*=-1;}
      else if(d<engagement)a.direction={x:0,z:0};
    }
    if(behavior.zigzag&&d>2&&d<10)this.space.rotateHeading(a.position,a.direction,Math.sin(this.director.time*3+a.id)*.65);
    a.cooldown=Math.max(0,a.cooldown-dt);
    if(!(d<=engagement&&Math.abs(this.space.heightGap(p,a.position))<3&&a.cooldown===0))return;
    // Linha de visão: sem ela o corpo abriria o windup através de uma parede.
    this.space.lift(a.position,1.1,work0);
    workVec.x=p.x-a.position.x;workVec.y=p.y-a.position.y;workVec.z=p.z-a.position.z;
    if(this.space.sweepTime(work0,workVec,.05)!==undefined)return;
    a.state='windup';a.time=0;a.locked={x:p.x,y:p.y,z:p.z};a.attack++;a.direction={x:0,z:0};
    this.telegraph(a,behavior.telegraph(this.attacking(a),this.space),behavior.windup);
  }

  private telegraph(a:EnemyActor,plan:TelegraphPlan,seconds:number):void {
    if(plan.shape==='none')return;
    if(plan.shape==='circle'){this.effects.warning(a.locked,plan.radius,seconds,0,a.id,plan.kind);return;}
    if(plan.shape==='cone'){this.effects.cone(a.position,a.locked,plan.radius,seconds,a.id);return;}
    // Faixa/mira/feixe são puramente visuais no servidor (dano nenhum sai delas): ocupam um slot
    // para a lotação bater com a do cliente e nada mais.
    this.space.towardInto(a.position,a.locked,work0);
    const reach=plan.shape==='band'?plan.reach:plan.shape==='aim'?plan.length:24;
    workVec.x=a.position.x+work0.x*reach;workVec.y=a.position.y+work0.y*reach;workVec.z=a.position.z+work0.z*reach;
    this.effects.line(a.position,workVec,plan.shape==='beam'?plan.width:plan.width,seconds,a.id,plan.shape==='aim'?'aim':'band');
  }

  private attack(a:EnemyActor,target:SimulatedPlayer):void {
    let nearby=0;
    for(const other of this.actors)if(other.active&&other!==a&&this.space.distance(other.position,a.position)<4)nearby++;
    const view=this.attacking(a);
    ENEMY_BEHAVIORS[a.kind].perform({
      actor:view,player:target.position,effects:this.effects,space:this.space,nearby,
      laser:damage=>this.fireLaser(a,damage),
      spawn:(kind,p)=>this.spawn(kind,p),
      hurt:(damage,source,knockback=0)=>{
        const hp=target.hp;
        target.applyDamage(this.damageContext(a,target,damage,target.position,source));
        if(target.hp<hp&&knockback){
          this.space.towardInto(a.position,target.position,work0);
          target.push(work0.x*knockback,work0.y*knockback,work0.z*knockback);
        }
      },
    });
    // As receitas mexem em `attack`/`direction` da VISTA; devolver ao corpo é o que fecha o ciclo.
    a.attack=view.attack;a.direction=view.direction;
  }

  /** Feixe da cenoura: linha reta até o alvo travado, acertando quem estiver no caminho. */
  private fireLaser(a:EnemyActor,damage:number):void {
    for(const victim of this.playersWithin(a.locked,1.2,2.5))
      victim.applyDamage({...this.damageContext(a,victim,damage,victim.position,'carrot_hand_laser'),damageTags:['enemy','laser'],forceMagnitude:2});
  }

  private updateWarnings(dt:number):void {
    for(const w of this.effects.warnings){
      if(!w.active)continue;
      w.remaining-=dt;
      if(w.remaining>0)continue;
      const {position,radius,kind,pulses,damage,owner}=w;
      w.active=false;
      if(!damage)continue;
      const source=this.byId.get(owner);
      for(const victim of this.playersWithin(position,radius+.25,2.1)){
        const before=victim.hp;
        if(source)victim.applyDamage(this.damageContext(source,victim,damage,position,kind));
        if(kind.startsWith('fire')&&victim.hp<before)this.burning.ignite(owner,1.2);
      }
      if(pulses>0){
        const pool=this.effects.warning(position,radius,.6,kind.includes('pool')?damage:damage*.18,owner,kind.startsWith('acid')?'acid-pool':'fire-pool');
        if(pool)pool.pulses=pulses-1;
      }
    }
  }

  private updateProjectiles(dt:number):void {
    for(const p of this.effects.projectiles){
      if(!p.active)continue;
      if(p.delay>0){p.delay-=dt;continue;}
      const previous=p.position.clone();
      p.remaining-=dt;
      this.space.gravity(p.position,p.velocity,p.gravity,dt);
      p.position.addInPlace(p.velocity.scale(dt));
      // Acerto contra TODOS os jogadores vivos: o tiro não pertence a um alvo, ele voa no mundo.
      const segment=p.position.subtract(previous),length=segment.lengthSquared();
      let victim:SimulatedPlayer|undefined;
      for(const candidate of this.living()){
        this.space.lift(candidate.position,.9,work0);
        const along=length?Math.max(0,Math.min(1,Vector3.Dot(work0.subtract(previous),segment)/length)):0;
        if(Vector3.DistanceSquared(previous.add(segment.scale(along)),work0)<.65*.65){victim=candidate;break;}
      }
      const landed=this.space.fallGround(p.position,work1);
      const wall=this.space.sweepTime(previous,segment,.15)!==undefined;
      if(!(victim||wall||(landed&&this.space.heightGap(p.position,work1)<0)||p.remaining<=0))continue;
      p.active=false;
      if(victim&&p.damage){
        const source=this.byId.get(p.owner),before=victim.hp;
        if(source)victim.applyDamage(this.damageContext(source,victim,p.damage,{x:p.position.x,y:p.position.y,z:p.position.z},p.impact?.zone==='fire'?'incendiary_projectile':'seed_projectile'));
        if(p.impact?.zone==='fire'&&victim.hp<before)this.burning.ignite(p.owner);
      }
      if(p.impact&&landed){
        const impact={x:work1.x,y:work1.y,z:work1.z};
        if(p.impact.zone)this.effects.warning(impact,p.impact.zone==='acid'?4:2.3,.12,p.damage||18,p.owner,p.impact.zone);
        if(p.impact.summon)this.spawn(p.impact.summon,impact);
      }
    }
  }

  /** Novo estágio: nada sobrevive à transição exceto o catálogo. Mesmo protocolo do cliente. */
  nextStage():void {
    for(const a of this.actors)this.release(a);
    this.effects.clear();this.burning.clear();this.scheduler.clear();this.byId.clear();
    this.kills=0;this.boss=undefined;this.bossDeadTime=-1;this.time=0;
    this.director=new MonsterDirector(this.options.rng.stream('director'),this.options.progression.stage,50,this.director.mode);
  }
}
