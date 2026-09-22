import type {Vec3} from '../core/contracts';
import type {CollisionWorld} from '../physics/CollisionWorld';
import type {SurfaceFrame} from '../physics/SurfaceFrame';
import type {PlayerMotor} from '../player/PlayerMotor';
import {STAGE_BIOMES} from '../stages/StageRoute';
import {FarmWorld} from './FarmWorld';
import type {GameWorld, WorldSite} from './GameWorld';
import type {TrainingYard} from './TrainingYard';
import type {TestMapWorld} from './TestMapWorld';

/**
 * A fazenda (e o pátio de treino) vestindo o contrato `GameWorld`.
 *
 * É adaptador, não reescrita: `FarmWorld` continua exatamente como está, com streaming de região,
 * terreno esculpido, celeiros e clima. O que este arquivo faz é responder as três perguntas novas
 * que o contrato acrescenta — referencial, sítios e rota — sem que a fazenda precise saber que um
 * planeta existe.
 *
 * Os `sites` saem de `STAGE_BIOMES`, que já é a autoria das ilhas da fazenda: assim o mesmo
 * `planStage` roda nos dois mundos lendo a mesma lista, e nenhum sorteio precisou de um caminho
 * separado para cada mapa.
 */
export class FarmGameWorld implements GameWorld {
  constructor(
    // `TestMapWorld` entra pelo mesmo adaptador: plano, como a fazenda, e sem nada que precise do
    // `instanceof FarmWorld` que guarda carga, streaming e clima abaixo.
    private readonly yard: TrainingYard | FarmWorld | TestMapWorld,
    /** Rota real entre dois pontos. Na fazenda quem sabe é o Detour, que vive na cena. */
    private readonly route: (from: Vec3, to: Vec3) => number | undefined,
  ) {}

  get targets() {return this.yard.targets;}
  get collision(): CollisionWorld {return this.yard.collision;}
  /** Plano enquanto ninguém chamar `configurePlanet` — que na fazenda não acontece nunca. */
  get surface(): SurfaceFrame {return this.yard.collision.surface;}
  get ready(): boolean {return this.yard instanceof FarmWorld ? this.yard.ready : true;}
  get error(): string {return this.yard instanceof FarmWorld ? this.yard.error : '';}

  async load(): Promise<void> {
    if (this.yard instanceof FarmWorld) await this.yard.load();
  }

  fixedUpdate(dt: number, player: PlayerMotor): void {
    if (this.yard instanceof FarmWorld) this.yard.fixedUpdate(dt, player);
  }

  update(dt: number): void {
    if (this.yard instanceof FarmWorld) this.yard.update(dt);
  }

  dispose(): void {
    if (this.yard instanceof FarmWorld) this.yard.dispose();
  }

  get sites(): readonly WorldSite[] {return FARM_SITES;}

  /**
   * Ilha que contém o ponto.
   *
   * A autoria descreve as ilhas por extensão em XZ (`width`/`depth`), então o teste é de caixa, não
   * de raio — usar o raio equivalente incluiria os cantos, que na fazenda costumam ser vazio.
   */
  siteAt(p: Vec3): WorldSite | undefined {
    let best: WorldSite | undefined, bestGap = Infinity;
    for (const site of FARM_SITES) {
      const dx = Math.abs(p.x - site.centre.x), dz = Math.abs(p.z - site.centre.z);
      const half = site.radius;
      if (dx > half || dz > half) continue;
      const gap = Math.hypot(dx, dz);
      if (gap < bestGap) {bestGap = gap; best = site;}
    }
    return best;
  }

  routeLength(from: Vec3, to: Vec3): number | undefined {return this.route(from, to);}

  prepareVisit(id: string): Promise<boolean> {
    return this.yard instanceof FarmWorld ? this.yard.prepareVisit(id) : Promise.resolve(true);
  }

  get regionStatus(): string {
    return this.yard instanceof FarmWorld ? this.yard.regionStatus : 'Pátio de treino';
  }
}

/**
 * As ilhas autorais da fazenda, achatadas a partir dos biomas.
 *
 * `radius` recebe a MENOR meia-extensão da ilha: é o maior círculo que cabe dentro do retângulo
 * autoral, e portanto o raio seguro para anel de nascimento e área de cálice.
 */
const FARM_SITES: readonly WorldSite[] = STAGE_BIOMES.flatMap(biome => biome.islands.map(island => ({
  id: island.id,
  name: island.name,
  centre: {x: island.x, y: island.y, z: island.z},
  up: {x: 0, y: 1, z: 0},
  radius: Math.min(island.width, island.depth) / 2,
})));
