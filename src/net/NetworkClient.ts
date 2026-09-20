import { Client, Predict, type Room, type InputHandle } from '@colyseus/sdk';
import type { FarmState, PlayerState } from '../../server/schema';
import { CLASS_IDS, PHASE, ENEMY_STATES } from '../../server/schema';
import type { ReplicatedEnemy } from '../game/EnemySwarm';
import type { EnemyKind } from '../run/MonsterDirector';
import type { EnemyVariant } from '../enemies/EnemyAffixes';
import { NetInput, writeInput } from './NetInput';
import type { InputFrame } from '../input/InputFrame';
import type { LobbyLink, LobbyPlayer, LobbyPhase } from './LobbyLink';
import type { PlayerClassId } from '../run/PlayerClass';

/**
 * Ligação com a sala `farm` via `@colyseus/sdk`, sem Babylon.
 * Entrada: `InputHandle` do `defineInput` (buffer com seq). Estado: `room.state` (schema).
 * Remotos: `Predict` do SDK suaviza/atrasa os campos numéricos dos jogadores (interpolação nativa).
 */
export interface RemoteSample { x: number; y: number; z: number; yaw: number; state: PlayerState }

export class NetworkClient implements LobbyLink {
  room: Room<FarmState> | undefined;
  private readonly lobbyListeners = new Set<() => void>();
  /** Última leitura do lobby, para só avisar a interface quando algo de fato mudou. */
  private lobbyKey = '';
  private input: InputHandle<NetInput> | undefined;
  private predict: Predict<FarmState> | undefined;
  private readonly attached = new Set<PlayerState>();
  private seq = 0;
  error = '';
  constructor(readonly url: string, readonly seed: string) {}

  get connected(): boolean { return !!this.room; }
  get sessionId(): string { return this.room?.sessionId ?? ''; }
  get roomId(): string { return this.room?.roomId ?? ''; }
  /** Meu estado autoritativo mais recente, se já chegou. */
  get me(): PlayerState | undefined { return this.room?.state.players.get(this.sessionId); }
  get rttMs(): number { return this.room?.clock.smoothedRtt() ?? 0; }
  get jitterMs(): number { return this.room?.clock.jitter() ?? 0; }
  get playerCount(): number { return this.room?.state.players.size ?? 0; }
  get lastSentSeq(): number { return this.seq; }

  async connect(): Promise<void> {
    try {
      const client = new Client(this.url);
      const room = await client.joinOrCreate<FarmState>('farm', { seed: this.seed });
      this.room = room;
      this.input = room.input({ type: NetInput });
      this.predict = Predict.get(room);
      room.onLeave(() => { this.room = undefined; this.input = undefined; });
      room.onError((code, message) => { this.error = `sala ${code}: ${message ?? ''}`; });
      // Uma patch por 1/30 s reescreve o roster inteiro; o `lobbyKey` corta o ruído para o DOM só
      // ser reescrito quando nome, classe, prontidão ou fase realmente mudaram.
      room.onStateChange(() => this.notifyLobby());
      this.notifyLobby();
    } catch (error) { this.error = error instanceof Error ? error.message : 'Falha ao conectar'; throw error; }
  }

  /** Um input por passo fixo: intenção, nunca posição. Devolve o seq enviado. */
  send(frame: InputFrame, yaw: number, pitch: number): number {
    if (!this.input) return 0;
    const seq = ++this.seq;
    writeInput(this.input.data, frame, yaw, pitch, seq);
    this.input.send();
    return seq;
  }

  /** Avança a suavização dos remotos e devolve a amostra interpolada de cada jogador que não sou eu. */
  remotes(now: number): RemoteSample[] {
    const room = this.room, predict = this.predict;
    if (!room || !predict) return [];
    predict.tick(now);
    const samples: RemoteSample[] = [];
    const seen = new Set<PlayerState>();
    for (const [id, state] of room.state.players) {
      if (id === this.sessionId) continue;
      seen.add(state);
      if (!this.attached.has(state)) { predict.attach(state, { x: 'lerp', y: 'lerp', z: 'lerp', yaw: { mode: 'lerp', angle: true } }); this.attached.add(state); }
      samples.push({ x: predict.value(state, 'x'), y: predict.value(state, 'y'), z: predict.value(state, 'z'), yaw: predict.value(state, 'yaw'), state });
    }
    for (const state of this.attached) if (!seen.has(state)) { predict.detach(state); this.attached.delete(state); }
    return samples;
  }

  /**
   * A horda autoritativa, decodificada para a apresentação.
   *
   * Leitura pura do schema: nenhum campo é calculado aqui. `state` volta a ser nome (o ordinal é
   * só a forma de rede, que existe porque `state` muda várias vezes por segundo em dezenas de
   * corpos) e o resto viaja como veio. Lista vazia enquanto a sala não respondeu — e é por isso que
   * a apresentação nunca inventa um inimigo para cobrir o silêncio.
   */
  enemies(): ReplicatedEnemy[] {
    const room = this.room;
    if (!room) return [];
    const rows: ReplicatedEnemy[] = [];
    for (const e of room.state.enemies.values()) rows.push({
      id: e.id, kind: e.kind as EnemyKind, variant: e.variant as EnemyVariant, scale: e.scale,
      x: e.x, y: e.y, z: e.z, yaw: e.yaw, hp: e.hp, maxHP: e.maxHP,
      state: (ENEMY_STATES[e.state] ?? 'chase') as ReplicatedEnemy['state'],
      time: e.time, burn: e.burn, stagger: e.stagger,
      targetPlayerId: e.targetPlayerId, alive: e.alive,
    });
    return rows;
  }

  // ---- lobby (`LobbyLink`) ------------------------------------------------------------------

  get players(): readonly LobbyPlayer[] {
    const room = this.room;
    if (!room) return [];
    const hostId = room.state.hostId;
    return [...room.state.players.values()].map(p => ({
      id: p.id, entityId: p.entityId, name: p.name,
      classId: p.classChosen ? CLASS_IDS[p.classId] as PlayerClassId | undefined : undefined,
      ready: p.ready, host: p.id === hostId, self: p.id === this.sessionId,
    })).sort((a, b) => a.entityId - b.entityId);
  }

  get phase(): LobbyPhase { return this.room?.state.phase === PHASE.playing ? 'playing' : 'lobby'; }
  get isHost(): boolean { return !!this.room && this.room.state.hostId === this.sessionId; }

  onChange(listener: () => void): () => void {
    this.lobbyListeners.add(listener);
    return () => this.lobbyListeners.delete(listener);
  }

  chooseClass(id: PlayerClassId): void { this.room?.send('chooseClass', { classId: id }); }
  setReady(ready: boolean): void { this.room?.send('setReady', { ready }); }
  setSetting(key: string, value: string): void { this.room?.send('setSetting', { key, value }); }

  private notifyLobby(): void {
    const key = this.phase + '|' + this.players.map(p => `${p.entityId}:${p.name}:${p.classId ?? ''}:${p.ready ? 1 : 0}:${p.host ? 1 : 0}`).join(',');
    if (key === this.lobbyKey) return;
    this.lobbyKey = key;
    for (const listener of this.lobbyListeners) listener();
  }

  dispose(): void {
    this.lobbyListeners.clear();
    this.predict?.dispose();
    void this.room?.leave(true);
    this.room = undefined; this.input = undefined; this.predict = undefined; this.attached.clear();
  }
}
