import {reloadMovement} from '../player/ReloadMovement';
import {meleeMovement} from '../combat/MeleeMovement';
import {extractionPresentation} from '../stages/ExtractionPresentation';
import {DeathFlight} from '../player/DeathFlight';
import {DeathTimeline} from '../player/DeathTimeline';
import {attemptSummary} from '../run/AttemptSummary';
import {reviewSkyBlend} from '../rendering/SeamlessSky';
import {NetworkSession} from '../net/NetworkSession';
import {IntroSequence,type IntroCue} from '../player/IntroSequence';
import {DropshipDeck} from '../world/DropshipDeck';
import {MeleeReview,meleeReviewShot} from '../animation/MeleeReview';
import {ElementalEffects,ELEMENTS,type ElementKind} from '../vfx/ElementalEffects';
import {SkillAura} from '../vfx/SkillAura';
import {SKILL_CUES,SkillTimeline,type SkillTier} from '../combat/SkillTimeline';

import {SkillCutIn} from '../ui/SkillCutIn';

import {AbyssPresentation} from '../world/AbyssPresentation';

import { Scene } from '@babylonjs/core/scene';

import { SceneInstrumentation } from '@babylonjs/core/Instrumentation/sceneInstrumentation';

import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine';

import { Vector3 } from '@babylonjs/core/Maths/math.vector';

import { RunRNG,type RandomStream } from '../core/RunRNG';

import { EventBus } from '../core/EventBus';

import type { GameEvents,Vec3 } from '../core/contracts';

import type { SceneModule } from '../engine/SceneLifecycle';

import { CollisionWorld } from '../physics/CollisionWorld';

import { GameInput,EMPTY_INPUT } from '../input/GameInput';

import { PlayerMotor } from '../player/PlayerMotor';

import { ThirdPersonCamera } from '../camera/ThirdPersonCamera';

import { CharacterVisual } from '../animation/CharacterVisual';

import { trainingLighting,applyLightingQuality } from '../rendering/TrainingLighting';

import { TrainingYard } from '../world/TrainingYard';

import { DualPistols } from '../combat/DualPistols';

import { WeaponAudio } from '../audio/WeaponAudio';

import { PlayerHUD } from '../ui/PlayerHUD';

import { MPCharge } from '../combat/MPCharge';

import { EnemyReview } from './EnemyReview';

import { FarmWorld } from '../world/FarmWorld';

import { EnemySwarm } from './EnemySwarm';

import { ITEMS,RunProgression } from '../run/RunProgression';

import { RunInteractables } from '../run/RunInteractables';

import { FootingPresentation } from '../world/FootingPresentation';

import { RunHUD } from '../ui/RunHUD';

import { ExpeditionObjectives,findTotemSite,FINAL_CHALICE_JUICE,TOTEM_RADIUS,type TotemSite } from '../run/ExpeditionObjectives';

import { StageJourney,type JourneyCue } from '../stages/StageJourney';

import { biomeForStage,nextBiomeForStage,WIDE_ISLAND_SEPARATION } from '../stages/StageRoute';

import { planStage,HOME_MIN_ROUTE,WIDE_MIN_ROUTE,type StagePlan } from '../stages/StagePlan';
import { seedPinned,retrySeed } from '../run/AttemptSeed';

import { findSpawnPoint } from '../stages/StageSpawn';

import { HarvestResonance } from '../run/HarvestResonance';

import { ExpeditionSites } from '../world/ExpeditionSites';

import type { DirectorMode } from '../run/MonsterDirector';

import { SlowMotion } from '../camera/SlowMotion';

import { UnarmedCombat,meleeReaches } from '../combat/UnarmedCombat';

import { ENEMIES,finalHordePressure } from '../run/MonsterDirector';

import { ENEMY_AFFIXES } from '../enemies/EnemyAffixes';

import { WeatherCycle } from '../world/WeatherCycle';

import { WeatherPresentation } from '../world/WeatherPresentation';



/** Plano de um estágio: o par de ilhas validado mais o sítio já montado do cálice. */
interface StageSetup {plan:StagePlan;site:TotemSite}

export class PlayerScene implements SceneModule {
  private readonly death=new DeathTimeline();
  private deathFlight!:DeathFlight;
  private deathSummary:ReturnType<typeof attemptSummary>|undefined;

  readonly scene: Scene;

  readonly instrumentation: SceneInstrumentation;

  readonly events=new EventBus<GameEvents>();

  readonly mp=new MPCharge(this.events);

  readonly progression=new RunProgression(this.events);

  readonly player: PlayerMotor;

  readonly camera: ThirdPersonCamera;

  readonly visual: CharacterVisual;

  readonly weapons: DualPistols;private readonly skillAura:SkillAura;

  readonly enemies:EnemyReview|EnemySwarm;

  private readonly runHUD:RunHUD|undefined;

  private readonly interactables:RunInteractables|undefined;

  private readonly hud: PlayerHUD;

  private readonly input: GameInput;

  private abyss:AbyssPresentation|undefined;private readonly audio=new WeaponAudio();private readonly footing:FootingPresentation;

  private readonly yard: TrainingYard | FarmWorld;

  private readonly spawn=new Vector3(0,0,-10);

  private readonly cinematic=new SkillTimeline();private readonly cutIn=new SkillCutIn();private voiceClock:(()=>number)|undefined;private skillPending=false;private castVersion=0;private castYaw=0;private castPitch=0;

  private cameraAudit='';private poseReview=false;private readonly elements:ElementalEffects;private elementPreview:ElementKind|undefined;private elementClock=0;private auraClock=0;private auraLast=-1;
  private paused=false;

  private readonly rewardRng:RandomStream;

  /** Expedição: explorar, encontrar o cálice e ativar a horda final com chefe. */
  readonly objectives=new ExpeditionObjectives();
  readonly resonance=new HarvestResonance();
  private expeditionSites:ExpeditionSites|undefined;
  private readonly directorMode:DirectorMode;
  private bossRequestClock=0;
  private readonly collision:CollisionWorld;

  /**
   * Conclusão do estágio: recolher o suco no cálice, embarcar, viajar e chegar a OUTRO bioma já
   * existente. Substitui a fenda fixa do celeiro, que reaparecia sempre no mesmo mapa.
   */
  readonly journey=new StageJourney();
  /** Plano em vigor: ilha de partida, ilha do cálice e o sítio do cálice já validado. */
  private stageSetup:StageSetup|undefined;
  /** Plano do próximo estágio, validado durante a viagem e aplicado na chegada. */
  private pendingSetup:StageSetup|undefined;
  /**
   * Planos já validados por estágio, guardados DENTRO da tentativa corrente.
   *
   * Reaproveitar isto entre tentativas é exatamente o que congelava a expedição: o estágio 1 voltava
   * com a mesma partida e o mesmo cálice para sempre. O cache é esvaziado sempre que a semente da
   * tentativa muda — ver `restartAttempt`.
   */
  private readonly stagePlans=new Map<number,StageSetup>();
  private planReady=false;private planning=false;private planError='';private planVersion=0;private planRetry=0;
  /**
   * Semente da TENTATIVA corrente, que é o que alimenta o sorteio de ilhas.
   *
   * Separada de `seed` de propósito: `seed` é a semente da SESSÃO e continua sendo a chave da sala
   * de co-op (`NetworkSession` já a recebeu no construtor). Trocar a semente da tentativa depois de
   * morrer não pode mudar a sala nem desconectar ninguém.
   */
  private attemptSeed:string;
  /** `true` quando a semente é contrato (`?replay=1` ou `?online=1`) e a repetição não re-sorteia. */
  private readonly seedLocked:boolean;
  /** Semente realmente em vigor; o `Application` espelha isto na URL e no overlay. */
  get runSeed():string {return this.attemptSeed;}

  /** Apresentação apenas: nunca aplicada ao passo fixo, ao diretor nem ao servidor. */
  readonly slowMotion=new SlowMotion();

  /** Combate desarmado alternável com `V`. */
  readonly unarmed=new UnarmedCombat();

  /** Ciclo sol → nublado → chuva → crepúsculo → noite, avançado por tempo e abates. */
  readonly weather=new WeatherCycle();
  private weatherView:WeatherPresentation|undefined;
  /** Sessão online (`?online=1`): predição local, reconciliação e remotos. `undefined` no single-player. */
  private net:NetworkSession|undefined;

  private charging=false;

  /** Continuação enfileirada na janela final da habilidade; consome uma carga de verdade. */
  private continuationTier:SkillTier|undefined;
  private chargingPressed=false;

  private cancelVersion=0;

  private reloadRunReview=0;private started=false;private hasArrived=false;private warming=false;

  /**
   * Entrada pela plataforma da nave: espera no deck, corrida, salto, mergulho, impacto e levantar.
   * É apresentação pura — enquanto `holdsControl` estiver ligado, o passo fixo, o diretor e a rede
   * ficam parados, então nenhum cliente de co-op roda colisão ou entrada divergente.
   */
  readonly intro=new IntroSequence();
  private dropship:DropshipDeck|undefined;

  /** Revisão do combo desarmado no F1 (ciclo lento, pose de contato, câmera de corpo inteiro). */
  readonly meleeReview=new MeleeReview();
  private meleeReviewReturn:{position:Vec3;yaw:number;pitch:number;armed:boolean}|undefined;

  private disposed=false;

  private lastRender=performance.now();

