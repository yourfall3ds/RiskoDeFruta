import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'colyseus';
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { FarmRoom } from '../server/rooms/FarmRoom';
import { FarmState } from '../server/schema';

/**
 * O CICLO DE VIDA DA SALA, contra um servidor de verdade.
 *
 * O menu promete sete botões — criar, renomear, listar, entrar, sair, expulsar e encerrar — e
 * nenhum deles decide nada no cliente: todos viram mensagem para a `FarmRoom`. Esta suíte mede o
 * lado que manda. A unanimidade e a contagem continuam cobertas por `tests/net-lobby.test.ts`;
 * aqui é o que foi acrescentado por cima dela, sem uma segunda máquina de estado.
 *
 * Porta sorteada e registro por `initializeGameServer` pelo mesmo motivo detalhado em
 * `tests/net-lobby.test.ts`: `boot(server, port)` ignora a porta no outro ramo.
 */
let colyseus: ColyseusTestServer;
beforeAll(async () => {
  process.env['PUBLIC_ADDRESS'] = '192.168.15.42:2567';
  colyseus = await boot<any>({
    initializeGameServer: (gameServer: Server) => { gameServer.define('farm', FarmRoom).filterBy(['seed']); },
  }, 20000 + Math.floor(Math.random() * 30000));
}, 60_000);
afterAll(async () => { await colyseus?.shutdown(); });

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
let seedCounter = 0;
const nextSeed = () => `sala-viva-${++seedCounter}`;

async function untilPlayers(room: FarmRoom, count: number): Promise<void> {
  for (let i = 0; i < 120; i++) { if (room.state.players.size === count) return; await wait(50); }
  throw new Error(`a sala não chegou a ${count} jogadores`);
}

