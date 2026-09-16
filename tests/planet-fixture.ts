import type {Vec3} from '../src/core/contracts';
import {PlanetFrame, add, cross, normalize, scale} from '../src/planet/PlanetFrame';

/**
 * Geometria de TESTE (triangle soup de colisão), não arte de jogo.
 *
 * O motor de planeta não tem opinião sobre de onde vêm os triângulos: em produção eles saem dos
 * GLB autorais de ilha e ponte já transformados para espaço de mundo pelo Codex. Aqui a suíte
 * precisa de uma superfície curva determinística para medir apoio, degrau, escorregamento e
 * recuperação — por isso o fixture gera os mesmos conveses de forma analítica.
 */
export class TriangleSoup {
  readonly positions: number[] = [];
  readonly indices: number[] = [];

  vertex(p: Vec3): number {
    this.positions.push(p.x, p.y, p.z);
    return this.positions.length / 3 - 1;
  }
  triangle(a: number, b: number, c: number): void {this.indices.push(a, b, c);}
  quad(a: number, b: number, c: number, d: number): void {this.triangle(a, b, c); this.triangle(a, c, d);}
  get triangleCount(): number {return this.indices.length / 3;}
}

/** Direção na superfície a `angle` do centro do slot, no azimute `azimuth`. */
function capDirection(direction: Vec3, angle: number, azimuth: number): Vec3 {
  const up = normalize(direction);
  const {east, north} = PlanetFrame.compass(up);
  const lateral = add(scale(east, Math.cos(azimuth)), scale(north, Math.sin(azimuth)));
  return normalize(add(scale(up, Math.cos(angle)), scale(lateral, Math.sin(angle))));
}

/** Convés de ilha: calota esférica de raio angular `radiusMetres / surfaceRadius`. */
export function islandDeck(
  soup: TriangleSoup, frame: PlanetFrame, direction: Vec3,
  {radiusMetres = 72, rings = 10, sectors = 24, altitude = 0} = {},
): void {
  const maxAngle = radiusMetres / frame.surfaceRadius;
  const centre = soup.vertex(frame.fromDirection(direction, altitude));
  let previous: number[] = [];
  for (let j = 1; j <= rings; j++) {
    const angle = maxAngle * j / rings;
    const ring: number[] = [];
    for (let k = 0; k < sectors; k++) {
      ring.push(soup.vertex(frame.fromDirection(capDirection(direction, angle, k / sectors * Math.PI * 2), altitude)));
    }
    for (let k = 0; k < sectors; k++) {
      const next = (k + 1) % sectors;
      if (j === 1) soup.triangle(centre, ring[k]!, ring[next]!);
      else soup.quad(previous[k]!, ring[k]!, ring[next]!, previous[next]!);
    }
    previous = ring;
  }
}

/** Convés de ponte: faixa de largura constante ao longo do círculo máximo entre dois slots. */
export function bridgeDeck(
  soup: TriangleSoup, frame: PlanetFrame, from: Vec3, to: Vec3,
  {width = 8, segments = 40, inset = 72, altitude = 0} = {},
): void {
  const start = frame.fromDirection(from, altitude);
  const arc = frame.arcDistance(start, frame.fromDirection(to, altitude));
  const heading = normalize(cross(cross(frame.up(start), frame.up(frame.fromDirection(to))), frame.up(start)));
  const free = arc - inset * 2;
  let previous: [number, number] | undefined;
  for (let i = 0; i <= segments; i++) {
    const along = inset + free * i / segments;
    const step = frame.geodesicStep(start, scale(heading, along));
    const up = frame.up(step.position);
    const side = cross(up, step.direction);
    const left = frame.geodesicStep(step.position, scale(side, -width / 2)).position;
    const right = frame.geodesicStep(step.position, scale(side, width / 2)).position;
    const pair: [number, number] = [soup.vertex(left), soup.vertex(right)];
    if (previous) soup.quad(previous[0], pair[0], pair[1], previous[1]);
    previous = pair;
  }
}

/**
 * Bloco tangente sobre a superfície: degrau, murete ou rampa de teste.
 * `height` positivo eleva ao longo da vertical local no ponto `at`.
 */
export function tangentSlab(
  soup: TriangleSoup, frame: PlanetFrame, at: Vec3,
  {along = 4, across = 6, height = 0.4, heading = {x: 0, y: 1, z: 0}, riseAlong = 0} = {},
): void {
  const basis = frame.basisAt(at, heading);
  const corner = (u: number, w: number, lift: number): number => soup.vertex(
    add(add(at, add(scale(basis.forward, u), scale(basis.right, w))), scale(basis.up, lift)),
  );
  const halfA = along / 2, halfB = across / 2;
  const lo = [corner(-halfA, -halfB, 0), corner(halfA, -halfB, 0), corner(halfA, halfB, 0), corner(-halfA, halfB, 0)];
  const hi = [
    corner(-halfA, -halfB, height), corner(halfA, -halfB, height + riseAlong),
    corner(halfA, halfB, height + riseAlong), corner(-halfA, halfB, height),
  ];
  soup.quad(hi[0]!, hi[1]!, hi[2]!, hi[3]!);
  soup.quad(lo[3]!, lo[2]!, lo[1]!, lo[0]!);
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    soup.quad(lo[i]!, lo[j]!, hi[j]!, hi[i]!);
  }
}