  constructor(engine: AbstractEngine,readonly seed: string) {

    this.scene=new Scene(engine);

    this.scene.skipPointerMovePicking=true;this.scene.skipPointerDownPicking=true;this.scene.skipPointerUpPicking=true;

    this.attemptSeed=seed;this.seedLocked=seedPinned(location.href);

    const rng=new RunRNG(seed);this.rewardRng=rng.stream('loot');

    const collision=this.collision=new CollisionWorld();this.deathFlight=new DeathFlight(collision);

    this.camera=new ThirdPersonCamera(this.scene,collision);

    const shadows=trainingLighting(this.scene,this.camera.camera);

    const mode=new URL(location.href).searchParams.get('mode');

    const training=mode==='training';

    // Expedição com um cálice por estágio. Modos legados continuam disponíveis pela URL.
    // Os modos anteriores continuam acessíveis: `?mode=horde` e `?mode=classic` (antigo `legacy`).
    this.directorMode=mode==='horde'?'horde':(mode==='classic'||mode==='legacy')?'classic':'expedition';

    this.yard=training?new TrainingYard(this.scene,shadows,rng):new FarmWorld(this.scene,collision,shadows,!new URLSearchParams(location.search).get('online'));

    if(this.yard instanceof FarmWorld)void this.yard.load().then(async()=>{if(this.disposed)return;if(this.enemies instanceof EnemySwarm)await this.enemies.prepareNavigation();if(!this.disposed)this.checkReady();});

    if(training){collision.boxes.push(...this.yard.collision.boxes);collision.surfaces.push(...this.yard.collision.surfaces);}

    if(!training){this.spawn.x=rng.stream('spawn').range(-2,2);this.spawn.z=rng.stream('spawn').range(-17,-10);}

    this.player=new PlayerMotor(collision,this.events,this.spawn);

    this.enemies=training?new EnemyReview(this.scene,this.yard,this.events,shadows):new EnemySwarm(this.scene,this.yard,this.events,shadows,this.player,this.progression,rng,this.directorMode);if(this.enemies instanceof EnemySwarm)this.enemies.audio=this.audio;void this.enemies.load().then(()=>{if(!this.disposed)this.checkReady();});

    if(!training){this.runHUD=new RunHUD();this.interactables=new RunInteractables(this.scene,this.player,this.progression,this.events,rng.stream('interactable'),collision);void this.interactables.load(this.scene).then(()=>{if(!this.disposed)this.checkReady();});}

    this.dropship=training?undefined:new DropshipDeck(this.scene);
    void this.dropship?.load().then(()=>{if(!this.disposed)this.checkReady();});

    this.hud=new PlayerHUD(()=>{if(this.progression.time===0)this.events.emit('StageStarted',{stageId:String(this.progression.stage),seed:this.seed});this.started=true;
      // Sem o GLB da nave não existe deck para correr: a entrada cai direto no mergulho original.
      if(!this.hasArrived){this.hasArrived=true;this.intro.start(Boolean(this.dropship?.ready));}
      this.audio.unlock();this.audio.setActive(true);void this.input.capture();},!training,{volume:value=>this.audio.setVolume(value),quality:balanced=>applyLightingQuality(this.scene,balanced)},this.directorMode);
    this.hud.onSkipIntro=()=>this.skipIntro();

    const canvas=engine.getRenderingCanvas()!;canvas.tabIndex=0;

    this.input=new GameInput(canvas,active=>{if(this.player.hp<=0){if(this.death.active)this.audio.setActive(!this.paused);return;}this.audio.setActive(active);this.started=active;this.hud.setActive(active);if(!active)this.mp.cancel();});

    if(!training){this.input.yaw=-.13;this.player.yaw=this.input.yaw;}

    this.visual=new CharacterVisual(this.scene,()=>{this.checkReady();for(const mesh of this.visual.meshes)shadows.addShadowCaster(mesh);});
    this.net=NetworkSession.fromLocation(this.scene,collision,shadows,this.events,seed);

    this.weapons=new DualPistols(this.scene,this.camera,this.visual,this.yard,rng.stream('run'),this.events,this.audio);

    this.elements=new ElementalEffects(this.scene,collision);this.skillAura=new SkillAura(this.scene,collision);void this.skillAura.load().then(()=>{if(!this.disposed)this.checkReady();});
    void this.weapons.load().then(()=>{if(!this.disposed)this.checkReady();});

    this.abyss=new AbyssPresentation(this.scene,this.player);this.footing=new FootingPresentation(this.scene,this.player,collision,this.audio);

    // Passos vinculados ao contato real dos pés do clipe dominante.
    this.footing.footHeights=()=>this.visual.footHeights();
    this.footing.suppressSteps=()=>this.visual.meleePose!==undefined||this.visual.arrivalPose!==undefined||this.visual.deathProgress!==undefined;

    this.weatherView=training?undefined:new WeatherPresentation(this.scene);
    // O ambiente de chuva só toca se existir gravação licenciada no manifest (grupo `rain`).
    // `world` é a integração de uma linha documentada em WeatherPresentation: sem ela a chuva roda
    // inteira, mas sem respingo no piso/telhado real e sem supressão sob cobertura.
    if(this.weatherView){this.weatherView.onRain=intensity=>this.audio.ambientRain(intensity);this.weatherView.world=this.collision;}

    this.instrumentation=new SceneInstrumentation(this.scene);this.instrumentation.captureFrameTime=true;

    this.events.on('BodyBumped',({strength})=>{this.camera.impulse(.02*strength);this.audio.bodyGround(strength);});

    this.events.on('Dodged',({direction})=>{this.footing.dodge(direction);this.audio.dodge();this.camera.impulse(.035);});

    this.events.on('SkillUsed',({skillId})=>this.audio.skill(skillId));

    this.events.on('MPCharged',({tier})=>this.audio.charge(tier));

    this.events.on('LevelUp',()=>{this.audio.charge(3);this.player.hp=Math.min(this.progression.stats.maxHP,this.player.hp+18);if(this.enemies instanceof EnemySwarm)this.enemies.effects.burst(this.player.position,'energy',2);});

    this.events.on('ItemPicked',()=>{this.player.maxHP=this.progression.stats.maxHP;this.audio.charge(2);if(this.enemies instanceof EnemySwarm)this.enemies.effects.burst(this.player.position,'energy',1.5);});

    // O timbre do dano recebido segue a origem real do golpe, para o jogador identificar o que o acertou.
    this.events.on('PlayerHit',context=>{this.hud.hit(context,this.input.yaw,this.player.hp,this.player.maxHP);this.camera.hurt(.18,context.forceDirection.x*Math.cos(this.input.yaw)-context.forceDirection.z*Math.sin(this.input.yaw));
      const tags=context.damageTags;if(!tags.includes('dot'))this.visual.reactToHit();
      this.audio.playerHurt(tags.includes('dot')?'dot':tags.includes('fire')?'fire':tags.includes('laser')?'laser':tags.includes('environment')?'environment':/projectile|seed|rush/.test(context.sourceId)?'projectile':'melee');});

    this.events.on('EnemyHit',hit=>{if(!hit.damageTags.includes('melee'))this.audio.impact();});

    // Ressonância da Colheita: só acertos reais e mobilidade aérea real alimentam o bônus.
    this.events.on('DamageDealt',hit=>{if(hit.attackerId!==1||hit.finalDamage<=0)return;if(hit.damageTags.includes('melee'))this.resonance.register('melee');else if(hit.damageTags.includes('bullet'))this.resonance.register('shot');});

    this.events.on('SkillUsed',({skillId})=>{if(skillId==='air_jump'||skillId==='wall_jump'||skillId==='dash')this.resonance.register('air');});

    this.events.on('BossSpawned',()=>{this.audio.charge(1);this.camera.impulse(.04);});

    this.events.on('BossKilled',()=>{this.audio.charge(3);this.camera.impulse(.1);this.slowMotion.request(true);});

    // Lentidão só em finalizações fortes (habilidade ou golpe pesado), com intervalo próprio.
    this.events.on('EnemyKilled',context=>{if(context.attackerId!==1)return;if(context.damageTags.includes('skill')||context.damageTags.includes('melee_heavy'))this.slowMotion.request(true);});
    this.events.on('FruitHarvested',kill=>{
      if(this.directorMode!=='expedition')return;
      const credit=this.objectives.harvest(kill,this.player.position,this.player.hp>0);
      if(credit)this.expeditionSites?.harvest(credit.index,kill.position,credit.complete);
    });

    this.events.on('PlayerKilled',()=>{if(!this.death.start())return;this.deathFlight.start(this.player.position,this.player.yaw);this.intro.abort();this.meleeReview.exit();this.deathSummary=this.summarize();this.cancelCinematic();this.weapons.cancelSkills();this.started=false;this.player.sprinting=false;this.input.clear();if(document.pointerLockElement)document.exitPointerLock();this.audio.setActive(true);this.audio.fatalImpact();this.camera.hurt(.32,1);this.hud.fatalReaction(true);});

    this.camera.update(this.player.position,this.input.yaw,this.input.pitch,1/60);

    void this.visual.load();

  }

