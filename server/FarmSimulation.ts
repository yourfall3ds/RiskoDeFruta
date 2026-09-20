import {reloadMovement} from '../src/player/ReloadMovement';
import {rootwoodChestColliders,barnChestColliders} from '../src/world/ExplorationSites';
import {cityChestColliders,frontierChestColliders,highlandChestColliders} from '../src/world/ExplorationSites';
import { EventBus } from '../src/core/EventBus';
import { FixedLoop } from '../src/core/FixedLoop';
import { RunRNG } from '../src/core/RunRNG';
import type { GameEvents, Vec3 } from '../src/core/contracts';
import { CollisionWorld, type BoxCollider, type GroundSurface } from '../src/physics/CollisionWorld';
import { PlayerMotor } from '../src/player/PlayerMotor';
import { MPCharge, type MPTier } from '../src/combat/MPCharge';
import { PistolCadence } from '../src/combat/PistolCadence';
import { PistolMagazine } from '../src/combat/PistolMagazine';
import { SkillTimeline, type SkillTier } from '../src/combat/SkillTimeline';
import { WEAK_POINT_TAG, weakPointDamageMultiplier } from '../src/combat/WeakPoints';
import { PISTOL_TUNING } from '../src/player/PlayerTuning';
import { RunProgression } from '../src/run/RunProgression';
import { PlayerLoadout } from '../src/run/PlayerLoadout';
import { ItemProcs } from '../src/items/ItemProcs';
import { IslandFerry } from '../src/world/IslandFerry';
import { worldTerrain, sculptRegion, type OutcropShape } from '../src/world/terrain/WorldTerrain';
import {applyInitialRockFix,type InitialRockFix} from '../src/world/terrain/InitialRocks';
import { EMPTY_INPUT, type InputFrame } from '../src/input/InputFrame';
import { EnemySimulation, type EnemyRow, type SimulatedPlayer } from './EnemySimulation';
export { EMPTY_INPUT };
export type { EnemyRow };

/** Geometria de colisão já lida do disco: os mesmos JSONs que `FarmWorld.load` busca por fetch. */
export interface CollisionData {
  boxes: BoxCollider[]; surfaces: GroundSurface[];
  mesh: { positions: number[]; indices: number[]; boxes: BoxCollider[] };
  /** Volumes fechados sob as ilhas (`solid-island-collision.json`); viram recuperação de sobreposição. */
  solid: { positions: number[]; indices: number[]; boxes: BoxCollider[] };
  /** Cidade agrícola (`farm-city-collision.json`), opcional: superfícies, malha, caixas e volumes sólidos próprios. */
  regions?: NonNullable<CollisionData['city']>[];
  // `walkableLinks` é parte do contrato aqui porque as exclusões de relevo saem das pontes: sem ele
  // o servidor esculpiria um terreno diferente do cliente e empurraria o jogador na cabeceira.
  city?: { id?:string; positions: number[]; indices: number[]; boxes: BoxCollider[]; surfaces: GroundSurface[]; solidPositions: number[]; solidIndices: number[]; walkableLinks?: { a: Vec3; b: Vec3; width: number }[] };
  /** Rocha escaneada dos afloramentos (`outcrop-rocks.json`); sem ela a região fica só com o relevo. */
  outcrops?: OutcropShape;
  initialRocks?: InitialRockFix;
}

/** Anexa (positions, indices) a um bloco de triângulos, deslocando os índices como `FarmWorld.load`. */
function appendTriangles(target: { positions: number[]; indices: number[] }, positions: readonly number[], indices: readonly number[]): void {
  const offset = target.positions.length / 3;
  for (const coordinate of positions) target.positions.push(coordinate);
  for (const index of indices) target.indices.push(index + offset);
}

/**
 * Funde cenário + volumes sólidos (+ cidade, se houver) na mesma ordem e com os mesmos deslocamentos de
 * `FarmWorld.load`, para o servidor colidir exatamente com o que o cliente vê.
 *
 * O relevo esculpido entra aqui pelo mesmo `worldTerrain` que o cliente usa: mesmos dados de entrada,
 * mesmos triângulos de saída. Sem isso o servidor autoritativo empurraria o jogador de volta para o
 * piso plano antigo a cada correção.
 */
