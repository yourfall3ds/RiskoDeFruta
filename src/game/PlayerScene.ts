import {reloadMovement} from '../player/ReloadMovement';
import {DeathFlight} from '../player/DeathFlight';
import {DeathTimeline} from '../player/DeathTimeline';
import {attemptSummary} from '../run/AttemptSummary';
import {reviewSkyBlend} from '../rendering/SeamlessSky';
import {NetworkSession} from '../net/NetworkSession';
import {MeteorArrival} from '../player/MeteorArrival';
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

import type { GameEvents } from '../core/contracts';

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
  /** Sessão online (`?online=1`): predição local, reconciliação e remotos. `undefined` no single-player. */
  private net:NetworkSession|undefined;

  private charging=false;

  private cancelVersion=0;

  private reloadRunReview=0;private preflightClock=0;private started=false;private readonly arrival=new MeteorArrival();private hasArrived=false;private warming=false;

  private disposed=false;

  private lastRender=performance.now();

  constructor(engine: AbstractEngine,readonly seed: string) {

    this.scene=new Scene(engine);

    this.scene.skipPointerMovePicking=true;this.scene.skipPointerDownPicking=true;this.scene.skipPointerUpPicking=true;

    const rng=new RunRNG(seed);this.rewardRng=rng.stream('loot');

    const collision=new CollisionWorld();this.deathFlight=new DeathFlight(collision);

    this.camera=new ThirdPersonCamera(this.scene,collision);

    const shadows=trainingLighting(this.scene,this.camera.camera);

    const training=new URL(location.href).searchParams.get('mode')==='training';

    this.yard=training?new TrainingYard(this.scene,shadows,rng):new FarmWorld(this.scene,collision,shadows,!new URLSearchParams(location.search).get('online'));

    if(this.yard instanceof FarmWorld)void this.yard.load().then(async()=>{if(this.disposed)return;if(this.enemies instanceof EnemySwarm)await this.enemies.prepareNavigation();if(!this.disposed)this.checkReady();});

    if(training){collision.boxes.push(...this.yard.collision.boxes);collision.surfaces.push(...this.yard.collision.surfaces);}

    if(!training){this.spawn.x=rng.stream('spawn').range(-2,2);this.spawn.z=rng.stream('spawn').range(-17,-10);}

    this.player=new PlayerMotor(collision,this.events,this.spawn);

    this.enemies=training?new EnemyReview(this.scene,this.yard,this.events,shadows):new EnemySwarm(this.scene,this.yard,this.events,shadows,this.player,this.progression,rng,new URL(location.href).searchParams.get("mode")!=="expedition");if(this.enemies instanceof EnemySwarm)this.enemies.audio=this.audio;void this.enemies.load().then(()=>{if(!this.disposed)this.checkReady();});

    if(!training){this.runHUD=new RunHUD();this.interactables=new RunInteractables(this.scene,this.player,this.progression,this.events,rng.stream('interactable'),collision);void this.interactables.load(this.scene).then(()=>{if(!this.disposed)this.checkReady();});}

    this.hud=new PlayerHUD(()=>{if(this.progression.time===0)this.events.emit('StageStarted',{stageId:String(this.progression.stage),seed:this.seed});this.started=true;if(!this.hasArrived){this.hasArrived=true;this.arrival.start(this.preflightClock);}this.audio.unlock();this.audio.setActive(true);void this.input.capture();},!training,{volume:value=>this.audio.setVolume(value),quality:balanced=>applyLightingQuality(this.scene,balanced)});

    const canvas=engine.getRenderingCanvas()!;canvas.tabIndex=0;

    this.input=new GameInput(canvas,active=>{if(this.player.hp<=0){if(this.death.active)this.audio.setActive(!this.paused);return;}this.audio.setActive(active);this.started=active;this.hud.setActive(active);if(!active)this.mp.cancel();});

    if(!training){this.input.yaw=-.13;this.player.yaw=this.input.yaw;}

    this.visual=new CharacterVisual(this.scene,()=>{this.checkReady();for(const mesh of this.visual.meshes)shadows.addShadowCaster(mesh);});
    this.net=NetworkSession.fromLocation(this.scene,collision,shadows,this.events,seed);

    this.weapons=new DualPistols(this.scene,this.camera,this.visual,this.yard,rng.stream('run'),this.events,this.audio);

    this.elements=new ElementalEffects(this.scene,collision);this.skillAura=new SkillAura(this.scene,collision);void this.skillAura.load().then(()=>{if(!this.disposed)this.checkReady();});
    void this.weapons.load().then(()=>{if(!this.disposed)this.checkReady();});

    this.abyss=new AbyssPresentation(this.scene,this.player);this.footing=new FootingPresentation(this.scene,this.player,collision,this.audio);

    this.instrumentation=new SceneInstrumentation(this.scene);this.instrumentation.captureFrameTime=true;

    this.events.on('BodyBumped',({strength})=>{this.camera.impulse(.02*strength);this.audio.impact();});

    this.events.on('Dodged',({direction})=>{this.footing.dodge(direction);this.audio.dodge();this.camera.impulse(.035);});

    this.events.on('SkillUsed',({skillId})=>this.audio.skill(skillId));

    this.events.on('MPCharged',({tier})=>this.audio.charge(tier));

    this.events.on('LevelUp',()=>{this.audio.charge(3);this.player.hp=Math.min(this.progression.stats.maxHP,this.player.hp+18);if(this.enemies instanceof EnemySwarm)this.enemies.effects.burst(this.player.position,'energy',2);});

    this.events.on('ItemPicked',()=>{this.player.maxHP=this.progression.stats.maxHP;this.audio.charge(2);if(this.enemies instanceof EnemySwarm)this.enemies.effects.burst(this.player.position,'energy',1.5);});

    this.events.on('PlayerHit',context=>{this.hud.hit(context,this.input.yaw,this.player.hp,this.player.maxHP);this.camera.hurt(.18,context.forceDirection.x*Math.cos(this.input.yaw)-context.forceDirection.z*Math.sin(this.input.yaw));this.audio.playerHurt();});

    this.events.on('EnemyHit',()=>this.audio.impact());

    this.events.on('BossSpawned',()=>{this.audio.charge(1);this.camera.impulse(.04);});

    this.events.on('BossKilled',()=>{this.audio.charge(3);this.camera.impulse(.1);});

    this.events.on('PlayerKilled',()=>{if(!this.death.start())return;this.deathFlight.start(this.player.position,this.player.yaw);this.arrival.active=false;this.deathSummary=attemptSummary(this.progression,this.enemies instanceof EnemySwarm?this.enemies.director.wave:1,this.enemies instanceof EnemySwarm?this.enemies.director.completedWaves:0);this.cancelCinematic();this.weapons.cancelSkills();this.started=false;this.player.sprinting=false;this.input.clear();if(document.pointerLockElement)document.exitPointerLock();this.audio.setActive(true);this.audio.fatalImpact();this.camera.hurt(.32,1);this.hud.fatalReaction(true);});

    this.camera.update(this.player.position,this.input.yaw,this.input.pitch,1/60);

    void this.visual.load();

  }

  fixedUpdate(dt: number): void {

    if(this.arrival.active||this.poseReview||this.paused || !this.started || !this.visual.ready || !this.weapons.ready || !this.skillAura.ready || (this.yard instanceof FarmWorld&&!this.yard.ready)||(this.enemies instanceof EnemySwarm&&(!this.enemies.ready||!this.enemies.navigationReady))||this.interactables&&!this.interactables.ready)return;

    if(this.skillPending||this.cinematic.preparing)return;

    const input=this.paused?EMPTY_INPUT:this.input.read();if(this.reloadRunReview>0){this.reloadRunReview=Math.max(0,this.reloadRunReview-dt);input.x=0;input.z=1;input.fire=false;input.charging=false;this.player.sprinting=true;}this.charging=input.charging;

    const stats=this.progression.stats;this.player.maxHP=stats.maxHP;this.player.moveMultiplier=stats.moveSpeed;this.player.jumpMultiplier=stats.jump;this.player.extraJumps=stats.extraJumps;this.player.rechargeMultiplier=stats.dodgeRecharge;this.player.armor=stats.armor;this.player.regeneration=stats.regeneration;this.weapons.cadence.rateMultiplier=stats.attackSpeed;this.mp.speedMultiplier=1+(stats.mp-1)*.5;

    if(this.cancelVersion!==this.input.cancelVersion){this.mp.cancel();this.cancelVersion=this.input.cancelVersion;}

    if(this.yard instanceof FarmWorld)this.yard.fixedUpdate(dt,this.player);

    if(input.reload)this.weapons.requestReload();
    // Online: reconcilia com o último seq confirmado antes de prever o passo seguinte; depois envia a intenção deste passo.
    this.net?.reconcile(this.player,dt);
    const stepInput=reloadMovement(input,this.weapons.magazine.reloading);
    this.player.fixedUpdate(dt,stepInput,this.input.yaw);
    this.net?.afterStep(stepInput,this.input.yaw,this.input.pitch,this.player);

    const released=this.player.hp>0?this.mp.update(dt,input.charging&&!this.weapons.magazine.reloading&&!this.cinematic.active):0;

    if(released){void this.requestSkill(released);return;}

    this.weapons.fixedUpdate(dt,input.fire&&this.weapons.ready&&!input.charging&&this.player.dodgeRemaining===0&&this.player.hp>0);

    if(this.enemies instanceof EnemySwarm){this.progression.time+=dt;this.enemies.fixedUpdate(dt);while(this.enemies.director.rewardsPending>0){if(!this.interactables!.deliverWaveReward(this.rewardRng))break;this.enemies.director.rewardsPending--;}this.interactables!.update(dt,this.enemies.bossDeadTime>=5);if(input.interact!==undefined){if(this.enemies.bossDeadTime>=5&&this.interactables!.atRift){this.progression.advanceStage();this.enemies.nextStage();this.interactables!.reset();this.player.maxHP=this.progression.stats.maxHP;this.player.resetAt(this.spawn);this.mp.cancel();this.cancelCinematic();this.weapons.cancelSkills();this.events.emit('StageStarted',{stageId:String(this.progression.stage),seed:this.seed});}else this.interactables!.buy(input.interact);}}

  }

  render(alpha: number): void {

    const now=performance.now();const dt=Math.min(.05,(now-this.lastRender)/1000);this.lastRender=now;

    const deathDt=this.paused?0:dt;
    if(this.death.active)this.deathFlight.update(deathDt);
    if(this.death.update(deathDt)){this.audio.setActive(false);this.hud.defeated(this.deathSummary!,!this.net&&this.enemies instanceof EnemySwarm?()=>this.restartAttempt():undefined);}
    if(this.death.active)this.hud.fatalReaction(true,this.death.progress);
    this.visual.deathProgress=this.death.state==='idle'?undefined:this.death.progress;
    this.visual.deathPosition=this.death.state==='idle'?undefined:this.deathFlight.position;
    const animDt=this.poseReview?1/60:this.paused||!this.started?0:dt;

    if(this.cinematic.active){if(this.cinematic.preparing){this.input.yaw=this.castYaw;this.input.pitch=this.castPitch;}if(!this.poseReview&&animDt>0&&this.voiceClock)this.cinematic.update(this.voiceClock(),tier=>{const clock=this.voiceClock!;this.visual.endPreparation();this.camera.update(this.player.position,this.castYaw,this.castPitch,dt);this.weapons.releaseSkill(tier,true,this.cinematic.duration-SKILL_CUES[tier].release,()=>Math.max(0,clock()-SKILL_CUES[tier].release));if(tier===2)this.player.barrageRetreat();});if(this.cinematic.preparing)this.visual.prepareSkill(this.cinematic.tier,this.cinematic.progress);}

    this.visual.skillPerformance=this.cinematic.active&&!this.cinematic.preparing?{tier:this.cinematic.tier,progress:this.cinematic.actionProgress}:undefined;
    this.cutIn.update(this.cinematic,this.started&&!this.paused);

    const worldDt=this.arrival.active||this.cinematic.preparing||this.skillPending?0:animDt;

    if(this.enemies instanceof EnemySwarm&&animDt>0)this.enemies.updateBudget(animDt,this.scene.getEngine().getDeltaTime());

    this.audio.update(animDt,this.enemies instanceof EnemySwarm?this.enemies.director.state:0);

    this.arrival.update(animDt,()=>{this.elements.aura('fire',[],0,0);this.elements.emit('explosion',new Vector3(this.player.position.x,this.player.position.y,this.player.position.z),1.3);this.elements.emit('earth',new Vector3(this.player.position.x,this.player.position.y,this.player.position.z),1.5);this.footing.impactCracks(this.player.position);this.audio.impact(true);this.audio.skill('meteor-impact');this.camera.hurt(.10,1);});
    const preflight=!this.hasArrived&&!this.started&&this.death.state==='idle'&&this.visual.ready&&this.weapons.ready;
    if(preflight)this.preflightClock+=dt;
    const flightVisible=preflight||this.arrival.active;
    this.hud.liveFlightMenu(preflight,this.arrival.active&&this.started);
    this.hud.arrivalReveal(this.arrival.active&&this.started&&!this.paused,this.arrival.reveal);
    const arrivalPosition=this.arrival.position(this.player.position,this.player.yaw);
    this.visual.arrivalPose=flightVisible?{sway:preflight?Math.sin(this.preflightClock*2)*.035:this.arrival.sway,rootLift:this.arrival.rootLift,height:this.arrival.height,recovery:this.arrival.recovery,dive:this.arrival.dive,position:arrivalPosition}:undefined;
    this.visual.update(this.player,alpha,this.death.active?deathDt:preflight?dt:animDt,!this.player.sprinting||this.charging,this.charging,this.input.pitch,this.mp.seconds/2.6);
    this.net?.render(animDt);

    this.camera.update(this.visual.position,this.input.yaw,this.input.pitch,dt);

    if(flightVisible){const r=this.arrival.recovery,w=1-r*r*(3-2*r),origin=new Vector3(arrivalPosition.x,arrivalPosition.y+this.arrival.rootLift,arrivalPosition.z),forward=new Vector3(Math.sin(this.player.yaw),0,Math.cos(this.player.yaw)),wanted=origin.subtract(forward.scale(3.8)).addInPlaceFromFloats(0,1,0),normalTarget=this.camera.camera.position.add(this.camera.forward.scale(6));
      this.camera.camera.position.copyFrom(Vector3.Lerp(this.camera.camera.position,wanted,w));this.camera.camera.setTarget(Vector3.Lerp(normalTarget,origin.addInPlaceFromFloats(0,this.arrival.dive?-.8:1,0),w));}

    if(this.death.active)this.camera.skillClose(this.deathFlight.position,this.player.yaw,1,this.death.progress);
    if(this.cinematic.preparing)this.camera.skillClose(this.visual.position,this.castYaw,this.cinematic.tier,this.cinematic.progress);

    this.weapons.updatePose(worldDt);this.skillAura.update(this.cinematic,this.visual.position,this.weapons);
    this.elements.update(this.poseReview?0:animDt);if(this.arrival.active&&this.arrival.height>0)this.elements.aura('fire',[new Vector3(arrivalPosition.x,arrivalPosition.y+.4,arrivalPosition.z)],this.arrival.elapsed,1);
    if(this.elementPreview&&animDt>0){this.elementClock-=animDt;if(this.elementClock<=0){this.elementClock=1.6;const p=this.visual.position.add(this.camera.forward.scale(2.4));p.y=this.player.position.y+.03;this.elements.emit(this.elementPreview,p);}}
    if(this.cinematic.active){const elapsed=this.cinematic.elapsed,power=this.cinematic.preparing?Math.sin(this.cinematic.progress*Math.PI/2):Math.min(1,(1-this.cinematic.actionProgress)*5);this.elements.aura('electricity',[this.weapons.muzzlePose(0).position,this.weapons.muzzlePose(1).position,this.visual.position.add(new Vector3(0,.6,0))],elapsed,power);if(elapsed<this.auraLast)this.auraClock=0;if(this.cinematic.preparing&&elapsed>=this.auraClock&&elapsed<.9){this.auraClock=elapsed+.3;this.elements.emit('earth',this.visual.position,.45);}this.auraLast=elapsed;}else if(this.auraLast>=0){this.elements.clear();this.auraLast=-1;this.auraClock=0;}



    this.enemies.update(worldDt);this.footing.update(worldDt);this.abyss?.update(worldDt);

    if(this.enemies instanceof EnemySwarm)this.enemies.updateCameraVisibility(this.camera.camera.position,dt);

    if(this.yard instanceof FarmWorld)this.yard.update(worldDt);

    for(const target of this.yard.targets)if(target.ring)target.ring.scaling.setAll(1+(target.ring.scaling.x-1)*Math.exp(-dt*18));

    this.scene.physicsEnabled=this.started&&!this.paused&&!this.arrival.active&&!this.cinematic.preparing&&!this.skillPending;this.scene.render();this.hud.update(this.player,this.weapons,this.visual.error||this.weapons.error||this.skillAura.error||this.enemies.error||this.interactables?.error||(this.yard instanceof FarmWorld?this.yard.error:''),this.mp,this.enemies,animDt);

    if(this.enemies instanceof EnemySwarm){this.runHUD!.setVisible(this.started&&this.player.hp>0);this.runHUD!.update(this.progression,this.enemies,this.interactables!,this.camera.camera);}

  }

  private async requestSkill(tier:SkillTier):Promise<void>{

    if(this.skillPending||this.cinematic.active||this.weapons.magazine.reloading||this.player.hp<=0)return;

    Object.assign(this.player.previous,this.player.position);this.skillPending=true;const version=++this.castVersion;this.player.sprinting=false;this.castYaw=this.input.yaw;this.castPitch=this.input.pitch;

    try{const clock=await this.audio.voice(tier);if(this.disposed||version!==this.castVersion)return;this.voiceClock=clock.clock;this.cinematic.start(tier,clock.duration);this.visual.prepareSkill(tier,0);}

    catch(error){if(this.disposed||version!==this.castVersion)return;console.warn('Cinemática sem áudio disponível',error);this.weapons.releaseSkill(tier);if(tier===2)this.player.barrageRetreat();}

    finally{this.skillPending=false;}

  }

  private restartAttempt():void {
    this.death.reset();this.deathSummary=undefined;this.started=false;
    this.cancelCinematic();this.progression.reset();this.weapons.resetAttempt();this.visual.resetAttempt();this.mp.cancel();this.mp.current=this.mp.maximum;this.mp.releases=0;this.mp.speedMultiplier=1;
    if(this.enemies instanceof EnemySwarm)this.enemies.nextStage();this.interactables?.reset();
    this.player.maxHP=this.progression.stats.maxHP;this.player.moveMultiplier=1;this.player.jumpMultiplier=1;this.player.extraJumps=0;this.player.rechargeMultiplier=1;this.player.armor=0;this.player.regeneration=1;this.player.debugInvincible=false;
    this.player.resetAt(this.spawn);this.player.jumps=0;this.player.dodges=0;this.player.respawns=0;this.player.solidRecoveries=0;this.player.wallJumps=0;
    this.reloadRunReview=0;this.arrival.start();this.arrival.active=false;this.hasArrived=false;this.paused=false;this.input.clear();this.input.yaw=-.13;this.input.pitch=.02;this.camera.update(this.player.position,this.input.yaw,this.input.pitch,1);
  }
  private cancelCinematic():void{this.elements?.clear();this.auraClock=0;this.auraLast=-1;this.poseReview=false;this.castVersion++;this.skillPending=false;this.cinematic.cancel();this.visual.endPreparation();this.audio.cancelVoice();}

  get isPaused():boolean {return this.paused;}
  setPaused(paused: boolean): void {this.paused=paused;this.input.clear();this.mp.cancel();this.audio.setActive(!paused&&(this.started||this.death.active));}

  private checkReady():void {const stages=[this.visual?.ready,this.weapons?.ready,this.skillAura?.ready,!(this.yard instanceof FarmWorld)||this.yard.ready,(!(this.enemies instanceof EnemySwarm)||this.enemies.ready),!(this.enemies instanceof EnemySwarm)||this.enemies.navigationReady,!this.interactables||this.interactables.ready];this.hud?.loading(stages.filter(Boolean).length,8,stages.every(Boolean)?'PREPARANDO LUZ E MATERIAIS':'CARREGANDO FAZENDAS E ROTAS');for(const material of this.scene.materials){const lit=material as typeof material & {maxSimultaneousLights?:number};if(lit.maxSimultaneousLights!==undefined&&lit.maxSimultaneousLights>4){lit.unfreeze();lit.maxSimultaneousLights=4;}}if(this.visual?.ready&&this.weapons?.ready&&this.skillAura?.ready&&(!(this.yard instanceof FarmWorld)||this.yard.ready)&&(!(this.enemies instanceof EnemySwarm)||(this.enemies.ready&&this.enemies.navigationReady))&&(!this.interactables||this.interactables.ready)){if(this.warming)return;this.warming=true;this.scene.executeWhenReady(()=>{if(!this.disposed)this.hud.ready();});}}

  configure(name: string,value: number): void {
    if(name==='sky-raw')reviewSkyBlend(this.scene,false);
    if(name==='skinning-cpu')this.visual.setSkinning('cpu');
    if(name==='skinning-gpu')this.visual.setSkinning('auto');
    if(name==='sky-blended')reviewSkyBlend(this.scene,true);

    if((name==='city'||name==='frontier'||name==='grain-port'||name==='glasshouse'||name==='horizon-review'||name==='highlands'||name==='rootwood')&&this.yard instanceof FarmWorld){
      const id=name==='rootwood'?'rootwood':name==='city'?'farm-city':name==='highlands'?'highland-farms':'solar-frontier';void this.yard.prepareVisit(id).then(ready=>{if(!ready||this.disposed)return;this.arrival.active=false;this.cancelCinematic();this.player.resetAt(name==='rootwood'?{x:883,y:31.2,z:355}:name==='highlands'?{x:431,y:18.7,z:280}:name==='city'?{x:99,y:2.1,z:-9}:name==='frontier'?{x:248,y:9.1,z:21}:(name==='glasshouse'||name==='horizon-review')?{x:285,y:15.1,z:245}:{x:285,y:15.1,z:120});this.input.yaw=name==='horizon-review'?Math.atan2(-185,-173):(name==='highlands'||name==='rootwood')?Math.PI/2:0;this.input.pitch=.02;});
    }
    if((name==='eggplant-rush'||name==='carrot-laser')&&this.enemies instanceof EnemySwarm){this.arrival.active=false;this.cancelCinematic();this.enemies.nextStage();this.enemies.director.stopped=true;this.player.resetAt({x:0,y:0,z:-10});this.input.yaw=0;this.input.pitch=.05;this.player.hp=this.player.maxHP;this.player.debugInvincible=false;this.enemies.spawn(name==='carrot-laser'?'carrot':'eggplant',{x:0,y:0,z:-2},'normal');}
    if(name==='tomato-fire'&&this.enemies instanceof EnemySwarm){this.cancelCinematic();this.enemies.nextStage();this.enemies.director.stopped=true;this.player.hp=this.player.maxHP;this.player.debugInvincible=false;this.enemies.spawn('tomato',{x:this.player.position.x,y:this.player.position.y,z:this.player.position.z+10},'normal');}
    if(name==='camera-audit'){const ray=this.camera.camera.getForwardRay(8),hit=this.scene.pickWithRay(ray,m=>m.isEnabled()&&m.isVisible&&m.getTotalVertices()>0);this.cameraAudit='Pronto: '+[this.visual.ready,this.weapons.ready,this.skillAura.ready,(this.yard as FarmWorld).ready,(!(this.enemies instanceof EnemySwarm)||this.enemies.ready),(this.enemies as EnemySwarm).navigationReady,this.interactables?.ready,this.warming].join('/')+' · pendentes '+this.scene.getWaitingItemsCount()+' · meshes sem material pronto '+this.scene.meshes.filter(m=>m.isEnabled()&&!m.isReady(true)).slice(0,6).map(m=>m.name+':'+m.material?.name).join(',')+' · Câmera '+this.camera.camera.position.toString()+' · centro '+(hit?.pickedMesh?.name??'vazio')+' · material '+hit?.pickedMesh?.material?.name+' · distância '+hit?.distance+' · ritual '+this.scene.getTransformNodeByName('GroundSigilRoot')?.getAbsolutePosition().toString()+' / '+this.scene.getMeshByName('Ground_Runewheel')?.isEnabled()+' / '+this.scene.getMeshByName('Ground_Runewheel')?.scaling.toString()+' · jogador '+this.visual.meshes.map(m=>m.name+':vis='+m.visibility+',enabled='+m.isEnabled()+',visible='+m.isVisible+',scale='+m.scaling.toString()+',center='+m.getBoundingInfo().boundingBox.centerWorld.toString()).join('|');}
    if(name==='element-off'){this.elementPreview=undefined;this.elements.clear();}
    if(name.startsWith('element-')&&ELEMENTS.includes(name.slice(8) as ElementKind)){this.elementPreview=name.slice(8) as ElementKind;this.elementClock=0;}
    if(name.startsWith('pose-skill')){this.arrival.active=false;const tier=Number(name.slice(10)) as SkillTier;this.cancelCinematic();this.poseReview=true;this.audio.setActive(false);this.castYaw=this.input.yaw;this.castPitch=this.input.pitch;this.cinematic.start(tier,6);this.cinematic.elapsed=SKILL_CUES[tier].release*.94;this.visual.prepareSkill(tier,.94);for(const side of [0,1] as const)this.elements.emit('electricity',this.weapons.muzzlePose(side).position,.55);this.elements.update(.12);}
    if(name==='pose-end'){this.cancelCinematic();this.audio.setActive(this.started&&!this.paused);}
    if(name==='distance')this.camera.preferredDistance=value;

    if(name==='fov')this.camera.camera.fov=value*Math.PI/180;

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

    if(name==='barn')this.player.resetAt({x:0,y:5,z:30.8});

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

      player:`${this.net?.debugLine()??''}${this.yard instanceof FarmWorld?this.yard.regionStatus:''}${this.cameraAudit}\nPosição ${this.player.position.x.toFixed(1)}, ${this.player.position.y.toFixed(1)}, ${this.player.position.z.toFixed(1)}\nVelocidade ${Math.hypot(this.player.velocity.x,this.player.velocity.z).toFixed(2)} m/s · ${this.player.sprinting?'CORRENDO':'NORMAL'}\nMira ${this.input.yaw.toFixed(3)} / ${this.input.pitch.toFixed(3)}\nGrounded ${this.player.grounded} · Saltos ${this.player.jumps}\nEsquivas ${this.player.dodges} · Retornos ${this.player.respawns}\n${this.enemies instanceof EnemySwarm?this.enemies.tactical?.residencyDescription??'':''}\nNavmesh ${this.enemies instanceof EnemySwarm?this.enemies.tactical?.count??0:0} agentes · Ragdolls ${this.enemies instanceof EnemySwarm?this.enemies.ragdollCount:0} · Marcas ${this.weapons.effects.decalCount}\nDisparos ${this.weapons.cadence.shots} · Acertos ${this.weapons.hits}\nImpacto ${this.weapons.lastImpact}\nModelo ${this.visual.ready?'pronto':'carregando'} · ${this.visual.skinning}\nInvulnerabilidade QA ${this.player.debugInvincible?'ATIVA':'desligada'}\nDirector ${this.enemies instanceof EnemySwarm?this.enemies.director.state:'treino'} · Estágio ${this.progression.stage}`};

  }

  dispose(): void {if(this.disposed)return;this.disposed=true;this.net?.dispose();this.cancelCinematic();this.cutIn.dispose();this.skillAura.dispose();this.elements.dispose();if(this.yard instanceof FarmWorld)this.yard.dispose();this.input.dispose();this.enemies.dispose();this.runHUD?.dispose();this.interactables?.dispose();this.events.clear();this.weapons.dispose();this.footing.dispose();this.abyss?.dispose();this.visual.dispose();this.audio.dispose();this.hud.dispose();this.instrumentation.dispose();this.scene.dispose();}

}

















