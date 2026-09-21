import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { Server, LobbyRoom } from 'colyseus';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { FarmRoom } from './rooms/FarmRoom';

/**
 * Primeiro IPv4 não interno das interfaces da máquina.
 *
 * O servidor anunciava `127.0.0.1`, que é um endereço que SÓ funciona na própria máquina: a
 * segunda pessoa da LAN recebia uma reserva de assento apontando para o computador dela mesma.
 * `publicAddress` é o que o Colyseus devolve ao cliente depois do matchmaking, então é ele — e não
 * a linha de log — que precisa carregar o endereço real.
 */
export function lanIPv4(): string {
  for (const entries of Object.values(networkInterfaces()))
    for (const entry of entries ?? []) if (entry.family === 'IPv4' && !entry.internal) return entry.address;
  return '127.0.0.1';
}

const port = Number(process.env['PORT'] ?? 2567);
/**
 * O endereço ANUNCIADO, que não é necessariamente onde se escuta.
 *
 * Com um túnel (Cloudflare, ngrok) o servidor continua ouvindo em 2567 na máquina, mas o mundo
 * externo fala com ele em `https://algo.trycloudflare.com` na porta 443. Colar `:${port}` no
 * endereço anunciado mandaria o convidado bater em `algo.trycloudflare.com:2567`, que não existe —
 * e o sintoma seria "entrou e caiu", difícil de ligar à causa.
 *
 * Por isso `PUBLIC_HOST` carrega a AUTORIDADE inteira: com porta (`192.168.0.5:2567`) ou sem
 * (`algo.trycloudflare.com`, que significa a porta padrão do esquema). Sem a variável, o padrão
 * continua sendo o IP da LAN com a porta de escuta, que é o caso de jogar na mesma casa.
 */
const address = process.env['PUBLIC_HOST'] ?? `${lanIPv4()}:${port}`;
/**
 * O endereço publicado, também no AMBIENTE.
 *
 * `publicAddress` é o que o Colyseus devolve ao cliente depois do matchmaking, e é por construção o
 * endereço certo — inclusive com `PUBLIC_HOST` apontando para um túnel. A sala precisa do mesmo
 * valor para poder DIZÊ-LO ao cliente (é ele que entra no código curto compartilhado), e o
 * ambiente é o caminho que não obriga `FarmRoom` a importar este arquivo — o que arrastaria o
 * `listen()` para dentro de todo teste que instancia uma sala.
 */
process.env['PUBLIC_ADDRESS'] = address;
/**
 * CORS NO MATCHMAKING — sem isto NINGUÉM vê sala nenhuma.
 *
 * O matchmaking do Colyseus é HTTP: antes de abrir o WebSocket, o cliente faz um `POST` em
 * `/matchmake/joinOrCreate/...`. Quando a página é servida de `http://localhost:5173` e o servidor
 * responde de outro host (um túnel, ou a máquina do anfitrião na LAN), isso é requisição de origem
 * cruzada — e o navegador a BLOQUEIA antes de ela sair, porque a resposta não traz
 * `Access-Control-Allow-Origin`.
 *
 * O sintoma engana: o console diz "servidor de salas fora do ar", a lista aparece vazia e parece
 * que o servidor caiu. Ele está no ar; a resposta é que foi descartada pelo navegador. Foi
 * exatamente o que aconteceu no primeiro teste com duas máquinas.
 *
 * O `request` é registrado AQUI, antes de o transporte anexar o dele, para os cabeçalhos existirem
 * em toda resposta. O `OPTIONS` (preflight) é respondido e encerrado no ato: ele não chega a ser
 * rota de matchmaking, e deixá-lo seguir faria o Colyseus devolver 404 para uma pergunta que era só
 * "posso falar com você?".
 *
 * `*` é deliberado: o servidor é de partida caseira, não há cookie nem sessão de navegador para
 * proteger, e a alternativa (lista de origens) quebraria assim que a porta do Vite mudasse.
 */
