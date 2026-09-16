import type {Vec3} from '../core/contracts';
import type {
  NavBaked, NavCollision, NavCoverage, NavFrame, NavManifest, NavOptions, NavPhase,
  NavProgress, NavRoute, NavSnap, NavStats,
} from './NavTypes';
import {NAV_BAKED_VERSION, resolveNavOptions} from './NavTypes';
import {NavGraph} from './NavGraph';
import {NavProbe} from './NavProbe';
import {directionAt, distance, normalize, scale, add, tangentBasis} from './NavMath';

type SampleJob =
  | {kind: 'island'; index: number; row: number; block: number}
  | {kind: 'spawn'; index: number}
  | {kind: 'bridge'; index: number; segment: number}
  | {kind: 'access'; index: number};

interface Counter {attempted: number; accepted: number; nodes: number}

/**
 * Granularidade das fatias.
 *
 * Uma sondagem de coluna custa até quatro consultas à BVH, e a BVW do planeta tem 1,5 milhão de
 * triângulos: um passo que processasse uma fileira inteira de ilha (58 colunas) ou 48 nós de
 * ligação estouraria qualquer orçamento de quadro. Os números abaixo existem para que
 * `build(8)` signifique mesmo 8 ms, e não "8 ms mais o que faltar do passo".
 */
const COLUMN_BLOCK = 8;
const LINK_CHUNK = 4;
const REFINE_CHUNK = 2;
const CONNECTOR_CHUNK = 2;

/**
 * Navegação consciente de colisão sobre o planeta.
 *
 * Substitui Detour/Recast, que é 2,5D e assume Y-up — num globo ele só funcionaria por carta
 * local, com emenda entre cartas. Aqui o grafo é feito de amostras radiais REAIS: cada nó nasceu
 * de um raio que partiu de fora do planeta, achou triângulo autoral, mediu a inclinação contra a
 * vertical local e provou que a cápsula cabe em pé ali. Cada aresta nasceu de sondas de apoio ao
 * longo do segmento mais uma varredura de cápsula.
 *
 * O que isso compra: não existe aresta atravessando o vazio entre duas ilhas, nem atravessando
 * parede de celeiro, nem encaixe de vinte metros que teleporta o ator para o outro lado de um muro.
 * O que isso custa: tempo de construção. Por isso `build(budgetMs)` é fatiado e reentrante.
 */
export class PlanetNavigation {
  private readonly options: NavOptions;
  private readonly probe: NavProbe;
  private readonly graph: NavGraph;
  private readonly jobs: SampleJob[] = [];
  private readonly islandCounters = new Map<string, Counter>();
  private readonly bridgeCounters = new Map<string, Counter>();
  /** Amostras de ponte sem piso, somadas por trecho — viram um defeito só no fecho. */
  private readonly bridgeGaps = new Map<string, number>();
  private readonly defects: string[] = [];

  private phase: NavPhase = 'sample';
  private jobCursor = 0;
  private linkCursor = 0;
  private refineQueue: number[] = [];
  private refineCursor = 0;
  private refineRound = 0;
  private refineSpent = 0;
  private ratioSeen = 0;
  private readonly candidates: number[] = [];
  /** Faixa contígua de nós de cada ponte, na ordem da densificação: ponta `a` primeiro. */
  private readonly bridgeRanges = new Map<string, {first: number; last: number}>();
  private connectorJobs: {node: number; island: string}[] = [];
  private connectorCursor = -1;
  private readonly mainComponents = new Map<string, number>();

  constructor(
    private readonly frame: NavFrame,
    collision: NavCollision,
    private readonly manifest: NavManifest,
    overrides?: Partial<NavOptions>,
  ) {
    this.options = resolveNavOptions(overrides);
    this.probe = new NavProbe(frame, collision, this.options);
    this.graph = new NavGraph(this.options.linkRadius);
    for (let i = 0; i < manifest.islands.length; i++) {
      const island = manifest.islands[i]!;
      this.islandCounters.set(island.id, {attempted: 0, accepted: 0, nodes: 0});
      const half = Math.max(1, Math.ceil(island.radius / this.options.islandSpacing));
      const blocks = Math.ceil((half * 2 + 1) / COLUMN_BLOCK);
      for (let row = 0; row <= half * 2; row++) {
        for (let block = 0; block < blocks; block++) this.jobs.push({kind: 'island', index: i, row, block});
      }
      this.jobs.push({kind: 'spawn', index: i});
    }
    for (let i = 0; i < manifest.bridges.length; i++) {
      const bridge = manifest.bridges[i]!;
      this.bridgeCounters.set(bridge.id, {attempted: 0, accepted: 0, nodes: 0});
      for (let segment = 1; segment < bridge.waypoints.length; segment++) {
        this.jobs.push({kind: 'bridge', index: i, segment});
      }
    }
    for (let i = 0; i < (manifest.access?.length ?? 0); i++) this.jobs.push({kind: 'access', index: i});
  }

