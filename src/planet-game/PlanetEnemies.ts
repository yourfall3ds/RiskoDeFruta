import {LoadAssetContainerAsync} from '@babylonjs/core/Loading/sceneLoader';
import '@babylonjs/loaders/glTF';
import {TransformNode} from '@babylonjs/core/Meshes/transformNode';
import {Quaternion, Vector3} from '@babylonjs/core/Maths/math.vector';
import type {AssetContainer} from '@babylonjs/core/assetContainer';
import type {AbstractMesh} from '@babylonjs/core/Meshes/abstractMesh';
import type {Scene} from '@babylonjs/core/scene';
import type {ShadowGenerator} from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import type {DamageContext, GameEvents, Vec3} from '../core/contracts';
import type {EventBus} from '../core/EventBus';
import type {RandomStream} from '../core/RunRNG';
import {Health} from '../combat/Health';
import {ENEMIES, bossHealth, type EnemyKind} from '../run/MonsterDirector';
import type {WeaponAudio} from '../audio/RecordedAudio';
import {ShotEffects} from '../vfx/ShotEffects';
import type {PlanetCollision} from '../planet/PlanetCollision';
import {PlanetFrame, add, cross, dot, length, normalize, quaternionFromBasis, reject, scale, sub} from '../planet/PlanetFrame';
import {PlanetMotor} from '../planet/PlanetMotor';
import {lineOfSight, type HitCapsule} from './PlanetHitscan';
import {PlanetActorRouting, type NavigationPort} from './PlanetActorRouting';
import {probeSpawn, ringSamples, SPAWN_DEFAULTS} from './PlanetSpawn';

/**
 * As pragas do planeta.
 *
 * Cada ator tem o SEU `PlanetMotor`: gravidade radial, encaixe no solo por sonda radial, degrau,
 * escorregamento e recuperação de vazio vêm do mesmo motor do jogador. Nenhum ator procura chão com
 * o `y` do mundo e nenhum ator é posicionado por interpolação solta no ar — se ele está de pé, é
 * porque a cápsula dele achou apoio na malha autoral.
 *
 * **Comportamento, e por que não `src/enemies/EnemyBehaviors`.** Aquele catálogo é excelente e
 * continua servindo o jogo plano, mas é planar na raiz: mede alcance com `hypot(dx, dz)` e monta a
 * origem dos projéteis somando altura em `y`. No globo isso erra o alvo em qualquer lugar fora do
 * polo. Aqui o CATÁLOGO de espécies (`ENEMIES`, `bossHealth`) é reaproveitado inteiro — vida,
 * velocidade, alcance, custo, raio e escala — e só a execução do ataque é reescrita no plano
 * tangente, em duas formas: contato (corpo a corpo) e feixe com linha de visão (à distância).
 */
export interface PlanetActor {
  readonly id: number;
  /**
   * Identidade ESTÁVEL do ator para a navegação. Nasce com ele e nunca muda — é o que garante
   * que a rota pedida pelo inimigo 7 volte para o inimigo 7 e não para o vizinho colado nele.
   */
  readonly key: string;
  readonly kind: EnemyKind;
  readonly boss: boolean;
  readonly health: Health;
  readonly motor: PlanetMotor;
  readonly root: TransformNode;
  /** Segundos restantes de aviso antes do golpe sair. */
  windup: number;
  cooldown: number;
  /** Tempo vivo, usado só pela apresentação. */
  age: number;
  dying: number;
  /** Segundos de simulação acumulados enquanto o ator esperou a vez no orçamento de tempo. */
  pending: number;
}

export interface EnemyDamageSink {
  /** Aplica dano no jogador. Só é chamado depois de linha de visão confirmada. */
  hurt(damage: number, sourceId: string, from: Vec3): void;
}

export interface EnemyWorld {
  readonly frame: PlanetFrame;
  readonly collision: PlanetCollision;
  /** Pé do jogador em espaço de mundo. */
  playerPosition(): Vec3;
  /** `false` congela ataques (morte, pausa, cinemática). */
  playerAlive(): boolean;
  /**
   * Raio da pegada da ilha sob o jogador, em metros. O anel de nascimento é limitado por ele:
   * medido no asset real, um anel fixo de 16–34 m não achava chão nenhum nas duas ilhas de
   * convés pequeno (`junction-3`, raio 10 m, e `junction-5`) — os hostis simplesmente não nasciam.
   */
  islandRadius(): number;
}

/** Só o chefe usa `boss.glb`; as pragas comuns usam os modelos de fruta do catálogo. */
const BOSS_MODEL = 'boss';