export function mergeCollision(mesh: CollisionData['mesh'], solid: CollisionData['solid'], city?: CollisionData['city'], regions:NonNullable<CollisionData['city']>[]=[], authoredBoxes: readonly BoxCollider[] = [], outcrops?: OutcropShape, initialRocks?:InitialRockFix): { mesh: CollisionData['mesh']; solid: CollisionData['solid']; surfaces: GroundSurface[] } {
  const merged = { positions: [...mesh.positions], indices: [...mesh.indices], boxes: [...mesh.boxes, ...solid.boxes] };
  applyInitialRockFix(merged,initialRocks,outcrops);
  appendTriangles(merged, solid.positions, solid.indices);
  const volumes = { positions: [...solid.positions], indices: [...solid.indices], boxes: solid.boxes };
  const surfaces: GroundSurface[] = [];
  for(const region of [...(city?[city]:[]),...regions]) {
    // A região é esculpida na SUA cópia antes de entrar na malha comum, exatamente como o cliente
    // faz no carregador de região: pedra aposentada sai, afloramento e relevo entram.
    const sculpted = { positions: region.positions, indices: region.indices, boxes: region.boxes, walkableLinks: region.walkableLinks ?? [] };
    if (region.id) sculptRegion(region.id, sculpted, outcrops);
    appendTriangles(merged, sculpted.positions, sculpted.indices); merged.boxes.push(...region.boxes);
    appendTriangles(volumes, region.solidPositions, region.solidIndices); surfaces.push(...region.surfaces);
  }
  // As mesmas caixas que o cliente tem em mãos ao montar o campo: autoradas + cenário + volumes sólidos.
  const base = worldTerrain('base', { boxes: [...authoredBoxes, ...mesh.boxes, ...solid.boxes] });
  if (base) { const geometry = base.collisionGeometry(); appendTriangles(merged, geometry.positions, geometry.indices); }
  return { mesh: merged, solid: volumes, surfaces };
}

/**
 * Entrada de um jogador já decodificada pela sala; `seq` permite reconciliar a predição local.
 * Nome distinto do schema de rede `NetInput` (`src/net/NetInput.ts`), que é a forma serializada.
 */
export interface PlayerCommand { frame: InputFrame; yaw: number; pitch: number; seq: number }

/**
 * Altura do peito do atirador, em metros. É de onde o cliente já traça a linha de mira
 * (`DualPistols`: `body() + up × 1,3`); atirar do pé faria a bala raspar o chão a cada aclive.
 */
const SHOOTER_HEIGHT = 1.3;

export interface PlayerSnapshot {
  id: string; entityId: number; x: number; y: number; z: number; yaw: number; pitch: number; seq: number;
  hp: number; maxHP: number; grounded: boolean; sprinting: boolean; dodgeRemaining: number; charges: number; invulnerable: number;
  ammo: number; reloading: boolean; mpSeconds: number; mpTier: MPTier; skillTier: SkillTier; skillActive: boolean; skillElapsed: number;
  /** Pilhas deste jogador; o inventário deixou de ser da sala (decisão de produto: loadout por jogador). */
  inventory: Record<string, number>;
}

export interface Snapshot {
  seed: string; tick: number; time: number; stage: number; ferryTime: number;
  credits: number; xp: number; level: number; totalKills: number;
  players: PlayerSnapshot[];
  /** A horda autoritativa. Antes o schema declarava `EnemyState` e NADA a preenchia (armadilha 8.6). */
  enemies: EnemyRow[];
  kills: number;
}

export interface Player {
  id: string; entityId: number; motor: PlayerMotor; mp: MPCharge; cadence: PistolCadence; magazine: PistolMagazine; skill: SkillTimeline;
  loadout: PlayerLoadout;
  /** Procs DESTE jogador: eles leem o inventário dele, não um `RunProgression` da sala. */
  procs: ItemProcs;
  input: InputFrame; yaw: number; pitch: number; seq: number; shots: number;
  /** Tiros DESTE jogador que encostaram num corpo. Diagnóstico; nenhuma regra lê este número. */
  hits: number;
}

