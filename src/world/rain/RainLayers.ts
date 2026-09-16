/**
 * Profundidade em camadas.
 *
 * A chuva antiga era uma única caixa de 900 rastros iguais em volta da câmera: tudo na mesma escala,
 * na mesma opacidade e na mesma velocidade aparente, que é exatamente a leitura "procedural".
 * Aqui são três populações com papéis diferentes:
 *
 * - `near` — poucas gotas grandes e rápidas, quase na lente. Dão a sensação de estar debaixo da
 *   chuva sem encher a tela.
 * - `mid`  — o corpo do aguaceiro, rastros finos numa caixa larga. É a camada que "é" a chuva.
 * - `far`  — cartões de véu grandes, lentos e muito fracos, com a textura de haste do atlas. Dão o
 *   fundo chuvoso sem virar folha chapada de tela cheia: continuam sendo objetos no mundo, com
 *   paralaxe, e somem junto com as outras.
 *
 * O orçamento somado é MENOR que o da versão rejeitada (820 contra 900): o ganho vem do desenho e
 * da separação, não de empilhar partículas.
 */

export type RainLayerId='near'|'mid'|'far';

export interface RainLayerSpec {
  id:RainLayerId;
  /** Teto de partículas vivas. */
  capacity:number;
  /** Meia-largura da caixa de emissão em torno da câmera, em metros. */
  radius:number;
  /** Faixa de altura da emissão acima da câmera. */
  top:number;
  bottom:number;
  minSize:number;
  maxSize:number;
  minLife:number;
  maxLife:number;
  /** Queda em m/s. */
  fall:number;
  /** Fração da deriva do vento que esta camada sente. */
  windFactor:number;
  /** Alfa máximo com chuva cheia. */
  alpha:number;
  /** Partículas por segundo com chuva cheia. */
  emitRate:number;
  /** `true` estica o cartão ao longo da velocidade — é o que dá o rastro inclinado pelo vento. */
  stretched:boolean;
  /** `true` usa o atlas do véu em vez do de rastros. */
  haze:boolean;
}

export const RAIN_LAYERS:readonly RainLayerSpec[]=[
  // Poucas, grandes e perto: a câmera cruza com elas em vez de olhar uma parede de riscos.
  {id:'near',capacity:170,radius:5.5,top:5.5,bottom:-1.5,minSize:.16,maxSize:.30,minLife:.26,maxLife:.44,
   fall:23,windFactor:1.0,alpha:.50,emitRate:330,stretched:true,haze:false},
  // O corpo da chuva. Caixa larga o bastante para a gota nascer fora do enquadramento.
  {id:'mid',capacity:390,radius:17,top:13,bottom:-3,minSize:.055,maxSize:.11,minLife:.55,maxLife:.95,
   fall:18,windFactor:.85,alpha:.40,emitRate:455,stretched:true,haze:false},
  // Véu: grande, lento e fraco. É fundo, não é a chuva.
  {id:'far',capacity:260,radius:44,top:26,bottom:-6,minSize:1.1,maxSize:2.6,minLife:2.4,maxLife:4.2,
   fall:5.5,windFactor:.45,alpha:.11,emitRate:66,stretched:false,haze:true},
];

/**
 * População viva estimada de uma camada com chuva cheia: `emitRate × vida média`.
 *
 * Existe porque emitir mais do que o teto faz o pool reciclar partículas ainda vivas, e o olho lê
 * isso como uma chuva que pisca. O teste exige folga em todas as camadas.
 */
export function steadyPopulation(layer:RainLayerSpec):number {
  return layer.emitRate*(layer.minLife+layer.maxLife)/2;
}

/** Soma dos tetos das três camadas. Fica ABAIXO das 900 gotas da versão rejeitada. */
export const RAIN_TOTAL_CAPACITY=RAIN_LAYERS.reduce((total,layer)=>total+layer.capacity,0);

/**
 * Perfil de intensidade por camada.
 *
 * As camadas não acendem juntas: o véu distante entra primeiro (o horizonte fecha antes de a chuva
 * chegar em cima) e as gotas de perto só aparecem com o aguaceiro formado. Isso evita a transição
 * em que 900 partículas surgem de uma vez.
 */
export function layerIntensity(layer:RainLayerSpec,rain:number):number {
  const r=Math.max(0,Math.min(1,Number.isFinite(rain)?rain:0));
  if(layer.id==='far')return Math.min(1,r/.55);
  if(layer.id==='mid')return Math.max(0,Math.min(1,(r-.08)/.62));
  return Math.max(0,Math.min(1,(r-.30)/.55));
}
