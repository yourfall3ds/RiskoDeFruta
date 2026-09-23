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
import type { EconomyRow } from '../run/RunEconomy';
import type { ItemDefinition } from '../run/RunProgression';
import { logger } from '../core/Log';

const log = logger('rede');

/** O veredito de uma compra, como ele viaja. Nenhum campo daqui vira decisão no cliente. */
export interface PurchaseVerdict {
  ok: boolean; interactableId: string; requestId: string; entityId: number;
  cost: number; credits: number; item?: ItemDefinition; empty?: boolean; reason?: string;
}

/**
 * Ligação com a sala `farm` via `@colyseus/sdk`, sem Babylon.
 * Entrada: `InputHandle` do `defineInput` (buffer com seq). Estado: `room.state` (schema).
 * Remotos: `Predict` do SDK suaviza/atrasa os campos numéricos dos jogadores (interpolação nativa).
 */
export interface RemoteSample { x: number; y: number; z: number; yaw: number; state: PlayerState }
export interface DebugRosterRow { id: string; entityId: number; name: string; ping: number; hp: number; maxHP: number; self: boolean; connected: boolean }

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
  /** Endereço público da sala, dito pelo servidor na boas-vindas. Ver `LobbyLink.address`. */
  address = '';
  /** Meu número de entidade na sala (1..4), dito na boas-vindas. Diagnóstico; nenhuma regra o lê. */
  entityId = 0;
  private closedReason = '';
  private readonly closedListeners = new Set<(reason: string) => void>();
  private rttTimer: ReturnType<typeof setInterval> | undefined;
  /** `name` viaja no `joinOrCreate`: é assim que `FarmRoom.onJoin` batiza o jogador. */
  constructor(readonly url: string, readonly seed: string, readonly playerName = '', readonly roomLabel = '') {}

  get connected(): boolean { return !!this.room; }
  get sessionId(): string { return this.room?.sessionId ?? ''; }
  get roomId(): string { return this.room?.roomId ?? ''; }
  /**
   * Meu estado autoritativo mais recente, se já chegou.
   *
   * O `?.` vai até `players`, e não só até `room`. Entre o `join` e o PRIMEIRO patch de estado a
   * sala existe e `state.players` ainda não: `room.state.players.get(...)` estourava
   * `Cannot read properties of undefined (reading 'get')` dentro do `connect()`, a sala era
   * descartada e o jogador voltava para a lista — com a tela dizendo só "não consegui entrar na
   * sala", sem nada ligando isso a uma leitura cedo demais.
   */
  get me(): PlayerState | undefined { return this.room?.state?.players?.get(this.sessionId); }
  get rttMs(): number { return this.room?.clock.smoothedRtt() ?? 0; }
  get jitterMs(): number { return this.room?.clock.jitter() ?? 0; }
  get playerCount(): number { return this.room?.state?.players?.size ?? 0; }
  get lastSentSeq(): number { return this.seq; }

  async connect(): Promise<void> {
    try {
      const client = new Client(this.url);
      log.info('conectando', { servidor: this.url, seed: this.seed, nome: this.playerName });
      const room = await client.joinOrCreate<FarmState>('farm', { seed: this.seed, name: this.playerName, roomName: this.roomLabel });
      this.room = room;
      this.input = room.input({ type: NetInput });
      this.predict = Predict.get(room);
      log.info('entrei na sala', { roomId: room.roomId, sessionId: room.sessionId, servidor: this.url });
      // O PING DE CADA UM, para a etiqueta de debug de todos (ver `PlayerState.ping`). Só quando já
      // existe medida: o RTT do SDK nasce do eco da entrada, e antes do primeiro eco vale zero —
      // mandar zero diria "ping perfeito" onde a verdade é "ainda não medi".
      this.rttTimer = setInterval(() => { const ms = this.rttMs; if (this.room && ms > 0) this.room.send('rtt', { ms: Math.round(ms) }); }, 2000);
      room.onLeave(code => {
        clearInterval(this.rttTimer);
        this.room = undefined; this.input = undefined;
        // 4000 é o código com que a sala expulsa (`client.leave(4000)`); sem motivo dito antes, a
        // queda é queda mesmo — e as três coisas precisam chegar à tela com nomes diferentes.
        const reason = this.closedReason || (code === 4000 ? 'O ANFITRIÃO REMOVEU VOCÊ DA SALA' : 'A SALA FOI ENCERRADA');
        // Saída pedida é `info`; queda é `aviso`. O código do WebSocket viaja junto porque é ele
        // que distingue "o anfitrião encerrou" de "a rede caiu" num relato de jogador.
        if (this.closedReason) log.info('saí da sala', { codigo: code, motivo: reason });
        else log.aviso('a sala caiu', { codigo: code, motivo: reason });
        for (const listener of this.closedListeners) listener(reason);
      });
      room.onError((code, message) => { this.error = `sala ${code}: ${message ?? ''}`; log.erro('erro da sala', { codigo: code, mensagem: message ?? '' }); });
      // O endereço público chega na boas-vindas: é o que o código curto carrega.
      room.onMessage('welcome', (payload: { address?: string; entityId?: number }) => {
        this.address = String(payload?.address ?? '');
        this.entityId = Number(payload?.entityId ?? 0);
        log.info('boas-vindas', { roomId: this.roomId, entityId: this.entityId, endereco: this.address });
        this.notifyLobby();
      });
      room.onMessage('roomClosed', (payload: { reason?: string }) => { this.closedReason = String(payload?.reason ?? 'O ANFITRIÃO ENCERROU A SALA'); });
      /**
       * A morte anunciada pelo servidor.
       *
       * O SDK reclama em voz alta quando chega mensagem sem `onMessage` registrado — e estava
       * reclamando desta a cada abate, poluindo o console de quem depura. Registrar aqui não é
       * silenciar: a morte é DECIDIDA no servidor (contrato §20.5) e o cliente só precisa saber
       * disso para contar e mostrar. A apresentação do corpo continua vindo do `alive` replicado,
       * não daqui, para não existirem dois caminhos anunciando a mesma morte.
       */
      room.onMessage('PlayerKilled', (payload: { entityId?: number; by?: number }) => {
        log.info('jogador abatido', { vitima: Number(payload?.entityId ?? 0), por: Number(payload?.by ?? 0) });
      });
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
    /**
     * `forEach`, e não `for...of`, e com guarda.
     *
     * `MapSchema` não é iterável por desestruturação nesta versão do schema: `for (const [id, state]
     * of room.state.players)` lançava `players is not iterable` a CADA QUADRO, e o laço de render
     * morria junto — o jogo entrava na sala e travava sem nada na tela explicando. `enemies()`
     * abaixo sempre usou `.values()` e por isso nunca quebrou; esta era a única leitura fora do
     * padrão.
     *
     * A guarda existe porque o primeiro quadro depois do `join` pode chegar antes do primeiro patch
     * de estado: aí `players` ainda é indefinido, e devolver lista vazia é o comportamento certo —
     * ninguém para desenhar ainda.
     */
    const players = room.state?.players;
    if (!players) return [];
    players.forEach((state: PlayerState, id: string) => {
      if (id === this.sessionId) return;
      seen.add(state);
      if (!this.attached.has(state)) { predict.attach(state, { x: 'lerp', y: 'lerp', z: 'lerp', yaw: { mode: 'lerp', angle: true } }); this.attached.add(state); }
      samples.push({ x: predict.value(state, 'x'), y: predict.value(state, 'y'), z: predict.value(state, 'z'), yaw: predict.value(state, 'yaw'), state });
    });
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
    // `enemies` só existe depois da primeira patch; antes dela a lista vazia é a resposta certa —
    // não há horda para apresentar ainda, e inventar uma seria pior que esperar.
    const enemies = room.state?.enemies;
    if (!enemies) return rows;
    for (const e of enemies.values()) rows.push({
      id: e.id, kind: e.kind as EnemyKind, variant: e.variant as EnemyVariant, scale: e.scale,
      x: e.x, y: e.y, z: e.z, yaw: e.yaw, hp: e.hp, maxHP: e.maxHP,
      state: (ENEMY_STATES[e.state] ?? 'chase') as ReplicatedEnemy['state'],
      time: e.time, burn: e.burn, stagger: e.stagger,
      targetPlayerId: e.targetPlayerId, alive: e.alive,
    });
    return rows;
  }

  /**
   * A ECONOMIA AUTORITATIVA, decodificada para a APRESENTAÇÃO (contrato §21.2).
   *
   * Até o bloco F `FarmRoom` publicava `credits`, `xp`, `level` e `totalKills` e nada no cliente os
   * adotava: o saldo era calculado, transportado — e ignorado. Este é o leitor que faltava. Ele
   * devolve `undefined` enquanto não há sala: silêncio não é saldo zero, e quem exibe precisa
   * distinguir os dois.
   */
  economy(): EconomyRow | undefined {
    const room = this.room;
    if (!room) return undefined;
    // O filho do schema só existe depois da primeira patch. Devolver zeros aqui seria inventar um
    // saldo: silêncio não é carteira vazia, e quem exibe precisa distinguir os dois.
    const p = room.state?.progression as FarmState['progression'] | undefined;
    if (!p) return undefined;
    return { credits: p.credits, xp: p.xp, level: p.level, totalKills: p.totalKills, stage: room.state?.stage ?? 1, purchases: p.purchases };
  }

  /** Os baús que o SERVIDOR marcou consumidos. Apresentação: a tampa abre igual nas quatro telas. */
  usedChests(): string[] {
    const used = this.room?.state?.usedChests;
    return used ? [...used] : [];
  }

  /** A TENTATIVA de compra. Não devolve sucesso: o veredito chega por `purchaseResolved`. */
  buyChest(interactableId: string, requestId: string): void {
    this.room?.send('buyChest', { interactableId, requestId });
  }

  /** A TENTATIVA de melee. Pedido possivelmente obsoleto; o servidor responde recusando (§20.22). */
  melee(requestId: string): void { this.room?.send('melee', { requestId }); }

  /** Veredito de uma compra, vindo do servidor. O chamador APRESENTA o que veio. */
  onPurchaseResolved(listener: (result: PurchaseVerdict) => void): void {
    this.room?.onMessage('purchaseResolved', listener);
  }

  // ---- lobby (`LobbyLink`) ------------------------------------------------------------------

  get players(): readonly LobbyPlayer[] {
    const room = this.room;
    if (!room) return [];
    // Roster vazio enquanto o schema não chegou — a tela da sala já sabe desenhar "aguardando…".
    const players = room.state?.players;
    if (!players) return [];
    const hostId = room.state?.hostId ?? '';
    return [...players.values()].map(p => ({
      id: p.id, entityId: p.entityId, name: p.name,
      classId: p.classChosen ? CLASS_IDS[p.classId] as PlayerClassId | undefined : undefined,
      ready: p.ready, host: p.id === hostId, self: p.id === this.sessionId,
      // `connected` nasceu `false` no schema antigo; um cliente ligado a um servidor sem o campo
      // veria a sala inteira "reconectando". Na dúvida, conectado — o estado normal.
      connected: p.connected !== false,
    })).sort((a, b) => a.entityId - b.entityId);
  }

  /**
   * O que a etiqueta de debug mostra de cada jogador: número, nome, ping e vida. Leitura direta do
   * estado replicado — o mesmo que todas as telas recebem —, então a vida aqui é a do SERVIDOR, e a
   * etiqueta mostra a verdade mesmo quando o HUD local diverge dela.
   */
  debugRoster(): DebugRosterRow[] {
    const out: DebugRosterRow[] = [];
    this.room?.state?.players?.forEach((p: PlayerState, id: string) => {
      out.push({ id, entityId: p.entityId, name: p.name, ping: p.ping ?? 0, hp: p.hp, maxHP: p.maxHP, self: id === this.sessionId, connected: p.connected !== false });
    });
    return out.sort((a, b) => a.entityId - b.entityId);
  }

  get phase(): LobbyPhase { return this.room?.state?.phase === PHASE.playing ? 'playing' : 'lobby'; }
  get isHost(): boolean { return !!this.room && this.room.state?.hostId === this.sessionId; }

  onChange(listener: () => void): () => void {
    this.lobbyListeners.add(listener);
    return () => this.lobbyListeners.delete(listener);
  }

  chooseClass(id: PlayerClassId): void { this.room?.send('chooseClass', { classId: id }); }
  setReady(ready: boolean): void { this.room?.send('setReady', { ready }); }
  setSetting(key: string, value: string): void { this.room?.send('setSetting', { key, value }); }

  /** O nome da sala é um AJUSTE da sala, então passa pelo mesmo `setSetting` já guardado por host. */
  get roomName(): string { return this.room?.state?.settings?.get('roomName') ?? ''; }
  /** O mapa da sala, como o SERVIDOR o tem. `''` é a fazenda. Estado autoritativo, nunca local. */
  get mapId(): string { return this.room?.state?.settings?.get('map') ?? ''; }
  /** O PEDIDO de troca. Quem decide é a sala: anfitrião, lobby e fora da contagem (`FarmRoom.selectMap`). */
  selectMap(id: string): void { this.setSetting('map', id); }
  rename(name: string): void { this.setSetting('roomName', name); }
  kick(playerId: string): void { this.room?.send('kick', { playerId }); }
  closeRoom(): void { this.room?.send('closeRoom', {}); }
  leaveRoom(): void { this.closedReason = 'VOCÊ SAIU DA SALA'; void this.room?.leave(true); }
  get failure(): string { return this.error; }
  onClosed(listener: (reason: string) => void): () => void {
    this.closedListeners.add(listener);
    return () => this.closedListeners.delete(listener);
  }

  /**
   * Avisa a interface — só quando algo que ela MOSTRA mudou.
   *
   * A chave tem de conter tudo o que a tela desenha, e faltavam duas coisas. `connected`: quando um
   * jogador caía, nada mais na linha dele mudava, a chave ficava igual e o `RECONECTANDO…` nunca
   * chegava à tela — o dado estava certo e a notificação o engolia. E o mapa, que passou a ser
   * escolhido no lobby: sem ele aqui, o convidado continuaria vendo o mapa antigo.
   */
  private notifyLobby(): void {
    const key = this.phase + '|' + this.address + '|' + this.roomName + '|' + this.mapId + '|' + this.players.map(p => `${p.entityId}:${p.name}:${p.classId ?? ''}:${p.ready ? 1 : 0}:${p.host ? 1 : 0}:${p.connected ? 1 : 0}`).join(',');
    if (key === this.lobbyKey) return;
    this.lobbyKey = key;
    for (const listener of this.lobbyListeners) listener();
  }

  dispose(): void {
    clearInterval(this.rttTimer);
    this.lobbyListeners.clear();
    this.closedListeners.clear();
    this.predict?.dispose();
    void this.room?.leave(true);
    this.room = undefined; this.input = undefined; this.predict = undefined; this.attached.clear();
  }
}