/**
 * Simulação autoritativa da fazenda, sem Babylon nem Colyseus.
 * Reutiliza os sistemas puros do cliente; a sala apenas injeta entrada, avança o tempo e copia o snapshot para o schema.
 */
export class FarmSimulation {
  readonly events = new EventBus<GameEvents>();
  readonly rng: RunRNG;
  readonly collision = new CollisionWorld();
  readonly progression = new RunProgression(this.events);
  readonly ferry: IslandFerry;
  readonly loop: FixedLoop;
  readonly players = new Map<string, Player>();
  /**
   * A horda. Ela é DAQUI, não do cliente: enquanto cada `EnemySwarm` decidia spawn e IA, cada
   * cliente lutava contra uma horda privada e dois jogadores nunca matavam o mesmo inimigo.
   */
  readonly enemies: EnemySimulation;
  /** Eventos cosméticos de um frame acumulados desde o último `drain()`; a sala reencaminha como mensagens. */
  private readonly outbox: { type: keyof GameEvents; payload: unknown }[] = [];
  time = 0;

  constructor(readonly seed: string, data: CollisionData) {
    this.rng = new RunRNG(seed);
    const merged = mergeCollision(data.mesh, data.solid, data.city, data.regions, data.boxes, data.outcrops, data.initialRocks);
    this.collision.boxes.push(...data.boxes, ...merged.mesh.boxes);
    this.collision.movingBoxes.push(...barnChestColliders());
    if(data.city)this.collision.movingBoxes.push(...cityChestColliders());
    if(data.regions?.length)this.collision.movingBoxes.push(...frontierChestColliders());
    if(data.regions?.some(r=>r.id==='rootwood'))this.collision.movingBoxes.push(...rootwoodChestColliders());
    if(data.regions?.some(r=>r.id==='highland-farms'))this.collision.movingBoxes.push(...highlandChestColliders());
    this.collision.surfaces.push(...data.surfaces, ...merged.surfaces);
    this.collision.setGeometry(merged.mesh.positions, merged.mesh.indices);
    this.collision.setRecoveryVolumes(merged.solid.positions, merged.solid.indices);
    this.ferry = new IslandFerry(this.collision);
    this.enemies = new EnemySimulation({
      collision: this.collision, events: this.events, rng: this.rng, progression: this.progression,
      // Uma FUNÇÃO e não uma lista: a corrida ganha e perde jogadores, e a IA tem de enxergar
      // exatamente quem está vivo NESTE passo (contrato §9 e §18.6).
      players: () => this.livingPlayerViews(),
    });
    this.loop = new FixedLoop(dt => this.step(dt), () => {});
    // `EnemyHit` entra na lista com o bloco E: o número de dano é feedback EFÊMERO (§18.10) e o
    // companheiro precisa vê-lo — sem ele, só quem atirou teria retorno do acerto, e cada tela
    // voltaria a inventar o próprio dano a partir da vida replicada.
    for (const type of ['DamageDealt', 'EnemyHit', 'EnemyKilled', 'Dodged', 'SkillUsed', 'MPCharged', 'MPReleased', 'LevelUp', 'BossSpawned', 'ItemPicked', 'PlayerKilled'] as const)
      this.events.on(type, payload => this.outbox.push({ type, payload }));
  }

  /** Índice de raios da colisão por malha. Em Node cai no caminho síncrono (sem `Worker`); chamar antes do primeiro passo. */
  async prepare(): Promise<void> { await this.collision.prepareRaycastsAsync(); }

  addPlayer(id: string): PlayerSnapshot {
    if (this.players.has(id)) throw new Error(`Jogador duplicado ${id}`);
    const spawn = this.spawnPoint();
    const loadout = new PlayerLoadout(this.progression.level);
    const player: Player = {
      id, entityId: this.freeEntityId(), motor: new PlayerMotor(this.collision, this.events, spawn), mp: new MPCharge(this.events), cadence: new PistolCadence(),
      magazine: new PistolMagazine(), skill: new SkillTimeline(), loadout,
      // Domínio `combatProc`, nunca `loot` nem `director`: um proc a mais não pode mexer em qual
      // elite nasce nem em qual item cai (adendo §1).
      procs: new ItemProcs(loadout, this.rng.stream('combatProc')),
      input: EMPTY_INPUT, yaw: -.13, pitch: .02, seq: 0, shots: 0, hits: 0,
    };
    player.motor.yaw = player.yaw;
    // Sem isto o motor recusaria todo dano cujo `victimId` não fosse 1 — jogadores 2..4 imortais.
    player.motor.entityId = player.entityId;
    this.players.set(id, player);
    return this.snapshotPlayer(player);
  }