  fixedUpdate(dt: number): void {

    // Enquanto a entrada, a conclusão do estágio ou uma revisão seguram o controle, o passo fixo
    // inteiro fica parado: nada de motor, diretor, colisão ou envio de intenção para a rede.
    // É assim que a transição congela o que é perigoso — sem nenhuma invulnerabilidade de QA.
    if(this.intro.holdsControl||this.journey.holdsControl||this.meleeReview.active||this.poseReview||this.paused || !this.started || !this.visual.ready || !this.weapons.ready || !this.skillAura.ready || (this.yard instanceof FarmWorld&&!this.yard.ready)||(this.enemies instanceof EnemySwarm&&(!this.enemies.ready||!this.enemies.navigationReady))||this.interactables&&!this.interactables.ready)return;

    if(this.skillPending||this.cinematic.preparing)return;

    const input=this.paused?EMPTY_INPUT:this.input.read();if(this.reloadRunReview>0){this.reloadRunReview=Math.max(0,this.reloadRunReview-dt);input.x=0;input.z=1;input.fire=false;input.charging=false;this.player.sprinting=true;}this.charging=input.charging;

    const stats=this.progression.stats;this.player.maxHP=stats.maxHP;this.player.moveMultiplier=stats.moveSpeed;this.player.sprintMultiplier=stats.sprintSpeed;this.player.jumpMultiplier=stats.jump;this.player.extraJumps=stats.extraJumps;this.player.rechargeMultiplier=stats.dodgeRecharge;this.player.armor=stats.armor;this.player.regeneration=stats.regeneration;this.weapons.cadence.rateMultiplier=stats.attackSpeed;this.mp.speedMultiplier=1+(stats.mp-1)*.5;this.mp.setMaxCharges(stats.skillCharges);

    if(this.cancelVersion!==this.input.cancelVersion){this.mp.cancel();this.cancelVersion=this.input.cancelVersion;}

    if(this.yard instanceof FarmWorld)this.yard.fixedUpdate(dt,this.player);

    if(input.reload&&this.unarmed.armed)this.weapons.requestReload();
    // Online: reconcilia com o último seq confirmado antes de prever o passo seguinte; depois envia a intenção deste passo.
    this.net?.reconcile(this.player,dt);
    const stepInput=meleeMovement(reloadMovement(input,this.weapons.magazine.reloading),this.unarmed,this.player.grounded);
    this.player.fixedUpdate(dt,stepInput,this.input.yaw);
    this.net?.afterStep(stepInput,this.input.yaw,this.input.pitch,this.player);

    // Enfileirar continuação exige um NOVO pressionamento na janela final: segurar o botão não repete.
    const pressEdge=Boolean(input.charging)&&!this.chargingPressed;this.chargingPressed=Boolean(input.charging);
    if(pressEdge&&this.cinematic.active&&!this.cinematic.preparing&&this.cinematic.actionProgress>=.6&&this.continuationTier===undefined&&this.mp.consumeCharge()){
      this.continuationTier=this.cinematic.tier;
    }

    const released=this.player.hp>0?this.mp.update(dt,this.unarmed.armed&&input.charging&&!this.weapons.magazine.reloading&&!this.cinematic.active):0;

    if(released){void this.requestSkill(released);return;}

    if(input.stance&&this.unarmed.toggle()){this.mp.cancel();this.weapons.cancelSkills();this.weapons.holstered=!this.unarmed.armed;this.audio.dodge();}
    this.unarmed.rateMultiplier=stats.attackSpeed;
    const evading=this.player.dodgeRemaining>0||this.player.dashRemaining>0||this.player.backflipProgress>=0;
    if(evading&&this.unarmed.busy)this.unarmed.reset();
    const canAct=!evading&&this.player.hp>0&&!input.charging;
    if(!this.unarmed.armed&&input.fire&&canAct)this.unarmed.strike();
    const meleeWasActive=this.unarmed.active;
    this.unarmed.update(dt);
    if(this.unarmed.active&&!meleeWasActive)this.audio.meleeSwing();
    if(this.unarmed.active)this.resolveMelee();
    this.weapons.fixedUpdate(dt,input.fire&&this.unarmed.armed&&this.weapons.ready&&!input.charging&&this.player.dodgeRemaining===0&&this.player.hp>0);

    if(this.enemies instanceof EnemySwarm){
      this.progression.time+=dt;this.enemies.fixedUpdate(dt);
      const expedition=this.directorMode==='expedition'&&this.objectives.planned;
      if(expedition)this.updateExpedition(dt,this.enemies);
      // A recompensa cai onde caiu a praga decisiva; sem abate recente, na âncora do objetivo.
      const recentKill=this.enemies.lastKill&&this.enemies.lastKill.age<12?this.enemies.lastKill.position:undefined;
      const hordeAnchors=[{position:recentKill,source:'kill' as const}];
      while(this.enemies.director.rewardsPending>0){if(!this.interactables!.deliverWaveReward(this.rewardRng,hordeAnchors))break;this.enemies.director.rewardsPending--;}
      while(this.objectives.rewardsPending>0){
        const totem=this.objectives.totems.filter(t=>t.state==='complete').at(-1)?.site.position;
        if(!this.interactables!.deliverWaveReward(this.rewardRng,[{position:this.objectives.nextRewardPosition,source:'kill' as const},{position:totem,source:'objective' as const}]))break;
        this.objectives.takeReward();
      }
      // A fenda fixa do celeiro só continua existindo nos modos legados (`?mode=horde`/`classic`).
      // Na expedição o estágio termina no PRÓPRIO cálice, onde quer que ele tenha caído.
      const riftReady=expedition?false:this.enemies.bossDeadTime>=5;
      this.interactables!.update(dt,riftReady);
      if(input.interact!==undefined){
        if(riftReady&&this.interactables!.atRift)this.advanceLegacyStage();
        else if(expedition&&this.beginStageJourney()){/* viagem iniciada no cálice cheio */}
        else if(expedition&&this.objectives.activate(this.player.position))this.audio.charge(1);
        else this.interactables!.buy(input.interact);
      }
    }

  }

  render(alpha: number): void {

    const now=performance.now();const dt=Math.min(.05,(now-this.lastRender)/1000);this.lastRender=now;

    const deathDt=this.paused?0:dt;
    if(this.death.active)this.deathFlight.update(deathDt);
    if(this.death.update(deathDt)){this.audio.setActive(false);this.hud.defeated(this.deathSummary!,!this.net&&this.enemies instanceof EnemySwarm?()=>this.restartAttempt():undefined);}
    if(this.death.active)this.hud.fatalReaction(true,this.death.progress);
    this.visual.deathProgress=this.death.state==='idle'?undefined:this.death.progress;
    this.visual.deathPosition=this.death.state==='idle'?undefined:this.deathFlight.position;
    const animDt=this.poseReview?1/60:this.meleeReview.active&&!this.paused?dt:this.paused||!this.started?0:dt;

    if(this.cinematic.active){if(this.cinematic.preparing){this.input.yaw=this.castYaw;this.input.pitch=this.castPitch;}if(!this.poseReview&&animDt>0&&this.voiceClock)this.cinematic.update(this.voiceClock(),tier=>{const clock=this.voiceClock!;this.visual.endPreparation();this.camera.update(this.player.position,this.castYaw,this.castPitch,dt);this.weapons.releaseSkill(tier,true,this.cinematic.duration-SKILL_CUES[tier].release,()=>Math.max(0,clock()-SKILL_CUES[tier].release));if(tier===2)this.player.barrageRetreat();});if(this.cinematic.preparing)this.visual.prepareSkill(this.cinematic.tier,this.cinematic.progress);}

    this.visual.skillPerformance=this.cinematic.active&&!this.cinematic.preparing?{tier:this.cinematic.tier,progress:this.cinematic.actionProgress}:undefined;
    // A revisão do F1 usa o MESMO contrato de pose do combate real, com relógio próprio.
    if(this.meleeReview.active)this.meleeReview.update(this.paused?0:dt);
    this.visual.unarmedStance=!this.unarmed.armed;
    this.visual.meleeRate=this.unarmed.rateMultiplier;
    this.visual.meleePose=this.meleeReview.active?this.meleeReview.pose
      :this.unarmed.busy?{stepId:this.unarmed.step.id,phase:this.unarmed.phase,progress:this.unarmed.phaseProgress,heavy:this.unarmed.heavy}:undefined;
    // A continuação entra quando a atuação original termina, sem cortar a fala nem os áudios originais.
    if(this.continuationTier!==undefined&&!this.cinematic.active){
      const tier=this.continuationTier;this.continuationTier=undefined;
      this.weapons.releaseSkill(tier);
      if(tier===2)this.player.barrageRetreat();
      this.audio.charge(tier);
    }
    this.cutIn.update(this.cinematic,this.started&&!this.paused);

    this.slowMotion.update(dt);
    const slow=this.slowMotion.scale;
    const worldDt=this.intro.holdsControl||this.journey.holdsControl||this.meleeReview.active||this.cinematic.preparing||this.skillPending?0:animDt*slow;

    if(this.enemies instanceof EnemySwarm&&animDt>0)this.enemies.updateBudget(animDt,this.scene.getEngine().getDeltaTime());

    this.audio.update(animDt,this.enemies instanceof EnemySwarm?this.enemies.director.state:0);

    // ---- Entrada pela nave -------------------------------------------------------------------
    // A espera no menu corre no relógio real (o jogador ainda não apertou Jogar); a sequência
    // depois segue o mesmo `animDt` da apresentação, então pausar congela tudo junto.
    if(!this.hasArrived&&!this.started&&this.death.state==='idle'&&this.visual.ready&&this.weapons.ready)this.intro.beginStandby();
    this.intro.update(this.death.active?0:this.intro.standby?(this.paused?0:dt):animDt,cue=>this.introCue(cue));
    // ---- Conclusão do estágio: suco, embarque, viagem e chegada -------------------------------
    // Roda no relógio de apresentação: pausar congela a transição inteira junto com o resto.
    const journeyDt=this.paused?0:dt;
    this.updateJourney(journeyDt);
    // Falha de plano no arranque (ou ao reiniciar): tenta de novo sozinho, sem travar o carregamento.
    if(this.planRetry>0&&!this.planning){this.planRetry-=dt;if(this.planRetry<=0)this.ensureStagePlan();}
    // Uma falha de rota espera sozinha, mas o `E` antecipa a nova tentativa. O passo fixo está
    // retido aqui, então consumir a entrada também evita um `E` acumulado disparar ao voltar.
    if(this.journey.failed&&this.input.read().interact!==undefined)this.journey.retryNow();
    const boarding=this.journey.phase==='board'||this.journey.phase==='travel';
    const extraction=this.dropship?.ready?extractionPresentation(this.journey.phase,this.journey.clock,this.player.position,this.player.yaw):undefined;

    const landing=this.player.position,introPose=this.intro.pose(landing,this.player.yaw);
    if(this.dropship){
      if(this.intro.visible)this.dropship.place(this.intro.deckEdge(landing,this.player.yaw),this.player.yaw);
      else if(extraction)this.dropship.place(extraction.edge,extraction.shipYaw);
      this.dropship.update(this.paused?0:dt,this.intro.deckVisible||boarding);
    }
    this.hud.liveFlightMenu(this.intro.standby,(this.intro.holdsControl||this.journey.holdsControl)&&this.started);
    this.hud.arrivalReveal(this.intro.holdsControl&&this.started&&!this.paused,this.intro.reveal);
    this.hud.skipIntro(this.intro.holdsControl&&this.started&&!this.paused);
    const flight=this.intro.flight;
    this.visual.arrivalPose=introPose?{
      sway:introPose.roll,rootLift:introPose.stride?0:flight.rootLift,
      height:flight.height,recovery:flight.recovery,dive:flight.dive,
      time:introPose.flutterTime,flutter:introPose.flutter,position:introPose.position,
      stride:introPose.stride,
    }:extraction?{height:0,recovery:0,position:extraction.body,
      stride:{clip:extraction.clip,progress:extraction.progress,yaw:this.player.yaw,pitch:0,roll:0}}:undefined;
    if(extraction&&this.dropship&&(this.journey.phase==='travel'||this.journey.clock>=1.85))
      extraction.body.y+=this.dropship.root.position.y-extraction.edge.y;
    this.visual.update(this.player,alpha,this.death.active?deathDt:this.intro.standby?dt:animDt*slow,!this.player.sprinting||this.charging,this.charging,this.input.pitch,this.mp.seconds/2.6);
    this.net?.render(animDt);

    this.camera.setSprint(this.player.sprinting&&this.started&&!this.paused);
    this.camera.update(this.visual.position,this.input.yaw,this.input.pitch,dt,this.started&&!this.intro.visible?this.player.velocity:undefined);

    const shot=this.intro.shot(landing,this.player.yaw);
    if(shot&&shot.weight>0){
      // `weight` cai sozinho na recuperação: a câmera volta ao jogo sem corte e sem ficar presa.
      const normalTarget=this.camera.camera.position.add(this.camera.forward.scale(6));
      this.camera.camera.position.copyFrom(Vector3.Lerp(this.camera.camera.position,new Vector3(shot.position.x,shot.position.y,shot.position.z),shot.weight));
      this.camera.camera.setTarget(Vector3.Lerp(normalTarget,new Vector3(shot.target.x,shot.target.y,shot.target.z),shot.weight));
      this.camera.sprintBlendTarget=shot.sprint*shot.weight;
    }

    if(this.death.active)this.camera.skillClose(this.deathFlight.position,this.player.yaw,1,this.death.progress);
    if(this.cinematic.preparing)this.camera.skillClose(this.visual.position,this.castYaw,this.cinematic.tier,this.cinematic.progress);
    if(extraction){
      this.camera.camera.position.copyFromFloats(extraction.camera.x,extraction.camera.y,extraction.camera.z);
      this.camera.camera.setTarget(new Vector3(extraction.target.x,extraction.target.y,extraction.target.z));
    }
    if(this.meleeReview.active){
      // Corpo inteiro no quadro: pés e punho ao mesmo tempo, sem a aproximação das cinemáticas.
      const review=meleeReviewShot(this.visual.position,this.input.yaw);
      // The regular camera is reset above on every frame; blending from it never reaches this shot.
      this.camera.camera.position.copyFromFloats(review.position.x,review.position.y,review.position.z);
      this.camera.camera.setTarget(new Vector3(review.target.x,review.target.y,review.target.z));
    }

    this.weapons.updatePose(worldDt);this.skillAura.update(this.cinematic,this.visual.position,this.weapons);
    this.elements.update(this.poseReview?0:animDt);if(this.intro.phase==='dive'&&introPose)this.elements.aura('fire',[new Vector3(introPose.position.x,introPose.position.y+.4,introPose.position.z)],flight.elapsed,1);
    if(this.elementPreview&&animDt>0){this.elementClock-=animDt;if(this.elementClock<=0){this.elementClock=1.6;const p=this.visual.position.add(this.camera.forward.scale(2.4));p.y=this.player.position.y+.03;this.elements.emit(this.elementPreview,p);}}
    if(this.cinematic.active){const elapsed=this.cinematic.elapsed,power=this.cinematic.preparing?Math.sin(this.cinematic.progress*Math.PI/2):Math.min(1,(1-this.cinematic.actionProgress)*5);this.elements.aura('electricity',[this.weapons.muzzlePose(0).position,this.weapons.muzzlePose(1).position,this.visual.position.add(new Vector3(0,.6,0))],elapsed,power);if(elapsed<this.auraLast)this.auraClock=0;if(this.cinematic.preparing&&elapsed>=this.auraClock&&elapsed<.9){this.auraClock=elapsed+.3;this.elements.emit('earth',this.visual.position,.45);}this.auraLast=elapsed;}else if(this.auraLast>=0){this.elements.clear();this.auraLast=-1;this.auraClock=0;}



    this.enemies.update(worldDt);this.footing.update(worldDt);this.abyss?.update(worldDt);
    this.expeditionSites?.update(animDt,this.objectives.totems,this.objectives.activeIndex,
      this.objectives.collected?(this.journey.phase==='harvest'?this.journey.clock/1.8:1):0,this.objectives.discovered);
    // Clima: relógio real + crédito por abates; a chuva viaja com a câmera.
    this.weather.paused=this.paused||!this.started;
    this.weather.update(animDt,this.enemies instanceof EnemySwarm?this.enemies.kills:0);
    this.weatherView?.update(this.weather,this.camera.camera.position,animDt);

    if(this.enemies instanceof EnemySwarm)this.enemies.updateCameraVisibility(this.camera.camera.position,dt);

    if(this.yard instanceof FarmWorld)this.yard.update(worldDt);

    for(const target of this.yard.targets)if(target.ring)target.ring.scaling.setAll(1+(target.ring.scaling.x-1)*Math.exp(-dt*18));

    this.scene.physicsEnabled=this.started&&!this.paused&&!this.intro.holdsControl&&!this.meleeReview.active&&!this.cinematic.preparing&&!this.skillPending;this.scene.render();this.hud.update(this.player,this.weapons,this.visual.error||this.weapons.error||this.skillAura.error||this.enemies.error||this.interactables?.error||(this.yard instanceof FarmWorld?this.yard.error:''),this.mp,this.enemies,animDt);

    if(this.enemies instanceof EnemySwarm){
      this.runHUD!.setVisible(this.started&&this.player.hp>0);
      // Distâncias e alcance de interação usam o corpo do jogador; a câmera só orienta a seta.
      this.runHUD!.update(this.progression,this.enemies,this.interactables!,this.camera.camera,{objectives:this.objectives,resonance:this.resonance,mp:this.mp,player:this.player.position,weather:this.weather,journey:this.journey});
      if(this.journey.active){
        this.hud.setObjective(`${this.journey.label} · ${this.journey.detail}`);
      } else if(this.objectives.planned){
        const pending=this.objectives.nearestPending(this.player.position);
        const target=this.objectives.totems[0];
        this.hud.setObjective(this.objectives.phase==='extract'
            ?(this.objectives.collectable(this.player.position)?'[E] Recolher o suco e embarcar'
              :`Volte ao cálice e embarque · ${target?Math.round(Math.hypot(target.site.position.x-this.player.position.x,target.site.position.z-this.player.position.z)):0} m`)
          :this.objectives.phase==='boss'?'Horda final · encha o cálice e derrote o chefe'
          :this.objectives.discovered&&pending?`Cálice encontrado · ${Math.round(pending.distance)} m`
          :'Explore as ilhas · saqueie baús e encontre o cálice');
      }
      this.hud.stageJourney(this.journey);
    }

  }

