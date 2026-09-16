import type {Vec3} from '../core/contracts';
import type {ImpactMaterial} from './DestructionModel';
import type {DestructibleState} from './DestructionModel';

/**
 * Portas do subsistema. É o que mantém `DestructionSystem` sem uma linha de `@babylonjs/*`:
 * o modelo decide o que aconteceu, as portas fazem acontecer.
 *
 * Isso não é abstração por gosto. O sistema precisa rodar em teste (sem cena), no planeta radial
 * (com `PlanetCollision`) e no jogo plano legado (com `CollisionWorld`, que não tem intervalo de
 * triângulo nenhum). Três donos diferentes para as mesmas regras de vida e quebra.
 */

/** Colisão que sabe remover um intervalo contíguo de triângulos. `PlanetCollision` implementa. */
export interface DestructionCollisionPort {
  disableTriangles(start: number, count: number): number;
  enableTriangles(start: number, count: number): number;
}

/** Som. O adaptador padrão reaproveita os bancos `wood`/`concrete`/`impact`/`heavy` já existentes. */
export interface DestructionAudioPort {
  /** Bala batendo no corpo ainda inteiro. `strength` 0..1 cresce com o dano acumulado. */
  impact(material: ImpactMaterial, point: Vec3, strength: number): void;
  /** O corpo abrindo. */
  shatter(material: ImpactMaterial, point: Vec3): void;
}

/** Tudo que se vê. A implementação Babylon está em `DestructionVisuals`. */
export interface DestructionPresentationPort {
  /**
   * A camada visual consegue representar a quebra deste corpo? Ausente ⇒ assume-se que sim.
   *
   * Existe por um defeito concreto: se a malha do `nodeName` não estiver na cena, quebrar o prop
   * removeria a colisão e deixaria o corpo VISÍVEL e intacto para sempre, atravessável a tiro e a
   * pé. Um prop que não quebra é um defeito pequeno; um prop fantasma é um defeito grande.
   */
  ready?(state: DestructibleState): boolean;
  /** Marca/rachadura no ponto do acerto, com o estágio já calculado pelo modelo. */
  mark(state: DestructibleState, point: Vec3, normal: Vec3, stage: number): void;
  /** Tranco do corpo levando tiro. */
  jolt(state: DestructibleState, direction: Vec3, power: number): void;
  /** Um componente de estrutura cai. */
  fell(state: DestructibleState, component: number, point: Vec3, direction: Vec3): void;
  /** O corpo quebra: estilhaço, tombamento ou desabamento, conforme o estilo do tipo. */
  destroy(state: DestructibleState, point: Vec3, direction: Vec3): void;
  update(dt: number): void;
  /** Volta tudo ao estado intacto. */
  restore(): void;
}

/** Um acerto chegando ao subsistema, venha de tiro, habilidade ou soco. */
export interface DestructionHit {
  readonly point: Vec3;
  /** Direção do golpe (unitária ou não). */
  readonly direction: Vec3;
  readonly damage: number;
  /** Índice do triângulo devolvido pela colisão. Ausente ⇒ resolve por posição. */
  readonly triangle?: number;
  readonly normal?: Vec3;
}

/** O que o subsistema fez com o acerto. `undefined` significa "não era prop meu". */
export interface DestructionOutcome {
  readonly id: string;
  readonly kind: DestructibleState['kind'];
  readonly broke: boolean;
  readonly stage: number;
  readonly fraction: number;
  /** Componentes derrubados neste golpe. */
  readonly felled: readonly number[];
  /** Triângulos removidos da colisão neste golpe. */
  readonly removedTriangles: number;
}

export type {ImpactMaterial};
export type {Vec3};