const httpServer = createServer();
httpServer.on('request', (req, res) => {
  /**
   * A guarda não é zelo: sem ela o servidor MORRE.
   *
   * O Colyseus também escuta `request` e já responde a boa parte das rotas — inclusive respondendo
   * ao preflight por conta própria em alguns caminhos. Quando a resposta já saiu, `setHeader` lança
   * `ERR_HTTP_HEADERS_SENT`, e uma exceção dentro de um ouvinte de evento do Node não é capturada
   * por ninguém: derruba o processo. Foi o que aconteceu — a porta 2567 caía sozinha no meio do
   * teste e o sintoma no navegador era "não consegui falar com o servidor", que parece rede e é
   * processo morto.
   *
   * O `try` cobre o resto: nenhum cabeçalho de conveniência vale o servidor cair.
   */
  if (res.headersSent) return;
  try {
    /**
     * A ORIGEM É REFLETIDA, e `*` seria um bug silencioso.
     *
     * O SDK do Colyseus faz o pedido de matchmaking com credenciais. A especificação do CORS proíbe
     * `Access-Control-Allow-Origin: *` quando há credenciais: o navegador descarta a resposta e
     * relata apenas `Failed to fetch` — sem dizer por quê.
     *
     * Isso enganou o diagnóstico: um `fetch` escrito à mão no console FUNCIONAVA (200, com `*`),
     * porque ele não manda credencial; só o caminho do jogo falhava. Refletir a origem e declarar
     * `Allow-Credentials` conserta os dois casos.
     *
     * `Vary: Origin` é obrigatório junto: sem ele, um intermediário guarda a resposta de uma origem
     * e a devolve para outra, e o erro volta em outra máquina, de forma intermitente.
     */
    const origin = req.headers.origin;
    res.setHeader('Access-Control-Allow-Origin', origin && origin !== 'null' ? origin : '*');
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Max-Age', '600');
    if (req.method === 'OPTIONS' && !res.writableEnded) { res.writeHead(204); res.end(); }
  } catch { /* outra parte já respondeu; os cabeçalhos dela valem */ }
});
const server = new Server({ transport: new WebSocketTransport({ server: httpServer }), publicAddress: address });
// Listagem em tempo real: `client.getAvailableRooms()` saiu no 0.16; quem descobre salas é o LobbyRoom.
server.define('lobby', LobbyRoom);
// `filterBy(['seed'])` fica: é o que mantém o atalho `?online=1&seed=` caindo na MESMA sala.
server.define('farm', FarmRoom).filterBy(['seed']).enableRealtimeListing();
// `address` JÁ carrega a porta quando ela existe (ver acima), então colá-la de novo imprimia
// `ws://192.168.15.42:2567:2567` — e alguém acabaria copiando esse endereço de dentro do log.
/**
 * A REDE DE SEGURANÇA DO PROCESSO.
 *
 * Uma exceção em retorno de chamada do Node — ou uma promessa rejeitada que ninguém esperou —
 * derruba o processo inteiro na versão atual. Para um servidor de jogo isso significa a sala de
 * TODO MUNDO caindo por causa de uma falha de um só, e o sintoma que chega ao jogador é o pior
 * possível: "a porta 2567 morreu sozinha", sem erro em lugar nenhum.
 *
 * Já aconteceu nesta base duas vezes — o handler de CORS acima (`ERR_HTTP_HEADERS_SENT`) e o
 * `.catch` que faltava no encerrar/trancar sala. Isto não substitui tratar o erro onde ele nasce:
 * é o que garante que a PRÓXIMA falha não tratada vire uma linha no log em vez de uma queda.
 */
process.on('unhandledRejection', motivo => console.error('[servidor] promessa rejeitada sem dono', motivo));
process.on('uncaughtException', erro => console.error('[servidor] exceção sem dono', erro));

void server.listen(port).then(() => console.log(`Mutant Farm · servidor Colyseus em ws://${address}  (escutando na porta ${port})`));
