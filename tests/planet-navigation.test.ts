import {describe, expect, it} from 'vitest';
import type {Vec3} from '../src/core/contracts';
import {PLANET, PlanetFrame} from '../src/planet/PlanetFrame';
import {PlanetCollision} from '../src/planet/PlanetCollision';
import {PlanetNavigation, PathFollower} from '../src/planet-nav';
import type {NavCollision, NavFrame, NavManifest, NavOptions} from '../src/planet-nav';
import {directionAt, distance, dot, normalize, scale, slerp, tangentBasis} from '../src/planet-nav/NavMath';

/**
 * Fixtures de TRIÂNGULO sintético, invisíveis: nada aqui é arte de mundo, é colisor de teste.
 * O que se mede é o comportamento do grafo diante de piso real, buraco real, parede real e teto
 * real — não diante de uma esfera ideal.
 */

const R = PLANET.surfaceRadius;
const frame = new PlanetFrame(PLANET);
const UP_A: Vec3 = {x: 0, y: 1, z: 0};
const {east: EAST, north: NORTH} = tangentBasis(UP_A);
const ARC = 70;

class Mesh {
  readonly positions: number[] = [];
  readonly indices: number[] = [];

  vertex(p: Vec3): number {
    this.positions.push(p.x, p.y, p.z);
    return this.positions.length / 3 - 1;
  }
  quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3): void {
    const i0 = this.vertex(a), i1 = this.vertex(b), i2 = this.vertex(c), i3 = this.vertex(d);
    this.indices.push(i0, i1, i2, i0, i2, i3);
  }
}

/** Ponto do mundo a `u` metros de arco para leste e `v` para o norte do polo de `up`. */
const at = (up: Vec3, u: number, v: number, altitude = 0): Vec3 => {
  const {east, north} = tangentBasis(up);
  return scale(directionAt(up, east, north, u, v, R), R + altitude);
};

/** Coordenadas tangentes aproximadas de um ponto perto de `UP_A` (erro < 0,1 % a 18 m). */
const uv = (p: Vec3): {u: number; v: number} => ({u: dot(p, EAST), v: dot(p, NORTH)});

/** Onde a polilinha cruza o plano `u = position`, medido em `v`. `undefined` = nunca cruzou. */
function crossingV(points: readonly Vec3[], position: number): number | undefined {
  for (let i = 1; i < points.length; i++) {
    const a = uv(points[i - 1]!), b = uv(points[i]!);
    if ((a.u - position) * (b.u - position) > 0) continue;
    const t = Math.abs(b.u - a.u) < 1e-9 ? 0 : (position - a.u) / (b.u - a.u);
    return a.v + (b.v - a.v) * t;
  }
  return undefined;
}

function deck(mesh: Mesh, up: Vec3, radius: number, altitude = 0, spacing = 2): void {
  const half = Math.ceil(radius / spacing);
  const inside = (u: number, v: number): boolean => u * u + v * v <= radius * radius;
  for (let row = -half; row < half; row++) {
    for (let column = -half; column < half; column++) {
      const u0 = column * spacing, v0 = row * spacing, u1 = u0 + spacing, v1 = v0 + spacing;
      if (!inside(u0, v0) || !inside(u1, v0) || !inside(u1, v1) || !inside(u0, v1)) continue;
      mesh.quad(at(up, u0, v0, altitude), at(up, u1, v0, altitude),
                at(up, u1, v1, altitude), at(up, u0, v1, altitude));
    }
  }
}

/** Convés de ponte ao longo do círculo máximo que passa por `UP_A` na direção leste. */
function strip(mesh: Mesh, fromArc: number, toArc: number, width: number, spacing = 2, altitude = 0): void {
  const steps = Math.max(1, Math.ceil((toArc - fromArc) / spacing));
  for (let i = 0; i < steps; i++) {
    const a = fromArc + (toArc - fromArc) * (i / steps);
    const b = fromArc + (toArc - fromArc) * ((i + 1) / steps);
    mesh.quad(at(UP_A, a, -width / 2, altitude), at(UP_A, b, -width / 2, altitude),
              at(UP_A, b, width / 2, altitude), at(UP_A, a, width / 2, altitude));
  }
}

