import type {Vec3} from '../core/contracts';

/**
 * Referencial esférico do planeta.
 *
 * Tudo aqui é matemática pura sobre `Vec3` — sem Babylon, sem cena, sem estado de jogo.
 * A peça central é `geodesicStep`/`transport`: mover sobre a superfície e levar junto,
 * SEM erro acumulado, as direções tangentes (velocidade, frente do personagem, câmera).
 * É isso que faz a volta completa fechar e o polo deixar de ser caso especial.
 */
export interface PlanetConfig {
  /** Centro em espaço de mundo. A gravidade sempre aponta para cá. */
  readonly centre: Vec3;
  /** Raio nominal do convés caminhável das ilhas — referência de colocação de asset. */
  readonly surfaceRadius: number;
  /** Abaixo deste raio o corpo está no vazio: dano e recuperação ao último apoio. */
  readonly voidRadius: number;
  /** Teto de spawn/enquadramento distante. */
  readonly ceilingRadius: number;
  /** Raio máximo de pegada de uma ilha, usado pelo traçado das pontes. */
  readonly islandRadius: number;
}

/** Contrato numérico fechado em .temp/planet-core-design.md §2. */
export const PLANET: PlanetConfig = {
  centre: {x: 0, y: 0, z: 0},
  surfaceRadius: 200,
  voidRadius: 168,
  ceilingRadius: 320,
  islandRadius: 72,
};

export const v3 = (x = 0, y = 0, z = 0): Vec3 => ({x, y, z});
export const copy = (v: Vec3): Vec3 => ({x: v.x, y: v.y, z: v.z});
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
/** Normaliza; devolve `fallback` quando o vetor é degenerado em vez de produzir NaN. */
export const normalize = (a: Vec3, fallback: Vec3 = {x: 0, y: 1, z: 0}): Vec3 => {
  const l = Math.hypot(a.x, a.y, a.z);
  return l < 1e-12 ? copy(fallback) : {x: a.x / l, y: a.y / l, z: a.z / l};
};
/** Componente de `v` perpendicular a `axis` (que precisa ser unitário). */
export const reject = (v: Vec3, axis: Vec3): Vec3 => {
  const d = dot(v, axis);
  return {x: v.x - axis.x * d, y: v.y - axis.y * d, z: v.z - axis.z * d};
};
/** Qualquer unitário perpendicular a `axis`, escolhido de forma estável. */
export const anyPerpendicular = (axis: Vec3): Vec3 => {
  const seed = Math.abs(axis.y) < 0.9 ? {x: 0, y: 1, z: 0} : {x: 1, y: 0, z: 0};
  return normalize(cross(seed, axis), {x: 1, y: 0, z: 0});
};

/**
 * Rotação de Rodrigues de `v` em torno de `axis` (unitário) por um ângulo de cosseno/seno dados.
 * Recebe cos/sin prontos porque quem chama já os tem — evita um `acos` que perde precisão perto de 0.
 */
export function rotateAbout(v: Vec3, axis: Vec3, cos: number, sin: number): Vec3 {
  const k = cross(axis, v), d = dot(axis, v) * (1 - cos);
  return {
    x: v.x * cos + k.x * sin + axis.x * d,
    y: v.y * cos + k.y * sin + axis.y * d,
    z: v.z * cos + k.z * sin + axis.z * d,
  };
}

/**
 * Transporte paralelo de `v` ao longo da geodésica que leva a vertical `from` até `to`
 * (ambas unitárias). É a mesma rotação que leva `from` em `to`, aplicada a `v`.
 *
 * Um vetor tangente em `from` sai tangente em `to`, com o MESMO comprimento: nada de
 * reprojetar e perder velocidade a cada quadro.
 */
