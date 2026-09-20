/**
 * O NOME DO JOGADOR, perguntado UMA vez.
 *
 * A pergunta só aparece na primeira vez que alguém abre o multijogador; depois o nome está salvo e
 * o caminho até a sala é `MULTIPLAYER → CRIAR SALA`, dois cliques. Repetir a pergunta a cada
 * sessão seria transformar um dado que não muda em pedágio.
 *
 * `localStorage` e não `sessionStorage`: o nome tem de sobreviver ao fechar do navegador. O acesso
 * é sempre protegido porque em janela anônima, com cookies bloqueados ou dentro de um `iframe` o
 * próprio `localStorage` LANÇA ao ser lido — e perder o menu inteiro por causa do nome seria
 * desproporcional. Sem armazenamento, o jogo só volta a perguntar.
 */

export const PLAYER_NAME_KEY = 'rdf.jogador.nome';
export const PLAYER_NAME_MAX = 16;

/** O que dá para usar do que foi digitado. Vazio quando não sobra nada. */
export function sanitizePlayerName(input: string): string {
  return (input ?? '').replace(/\s+/g, ' ').trim().slice(0, PLAYER_NAME_MAX);
}

export interface NameStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }

function storage(given?: NameStorage): NameStorage | undefined {
  if (given) return given;
  try { return globalThis.localStorage ?? undefined; } catch { return undefined; }
}

/** O nome salvo, ou `''` se nunca foi perguntado (ou se não há onde guardar). */
export function loadPlayerName(given?: NameStorage): string {
  try { return sanitizePlayerName(storage(given)?.getItem(PLAYER_NAME_KEY) ?? ''); } catch { return ''; }
}

/** Salva e devolve o que foi salvo. Nome vazio não é gravado: apagaria o que já valia. */
export function savePlayerName(name: string, given?: NameStorage): string {
  const clean = sanitizePlayerName(name);
  if (!clean) return '';
  try { storage(given)?.setItem(PLAYER_NAME_KEY, clean); } catch { /* sem armazenamento: só não persiste */ }
  return clean;
}