  get ready(): boolean {return this.phase === 'done';}
  get nodeCount(): number {return this.graph.size;}
  get edgeCount(): number {return this.graph.edgeCount;}

  /** Uma fatia de construção. Sem argumento, constrói até o fim. Reentrante. */
  build(budgetMs = Infinity): NavProgress {
    const deadline = Number.isFinite(budgetMs) ? Date.now() + budgetMs : Infinity;
    while (this.phase !== 'done') {
      this.step();
      if (Date.now() >= deadline) break;
    }
    return this.progress();
  }

  buildAll(): NavProgress {return this.build();}

  private step(): void {
    switch (this.phase) {
      case 'sample': return this.stepSample();
      case 'link': return this.stepLink();
      case 'refine': return this.stepRefine();
      case 'finish': return this.stepFinish();
      case 'done': return;
    }
  }

  // ---------------------------------------------------------------- amostragem

  private stepSample(): void {
    if (this.jobCursor >= this.jobs.length) {this.phase = 'link'; return;}
    const job = this.jobs[this.jobCursor++]!;
    switch (job.kind) {
      case 'island': return this.sampleIslandRow(job.index, job.row, job.block);
      case 'spawn': return this.sampleSpawn(job.index);
      case 'bridge': return this.sampleBridge(job.index, job.segment);
      case 'access': return this.sampleAccess(job.index);
    }
  }

  /**
   * Uma linha da grade tangente de uma ilha.
   *
   * A grade é construída pelo mapa exponencial, então `spacing` é distância de ARCO de verdade —
   * a 72 m do centro, a projeção plana já erraria 2 % e abriria buraco justo na borda, que é
   * onde ficam as cabeceiras de ponte.
   */
  private sampleIslandRow(index: number, row: number, block: number): void {
    const island = this.manifest.islands[index]!;
    const o = this.options;
    const up = normalize(island.up);
    const {east, north} = tangentBasis(up);
    const half = Math.max(1, Math.ceil(island.radius / o.islandSpacing));
    const v = (row - half) * o.islandSpacing;
    const limit = island.radius * island.radius;
    const counter = this.islandCounters.get(island.id)!;
    const last = Math.min(half * 2, (block + 1) * COLUMN_BLOCK - 1);
    for (let column = block * COLUMN_BLOCK; column <= last; column++) {
      const u = (column - half) * o.islandSpacing;
      if (u * u + v * v > limit) continue;
      counter.attempted++;
      const direction = directionAt(up, east, north, u, v, this.frame.surfaceRadius);
      const layers = this.probe.column(direction);
      if (layers.length > 0) counter.accepted++;
      for (const layer of layers) if (this.addNode(layer.point, island.id)) counter.nodes++;
    }
  }

  /** O nascedouro autoral vira nó garantido — senão o primeiro `path()` da partida já falha. */
  private sampleSpawn(index: number): void {
    const island = this.manifest.islands[index]!;
    const counter = this.islandCounters.get(island.id)!;
    counter.attempted++;
    const direction = this.frame.up(island.spawn);
    const altitude = this.frame.radius(island.spawn) - this.frame.surfaceRadius;
    const layer = this.probe.layerNear(direction, this.frame.radius(island.spawn), Math.max(3, this.options.bridgeTolerance));
    if (!layer) {
      // Três causas diferentes, três mensagens diferentes: quem vai corrigir precisa saber se o
      // problema é falta de chão, falta de espaço para o corpo, ou spawn pendurado longe do convés.
      const surface = this.probe.firstSurface(direction);
      const standable = this.probe.column(direction);
      const where = `${island.id}" (spawn a ${altitude.toFixed(2)} m de altitude, ${fmt(island.spawn)})`;
      if (surface === undefined) {
        this.defects.push(`A ilha "${where} não tem piso NENHUM na coluna do spawn`);
      } else if (standable.length === 0) {
        this.defects.push(`A ilha "${where} tem piso a ${(surface - this.frame.surfaceRadius).toFixed(2)} m ` +
          `mas nenhuma camada onde a cápsula (${this.options.capsuleRadius * 2} × ${this.options.capsuleHeight} m) ` +
          `caiba em pé — teto baixo, prop ou vegetação por cima`);
      } else {
        this.defects.push(`A ilha "${where} está longe da camada pisável mais próxima ` +
          `(${(standable[0]!.radius - this.frame.surfaceRadius).toFixed(2)} m)`);
      }
      return;
    }
    counter.accepted++;
    if (this.graph.occupied(layer.point, this.options.islandSpacing * 0.25)) return;
    if (this.addNode(layer.point, island.id)) counter.nodes++;
  }

