import type {Vec3} from '../core/contracts';
import {CAMERA_TUNING} from '../player/PlayerTuning';
import type {PlanetCollision} from './PlanetCollision';
import {
  PlanetFrame, add, copy, cross, dot, length, normalize, reject, rotateAbout, scale, sub, transport,
} from './PlanetFrame';

/**
 * Pose de câmera em terceira pessoa com "para cima" do planeta.
 *
 * Não depende do Babylon e não devolve roll cosmético: devolve `up` de verdade.
 * Integração: `camera.upVector.copyFrom(up); camera.position.copyFrom(position); camera.setTarget(target)`.
 * `PlanetaryHorizon` (roll fake sobre simulação plana) fica obsoleto e não é usado aqui.
 *
 * A direção de mira é um VETOR tangente transportado, igual à frente do personagem.
 * Não existe ângulo `yaw` global, logo não existe salto ao cruzar o polo.
 */

export interface PlanetCameraTuning {
  distance: number; shoulderOffset: number; pivotHeight: number;
  radius: number; smoothing: number; sensitivity: number;
  pitchMin: number; pitchMax: number; defaultPitch: number;
}

export const PLANET_CAMERA_TUNING: PlanetCameraTuning = {
  distance: CAMERA_TUNING.distance, shoulderOffset: CAMERA_TUNING.shoulderOffset,
  pivotHeight: CAMERA_TUNING.pivotHeight, radius: CAMERA_TUNING.radius,
  smoothing: CAMERA_TUNING.smoothing, sensitivity: CAMERA_TUNING.sensitivity,
  pitchMin: CAMERA_TUNING.pitchMin, pitchMax: CAMERA_TUNING.pitchMax,
  defaultPitch: CAMERA_TUNING.defaultPitch,
};

export interface CameraPose {
  position: Vec3;
  target: Vec3;
  /** Vertical local da câmera. Vai direto para `FreeCamera.upVector`. */
  up: Vec3;
  /** Direção de visão, já com o pitch aplicado. */
  forward: Vec3;
  right: Vec3;
  /** Distância efetiva depois do recuo por colisão. */
  distance: number;
}

export class PlanetCamera {
  /** Direção de marcha da câmera: unitário TANGENTE ao ponto onde o alvo está. */
  heading: Vec3;
  pitch: number;
  private readonly frame: PlanetFrame;
  private readonly collision: PlanetCollision | undefined;
  private readonly tuning: PlanetCameraTuning;
  private readonly pivot: Vec3;
  private distance: number;
  private started = false;

  constructor(
    frame: PlanetFrame,
    anchor: Vec3,
    options: {collision?: PlanetCollision; heading?: Vec3; tuning?: Partial<PlanetCameraTuning>} = {},
  ) {
    this.frame = frame;
    if (options.collision) this.collision = options.collision;
    this.tuning = {...PLANET_CAMERA_TUNING, ...options.tuning};
    this.heading = frame.basisAt(anchor, options.heading ?? {x: 0, y: 0, z: 1}).forward;
    this.pitch = this.tuning.defaultPitch;
    this.pivot = add(anchor, scale(frame.up(anchor), this.tuning.pivotHeight));
    this.distance = this.tuning.distance;
  }

  /** Movimento de mouse/analógico. `dx` gira no plano tangente, `dy` inclina. */
  look(dx: number, dy: number, anchorUp?: Vec3): void {
    const up = anchorUp ?? this.frame.up(this.pivot);
    const right = cross(up, this.heading);
    const angle = dx * this.tuning.sensitivity;
    this.heading = normalize(
      add(scale(this.heading, Math.cos(angle)), scale(right, Math.sin(angle))),
      this.heading,
    );
    this.pitch = Math.max(this.tuning.pitchMin, Math.min(this.tuning.pitchMax, this.pitch + dy * this.tuning.sensitivity));
  }

