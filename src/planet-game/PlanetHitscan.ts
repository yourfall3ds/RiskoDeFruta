import type {Vec3} from '../core/contracts';
import type {PlanetCollision} from '../planet/PlanetCollision';
import {add, cross, dot, length, normalize, scale, sub} from '../planet/PlanetFrame';

/**
 * Alvo de tiro: uma cápsula ORIENTADA pela vertical local do ator.
 *
 * Caixa alinhada ao mundo (o que o jogo plano usa) não serve aqui: na face de baixo do planeta a
 * "altura" do bicho aponta para −Y, e uma AABB cresceria na diagonal errada. A cápsula ao longo de
 * `up` é a mesma forma que o `PlanetMotor` usa para colidir, então o que se vê é o que se acerta.
 */
export interface HitCapsule {
  readonly id: number;
  /** Pé do ator em espaço de mundo. */
  readonly base: Vec3;
  /** Vertical local do ator (unitária). */
  readonly up: Vec3;
  readonly radius: number;
  readonly height: number;
  readonly alive: boolean;
}

export interface HitscanResult {
  /** Distância percorrida da origem até o ponto final. */
  readonly distance: number;
  readonly point: Vec3;
  readonly normal: Vec3;
  /** Ator atingido, quando o primeiro contato foi um ator e não o mundo. */
  readonly target: HitCapsule | undefined;
  /** `true` quando o raio terminou no alcance máximo sem tocar em nada. */
  readonly missed: boolean;
  /**
   * Triângulo do MUNDO atingido, quando o contato foi na malha e não num ator.
   *
   * É por ele que a destruição de cenário resolve qual prop levou o tiro: os registros do
   * manifesto são intervalos contíguos de triângulo, então a busca é O(log n) num vetor ordenado
   * em vez de uma varredura espacial por caixa. `undefined` quando o raio acertou um ator ou nada.
   */
  readonly triangle: number | undefined;
}

const EPSILON = 1e-9;

/**
 * Raio × cápsula orientada. Devolve a menor distância positiva de entrada, ou `undefined`.
 *
 * Resolve o cilindro no plano perpendicular ao eixo e, quando o contato cai fora do segmento,
 * testa a esfera da tampa correspondente. É o caso completo: sem isto, tiros na cabeça ou nos pés
 * de um bicho inclinado numa rampa passariam direto.
 */
export function rayCapsule(origin: Vec3, direction: Vec3, maxDistance: number, capsule: HitCapsule): number | undefined {
  const axis = normalize(capsule.up, {x: 0, y: 1, z: 0});
  const low = capsule.radius;
  const high = Math.max(low, capsule.height - capsule.radius);
  const a = add(capsule.base, scale(axis, low));
  const b = add(capsule.base, scale(axis, high));
  const ab = sub(b, a), ao = sub(origin, a);
  const abLength = length(ab);
  if (!(abLength > EPSILON)) return raySphere(origin, direction, maxDistance, a, capsule.radius);
  const n = scale(ab, 1 / abLength);
  // Componentes perpendiculares ao eixo: o problema vira um círculo 2D.
  const dPerp = sub(direction, scale(n, dot(direction, n)));
  const oPerp = sub(ao, scale(n, dot(ao, n)));
  const qa = dot(dPerp, dPerp), qb = 2 * dot(dPerp, oPerp), qc = dot(oPerp, oPerp) - capsule.radius * capsule.radius;
  let best: number | undefined;
  if (qa > EPSILON) {
    const disc = qb * qb - 4 * qa * qc;
    if (disc >= 0) {
      const root = Math.sqrt(disc);
      for (const t of [(-qb - root) / (2 * qa), (-qb + root) / (2 * qa)]) {
        if (t < 0 || t > maxDistance) continue;
        const along = dot(sub(add(origin, scale(direction, t)), a), n);
        if (along < 0 || along > abLength) continue;
        best = best === undefined ? t : Math.min(best, t);
      }
    }
  } else if (qc <= 0) {
    // Raio paralelo ao eixo e dentro do cilindro: só as tampas podem decidir.
    best = undefined;
  }
  for (const cap of [a, b]) {
    const t = raySphere(origin, direction, maxDistance, cap, capsule.radius);
    if (t !== undefined) best = best === undefined ? t : Math.min(best, t);
  }
  return best;
}

