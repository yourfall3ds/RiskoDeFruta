import {describe, expect, it} from 'vitest';
import type {Vec3} from '../src/core/contracts';
import {PLANET, PlanetFrame} from '../src/planet/PlanetFrame';
import {PlanetCollision} from '../src/planet/PlanetCollision';
import {directionAt, tangentBasis} from '../src/planet-nav/NavMath';
import {
  NAV_WORKER_OPTIONS, createPlanetNavWorker, sphericalNavFrame,
} from '../src/planet-game/PlanetNavigation.worker';
import type {NavWorkerRequest, NavWorkerResponse} from '../src/planet-game/PlanetNavigation.worker';
import {
  NAVIGATION_BUDGET, PlanetNavigationService, spawnPlanetNavigationWorker,
} from '../src/planet-game/PlanetNavigationService';
import type {
  NavigationBudget, NavigationManifest, NavWorkerHandle, NavWorkerHost, NavWorkerSpawn,
} from '../src/planet-game/PlanetNavigationService';

/**
 * Suíte FOCADA do worker de navegação. Não mede o grafo (isso é `tests/planet-navigation.test.ts`,
 * de outro dono): mede o CONTRATO entre main thread e worker — quem constrói onde, quem recebe
 * qual rota, o que acontece quando a resposta chega velha e o que sobra quando o worker morre.
 *
 * A geometria abaixo é um colisor sintético minúsculo (uma calota de 12 m), não arte de jogo:
 * o objetivo é provar o caminho das mensagens com um grafo real, não auditar o planeta.
 */

const frame = new PlanetFrame(PLANET);
const R = PLANET.surfaceRadius;
const UP: Vec3 = {x: 0, y: 1, z: 0};
const {east: EAST, north: NORTH} = tangentBasis(UP);

/** Ponto a `u` metros de arco para leste e `v` para o norte do polo `UP`. */
const at = (u: number, v: number, altitude = 0): Vec3 => {
  const d = directionAt(UP, EAST, NORTH, u, v, R);
  return {x: d.x * (R + altitude), y: d.y * (R + altitude), z: d.z * (R + altitude)};
};

/** Convés quadriculado de `radius` metros de arco em volta de `UP`. */
function deck(radius: number, spacing: number): {positions: number[]; indices: number[]} {
  const positions: number[] = [], indices: number[] = [];
  const vertex = (p: Vec3): number => {positions.push(p.x, p.y, p.z); return positions.length / 3 - 1;};
  const half = Math.ceil(radius / spacing);
  for (let row = -half; row < half; row++) {
    for (let column = -half; column < half; column++) {
      const u0 = column * spacing, v0 = row * spacing, u1 = u0 + spacing, v1 = v0 + spacing;
      const a = vertex(at(u0, v0)), b = vertex(at(u1, v0)), c = vertex(at(u1, v1)), d = vertex(at(u0, v1));
      indices.push(a, b, c, a, c, d);
    }
  }
  return {positions, indices};
}

const GEOMETRY = deck(12, 1);

const ISLAND_MANIFEST: NavigationManifest = {
  islands: [{id: 'ilha', up: UP, centre: at(0, 0), spawn: at(0, 0), radius: 9}],
  bridges: [],
  positions: GEOMETRY.positions,
  indices: GEOMETRY.indices,
};

/** Manifesto de protocolo: geometria simbólica, porque nenhum teste desta parte constrói grafo. */
const STUB_MANIFEST: NavigationManifest = {
  islands: [{id: 'ilha', up: UP, centre: at(0, 0), spawn: at(0, 0), radius: 4}],
  bridges: [],
  positions: [0, R, 0, 1, R, 0, 0, R, 1],
  indices: [0, 1, 2],
};

const BUDGET: NavigationBudget = {...NAVIGATION_BUDGET, repathIntervalSeconds: 0.5};

// ------------------------------------------------------------------ worker falso (protocolo)