  removePlayer(id: string): void { this.players.delete(id); }

  applyInput(id: string, input: PlayerCommand): void {
    const player = this.players.get(id);
    if (!player || input.seq <= player.seq) return; // descarta pacotes fora de ordem
    player.input = input.frame; player.yaw = input.yaw;
    player.pitch = Math.max(-1.1, Math.min(1.1, input.pitch)); player.seq = input.seq;
  }

  /** Avança o relógio real; o `FixedLoop` converte em passos de 1/60 s. */
  frame(nowSeconds: number): void { this.loop.frame(nowSeconds); }

  /** Um passo fixo. Exposto para testes determinísticos. */
  step(dt: number): void {
    const first = [...this.players.values()][0];
    if (first) { this.ferry.update(dt, first.motor); this.carryOtherRiders(first); }
    for (const player of this.players.values()) {
      // Nível é da SALA, itens são do jogador: os atributos saem do loadout dele, nunca de um
      // `stats` único — senão o item que um pegou buffaria os quatro.
      player.loadout.refresh(this.progression.level);
      const stats = player.loadout.stats;
      const m = player.motor;
      m.maxHP = stats.maxHP; m.moveMultiplier = stats.moveSpeed; m.jumpMultiplier = stats.jump; m.extraJumps = stats.extraJumps; m.rechargeMultiplier = stats.dodgeRecharge;
      m.armor = stats.armor; m.regeneration = stats.regeneration; player.cadence.rateMultiplier = stats.attackSpeed; player.mp.speedMultiplier = 1 + (stats.mp - 1) * .5;
      // Sem estes dois, o cliente corria mais rápido que o servidor e sofria snap-back contínuo.
      m.sprintMultiplier = stats.sprintSpeed; player.mp.setMaxCharges(stats.skillCharges);
      const input = player.input;
      if (input.reload) player.magazine.request();
      player.magazine.update(dt);
      m.fixedUpdate(dt, reloadMovement(input,player.magazine.reloading), player.yaw);
      const released = m.hp > 0 ? player.mp.update(dt, input.charging && !player.magazine.reloading && !player.skill.active) : 0;
      if (released) player.skill.start(released);
      // Timeline da skill é do servidor, com as durações fixas de SKILL_CUES; a voz e a cinemática ficam no cliente.
      if (player.skill.active) player.skill.update(player.skill.elapsed + dt, tier => this.events.emit('SkillUsed', { entityId: player.entityId, skillId: tier === 1 ? 'ricochet_fan' : tier === 2 ? 'backflip_barrage' : 'harvest_storm' }));
      const firing = input.fire && !input.charging && m.dodgeRemaining === 0 && m.hp > 0 && !player.skill.active;
      // Antes este callback só CONTAVA o tiro: a intenção de disparo do jogador não chegava a
      // `EnemySimulation.applyDamage` por caminho nenhum, e a horda só podia ser ferida pelos
      // efeitos de área do próprio servidor. É aqui que o bloco E fecha o circuito.
      player.cadence.update(dt, firing, () => { if (player.magazine.consume()) { player.shots++; this.resolveShot(player); } });
      // Entradas de borda (jump/dodge/reload/interact) valem por um passo; movimento contínuo permanece até o próximo pacote.
      player.input = { ...input, jump: false, dodge: false, reload: false };
      delete player.input.interact;
    }
    // A horda anda DEPOIS dos jogadores, no mesmo passo fixo: ela persegue a posição deste tique,
    // não a do anterior. Mesma ordem que `PlayerScene.fixedUpdate` usa no cliente.
    this.enemies.step(dt);
    this.time += dt; this.progression.time = this.time;
  }

