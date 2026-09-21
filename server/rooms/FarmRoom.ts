import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Room, type Client, type StepContext } from 'colyseus';
import { FarmSimulation, type CollisionData } from '../FarmSimulation';
import { FarmState, PlayerState, EnemyState, CLASS_IDS, PHASE, enemyStateOrdinal } from '../schema';
import { NetInput, BUTTON, toFrame } from '../../src/net/NetInput';
export { NetInput, BUTTON, toFrame };

export interface FarmRoomOptions { seed?: string; name?: string; roomName?: string }
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
/**
 * Quanto tempo a sala segura o lugar de quem caiu.
 *
 * Trinta segundos é o que cobre o acidente real — wi-fi oscilando, notebook dormindo, cabo puxado —
 * sem transformar a corrida de quem ficou numa sala de espera. Passado isso a vaga é liberada e a
 * saída segue o caminho de sempre.
 */
const RECONNECT_SECONDS = 30;
/**
 * O código de fecho que o Colyseus usa quando a saída foi PEDIDA, não sofrida.
 *
 * É `CloseCode.CONSENTED` (`@colyseus/core/Protocol`), e NÃO o 1000 do WebSocket — que foi o meu
 * primeiro palpite e fazia toda saída normal cair na janela de reconexão: `leave()` só resolvia
 * trinta segundos depois, e a suíte inteira de lobby passou a estourar por tempo.
 *
 * `kickClient` usa o mesmo código, e isso é desejável: quem foi EXPULSO não ganha janela de volta.
 */
const CONSENTED_CLOSE = 4000;
/** Ajustes que o anfitrião pode mudar. Chave fora desta lista é recusada como qualquer outra. */
const SETTINGS = new Set(['seed', 'mode', 'roomName']);

/**
 * O ENDEREÇO PÚBLICO desta instalação (`host:porta`), escrito por `server/index.ts`.
 *
 * A sala precisa DIZER esse endereço ao cliente, porque é ele que entra no código curto que o
 * jogador compartilha — e o cliente não tem como descobri-lo sozinho: o anfitrião conhece apenas o
 * `localhost` por onde ele mesmo entrou. Vem do ambiente e não de um `import` de `index.ts` para
 * não arrastar o `listen()` para dentro dos testes.
 */
