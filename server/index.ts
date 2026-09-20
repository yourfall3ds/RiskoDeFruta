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
const host = address;
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
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '600');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); }
});
const server = new Server({ transport: new WebSocketTransport({ server: httpServer }), publicAddress: address });
// Listagem em tempo real: `client.getAvailableRooms()` saiu no 0.16; quem descobre salas é o LobbyRoom.
server.define('lobby', LobbyRoom);
// `filterBy(['seed'])` fica: é o que mantém o atalho `?online=1&seed=` caindo na MESMA sala.
server.define('farm', FarmRoom).filterBy(['seed']).enableRealtimeListing();
void server.listen(port).then(() => console.log(`Mutant Farm · servidor Colyseus em ws://${host}:${port}`));
