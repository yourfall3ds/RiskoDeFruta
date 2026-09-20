import {BARN_CHESTS,CITY_CHESTS,FRONTIER_CHESTS,HIGHLAND_CHESTS,ROOTWOOD_CHESTS} from '../world/ExplorationSites';

/**
 * O CATÁLOGO DE BAÚS, SEM BABYLON — uma lista só, lida pelos dois lados.
 *
 * Ele nasceu do bloco F: a compra virou protocolo, e o servidor precisa saber que baú é `supply-0`
 * e onde ele fica para validar distância e preço. Se o servidor tivesse a própria lista, o cliente e
 * a autoridade divergiriam no primeiro baú movido — o mesmo defeito de dois donos do §18.8, só que
 * em coordenadas.
 *
 * `RunInteractables` monta as entradas visuais A PARTIR daqui; o servidor monta o estado
 * autoritativo a partir daqui. Nada de apresentação mora neste arquivo.
 */
export type ChestKind='supply'|'shop'|'altar';
export interface ChestSpec {id:string;kind:ChestKind;x:number;y:number;z:number}

/** Os seis interativos do sítio inicial autoral — a base da corrida na fazenda. */
export const HOME_CHESTS:readonly ChestSpec[]=[
  {id:'supply-0',kind:'supply',x:-5,y:0,z:-13},
  {id:'shop-1',kind:'shop',x:5,y:0,z:1},
  {id:'altar-2',kind:'altar',x:-9,y:5,z:29},
  {id:'supply-3',kind:'supply',x:7,y:5,z:29},
  {id:'supply-4',kind:'supply',x:-45,y:0,z:3},
  {id:'shop-5',kind:'shop',x:44,y:2,z:10},
];

/** Os baús dos sítios de exploração (cidade, fronteira, planalto, rootwood, celeiros). */
export const SITE_CHESTS:readonly ChestSpec[]=
  [...CITY_CHESTS,...FRONTIER_CHESTS,...HIGHLAND_CHESTS,...ROOTWOOD_CHESTS,...BARN_CHESTS]
    .map(site=>({id:site.id,kind:site.kind as ChestKind,x:site.x,y:site.y,z:site.z}));

/** Tudo o que existe na fazenda, na ordem em que `RunInteractables` sempre montou. */
export function chestCatalog():ChestSpec[] {return [...HOME_CHESTS,...SITE_CHESTS].map(spec=>({...spec}));}

/** Custo base por tipo. É o mesmo número de sempre, agora num lugar só. */
export const BASE_COST={altar:25,shop:45,supply:30} as const;
/**
 * Preço PROGRESSIVO dos baús.
 *
 * O mapa tem dezenas de baús e o preço deles era fixo dentro do estágio, então a corrida ótima era
 * literalmente correr abrindo tudo: cada baú custava o mesmo do primeiro e nenhum deles era uma
 * escolha. Agora cada compra encarece as SEGUINTES, do jeito clássico de roguelite:
 *
 *   preço = base × (1 + (estágio − 1) × STAGE_STEP) × GROWTH^(comprados no estágio)
 *
 * O altar mantém a escalada PRÓPRIA dele (×1,6 por oferta), que é o risco dele; as duas contas se
 * multiplicam em vez de uma sobrescrever a outra.
 *
 * A conta mora AQUI, e não na classe de apresentação, porque o preço é regra de economia: com a
 * compra virando protocolo (§21.3) quem cobra é o servidor, e duas cópias da fórmula seriam duas
 * economias divergindo no segundo baú.
 */
export const CHEST_PRICE_GROWTH=1.22,CHEST_PRICE_STAGE_STEP=.3,CHEST_PRICE_CAP=14,ALTAR_REUSE_GROWTH=1.6;
/** Preço de um interativo pelo que já foi comprado nesta fase. Puro, para o teste de curva. */
export function chestPrice(kind:ChestKind,stage:number,opened:number,uses=0):number {
  const s=Number.isFinite(stage)?Math.max(1,Math.floor(stage)):1;
  const n=Number.isFinite(opened)?Math.min(CHEST_PRICE_CAP,Math.max(0,Math.floor(opened))):0;
  const u=Number.isFinite(uses)?Math.max(0,Math.floor(uses)):0;
  // A escalada por REUSO é só do altar: ele é o único que continua comprável depois de usado.
  const reuse=kind==='altar'?Math.pow(ALTAR_REUSE_GROWTH,u):1;
  return Math.round(BASE_COST[kind]*(1+(s-1)*CHEST_PRICE_STAGE_STEP)*Math.pow(CHEST_PRICE_GROWTH,n)*reuse);
}
/** O nome que a tela mostra. Apresentação, mas derivado do tipo — não há segunda tabela. */
export const chestName=(kind:ChestKind):string=>
  kind==='altar'?'Altar de risco':kind==='shop'?'Baú reforçado':'Caixa de suprimentos';
