import type {Vec3} from '../core/contracts';
import type {NavCollision, NavFrame, NavOptions} from './NavTypes';
import {add, clamp, distance, dot, normalize, scale, slerp, sub} from './NavMath';

/** Uma camada de piso encontrada numa coluna radial. */
export interface FloorSample {
  readonly point: Vec3;
  readonly normal: Vec3;
  readonly radius: number;
  readonly slopeDegrees: number;
}

/** Por que uma ligação entre dois nós foi recusada — alimenta o refino e o relatório. */
export type LinkVerdict = 'ok' | 'far' | 'step' | 'gap' | 'blocked';

const DEG = 180 / Math.PI;

/**
 * Todas as perguntas que a navegação faz à geometria autoral.
 *
 * Regra única e inegociável: **nada é inventado no raio nominal**. Se a sonda não devolve
 * triângulo, ali não há chão — o mapa perde um nó e a auditoria ganha um número, em vez de o
 * jogador ganhar um caminho que atravessa o vazio.
 */
export class NavProbe {
  constructor(
    private readonly frame: NavFrame,
    private readonly collision: NavCollision,
    private readonly options: NavOptions,
  ) {}

  /**
   * Camadas de piso pisáveis de uma coluna radial, de fora para dentro.
   *
   * Sondar de fora (R+60) para dentro é o que torna o telhado visível como telhado. Continuar
   * a partir do ponto de impacto colhe o piso SOB o telhado — sem isso, celeiro e galpão viram
   * buraco no mapa porque o único candidato da coluna era a cobertura.
   */
  column(direction: Vec3): FloorSample[] {
    const o = this.options, frame = this.frame;
    const dir = normalize(direction);
    const startRadius = frame.surfaceRadius + o.probeAbove;
    const minRadius = frame.surfaceRadius + o.minAltitude;
    const maxRadius = frame.surfaceRadius + o.maxAltitude;
    const down = scale(dir, -1);
    let origin = add(frame.centre, scale(dir, startRadius));
    let budget = startRadius - minRadius;
    const out: FloorSample[] = [];
    for (let layer = 0; layer < o.layers && budget > 1e-3; layer++) {
      const hit = this.collision.raycast(origin, down, budget);
      if (!hit) break;
      const advance = hit.distance + 1e-3;
      origin = add(origin, scale(down, advance));
      budget -= advance;
      const radius = frame.radius(hit.point);
      // Abaixo do piso mínimo é flanco de penhasco ou barriga de ilha: para de descer nesta coluna.
      if (radius < minRadius) break;
      if (radius > maxRadius) continue;
      const up = frame.up(hit.point);
      const facing = dot(hit.normal, up);
      const normal = facing < 0 ? scale(hit.normal, -1) : hit.normal;
      const slopeDegrees = Math.acos(clamp(Math.abs(facing), -1, 1)) * DEG;
      if (slopeDegrees > o.maxSlopeDegrees) continue;
      if (!this.standable(hit.point, up)) continue;
      out.push({point: hit.point, normal, radius, slopeDegrees});
    }
    return out;
  }

  /**
   * Raio do PRIMEIRO triângulo da coluna, sem nenhum filtro. Só para diagnóstico: separa
   * "não existe piso aqui" de "existe piso, mas a cápsula não cabe em pé nele".
   */
  firstSurface(direction: Vec3): number | undefined {
    const o = this.options, frame = this.frame;
    const dir = normalize(direction);
    const start = frame.surfaceRadius + o.probeAbove;
    // Desce quase até o centro: a casca não tem lado de lá para atrapalhar, e assim o
    // diagnóstico enxerga inclusive o piso rejeitado por estar fundo demais.
    const hit = this.collision.raycast(
      add(frame.centre, scale(dir, start)), scale(dir, -1), start - frame.surfaceRadius * 0.1);
    return hit ? frame.radius(hit.point) : undefined;
  }

