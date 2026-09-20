import {CreateDisc} from '@babylonjs/core/Meshes/Builders/discBuilder';
import {StandardMaterial} from '@babylonjs/core/Materials/standardMaterial';
import {Color3} from '@babylonjs/core/Maths/math.color';
import {Quaternion,Vector3} from '@babylonjs/core/Maths/math.vector';
import {Constants} from '@babylonjs/core/Engines/constants';
import type {Mesh} from '@babylonjs/core/Meshes/mesh';
import type {Scene} from '@babylonjs/core/scene';
import type {GroundFirePatch} from '../combat/GroundFire';

/**
 * O chão em chamas, desenhado.
 *
 * Duas peças por poça, e cada uma resolve um problema diferente:
 *
 * 1. **a marca no chão** — um disco deitado na superfície, que diz ONDE não pisar. É o que faz a
 *    poça ser área negada legível em vez de um brilho ambíguo;
 * 2. **as labaredas** — chamas pedidas ao `ElementalEffects` que já existe, em cadência própria.
 *    Não reimplemento fogo: aquele sistema já tem o shader, a luz e o orçamento.
 *
 * O disco é orientado pela vertical LOCAL da poça, não por `+Y`. No planeta uma marca em `+Y`
 * ficaria de pé feito placa no equador — é a mesma correção que o míssil e o leque já fazem.
 *
 * Os discos são um pool do tamanho do teto de poças: nenhuma alocação por quadro, e uma poça que
 * apaga devolve o disco em vez de descartá-lo.
 */

/** Quantas chamas por segundo cada poça pede. Acima disso vira sopa e come orçamento. */
const FLAMES_PER_SECOND = 7;
/** Chamas pedidas por quadro no total, somando todas as poças. */
const FLAME_BUDGET = 3;

export interface FlamePort {
  /** A mesma assinatura de `ElementalEffects.emit`. */
  emit(kind: 'fire', at: Vector3, power: number): void;
}

export class GroundFireView {
  private readonly discs: Mesh[] = [];
  private readonly material: StandardMaterial;
  /** Relógio de labareda por poça, casado por índice com a lista que `render` recebe. */
  private readonly clocks: number[] = [];
  private readonly scratch = new Vector3();

  constructor(scene: Scene, limit: number) {
    this.material = new StandardMaterial('ground-fire-scorch', scene);
    this.material.emissiveColor = new Color3(1.6, .42, .07);
    this.material.diffuseColor = new Color3(.06, .02, .01);
    this.material.disableLighting = true;
    this.material.alphaMode = Constants.ALPHA_ADD;
    this.material.backFaceCulling = false;
    for (let i = 0; i < limit; i++) {
      const disc = CreateDisc('ground-fire-' + i, {radius: 1, tessellation: 20}, scene);
      disc.material = this.material;
      disc.isPickable = false;
      disc.setEnabled(false);
      this.discs.push(disc);
    }
  }

  /**
   * Desenha as poças vivas deste quadro.
   *
   * `flames` é opcional: sem ela ficam só as marcas no chão, que é o que um ambiente sem o sistema
   * elemental (teste, revisão) consegue mostrar sem inventar nada.
   */
  render(patches: readonly GroundFirePatch[], dt: number, flames?: FlamePort): void {
    const step = Math.max(0, dt);
    let budget = FLAME_BUDGET;
    for (let i = 0; i < this.discs.length; i++) {
      const disc = this.discs[i]!;
      const patch = patches[i];
      if (!patch) {disc.setEnabled(false); this.clocks[i] = 0; continue;}
      const life = Math.max(0, Math.min(1, patch.remaining / patch.duration));
      // O disco encolhe e apaga junto com a poça: quem vê a marca murchar sabe que dá para passar.
      const radius = patch.radius * (.55 + life * .45);
      disc.setEnabled(true);
      // A face do disco olha para a vertical local; `+Z` do disco é a normal dele.
      disc.rotationQuaternion = Quaternion.FromUnitVectorsToRef(
        Vector3.Forward(), this.scratch.copyFromFloats(patch.up.x, patch.up.y, patch.up.z), new Quaternion(),
      );
      // Meio palmo acima do chão: colado demais briga com o terreno (z-fighting), alto demais flutua.
      disc.position.set(
        patch.centre.x + patch.up.x * .06,
        patch.centre.y + patch.up.y * .06,
        patch.centre.z + patch.up.z * .06,
      );
      disc.scaling.setAll(radius);
      this.material.alpha = .3;
      // As labaredas seguem a vida da poça e respeitam o orçamento do quadro.
      if (!flames || budget <= 0) continue;
      const clock = (this.clocks[i] ?? 0) - step;
      if (clock > 0) {this.clocks[i] = clock; continue;}
      this.clocks[i] = 1 / FLAMES_PER_SECOND;
      budget--;
      // Ponto sorteado no disco, erguido um palmo: a chama nasce DENTRO da marca, não no centro.
      const angle = patch.remaining * 4.7 + i * 2.399;
      const spread = radius * .62;
      flames.emit('fire', new Vector3(
        patch.centre.x + Math.cos(angle) * spread + patch.up.x * .35,
        patch.centre.y + Math.sin(angle * .7) * spread * .25 + patch.up.y * .35,
        patch.centre.z + Math.sin(angle) * spread + patch.up.z * .35,
      ), .55 + life * .45);
    }
  }

  clear(): void {
    for (const disc of this.discs) disc.setEnabled(false);
    this.clocks.length = 0;
  }

  dispose(): void {
    this.clear();
    for (const disc of this.discs) disc.dispose();
    this.discs.length = 0;
    this.material.dispose();
  }
}