/** Parede vertical em `u = position`, com porta opcional centrada em `v = 0`. */
function wall(mesh: Mesh, position: number, span: number, height: number, door = 0): void {
  const segments: readonly (readonly [number, number])[] = door > 0
    ? [[-span, -door / 2], [door / 2, span]]
    : [[-span, span]];
  for (const [v0, v1] of segments) {
    const steps = Math.max(1, Math.ceil((v1 - v0) / 2));
    for (let i = 0; i < steps; i++) {
      const a = v0 + (v1 - v0) * (i / steps), b = v0 + (v1 - v0) * ((i + 1) / steps);
      mesh.quad(at(UP_A, position, a, 0), at(UP_A, position, b, 0),
                at(UP_A, position, b, height), at(UP_A, position, a, height));
    }
  }
}

/**
 * Laje sobre o convés — telhado de celeiro ou teto baixo.
 *
 * Tesselada de propósito: um único quad de 16 m sobre R=200 afunda 0,3 m no meio (a corda passa
 * por dentro da esfera) e o teste passaria a medir o erro do fixture em vez da navegação.
 */
const slab = (mesh: Mesh, radius: number, altitude: number): void => deck(mesh, UP_A, radius, altitude);

const UP_B: Vec3 = normalize(at(UP_A, ARC, 0));

const island = (id: string, up: Vec3, radius: number) =>
  ({id, up, centre: scale(up, R), spawn: scale(up, R + 1), radius});

const TWO_ISLANDS: NavManifest = {
  islands: [island('alfa', UP_A, 18), island('beta', UP_B, 18)],
  bridges: [{
    id: 'vao', a: 'alfa', b: 'beta', width: 6,
    waypoints: [at(UP_A, 14, 0), at(UP_A, ARC / 2, 0), at(UP_A, ARC - 14, 0)],
  }],
};

const ALFA_ONLY = (radius = 18): NavManifest => ({islands: [island('alfa', UP_A, radius)], bridges: []});

const FAST: Partial<NavOptions> = {refineRounds: 0};

function collisionOf(mesh: Mesh): PlanetCollision {
  const collision = new PlanetCollision();
  collision.setGeometry(mesh.positions, mesh.indices);
  return collision;
}

function archipelago(gap = 0): PlanetCollision {
  const mesh = new Mesh();
  deck(mesh, UP_A, 18);
  deck(mesh, UP_B, 18);
  if (gap > 0) {
    strip(mesh, 14, ARC / 2 - gap / 2, 6);
    strip(mesh, ARC / 2 + gap / 2, ARC - 14, 6);
  } else {
    strip(mesh, 14, ARC - 14, 6);
  }
  return collisionOf(mesh);
}

const built = (collision: PlanetCollision, manifest: NavManifest, options: Partial<NavOptions> = FAST) => {
  const navigation = new PlanetNavigation(frame, collision, manifest, options);
  navigation.buildAll();
  return navigation;
};

const island1 = (mesh: Mesh): PlanetCollision => {deck(mesh, UP_A, 18); return collisionOf(mesh);};

describe('PlanetNavigation — contrato estrutural com o núcleo', () => {
  it('PlanetFrame e PlanetCollision satisfazem as portas sem import cruzado', () => {
    // Se o núcleo mudar a assinatura, isto quebra no `typecheck` em vez de quebrar no jogo.
    const port: NavFrame = frame;
    const world: NavCollision = new PlanetCollision();
    expect(port.surfaceRadius).toBe(R);
    expect(port.radius(at(UP_A, 0, 0, 5))).toBeCloseTo(R + 5, 9);
    expect(world.raycast(scale(UP_A, R + 10), scale(UP_A, -1), 20)).toBeUndefined();
    expect(world.supportBelow(scale(UP_A, R), UP_A, 1, 1)).toBeUndefined();
    expect(world.deepestContact?.(scale(UP_A, R), UP_A, 0.35, 1.8)).toBeUndefined();
  });

  it('não responde consulta antes de terminar de construir', () => {
    const navigation = new PlanetNavigation(frame, archipelago(), TWO_ISLANDS, FAST);
    expect(navigation.ready).toBe(false);
    expect(navigation.path(TWO_ISLANDS.islands[0]!.spawn, TWO_ISLANDS.islands[1]!.spawn)).toBeUndefined();
    expect(navigation.nearestSafe(TWO_ISLANDS.islands[0]!.spawn)).toBeUndefined();
  });
});

