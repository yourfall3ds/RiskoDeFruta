import type {Vec3} from '../core/contracts';
import {PathFollower} from '../planet-nav';
import type {NavCollision, NavFrame, NavManifest, NavOptions} from '../planet-nav';
import type {NavWorkerRequest, NavWorkerResponse} from './PlanetNavigation.worker';

/**
 * Navegação do planeta — cliente de um Web Worker real.
 *
 * A auditoria contra o asset final (`.temp/planet-navigation-audit.md`) mediu, na main thread:
 * **232 s de construção com pior fatia de 3915 ms** e `path()` com média 322 ms, p95 1529 ms e
 * pior caso 2635 ms. Fatiar isso em 8 ms por quadro não resolve nada — só transforma um
 * travamento visível em centenas de engasgos, e a consulta de rota continua indivisível: uma
 * única chamada de `path()` estoura dezenas de quadros sozinha.
 *
 * Por isso esta camada não constrói nem consulta nada aqui. Ela:
 *
 * 1. **serializa a geometria real uma vez** (`manifest.positions/indices`) para um worker que
 *    monta a própria BVH e o próprio grafo, com o perfil econômico medido (11 s, 3.000 nós,
 *    as MESMAS 10 de 14 ilhas ligadas a pé);
 * 2. **correlaciona consulta e resposta por `id`**: uma rota só é entregue a quem a pediu, e só
 *    depois de validada contra a posição ATUAL de quem pediu;
 * 3. **degrada em silêncio seguro**: sem worker, `ready` nunca fica verdadeiro e `request()`
 *    devolve `undefined` para sempre — o chamador segue na perseguição local e o motivo aparece
 *    no `readout()`. Em nenhuma hipótese a construção volta para a thread da UI.
 *
 * ## Integração (o que mudou para quem chama)
 *
 * Nada obrigatório. O construtor, `build(loading)`, `tick(dt)`, `request(from, to)` e `readout()`
 * continuam iguais. Duas adições **opcionais**:
 *
 * ```ts
 * navigation.preload();                              // começa o worker antes da tela de jogo
 * navigation.request(from, to, enemy.id);            // ← actorKey recomendado (ver abaixo)
 * navigation.dispose();                              // ao trocar de cena
 * ```
 *
 * ### Por que `actorKey`
 *
 * `request()` é síncrono, mas a resposta do worker chega milissegundos depois — ou seja, a
 * chamada que recebe a rota nunca é a que a pediu. Para devolver a rota certa é preciso saber
 * QUEM está perguntando. Com `actorKey` a correspondência é por identidade: a rota do inimigo 7
 * só volta para o inimigo 7.
 *
 * Sem `actorKey` a correspondência é **geométrica e best-effort**: a resposta é entregue ao
 * primeiro pedido cuja origem esteja a até `staleRadius` da origem consultada e cujo destino
 * esteja a até `goalRadius` do destino consultado, e é consumida na entrega (dois atores
 * colados no mesmo alvo não recebem a mesma rota duas vezes). A rota entregue é sempre
 * geometricamente válida para quem a recebe, mas a identidade não é garantida — passe
 * `actorKey` quando houver horda.
 */

export interface NavigationBudget {
  /**
   * Herança da era main-thread: hoje a fatia é paga pelo worker, não pelo quadro.
   * Mantidos porque `PlanetScene` referencia `NAVIGATION_BUDGET` e porque o teto de
   * carregamento continua valendo.
   */
  readonly loadingSliceMs: number;
  /** Teto de tempo de carregamento antes de o HUD dizer "continuando em segundo plano". */
  readonly loadingCapMs: number;
  readonly playingSliceMs: number;
  /** Intervalo mínimo entre dois DESPACHOS de consulta, em segundos — global, não por ator. */
  readonly repathIntervalSeconds: number;

