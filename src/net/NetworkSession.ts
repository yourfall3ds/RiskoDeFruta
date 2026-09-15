import type { Scene } from '@babylonjs/core/scene';
import type { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import type { CollisionWorld } from '../physics/CollisionWorld';
import type { EventBus } from '../core/EventBus';
import type { GameEvents } from '../core/contracts';
import type { PlayerMotor } from '../player/PlayerMotor';
import type { InputFrame } from '../input/InputFrame';
import { NetworkClient } from './NetworkClient';
import { RemotePlayers } from './RemotePlayers';
import { Reconciliation, type Pose } from './Reconciliation';

const DEFAULT_SERVER = 'ws://127.0.0.1:2567';

/**
 * Sessão online do `PlayerScene`: predição local (o motor continua rodando com a entrada local),
 * reconciliação contra o `seq` confirmado pelo servidor e apresentação dos remotos.
 * Ativa com `?online=1` (`&server=ws://host:porta` opcional). Sem o parâmetro, o jogo segue single-player.
 */
export class NetworkSession {
  readonly client: NetworkClient;
  readonly remotes: RemotePlayers;
  readonly reconciliation = new Reconciliation(.12, 240);
  private readonly frames = new Map<number, { frame: InputFrame; yaw: number }>();
  private lastAckedSeq = 0;
  replays = 0;
  status = 'conectando';

  static fromLocation(scene: Scene, collision: CollisionWorld, shadows: ShadowGenerator, events: EventBus<GameEvents>, seed: string): NetworkSession | undefined {
    const params = new URL(location.href).searchParams;
    if (!params.get('online')) return undefined;
    return new NetworkSession(scene, collision, shadows, events, seed, params.get('server') || DEFAULT_SERVER);
  }

  constructor(scene: Scene, collision: CollisionWorld, shadows: ShadowGenerator, events: EventBus<GameEvents>, seed: string, url: string) {
    this.client = new NetworkClient(url, seed);
    this.remotes = new RemotePlayers(scene, collision, shadows, events);
    void this.client.connect().then(() => { this.status = 'online'; }).catch(() => { this.status = 'falha: ' + this.client.error; });
  }

  get online(): boolean { return this.client.connected; }

  /** Depois de `motor.fixedUpdate`: envia a intenção e grava a pose prevista sob o mesmo seq. */
  afterStep(frame: InputFrame, yaw: number, pitch: number, motor: PlayerMotor): void {
    if (!this.online) return;
    const seq = this.client.send(frame, yaw, pitch);
    if (!seq) return;
    this.frames.set(seq, { frame, yaw });
    this.reconciliation.record(seq, pose(motor));
    for (const key of this.frames.keys()) { if (this.frames.size <= 240) break; this.frames.delete(key); }
  }

  /** Confirmação do servidor: compara com a predição no mesmo seq; corrige e reaplica as entradas pendentes se divergiu. */
  reconcile(motor: PlayerMotor, dt: number): void {
    const me = this.client.me;
    if (!me || me.seq <= this.lastAckedSeq) return;
    this.lastAckedSeq = me.seq;
    const result = this.reconciliation.ack(me.seq, { x: me.x, y: me.y, z: me.z, vx: 0, vy: 0, vz: 0 }, server => {
      motor.position.x = server.x; motor.position.y = server.y; motor.position.z = server.z;
      Object.assign(motor.previous, motor.position);
    });
    if (!result.corrected) return;
    for (const seq of result.pending) {
      const replay = this.frames.get(seq);
      if (!replay) continue;
      motor.fixedUpdate(dt, replay.frame, replay.yaw);
      this.reconciliation.record(seq, pose(motor));
      this.replays++;
    }
    for (const seq of [...this.frames.keys()]) if (seq <= me.seq) this.frames.delete(seq);
  }

  /** Por frame de render: interpola e apresenta os remotos. */
  render(dt: number): void {
    if (!this.online) return;
    this.remotes.update(this.client.remotes(performance.now()), dt);
  }

  debugLine(): string {
    const c = this.client, r = this.reconciliation;
    return `Rede ${this.status} · sala ${c.roomId || '-'} · sessão ${c.sessionId || '-'} · jogadores ${c.playerCount} · remotos ${this.remotes.count}\n`
      + `RTT ${c.rttMs.toFixed(0)} ms · jitter ${c.jitterMs.toFixed(0)} ms · seq ${c.lastSentSeq} · confirmado ${r.lastAcked} · pendentes ${r.pendingCount}\n`
      + `Correções ${r.corrections} · último erro ${r.lastError.toFixed(3)} m · replays ${this.replays}\n`;
  }

  dispose(): void { this.remotes.dispose(); this.client.dispose(); this.frames.clear(); }
}

function pose(motor: PlayerMotor): Pose {
  return { x: motor.position.x, y: motor.position.y, z: motor.position.z, vx: motor.velocity.x, vy: motor.velocity.y, vz: motor.velocity.z };
}