  /**
   * Sinais da entrada: passo no deck, salto, vento da queda, impacto no chão e o corpo levantando.
   * Só gravações já licenciadas do manifest — nada novo e nada sintético.
   */
  private introCue(cue:IntroCue):void {
    const at=new Vector3(this.player.position.x,this.player.position.y,this.player.position.z);
    if(cue==='step'){this.audio.footstep('concrete',1.7);return;}
    if(cue==='launch'){this.audio.skill('jump');this.audio.arrivalWind(.5);this.camera.impulse(.028);return;}
    if(cue==='wind'){this.audio.arrivalWind(Math.min(1,.35+this.intro.flight.flutter));return;}
    if(cue==='impact'){
      this.elements.aura('fire',[],0,0);
      this.elements.emit('explosion',at,1.3);this.elements.emit('earth',at,1.5);
      this.footing.impactCracks(this.player.position);
      this.audio.impact(true);this.audio.skill('meteor-impact');this.camera.hurt(.10,1);
      return;
    }
    if(cue==='rise')this.audio.arrivalRise();
  }

  /**
   * Pular a entrada. O corpo termina de pé no ponto de pouso, o impacto ainda é ouvido e visto, a
   * câmera volta ao jogo pelo mesmo caminho do fim natural e o controle é liberado no mesmo
   * instante — nunca antes.
   */
  skipIntro():void {
    if(!this.intro.holdsControl)return;
    this.intro.skip(cue=>this.introCue(cue));
    this.dropship?.update(0,false);
    this.hud.skipIntro(false);
    this.hud.arrivalReveal(false,1);
  }

  /** Entra na revisão do combo desarmado guardando origem, mira e guarda das armas. */
  private beginMeleeReview():void {
    if(this.meleeReview.active)return;
    this.intro.abort();this.cancelCinematic();this.weapons.cancelSkills();
    this.meleeReviewReturn={position:{x:this.player.position.x,y:this.player.position.y,z:this.player.position.z},yaw:this.input.yaw,pitch:this.input.pitch,armed:this.unarmed.armed};
    this.unarmed.reset();this.unarmed.armed=false;this.weapons.holstered=true;
    this.player.velocity.x=0;this.player.velocity.z=0;this.player.sprinting=false;
    this.audio.setActive(false);
    this.meleeReview.enter();
  }
  /** Saída limpa: pose apagada, armas de volta como estavam e o corpo na origem guardada. */
  private endMeleeReview():void {
    if(!this.meleeReview.active)return;
    this.meleeReview.exit();
    this.visual.meleePose=undefined;
    const back=this.meleeReviewReturn;this.meleeReviewReturn=undefined;
    if(back){
      this.player.resetAt(back.position);this.input.yaw=back.yaw;this.input.pitch=back.pitch;
      this.unarmed.armed=back.armed;this.weapons.holstered=!back.armed;
    }
    this.audio.setActive(this.started&&!this.paused);
  }

  /** Resumo da tentativa com o estado real do modo em curso (marcos da expedição ou hordas). */
  private summarize():ReturnType<typeof attemptSummary> {
    const swarm=this.enemies instanceof EnemySwarm?this.enemies:undefined;
    return attemptSummary(this.progression,swarm?.director.wave??1,swarm?.director.completedWaves??0,
      this.directorMode==='expedition'&&this.objectives.planned
        ?{mode:'expedition',completed:this.objectives.completed,total:this.objectives.total,phase:this.objectives.phase,bossDefeated:this.objectives.bossDefeated}
        :{mode:this.directorMode});
  }

