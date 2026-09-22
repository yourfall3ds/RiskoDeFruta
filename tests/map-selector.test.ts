import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'colyseus';
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { FarmRoom } from '../server/rooms/FarmRoom';
import { PHASE, type FarmState } from '../server/schema';
import { TEST_MAP_ID, TEST_MAP_PLAYER_SPAWNS } from '../src/world/TestMap';

/**
 * O MAPA É ESCOLHIDO PELO ANFITRIÃO, NO LOBBY, E CONGELA NA LARGADA.
 *
 * O `mapId` não é estado de tela: ele mora em `settings`, que é estado AUTORITATIVO da sala. O
 * anfitrião pede, o servidor valida, o estado muda, e todo mundo vê — inclusive quem não pediu.
 *
 * O que se afirma aqui é cada porta do caminho, com o motivo da recusa: quem não é anfitrião não
 * troca; mapa inexistente não entra; e durante a contagem ninguém troca, porque todos confirmaram
 * UM mapa e a corrida não pode largar num que ninguém aceitou.
 */
let colyseus: ColyseusTestServer;
beforeAll(async () => {
  colyseus = await boot<any>({
    initializeGameServer: (gameServer: Server) => { gameServer.define('farm', FarmRoom).filterBy(['seed']); },
  }, 20000 + Math.floor(Math.random() * 30000));
}, 60_000);
afterAll(async () => { await colyseus?.shutdown(); });

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
async function until(condition: () => boolean, attempts = 1600): Promise<boolean> {
  for (let i = 0; i < attempts; i++) { if (condition()) return true; await wait(25); }
  return false;
}

type Cliente = {
  readonly sessionId: string; readonly roomId: string; readonly state: FarmState;
  send(type: string, message?: unknown): void; leave(consented?: boolean): Promise<number>;
  onMessage<T>(type: string, cb: (payload: T) => void): unknown;
};

/** Anfitrião e convidados numa sala nova da FAZENDA (o padrão), com as recusas anotadas. */
async function sala(seed: string, nomes: string[]) {
  const clientes: Cliente[] = [];
  const recusas: { quem: string; key: string; reason: string }[] = [];
  for (const nome of nomes) {
    const c = await colyseus.sdk.joinOrCreate<FarmState>('farm', { seed, name: nome }) as unknown as Cliente;
    c.onMessage<{ key: string; reason: string }>('settingRejected', r => recusas.push({ quem: nome, ...r }));
    clientes.push(c);
  }
  const room = colyseus.getRoomById<FarmRoom>(clientes[0]!.roomId);
  expect(await until(() => room.state.players.size === nomes.length)).toBe(true);
  return { clientes, room, recusas };
}

const fechar = async (clientes: Cliente[]) => { for (const c of clientes) await c.leave().catch(() => {}); };

describe('quem escolhe o mapa', () => {
  it('o anfitrião troca, e TODOS veem a troca no estado da sala', async () => {
    const { clientes: [a, b], room } = await sala('seletor-1', ['ANA', 'BENTO']);
    expect(room.state.settings.get('map')).toBe('');

    a!.send('setSetting', { key: 'map', value: TEST_MAP_ID });
    expect(await until(() => room.state.settings.get('map') === TEST_MAP_ID)).toBe(true);
    // Não é estado local de quem pediu: o CONVIDADO também recebe.
    expect(await until(() => b!.state.settings?.get('map') === TEST_MAP_ID && a!.state.settings?.get('map') === TEST_MAP_ID)).toBe(true);
    await fechar([a!, b!]);
  }, 120_000);

  it('quem NÃO é anfitrião é recusado, e o mapa não muda', async () => {
    const { clientes: [a, b], room, recusas } = await sala('seletor-2', ['ANA', 'BENTO']);
    b!.send('setSetting', { key: 'map', value: TEST_MAP_ID });
    expect(await until(() => recusas.some(r => r.quem === 'BENTO' && r.reason === 'host'))).toBe(true);
    expect(room.state.settings.get('map')).toBe('');
    await fechar([a!, b!]);
  }, 120_000);

  it('mapa que não existe é recusado', async () => {
    const { clientes: [a], room, recusas } = await sala('seletor-3', ['ANA']);
    a!.send('setSetting', { key: 'map', value: 'mapa-inventado' });
    expect(await until(() => recusas.some(r => r.reason === 'value'))).toBe(true);
    expect(room.state.settings.get('map')).toBe('');
    await fechar([a!]);
  }, 120_000);
});