  /**
   * Ponte: densifica a polilinha autoral até `bridgeSpacing` e exige piso REAL em cada amostra,
   * na altura do convés autoral (`layerNear`) — não o primeiro triângulo da coluna, que num vão
   * com arco ou pórtico seria a estrutura por cima.
   *
   * Amostra sem piso não vira nó e conta como defeito: uma ponte com buraco tem de aparecer no
   * relatório, não virar um pulo silencioso sobre o vazio.
   */
  private sampleBridge(index: number, segment: number): void {
    const bridge = this.manifest.bridges[index]!;
    const o = this.options;
    const counter = this.bridgeCounters.get(bridge.id)!;
    const from = bridge.waypoints[segment - 1]!, to = bridge.waypoints[segment]!;
    const span = distance(from, to);
    const steps = Math.max(1, Math.ceil(span / o.bridgeSpacing));
    let missing = 0;
    for (let k = segment === 1 ? 0 : 1; k <= steps; k++) {
      const point = this.probe.between(from, to, k / steps);
      counter.attempted++;
      const layer = this.probe.layerNear(this.frame.up(point), this.frame.radius(point), o.bridgeTolerance);
      if (!layer) {missing++; continue;}
      counter.accepted++;
      if (this.graph.occupied(layer.point, o.bridgeSpacing * 0.25)) continue;
      if (!this.addNode(layer.point, bridge.id)) continue;
      counter.nodes++;
      const range = this.bridgeRanges.get(bridge.id);
      if (range) range.last = this.graph.size - 1;
      else this.bridgeRanges.set(bridge.id, {first: this.graph.size - 1, last: this.graph.size - 1});
    }
    if (missing > 0) {
      this.bridgeGaps.set(bridge.id, (this.bridgeGaps.get(bridge.id) ?? 0) + missing);
    }
  }

  /** Mancha densa em volta de um ponto autoral de acesso — a saída para portas estreitas. */
  private sampleAccess(index: number): void {
    const access = this.manifest.access?.[index];
    if (!access) return;
    const o = this.options;
    const up = this.frame.up(access.point);
    const {east, north} = tangentBasis(up);
    const reach = access.radius ?? o.accessPatchRadius;
    const targetRadius = this.frame.radius(access.point);
    const half = Math.max(1, Math.ceil(reach / o.accessSpacing));
    for (let row = 0; row <= half * 2; row++) {
      const v = (row - half) * o.accessSpacing;
      for (let column = 0; column <= half * 2; column++) {
        const u = (column - half) * o.accessSpacing;
        if (u * u + v * v > reach * reach) continue;
        const direction = directionAt(up, east, north, u, v, this.frame.surfaceRadius);
        const layer = this.probe.layerNear(direction, targetRadius, o.bridgeTolerance);
        if (!layer || this.graph.occupied(layer.point, o.accessSpacing * 0.45)) continue;
        this.addNode(layer.point, 'acesso');
      }
    }
  }

  private addNode(point: Vec3, owner: string): boolean {
    if (this.graph.size >= this.options.maxNodes) {
      if (this.defects.length === 0 || !this.defects[this.defects.length - 1]!.startsWith('Teto de nós'))
        this.defects.push(`Teto de nós (${this.options.maxNodes}) atingido: o mapa está incompleto`);
      return false;
    }
    this.graph.add(point, owner);
    return true;
  }

  // ---------------------------------------------------------------- ligação