export function transport(v: Vec3, from: Vec3, to: Vec3): Vec3 {
  const c = dot(from, to);
  if (c > 1 - 1e-14) return copy(v);
  const k = cross(from, to), s = length(k);
  // Antípoda exata: a geodésica é ambígua; giro de 180° em torno de qualquer eixo perpendicular.
  if (s < 1e-12) return rotateAbout(v, anyPerpendicular(from), -1, 0);
  return rotateAbout(v, scale(k, 1 / s), c, s);
}

export interface SurfaceBasis {up: Vec3; forward: Vec3; right: Vec3}
export interface GeodesicStep {position: Vec3; direction: Vec3; angle: number}
export interface Quat {x: number; y: number; z: number; w: number}

/**
 * Quaternion de uma base ortonormal de mão-esquerda (`right`, `up`, `forward`) na convenção do
 * Babylon: linhas da matriz de rotação = eixos X, Y, Z locais. É assim que o Codex monta a
 * `rotationQuaternion` da raiz do personagem e dos assets de ilha/ponte.
 */
export function quaternionFromBasis(right: Vec3, up: Vec3, forward: Vec3): Quat {
  const m00 = right.x, m01 = right.y, m02 = right.z;
  const m10 = up.x, m11 = up.y, m12 = up.z;
  const m20 = forward.x, m21 = forward.y, m22 = forward.z;
  const trace = m00 + m11 + m22;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    return {w: s / 4, x: (m12 - m21) / s, y: (m20 - m02) / s, z: (m01 - m10) / s};
  }
  if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    return {w: (m12 - m21) / s, x: s / 4, y: (m01 + m10) / s, z: (m02 + m20) / s};
  }
  if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    return {w: (m20 - m02) / s, x: (m01 + m10) / s, y: s / 4, z: (m12 + m21) / s};
  }
  const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
  return {w: (m01 - m10) / s, x: (m02 + m20) / s, y: (m12 + m21) / s, z: s / 4};
}

export class PlanetFrame {
  readonly centre: Vec3;
  readonly surfaceRadius: number;
  readonly voidRadius: number;
  readonly ceilingRadius: number;
  readonly islandRadius: number;

  constructor(config: PlanetConfig = PLANET) {
    this.centre = copy(config.centre);
    this.surfaceRadius = config.surfaceRadius;
    this.voidRadius = config.voidRadius;
    this.ceilingRadius = config.ceilingRadius;
    this.islandRadius = config.islandRadius;
  }

  /** Distância ao centro. */
  radius(p: Vec3): number {return distance(p, this.centre);}
  /** Altura relativa ao convés nominal; substitui o `y` do mundo plano. */
  altitude(p: Vec3): number {return this.radius(p) - this.surfaceRadius;}
  /** Vertical local (para cima). No centro exato devolve `+Y` em vez de NaN. */
  up(p: Vec3): Vec3 {return normalize(sub(p, this.centre));}
  /** Gravidade local (para baixo). */
  down(p: Vec3): Vec3 {return scale(this.up(p), -1);}
  /** Reposiciona `p` mantendo a direção, na altitude pedida. */
  atAltitude(p: Vec3, altitude: number): Vec3 {
    return add(this.centre, scale(this.up(p), this.surfaceRadius + altitude));
  }
  /** Ponto sobre a superfície nominal na direção unitária dada. */
  fromDirection(direction: Vec3, altitude = 0): Vec3 {
    return add(this.centre, scale(normalize(direction), this.surfaceRadius + altitude));
  }
  /** Componente de `v` no plano tangente em `p`. */
  tangentAt(p: Vec3, v: Vec3): Vec3 {return reject(v, this.up(p));}

  /**
   * Base ortonormal de superfície em `p`. `forwardHint` só precisa ter alguma projeção tangente;
   * quando não tem (olhando direto para cima/baixo) cai numa perpendicular estável.
   *
   * Convenção de mão-esquerda igual à do jogo atual: com `up = +Y` e `forward = (sin y, 0, cos y)`,
   * `right = up × forward = (cos y, 0, −sin y)` — exatamente o `right` de `ThirdPersonCamera`.
   */
  basisAt(p: Vec3, forwardHint: Vec3): SurfaceBasis {
    const up = this.up(p);
    let forward = reject(forwardHint, up);
    if (length(forward) < 1e-6) forward = anyPerpendicular(up);
    forward = normalize(forward, anyPerpendicular(up));
    return {up, forward, right: cross(up, forward)};
  }