function raySphere(origin: Vec3, direction: Vec3, maxDistance: number, centre: Vec3, radius: number): number | undefined {
  const oc = sub(origin, centre);
  const b = 2 * dot(direction, oc), c = dot(oc, oc) - radius * radius;
  const disc = b * b - 4 * c;
  if (disc < 0) return undefined;
  const root = Math.sqrt(disc);
  for (const t of [(-b - root) / 2, (-b + root) / 2]) if (t >= 0 && t <= maxDistance) return t;
  return undefined;
}

/**
 * Um disparo: o mundo primeiro, os atores depois, e só vence quem estiver na frente.
 *
 * É esta ordem que impede bala fantasma. Um bicho atrás de uma pedra tem contato de cápsula mais
 * distante que o triângulo da pedra, então o triângulo ganha e o dano não sai. Não existe caminho
 * neste arquivo que aplique dano sem ter comparado com a geometria real.
 */
export function hitscan(
  collision: PlanetCollision,
  origin: Vec3,
  direction: Vec3,
  maxDistance: number,
  targets: Iterable<HitCapsule>,
): HitscanResult {
  const ray = normalize(direction, {x: 0, y: 0, z: 1});
  const world = collision.raycast(origin, ray, maxDistance);
  let nearest = world ? world.distance : maxDistance;
  let target: HitCapsule | undefined;
  for (const capsule of targets) {
    if (!capsule.alive) continue;
    const t = rayCapsule(origin, ray, nearest, capsule);
    if (t === undefined || t >= nearest) continue;
    nearest = t; target = capsule;
  }
  const point = add(origin, scale(ray, nearest));
  const normal = target
    ? normalize(sub(origin, point), {x: 0, y: 1, z: 0})
    : world ? world.normal : scale(ray, -1);
  // O triângulo só vale quando o mundo ganhou: um ator na frente cancela o contato com a malha.
  return {
    distance: nearest, point, normal, target, missed: !target && !world,
    triangle: !target && world ? world.triangle : undefined,
  };
}

/**
 * Linha de visão livre entre dois pontos do mundo, com folga nas duas pontas.
 *
 * Usada antes de qualquer dano de contato ou investida do inimigo: sem isto um bicho do outro lado
 * de uma parede acertaria o jogador por proximidade, que é exatamente o "dano automático sem LOS".
 */
export function lineOfSight(collision: PlanetCollision, from: Vec3, to: Vec3, margin = 0.25): boolean {
  const delta = sub(to, from), span = length(delta);
  if (!(span > margin * 2)) return true;
  const direction = scale(delta, 1 / span);
  const hit = collision.raycast(add(from, scale(direction, margin)), direction, span - margin * 2);
  return hit === undefined;
}

/** Direções espalhadas no plano tangente em torno de `forward`, girando sobre `up`. */
export function tangentSpread(forward: Vec3, up: Vec3, count: number, totalAngle: number): Vec3[] {
  const f = normalize(forward, {x: 0, y: 0, z: 1});
  let side = sub(cross(up, f), scale(f, 0));
  if (length(side) < 1e-6) side = cross({x: 0, y: 1, z: 0}, f);
  const right = normalize(side, {x: 1, y: 0, z: 0});
  const out: Vec3[] = [];
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0 : i / (count - 1) - 0.5;
    const angle = t * totalAngle;
    out.push(normalize(add(scale(f, Math.cos(angle)), scale(right, Math.sin(angle))), f));
  }
  return out;
}