interface FakeWorker {
  readonly spawn: NavWorkerSpawn;
  readonly sent: NavWorkerRequest[];
  reply(message: NavWorkerResponse): void;
  die(reason: string): void;
  readonly closed: () => boolean;
  /** Últimos `path` despachados, na ordem. */
  paths(): Extract<NavWorkerRequest, {type: 'path'}>[];
}

function fakeWorker(options?: {throwOnPost?: boolean; throwOnSpawn?: boolean}): FakeWorker {
  const sent: NavWorkerRequest[] = [];
  let host: NavWorkerHost | undefined;
  let closed = false;
  const spawn: NavWorkerSpawn = h => {
    if (options?.throwOnSpawn) throw new Error('Worker não existe neste ambiente');
    host = h;
    const handle: NavWorkerHandle = {
      post: message => {
        if (options?.throwOnPost && message.type === 'path') throw new Error('canal fechado');
        sent.push(message);
      },
      close: () => {closed = true;},
    };
    return handle;
  };
  return {
    spawn, sent,
    reply: message => host?.message(message),
    die: reason => host?.failure(reason),
    closed: () => closed,
    paths: () => sent.filter((m): m is Extract<NavWorkerRequest, {type: 'path'}> => m.type === 'path'),
  };
}

const flat = (points: readonly Vec3[]): Float64Array => {
  const out = new Float64Array(points.length * 3);
  points.forEach((p, i) => {out[i * 3] = p.x; out[i * 3 + 1] = p.y; out[i * 3 + 2] = p.z;});
  return out;
};

const ready = (nodes = 120): NavWorkerResponse => ({
  type: 'ready', nodes, edges: nodes * 4, buildMs: 11_000,
  connectedIslands: 10, totalIslands: 14, defects: [],
});

function service(worker: FakeWorker, manifest: NavigationManifest = STUB_MANIFEST): PlanetNavigationService {
  const collision = new PlanetCollision();
  return new PlanetNavigationService(frame, collision, manifest, BUDGET, worker.spawn);
}

