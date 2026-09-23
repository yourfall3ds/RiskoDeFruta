import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'colyseus';
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { FarmRoom, NetInput } from '../server/rooms/FarmRoom';
import type { FarmState } from '../server/schema';
import type { FarmSimulation } from '../server/FarmSimulation';

/**
 * O PORTÃO DE CARREGAMENTO: a corrida largava no servidor e a fazenda só começava a montar no
 * cliente — um minuto de horda batendo em corpos parados. Quem declara `loadGate` segura relógio,
 * horda e dano até mandar o primeiro movimento.
 */
let colyseus: ColyseusTestServer;
beforeAll(async () => {
  colyseus = await boot<any>({ initializeGameServer: (s: Server) => { s.define('farm', FarmRoom); } }, 20000 + Math.floor(Math.random() * 30000));
}, 60_000);
afterAll(async () => { await colyseus?.shutdown(); });
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

describe('portão de carregamento', () => {
  it('o mundo não anda até o jogador que carrega mandar o primeiro movimento', async () => {
    const a = await colyseus.sdk.joinOrCreate<FarmState>('farm', { seed: 'gate-1', loadGate: true });
    a.onMessage('*', () => {});
    const room = colyseus.getRoomById<FarmRoom>(a.roomId);
    for (let i = 0; i < 100 && !room.state.players.get(a.sessionId); i++) await wait(50);
    a.send('chooseClass', { classId: 'gunslinger' }); a.send('setReady', { ready: true });
    await wait(4200);
    const sim = room['sim'] as FarmSimulation;
    const t0 = sim.time;
    await wait(1500);                          // "carregando": nenhum movimento enviado
    expect(sim.time).toBe(t0);

    const input = a.input({ type: NetInput });
    for (let i = 1; i <= 30; i++) { Object.assign(input.data, { x: 0, z: 1, yaw: 0, pitch: 0, buttons: 0, interactOption: 0, seq: i }); input.send(); await wait(1000 / 60); }
    await wait(300);
    expect(sim.time).toBeGreaterThan(t0);
    await a.leave();
  }, 60_000);

  it('quem não declara (bots, testes) não segura a mesa', async () => {
    const a = await colyseus.sdk.joinOrCreate<FarmState>('farm', { seed: 'gate-2' });
    a.onMessage('*', () => {});
    const room = colyseus.getRoomById<FarmRoom>(a.roomId);
    for (let i = 0; i < 100 && !room.state.players.get(a.sessionId); i++) await wait(50);
    a.send('chooseClass', { classId: 'gunslinger' }); a.send('setReady', { ready: true });
    await wait(4200);
    const sim = room['sim'] as FarmSimulation;
    const t0 = sim.time;
    await wait(600);
    expect(sim.time).toBeGreaterThan(t0);
    await a.leave();
  }, 60_000);
});
