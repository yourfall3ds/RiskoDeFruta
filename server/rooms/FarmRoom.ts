import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Room, type Client, type StepContext } from 'colyseus';
import { FarmSimulation, type CollisionData } from '../FarmSimulation';
import { FarmState, PlayerState, EnemyState, CLASS_IDS, PHASE, enemyStateOrdinal } from '../schema';
import { NetInput, BUTTON, toFrame } from '../../src/net/NetInput';
import { HIT_MESSAGE, SHOT_MESSAGE, sanitizeHitClaim, sanitizeShot } from '../../src/net/HitClaim';
import { MAP_CHOICES, TEST_MAP, TEST_MAP_ID, isTestMap, testMapCollision } from '../../src/world/TestMap';
import { FARM_MAP } from '../../src/world/FarmMap';
export { NetInput, BUTTON, toFrame };

/**
 * `loadGate`: este cliente MONTA um mundo depois da largada (o jogo de verdade) e a sala deve
 * esperar o primeiro movimento dele antes de o mundo andar. Bots e testes não declaram e não seguram.
 */
export interface FarmRoomOptions { seed?: string; name?: string; roomName?: string; map?: string; loadGate?: boolean }
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
const SETTINGS = new Set(['seed', 'mode', 'roomName', 'map']);

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

/**
 * Eventos da simulação que ATRAVESSAM a rede. Os de alta frequência — `DamageDealt`, `EnemyHit`,
 * `DamageTaken`, `PlayerHit`, `MPCharged`, `BodyBumped` — saíam um por acerto para cada
 * cliente e nenhum cliente os lia (o que eles anunciam já chega por `hp`/`alive` replicados):
 * centenas de mensagens por segundo decodificadas para o lixo. Ficam os raros que alguém usa.
 */
const RELAYED_EVENTS: ReadonlySet<string> = new Set(['PlayerKilled', 'EnemyKilled', 'SkillUsed', 'MPReleased', 'LevelUp', 'BossSpawned', 'ItemPicked', 'Dodged']);

export interface AuditPlayer {
  entityId: number; name: string; classId: string; ready: boolean; loading: boolean; hp: number; maxHP: number;
  x: number; y: number; z: number; grounded: boolean; inputsPerSecond: number; staleSeq: number; starvedPerSecond: number;
  queue: number; hits: number; ping: number;
  /** Relato do PC: 'rodando' / 'PARADO por …' / 'sem relato' (robô, ou jogo antigo). */
  step: string; fps: number; frameMs: number; gpu: string; activeMeshes: number; meshes: number; enemies: number; hidden: boolean; cost: string;
}
interface ClientReport { step: string; fps: number; frameMs: number; gpu: string; activeMeshes: number; meshes: number; enemies: number; hidden: boolean; cost: string }

function clientReport(d: (ClientReport & { at: number }) | undefined, now: number): ClientReport {
  if (!d || now - d.at > 6000) return { step: 'sem relato', fps: 0, frameMs: 0, gpu: '', activeMeshes: 0, meshes: 0, enemies: 0, hidden: false, cost: '' };
  const { at: _at, ...rest } = d; return rest;
}
export interface RoomAudit {
  roomId: string; seed: string; map: string; phase: string; loading: number; ticksPerSecond: number;
  enemies: number; enemiesAlive: number; players: AuditPlayer[]; rejectedHits: Record<string, number>;
}

/** Entradas que podem esperar na fila de um cliente antes de a sala consumir uma extra por tique. */
const QUEUE_SLACK = 2;
/** Quanto a sala espera o carregamento de quem ainda não chegou ao mundo. */
const LOADING_TIMEOUT_MS = 120_000;

export class FarmRoom extends Room<{ state: FarmState; input: NetInput; metadata: FarmRoomMetadata }> {
  maxClients = MAX_PLAYERS;
  inputs = this.defineInput(NetInput, { seqField: 'seq' });
  private sim!: FarmSimulation;
  /** Instante (ms) da largada; 0 = sem contagem em curso. É o único estado do lobby fora do schema. */
  private startAt = 0;

  /** Salas vivas neste processo — é o que o painel de auditoria (`/painel`) lista. */
  static readonly live = new Set<FarmRoom>();
  /** A última fotografia de auditoria desta sala, refeita a cada segundo. */
  audit: RoomAudit = { roomId: '', seed: '', map: '', phase: 'lobby', loading: 0, ticksPerSecond: 0, enemies: 0, enemiesAlive: 0, players: [], rejectedHits: {} };
  private auditSteps = 0;
  /** Último relato de cada PC (ver mensagem `diag`). */
  private readonly clientDiag = new Map<string, ClientReport & { at: number }>();
  private auditWall = 0;
  private auditLogClock = 0;

