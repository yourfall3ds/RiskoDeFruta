/**
 * ONDE FICA O SERVIDOR DE SALAS — resolvido num lugar só, em três camadas.
 *
 * ## O problema que isto resolve
 *
 * A lista de salas vem do `LobbyRoom`, e o `LobbyRoom` vive DENTRO de um servidor. Enquanto cada
 * jogador subia o próprio Colyseus na própria máquina, a lista só podia mostrar as salas dele
 * mesmo — ninguém via ninguém, e era por isso que o código curto existia: ele carregava o endereço
 * do anfitrião porque não havia um lugar comum onde as salas pudessem se encontrar.
 *
 * O lugar comum é um **servidor padrão configurável**. Com ele definido no build, MULTIPLAYER abre,
 * conecta e lista — sem o jogador digitar endereço nenhum, e sem o código deixar de funcionar.
 *
 * ## As três camadas, nesta ordem
 *
 * ```
 * 1. ?server=ws://host:porta   na URL      quem está depurando mandou explicitamente
 * 2. VITE_SERVER=wss://host    no build    o servidor compartilhado desta instalação
 * 3. o host de onde a página veio          jogar na mesma casa / na mesma LAN
 *    └─ sem host legível: ws://127.0.0.1:2567
 * ```
 *
 * A camada 3 é o "último recurso" do pedido, escrito da forma que de fato serve: quem abre
 * `http://192.168.15.42:5173` na LAN do anfitrião precisa falar com `192.168.15.42:2567`, e não com
 * o `127.0.0.1` da própria máquina — esse era o bug antigo. Quando a página não tem host legível
 * (`file://`, href inválido), a queda é literalmente `ws://127.0.0.1:2567`.
 *
 * Nada aqui lê ambiente por conta própria além de `configuredServerUrl()`, que é a única função
 * deste arquivo que toca `import.meta.env`. O resto é função pura de texto para texto, que é o que
 * permite cobrir as três camadas em teste sem servidor, sem build e sem navegador.
 */

import { DEFAULT_COOP_PORT } from './RoomCode';

/** A queda final, quando nem a URL, nem o build, nem a página dizem onde o servidor está. */
export const LOCAL_SERVER_URL = `ws://127.0.0.1:${DEFAULT_COOP_PORT}`;

/**
 * Um endereço escrito por uma pessoa, virado URL de WebSocket.
 *
 * Aceita as formas que alguém realmente escreve numa variável de ambiente: `wss://host`,
 * `ws://host:2567`, `https://host`, `host:2567` e `host`. Sem esquema, o esquema vem do da PÁGINA —
 * uma página em `https:` não pode abrir `ws:` (o navegador bloqueia conteúdo misto), e descobrir
 * isso em produção é caro.
 */
export function normalizeServerUrl(value: string, pageProtocol = 'http:', port = DEFAULT_COOP_PORT): string {
  const text = String(value ?? '').trim().replace(/\/+$/, '');
  if (!text) return '';
  if (/^wss?:\/\//i.test(text)) return text;
  if (/^https:\/\//i.test(text)) return 'wss://' + text.slice('https://'.length);
  if (/^http:\/\//i.test(text)) return 'ws://' + text.slice('http://'.length);
  const scheme = pageProtocol === 'https:' ? 'wss:' : 'ws:';
  // Sem porta escrita, a porta padrão do co-op. Com porta, respeita o que foi escrito — inclusive
  // a ausência dela num túnel (`wss://algo.trycloudflare.com` fala na 443 do esquema).
  return `${scheme}//${/:\d{1,5}$/.test(text) ? text : `${text}:${port}`}`;
}

export interface ServerSources {
  /** Camada 1: o `?server=` da URL. */
  readonly query?: string | undefined;
  /** Camada 2: `VITE_SERVER`, definido no build ou no `.env`. */
  readonly configured?: string | undefined;
  /** Camada 3: a URL da página, de onde o host é deduzido. */
  readonly pageHref?: string | undefined;
  readonly port?: number | undefined;
}

/** A resolução em si, sem ambiente e sem navegador. */
export function resolveServerUrl(sources: ServerSources): string {
  const port = sources.port ?? DEFAULT_COOP_PORT;
  let protocol = 'http:', hostname = '';
  try {
    const url = new URL(String(sources.pageHref ?? ''));
    protocol = url.protocol; hostname = url.hostname;
  } catch { /* sem página legível: a camada 3 vira o padrão local */ }

  const explicit = normalizeServerUrl(String(sources.query ?? ''), protocol, port);
  if (explicit) return explicit;
  const configured = normalizeServerUrl(String(sources.configured ?? ''), protocol, port);
  if (configured) return configured;
  if (!hostname) return LOCAL_SERVER_URL;
  return `${protocol === 'https:' ? 'wss:' : 'ws:'}//${hostname}:${port}`;
}

/**
 * `VITE_SERVER` do build, se existir. Ver `.env.example`.
 *
 * Único ponto do projeto que lê `import.meta.env`, e ele está aqui de propósito: o servidor
 * (`server/tsconfig.json`) não conhece os tipos do Vite, então nada que o servidor importe pode
 * tocar nisto. Por isso o resolvedor acima recebe o valor por parâmetro.
 */
export function configuredServerUrl(): string {
  try {
    const env = (import.meta as { env?: Record<string, unknown> }).env;
    return String(env?.['VITE_SERVER'] ?? '').trim();
  } catch { return ''; }
}

/** As três camadas, com o build e a página já lidos. É o que o cliente chama. */
export function serverUrlFor(href: string, configured = configuredServerUrl(), port = DEFAULT_COOP_PORT): string {
  let query = '';
  try { query = new URL(href).searchParams.get('server') ?? ''; } catch { /* href ilegível: sem camada 1 */ }
  return resolveServerUrl({ query, configured, pageHref: href, port });
}

/** `true` quando esta instalação aponta para um servidor compartilhado (camada 2). */
export function hasSharedServer(configured = configuredServerUrl()): boolean {
  return !!normalizeServerUrl(configured);
}