describe('PlanetNavigation — amostragem do piso autoral', () => {
  it('cobre as duas ilhas e a ponte inteira, num componente só', () => {
    const stats = built(archipelago(), TWO_ISLANDS).stats();
    expect(stats.nodes).toBeGreaterThan(200);
    expect(stats.islands.every(entry => entry.nodes > 0)).toBe(true);
    expect(stats.bridges[0]!.accepted).toBe(stats.bridges[0]!.attempted);
    expect(stats.connectedIslands).toBe(2);
    expect(stats.longestEdge).toBeLessThanOrEqual(4.01);
    expect(stats.defects).toEqual([]);
  });

  it('não inventa superfície: ilha declarada sem convés não produz nó, e isso vira defeito', () => {
    const mesh = new Mesh();
    const manifest: NavManifest = {
      islands: [island('alfa', UP_A, 18), island('fantasma', UP_B, 18)], bridges: [],
    };
    const stats = built(island1(mesh), manifest).stats();
    expect(stats.islands[0]!.nodes).toBeGreaterThan(0);
    expect(stats.islands[1]!.nodes).toBe(0);
    expect(stats.defects.join(' ')).toContain('fantasma');
  });

  it('separa "sem chão" de "sem espaço" no spawn autoral', () => {
    // Telhado de duas águas estreito e íngreme (67°) a 1,2 m: a água do telhado é íngreme demais
    // para pisar e o chão embaixo não tem pé-direito. Existe chão; o corpo é que não cabe.
    const cramped = new Mesh();
    deck(cramped, UP_A, 18);
    for (let v = -6; v < 6; v += 2) {
      cramped.quad(at(UP_A, -0.5, v), at(UP_A, -0.5, v + 2), at(UP_A, 0, v + 2, 1.2), at(UP_A, 0, v, 1.2));
      cramped.quad(at(UP_A, 0, v, 1.2), at(UP_A, 0, v + 2, 1.2), at(UP_A, 0.5, v + 2), at(UP_A, 0.5, v));
    }
    const underRoof: NavManifest = {
      islands: [{...island('alfa', UP_A, 18), spawn: at(UP_A, -0.25, 0, 1)}], bridges: [],
    };
    expect(built(collisionOf(cramped), underRoof).stats().defects.join(' ')).toContain('caiba em pé');

    // Coluna do spawn totalmente vazia: aí sim é falta de chão.
    const holed = new Mesh();
    deck(holed, UP_A, 18);
    const manifest: NavManifest = {
      islands: [{...island('alfa', UP_A, 18), spawn: at(UP_A, 60, 0, 1)}], bridges: [],
    };
    expect(built(collisionOf(holed), manifest).stats().defects.join(' ')).toContain('não tem piso NENHUM');
  });

  it('recusa convés afundado abaixo de R−3: flanco de penhasco não é estrada', () => {
    const mesh = new Mesh();
    deck(mesh, UP_A, 18, -6);
    expect(built(collisionOf(mesh), ALFA_ONLY()).stats().islands[0]!.nodes).toBe(0);
  });

  it('recusa rampa de 70° e aceita a mesma rampa a 30°', () => {
    const ramp = (degrees: number): number => {
      const rise = Math.tan(degrees * Math.PI / 180);
      const mesh = new Mesh();
      for (let u = -2; u < 16; u += 2) {
        mesh.quad(at(UP_A, u, -6, u * rise), at(UP_A, u + 2, -6, (u + 2) * rise),
                  at(UP_A, u + 2, 6, (u + 2) * rise), at(UP_A, u, 6, u * rise));
      }
      return built(collisionOf(mesh), ALFA_ONLY(16)).stats().islands[0]!.nodes;
    };
    expect(ramp(30)).toBeGreaterThan(0);
    expect(ramp(70)).toBe(0);
  });

  it('acha o piso SOB o telhado e recusa o pé-direito de 1,2 m', () => {
    const altitudes = (roof: number): number[] => {
      const mesh = new Mesh();
      deck(mesh, UP_A, 18);
      slab(mesh, 8, roof);
      const navigation = built(collisionOf(mesh), ALFA_ONLY(6));
      return navigation.nodesOf('alfa').map(point => frame.radius(point) - R);
    };
    const roomy = altitudes(3);
    expect(roomy.some(altitude => Math.abs(altitude) < 0.1)).toBe(true);      // piso sob o telhado
    expect(roomy.some(altitude => Math.abs(altitude - 3) < 0.1)).toBe(true);  // e o telhado por cima
    const cramped = altitudes(1.2);
    expect(cramped.some(altitude => Math.abs(altitude - 1.2) < 0.1)).toBe(true);
    expect(cramped.some(altitude => Math.abs(altitude) < 0.1)).toBe(false);   // a cápsula não cabe embaixo
  });
});

