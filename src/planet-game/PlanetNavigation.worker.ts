import type {Vec3} from '../core/contracts';
import {PlanetCollision} from '../planet/PlanetCollision';
import {PlanetNavigation} from '../planet-nav';
import type {NavFrame, NavManifest, NavOptions, NavPhase} from '../planet-nav';

/**
 * Worker de navegação do planeta.
 *
 * Por que existir: a auditoria contra o asset real (`.temp/planet-navigation-audit.md`) mediu
 * **232 s de construção com pior fatia de 3915 ms** e `path()` com p95 de 1528 ms. Fatiar isso na
 * main thread só troca um travamento de quatro segundos por centenas de engasgos — o quadro
 * continua sendo pago pelo jogador. Aqui a construção inteira e TODA consulta rodam noutra thread;
 * a main thread só serializa a geometria uma vez e depois recebe polilinhas prontas.
 *
 * O worker monta a **sua própria BVH** (`PlanetCollision`) a partir do `positions/indices` do
 * manifesto real. Não há colisor compartilhado: `SharedArrayBuffer` exigiria COOP/COEP no host e
 * a BVH da main thread é um grafo de objetos que nem é transferível. Uma cópia de 1,5 M de
 * triângulos custa memória; custa MENOS que 232 s de UI travada.
 *
 * Este módulo é importável em teste: ele só se pendura no escopo de worker quando está mesmo
 * dentro de um (`createPlanetNavWorker` é a porta pura, `handle()` é síncrono e determinístico).
 */

// ------------------------------------------------------------------ protocolo

export interface NavWorkerFrame {
  readonly centre: Vec3;
  readonly surfaceRadius: number;
}

export type NavWorkerRequest =
  /** Geometria real + manifesto. Uma vez só; repetir é ignorado. */
  | {
      readonly type: 'build';
      readonly frame: NavWorkerFrame;
      readonly manifest: NavManifest;
      readonly positions: ArrayLike<number>;
      readonly indices: ArrayLike<number>;
      readonly options: Partial<NavOptions>;
      readonly sliceMs: number;
    }
  /** Troca o tamanho da fatia (carregamento generoso ⇄ jogo, para responder consulta mais cedo). */
  | {readonly type: 'slice'; readonly sliceMs: number}
  | {readonly type: 'path'; readonly id: number; readonly from: Vec3; readonly to: Vec3; readonly smooth: boolean}
  /**
   * Intervalos de triângulo que a main thread removeu (cenário destruído).
   *
   * O que isto conserta, dito sem inflar: a BVH **deste** worker deixa de afirmar que existe um
   * prop que já virou caco, então o encaixe (`nearestSafe`, que faz varredura de cápsula) para de
   * recusar um nó livre. O que isto NÃO faz: acrescentar nós no espaço que abriu — o grafo é
   * estático e já foi montado. A rota continua contornando o vão; ela só não erra mais o encaixe.
   */
  | {readonly type: 'disable'; readonly ranges: readonly {readonly start: number; readonly count: number}[]}
  | {readonly type: 'dispose'};

export type NavWorkerResponse =
  | {
      readonly type: 'progress';
      readonly phase: NavPhase; readonly ratio: number;
      readonly nodes: number; readonly edges: number;
    }
  | {
      readonly type: 'ready';
      readonly nodes: number; readonly edges: number; readonly buildMs: number;
      readonly connectedIslands: number; readonly totalIslands: number;
      readonly defects: readonly string[];
    }
  /**
   * Resposta de UMA consulta. `points` vem achatado (`x,y,z,x,y,z…`) e é transferido:
   * a polilinha mais longa da auditoria tem 12 m de perna e poucas dezenas de pontos.
   * `points === undefined` significa "não dá para ir a pé daqui até lá" — nunca "tente de novo
   * com outra rota".
   */
  | {
      readonly type: 'path';
      readonly id: number;
      readonly points: Float64Array | undefined;
      readonly reachable: boolean;
      readonly distance: number;
      readonly elapsedMs: number;
    }
  | {readonly type: 'failed'; readonly message: string};

