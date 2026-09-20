import {ExplorationMap} from '../ui/ExplorationMap';
import {usePlanetWorld} from '../world/WorldSelection';
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

import { Ray } from '@babylonjs/core/Culling/ray';

import { destructionHit } from '../planet-game/PlanetDestruction';

import { RunRNG, type RandomStream } from '../core/RunRNG';

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

import { PrismRig } from '../combat/PrismRig';

import { PrismWeapon } from '../combat/PrismWeapon';

import { PrismShotVisuals } from '../combat/PrismShotVisuals';

import { weaponReadout } from '../ui/WeaponReadout';

import { AimState,aimKindFor,type AimView } from '../combat/AimState';

import { TrajectoryRefreshGate } from '../combat/GrenadeTrajectory';

import { TrajectoryView } from '../vfx/TrajectoryView';

import { ScopeOcclusion } from '../camera/ScopeOcclusion';

// Visual da mira apurada (retículo, alça, luneta e indicador de queda). O dono da interface é quem
// escreve o arquivo; a cena só publica o estado por `update({active,kind,zoom})`.
import { WeaponAimOverlay } from '../ui/WeaponAimOverlay';

import { CAMERA_TUNING } from '../player/PlayerTuning';

import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';

import { WeaponAudio } from '../audio/WeaponAudio';

import { PlayerHUD } from '../ui/PlayerHUD';

import { MPCharge,MP_COSTS } from '../combat/MPCharge';

import { PlayerClassChoice,PLAYER_CLASSES,type PlayerClassId } from '../run/PlayerClass';

import { EnemyReview } from './EnemyReview';

import { FarmWorld } from '../world/FarmWorld';

import { EnemySwarm } from './EnemySwarm';

import { ITEMS,RunProgression } from '../run/RunProgression';

import { RunInteractables } from '../run/RunInteractables';

import { FootingPresentation } from '../world/FootingPresentation';

import { RunHUD } from '../ui/RunHUD';

import { ExpeditionObjectives,findTotemSite,FINAL_CHALICE_JUICE,TOTEM_RADIUS,isOuterDeck,CHALICE_SIGNAL_SECONDS,DECK_TOLERANCE,type TotemSite } from '../run/ExpeditionObjectives';

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

import type { GameWorld } from '../world/GameWorld';

import { FarmGameWorld } from '../world/FarmGameWorld';

import { PlanetWorld } from '../world/PlanetWorld';

import { PlanetFrame } from '../planet/PlanetFrame';

import type { GameCamera } from '../camera/GameCamera';

import { RadialCamera } from '../camera/RadialCamera';

import { RadialAvatar } from '../animation/RadialAvatar';

import { RadialCombatSpace } from '../combat/RadialCombatSpace';

import { PLAYER_TUNING } from '../player/PlayerTuning';

import {pickIslands, RADIAL_ISLAND_POOL} from '../stages/IslandPool';
import { PlayerRagdoll } from '../player/PlayerRagdoll';

import { addRagdollTerrain } from '../physics/RagdollWorld';
import { IonBeam } from '../vfx/IonBeam';
import { BLAST_IMPULSE_CAP } from '../player/PlayerMotor';
import { blastFalloff } from '../combat/PrismGrenades';
import { GroundFireView } from '../vfx/GroundFireView';
import { StrikeMarker, type Mark } from '../vfx/StrikeMarker';
import { GROUND_FIRE } from '../combat/GroundFire';
import { exposeQA } from '../debug/FreezeTrace';

import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader';

import type { DamageContext } from '../core/contracts';

import { traceBoot } from '../core/BootTrace';

import { metricOf } from '../run/ExpeditionObjectives';

import { siteBiomes, siteBiomeForStage, type StageBiome } from '../stages/StageRoute';

import { TacticalNavigation } from '../ai/TacticalNavigation';

/**
 * Navmesh de ilha assada offline, quando existir.
 *
 * Ausente devolve `undefined`, e `createIslands` assa em tempo de execução — mais lento no
 * carregamento, mesmo resultado em jogo. É o contrato de `IslandNavigationSource.baked`.
 */