export const ENEMY_TUNING = {
  /** Distância de nascimento em torno do jogador, em metros de arco. */
  spawnNear: 16, spawnFar: 34,
  /** Tentativas de sonda por nascimento antes de desistir deste quadro. */
  spawnAttempts: 10,
  /** Acima disto o ator é aposentado (devolve orçamento, não conta abate). */
  retireMetres: 95,
  /** Segundos de morte antes de o corpo sumir. */
  deathSeconds: 0.9,
  /** Teto absoluto de atores vivos nesta prévia. */
  population: 8,
  /**
   * Orçamento de tempo dos motores por passo fixo, em milissegundos.
   *
   * Medido no asset real: um `PlanetMotor` custa ~85 µs por passo em terreno limpo e até ~960 µs
   * dentro de geometria densa — 8 atores no pior caso dariam 7,7 ms, quase metade de um quadro de
   * 60 Hz. Por isso o orçamento é de TEMPO e não de contagem: quem não couber neste passo acumula
   * o `dt` e anda no próximo, com a velocidade preservada.
   */
  motorBudgetMs: 2.5,
  /** Maior passo acumulado que um ator pode gastar de uma vez. */
  maxCatchUpSeconds: 1 / 20,
} as const;

let nextActorId = 100;

export class PlanetEnemies {
  readonly actors: PlanetActor[] = [];
  readonly effects: ShotEffects;
  ready = false;
  error = '';
  kills = 0;
  bossKills = 0;
  /** Ator de chefe vivo, quando existe. */
  boss: PlanetActor | undefined;

  private readonly containers = new Map<string, AssetContainer>();
  private readonly meshes = new Map<number, AbstractMesh[]>();
  private disposed = false;

  /**
   * Rotas do grafo, por ator. Sem serviço de navegação o roteador devolve sempre perseguição
   * local — que é o comportamento seguro: os hostis nascem e lutam na ilha do jogador.
   */
  readonly routing: PlanetActorRouting;

  constructor(
    private readonly scene: Scene,
    private readonly world: EnemyWorld,
    private readonly events: EventBus<GameEvents>,
    private readonly rng: RandomStream,
    private readonly audio: WeaponAudio,
    private readonly sink: EnemyDamageSink,
    private readonly shadows?: ShadowGenerator,
    navigation?: NavigationPort,
  ) {
    this.effects = new ShotEffects(scene);
    this.routing = new PlanetActorRouting(navigation);
  }

  get population(): number {return this.actors.filter(actor => !actor.health.dead).length;}

  async load(): Promise<void> {
    try {
      const models = new Set<string>([...Object.values(ENEMIES).map(entry => entry.model), BOSS_MODEL]);
      for (const model of models) {
        if (this.disposed) return;
        try {
          const container = await LoadAssetContainerAsync(`/models/${model}.glb`, this.scene);
          if (this.disposed) {container.dispose(); return;}
          this.containers.set(model, container);
        } catch {
          // O chefe tem modelo próprio; se ele faltar, o catálogo já traz um substituto autoral.
          if (model !== BOSS_MODEL) throw new Error(`modelo ${model}.glb indisponível`);
        }
      }
      this.ready = true;
    } catch (error) {
      if (!this.disposed) this.error = error instanceof Error ? error.message : 'Falha ao carregar as pragas';
    }
  }

  /** Cápsulas vivas para o tiro do jogador. */
  *capsules(): Generator<HitCapsule> {
    for (const actor of this.actors) {
      if (actor.health.dead) continue;
      const spec = ENEMIES[actor.kind];
      yield {
        id: actor.id, base: actor.motor.position, up: actor.motor.up,
        radius: spec.radius, height: Math.max(1, spec.radius * 2.4 * (actor.boss ? 1.6 : 1)),
        alive: true,
      };
    }
  }

  /** Dano vindo do jogador. Passa por `Health`, que é quem emite `EnemyHit` e paga MP. */
  damage(id: number, context: DamageContext): void {
    const actor = this.actors.find(entry => entry.id === id);
    if (!actor || actor.health.dead) return;
    const applied = actor.health.apply(context);
    if (!applied) return;
    const distance = length(sub(actor.motor.position, this.world.playerPosition()));
    this.audio.enemy(actor.health.dead ? 'death' : 'hit', actor.kind, distance);
    if (!actor.health.dead) return;
    this.kills++;
    if (actor.boss) {this.bossKills++; this.boss = undefined;}
    actor.dying = ENEMY_TUNING.deathSeconds;
  }

