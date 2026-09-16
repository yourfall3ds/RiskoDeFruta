import {Scene} from '@babylonjs/core/scene';
import {SceneInstrumentation} from '@babylonjs/core/Instrumentation/sceneInstrumentation';
import type {AbstractEngine} from '@babylonjs/core/Engines/abstractEngine';
import type {ShadowGenerator} from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import type {SceneModule} from '../engine/SceneLifecycle';
import type {DamageContext, GameEvents, Vec3} from '../core/contracts';
import {EventBus} from '../core/EventBus';
import {RunRNG} from '../core/RunRNG';
import {GameInput, type InputFrame} from '../input/GameInput';
import {PLAYER_TUNING, CAMERA_TUNING} from '../player/PlayerTuning';
import {MPCharge, type MPTier} from '../combat/MPCharge';
import {RunProgression} from '../run/RunProgression';
import {MonsterDirector, finalHordePressure, type EnemyKind} from '../run/MonsterDirector';
import {WeaponAudio} from '../audio/WeaponAudio';
import {FootstepSync, type FootSample} from '../animation/FootstepSync';
import {PlanetFrame, add, cross, dot, length, normalize, reject, scale, sub, transport} from '../planet/PlanetFrame';
import {PlanetCollision} from '../planet/PlanetCollision';
import {PlanetMotor} from '../planet/PlanetMotor';
import {PlanetArrival, type IntroCue} from '../planet-game/PlanetArrival';
import {PlanetAvatar} from '../planet-game/PlanetAvatar';
import {PlanetCameraRig} from '../planet-game/PlanetCameraRig';
import {PlanetChaliceMarker} from '../planet-game/PlanetChaliceMarker';
import {PlanetDebugPanel} from '../planet-game/PlanetDebugPanel';
import {NO_DESTRUCTION, PlanetDestructionLedger, type DestructionPort} from '../planet-game/PlanetDestruction';
import {PlanetEnemies} from '../planet-game/PlanetEnemies';
import {PlanetObjective} from '../planet-game/PlanetObjective';
import {PlanetGraph} from '../planet-game/PlanetGraph';
import {PlanetHUD} from '../planet-game/PlanetHUD';
import {PlanetIntroPresentation} from '../planet-game/PlanetIntroPresentation';
import {
  DestructionSystem, DestructionVisuals, materialDestructionAudio, parseDestructibles, profileOf,
  type DestructibleRecord,
} from '../destruction';
import {loadPlanetManifest, PlanetManifestError, type IslandRecord, type PlanetManifest} from '../planet-game/PlanetManifest';
import {PlanetNavigationService} from '../planet-game/PlanetNavigationService';
import {PlanetRun} from '../planet-game/PlanetRun';
import {PlanetWeapons, type WeaponAim} from '../planet-game/PlanetWeapons';
import {findIslandSpawn, probeSpawn, respawnAbove, SPAWN_DEFAULTS, type SpawnProbe} from '../planet-game/PlanetSpawn';
import {PlanetWorldView, planetLighting} from '../planet-game/PlanetWorldView';

/**
 * Expedição no planeta: `?mode=planet`.
 *
 * Travessia esférica real (gravidade radial, câmera com `up` verdadeiro, colisão contra a malha
 * autoral) MAIS o laço de jogo básico: pistolas autorais na mão, tiro 3D de mundo com linha de
 * visão, pragas importadas com vida e morte, cálice distante, horda final com chefe, baús, itens
 * que sobrevivem à troca de ilha e morte que reinicia a tentativa.
 *
 * A rota é ADITIVA: sem `?mode=planet` o jogo continua no `PlayerScene`, que não foi tocado.
 * O que ainda falta está em `.temp/planet-combat-result.md`, e o distintivo "EM DESENVOLVIMENTO"
 * fica no HUD enquanto faltar.
 */
export class PlanetScene implements SceneModule {
  readonly scene: Scene;
  readonly instrumentation: SceneInstrumentation;
  readonly events = new EventBus<GameEvents>();
  readonly progression = new RunProgression(this.events);
  readonly mp = new MPCharge(this.events);

  private readonly hud: PlanetHUD;
  private readonly input: GameInput;
  private readonly debug: PlanetDebugPanel;
  private readonly rng: RunRNG;
  private readonly audio = new WeaponAudio();
  /**
   * Passos pelo CONTATO real do pé, com os mesmos limiares medidos no rig (`FootstepSync`), não
   * por um relógio arbitrário. A altura do pé é medida ao longo do `up` local — ver o argumento
   * opcional de `CharacterVisual.footHeights`.
   */
  private readonly footing = new FootstepSync();
  private readonly footSamples: FootSample[] = [{side: 0, height: 0}, {side: 1, height: 0}];

  private frame: PlanetFrame | undefined;
  private readonly collision = new PlanetCollision();
  private manifest: PlanetManifest | undefined;
  private graph: PlanetGraph | undefined;
  private rig: PlanetCameraRig | undefined;
  private world: PlanetWorldView | undefined;
  private avatar: PlanetAvatar | undefined;
  private motor: PlanetMotor | undefined;
  private arrival: PlanetArrival | undefined;
  /** Nave, deck e o corpo durante a entrada. Falha dela não impede jogar: cai direto no mergulho. */
  private intro: PlanetIntroPresentation | undefined;
  private shadows: ShadowGenerator | undefined;
  private objective: PlanetObjective | undefined;
  private chalice: PlanetChaliceMarker | undefined;
  private weapons: PlanetWeapons | undefined;
  private enemies: PlanetEnemies | undefined;
  private director: MonsterDirector | undefined;
  private run: PlanetRun | undefined;
  private navigation: PlanetNavigationService | undefined;
  /**
   * Destruição de cenário.
   *
   * O ledger existe sempre (é ele quem conta o que saiu da colisão e acusa parede fantasma);
   * a fachada só é instalada quando o manifesto trouxer `destructibles`. Ver `installDestruction`.
   */
  private destructionLedger: PlanetDestructionLedger | undefined;
  private destruction: DestructionPort = NO_DESTRUCTION;
  /** Fachada real, quando o mapa tem cenário quebrável. Guardada para estado, visual e descarte. */
  private destructionSystem: DestructionSystem | undefined;
  private destructionVisuals: DestructionVisuals | undefined;
  /** Motivo de a destruição não estar ativa, para o painel de verificação. */
  private destructionNote = 'sem cenário quebrável neste mapa';

  private homeIsland: IslandRecord | undefined;