  /**
   * Liga cada nó novo aos anteriores dentro do raio de ligação.
   *
   * Considerar só `j < i` garante que cada par seja avaliado UMA vez, inclusive depois do refino
   * acrescentar nós — o cursor continua de onde parou e nós velhos nunca são reprocessados.
   */
  private stepLink(): void {
    const o = this.options;
    const end = Math.min(this.graph.size, this.linkCursor + LINK_CHUNK);
    for (; this.linkCursor < end; this.linkCursor++) {
      const index = this.linkCursor;
      const point = this.graph.point(index);
      this.graph.query(point, o.linkRadius, this.candidates);
      // Só os anteriores (cada par uma vez) e só os mais próximos (custo por nó limitado).
      const nearest = this.candidates.filter(other => other < index);
      if (nearest.length > o.linkCandidates) {
        nearest.sort((a, b) => this.graph.distanceTo(a, point) - this.graph.distanceTo(b, point));
        nearest.length = o.linkCandidates;
      }
      for (const other of nearest) {
        const verdict = this.probe.link(point, this.graph.point(other), o.linkRadius, o.maxStep);
        if (verdict === 'ok') this.graph.connect(index, other, this.graph.distanceBetween(index, other));
      }
    }
    if (this.linkCursor < this.graph.size) return;
    if (this.refineRound < o.refineRounds && this.refineSpent < o.refineBudget) {
      this.prepareRefine();
      this.phase = 'refine';
      return;
    }
    this.phase = 'finish';
  }

  // ---------------------------------------------------------------- refino

  /**
   * Refino adaptativo: quem tem poucos vizinhos está numa borda, num gargalo ou numa soleira —
   * exatamente onde uma grade de 2,5 m erra. No meio de um campo aberto todo nó tem oito vizinhos
   * e não é tocado, então o custo é proporcional ao PERÍMETRO, não à área.
   *
   * Isto reduz a chance de perder uma porta; não elimina. Porta abaixo de ~0,8 m continua
   * intransponível pela cápsula, e o caminho honesto para 0,8–2,5 m é `manifest.access`.
   */
  private prepareRefine(): void {
    this.refineQueue = [];
    this.refineCursor = 0;
    for (let i = 0; i < this.graph.size; i++) {
      if (this.graph.degree(i) < this.options.refineDegree) this.refineQueue.push(i);
    }
  }

  private stepRefine(): void {
    const o = this.options;
    const spacing = o.islandSpacing / Math.pow(2, this.refineRound + 1);
    const end = Math.min(this.refineQueue.length, this.refineCursor + REFINE_CHUNK);
    for (; this.refineCursor < end; this.refineCursor++) {
      if (this.refineSpent >= o.refineBudget) break;
      const seed = this.refineQueue[this.refineCursor]!;
      const centre = this.graph.point(seed);
      const owner = this.graph.owner(seed);
      const up = this.frame.up(centre);
      const {east, north} = tangentBasis(up);
      const targetRadius = this.frame.radius(centre);
      for (let row = -2; row <= 2; row++) {
        for (let column = -2; column <= 2; column++) {
          if (row === 0 && column === 0) continue;
          const direction = directionAt(up, east, north, column * spacing, row * spacing, this.frame.surfaceRadius);
          const layer = this.probe.layerNear(direction, targetRadius, o.maxStep * 3);
          if (!layer || this.graph.occupied(layer.point, spacing * 0.45)) continue;
          if (!this.addNode(layer.point, owner)) break;
          this.refineSpent++;
        }
      }
    }
    if (this.refineCursor < this.refineQueue.length && this.refineSpent < o.refineBudget) return;
    this.refineRound++;
    this.refineQueue = [];
    this.phase = 'link';
  }

  // ---------------------------------------------------------------- conectores e fecho