/**
 * Perfil **econômico**, medido na auditoria contra o asset final.
 *
 * | perfil | tempo | pior fatia | nós | ilhas ligadas |
 * |---|---|---|---|---|
 * | padrão (`islandSpacing 2.5`, `refineRounds 1`) | 232 s | 3915 ms | 30.185 | 10 de 14 |
 * | econômico | **11 s** | 1525 ms | 3.000 | **10 de 14** |
 *
 * A conectividade do mapa é idêntica: o refino a 1,25 m compra soleira estreita, não travessia.
 * Dez vezes menos nós também derrubam o A\*, que é o que faz a consulta caber em milissegundos.
 * Quem quiser a grade fina passa `options` no `build` — o worker não tem opinião própria.
 */
export const NAV_WORKER_OPTIONS: Partial<NavOptions> = {
  islandSpacing: 3.5,
  refineRounds: 0,
};

// ------------------------------------------------------------------ núcleo puro

/**
 * `NavFrame` reconstruído a partir de dois números.
 *
 * `PlanetFrame` é uma classe — não atravessa `postMessage`. Só `up()` e `radius()` interessam à
 * navegação, e ambos são a mesma matemática do núcleo, incluindo a queda para `+Y` no centro
 * exato (sem isso, um ponto degenerado vira NaN e contamina o grafo inteiro).
 */
export function sphericalNavFrame(config: NavWorkerFrame): NavFrame {
  const centre: Vec3 = {x: config.centre.x, y: config.centre.y, z: config.centre.z};
  return {
    centre,
    surfaceRadius: config.surfaceRadius,
    radius(p: Vec3): number {
      return Math.hypot(p.x - centre.x, p.y - centre.y, p.z - centre.z);
    },
    up(p: Vec3): Vec3 {
      const dx = p.x - centre.x, dy = p.y - centre.y, dz = p.z - centre.z;
      const l = Math.hypot(dx, dy, dz);
      return l < 1e-12 ? {x: 0, y: 1, z: 0} : {x: dx / l, y: dy / l, z: dz / l};
    },
  };
}

export interface NavWorkerCore {
  /** Consome uma mensagem da main thread. Nunca lança: falha vira `{type: 'failed'}`. */
  handle(message: NavWorkerRequest): void;
  /** Só para teste/diagnóstico. */
  readonly ready: boolean;
}

type Emit = (message: NavWorkerResponse, transfer: Transferable[]) => void;
type Schedule = (run: () => void) => void;

const now = (): number => (typeof performance === 'object' ? performance.now() : Date.now());

/**
 * Máquina do worker, sem nenhum global.
 *
 * `schedule` existe para que o teste conduza a construção passo a passo em vez de esperar
 * `setTimeout`. Em produção é `setTimeout(run, 0)`: ceder o laço entre fatias é o que deixa uma
 * consulta de rota chegar durante a construção — a fila de mensagens do worker só é drenada
 * quando a pilha desenrola.
 */