  /** Tangente de referência transportada: é contra ela que o `yaw` local do avatar é medido. */
  private reference: Vec3 = {x: 0, y: 0, z: 1};
  private sprinting = false;
  private lastYaw = 0;
  private lastPitch = 0;
  private orbitView = false;
  private orbitAngle = 0;
  private bossRequested = false;

  private hp: number = PLAYER_TUNING.maxHP;
  private invulnerable = 0;
  private regenDelay = 0;
  private charging = false;
  private notice = '';
  private noticeClock = 0;
  private extraction = 0;
  private deaths = 0;
  private falls = 0;
  private defeat = '';
  private started = false;
  private paused = false;
  private disposed = false;
  private error = '';
  private readonly pending = new Set<string>(['o mapa do planeta']);
  private lastRender = performance.now();
  private travelled = 0;
  private visited = new Set<string>();

  constructor(engine: AbstractEngine, readonly seed: string) {
    this.rng = new RunRNG(seed);
    this.scene = new Scene(engine);
    this.scene.skipPointerMovePicking = true;
    this.scene.skipPointerDownPicking = true;
    this.scene.skipPointerUpPicking = true;
    this.instrumentation = new SceneInstrumentation(this.scene);
    this.instrumentation.captureFrameTime = true;

    const canvas = engine.getRenderingCanvas()!;
    canvas.tabIndex = 0;
    this.input = new GameInput(canvas, active => {
      if (this.defeat) return;
      this.started = active;
      this.audio.setActive(active);
      if (!active) this.mp.cancel();
    });
    this.hud = new PlanetHUD(() => {
      if (this.defeat) this.retry(); else this.started = true;
      this.audio.unlock(); this.audio.setActive(true);
      void this.input.capture();
    });
    this.debug = new PlanetDebugPanel({
      toggleOrbit: () => (this.orbitView = !this.orbitView),
      teleportNextIsland: () => this.teleportNextIsland(),
      verifyFall: () => this.verifyFall(),
      skipIntro: () => {
        if (!this.arrival?.holdsControl) return 'Nenhuma entrada em curso.';
        this.arrival.skip(cue => this.arrivalCue(cue));
        this.intro?.hide();
        return 'Entrada pulada.';
      },
      inspectDestructible: kind => this.inspectDestructible(kind),
      readout: () => this.readout(),
    });
    this.events.on('EnemyKilled', context => this.onEnemyKilled(context));
    void this.boot();
  }

  // ---------------------------------------------------------------- carregamento

  private async boot(): Promise<void> {
    try {
      const manifest = await loadPlanetManifest();
      if (this.disposed) return;
      this.manifest = manifest;
      this.frame = new PlanetFrame({
        centre: manifest.centre,
        surfaceRadius: manifest.radius,
        voidRadius: manifest.radius * 0.84,
        ceilingRadius: manifest.radius * 1.6,
        islandRadius: Math.max(...manifest.islands.map(island => island.radius), 1),
      });
      this.collision.setGeometry(manifest.positions, manifest.indices);
      this.graph = new PlanetGraph(manifest);
      this.pending.delete('o mapa do planeta');
      for (const step of ['a casca do planeta', 'o personagem', 'as armas', 'as pragas']) this.pending.add(step);

      const home = this.pickHomeIsland(manifest, this.graph);
      const anchor = home ? home.spawn : this.frame.fromDirection({x: 0, y: 1, z: 0}, 2);
      this.rig = new PlanetCameraRig(this.scene, this.frame, anchor, {collision: this.collision});
      this.shadows = planetLighting(this.scene, this.rig.camera);
      this.scene.activeCamera = this.rig.camera;
      this.arrival = new PlanetArrival(this.frame);
      this.intro = new PlanetIntroPresentation(this.scene);

      // A navegação nasce ANTES das pragas: elas recebem a porta e são o consumidor real das
      // rotas. Sem consumidor o serviço não teria por que construir grafo nenhum.
      this.navigation = new PlanetNavigationService(this.frame, this.collision, manifest);
      this.navigation.preload();

      this.world = new PlanetWorldView(this.scene, this.shadows);
      const avatar = new PlanetAvatar(this.scene, () => {
        for (const mesh of avatar.visual.meshes) this.shadows?.addShadowCaster(mesh);
      });
      this.avatar = avatar;
      this.chalice = new PlanetChaliceMarker(this.scene, this.shadows);
      this.enemies = new PlanetEnemies(
        this.scene,
        {
          frame: this.frame, collision: this.collision,
          playerPosition: () => this.motor?.position ?? anchor,
          playerAlive: () => this.hp > 0 && this.started && !this.paused && this.defeat === '',
          islandRadius: () => {
            const at = this.motor?.position;
            return (at ? this.graph?.islandAt(at)?.radius : undefined) ?? 24;
          },
        },
        this.events, this.rng.stream('elite'), this.audio,
        {hurt: (damage, sourceId, from) => this.hurt(damage, sourceId, from)},
        this.shadows,
        this.navigation,
      );
      // A arma consulta a destruição a cada acerto no mundo; o campo é trocado em `installDestruction`.
      this.weapons = new PlanetWeapons(
        this.scene, avatar, this.collision,
        {
          capsules: () => this.enemies?.capsules() ?? [],
          damage: (id, context) => this.enemies?.damage(id, context),
        },
        this.events, this.rng.stream('run'), this.audio,
      );
      this.run = new PlanetRun(this.scene, this.frame, this.collision, this.progression, this.rng.stream('loot'), this.shadows);

      await Promise.all([
        this.world.load().then(() => {this.pending.delete('a casca do planeta');}),
        avatar.load().then(() => {this.pending.delete('o personagem');}),
        this.weapons.load().then(() => {this.pending.delete('as armas');}),
        this.enemies.load().then(() => {this.pending.delete('as pragas');}),
        this.chalice.load(),
        this.run.load(),
        this.intro.load(),
      ]);
      if (this.disposed) return;
      if (this.world.error) {this.error = this.world.error; return;}
      if (avatar.error) {this.error = `Personagem: ${avatar.error}`; return;}
      if (this.weapons.error) {this.error = `Armas: ${this.weapons.error}`; return;}
      if (this.enemies.error) {this.error = `Pragas: ${this.enemies.error}`; return;}
      this.installDestruction(manifest);
      this.placeRun();
    } catch (error) {
      if (this.disposed) return;
      this.error = error instanceof PlanetManifestError
        ? `${error.message}.`
        : error instanceof Error ? error.message : 'Falha desconhecida ao montar o planeta';
    }
  }