  /**
   * Conector explícito de cabeceira de ponte.
   *
   * A junta ponte/ilha é o lugar onde o autor tem licença para deixar um desnível maior que o
   * degrau normal e onde a grade da ilha pode simplesmente não ter caído perto o bastante. Se
   * essa junta falhar, a ponte existe no mapa e não serve para nada — o pior defeito possível.
   * Por isso a tentativa é feita de propósito, com alcance maior (8 m) e degrau maior (0,6 m),
   * mas com as MESMAS provas de piso e de cápsula: nada passa sem chão contínuo embaixo.
   *
   * É um RECURSO, não um acréscimo: a cabeceira que a ligação normal já resolveu não entra na
   * fila. Sem isso o grafo ganharia arestas de 8 m em toda junta que já funcionava.
   *
   * O critério de "já resolvida" é COMPONENTE CONEXO, não dono do nó. A grade da ilha passa por
   * cima do convés da ponte na sobreposição e produz nós que pertencem à ilha mas estão presos ao
   * tabuleiro da ponte; medir por dono diria "encostou" justo na junta que está quebrada.
   */
  private buildConnectorJobs(): void {
    const o = this.options;
    this.connectorJobs = [];
    for (const bridge of this.manifest.bridges) {
      const range = this.bridgeRanges.get(bridge.id);
      if (!range) continue;
      const nodes: number[] = [];
      for (let i = range.first; i <= range.last; i++) if (this.graph.owner(i) === bridge.id) nodes.push(i);
      if (nodes.length === 0) continue;
      const sides = [{id: bridge.a, ordered: nodes}, {id: bridge.b, ordered: [...nodes].reverse()}];
      for (const side of sides) {
        const main = this.mainComponent(side.id);
        if (main < 0) continue;
        const reach = Math.min(o.connectorSamples, side.ordered.length);
        let resolved = false;
        for (let k = 0; k < reach && !resolved; k++) resolved = this.touches(side.ordered[k]!, main);
        if (resolved) continue;
        for (let k = 0; k < reach; k++) this.connectorJobs.push({node: side.ordered[k]!, island: side.id});
      }
    }
  }

  /**
   * Componente do corpo principal de uma ilha: o do nó mais próximo do centro do convés autoral.
   * Nós soltos numa laje de telhado ou no tabuleiro sobreposto da ponte não valem como "a ilha".
   */
  private mainComponent(islandId: string): number {
    const cached = this.mainComponents.get(islandId);
    if (cached !== undefined) return cached;
    const island = this.manifest.islands.find(entry => entry.id === islandId);
    let best = -1, bestGap = Infinity;
    if (island) {
      for (let i = 0; i < this.graph.size; i++) {
        if (this.graph.owner(i) !== islandId) continue;
        const gap = this.graph.distanceTo(i, island.centre);
        if (gap < bestGap) {bestGap = gap; best = this.graph.componentOf(i);}
      }
    }
    this.mainComponents.set(islandId, best);
    return best;
  }

  private stepConnectors(): void {
    const o = this.options;
    const end = Math.min(this.connectorJobs.length, this.connectorCursor + CONNECTOR_CHUNK);
    for (; this.connectorCursor < end; this.connectorCursor++) {
      const job = this.connectorJobs[this.connectorCursor]!;
      const point = this.graph.point(job.node);
      const main = this.mainComponent(job.island);
      const found = this.graph.query(point, o.connectorRadius, []);
      found.sort((a, b) => this.graph.distanceTo(a, point) - this.graph.distanceTo(b, point));
      let tested = 0;
      for (const other of found) {
        if (tested >= o.connectorCandidates) break;
        if (other === job.node || this.graph.componentOf(other) !== main) continue;
        if (this.graph.neighbours(job.node).includes(other)) continue;
        tested++;
        if (this.probe.link(point, this.graph.point(other), o.connectorRadius, o.connectorStep) !== 'ok') continue;
        this.graph.connect(job.node, other, this.graph.distanceBetween(job.node, other));
      }
    }
  }

  private stepFinish(): void {
    if (this.connectorCursor < 0) {
      // Componentes provisórios: é com eles que se sabe qual cabeceira ficou solta.
      this.graph.finish();
      this.buildConnectorJobs();
      this.connectorCursor = 0;
      return;
    }
    if (this.connectorCursor < this.connectorJobs.length) {this.stepConnectors(); return;}
    this.graph.finish();
    this.mainComponents.clear();
    const byOwner = new Map<string, number[]>();
    for (let i = 0; i < this.graph.size; i++) {
      const list = byOwner.get(this.graph.owner(i));
      if (list) list.push(i); else byOwner.set(this.graph.owner(i), [i]);
    }
    for (const island of this.manifest.islands) {
      const counter = this.islandCounters.get(island.id)!;
      if (counter.nodes === 0) this.defects.push(`A ilha "${island.id}" não produziu nenhum nó caminhável`);
    }
    for (const bridge of this.manifest.bridges) {
      const counter = this.bridgeCounters.get(bridge.id)!;
      const missing = this.bridgeGaps.get(bridge.id) ?? 0;
      if (missing > 0) {
        this.defects.push(`A ponte "${bridge.id}" (${bridge.a}→${bridge.b}) tem ${missing} ` +
                          `de ${counter.attempted} amostras sem piso`);
      }
      if (counter.nodes === 0) {
        this.defects.push(`A ponte "${bridge.id}" não produziu nenhum nó caminhável`);
        continue;
      }
      // Ponte que não encosta na ilha é ponte decorativa: tem de sair nomeada no relatório.
      const mine = byOwner.get(bridge.id) ?? [];
      for (const side of [bridge.a, bridge.b]) {
        const main = this.mainComponent(side);
        if (main < 0 || mine.some(index => this.touches(index, main))) continue;
        this.defects.push(`A ponte "${bridge.id}" não encosta no convés da ilha "${side}"`);
      }
    }
    this.phase = 'done';
  }