describe('PlanetNavigationService fala com um worker de verdade', () => {
  it('manda geometria e manifesto uma vez só e não constrói nada na main thread', () => {
    const worker = fakeWorker(), nav = service(worker, ISLAND_MANIFEST);
    expect(worker.sent).toHaveLength(0);          // construtor não faz trabalho pesado

    expect(nav.build(true)).toBe(true);
    expect(nav.build(true)).toBe(true);
    const builds = worker.sent.filter(m => m.type === 'build');
    expect(builds).toHaveLength(1);
    const build = builds[0]!;
    if (build.type !== 'build') throw new Error('mensagem errada');
    expect(build.positions.length).toBe(GEOMETRY.positions.length);
    expect(build.indices.length).toBe(GEOMETRY.indices.length);
    expect(build.frame.surfaceRadius).toBe(R);
    expect(build.manifest.islands).toHaveLength(1);
    expect(nav.ready).toBe(false);
    expect(nav.readout()).toContain('worker');
  });

  it('a geometria da main thread continua intacta: clonada, nunca transferida', () => {
    const positions = new Float64Array([0, R, 0, 1, R, 0, 0, R, 1]);
    const indices = new Uint32Array([0, 1, 2]);
    const worker = fakeWorker();
    const nav = service(worker, {islands: STUB_MANIFEST.islands, bridges: [], positions, indices});
    nav.preload();
    expect(positions.length).toBe(9);             // buffer não destacado
    expect(indices.length).toBe(3);
  });

  it('troca a fatia do worker quando o jogo sai do carregamento', () => {
    const worker = fakeWorker(), nav = service(worker);
    nav.build(true);
    nav.build(false);
    const slice = worker.sent.find(m => m.type === 'slice');
    expect(slice).toBeDefined();
    if (slice?.type !== 'slice') throw new Error('mensagem errada');
    expect(slice.sliceMs).toBe(BUDGET.workerPlayingSliceMs);
  });

  it('não consulta antes de o grafo ficar pronto', () => {
    const worker = fakeWorker(), nav = service(worker);
    nav.build(true);
    worker.reply({type: 'progress', phase: 'sample', ratio: 0.4, nodes: 10, edges: 2});
    expect(nav.ratio).toBeCloseTo(0.4);
    expect(nav.readout()).toContain('40%');
    expect(nav.request(at(0, 0), at(5, 0))).toBeUndefined();
    expect(worker.paths()).toHaveLength(0);
  });

  it('devolve o PathFollower só quando a resposta daquele ator chega', () => {
    const worker = fakeWorker(), nav = service(worker);
    nav.build(true);
    worker.reply(ready());
    const from = at(0, 0), to = at(6, 0);

    expect(nav.request(from, to, 'inimigo-7')).toBeUndefined();   // despacha
    const query = worker.paths()[0];
    expect(query).toBeDefined();
    expect(nav.pending).toBe(1);
    expect(nav.request(from, to, 'inimigo-7')).toBeUndefined();   // em voo: não duplica
    expect(worker.paths()).toHaveLength(1);

    const route = [at(0, 0), at(3, 0), at(6, 0)];
    worker.reply({type: 'path', id: query!.id, points: flat(route), reachable: true,
      distance: 6, elapsedMs: 7});
    expect(nav.pending).toBe(0);

    const follower = nav.request(from, to, 'inimigo-7');
    expect(follower).toBeDefined();
    expect(follower!.waypoints).toHaveLength(3);
    expect(follower!.waypoints[2]!.x).toBeCloseTo(route[2]!.x, 6);
    expect(nav.answers).toBe(1);
  });

  it('nunca entrega a rota de outro par', () => {
    const worker = fakeWorker(), nav = service(worker);
    nav.build(true);
    worker.reply(ready());
    const to = at(6, 0);

    nav.request(at(0, 0), to, 'a');
    nav.tick(1);
    nav.request(at(0, 4), to, 'b');
    const [queryA, queryB] = worker.paths();
    expect(queryA).toBeDefined(); expect(queryB).toBeDefined();
    expect(queryA!.id).not.toBe(queryB!.id);

    worker.reply({type: 'path', id: queryA!.id, points: flat([at(0, 0), to]), reachable: true,
      distance: 6, elapsedMs: 5});
    expect(nav.request(at(0, 4), to, 'b')).toBeUndefined();       // b não herda a rota de a
    expect(nav.request(at(0, 0), to, 'a')).toBeDefined();
  });

  it('descarta resposta superada e resposta órfã', () => {
    const worker = fakeWorker(), nav = service(worker);
    nav.build(true);
    worker.reply(ready());
    const from = at(0, 0), to = at(6, 0);
    nav.request(from, to, 'a');
    const first = worker.paths()[0]!;

    // O ator caiu e se recuperou longe: a próxima pergunta é outro par, e a resposta antiga,
    // que chega depois, não pode virar rota de ninguém.
    nav.tick(1);
    nav.request(at(0, 9), to, 'a');
    const second = worker.paths()[1]!;
    expect(second.id).not.toBe(first.id);
    worker.reply({type: 'path', id: first.id, points: flat([from, to]), reachable: true,
      distance: 6, elapsedMs: 4});
    expect(nav.request(at(0, 9), to, 'a')).toBeUndefined();

    worker.reply({type: 'path', id: second.id, points: flat([at(0, 9), to]), reachable: true,
      distance: 6, elapsedMs: 4});
    expect(nav.request(at(0, 9), to, 'a')).toBeDefined();
  });

  it('resposta que não vale mais para a posição atual é descartada e repetida', () => {
    const worker = fakeWorker(), nav = service(worker);
    nav.build(true);
    worker.reply(ready());
    const from = at(0, 0), to = at(6, 0);
    nav.request(from, to, 'a');
    const query = worker.paths()[0]!;
    worker.reply({type: 'path', id: query.id, points: flat([from, to]), reachable: true,
      distance: 6, elapsedMs: 4});

    nav.tick(1);
    // Empurrão de 20 m: mais que `staleRadius`. A rota guardada não serve.
    expect(nav.request(at(0, 20), to, 'a')).toBeUndefined();
    expect(nav.stale).toBe(1);
    expect(worker.paths()).toHaveLength(2);
  });

  it('resposta envelhecida além do TTL vence sozinha', () => {
    const worker = fakeWorker(), nav = service(worker);
    nav.build(true);
    worker.reply(ready());
    const from = at(0, 0), to = at(6, 0);
    nav.request(from, to, 'a');
    worker.reply({type: 'path', id: worker.paths()[0]!.id, points: flat([from, to]),
      reachable: true, distance: 6, elapsedMs: 4});
    nav.tick(3);                                   // answerTtlSeconds = 2
    expect(nav.request(from, to, 'a')).toBeUndefined();
    expect(nav.stale).toBe(1);
  });

  it('"não alcança" não vira cache: o alvo se move', () => {
    const worker = fakeWorker(), nav = service(worker);
    nav.build(true);
    worker.reply(ready());
    const from = at(0, 0), to = at(6, 0);
    nav.request(from, to, 'a');
    worker.reply({type: 'path', id: worker.paths()[0]!.id, points: undefined, reachable: false,
      distance: Infinity, elapsedMs: 3});
    nav.tick(1);
    expect(nav.request(from, to, 'a')).toBeUndefined();
    expect(worker.paths()).toHaveLength(2);        // perguntou de novo
  });

  it('respeita o intervalo mínimo entre despachos', () => {
    const worker = fakeWorker(), nav = service(worker);
    nav.build(true);
    worker.reply(ready());
    nav.request(at(0, 0), at(6, 0), 'a');
    nav.request(at(0, 4), at(6, 0), 'b');
    expect(worker.paths()).toHaveLength(1);
    expect(nav.rejected).toBe(1);
    nav.tick(BUDGET.repathIntervalSeconds);
    nav.request(at(0, 4), at(6, 0), 'b');
    expect(worker.paths()).toHaveLength(2);
  });

  it('sem actorKey, casa por geometria e consome a resposta uma vez só', () => {
    const worker = fakeWorker(), nav = service(worker);
    nav.build(true);
    worker.reply(ready());
    const from = at(0, 0), to = at(6, 0);
    nav.request(from, to);
    worker.reply({type: 'path', id: worker.paths()[0]!.id, points: flat([from, to]),
      reachable: true, distance: 6, elapsedMs: 4});
    nav.tick(1);
    expect(nav.request(at(0.5, 0), to)).toBeDefined();   // dentro de staleRadius
    nav.tick(1);
    expect(nav.request(at(0.5, 0), to)).toBeUndefined(); // consumida
  });

  it('o teto de slots não cresce sem fim com actorKey descartável', () => {
    const worker = fakeWorker();
    const collision = new PlanetCollision();
    const nav = new PlanetNavigationService(
      frame, collision, STUB_MANIFEST,
      {...BUDGET, repathIntervalSeconds: 0, maxSlots: 4}, worker.spawn,
    );
    nav.build(true);
    worker.reply(ready());
    for (let i = 0; i < 40; i++) nav.request(at(0, 0), at(6, 0), `efêmero-${i}`);
    expect(worker.paths()).toHaveLength(40);
    expect(nav.pending).toBeLessThanOrEqual(4);
  });

  it('worker morto vira diagnóstico e perseguição local, nunca construção na UI', () => {
    const worker = fakeWorker(), nav = service(worker);
    nav.build(true);
    worker.reply(ready());
    worker.die('o worker de navegação falhou ao carregar');
    expect(nav.ready).toBe(false);
    expect(nav.error).toContain('falhou');
    expect(nav.readout()).toContain('perseguição local');
    expect(nav.request(at(0, 0), at(6, 0), 'a')).toBeUndefined();
    expect(nav.build(true)).toBe(false);           // não fica preso no laço de carregamento
    expect(worker.closed()).toBe(true);
  });

  it('worker que nem nasce degrada com motivo, sem lançar', () => {
    const worker = fakeWorker({throwOnSpawn: true}), nav = service(worker);
    expect(() => nav.build(true)).not.toThrow();
    expect(nav.error).toContain('Worker');
    expect(nav.request(at(0, 0), at(6, 0))).toBeUndefined();
  });

  it('manifesto sem geometria é recusado com motivo', () => {
    const worker = fakeWorker();
    const collision = new PlanetCollision();
    const nav = new PlanetNavigationService(
      frame, collision, {islands: STUB_MANIFEST.islands, bridges: []}, BUDGET, worker.spawn,
    );
    nav.build(true);
    expect(nav.error).toContain('geometria');
    expect(worker.sent).toHaveLength(0);
  });

  it('canal que quebra no meio do despacho também degrada', () => {
    const worker = fakeWorker({throwOnPost: true}), nav = service(worker);
    nav.build(true);
    worker.reply(ready());
    expect(() => nav.request(at(0, 0), at(6, 0), 'a')).not.toThrow();
    expect(nav.error).not.toBe('');
    expect(nav.pending).toBe(0);
  });

  it('dispose fecha o worker e cala o serviço', () => {
    const worker = fakeWorker(), nav = service(worker);
    nav.build(true);
    worker.reply(ready());
    nav.dispose();
    expect(worker.closed()).toBe(true);
    expect(nav.ready).toBe(false);
    expect(nav.request(at(0, 0), at(6, 0), 'a')).toBeUndefined();
    worker.reply(ready());                          // mensagem atrasada não ressuscita nada
    expect(nav.ready).toBe(false);
  });

  it('o spawn padrão não explode fora do navegador', () => {
    const collision = new PlanetCollision();
    const nav = new PlanetNavigationService(frame, collision, STUB_MANIFEST, BUDGET, spawnPlanetNavigationWorker);
    expect(() => nav.build(true)).not.toThrow();
    expect(nav.ready).toBe(false);
    expect(nav.error).not.toBe('');
    expect(nav.readout()).toContain('perseguição local');
  });
});