  /**
   * Nascimento perto do jogador, sempre sobre piso validado.
   *
   * O ponto sai de um passo geodésico a partir do corpo do jogador, e só vira nascimento se a
   * sonda radial achar apoio caminhável com espaço livre. Nunca existe ator solto no ar nem dentro
   * da geologia: quando nenhuma das tentativas passa, o nascimento simplesmente não acontece e o
   * diretor tenta de novo mais tarde.
   */
  spawn(kind: EnemyKind, options: {boss?: boolean; stage?: number; level?: number} = {}): boolean {
    if (!this.ready || this.actors.length >= ENEMY_TUNING.population + 2) return false;
    const spec = ENEMIES[kind];
    const player = this.world.playerPosition();
    const frame = this.world.frame;
    const height = Math.max(1.2, spec.radius * 2.2);
    const probeOptions = {
      ...SPAWN_DEFAULTS, height,
      // Um bicho não precisa da plataforma de desembarque do jogador; precisa de piso e espaço.
      requirePlatform: false, above: 3, below: 8,
    };
    // Numa ilha pequena o anel inteiro cairia no vazio; encolhe para caber no convés.
    const footprint = Math.max(6, this.world.islandRadius());
    const far = Math.min(ENEMY_TUNING.spawnFar, footprint * 0.9);
    const near = Math.min(ENEMY_TUNING.spawnNear, far * 0.55);
    const ring = ringSamples(frame, player, () => this.rng.next(), near, far, ENEMY_TUNING.spawnAttempts);
    for (const candidate of ring) {
      const probe = probeSpawn(this.world.collision, frame, candidate, probeOptions);
      if (!probe) continue;
      this.create(kind, probe.position, options);
      return true;
    }
    return false;
  }

  private create(kind: EnemyKind, position: Vec3, options: {boss?: boolean; stage?: number; level?: number}): void {
    const spec = ENEMIES[kind];
    const boss = options.boss === true;
    const id = nextActorId++;
    const hp = boss ? bossHealth(options.stage ?? 1, options.level ?? 1) : spec.hp;
    const frame = this.world.frame;
    const motor = new PlanetMotor({
      frame, collision: this.world.collision,
      spawn: add(position, scale(frame.up(position), 0.2)),
      heading: normalize(reject(sub(this.world.playerPosition(), position), frame.up(position)), {x: 0, y: 0, z: 1}),
      tuning: {
        speed: spec.speed, sprintMultiplier: 1,
        radius: Math.max(0.3, spec.radius * 0.8),
        height: Math.max(1.2, spec.radius * 2.2),
      },
    });
    const root = new TransformNode(`planet-enemy-${id}`, this.scene);
    root.rotationQuaternion = Quaternion.Identity();
    const scaleFactor = spec.scale * (boss ? 1.8 : 1);
    root.scaling.setAll(scaleFactor);
    const model = boss && this.containers.has(BOSS_MODEL) ? BOSS_MODEL : spec.model;
    const container = this.containers.get(model);
    const meshes: AbstractMesh[] = [];
    if (container) {
      const instance = container.instantiateModelsToScene(name => `enemy-${id}-${name}`, false, {doNotInstantiate: false});
      for (const node of instance.rootNodes) {
        node.parent = root;
        for (const mesh of node.getChildMeshes()) {
          mesh.isPickable = false; mesh.receiveShadows = true; meshes.push(mesh);
          this.shadows?.addShadowCaster(mesh);
        }
      }
    }
    this.meshes.set(id, meshes);
    this.actors.push({
      id, key: `planet-enemy-${id}`, kind, boss, motor, root, dying: 0, age: 0, windup: 0, pending: 0,
      cooldown: this.rng.range(0.6, 1.6),
      health: new Health(id, hp, this.events),
    });
    this.audio.enemy('spawn', kind, length(sub(position, this.world.playerPosition())));
    if (boss) {
      this.boss = this.actors[this.actors.length - 1];
      this.events.emit('BossSpawned', {entityId: id, definitionId: kind});
    }
  }

