import {reloadMovement} from '../src/player/ReloadMovement';
import {rootwoodChestColliders} from '../src/world/ExplorationSites';
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
import { RunProgression } from '../src/run/RunProgression';
import { IslandFerry } from '../src/world/IslandFerry';
import { worldTerrain, sculptRegion, type OutcropShape } from '../src/world/terrain/WorldTerrain';
import {applyInitialRockFix,type InitialRockFix} from '../src/world/terrain/InitialRocks';
import { EMPTY_INPUT, type InputFrame } from '../src/input/InputFrame';
export { EMPTY_INPUT };

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

/** Entrada de um jogador tal como chega pela rede; `seq` permite reconciliar a predição local. */
export interface NetInput { frame: InputFrame; yaw: number; pitch: number; seq: number }

export interface PlayerSnapshot {
  id: string; x: number; y: number; z: number; yaw: number; pitch: number; seq: number;
  hp: number; maxHP: number; grounded: boolean; sprinting: boolean; dodgeRemaining: number; charges: number; invulnerable: number;
  ammo: number; reloading: boolean; mpSeconds: number; mpTier: MPTier; skillTier: SkillTier; skillElapsed: number; skillActive: boolean;
}

export interface Snapshot {
  seed: string; tick: number; time: number; stage: number; ferryTime: number;
  credits: number; xp: number; level: number; totalKills: number; inventory: Record<string, number>;
  players: PlayerSnapshot[];
}

interface Player {
  id: string; motor: PlayerMotor; mp: MPCharge; cadence: PistolCadence; magazine: PistolMagazine; skill: SkillTimeline;
  input: InputFrame; yaw: number; pitch: number; seq: number; shots: number;
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
  /** Eventos cosméticos de um frame acumulados desde o último `drain()`; a sala reencaminha como mensagens. */
  private readonly outbox: { type: keyof GameEvents; payload: unknown }[] = [];
  time = 0;

  constructor(readonly seed: string, data: CollisionData) {
    this.rng = new RunRNG(seed);
    const merged = mergeCollision(data.mesh, data.solid, data.city, data.regions, data.boxes, data.outcrops, data.initialRocks);
    this.collision.boxes.push(...data.boxes, ...merged.mesh.boxes);
    if(data.city)this.collision.movingBoxes.push(...cityChestColliders());
    if(data.regions?.length)this.collision.movingBoxes.push(...frontierChestColliders());
    if(data.regions?.some(r=>r.id==='rootwood'))this.collision.movingBoxes.push(...rootwoodChestColliders());
    if(data.regions?.some(r=>r.id==='highland-farms'))this.collision.movingBoxes.push(...highlandChestColliders());
    this.collision.surfaces.push(...data.surfaces, ...merged.surfaces);
    this.collision.setGeometry(merged.mesh.positions, merged.mesh.indices);
    this.collision.setRecoveryVolumes(merged.solid.positions, merged.solid.indices);
    this.ferry = new IslandFerry(this.collision);
    this.loop = new FixedLoop(dt => this.step(dt), () => {});
    for (const type of ['DamageDealt', 'EnemyKilled', 'Dodged', 'SkillUsed', 'MPCharged', 'MPReleased', 'LevelUp', 'BossSpawned', 'ItemPicked', 'PlayerKilled'] as const)
      this.events.on(type, payload => this.outbox.push({ type, payload }));
  }

  /** Índice de raios da colisão por malha. Em Node cai no caminho síncrono (sem `Worker`); chamar antes do primeiro passo. */
  async prepare(): Promise<void> { await this.collision.prepareRaycastsAsync(); }

  addPlayer(id: string): PlayerSnapshot {
    if (this.players.has(id)) throw new Error(`Jogador duplicado ${id}`);
    const spawn = this.spawnPoint();
    const player: Player = {
      id, motor: new PlayerMotor(this.collision, this.events, spawn), mp: new MPCharge(this.events), cadence: new PistolCadence(),
      magazine: new PistolMagazine(), skill: new SkillTimeline(), input: EMPTY_INPUT, yaw: -.13, pitch: .02, seq: 0, shots: 0,
    };
    player.motor.yaw = player.yaw;
    this.players.set(id, player);
    return this.snapshotPlayer(player);
  }

  removePlayer(id: string): void { this.players.delete(id); }

  applyInput(id: string, input: NetInput): void {
    const player = this.players.get(id);
    if (!player || input.seq <= player.seq) return; // descarta pacotes fora de ordem
    player.input = input.frame; player.yaw = input.yaw;
    player.pitch = Math.max(-1.1, Math.min(1.1, input.pitch)); player.seq = input.seq;
  }

  /** Avança o relógio real; o `FixedLoop` converte em passos de 1/60 s. */
  frame(nowSeconds: number): void { this.loop.frame(nowSeconds); }

  /** Um passo fixo. Exposto para testes determinísticos. */
  step(dt: number): void {
    const stats = this.progression.stats;
    const first = [...this.players.values()][0];
    if (first) { this.ferry.update(dt, first.motor); this.carryOtherRiders(first); }
    for (const player of this.players.values()) {
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
      if (player.skill.active) player.skill.update(player.skill.elapsed + dt, tier => this.events.emit('SkillUsed', { entityId: this.entityId(player), skillId: tier === 1 ? 'ricochet_fan' : tier === 2 ? 'backflip_barrage' : 'harvest_storm' }));
      const firing = input.fire && !input.charging && m.dodgeRemaining === 0 && m.hp > 0 && !player.skill.active;
      player.cadence.update(dt, firing, () => { if (player.magazine.consume()) player.shots++; });
      // Entradas de borda (jump/dodge/reload/interact) valem por um passo; movimento contínuo permanece até o próximo pacote.
      player.input = { ...input, jump: false, dodge: false, reload: false };
      delete player.input.interact;
    }
    this.time += dt; this.progression.time = this.time;
  }

  snapshot(): Snapshot {
    return {
      seed: this.seed, tick: this.loop.tick, time: this.time, stage: this.progression.stage, ferryTime: this.ferry.time,
      credits: this.progression.credits, xp: this.progression.xp, level: this.progression.level, totalKills: this.progression.totalKills,
      inventory: Object.fromEntries(this.progression.inventory), players: [...this.players.values()].map(p => this.snapshotPlayer(p)),
    };
  }

  /** Esvazia a caixa de saída de eventos cosméticos. */
  drain(): { type: keyof GameEvents; payload: unknown }[] { return this.outbox.splice(0); }

  private snapshotPlayer(p: Player): PlayerSnapshot {
    const m = p.motor;
    return {
      id: p.id, x: m.position.x, y: m.position.y, z: m.position.z, yaw: p.yaw, pitch: p.pitch, seq: p.seq,
      hp: m.hp, maxHP: m.maxHP, grounded: m.grounded, sprinting: m.sprinting, dodgeRemaining: m.dodgeRemaining, charges: m.charges, invulnerable: m.invulnerable,
      ammo: p.magazine.ammo, reloading: p.magazine.reloading, mpSeconds: p.mp.seconds, mpTier: p.mp.tier,
      skillTier: p.skill.tier, skillElapsed: p.skill.elapsed, skillActive: p.skill.active,
    };
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

  /** IDs numéricos estáveis por sessão para o `DamageContext`, que ainda espera números. */
  private entityId(player: Player): number { return 1 + [...this.players.keys()].indexOf(player.id); }
}
