import {existsSync, readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {beforeAll, describe, expect, it} from 'vitest';
import type {Vec3} from '../src/core/contracts';
import {PLANET, PlanetFrame, add, distance, dot, normalize, scale, sub} from '../src/planet/PlanetFrame';
import {PlanetCollision} from '../src/planet/PlanetCollision';
import {PLANET_MOTOR_TUNING, PlanetMotor} from '../src/planet/PlanetMotor';
import {footAt, projectOnRoute, routeLength, walkRoute} from '../src/planet/RouteWalk';
import {findIslandSpawn} from '../src/planet-game/PlanetSpawn';
import type {PlanetManifest} from '../src/planet-game/PlanetManifest';
import {TriangleSoup, bridgeDeck, islandDeck, tangentSlab} from './planet-fixture';

/**
 * Integração de travessia.
 *
 * Duas camadas, de propósito:
 *
 * 1. **O condutor** (`RouteWalk`) é testado contra o fixture analítico — rápido, sem asset, e é o que
 *    garante que "não chegou" e "bloqueado aqui" significam mesmo o que dizem.
 * 2. **O arquipélago real** entra com poucas pontes REPRESENTATIVAS, inteiras e nos dois sentidos,
 *    sobre a colisão de verdade do `.json.gz`. A varredura completa das 24 pontes × 2 sentidos
 *    custa ~23 s e **não** roda na suíte: quem faz isso é `scripts/audit-planet-traversal.ts`,
 *    cujo resultado fica em `docs/planet-traversal-audit.json` e `.temp/planet-traversal-result.md`.
 *
 * Sem o `.json.gz` no disco a segunda camada é pulada, não falsificada.
 */

const t = PLANET_MOTOR_TUNING;
const MANIFEST = 'public/models/planet-archipelago.json.gz';
const hasManifest = existsSync(MANIFEST);

// ------------------------------------------------------------------ camada 1: o condutor
describe('RouteWalk — o condutor de travessia', () => {
  const frame = new PlanetFrame(PLANET);
  const heading = frame.basisAt(frame.fromDirection({x: 0, y: 0, z: 1}), {x: 0, y: 1, z: 0}).forward;

  /** Rota reta de `metres` sobre o convés da ilha `front`, em passos de 5 m. */
  const straightRoute = (metres: number): Vec3[] => {
    const start = frame.fromDirection({x: 0, y: 0, z: 1});
    const route: Vec3[] = [];
    for (let d = 0; d <= metres + 1e-9; d += 5) route.push(frame.geodesicStep(start, scale(heading, d)).position);
    return route;
  };

  const deck = (extra?: (soup: TriangleSoup) => void): PlanetCollision => {
    const soup = new TriangleSoup();
    islandDeck(soup, frame, {x: 0, y: 0, z: 1}, {radiusMetres: frame.islandRadius, rings: 14, sectors: 36});
    extra?.(soup);
    const collision = new PlanetCollision();
    collision.setGeometry(soup.positions, soup.indices);
    return collision;
  };

  it('mede o comprimento e a projeção da rota', () => {
    const route = straightRoute(40);
    // A rota é uma POLILINHA: oito cordas de 5 m sobre um arco de 40 m ficam ~1 mm mais curtas.
    // É a medida certa — o corpo anda nas cordas, não no arco ideal.
    expect(routeLength(route)).toBeCloseTo(40, 2);
    expect(routeLength(route)).toBeLessThan(40);
    const half = frame.geodesicStep(route[0]!, scale(heading, 17)).position;
    const projected = projectOnRoute(route, half);
    expect(projected.along).toBeCloseTo(17, 1);
    expect(projected.lateral).toBeLessThan(0.02);
    // Afastar-se de lado aparece como desvio lateral, não como avanço.
    const side = cross(frame.up(half), heading);
    const off = frame.geodesicStep(half, scale(side, 3)).position;
    expect(projectOnRoute(route, off).lateral).toBeCloseTo(3, 1);
  });

  it('atravessa uma rota livre inteira e chega ao fim apoiado', () => {
    const walk = walkRoute(deck(), frame, straightRoute(40), {maxSeconds: 30});
    expect(walk.reached).toBe(true);
    expect(walk.blockage).toBeUndefined();
    expect(walk.recoveries).toBe(0);
    expect(walk.groundedRate).toBeGreaterThan(0.95);
    expect(walk.progress).toBeGreaterThan(36);
    expect(walk.maxLateralDeviation).toBeLessThan(1);
    expect(walk.seconds).toBeLessThan(12);
  });

  it('para no obstáculo e registra o ponto exato, em vez de atravessar', () => {
    const route = straightRoute(40);
    const at = frame.geodesicStep(route[0]!, scale(heading, 20)).position;
    const walk = walkRoute(deck(soup => {
      tangentSlab(soup, frame, at, {along: 2, across: 20, height: 3, heading: {x: 0, y: 1, z: 0}});
    }), frame, route, {maxSeconds: 30});
    expect(walk.reached).toBe(false);
    expect(walk.blockage).toBeDefined();
    expect(walk.blockage!.reason).toBe('wall');
    // O ponto relatado é a face do murete, a um raio de cápsula dela — não um palpite.
    const stopped = frame.arcDistance(route[0]!, walk.blockage!.position);
    expect(stopped).toBeGreaterThan(20 - 1 - t.radius - 0.35);
    expect(stopped).toBeLessThan(20 - 1 - t.radius + 0.35);
    expect(walk.recoveries).toBe(0);
    // Parou de verdade: não empurrou o corpo para dentro da geometria.
    expect(walk.progress).toBeLessThan(20);
  });

  it('recusa a rota quando o começo não tem piso', () => {
    const route = straightRoute(40).map(p => frame.atAltitude(p, 0));
    const away = route.map(p => add(p, scale(frame.up(p), 0)));
    const collision = new PlanetCollision();
    collision.setGeometry([], []);
    const walk = walkRoute(collision, frame, away, {maxSeconds: 5});
    expect(walk.reached).toBe(false);
    expect(walk.blockage?.reason).toBe('no-floor');
    expect(walk.ticks).toBe(0);
  });

  it('atravessa nos DOIS sentidos a mesma ponte analítica', () => {
    const soup = new TriangleSoup();
    islandDeck(soup, frame, {x: 0, y: 0, z: 1}, {radiusMetres: frame.islandRadius});
    islandDeck(soup, frame, {x: 1, y: 0, z: 0}, {radiusMetres: frame.islandRadius});
    bridgeDeck(soup, frame, {x: 0, y: 0, z: 1}, {x: 1, y: 0, z: 0}, {width: 10, segments: 60, inset: frame.islandRadius});
    const collision = new PlanetCollision();
    collision.setGeometry(soup.positions, soup.indices);
    const start = frame.fromDirection({x: 0, y: 0, z: 1});
    const towards = normalize(sub(frame.up(frame.fromDirection({x: 1, y: 0, z: 0})), frame.up(start)));
    const route: Vec3[] = [];
    for (let d = 40; d <= 275; d += 7) route.push(frame.geodesicStep(start, scale(towards, d)).position);
    for (const [name, path] of [['ida', route], ['volta', [...route].reverse()]] as const) {
      const walk = walkRoute(collision, frame, path, {maxSeconds: 70});
      expect(walk.reached, `${name} não chegou`).toBe(true);
      expect(walk.recoveries, `${name} caiu no vazio`).toBe(0);
      expect(walk.groundedRate, `${name} ficou no ar`).toBeGreaterThan(0.95);
      expect(walk.longestHangSeconds, `${name} pendurou`).toBeLessThan(1);
    }
  });
});

const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x,
});