  /** O nó tem aresta para o corpo principal da ilha (componente `main`)? */
  private touches(index: number, main: number): boolean {
    if (this.graph.componentOf(index) === main) return true;
    for (const other of this.graph.neighbours(index)) if (this.graph.componentOf(other) === main) return true;
    return false;
  }

  private progress(): NavProgress {
    const raw = this.phase === 'done' ? 1
      : this.phase === 'finish' ? 0.98
      : this.phase === 'refine' ? 0.9
      : this.phase === 'link' ? 0.6 + 0.3 * ratio(this.linkCursor, this.graph.size)
      : 0.6 * ratio(this.jobCursor, this.jobs.length);
    this.ratioSeen = Math.max(this.ratioSeen, raw);
    return {
      done: this.phase === 'done',
      phase: this.phase,
      ratio: this.ratioSeen,
      nodes: this.graph.size,
      edges: this.graph.edgeCount,
    };
  }

  // ---------------------------------------------------------------- consulta

  /**
   * Nó seguro mais próximo de `p`.
   *
   * Duas travas contra o encaixe mentiroso: um teto de distância (`snapRadius`, 6 m por padrão —
   * nada de encaixar a vinte metros) e uma varredura de cápsula até o nó. Encostar num muro e
   * pedir caminho não pode devolver um nó do outro lado do muro.
   *
   * A varredura vai do nó até a COLUNA de `p` na altura do próprio nó, não até `p` cru. A pergunta
   * que interessa é "há parede entre nós dois", e quem pergunta muitas vezes está no ar: caindo,
   * saltando, ou num spawn autoral dois metros acima do convés. Varrer até o ponto cru fazia a
   * cápsula subir através da copa das árvores e o encaixe falhava — foi o que isolou as catorze
   * ilhas dos spawns na primeira auditoria.
   */
  nearestSafe(p: Vec3, maxSnap = this.options.snapRadius): NavSnap | undefined {
    if (!this.ready) return undefined;
    const found = this.graph.query(p, maxSnap, []);
    if (found.length === 0) return undefined;
    found.sort((a, b) => this.graph.distanceTo(a, p) - this.graph.distanceTo(b, p));
    const limit = Math.min(found.length, this.options.snapCandidates);
    const up = this.frame.up(p);
    for (let i = 0; i < limit; i++) {
      const index = found[i]!;
      const point = this.graph.point(index);
      const gap = this.graph.distanceTo(index, p);
      const level = add(this.frame.centre, scale(up, this.frame.radius(point)));
      if (gap <= this.options.capsuleRadius || this.probe.clearSweep(point, level)) {
        return {node: index, point, distance: gap};
      }
    }
    return undefined;
  }

  /** `true` quando os dois pontos caem no mesmo componente conexo — sem rodar o A\*. */
  reachable(from: Vec3, to: Vec3): boolean {
    const start = this.nearestSafe(from), goal = this.nearestSafe(to);
    if (!start || !goal) return false;
    return this.graph.componentOf(start.node) === this.graph.componentOf(goal.node);
  }

