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
const host = process.env['PUBLIC_HOST'] ?? lanIPv4();
const server = new Server({ transport: new WebSocketTransport({ server: createServer() }), publicAddress: `${host}:${port}` });
// Listagem em tempo real: `client.getAvailableRooms()` saiu no 0.16; quem descobre salas é o LobbyRoom.
server.define('lobby', LobbyRoom);
// `filterBy(['seed'])` fica: é o que mantém o atalho `?online=1&seed=` caindo na MESMA sala.
server.define('farm', FarmRoom).filterBy(['seed']).enableRealtimeListing();
void server.listen(port).then(() => console.log(`Mutant Farm · servidor Colyseus em ws://${host}:${port}`));
