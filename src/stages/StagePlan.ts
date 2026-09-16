import type {Vec3} from '../core/contracts';
import type {RandomStream} from '../core/RunRNG';
import type {StageBiome,StageIsland} from './StageRoute';

/**
 * Sorteio validado do par (ilha de partida, ilha do cálice).
 *
 * O jogador nasce numa ilha aleatória e o cálice fica em OUTRA, a pelo menos `biome.separation`
 * metros. O par é validado como par: partida com pouso seguro, cálice com arena de combate e rota
 * de navegação real entre os dois. Se nenhum par do bioma validar, o plano falha — não existe
 * aproximação de emergência do cálice, porque isso é exatamente o que o pedido proíbe.
 *
 * **O que decide a separação é a rota percorrida, não a reta.** Duas ilhas a 140 m de distância
 * podem ficar a 300 m de caminhada porque a única travessia fica do outro lado; e a ilha ao lado
 * continua sendo a ilha ao lado mesmo quando a reta passa do mínimo. Por isso `route` devolve o
 * COMPRIMENTO real do caminho de navegação, e `minRoute` é o piso que afasta o cálice do vizinho
 * imediato. A reta segue valendo como filtro barato antes de consultar a navegação.
 *
 * Determinístico pela semente: a mesma semente e o mesmo estágio produzem o mesmo plano.
 */

export interface IslandPair {spawn:StageIsland;chalice:StageIsland;distance:number}

export interface StagePlanValidation {
  /** Pouso seguro na ilha, ou `undefined` se a ilha não servir de partida. */
  spawnPoint(island:StageIsland):Vec3|undefined;
  /** Arena de combate válida para o cálice, ou `undefined`. */
  chalicePoint(island:StageIsland):Vec3|undefined;
  /**
   * Comprimento REAL da rota de navegação do pouso até o cálice, em metros.
   * `undefined` quando não existe rota — é também a checagem de alcançabilidade.
   */
  route(spawn:Vec3,chalice:Vec3):number|undefined;
}

/** Piso de rota real no primeiro bioma, onde as ilhas são muitas e pequenas. */
export const HOME_MIN_ROUTE=180;
/** Piso de rota real nas regiões de três ilhas, mais largas e mais distantes entre si. */
export const WIDE_MIN_ROUTE=150;

export interface StagePlanOptions {
  /** Caminhada mínima, em metros, entre o pouso e o cálice. */
  minRoute:number;
}

export interface StagePlan {
  biome:StageBiome;
  spawn:Vec3;chalice:Vec3;
  spawnIsland:StageIsland;chaliceIsland:StageIsland;
  /** Distância planar entre os pontos ESCOLHIDOS, não entre as âncoras. */
  distance:number;
  /** Comprimento da rota realmente percorrível entre os dois pontos. */
  routeLength:number;
  /** Piso de rota que este plano tentou cumprir. */
  minRoute:number;
  /**
   * Retained in diagnostics for report compatibility. Successful plans never accept a short route.
   */
  shortfall:boolean;
  /** Quantos pares foram examinados até validar; diagnóstico de QA. */
  examined:number;
}

export const planar=(a:{x:number;z:number},b:{x:number;z:number}):number=>Math.hypot(a.x-b.x,a.z-b.z);

/**
 * Todos os pares ordenados em ilhas diferentes e suficientemente separadas, em ordem estável.
 * A lista é a mesma para a mesma definição de bioma — o sorteio é que muda entre sementes.
 */
export function islandPairs(biome:StageBiome):IslandPair[] {
  const pairs:IslandPair[]=[];
  for(const spawn of biome.islands)for(const chalice of biome.islands){
    if(spawn.id===chalice.id)continue;
    const distance=planar(spawn,chalice);
    if(distance<biome.separation)continue;
    pairs.push({spawn,chalice,distance});
  }
  return pairs;
}

/** Embaralhamento determinístico (Fisher-Yates) para variar a partida sem perder reprodutibilidade. */
function shuffle<T>(values:T[],rng:RandomStream):T[] {
  for(let i=values.length-1;i>0;i--){
    const j=Math.floor(rng.next()*(i+1));
    const swap=values[i]!;values[i]=values[j]!;values[j]=swap;
  }
  return values;
}

/**
 * Sorteia um par e o valida inteiro. `undefined` quando nenhum par do bioma tem pouso, arena e rota
 * — quem chama mantém a interface de carregamento em espera e relata o erro em vez de cair num
 * plano indefinido.
 *
 * A ordem dos pares é embaralhada pela semente antes de qualquer validação, então não existe viés
 * para "a primeira ilha da lista que serve": partida e cálice variam de tentativa para tentativa.
 *
 * The route floor is mandatory. Accepting a shorter fallback would reintroduce the reported bug.
 */
export function planStage(biome:StageBiome,rng:RandomStream,validation:StagePlanValidation,options:StagePlanOptions):StagePlan|undefined {
  const pairs=shuffle(islandPairs(biome),rng);
  // Um ponto por ilha basta: o piso escolhido não depende de com quem a ilha é emparelhada.
  const spawns=new Map<string,Vec3|undefined>(),chalices=new Map<string,Vec3|undefined>();
  let examined=0;
  for(const pair of pairs){
    examined++;
    if(!spawns.has(pair.spawn.id))spawns.set(pair.spawn.id,validation.spawnPoint(pair.spawn));
    const spawn=spawns.get(pair.spawn.id);
    if(!spawn)continue;
    if(!chalices.has(pair.chalice.id))chalices.set(pair.chalice.id,validation.chalicePoint(pair.chalice));
    const chalice=chalices.get(pair.chalice.id);
    if(!chalice)continue;
    // A distância vale entre os pontos ESCOLHIDOS: o piso válido pode estar dezenas de metros
    // fora da âncora, e aceitar o par pela âncora aprovaria um destino perto demais.
    const distance=planar(spawn,chalice);
    if(distance<biome.separation)continue;
    const routeLength=validation.route(spawn,chalice);
    if(routeLength===undefined)continue;
    const plan:StagePlan={biome,spawn,chalice,spawnIsland:pair.spawn,chaliceIsland:pair.chalice,
      distance,routeLength,minRoute:options.minRoute,shortfall:false,examined};
    if(routeLength>=options.minRoute)return plan;
  }
  return undefined;
}
