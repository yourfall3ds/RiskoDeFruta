import {CreateTorus} from '@babylonjs/core/Meshes/Builders/torusBuilder';
import {StandardMaterial} from '@babylonjs/core/Materials/standardMaterial';
import {Color3} from '@babylonjs/core/Maths/math.color';
import {Quaternion,Vector3} from '@babylonjs/core/Maths/math.vector';
import {Constants} from '@babylonjs/core/Engines/constants';
import type {Mesh} from '@babylonjs/core/Meshes/mesh';
import type {Scene} from '@babylonjs/core/scene';

/**
 * O alvo MARCADO pela chuva de mísseis.
 *
 * A habilidade tem 0,8 s entre marcar e o céu responder. Sem nada na tela esse intervalo parece
 * a habilidade ter falhado — o jogador aperta, gasta 100 MP e fica olhando. O marcador é o que
 * transforma a espera em expectativa: ele diz QUEM já era, e o míssil só confirma.
 *
 * Um anel que aperta em volta do alvo enquanto a contagem corre. Apertar (e não piscar) é o que
 * comunica prazo: o tamanho do anel É o tempo restante, legível sem número nem barra.
 *
 * O anel fica DEITADO sobre a vertical local do alvo, como a marca de fogo no chão — no planeta um
 * anel em `+Y` ficaria de pé no equador.
 */

/** Anéis desenháveis ao mesmo tempo: a habilidade marca três, e três é o teto. */
const SLOTS = 3;

export interface Mark {
  /** Centro do alvo, em MUNDO. */
  readonly position: Vector3;
  /** Vertical local no ponto. */
  readonly up: Vector3;
  /** Fração 0..1 da contagem já corrida; 1 é o instante do impacto. */
  readonly progress: number;
  /** Raio nominal do alvo, para o anel nascer maior que ele. */
  readonly radius: number;
}

export class StrikeMarker {
  private readonly rings: Mesh[] = [];
  private readonly material: StandardMaterial;
  private readonly scratch = new Vector3();

  constructor(scene: Scene) {
    this.material = new StandardMaterial('strike-marker', scene);
    this.material.emissiveColor = new Color3(3, .5, .12);
    this.material.disableLighting = true;
    this.material.alphaMode = Constants.ALPHA_ADD;
    this.material.backFaceCulling = false;
    for (let i = 0; i < SLOTS; i++) {
      const ring = CreateTorus('strike-marker-' + i, {diameter: 2, thickness: .08, tessellation: 24}, scene);
      ring.material = this.material;
      ring.isPickable = false;
      ring.setEnabled(false);
      this.rings.push(ring);
    }
  }

  /** Desenha as marcas deste quadro. Lista vazia apaga tudo. */
  render(marks: readonly Mark[]): void {
    for (let i = 0; i < this.rings.length; i++) {
      const ring = this.rings[i]!;
      const mark = marks[i];
      if (!mark) {ring.setEnabled(false); continue;}
      const t = Math.min(1, Math.max(0, mark.progress));
      // Abre em 2,6× o raio do alvo e fecha em 1,05×: o anel APERTA conforme o prazo corre.
      const scale = mark.radius * (2.6 - 1.55 * t);
      ring.setEnabled(true);
      ring.position.copyFrom(mark.position);
      // O toro nasce deitado no plano XZ com eixo em `+Y`; alinhar `+Y` à vertical local basta.
      ring.rotationQuaternion = Quaternion.FromUnitVectorsToRef(
        Vector3.Up(), this.scratch.copyFrom(mark.up).normalize(), new Quaternion(),
      );
      ring.scaling.setAll(Math.max(.05, scale));
    }
    // Perto do impacto o anel acende: o brilho é o aviso de que acabou o tempo.
    const hottest = marks.reduce((peak, mark) => Math.max(peak, mark.progress), 0);
    this.material.alpha = .45 + Math.min(1, hottest) * .5;
  }

  clear(): void {for (const ring of this.rings) ring.setEnabled(false);}

  dispose(): void {
    this.clear();
    for (const ring of this.rings) ring.dispose();
    this.rings.length = 0;
    this.material.dispose();
  }
}
