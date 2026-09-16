/**
 * Rota da expedição entre os biomas que EXISTEM no projeto.
 *
 * Cada estágio acontece num bioma autoral já construído — campo inicial + cidade agrícola, fronteira
 * solar, campos altos e bosque das raízes. Não existe "planeta novo": a viagem leva a uma região
 * diferente do MESMO mundo, transmitida por `FarmWorld.prepareVisit`.
 *
 * As ilhas abaixo são as mesmas dos JSONs de autoria (`docs/farm-city-authoring.json`,
 * `docs/highland-authoring.json`, `docs/rootwood-authoring.json` e `scripts/build-solar-frontier.py`,
 * que lista `Pomar dos Ventos`, `Porto dos Grãos` e `Distrito das Estufas`) e do volume sólido do
 * campo inicial (`docs/solid-geology.json`: `Main`, `Barn plateau`, `West outpost`, `East outpost`).
 * Cada entrada é um corpo suspenso distinto — é isso que dá sentido a "nascer numa ilha e procurar o
 * cálice em outra".
 *
 * Módulo puro: nenhuma dependência de Babylon, de cena ou de rede.
 */

/** Uma ilha autoral. Duas âncoras com o mesmo `id` seriam a MESMA ilha; aqui cada id é único. */
export interface StageIsland {
  id:string;
  name:string;
  x:number;y:number;z:number;
  /** Extensão autoral em XZ, em metros, vinda do JSON de autoria da região. */
  width:number;depth:number;
}

export interface StageBiome {
  id:string;
  name:string;
  /**
   * Região transmitida (`FARM_REGIONS`) que precisa estar residente para o bioma existir.
   * `undefined` só apareceria num bioma inteiramente na base sempre residente.
   */
  region:string|undefined;
  islands:readonly StageIsland[];
  /**
   * Separação mínima, em metros, entre a ilha de partida e a ilha do cálice.
   *
   * O pedido é "pelo menos 100 m, mais em regiões grandes": campos altos e bosque das raízes têm
   * ilhas de 90–120 m de lado e centenas de metros entre elas, então 150 m ali ainda deixa TODOS os
   * pares autorais válidos e evita um destino que pareceria vizinho no mapa.
   */
  separation:number;
}

/** Mínimo absoluto exigido em qualquer bioma. */
export const MIN_ISLAND_SEPARATION=100;
/** Mínimo usado nas regiões grandes (campos altos, bosque das raízes). */
export const WIDE_ISLAND_SEPARATION=150;

/** Campo inicial + cidade agrícola: as ilhas onde a primeira expedição pode começar. */
const HOME_ISLANDS:readonly StageIsland[]=[
  {id:'initial-field',name:'Campo inicial',x:0,y:0,z:0,width:46,depth:46},
  {id:'barn-plateau',name:'Platô do celeiro',x:0,y:5,z:29,width:30,depth:26},
  {id:'west-outpost',name:'Posto oeste',x:-42,y:0,z:4,width:26,depth:24},
  {id:'east-outpost',name:'Lavoura leste',x:42,y:2,z:10,width:26,depth:24},
  // Authoring tuples contain radii; placement bounds use full widths/depths.
  {id:'seeds',name:'Distrito das Sementes',x:100,y:2,z:8,width:60,depth:52},
  {id:'solar',name:'Fazenda Solar',x:105,y:12,z:72,width:56,depth:46},
  {id:'harvest',name:'Mercado da Colheita',x:160,y:7,z:45,width:50,depth:46},
];

const FRONTIER_ISLANDS:readonly StageIsland[]=[
  {id:'orchard',name:'Pomar dos Ventos',x:248,y:9,z:45,width:96,depth:86},
  {id:'port',name:'Porto dos Grãos',x:285,y:15,z:147,width:96,depth:90},
  {id:'glasshouse',name:'Distrito das Estufas',x:285,y:15,z:280,width:148,depth:144},
];

const HIGHLAND_ISLANDS:readonly StageIsland[]=[
  {id:'highland',name:'Campos Altos',x:500,y:23,z:280,width:200,depth:196},
  {id:'windmill',name:'Moinhos do Leste',x:720,y:31,z:320,width:190,depth:170},
  {id:'valley',name:'Vale das Sementes',x:610,y:25,z:520,width:220,depth:190},
];

const ROOTWOOD_ISLANDS:readonly StageIsland[]=[
  {id:'root-grove',name:'Bosque da Colheita',x:940,y:35,z:360,width:220,depth:180},
  {id:'root-mill',name:'Ruínas do Engenho',x:1150,y:43,z:420,width:220,depth:220},
  {id:'root-seed',name:'Terraços das Sementes',x:1030,y:29,z:630,width:240,depth:200},
];

/**
 * Ordem de rotação dos destinos: cidade agrícola → fronteira solar → campos altos → bosque das
 * raízes e então de volta ao começo. O estágio 1 acontece no bioma de chegada (campo inicial +
 * cidade), exatamente onde a entrada pela nave já deposita o jogador hoje.
 */
