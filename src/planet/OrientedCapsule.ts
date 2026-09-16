import type {Vec3} from '../core/contracts';

/**
 * Cápsula de EIXO ARBITRÁRIO contra triângulo.
 *
 * É a única diferença real entre colidir num mundo Y-up e colidir num planeta: a cápsula do
 * personagem aponta para a vertical local, que muda a cada passo. O algoritmo (ponto mais próximo
 * + avanço conservador) é o mesmo já usado por `src/physics/CapsuleTriangle.ts`; aqui o eixo entra
 * como parâmetro em vez de ser `+Y` fixo, e a matemática é escalar para não alocar por triângulo.
 *
 * `base` é o ponto do PÉ. O segmento interno vai de `base + axis·radius` a `base + axis·(height−radius)`.
 */

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Ponto do triângulo mais próximo de `p`, escrito em `out`. Regiões de Voronoi (Ericson). */
function closestOnTriangle(
  px: number, py: number, pz: number,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number,
  out: Vec3,
): void {
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const acx = cx - ax, acy = cy - ay, acz = cz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) {out.x = ax; out.y = ay; out.z = az; return;}
  const bpx = px - bx, bpy = py - by, bpz = pz - bz;
  const d3 = abx * bpx + aby * bpy + abz * bpz;
  const d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) {out.x = bx; out.y = by; out.z = bz; return;}
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const t = d1 / (d1 - d3);
    out.x = ax + abx * t; out.y = ay + aby * t; out.z = az + abz * t; return;
  }
  const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
  const d5 = abx * cpx + aby * cpy + abz * cpz;
  const d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) {out.x = cx; out.y = cy; out.z = cz; return;}
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const t = d2 / (d2 - d6);
    out.x = ax + acx * t; out.y = ay + acy * t; out.z = az + acz * t; return;
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const t = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    out.x = bx + (cx - bx) * t; out.y = by + (cy - by) * t; out.z = bz + (cz - bz) * t; return;
  }
  const inv = 1 / (va + vb + vc), v = vb * inv, w = vc * inv;
  out.x = ax + abx * v + acx * w; out.y = ay + aby * v + acy * w; out.z = az + abz * v + acz * w;
}

/** Par de pontos mais próximos entre os segmentos `p→q` e `a→b`. */
function closestSegments(
  p: Vec3, q: Vec3, ax: number, ay: number, az: number, bx: number, by: number, bz: number,
  outOnPQ: Vec3, outOnAB: Vec3,
): void {
  const d1x = q.x - p.x, d1y = q.y - p.y, d1z = q.z - p.z;
  const d2x = bx - ax, d2y = by - ay, d2z = bz - az;
  const rx = p.x - ax, ry = p.y - ay, rz = p.z - az;
  const aa = d1x * d1x + d1y * d1y + d1z * d1z;
  const ee = d2x * d2x + d2y * d2y + d2z * d2z;
  const f = d2x * rx + d2y * ry + d2z * rz;
  let s = 0, t = 0;
  if (aa < 1e-12) t = ee > 1e-12 ? clamp01(f / ee) : 0;
  else {
    const c = d1x * rx + d1y * ry + d1z * rz;
    if (ee < 1e-12) s = clamp01(-c / aa);
    else {
      const bb = d1x * d2x + d1y * d2y + d1z * d2z, den = aa * ee - bb * bb;
      s = den !== 0 ? clamp01((bb * f - c * ee) / den) : 0;
      t = (bb * s + f) / ee;
      if (t < 0) {t = 0; s = clamp01(-c / aa);}
      else if (t > 1) {t = 1; s = clamp01((bb - c) / aa);}
    }
  }
  outOnPQ.x = p.x + d1x * s; outOnPQ.y = p.y + d1y * s; outOnPQ.z = p.z + d1z * s;
  outOnAB.x = ax + d2x * t; outOnAB.y = ay + d2y * t; outOnAB.z = az + d2z * t;
}

export interface CapsuleContact {
  /** Distância do EIXO da cápsula ao triângulo. Penetração = `radius − distance`. */
  distance: number;
  /** Unitário do triângulo para a cápsula: a direção que separa. */
  normal: Vec3;
}

const scratch = {
  p: {x: 0, y: 0, z: 0}, q: {x: 0, y: 0, z: 0},
  onTri: {x: 0, y: 0, z: 0}, onSeg: {x: 0, y: 0, z: 0}, edge: {x: 0, y: 0, z: 0},
};

