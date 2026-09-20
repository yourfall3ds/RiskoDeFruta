import {CreateCylinder} from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import {CreateSphere} from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import {StandardMaterial} from '@babylonjs/core/Materials/standardMaterial';
import {Color3} from '@babylonjs/core/Maths/math.color';
import {Quaternion,Vector3} from '@babylonjs/core/Maths/math.vector';
import type {Mesh} from '@babylonjs/core/Meshes/mesh';
import type {Scene} from '@babylonjs/core/scene';

/**
 * A CARGA DE ÍONS na tela: a energia subindo no cano e o feixe que ela solta.
 *
 * Existe porque a habilidade sem visual repete exatamente o defeito que ela veio consertar — a
 * SOBRECARGA antiga gastava 100 MP e não mostrava nada, e o jogador concluía que o `Q III` estava
 * quebrado. Um feixe que causa dano sem aparecer é o mesmo erro com outro nome.
 *
 * **Por quadro, não por emissão.** O feixe entrega doze tiques de dano em 0,6 s; desenhar um risco
 * por tique daria doze piscadas, não um feixe. Aqui o dano e a imagem são coisas separadas: a arma
 * chama `show` TODO quadro enquanto o feixe estiver no ar, e `update` apaga o que não foi
 * renovado. É o mesmo contrato de `EnemyLaser`, que desenha o feixe da cenoura.
 *
 * Três cilindros concêntricos (núcleo, corpo, halo) e uma esfera de carga, criados uma vez e
 * reaproveitados: nenhuma alocação por quadro.
 */

/** Espessura de cada camada, do núcleo para fora, como fator da espessura base. */
const LAYERS = [.22, .55, 1] as const;
/** Opacidade de cada camada. O núcleo é sólido; o halo é véu. */
const ALPHA = [1, .45, .16] as const;

export class IonBeam {
  private readonly tubes: Mesh[] = [];
  private readonly orb: Mesh;
  /** `true` quando a arma pediu o feixe NESTE quadro. Zerado no fim de `update`. */
  private shown = false;
  private chargeShown = false;
  /** Sobra de brilho depois do último quadro pedido: o feixe não corta seco, apaga. */
  private fade = 0;

  constructor(scene: Scene) {
    const core = new StandardMaterial('ion-beam-core', scene);
    core.emissiveColor = new Color3(2.4, 2.9, 3);
    core.disableLighting = true;
    for (let i = 0; i < LAYERS.length; i++) {
      const material = i === 0 ? core : new StandardMaterial('ion-beam-veil-' + i, scene);
      if (i > 0) {
        (material as StandardMaterial).emissiveColor = new Color3(.35, 1.1, 2.6);
        (material as StandardMaterial).disableLighting = true;
      }
      material.alpha = ALPHA[i]!;
      const tube = CreateCylinder('ion-beam-' + i, {height: 1, diameter: 1, tessellation: 10}, scene);
      tube.material = material;
      tube.isPickable = false;
      tube.setEnabled(false);
      this.tubes.push(tube);
    }
    const glow = new StandardMaterial('ion-charge-glow', scene);
    glow.emissiveColor = new Color3(.5, 1.6, 3);
    glow.disableLighting = true;
    glow.alpha = .8;
    this.orb = CreateSphere('ion-charge-orb', {diameter: 1, segments: 10}, scene);
    this.orb.material = glow;
    this.orb.isPickable = false;
    this.orb.setEnabled(false);
  }

  /**
   * A energia subindo no cano, durante a carga. `progress` vai de 0 a 1.
   *
   * A esfera cresce com a raiz do progresso, não com ele: no começo o crescimento é visível de
   * imediato e no fim ele desacelera, que é como uma carga é lida. Linear parece travada no início.
   */
  charge(at: Vector3, progress: number): void {
    const t = Math.min(1, Math.max(0, progress));
    const size = .06 + Math.sqrt(t) * .3;
    this.orb.setEnabled(true);
    this.orb.position.copyFrom(at);
    this.orb.scaling.setAll(size);
    (this.orb.material as StandardMaterial).alpha = .35 + t * .55;
    this.chargeShown = true;
  }

  /** O feixe deste quadro. `power` engrossa o traço; 1 é a espessura nominal. */
  show(from: Vector3, to: Vector3, power = 1): void {
    const delta = to.subtract(from);
    const length = delta.length();
    if (!(length > .05)) return;
    const rotation = Quaternion.FromUnitVectorsToRef(Vector3.Up(), delta.scale(1 / length), new Quaternion());
    const centre = from.add(to).scale(.5);
    const base = .09 * Math.max(.2, power);
    for (let i = 0; i < this.tubes.length; i++) {
      const tube = this.tubes[i]!;
      const width = base * LAYERS[i]!;
      tube.setEnabled(true);
      tube.position.copyFrom(centre);
      tube.rotationQuaternion = rotation;
      tube.scaling.set(width, length, width);
      (tube.material as StandardMaterial).alpha = ALPHA[i]!;
    }
    this.shown = true;
    this.fade = 1;
  }

  /**
   * Fim de quadro: apaga o que não foi renovado.
   *
   * O feixe some em ~90 ms em vez de sumir no quadro: um corte seco num efeito que durou 0,6 s
   * parece falha de renderização. A carga, essa sim, some no ato — ela é substituída pelo feixe.
   */
  update(dt: number): void {
    if (!this.chargeShown) this.orb.setEnabled(false);
    this.chargeShown = false;
    if (this.shown) {this.shown = false; return;}
    if (this.fade <= 0) return;
    this.fade = Math.max(0, this.fade - Math.max(0, dt) / .09);
    for (let i = 0; i < this.tubes.length; i++) {
      const tube = this.tubes[i]!;
      if (this.fade <= 0) {tube.setEnabled(false); continue;}
      (tube.material as StandardMaterial).alpha = ALPHA[i]! * this.fade;
      tube.scaling.x = tube.scaling.z = tube.scaling.x * (1 + Math.max(0, dt) * 2.5);
    }
  }

  /** Some com tudo. Morte, troca de estágio, guardar a arma. */
  clear(): void {
    this.fade = 0; this.shown = false; this.chargeShown = false;
    this.orb.setEnabled(false);
    for (const tube of this.tubes) tube.setEnabled(false);
  }

  dispose(): void {
    this.clear();
    this.orb.dispose();
    for (const tube of this.tubes) tube.dispose();
    this.tubes.length = 0;
  }
}