export const STAGE_BIOMES:readonly StageBiome[]=[
  {id:'farm-city',name:'Cidade agrícola',region:'farm-city',islands:HOME_ISLANDS,separation:MIN_ISLAND_SEPARATION},
  {id:'solar-frontier',name:'Fronteira solar',region:'solar-frontier',islands:FRONTIER_ISLANDS,separation:MIN_ISLAND_SEPARATION},
  {id:'highland-farms',name:'Campos altos',region:'highland-farms',islands:HIGHLAND_ISLANDS,separation:WIDE_ISLAND_SEPARATION},
  {id:'rootwood',name:'Bosque das raízes',region:'rootwood',islands:ROOTWOOD_ISLANDS,separation:WIDE_ISLAND_SEPARATION},
];

/** Bioma do estágio pedido. Estágios acima de quatro giram pela mesma ordem. */
export function biomeForStage(stage:number):StageBiome {
  const index=Number.isFinite(stage)?Math.max(0,Math.floor(stage)-1)%STAGE_BIOMES.length:0;
  return STAGE_BIOMES[index]!;
}

/** Bioma do próximo estágio — o destino anunciado quando o suco é recolhido. */
export function nextBiomeForStage(stage:number):StageBiome {
  return biomeForStage((Number.isFinite(stage)?Math.floor(stage):1)+1);
}

/** Bioma pelo id, para diagnóstico e para os saltos de QA. */
export function biomeById(id:string):StageBiome|undefined {
  return STAGE_BIOMES.find(biome=>biome.id===id);
}

// ---------------------------------------------------------------------------------------------
// Rota da expedição num mapa que traz as próprias ilhas (o planeta)
// ---------------------------------------------------------------------------------------------

/** Ilha vinda do mundo: centro, vertical local e raio da pegada caminhável. */
export interface RouteSite {
  readonly id:string; readonly name:string;
  readonly centre:{x:number;y:number;z:number};
  readonly radius:number;
}

/** Quantas regiões nomeadas a expedição percorre num mapa com ilhas próprias. */
export const PLANET_BIOME_COUNT=6;

/**
 * Divide as ilhas do mapa em regiões nomeadas, para a expedição continuar **viajando para outro
 * lugar com nome** em vez de reciclar o mesmo bioma para sempre.
 *
 * As sementes de região são escolhidas por amostragem do PONTO MAIS DISTANTE (greedy
 * farthest-point): começa pela ilha de maior pegada e, a cada passo, adota a ilha mais longe de
 * todas as já adotadas. Isso espalha as regiões pela casca inteira sem depender de nome de ilha
 * nem de eixo do manifesto — trocar o mapa não quebra a rota. Cada ilha restante entra na região
 * da semente mais próxima, e a região herda o nome da semente.
 *
 * `measure` é a distância CAMINHANDO (arco, no planeta). Passá-la é obrigatório: no mundo curvo a
 * distância em linha reta atravessa a rocha e agruparia ilhas antípodas.
 *
 * **Cada bioma fica com a lista INTEIRA de ilhas, não com o seu agrupamento.** A semente dá só
 * identidade e nome à etapa. Restringir o sorteio ao agrupamento parecia mais arrumado e é uma
 * armadilha: um agrupamento pode ser internamente desconexo (as pontes ligam ilhas de regiões
 * diferentes), e aí nenhum par teria rota, `planStage` devolveria `undefined` para sempre e a
 * expedição travaria no carregamento. Com a lista inteira, conectividade e separação continuam
 * sendo decididas por quem sabe: a rota real.
 */
export function siteBiomes(
  sites:readonly RouteSite[],
  measure:(a:{x:number;y:number;z:number},b:{x:number;y:number;z:number})=>number,
  separation=WIDE_ISLAND_SEPARATION,
):StageBiome[] {
  if(sites.length===0)return [];
  const pool=[...sites].sort((a,b)=>b.radius-a.radius||a.id.localeCompare(b.id));
  const seeds:RouteSite[]=[pool[0]!];
  while(seeds.length<Math.min(PLANET_BIOME_COUNT,pool.length)){
    let best:RouteSite|undefined,bestGap=-1;
    for(const site of pool){
      if(seeds.some(seed=>seed.id===site.id))continue;
      // Distância até a semente MAIS PRÓXIMA: adotar quem maximiza isso é o que espalha.
      let gap=Infinity;
      for(const seed of seeds)gap=Math.min(gap,measure(site.centre,seed.centre));
      if(gap>bestGap){bestGap=gap;best=site;}
    }
    if(!best)break;
    seeds.push(best);
  }
  const islands=sites.map(toStageIsland);
  return seeds.map(seed=>({id:seed.id,name:seed.name,region:undefined,islands,separation}));
}

/** Bioma do estágio numa lista já dividida por `siteBiomes`. Mesma rotação de `biomeForStage`. */
export function siteBiomeForStage(biomes:readonly StageBiome[],stage:number):StageBiome|undefined {
  if(biomes.length===0)return undefined;
  const index=Number.isFinite(stage)?Math.max(0,Math.floor(stage)-1)%biomes.length:0;
  return biomes[index];
}

const toStageIsland=(site:RouteSite):StageIsland=>({
  id:site.id,name:site.name,x:site.centre.x,y:site.centre.y,z:site.centre.z,
  // `width`/`depth` limitam a busca de pouso ao corpo da ilha; num convés redondo é o diâmetro.
  width:site.radius*2,depth:site.radius*2,
});