describe('PlanetNavigation — ligações válidas', () => {
  it('não pula buraco de 3 m na ponte, mesmo com raio de ligação de 4 m', () => {
    const navigation = built(archipelago(3), TWO_ISLANDS);
    const stats = navigation.stats();
    const from = TWO_ISLANDS.islands[0]!.spawn, to = TWO_ISLANDS.islands[1]!.spawn;
    expect(stats.connectedIslands).toBe(1);
    expect(navigation.path(from, to)).toBeUndefined();
    expect(navigation.distance(from, to)).toBe(Infinity);
    expect(navigation.reachable(from, to)).toBe(false);
    expect(stats.defects.join(' ')).toContain('sem piso');
    expect(stats.defects.join(' ')).toContain('ilhas estão ligadas a pé');
  });

  it('não atravessa parede sólida: a ilha partida ao meio vira dois componentes', () => {
    const mesh = new Mesh();
    deck(mesh, UP_A, 18);
    wall(mesh, 0.5, 20, 2.5);
    const navigation = built(collisionOf(mesh), ALFA_ONLY());
    const west = at(UP_A, -6, 0), east = at(UP_A, 6, 0);
    expect(navigation.nearestSafe(west)).toBeDefined();
    expect(navigation.nearestSafe(east)).toBeDefined();
    expect(navigation.path(west, east)).toBeUndefined();
  });

  it('contorna a parede parcial pela ponta, e o desvio custa mais que a linha livre', () => {
    const open = new Mesh();
    const blocked = new Mesh();
    deck(blocked, UP_A, 18);
    wall(blocked, 0.5, 6, 2.5);
    const west = at(UP_A, -8, 0), east = at(UP_A, 8, 0);
    const direct = built(island1(open), ALFA_ONLY()).route(west, east);
    const around = built(collisionOf(blocked), ALFA_ONLY()).route(west, east);
    expect(direct.reachable).toBe(true);
    expect(around.reachable).toBe(true);
    expect(around.distance).toBeGreaterThan(direct.distance + 1);
    const crossing = crossingV(around.points, 0.5);
    expect(crossing).toBeDefined();
    expect(Math.abs(crossing!)).toBeGreaterThan(6);   // passou pela ponta da parede, não por dentro
  });

  it('o conector de cabeceira salva a junta com degrau de 0,5 m que a ligação normal recusa', () => {
    // Convés da ponte meio metro acima do da ilha: degrau maior que `maxStep` (0,35 m) e menor
    // que `connectorStep` (0,6 m). Sem conector explícito, as duas ilhas ficam separadas.
    const raised = new Mesh();
    deck(raised, UP_A, 18);
    deck(raised, UP_B, 18);
    strip(raised, 14, ARC - 14, 6, 2, 0.5);
    const collision = collisionOf(raised);
    const from = TWO_ISLANDS.islands[0]!.spawn, to = TWO_ISLANDS.islands[1]!.spawn;
    const manifest: NavManifest = {
      islands: TWO_ISLANDS.islands,
      bridges: [{
        ...TWO_ISLANDS.bridges[0]!,
        waypoints: [at(UP_A, 14, 0, 0.5), at(UP_A, ARC / 2, 0, 0.5), at(UP_A, ARC - 14, 0, 0.5)],
      }],
    };
    const semConector = built(collision, manifest, {...FAST, connectorSamples: 0});
    expect(semConector.path(from, to)).toBeUndefined();
    expect(semConector.stats().defects.join(' ')).toContain('não encosta no convés');

    const comConector = built(collision, manifest);
    expect(comConector.path(from, to)).toBeDefined();
    expect(comConector.stats().connectedIslands).toBe(2);
    expect(comConector.stats().longestEdge).toBeLessThanOrEqual(8.01);
  });

  it('a porta autoral em `access` abre a passagem que a grade de 2,5 m perderia', () => {
    const mesh = new Mesh();
    deck(mesh, UP_A, 18);
    wall(mesh, 0.5, 20, 2.5, 1.6);
    const manifest: NavManifest = {...ALFA_ONLY(), access: [{point: at(UP_A, 0.5, 0), radius: 2.5}]};
    const navigation = built(collisionOf(mesh), manifest);
    const points = navigation.path(at(UP_A, -6, 0), at(UP_A, 6, 0));
    expect(points).toBeDefined();
    const crossing = crossingV(points!, 0.5);
    expect(crossing).toBeDefined();
    expect(Math.abs(crossing!)).toBeLessThan(0.8);   // cruzou exatamente pelo vão da porta
  });
});