  /** Camada da coluna mais próxima de um raio alvo — usada por ponte/spawn, que têm convés autoral. */
  layerNear(direction: Vec3, targetRadius: number, tolerance: number): FloorSample | undefined {
    let best: FloorSample | undefined, bestGap = Infinity;
    for (const sample of this.column(direction)) {
      const gap = Math.abs(sample.radius - targetRadius);
      if (gap < bestGap) {bestGap = gap; best = sample;}
    }
    return best && bestGap <= tolerance ? best : undefined;
  }

  /** A cápsula cabe em pé neste piso? Teto e parede contam; o próprio piso não. */
  standable(point: Vec3, up: Vec3): boolean {
    const o = this.options;
    const base = add(point, scale(up, o.embedTolerance * 5));
    if (this.collision.raycast(base, up, o.capsuleHeight)) return false;
    const contact = this.collision.deepestContact?.(base, up, o.capsuleRadius, o.capsuleHeight);
    return !(contact && contact.depth > o.embedTolerance);
  }

  /** Ponto do convés interpolado entre `a` e `b`: direção por slerp, raio por lerp. */
  between(a: Vec3, b: Vec3, t: number): Vec3 {
    const frame = this.frame;
    const ra = frame.radius(a), rb = frame.radius(b);
    const dir = slerp(frame.up(a), frame.up(b), t);
    return add(frame.centre, scale(dir, ra + (rb - ra) * t));
  }

  /**
   * Existe piso contínuo ao longo do segmento?
   *
   * É esta sonda — e só ela — que impede o atalho por cima do vazio entre duas ilhas vizinhas.
   * O passo é o diâmetro da cápsula: nenhum buraco maior que o corpo passa entre duas sondas.
   */
  supportAlong(a: Vec3, b: Vec3): boolean {
    const o = this.options;
    const span = distance(a, b);
    const steps = Math.max(2, Math.ceil(span / o.supportSpacing));
    for (let i = 1; i < steps; i++) {
      const point = this.between(a, b, i / steps);
      const up = this.frame.up(point);
      const support = this.collision.supportBelow(point, up, o.supportAbove, o.supportBelow);
      if (!support || support.slopeDegrees > o.maxSlopeDegrees) return false;
    }
    return true;
  }

  /**
   * A cápsula passa de `a` para `b` sem atravessar sólido?
   *
   * A varredura é uma RETA no espaço de mundo enquanto a caminhada é um arco. Em R=200 m e 4 m de
   * vão a flecha é 1 cm e a inclinação do eixo 1,15°: uma ordem de grandeza abaixo do raio de
   * 0,35 m da cápsula. Aproximação consciente, não descuido.
   */
  clearSweep(a: Vec3, b: Vec3, lift = this.options.stepHeight): boolean {
    const o = this.options;
    const up = this.frame.up(a);
    const base = add(a, scale(up, lift));
    const height = Math.max(o.capsuleRadius * 2, o.capsuleHeight - lift);
    return !this.collision.sweepCapsule(base, up, sub(b, a), o.capsuleRadius, height);
  }

  /**
   * Veredito completo de ligação, com o motivo — o motivo é o que o refino usa para decidir.
   *
   * A cápsula é levantada pelo PRÓPRIO degrau tolerado: permitir um degrau de 0,6 m e varrer a
   * 0,35 m do chão é contradição — a varredura bateria na face do degrau e recusaria a ligação
   * que a regra acabou de autorizar.
   */
  link(a: Vec3, b: Vec3, maxDistance: number, maxStep: number): LinkVerdict {
    const span = distance(a, b);
    if (span < 1e-6 || span > maxDistance) return 'far';
    if (Math.abs(this.frame.radius(b) - this.frame.radius(a)) > maxStep) return 'step';
    if (!this.supportAlong(a, b)) return 'gap';
    if (!this.clearSweep(a, b, Math.max(this.options.stepHeight, maxStep))) return 'blocked';
    return 'ok';
  }
}