/** Aproximação mais próxima entre o eixo da cápsula e o triângulo `a,b,c`. */
export function capsuleTriangle(
  base: Vec3, axis: Vec3, radius: number, height: number, a: Vec3, b: Vec3, c: Vec3,
): CapsuleContact {
  const low = radius, high = Math.max(radius, height - radius);
  const p = scratch.p, q = scratch.q;
  p.x = base.x + axis.x * low; p.y = base.y + axis.y * low; p.z = base.z + axis.z * low;
  q.x = base.x + axis.x * high; q.y = base.y + axis.y * high; q.z = base.z + axis.z * high;

  let best = Infinity, nx = 0, ny = 0, nz = 0;
  const consider = (fx: number, fy: number, fz: number, tx: number, ty: number, tz: number): void => {
    const dx = fx - tx, dy = fy - ty, dz = fz - tz, d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < best) {best = d2; nx = dx; ny = dy; nz = dz;}
  };
  const tri = scratch.onTri;
  closestOnTriangle(p.x, p.y, p.z, a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, tri);
  consider(p.x, p.y, p.z, tri.x, tri.y, tri.z);
  closestOnTriangle(q.x, q.y, q.z, a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, tri);
  consider(q.x, q.y, q.z, tri.x, tri.y, tri.z);
  const seg = scratch.onSeg, other = scratch.edge;
  for (const [u, w] of [[a, b], [b, c], [c, a]] as const) {
    closestSegments(p, q, u.x, u.y, u.z, w.x, w.y, w.z, seg, other);
    consider(seg.x, seg.y, seg.z, other.x, other.y, other.z);
  }

  // Travessia do plano dentro do triângulo: o eixo atravessa a face, penetração total.
  const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
  const vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
  const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
  const den = fx * (q.x - p.x) + fy * (q.y - p.y) + fz * (q.z - p.z);
  if (Math.abs(den) > 1e-12) {
    const t = (fx * (a.x - p.x) + fy * (a.y - p.y) + fz * (a.z - p.z)) / den;
    if (t >= 0 && t <= 1) {
      const hx = p.x + (q.x - p.x) * t, hy = p.y + (q.y - p.y) * t, hz = p.z + (q.z - p.z) * t;
      closestOnTriangle(hx, hy, hz, a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, tri);
      const ex = tri.x - hx, ey = tri.y - hy, ez = tri.z - hz;
      if (ex * ex + ey * ey + ez * ez < 1e-10) {best = 0; nx = fx; ny = fy; nz = fz;}
    }
  }

  let l = Math.hypot(nx, ny, nz);
  if (l < 1e-12) {nx = fx; ny = fy; nz = fz; l = Math.hypot(nx, ny, nz);}
  if (l < 1e-12) return {distance: Math.sqrt(best), normal: {x: 0, y: 1, z: 0}};
  return {distance: Math.sqrt(best), normal: {x: nx / l, y: ny / l, z: nz / l}};
}

export interface CapsuleSweep {time: number; normal: Vec3}

/**
 * Varredura contínua por avanço conservador. Devolve o primeiro instante de contato em [0,1].
 *
 * Uma convergência rasante conta como contato, nunca como permissão para atravessar — mesma
 * política do motor plano, que é o que impede túnel em parede fina.
 */
export function sweepCapsuleTriangle(
  base: Vec3, axis: Vec3, delta: Vec3, radius: number, height: number, a: Vec3, b: Vec3, c: Vec3,
): CapsuleSweep | undefined {
  const speed = Math.hypot(delta.x, delta.y, delta.z);
  if (speed < 1e-10) return undefined;
  const at = {x: 0, y: 0, z: 0};
  let time = 0;
  for (let i = 0; i < 24; i++) {
    at.x = base.x + delta.x * time; at.y = base.y + delta.y * time; at.z = base.z + delta.z * time;
    const near = capsuleTriangle(at, axis, radius, height, a, b, c);
    const gap = near.distance - radius;
    if (gap < 0.0005) {
      if (near.normal.x * delta.x + near.normal.y * delta.y + near.normal.z * delta.z >= -1e-8) return undefined;
      return {time, normal: near.normal};
    }
    time += gap / speed;
    if (time > 1) return undefined;
  }
  at.x = base.x + delta.x * time; at.y = base.y + delta.y * time; at.z = base.z + delta.z * time;
  const near = capsuleTriangle(at, axis, radius, height, a, b, c);
  if (near.normal.x * delta.x + near.normal.y * delta.y + near.normal.z * delta.z < 0) {
    return {time, normal: near.normal};
  }
  return undefined;
}
