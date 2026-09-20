/**
 * O endereço que a JANELA do Electron carrega.
 *
 * O jogador instalado não digita endereço nenhum — então alguém tem de dizer ao cliente onde está
 * o servidor embutido, e esse alguém é a URL que o processo principal manda a janela abrir.
 *
 * O cliente já sabe resolver isso: `src/net/ServerAddress.ts` lê `?server=` antes de qualquer
 * outra coisa. Portanto NÃO existe código novo de resolução aqui — este módulo só monta a URL que
 * alimenta o resolvedor que já existe e já é testado. Reescrever a resolução do lado do Electron
 * criaria duas regras para a mesma pergunta, e elas divergiriam na primeira mudança.
 */
export interface AlvoEmbutido {
  /** Porta do servidor estático que serve o build do Vite (o `file://` não serve — ver abaixo). */
  readonly portaHttp: number;
  /** Porta do Colyseus embutido, escolhida em tempo de execução por `escolherPorta`. */
  readonly portaJogo: number;
  /** Em desenvolvimento, a origem do Vite (`http://localhost:5173`) em vez do servidor estático. */
  readonly origemDev?: string | undefined;
}

/**
 * Por que NÃO `file://`.
 *
 * O build do Vite é um módulo ES, e o navegador recusa `import` de módulo em `file://` por origem
 * opaca — a página abriria em branco, sem erro visível para o jogador. Além disso `fetch` dos
 * assets (modelos, áudio) falha pela mesma razão, e o Havok/WASM também. Servir por HTTP em
 * `127.0.0.1` custa poucas linhas e faz o aplicativo empacotado se comportar igual ao `npm run
 * preview`, que é o caminho já exercitado.
 */
export function urlDoCliente(alvo: AlvoEmbutido): string {
  const base = alvo.origemDev ? alvo.origemDev.replace(/\/+$/, '') : `http://127.0.0.1:${alvo.portaHttp}`;
  // O endereço vai como AUTORIDADE (`127.0.0.1:2567`), sem esquema: `normalizeServerUrl` põe
  // `ws:` ou `wss:` conforme o protocolo da página. Mandar `ws://…` cravado aqui funcionaria hoje
  // e quebraria no dia em que a página fosse servida por `https`.
  const servidor = encodeURIComponent(`127.0.0.1:${alvo.portaJogo}`);
  return `${base}/index.html?server=${servidor}`;
}

/**
 * O endereço que o ANFITRIÃO anuncia na LAN, e que o convidado vai usar.
 *
 * Aqui o `127.0.0.1` não serve: ele é o endereço que significa "eu mesmo", então o convidado que o
 * recebesse tentaria falar com o próprio computador dele. Este é o mesmo erro que
 * `server/index.ts` documenta em `lanIPv4()`, e a correção é a mesma — anunciar o IP da LAN.
 */
export function enderecoAnunciado(ipLan: string, porta: number): string {
  return `${ipLan}:${porta}`;
}