  /** Fatia que o worker gasta por rodada durante o carregamento. Fora da UI, pode ser grande. */
  readonly workerLoadingSliceMs?: number;
  /**
   * Fatia do worker com o jogo rodando. Menor de propósito: é o tempo máximo que uma consulta
   * de rota espera na fila do worker enquanto a construção ainda não acabou.
   */
  readonly workerPlayingSliceMs?: number;
  /** Deslocamento tolerado entre a origem consultada e a posição atual de quem recebe a rota. */
  readonly staleRadius?: number;
  /** Deslocamento tolerado do alvo (o jogador anda enquanto a consulta roda). */
  readonly goalRadius?: number;
  /** Validade de uma resposta ainda não entregue, em segundos. */
  readonly answerTtlSeconds?: number;
  /** Tempo sem `request()` até um slot de ator ser esquecido. */
  readonly slotIdleSeconds?: number;
  /** Teto de slots vivos — protege contra `actorKey` gerado por quadro. */
  readonly maxSlots?: number;
  /**
   * Suavizar a rota. `false` por padrão: a suavização é a parte cara da consulta (cada atalho é
   * provado com as mesmas sondas de apoio e varredura de cápsula) e o `PathFollower` anda
   * igualmente bem sobre a polilinha crua da grade.
   */
  readonly smoothPaths?: boolean;
}

export const NAVIGATION_BUDGET: NavigationBudget = {
  loadingSliceMs: 8,
  loadingCapMs: 12_000,
  playingSliceMs: 2,
  repathIntervalSeconds: 0.5,
  workerLoadingSliceMs: 50,
  workerPlayingSliceMs: 12,
  staleRadius: 6,
  goalRadius: 3,
  answerTtlSeconds: 2,
  slotIdleSeconds: 8,
  maxSlots: 64,
  smoothPaths: false,
};

/**
 * Manifesto aceito pelo serviço: o contrato de `src/planet-nav` **mais** a geometria de colisão.
 *
 * `PlanetManifest` (o manifesto real do jogo) já satisfaz os dois lados — `positions` e `indices`
 * são exatamente o par que `PlanetScene` entrega a `collision.setGeometry`. Ficam opcionais para
 * que um manifesto sintético de teste continue válido; sem eles o worker não tem o que construir
 * e o serviço diz isso em vez de fingir que está carregando.
 */
export type NavigationManifest = NavManifest & {
  readonly positions?: ArrayLike<number>;
  readonly indices?: ArrayLike<number>;
};

/** Canal com o worker, visto pelo serviço. Existe para o teste poder trocar o worker real. */
export interface NavWorkerHandle {
  post(message: NavWorkerRequest): void;
  close(): void;
}

export interface NavWorkerHost {
  message(message: NavWorkerResponse): void;
  /** Falha dura: worker que não nasceu, que morreu ou que mandou mensagem indecifrável. */
  failure(reason: string): void;
}

export type NavWorkerSpawn = (host: NavWorkerHost) => NavWorkerHandle;

/**
 * Worker de verdade. `new URL(..., import.meta.url)` é a forma que o Vite entende tanto em `dev`
 * quanto no `build` — sem plugin, sem entrada extra no `rollupOptions`.
 *
 * Fora do navegador (suíte em Node) `Worker` não existe: a falha vira diagnóstico, não exceção.
 */
export const spawnPlanetNavigationWorker: NavWorkerSpawn = host => {
  const worker = new Worker(new URL('./PlanetNavigation.worker.ts', import.meta.url), {type: 'module'});
  worker.onmessage = event => host.message(event.data as NavWorkerResponse);
  worker.onerror = event => host.failure(event.message || 'o worker de navegação falhou ao carregar');
  worker.onmessageerror = () => host.failure('o worker de navegação mandou uma mensagem indecifrável');
  return {
    post: message => worker.postMessage(message),
    close: () => worker.terminate(),
  };
};

/**
 * Um pedinte. Com `actorKey` o slot tem dono; sem, é anônimo e casa por proximidade.
 *
 * `query` é o `id` da consulta EM VOO. Uma resposta cujo `id` não bate com o `query` do slot é
 * jogada fora — é assim que se garante que ninguém recebe a rota de outro par.
 */
