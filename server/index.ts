import { createServer } from 'node:http';
import { Server } from 'colyseus';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { FarmRoom } from './rooms/FarmRoom';

const port = Number(process.env['PORT'] ?? 2567);
const server = new Server({ transport: new WebSocketTransport({ server: createServer() }) });
server.define('farm', FarmRoom).filterBy(['seed']);
void server.listen(port).then(() => console.log(`Mutant Farm · servidor Colyseus em ws://127.0.0.1:${port}`));