  /**
   * `anchor` é o pé do personagem. `dt` em segundos.
   * A cada quadro o rumo é TRANSPORTADO da vertical do quadro anterior para a atual —
   * é o que mantém o enquadramento contínuo ao contornar o planeta.
   */
  update(anchor: Vec3, dt: number): CameraPose {
    const t = this.tuning;
    const previousUp = this.frame.up(this.pivot);
    const up = this.frame.up(anchor);
    this.heading = normalize(reject(transport(this.heading, previousUp, up), up), this.heading);

    const wanted = add(anchor, scale(up, t.pivotHeight));
    const blend = this.started ? 1 - Math.exp(-Math.min(dt, 0.1) / t.smoothing) : 1;
    this.pivot.x += (wanted.x - this.pivot.x) * blend;
    this.pivot.y += (wanted.y - this.pivot.y) * blend;
    this.pivot.z += (wanted.z - this.pivot.z) * blend;

    const right = cross(up, this.heading);
    // Pitch positivo olha para BAIXO, igual à convenção do jogo plano.
    const forward = normalize(sub(scale(this.heading, Math.cos(this.pitch)), scale(up, Math.sin(this.pitch))));
    const delta = add(scale(forward, -t.distance), scale(right, t.shoulderOffset));
    let allowed = t.distance;
    if (this.collision) {
      const base = sub(this.pivot, scale(up, t.radius));
      const hit = this.collision.sweepCapsule(base, up, delta, t.radius, t.radius * 2);
      if (hit) allowed = Math.max(0.15, t.distance * Math.max(0, hit.time - 0.02));
    }
    // Aproximar é imediato (nunca atravessa parede); afastar é suavizado.
    this.distance = allowed < this.distance ? allowed : this.distance + (allowed - this.distance) * blend;
    const position = add(this.pivot, scale(delta, this.distance / t.distance));
    this.started = true;
    return {
      position,
      target: add(position, forward),
      up: copy(up),
      forward,
      right,
      distance: this.distance,
    };
  }

  /** Frente da câmera projetada no plano tangente — é o `heading` que o motor consome. */
  get motorHeading(): Vec3 {return copy(this.heading);}

  /**
   * Distância de enquadramento pedida (o regulador do F1).
   *
   * Tem de entrar AQUI, e não ser aplicada depois como uma escala sobre a pose devolvida: o recuo
   * por colisão é calculado em cima desta distância, e multiplicar o resultado já recuado joga a
   * câmera de volta para dentro da parede. Quem quiser afastar a câmera afasta o alvo da varredura,
   * não o resultado dela.
   */
  get preferredDistance(): number {return this.tuning.distance;}
  set preferredDistance(metres: number) {
    const wanted = Number.isFinite(metres) && metres > 0.15 ? metres : PLANET_CAMERA_TUNING.distance;
    if (wanted === this.tuning.distance) return;
    // A distância corrente acompanha a mudança na mesma proporção, senão o primeiro quadro depois
    // do ajuste daria um salto (o núcleo só suaviza o AFASTAR, nunca o aproximar).
    this.distance *= wanted / this.tuning.distance;
    this.tuning.distance = wanted;
  }

  /** Realinha sem suavização (troca de bioma, recuperação, cinemática). */
  snapTo(anchor: Vec3, heading?: Vec3): void {
    const up = this.frame.up(anchor);
    if (heading) {
      const tangent = reject(heading, up);
      if (length(tangent) > 1e-6) this.heading = normalize(tangent);
    }
    Object.assign(this.pivot, add(anchor, scale(up, this.tuning.pivotHeight)));
    this.distance = this.tuning.distance;
    this.started = false;
  }
}

/** Ângulo entre duas direções tangentes no mesmo ponto — útil para diagnóstico e testes. */
export function tangentAngle(up: Vec3, a: Vec3, b: Vec3): number {
  const ta = normalize(reject(a, up)), tb = normalize(reject(b, up));
  return Math.atan2(dot(cross(ta, tb), up), dot(ta, tb));
}

/** Gira uma tangente em torno da vertical local. */
export function turnTangent(up: Vec3, tangent: Vec3, radians: number): Vec3 {
  return normalize(reject(rotateAbout(tangent, up, Math.cos(radians), Math.sin(radians)), up), tangent);
}
