import type {Vec3} from '../core/contracts';
import type {NavFrame} from './NavTypes';
import {distance, length, normalize, reject, sub} from './NavMath';

export interface FollowStep {
  /** Intenção de marcha: unitária e TANGENTE em `position`. `{0,0,0}` quando chegou. */
  readonly direction: Vec3;
  /** Metros que ainda faltam pela polilinha. */
  readonly remaining: number;
  readonly arrived: boolean;
  /** `true` quando o ator está longe demais do caminho: quem chama deve pedir rota nova. */
  readonly strayed: boolean;
  /** Ponto que está sendo perseguido agora — útil para depuração visual. */
  readonly target: Vec3 | undefined;
}

const ZERO: Vec3 = {x: 0, y: 0, z: 0};

/**
 * Seguidor de polilinha para o ator local.
 *
 * Não move ninguém: devolve a direção tangente que o motor de colisão deve consumir como entrada
 * de marcha. Assim o motor continua sendo o único dono do encaixe no solo, do degrau e do
 * escorregamento — o caminho só diz PARA ONDE, nunca COMO.
 */
export class PathFollower {
  private index = 0;
  /** Menor distância já alcançada do alvo atual — a régua do desvio. */
  private acquired = Infinity;
  private acquiredFor = -1;
  private readonly points: Vec3[];
  private readonly arriveRadius: number;
  private readonly strayRadius: number;

  constructor(
    private readonly frame: NavFrame,
    points: readonly Vec3[],
    options?: {arriveRadius?: number; strayRadius?: number},
  ) {
    this.points = points.map(p => ({x: p.x, y: p.y, z: p.z}));
    this.arriveRadius = options?.arriveRadius ?? 0.9;
    this.strayRadius = options?.strayRadius ?? 8;
  }

  get done(): boolean {return this.index >= this.points.length;}
  get waypoints(): readonly Vec3[] {return this.points;}

  /** Metros da polilinha do alvo atual até o fim — sem contar a distância do ator até o alvo. */
  get remainingDistance(): number {
    let total = 0;
    for (let i = this.index + 1; i < this.points.length; i++) {
      total += distance(this.points[i - 1]!, this.points[i]!);
    }
    return total;
  }

  update(position: Vec3): FollowStep {
    while (this.index < this.points.length && distance(position, this.points[this.index]!) <= this.arriveRadius) {
      this.index++;
    }
    const target = this.points[this.index];
    if (!target) return {direction: ZERO, remaining: 0, arrived: true, strayed: false, target: undefined};
    const gap = distance(position, target);
    // O desvio é medido contra a MENOR distância já alcançada deste alvo, não contra um teto
    // absoluto: uma perna suavizada legítima tem 12 m e um teto fixo acusaria desvio já no começo.
    // Como a régua encolhe conforme o ator se aproxima, um empurrão depois de chegar perto também
    // é pego — que é justamente o caso de queda, recuperação ou dano em área.
    if (this.acquiredFor !== this.index) {this.acquiredFor = this.index; this.acquired = gap;}
    else if (gap < this.acquired) this.acquired = gap;
    const tangent = reject(sub(target, position), this.frame.up(position));
    const direction = length(tangent) < 1e-6 ? ZERO : normalize(tangent);
    return {
      direction,
      remaining: gap + this.remainingDistance,
      arrived: false,
      strayed: gap > this.acquired + this.strayRadius,
      target: {x: target.x, y: target.y, z: target.z},
    };
  }

  /** Recomeça do início — usado quando a rota é recalculada com os mesmos pontos. */
  reset(): void {this.index = 0; this.acquiredFor = -1; this.acquired = Infinity;}
}
