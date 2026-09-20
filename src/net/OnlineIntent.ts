/**
 * O PEDIDO DE CO-OP, sem URL.
 *
 * ## O problema
 *
 * Todo o jogo decide "estou online?" lendo `?online=1` da URL: a sessão de rede (`NetworkSession`),
 * a semente presa (`AttemptSeed`), o mundo escolhido (`WorldSelection`) e a fazenda estática
 * (`FarmWorld`). Isso é bom — é um lugar só e é o que `jogar-coop.ps1` e os testes usam. É ruído
 * apenas numa coisa: obriga o JOGADOR a ver `?online=1&seed=f03a9243` na barra de endereço.
 *
 * ## A solução
 *
 * O menu não navega para lugar nenhum com parâmetros: ele GRAVA a intenção (sala, nome, servidor) e
 * recarrega numa URL limpa. No arranque seguinte, quem pergunta "estou online?" continua
 * perguntando exatamente como antes, só que a pergunta passa por `coopHref`, que devolve a URL
 * COMO SE ela tivesse `online=1&seed=…`. Nenhum módulo precisou aprender um segundo jeito de
 * decidir, e o caminho da URL continua valendo palavra por palavra — se os dois existirem, a URL
 * ganha, porque ali alguém pediu explicitamente.
 *
 * `sessionStorage` e não `localStorage`: a intenção morre com a aba. Fechar e reabrir o jogo tem de
 * cair no menu single-player, não reconectar numa sala de ontem.
 */

import { seedForCode } from './RoomCode';

export interface OnlineIntent {
  /** O código curto da sala. Vazio nas salas de desenvolvimento, que só têm semente. */
  readonly code: string;
  /** A semente por baixo — a chave real do `filterBy(['seed'])`. */
  readonly seed: string;
  readonly name: string;
  /** `ws://host:porta`, decodificado do código. Vazio cai no padrão local — o caso de quem hospeda. */
  readonly server: string;
  /** Nome da sala, escolhido por quem criou. Vazio deixa o servidor batizar pelo anfitrião. */
  readonly roomName: string;
}

export const ONLINE_INTENT_KEY = 'rdf.coop.intencao';

export interface IntentStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function storage(given?: IntentStorage): IntentStorage | undefined {
  if (given) return given;
  try { return globalThis.sessionStorage ?? undefined; } catch { return undefined; }
}

/** A intenção gravada, ou `undefined`. Conteúdo corrompido é tratado como ausência. */
export function readOnlineIntent(given?: IntentStorage): OnlineIntent | undefined {
  let raw: string | null = null;
  try { raw = storage(given)?.getItem(ONLINE_INTENT_KEY) ?? null; } catch { return undefined; }
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as Partial<OnlineIntent>;
    const seed = String(parsed.seed ?? '') || seedForCode(String(parsed.code ?? ''));
    if (!seed) return undefined;
    return { code: String(parsed.code ?? ''), seed, name: String(parsed.name ?? ''), server: String(parsed.server ?? ''), roomName: String(parsed.roomName ?? '') };
  } catch { return undefined; }
}

export function writeOnlineIntent(intent: OnlineIntent, given?: IntentStorage): void {
  try { storage(given)?.setItem(ONLINE_INTENT_KEY, JSON.stringify(intent)); } catch { /* sem armazenamento: o co-op pela interface não fica de pé, e o menu diz isso */ }
}

export function clearOnlineIntent(given?: IntentStorage): void {
  try { storage(given)?.removeItem(ONLINE_INTENT_KEY); } catch { /* idem */ }
}

/**
 * O RECADO que atravessa a recarga.
 *
 * Sair da sala, ser expulso ou ver o anfitrião encerrar são três coisas que acontecem numa aba que
 * em seguida recarrega para voltar ao menu. Sem um lugar para o motivo esperar a recarga, o jogador
 * voltaria para a lista de salas sem explicação nenhuma — que é exatamente a reclamação de "o jogo
 * não diz o que está acontecendo".
 */
export const COOP_NOTICE_KEY = 'rdf.coop.aviso';
export function readCoopNotice(given?: IntentStorage): string {
  try {
    const value = storage(given)?.getItem(COOP_NOTICE_KEY) ?? '';
    if (value) storage(given)?.removeItem(COOP_NOTICE_KEY);      // lido uma vez, e some
    return value;
  } catch { return ''; }
}
export function writeCoopNotice(text: string, given?: IntentStorage): void {
  try { storage(given)?.setItem(COOP_NOTICE_KEY, text); } catch { /* sem armazenamento: o aviso se perde, o menu não */ }
}

/**
 * A URL que o RESTO DO JOGO enxerga.
 *
 * Com intenção gravada, devolve a mesma URL acrescida de `online=1&seed=…`; sem ela, devolve o que
 * entrou, sem tocar em nada. **Ninguém navega para o resultado disto** — ele existe só para as
 * decisões internas. A barra de endereço do jogador continua limpa.
 */
export function coopHref(href: string, intent: OnlineIntent | undefined = readOnlineIntent()): string {
  if (!intent) return href;
  try {
    const url = new URL(href);
    // A URL explícita manda: quem abriu com `?online=1&seed=X` pediu a sala X, e uma intenção
    // esquecida na aba não pode sequestrar esse pedido.
    if (url.searchParams.get('online')) return href;
    url.searchParams.set('online', '1');
    url.searchParams.set('seed', intent.seed);
    return url.href;
  } catch { return href; }
}