// ------------------------------------------------------------------ worker de verdade, em processo

/** Conduz o worker real sem `setTimeout`: cada `drain()` é uma fatia. */
function driven(): {spawn: NavWorkerSpawn; drain: (rounds?: number) => void} {
  const tasks: (() => void)[] = [];
  const spawn: NavWorkerSpawn = host => {
    const core = createPlanetNavWorker(message => host.message(message), run => tasks.push(run));
    return {post: message => core.handle(message), close: () => {tasks.length = 0;}};
  };
  const drain = (rounds = 5000): void => {
    for (let i = 0; i < rounds && tasks.length > 0; i++) tasks.shift()!();
  };
  return {spawn, drain};
}

describe('o worker constrói e consulta de verdade, fora da main thread', () => {
  it('monta a própria BVH a partir do manifesto e responde rota real', () => {
    const responses: NavWorkerResponse[] = [];
    const tasks: (() => void)[] = [];
    const core = createPlanetNavWorker(message => responses.push(message), run => tasks.push(run));

    core.handle({
      type: 'build',
      frame: {centre: PLANET.centre, surfaceRadius: R},
      manifest: {islands: ISLAND_MANIFEST.islands, bridges: []},
      positions: GEOMETRY.positions, indices: GEOMETRY.indices,
      options: NAV_WORKER_OPTIONS, sliceMs: 50,
    });
    for (let i = 0; i < 5000 && tasks.length > 0; i++) tasks.shift()!();

    const done = responses.find(m => m.type === 'ready');
    expect(done).toBeDefined();
    if (done?.type !== 'ready') throw new Error('sem ready');
    expect(done.nodes).toBeGreaterThan(10);
    expect(core.ready).toBe(true);
    expect(responses.some(m => m.type === 'progress')).toBe(true);

    core.handle({type: 'path', id: 42, from: at(-6, 0), to: at(6, 0), smooth: false});
    const answer = responses.find(m => m.type === 'path');
    if (answer?.type !== 'path') throw new Error('sem resposta de rota');
    expect(answer.id).toBe(42);
    expect(answer.reachable).toBe(true);
    expect(answer.points).toBeDefined();
    expect(answer.points!.length % 3).toBe(0);
    expect(answer.distance).toBeGreaterThan(8);
  });

  it('geometria vazia vira falha declarada, não grafo fantasma', () => {
    const responses: NavWorkerResponse[] = [];
    const core = createPlanetNavWorker(message => responses.push(message), () => {});
    core.handle({
      type: 'build', frame: {centre: PLANET.centre, surfaceRadius: R},
      manifest: {islands: ISLAND_MANIFEST.islands, bridges: []},
      positions: [], indices: [], options: {}, sliceMs: 50,
    });
    const failed = responses.find(m => m.type === 'failed');
    expect(failed).toBeDefined();
    expect(core.ready).toBe(false);
  });

  it('consulta antes de ready responde "não alcança", não uma rota inventada', () => {
    const responses: NavWorkerResponse[] = [];
    const core = createPlanetNavWorker(message => responses.push(message), () => {});
    core.handle({type: 'path', id: 1, from: at(0, 0), to: at(6, 0), smooth: false});
    const answer = responses[0];
    if (answer?.type !== 'path') throw new Error('sem resposta');
    expect(answer.points).toBeUndefined();
    expect(answer.reachable).toBe(false);
  });

  it('sphericalNavFrame reproduz o referencial do núcleo', () => {
    const rebuilt = sphericalNavFrame({centre: PLANET.centre, surfaceRadius: R});
    const p = at(7, -3, 12);
    expect(rebuilt.radius(p)).toBeCloseTo(frame.radius(p), 9);
    expect(rebuilt.up(p).x).toBeCloseTo(frame.up(p).x, 12);
    expect(rebuilt.up(p).y).toBeCloseTo(frame.up(p).y, 12);
    expect(rebuilt.up(p).z).toBeCloseTo(frame.up(p).z, 12);
    expect(rebuilt.up(PLANET.centre)).toEqual({x: 0, y: 1, z: 0});
  });

  it('ponta a ponta: serviço + worker real entregam um PathFollower andável', () => {
    const {spawn, drain} = driven();
    const collision = new PlanetCollision();
    const nav = new PlanetNavigationService(
      frame, collision, ISLAND_MANIFEST,
      {...BUDGET, repathIntervalSeconds: 0}, spawn, NAV_WORKER_OPTIONS,
    );

    expect(nav.build(true)).toBe(true);
    drain();
    expect(nav.ready).toBe(true);
    expect(nav.build(false)).toBe(false);
    expect(nav.readout()).toContain('navegação pronta');

    const from = at(-6, 0), to = at(6, 0);
    expect(nav.request(from, to, 'inimigo-1')).toBeUndefined();   // despacha
    const follower = nav.request(from, to, 'inimigo-1');
    expect(follower).toBeDefined();
    const step = follower!.update(from);
    expect(step.arrived).toBe(false);
    expect(Math.hypot(step.direction.x, step.direction.y, step.direction.z)).toBeCloseTo(1, 6);
    // A marcha é tangente ao planeta: nenhuma componente radial.
    const up = frame.up(from);
    expect(step.direction.x * up.x + step.direction.y * up.y + step.direction.z * up.z).toBeCloseTo(0, 6);
    expect(nav.worstQueryMs).toBeGreaterThanOrEqual(0);
  });
});