  /**
   * Comprimento da rota REALMENTE percorrível entre dois pontos, em metros.
   *
   * Consulta o Detour e soma a polilinha que ele devolve (`computePath` já entrega o caminho
   * suavizado pelo funil, que é por onde um corpo andaria). A reta entre as âncoras não serve para
   * isto: ela atravessa o vão entre as ilhas, onde não há chão nenhum — era por isso que um cálice
   * "a 140 m" podia estar na ilha colada do outro lado de uma ponte curta.
   *
   * `undefined` quando não existe rota; é também a checagem de alcançabilidade do par. Sem malha de
   * navegação (testes e modos sem `EnemySwarm`) devolve a reta, porque ali não há o que medir e
   * recusar tudo travaria o carregamento por falta de ferramenta, não por falta de mapa.
   */
  private routeLength(from:Vec3,to:Vec3):number|undefined {
    const tactical=this.enemies instanceof EnemySwarm?this.enemies.tactical:undefined;
    if(!tactical)return Math.hypot(from.x-to.x,from.z-to.z);
    const start=tactical.closest(from);
    if(!start||Math.hypot(start.x-from.x,start.z-from.z)>1.4)return undefined;
    const route=tactical.query.computePath(start,to,{maxPathPolys:2048,maxStraightPathPoints:2048});
    const path=route.success?route.path:undefined;
    if(!path?.length)return undefined;
    // Caminho que para longe do destino é caminho truncado: o cálice não está ligado à partida.
    const end=path[path.length-1]!;
    if(Math.hypot(end.x-to.x,end.z-to.z)>3)return undefined;
    let length=0;
    for(let i=1;i<path.length;i++)length+=Math.hypot(path[i]!.x-path[i-1]!.x,path[i]!.z-path[i-1]!.z);
    return length;
  }

  /**
   * Valida um par (ilha de partida, ilha do cálice) do bioma do estágio.
   *
   * A partida precisa de piso de TOPO com espaço acima e apoio em volta; o cálice precisa de arena
   * larga e contínua; e tem de existir rota de navegação real entre os dois pontos, separados pelo
   * mínimo do bioma. Sem par válido devolve `undefined` — não existe aproximação de emergência.
   *
   * Síncrono de propósito: a região do bioma já tem de estar residente quando isto roda.
   */
  private buildStageSetup(stage:number):StageSetup|undefined {
    if(!(this.enemies instanceof EnemySwarm)||!this.enemies.navigationReady)return undefined;
    if(this.yard instanceof FarmWorld&&!this.yard.ready)return undefined;
    const swarm=this.enemies,world=this.collision,biome=biomeForStage(stage);
    // Os tiles distantes são podados durante o jogo; uma rota entre ilhas os atravessa inteira.
    swarm.tactical?.restoreNavigation();
    const radii=new Map<string,number>();
    const rng=new RunRNG(`${this.attemptSeed}:stage:${stage}`).stream('scene');
    const plan=planStage(biome,rng,{
      spawnPoint:island=>findSpawnPoint(world,island),
      chalicePoint:island=>{
        for(const radius of [TOTEM_RADIUS,8.5,6.5]){
          const at=findTotemSite(world,island,radius,()=>true);
          if(at){radii.set(island.id,radius);return at;}
        }
        return undefined;
      },
      route:(spawn,chalice)=>this.routeLength(spawn,chalice),
    },{minRoute:biome.separation>=WIDE_ISLAND_SEPARATION?WIDE_MIN_ROUTE:HOME_MIN_ROUTE});
    if(!plan)return undefined;
    const site:TotemSite={id:plan.chaliceIsland.id,name:plan.chaliceIsland.name,index:0,
      position:plan.chalice,radius:radii.get(plan.chaliceIsland.id)??TOTEM_RADIUS,juiceTarget:FINAL_CHALICE_JUICE};
    const setup={plan,site};
    this.stagePlans.set(stage,setup);
    return setup;
  }

  /**
   * Carrega a região do bioma do estágio e valida o plano.
   *
   * É o mesmo caminho no arranque e durante a viagem. Uma falha (região que não carrega, nenhum par
   * de ilhas válido) NÃO avança nada: a viagem fica em espera, anuncia o motivo e tenta de novo;
   * inventário, nível e XP ficam intactos porque nada foi consumido.
   */
  private async loadStageDestination(stage:number):Promise<void> {
    if(this.directorMode!=='expedition'||this.disposed)return;
    const version=++this.planVersion;this.planning=true;this.planRetry=0;
    try{
      const biome=biomeForStage(stage);
      if(this.yard instanceof FarmWorld&&biome.region){
        const loaded=await this.yard.prepareVisit(biome.region);
        if(this.disposed||version!==this.planVersion)return;
        if(!loaded)throw Error(`A região ${biome.name} não carregou`);
      }
      const setup=this.buildStageSetup(stage);
      if(this.disposed||version!==this.planVersion)return;
      if(!setup)throw Error(`Sem par de ilhas válido em ${biome.name}`);
      this.planError='';this.pendingSetup=setup;
      if(this.journey.active)this.journey.routeReady();
      else this.applyStageSetup(setup,false);
    }catch(error){
      if(this.disposed||version!==this.planVersion)return;
      this.planError=error instanceof Error?error.message:'Falha ao preparar o estágio';
      if(this.journey.active)this.journey.routeFailed(this.planError);
      else this.planRetry=2;
    }finally{
      if(!this.disposed&&version===this.planVersion){this.planning=false;this.checkReady();}
    }
  }

  /**
   * Aplica o plano: cálice, partida, mira e — na chegada — o avanço de estágio e a entrada pela nave.
   *
   * `arrival` separa os dois usos. No arranque (e ao reiniciar) só posiciona; na chegada de uma
   * viagem também avança o estágio UMA vez (`consumeAdvance`), reinicia a horda e reencena a queda.
   * Inventário, nível e XP nunca são tocados aqui — `RunProgression.advanceStage` só converte os
   * créditos restantes em XP, que é a regra já existente e anunciada na interface.
   */
  private applyStageSetup(setup:StageSetup,arrival:boolean):void {
    if(this.disposed)return;
    const {plan,site}=setup;
    if(arrival){
      if(this.journey.consumeAdvance())this.progression.advanceStage();
      if(this.enemies instanceof EnemySwarm)this.enemies.nextStage();
      this.interactables?.reset();this.resonance.reset();this.bossRequestClock=0;
    }
    this.objectives.reset();this.objectives.setSites([site]);
    this.expeditionSites?.dispose();
    this.expeditionSites=new ExpeditionSites(this.scene,this.collision);
    void this.expeditionSites.load(this.objectives.totems);
    this.stageSetup=setup;this.pendingSetup=undefined;this.planReady=true;this.planError='';
    this.spawn.set(plan.spawn.x,plan.spawn.y,plan.spawn.z);
    // Fora da chegada, um plano que resolve tarde nunca teleporta um jogo já em curso.
    if(arrival||!this.started){
      this.player.maxHP=this.progression.stats.maxHP;
      // `arriveAt` (e não `resetAt`) reescreve TAMBÉM a origem de recuperação do motor: depois de
      // viajar, cair de uma ilha do bosque não pode devolver o corpo ao campo inicial do estágio 1.
      this.player.arriveAt(this.spawn);
      this.mp.cancel();this.cancelCinematic();this.weapons.cancelSkills();this.input.clear();
      // De frente para o destino: a bússola do HUD e o corpo apontam para o mesmo lado.
      this.input.yaw=Math.atan2(plan.chalice.x-plan.spawn.x,plan.chalice.z-plan.spawn.z);
      this.input.pitch=.02;this.player.yaw=this.input.yaw;
      this.camera.update(this.player.position,this.input.yaw,this.input.pitch,1);
    }
    if(!arrival)return;
    this.events.emit('StageStarted',{stageId:String(this.progression.stage),seed:this.seed});
    // A chegada é a MESMA entrada pela nave do início da expedição: deck, corrida, salto e mergulho.
    this.intro.reset();this.intro.beginStandby();this.hasArrived=true;
    this.intro.start(Boolean(this.dropship?.ready));
    this.started=true;this.audio.setActive(true);
  }

  /**
   * `E` no cálice cheio: recolhe o suco e larga a conclusão do estágio.
   * Devolve `false` quando não há nada a recolher ou quando uma viagem já está em curso.
   */
  private beginStageJourney():boolean {
    if(this.directorMode!=='expedition'||this.journey.active)return false;
    if(!this.objectives.collect(this.player.position))return false;
    const destination=nextBiomeForStage(this.progression.stage);
    if(!this.journey.begin(this.progression.stage,destination.name)){this.objectives.collected=false;return false;}
    // Congela o que é perigoso: o diretor para e o passo fixo inteiro fica retido por `holdsControl`.
    if(this.enemies instanceof EnemySwarm)this.enemies.director.stopped=true;
    this.mp.cancel();this.cancelCinematic();this.weapons.cancelSkills();
    this.unarmed.reset();this.visual.meleePose=undefined;
    this.player.sprinting=false;this.player.velocity.x=0;this.player.velocity.z=0;
    this.journeyCue('collect');
    return true;
  }

  /** Sons da transição — só gravações já licenciadas, nada novo. */
  private journeyCue(cue:JourneyCue):void {
    if(cue==='collect'){this.audio.charge(2);this.camera.impulse(.03);return;}
    if(cue==='board'){this.audio.charge(1);return;}
    if(cue==='launch'){this.audio.arrivalWind(.45);return;}
    if(cue==='arrive')this.audio.charge(3);
  }