describe('PlanetNavigation — encaixe e caminho', () => {
  it('não encaixa através de parede, mesmo quando o nó do outro lado é o mais próximo', () => {
    const mesh = new Mesh();
    deck(mesh, UP_A, 18);
    wall(mesh, 0.5, 20, 2.5);
    const navigation = built(collisionOf(mesh), ALFA_ONLY());
    // Ator a 0,5 m a leste da parede: o nó mais próximo (u=0) está do lado de lá.
    const hugging = at(UP_A, 1, 0, 0.05);
    const snap = navigation.nearestSafe(hugging);
    expect(snap).toBeDefined();
    expect(uv(snap!.point).u).toBeGreaterThan(0.5);
    expect(snap!.distance).toBeLessThanOrEqual(6);
  });

  it('não puxa nó do céu: acima do raio de encaixe não existe encaixe', () => {
    const mesh = new Mesh();
    const navigation = built(island1(mesh), ALFA_ONLY());
    expect(navigation.nearestSafe(at(UP_A, 0, 0, 40))).toBeUndefined();
    expect(navigation.nearestSafe(at(UP_A, 0, 0, 2))).toBeDefined();
  });

  it('o caminho entre ilhas é contínuo, tem piso sob cada ponto e mede perto do arco real', () => {
    const collision = archipelago();
    const navigation = built(collision, TWO_ISLANDS);
    const from = TWO_ISLANDS.islands[0]!.spawn, to = TWO_ISLANDS.islands[1]!.spawn;
    const route = navigation.route(from, to);
    expect(route.reachable).toBe(true);
    expect(route.points.length).toBeGreaterThan(2);
    for (let i = 1; i < route.points.length; i++) {
      expect(distance(route.points[i - 1]!, route.points[i]!)).toBeLessThanOrEqual(12.01);
    }
    for (const point of route.points) {
      expect(collision.supportBelow(point, frame.up(point), 1, 1)).toBeDefined();
    }
    const arc = frame.arcDistance(from, to);
    expect(route.distance).toBeGreaterThan(arc * 0.9);
    expect(route.distance).toBeLessThan(arc * 1.35);
    expect(navigation.distance(from, to)).toBeCloseTo(route.distance, 6);
    expect(navigation.reachable(from, to)).toBe(true);
  });
});

describe('PlanetNavigation — construção fatiada', () => {
  it('construir em fatias dá exatamente o mesmo grafo que construir de uma vez', () => {
    const once = built(archipelago(), TWO_ISLANDS);
    const sliced = new PlanetNavigation(frame, archipelago(), TWO_ISLANDS, FAST);
    let guard = 0, last = sliced.build(0);
    while (!last.done && guard++ < 100000) last = sliced.build(0);
    expect(last.done).toBe(true);
    expect(last.ratio).toBe(1);
    expect(sliced.nodeCount).toBe(once.nodeCount);
    expect(sliced.edgeCount).toBe(once.edgeCount);
  });

  it('o progresso nunca anda para trás', () => {
    const navigation = new PlanetNavigation(frame, archipelago(), TWO_ISLANDS, FAST);
    let previous = 0, guard = 0;
    for (;;) {
      const progress = navigation.build(1);
      expect(progress.ratio).toBeGreaterThanOrEqual(previous);
      previous = progress.ratio;
      if (progress.done || guard++ > 100000) break;
    }
    expect(navigation.ready).toBe(true);
  });
});