  /**
   * O TIRO DO JOGADOR, RESOLVIDO NO SERVIDOR (contrato §6).
   *
   * O cliente manda `fire` + yaw/pitch e nada mais. Quem decide se acertou, em quem, quanto doeu e
   * se foi crítico é este método — e o `EnemySwarm` do cliente recusa o mesmo acerto por autoridade
   * (§18.8), para a barra de vida não descer duas vezes na tela de quem atirou.
   *
   * A direção é DERIVADA de yaw/pitch em vez de viajar como vetor próprio: é exatamente a conta que
   * `ThirdPersonCamera.forward` faz, então o vetor seria a mesma informação num campo a mais — e um
   * vetor pronto vindo do cliente não acrescentaria autoridade nenhuma, só superfície para mentir.
   *
   * O DANO É DO ATIRADOR: `loadout.stats` é dele, não da sala. Ler um `stats` compartilhado aqui
   * devolveria os quatro jogadores mecanicamente idênticos, que é a armadilha 8.1/§2.6 do plano.
   */
  private resolveShot(player: Player): void {
    const m = player.motor, stats = player.loadout.stats;
    const yaw = player.yaw, pitch = player.pitch;
    const direction = { x: Math.sin(yaw) * Math.cos(pitch), y: -Math.sin(pitch), z: Math.cos(yaw) * Math.cos(pitch) };
    const origin = { x: m.position.x, y: m.position.y + SHOOTER_HEIGHT, z: m.position.z };
    const hit = this.enemies.hitscan(origin, direction, PISTOL_TUNING.range);
    if (!hit) return;
    player.hits++;
    /**
     * O DADO DO CRÍTICO É DO SERVIDOR.
     *
     * Seed igual não bastaria (contrato §6): cada cliente consome os streams um número diferente de
     * vezes — um atira mais, outro vê menos corpos — e as sequências divergem permanentemente. O
     * stream `combat` existe só para isto e não é compartilhado com o diretor nem com o nascimento,
     * senão um tiro a mais de um jogador mudaria qual inimigo nasce para todos.
     */
    const crit = this.rng.stream('combatCrit').next() < stats.crit;
    const baseDamage = PISTOL_TUNING.damage;
    // Mesma regra do cliente, no mesmo lugar: ponto fraco não empilha com crítico de sorte. Sem rig
    // no servidor não há zona a testar, então o argumento é `false` — ver `EnemySimulation.hitscan`.
    const finalDamage = baseDamage * stats.damage * weakPointDamageMultiplier(false, crit);
    /**
     * IDENTIDADE DO EVENTO (adendo §2).
     *
     * Atirador + sequência de entrada + número do tiro identificam este disparo para sempre. É o que
     * permite a `EnemySimulation` recusar o MESMO evento chegando duas vezes — por retransmissão,
     * por reaplicação de entrada ou por um proc que se derivou dele — sem depender de um booleano
     * no fim do fluxo.
     */
    const combatEventId = `${player.entityId}:${player.seq}:${player.shots}`;
    const context = {
      attackerId: player.entityId, victimId: hit.id, sourceId: 'dual_pistols', attackId: 'dual_pistols',
      baseDamage, finalDamage, crit, procCoefficient: 1, procChainDepth: 0, damageTags: [WEAK_POINT_TAG],
      hitPosition: hit.point, hitNormal: { x: -direction.x, y: -direction.y, z: -direction.z },
      forceDirection: direction, forceMagnitude: 2, hitDirection: direction, combatEventId,
    };
    if (!this.enemies.applyDamage(hit.id, context)) return;
    // Proc é CONSEQUÊNCIA do acerto autoritativo, e a consequência também mora no servidor: o
    // cliente representa o fogo e a explosão, nunca decide que eles saíram.
    player.procs.onHit(context, {
      burn: seconds => this.enemies.ignite(hit.id, seconds),
      blast: radius => this.enemies.blast(hit.id, radius, finalDamage * .5, context),
    });
    if (this.enemies.actor(hit.id)?.health.dead) {
      // Pela porta do motor, nunca escrevendo `hp` de fora: vida tem um dono só.
      player.motor.heal(player.procs.onKill());
    }
  }