  /**
   * Passo geodésico exato: anda `tangentDelta` (comprimento de arco) mantendo o raio,
   * e devolve a direção de marcha JÁ transportada.
   *
   *   θ  = |d| / r        p' = p·cos θ + t·r·sin θ        t' = −(p/r)·sin θ + t·cos θ
   *
   * `|p'| = r` por construção — mil passos não afastam o corpo da esfera.
   */
  geodesicStep(p: Vec3, tangentDelta: Vec3): GeodesicStep {
    const radial = sub(p, this.centre), r = length(radial);
    if (r < 1e-9) return {position: copy(p), direction: normalize(tangentDelta), angle: 0};
    const up = scale(radial, 1 / r);
    const planar = reject(tangentDelta, up), arc = length(planar);
    if (arc < 1e-12) return {position: copy(p), direction: anyPerpendicular(up), angle: 0};
    const t = scale(planar, 1 / arc), angle = arc / r, cos = Math.cos(angle), sin = Math.sin(angle);
    return {
      position: add(this.centre, add(scale(up, r * cos), scale(t, r * sin))),
      direction: add(scale(up, -sin), scale(t, cos)),
      angle,
    };
  }

  /** Transporte paralelo entre dois pontos do planeta (não entre verticais soltas). */
  transportBetween(v: Vec3, from: Vec3, to: Vec3): Vec3 {
    return transport(v, this.up(from), this.up(to));
  }

  /** Ângulo central entre dois pontos, robusto perto de 0 e de π. */
  centralAngle(a: Vec3, b: Vec3): number {
    const ua = this.up(a), ub = this.up(b);
    return Math.atan2(length(cross(ua, ub)), dot(ua, ub));
  }
  /** Distância percorrida a pé entre dois pontos, medida no convés nominal. */
  arcDistance(a: Vec3, b: Vec3): number {return this.centralAngle(a, b) * this.surfaceRadius;}
  /** Volta completa no convés nominal. */
  get circumference(): number {return 2 * Math.PI * this.surfaceRadius;}

  /**
   * Direção unitária a partir de longitude/latitude em graus.
   * lat +90 = `north` (0,1,0); lat 0/lon 0 = `front` (0,0,1); lat 0/lon +90 = `east` (1,0,0).
   */
  static direction(longitudeDegrees: number, latitudeDegrees: number): Vec3 {
    const lat = latitudeDegrees * Math.PI / 180, lon = longitudeDegrees * Math.PI / 180;
    const c = Math.cos(lat);
    return {x: c * Math.sin(lon), y: Math.sin(lat), z: c * Math.cos(lon)};
  }
  static lonLat(direction: Vec3): {longitudeDegrees: number; latitudeDegrees: number} {
    const d = normalize(direction);
    return {
      longitudeDegrees: Math.atan2(d.x, d.z) * 180 / Math.PI,
      latitudeDegrees: Math.asin(Math.max(-1, Math.min(1, d.y))) * 180 / Math.PI,
    };
  }
  /**
   * Base geográfica de um ponto da superfície: `east` aponta para longitude crescente,
   * `north` para o polo +Y. Nos polos, onde não há leste definido, cai em `+X` de forma estável.
   */
  static compass(up: Vec3): {east: Vec3; north: Vec3} {
    const raw = cross({x: 0, y: 1, z: 0}, up);
    const east = length(raw) < 1e-6 ? {x: 1, y: 0, z: 0} : normalize(raw);
    return {east, north: cross(up, east)};
  }
}