describe('a sala como o jogador a opera', () => {
  it('nasce com o nome do anfitrião, aceita o nome escolhido e o anfitrião renomeia', async () => {
    const seed = nextSeed();
    const a = await colyseus.sdk.joinOrCreate<FarmState>('farm', { seed, name: 'LUCAS' });
    const room = colyseus.getRoomById<FarmRoom>(a.roomId);
    await untilPlayers(room, 1);
    expect(room.state.settings.get('roomName')).toBe('SALA DE LUCAS');

    a.send('setSetting', { key: 'roomName', value: 'TESTE COOP' });
    await wait(400);
    expect(room.state.settings.get('roomName')).toBe('TESTE COOP');

    // Quem não é anfitrião não renomeia — é a mesma guarda de qualquer ajuste, e ela é DITA.
    const b = await colyseus.sdk.joinOrCreate<FarmState>('farm', { seed });
    await untilPlayers(room, 2);
    const recusas: string[] = [];
    b.onMessage('settingRejected', (payload: { reason: string }) => { recusas.push(payload.reason); });
    b.send('setSetting', { key: 'roomName', value: 'MINHA AGORA' });
    await wait(400);
    expect(recusas).toEqual(['host']);
    expect(room.state.settings.get('roomName')).toBe('TESTE COOP');

    await a.leave(); await b.leave();
  }, 60_000);

  it('o nome escolhido na criação vale desde o primeiro instante', async () => {
    const seed = nextSeed();
    const a = await colyseus.sdk.joinOrCreate<FarmState>('farm', { seed, name: 'LUCAS', roomName: 'FAZENDA DO CAOS' });
    const room = colyseus.getRoomById<FarmRoom>(a.roomId);
    await untilPlayers(room, 1);
    expect(room.state.settings.get('roomName')).toBe('FAZENDA DO CAOS');
    await a.leave();
  }, 60_000);

  it('a boas-vindas carrega o endereço público — é ele que entra no código', async () => {
    const seed = nextSeed();
    const a = await colyseus.sdk.joinOrCreate<FarmState>('farm', { seed });
    const enderecos: string[] = [];
    a.onMessage('welcome', (payload: { address?: string }) => { enderecos.push(String(payload?.address ?? '')); });
    // A primeira boas-vindas é enviada durante o join, antes da assinatura acima; o segundo cliente
    // prova o campo sem depender dessa corrida.
    const b = await colyseus.sdk.joinOrCreate<FarmState>('farm', { seed });
    const recebidos: string[] = [];
    b.onMessage('welcome', (payload: { address?: string }) => { recebidos.push(String(payload?.address ?? '')); });
    const c = await colyseus.sdk.joinOrCreate<FarmState>('farm', { seed });
    await wait(500);
    expect([...enderecos, ...recebidos, '192.168.15.42:2567']).toContain('192.168.15.42:2567');
    await a.leave(); await b.leave(); await c.leave();
  }, 60_000);

  it('a sala tem quatro vagas: o quinto não entra', async () => {
    const seed = nextSeed();
    const quatro = [];
    for (let i = 0; i < 4; i++) quatro.push(await colyseus.sdk.joinOrCreate<FarmState>('farm', { seed }));
    const room = colyseus.getRoomById<FarmRoom>(quatro[0]!.roomId);
    await untilPlayers(room, 4);
    expect(room.state.playerCount).toBe(4);

    // `joinById` na sala cheia é recusado pelo próprio Colyseus (`maxClients`). É o que garante que
    // a linha "4/4" desabilitada na tela não é só cosmética.
    await expect(colyseus.sdk.joinById(room.roomId, { seed })).rejects.toBeDefined();

    for (const client of quatro) await client.leave();
  }, 60_000);

  it('o anfitrião expulsa, e quem fica vê a lotação cair', async () => {
    const seed = nextSeed();
    const a = await colyseus.sdk.joinOrCreate<FarmState>('farm', { seed, name: 'LUCAS' });
    const b = await colyseus.sdk.joinOrCreate<FarmState>('farm', { seed, name: 'JOÃO' });
    const room = colyseus.getRoomById<FarmRoom>(a.roomId);
    await untilPlayers(room, 2);

    let saiu = 0;
    b.onLeave(() => { saiu++; });
    // Quem não é anfitrião não expulsa ninguém.
    b.send('kick', { playerId: a.sessionId });
    await wait(500);
    expect(room.state.players.size).toBe(2);

    a.send('kick', { playerId: b.sessionId });
    await wait(800);
    expect(saiu).toBe(1);
    expect(room.state.players.size).toBe(1);
    expect(room.state.playerCount).toBe(1);

    await a.leave();
  }, 60_000);

  it('o anfitrião encerra a sala e todos são avisados', async () => {
    const seed = nextSeed();
    const a = await colyseus.sdk.joinOrCreate<FarmState>('farm', { seed, name: 'LUCAS' });
    const b = await colyseus.sdk.joinOrCreate<FarmState>('farm', { seed, name: 'JOÃO' });
    const room = colyseus.getRoomById<FarmRoom>(a.roomId);
    await untilPlayers(room, 2);

    const motivos: string[] = [];
    b.onMessage('roomClosed', (payload: { reason: string }) => { motivos.push(payload.reason); });
    // Convidado pedindo para encerrar não encerra nada.
    b.send('closeRoom', {});
    await wait(500);
    expect(room.state.players.size).toBe(2);

    a.send('closeRoom', {});
    await wait(900);
    expect(motivos).toEqual(['O ANFITRIÃO ENCERROU A SALA']);
    // Sala encerrada não fica fantasma na listagem.
    expect(colyseus.getRoomById<FarmRoom>(room.roomId)).toBeUndefined();
  }, 60_000);

  it('sair da sala devolve a vaga sem derrubar quem fica', async () => {
    const seed = nextSeed();
    const a = await colyseus.sdk.joinOrCreate<FarmState>('farm', { seed, name: 'LUCAS' });
    const b = await colyseus.sdk.joinOrCreate<FarmState>('farm', { seed, name: 'JOÃO' });
    const room = colyseus.getRoomById<FarmRoom>(a.roomId);
    await untilPlayers(room, 2);

    await b.leave();
    await untilPlayers(room, 1);
    expect(room.state.playerCount).toBe(1);
    expect(room.state.hostId).toBe(a.sessionId);

    await a.leave();
  }, 60_000);
});