// ------------------------------------------------- camada 2: arquipélago real, amostra representativa
/**
 * Três pontes representativas: a mais curta, a mais longa e uma ligada a uma ilha polar.
 * A cobertura completa é do script de auditoria — aqui só o suficiente para pegar regressão do
 * núcleo contra geometria autoral de verdade, dentro do orçamento de tempo da suíte.
 */
const SAMPLE_BRIDGES = ['shortest', 'longest', 'polar'] as const;
function sampleBridge(manifest: PlanetManifest, kind: typeof SAMPLE_BRIDGES[number]) {
  const sorted = [...manifest.bridges].sort((a,b) => routeLength(a.waypoints)-routeLength(b.waypoints));
  return kind === 'shortest' ? sorted[0]! : kind === 'longest' ? sorted[sorted.length-1]!
    : manifest.bridges.find(b => b.a === 'north' || b.b === 'north')!;
}

describe.skipIf(!hasManifest)('Travessia no arquipélago real', () => {
  let manifest: PlanetManifest;
  let frame: PlanetFrame;
  let world: PlanetCollision;

  beforeAll(() => {
    manifest = JSON.parse(gunzipSync(readFileSync(MANIFEST)).toString('utf8')) as PlanetManifest;
    frame = new PlanetFrame({
      ...PLANET, centre: manifest.centre, surfaceRadius: manifest.radius, voidRadius: manifest.radius - 32,
    });
    world = new PlanetCollision();
    world.setGeometry(manifest.positions, manifest.indices);
  });

  it('carrega o manifesto gzipado com a malha de colisão global', () => {
    expect(world.triangleCount).toBeGreaterThan(10_000);
    expect(manifest.radius).toBeGreaterThan(100);
    expect(manifest.islands.length).toBeGreaterThanOrEqual(6);
    expect(manifest.bridges.length).toBeGreaterThanOrEqual(6);
    for (const id of SAMPLE_BRIDGES) {
      expect(sampleBridge(manifest, id), `sem ponte para amostra ${id}`).toBeDefined();
    }
  });

  it.each(SAMPLE_BRIDGES)('atravessa %s inteira, nos dois sentidos', id => {
    const bridge = sampleBridge(manifest, id);
    const forward = [...bridge.waypoints];
    expect(routeLength(forward)).toBeGreaterThan(3);
    for (const [name, route] of [['a→b', forward], ['b→a', [...forward].reverse()]] as const) {
      const walk = walkRoute(world, frame, route, {maxSeconds: 60});
      const where = walk.blockage
        ? ` bloqueio ${walk.blockage.reason} em ${walk.blockage.position.x.toFixed(2)}, ` +
          `${walk.blockage.position.y.toFixed(2)}, ${walk.blockage.position.z.toFixed(2)}`
        : '';
      expect(walk.reached, `${id} ${name}: parou em ${walk.progress.toFixed(1)}/${walk.routeLength.toFixed(1)} m.${where}`).toBe(true);
      expect(walk.recoveries, `${id} ${name} caiu no vazio`).toBe(0);
      expect(walk.groundedRate, `${id} ${name} apoiado de menos`).toBeGreaterThan(0.9);
      expect(walk.longestHangSeconds, `${id} ${name} pendurado`).toBeLessThan(1.2);
      // Flutuação: o motor não pode se dizer apoiado com o piso longe dos pés.
      expect(walk.maxGapWhileGrounded, `${id} ${name} flutuou "apoiado"`).toBeLessThan(0.35);
      // Seguiu a rota autoral, não saiu vagando pela ilha.
      expect(walk.maxLateralDeviation, `${id} ${name} saiu da rota`).toBeLessThan(12);
    }
  });

  it('a rota autoral tem piso medido em todos os waypoints das pontes amostradas', () => {
    for (const id of SAMPLE_BRIDGES) {
      const bridge = sampleBridge(manifest, id);
      bridge.waypoints.forEach((point, index) => {
        expect(footAt(world, frame, point), `${id} waypoint ${index} sem piso caminhável`).toBeDefined();
      });
    }
  });

  it('parado, salto e volta do vazio funcionam nas seis verticais cardeais', () => {
    const cardinals: [string, Vec3][] = [
      ['+Y', {x: 0, y: 1, z: 0}], ['-Y', {x: 0, y: -1, z: 0}],
      ['+X', {x: 1, y: 0, z: 0}], ['-X', {x: -1, y: 0, z: 0}],
      ['+Z', {x: 0, y: 0, z: 1}], ['-Z', {x: 0, y: 0, z: -1}],
    ];
    const idle = {x: 0, z: 0, jump: false, sprint: false};
    for (const [name, direction] of cardinals) {
      const island = manifest.islands.reduce((best, candidate) =>
        dot(normalize(candidate.up), direction) > dot(normalize(best.up), direction) ? candidate : best);
      // Alinhamento frouxo de propósito: o manifesto tem 14 ilhas, não 6 slots cardeais exatos.
      expect(dot(normalize(island.up), direction), `${name} sem ilha próxima`).toBeGreaterThan(0.5);
      const spawn = findIslandSpawn(world, frame, island);
      expect(spawn, `${name} (${island.id}): findIslandSpawn não achou apoio`).toBeDefined();

      const motor = new PlanetMotor({frame, collision: world, spawn: spawn!.position});
      for (let i = 0; i < 180; i++) motor.fixedUpdate(1 / 60, idle);
      const settled = {...motor.position};
      expect(motor.grounded, `${name} (${island.id}) não ficou apoiado`).toBe(true);
      // A vertical do corpo é radial de verdade, e aponta para o lado cardeal pedido.
      expect(dot(motor.up, direction), `${name} up errado`).toBeGreaterThan(0.5);
      expect(distance(motor.up, frame.up(motor.position))).toBeLessThan(1e-9);

      // Parado é parado: nada de escorregar sozinho na rampa autoral.
      for (let i = 0; i < 300; i++) motor.fixedUpdate(1 / 60, idle);
      expect(distance(settled, motor.position), `${name} (${island.id}) escorregou parado`).toBeLessThan(0.02);

      motor.fixedUpdate(1 / 60, {...idle, jump: true});
      let apex = 0;
      for (let i = 0; i < 150; i++) {
        motor.fixedUpdate(1 / 60, idle);
        apex = Math.max(apex, dot(sub(motor.position, settled), spawn!.up));
      }
      expect(apex, `${name} (${island.id}) salto baixo`).toBeGreaterThan(t.jumpApex - 0.35);
      expect(motor.grounded, `${name} (${island.id}) não pousou`).toBe(true);
      expect(distance(motor.position, settled), `${name} pousou longe`).toBeLessThan(1);

      // Volta do vazio: reaparece sobre apoio caminhável de verdade, medido na malha.
      const before = motor.recoveries;
      motor.teleport(frame.fromDirection(spawn!.up, -45));
      for (let i = 0; i < 360; i++) motor.fixedUpdate(1 / 60, idle);
      expect(motor.recoveries, `${name} (${island.id}) não recuperou`).toBeGreaterThan(before);
      expect(motor.grounded, `${name} (${island.id}) recuperou no ar`).toBe(true);
      const support = world.supportBelow(motor.position, motor.up, 0.3, 1);
      expect(support, `${name} (${island.id}) recuperou sem piso sob os pés`).toBeDefined();
      expect(support!.slopeDegrees).toBeLessThanOrEqual(t.maxSlopeDegrees);
    }
  });
});