  /**
   * Conduz a viagem por quadro: relógio, pedido de carregamento e aplicação do plano na chegada.
   * A nave fica visível durante o embarque e a viagem, e a chegada devolve o controle à entrada.
   */
  private updateJourney(dt:number):void {
    if(!this.journey.active&&this.journey.phase!=='done')return;
    this.journey.update(dt,cue=>this.journeyCue(cue));
    if(this.journey.takeLoadRequest())void this.loadStageDestination(this.progression.stage+1);
    if(this.journey.takeArrival()){
      const setup=this.pendingSetup;
      // `routeReady` só é chamado com plano em mãos; sem ele a viagem volta a esperar.
      if(setup)this.applyStageSetup(setup,true);
      else{this.journey.returnToTravel('Plano do destino perdido');return;}
    }
    if(this.journey.phase==='arrival'&&this.intro.consumed)this.journey.arrived();
    if(this.journey.phase==='done')this.journey.reset();
  }
  /** Marcos, pressão do diretor, chefe do último evento e sua recuperação. */
  private updateExpedition(dt:number,swarm:EnemySwarm):void {
    const objectives=this.objectives;
    objectives.chargeMultiplier=this.resonance.chargeMultiplier;
    this.resonance.update(dt);
    objectives.update(dt,this.player.position,this.player.hp>0);
    // Exploração mantém a abertura suave; o evento eleva a reposição e o teto de hostis.
    // O acréscimo da horda final cresce com o NÍVEL do exterminador em vez do `+12` fixo de antes,
    // então ativar o cálice cedo traz uma horda proporcionalmente menor — sem portão de nível.
    swarm.director.pressure=objectives.phase==='boss'?1:0;
    swarm.director.pressureCap=finalHordePressure(this.progression.level);
    if(objectives.phase==='boss'&&!objectives.bossDefeated){
      this.bossRequestClock=Math.max(0,this.bossRequestClock-dt);
      if(!objectives.bossSpawned){
        if(this.bossRequestClock<=0){if(swarm.requestBoss())objectives.bossSpawned=true;else this.bossRequestClock=1.5;}
      } else {
        objectives.updateBoss(dt,swarm.bossReachable);
        if(objectives.needsBossRecovery&&swarm.recoverBoss())objectives.recoveredBoss();
      }
      if(objectives.bossSpawned&&swarm.boss?.health.dead)objectives.onBossKilled(swarm.boss.root.position);
    }
    // Cálice cheio e chefe morto: a horda para e o estágio fica pronto para ser concluído no cálice.
    if(objectives.phase==='extract'&&!swarm.director.stopped){swarm.director.stopped=true;this.events.emit('StageCompleted',{stageId:String(this.progression.stage)});}
  }
  /**
   * Resolve a etapa ativa do combo: alcance, cone e linha de visão reais.
   * Cada alvo recebe dano uma única vez por etapa — `canHit`/`registerHit` garantem isso.
   */
  private resolveMelee():void {
    if(!(this.enemies instanceof EnemySwarm))return;
    const step=this.unarmed.step,origin=this.player.position,yaw=this.input.yaw;
    const heavy=this.unarmed.heavy;
    for(const actor of this.enemies.actors){
      if(!actor.active||actor.health.dead||!this.unarmed.canHit(actor.id))continue;
      const target=actor.root.position,radius=ENEMIES[actor.kind].radius*ENEMY_AFFIXES[actor.variant].scale;
      if(!meleeReaches(step,origin,yaw,target,radius))continue;
      const dx=target.x-origin.x,dz=target.z-origin.z,length=Math.hypot(dx,dz)||1;
      // Sem atravessar cobertura: a varredura sai do peito até o corpo do alvo.
      const chest={x:origin.x,y:origin.y+1.1,z:origin.z};
      if(this.collision.sweepSphere(chest,{x:dx,y:target.y+1-chest.y,z:dz},.12))continue;
      this.unarmed.registerHit(actor.id);
      const damage=step.damage*this.progression.stats.damage;
      actor.target.onHit?.({attackerId:1,victimId:actor.id,sourceId:'unarmed_'+step.id,attackId:step.id,baseDamage:step.damage,finalDamage:damage,crit:false,procCoefficient:.8,procChainDepth:0,
        damageTags:heavy?['melee','melee_heavy']:['melee'],
        hitPosition:{x:target.x,y:target.y+1.1,z:target.z},hitNormal:{x:-dx/length,y:0,z:-dz/length},
        forceDirection:{x:dx/length,y:0,z:dz/length},forceMagnitude:step.force});
      this.events.emit('DamageDealt',{attackerId:1,victimId:actor.id,sourceId:'unarmed_'+step.id,attackId:step.id,baseDamage:step.damage,finalDamage:damage,crit:false,procCoefficient:.8,procChainDepth:0,damageTags:heavy?['melee','melee_heavy']:['melee'],hitPosition:{x:target.x,y:target.y+1.1,z:target.z},hitNormal:{x:-dx/length,y:0,z:-dz/length},forceDirection:{x:dx/length,y:0,z:dz/length},forceMagnitude:step.force});
      this.camera.impulse(heavy?.03:.014);this.audio.skillImpact('unarmed_'+step.id);
    }
  }
  /**
   * Avanço dos modos legados (`?mode=horde` e `?mode=classic`), que continuam com a fenda do celeiro
   * e com o campo inicial fixo. A expedição não passa por aqui: ela usa a `StageJourney`.
   */
  private advanceLegacyStage():void {
    if(!(this.enemies instanceof EnemySwarm)||this.directorMode==='expedition')return;
    this.progression.advanceStage();this.enemies.nextStage();this.interactables!.reset();
    this.objectives.reset();this.resonance.reset();
    this.player.maxHP=this.progression.stats.maxHP;this.player.resetAt(this.spawn);
    this.mp.cancel();this.cancelCinematic();this.weapons.cancelSkills();
    this.events.emit('StageStarted',{stageId:String(this.progression.stage),seed:this.seed});
  }
  private async requestSkill(tier:SkillTier):Promise<void>{

    if(this.skillPending||this.cinematic.active||this.weapons.magazine.reloading||this.player.hp<=0)return;

    Object.assign(this.player.previous,this.player.position);this.skillPending=true;const version=++this.castVersion;this.player.sprinting=false;this.castYaw=this.input.yaw;this.castPitch=this.input.pitch;

    try{const clock=await this.audio.voice(tier);if(this.disposed||version!==this.castVersion)return;this.voiceClock=clock.clock;this.cinematic.start(tier,clock.duration);this.visual.prepareSkill(tier,0);}

    catch(error){if(this.disposed||version!==this.castVersion)return;console.warn('Cinemática sem áudio disponível',error);this.weapons.releaseSkill(tier);if(tier===2)this.player.barrageRetreat();}

    finally{this.skillPending=false;}

  }

  private async restartAttempt():Promise<void> {
    this.death.reset();this.deathSummary=undefined;this.started=false;
    this.cancelCinematic();this.progression.reset();this.weapons.resetAttempt();this.visual.resetAttempt();this.mp.cancel();this.mp.current=this.mp.maximum;this.mp.releases=0;this.mp.speedMultiplier=1;
    if(this.enemies instanceof EnemySwarm)this.enemies.nextStage();this.interactables?.reset();this.objectives.reset();this.resonance.reset();this.slowMotion.reset();this.weather.reset();this.unarmed.resetAttempt();this.weapons.holstered=false;this.bossRequestClock=0;
    // A viagem volta ao zero e o estágio 1 é replanejado: nada de herdar a partida do estágio onde
    // a tentativa terminou.
    this.journey.reset();this.pendingSetup=undefined;
    // Tentativa nova é EXPEDIÇÃO nova: sorteia outra semente e joga fora os planos da anterior,
    // senão o cache devolveria a mesma ilha de partida e o mesmo cálice para sempre. Preso por
    // `?replay=1` ou `?online=1`, a semente e os planos ficam — repetir é o pedido ali.
    const seed=retrySeed({pinned:this.seedLocked,seed:this.attemptSeed});
    if(seed!==this.attemptSeed){this.attemptSeed=seed;this.stagePlans.clear();}
    let destination:Promise<void>|undefined;
    if(this.stagePlanRequired){
      const cached=this.stagePlans.get(1);
      this.planReady=false;this.planError='';this.stageSetup=undefined;
      if(cached)this.spawn.set(cached.plan.spawn.x,cached.plan.spawn.y,cached.plan.spawn.z);
      destination=this.loadStageDestination(1);
    }
    this.player.maxHP=this.progression.stats.maxHP;this.player.moveMultiplier=1;this.player.jumpMultiplier=1;this.player.extraJumps=0;this.player.rechargeMultiplier=1;this.player.armor=0;this.player.regeneration=1;this.player.debugInvincible=false;
    this.player.arriveAt(this.spawn);this.player.jumps=0;this.player.dodges=0;this.player.respawns=0;this.player.solidRecoveries=0;this.player.wallJumps=0;
    // A entrada volta ao zero: nada de corpo suspenso, câmera presa ou deck sobrando em cena.
    this.reloadRunReview=0;this.intro.reset();this.endMeleeReview();this.dropship?.update(0,false);this.hasArrived=false;this.paused=false;this.input.clear();this.input.yaw=-.13;this.input.pitch=.02;this.camera.update(this.player.position,this.input.yaw,this.input.pitch,1);
    // The retry button must wait for the NEW island before starting the arrival cinematic.
    await destination;
    if(this.stagePlanRequired&&!this.planReady)throw Error(this.planError||'A nova ilha ainda não carregou. Tente novamente.');
  }
  private cancelCinematic():void{this.continuationTier=undefined;this.chargingPressed=false;this.elements?.clear();this.auraClock=0;this.auraLast=-1;this.poseReview=false;this.castVersion++;this.skillPending=false;this.cinematic.cancel();this.visual.endPreparation();this.audio.cancelVoice();}

  get isPaused():boolean {return this.paused;}
  setPaused(paused: boolean): void {this.paused=paused;this.input.clear();this.mp.cancel();this.audio.setActive(!paused&&(this.started||this.death.active));}

  /**
   * Linha de diagnóstico do plano em vigor: bioma, ilha de partida, ilha do cálice e a distância
   * realmente medida entre os dois pontos. É por aqui que o QA confere "ilhas diferentes, longe".
   */
  get stagePlanDescription():string {
    if(this.directorMode!=='expedition')return 'Rota de estágio: modo legado (campo fixo)';
    const setup=this.stageSetup;
    if(!setup)return `Rota de estágio: ${this.planError||(this.planning?'planejando…':'sem plano')}`;
    const {plan}=setup;
    // O comprimento que importa é o PERCORRIDO; a reta vai junto só para comparar. `shortfall`
    // aparece escrito porque um cálice abaixo do piso nunca pode passar despercebido.
    return `Rota de estágio: ${plan.biome.name} · partida ${plan.spawnIsland.name} · cálice ${plan.chaliceIsland.name}`
      +` · caminhada ${Math.round(plan.routeLength)} m (mínimo ${plan.minRoute})${plan.shortfall?' · ABAIXO DO PISO':''}`
      +` · reta ${Math.round(plan.distance)} m (mínimo ${plan.biome.separation})`
      +` · semente ${this.attemptSeed}${this.seedLocked?' (presa)':''} · viagem ${this.journey.phase}`;
  }

