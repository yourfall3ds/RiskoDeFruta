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
 * Determinístico pela semente: a mesma semente e o mesmo estágio produzem o mesmo plano.
 */

export interface IslandPair {spawn:StageIsland;chalice:StageIsland;distance:number}

export interface StagePlanValidation {
  /** Pouso seguro na ilha, ou `undefined` se a ilha não servir de partida. */
  spawnPoint(island:StageIsland):Vec3|undefined;
  /** Arena de combate válida para o cálice, ou `undefined`. */
  chalicePoint(island:StageIsland):Vec3|undefined;
  /** Existe rota de navegação do pouso até o cálice. */
  route(spawn:Vec3,chalice:Vec3):boolean;
}

export interface StagePlan {
  biome:StageBiome;
  spawn:Vec3;chalice:Vec3;
  spawnIsland:StageIsland;chaliceIsland:StageIsland;
  /** Distância planar entre os pontos ESCOLHIDOS, não entre as âncoras. */
  distance:number;
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
 * Sorteia um par e o valida inteiro. `undefined` quando nenhum par do bioma serve — quem chama
 * mantém a interface de carregamento em espera e relata o erro em vez de cair num plano indefinido.
 */
export function planStage(biome:StageBiome,rng:RandomStream,validation:StagePlanValidation):StagePlan|undefined {
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
    if(!validation.route(spawn,chalice))continue;
    return {biome,spawn,chalice,spawnIsland:pair.spawn,chaliceIsland:pair.chalice,distance,examined};
  }
  return undefined;
}
