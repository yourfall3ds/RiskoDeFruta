import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import { Server } from 'colyseus';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { FarmRoom, NetInput, BUTTON } from '../server/rooms/FarmRoom';
import type { FarmState } from '../server/schema';

/**
 * Sala real, dois clientes reais pelo SDK. Cliente envia intenção (input com seq);
 * o servidor decide a posição e a cadência; os dois clientes recebem o mesmo estado.
 */
let colyseus: ColyseusTestServer;
beforeAll(async () => {
  const server = new Server({ transport: new WebSocketTransport({ server: createServer() }) });
  server.define('farm', FarmRoom);
  colyseus = await boot(server);
}, 60_000);
afterAll(async () => { await colyseus.shutdown(); });

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
/** Prontidão pelo estado, não por mensagem: `welcome` pode chegar antes de o teste registrar o listener. */
async function untilPlayer(room: FarmRoom, sessionId: string): Promise<void> {
  for (let i = 0; i < 100; i++) { if (room.state.players.get(sessionId)) return; await wait(50); }
  throw new Error(`jogador ${sessionId} não entrou no estado`);
}

describe('sala cooperativa (Colyseus 0.18)', () => {
  it('dois clientes entram, um anda por intenção e ambos veem a mesma posição autoritativa', async () => {
    const a = await colyseus.sdk.joinOrCreate<FarmState>('farm', { seed: 'net-room' });
    const b = await colyseus.sdk.joinOrCreate<FarmState>('farm', { seed: 'net-room' });
    expect(b.roomId).toBe(a.roomId);
    const room = colyseus.getRoomById<FarmRoom>(a.roomId);
    await untilPlayer(room, a.sessionId); await untilPlayer(room, b.sessionId);
    await wait(150);                                          // primeiras patches
    const before = room.state.players.get(a.sessionId)!.z, bBefore = room.state.players.get(b.sessionId)!.z;

    const input = a.input({ type: NetInput });
    for (let i = 0; i < 45; i++) { input.data.z = 1; input.data.buttons = 0; input.data.seq = i + 1; input.send(); await wait(1000 / 60); }
    input.data.z = 0; input.data.seq = 46; input.send();     // para; compara-se em repouso, não no meio do movimento

    // Convergência com limite: servidor parado (dois lidos iguais) e os dois clientes casando com ele.
    // Sob carga (suíte inteira em paralelo) um patch de 30 Hz pode atrasar; esperar tempo fixo é frágil.
    const serverA = room.state.players.get(a.sessionId)!, serverB = room.state.players.get(b.sessionId)!;
    let previous = Number.NaN, converged = false;
    for (let i = 0; i < 60 && !converged; i++) {
      await wait(50);
      const z = serverA.z, sa = a.state.players.get(a.sessionId)?.z, sb = b.state.players.get(a.sessionId)?.z;
      converged = Math.abs(z - previous) < 1e-4 && sa !== undefined && sb !== undefined && Math.abs(sa - z) < .01 && Math.abs(sb - z) < .01;
      previous = z;
    }
    expect(converged).toBe(true);
    expect(serverA.z).toBeGreaterThan(before + 2);           // andou no servidor
    expect(serverB.z).toBeCloseTo(bBefore, 3);               // quem não enviou intenção não se mexeu
    expect(serverA.seq).toBe(46);

    await a.leave(); await b.leave();
  }, 60_000);

  it('ignora pacotes com seq repetido e impõe a cadência da arma ao tiro', async () => {
    const a = await colyseus.sdk.joinOrCreate<FarmState>('farm', { seed: 'net-room-2' });
    const room = colyseus.getRoomById<FarmRoom>(a.roomId);
    await untilPlayer(room, a.sessionId);
    const input = a.input({ type: NetInput });
    // 10 pacotes de FIRE em ~160 ms, todos com seq=1: só o primeiro é válido; FIRE mantido vira intenção contínua.
    for (let i = 0; i < 10; i++) { input.data.buttons = BUTTON.FIRE; input.data.seq = 1; input.send(); await wait(1000 / 60); }
    await wait(150);
    const p = room.state.players.get(a.sessionId)!;
    expect(p.seq).toBe(1);                                    // duplicatas ignoradas
    expect(50 - p.ammo).toBeLessThanOrEqual(4);              // ~0,3 s a 6,7 tiros/s: a cadência é do servidor, não do cliente
    expect(50 - p.ammo).toBeGreaterThanOrEqual(1);
    await a.leave();
  }, 60_000);
});