async function bakedIslandNavmesh(id:string):Promise<Uint8Array|undefined> {
  try{
    const response=await fetch(`/models/island-navmesh/${id}.bin`);
    if(!response.ok)return undefined;
    return new Uint8Array(await response.arrayBuffer());
  }catch{return undefined;}
}



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

  readonly camera: GameCamera;

  readonly visual: CharacterVisual;

  /**
   * O mapa, atrás do contrato `GameWorld`.
   *
   * `yard` continua sendo o objeto concreto (fazenda, pátio de treino ou planeta) porque a cena
   * ainda fala com ele em alguns lugares que são mesmo específicos de mapa — streaming de região,
   * celeiros, terreno esculpido. Tudo o que é JOGO passa por aqui.
   */
  readonly world: GameWorld;

  /**
   * `true` quando o mapa é o planeta. Não muda nenhuma regra: só decide qual câmera e qual
   * avatar são montados, porque esses dois são os únicos que precisam de um referencial.
   */
  private readonly radial: boolean;

  /** Avatar radial. `undefined` no mundo plano, onde a visual recebe o motor direto. */
  private readonly avatar: RadialAvatar | undefined;

  /** Biomas derivados das ilhas do mapa (planeta). Vazio na fazenda, que tem os seus na autoria. */
  private readonly worldBiomes: StageBiome[] = [];

  /** Motivo escrito quando uma combinação de rota é recusada (hoje: co-op no planeta). */
  private networkNotice='';

  /** Degradação anunciada da navegação, quando as cartas de ilha não sobem. */
  private navigationNotice='';

  /** Os baús autorais já carregaram; só então a colocação do mapa pode substituí-los. */
  private lootReady=false;

  /** Quantas vezes o sorteio do estágio já foi tentado; varia o subconjunto de ilhas do planeta. */
  private planAttempt=0;

  /**
   * Tiques já rastreados pelo `?qaBoot`. Limitado de propósito: o alvo é achar ONDE o primeiro
   * quadro vivo morre, e um rastro ilimitado afogaria o servidor de QA (teto de 100 mensagens).
   */
  private tracedFixed=0;
  private tracedRender=0;

  readonly weapons: DualPistols;private readonly skillAura:SkillAura;

  /**
   * A CLASSE escolhida no menu, antes de entrar em campo.
   *
   * Persistente por design (ver `PlayerClassChoice`): ela atravessa estágios, viagens e RENASCER —
   * a mesma tentativa repetida é a mesma classe. Só voltar ao menu destranca a escolha, e é por
   * isso que **não existe tecla de troca de arma**: a decisão foi tomada uma vez, fora do campo.
   */
  private readonly classChoice=new PlayerClassChoice(undefined,location.href);
  /** `true` quando a classe é Soldado E a PRISM subiu. Sem rig, o soldado joga nas pistolas. */
  private get soldier():boolean {return this.classChoice.id==='soldier'&&this.prism.ready;}
  get playerClass():PlayerClassId {return this.classChoice.id;}

  /**
   * A PRISM do SOLDADO: o rig autoral (Codex) mais o backend de jogo.
   *
   * Uma arma por classe, sem troca em campo. O pistoleiro nunca a equipa; o soldado nunca larga
   * dela. As três habilidades autorais de pistola (leque, barragem e tempestade) continuam sendo do
   * PISTOLEIRO — o soldado tem as seis próprias da PRISM (`src/combat/PrismSkills.ts`) e nunca
   * dispara uma cinemática de pistola. Se o GLB do rig não subir, o soldado cai nas pistolas com o
   * motivo escrito no F1, em vez de entrar em campo desarmado.
   */
  readonly prism: PrismWeapon;
  private readonly prismRig: PrismRig;
  private readonly prismVisuals: PrismShotVisuals;
  /** As tres visuais das habilidades novas do assalto. Ver src/vfx/IonBeam.ts. */
  private readonly ionBeam: IonBeam;
  private readonly groundFireView: GroundFireView;
  private readonly strikeMarker: StrikeMarker;
  private readonly markBuffer: Mark[] = [];
  /** Carga da PRISM concluída (com ou sem sucesso): é o que libera a barra de carregamento. */
  private prismSettled=false;
  private prismError='';

  readonly enemies:EnemyReview|EnemySwarm;

  private readonly runHUD:RunHUD|undefined;
  private explorationMap:ExplorationMap|undefined;

  private readonly interactables:RunInteractables|undefined;

  private readonly hud: PlayerHUD;

  private readonly input: GameInput;

  private abyss:AbyssPresentation|undefined;private readonly audio=new WeaponAudio();private readonly footing:FootingPresentation;

  private readonly yard: TrainingYard | FarmWorld | PlanetWorld;

  private readonly spawn=new Vector3(0,0,-10);

  private readonly cinematic=new SkillTimeline();private readonly cutIn=new SkillCutIn();private voiceClock:(()=>number)|undefined;private skillPending=false;private castVersion=0;private castYaw=0;private castPitch=0;

  private cameraAudit='';private poseReview=false;private readonly elements:ElementalEffects;private elementPreview:ElementKind|undefined;private elementClock=0;private auraClock=0;private auraLast=-1;
  private paused=false;

  private readonly rewardRng:RandomStream;

  /** Expedição: explorar, encontrar o cálice e ativar a horda final com chefe. */
  readonly objectives=new ExpeditionObjectives();
  readonly resonance=new HarvestResonance();
  private expeditionSites:ExpeditionSites|undefined;
  /**
   * Sítio do próximo estágio JÁ MONTADO e escondido, esperando o plano ser aplicado.
   *
   * O cálice deixou de ser carregado "depois, se der": ele é uma exigência do plano. `planReady` só
   * fica verdadeiro quando o copo está na ilha, então uma falha de GLB agora segura a viagem (com
   * motivo na tela e nova tentativa) em vez de entregar um estágio sem objetivo visível.
   */
  private pendingSites:ExpeditionSites|undefined;
  /** Motivo real da última falha de montagem do sítio; aparece no F1 e no rótulo de carga. */
  private siteError='';
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

  // ---- mira apurada (ADS) --------------------------------------------------------------------
  /**
   * O botão direito virou MIRA e o `Q` virou a carga do especial.
   *
   * O estado da mira vive em `AimState` (regra pura, testável) e é aplicado por quadro na
   * apresentação, nunca no passo fixo: a mira é enquadramento, não simulação — e o passo fixo fica
   * RETIDO durante entrada, viagem, revisão e morte, que são justamente os estados em que a mira
   * tem de ser cancelada. Deixá-la na apresentação é o que faz o cancelamento acontecer mesmo
   * quando a simulação está parada.
   */
  private readonly aim=new AimState();
  private readonly aimOverlay=new WeaponAimOverlay();
  private readonly trajectory:TrajectoryView;
  private readonly trajectoryGate=new TrajectoryRefreshGate();
  private readonly scopeOcclusion:ScopeOcclusion;
  /** Botão direito preso e entalhes de roda do último quadro de entrada lido. */
  private aimHeld=false;
  private aimWheel=0;

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

    const mode=new URL(location.href).searchParams.get('mode');

    const training=mode==='training';

    // Shared original gameplay, with the selected map and gravity adapter.
    this.radial=usePlanetWorld(location.href);

    const planetWorld=this.radial?new PlanetWorld(this.scene,undefined,this.audio):undefined;
    const collision=this.collision=planetWorld?planetWorld.collision:new CollisionWorld();
    this.deathFlight=new DeathFlight(collision);

    // A câmera radial nasce com o contrato nominal do planeta e adota o raio real quando o
    // manifesto chega (`retarget`), durante o carregamento — antes de existir controle.
    this.camera=this.radial
      ?new RadialCamera(this.scene,new PlanetFrame(),this.spawn)
      :new ThirdPersonCamera(this.scene,collision);

    const shadows=trainingLighting(this.scene,this.camera.camera);
    planetWorld?.useShadows(shadows);

    // Expedição com um cálice por estágio. Modos legados continuam disponíveis pela URL.
    // Os modos anteriores continuam acessíveis: `?mode=horde` e `?mode=classic` (antigo `legacy`).
    this.directorMode=mode==='horde'?'horde':(mode==='classic'||mode==='legacy')?'classic':'expedition';

    this.yard=training?new TrainingYard(this.scene,shadows,rng)
      :planetWorld?planetWorld
      :new FarmWorld(this.scene,collision,shadows,!new URLSearchParams(location.search).get('online'));

    // O contrato de mundo: é o que a horda e as armas recebem, nos dois mapas.
    if(planetWorld)this.explorationMap=new ExplorationMap();
    this.world=planetWorld??new FarmGameWorld(this.yard as TrainingYard|FarmWorld,(from,to)=>this.routeLength(from,to));

    traceBoot(this.radial?'cena:construtor radial':'cena:construtor plano');
    const worldStarted=performance.now();
    if(planetWorld)void planetWorld.load().then(async()=>{
      stageTiming('mapa (manifesto + casca + colisão + destrutíveis)',worldStarted);
      traceBoot('mapa:carregado');
      if(this.disposed)return;
      // O planeta só EXISTE aqui: `configurePlanet` já rodou dentro de `PlanetWorld.load`, então a
      // partir desta linha `collision.surface.kind === 'sphere'`. Tudo o que tinha guardado o
      // referencial plano precisa ser religado agora — é por isso que este bloco existe.
      const frame=planetWorld.frame;
      if(frame&&this.camera instanceof RadialCamera)this.camera.retarget(frame,planetWorld.collisionMesh,this.player.position);
      const surface=this.world.surface;
      this.weapons.destruction=planetWorld.destruction;
      this.objectives.metric=metricOf(surface);
      this.worldBiomes.push(...siteBiomes(planetWorld.sites,(a,b)=>surface.planarDistance(a,b)));
      // A horda foi construída antes do manifesto chegar e nasceu com o espaço PLANO. Sem esta
      // troca ela mediria distância por `hypot(dx,dz)` e apoiaria por `groundAt` numa esfera —
      // ou seja, nenhuma praga encostaria no chão fora do polo.
      if(this.enemies instanceof EnemySwarm){
        this.enemies.configureSurface(surface);
        // A navegação NÃO entra no caminho crítico do carregamento.
        //
        // Sem `.bin` assado, `createIslands` monta 38 navmeshes em tempo de execução, e isso é
        // trabalho SÍNCRONO de muitos segundos na thread da interface — foi o que travou o
        // navegador duro depois do recarregamento. A partida não depende dela para existir: sem
        // cartas a horda persegue localmente e o motivo aparece no HUD. Quando as cartas ficam
        // prontas elas entram sozinhas, sem reiniciar nada.
        this.enemies.navigationReady=true;
        traceBoot('horda:superfície radial ligada');
        void this.prepareIslandNavigation(planetWorld);
      }
      if(this.disposed)return;
      this.checkReady();
    });

    if(this.yard instanceof FarmWorld)void this.yard.load().then(async()=>{if(this.disposed)return;if(this.enemies instanceof EnemySwarm)await this.enemies.prepareNavigation();if(!this.disposed)this.checkReady();});

    if(training){collision.boxes.push(...this.yard.collision.boxes);collision.surfaces.push(...this.yard.collision.surfaces);}

    if(!training){this.spawn.x=rng.stream('spawn').range(-2,2);this.spawn.z=rng.stream('spawn').range(-17,-10);}

    this.player=new PlayerMotor(collision,this.events,this.spawn);

    this.enemies=training?new EnemyReview(this.scene,this.world,this.events,shadows):new EnemySwarm(this.scene,this.world,this.events,shadows,this.player,this.progression,rng,this.directorMode);if(this.enemies instanceof EnemySwarm)this.enemies.audio=this.audio;void this.enemies.load().then(()=>{if(!this.disposed)this.checkReady();});

    if(!training){this.runHUD=new RunHUD();this.interactables=new RunInteractables(this.scene,this.player,this.progression,this.events,rng.stream('interactable'),collision);void this.interactables.load(this.scene).then(()=>{if(this.disposed)return;this.lootReady=true;this.applyLootPlacement();this.checkReady();});}

    this.dropship=training?undefined:new DropshipDeck(this.scene);
    void this.dropship?.load().then(()=>{if(!this.disposed)this.checkReady();});

    this.hud=new PlayerHUD(()=>{if(this.progression.time===0)this.events.emit('StageStarted',{stageId:String(this.progression.stage),seed:this.seed});this.started=true;
      // Sem o GLB da nave não existe deck para correr: a entrada cai direto no mergulho original.
      if(!this.hasArrived){this.hasArrived=true;this.intro.start(Boolean(this.dropship?.ready));}
      this.audio.unlock();this.audio.setActive(true);void this.input.capture();},!training,{volume:value=>{this.audio.setVolume(value);this.prismRig?.setVolume(value);},quality:balanced=>applyLightingQuality(this.scene,balanced)},this.directorMode,
      // A seleção de classe só existe no jogo de verdade; o pátio de treino não tem expedição.
      {initial:this.classChoice.id,choose:id=>{this.classChoice.choose(id);this.applyPlayerClass();}});
    this.hud.onSkipIntro=()=>this.skipIntro();

    const canvas=engine.getRenderingCanvas()!;canvas.tabIndex=0;

    this.input=new GameInput(canvas,active=>{if(this.player.hp<=0){if(this.death.active)this.audio.setActive(!this.paused);return;}this.audio.setActive(active);this.started=active;this.hud.setActive(active);if(!active)this.mp.cancel();});

    if(!training){this.input.yaw=-.13;this.player.yaw=this.input.yaw;}

    this.visual=new CharacterVisual(this.scene,()=>{this.checkReady();for(const mesh of this.visual.meshes)shadows.addShadowCaster(mesh);});
    // No planeta a visual ganha um PAI radial e passa a receber pose LOCAL; os clipes autorais
    // (Idle/Walk/Run/Jump/Dodge/Land/combos) tocam exatamente como no mundo plano.
    this.avatar=this.radial?new RadialAvatar(this.scene,this.visual,()=>this.world.surface):undefined;
    this.playerRagdoll=new PlayerRagdoll({
      scene:this.scene,
      // O clone é carregado à parte: o rig VIVO nunca recebe física.
      corpse:()=>LoadAssetContainerAsync('/models/gunslinger.glb',this.scene),
      // Por PONTO e a cada quadro — num planeta a vertical do cadáver não é a do jogador.
      down:point=>this.world.surface.down(point),
      // A casca do planeta não tem corpo estático de Havok; o cadáver leva um recorte local.
      ...(this.radial?{terrain:(centre:Vec3)=>this.localRagdollTerrain(centre)}:{}),
    });
    void this.playerRagdoll.prepare().then(()=>{if(!this.disposed)this.checkReady();});
    // Co-op continua EXATAMENTE como está na fazenda. No planeta ele é recusado em voz alta em vez
    // de aberto pela metade: `Reconciliation` e `RemotePlayers` reproduzem o passo do motor com
    // gravidade em `−Y`, então um segundo jogador apareceria andando para o lado errado da casca e
    // divergindo do servidor. Fingir compatibilidade aqui seria perder jogo em silêncio — quem
    // pedir `?online=1&world=planet` recebe o motivo escrito e joga na fazenda.
    this.net=this.radial?undefined:NetworkSession.fromLocation(this.scene,collision,shadows,this.events,seed);
    if(this.radial&&new URLSearchParams(location.search).get('online'))
      this.networkNotice='Co-op ainda não roda no planeta (a réplica de rede é do motor plano) · use a fazenda';

    // Sem isto o leque do ricochete, o arremesso do carregador, a guinada do MP II e o arco da
    // granada continuam girando em torno do `+Y` do MUNDO — certos no polo norte e errados em
    // toda a outra casca. O MESMO espaço serve as duas armas.
    const combatSpace=this.radial?new RadialCombatSpace(()=>this.world.surface):undefined;
    this.weapons=new DualPistols(this.scene,this.camera,this.visual,this.world,rng.stream('run'),this.events,this.audio,combatSpace);

    // ---- PRISM ------------------------------------------------------------------------------
    // O rig autoral cuida de pose, clipes e áudio da arma; este backend cuida de munição, dano,
    // balística e destruição, reaproveitando a MESMA física do tiro (a porta `CombatServices`, que
    // `DualPistols` publica). Nenhum campo privado do rig é tocado.
    this.prismRig=new PrismRig(this.scene,this.visual);
    this.prismVisuals=new PrismShotVisuals(this.scene);
    this.ionBeam=new IonBeam(this.scene);
    this.groundFireView=new GroundFireView(this.scene,GROUND_FIRE.limit);
    this.strikeMarker=new StrikeMarker(this.scene);
    this.prism=new PrismWeapon({
      services:this.weapons,rig:this.prismRig,camera:this.camera,rng:rng.stream('run'),
      body:()=>this.visual.position,visuals:this.prismVisuals,...(combatSpace?{space:combatSpace}:{}),
    });

    this.elements=new ElementalEffects(this.scene,collision);this.skillAura=new SkillAura(this.scene,collision);void this.skillAura.load().then(()=>{if(!this.disposed)this.checkReady();});
    void this.weapons.load().then(()=>{if(!this.disposed)this.checkReady();});
    // A PRISM não é portão de partida: falhar a carga do GLB deixa o jogo inteiro nas pistolas, com
    // o motivo escrito no diagnóstico. O que ela é é uma ETAPA — o Jogar espera o resultado, seja
    // ele qual for, para o jogador não entrar em campo com a arma padrão ainda no ar.
    void this.prismRig.load().then(()=>{
      if(this.disposed)return;
      // A PRISM entra nas mãos só se a CLASSE for Soldado. O pistoleiro nunca a equipa.
      this.applyPlayerClass();
    }).catch((error:unknown)=>{
      if(!this.disposed)this.prismError=error instanceof Error?error.message:'Falha no rig da PRISM';
    }).finally(()=>{if(!this.disposed){this.prismSettled=true;this.applyPlayerClass();this.checkReady();}});
    void this.prismVisuals.load();
    void this.prismVisuals.loadMissile();

    // Arco previsto do lança-granadas e a lente limpa da luneta. Os dois são apresentação de MIRA:
    // não colidem, não são atingíveis e não entram na lista de alvos.
    this.trajectory=new TrajectoryView(this.scene);
    this.scopeOcclusion=new ScopeOcclusion(()=>this.scopeCandidates());

    this.abyss=new AbyssPresentation(this.scene,this.player);this.footing=new FootingPresentation(this.scene,this.player,collision,this.audio);

    // Passos vinculados ao contato real dos pés do clipe dominante.
    // Ponte soa madeira, convés soa grama: sem este gancho o planeta inteiro soaria grama, porque
    // a malha do manifesto não tem id de material.
    if(this.yard instanceof PlanetWorld){const world=this.yard;this.footing.footingMaterial=p=>world.footingMaterialAt(p);}
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

    this.events.on('ItemPicked',({itemId})=>{this.runHUD?.showItemPickup(itemId);this.player.maxHP=this.progression.stats.maxHP;this.audio.charge(2);if(this.enemies instanceof EnemySwarm)this.enemies.effects.burst(this.player.position,'energy',1.5);});

    // O timbre do dano recebido segue a origem real do golpe, para o jogador identificar o que o acertou.
    this.events.on('PlayerHit',context=>{
      // A seta de dano e o lado do tranco são RELATIVOS ao corpo. No mundo plano a conta é a de
      // sempre (`fx·cos y − fz·sin y`); no planeta a mesma conta vira projeção na base tangente,
      // porque `x`/`z` de mundo não dizem nada sobre "veio da minha direita" fora do polo.
      const local=this.localForce(context.forceDirection);
      this.hud.hit({...context,forceDirection:local.arrow},this.player.yaw,this.player.hp,this.player.maxHP);
      this.camera.hurt(.18,local.side);
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

    this.events.on('PlayerKilled',context=>{if(!this.death.start())return;
      // A PRISM sai das mãos ANTES do cadáver ser montado: sem isto `corpseEquipment` devolveria
      // lista vazia (as pistolas ainda estariam escondidas) e o corpo cairia desarmado.
      this.prism.suppressed=true;this.prism.cancel();this.weapons.concealed=false;
      // A captura vem ANTES de tudo: `started=false`, `sprinting=false` e o cancelamento das
      // habilidades mexem no corpo, e a velocidade do instante do golpe é o que dá peso à queda.
      this.cancelAim();
      this.startPlayerRagdoll(context);this.deathFlight.start(this.player.position,this.player.yaw,{up:this.player.up,forward:this.player.forward});this.intro.abort();this.meleeReview.exit();this.deathSummary=this.summarize();this.cancelCinematic();this.weapons.cancelSkills();this.started=false;this.player.sprinting=false;this.input.clear();if(document.pointerLockElement)document.exitPointerLock();this.audio.setActive(true);this.audio.fatalImpact();this.camera.hurt(.32,1);this.hud.fatalReaction(true);});


    // A explosão da PRISM acende o chão pela horda, que é quem tem os corpos para queimar.
    this.prism.onGroundFire=(centre,radius)=>{if(this.enemies instanceof EnemySwarm)this.enemies.igniteGround({x:centre.x,y:centre.y,z:centre.z},radius);};
    // ---- salto de foguete ---------------------------------------------------------------------
    // A onda de choque arremessa o PRÓPRIO jogador, e é isso que transforma a explosiva em
    // mobilidade. A direção é do centro da explosão PARA o corpo, então uma cápsula sob os pés
    // manda para cima e uma ao lado manda para longe — sem caso especial para nenhum dos dois.
    //
    // O impulso cai com a distância pela MESMA curva do dano (`blastFalloff`): quem quer altura
    // tem de explodir perto, que é o risco que paga o ganho. Explosão longe não levanta ninguém.
    this.prism.onBlastWave=(centre,radius)=>{
      if(this.player.hp<=0||this.death.active)return;
      const body=this.player.position;
      const dx=body.x-centre.x,dy=body.y-centre.y,dz=body.z-centre.z;
      const distance=Math.hypot(dx,dy,dz);
      const falloff=blastFalloff(distance,radius);
      if(falloff<=0)return;
      // Corpo em cima do ponto exato: a direção degenera, e o salto certo ali é reto para cima.
      const up=this.world.surface.up(body);
      const direction=distance>1e-3
        ?{x:dx/distance,y:dy/distance,z:dz/distance}
        :{x:up.x,y:up.y,z:up.z};
      this.player.blastImpulse(direction,BLAST_IMPULSE_CAP*falloff);
    };
    this.camera.update(this.player.position,this.input.yaw,this.input.pitch,1/60);

    void this.visual.load();

    // Porta de diagnóstico do congelamento na morte do chefe (`?qaFreeze=1`). Só publica
    // referências já existentes; nenhuma regra do jogo lê daqui. Ver `src/debug/FreezeTrace.ts`.
    exposeQA('scene',this);
    exposeQA('swarm',()=>this.enemies);
    exposeQA('objectives',()=>this.objectives);
    exposeQA('killBoss',()=>{
      const swarm=this.enemies;
      if(!(swarm instanceof EnemySwarm))return 'sem horda nesta cena';
      this.objectives.phase='boss';
      if(!swarm.boss&&!swarm.requestBoss())return 'não consegui invocar a Praga Alfa';
      this.objectives.bossSpawned=true;
      const boss=swarm.boss;
      if(!boss)return 'invocada, mas sem referência ainda — chame de novo';
      boss.target.onHit?.({attackerId:1,victimId:boss.id,sourceId:'qa_freeze',attackId:'qa',
        baseDamage:9e9,finalDamage:9e9,crit:false,procCoefficient:0,procChainDepth:0,damageTags:['qa'],
        hitPosition:{x:boss.root.position.x,y:boss.root.position.y,z:boss.root.position.z},hitNormal:{x:0,y:1,z:0},
        forceDirection:{x:0,y:1,z:0},hitDirection:{x:0,y:1,z:0},forceMagnitude:2});
      return 'golpe fatal aplicado';
    });
  }

  fixedUpdate(dt: number): void {

    // Enquanto a entrada, a conclusão do estágio ou uma revisão seguram o controle, o passo fixo
    // inteiro fica parado: nada de motor, diretor, colisão ou envio de intenção para a rede.
    // É assim que a transição congela o que é perigoso — sem nenhuma invulnerabilidade de QA.
    if(this.intro.holdsControl||this.journey.holdsControl||this.meleeReview.active||this.poseReview||this.paused || !this.started || !this.visual.ready || !this.weapons.ready || !this.skillAura.ready || (this.yard instanceof FarmWorld&&!this.yard.ready)||(this.enemies instanceof EnemySwarm&&(!this.enemies.ready||!this.enemies.navigationReady))||this.interactables&&!this.interactables.ready)return;

    if(this.skillPending||this.cinematic.preparing)return;

    // Os três primeiros passos fixos VIVOS são rastreados etapa a etapa. É aqui que a entrada acaba
    // de devolver o controle — o ponto exato em que o renderizador morreu no QA do navegador.
    const trace=this.tracedFixed<3?(stage:string):void=>traceBoot(`fixo#${this.tracedFixed}:${stage}`):undefined;
    if(trace){this.tracedFixed++;trace('entrou');}

    const input=this.paused?EMPTY_INPUT:this.input.read();if(this.reloadRunReview>0){this.reloadRunReview=Math.max(0,this.reloadRunReview-dt);input.x=0;input.z=1;input.fire=false;input.charging=false;input.aim=false;this.player.sprinting=true;}this.charging=input.charging;
    // A mira é RESOLVIDA na apresentação (ver `updateAimState`); aqui só se guarda a intenção lida.
    // Os entalhes de roda somam entre passos fixos porque um quadro pode conter vários.
    this.aimHeld=Boolean(input.aim);this.aimWheel+=input.zoomDelta??0;

    const stats=this.progression.stats;this.player.maxHP=stats.maxHP;this.player.moveMultiplier=stats.moveSpeed;this.player.sprintMultiplier=stats.sprintSpeed;this.player.jumpMultiplier=stats.jump;this.player.extraJumps=stats.extraJumps;this.player.rechargeMultiplier=stats.dodgeRecharge;this.player.armor=stats.armor;this.player.regeneration=stats.regeneration;this.weapons.cadence.rateMultiplier=stats.attackSpeed;this.prism.rateMultiplier=stats.attackSpeed;this.mp.speedMultiplier=1+(stats.mp-1)*.5;this.mp.setMaxCharges(stats.skillCharges);

    // Foco perdido, `Esc` ou pausa: a entrada foi zerada, e a mira vai junto — segurar o botão
    // direito não pode sobreviver a uma janela que deixou de receber eventos de soltar.
    if(this.cancelVersion!==this.input.cancelVersion){this.mp.cancel();this.cancelAim();this.cancelVersion=this.input.cancelVersion;}

    this.world.fixedUpdate(dt,this.player);

    // Não existe troca de arma em campo: a arma é a da CLASSE escolhida no menu (ver `classChoice`).
    // `R` vai para a arma que está na mão; a PRISM recebe o pedido dentro do próprio passo.
    if(input.reload&&this.unarmed.armed&&!this.prism.equipped)this.weapons.requestReload();
    // Online: reconcilia com o último seq confirmado antes de prever o passo seguinte; depois envia a intenção deste passo.
    this.net?.reconcile(this.player,dt);
    // O movimento enviado ao servidor continua olhando a PISTOLA: a simulação autoritativa do co-op
    // é a da fazenda com pistolas, e uma recarga de PRISM que o servidor não conhece só produziria
    // divergência de predição. A PRISM trava o próprio disparo durante a recarga dela.
    const stepInput=meleeMovement(reloadMovement(input,this.weapons.magazine.reloading),this.unarmed,this.player.grounded);
    // `heading`: número no mundo plano (o yaw global de sempre), vetor de MUNDO no planeta.
    // O contrato é o publicado pela física (`.temp/real-game-surface-api.md` §3.2); mandar o yaw
    // global numa esfera faria o corpo andar para um canto fixo do espaço em vez de para a frente.
    trace?.('motor:antes');
    this.player.fixedUpdate(dt,stepInput,this.radial?this.camera.heading:this.input.yaw);
    trace?.('motor:depois');
    this.net?.afterStep(stepInput,this.input.yaw,this.input.pitch,this.player);

    // Enfileirar continuação exige um NOVO pressionamento na janela final: segurar o botão não repete.
    const pressEdge=Boolean(input.charging)&&!this.chargingPressed;this.chargingPressed=Boolean(input.charging);
    if(pressEdge&&this.cinematic.active&&!this.cinematic.preparing&&this.cinematic.actionProgress>=.6&&this.continuationTier===undefined&&this.mp.consumeCharge()){
      this.continuationTier=this.cinematic.tier;
    }

    // O `Q` do SOLDADO é outro jogo: nível I transforma (grátis), níveis II e III são as habilidades
    // da FORMA que está nas mãos. Nenhuma cinemática de pistola é disparada por ele.
    const prismSpecial=this.soldier&&this.prism.equipped;
    const chargingAllowed=this.unarmed.armed&&!this.cinematic.active&&(prismSpecial?!this.prism.busy&&!this.prism.reloading&&!this.prism.skillActive:!this.weapons.magazine.reloading);
    const released=this.player.hp>0?this.mp.update(dt,chargingAllowed&&input.charging,prismSpecial):0;

    if(released){
      if(prismSpecial){
        this.syncWeapons();
        if(released===1)this.prism.requestMode();
        // Recusada (sem munição, recarregando, transformando): o MP volta. A barra é descontada na
        // SOLTURA do `Q`, então cobrar por uma habilidade que não saiu seria roubo silencioso.
        else if(!this.prism.releaseSkill(released===2?2:3)){this.mp.gain(MP_COSTS[released-1]!);this.audio.dodge();}
        else this.audio.skill(`prism_skill_${released}`);
      } else void this.requestSkill(released);
      return;
    }

    if(input.stance&&this.unarmed.toggle()){this.mp.cancel();this.weapons.cancelSkills();this.prism.cancel();this.weapons.holstered=!this.unarmed.armed;this.audio.dodge();}
    this.unarmed.rateMultiplier=stats.attackSpeed;
    const evading=this.player.dodgeRemaining>0||this.player.dashRemaining>0||this.player.backflipProgress>=0;
    if(evading&&this.unarmed.busy)this.unarmed.reset();
    const canAct=!evading&&this.player.hp>0&&!input.charging;
    if(!this.unarmed.armed&&input.fire&&canAct)this.unarmed.strike();
    const meleeWasActive=this.unarmed.active;
    this.unarmed.update(dt);
    if(this.unarmed.active&&!meleeWasActive)this.audio.meleeSwing();
    if(this.unarmed.active)this.resolveMelee();
    // As duas armas partilham as mesmas condições de tiro; o que muda é QUAL delas está na mão.
    // As habilidades de MP continuam sendo das pistolas: enquanto uma está no ar, a PRISM não
    // dispara (senão os dois canos cuspiriam ao mesmo tempo) e as pistolas voltam a aparecer.
    this.syncWeapons();
    const armed=this.unarmed.armed&&!input.charging&&this.player.dodgeRemaining===0&&this.player.hp>0;
    this.weapons.fixedUpdate(dt,input.fire&&armed&&this.weapons.ready&&!this.prism.equipped);
    this.prism.aiming=this.aimHeld&&this.aimAllowed;
    this.prism.fixedUpdate(dt,{fire:input.fire,reload:Boolean(input.reload)&&this.unarmed.armed,
      // `cycle` já não tem tecla: a forma avança pelo `Q` no nível I (e pelo botão de QA no F1).
      cycle:false,canAct:armed&&!this.weapons.skillActive});

    trace?.('armas:depois');
    if(this.enemies instanceof EnemySwarm){
      this.progression.time+=dt;this.enemies.fixedUpdate(dt);
      trace?.('horda:depois');
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
    this.visual.deathProgress=this.death.state==='idle'||this.ragdollOwnsBody?undefined:this.death.progress;
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
    const heldBefore=this.intro.holdsControl;
    this.intro.update(this.death.active?0:this.intro.standby?(this.paused?0:dt):animDt,cue=>this.introCue(cue));
    // A entrada acabou de devolver o controle: daqui em diante o motor, a horda e o clima andam.
    if(heldBefore&&!this.intro.holdsControl){traceBoot('entrada:controle devolvido');this.settleArrival();}
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
    // A extração é montada com `forward=(sin y,0,cos y)` e alturas em `+Y` — o MESMO espaço local
    // da entrada. Avaliada na origem com yaw 0 e remapeada pela base tangente, a nave sobe pela
    // radial verdadeira em vez de rumar para o polo norte.
    const exitYaw=this.radial?0:this.player.yaw;
    const exitOrigin=this.radial?ORIGIN:this.player.position;
    const extraction=this.dropship?.ready?extractionPresentation(this.journey.phase,this.journey.clock,exitOrigin,exitYaw):undefined;
    const exitAnchor={x:this.player.position.x,y:this.player.position.y,z:this.player.position.z};
    if(extraction&&this.radial){
      extraction.edge=this.stageToWorld(extraction.edge,exitAnchor);
      extraction.body=this.stageToWorld(extraction.body,exitAnchor);
      extraction.camera=this.stageToWorld(extraction.camera,exitAnchor);
      extraction.target=this.stageToWorld(extraction.target,exitAnchor);
    }

    // ---- entrada pela nave, no referencial do POUSO ------------------------------------------
    // A coreografia autoral (espera no deck, corrida, salto, mergulho de cabeça, impacto, levantar)
    // é construída com `forward=(sin y,0,cos y)` e alturas em `+Y`, ou seja, num espaço LOCAL
    // ancorado no pouso. Em vez de reescrevê-la, ela é avaliada nesse espaço (origem, yaw 0) e a
    // pose resultante é levada ao mundo pela base tangente da ilha. O mergulho desce pela RADIAL
    // verdadeira e os clipes autorais continuam sendo exatamente os mesmos.
    const landing=this.player.position,stagingYaw=this.radial?0:this.player.yaw;
    const stagingOrigin=this.radial?ORIGIN:landing;
    const introPose=this.intro.pose(stagingOrigin,stagingYaw);
    if(introPose&&this.radial){
      introPose.position=this.stageToWorld(introPose.position,landing);
      if(introPose.stride)introPose.stride.yaw+=this.player.yaw;
    }
    if(this.dropship){
      this.dropship.basis=this.radial?this.world.surface.basis(boarding?exitAnchor:landing,this.player.forward):undefined;
      if(this.intro.visible)this.dropship.place(this.stageToWorld(this.intro.deckEdge(stagingOrigin,stagingYaw),landing),this.player.yaw);
      else if(extraction)this.dropship.place(extraction.edge,extraction.shipYaw);
      this.dropship.update(this.paused?0:dt,this.intro.deckVisible||boarding);
    }
    this.hud.liveFlightMenu(this.intro.standby,(this.intro.holdsControl||this.journey.holdsControl)&&this.started);
    this.hud.arrivalReveal(this.intro.holdsControl&&this.started&&!this.paused,this.intro.reveal);
    this.hud.skipIntro(this.intro.holdsControl&&this.started&&!this.paused);
    const flight=this.intro.flight;
    this.visual.riflePresentation=!this.started||this.intro.standby;
    this.visual.arrivalPose=introPose?{
      sway:introPose.roll,rootLift:introPose.stride?0:flight.rootLift,
      height:flight.height,recovery:flight.recovery,dive:flight.dive,
      time:introPose.flutterTime,flutter:introPose.flutter,position:introPose.position,
      stride:introPose.stride,
    }:extraction?{height:0,recovery:0,position:extraction.body,
      stride:{clip:extraction.clip,progress:extraction.progress,yaw:this.player.yaw,pitch:0,roll:0}}:undefined;
    if(extraction&&this.dropship&&(this.journey.phase==='travel'||this.journey.clock>=1.85))
      // O corpo acompanha a subida da nave ao longo da vertical LOCAL: a diferença é medida na
      // projeção em `up`, não em `y` de mundo, que fora do polo aponta para outro lugar.
      extraction.body=this.followShipRise(extraction.body,extraction.edge);
    const draw=!this.intro.holdsControl&&this.started&&this.tracedRender<3
      ?(stage:string):void=>traceBoot(`quadro#${this.tracedRender}:${stage}`):undefined;
    if(draw){this.tracedRender++;draw('entrou');}
    const poseDt=this.death.active?deathDt:this.intro.standby?dt:animDt*slow;
    const aiming=!this.player.sprinting||this.charging||(this.aimHeld&&this.aimAllowed);
    this.visual.rifleAiming=this.aimHeld&&this.aimAllowed;
    this.prism.aiming=this.visual.rifleAiming;
    if(this.avatar)this.avatar.update(this.player,alpha,poseDt,aiming,this.charging,this.input.pitch,this.mp.seconds/2.6,this.camera.forward);
    else this.visual.update(this.player,alpha,poseDt,aiming,this.charging,this.input.pitch,this.mp.seconds/2.6);
    draw?.('avatar:depois');
    this.net?.render(animDt);

    draw?.('câmera:antes');
    // A mira apurada entra ANTES da câmera: `setAimZoom` só deixa um ALVO, e é `camera.update` que
    // interpola o FOV a partir do base neste mesmo quadro.
    const aimView=this.updateAimState(dt);
    this.camera.setSprint(this.player.sprinting&&this.started&&!this.paused&&!aimView.active);
    this.camera.update(this.visual.position,this.input.yaw,this.input.pitch,dt,this.started&&!this.intro.visible?this.player.velocity:undefined);

    const shot=this.intro.shot(stagingOrigin,stagingYaw);
    if(shot&&shot.weight>0){
      // `weight` cai sozinho na recuperação: a câmera volta ao jogo sem corte e sem ficar presa.
      // `blend` substitui o `setTarget` que estava escrito aqui: no planeta `setTarget` reconstrói
      // a rotação pelo `Y` do MUNDO e degenera exatamente quando se olha para o polo.
      this.camera.blend(this.stageToWorld(shot.position,landing),this.stageToWorld(shot.target,landing),shot.weight);
      this.camera.sprintBlendTarget=shot.sprint*shot.weight;
    }

    // O cadáver anda no relógio de apresentação: o passo fixo está parado desde `started=false`.
    this.playerRagdoll.update(this.paused?0:dt);
    if(this.ragdollOwnsBody){
      // Enquadramento no quadril do cadáver, que é o que o jogador quer ver.
      const focus=this.playerRagdoll.focus;
      // skillClose expects a foot anchor and raises its target by 1.05 m. The corpse focus is already its hips.
      this.camera.skillClose(this.liftWorld(focus,-.95),this.player.yaw,1,this.death.progress);
    }
    else if(this.death.active)this.camera.skillClose(this.deathFlight.position,this.player.yaw,1,this.death.progress);
    if(this.cinematic.preparing)this.camera.skillClose(this.visual.position,this.castYaw,this.cinematic.tier,this.cinematic.progress);
    if(extraction){
      this.camera.blend(extraction.camera,extraction.target,1);
    }
    if(this.meleeReview.active){
      // Corpo inteiro no quadro: pés e punho ao mesmo tempo, sem a aproximação das cinemáticas.
      const review=meleeReviewShot(this.radial?ORIGIN:this.visual.position,this.radial?0:this.input.yaw);
      // The regular camera is reset above on every frame; blending from it never reaches this shot.
      this.camera.blend(this.stageToWorld(review.position,this.visual.position),this.stageToWorld(review.target,this.visual.position),1);
    }

    this.syncWeapons();
    if(!this.playerRagdoll.active)this.weapons.updatePose(worldDt);
    // A pose do rig da PRISM tem de vir DEPOIS da pose do corpo: ela pendura a arma no punho já
    // amostrado do quadro. Com o cadáver no comando não existe punho vivo para pendurar.
    this.prism.updatePresentation(this.playerRagdoll.active?0:worldDt);
    this.updateSkillVisuals(this.playerRagdoll.active?0:worldDt);
    // Depois da pose do rig: a prévia da granada sai da BOCA já amostrada deste quadro, e a lente
    // da luneta só sabe o que a bloqueia depois que corpo e arma foram colocados.
    this.updateAimPresentation(aimView,dt);
    this.skillAura.update(this.cinematic,this.visual.position,this.weapons);
    this.elements.update(this.poseReview?0:animDt);if(this.intro.phase==='dive'&&introPose)this.elements.aura('fire',[this.liftWorld(introPose.position,.4)],flight.elapsed,1);
    if(this.elementPreview&&animDt>0){this.elementClock-=animDt;if(this.elementClock<=0){this.elementClock=1.6;const ahead=this.visual.position.add(this.camera.forward.scale(2.4));const at=this.liftWorld({x:ahead.x,y:ahead.y,z:ahead.z},0);this.elements.emit(this.elementPreview,new Vector3(at.x,at.y,at.z));}}
    if(this.cinematic.active){const elapsed=this.cinematic.elapsed,power=this.cinematic.preparing?Math.sin(this.cinematic.progress*Math.PI/2):Math.min(1,(1-this.cinematic.actionProgress)*5);this.elements.aura('electricity',[this.weapons.muzzlePose(0).position,this.weapons.muzzlePose(1).position,this.liftWorld({x:this.visual.position.x,y:this.visual.position.y,z:this.visual.position.z},.6)],elapsed,power);if(elapsed<this.auraLast)this.auraClock=0;if(this.cinematic.preparing&&elapsed>=this.auraClock&&elapsed<.9){this.auraClock=elapsed+.3;this.elements.emit('earth',this.visual.position,.45);}this.auraLast=elapsed;}else if(this.auraLast>=0){this.elements.clear();this.auraLast=-1;this.auraClock=0;}



    draw?.('câmera:depois');
    this.enemies.update(worldDt);this.footing.update(worldDt);this.abyss?.update(worldDt);
    this.expeditionSites?.update(animDt,this.objectives.totems,this.objectives.activeIndex,
      this.objectives.collected?(this.journey.phase==='harvest'?this.journey.clock/1.8:1):0,this.objectives.discovered);
    // Clima: relógio real + crédito por abates; a chuva viaja com a câmera.
    this.weather.paused=this.paused||!this.started;
    this.weather.update(animDt,this.enemies instanceof EnemySwarm?this.enemies.kills:0);
    this.weatherView?.update(this.weather,this.camera.camera.position,animDt);

    if(this.enemies instanceof EnemySwarm)this.enemies.updateCameraVisibility(this.camera.camera.position,dt);

    this.world.update(worldDt);

    for(const target of this.yard.targets)if(target.ring)target.ring.scaling.setAll(1+(target.ring.scaling.x-1)*Math.exp(-dt*18));

    // O cadáver articulado precisa de Havok DEPOIS de `started=false`. Sem este `||` o corpo
    // congelaria no ar no quadro da morte — que é o oposto do pedido.
    this.scene.physicsEnabled=(this.playerRagdoll.active&&!this.paused)||this.started&&!this.paused&&!this.intro.holdsControl&&!this.meleeReview.active&&!this.cinematic.preparing&&!this.skillPending;draw?.('cena:antes de render');this.scene.render();draw?.('cena:depois de render');this.hud.update(this.player,this.weapons,this.visual.error||this.weapons.error||this.skillAura.error||this.enemies.error||this.interactables?.error||(this.yard instanceof FarmWorld?this.yard.error:''),this.mp,this.enemies,animDt,this.weaponReadout());

    if(this.enemies instanceof EnemySwarm){
      this.runHUD!.setVisible(this.started&&this.player.hp>0);
      if(this.yard instanceof PlanetWorld&&this.yard.manifest){
        const manifest=this.yard.manifest;
        this.explorationMap?.update(dt,this.started&&this.player.hp>0&&!this.intro.holdsControl&&!this.journey.holdsControl,`${this.attemptSeed}:${this.progression.stage}`,this.world.sites,manifest.bridges,this.world.surface,manifest.centre,this.player.position,this.player.forward,this.objectives.discovered?this.objectives.totems[0]?.site.position:undefined,this.runHUD!.atlasOpen);
      }

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
          :this.objectives.discovered&&pending?`${this.objectives.signalAcquired?'Sinal do cálice':'Cálice encontrado'} · ${pending.totem.site.name} · ${Math.round(pending.distance)} m`
          :'Explore as ilhas · saqueie baús e encontre o cálice');
      }
      this.hud.stageJourney(this.journey);
    }

  }

  // ---------------------------------------------------------------- arma em uso

  /**
   * Quem está nas mãos NESTE quadro.
   *
   * Uma arma por vez: a PRISM viva esconde as pistolas (`concealed`, que é só apresentação — o
   * backend delas continua inteiro). Tudo que retém o controle — entrada pela nave, viagem,
   * revisão, cinemática de habilidade, morte — guarda a PRISM sem mexer em munição nem em forma.
   *
   * As três habilidades de MP continuam sendo das pistolas por AUTORIA: leque, barragem e
   * tempestade têm clipe, voz, coreografia e mira próprias, todas escritas em cima do par de
   * pistolas. Enquanto uma delas está no ar as pistolas voltam às mãos e a PRISM some, senão a
   * cinemática tocaria com as mãos vazias e os dois canos disparariam ao mesmo tempo.
   */
  private syncWeapons():void {
    const performing=this.cinematic.active||this.skillPending||this.weapons.skillActive;
    const down=this.player.hp<=0||this.death.active||this.playerRagdoll.active;
    this.prism.holstered=!this.unarmed.armed;
    this.prism.suppressed=performing||this.intro.holdsControl||this.journey.holdsControl
      ||this.meleeReview.active||this.poseReview||down;
    // Soldado: as pistolas ficam escondidas o tempo TODO, e não só quando a PRISM está no ar. Sem
    // este `||` elas reapareceriam nas mãos durante a entrada pela nave e a viagem — que é
    // exatamente quando a PRISM está suprimida. O cadáver continua recebendo o par de pistolas
    // (o `PlayerKilled` desliga `concealed` de propósito), e é por isso que `down` sai daqui.
    this.weapons.concealed=this.prism.live||(this.soldier&&this.prism.equipped&&!down);
  }

  /**
   * Aplica a CLASSE escolhida: quem nasce nas mãos e o que o `Q` vai fazer.
   *
   * Chamada no menu (a cada escolha), quando o rig da PRISM termina de carregar e a cada reinício
   * de tentativa. É idempotente de propósito: `setEquipped` recusa o que já vale, e por isso pode
   * ser chamada de qualquer um desses pontos sem cancelar recarga nem munição por engano.
   *
   * Degradação escrita: Soldado sem rig (`prism.ready === false`) recebe as pistolas e o motivo
   * aparece no F1 — entrar em campo desarmado nunca é uma opção.
   */
  private applyPlayerClass():void {
    const soldier=this.soldier;
    if(this.prism.equipped!==soldier){
      this.prism.setEquipped(soldier);
      this.prism.cancel();
      this.weapons.magazine.cancel();
      this.weapons.cancelSkills();
      this.mp.cancel();
      this.cancelAim();
    }
    this.syncWeapons();
    this.hud?.showPlayerClass(this.classChoice.id);
  }

  // ---------------------------------------------------------------- mira apurada (ADS)

  /**
   * Pode mirar NESTE quadro?
   *
   * É a lista inteira dos cancelamentos pedidos, num lugar só. Tudo o que retém o controle, tudo o
   * que tira a arma das mãos e tudo o que já é uma ação exclusiva desliga a mira — inclusive o
   * menu aberto, que aqui aparece como `!started` (é o mesmo sinal que o HUD usa para pôr
   * `body.game-menu-open`). Com o menu na tela a mira nem chega a mudar de estado: ela é solta e
   * fica solta enquanto ele estiver lá.
   */
  private get aimAllowed():boolean {
    if(!this.started||this.paused)return false;
    if(this.player.hp<=0||this.death.active||this.playerRagdoll.active)return false;
    if(this.intro.holdsControl||this.journey.holdsControl||this.meleeReview.active||this.poseReview)return false;
    // Habilidade de MP: preparação, atuação e a própria carga do `Q`.
    if(this.cinematic.active||this.skillPending||this.weapons.skillActive||this.charging)return false;
    // Punhos (`V`) e combo em curso.
    if(!this.unarmed.armed||this.unarmed.busy||this.player.dodgeRemaining>0)return false;
    // Recarga da arma na mão e transformação da PRISM.
    if(this.prism.equipped)return !this.prism.busy&&!this.prism.reloading;
    return !this.weapons.magazine.reloading;
  }

  /**
   * Resolve a mira do quadro: estado, aproximação da câmera, sensibilidade e sobreposição visual.
   *
   * A roda é lida aqui e ZERADA aqui, sempre — mesmo quando o modo em vigor não a usa. É assim que
   * rolar a roda com a granada na mão não guarda uma aproximação que apareceria de surpresa ao
   * trocar para o sniper.
   */
  private updateAimState(dt:number):AimView {
    const wheel=this.aimWheel;this.aimWheel=0;
    const view=this.aim.update({
      hold:this.aimHeld,
      kind:aimKindFor({prismReady:this.prism.ready,prismEquipped:this.prism.equipped,prismMode:this.prism.mode}),
      allowed:this.aimAllowed,
      wheel,
    });
    this.camera.setAimZoom(view.zoom);
    // Sensibilidade INVERSAMENTE proporcional à aproximação: o mesmo gesto de pulso varre o mesmo
    // ângulo de TELA com ou sem luneta. Vale para as duas câmeras, porque a radial converte o
    // acumulador de volta a pixels dividindo pela constante de sintonia, não por este valor.
    this.input.sensitivity=CAMERA_TUNING.sensitivity*this.aim.sensitivityScale;
    this.aimOverlay.update(view);
    void dt;
    return view;
  }

  /**
   * A parte da mira que depende de corpo e arma já colocados: a trajetória prevista da cápsula e a
   * lente limpa da luneta.
   */
  private updateAimPresentation(view:AimView,dt:number):void {
    // Luneta: só o sniper esconde o que está colado na lente, e só enquanto estiver mirando.
    this.scopeOcclusion.apply(this.aim.scoped&&this.prism.live,this.camera.camera.position);
    if(!view.active||view.kind!=='grenade'||!this.prism.live){
      this.trajectory.hide();this.trajectoryGate.reset();return;
    }
    // O porteiro cobra o custo: no máximo dez integrações por segundo, e nenhuma com o cano e a
    // mira parados. O olho e a frente da câmera são o par barato que resume as duas coisas.
    const eye=this.camera.camera.position,look=this.camera.forward;
    if(!this.trajectoryGate.due(dt,{x:eye.x,y:eye.y,z:eye.z},{x:look.x,y:look.y,z:look.z}))return;
    const prediction=this.prism.previewGrenade();
    if(!prediction){this.trajectory.hide();return;}
    // `impact` ausente = estopim estourado no ar (ou arco truncado): arco desenhado, chão NÃO
    // marcado. Marcar um ponto de queda que não existe seria pior do que não marcar nada.
    this.trajectory.show(prediction.points,prediction.impact);
  }

  /** Solta a mira agora e apaga tudo o que ela desenha. Foco perdido, pausa, morte, reinício. */
  private cancelAim():void {
    this.aimHeld=false;this.aimWheel=0;
    this.aim.cancel();
    this.camera.setAimZoom(1);
    this.input.sensitivity=CAMERA_TUNING.sensitivity;
    this.scopeOcclusion.restore();
    this.trajectory.hide();
    this.trajectoryGate.reset();
    this.aimOverlay.update(this.aim.view());
  }

  /**
   * As malhas que podem tapar a lente: o corpo do exterminador e o rig da PRISM.
   *
   * As pistolas ficam de fora porque elas não têm luneta — `AIM_MODES.pistols.scope` é `false`, e
   * esconder o que não atrapalha só criaria um piscar sem motivo.
   */
  private *scopeCandidates():Iterable<AbstractMesh> {
    for(const mesh of this.visual.meshes)yield mesh;
    if(this.prism.ready)for(const mesh of this.prismRig.root.getChildMeshes())yield mesh;
  }

  /**
   * Linha do F1 para a PRISM: forma, munição POR FORMA, cápsulas no ar e o motivo de uma falha.
   * Munição por forma está escrita de propósito — é assim que o QA confere que trocar de arma não
   * enche carregador nenhum.
   */
  private prismDebug():string {
    const cls=`Classe ${PLAYER_CLASSES[this.classChoice.id].name}`;
    if(!this.prism.ready)
      return `${cls} · PRISM: ${this.prismError||(this.prismSettled?'rig indisponível':'carregando')}`
        +`${this.classChoice.id==='soldier'?' · SOLDADO REBAIXADO ÀS PISTOLAS':' · jogo nas pistolas'}`;
    if(!this.prism.equipped)
      return `${cls} · PRISM fora da tentativa (arma da classe: pistolas duplas)`;
    const skillII=this.prism.skillFor(2),skillIII=this.prism.skillFor(3);
    const ammo=[0,1,2].map(mode=>this.prism.arsenal.magazineOf(mode as 0|1|2))
      .map(magazine=>`${magazine.ammo}/${magazine.capacity}`).join(' · ');
    return `${cls} · Q II ${skillII.name} (${skillII.ammoCost||skillII.ammoRequired} mun · 55 MP)`
      +` · Q III ${skillIII.name} (${skillIII.ammoCost||skillIII.ammoRequired} mun · 100 MP)`
      +`${this.prism.skillActive?` · NO AR: ${this.prism.skillLabel}${this.prism.overdriveRemaining>0?` ${this.prism.overdriveRemaining.toFixed(1)} s`:''}`:''}`
      +` · habilidades soltas ${this.prism.skillReleases}`
      +`\nPRISM ${this.prism.equipped?'EQUIPADA':'guardada'} · ${this.prism.tuning.name}`
      +`${this.prism.busy?' · TRANSFORMANDO':this.prism.reloading?` · recarregando ${Math.round(this.prism.magazine.progress*100)}%`:''}`
      +` · carregadores ${ammo} · disparos ${this.prism.shots} · explosões ${this.prism.blasts}`
      +` · cápsulas no ar ${this.prism.grenades.count}`
      +`${this.prismVisuals.error?` · projéteis: ${this.prismVisuals.error}`:''}`
      +`\nMira ${this.aim.active?`${this.aim.kind} · ${this.aim.zoom.toFixed(2)}×`:'livre'}`
      +` · luneta ${this.aim.scoped?`aberta (${this.scopeOcclusion.count} malhas ocultas)`:'fechada'}`
      +` · trajetória ${this.trajectory.active?'desenhada':'oculta'}`;
  }

  /** Painel de arma: nome, munição e os controles que valem agora (ver `weaponReadout`). */
  private weaponReadout() {
    return weaponReadout({
      playerClass:this.classChoice.id,
      holstered:!this.unarmed.armed,
      prismReady:this.prism.ready,prismEquipped:this.prism.equipped,prismMode:this.prism.mode,
      prismAmmo:this.prism.magazine.ammo,prismCapacity:this.prism.magazine.capacity,
      prismReloading:this.prism.magazine.reloading,prismProgress:this.prism.magazine.progress,
      prismBusy:this.prism.busy,
      pistolAmmo:this.weapons.magazine.ammo,pistolCapacity:this.weapons.magazine.capacity,
      pistolReloading:this.weapons.magazine.reloading,pistolProgress:this.weapons.magazine.progress,
      aiming:this.aim.active,
      // Uma habilidade no ar manda no painel e na barra de carga, seja de qual classe for.
      activeSkill:this.prism.skillActive?this.prism.skillLabel
        :this.weapons.stormRemaining>0?'TEMPESTADE DA COLHEITA':'',
    });
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
    this.intro.abort();this.cancelCinematic();this.weapons.cancelSkills();this.prism.cancel();
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
    // Num mapa que sabe a própria topologia (o planeta), quem responde é o MAPA: o grafo de pontes
    // dá a rota a pé entre ilhas em tempo constante. Consultar o Detour aqui seria pedir ao
    // sistema errado — as cartas de ilha são locais, uma rota entre ilhas atravessa várias, e o
    // custo disso dentro do sorteio de estágio é o que travava o carregamento.
    if(this.radial)return this.world.routeLength(from,to);
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
    if(this.radial&&!this.world.ready)return undefined;
    const swarm=this.enemies,surface=this.world.surface,fullBiome=this.biomeFor(stage);
    if(!fullBiome)return undefined;
    const started=performance.now();
    /**
     * No planeta o sorteio olha um SUBCONJUNTO das ilhas, não as 38.
     *
     * Cada ilha reprovada custa uma varredura de anéis contra uma BVH de 1,75 milhão de
     * triângulos — sondas de apoio, varreduras de espaço livre e teste de interior sólido. Isso é
     * trabalho síncrono na thread da interface: com as 38 no pior caso, o carregamento congelava
     * por dezenas de segundos (foi o travamento duro relatado no navegador).
     *
     * O corte não enfraquece a regra: `planStage` já devolve no PRIMEIRO par válido, a auditoria do
     * mapa achou pouso em 38/38 e arena em 16/38, e uma falha não é fatal — a tentativa seguinte
     * (`planRetry`) sorteia OUTRO subconjunto, porque a semente carrega o número da tentativa.
     */
    const biome=this.radial?{...fullBiome,islands:pickIslands(fullBiome.islands,
      new RunRNG(`${this.attemptSeed}:stage:${stage}:pool:${this.planAttempt}`).stream('scene'),RADIAL_ISLAND_POOL)}:fullBiome;
    // Os tiles distantes são podados durante o jogo; uma rota entre ilhas os atravessa inteira.
    swarm.tactical?.restoreNavigation();
    const radii=new Map<string,number>();
    const rng=new RunRNG(`${this.attemptSeed}:stage:${stage}`).stream('scene');
    const plan=planStage(biome,rng,{
      spawnPoint:island=>findSpawnPoint(surface,island),
      chalicePoint:island=>{
        for(const radius of [TOTEM_RADIUS,8.5,6.5]){
          const at=findTotemSite(surface,island,radius,()=>true);
          if(at){radii.set(island.id,radius);return at;}
        }
        return undefined;
      },
      route:(spawn,chalice)=>this.routeLength(spawn,chalice),
      // No planeta o filtro barato tem de ser o ARCO: dois pontos em lados opostos da casca têm
      // `dx`/`dz` pequenos e estão a meia circunferência de caminhada.
      distance:(a,b)=>surface.planarDistance(a,b),
    },{minRoute:biome.separation>=WIDE_ISLAND_SEPARATION?WIDE_MIN_ROUTE:HOME_MIN_ROUTE});
    stageTiming(`sorteio do estágio ${stage} · ${biome.islands.length} ilhas · ${plan?.examined??0} pares`,started);
    if(!plan){this.planAttempt++;return undefined;}
    this.planAttempt=0;
    const site:TotemSite={id:plan.chaliceIsland.id,name:plan.chaliceIsland.name,index:0,
      position:plan.chalice,radius:radii.get(plan.chaliceIsland.id)??TOTEM_RADIUS,juiceTarget:FINAL_CHALICE_JUICE};
    const setup={plan,site};
    this.stagePlans.set(stage,setup);
    return setup;
  }

  /**
   * Recorte de terreno físico em volta do cadáver, no planeta.
   *
   * A casca tem 1,75 M de triângulos e não existe corpo estático de Havok para ela — registrar a
   * malha inteira seria inviável. Aqui vai só o que está perto do cadáver, e o `release` devolvido
   * é chamado pelo próprio `PlayerRagdoll` quando o corpo é recolhido.
   */
  /**
   * As três visuais das habilidades novas do assalto, por quadro.
   *
   * Roda no relógio de APRESENTAÇÃO (`worldDt`), não no passo fixo: pausar o jogo congela o feixe,
   * o fogo e os anéis junto com o resto, e a câmera lenta os acompanha de graça.
   *
   * Nenhuma delas decide nada — feixe, marcação e poça já existem na simulação e foram testados
   * sem cena. Aqui só se lê o estado e se desenha.
   */
  private updateSkillVisuals(dt:number):void {
    // ---- feixe de íons: carga no cano e, depois, o feixe sustentado enquanto durar
    if(this.prism.skillKind==='beam'){
      if(this.prism.skillCharging)this.ionBeam.charge(this.prism.muzzlePoint(),this.prism.skillChargeProgress);
      else {
        const segment=this.prism.beamSegment;
        if(segment)this.ionBeam.show(segment.from,segment.to,1+this.progression.stats.mp*.15);
      }
    }
    this.ionBeam.update(dt);

    // ---- anéis dos alvos marcados, apertando enquanto a contagem corre
    const marks=this.markBuffer;marks.length=0;
    if(this.prism.skillKind==='strike'){
      const progress=this.prism.skillChargeProgress;
      for(const target of this.prism.markedTargets){
        const centre=target.mesh.getBoundingInfo().boundingBox.centerWorld;
        const up=this.world.surface.up({x:centre.x,y:centre.y,z:centre.z});
        marks.push({position:centre,up:new Vector3(up.x,up.y,up.z),progress,
          radius:target.mesh.getBoundingInfo().boundingSphere.radiusWorld||1});
      }
    }
    this.strikeMarker.render(marks);

    // ---- chão em chamas: a horda é dona das poças, porque é ela que tem os corpos para queimar
    if(this.enemies instanceof EnemySwarm)
      this.groundFireView.render(this.enemies.groundFire.patches,dt,this.enemies.flames);
  }

  private localRagdollTerrain(centre:Vec3):(()=>void)|undefined {
    const world=this.yard instanceof PlanetWorld?this.yard:undefined;
    // Teto de triângulos: medido no asset real, um raio de 14 m numa ilha densa devolve mais de
    // 100 mil triângulos, e transformar isso num corpo de malha de Havok trava o quadro da MORTE —
    // justamente o quadro em que o jogador está olhando. Ver `PlanetCollision.trianglesAround`.
    const patch=world?.trianglePatch(centre,14,6000);
    if(!patch)return undefined;
    try{return addRagdollTerrain(this.scene,`player-corpse-${Math.round(performance.now())}`,patch);}
    catch{return undefined;}
  }

  // ---------------------------------------------------------------- morte articulada

  /**
   * Solta o cadáver articulado com o golpe fatal REAL.
   *
   * `velocity` e `lethal` são lidos do estado do instante da morte, antes de a cena zerar corrida,
   * habilidades e entrada — é o que faz o corpo ser jogado na direção do golpe em vez de cair no
   * lugar. Falhar aqui não custa nada: `start` devolve `false` e a morte segue com o clipe autoral
   * de sempre, que continua no lugar.
   */
  private startPlayerRagdoll(context:DamageContext):void {
    if(!this.playerRagdoll.ready||!this.visual.ready)return;
    const skinned=this.visual.meshes.find(mesh=>mesh.skeleton);
    const skeleton=skinned?.skeleton;
    if(!skeleton||!skinned)return;
    const started=this.playerRagdoll.start({
      pose:{skeleton,root:skinned},
      equipment:this.weapons.corpseEquipment(),
      velocity:{...this.player.velocity},
      lethal:{direction:context.forceDirection,magnitude:context.forceMagnitude,point:context.hitPosition},
    });
    if(!started)return;
    // O rig vivo sai de cena; quem aparece é o clone físico. Sem isto o corpo rígido ficaria
    // dentro do cadáver articulado, sobrepostos.
    this.visual.root.setEnabled(false);
  }

  /** Enquanto o cadáver articulado existe, o clipe rígido de morte NÃO escreve osso nenhum. */
  private get ragdollOwnsBody():boolean {return this.playerRagdoll.active;}

  // ---------------------------------------------------------------- diagnóstico (F1) no planeta

  /**
   * Ponto de QA relativo a uma âncora, no plano tangente e assentado no apoio real.
   *
   * `side`/`ahead` são metros nas tangentes direita/frente da âncora, `lift` sobe pela vertical
   * local. No mundo plano a base é `{+X,+Y,+Z}`, então `qaSpotNear(at,0,-2.5,.2)` devolve
   * exatamente `{x, y+.2, z-2.5}` — os mesmos números dos botões de sempre.
   */
  private qaSpotNear(at:Vec3,side:number,ahead:number,lift:number):Vec3 {
    const surface=this.world.surface;
    const b=surface.basis(at,{x:0,y:0,z:1});
    const spot=surface.walk(at,{
      x:b.right.x*side+b.forward.x*ahead,
      y:b.right.y*side+b.forward.y*ahead,
      z:b.right.z*side+b.forward.z*ahead,
    });
    const support=surface.support(spot,PLAYER_TUNING.height,PLAYER_TUNING.height,PLAYER_TUNING.maxSlopeDegrees);
    const ground=support?support.point:spot;
    const up=surface.up(ground);
    return {x:ground.x+up.x*lift,y:ground.y+up.y*lift,z:ground.z+up.z*lift};
  }

  /** Vira o corpo e a câmera para uma âncora, nos dois mapas. */
  private faceQa(at:Vec3):void {
    if(!this.radial){this.input.yaw=0;return;}
    const here=this.player.position;
    const heading=this.world.surface.basis(here,{x:at.x-here.x,y:at.y-here.y,z:at.z-here.z}).forward;
    this.camera.snapTo(here,heading);
    this.player.setHeading(heading);
  }

  /**
   * Recusa um atalho de QA que só existe em coordenadas AUTORAIS da fazenda.
   *
   * Esses botões ficam visíveis para o usuário. Num planeta as coordenadas deles caem dentro do
   * miolo da esfera, e o corpo seria enterrado no núcleo — um estado quebrado provocado por um
   * botão de diagnóstico. Recusar e dizer o motivo é o comportamento correto.
   */
  private qaRefuseFlat(name:string):boolean {
    if(!this.radial)return false;
    this.qaNotice=`"${name}" usa coordenadas da fazenda e não existe neste mapa`;
    return true;
  }
  private qaNotice='';

  /**
   * Morte articulada do jogador.
   *
   * O clone físico é preparado no CARREGAMENTO e fica escondido; na morte ele recebe a pose do rig
   * vivo e solta. O rig vivo nunca é escrito — por isso o clipe `FinalDeath` é SUPRIMIDO enquanto
   * o cadáver articulado existe: dois donos escrevendo os mesmos ossos é exatamente a briga que o
   * usuário descreveu como "morte dura".
   */
  private readonly playerRagdoll:PlayerRagdoll;

  /**
   * O corpo embarcado sobe junto com a nave.
   *
   * A nave flutua e depois decola; o corpo em pé no deck tem de acompanhar essa subida. No mundo
   * plano isso é a diferença em `y` entre a raiz da nave e a borda do deck — que é como o jogo
   * sempre fez. No mapa curvo a mesma diferença é medida na projeção da vertical LOCAL: usar `y` de
   * mundo faria o corpo escorregar para o lado enquanto a nave sobe pela radial.
   */
  private followShipRise(body:Vec3,edge:Vec3):Vec3 {
    const ship=this.dropship?.root.position;
    if(!ship)return body;
    if(!this.radial)return {x:body.x,y:body.y+ship.y-edge.y,z:body.z};
    const up=this.world.surface.up(body);
    const rise=(ship.x-edge.x)*up.x+(ship.y-edge.y)*up.y+(ship.z-edge.z)*up.z;
    return {x:body.x+up.x*rise,y:body.y+up.y*rise,z:body.z+up.z*rise};
  }

  /**
   * Assenta um ponto de chegada sobre o convés, com a folga do pé.
   *
   * `findSpawnPoint` devolve o ponto de CONTATO da sonda. Num convés curvo a ponta arredondada da
   * cápsula penetra `r·(1 − cos θ)` se o pé for posto exatamente ali, e o desencrave empurra o
   * corpo ao longo da normal — que é justamente como um pouso válido vira um corpo escorregando ou
   * caindo. A prévia esférica já resolvia isto com `respawnAbove(probe, .4)`; aqui a folga é medida
   * na inclinação real em vez de fixa.
   *
   * No mundo plano devolve o ponto como veio: `groundAt` já é a cota em que o corpo fica de pé.
   */
  private seatOnDeck(at:Vec3):Vec3 {
    if(!this.radial)return at;
    const surface=this.world.surface;
    const support=surface.support(at,PLAYER_TUNING.stepHeight,PLAYER_TUNING.stepHeight+.02,PLAYER_TUNING.maxSlopeDegrees);
    const ground=support?support.point:at;
    const facing=Math.cos(Math.min(85,support?.slopeDegrees??0)*Math.PI/180);
    const clearance=PLAYER_TUNING.radius*(1/Math.max(.2,facing)-1)+.02;
    const up=surface.up(ground);
    return {x:ground.x+up.x*clearance,y:ground.y+up.y*clearance,z:ground.z+up.z*clearance};
  }

  /**
   * Confere o pouso no instante em que a entrada devolve o controle.
   *
   * A chegada é uma sequência ROTEIRIZADA: enquanto ela roda o passo fixo está congelado e o
   * contrato é "o corpo termina no pouso validado". Se por qualquer motivo o corpo chegar aqui sem
   * apoio — ou dentro do vazio — reassentá-lo é a correção certa, e sem dano: o jogador não caiu,
   * a transição é que errou. Sem isto o motor faz a coisa correta pelo motivo errado e cobra 35%
   * da vida por uma queda que ninguém provocou (foi o que o QA viu: 1 retorno, 84/130).
   */
  private settleArrival():void {
    if(!this.radial||this.player.hp<=0)return;
    const surface=this.world.surface,at=this.player.position;
    const support=surface.support(at,PLAYER_TUNING.stepHeight,PLAYER_TUNING.height,PLAYER_TUNING.maxSlopeDegrees);
    const stranded=surface.belowVoid(at)||!support;
    traceBoot(`pouso:raio ${Math.round(this.world.surface.altitude(at)*100)/100} m · apoio ${support?support.offset.toFixed(2):'nenhum'}${stranded?' · REASSENTADO':''}`);
    if(!stranded)return;
    this.player.arriveAt(this.seatOnDeck(this.spawn));
  }

  /**
   * Semeia os baús nos decks reais do mapa.
   *
   * Só roda quando as DUAS pontas existem: os baús autorais já carregados (`lootReady`) e o mapa
   * montado (`world.ready`, portanto depois de `configurePlanet`). Chamar antes trocaria a lista
   * por posições sorteadas num referencial que ainda é plano, e os baús nasceriam dentro da rocha.
   *
   * É idempotente por contrato (`.temp/real-game-loot-api.md`): mesma semente e mesmos sítios dão
   * as mesmas posições, e baús já abertos continuam abertos. Por isso pode ser chamado de novo na
   * troca de estágio e na repetição da tentativa sem embaralhar a corrida em curso.
   */
  private applyLootPlacement():void {
    const interactables=this.interactables;
    if(!interactables||!this.lootReady||!this.radial||!this.world.ready||!this.stageSetup)return;
    interactables.configurePlacement({
      sites:this.world.sites,
      spawn:this.spawn,
      // Função, nunca valor: o referencial do mundo troca quando o planeta é configurado.
      surface:()=>this.world.surface,
      // A semente é a da TENTATIVA: repetir com a mesma semente devolve o mesmo mapa de baús,
      // e uma tentativa nova sorteia outro — a mesma regra que já vale para ilha e cálice.
      seed:`${this.attemptSeed}:stage:${this.progression.stage}`,
    });
    // A malha do baú é desenho; o CORPO dele é esta lista. Sem anexar, o baú do planeta seria
    // atravessado — a BVH do manifesto é assada sobre o asset e não contém nada criado em
    // tempo de execução. O `PlayerMotor` original continua consultando `.surface` como sempre;
    // é o referencial que passa a incluir os props.
    this.collision.attachRadialProps('loot',interactables.props);
  }

  /**
   * Malha de navegação do planeta: uma carta rígida por ilha.
   *
   * `EnemySwarm.prepareNavigation()` é o caminho da fazenda (navmesh assada única). No planeta quem
   * monta é `TacticalNavigation.createIslands`, que precisa do manifesto. Os dois campos escritos
   * aqui (`tactical`, `navigationReady`) são públicos no `EnemySwarm` justamente para isto, então
   * a integração liga a navegação sem a horda precisar conhecer manifesto nenhum.
   *
   * Falhar aqui NÃO derruba a partida: sem Detour a horda cai na perseguição local do
   * `FarmNavigation`, que é degradação anunciada no F1 — nunca uma cena sem inimigos.
   */
  private async prepareIslandNavigation(world:PlanetWorld):Promise<void> {
    const swarm=this.enemies,manifest=world.manifest;
    if(!(swarm instanceof EnemySwarm)||!manifest)return;
    const started=performance.now();
    try{
      // Sem `.bin` assado NÃO se assa em tempo de execução.
      //
      // `createIslands` é `async`, mas o trabalho dele é CPU síncrona: `await` não devolve a thread
      // no meio de um Recast. Assar 38 navmeshes aqui congelaria a aba do mesmo jeito, só que
      // depois da tela de carregamento em vez de durante — que foi exatamente o travamento duro
      // relatado. Enquanto o bake offline não existir, a horda joga em perseguição local e o HUD
      // diz o porquê. Ver `scripts/` (dono: worker de inimigos).
      if(!await bakedIslandNavmesh(manifest.islands[0]?.id??'')){
        this.navigationNotice='Cartas de ilha não assadas · horda em perseguição local (rode o bake offline)';
        return;
      }
      const tactical=await TacticalNavigation.createIslands({
        centre:manifest.centre,radius:manifest.radius,
        islands:manifest.islands.map(i=>({id:i.id,centre:i.centre,up:i.up,radius:i.radius})),
        bridges:manifest.bridges.map(b=>({a:b.a,b:b.b,waypoints:b.waypoints})),
        positions:manifest.positions,indices:manifest.indices,
        baked:id=>bakedIslandNavmesh(id),
      });
      if(this.disposed){tactical.dispose();return;}
      swarm.tactical=tactical;swarm.navigationReady=true;
      traceBoot('navegação:cartas de ilha prontas');
      stageTiming('navegação por ilha',started);
    }catch(error){
      this.navigationNotice=`Navegação por ilha indisponível (${error instanceof Error?error.message:'falha'}) · horda em perseguição local`;
      // Sem Detour a horda ainda joga; liberar o carregamento é o que impede a cena travar.
      swarm.navigationReady=true;
    }
  }

  /**
   * Bioma do estágio.
   *
   * A fazenda tem os biomas na autoria (`STAGE_BIOMES`); o planeta traz as próprias ilhas e elas
   * viram regiões nomeadas em `siteBiomes`. A rotação por estágio é a mesma nos dois.
   */
  private biomeFor(stage:number):StageBiome|undefined {
    return this.radial?siteBiomeForStage(this.worldBiomes,stage):biomeForStage(stage);
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
      // Plan against the same restored scenery that the destination will display.
      if(this.yard instanceof PlanetWorld)this.yard.restoreScenery();
      // Temporary cups/chests from the previous stage must not become the new site's ground.
      this.collision.detachRadialProps('expedition-sites');
      this.collision.detachRadialProps('loot');
      const setup=this.buildStageSetup(stage);
      if(this.disposed||version!==this.planVersion)return;
      if(!setup)throw Error(`Sem par de ilhas válido em ${biome.name}`);
      if(!isOuterDeck(this.world.surface,setup.site.position)){
        this.stagePlans.delete(stage);this.planAttempt++;
        throw Error(`Cálice sem superfície externa válida em ${setup.site.name}`);
      }
      // O cálice entra AQUI, esperado de verdade. Falhar aqui é falhar o plano.
      await this.prepareExpeditionSite(setup,version);
      if(this.disposed||version!==this.planVersion)return;
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
   * Monta o sítio do cálice do plano ANTES de o plano valer, e o deixa escondido.
   *
   * É a correção central do relatório "não existe cálice nenhum no mapa". Antes, `applyStageSetup`
   * ligava `planReady` e largava `void sites.load(...)`: o selo de runas podia chegar, o copo não, e
   * o estágio ficava jogável com um objetivo invisível — sem erro na tela, sem nova tentativa.
   * Agora `ExpeditionSites.load` é esperado, já repete sozinho `SITE_LOAD_ATTEMPTS` vezes, e uma
   * falha vira exceção: a viagem espera e tenta outro plano, o arranque mostra o motivo, e
   * inventário/nível/classe não são tocados porque nada foi consumido.
   *
   * Fica invisível até a aplicação: durante a viagem o sítio do estágio ANTERIOR ainda está em cena,
   * e dois copos ao mesmo tempo seria pior que nenhum.
   */
  private async prepareExpeditionSite(setup:StageSetup,version:number):Promise<void> {
    this.pendingSites?.dispose();this.pendingSites=undefined;
    const sites=new ExpeditionSites(this.scene,this.collision,this.world.surface);
    sites.setVisible(false);
    // O mesmo formato que `objectives.setSites([site])` produz: um marco, índice 0, vazio.
    const built=await sites.load([{site:{...setup.site,index:0},charged:0,state:'available'}]);
    if(this.disposed||version!==this.planVersion){sites.dispose();return;}
    if(!built){
      this.siteError=sites.error||'cálice da colheita não carregou';
      sites.dispose();
      throw Error(`Cálice não montou em ${setup.site.name} · ${this.siteError}`);
    }
    this.siteError='';this.pendingSites=sites;
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
    const prepared=this.pendingSites;
    if(!prepared?.ready){
      this.planError='O cálice ainda não está pronto';this.planReady=false;
      if(this.journey.active)this.journey.returnToTravel(this.planError);
      else this.planRetry=2;
      return;
    }
    if(arrival){
      if(this.journey.consumeAdvance())this.progression.advanceStage();
      if(this.enemies instanceof EnemySwarm)this.enemies.nextStage();
      this.interactables?.reset();this.resonance.reset();this.bossRequestClock=0;
    }
    this.objectives.reset();this.objectives.setSites([site]);
    // O sítio antigo sai de cena: o registro de corpos dele tem de sair junto, senão o cálice do
    // estágio anterior continuaria sólido no ar sobre uma ilha que ninguém mais visita.
    this.collision.detachRadialProps('expedition-sites');
    this.expeditionSites?.dispose();
    // Only a fully loaded site may commit a stage transition.
    this.expeditionSites=prepared;
    this.pendingSites=undefined;
    this.expeditionSites.setVisible(true);
    // O corpo do cálice entra no referencial pela mesma porta do baú. Um id por sítio, então
    // trocar de estágio substitui o registro em vez de empilhar cálices invisíveis.
    this.collision.attachRadialProps('expedition-sites',this.expeditionSites.props);
    this.stageSetup=setup;this.pendingSetup=undefined;this.planReady=true;this.planError='';
    this.spawn.set(plan.spawn.x,plan.spawn.y,plan.spawn.z);
    // Fora da chegada, um plano que resolve tarde nunca teleporta um jogo já em curso.
    if(arrival||!this.started){
      this.player.maxHP=this.progression.stats.maxHP;
      // `arriveAt` (e não `resetAt`) reescreve TAMBÉM a origem de recuperação do motor: depois de
      // viajar, cair de uma ilha do bosque não pode devolver o corpo ao campo inicial do estágio 1.
      this.player.arriveAt(this.seatOnDeck(this.spawn));
      this.mp.cancel();this.cancelCinematic();this.weapons.cancelSkills();this.prism.cancel();this.input.clear();
      // De frente para o destino: a bússola do HUD e o corpo apontam para o mesmo lado.
      // No mapa curvo o rumo é um VETOR tangente — um `atan2(dx,dz)` de mundo apontaria para um
      // canto fixo do espaço, e escrevê-lo em `player.yaw` (que ali é o yaw LOCAL) seria pior
      // ainda. A câmera é a dona da marcha, então é ela que recebe a direção.
      if(this.radial){
        const heading=this.world.surface.basis(this.spawn,{x:plan.chalice.x-plan.spawn.x,y:plan.chalice.y-plan.spawn.y,z:plan.chalice.z-plan.spawn.z}).forward;
        this.camera.snapTo(this.spawn,heading);
        this.player.setHeading(heading);
      } else {
        this.input.yaw=Math.atan2(plan.chalice.x-plan.spawn.x,plan.chalice.z-plan.spawn.z);
        this.player.yaw=this.input.yaw;
      }
      this.input.pitch=.02;
      this.camera.update(this.player.position,this.input.yaw,this.input.pitch,1);
    }
    this.applyLootPlacement();
    if(!arrival)return;
    if(this.yard instanceof PlanetWorld)this.yard.restoreScenery();
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
    const destination=this.biomeFor(this.progression.stage+1)??nextBiomeForStage(this.progression.stage);
    if(!this.journey.begin(this.progression.stage,destination.name)){this.objectives.collected=false;return false;}
    // Congela o que é perigoso: o diretor para e o passo fixo inteiro fica retido por `holdsControl`.
    if(this.enemies instanceof EnemySwarm)this.enemies.director.stopped=true;
    this.mp.cancel();this.cancelCinematic();this.weapons.cancelSkills();this.prism.cancel();
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
    // `searching` é o único relógio que revela o rumo do cálice por tempo. Só conta exploração de
    // verdade: menu, entrada pela nave, viagem, pausa, revisão e morte NÃO creditam segundo nenhum,
    // senão o sinal chegaria durante uma cinemática e entregaria o destino antes do primeiro passo.
    const searching=this.started&&!this.paused&&this.player.hp>0
      &&!this.intro.holdsControl&&!this.journey.holdsControl&&!this.meleeReview.active&&!this.poseReview;
    objectives.update(dt,this.player.position,this.player.hp>0,searching);
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
    const heavy=this.unarmed.heavy,surface=this.world.surface;
    // A frente do golpe é a do CORPO, que no planeta é um vetor tangente transportado. No mundo
    // plano `player.forward` vale exatamente `(sin yaw, 0, cos yaw)`, então nada muda ali.
    const facing=this.player.forward;
    const up=surface.up(origin);
    const chest={x:origin.x+up.x*1.1,y:origin.y+up.y*1.1,z:origin.z+up.z*1.1};
    for(const actor of this.enemies.actors){
      if(!actor.active||actor.health.dead||!this.unarmed.canHit(actor.id))continue;
      const target=actor.root.position,radius=ENEMIES[actor.kind].radius*ENEMY_AFFIXES[actor.variant].scale;
      if(!meleeReaches(step,origin,yaw,target,radius,surface,facing))continue;
      // O peito do alvo sobe pela vertical DELE — numa ponte entre ilhas os dois `up` diferem.
      const targetUp=surface.up(target);
      const chestTarget={x:target.x+targetUp.x,y:target.y+targetUp.y,z:target.z+targetUp.z};
      const to={x:chestTarget.x-chest.x,y:chestTarget.y-chest.y,z:chestTarget.z-chest.z};
      // Sem atravessar cobertura: a varredura sai do peito até o corpo do alvo.
      if(surface.sweep(chest,to,.12))continue;
      this.unarmed.registerHit(actor.id);
      // A força empurra no plano TANGENTE; no mundo plano isto é o `y:0` de sempre.
      const push=normalizeTangent(to,up);
      const damage=step.damage*this.progression.stats.damage;
      const hit={attackerId:1,victimId:actor.id,sourceId:'unarmed_'+step.id,attackId:step.id,baseDamage:step.damage,finalDamage:damage,crit:false,procCoefficient:.8,procChainDepth:0,
        damageTags:(heavy?['melee','melee_heavy']:['melee']) as string[],
        hitPosition:{x:chestTarget.x,y:chestTarget.y,z:chestTarget.z},hitNormal:{x:-push.x,y:-push.y,z:-push.z},
        forceDirection:push,forceMagnitude:step.force};
      actor.target.onHit?.(hit);
      this.events.emit('DamageDealt',hit);
      this.camera.impulse(heavy?.03:.014);this.audio.skillImpact('unarmed_'+step.id);
    }
    this.resolveMeleeScenery(chest,facing,heavy);
  }

  /**
   * O soco também quebra cenário.
   *
   * Sem isto o jogador atravessaria o combo inteiro numa caixa sem arranhá-la, enquanto uma bala
   * a destrói — e os 520 destrutíveis do planeta ficariam sendo "coisa de arma". A varredura é a
   * mesma do alcance do golpe e o dano entra pela MESMA porta de destruição do tiro, então perfil,
   * estágios, áudio e cacos são os do subsistema, não uma segunda regra escrita aqui.
   */
  /**
   * Uma direção de MUNDO vista pelo corpo.
   *
   * `arrow` sai em componentes da base de REFERÊNCIA (a tangente transportada), que é o mesmo
   * referencial em que `player.yaw` é medido — é o par que a seta do HUD espera. `side` é a
   * projeção na direita do corpo, que decide para que lado a câmera balança.
   *
   * No mundo plano a base de referência é `{+X, +Y, +Z}` e `arrow` devolve `forceDirection`
   * intacto, então o HUD recebe exatamente o que recebia antes.
   */
  /**
   * Leva um ponto do espaço de ENCENAÇÃO do pouso para o mundo.
   *
   * O espaço de encenação é o que a coreografia autoral já usava: origem no pouso, `+Z` para onde
   * o corpo olha, `+Y` para cima. No mundo plano isso É o mundo (a base é `{+X,+Y,+Z}` e a origem
   * é o pouso), então a função devolve o ponto somado ao pouso, sem mudar nada. No planeta a base
   * é a tangente da ilha, e é isso que faz o mergulho descer pela radial.
   */
  private stageToWorld(local:Vec3,landing:Vec3):Vec3 {
    if(!this.radial)return local;
    const b=this.world.surface.basis(landing,this.player.forward);
    return {
      x:landing.x+b.right.x*local.x+b.up.x*local.y+b.forward.x*local.z,
      y:landing.y+b.right.y*local.x+b.up.y*local.y+b.forward.y*local.z,
      z:landing.z+b.right.z*local.x+b.up.z*local.y+b.forward.z*local.z,
    };
  }

  /**
   * Sobe `metres` pela vertical LOCAL. No mundo plano é exatamente `y + metres`, que é o que
   * estas apresentações escreviam à mão; no planeta é o que impede o efeito nascer de lado.
   */
  private liftWorld(at:Vec3,metres:number):Vector3 {
    const up=this.world.surface.up(at);
    return new Vector3(at.x+up.x*metres,at.y+up.y*metres,at.z+up.z*metres);
  }

  private localForce(force:Vec3):{arrow:Vec3;side:number} {
    const surface=this.world.surface,at=this.player.position;
    const reference=surface.basis(at,this.player.reference);
    const body=surface.basis(at,this.player.forward);
    return {
      arrow:{
        x:force.x*reference.right.x+force.y*reference.right.y+force.z*reference.right.z,
        y:force.x*reference.up.x+force.y*reference.up.y+force.z*reference.up.z,
        z:force.x*reference.forward.x+force.y*reference.forward.y+force.z*reference.forward.z,
      },
      side:force.x*body.right.x+force.y*body.right.y+force.z*body.right.z,
    };
  }

  private resolveMeleeScenery(chest:Vec3,facing:Vec3,heavy:boolean):void {
    if(this.unarmed.sceneryHit)return;
    const step=this.unarmed.step;
    const direction=new Vector3(facing.x,facing.y,facing.z);
    if(direction.lengthSquared()<1e-8)return;
    direction.normalize();
    const hit=this.world.surface.raycast(new Ray(new Vector3(chest.x,chest.y,chest.z),direction,step.range));
    if(!hit)return;
    this.unarmed.sceneryHit=true;
    // Mesma porta do tiro: perfil, estágios, áudio, cacos e remoção de colisão são do subsistema.
    this.weapons.destruction.hit(destructionHit(
      hit.point,{x:direction.x,y:direction.y,z:direction.z},
      step.damage*this.progression.stats.damage*(heavy?1.4:1),
      undefined,hit.normal,
    ));
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
    this.mp.cancel();this.cancelCinematic();this.weapons.cancelSkills();this.prism.cancel();
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
    // O clone volta a ficar escondido e o rig vivo reaparece — sem realocar nada.
    this.playerRagdoll.reset();this.visual.root.setEnabled(true);
    if(this.yard instanceof PlanetWorld)this.yard.restoreScenery();
    // A CLASSE sobrevive ao RENASCER: é a mesma expedição tentada de novo. `resetAttempt` da PRISM
    // devolve a arma às mãos por padrão, então `applyPlayerClass` volta a mandar logo em seguida.
    this.cancelCinematic();this.runHUD?.clearItemPickups();this.progression.reset();this.weapons.resetAttempt();this.prism.resetAttempt();this.applyPlayerClass();this.visual.resetAttempt();this.mp.cancel();this.mp.current=this.mp.maximum;this.mp.releases=0;this.mp.speedMultiplier=1;
    if(this.enemies instanceof EnemySwarm)this.enemies.nextStage();this.interactables?.reset();this.objectives.reset();this.resonance.reset();this.slowMotion.reset();this.weather.reset();this.unarmed.resetAttempt();this.weapons.holstered=false;this.bossRequestClock=0;
    // A viagem volta ao zero e o estágio 1 é replanejado: nada de herdar a partida do estágio onde
    // a tentativa terminou.
    this.journey.reset();this.pendingSetup=undefined;
    // Tentativa nova é EXPEDIÇÃO nova: sorteia outra semente e joga fora os planos da anterior,
    // senão o cache devolveria a mesma ilha de partida e o mesmo cálice para sempre. Preso por
    // `?replay=1` ou `?online=1`, a semente e os planos ficam — repetir é o pedido ali.
    const seed=retrySeed({pinned:this.seedLocked,seed:this.attemptSeed});
    if(seed!==this.attemptSeed){this.attemptSeed=seed;this.stagePlans.clear();this.applyLootPlacement();}
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
    this.reloadRunReview=0;this.intro.reset();this.endMeleeReview();this.dropship?.update(0,false);this.hasArrived=false;this.paused=false;this.input.clear();this.cancelAim();this.input.yaw=-.13;this.input.pitch=.02;this.camera.update(this.player.position,this.input.yaw,this.input.pitch,1);
    // The retry button must wait for the NEW island before starting the arrival cinematic.
    await destination;
    if(this.stagePlanRequired&&!this.planReady)throw Error(this.planError||'A nova ilha ainda não carregou. Tente novamente.');
  }
  private cancelCinematic():void{this.continuationTier=undefined;this.chargingPressed=false;this.elements?.clear();this.auraClock=0;this.auraLast=-1;this.poseReview=false;this.castVersion++;this.skillPending=false;this.cinematic.cancel();this.visual.endPreparation();this.audio.cancelVoice();}

  get isPaused():boolean {return this.paused;}
  setPaused(paused: boolean): void {this.paused=paused;this.input.clear();this.mp.cancel();this.cancelAim();this.prism.trigger.release();if(paused)this.prismRig.stopAudio();this.audio.setActive(!paused&&(this.started||this.death.active));}

  /**
   * Linha de diagnóstico do plano em vigor: bioma, ilha de partida, ilha do cálice e a distância
   * realmente medida entre os dois pontos. É por aqui que o QA confere "ilhas diferentes, longe".
   */
  get stagePlanDescription():string {
    if(this.directorMode!=='expedition')return 'Rota de estágio: modo legado (campo fixo)';
    const setup=this.stageSetup;
    if(!setup)return `Rota de estágio: ${this.planError||(this.planning?'planejando…':'sem plano')} · ${this.chaliceDescription}`;
    const {plan}=setup;
    // O comprimento que importa é o PERCORRIDO; a reta vai junto só para comparar. `shortfall`
    // aparece escrito porque um cálice abaixo do piso nunca pode passar despercebido.
    return `Rota de estágio: ${plan.biome.name} · partida ${plan.spawnIsland.name} · cálice ${plan.chaliceIsland.name}`
      +` · caminhada ${Math.round(plan.routeLength)} m (mínimo ${plan.minRoute})${plan.shortfall?' · ABAIXO DO PISO':''}`
      +` · reta ${Math.round(plan.distance)} m (mínimo ${plan.biome.separation})`
      +` · semente ${this.attemptSeed}${this.seedLocked?' (presa)':''} · viagem ${this.journey.phase}`
      +`\n${this.chaliceDescription}`;
  }

  /**
   * Estado REAL do cálice em campo: carga, colocação e busca.
   *
   * Existe porque o sintoma relatado era indistinguível de "mapa sem cálice". Com esta linha o QA vê
   * na hora se o copo está montado, onde ele está, de quanto é a distância e quanto falta para o
   * sinal revelar o rumo — sem abrir o console.
   */
  private get chaliceDescription():string {
    const sites=this.expeditionSites,totem=this.objectives.totems[0];
    const load=sites?`${sites.status}${sites.attempts>1?` (${sites.attempts} tentativas)`:''}`:'sem sítio';
    const failure=this.siteError||sites?.error||'';
    const notice=sites?.notice?` · aviso ${sites.notice}`:'';
    if(!totem)return `Cálice: ${load}${failure?` · ERRO ${failure}`:''}${notice}`;
    const at=totem.site.position;
    const distance=Math.round(this.world.surface.planarDistance(this.player.position,at));
    const support=this.world.surface.support(at,.05,DECK_TOLERANCE);
    const deck=support&&Math.abs(this.world.surface.heightGap(support.point,at))<=DECK_TOLERANCE?`convés ok (desnível ${this.world.surface.heightGap(support.point,at).toFixed(2)} m)`
      :'SEM CONVÉS SOB O CÁLICE';
    const reveal=this.objectives.discovered
      ?(this.objectives.signalAcquired?'revelado pelo sinal':'descoberto em campo')
      :`sinal em ${Math.max(0,Math.ceil(CHALICE_SIGNAL_SECONDS-this.objectives.searchSeconds))} s de busca`;
    return `Cálice: ${load} · ${totem.site.name} (${at.x.toFixed(1)}, ${at.y.toFixed(1)}, ${at.z.toFixed(1)})`
      +` · ${distance} m · ${deck} · ${reveal}${failure?` · ERRO ${failure}`:''}${notice}`;
  }

  /** O plano do estágio é exigência de arranque: sem ele o objetivo ficaria indefinido. */
  private get stagePlanRequired():boolean {return this.directorMode==='expedition';}
  private get stagePlanSettled():boolean {return !this.stagePlanRequired||(this.planReady&&Boolean(this.expeditionSites?.ready));}
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

  private checkReady():void {this.ensureStagePlan();this.applyLootPlacement();
    // A nave entra na lista: o menu vivo mostra o corpo em pé no deck, então o deck precisa existir
    // antes do Jogar. Uma falha de carga NÃO trava o boot — a entrada cai no mergulho original.
    const deckReady=!this.dropship||this.dropship.ready||Boolean(this.dropship.error);
    // O plano da expedição é o nono estágio de carga: o Jogar só libera com partida e cálice válidos.
    const planned=!this.interactables||this.stagePlanSettled;
    // A PRISM entra como ETAPA, não como exigência: `prismSettled` é `true` tanto com o rig pronto
    // quanto com a carga falhada — o jogo então começa com as pistolas e o motivo fica no F1.
    const stages=[this.visual?.ready,this.weapons?.ready,this.skillAura?.ready,!(this.yard instanceof FarmWorld)||this.yard.ready,(!(this.enemies instanceof EnemySwarm)||this.enemies.ready),!(this.enemies instanceof EnemySwarm)||this.enemies.navigationReady,!this.interactables||this.interactables.ready,deckReady,planned,this.prismSettled];
    const label=this.planError?`FALHA NA ROTA · ${this.planError} · tentando de novo`
      // O cálice é etapa de carga como qualquer outra: se ele não montou, o rótulo diz isso.
      :this.siteError&&!planned?`CARREGANDO O CÁLICE · ${this.siteError}`
      :!planned?'SORTEANDO ILHA DE PARTIDA E MONTANDO O CÁLICE'
      :stages.every(Boolean)?'PREPARANDO LUZ E MATERIAIS':'CARREGANDO FAZENDAS E ROTAS';
    this.hud?.loading(stages.filter(Boolean).length,stages.length,label);for(const material of this.scene.materials){const lit=material as typeof material & {maxSimultaneousLights?:number};if(lit.maxSimultaneousLights!==undefined&&lit.maxSimultaneousLights>4){lit.unfreeze();lit.maxSimultaneousLights=4;}}if(this.visual?.ready&&this.weapons?.ready&&this.skillAura?.ready&&(!(this.yard instanceof FarmWorld)||this.yard.ready)&&(!(this.enemies instanceof EnemySwarm)||(this.enemies.ready&&this.enemies.navigationReady))&&(!this.interactables||this.interactables.ready)&&deckReady&&planned&&this.prismSettled){if(this.warming)return;this.warming=true;this.scene.executeWhenReady(()=>{if(!this.disposed)this.hud.ready();});}}

  configure(name: string,value: number): void {
    if(name==='review-enemy-distance'&&this.yard instanceof PlanetWorld&&this.yard.manifest){
      const island=this.yard.manifest.islands.filter(i=>this.world.surface.planarDistance(this.player.position,i.spawn)>100).sort((a,b)=>this.world.surface.planarDistance(this.player.position,a.spawn)-this.world.surface.planarDistance(this.player.position,b.spawn))[0];
      if(!island)return;
      this.intro.skip();this.player.arriveAt(this.seatOnDeck(island.spawn));this.player.debugInvincible=true;return;
    }
    if(name==='review-loot'&&this.interactables){
      const chest=this.interactables.entries.filter(e=>!e.used&&e.kind!=='altar').sort((a,b)=>this.world.surface.planarDistance(this.player.position,a)-this.world.surface.planarDistance(this.player.position,b))[0];
      if(!chest)return;
      this.intro.skip();if(this.enemies instanceof EnemySwarm){this.enemies.nextStage();this.enemies.director.stopped=true;}
      this.player.resetAt(this.qaSpotNear(chest,0,-2,.05));this.faceQa(chest);this.input.pitch=.3;
      this.player.debugInvincible=true;this.progression.credits=90;return;
    }
    if(name==='review-crate'&&this.yard instanceof PlanetWorld){
      const props=this.yard.destructibles.filter(p=>p.kind==='crate').sort((a,b)=>this.world.surface.planarDistance(a.centre,this.player.position)-this.world.surface.planarDistance(b.centre,this.player.position));
      const prop=props[0];if(!prop)return;
      this.intro.skip();if(this.enemies instanceof EnemySwarm){this.enemies.nextStage();this.enemies.director.stopped=true;}
      this.player.resetAt(this.qaSpotNear(prop.centre,0,-4,.05));
      this.faceQa(prop.centre);this.input.pitch=.32;this.player.debugInvincible=true;
      this.weapons.holstered=false;return;
    }
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
      this.endMeleeReview();this.cancelCinematic();this.mp.cancel();this.weapons.cancelSkills();this.prism.cancel();
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

    // Os três atalhos da PRISM passam pelas MESMAS portas das teclas; nada de caminho paralelo.
    if(name==='prism-mode')this.prism.requestMode();
    if(name==='prism-reload')this.prism.requestReload();
    // As habilidades do soldado pelo F1, pela MESMA porta do `Q` (munição cobrada, recusa honesta).
    if(name==='prism-skill2'||name==='prism-skill3')this.prism.releaseSkill(name==='prism-skill2'?2:3);
    if(name==='reload-run'&&!this.net){this.reloadRunReview=2;this.player.sprinting=true;this.weapons.magazine.ammo=Math.min(20,this.weapons.magazine.ammo);this.weapons.requestReload();}
    if(name==='reload'){this.weapons.magazine.ammo=Math.min(20,this.weapons.magazine.ammo);this.weapons.requestReload();}
    if(name==='heal')this.player.hp=this.player.maxHP;

    if(name==='quality')applyLightingQuality(this.scene,value===1);

    if(name==='invincible')this.player.debugInvincible=!this.player.debugInvincible;

    if(name==='hit-player'||name==='fatal-player'){const damage=name==='fatal-player'?Math.max(1,this.player.hp):25;const invincible=this.player.debugInvincible;this.player.debugInvincible=false;this.player.invulnerable=0;this.player.applyDamage({attackerId:999,victimId:1,sourceId:'qa_enemy',attackId:'qa_damage',baseDamage:damage,finalDamage:damage,crit:false,procCoefficient:0,procChainDepth:0,damageTags:['enemy'],hitPosition:{...this.player.position},hitNormal:{x:1,y:0,z:0},forceDirection:{x:-1,y:0,z:0},forceMagnitude:2});this.player.debugInvincible=invincible;}

    if(name==='all-perks')for(const item of ITEMS)this.progression.addItem(item.id);
    if(name==='loot'){const ids=['pruner','battery','boot','watch','feather','goggles','bandage','belt','fire','harvest','bomb','crystal'];this.progression.addItem(ids[this.progression.inventory.size%ids.length]!);this.progression.credits+=100;}

    // Coordenadas AUTORAIS da fazenda. No planeta elas caem dentro do miolo da esfera, então o
    // botão recusa em voz alta em vez de enterrar o corpo no núcleo.
    if(name==='ferry'&&!this.qaRefuseFlat(name)){this.player.resetAt({x:-21,y:0,z:-8});this.input.yaw=-Math.PI/2;this.input.pitch=.10;}

    if(name==='review-cliff'&&!this.qaRefuseFlat(name)){this.player.resetAt({x:9,y:0,z:12});this.input.yaw=-.28;this.input.pitch=-.09;}
    if(name==='review-east-bridge'&&!this.qaRefuseFlat(name)){
      this.intro.abort();this.endMeleeReview();this.cancelCinematic();
      if(this.enemies instanceof EnemySwarm){this.enemies.nextStage();this.enemies.director.stopped=true;}
      this.player.resetAt({x:28,y:1,z:8});this.input.yaw=Math.PI/2;this.input.pitch=.02;
    }
    if((name==='review-chalice'||name==='complete-chalice')&&this.objectives.totems[0]){
      const at=this.objectives.totems[0].site.position;
      this.intro.abort();this.endMeleeReview();this.cancelCinematic();
      if(this.enemies instanceof EnemySwarm){this.enemies.nextStage();this.enemies.director.stopped=true;}
      // 2,5 m ATRÁS do cálice, no plano tangente, e 20 cm acima do apoio medido. No mundo plano
      // isto é literalmente `{x, y+.2, z-2.5}`, como sempre foi.
      this.player.resetAt(this.qaSpotNear(at,0,-2.5,.2));
      this.faceQa(at);
      this.input.pitch=.05;
      if(name==='complete-chalice'){
        this.objectives.activate(this.player.position);
        for(let i=0;i<30;i++)this.objectives.harvest({sequence:1_000_000+i,kind:'watermelon',position:at},this.player.position,true);
        this.objectives.onBossKilled(at);
      }
    }

    if(name==='barn'&&!this.qaRefuseFlat(name))this.player.resetAt({x:0,y:5,z:30.8});

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

    if(name==='shop'&&!this.qaRefuseFlat(name))this.player.resetAt({x:3,y:0,z:1});

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

      // Avisos vivem AQUI, no diagnóstico — nunca no parâmetro `error` do HUD, que troca o botão
      // Jogar por "Recarregue a página". Degradação anunciada não é partida quebrada.
      player:`${this.networkNotice?this.networkNotice+'\n':''}${this.navigationNotice?this.navigationNotice+'\n':''}${this.expeditionSites?.notice?this.expeditionSites.notice+'\n':''}${this.qaNotice?this.qaNotice+'\n':''}${this.net?.debugLine()??''}${this.yard instanceof FarmWorld?this.yard.regionStatus:this.world.regionStatus??''}${this.cameraAudit}`
      +`\nEntrada ${this.intro.phase}${this.intro.skipped?' (pulada)':''} · deck ${this.dropship?this.dropship.error||(this.dropship.ready?'pronto':'carregando'):'treino'} · controle ${this.intro.holdsControl?'RETIDO':'livre'}`
      +`\n${this.stagePlanDescription}`
      +(this.meleeReview.active?`\nRevisão corpo a corpo · ${this.meleeReview.label} · voltas ${this.meleeReview.loops} · armas ${this.weapons.holstered?'guardadas':'EM MÃOS'}`:'')
      +`\nPosição${this.player.position.x.toFixed(1)}, ${this.player.position.y.toFixed(1)}, ${this.player.position.z.toFixed(1)}\nVelocidade ${Math.hypot(this.player.velocity.x,this.player.velocity.z).toFixed(2)} m/s · ${this.player.sprinting?'CORRENDO':'NORMAL'}\nMira ${this.input.yaw.toFixed(3)} / ${this.input.pitch.toFixed(3)}\nGrounded ${this.player.grounded} · Saltos ${this.player.jumps}\nEsquivas ${this.player.dodges} · Retornos ${this.player.respawns}\n${this.enemies instanceof EnemySwarm?this.enemies.tactical?.residencyDescription??'':''}\nReciclagem ${this.enemies instanceof EnemySwarm?this.enemies.strays:0} distantes removidos · ${this.enemies instanceof EnemySwarm?this.enemies.recycled:0} repostos perto\nNavmesh ${this.enemies instanceof EnemySwarm?this.enemies.tactical?.count??0:0} agentes · Ragdolls ${this.enemies instanceof EnemySwarm?this.enemies.ragdollCount:0} · Marcas ${this.weapons.effects.decalCount}\nCorpo do jogador: ${this.playerRagdoll.ready?"pronto":"carregando"} · ${this.playerRagdoll.bodies} corpos · ${this.playerRagdoll.active?"física ativa":"inativo"} · ${this.playerRagdoll.error}\nDisparos ${this.weapons.cadence.shots} · Acertos ${this.weapons.hits}\nImpacto ${this.weapons.lastImpact}\n${this.prismDebug()}\nModelo ${this.visual.ready?'pronto':'carregando'} · ${this.visual.skinning}\nInvulnerabilidade QA ${this.player.debugInvincible?'ATIVA':'desligada'}\nDirector ${this.enemies instanceof EnemySwarm?this.enemies.director.state:'treino'} · Estágio ${this.progression.stage}`};

  }

  dispose(): void {if(this.disposed)return;this.disposed=true;
    // Invalida qualquer carregamento de destino em voo: o `.then` tardio vê a versão mudada e sai.
    this.planVersion++;this.planning=false;this.journey.reset();this.pendingSetup=undefined;this.stagePlans.clear();
    this.cancelAim();this.aimOverlay.dispose();this.trajectory.dispose();this.scopeOcclusion.dispose();
    this.weatherView?.dispose();this.weatherView=undefined;this.dropship?.dispose();this.dropship=undefined;this.collision.detachRadialProps('expedition-sites');this.collision.detachRadialProps('loot');this.expeditionSites?.dispose();this.expeditionSites=undefined;this.pendingSites?.dispose();this.pendingSites=undefined;this.playerRagdoll.dispose();this.avatar?.dispose();this.net?.dispose();this.cancelCinematic();this.cutIn.dispose();this.skillAura.dispose();this.elements.dispose();this.world.dispose();this.input.dispose();this.enemies.dispose();this.explorationMap?.dispose();this.runHUD?.dispose();this.interactables?.dispose();this.events.clear();this.prism.dispose();this.prismVisuals.dispose();this.ionBeam.dispose();this.groundFireView.dispose();this.strikeMarker.dispose();this.prismRig.dispose();this.weapons.dispose();this.footing.dispose();this.abyss?.dispose();this.visual.dispose();this.audio.dispose();this.hud.dispose();this.instrumentation.dispose();this.scene.dispose();}

}