  /** O plano do estágio é exigência de arranque: sem ele o objetivo ficaria indefinido. */
  private get stagePlanRequired():boolean {return this.directorMode==='expedition';}
  private get stagePlanSettled():boolean {return !this.stagePlanRequired||this.planReady;}
  /**
   * Pede o plano do estágio corrente quando as dependências ficam prontas.
   * Idempotente: um pedido em curso ou um plano válido não disparam outro.
   */
  private ensureStagePlan():void {
    if(!this.stagePlanRequired||this.planReady||this.planning||this.planRetry>0||this.journey.active||this.disposed)return;
    if(!(this.enemies instanceof EnemySwarm)||!this.enemies.navigationReady)return;
    if(this.yard instanceof FarmWorld&&!this.yard.ready)return;
    void this.loadStageDestination(this.progression.stage);
  }

  private checkReady():void {this.ensureStagePlan();
    // A nave entra na lista: o menu vivo mostra o corpo em pé no deck, então o deck precisa existir
    // antes do Jogar. Uma falha de carga NÃO trava o boot — a entrada cai no mergulho original.
    const deckReady=!this.dropship||this.dropship.ready||Boolean(this.dropship.error);
    // O plano da expedição é o nono estágio de carga: o Jogar só libera com partida e cálice válidos.
    const planned=this.stagePlanSettled;
    const stages=[this.visual?.ready,this.weapons?.ready,this.skillAura?.ready,!(this.yard instanceof FarmWorld)||this.yard.ready,(!(this.enemies instanceof EnemySwarm)||this.enemies.ready),!(this.enemies instanceof EnemySwarm)||this.enemies.navigationReady,!this.interactables||this.interactables.ready,deckReady,planned];
    const label=this.planError?`FALHA NA ROTA · ${this.planError} · tentando de novo`
      :!planned?'SORTEANDO ILHA DE PARTIDA E CÁLICE'
      :stages.every(Boolean)?'PREPARANDO LUZ E MATERIAIS':'CARREGANDO FAZENDAS E ROTAS';
    this.hud?.loading(stages.filter(Boolean).length,stages.length,label);for(const material of this.scene.materials){const lit=material as typeof material & {maxSimultaneousLights?:number};if(lit.maxSimultaneousLights!==undefined&&lit.maxSimultaneousLights>4){lit.unfreeze();lit.maxSimultaneousLights=4;}}if(this.visual?.ready&&this.weapons?.ready&&this.skillAura?.ready&&(!(this.yard instanceof FarmWorld)||this.yard.ready)&&(!(this.enemies instanceof EnemySwarm)||(this.enemies.ready&&this.enemies.navigationReady))&&(!this.interactables||this.interactables.ready)&&deckReady&&planned){if(this.warming)return;this.warming=true;this.scene.executeWhenReady(()=>{if(!this.disposed)this.hud.ready();});}}

  configure(name: string,value: number): void {
    if(name.startsWith('weather-')){
      const phase=name.slice(8);
      if(phase==='auto')this.weather.manualPhase=undefined;
      else this.weather.manualPhase=phase as never;
    }
    if(name==='sky-raw')reviewSkyBlend(this.scene,false);
    if(name==='skinning-cpu')this.visual.setSkinning('cpu');
    if(name==='skinning-gpu')this.visual.setSkinning('auto');
    if(name==='sky-blended')reviewSkyBlend(this.scene,true);

    if((name==='city'||name==='frontier'||name==='grain-port'||name==='glasshouse'||name==='horizon-review'||name==='highlands'||name==='rootwood')&&this.yard instanceof FarmWorld){
      const id=name==='rootwood'?'rootwood':name==='city'?'farm-city':name==='highlands'?'highland-farms':'solar-frontier';void this.yard.prepareVisit(id).then(ready=>{if(!ready||this.disposed)return;this.intro.abort();this.endMeleeReview();this.cancelCinematic();this.player.resetAt(name==='rootwood'?{x:883,y:31.2,z:355}:name==='highlands'?{x:431,y:18.7,z:280}:name==='city'?{x:99,y:2.1,z:-9}:name==='frontier'?{x:248,y:9.1,z:21}:(name==='glasshouse'||name==='horizon-review')?{x:285,y:15.1,z:245}:{x:285,y:15.1,z:120});this.input.yaw=name==='horizon-review'?Math.atan2(-185,-173):(name==='highlands'||name==='rootwood')?Math.PI/2:0;this.input.pitch=.02;});
    }
    if((name==='eggplant-rush'||name==='carrot-laser')&&this.enemies instanceof EnemySwarm){this.intro.abort();this.endMeleeReview();this.cancelCinematic();this.enemies.nextStage();this.enemies.director.stopped=true;this.player.resetAt({x:0,y:0,z:-10});this.input.yaw=0;this.input.pitch=.05;this.player.hp=this.player.maxHP;this.player.debugInvincible=false;this.enemies.spawn(name==='carrot-laser'?'carrot':'eggplant',{x:0,y:0,z:-2},'normal');}
    if(name==='tomato-fire'&&this.enemies instanceof EnemySwarm){this.cancelCinematic();this.enemies.nextStage();this.enemies.director.stopped=true;this.player.hp=this.player.maxHP;this.player.debugInvincible=false;this.enemies.spawn('tomato',{x:this.player.position.x,y:this.player.position.y,z:this.player.position.z+10},'normal');}
    if(name==='camera-audit'){const ray=this.camera.camera.getForwardRay(8),hit=this.scene.pickWithRay(ray,m=>m.isEnabled()&&m.isVisible&&m.getTotalVertices()>0);this.cameraAudit='Pronto: '+[this.visual.ready,this.weapons.ready,this.skillAura.ready,(this.yard as FarmWorld).ready,(!(this.enemies instanceof EnemySwarm)||this.enemies.ready),(this.enemies as EnemySwarm).navigationReady,this.interactables?.ready,this.warming].join('/')+' · pendentes '+this.scene.getWaitingItemsCount()+' · meshes sem material pronto '+this.scene.meshes.filter(m=>m.isEnabled()&&!m.isReady(true)).slice(0,6).map(m=>m.name+':'+m.material?.name).join(',')+' · Câmera '+this.camera.camera.position.toString()+' · centro '+(hit?.pickedMesh?.name??'vazio')+' · material '+hit?.pickedMesh?.material?.name+' · distância '+hit?.distance+' · ritual '+this.scene.getTransformNodeByName('GroundSigilRoot')?.getAbsolutePosition().toString()+' / '+this.scene.getMeshByName('Ground_Runewheel')?.isEnabled()+' / '+this.scene.getMeshByName('Ground_Runewheel')?.scaling.toString()+' · jogador '+this.visual.meshes.map(m=>m.name+':vis='+m.visibility+',enabled='+m.isEnabled()+',visible='+m.isVisible+',scale='+m.scaling.toString()+',center='+m.getBoundingInfo().boundingBox.centerWorld.toString()).join('|');}
    if(name==='element-off'){this.elementPreview=undefined;this.elements.clear();}
    if(name.startsWith('element-')&&ELEMENTS.includes(name.slice(8) as ElementKind)){this.elementPreview=name.slice(8) as ElementKind;this.elementClock=0;}
    if(name.startsWith('pose-skill')){this.intro.abort();this.endMeleeReview();const tier=Number(name.slice(10)) as SkillTier;this.cancelCinematic();this.poseReview=true;this.audio.setActive(false);this.castYaw=this.input.yaw;this.castPitch=this.input.pitch;this.cinematic.start(tier,6);this.cinematic.elapsed=SKILL_CUES[tier].release*.94;this.visual.prepareSkill(tier,.94);for(const side of [0,1] as const)this.elements.emit('electricity',this.weapons.muzzlePose(side).position,.55);this.elements.update(.12);}
    if(name==='pose-end'){this.cancelCinematic();this.endMeleeReview();this.audio.setActive(this.started&&!this.paused);}
    // --- Entrada pela nave ---------------------------------------------------------------------
    if(name==='intro-skip')this.skipIntro();
    if(name==='intro-replay'){
      // Reencena a entrada inteira a partir do deck, sem mexer no estágio nem no inventário.
      this.endMeleeReview();this.cancelCinematic();this.mp.cancel();this.weapons.cancelSkills();
      this.intro.reset();this.intro.beginStandby();this.hasArrived=true;this.intro.start(Boolean(this.dropship?.ready));
      this.started=true;this.audio.setActive(true);
    }
    // --- Revisão do combo desarmado -------------------------------------------------------------
    if(name==='melee-review')this.beginMeleeReview();
    if(name==='melee-end')this.endMeleeReview();
    if(this.meleeReview.active){
      if(name==='melee-next')this.meleeReview.next();
      if(name==='melee-previous')this.meleeReview.previous();
      if(name==='melee-contact')this.meleeReview.holdContact();
      if(name==='melee-play')this.meleeReview.play();
      if(name==='melee-rate')this.meleeReview.cycleRate();
      if(name==='melee-frame')this.meleeReview.nudge(.02);
      if(name==='melee-frame-back')this.meleeReview.nudge(-.02);
    }
    if(name==='distance')this.camera.preferredDistance=value;

    if(name==='fov')this.camera.setFovDegrees(value);

    if(name==='shake')this.camera.shake=value;

    if(name==='reload-run'&&!this.net){this.reloadRunReview=2;this.player.sprinting=true;this.weapons.magazine.ammo=Math.min(20,this.weapons.magazine.ammo);this.weapons.requestReload();}
    if(name==='reload'){this.weapons.magazine.ammo=Math.min(20,this.weapons.magazine.ammo);this.weapons.requestReload();}
    if(name==='heal')this.player.hp=this.player.maxHP;

    if(name==='quality')applyLightingQuality(this.scene,value===1);

    if(name==='invincible')this.player.debugInvincible=!this.player.debugInvincible;

    if(name==='hit-player'||name==='fatal-player'){const damage=name==='fatal-player'?Math.max(1,this.player.hp):25;const invincible=this.player.debugInvincible;this.player.debugInvincible=false;this.player.invulnerable=0;this.player.applyDamage({attackerId:999,victimId:1,sourceId:'qa_enemy',attackId:'qa_damage',baseDamage:damage,finalDamage:damage,crit:false,procCoefficient:0,procChainDepth:0,damageTags:['enemy'],hitPosition:{...this.player.position},hitNormal:{x:1,y:0,z:0},forceDirection:{x:-1,y:0,z:0},forceMagnitude:2});this.player.debugInvincible=invincible;}

    if(name==='all-perks')for(const item of ITEMS)this.progression.addItem(item.id);
    if(name==='loot'){const ids=['pruner','battery','boot','watch','feather','goggles','bandage','belt','fire','harvest','bomb','crystal'];this.progression.addItem(ids[this.progression.inventory.size%ids.length]!);this.progression.credits+=100;}

    if(name==='ferry'){this.player.resetAt({x:-21,y:0,z:-8});this.input.yaw=-Math.PI/2;this.input.pitch=.10;}

    if(name==='review-cliff'){this.player.resetAt({x:9,y:0,z:12});this.input.yaw=-.28;this.input.pitch=-.09;}
    if(name==='review-east-bridge'){
      this.intro.abort();this.endMeleeReview();this.cancelCinematic();
      if(this.enemies instanceof EnemySwarm){this.enemies.nextStage();this.enemies.director.stopped=true;}
      this.player.resetAt({x:28,y:1,z:8});this.input.yaw=Math.PI/2;this.input.pitch=.02;
    }
    if((name==='review-chalice'||name==='complete-chalice')&&this.objectives.totems[0]){
      const at=this.objectives.totems[0].site.position;
      this.intro.abort();this.endMeleeReview();this.cancelCinematic();
      if(this.enemies instanceof EnemySwarm){this.enemies.nextStage();this.enemies.director.stopped=true;}
      this.player.resetAt({x:at.x,y:at.y+.2,z:at.z-2.5});this.input.yaw=0;this.input.pitch=.05;
      if(name==='complete-chalice'){
        this.objectives.activate(this.player.position);
        for(let i=0;i<30;i++)this.objectives.harvest({sequence:1_000_000+i,kind:'watermelon',position:at},this.player.position,true);
        this.objectives.onBossKilled(at);
      }
    }

    if(name==='barn')this.player.resetAt({x:0,y:5,z:30.8});

    if(name==='safe-return'){
      this.intro.abort();this.endMeleeReview();this.cancelCinematic();
      if(this.enemies instanceof EnemySwarm){this.enemies.nextStage();this.enemies.director.stopped=true;}
      this.player.resetAt({x:44,y:2,z:8});
      // Reproduce the report: saved checkpoint below the outpost, followed by a void fall.
      Object.assign(this.player.safe,{x:44,y:-5,z:8});
      Object.assign(this.player.position,{x:66,y:-30,z:8});
      this.player.grounded=false;this.player.velocity.y=-20;
      this.input.yaw=Math.PI/2;this.input.pitch=.02;
    }

    if(name==='shop')this.player.resetAt({x:3,y:0,z:1});

    if(name.startsWith('skill')&&this.started&&this.weapons.ready){const tier=Number(name.slice(5));if(tier===1||tier===2||tier===3){void this.requestSkill(tier);}}

    if(this.enemies instanceof EnemySwarm){

      if(name==='wave5'){this.enemies.nextStage();this.enemies.director.wave=5;this.enemies.director.intermission=2;}
      if(name==='wave-clear'){this.enemies.director.spawned=this.enemies.director.waveQuota;for(const a of this.enemies.actors)if(a.active&&!a.health.dead)a.target.onHit?.({attackerId:1,victimId:a.id,sourceId:'qa',attackId:'qa',baseDamage:999999,finalDamage:999999,crit:false,procCoefficient:0,procChainDepth:1,damageTags:['qa'],hitPosition:{x:a.root.position.x,y:a.root.position.y,z:a.root.position.z},hitNormal:{x:0,y:1,z:0},forceDirection:{x:0,y:0,z:1},forceMagnitude:0});}
      if(name==='normal-horde'){this.enemies.nextStage();this.enemies.director.stopped=true;this.enemies.populationCap=24;this.enemies.benchmark=false;for(let i=0;i<24;i++){const angle=i/24*Math.PI*2,p={x:this.player.position.x+Math.sin(angle)*15,y:this.player.position.y,z:this.player.position.z+Math.cos(angle)*17};const at=this.enemies.tactical?.closest(p);if(at)this.enemies.spawn((['eggplant','corn','watermelon','tomato','carrot'] as const)[i%5]!,at,'normal');}}

      if(name==='review-enemies'){this.enemies.nextStage();this.enemies.director.stopped=true;for(const [i,kind] of (['eggplant','corn','watermelon','tomato','carrot'] as const).entries()){const p={x:this.player.position.x+(i-2)*3,y:this.player.position.y,z:this.player.position.z+9};const at=this.enemies.tactical?.closest(p);if(at)this.enemies.spawn(kind,at);}}

      if(name==='hit-enemy'||name==='kill-enemy'){const a=this.enemies.actors.filter(a=>a.active&&!a.health.dead).sort((a,b)=>Math.hypot(a.root.position.x-this.player.position.x,a.root.position.z-this.player.position.z)-Math.hypot(b.root.position.x-this.player.position.x,b.root.position.z-this.player.position.z))[0];if(a){const damage=name==='kill-enemy'?999999:12;a.target.onHit?.({attackerId:1,victimId:a.id,sourceId:'qa',attackId:'qa',baseDamage:damage,finalDamage:damage,crit:false,procCoefficient:0,procChainDepth:1,damageTags:['qa'],hitPosition:{x:a.root.position.x,y:a.root.position.y+1,z:a.root.position.z},hitNormal:{x:0,y:0,z:-1},forceDirection:{x:0,y:0,z:1},forceMagnitude:3});}}

      if(name.startsWith('population')){const count=Number(name.slice(10))||50;this.enemies.benchmark=true;this.enemies.populationCap=count;this.enemies.initialize();for(let i=0;i<count;i++){const x=(i%15-7)*2.2,z=Math.floor(i/15)*2.2-4,y=this.yard.collision.groundAt(x,z,6);if(Number.isFinite(y))this.enemies.spawn((['eggplant','corn','watermelon','tomato','carrot'] as const)[i%5]!,{x,y,z});}}

      if(name==='boss'&&!this.enemies.boss){this.enemies.initialize();this.enemies.director.time=226;this.enemies.spawn('boss',{x:0,y:0,z:3});}

      if(name==='clear-boss'&&this.enemies.boss){const boss=this.enemies.boss;boss.target.onHit?.({attackerId:1,victimId:boss.id,sourceId:'debug',attackId:'debug',baseDamage:999999,finalDamage:999999,crit:false,procCoefficient:0,procChainDepth:1,damageTags:['debug'],hitPosition:{x:boss.root.position.x,y:boss.root.position.y,z:boss.root.position.z},hitNormal:{x:0,y:1,z:0},forceDirection:{x:0,y:0,z:1},forceMagnitude:5});}

    }

  }

