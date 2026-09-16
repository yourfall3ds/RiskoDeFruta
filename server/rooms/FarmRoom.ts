import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Room, type Client, type StepContext } from 'colyseus';
import { FarmSimulation, type CollisionData } from '../FarmSimulation';
import { FarmState, PlayerState } from '../schema';
import { NetInput, BUTTON, toFrame } from '../../src/net/NetInput';
export { NetInput, BUTTON, toFrame };

export interface FarmRoomOptions { seed?: string }
const MAX_PLAYERS = 4;
const TICK_HZ = 60;          // calibração do FixedLoop/PlayerMotor e dos 203 testes
const PATCH_HZ = 30;         // estado na rede a 30 Hz; o cliente interpola


/** Lê os mesmos JSONs que `FarmWorld.load` busca por fetch; o servidor não carrega GLB. */
export function loadCollision(root = process.cwd()): CollisionData {
  const path = (name: string) => join(root, 'public', 'models', name);
  const read = (name: string): unknown => JSON.parse(readFileSync(path(name), 'utf8'));
  const farm = read('farm-collision.json') as Pick<CollisionData, 'boxes' | 'surfaces'>;
  const data: CollisionData = { boxes: farm.boxes, surfaces: farm.surfaces, mesh: read('world-collision-mesh.json') as CollisionData['mesh'], solid: read('solid-island-collision.json') as CollisionData['solid'] };
  // Cidade agrícola: opcional, espelha FarmWorld.load quando o JSON existe.
  if (existsSync(path('farm-city-collision.json'))) data.city = read('farm-city-collision.json') as NonNullable<CollisionData['city']>;
  data.regions=['solar-frontier-collision.json','highland-farms-collision.json','rootwood-collision.json'].filter(name=>existsSync(path(name))).map(name=>({...read(name) as NonNullable<CollisionData['city']>,id:name.replace('-collision.json','')}));
  // Rocha dos afloramentos: o MESMO arquivo que o cliente busca por fetch, para a colisão do
  // servidor ter exatamente as pedras que o jogador vê.
  if (existsSync(path('outcrop-rocks.json'))) data.outcrops = read('outcrop-rocks.json') as NonNullable<CollisionData['outcrops']>;
  return data;
}


/**
 * Adaptador fino sobre o netcode do Colyseus 0.18: `defineInput` (buffer por cliente com seq),
 * `setFixedTimestep` (passo fixo) e `allowRewindState` (posições vistas pelo atirador, para o hitscan da Fase 3).
 * A simulação é `FarmSimulation`; aqui só entra rede, schema e reencaminhamento de eventos.
 */
export class FarmRoom extends Room<{ state: FarmState; input: NetInput }> {
  maxClients = MAX_PLAYERS;
  inputs = this.defineInput(NetInput, { seqField: 'seq' });
  private sim!: FarmSimulation;

  async onCreate(options: FarmRoomOptions): Promise<void> {
    const seed = options.seed?.trim() || `farm-${Date.now().toString(16)}`;
    this.sim = new FarmSimulation(seed, loadCollision());
    await this.sim.prepare();
    this.state = new FarmState();
    this.state.seed = seed;
    this.patchRate = 1000 / PATCH_HZ;
    const rewind = this.allowRewindState({ maxRewindMs: 500 });
    rewind.attachAll(this.state.players, { fields: ['x', 'y', 'z'] });
    this.setFixedTimestep(ctx => this.step(ctx), TICK_HZ);
  }

  onJoin(client: Client): void {
    const snapshot = this.sim.addPlayer(client.sessionId);
    const state = new PlayerState();
    state.id = client.sessionId;
    this.state.players.set(client.sessionId, state);
    client.send('welcome', { seed: this.sim.seed, tick: this.sim.loop.tick, spawn: { x: snapshot.x, y: snapshot.y, z: snapshot.z } });
  }

  onLeave(client: Client): void {
    this.sim.removePlayer(client.sessionId);
    this.state.players.delete(client.sessionId);
  }

  private step(ctx: StepContext): void {
    for (const client of this.clients) {
      const input = this.inputs.get(client.sessionId).next();   // UM input por cliente por passo
      if (input) this.sim.applyInput(client.sessionId, { frame: toFrame(input), yaw: input.yaw, pitch: input.pitch, seq: input.seq });
    }
    this.sim.step(ctx.dt);
    this.mirror();
    for (const event of this.sim.drain()) this.broadcast(event.type, event.payload);
  }

  private mirror(): void {
    const snap = this.sim.snapshot(), s = this.state;
    s.tick = snap.tick; s.time = snap.time; s.stage = snap.stage; s.ferryTime = snap.ferryTime;
    const p = s.progression;
    p.credits = snap.credits; p.xp = snap.xp; p.level = snap.level; p.totalKills = snap.totalKills;
    for (const [id, stacks] of Object.entries(snap.inventory)) if (p.inventory.get(id) !== stacks) p.inventory.set(id, stacks);
    for (const player of snap.players) {
      const t = s.players.get(player.id);
      if (!t) continue;
      t.x = player.x; t.y = player.y; t.z = player.z; t.yaw = player.yaw; t.pitch = player.pitch; t.seq = player.seq;
      t.hp = player.hp; t.maxHP = player.maxHP; t.grounded = player.grounded; t.sprinting = player.sprinting;
      t.dodgeRemaining = player.dodgeRemaining; t.charges = player.charges; t.invulnerable = player.invulnerable;
      t.ammo = player.ammo; t.reloading = player.reloading; t.mpSeconds = player.mpSeconds; t.mpTier = player.mpTier;
      t.skillTier = player.skillTier; t.skillElapsed = player.skillElapsed; t.skillActive = player.skillActive;
    }
  }
}