  /**
   * Liga a destruição de cenário, se o mapa trouxer algum.
   *
   * O manifesto entrega `destructibles` CRU; quem valida é `parseDestructibles`, do subsistema —
   * inclusive recusando registro ruim sem derrubar o resto do mapa. O ledger entra no meio da
   * colisão para (a) guardar os intervalos removidos, que a cópia da navegação precisaria receber,
   * e (b) acusar prop que quebrou na tela sem sair da colisão.
   *
   * A fachada (`DestructionSystem`) ainda está sendo escrita pelo dono do subsistema. Enquanto ela
   * não existir, o jogo roda com `NO_DESTRUCTION` e o tiro segue exatamente como antes — nenhum
   * caminho novo, nenhum custo. A instalação é o único ponto que muda quando ela chegar.
   */
  private installDestruction(manifest: PlanetManifest): void {
    this.destructionLedger = new PlanetDestructionLedger(this.collision);
    if (manifest.destructibles === undefined) {
      this.destructionNote = 'o mapa não declara cenário quebrável (manifesto versão 1)';
      return;
    }
    const parsed = parseDestructibles(manifest.destructibles, {
      centre: manifest.centre,
      triangleTotal: manifest.indices.length / 3,
    });
    if (parsed.records.length === 0) {
      this.destructionNote = parsed.warnings.length > 0
        ? `nenhum destrutível aceito · ${parsed.warnings[0]}`
        : 'lista de destrutíveis vazia';
      return;
    }
    // A colisão entra pelo ledger, não direto: é ele quem guarda os intervalos removidos (para a
    // cópia da navegação) e quem acusa prop que quebrou na tela sem sair do caminho.
    const visuals = new DestructionVisuals(this.scene, {
      ...(this.world ? {root: this.world.root} : {}),
      // Centro presente ⇒ os cacos caem pela RADIAL, não pelo −Y do mundo.
      centre: manifest.centre,
      support: (point, up) => this.collision.supportBelow(point, up, 0.6, 12)?.offset,
    });
    const system = new DestructionSystem({
      collision: this.destructionLedger.collisionPort(),
      audio: materialDestructionAudio(this.audio),
      presentation: visuals,
    });
    system.register(parsed.records);
    this.destructionVisuals = visuals;
    this.destructionSystem = system;
    this.attachDestruction(this.destructionPortOf(system));

    this.destructionRecords = parsed.records.length;
    this.destructionWarnings = [...parsed.warnings, ...system.warnings];
    this.destructionList = parsed.records;
    this.destructionNote = `${system.registered} instalados`
      + (this.destructionWarnings.length > 0 ? ` · ${this.destructionWarnings.length} avisos` : '');
  }

  /**
   * Liga (ou desliga) a fachada no tiro.
   *
   * O ledger fica SEMPRE no meio: é ele quem conta os intervalos e acusa o defeito, mesmo que a
   * fachada seja trocada. Público para o teste de integração poder instalar uma fachada falsa sem
   * precisar de manifesto nem de GLB.
   */
  /**
   * Intervalos de triângulo removidos pela destruição, para a CÓPIA da navegação.
   *
   * O worker de rotas montou a BVH dele a partir de uma cópia da geometria e o protocolo atual
   * (`build`/`slice`/`path`/`dispose`) não tem mensagem de invalidação. A consequência é
   * **conservadora, não perigosa**: o grafo nunca teve nó dentro de um prop, então depois de o prop
   * sumir a rota apenas deixa de aproveitar um espaço que ficou livre — ela contorna algo que já
   * não está lá. O erro perigoso (rota passando por onde não há mais chão) só apareceria se um
   * destrutível fosse PISO, que é justamente o que a regra de ouro do contrato proíbe.
   *
   * Quem for fechar esse laço precisa de uma mensagem nova no worker, algo como
   * `{type: 'disable', start, count}`, alimentada por este acessor. Não edito nem o serviço nem o
   * worker, então aqui fica só a fonte da verdade.
   */
  destructionRanges(): readonly {start: number; count: number}[] {
    return this.destructionLedger?.ranges ?? [];
  }

  /**
   * Publica as remoções para a cópia da navegação, só quando algo mudou.
   *
   * O `drainDirty` é o que evita mandar a lista inteira todo quadro — ela cresce com a partida.
   * Se o worker ainda não nasceu, a publicação falha em silêncio e a próxima quebra reenvia o
   * conjunto acumulado, que é sempre o estado completo.
   */
  private publishDestructionRanges(): void {
    const ledger = this.destructionLedger, navigation = this.navigation;
    if (!ledger || !navigation) return;
    // `drainDirty` consome a mudança; se a publicação falhar (worker ainda não nasceu) a pendência
    // fica marcada e o próximo quadro tenta de novo com o conjunto acumulado, que é o estado real.
    if (ledger.drainDirty()) this.destructionPublishPending = true;
    if (!this.destructionPublishPending) return;
    if (navigation.applyDisabledRanges(ledger.ranges)) this.destructionPublishPending = false;
  }
  private destructionPublishPending = false;

  attachDestruction(port: DestructionPort): void {
    this.destruction = port;
    const ledger = this.destructionLedger;
    if (!this.weapons) return;
    this.weapons.destruction = ledger
      ? {
        hit: hit => ledger.record(port.hit(hit)),
        update: dt => port.update(dt),
        reset: () => port.reset(),
      }
      : port;
  }

  /**
   * A fachada usa `resetAttempt()`; a porta do jogo fala `reset()`. Um adaptador de uma linha
   * evita que qualquer um dos dois lados mude de nome só para casar com o outro.
   */
  private destructionPortOf(system: DestructionSystem): DestructionPort {
    return {
      hit: hit => system.hit(hit),
      update: dt => system.update(dt),
      reset: () => system.resetAttempt(),
      dispose: () => this.destructionVisuals?.dispose(),
    };
  }
  private destructionRecords = 0;
  private destructionWarnings: readonly string[] = [];
  /** Registros aceitos, na ordem do arquivo — é a lista que o inspetor do F2 percorre. */
  private destructionList: readonly DestructibleRecord[] = [];
  private inspectCursor = -1;

  private pickHomeIsland(manifest: PlanetManifest, graph: PlanetGraph): IslandRecord | undefined {
    const stream = this.rng.stream('spawn');
    const islands = [...manifest.islands].filter(island => graph.neighbours(island.id).length > 0);
    const pool = islands.length > 0 ? islands : [...manifest.islands];
    return pool[Math.min(pool.length - 1, Math.floor(stream.next() * pool.length))];
  }

