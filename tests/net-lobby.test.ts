import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'colyseus';
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { FarmRoom } from '../server/rooms/FarmRoom';
import { FarmState, PHASE } from '../server/schema';

/**
 * O LOBBY, contra um servidor de verdade e clientes de verdade pelo SDK.
 *
 * A regra sob teste é a unanimidade ESTRITA: a corrida só sai do lobby quando TODOS os conectados
 * estão prontos E com personagem escolhido, e qualquer quebra dessa condição dentro da contagem
 * (entrada, desistência, queda) devolve a sala ao lobby. Testar isso com uma simulação de mentira
 * não provaria nada — o que decide é a sala, e é a sala que está aqui.
 */
let colyseus: ColyseusTestServer;
beforeAll(async () => {
  /**
   * PORTA SORTEADA — e a forma de pedi-la importa.
   *
   * `tests/net-room.test.ts` também sobe um servidor real, e o vitest roda os arquivos em
   * paralelo: se os dois usarem a mesma porta, um morre com `EADDRINUSE`. Uma porta fixa também
   * não basta — basta um servidor de teste zumbi de uma execução anterior (ou de outra sessão de
   * trabalho na mesma máquina) segurando a porta para a suíte inteira falhar por um motivo que
   * nada tem a ver com o código. Sortear numa faixa alta torna o arquivo imune às duas coisas.
   *
   * Só que `boot(server, port)` IGNORA a porta quando o primeiro argumento é uma instância de
   * `Server` — nesse ramo o pacote chama `gameServer.listen(DEFAULT_TEST_PORT)` com a constante
   * 2568 cravada (`@colyseus/testing/build/index.mjs:10`). A porta só é respeitada no outro ramo,
   * o que recebe um objeto de configuração e cai em `listen(config, port)` (linha 19).
   *
   * Por isso aqui a sala é registrada por `initializeGameServer` em vez de `server.define`: é o
   * que coloca a chamada no ramo que honra a porta. `filterBy(['seed'])` continua como em
   * produção — é o que garante UMA sala por caso de teste, em vez de `joinOrCreate` reaproveitar
   * a sala não cheia do caso anterior.
   */
  // O genérico explícito evita que o TypeScript infira `never` a partir do objeto de configuração
  // e recuse a atribuição a `ColyseusTestServer<any>`.
  colyseus = await boot<any>({
    initializeGameServer: (gameServer: Server) => {
      gameServer.define('farm', FarmRoom).filterBy(['seed']);
    },
  }, 20000 + Math.floor(Math.random() * 30000));
}, 60_000);
// `colyseus` fica indefinido se o `boot` falhar; sem a guarda, o erro real vira um
// "Cannot read properties of undefined" no encerramento e esconde a causa.
afterAll(async () => { await colyseus?.shutdown(); });

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
/** A contagem da sala é de 3 s; esperar um pouco além dela é o que prova que a largada aconteceu. */
const PAST_COUNTDOWN = 4200;

async function untilPlayer(room: FarmRoom, sessionId: string): Promise<void> {
  for (let i = 0; i < 100; i++) { if (room.state.players.get(sessionId)) return; await wait(50); }
  throw new Error(`jogador ${sessionId} não entrou no estado`);
}

let seedCounter = 0;
/** Uma sala por caso: `filterBy` não está ligado no `define` do teste, o seed é quem separa. */
const nextSeed = () => `lobby-${++seedCounter}`;

