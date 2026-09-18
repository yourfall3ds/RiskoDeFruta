import type {Vector3} from '@babylonjs/core/Maths/math.vector';
import type {TrainingTarget} from '../world/TrainingYard';

/**
 * O pool de efeitos de tiro, pelo que o combate realmente pede dele.
 *
 * `ShotEffects` satisfaz por estrutura. Declarar a porta em vez de importar a classe é o que deixa
 * o teste rodar sem canvas — e deixa explícito que uma arma não pode chamar nada além disto.
 */
export interface CombatEffects {
  mark(position: Vector3, normal: Vector3): void;
  muzzle(position: Vector3): void;
  impact(position: Vector3, normal: Vector3): void;
  tracer(from: Vector3, to: Vector3): void;
  piercer(from: Vector3, to: Vector3): void;
  burst(position: Vector3, size?: number, duration?: number): void;
}

/**
 * O combate de tiro que JÁ EXISTE, publicado como porta.
 *
 * Mira, colisão de mundo, escolha de ator, destruição de cenário, crítico, ponto fraco, MP por
 * acerto e os eventos de dano foram todos resolvidos uma vez dentro de `DualPistols`. Uma segunda
 * arma não pode reimplementar nada disso — seria a mesma regra escrita duas vezes, divergindo no
 * primeiro ajuste. Ela recebe esta porta e usa a MESMA física e o MESMO caminho de dano.
 *
 * `DualPistols` satisfaz a porta por estrutura; a PRISM só conhece a interface, e por isso o teste
 * dela fecha o contrato com um duplo, sem cena, sem GLB e sem horda.
 */
export interface CombatServices {
  /** Alvos atingíveis do mapa. É a lista viva da horda, não uma cópia. */
  readonly combatTargets: readonly TrainingTarget[];
  /** Pool de efeitos da cena: rastro, fogacho, marca e faísca de impacto. */
  readonly effects: CombatEffects;
  /**
   * Contato do MUNDO ESTÁTICO ao longo do raio, ou `undefined`.
   *
   * É o mesmo `worldPick` do tiro comum, então o backend radial (e os triângulos desativados pela
   * destruição) já valem aqui. É também o teste de linha de visão da explosão.
   */
  traceWorld(origin: Vector3, direction: Vector3, range: number): CombatContact | undefined;
  /**
   * Varredura completa: o contato de mundo mais os ATORES que estão na frente dele.
   *
   * `actors` já vem ordenado por distância e JÁ está recortado pela parede — um inimigo atrás do
   * terreno não aparece. É esse recorte que dá, de graça, "sem dano atrás de parede" para o tiro
   * perfurante e para o contato direto da granada.
   */
  sweep(origin: Vector3, direction: Vector3, range: number, padding?: number): CombatSweep;
  /** Dano num ator pela porta de sempre: `DamageDealt`, `onHit`, crítico, ponto fraco e MP. */
  applyHit(target: TrainingTarget, spec: CombatHitSpec): void;
  /**
   * Oferece um acerto de CENÁRIO à fachada de destruição. `true` quando ela assumiu o corpo — e
   * então a marca genérica de bala é omitida, porque a rachadura do subsistema é o retorno autoral.
   */
  damageScenery(point: Vector3, normal: Vector3, direction: Vector3, damage: number, triangle: number | undefined): boolean;
}

export interface CombatContact {
  readonly point: Vector3;
  readonly normal: Vector3;
  readonly distance: number;
  /** Ator atingido; ausente quando o contato foi cenário. */
  readonly target: TrainingTarget | undefined;
  /** Triângulo do mundo; só o backend radial preenche, e é o que a destruição resolve por prop. */
  readonly triangle: number | undefined;
}

export interface CombatSweep {
  readonly world: CombatContact | undefined;
  readonly actors: readonly CombatContact[];
}

export interface CombatHitSpec {
  readonly point: Vector3;
  /** Rumo do TRANCO — no tiro, o rumo da câmera. */
  readonly force: Vector3;
  /**
   * Rumo REAL do projétil. Forma com `point` o par `(hitPosition, hitDirection)` que o teste de
   * ponto fraco precisa; sem ele o acerto na cabeça viraria sorteio.
   */
  readonly ray: Vector3;
  readonly damage: number;
  readonly sourceId: string;
  readonly attackId: string;
  /**
   * Etiquetas do dano. `bullet` é o que habilita ponto fraco (`WEAK_POINT_TAG`) e MP por acerto
   * (`awardsMP`); `skill` faz o dano escalar por `stats.mp` e DESLIGA o MP. Escolher aqui é a
   * diferença entre uma arma que alimenta a barra e uma que se realimenta.
   */
  readonly tags: readonly string[];
  readonly procCoefficient: number;
  readonly forceMagnitude: number;
}

/** Nearest contact between the world and the actors in front of it. */
export function nearestContact(sweep: CombatSweep): CombatContact | undefined {
  const actor=sweep.actors[0];
  if(!actor)return sweep.world;
  if(!sweep.world)return actor;
  return actor.distance<=sweep.world.distance?actor:sweep.world;
}