  /**
   * Caminho completo. Nunca devolve `undefined`: quem chama lê `reachable`.
   *
   * `smooth: false` devolve a polilinha crua da grade (pernas de 2,5 m) e pula a etapa cara —
   * é a opção certa para uma horda que repede rota a cada segundo, já que o seguidor não se
   * importa com o serrilhado.
   */
  route(from: Vec3, to: Vec3, options?: {smooth?: boolean}): NavRoute {
    const start = this.nearestSafe(from), goal = this.nearestSafe(to);
    if (!start || !goal) return {points: [], distance: Infinity, reachable: false, start, goal};
    const found = this.graph.search(start.node, goal.node);
    if (!found) return {points: [], distance: Infinity, reachable: false, start, goal};
    const raw = found.nodes.map(node => this.graph.point(node));
    const points = options?.smooth === false ? raw : this.smooth(raw);
    let total = 0;
    for (let i = 1; i < points.length; i++) total += distance(points[i - 1]!, points[i]!);
    return {points, distance: total, reachable: true, start, goal};
  }

  /** Polilinha do convés, ou `undefined` quando não dá para ir a pé. */
  path(from: Vec3, to: Vec3, options?: {smooth?: boolean}): Vec3[] | undefined {
    const route = this.route(from, to, options);
    return route.reachable ? [...route.points] : undefined;
  }

  /**
   * Metros de caminhada; `Infinity` quando não alcança.
   *
   * Custa uma rota inteira, e de propósito: devolver aqui o comprimento cru da grade enquanto
   * `route()` devolve o suavizado criaria duas "distâncias" diferentes para o mesmo trajeto.
   * Quem quiser a estimativa barata pede `route(from, to, {smooth: false}).distance`.
   */
  distance(from: Vec3, to: Vec3): number {return this.route(from, to).distance;}

  nodesOf(owner: string): Vec3[] {
    const out: Vec3[] = [];
    for (let i = 0; i < this.graph.size; i++) if (this.graph.owner(i) === owner) out.push(this.graph.point(i));
    return out;
  }

  /**
   * Corta cantos do caminho bruto, mas só por atalho PROVADO: mesma sonda de apoio e mesma
   * varredura de cápsula das arestas. Um atalho nunca corta por cima do vazio nem por dentro de
   * um muro; no pior caso o caminho fica igual ao da grade.
   */
  private smooth(points: readonly Vec3[]): Vec3[] {
    if (points.length <= 2) return [...points];
    const out: Vec3[] = [points[0]!];
    let i = 0;
    while (i < points.length - 1) {
      let next = i + 1, tried = 0;
      const far = Math.min(points.length - 1, i + 8);
      for (let j = far; j > i + 1 && tried < this.options.smoothingTests; j--) {
        const a = points[i]!, b = points[j]!;
        if (distance(a, b) > this.options.smoothingRange) continue;
        tried++;
        if (this.probe.supportAlong(a, b) && this.probe.clearSweep(a, b)) {next = j; break;}
      }
      out.push(points[next]!);
      i = next;
    }
    return out;
  }

  // ---------------------------------------------------------------- assar e carregar

  /**
   * Congela o grafo pronto. Só depois de `ready`; antes disso devolve `undefined` em vez de um
   * mapa pela metade que pareceria completo depois de gravado.
   */
  serialize(signature: string): NavBaked | undefined {
    if (!this.ready) return undefined;
    const owners: string[] = [];
    const index = new Map<string, number>();
    const ownerOf: number[] = [];
    const nodes: number[] = [];
    for (let i = 0; i < this.graph.size; i++) {
      const point = this.graph.point(i);
      nodes.push(Math.round(point.x * 1000) / 1000, Math.round(point.y * 1000) / 1000,
                 Math.round(point.z * 1000) / 1000);
      const owner = this.graph.owner(i);
      let slot = index.get(owner);
      if (slot === undefined) {slot = owners.length; owners.push(owner); index.set(owner, slot);}
      ownerOf.push(slot);
    }
    const stats = this.stats();
    return {
      version: NAV_BAKED_VERSION,
      signature,
      nodes, owners, ownerOf,
      edges: this.graph.edgePairs(),
      islands: stats.islands,
      bridges: stats.bridges,
      defects: [...this.defects],
    };
  }

