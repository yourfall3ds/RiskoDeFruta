import type {Vec3} from '../core/contracts';

/**
 * Vetores e geodésicas locais do módulo de navegação.
 *
 * Duplicam de propósito o que existe em `src/planet/PlanetFrame`: este módulo é consumido por
 * interface ESTRUTURAL (ver `NavTypes.ts`) e não pode depender do arquivo de outro dono. São
 * dez linhas de álgebra, não uma regra de jogo — duplicar aqui é mais barato que acoplar.
 */

export const add = (a: Vec3, b: Vec3): Vec3 => ({x: a.x + b.x, y: a.y + b.y, z: a.z + b.z});
export const sub = (a: Vec3, b: Vec3): Vec3 => ({x: a.x - b.x, y: a.y - b.y, z: a.z - b.z});
export const scale = (a: Vec3, s: number): Vec3 => ({x: a.x * s, y: a.y * s, z: a.z * s});
export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
export const length = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);
export const distance = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
export const clamp = (v: number, low: number, high: number): number => (v < low ? low : v > high ? high : v);

export const normalize = (a: Vec3, fallback: Vec3 = {x: 0, y: 1, z: 0}): Vec3 => {
  const l = Math.hypot(a.x, a.y, a.z);
  return l < 1e-12 ? {x: fallback.x, y: fallback.y, z: fallback.z} : {x: a.x / l, y: a.y / l, z: a.z / l};
};

/** Componente de `v` perpendicular a `axis` (unitário). */
export const reject = (v: Vec3, axis: Vec3): Vec3 => {
  const d = dot(v, axis);
  return {x: v.x - axis.x * d, y: v.y - axis.y * d, z: v.z - axis.z * d};
};

/** Um unitário perpendicular a `axis`, escolhido de forma estável (sem salto perto dos polos). */
export const anyPerpendicular = (axis: Vec3): Vec3 => {
  const seed = Math.abs(axis.y) < 0.9 ? {x: 0, y: 1, z: 0} : {x: 1, y: 0, z: 0};
  return normalize(cross(seed, axis), {x: 1, y: 0, z: 0});
};

/** Base tangente (`east`, `north`) estável em torno de uma vertical. */
export const tangentBasis = (up: Vec3): {east: Vec3; north: Vec3} => {
  const east = anyPerpendicular(up);
  return {east, north: cross(up, east)};
};

/**
 * Mapa exponencial: direção unitária obtida andando `u·east + v·north` (comprimento de ARCO, em
 * metros, sobre a esfera de raio `radius`) a partir de `up`.
 *
 * Usar o mapa exponencial em vez de projeção gnomônica garante que o espaçamento da grade seja
 * o espaçamento REAL caminhado — a 72 m do centro da ilha a diferença entre os dois já é de 2 %,
 * e uma grade que "estica" na borda abre buracos justo onde ficam as cabeceiras de ponte.
 */
export function directionAt(up: Vec3, east: Vec3, north: Vec3, u: number, v: number, radius: number): Vec3 {
  const s = Math.hypot(u, v);
  if (s < 1e-9) return {x: up.x, y: up.y, z: up.z};
  const angle = s / radius, c = Math.cos(angle), n = Math.sin(angle) / s;
  return normalize({
    x: up.x * c + (east.x * u + north.x * v) * n,
    y: up.y * c + (east.y * u + north.y * v) * n,
    z: up.z * c + (east.z * u + north.z * v) * n,
  }, up);
}

/** Interpolação esférica entre duas direções unitárias. */
export function slerp(a: Vec3, b: Vec3, t: number): Vec3 {
  const c = clamp(dot(a, b), -1, 1);
  const angle = Math.acos(c);
  if (angle < 1e-7) return normalize({x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t}, a);
  const s = Math.sin(angle), w0 = Math.sin((1 - t) * angle) / s, w1 = Math.sin(t * angle) / s;
  return normalize({x: a.x * w0 + b.x * w1, y: a.y * w0 + b.y * w1, z: a.z * w0 + b.z * w1}, a);
}