export function publicAddress(): string { return process.env['PUBLIC_ADDRESS'] ?? ''; }


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
export interface FarmRoomMetadata { seed: string; playerCount: number; maxClients: number; hostName: string; phase: number; roomName: string; address: string }

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
    // Nome da sala: o que quem criou escreveu. Sem nada escrito, `onJoin` batiza pelo anfitrião.
    if (options.roomName?.trim()) this.state.settings.set('roomName', options.roomName.trim().slice(0, 24));
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
    state.connected = true;
    this.state.players.set(client.sessionId, state);
    // Anfitrião é o primeiro a entrar. Escolher aqui e não no primeiro `setSetting` evita uma sala
    // sem dono enquanto ninguém mexe nos ajustes.
    if (!this.state.hostId) this.state.hostId = client.sessionId;
    // Sala sem nome ganha o do anfitrião: "SALA DE LUCAS" é o que o dono descreveu, e renomear
    // continua sendo um `setSetting` do anfitrião como qualquer outro ajuste.
    if (!this.state.settings.get('roomName')) this.state.settings.set('roomName', `SALA DE ${state.name}`);
    this.state.playerCount = this.state.players.size;
    /**
     * UMA linha por entrada, com o `roomId`.
     *
     * A sala é registrada com `filterBy(['seed'])`, e quando dois clientes caem em salas DIFERENTES
     * o sintoma é "ninguém vê ninguém" — indistinguível de replicação, presença ou join quebrados.
     * A primeira checagem de qualquer playtest é: os quatro no mesmo `roomId`.
     */
    console.log(`[farm] ${this.roomId} · entrou ${client.sessionId} como entityId=${snapshot.entityId} · ${this.state.players.size}/${MAX_PLAYERS} na sala · seed=${this.sim.seed}`);
    client.send('welcome', { seed: this.sim.seed, tick: this.sim.loop.tick, spawn: { x: snapshot.x, y: snapshot.y, z: snapshot.z }, entityId: snapshot.entityId, hostId: this.state.hostId, address: publicAddress() });
    this.publish();
    // Uma entrada quebra a unanimidade que existia: quem chegou não está pronto.
    this.abortStart('jogador entrou');
    this.evaluateStart();
  }

  /**
   * A SAÍDA, e a queda — que não são a mesma coisa.
   *
   * Sair é uma decisão: o jogador clicou em SAIR DA SALA, e a vaga é liberada na hora. Cair é um
   * acidente: o wi-fi oscilou, o notebook dormiu, o cabo foi puxado. Até aqui o servidor tratava as
   * duas iguais — quem caía perdia o corpo, o inventário e a numeração, e voltava como JOGADOR
   * NOVO no fim da fila de uma corrida que já ia pela metade. Era o comportamento que
   * `tests/coop-four-clients` documentava como "a sala não tem reconexão por token".
   *
   * Agora a queda ABRE UMA JANELA. Dentro dela o `PlayerState` continua na sala, com tudo no lugar,
   * e `allowReconnection` devolve o MESMO `sessionId` quando o cliente volta — que é o que faz o
   * inventário e a vaga serem os mesmos sem precisar de token nenhum: a identidade é a sessão.
   *
   * A janela só existe com a corrida EM CURSO. No lobby não há nada a preservar, e segurar uma vaga
   * de quatro por meio minuto por causa de quem fechou a aba é pior do que liberá-la.
   */
  async onLeave(client: Client, code?: number): Promise<void> {
    // Saída pedida (ou expulsão). Qualquer outro código é acidente — e é só o acidente que merece
    // a janela de volta.
    const consented = code === CONSENTED_CLOSE;
    const playing = this.state.phase === PHASE.playing;
    if (!consented && playing && this.sim.setDisconnected(client.sessionId, true)) {
      const state = this.state.players.get(client.sessionId);
      if (state) state.connected = false;
      console.log(`[farm] ${this.roomId} · caiu ${client.sessionId} · esperando ${RECONNECT_SECONDS}s`);
      try {
        await this.allowReconnection(client, RECONNECT_SECONDS);
        this.sim.setDisconnected(client.sessionId, false);
        const back = this.state.players.get(client.sessionId);
        if (back) back.connected = true;
        console.log(`[farm] ${this.roomId} · voltou ${client.sessionId} · mesma corrida`);
        this.publish();
        return;
      } catch {
        // A janela fechou sem ele. Daqui para baixo é a saída de sempre.
        console.log(`[farm] ${this.roomId} · não voltou ${client.sessionId}`);
      }
    }
    this.sim.removePlayer(client.sessionId);
    this.state.players.delete(client.sessionId);
    this.state.playerCount = this.state.players.size;
    // Queda do anfitrião promove o próximo do mapa (ordem de entrada), não deixa a sala sem dono.
    if (this.state.hostId === client.sessionId) this.state.hostId = [...this.state.players.keys()][0] ?? '';
    console.log(`[farm] ${this.roomId} · saiu ${client.sessionId} · ${this.state.players.size}/${MAX_PLAYERS} na sala`);
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

    /**
     * COMPRA DE BAÚ — protocolo, não checagem local (contrato §21.3).
     *
     * A sala não valida nada aqui: ela repassa a tentativa e devolve o veredito. Quem decide é
     * `FarmSimulation.requestPurchase`, que é onde a carteira autoritativa mora.
     */
    this.onMessage('buyChest', (client: Client, message: { interactableId?: unknown; requestId?: unknown }) => {
      const result = this.sim.requestPurchase(client.sessionId, message ?? {});
      // O veredito volta para QUEM pediu; o que os outros precisam ver (saldo, baú aberto) viaja
      // pelo schema, não por mensagem — evento é efêmero, estado é replicado (§18.10).
      if (result) client.send('purchaseResolved', result);
    });

    /**
     * MELEE — a intenção chega, o servidor resolve (contrato §20.22).
     *
     * Um pedido de quem já morreu, ou apontado para o vazio, é recusado de graça: o cliente nunca
     * precisou conferir o próprio espelho antes de mandar.
     */
    this.onMessage('melee', (client: Client, message: { requestId?: unknown }) => {
      this.sim.requestMelee(client.sessionId, message ?? {});
    });

    this.onMessage('setSetting', (client: Client, message: { key?: unknown; value?: unknown }) => {
      const key = String(message?.key ?? '');
      // Ajuste da corrida é do anfitrião. A recusa é DITA ao cliente: um botão que não faz nada e
      // não explica é indistinguível de um bug de rede.
      if (client.sessionId !== this.state.hostId) { client.send('settingRejected', { key, reason: 'host' }); return; }
      if (this.state.phase !== PHASE.lobby) { client.send('settingRejected', { key, reason: 'phase' }); return; }
      if (!SETTINGS.has(key)) { client.send('settingRejected', { key, reason: 'key' }); return; }
      this.state.settings.set(key, String(message?.value ?? ''));
      // O nome da sala é o que a LISTAGEM mostra; sem republicar, renomear só apareceria para quem
      // já está dentro — que é justamente quem não precisa do nome.
      if (key === 'roomName') this.publish();
    });

    /**
     * EXPULSAR e ENCERRAR — as duas ações do anfitrião sobre a sala inteira.
     *
     * Ambas apenas DESLIGAM clientes. Nenhuma toca na fase, na unanimidade ou na contagem: a saída
     * já passa por `onLeave`, que é onde a máquina de lobby existente reavalia tudo. Uma segunda
     * máquina de estado aqui seria a forma mais rápida de desalinhar as duas.
     */
    this.onMessage('kick', (client: Client, message: { playerId?: unknown }) => {
      if (client.sessionId !== this.state.hostId) return;
      const target = String(message?.playerId ?? '');
      if (!target || target === this.state.hostId) return;
      const victim = this.clients.find(other => other.sessionId === target);
      // 4000: código combinado com `NetworkClient.onLeave`, que é o que diferencia "expulso" de
      // "a sala caiu" na tela de quem foi removido.
      victim?.leave(4000);
    });

    this.onMessage('closeRoom', (client: Client) => {
      if (client.sessionId !== this.state.hostId) return;
      this.broadcast('roomClosed', { reason: 'O ANFITRIÃO ENCERROU A SALA' });
      // `disconnect()` desliga todo mundo e descarta a sala — é o que impede a sala fantasma na
      // listagem depois que o anfitrião desiste.
      void this.disconnect();
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
      /**
       * A PORTA FECHA QUANDO A CORRIDA LARGA.
       *
       * Sem isto, `joinOrCreate` com a mesma semente entregava um desconhecido no meio do estágio
       * 5, sem itens, sem nível e sem a menor chance — e a mesa de quem estava jogando ganhava um
       * passageiro que ninguém convidou. `tests/coop-four-clients` registrava exatamente isso:
       * "a sala aceita (não há porteiro nem token)".
       *
       * `lock()` e não uma recusa no `onJoin`: a sala trancada sai do emparelhamento, então quem
       * procura sala com esta semente recebe uma NOVA em vez de um erro. E `allowReconnection`
       * atravessa a tranca de propósito — quem CAIU continua podendo voltar, que é a diferença
       * entre fechar a porta e trancar alguém do lado de fora.
       */
      void this.lock();
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
    void this.setMetadata({ ...this.metadata, seed: this.sim.seed, playerCount: this.state.players.size, maxClients: MAX_PLAYERS, hostName: this.state.players.get(this.state.hostId)?.name ?? '', phase: this.state.phase, roomName: this.state.settings.get('roomName') ?? '', address: publicAddress() }).catch(() => {});
  }

  private mirror(): void {
    const snap = this.sim.snapshot(), s = this.state;
    s.tick = snap.tick; s.time = snap.time; s.stage = snap.stage; s.ferryTime = snap.ferryTime;
    const p = s.progression;
    p.credits = snap.credits; p.xp = snap.xp; p.level = snap.level; p.totalKills = snap.totalKills;
    p.purchases = snap.purchases;
    // Cópia, e só cópia: a lista cresce no servidor quando uma compra é resolvida, e aqui ela só
    // atravessa para a rede. Nenhuma regra nasce de ler este array.
    if (s.usedChests.length !== snap.usedChests.length) { s.usedChests.clear(); for (const id of snap.usedChests) s.usedChests.push(id); }
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
    this.mirrorEnemies(snap.enemies);
  }

  /**
   * A horda, do snapshot para o schema. **Cópia, e só cópia** (contrato §18.9).
   *
   * Nenhuma decisão mora aqui: nem escolha de alvo, nem vida, nem morte, nem nascimento. Se algum
   * dia uma linha deste método precisar de uma regra, a regra pertence a `EnemySimulation` —
   * preencher schema não pode virar desculpa para uma segunda simulação.
   *
   * Até hoje este método simplesmente NÃO EXISTIA: `EnemyState` era declarado no schema e jamais
   * escrito, e era por isso que dois clientes viam mundos diferentes.
   */
  private mirrorEnemies(rows: ReturnType<FarmSimulation['snapshot']>['enemies']): void {
    const enemies = this.state.enemies;
    const seen = new Set<string>();
    for (const row of rows) {
      const key = String(row.id);
      seen.add(key);
      let e = enemies.get(key);
      if (!e) {
        e = new EnemyState();
        // Identidade do corpo: fixada no nascimento e nunca reescrita por tique.
        e.id = row.id; e.kind = row.kind; e.variant = row.variant; e.scale = row.scale; e.maxHP = row.maxHP;
        enemies.set(key, e);
      }
      e.x = row.x; e.y = row.y; e.z = row.z; e.yaw = row.yaw;
      e.hp = row.hp; e.state = enemyStateOrdinal(row.state); e.time = row.time;
      e.burn = row.burn; e.stagger = row.stagger; e.alive = row.alive;
      e.targetPlayerId = row.targetPlayerId; e.targetLockTime = row.targetLockTime; e.lastTargetSwitchTime = row.lastTargetSwitchTime;
    }
    // Quem saiu de campo some da rede no mesmo tique em que some da simulação.
    for (const key of [...enemies.keys()]) if (!seen.has(key)) enemies.delete(key);
  }
}