  /**
   * Passo fixo dos atores, com orçamento de TEMPO.
   *
   * Cada `PlanetMotor` varre uma BVH de 1,5 M de triângulos, e o custo depende da densidade local:
   * medido no asset real, entre ~85 µs (convés limpo) e ~960 µs (dentro de um aglomerado de props)
   * por ator por passo. Um orçamento por CONTAGEM, portanto, não limita nada — 8 atores no pior
   * caso davam 7,7 ms, quase metade de um quadro de 60 Hz.
   *
   * Aqui o laço roda em rodízio até gastar `budgetMs`. Quem não anda neste passo **acumula o `dt`**
   * e gasta tudo de uma vez quando chegar a sua vez, então a velocidade de deslocamento não muda —
   * só a frequência de atualização cai. O acúmulo é limitado por `maxCatchUpSeconds` para o passo
   * grande não degradar a resolução de degrau e rampa.
   *
   * O ataque (aviso, golpe, recarga) roda para TODOS os atores em todo passo: é barato e é o que
   * o jogador sente. Só o motor entra no rodízio.
   */
  fixedUpdate(dt: number, budgetMs = ENEMY_TUNING.motorBudgetMs): void {
    const player = this.world.playerPosition();
    for (let i = this.actors.length - 1; i >= 0; i--) {
      const actor = this.actors[i]!;
      actor.age += dt;
      if (actor.health.dead) {
        actor.dying -= dt;
        if (actor.dying <= 0) this.remove(i);
        continue;
      }
      if (length(sub(player, actor.motor.position)) > ENEMY_TUNING.retireMetres) {this.remove(i); continue;}
      actor.pending += dt;
    }
    const living = this.actors.filter(actor => !actor.health.dead);
    if (living.length === 0) return;
    const deadline = performance.now() + Math.max(0.2, budgetMs);
    for (let visited = 0; visited < living.length; visited++) {
      const actor = living[(this.cursor + visited) % living.length]!;
      if (actor.pending <= 0) continue;
      const step = Math.min(actor.pending, ENEMY_TUNING.maxCatchUpSeconds);
      actor.pending -= step;
      this.advance(actor, step, player);
      if (performance.now() >= deadline) {this.cursor = (this.cursor + visited + 1) % living.length; return;}
    }
    this.cursor = 0;
    // Todos andaram: ninguém fica com dívida acumulada para o próximo passo.
    for (const actor of living) actor.pending = 0;
  }
  private cursor = 0;

  /**
   * Um passo de um ator: para onde ir, e depois o motor.
   *
   * O rumo vem do `PlanetActorRouting`: rota do grafo quando existe uma válida, perseguição local
   * quando não existe. Em nenhum dos dois casos o ator anda sozinho — quem move é o `PlanetMotor`,
   * que continua sendo o único dono do apoio, do degrau e do vazio. Por isso uma rota errada
   * nunca atravessa lacuna: ela só sugere direção, e a cápsula é quem responde pelo chão.
   *
   * Dentro do alcance de combate o rumo volta a ser o jogador, para o bicho ENCARAR quem ataca em
   * vez de olhar para o próximo nó do caminho.
   */
  private advance(actor: PlanetActor, dt: number, player: Vec3): void {
    const spec = ENEMIES[actor.kind];
    const up = actor.motor.up;
    const planar = length(reject(sub(player, actor.motor.position), up));
    const steer = this.routing.steer({
      key: actor.key, position: actor.motor.position, up,
      forward: actor.motor.forward, recoveries: actor.motor.recoveries,
    }, player, dt);
    const inRange = planar <= spec.range * 0.8;
    const facing = inRange
      ? normalize(reject(sub(player, actor.motor.position), up), actor.motor.forward)
      : steer.heading;
    const approach = inRange || actor.windup > 0 || steer.arrived ? 0 : 1;
    actor.motor.fixedUpdate(dt, {x: 0, z: approach, jump: false, sprint: false}, facing);
    this.updateAttack(dt, actor, spec, planar);
  }

  /** Aviso, golpe e recarga. O golpe só sai com linha de visão real contra a malha. */
  private updateAttack(dt: number, actor: PlanetActor, spec: typeof ENEMIES[EnemyKind], planar: number): void {
    if (!this.world.playerAlive()) {actor.windup = 0; return;}
    const ranged = spec.range > 11;
    const reach = ranged ? spec.range : spec.range * 0.45 + spec.radius + 1.2;
    if (actor.windup > 0) {
      actor.windup -= dt;
      if (actor.windup > 0) return;
      this.strike(actor, spec, ranged, reach);
      actor.cooldown = ranged ? 2.4 : 1.6;
      return;
    }
    actor.cooldown = Math.max(0, actor.cooldown - dt);
    if (actor.cooldown > 0 || planar > reach) return;
    const eye = this.actorEye(actor);
    if (!lineOfSight(this.world.collision, eye, this.playerChest())) return;
    actor.windup = actor.boss ? 1.4 : ranged ? 1.05 : 0.9;
    this.audio.enemy('windup', actor.kind, planar);
  }