  getDebug() {

    const pool=this.weapons.effects.pool.stats;

    return {entities:1+this.enemies.count,aiJobs:this.enemies instanceof EnemySwarm?this.enemies.scheduler.size:0,aiTicks:this.enemies instanceof EnemySwarm?this.enemies.scheduler.totalTicks:0,poolActive:pool.active+(this.enemies instanceof EnemySwarm?this.enemies.effects.active:0),poolCapacity:pool.capacity+(this.enemies instanceof EnemySwarm?320:0),poolPeak:pool.peak,poolMisses:pool.misses,definitions:this.enemies instanceof EnemySwarm?20:1,listeners:this.events.listenerCount,

      player:`${this.net?.debugLine()??''}${this.yard instanceof FarmWorld?this.yard.regionStatus:''}${this.cameraAudit}`
      +`\nEntrada ${this.intro.phase}${this.intro.skipped?' (pulada)':''} · deck ${this.dropship?this.dropship.error||(this.dropship.ready?'pronto':'carregando'):'treino'} · controle ${this.intro.holdsControl?'RETIDO':'livre'}`
      +`\n${this.stagePlanDescription}`
      +(this.meleeReview.active?`\nRevisão corpo a corpo · ${this.meleeReview.label} · voltas ${this.meleeReview.loops} · armas ${this.weapons.holstered?'guardadas':'EM MÃOS'}`:'')
      +`\nPosição${this.player.position.x.toFixed(1)}, ${this.player.position.y.toFixed(1)}, ${this.player.position.z.toFixed(1)}\nVelocidade ${Math.hypot(this.player.velocity.x,this.player.velocity.z).toFixed(2)} m/s · ${this.player.sprinting?'CORRENDO':'NORMAL'}\nMira ${this.input.yaw.toFixed(3)} / ${this.input.pitch.toFixed(3)}\nGrounded ${this.player.grounded} · Saltos ${this.player.jumps}\nEsquivas ${this.player.dodges} · Retornos ${this.player.respawns}\n${this.enemies instanceof EnemySwarm?this.enemies.tactical?.residencyDescription??'':''}\nNavmesh ${this.enemies instanceof EnemySwarm?this.enemies.tactical?.count??0:0} agentes · Ragdolls ${this.enemies instanceof EnemySwarm?this.enemies.ragdollCount:0} · Marcas ${this.weapons.effects.decalCount}\nDisparos ${this.weapons.cadence.shots} · Acertos ${this.weapons.hits}\nImpacto ${this.weapons.lastImpact}\nModelo ${this.visual.ready?'pronto':'carregando'} · ${this.visual.skinning}\nInvulnerabilidade QA ${this.player.debugInvincible?'ATIVA':'desligada'}\nDirector ${this.enemies instanceof EnemySwarm?this.enemies.director.state:'treino'} · Estágio ${this.progression.stage}`};

  }

  dispose(): void {if(this.disposed)return;this.disposed=true;
    // Invalida qualquer carregamento de destino em voo: o `.then` tardio vê a versão mudada e sai.
    this.planVersion++;this.planning=false;this.journey.reset();this.pendingSetup=undefined;this.stagePlans.clear();
    this.weatherView?.dispose();this.weatherView=undefined;this.dropship?.dispose();this.dropship=undefined;this.expeditionSites?.dispose();this.expeditionSites=undefined;this.net?.dispose();this.cancelCinematic();this.cutIn.dispose();this.skillAura.dispose();this.elements.dispose();if(this.yard instanceof FarmWorld)this.yard.dispose();this.input.dispose();this.enemies.dispose();this.runHUD?.dispose();this.interactables?.dispose();this.events.clear();this.weapons.dispose();this.footing.dispose();this.abyss?.dispose();this.visual.dispose();this.audio.dispose();this.hud.dispose();this.instrumentation.dispose();this.scene.dispose();}

}

