  /**
   * Os jogadores como a IA os enxerga — `getLivingPlayers()` do contrato §9.
   *
   * Devolve TODOS (a política de alvo precisa distinguir "morreu" de "saiu da corrida"), com
   * `alive`/`eligible` dizendo quem é alvo legítimo. Morto não é alvo normal da IA (§18.5) mas
   * continua pertencendo à corrida.
   */
  private livingPlayerViews(): SimulatedPlayer[] {
    return [...this.players.values()].map(player => ({
      entityId: player.entityId,
      position: player.motor.position,
      alive: player.motor.hp > 0,
      eligible: true,
      get hp() { return player.motor.hp; },
      applyDamage: (context) => player.motor.applyDamage(context),
      push: (x, y, z) => { player.motor.velocity.x += x; player.motor.velocity.y += y; player.motor.velocity.z += z; },
    }));
  }

  snapshot(): Snapshot {
    return {
      seed: this.seed, tick: this.loop.tick, time: this.time, stage: this.progression.stage, ferryTime: this.ferry.time,
      credits: this.progression.credits, xp: this.progression.xp, level: this.progression.level, totalKills: this.progression.totalKills,
      players: [...this.players.values()].map(p => this.snapshotPlayer(p)),
      enemies: this.enemies.rows(), kills: this.enemies.kills,
    };
  }

  /** Esvazia a caixa de saída de eventos cosméticos. */
  drain(): { type: keyof GameEvents; payload: unknown }[] { return this.outbox.splice(0); }

  private snapshotPlayer(p: Player): PlayerSnapshot {
    const m = p.motor;
    return {
      id: p.id, entityId: p.entityId, x: m.position.x, y: m.position.y, z: m.position.z, yaw: p.yaw, pitch: p.pitch, seq: p.seq,
      hp: m.hp, maxHP: m.maxHP, grounded: m.grounded, sprinting: m.sprinting, dodgeRemaining: m.dodgeRemaining, charges: m.charges, invulnerable: m.invulnerable,
      ammo: p.magazine.ammo, reloading: p.magazine.reloading, mpSeconds: p.mp.seconds, mpTier: p.mp.tier,
      skillTier: p.skill.tier, skillElapsed: p.skill.elapsed, skillActive: p.skill.active,
      inventory: Object.fromEntries(p.loadout.inventory),
    };
  }

  /**
   * Menor id livre em 1..4, atribuído na entrada e NUNCA recalculado.
   *
   * A versão anterior devolvia `1 + indexOf(id)` a cada chamada: quando o jogador 2 de 4 saía, os
   * jogadores 3 e 4 viravam 2 e 3 no meio da corrida — com contextos de dano carregando os ids
   * antigos ainda em trânsito. Reaproveitar o buraco mantém a faixa 1..4 sem renumerar ninguém.
   */
  private freeEntityId(): number {
    const taken = new Set([...this.players.values()].map(p => p.entityId));
    for (let id = 1; ; id++) if (!taken.has(id)) return id;
  }

  /** Mesmo sorteio de `PlayerScene`: faixa em frente ao celeiro, altura pela colisão. */
  private spawnPoint(): Vec3 {
    const stream = this.rng.stream('spawn');
    const x = stream.range(-2, 2), z = stream.range(-17, -10);
    const ground = this.collision.groundAt(x, z, 6);
    return { x, y: Number.isFinite(ground) ? ground : 0, z };
  }

  /** `IslandFerry.update` transporta um passageiro; os demais recebem o mesmo deslocamento com o mesmo teste de bordo. */
  private carryOtherRiders(first: Player): void {
    const f = this.ferry, dx = f.position.x - f.previous.x, dz = f.position.z - f.previous.z, dy = f.position.y - f.previous.y;
    if (!dx && !dz && !dy) return;
    for (const player of this.players.values()) {
      if (player === first) continue;
      const p = player.motor.position;
      const rider = player.motor.grounded && Math.abs(p.y - f.position.y) < .15 && ((p.x - f.position.x) / 3.4) ** 2 + ((p.z - f.position.z) / 3.4) ** 2 < .98;
      if (rider) { this.collision.move(p, dx, dz, .34, 1.7, .35); p.y += dy; }
    }
  }
}