  /**
   * Monta a ilha de partida: nascimento validado por sonda radial, motor, câmera, cálice distante,
   * baús e diretor. Reprovando todas as ilhas, é erro de mapa — nunca um corpo sem apoio medido.
   */
  private placeRun(): void {
    const frame = this.frame, graph = this.graph, manifest = this.manifest;
    if (!frame || !graph || !manifest) return;
    const options = {...SPAWN_DEFAULTS, height: PLAYER_TUNING.height, maxSlopeDegrees: PLAYER_TUNING.maxSlopeDegrees};
    const preferred = this.pickHomeIsland(manifest, graph);
    const order = preferred ? [preferred, ...manifest.islands.filter(i => i.id !== preferred.id)] : [...manifest.islands];
    let chosen: {island: IslandRecord; probe: SpawnProbe} | undefined;
    for (const island of order) {
      const probe = findIslandSpawn(this.collision, frame, island, options);
      if (probe) {chosen = {island, probe}; break;}
    }
    if (!chosen) {
      this.error = 'Nenhuma ilha deste planeta tem apoio válido para desembarcar.';
      return;
    }
    this.homeIsland = chosen.island;
    this.visited = new Set([chosen.island.id]);
    this.objective = new PlanetObjective(frame, graph);
    const site = this.objective.plan(this.collision, chosen.island);
    if (site) this.chalice?.placeAt(site.position, site.probe.up);

    const spawn = respawnAbove(chosen.probe, 0.4);
    const heading = this.headingTowards(chosen.probe, site?.island);
    this.motor = new PlanetMotor({
      frame, collision: this.collision, spawn, heading,
      listener: {
        recovered: fraction => this.onVoidRecovery(fraction),
        // Salto e aterrissagem têm som próprio desde já; o passo vem do contato do pé, abaixo.
        jumped: () => this.audio.skill('jump'),
        landed: impact => {
          this.audio.bodyGround(Math.min(1, impact / 14));
          if (impact > 9) this.audio.impact();
        },
      },
    });
    this.footing.reset();
    this.reference = normalize(reject(heading, chosen.probe.up), {x: 0, y: 0, z: 1});
    this.rig?.planet.snapTo(this.motor.position, heading);
    // A entrada é armada com a MESMA tangente de marcha do desembarque: a plataforma da nave
    // aponta para onde a partida vai seguir. `play()` sai só no Jogar (ver `render`).
    this.arrival?.start(chosen.probe.position, {heading});
    this.intro?.hide();
    this.director = new MonsterDirector(this.rng.stream('director'), this.progression.stage, 24, 'expedition');
    this.bossRequested = false;
    this.run?.plantChests(chosen.island);
    if (site) this.run?.plantChests(site.island, 1);
    this.hp = this.progression.stats.maxHP;
    this.invulnerable = 0;
    this.inspectCursor = -1;
    this.travelled = 0;
  }

  private headingTowards(probe: SpawnProbe, target: IslandRecord | undefined): Vec3 {
    const fallback = normalize(reject({x: 0, y: 0, z: 1}, probe.up), {x: 0, y: 0, z: 1});
    if (!target) return fallback;
    const tangent = reject(sub(target.centre, probe.position), probe.up);
    return length(tangent) > 1e-6 ? normalize(tangent) : fallback;
  }

  // ---------------------------------------------------------------- passo fixo

  /**
   * Pronto para jogar. Exige, além dos assets, uma ilha de partida validada — o combate NUNCA
   * começa antes de existir chão medido sob o corpo e as armas e pragas carregadas.
   */
  get ready(): boolean {
    return !this.error && this.pending.size === 0
      && this.motor !== undefined && this.avatar?.ready === true
      && this.weapons?.ready === true && this.enemies?.ready === true;
  }

  fixedUpdate(dt: number): void {
    const motor = this.motor, rig = this.rig;
    // A navegação continua sendo construída com orçamento; antes de começar recebe fatia maior.
    this.navigation?.build(!this.started);
    if (!this.ready || !motor || !rig) return;
    if (this.paused || !this.started || this.defeat) return;
    if (this.arrival?.holdsControl) return;

    const input: InputFrame = this.input.read();
    this.applyLook(motor.up);
    if (input.dodge) this.sprinting = true;
    if (Math.hypot(input.x, input.z) < 0.1 || input.fire || input.charging) this.sprinting = false;

    const stats = this.progression.stats;
    const before = {...motor.position};
    const upBefore = {...motor.up};
    motor.fixedUpdate(dt, {x: input.x, z: input.z, jump: input.jump, sprint: this.sprinting}, rig.heading);
    const carried = transport(this.reference, upBefore, motor.up);
    this.reference = normalize(reject(carried, motor.up), this.reference);
    this.travelled += length(reject(sub(motor.position, before), motor.up));
    const island = this.graph?.islandAt(motor.position);
    if (island && motor.grounded) this.visited.add(island.id);

    // ---- combate -----------------------------------------------------------------------------
    const aim = this.aim();
    const weapons = this.weapons!;
    weapons.stats = {damage: stats.damage, attackSpeed: stats.attackSpeed, crit: stats.crit, mp: stats.mp};
    this.charging = Boolean(input.charging);
    if (input.reload) weapons.requestReload();
    this.mp.speedMultiplier = 1 + (stats.mp - 1) * 0.5;
    const released = this.mp.update(dt, this.charging && !weapons.reloading && this.hp > 0);
    if (released) weapons.releaseSkill(released as Exclude<MPTier, 0>, aim);
    weapons.fixedUpdate(dt, input.fire && !this.charging && this.hp > 0, aim);

    // ---- diretor e pragas --------------------------------------------------------------------
    this.navigation?.tick(dt);
    // `holdsSpawns` só cai quando o corpo LEVANTA: nada de praga solta enquanto a chegada roda.
    this.updateDirector(dt);
    this.enemies?.fixedUpdate(dt);

    // ---- objetivo, baús e vida ---------------------------------------------------------------
    this.objective?.update(motor.position);
    if (input.interact !== undefined) this.interact();
    const picked = this.run?.collect(motor.position);
    if (picked) this.say(`${picked.name} equipado`);
    this.invulnerable = Math.max(0, this.invulnerable - dt);
    this.regenDelay = Math.max(0, this.regenDelay - dt);
    if (this.hp > 0 && this.regenDelay === 0) this.hp = Math.min(stats.maxHP, this.hp + stats.regeneration * dt);
    if (this.extraction > 0) {
      this.extraction -= dt;
      if (this.extraction <= 0) this.advanceStage();
    }
  }

