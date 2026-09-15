import { Client, Predict, type Room, type InputHandle } from '@colyseus/sdk';
import type { FarmState, PlayerState } from '../../server/schema';
import { NetInput, writeInput } from './NetInput';
import type { InputFrame } from '../input/InputFrame';

/**
 * Ligação com a sala `farm` via `@colyseus/sdk`, sem Babylon.
 * Entrada: `InputHandle` do `defineInput` (buffer com seq). Estado: `room.state` (schema).
 * Remotos: `Predict` do SDK suaviza/atrasa os campos numéricos dos jogadores (interpolação nativa).
 */
export interface RemoteSample { x: number; y: number; z: number; yaw: number; state: PlayerState }

export class NetworkClient {
  room: Room<FarmState> | undefined;
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

  dispose(): void {
    this.predict?.dispose();
    void this.room?.leave(true);
    this.room = undefined; this.input = undefined; this.predict = undefined; this.attached.clear();
  }
}