describe('lobby cooperativo com unanimidade estrita', () => {
  it('dois clientes se veem no roster com nome, classe e prontidão', async () => {
    const seed = nextSeed();
    const a = await colyseus.sdk.joinOrCreate<FarmState>('farm', { seed, name: 'ANA' });
    const b = await colyseus.sdk.joinOrCreate<FarmState>('farm', { seed, name: 'BENTO' });
    const room = colyseus.getRoomById<FarmRoom>(a.roomId);
    await untilPlayer(room, a.sessionId); await untilPlayer(room, b.sessionId);

    a.send('chooseClass', { classId: 'soldier' });
    b.send('setReady', { ready: true });
    await wait(400);

    // O roster de CADA cliente enxerga os dois jogadores, com os mesmos dados.
    for (const view of [a, b]) {
      const roster = [...view.state.players.values()];
      expect(roster).toHaveLength(2);
      expect(roster.map(p => p.name).sort()).toEqual(['ANA', 'BENTO']);
      expect(roster.map(p => p.entityId).sort()).toEqual([1, 2]);
    }
    const server = [...room.state.players.values()];
    expect(server.find(p => p.name === 'ANA')!.classChosen).toBe(true);
    expect(server.find(p => p.name === 'ANA')!.classId).toBe(1);   // ordinal de 'soldier'
    expect(server.find(p => p.name === 'BENTO')!.ready).toBe(true);
    expect(room.state.hostId).toBe(a.sessionId);
    expect(room.state.playerCount).toBe(2);

    await a.leave(); await b.leave();
  }, 60_000);

  it('não larga com apenas um pronto, nem com pronto sem personagem escolhido', async () => {
    const seed = nextSeed();
    const a = await colyseus.sdk.joinOrCreate<FarmState>('farm', { seed });
    const b = await colyseus.sdk.joinOrCreate<FarmState>('farm', { seed });
    const room = colyseus.getRoomById<FarmRoom>(a.roomId);
    await untilPlayer(room, a.sessionId); await untilPlayer(room, b.sessionId);

    a.send('chooseClass', { classId: 'gunslinger' });
    a.send('setReady', { ready: true });
    await wait(PAST_COUNTDOWN);
    expect(room.state.phase).toBe(PHASE.lobby);                   // um pronto não é unanimidade

    // B pronto MAS sem personagem: continua faltando a segunda metade da condição.
    b.send('setReady', { ready: true });
    await wait(PAST_COUNTDOWN);
    expect(room.state.phase).toBe(PHASE.lobby);

    await a.leave(); await b.leave();
  }, 60_000);

  it('larga quando todos estão prontos e com personagem escolhido', async () => {
    const seed = nextSeed();
    const a = await colyseus.sdk.joinOrCreate<FarmState>('farm', { seed });
    const b = await colyseus.sdk.joinOrCreate<FarmState>('farm', { seed });
    const room = colyseus.getRoomById<FarmRoom>(a.roomId);
    await untilPlayer(room, a.sessionId); await untilPlayer(room, b.sessionId);

    let announced = 0, started = 0;
    a.onMessage('runStarting', () => { announced++; });
    a.onMessage('runStarted', () => { started++; });

    for (const client of [a, b]) { client.send('chooseClass', { classId: 'gunslinger' }); client.send('setReady', { ready: true }); }
    await wait(PAST_COUNTDOWN);

    expect(room.state.phase).toBe(PHASE.playing);
    expect(announced).toBe(1);
    expect(started).toBe(1);

    await a.leave(); await b.leave();
  }, 60_000);

  it('um jogador desistindo aborta a largada e a sala continua no lobby', async () => {
    const seed = nextSeed();
    const a = await colyseus.sdk.joinOrCreate<FarmState>('farm', { seed });
    const b = await colyseus.sdk.joinOrCreate<FarmState>('farm', { seed });
    const room = colyseus.getRoomById<FarmRoom>(a.roomId);
    await untilPlayer(room, a.sessionId); await untilPlayer(room, b.sessionId);

    let aborted = 0;
    a.onMessage('runAborted', () => { aborted++; });
    for (const client of [a, b]) { client.send('chooseClass', { classId: 'gunslinger' }); client.send('setReady', { ready: true }); }
    await wait(500);                                              // dentro da contagem, ainda no lobby
    expect(room.state.phase).toBe(PHASE.lobby);

    b.send('setReady', { ready: false });
    await wait(PAST_COUNTDOWN);
    expect(aborted).toBe(1);
    expect(room.state.phase).toBe(PHASE.lobby);
    expect(room.state.players.get(b.sessionId)!.ready).toBe(false);

    await a.leave(); await b.leave();
  }, 60_000);

  it('uma desconexão durante a contagem aborta a largada mesmo com os restantes prontos', async () => {
    const seed = nextSeed();
    const a = await colyseus.sdk.joinOrCreate<FarmState>('farm', { seed });
    const b = await colyseus.sdk.joinOrCreate<FarmState>('farm', { seed });
    const c = await colyseus.sdk.joinOrCreate<FarmState>('farm', { seed });
    const room = colyseus.getRoomById<FarmRoom>(a.roomId);
    for (const client of [a, b, c]) await untilPlayer(room, client.sessionId);

    let aborted = 0;
    a.onMessage('runAborted', () => { aborted++; });
    for (const client of [a, b, c]) { client.send('chooseClass', { classId: 'gunslinger' }); client.send('setReady', { ready: true }); }
    await wait(500);
    expect(room.state.phase).toBe(PHASE.lobby);                   // contagem em curso

    await c.leave();
    await wait(700);
    // A largada caiu junto com C, e a contagem dos dois que ficaram recomeçou do zero — por isso a
    // sala ainda está no lobby 700 ms depois, bem dentro dos 3 s da contagem nova.
    expect(aborted).toBe(1);
    expect(room.state.phase).toBe(PHASE.lobby);
    expect(room.state.players.size).toBe(2);
    expect(room.state.hostId).toBe(a.sessionId);

    await a.leave(); await b.leave();
  }, 60_000);

  it('um não-pronto entrando durante a contagem derruba a largada', async () => {
    const seed = nextSeed();
    const a = await colyseus.sdk.joinOrCreate<FarmState>('farm', { seed });
    const room = colyseus.getRoomById<FarmRoom>(a.roomId);
    await untilPlayer(room, a.sessionId);

    let aborted = 0;
    a.onMessage('runAborted', () => { aborted++; });
    a.send('chooseClass', { classId: 'gunslinger' }); a.send('setReady', { ready: true });
    await wait(400);
    const b = await colyseus.sdk.joinOrCreate<FarmState>('farm', { seed });
    await untilPlayer(room, b.sessionId);
    await wait(PAST_COUNTDOWN);

    expect(aborted).toBe(1);
    expect(room.state.phase).toBe(PHASE.lobby);

    await a.leave(); await b.leave();
  }, 60_000);

  it('setSetting de quem não é anfitrião é recusado', async () => {
    const seed = nextSeed();
    const a = await colyseus.sdk.joinOrCreate<FarmState>('farm', { seed });
    const b = await colyseus.sdk.joinOrCreate<FarmState>('farm', { seed });
    const room = colyseus.getRoomById<FarmRoom>(a.roomId);
    await untilPlayer(room, a.sessionId); await untilPlayer(room, b.sessionId);

    const rejected: string[] = [];
    b.onMessage('settingRejected', (payload: { key: string; reason: string }) => { rejected.push(payload.reason); });
    b.send('setSetting', { key: 'mode', value: 'horde' });
    await wait(400);
    expect(rejected).toEqual(['host']);
    expect(room.state.settings.get('mode')).toBeUndefined();

    // O anfitrião passa; chave desconhecida dele também é recusada.
    a.send('setSetting', { key: 'mode', value: 'horde' });
    a.send('setSetting', { key: 'cheat', value: '1' });
    await wait(400);
    expect(room.state.settings.get('mode')).toBe('horde');
    expect(room.state.settings.get('cheat')).toBeUndefined();

    await a.leave(); await b.leave();
  }, 60_000);

  it('entityId é atribuído na entrada e não renumera quem fica', async () => {
    const seed = nextSeed();
    const a = await colyseus.sdk.joinOrCreate<FarmState>('farm', { seed });
    const b = await colyseus.sdk.joinOrCreate<FarmState>('farm', { seed });
    const c = await colyseus.sdk.joinOrCreate<FarmState>('farm', { seed });
    const room = colyseus.getRoomById<FarmRoom>(a.roomId);
    for (const client of [a, b, c]) await untilPlayer(room, client.sessionId);
    expect(room.state.players.get(c.sessionId)!.entityId).toBe(3);

    await b.leave();
    await wait(300);
    // A e C mantêm 1 e 3. Antes, o id saía da ORDEM do mapa e C virava 2 no meio da corrida.
    expect(room.state.players.get(a.sessionId)!.entityId).toBe(1);
    expect(room.state.players.get(c.sessionId)!.entityId).toBe(3);

    // O buraco deixado por B é reaproveitado, mantendo a faixa 1..4.
    const d = await colyseus.sdk.joinOrCreate<FarmState>('farm', { seed });
    await untilPlayer(room, d.sessionId);
    expect(room.state.players.get(d.sessionId)!.entityId).toBe(2);
    expect(room.state.players.get(c.sessionId)!.entityId).toBe(3);

    await a.leave(); await c.leave(); await d.leave();
  }, 60_000);
});