interface QuerySlot {
  readonly key: string | undefined;
  query: number;
  /** Par que originou a consulta em voo (ou a resposta guardada). */
  from: Vec3;
  to: Vec3;
  points: Vec3[] | undefined;
  /** Segundos desde que a resposta chegou. */
  answerAge: number;
  /** Segundos desde o último `request()` deste slot. */
  idle: number;
}

const gap = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const copy = (p: Vec3): Vec3 => ({x: p.x, y: p.y, z: p.z});

export class PlanetNavigationService {
  private readonly spawn: NavWorkerSpawn;
  private worker: NavWorkerHandle | undefined;
  private started = false;
  private disposed = false;

  private ratioValue = 0;
  private phaseValue = 'sample';
  private nodes = 0;
  private edges = 0;
  private readyValue = false;
  private failure = '';
  private startedAt = 0;
  private elapsedMs = 0;
  private buildMs = 0;
  private connectedIslands = 0;
  private totalIslands = 0;
  private defects: readonly string[] = [];

  private loading = true;
  private repathClock = 0;
  private sequence = 0;
  private readonly slots: QuerySlot[] = [];
  private readonly inflight = new Map<number, QuerySlot>();

  /** Consultas despachadas, recusadas por orçamento, entregues e descartadas por frescor. */
  queries = 0;
  rejected = 0;
  answers = 0;
  stale = 0;
  /** Pior consulta medida DENTRO do worker, em milissegundos — vai para o painel de verificação. */
  worstQueryMs = 0;

  /**
   * `collision` continua na assinatura de propósito: é o colisor da main thread, e o worker
   * monta o SEU. Mantê-lo aqui deixa a chamada de `PlanetScene` intacta e documenta que o
   * colisor da cena não é consultado pela navegação.
   */
  constructor(
    private readonly frame: NavFrame,
    collision: NavCollision,
    private readonly manifest: NavigationManifest,
    private readonly budget: NavigationBudget = NAVIGATION_BUDGET,
    spawn: NavWorkerSpawn = spawnPlanetNavigationWorker,
    private readonly options: Partial<NavOptions> | undefined = undefined,
  ) {
    void collision;
    this.spawn = spawn;
  }

  get ready(): boolean {return this.readyValue;}
  get ratio(): number {return this.ratioValue;}
  get phase(): string {return this.phaseValue;}
  get nodeCount(): number {return this.nodes;}
  get edgeCount(): number {return this.edges;}
  /** Motivo da degradação, vazio quando está tudo bem. */
  get error(): string {return this.failure;}
  /** `true` quando o teto de carregamento estourou e a construção segue em segundo plano. */
  get deferred(): boolean {
    return !this.readyValue && this.failure === '' && this.elapsedMs >= this.budget.loadingCapMs;
  }
  /** Consultas despachadas e ainda sem resposta. */
  get pending(): number {return this.inflight.size;}

  private get staleRadius(): number {return this.budget.staleRadius ?? 6;}
  private get goalRadius(): number {return this.budget.goalRadius ?? 3;}

  // ------------------------------------------------------------ ciclo de vida

  /**
   * Acorda o worker e manda a geometria. Idempotente; `build()` chama sozinho, mas chamar cedo
   * (assim que o manifesto existe) tira a construção inteira do caminho crítico.
   */
  /**
   * Informa ao worker os intervalos de triângulo que o cenário destruído tirou da colisão.
   *
   * Honestamente, o que isto compra: a BVH do worker para de afirmar que existe um prop que já
   * virou caco, então o encaixe (`nearestSafe`, que varre uma cápsula) deixa de recusar um nó que
   * ficou livre. O que NÃO compra: nó novo no espaço aberto — o grafo é estático e já foi montado.
   * A rota continua contornando, só não erra mais o encaixe.
   *
   * Seguro chamar antes do worker existir: a mensagem é ignorada e a próxima chamada reenvia o
   * conjunto inteiro (é o chamador que guarda o acumulado).
   */
  applyDisabledRanges(ranges: readonly {readonly start: number; readonly count: number}[]): boolean {
    if (this.disposed || ranges.length === 0 || !this.worker) return false;
    try {
      this.worker.post({type: 'disable', ranges: ranges.map(range => ({start: range.start, count: range.count}))});
      return true;
    } catch (error) {
      this.fail(error instanceof Error ? error.message : 'o canal do worker de navegação quebrou');
      return false;
    }
  }