  /**
   * Reconstrói a navegação a partir de um grafo assado, sem tocar na geometria.
   *
   * Devolve `undefined` — e não um objeto quebrado — quando a versão, a assinatura ou o desenho do
   * manifesto não batem. Quem chama cai de volta para `build()`. Um mapa assado de um asset antigo
   * é pior que nenhum mapa: ele tem caminhos bonitos por cima de chão que não existe mais.
   */
  static load(
    frame: NavFrame, collision: NavCollision, manifest: NavManifest, baked: NavBaked,
    options?: {signature?: string; overrides?: Partial<NavOptions>},
  ): PlanetNavigation | undefined {
    if (baked.version !== NAV_BAKED_VERSION) return undefined;
    if (options?.signature !== undefined && options.signature !== baked.signature) return undefined;
    if (baked.islands.length !== manifest.islands.length) return undefined;
    if (baked.bridges.length !== manifest.bridges.length) return undefined;
    if (baked.nodes.length % 3 !== 0 || baked.ownerOf.length * 3 !== baked.nodes.length) return undefined;
    if (baked.edges.length % 2 !== 0) return undefined;
    const navigation = new PlanetNavigation(frame, collision, manifest, options?.overrides);
    const count = baked.ownerOf.length;
    for (let i = 0; i < count; i++) {
      const owner = baked.owners[baked.ownerOf[i]!] ?? '';
      navigation.graph.add(
        {x: baked.nodes[i * 3]!, y: baked.nodes[i * 3 + 1]!, z: baked.nodes[i * 3 + 2]!}, owner);
    }
    for (let i = 0; i < baked.edges.length; i += 2) {
      const a = baked.edges[i]!, b = baked.edges[i + 1]!;
      if (a < 0 || b < 0 || a >= count || b >= count) return undefined;
      navigation.graph.connect(a, b, navigation.graph.distanceBetween(a, b));
    }
    navigation.graph.finish();
    for (const entry of baked.islands) {
      navigation.islandCounters.set(entry.id, {attempted: entry.attempted, accepted: entry.accepted, nodes: entry.nodes});
    }
    for (const entry of baked.bridges) {
      navigation.bridgeCounters.set(entry.id, {attempted: entry.attempted, accepted: entry.accepted, nodes: entry.nodes});
    }
    navigation.defects.push(...baked.defects);
    navigation.jobCursor = navigation.jobs.length;
    navigation.linkCursor = navigation.graph.size;
    navigation.connectorCursor = 0;
    navigation.connectorJobs = [];
    navigation.ratioSeen = 1;
    navigation.phase = 'done';
    return navigation;
  }

  // ---------------------------------------------------------------- relatório

  stats(): NavStats {
    const islands: NavCoverage[] = this.manifest.islands.map(island => coverage(island.id, this.islandCounters));
    const bridges: NavCoverage[] = this.manifest.bridges.map(bridge => coverage(bridge.id, this.bridgeCounters));
    // Agrupar por componente do CORPO PRINCIPAL de cada ilha. Ancorar na primeira ilha da lista
    // daria um número sem sentido sempre que justo essa ilha fosse a quebrada.
    const byComponent = new Map<number, string[]>();
    for (const island of this.manifest.islands) {
      const main = this.mainComponent(island.id);
      if (main < 0) continue;
      const list = byComponent.get(main);
      if (list) list.push(island.id); else byComponent.set(main, [island.id]);
    }
    const groups = [...byComponent.values()].sort((a, b) => b.length - a.length);
    const connected = groups[0]?.length ?? 0;
    const defects = [...this.defects];
    if (connected < this.manifest.islands.length) {
      defects.push(`Só ${connected} de ${this.manifest.islands.length} ilhas estão ligadas a pé`);
    }
    return {
      nodes: this.graph.size,
      edges: this.graph.edgeCount,
      components: this.graph.components,
      islands, bridges, groups,
      connectedIslands: connected,
      totalIslands: this.manifest.islands.length,
      longestEdge: this.graph.longestEdge(),
      defects,
    };
  }
}

const ratio = (done: number, total: number): number => (total <= 0 ? 1 : Math.min(1, done / total));

const coverage = (id: string, counters: Map<string, Counter>): NavCoverage => {
  const counter = counters.get(id) ?? {attempted: 0, accepted: 0, nodes: 0};
  return {id, nodes: counter.nodes, attempted: counter.attempted, accepted: counter.accepted};
};

const fmt = (p: Vec3): string => `${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}`;

/** Ponto da superfície nominal numa direção — atalho de depuração, não usado pela construção. */
export const surfacePoint = (frame: NavFrame, direction: Vec3, altitude = 0): Vec3 =>
  add(frame.centre, scale(normalize(direction), frame.surfaceRadius + altitude));