  /**
   * AUDITORIA AO VIVO: por segundo, o que cada jogador REALMENTE mandou e o que o servidor fez
   * com isso. Alimenta `/painel` (visível no navegador) e, a cada 10 s, o log.
   */
  private auditTick(): void {
    this.auditSteps++;
    const now = Date.now();
    if (!this.auditWall) this.auditWall = now;
    const span = (now - this.auditWall) / 1000;
    if (span < 1) return;
    const players: AuditPlayer[] = [];
    for (const client of this.clients) {
      const p = this.sim.players.get(client.sessionId), st = this.state.players.get(client.sessionId);
      if (!p || !st) continue;
      const n = p.netStats, m = p.motor;
      players.push({
        entityId: p.entityId, name: st.name, classId: st.classChosen ? CLASS_IDS[st.classId] ?? '?' : '-', ready: !!st.ready,
        loading: this.loading.has(client.sessionId), hp: Math.round(m.hp), maxHP: Math.round(m.maxHP),
        x: +m.position.x.toFixed(1), y: +m.position.y.toFixed(1), z: +m.position.z.toFixed(1), grounded: m.grounded,
        inputsPerSecond: Math.round(n.applied / span), staleSeq: n.staleSeq, starvedPerSecond: Math.round(n.starved / span),
        queue: this.inputs.get(client.sessionId).size, hits: p.hits, ping: st.ping ?? 0,
        ...clientReport(this.clientDiag.get(client.sessionId), now),
      });
      n.applied = 0; n.staleSeq = 0; n.starved = 0;
    }
    let alive = 0; for (const e of this.state.enemies.values()) if (e.alive) alive++;
    this.audit = {
      roomId: this.roomId, seed: this.state.seed, map: this.state.settings.get('map') || 'fazenda',
      phase: this.state.phase === PHASE.playing ? (this.loading.size ? 'carregando' : 'jogando') : (this.startAt ? 'contagem' : 'lobby'),
      loading: this.loading.size, ticksPerSecond: Math.round(this.auditSteps / span), enemies: this.state.enemies.size, enemiesAlive: alive,
      players, rejectedHits: Object.fromEntries(this.sim.rejectedHits),
    };
    this.sim.rejectedHits.clear();
    this.auditSteps = 0; this.auditWall = now;
    if ((this.auditLogClock += span) >= 10 && this.state.phase === PHASE.playing) {
      this.auditLogClock = 0;
      for (const pl of players) console.log(`[rede] ${this.roomId} · P${pl.entityId} ${pl.name} (${pl.classId}) · entradas ${pl.inputsPerSecond}/s · sem entrada ${pl.starvedPerSecond}/s · seq velho ${pl.staleSeq} · fila ${pl.queue} · hp ${pl.hp} · pos ${pl.x},${pl.y},${pl.z}`);
    }
  }
  /**
   * O PORTÃO DE CARREGAMENTO.
   *
   * A corrida largava no servidor no fim da contagem — e o mundo da fazenda só começa a ser MONTADO
   * no cliente nesse instante (quase um minuto de carga). Nesse minuto a horda nascia e batia em
   * corpos parados: medido no relatório de rede, os dois jogadores chegaram à tela com a vida em 0.
   * Agora, depois da largada, relógio, horda e dano esperam até cada jogador presente mandar o
   * primeiro movimento — o sinal de que o passo fixo DELE está rodando, ou seja, que carregou.
   * Quem já chegou pode andar; quem não chegar em `LOADING_TIMEOUT_MS` não segura a mesa.
   */
  private loading = new Set<string>();
  /** Quem declarou `loadGate` ao entrar. */
  private readonly loadGated = new Set<string>();
  private loadingSince = 0;

  onDispose(): void { FarmRoom.live.delete(this); }