  private strike(actor: PlanetActor, spec: typeof ENEMIES[EnemyKind], ranged: boolean, reach: number): void {
    const eye = this.actorEye(actor);
    const chest = this.playerChest();
    const gap = length(sub(chest, eye));
    this.audio.enemy('attack', actor.kind, gap);
    // Nenhum caminho aplica dano sem confirmar a linha até o peito do jogador AGORA — o aviso
    // termina, mas se o jogador se escondeu no meio do tempo o golpe sai e não acerta.
    if (gap > reach + 1.5 || !lineOfSight(this.world.collision, eye, chest)) {
      if (ranged) this.effects.tracer(new Vector3(eye.x, eye.y, eye.z), new Vector3(chest.x, chest.y, chest.z));
      return;
    }
    const damage = actor.boss ? 35 : ranged ? 16 : 22;
    if (ranged) this.effects.tracer(new Vector3(eye.x, eye.y, eye.z), new Vector3(chest.x, chest.y, chest.z));
    this.sink.hurt(damage, `${actor.kind}_${ranged ? 'shot' : 'strike'}`, actor.motor.position);
    void spec;
  }

  private actorEye(actor: PlanetActor): Vec3 {
    const spec = ENEMIES[actor.kind];
    return add(actor.motor.position, scale(actor.motor.up, Math.max(0.8, spec.radius * 1.4)));
  }

  private playerChest(): Vec3 {
    const player = this.world.playerPosition();
    return add(player, scale(this.world.frame.up(player), 1.25));
  }

  /**
   * Apresentação: a raiz de cada ator recebe a base radial do próprio motor.
   *
   * É aqui que "raiz rotacionada pela vertical" acontece. Sem isto a fruta ficaria deitada em
   * qualquer ilha fora do polo norte. O balanço é um deslocamento da RAIZ com a velocidade real
   * do motor — não existe pose de osso procedural (estes modelos nem têm esqueleto).
   */
  render(dt: number): void {
    for (const actor of this.actors) {
      const up = actor.motor.up;
      const forward = normalize(reject(actor.motor.forward, up), {x: 0, y: 0, z: 1});
      const q = quaternionFromBasis(cross(up, forward), up, forward);
      actor.root.rotationQuaternion!.set(q.x, q.y, q.z, q.w);
      const speed = actor.motor.tangentialSpeed;
      const bob = actor.health.dead ? 0 : Math.abs(Math.sin(actor.age * Math.max(2, speed * 1.6))) * Math.min(0.22, speed * 0.05);
      const sink = actor.health.dead ? (1 - Math.max(0, actor.dying) / ENEMY_TUNING.deathSeconds) : 0;
      const lift = bob - sink * 1.4;
      const p = add(actor.motor.position, scale(up, lift));
      actor.root.position.set(p.x, p.y, p.z);
      const spec = ENEMIES[actor.kind];
      const wanted = spec.scale * (actor.boss ? 1.8 : 1) * (actor.health.dead ? Math.max(0.05, 1 - sink) : 1 + (actor.windup > 0 ? 0.08 * Math.sin(actor.age * 26) : 0));
      actor.root.scaling.setAll(wanted);
    }
    this.effects.update(dt);
  }

  private remove(index: number): void {
    const actor = this.actors[index];
    if (!actor) return;
    // Morte e aposentadoria invalidam a rota na hora: um slot vivo de quem já não existe seguraria
    // a identidade no serviço e gastaria despacho de consulta por nada.
    this.routing.forget(actor.key);
    if (this.boss?.id === actor.id) this.boss = undefined;
    for (const mesh of this.meshes.get(actor.id) ?? []) mesh.dispose();
    this.meshes.delete(actor.id);
    actor.root.dispose();
    this.actors.splice(index, 1);
  }

  /** Limpa o campo — troca de estágio, morte, recomeço. */
  clear(): void {
    for (let i = this.actors.length - 1; i >= 0; i--) this.remove(i);
    this.boss = undefined;
    this.routing.clear();
    this.effects.clear();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clear();
    this.effects.dispose();
    for (const container of this.containers.values()) container.dispose();
    this.containers.clear();
  }
}

/** Ângulo entre a frente do ator e a direção do jogador — diagnóstico e testes. */
export function facingError(actor: {motor: {up: Vec3; forward: Vec3; position: Vec3}}, player: Vec3): number {
  const tangent = reject(sub(player, actor.motor.position), actor.motor.up);
  if (length(tangent) < 1e-6) return 0;
  return Math.acos(Math.max(-1, Math.min(1, dot(normalize(tangent), normalize(actor.motor.forward)))));
}
