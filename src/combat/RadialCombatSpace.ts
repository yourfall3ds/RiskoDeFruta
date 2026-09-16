import {Vector3} from '@babylonjs/core/Maths/math.vector';
import type {SurfaceFrame} from '../physics/SurfaceFrame';
import type {CombatBasis, CombatSpace} from './DualPistols';

/**
 * O espaço que as pistolas AUTORAIS enxergam quando o mapa é curvo.
 *
 * `DualPistols` não foi duplicado nem simplificado: ele só deixou de presumir que "para cima" é o
 * `+Y` do mundo. Esta classe responde as três perguntas do contrato `CombatSpace` a partir do
 * referencial do mapa — e é tudo que separa o combate original de funcionar em qualquer polo.
 *
 * O referencial entra como **função**, nunca como valor guardado: o `CollisionWorld` só vira
 * esférico quando `configurePlanet` roda, e isso acontece depois que a cena (e as armas) já foram
 * construídas. Guardar o `SurfaceFrame` aqui congelaria o leque, o arremesso do carregador e a
 * guinada do MP II no plano — o mesmo defeito que o avatar radial já teve.
 */
export class RadialCombatSpace implements CombatSpace {
  constructor(private readonly surfaceOf: () => SurfaceFrame) {}

  upAt(point: Vector3, result?: Vector3): Vector3 {
    const up = this.surfaceOf().up(point);
    return (result ?? new Vector3()).set(up.x, up.y, up.z);
  }

  frameAt(point: Vector3, forwardHint: Vector3, result?: CombatBasis): CombatBasis {
    const basis = this.surfaceOf().basis(point, forwardHint);
    const target = result ?? {up: new Vector3(), right: new Vector3(), forward: new Vector3()};
    target.up.set(basis.up.x, basis.up.y, basis.up.z);
    target.right.set(basis.right.x, basis.right.y, basis.right.z);
    target.forward.set(basis.forward.x, basis.forward.y, basis.forward.z);
    return target;
  }

  /**
   * Identidade — e isso é uma decisão, não um esquecimento.
   *
   * `CharacterVisual.position` É local sob o pai radial, mas `RadialAvatar.update` a reescreve para
   * MUNDO logo depois de `visual.update`, justamente porque armas, efeitos e apresentação precisam
   * de mundo. Converter de novo aqui aplicaria a transformação duas vezes e jogaria o coldre para
   * fora do planeta. A conversão existe num lugar só, e é lá.
   */
  toWorld(local: Vector3, result?: Vector3): Vector3 {
    return (result ?? new Vector3()).copyFrom(local);
  }
}
