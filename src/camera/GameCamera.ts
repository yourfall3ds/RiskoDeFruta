import type {FreeCamera} from '@babylonjs/core/Cameras/freeCamera';
import type {Vector3} from '@babylonjs/core/Maths/math.vector';
import type {Vec3} from '../core/contracts';

/**
 * A câmera do jogo, vista pelo jogo.
 *
 * `ThirdPersonCamera` (mundo plano) e `RadialCamera` (planeta) implementam isto. O contrato é
 * exatamente o que `PlayerScene` e `DualPistols` já consumiam — nada foi inventado e nada foi
 * cortado: tremor, dano, corrida, distância, FOV e o close das habilidades continuam aqui, porque
 * eles SÃO o toque do jogo original.
 *
 * As duas adições são o mínimo que o planeta exige de quem chama:
 *
 * - `heading`: a frente da câmera projetada no plano tangente. No mundo plano é
 *   `(sin yaw, 0, cos yaw)`; no planeta é o vetor transportado. É o que o motor consome para andar,
 *   e é o que substitui "mandar o `yaw` global" — que no polo não existe.
 * - `up`: a vertical da câmera. No plano é sempre `+Y`.
 */
export interface GameCamera {
  readonly camera: FreeCamera;
  /** Direção de visão com o pitch aplicado. */
  readonly forward: Vector3;
  /** Frente projetada no plano tangente do corpo — a marcha. */
  readonly heading: Vec3;
  /** Vertical local da câmera. */
  readonly up: Vec3;

  /**
   * `yaw`/`pitch` são o acumulador de `GameInput`. A câmera plana os usa como ÂNGULO ABSOLUTO; a
   * radial usa a DIFERENÇA em relação ao quadro anterior (no planeta não existe ângulo absoluto).
   * Quem chama não precisa saber a diferença.
   */
  update(position: Vec3, yaw: number, pitch: number, dt: number, velocity?: Vec3): void;

  setSprint(sprinting: boolean): void;
  sprintBlendTarget: number;
  impulse(strength: number): void;
  hurt(strength: number, side: number): void;
  skillClose(position: Vec3, yaw: number, tier: 1 | 2 | 3, progress: number): void;
  preferredDistance: number;
  setFovDegrees(degrees: number): void;
  shake: number;

  /**
   * Sobrepõe uma pose de apresentação (entrada pela nave, extração, revisão de combo, morte).
   *
   * No jogo plano isto era feito escrevendo `camera.position` e `camera.setTarget` direto na cena.
   * Virou método porque no planeta `setTarget` degenera: ele reconstrói a rotação a partir do `Y`
   * do MUNDO e zera o roll, e quem está no equador olhando para o polo passa exatamente por essa
   * singularidade. A versão radial monta a base por quaternion.
   */
  blend(position: Vec3, target: Vec3, weight: number, up?: Vec3): void;

  /** Realinha sem suavização: troca de ilha, recuperação, teleporte de QA. */
  snapTo(position: Vec3, heading?: Vec3): void;
}
