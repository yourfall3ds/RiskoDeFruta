import type {Vec3} from '../core/contracts';
import type {CollisionWorld} from '../physics/CollisionWorld';
import type {SurfaceFrame} from '../physics/SurfaceFrame';
import type {PlayerMotor} from '../player/PlayerMotor';
import type {TrainingTarget} from './TrainingYard';

/**
 * O mundo do jogo, visto pelo jogo.
 *
 * Existe para que `PlayerScene` — e, por tabela, `DualPistols` e `EnemySwarm` — deixem de depender
 * da CLASSE do mundo (`TrainingYard | FarmWorld`) e passem a depender só do que realmente usam.
 * É o que permite trocar a fazenda pelo planeta sem tocar em nenhuma mecânica: o mapa vira um
 * parâmetro, e não uma variante do código de jogo.
 *
 * A regra que separa `surface` de `collision`: **gameplay fala com `surface`**, que é o referencial
 * (o que é "para cima" aqui, onde está o chão sob este ponto, quanto é longe no chão). O campo
 * `collision` continua exposto porque terreno, clima e streaming ainda falam a linguagem plana do
 * `CollisionWorld`; ele é escape hatch, não a porta principal.
 */
export interface GameWorld {
  /** Alvos atingíveis por tiro. `EnemySwarm` registra e remove os corpos das pragas aqui. */
  readonly targets: TrainingTarget[];
  /**
   * O `CollisionWorld` do mundo — **sempre existe**, inclusive no planeta.
   *
   * Foi a decisão da física (`.temp/real-game-surface-api.md` §2) e ela está certa: o
   * `CollisionWorld` continua sendo o objeto que a cena distribui, e o planeta entra nele por
   * `configurePlanet(frame, mesh)` em vez de virar um tipo paralelo. Assim `PlayerMotor`,
   * `EnemySwarm`, `NetworkSession` e companhia continuam recebendo exatamente o que recebiam.
   */
  readonly collision: CollisionWorld;
  /**
   * Referencial e consultas de mundo. É sempre `collision.surface` — está aqui por conveniência
   * e para deixar explícito que gameplay fala com o referencial, não com as listas planas.
   */
  readonly surface: SurfaceFrame;
  readonly ready: boolean;
  readonly error: string;

  load(): Promise<void>;
  fixedUpdate(dt: number, player: PlayerMotor): void;
  update(dt: number): void;
  dispose(): void;

  /**
   * Sítios jogáveis do mapa: ilha na esfera, região na fazenda.
   *
   * É o que `StagePlan`/`StageRoute`/`StageSpawn` sorteiam para montar "partida numa, cálice na
   * outra". Deixou de ser `BIOMES` fixo justamente porque o planeta tem 38 ilhas e a fazenda tem
   * quatro regiões — o sorteio é o mesmo, a lista é que vem do mundo.
   */
  readonly sites: readonly WorldSite[];
  /** Sítio que contém o ponto, se algum. */
  siteAt(p: Vec3): WorldSite | undefined;
  /**
   * Comprimento da rota REALMENTE percorrível entre dois pontos, em metros.
   *
   * `undefined` quando não existe caminho — é também a checagem de alcançabilidade do par. A reta
   * não serve: ela atravessa o vão entre ilhas, onde não há chão nenhum. Na fazenda isto consulta
   * o Detour; no planeta, o grafo de pontes.
   */
  routeLength(from: Vec3, to: Vec3): number | undefined;

  /** Carrega sob demanda o sítio (região da fazenda). Mundos sem streaming devolvem `true`. */
  prepareVisit?(id: string): Promise<boolean>;
  /** Linha de diagnóstico do F1. */
  readonly regionStatus?: string;
}

/**
 * Um pedaço caminhável e contínuo do mapa.
 *
 * `up` é a vertical local no centro — na fazenda é sempre `+Y`, no planeta é a radial da ilha.
 * `radius` é a pegada caminhável, que limita anel de nascimento e sorteio de cálice.
 */
export interface WorldSite {
  readonly id: string;
  readonly name: string;
  readonly centre: Vec3;
  readonly up: Vec3;
  readonly radius: number;
}