  async onCreate(options: FarmRoomOptions): Promise<void> {
    FarmRoom.live.add(this);
    const seed = (typeof options.seed === 'string' ? options.seed.trim() : '') || `farm-${Date.now().toString(16)}`;
    /**
     * O MAPA É DECIDIDO NA CRIAÇÃO, e não muda depois.
     *
     * A colisão inteira — chão, relevo, cidade, pedras — nasce com a simulação, e o nascimento dos
     * jogadores já consultou o chão. Trocar de mapa com a sala de pé exigiria refazer a simulação
     * por baixo de quem já está nela, e isso é uma segunda máquina de estado para manter alinhada.
     * Quem quer outro mapa cria outra sala, que custa um clique.
     *
     * O `map` viaja em `settings` como qualquer outro ajuste: é assim que o CLIENTE descobre qual
     * mundo montar sem ter de perguntar.
     */
    const noLaboratorio = isTestMap(options.map);
    const map = noLaboratorio ? TEST_MAP_ID : '';
    // Colisão E assentos vêm do MESMO mapa: é o que impede um nascer num mundo e o outro em outro.
    this.sim = new FarmSimulation(seed, noLaboratorio ? testMapCollision() : loadCollision(), noLaboratorio ? TEST_MAP : FARM_MAP);
    this.sim.lockstep = true; this.sim.clientHits = true; this.sim.trainingTargetsEnabled = true;
    await this.sim.prepare();
    this.state = new FarmState();
    this.state.seed = seed;
    this.state.phase = PHASE.lobby;
    this.state.settings.set('seed', seed);
    this.state.settings.set('map', map);
    // Nome da sala: o que quem criou escreveu. Sem nada escrito, `onJoin` batiza pelo anfitrião.
    if (options.roomName?.trim()) this.state.settings.set('roomName', options.roomName.trim().slice(0, 24));
    this.patchRate = 1000 / PATCH_HZ;
    const rewind = this.allowRewindState({ maxRewindMs: 500 });
    rewind.attachAll(this.state.players, { fields: ['x', 'y', 'z'] });
    this.registerLobbyMessages();
    this.setFixedTimestep(ctx => this.step(ctx), TICK_HZ);
  }

  onJoin(client: Client, options?: FarmRoomOptions): void {
    if (options?.loadGate === true) this.loadGated.add(client.sessionId);
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
    /**
     * COMBATE DE QUEM ATIRA. `hit`: o pedido de acerto, validado e aplicado pela simulação.
     * `shot`: o aviso visual do disparo, repassado aos OUTROS (quem atirou já desenhou o seu).
     * Ambos só valem com a corrida em curso — no lobby não há horda nem arma em punho.
     */
    // O relato do PC de cada jogador (passo fixo, fps) — só para o painel; nenhuma regra lê isto.
    this.onMessage('diag', (client: Client, raw: unknown) => {
      const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : 0;
      const r = raw as Record<string, unknown>;
      this.clientDiag.set(client.sessionId, {
        step: typeof r?.['step'] === 'string' ? (r['step'] as string).slice(0, 60) : '?',
        fps: num(r?.['fps']), frameMs: num(r?.['frameMs']),
        gpu: typeof r?.['gpu'] === 'string' ? (r['gpu'] as string).slice(0, 60) : '?',
        activeMeshes: num(r?.['activeMeshes']), meshes: num(r?.['meshes']), enemies: num(r?.['enemies']), hidden: r?.['hidden'] === true,
        cost: typeof r?.['cost'] === 'string' ? (r['cost'] as string).slice(0, 160) : '',
        at: Date.now(),
      });
    });
    this.onMessage(HIT_MESSAGE, (client: Client, raw: unknown) => {
      if (this.state.phase !== PHASE.playing) return;
      const claim = sanitizeHitClaim(raw);
      if (claim) this.sim.claimHit(client.sessionId, claim);
    });
    this.onMessage(SHOT_MESSAGE, (client: Client, raw: unknown) => {
      if (this.state.phase !== PHASE.playing) return;
      const shot = sanitizeShot(raw);
      const entityId = this.state.players.get(client.sessionId)?.entityId;
      if (shot && entityId) this.broadcast(SHOT_MESSAGE, { ...shot, entityId }, { except: client });
    });
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

    /**
     * O PING DE CADA UM, para a etiqueta de debug de todos. O cliente mede (eco da entrada) e informa;
     * a sala só valida o número e o replica. Diagnóstico — nenhuma regra lê `ping`, então um valor
     * inventado mentiria para a etiqueta e para mais nada.
     */
    this.onMessage('rtt', (client: Client, message: { ms?: unknown }) => {
      const player = this.state.players.get(client.sessionId);
      const ms = Number(message?.ms);
      if (!player || !Number.isFinite(ms)) return;
      player.ping = Math.max(0, Math.min(9999, Math.round(ms)));
    });

    this.onMessage('setSetting', (client: Client, message: { key?: unknown; value?: unknown }) => {
      const key = String(message?.key ?? '');
      // Ajuste da corrida é do anfitrião. A recusa é DITA ao cliente: um botão que não faz nada e
      // não explica é indistinguível de um bug de rede.
      if (client.sessionId !== this.state.hostId) { client.send('settingRejected', { key, reason: 'host' }); return; }
      if (this.state.phase !== PHASE.lobby) { client.send('settingRejected', { key, reason: 'phase' }); return; }
      if (!SETTINGS.has(key)) { client.send('settingRejected', { key, reason: 'key' }); return; }
      // O mapa não é um texto: colisão e assentos nascem com a simulação. Caminho próprio, abaixo.
      if (key === 'map') { void this.selectMap(client, String(message?.value ?? '')); return; }
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
      //
      // O `.catch` não é zelo: o servidor NÃO tem rede para rejeição não tratada
      // (`server/index.ts` não instala `unhandledRejection`), e no Node atual uma rejeição solta
      // derruba o processo inteiro — a sala de todo mundo cai junto com a de quem encerrou. Já
      // aconteceu nesta base, pelo handler de CORS, e o sintoma era "a porta 2567 morre sozinha".
      this.disconnect().catch(motivo => console.warn(`[farm] ${this.roomId} · falha ao encerrar`, motivo));
    });
  }