  preload(): void {
    if (this.started || this.disposed) return;
    this.started = true;
    const positions = this.manifest.positions, indices = this.manifest.indices;
    if (!positions || positions.length === 0 || !indices || indices.length === 0) {
      this.fail('o manifesto do planeta não trouxe geometria de colisão para a navegação');
      return;
    }
    let handle: NavWorkerHandle;
    try {
      handle = this.spawn({
        message: message => this.receive(message),
        failure: reason => this.fail(reason),
      });
    } catch (error) {
      this.fail(error instanceof Error ? error.message : 'não foi possível criar o worker de navegação');
      return;
    }
    this.worker = handle;
    this.startedAt = this.clock();
    try {
      // Geometria é CLONADA, não transferida: transferir destacaria `manifest.positions` na main
      // thread e quebraria em silêncio quem mais ler o manifesto (auditoria, spawn, depuração).
      // O preço é uma serialização única de alguns dezenas de MB; o de travar a UI é maior.
      handle.post({
        type: 'build',
        frame: {centre: copy(this.frame.centre), surfaceRadius: this.frame.surfaceRadius},
        manifest: {islands: this.manifest.islands, bridges: this.manifest.bridges,
          ...(this.manifest.access ? {access: this.manifest.access} : {})},
        positions, indices,
        options: this.options ?? {},
        sliceMs: this.budget.workerLoadingSliceMs ?? 50,
      });
    } catch (error) {
      this.fail(error instanceof Error ? error.message : 'a geometria do planeta não coube na mensagem do worker');
    }
  }

  /**
   * Uma "fatia" de construção — que hoje não gasta nada da main thread. Devolve `true` enquanto
   * ainda há trabalho, para o laço de carregamento continuar esperando.
   *
   * `loading` deixou de escolher orçamento de quadro e passou a escolher o tamanho da fatia DO
   * WORKER: generosa antes de o jogador entrar, curta depois, para que uma consulta de rota não
   * espere uma fatia inteira na fila quando a construção ainda está rolando.
   */
  build(loading: boolean): boolean {
    if (this.disposed) return false;
    this.preload();
    if (this.failure !== '') return false;
    if (this.startedAt > 0 && !this.readyValue) this.elapsedMs = this.clock() - this.startedAt;
    if (loading !== this.loading) {
      this.loading = loading;
      this.worker?.post({
        type: 'slice',
        sliceMs: (loading ? this.budget.workerLoadingSliceMs : this.budget.workerPlayingSliceMs)
          ?? (loading ? 50 : 12),
      });
    }
    return !this.readyValue;
  }

  /** Relógio de orçamento e de frescor. Chamar uma vez por passo fixo. */
  tick(dt: number): void {
    this.repathClock = Math.max(0, this.repathClock - dt);
    const ttl = this.budget.answerTtlSeconds ?? 2, idleCap = this.budget.slotIdleSeconds ?? 8;
    for (let i = this.slots.length - 1; i >= 0; i--) {
      const slot = this.slots[i]!;
      slot.idle += dt;
      if (slot.points) {
        slot.answerAge += dt;
        if (slot.answerAge > ttl) {slot.points = undefined; this.stale++;}
      }
      if (slot.idle > idleCap && slot.query === 0) this.slots.splice(i, 1);
    }
  }