describe('PlanetNavigation — grafo assado', () => {
  const from = TWO_ISLANDS.islands[0]!.spawn, to = TWO_ISLANDS.islands[1]!.spawn;

  it('assar e carregar devolve exatamente o mesmo grafo e o mesmo caminho', () => {
    const original = built(archipelago(), TWO_ISLANDS);
    const baked = original.serialize('asset-v1');
    expect(baked).toBeDefined();
    const loaded = PlanetNavigation.load(frame, archipelago(), TWO_ISLANDS, baked!, {signature: 'asset-v1'});
    expect(loaded).toBeDefined();
    expect(loaded!.ready).toBe(true);
    expect(loaded!.nodeCount).toBe(original.nodeCount);
    expect(loaded!.edgeCount).toBe(original.edgeCount);
    const before = original.path(from, to)!, after = loaded!.path(from, to)!;
    expect(after.length).toBe(before.length);
    for (let i = 0; i < before.length; i++) expect(distance(before[i]!, after[i]!)).toBeLessThan(0.002);
    const stats = loaded!.stats();
    expect(stats.connectedIslands).toBe(2);
    expect(stats.islands[0]!.nodes).toBe(original.stats().islands[0]!.nodes);
  });

  it('não serializa um grafo pela metade', () => {
    const half = new PlanetNavigation(frame, archipelago(), TWO_ISLANDS, FAST);
    half.build(0);
    expect(half.serialize('asset-v1')).toBeUndefined();
  });

  it('recusa grafo assado de outro asset em vez de andar sobre chão que não existe mais', () => {
    const baked = built(archipelago(), TWO_ISLANDS).serialize('asset-v1')!;
    const collision = archipelago();
    expect(PlanetNavigation.load(frame, collision, TWO_ISLANDS, baked, {signature: 'asset-v2'})).toBeUndefined();
    expect(PlanetNavigation.load(frame, collision, TWO_ISLANDS, {...baked, version: 99})).toBeUndefined();
    const oneIsland: NavManifest = {islands: [TWO_ISLANDS.islands[0]!], bridges: []};
    expect(PlanetNavigation.load(frame, collision, oneIsland, baked)).toBeUndefined();
    expect(PlanetNavigation.load(frame, collision, TWO_ISLANDS, {...baked, edges: [0, 999999]})).toBeUndefined();
  });
});

describe('PathFollower', () => {
  it('segue a polilinha até chegar, sempre com direção tangente', () => {
    const navigation = built(archipelago(), TWO_ISLANDS);
    const points = navigation.path(TWO_ISLANDS.islands[0]!.spawn, TWO_ISLANDS.islands[1]!.spawn)!;
    const follower = new PathFollower(frame, points);
    let position = points[0]!;
    let guard = 0;
    for (;;) {
      const step = follower.update(position);
      if (step.arrived) break;
      expect(step.strayed).toBe(false);
      expect(Math.abs(dot(step.direction, frame.up(position)))).toBeLessThan(1e-9);
      expect(Math.hypot(step.direction.x, step.direction.y, step.direction.z)).toBeCloseTo(1, 9);
      position = frame.geodesicStep(position, scale(step.direction, 0.5)).position;
      expect(guard++).toBeLessThan(2000);
    }
    expect(distance(position, points[points.length - 1]!)).toBeLessThan(1.5);
  });

  it('acusa `strayed` quando o ator é jogado para longe do caminho', () => {
    const follower = new PathFollower(frame, [at(UP_A, 0, 0), at(UP_A, 4, 0), at(UP_A, 8, 0)]);
    expect(follower.update(at(UP_A, 0, 0)).strayed).toBe(false);
    expect(follower.update(at(UP_A, 0, 30)).strayed).toBe(true);
  });

  it('a régua do desvio encolhe: empurrão depois de chegar perto também conta', () => {
    // Perna longa e legítima (12 m): aproximar-se até 1,2 m e ser jogado a 10 m é desvio,
    // mesmo sem nunca passar da distância original.
    const follower = new PathFollower(frame, [at(UP_A, 0, 0), at(UP_A, 12, 0)]);
    expect(follower.update(at(UP_A, 0, 0)).strayed).toBe(false);
    expect(follower.update(at(UP_A, 10.8, 0)).strayed).toBe(false);
    expect(follower.update(at(UP_A, 2, 0)).strayed).toBe(true);
  });

  it('caminho vazio chega de imediato', () => {
    const follower = new PathFollower(frame, []);
    const step = follower.update(at(UP_A, 0, 0));
    expect(step.arrived).toBe(true);
    expect(step.remaining).toBe(0);
    expect(follower.done).toBe(true);
  });
});

describe('NavMath — geodésicas da grade', () => {
  it('o espaçamento da grade é distância de ARCO de verdade, inclusive na borda', () => {
    const centre = scale(UP_A, R);
    for (const arc of [2.5, 20, 72]) {
      expect(frame.arcDistance(centre, at(UP_A, arc, 0))).toBeCloseTo(arc, 6);
    }
  });

  it('slerp entre duas verticais mantém o unitário e o meio do arco', () => {
    const middle = slerp(UP_A, UP_B, 0.5);
    expect(Math.hypot(middle.x, middle.y, middle.z)).toBeCloseTo(1, 12);
    expect(frame.arcDistance(scale(middle, R), scale(UP_A, R))).toBeCloseTo(ARC / 2, 6);
  });
});
