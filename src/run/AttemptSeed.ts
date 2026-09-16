import {createSeed} from '../core/RunRNG';

/**
 * De onde sai a semente de uma tentativa.
 *
 * O problema que isto resolve: a URL guardava a semente da partida anterior (`?seed=mutant-farm-m0`
 * era até o padrão embutido), então TODA abertura do jogo e TODA repetição depois de morrer caíam no
 * mesmo sorteio — mesma ilha de partida, mesmo cálice, para sempre. Sortear de novo no arranque
 * comum é o que devolve variedade.
 *
 * Mas nem toda semente pode ser sorteada de novo. Duas são contrato e ficam PRESAS:
 *
 * - **Repetição de QA** (`?replay=1`): o ponto é reproduzir exatamente a mesma expedição. Sortear
 *   aqui destruiria a única ferramenta de repro que o projeto tem.
 * - **Cooperativo** (`?online=1`): a semente é a chave da sala (`NetworkClient` entra com ela em
 *   `joinOrCreate`). Se cada cliente sorteasse a sua, dois jogadores nunca cairiam na mesma sala nem
 *   no mesmo plano de ilhas.
 *
 * Fora desses dois casos a semente da URL é história, não pedido — o arranque sorteia uma nova e
 * quem chama reescreve a URL com a semente REAL em vigor.
 *
 * `F1 → Reiniciar mesma seed` não passa por aqui: repetir a mesma semente é o propósito daquele
 * botão, e ele reaproveita a semente ativa diretamente.
 *
 * Módulo puro: recebe a URL como texto e o sorteio como função, então roda igual no jogo e no teste.
 */

/** Semente embutida antiga. Continua servindo de sala padrão do cooperativo sem `?seed=`. */
export const LEGACY_DEFAULT_SEED='mutant-farm-m0';

/** Por que a semente em vigor é a que é. Aparece no diagnóstico do overlay. */
export type SeedReason='replay'|'coop'|'fresh';

export interface SeedPolicy {
  /** Semente que a tentativa deve usar agora. */
  seed:string;
  /** `true` quando a semente é contrato: nem o arranque nem a repetição podem sortear outra. */
  pinned:boolean;
  reason:SeedReason;
}

function parameters(href:string):URLSearchParams {
  try{return new URL(href).searchParams;}catch{return new URLSearchParams();}
}

/**
 * `true` quando a semente da URL é contrato e não pode ser sorteada de novo.
 *
 * Separado de `seedPolicy` de propósito: quem só precisa saber se pode re-sortear (a cena, ao
 * repetir depois de morrer) não deve gastar um sorteio criptográfico para descobrir isso.
 */
export function seedPinned(href:string):boolean {
  const params=parameters(href);
  return Boolean(params.get('replay')||params.get('online'));
}

/** Semente do arranque, já decidida entre "repetir o contrato" e "sortear uma nova". */
export function seedPolicy(href:string,fresh:()=>string=createSeed):SeedPolicy {
  const params=parameters(href),seed=params.get('seed')||'';
  // Repetição de QA: a semente pedida vale como está. Sem `seed=` ainda vale prender uma nova, para
  // que a repetição depois da derrota reproduza a MESMA expedição dentro da sessão.
  if(params.get('replay'))return {seed:seed||fresh(),pinned:true,reason:'replay'};
  // Cooperativo: a semente é a chave da sala, partilhada por link. Nunca sorteada por cliente.
  if(params.get('online'))return {seed:seed||LEGACY_DEFAULT_SEED,pinned:true,reason:'coop'};
  return {seed:fresh(),pinned:false,reason:'fresh'};
}

/**
 * Semente da PRÓXIMA tentativa depois de uma derrota.
 *
 * Presa: a mesma, porque repetir é o pedido. Solta: uma nova, porque "tentar de novo" é uma
 * expedição nova — ilha de partida e cálice diferentes.
 */
export function retrySeed(policy:{pinned:boolean;seed:string},fresh:()=>string=createSeed):string {
  return policy.pinned?policy.seed:fresh();
}