/**
 * Componente TANGENTE de `v` em `up`, normalizada. No mundo plano (`up = +Y`) devolve
 * exatamente o `{x/len, y:0, z/len}` que o combate original já escrevia à mão.
 */
const ORIGIN:Vec3={x:0,y:0,z:0};

/**
 * Cronômetro das etapas caras de carregamento.
 *
 * Existe porque um travamento de carregamento sem medição vira adivinhação: com isto o console diz
 * QUAL etapa custou os segundos. Só imprime o que passou de 250 ms — abaixo disso é ruído.
 */
function stageTiming(label:string,startedAt:number):void {
  const elapsed=performance.now()-startedAt;
  if(elapsed>=250)console.info(`[planeta] ${label}: ${Math.round(elapsed)} ms`);
}

/** Quantas ilhas o sorteio do planeta examina por tentativa. Ver `buildStageSetup`. */
function normalizeTangent(v:Vec3,up:Vec3):Vec3 {
  const d=v.x*up.x+v.y*up.y+v.z*up.z;
  const x=v.x-up.x*d,y=v.y-up.y*d,z=v.z-up.z*d;
  const length=Math.hypot(x,y,z);
  return length<1e-6?{x:0,y:0,z:0}:{x:x/length,y:y/length,z:z/length};
}