  /** Unanimidade ESTRITA: sala não vazia, todos prontos e todos com personagem escolhido. */
  private unanimous(): boolean {
    const players = [...this.state.players.values()];
    return players.length > 0 && players.every(p => p.ready && p.classChosen);
  }

  /**
   * O ANFITRIÃO TROCA O MAPA — no lobby, e só fora da contagem.
   *
   * ## Por que não é um `settings.set`
   *
   * Colisão e assentos nascem COM a simulação: trocar só o texto deixaria a sala anunciando o mapa
   * de teste e simulando a fazenda. Então a simulação é REFEITA, e é isso que só pode acontecer no
   * lobby — lá ela não anda (ver `step`), não há horda, projétil nem progresso a perder.
   *
   * ## As recusas, cada uma com motivo
   *
   * - `value`: mapa que não existe. O cliente nunca inventa mapa; quem manda um id qualquer é outro
   *   cliente, e a sala não confia.
   * - `starting`: a contagem já começou. Todos confirmaram UM mapa; trocar debaixo deles faria a
   *   corrida largar num lugar que ninguém aceitou. É o congelamento pedido para a largada.
   *
   * ## Trocar desfaz o PRONTO de todo mundo
   *
   * Quem deu PRONTO aceitou o mapa que estava na tela. Com o mapa trocado, esse aceite não vale
   * mais para o que vai acontecer — então cada um confirma de novo. Sem isto, o anfitrião poderia
   * trocar o mapa no último segundo e a sala largaria com gente que nunca viu a troca.
   *
   * ## O número de cada um sobrevive
   *
   * Os jogadores são recolocados com o `entityId` que já tinham. Uma sala com P1 e P3 (P2 saiu) não
   * vira P1 e P2 depois da troca: o número é identidade, não ordem de chegada.
   */
  private async selectMap(client: Client, value: string): Promise<void> {
    const pedido = value.trim().toLowerCase();
    if (!MAP_CHOICES.some(m => m.id === pedido)) { client.send('settingRejected', { key: 'map', reason: 'value' }); return; }
    if (this.startAt) { client.send('settingRejected', { key: 'map', reason: 'starting' }); return; }
    if ((this.state.settings.get('map') ?? '') === pedido) return;

    const noLaboratorio = isTestMap(pedido);
    const nova = new FarmSimulation(this.state.seed, noLaboratorio ? testMapCollision() : loadCollision(), noLaboratorio ? TEST_MAP : FARM_MAP);
    nova.lockstep = true; nova.clientHits = true; nova.trainingTargetsEnabled = true;
    this.rebuilding = true;
    try {
      await nova.prepare();
      // A sala pode ter largado, esvaziado ou recebido outra troca enquanto a colisão preparava.
      if (this.state.phase !== PHASE.lobby || this.startAt) { client.send('settingRejected', { key: 'map', reason: 'starting' }); return; }
      const assentos = [...this.state.players.values()].sort((x, y) => x.entityId - y.entityId);
      for (const p of assentos) nova.addPlayer(p.id, p.entityId);
      this.sim = nova;
      this.state.settings.set('map', pedido);
      for (const p of this.state.players.values()) p.ready = false;
      this.mirror();
      this.publish();
      console.log(`[farm] ${this.roomId} · mapa trocado para "${pedido || 'fazenda'}" pelo anfitrião · prontos desfeitos`);
    } finally {
      this.rebuilding = false;
    }
  }

