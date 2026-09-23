import type { HitClaim, ShotFx } from './HitClaim';
import type { Scene } from '@babylonjs/core/scene';
import type { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import type { CollisionWorld } from '../physics/CollisionWorld';
import type { EventBus } from '../core/EventBus';
import type { GameEvents } from '../core/contracts';
import type { MotorState, PlayerMotor } from '../player/PlayerMotor';
import type { InputFrame } from '../input/InputFrame';
import { NetworkClient, type PurchaseVerdict } from './NetworkClient';
import type { EconomyRow, PurchaseChannel } from '../run/RunEconomy';
import { RemotePlayers } from './RemotePlayers';
import { Reconciliation, type Pose } from './Reconciliation';
import type { LobbyLink } from './LobbyLink';
import { readOnlineIntent } from './OnlineIntent';
import { DEFAULT_COOP_SERVER, currentRoomClient } from './RoomSession';

const DEFAULT_SERVER = DEFAULT_COOP_SERVER;

/**
 * Sessão online do `PlayerScene`: predição local (o motor continua rodando com a entrada local),
 * reconciliação contra o `seq` confirmado pelo servidor e apresentação dos remotos.
 * Ativa com `?online=1` (`&server=ws://host:porta` opcional). Sem o parâmetro, o jogo segue single-player.
 */
export class NetworkSession {
  readonly client: NetworkClient;
  readonly remotes: RemotePlayers;
  readonly reconciliation = new Reconciliation(.12, 240);
  private readonly frames = new Map<number, { frame: InputFrame; yaw: number; state: MotorState }>();
  private lastAckedSeq = 0;
  replays = 0;
  status = 'conectando';

  /**
   * A sessão, se esta aba está online — pela URL (dev, testes, `jogar-coop.ps1`) OU pelo pedido que
   * o MENU gravou (`OnlineIntent`). Os dois caminhos convergem aqui: o jogo continua conhecendo um
   * só jeito de estar online, e a diferença é só quem pediu.
   *
   * O ENDEREÇO vem, em ordem: do `?server=` explícito, do código curto que o jogador colou (é ele
   * que carrega o endereço do anfitrião) e, por último, do padrão local. A ordem importa — o padrão
   * `127.0.0.1` só serve para quem hospeda, e era ele que mandava o convidado falar consigo mesmo.
   */
  static fromLocation(scene: Scene, collision: CollisionWorld, shadows: ShadowGenerator, events: EventBus<GameEvents>, seed: string): NetworkSession | undefined {
    const params = new URL(location.href).searchParams;
    const intent = readOnlineIntent();
    if (!params.get('online') && !intent) return undefined;
    /**
     * A SALA QUE JÁ ESTÁ ABERTA vem primeiro.
     *
     * Quem entrou pelo menu já está numa sala desde o lobby — o roster respondeu, o personagem foi
     * escolhido e o PRONTO foi dado, tudo isso antes de esta cena existir (ver `RoomSession`).
     * Conectar de novo aqui abriria uma SEGUNDA conexão para o mesmo jogador e o mandaria para o
     * fim da fila de uma sala em que ele já tem vaga. A cena adota e segue.
     */
    const open = currentRoomClient();
    if (open) return new NetworkSession(scene, collision, shadows, events, seed, open.url, intent?.name ?? '', intent?.roomName ?? '', open);
    const url = params.get('server') || intent?.server || DEFAULT_SERVER;
    return new NetworkSession(scene, collision, shadows, events, seed, url, intent?.name ?? '', intent?.roomName ?? '');
  }

  /**
   * `true` quando a sala foi ABERTA por esta sessão — e portanto é esta sessão que a descarta.
   *
   * Uma sala adotada pertence ao menu (`RoomSession`), que a abriu antes desta cena nascer e a
   * fecha quando o jogador sai. Descartá-la aqui derrubaria o jogador da sala toda vez que a cena
   * fosse refeita, que é precisamente o que o trabalho inteiro existe para impedir.
   */
  private readonly ownsClient: boolean;

  constructor(scene: Scene, collision: CollisionWorld, shadows: ShadowGenerator, events: EventBus<GameEvents>, seed: string, url: string, playerName = '', roomName = '', adopted?: NetworkClient) {
    this.client = adopted ?? new NetworkClient(url, seed, playerName, roomName);
    this.ownsClient = !adopted;
    this.remotes = new RemotePlayers(scene, collision, shadows, events);
    /**
     * O RELATO DESTE PC ao painel, a cada 2 s, por temporizador próprio — e não pelo quadro: se a
     * cena estiver parada, é exatamente aí que o relato mais importa. `diagSource` é ligado pela
     * cena (o motivo do passo parado); o fps vem do motor.
     */
    const engine = scene.getEngine();
    let gpu = '';
    try { gpu = String((engine as unknown as { getGlInfo(): { renderer: string } }).getGlInfo().renderer).replace(/^ANGLE \(/, '').replace(/ Direct3D.*$/, '').slice(0, 60); } catch { gpu = '?'; }
    this.diagTimer = setInterval(() => {
      if (!this.online) return;
      const step = this.diagSource?.() ?? '';
      const fps = engine.getFps();
      this.client.sendDiag({
        step: step ? 'PARADO por ' + step : 'rodando', fps: Number.isFinite(fps) ? Math.round(fps) : 0, frameMs: Math.round(engine.getDeltaTime()),
        gpu, activeMeshes: scene.getActiveMeshes().length, meshes: scene.meshes.length, enemies: this.client.enemyCount,
        // Aba em segundo plano: o navegador segura o quadro, e o fps baixo NÃO é peso do jogo.
        hidden: typeof document !== 'undefined' && document.hidden,
        cost: this.costSource?.() ?? '',
      });
    }, 2000);
    const ready = (): void => {
      this.status = 'online';
      // A assinatura só pode existir depois da sala; até lá os vereditos ainda não têm por onde vir.
      this.client.onPurchaseResolved(result => { for (const listener of this.purchaseListeners) listener(result); });
      this.client.onShot(shot => this.remotes.shot(shot));
    };
    // A sala adotada já está conectada: não há o que esperar, e esperar deixaria a cena sem
    // vereditos de compra até o próximo evento que nunca viria.
    if (adopted) ready();
    else void this.client.connect().then(ready).catch(() => { this.status = 'falha: ' + this.client.error; });
  }

  /** O motivo de o passo fixo estar parado (vazio = rodando). Ligado pela cena. */
  diagSource: (() => string) | undefined;
  /** Os trechos mais caros do quadro (ver `FrameSections`). Ligado pela cena. */
  costSource: (() => string) | undefined;
  private readonly diagTimer: ReturnType<typeof setInterval>;

  get online(): boolean { return this.client.connected; }

  /** O lobby, para o menu. É o `NetworkClient` por baixo — a interface só enxerga `LobbyLink`. */
  get lobby(): LobbyLink { return this.client; }

  /** Depois de `motor.fixedUpdate`: envia a intenção e grava a pose prevista sob o mesmo seq. */
  afterStep(frame: InputFrame, yaw: number, pitch: number, motor: PlayerMotor): void {
    if (!this.online) return;
    const seq = this.client.send(frame, yaw, pitch);
    if (!seq) return;
    this.frames.set(seq, { frame, yaw, state: motor.captureState() });
    this.reconciliation.record(seq, pose(motor));
    for (const key of this.frames.keys()) { if (this.frames.size <= 240) break; this.frames.delete(key); }
  }

  /** Confirmação do servidor: compara com a predição no mesmo seq; corrige e reaplica as entradas pendentes se divergiu. */
  reconcile(motor: PlayerMotor, dt: number): void {
    const me = this.client.me;
    if (!me || me.seq <= this.lastAckedSeq) return;
    this.lastAckedSeq = me.seq;
    const acked = this.frames.get(me.seq);
    const result = this.reconciliation.ack(me.seq, { x: me.x, y: me.y, z: me.z, vx: 0, vy: 0, vz: 0 }, server => {
      // Primeiro o estado previsto NAQUELE seq (velocidade, chão, coyote…), depois a posição do
      // servidor por cima: a reexecução parte do mesmo ponto em que o servidor estava.
      if (acked) motor.restoreState(acked.state);
      motor.position.x = server.x; motor.position.y = server.y; motor.position.z = server.z;
      Object.assign(motor.previous, motor.position);
    });
    if (!result.corrected) return;
    motor.replaying = true;
    try {
      for (const seq of result.pending) {
        const replay = this.frames.get(seq);
        if (!replay) continue;
        motor.fixedUpdate(dt, replay.frame, replay.yaw);
        replay.state = motor.captureState();
        this.reconciliation.record(seq, pose(motor));
        this.replays++;
      }
    } finally { motor.replaying = false; }
    for (const seq of [...this.frames.keys()]) if (seq <= me.seq) this.frames.delete(seq);
  }

  /**
   * A horda autoritativa deste tique, ou `undefined` enquanto a sala não está de pé.
   *
   * `undefined` e lista vazia dizem coisas DIFERENTES e o chamador precisa dos dois: vazio é "o
   * servidor diz que não há inimigo", indefinido é "ainda não há servidor". Só o primeiro autoriza
   * o cliente a virar apresentação — virar no segundo deixaria a fazenda sem horda nenhuma.
   */
  enemies(): readonly import('../game/EnemySwarm').ReplicatedEnemy[] | undefined {
    return this.online ? this.client.enemies() : undefined;
  }

  /**
   * A economia autoritativa deste tique, ou `undefined` enquanto a sala não está de pé.
   *
   * Mesmo contrato de `enemies()`: `undefined` é "ainda não há servidor" e não autoriza a tela a
   * exibir zero. Quem consome adota a última linha conhecida.
   */
  economy(): EconomyRow | undefined { return this.online ? this.client.economy() : undefined; }

  /** Os baús que o servidor marcou consumidos. Apresentação pura. */
  usedChests(): string[] { return this.online ? this.client.usedChests() : []; }

  /**
   * O canal de compra (contrato §21.3). Existe só quando há servidor: offline a decisão continua
   * sendo local e legítima, porque ali não há duas telas para divergir.
   */
  get purchases(): PurchaseChannel | undefined {
    return this.online ? { request: (id, requestId) => this.client.buyChest(id, requestId) } : undefined;
  }

  private readonly purchaseListeners = new Set<(result: PurchaseVerdict) => void>();
  /** Quem quiser APRESENTAR o veredito de uma compra se inscreve aqui. */
  onPurchaseResolved(listener: (result: PurchaseVerdict) => void): void { this.purchaseListeners.add(listener); }

  /** Manda o soco. Sem conferir espelho nenhum antes — a recusa é do servidor (§20.22). */
  melee(requestId: string): void { if (this.online) this.client.melee(requestId); }

  /** Pedidos de acerto enviados. Diagnóstico do F1. */
  hitClaims = 0;
  /** O acerto que a arma local viu, virando pedido ao servidor. */
  claimHit(claim: HitClaim): void { if (!this.online) return; this.hitClaims++; this.client.sendHit(claim); }
  /** O disparo local, para os outros verem. */
  shot(fx: ShotFx): void { if (this.online) this.client.sendShot(fx); }

  /** Por frame de render: interpola e apresenta os remotos. */
  render(dt: number): void {
    if (!this.online) return;
    this.remotes.update(this.client.remotes(performance.now()), dt);
  }

  debugLine(): string {
    const c = this.client, r = this.reconciliation;
    return `Rede ${this.status} · sala ${c.roomId || '-'} · sessão ${c.sessionId || '-'} · jogadores ${c.playerCount} · remotos ${this.remotes.count}\n`
      + `RTT ${c.rttMs.toFixed(0)} ms · jitter ${c.jitterMs.toFixed(0)} ms · seq ${c.lastSentSeq} · confirmado ${r.lastAcked} · pendentes ${r.pendingCount}\n`
      + `Correções ${r.corrections} · último erro ${r.lastError.toFixed(3)} m · replays ${this.replays} · acertos pedidos ${this.hitClaims}\n`;
  }

  dispose(): void {
    clearInterval(this.diagTimer);
    this.remotes.dispose();
    // A sala adotada NÃO é descartada aqui: ela é do menu (`RoomSession`) e precisa sobreviver à
    // troca de cena — descartá-la derrubaria o jogador de uma sala em que ele tem vaga.
    if (this.ownsClient) this.client.dispose();
    this.frames.clear();
  }
}

function pose(motor: PlayerMotor): Pose {
  return { x: motor.position.x, y: motor.position.y, z: motor.position.z, vx: motor.velocity.x, vy: motor.velocity.y, vz: motor.velocity.z };
}