  /** Encerra o worker. Depois disso o serviço fica mudo — `request()` devolve `undefined`. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.readyValue = false;
    try {this.worker?.post({type: 'dispose'});} catch {/* worker já morto */}
    try {this.worker?.close();} catch {/* idem */}
    this.worker = undefined;
    this.slots.length = 0;
    this.inflight.clear();
  }

  // ------------------------------------------------------------ consulta

  /**
   * Pede — ou colhe — a rota entre dois pontos.
   *
   * O retorno é `PathFollower` **apenas** quando a resposta da consulta daquele ator/par já
   * chegou e ainda vale para a posição atual. Em todo o resto (grafo não pronto, consulta em
   * voo, orçamento fechado, worker caído, resposta velha) devolve `undefined`, que significa
   * "siga com o que você já tem" — nunca "vá em linha reta pelo vazio".
   *
   * `actorKey` é opcional por compatibilidade, mas é o único jeito de garantir identidade quando
   * vários atores perguntam ao mesmo tempo. Ver o cabeçalho do arquivo.
   */
  request(from: Vec3, to: Vec3, actorKey?: string): PathFollower | undefined {
    if (this.disposed || !this.readyValue) return undefined;
    const slot = this.slotFor(from, to, actorKey);

    if (slot?.points) {
      const points = slot.points;
      slot.points = undefined;
      slot.idle = 0;
      // Frescor medido contra a posição de AGORA, não contra a de quando se perguntou. É isto
      // que pega empurrão, queda no vazio e recuperação: o ator não está mais onde a rota começa,
      // então a rota é descartada e uma nova consulta sai no lugar.
      if (gap(from, slot.from) <= this.staleRadius && gap(to, slot.to) <= this.goalRadius) {
        this.answers++;
        return new PathFollower(this.frame, points);
      }
      this.stale++;
    }

    if (slot && slot.query !== 0) {
      slot.idle = 0;
      // Consulta em voo normalmente basta: esperar é mais barato que perguntar duas vezes.
      // A exceção é a recuperação — queda, empurrão, troca de bioma: se o ator já não está onde
      // a consulta começou, a resposta JÁ nasceu inútil, e segurar o slot só atrasa a rota boa
      // em uma ida e volta. Nesse caso a consulta em voo é substituída (e sua resposta,
      // descartada na chegada por não bater mais com o `id` do slot).
      if (gap(from, slot.from) <= this.staleRadius && gap(to, slot.to) <= this.goalRadius) return undefined;
    }
    if (this.repathClock > 0) {this.rejected++; if (slot) slot.idle = 0; return undefined;}
    this.dispatch(from, to, slot, actorKey);
    return undefined;
  }

  private slotFor(from: Vec3, to: Vec3, actorKey: string | undefined): QuerySlot | undefined {
    if (actorKey !== undefined) return this.slots.find(slot => slot.key === actorKey);
    // Anônimo: casa por geometria. Um slot só serve se a rota que ele guarda (ou que ele está
    // esperando) começa e termina onde ESTE pedido começa e termina, dentro das mesmas margens
    // que validam a entrega. Sem isso, um ator herdaria a rota de um par que não é o dele.
    return this.slots.find(slot => slot.key === undefined
      && gap(slot.from, from) <= this.staleRadius && gap(slot.to, to) <= this.goalRadius);
  }

  private dispatch(from: Vec3, to: Vec3, existing: QuerySlot | undefined, actorKey: string | undefined): void {
    const maxSlots = this.budget.maxSlots ?? 64;
    let slot = existing;
    if (!slot) {
      if (this.slots.length >= maxSlots) {
        // Teto estourado: derruba o slot mais esquecido em vez de crescer sem fim.
        let victim = 0;
        for (let i = 1; i < this.slots.length; i++) {
          if (this.slots[i]!.idle > this.slots[victim]!.idle) victim = i;
        }
        const dropped = this.slots.splice(victim, 1)[0];
        if (dropped && dropped.query !== 0) this.inflight.delete(dropped.query);
      }
      slot = {
        key: actorKey, query: 0, from: copy(from), to: copy(to),
        points: undefined, answerAge: 0, idle: 0,
      };
      this.slots.push(slot);
    }
    if (slot.query !== 0) this.inflight.delete(slot.query);
    slot.from = copy(from);
    slot.to = copy(to);
    slot.idle = 0;
    slot.points = undefined;
    const id = ++this.sequence;
    slot.query = id;
    this.inflight.set(id, slot);
    this.queries++;
    this.repathClock = this.budget.repathIntervalSeconds;
    try {
      this.worker?.post({type: 'path', id, from: copy(from), to: copy(to),
        smooth: this.budget.smoothPaths ?? false});
    } catch (error) {
      this.inflight.delete(id);
      slot.query = 0;
      this.fail(error instanceof Error ? error.message : 'o worker de navegação parou de responder');
    }
  }

  // ------------------------------------------------------------ worker → serviço

  private receive(message: NavWorkerResponse): void {
    if (this.disposed) return;
    switch (message.type) {
      case 'progress':
        this.phaseValue = message.phase;
        this.ratioValue = message.ratio;
        this.nodes = message.nodes;
        this.edges = message.edges;
        return;
      case 'ready':
        this.readyValue = true;
        this.phaseValue = 'done';
        this.ratioValue = 1;
        this.nodes = message.nodes;
        this.edges = message.edges;
        this.buildMs = message.buildMs;
        this.connectedIslands = message.connectedIslands;
        this.totalIslands = message.totalIslands;
        this.defects = message.defects;
        return;
      case 'path': {
        const slot = this.inflight.get(message.id);
        this.inflight.delete(message.id);
        if (message.elapsedMs > this.worstQueryMs) this.worstQueryMs = message.elapsedMs;
        // Resposta órfã (slot despejado) ou superada (o ator já pediu de novo): descartada.
        // É a garantia dura de que ninguém recebe a rota de outro par.
        if (!slot || slot.query !== message.id) return;
        slot.query = 0;
        if (!message.points || message.points.length < 3 || !message.reachable) {
          // "Não dá para ir a pé" NÃO vira cache: o grafo é estático, mas o alvo se move, e
          // guardar o negativo faria o ator desistir de um destino que ficou alcançável.
          slot.points = undefined;
          return;
        }
        const flat = message.points, points: Vec3[] = [];
        for (let i = 0; i + 2 < flat.length; i += 3) {
          points.push({x: flat[i]!, y: flat[i + 1]!, z: flat[i + 2]!});
        }
        slot.points = points;
        slot.answerAge = 0;
        return;
      }
      case 'failed':
        this.fail(message.message);
        return;
    }
  }

  private fail(reason: string): void {
    if (this.failure !== '') return;
    this.failure = reason;
    this.readyValue = false;
    // Sem worker não existe plano B barato: construir o grafo aqui custaria os 232 s medidos NA
    // THREAD DA UI. Quem chama recebe `undefined` para sempre e continua na perseguição local,
    // que já é o comportamento seguro deste serviço desde o primeiro dia.
    try {this.worker?.close();} catch {/* já morto */}
    this.worker = undefined;
    this.slots.length = 0;
    this.inflight.clear();
  }

  private clock(): number {
    return typeof performance === 'object' ? performance.now() : Date.now();
  }

  // ------------------------------------------------------------ diagnóstico

  /** Linha de diagnóstico para o painel F2. */
  readout(): string {
    if (this.failure !== '') {
      return `navegação indisponível · ${this.failure} · perseguição local`;
    }
    if (this.readyValue) {
      const islands = this.totalIslands > 0
        ? ` · ${this.connectedIslands}/${this.totalIslands} ilhas a pé` : '';
      const flawed = this.defects.length > 0 ? ` · ${this.defects.length} defeitos` : '';
      return `navegação pronta em ${(this.buildMs / 1000).toFixed(1)} s · ${this.nodes} nós${islands}`
        + ` · ${this.queries} consultas (${this.answers} entregues, ${this.rejected} adiadas,`
        + ` ${this.stale} vencidas, pior ${Math.round(this.worstQueryMs)} ms)${flawed}`;
    }
    if (!this.started) return 'navegação aguardando o mapa';
    return `navegação ${Math.round(this.ratioValue * 100)}% (${this.phaseValue}) no worker`
      + `${this.deferred ? ' · continuando em segundo plano' : ''}`;
  }

  /** Defeitos nomeados que o grafo reportou ao terminar — para a auditoria, não para o HUD. */
  get graphDefects(): readonly string[] {return this.defects;}
}