  /** Uma troca de mapa em preparo. Enquanto durar, a sala não larga. */
  private rebuilding = false;

  private evaluateStart(): void {
    if (this.state.phase !== PHASE.lobby) return;
    if (this.rebuilding) return;
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
    this.auditTick();
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
      // Mesma razão do `.catch` em `closeRoom`: rejeição solta aqui derruba o processo, e com ele a
      // corrida que acabou de largar. Falhar a tranca é ruim — entra estranho na sala —, derrubar o
      // servidor é pior.
      this.lock().catch(motivo => console.warn(`[farm] ${this.roomId} · falha ao trancar a sala`, motivo));
      this.broadcast('runStarted', { seed: this.sim.seed });
      // Portão de carregamento: quem está na sala agora precisa CHEGAR ao mundo antes de ele andar.
      this.loading = new Set(this.clients.map(c => c.sessionId).filter(id => this.loadGated.has(id)));
      this.loadingSince = Date.now();
    }
    /**
     * O LOBBY É MENU, E MENU NÃO SIMULA.
     *
     * `sim.step` rodava sem olhar a fase. Do lado do jogador o lobby é uma TELA DE MENU — ele está
     * escolhendo personagem —, mas do lado do servidor a fazenda já estava viva: relógio correndo,
     * diretor acumulando, horda nascendo e ferindo. O jogador entrava em campo já machucado, ou
     * entrava morto, sem nunca ter visto o que o matou.
     *
     * Não é teoria: um cliente de testes ficou numa sala que NUNCA largou e saiu assim —
     * `saindo {"vida":0,"municao":23}`. Morto, numa corrida que não tinha começado.
     *
     * A entrada continua sendo CONSUMIDA no lobby, de propósito: o buffer por cliente tem tamanho
     * finito, e deixá-lo encher durante a escolha de personagem faria o primeiro segundo da corrida
     * reproduzir comandos velhos — o jogador largaria correndo para um lado que ele quis dois
     * minutos atrás. Consumir e descartar é o que mantém a largada limpa.
     */
    const emCurso = this.state.phase === PHASE.playing;
    /**
     * Entradas EXTRAS deste tique, por cliente. O cliente manda uma por passo fixo dele; o servidor
     * consome uma por passo seu. Qualquer engasgo (GC, aba, rede) deixava um acúmulo que NUNCA mais
     * drenava — a confirmação ficava cada vez mais atrasada e cada correção reexecutava mais passos.
     * Acima de `QUEUE_SLACK`, a sala aplica uma entrada extra por tique até a fila voltar.
     */
    const extras: { id: string; input: NetInput }[] = [];
    const gated = this.loading.size > 0;
    for (const client of this.clients) {
      const buffer = this.inputs.get(client.sessionId);
      const input = buffer.next();   // UM input por cliente por passo…
      if (input && emCurso) {
        this.sim.applyInput(client.sessionId, { frame: toFrame(input), yaw: input.yaw, pitch: input.pitch, seq: input.seq });
        if (this.loading.delete(client.sessionId) || gated) this.sim.stepPlayerById(client.sessionId, ctx.dt);
      }
      if (buffer.size > QUEUE_SLACK) { const extra = buffer.next(); if (extra && emCurso) extras.push({ id: client.sessionId, input: extra }); }   // …mais um quando a fila acumulou
    }
    if (!emCurso) { this.mirror(); return; }
    if (this.loading.size > 0) {
      for (const id of [...this.loading]) if (!this.clients.some(c => c.sessionId === id)) this.loading.delete(id);
      if (this.loading.size > 0 && Date.now() - this.loadingSince < LOADING_TIMEOUT_MS) { this.mirror(); return; }
      console.log(`[farm] ${this.roomId} · todos carregaram em ${((Date.now() - this.loadingSince) / 1000).toFixed(1)} s${this.loading.size ? ` (sem esperar ${this.loading.size})` : ''} · a corrida anda`);
      this.loading.clear();
    } else if (gated) {
      console.log(`[farm] ${this.roomId} · todos carregaram em ${((Date.now() - this.loadingSince) / 1000).toFixed(1)} s · a corrida anda`);
    }
    this.sim.step(ctx.dt);
    for (const { id, input } of extras) {
      this.sim.applyInput(id, { frame: toFrame(input), yaw: input.yaw, pitch: input.pitch, seq: input.seq });
      this.sim.stepPlayerById(id, ctx.dt);
    }
    this.mirror();
    for (const event of this.sim.drain()) if (RELAYED_EVENTS.has(event.type)) this.broadcast(event.type, event.payload);
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