  /**
   * Pressão do diretor: exploração tranquila, horda final quando o cálice acorda.
   *
   * `MonsterDirector` é usado no modo `expedition` sem cópia — ele já abre com no máximo 3 hostis
   * vivos nos primeiros 30 s e 5 até 60 s, que é a abertura baixa pedida. A `pressure` só sobe
   * quando a horda final começa, e o chefe é pedido uma única vez por ativação.
   */
  private updateDirector(dt: number): void {
    // Nenhuma praga solta enquanto a chegada roda — só depois de o corpo LEVANTAR.
    if (this.arrival?.holdsSpawns) return;
    const director = this.director, enemies = this.enemies, objective = this.objective;
    if (!director || !enemies || !objective) return;
    const horde = objective.hordeActive;
    director.pressure = horde ? 1 : 0;
    director.pressureCap = finalHordePressure(this.progression.level);
    if (horde && !this.bossRequested && !objective.bossDefeated) {
      this.bossRequested = enemies.spawn('boss', {boss: true, stage: this.progression.stage, level: this.progression.level});
    }
    director.update(dt, enemies.kills, enemies.population,
      (kind: EnemyKind) => enemies.spawn(kind),
      horde ? 8 + director.pressureCap : 6);
  }

  /** `E`: cálice primeiro (é o objetivo), baú depois. */
  private interact(): void {
    const motor = this.motor, objective = this.objective;
    if (!motor) return;
    const action = objective?.activate(motor.position);
    if (action === 'horda') {
      this.bossRequested = false;
      this.audio.charge(1);
      this.say('A horda final acordou. Derrote a Praga Alfa.');
      return;
    }
    if (action === 'recolhido') {
      this.audio.charge(3);
      this.events.emit('StageCompleted', {stageId: `planet-${this.progression.stage}`});
      this.extraction = 3.4;
      this.say('Suco recolhido. Extração em curso…');
      return;
    }
    const chest = this.run?.openChest(motor.position);
    if (chest) {this.say(chest); this.audio.charge(2);}
  }

  /**
   * Fim de estágio: inventário, nível e XP sobrevivem; o planeta é resemeado e o corpo desembarca
   * numa ilha nova. É `RunProgression.advanceStage()` — o mesmo contrato do jogo plano.
   */
  private advanceStage(): void {
    this.run?.advanceStage();
    this.enemies?.clear();
    this.mp.cancel();
    this.weapons?.resetAttempt();
    this.restoreScenery();
    this.chalice?.hide();
    this.placeRun();
    this.hp = this.progression.stats.maxHP;
    this.say(`Ilha ${this.progression.stage}. Itens preservados.`);
  }

  private applyLook(up: Vec3): void {
    const sensitivity = this.input.sensitivity || CAMERA_TUNING.sensitivity;
    const dx = (this.input.yaw - this.lastYaw) / sensitivity;
    const dy = (this.input.pitch - this.lastPitch) / sensitivity;
    this.lastYaw = this.input.yaw;
    this.lastPitch = this.input.pitch;
    if (Number.isFinite(dx) && Number.isFinite(dy)) this.rig?.look(dx, dy, up);
  }

  /** Mira do quadro: olho na câmera, direção da câmera, vertical do corpo. Tudo em MUNDO. */
  private aim(): WeaponAim {
    const rig = this.rig!;
    const camera = rig.camera.position;
    return {eye: {x: camera.x, y: camera.y, z: camera.z}, forward: rig.forward, up: this.motor?.up ?? rig.up};
  }

  // ---------------------------------------------------------------- vida do jogador

  private hurt(damage: number, sourceId: string, from: Vec3): void {
    if (this.hp <= 0 || this.invulnerable > 0 || this.defeat) return;
    const armor = this.progression.stats.armor;
    const applied = Math.max(0, damage) * 100 / (100 + Math.max(0, armor));
    if (applied <= 0) return;
    this.hp = Math.max(0, this.hp - applied);
    this.invulnerable = 0.25;
    this.regenDelay = 2;
    this.audio.playerHurt(sourceId.includes('shot') ? 'projectile' : 'melee');
    void from;
    if (this.hp <= 0) this.onDefeat('As pragas derrubaram você.');
  }

  private onVoidRecovery(fraction: number): void {
    this.falls++;
    this.hp = Math.max(0, this.hp - this.progression.stats.maxHP * fraction);
    this.audio.playerHurt('environment');
    if (this.hp <= 0) this.onDefeat('O vazio levou você.');
  }

  private onEnemyKilled(context: DamageContext): void {
    const enemies = this.enemies, objective = this.objective;
    if (!enemies) return;
    const actor = enemies.actors.find(entry => entry.id === context.victimId);
    const elite = actor?.boss === true;
    this.progression.reward(elite);
    objective?.registerKill(elite ? 'boss' : actor?.kind ?? 'eggplant');
    if (!elite) return;
    objective?.registerBossDefeat();
    this.director?.bossKilled();
    this.audio.charge(3);
    this.say('Praga Alfa derrotada.');
  }

  private onDefeat(reason: string): void {
    if (this.defeat) return;
    this.deaths++;
    this.defeat = `${reason}\nIlhas visitadas: ${this.visited.size} · nível ${this.progression.level} · ilha ${this.progression.stage}.`;
    this.started = false;
    this.mp.cancel();
    // A entrada não pode continuar desenhando o corpo no deck depois da derrota.
    this.arrival?.abort();
    this.intro?.hide();
    this.input.clear();
    this.audio.fatalImpact();
    if (document.pointerLockElement) document.exitPointerLock();
  }

  /** Morte reinicia a tentativa: inventário, nível e créditos zerados, como num roguelike. */
  private retry(): void {
    this.defeat = '';
    this.falls = 0;
    this.enemies?.clear();
    this.weapons?.resetAttempt();
    this.mp.cancel();
    this.run?.resetOnDeath();
    this.restoreScenery();
    this.chalice?.hide();
    this.placeRun();
    this.hp = this.progression.stats.maxHP;
    this.started = true;
  }

  /**
   * Cenário inteiro de novo: nova tentativa e próxima ilha.
   *
   * A ordem importa. O ledger reativa a colisão PRIMEIRO, porque é ele quem sabe quais intervalos
   * foram desativados mesmo que a fachada já tenha esquecido; só depois a fachada apaga os cacos e
   * volta os props à tela. O contrário deixaria colisão removida sob um prop visível — o defeito
   * espelhado do "parede fantasma", e igualmente ruim: o jogador atravessaria a caixa.
   */
  private restoreScenery(): void {
    this.destructionLedger?.restore();
    this.destruction.reset();
  }

  private say(message: string): void {this.notice = message; this.noticeClock = 2.6;}