export function createPlanetNavWorker(emit: Emit, schedule: Schedule = run => {setTimeout(run, 0);}): NavWorkerCore {
  let navigation: PlanetNavigation | undefined;
  /** A BVH deste worker, guardada para receber as remoções de cenário depois da construção. */
  let built: PlanetCollision | undefined;
  /** Remoções que chegaram antes de a geometria existir aqui. */
  const pendingDisabled: {start: number; count: number}[] = [];
  let sliceMs = 50;
  let scheduled = false;
  let disposed = false;
  let startedAt = 0;

  const fail = (error: unknown): void => {
    navigation = undefined;
    disposed = true;
    emit({type: 'failed', message: error instanceof Error ? error.message : String(error)}, []);
  };

  const pump = (): void => {
    scheduled = false;
    const nav = navigation;
    if (disposed || !nav || nav.ready) return;
    try {
      const progress = nav.build(sliceMs);
      emit({
        type: 'progress', phase: progress.phase, ratio: progress.ratio,
        nodes: progress.nodes, edges: progress.edges,
      }, []);
      if (!progress.done) {schedulePump(); return;}
      const stats = nav.stats();
      emit({
        type: 'ready', nodes: stats.nodes, edges: stats.edges, buildMs: now() - startedAt,
        connectedIslands: stats.connectedIslands, totalIslands: stats.totalIslands,
        defects: stats.defects,
      }, []);
    } catch (error) {
      fail(error);
    }
  };

  function schedulePump(): void {
    if (scheduled || disposed) return;
    scheduled = true;
    schedule(pump);
  }

  const answer = (request: Extract<NavWorkerRequest, {type: 'path'}>): void => {
    const started = now();
    const nav = navigation;
    // Consulta antes de `ready` não é erro: é uma corrida legítima entre a mensagem `ready` e o
    // pedido do ator. Responder "não alcança" com `points: undefined` faz o cliente liberar o
    // slot e tentar de novo, em vez de guardar um "não existe caminho" que nunca foi medido.
    if (!nav || !nav.ready) {
      emit({type: 'path', id: request.id, points: undefined, reachable: false, distance: Infinity,
        elapsedMs: now() - started}, []);
      return;
    }
    const route = nav.route(request.from, request.to, {smooth: request.smooth});
    if (!route.reachable || route.points.length === 0) {
      emit({type: 'path', id: request.id, points: undefined, reachable: false, distance: Infinity,
        elapsedMs: now() - started}, []);
      return;
    }
    const points = new Float64Array(route.points.length * 3);
    for (let i = 0; i < route.points.length; i++) {
      const p = route.points[i]!;
      points[i * 3] = p.x; points[i * 3 + 1] = p.y; points[i * 3 + 2] = p.z;
    }
    emit({
      type: 'path', id: request.id, points, reachable: true, distance: route.distance,
      elapsedMs: now() - started,
    }, [points.buffer]);
  };

  return {
    get ready(): boolean {return navigation?.ready ?? false;},
    handle(message: NavWorkerRequest): void {
      if (disposed && message.type !== 'dispose') return;
      try {
        switch (message.type) {
          case 'build': {
            if (navigation) return;
            startedAt = now();
            const collision = new PlanetCollision();
            collision.setGeometry(message.positions, message.indices);
            if (collision.triangleCount === 0) throw new Error('a geometria do planeta chegou vazia no worker');
            built = collision;
            // Cenário destruído antes de a construção terminar não se perde: a fila é aplicada aqui.
            for (const range of pendingDisabled) collision.disableTriangles(range.start, range.count);
            pendingDisabled.length = 0;
            sliceMs = message.sliceMs > 0 ? message.sliceMs : 50;
            navigation = new PlanetNavigation(
              sphericalNavFrame(message.frame), collision, message.manifest, message.options,
            );
            schedulePump();
            return;
          }
          case 'slice':
            if (message.sliceMs > 0) sliceMs = message.sliceMs;
            return;
          case 'path':
            answer(message);
            return;
          case 'disable':
            for (const range of message.ranges) {
              if (built) built.disableTriangles(range.start, range.count);
              else pendingDisabled.push(range);
            }
            return;
          case 'dispose':
            disposed = true;
            navigation = undefined;
            built = undefined;
            pendingDisabled.length = 0;
            return;
        }
      } catch (error) {
        fail(error);
      }
    },
  };
}

// ------------------------------------------------------------------ amarração ao escopo de worker

/** Superfície mínima do escopo de worker — `lib.dom` não declara `DedicatedWorkerGlobalScope`. */
interface WorkerScope {
  postMessage(message: NavWorkerResponse, transfer?: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: {data: NavWorkerRequest}) => void): void;
}

const scope = (globalThis as {self?: unknown}).self as WorkerScope | undefined;
const insideWorker = scope !== undefined
  && typeof scope.postMessage === 'function'
  && typeof scope.addEventListener === 'function'
  && typeof (globalThis as {window?: unknown}).window === 'undefined';

if (insideWorker && scope) {
  const core = createPlanetNavWorker((message, transfer) => {
    scope.postMessage(message, transfer.length > 0 ? transfer : undefined);
  });
  scope.addEventListener('message', event => core.handle(event.data));
}
