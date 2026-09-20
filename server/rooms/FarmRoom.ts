import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Room, type Client, type StepContext } from 'colyseus';
import { FarmSimulation, type CollisionData } from '../FarmSimulation';
import { FarmState, PlayerState, CLASS_IDS, PHASE } from '../schema';
import { NetInput, BUTTON, toFrame } from '../../src/net/NetInput';
export { NetInput, BUTTON, toFrame };

export interface FarmRoomOptions { seed?: string; name?: string }
const MAX_PLAYERS = 4;
const TICK_HZ = 60;          // calibração do FixedLoop/PlayerMotor e dos 203 testes
const PATCH_HZ = 30;         // estado na rede a 30 Hz; o cliente interpola
/**
 * Janela entre "todos prontos" e a largada.
 *
 * Ela existe para que a unanimidade seja REVOGÁVEL: sem contagem, o último a apertar PRONTO
 * arrastaria a sala para dentro da corrida no mesmo quadro, e quem entrasse ou se arrependesse
 * um instante depois já estaria em campo. Qualquer quebra da unanimidade dentro da janela
 * — entrada, desistência ou queda — cancela a largada e a sala continua no lobby.
 */
const COUNTDOWN_MS = 3000;
/** Ajustes que o anfitrião pode mudar. Chave fora desta lista é recusada como qualquer outra. */
const SETTINGS = new Set(['seed', 'mode']);


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
  if (existsSync(path('initial-rock-fix.json'))) data.initialRocks = read('initial-rock-fix.json') as NonNullable<CollisionData['initialRocks']>;
  return data;
}


/**
 * Adaptador fino sobre o netcode do Colyseus 0.18: `defineInput` (buffer por cliente com seq),
 * `setFixedTimestep` (passo fixo) e `allowRewindState` (posições vistas pelo atirador, para o hitscan da Fase 3).
 * A simulação é `FarmSimulation`; aqui só entra rede, schema e reencaminhamento de eventos.
 */
/** O que a listagem em tempo real mostra de cada sala, antes de alguém entrar nela. */
export interface FarmRoomMetadata { seed: string; playerCount: number; maxClients: number; hostName: string; phase: number }

export class FarmRoom extends Room<{ state: FarmState; input: NetInput; metadata: FarmRoomMetadata }> {
  maxClients = MAX_PLAYERS;
  inputs = this.defineInput(NetInput, { seqField: 'seq' });
  private sim!: FarmSimulation;
  /** Instante (ms) da largada; 0 = sem contagem em curso. É o único estado do lobby fora do schema. */
  private startAt = 0;

  async onCreate(options: FarmRoomOptions): Promise<void> {
    const seed = options.seed?.trim() || `farm-${Date.now().toString(16)}`;
    this.sim = new FarmSimulation(seed, loadCollision());
    await this.sim.prepare();
    this.state = new FarmState();
    this.state.seed = seed;
    this.state.phase = PHASE.lobby;
    this.state.settings.set('seed', seed);
    this.patchRate = 1000 / PATCH_HZ;
    const rewind = this.allowRewindState({ maxRewindMs: 500 });
    rewind.attachAll(this.state.players, { fields: ['x', 'y', 'z'] });
    this.registerLobbyMessages();
    this.setFixedTimestep(ctx => this.step(ctx), TICK_HZ);
  }

  onJoin(client: Client, options?: FarmRoomOptions): void {
    const snapshot = this.sim.addPlayer(client.sessionId);
    const state = new PlayerState();
    state.id = client.sessionId;
    state.entityId = snapshot.entityId;
    state.name = options?.name?.trim().slice(0, 24) || `JOGADOR ${snapshot.entityId}`;
    this.state.players.set(client.sessionId, state);
    // Anfitrião é o primeiro a entrar. Escolher aqui e não no primeiro `setSetting` evita uma sala
    // sem dono enquanto ninguém mexe nos ajustes.
    if (!this.state.hostId) this.state.hostId = client.sessionId;
    this.state.playerCount = this.state.players.size;
    client.send('welcome', { seed: this.sim.seed, tick: this.sim.loop.tick, spawn: { x: snapshot.x, y: snapshot.y, z: snapshot.z }, entityId: snapshot.entityId, hostId: this.state.hostId });
    this.publish();
    // Uma entrada quebra a unanimidade que existia: quem chegou não está pronto.
    this.abortStart('jogador entrou');
    this.evaluateStart();
  }

  onLeave(client: Client): void {
    this.sim.removePlayer(client.sessionId);
    this.state.players.delete(client.sessionId);
    this.state.playerCount = this.state.players.size;
    // Queda do anfitrião promove o próximo do mapa (ordem de entrada), não deixa a sala sem dono.
    if (this.state.hostId === client.sessionId) this.state.hostId = [...this.state.players.keys()][0] ?? '';
    this.publish();
    /**
     * Uma queda CANCELA a largada mesmo que os restantes continuem unânimes.
     *
     * Deixar a contagem correr por cima da saída largaria a corrida num grupo que ninguém
     * confirmou — e quem ficou não teve um quadro sequer para reagir ao sumiço do companheiro. A
     * contagem reinicia do zero logo abaixo se a unanimidade ainda valer, mas reiniciada, e com o
     * aviso na tela.
     */
    this.abortStart('jogador saiu');
    this.evaluateStart();
  }