  /**
   * Sinais sonoros da entrada, com as MESMAS gravações que o resto desta cena já usa.
   * Mesmo mapeamento do jogo plano: passo no deck, salto, vento da queda, impacto e levantar.
   */
  private arrivalCue(cue: IntroCue): void {
    if (cue === 'step') {this.audio.footstep('concrete', 1.7); return;}
    if (cue === 'launch') {this.audio.skill('jump'); this.audio.arrivalWind(0.5); return;}
    if (cue === 'wind') {this.audio.arrivalWind(Math.min(1, 0.35 + (this.arrival?.intro.flight.flutter ?? 0))); return;}
    if (cue === 'impact') {this.audio.impact(true); this.audio.bodyGround(1); return;}
    if (cue === 'rise') this.audio.arrivalRise();
  }

  // ---------------------------------------------------------------- apresentação

  render(alpha: number): void {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastRender) / 1000);
    this.lastRender = now;
    const presentationDt = this.paused ? 0 : dt;
    this.noticeClock = Math.max(0, this.noticeClock - presentationDt);
    this.audio.update(presentationDt);
    this.hud.update(this.hudState(), presentationDt);
    this.debug.update();

    const rig = this.rig, motor = this.motor, avatar = this.avatar, frame = this.frame;
    if (!rig || !frame) return;
    if (motor && avatar?.ready) {
      const position = this.interpolated(motor, alpha);
      const up = frame.up(position);
      // Chegada pela nave: enquanto ela desenha, o corpo está no deck/queda — NÃO no nascimento.
      // `play()` é idempotente e é o que tira a entrada da espera quando o jogador aperta Jogar;
      // sem ele `holdsControl` nunca cairia e o corpo nunca andaria.
      const arrival = this.arrival;
      if (arrival) {
        if (this.started && !this.defeat) arrival.play(this.intro?.prologue ?? false);
        arrival.update(this.paused ? 0 : dt, cue => this.arrivalCue(cue));
      }
      const onDeck = arrival?.visible === true
        ? this.intro?.render(arrival, avatar, alpha, this.paused ? 0 : dt)
        : undefined;
      if (!onDeck) {
        this.intro?.hide();
        avatar.update({
          position, up,
          reference: this.reference,
          facing: motor.forward,
          velocity: motor.velocity,
          grounded: motor.grounded,
          sprinting: this.sprinting,
        }, alpha, presentationDt, {
          aiming: !this.sprinting || this.charging,
          charging: this.charging,
          pitch: rig.pitch,
          chargeProgress: this.mp.seconds / 2.6,
          aimWorld: rig.forward,
        });
        // A `CharacterVisual` guarda a posição em espaço LOCAL (o pai radial carrega o mundo).
        // Armas e efeitos precisam do MUNDO, então ela é reescrita aqui, depois da raiz.
        avatar.visual.position.copyFromFloats(position.x, position.y, position.z);
      }
      this.updateFootsteps(presentationDt, motor, up);

      this.weapons?.updatePose(presentationDt);
      // Rachadura, caco e poeira andam no relógio de apresentação: pausar congela tudo junto.
      this.destruction.update(presentationDt);
      this.publishDestructionRanges();
      this.enemies?.render(presentationDt);
      this.run?.render(presentationDt, {x: rig.camera.position.x, y: rig.camera.position.y, z: rig.camera.position.z});
      this.chalice?.update(presentationDt, true);
      rig.update(position, dt);
      const shot = this.arrival?.shot;
      if (shot) rig.blend(shot.position, shot.target, shot.up, shot.weight);
      if (this.orbitView) this.applyOrbitView(dt, position);
    }
    this.scene.render();
  }

  private hudState() {
    const stats = this.progression.stats;
    const objective = this.objective, weapons = this.weapons, motor = this.motor;
    const onTarget = Boolean(weapons && motor && this.started && !this.defeat && this.ready
      && weapons.aimTarget(this.aim()) !== undefined);
    return {
      pending: [...this.pending],
      error: this.error,
      objective: this.error ? '' : objective && motor ? objective.label(motor.position) : 'Preparando a expedição…',
      health: this.hp,
      maxHealth: stats.maxHP,
      ammo: weapons?.ammo ?? 0,
      magazine: weapons?.capacity ?? 0,
      reloading: weapons?.reloading ?? false,
      mp: this.mp.current,
      mpTier: this.mp.tier,
      credits: this.progression.credits,
      level: this.progression.level,
      stage: this.progression.stage,
      onTarget,
      threats: this.enemies?.population ?? 0,
      ...(objective?.hordeActive ? {juice: {value: objective.juice, target: objective.juiceTarget}} : {}),
      ...(this.noticeClock > 0 && this.notice ? {notice: this.notice} : {}),
      ...(this.defeat ? {defeat: this.defeat} : {}),
    };
  }

  /**
   * Passos pelo contato real do pé, medido ao longo da vertical LOCAL.
   *
   * `FootstepSync` é usado como está — os limiares dele foram medidos no `gunslinger.glb` e não
   * dependem de orientação. O que muda no planeta é só a grandeza de entrada: a altura do pé sai
   * da projeção em `up`, não da diferença em `y` de mundo, que sob o pai radial não significa nada.
   */
  private updateFootsteps(dt: number, motor: PlanetMotor, up: Vec3): void {
    const heights = this.avatar?.visual.footHeights(up);
    if (!heights) return;
    this.footSamples[0]!.height = heights.right;
    this.footSamples[1]!.height = heights.left;
    // Os passos do deck vêm do sinal `step` da coreografia, não do contato do pé: durante a
    // entrada inteira o motor está congelado e a altura do pé não significa nada.
    this.footing.muted = !this.started || this.paused || this.defeat !== '' || this.arrival?.visible === true;
    this.footing.update(dt, this.footSamples, motor.grounded, motor.tangentialSpeed,
      (_side, strength) => this.audio.footstep('grass', strength * 8));
  }

  /** Posição do pé interpolada. A corda entre dois passos afunda micrômetros; o apoio absorve. */
  private interpolated(motor: PlanetMotor, alpha: number): Vec3 {
    const t = Math.max(0, Math.min(1, alpha));
    return {
      x: motor.previous.x + (motor.position.x - motor.previous.x) * t,
      y: motor.previous.y + (motor.position.y - motor.previous.y) * t,
      z: motor.previous.z + (motor.position.z - motor.previous.z) * t,
    };
  }

  /**
   * Vista de órbita de QA: confirma a olho que a casca fecha por todos os lados.
   *
   * Dois cuidados que o primeiro esboço não tinha, e que faziam a câmera "olhar para longe do
   * globo":
   *
   * 1. a distância sai do RAIO REAL do manifesto (`surfaceRadius`), não de um múltiplo do teto —
   *    com o planeta reautorado para R=180 o enquadramento tem de acompanhar sozinho;
   * 2. o `up` da câmera não pode ser o radial do ponto observado, porque olhando de cima ele fica
   *    PARALELO à direção de visão e a base degenera. Aqui o `up` é a própria tangente do
   *    movimento de órbita, que é sempre perpendicular ao olhar.
   */
  private applyOrbitView(dt: number, anchor: Vec3): void {
    const frame = this.frame, rig = this.rig;
    if (!frame || !rig) return;
    this.orbitAngle += dt * 0.12;
    const radial = frame.up(anchor);
    // Tangente estável: nunca paralela a `radial`, mesmo quando a permutação coincide com ele.
    const seed = Math.abs(radial.y) < 0.9 ? {x: 0, y: 1, z: 0} : {x: 1, y: 0, z: 0};
    const side = normalize(reject(seed, radial), {x: 1, y: 0, z: 0});
    const cos = Math.cos(this.orbitAngle), sin = Math.sin(this.orbitAngle);
    const direction = normalize(add(scale(radial, cos), scale(side, sin)), radial);
    // 2,6 raios: o globo inteiro cabe com folga num FOV de 60° e ainda se vê a curvatura.
    const position = add(frame.centre, scale(direction, frame.surfaceRadius * 2.6));
    const forward = normalize(sub(frame.centre, position), {x: 0, y: -1, z: 0});
    const cameraUp = normalize(add(scale(radial, -sin), scale(side, cos)), side);
    rig.apply(position, forward, cameraUp);
  }

  // ---------------------------------------------------------------- diagnóstico (F2)

  private lapProgress(): number {
    return this.frame ? Math.round(this.travelled / this.frame.circumference * 100) / 100 : 0;
  }

  private readout(): string {
    const motor = this.motor, frame = this.frame;
    if (!motor || !frame) return 'Planeta ainda não montado.';
    const u = motor.up, p = motor.position;
    const support = this.collision.supportBelow(p, u, 0.6, 3);
    const weapons = this.weapons;
    return [
      `up    ${u.x.toFixed(3)} ${u.y.toFixed(3)} ${u.z.toFixed(3)}`,
      `pos   ${p.x.toFixed(2)} ${p.y.toFixed(2)} ${p.z.toFixed(2)}`,
      `raio  ${frame.radius(p).toFixed(2)} · alt ${motor.altitude.toFixed(3)} m`,
      `apoio ${support ? `${support.offset.toFixed(3)} m · ${support.slopeDegrees.toFixed(1)}°` : 'nenhum'}`,
      `vel   tang ${motor.tangentialSpeed.toFixed(2)} · rad ${motor.verticalSpeed.toFixed(2)}`,
      `volta ${this.lapProgress().toFixed(2)} · ilhas ${this.visited.size}/${this.graph?.size ?? 0}`,
      `tiros ${weapons?.shots ?? 0} · acertos ${weapons?.hits ?? 0}`,
      `pragas ${this.enemies?.population ?? 0} vivas · ${this.enemies?.kills ?? 0} abates`,
      `diretor estado ${this.director?.state ?? 0} · créditos ${Math.round(this.director?.credits ?? 0)}`,
      `objetivo ${this.objective?.phase ?? '—'} · suco ${Math.round(this.objective?.juice ?? 0)}/${this.objective?.juiceTarget ?? 0}`,
      `quedas ${this.falls} · mortes ${this.deaths} · base ${this.homeIsland?.name ?? '—'}`,
      this.navigation?.readout() ?? 'navegação indisponível',
      this.destructionLedger?.readout() ?? 'destruição não montada',
      this.inspectedPropReadout(),
      `destrutíveis ${this.destructionRecords} · ${this.destructionNote}`
        + (this.destructionSystem
          ? ` · quebrados ${this.destructionSystem.broken} · ${this.destructionSystem.removedTriangles} tris fora`
          : '')
        + (this.destructionWarnings.length > 0 ? `\n  recusado: ${this.destructionWarnings[0]}` : ''),
      `rotas ${this.enemies?.routing.active ?? 0} ativas · ${this.enemies?.routing.adopted ?? 0} adotadas`
        + ` · ${this.enemies?.routing.invalidated ?? 0} invalidadas · ${this.enemies?.routing.strayed ?? 0} desviadas`,
      `triângulos ${this.collision.triangleCount}`,
    ].join('\n');
  }

  /**
   * Teleporte de QA: avança pela LISTA do manifesto, não pelo primeiro vizinho.
   * Pelo vizinho o teste ficava em pingue-pongue entre duas ilhas e nunca chegava ao antípoda.
   */
  private teleportNextIsland(): string {
    const motor = this.motor, graph = this.graph, frame = this.frame, manifest = this.manifest;
    if (!motor || !graph || !frame || !manifest) return 'Planeta ainda não montado.';
    const current = graph.islandAt(motor.position);
    const index = manifest.islands.findIndex(island => island.id === current?.id);
    for (let step = 1; step <= manifest.islands.length; step++) {
      const next = manifest.islands[(index + step) % manifest.islands.length]!;
      if (next.id === current?.id) continue;
      const probe = findIslandSpawn(this.collision, frame, next, {...SPAWN_DEFAULTS, height: PLAYER_TUNING.height});
      if (!probe) continue;
      const heading = this.headingTowards(probe, this.objective?.chalice?.island);
      motor.teleport(respawnAbove(probe, 0.4), heading);
      this.reference = normalize(reject(heading, probe.up), this.reference);
      this.rig?.planet.snapTo(motor.position, heading);
      // Teleporte de QA cancela a chegada: nada da coreografia pode continuar desenhando o corpo
      // numa ilha onde ele não está mais.
      this.arrival?.abort();
      this.enemies?.clear();
      return `Teleportado para ${next.name}.`;
    }
    return 'Nenhuma ilha com apoio validado.';
  }

  /**
   * Inspetor de cenário quebrável (F2) — QA visual, um prop por clique.
   *
   * Põe o corpo em **apoio validado** a poucos metros do prop e aponta corpo e câmera para ele.
   * O que este botão NÃO faz, de propósito: causar dano. Quem quebra é o botão esquerdo com a
   * arma de verdade, passando pelo mesmo `hitscan` do jogo — um atalho que "testasse" a destruição
   * por dentro provaria só que o atalho funciona.
   *
   * A distância sai do tamanho do prop (`extents`), então uma caixa de 40 cm e um celeiro não
   * pedem o mesmo recuo. Se nenhuma direção em volta tiver apoio, o corpo NÃO é movido e a
   * mensagem diz isso — teleportar para o vazio só para olhar seria pior que não olhar.
   */
  private inspectDestructible(kind?: string): string {
    const motor = this.motor, frame = this.frame, rig = this.rig;
    if (!motor || !frame || !rig) return 'Planeta ainda não montado.';
    if (this.destructionList.length === 0) {
      return this.destructionRecords === 0
        ? `Nenhum destrutível no manifesto — ${this.destructionNote}.`
        : 'Nenhum destrutível aceito.';
    }
    this.inspectCursor = (this.inspectCursor + 1) % this.destructionList.length;
    if (kind) {
      const start = this.inspectCursor;
      while (this.destructionList[this.inspectCursor]?.kind !== kind) {
        this.inspectCursor = (this.inspectCursor + 1) % this.destructionList.length;
        if (this.inspectCursor === start) return 'Nenhum objeto desse tipo no mapa.';
      }
    }
    const record = this.destructionList[this.inspectCursor]!;
    const profile = profileOf(record.kind);
    const up = normalize(record.up, frame.up(record.centre));
    const reach = Math.max(4, length(record.extents) + 3);

    // Oito direções em volta, na tangente do prop; a primeira com apoio medido vence.
    const east = normalize(reject({x: 0, y: 1, z: 0}, up), {x: 1, y: 0, z: 0});
    const north = cross(up, east);
    for (let i = 0; i < 8; i++) {
      const angle = i * Math.PI / 4;
      const offset = add(scale(east, Math.cos(angle) * reach), scale(north, Math.sin(angle) * reach));
      const candidate = frame.geodesicStep(record.centre, offset).position;
      const probe = probeSpawn(this.collision, frame, candidate,
        {...SPAWN_DEFAULTS, height: PLAYER_TUNING.height, requirePlatform: false});
      if (!probe) continue;
      const toProp = sub(record.centre, probe.position);
      const heading = normalize(reject(toProp, probe.up), motor.forward);
      motor.teleport(respawnAbove(probe, 0.2), heading);
      this.reference = normalize(reject(heading, probe.up), this.reference);
      rig.planet.snapTo(motor.position, heading);
      // Pitch para o centro do prop: olhar para o horizonte deixaria uma caixa baixa fora do quadro.
      const eye = add(probe.position, scale(probe.up, CAMERA_TUNING.pivotHeight));
      const look = sub(record.centre, eye);
      const planar = length(reject(look, probe.up));
      rig.planet.pitch = Math.max(-1.1, Math.min(1.1, -Math.atan2(dot(look, probe.up), Math.max(0.01, planar))));
      // A chegada e as pragas atrapalhariam a leitura; o jogo normal não muda por isso.
      this.arrival?.abort();
      this.intro?.hide();
      this.enemies?.clear();
      this.invulnerable = 60;
      this.say(`${record.kind} · ${record.id}`);
      // Vida VIVA: sai do estado registrado na fachada, não do perfil do tipo. É por isso que
      // clicar de novo no mesmo prop depois de atirar mostra o dano acumulado de verdade.
      const state = this.destructionSystem?.field.get(record.id);
      const life = state
        ? `vida ${Math.max(0, Math.round(state.health))}/${profile.health}`
          + ` · estágio ${state.stage}/${profile.stages}${state.broken ? ' · QUEBRADO' : ''}`
        : `vida ${profile.health} (estado não registrado)`;
      return `${this.inspectCursor + 1}/${this.destructionList.length} · ${record.kind} "${record.id}"`
        + ` · ${life} · ${record.triangleCount} triângulos · a ${reach.toFixed(1)} m.`
        + ' Atire com o botão esquerdo. Proteção QA: 60 s.';
    }
    return `${record.kind} "${record.id}" sem apoio validado em volta — corpo não foi movido.`;
  }

  private inspectedPropReadout(): string {
    const record = this.destructionList[this.inspectCursor];
    const state = record && this.destructionSystem?.field.get(record.id);
    return state ? `inspeção ${state.id}: ${Math.round(state.health)} de ${state.profile.health} · estágio ${state.stage}${state.broken ? ' · QUEBRADO' : ''}` : '';
  }

  private verifyFall(): string {
    const motor = this.motor, frame = this.frame;
    if (!motor || !frame) return 'Planeta ainda não montado.';
    const before = motor.recoveries;
    motor.teleport(frame.atAltitude(motor.position, -(frame.surfaceRadius - frame.voidRadius) - 5), motor.forward);
    return `Corpo solto no vazio (recuperações antes: ${before}).`;
  }

  // ---------------------------------------------------------------- ciclo de vida

  getDebug() {
    const motor = this.motor;
    return {
      entities: this.enemies?.actors.length ?? 0,
      aiJobs: this.enemies?.population ?? 0,
      aiTicks: this.enemies?.kills ?? 0,
      poolActive: 0, poolCapacity: 0, poolPeak: 0, poolMisses: 0,
      definitions: this.graph?.size ?? 0,
      listeners: this.events.listenerCount,
      player: [
        '',
        `Planeta          raio ${this.frame?.surfaceRadius ?? 0} · ${this.graph?.size ?? 0} ilhas · ${this.manifest?.bridges.length ?? 0} pontes`,
        `Colisão          ${this.collision.triangleCount} triângulos`,
        `Corpo            alt ${motor ? motor.altitude.toFixed(2) : '—'} m · ${motor?.grounded ? 'apoiado' : 'no ar'}`,
        `Expedição        ${this.objective?.phase ?? '—'} · ilha ${this.progression.stage} · nível ${this.progression.level}`,
        `Pragas           ${this.enemies?.population ?? 0} vivas · ${this.enemies?.kills ?? 0} abates`,
        this.pending.size ? `Carregando       ${[...this.pending].join(', ')}` : '',
        this.error ? `ERRO             ${this.error.split('\n')[0]}` : '',
      ].filter(Boolean).join('\n'),
    };
  }

  get isPaused(): boolean {return this.paused;}
  setPaused(paused: boolean): void {this.paused = paused; this.audio.setActive(!paused && this.started);}
  configure(name: string, value: number): void {
    if (name === 'fov' && this.rig && Number.isFinite(value)) this.rig.camera.fov = value * Math.PI / 180;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.debug.dispose();
    this.hud.dispose();
    this.input.dispose();
    this.destruction.dispose?.();
    this.navigation?.dispose();
    this.weapons?.dispose();
    this.enemies?.dispose();
    this.run?.dispose();
    this.avatar?.dispose();
    this.intro?.dispose();
    this.chalice?.dispose();
    this.world?.dispose();
    this.rig?.dispose();
    this.audio.dispose();
    this.events.clear();
    this.instrumentation.dispose();
    this.scene.dispose();
  }
}