describe('o congelamento', () => {
  /**
   * Durante a contagem, todos confirmaram UM mapa. Trocar debaixo deles faria a corrida largar num
   * lugar que ninguém aceitou.
   */
  it('com a contagem correndo, a troca é recusada e o mapa confirmado fica', async () => {
    const { clientes: [a, b], room, recusas } = await sala('seletor-4', ['ANA', 'BENTO']);
    for (const c of [a!, b!]) { c.send('chooseClass', { classId: 'gunslinger' }); c.send('setReady', { ready: true }); }
    expect(await until(() => room['startAt'] > 0)).toBe(true);

    a!.send('setSetting', { key: 'map', value: TEST_MAP_ID });
    expect(await until(() => recusas.some(r => r.reason === 'starting'))).toBe(true);
    expect(room.state.settings.get('map')).toBe('');
    await fechar([a!, b!]);
  }, 120_000);

  /**
   * Quem deu PRONTO aceitou o mapa que estava na tela. Trocado o mapa, o aceite não vale mais para
   * o que vai acontecer — cada um confirma de novo.
   */
  it('trocar o mapa desfaz o PRONTO de todo mundo', async () => {
    const { clientes: [a, b], room } = await sala('seletor-5', ['ANA', 'BENTO']);
    b!.send('chooseClass', { classId: 'gunslinger' }); b!.send('setReady', { ready: true });
    expect(await until(() => room.state.players.get(b!.sessionId)!.ready)).toBe(true);

    a!.send('setSetting', { key: 'map', value: TEST_MAP_ID });
    expect(await until(() => room.state.settings.get('map') === TEST_MAP_ID)).toBe(true);
    expect(room.state.players.get(b!.sessionId)!.ready).toBe(false);
    expect(room.state.phase).toBe(PHASE.lobby);
    await fechar([a!, b!]);
  }, 120_000);
});

describe('a troca refaz a simulação sem trocar ninguém de número', () => {
  /**
   * P2 saiu: sobram P1 e P3. A simulação é refeita por baixo da sala, e cada um volta com o MESMO
   * número — e nasce no assento DAQUELE número no mapa novo.
   */
  it('P1 e P3 continuam P1 e P3, cada um no seu assento do mapa de teste', async () => {
    const { clientes: [a, b, c], room } = await sala('seletor-6', ['ANA', 'BENTO', 'CLARA']);
    await b!.leave(true);
    expect(await until(() => room.state.players.size === 2)).toBe(true);
    const idA = room.state.players.get(a!.sessionId)!.entityId, idC = room.state.players.get(c!.sessionId)!.entityId;
    expect([idA, idC]).toEqual([1, 3]);

    a!.send('setSetting', { key: 'map', value: TEST_MAP_ID });
    expect(await until(() => room.state.settings.get('map') === TEST_MAP_ID)).toBe(true);
    const pa = room.state.players.get(a!.sessionId)!, pc = room.state.players.get(c!.sessionId)!;
    expect([pa.entityId, pc.entityId]).toEqual([1, 3]);
    // No assento do mapa NOVO, e não no da fazenda.
    expect(pa.x).toBeCloseTo(TEST_MAP_PLAYER_SPAWNS[0]!.x, 3);
    expect(pc.x).toBeCloseTo(TEST_MAP_PLAYER_SPAWNS[2]!.x, 3);
    await fechar([a!, c!]);
  }, 120_000);
});