  /**
   * Pedidos discretos do lobby. Nenhum deles decide nada sozinho: todos terminam em
   * `evaluateStart`, que é o único lugar onde a sala sai do lobby.
   */
  private registerLobbyMessages(): void {
    this.onMessage('chooseClass', (client: Client, message: { classId?: unknown }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || this.state.phase !== PHASE.lobby) return;
      const index = typeof message?.classId === 'number' ? message.classId : CLASS_IDS.indexOf(message?.classId as typeof CLASS_IDS[number]);
      if (!(index >= 0 && index < CLASS_IDS.length)) return;
      player.classId = index; player.classChosen = true;
      this.evaluateStart();
    });

    this.onMessage('setReady', (client: Client, message: { ready?: unknown }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || this.state.phase !== PHASE.lobby) return;
      player.ready = message?.ready !== false;
      this.evaluateStart();
    });

    this.onMessage('setSetting', (client: Client, message: { key?: unknown; value?: unknown }) => {
      const key = String(message?.key ?? '');
      // Ajuste da corrida é do anfitrião. A recusa é DITA ao cliente: um botão que não faz nada e
      // não explica é indistinguível de um bug de rede.
      if (client.sessionId !== this.state.hostId) { client.send('settingRejected', { key, reason: 'host' }); return; }
      if (this.state.phase !== PHASE.lobby) { client.send('settingRejected', { key, reason: 'phase' }); return; }
      if (!SETTINGS.has(key)) { client.send('settingRejected', { key, reason: 'key' }); return; }
      this.state.settings.set(key, String(message?.value ?? ''));
    });
  }

  /** Unanimidade ESTRITA: sala não vazia, todos prontos e todos com personagem escolhido. */
  private unanimous(): boolean {
    const players = [...this.state.players.values()];
    return players.length > 0 && players.every(p => p.ready && p.classChosen);
  }

  private evaluateStart(): void {
    if (this.state.phase !== PHASE.lobby) return;
    if (this.unanimous()) {
      if (this.startAt) return;
      this.startAt = Date.now() + COUNTDOWN_MS;
      this.broadcast('runStarting', { inSeconds: COUNTDOWN_MS / 1000 });
    } else this.abortStart('unanimidade quebrada');
  }

  private abortStart(reason: string): void {
    if (!this.startAt) return;
    this.startAt = 0;
    this.broadcast('runAborted', { reason });
  }

  private step(ctx: StepContext): void {
    if (this.state.phase === PHASE.lobby && this.startAt && Date.now() >= this.startAt) {
      this.startAt = 0;
      this.state.phase = PHASE.playing;
      this.broadcast('runStarted', { seed: this.sim.seed });
    }
    for (const client of this.clients) {
      const input = this.inputs.get(client.sessionId).next();   // UM input por cliente por passo
      if (input) this.sim.applyInput(client.sessionId, { frame: toFrame(input), yaw: input.yaw, pitch: input.pitch, seq: input.seq });
    }
    this.sim.step(ctx.dt);
    this.mirror();
    for (const event of this.sim.drain()) this.broadcast(event.type, event.payload);
  }

  /**
   * Metadados da listagem em tempo real (o que o navegador de salas mostra).
   *
   * `setMetadata` no 0.18 SUBSTITUI o objeto em vez de fundir — daí o espalhamento explícito.
   */
  private publish(): void {
    // A listagem é COSMÉTICA: uma falha dela (sala já em descarte, driver fora do ar) não pode
    // virar rejeição não tratada e derrubar o processo no meio de uma partida.
    void this.setMetadata({ ...this.metadata, seed: this.sim.seed, playerCount: this.state.players.size, maxClients: MAX_PLAYERS, hostName: this.state.players.get(this.state.hostId)?.name ?? '', phase: this.state.phase }).catch(() => {});
  }

  private mirror(): void {
    const snap = this.sim.snapshot(), s = this.state;
    s.tick = snap.tick; s.time = snap.time; s.stage = snap.stage; s.ferryTime = snap.ferryTime;
    const p = s.progression;
    p.credits = snap.credits; p.xp = snap.xp; p.level = snap.level; p.totalKills = snap.totalKills;
    for (const player of snap.players) {
      const t = s.players.get(player.id);
      if (!t) continue;
      for (const [id, stacks] of Object.entries(player.inventory)) if (t.inventory.get(id) !== stacks) t.inventory.set(id, stacks);
      t.x = player.x; t.y = player.y; t.z = player.z; t.yaw = player.yaw; t.pitch = player.pitch; t.seq = player.seq;
      t.hp = player.hp; t.maxHP = player.maxHP; t.grounded = player.grounded; t.sprinting = player.sprinting;
      t.dodgeRemaining = player.dodgeRemaining; t.charges = player.charges; t.invulnerable = player.invulnerable;
      t.ammo = player.ammo; t.reloading = player.reloading; t.mpSeconds = player.mpSeconds; t.mpTier = player.mpTier;
      t.skillTier = player.skillTier; t.skillElapsed = player.skillElapsed; t.skillActive = player.skillActive;
    }
  }
}
