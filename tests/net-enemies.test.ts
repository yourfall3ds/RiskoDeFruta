import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'colyseus';
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { FarmRoom } from '../server/rooms/FarmRoom';
import type { FarmState } from '../server/schema';
import { ENEMY_STATES } from '../server/schema';

/**
 * DOIS CLIENTES REAIS, UM MUNDO SÓ.
 *
 * Este arquivo é a prova do bloco: até aqui `EnemyState` era declarado no schema e NUNCA escrito, e
 * cada cliente rodava a própria horda. As afirmações abaixo são as que só passam quando existe um
 * dono único — mesmos ids, mesma vida, mesmo alvo, mesma morte.
 */
let colyseus: ColyseusTestServer;
beforeAll(async () => {
  /**
   * PORTA SORTEADA, pelo ramo do `boot` que realmente a respeita.
   *
   * Com `boot(server)` este arquivo subia na 2568 cravada — a MESMA de `tests/net-room.test.ts`.
   * O vitest roda os arquivos em paralelo, então os dois disputavam a porta: o perdedor pendurava
   * o `beforeAll` até o limite de 60 s e o vitest marcava os três casos como PULADOS. E pular não
   * é falhar: a suíte fechava "verde" sem nunca ter executado a única prova fim-a-fim do co-op.
   * Foi assim que isto passou despercebido — isolado o arquivo passa, junto ele não roda.
   *
   * `boot(server, port)` IGNORA a porta quando o primeiro argumento é uma instância de `Server`:
   * esse ramo chama `gameServer.listen(DEFAULT_TEST_PORT)` com a constante cravada
   * (`@colyseus/testing/build/index.mjs:10`). Só o ramo que recebe configuração honra a porta.
   * Sortear numa faixa alta também imuniza contra servidor zumbi de execução anterior.
   *
   * Sem `filterBy` aqui, e de propósito: estes casos querem os dois clientes na MESMA sala, que é
   * o mundo único sob teste. `net-lobby` filtra por semente porque lá cada caso quer sala própria.
   */
  // O genérico explícito evita que o TypeScript infira `never` a partir do objeto de configuração.
  colyseus = await boot<any>({
    initializeGameServer: (gameServer: Server) => { gameServer.define('farm', FarmRoom); },
  }, 20000 + Math.floor(Math.random() * 30000));
}, 60_000);
// `colyseus` fica indefinido se o `boot` falhar; sem a guarda o erro real vira um
// "Cannot read properties of undefined" no encerramento e esconde a causa.
afterAll(async () => { await colyseus?.shutdown(); });

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

async function untilPlayer(room: FarmRoom, sessionId: string): Promise<void> {
  for (let i = 0; i < 100; i++) { if (room.state.players.get(sessionId)) return; await wait(50); }
  throw new Error(`jogador ${sessionId} não entrou no estado`);
}
/** Espera a condição valer nos DOIS clientes; patch de 30 Hz sob carga não cabe em tempo fixo. */
async function until(condition: () => boolean, attempts = 240): Promise<boolean> {
  for (let i = 0; i < attempts; i++) { if (condition()) return true; await wait(50); }
  return false;
}
/**
 * LARGAR A CORRIDA, que passou a ser obrigatório para haver horda.
 *
 * Estes casos juntavam dois clientes e esperavam o diretor pagar o primeiro corpo SEM largar nada
 * — o que funcionava porque a simulação rodava também no lobby. Isso era um defeito: o mundo ficava
 * vivo enquanto os jogadores ainda escolhiam personagem, e eles entravam em campo já feridos, ou
 * mortos, sem ter visto o que os matou. Um cliente de testes chegou a sair com `vida: 0` de uma
 * sala que nunca começou.
 *
 * Com o lobby parado, a horda só existe depois da largada — e é assim que o jogo se comporta para
 * quem joga. O que estes casos afirmam sobre REPLICAÇÃO continua idêntico; só passaram a afirmá-lo
 * no estado em que o jogador de fato veria a horda.
 */
async function largar(clients: readonly { send(type: string, message?: unknown): void }[]): Promise<void> {
  for (const c of clients) { c.send('chooseClass', { classId: 'gunslinger' }); c.send('setReady', { ready: true }); }
  // A contagem da sala é de 3 s; esperar além dela é o que garante que a corrida largou.
  await wait(4200);
}

/** `enemies` é `undefined` no cliente até a primeira patch chegar — antes disso não há mundo ainda. */
const rows = (state: FarmState) => state?.enemies ? [...state.enemies.values()] : [];
const ids = (state: FarmState) => rows(state).map(e => e.id).sort((x, y) => x - y);

describe('a horda replicada é a mesma nos dois clientes', () => {
  it('mesmos ids, mesma vida e mesmo alvo — e o schema finalmente É preenchido', async () => {
    const a = await colyseus.sdk.joinOrCreate<FarmState>('farm', { seed: 'net-enemies-1' });
    const b = await colyseus.sdk.joinOrCreate<FarmState>('farm', { seed: 'net-enemies-1' });
    expect(b.roomId).toBe(a.roomId);
    const room = colyseus.getRoomById<FarmRoom>(a.roomId);
    await untilPlayer(room, a.sessionId); await untilPlayer(room, b.sessionId);
    await largar([a, b]);

    // O diretor precisa de tempo de relógio para pagar o primeiro corpo.
    expect(await until(() => rows(a.state).length > 0 && rows(b.state).length > 0)).toBe(true);
    // Isto sozinho já era impossível antes: `mirror()` nunca escrevia `EnemyState`.
    expect(rows(room.state).length).toBeGreaterThan(0);

    expect(await until(() => JSON.stringify(ids(a.state)) === JSON.stringify(ids(b.state)))).toBe(true);
    expect(ids(a.state)).toEqual(ids(b.state));
    expect(ids(a.state)).toEqual(ids(room.state));

    for (const ra of rows(a.state)) {
      const rb = rows(b.state).find(e => e.id === ra.id)!;
      expect(rb).toBeDefined();
      // Vida, espécie, variante e ESTADO vêm do servidor: nenhum cliente os calcula.
      expect(rb.hp).toBe(ra.hp);
      expect(rb.maxHP).toBe(ra.maxHP);
      expect(rb.kind).toBe(ra.kind);
      expect(rb.variant).toBe(ra.variant);
      // O ALVO é o campo que fecha o bug original: sem ele, cada tela adivinharia um alvo diferente.
      expect(rb.targetPlayerId).toBe(ra.targetPlayerId);
      expect(ENEMY_STATES[ra.state]).toBeDefined();
    }
    await a.leave(); await b.leave();
  }, 120_000);

  it('a morte acontece UMA vez e os dois clientes veem a mesma', async () => {
    const a = await colyseus.sdk.joinOrCreate<FarmState>('farm', { seed: 'net-enemies-2' });
    const b = await colyseus.sdk.joinOrCreate<FarmState>('farm', { seed: 'net-enemies-2' });
    const room = colyseus.getRoomById<FarmRoom>(a.roomId);
    await untilPlayer(room, a.sessionId); await untilPlayer(room, b.sessionId);
    await largar([a, b]);
    expect(await until(() => rows(a.state).length > 0 && rows(b.state).length > 0)).toBe(true);

    const victim = rows(room.state)[0]!;
    const before = room.state.progression.totalKills;
    // O abate é pedido ao SERVIDOR. Nenhum cliente reivindica morte — é a regra do contrato §1.
    room['sim'].enemies.applyDamage(victim.id, {
      attackerId: 0, victimId: victim.id, sourceId: 'qa', attackId: 'qa',
      baseDamage: victim.maxHP * 10, finalDamage: victim.maxHP * 10, crit: false,
      procCoefficient: 0, procChainDepth: 0, damageTags: ['qa'],
      hitPosition: { x: victim.x, y: victim.y, z: victim.z }, hitNormal: { x: 0, y: 1, z: 0 },
      forceDirection: { x: 0, y: 0, z: 1 }, forceMagnitude: 0,
    });

    const deadFor = (state: FarmState) => state.enemies.get(String(victim.id))?.alive === false;
    expect(await until(() => deadFor(a.state) && deadFor(b.state))).toBe(true);
    expect(a.state.enemies.get(String(victim.id))!.hp).toBe(0);
    expect(b.state.enemies.get(String(victim.id))!.hp).toBe(0);
    // Uma morte, um abate — e não um por cliente, que é o que aconteceria com dois donos da regra.
    expect(room.state.progression.totalKills).toBe(before + 1);
    await a.leave(); await b.leave();
  }, 120_000);

  /**
   * ESTE CASO MUDOU DE PREMISSA, e a premissa antiga não existe mais.
   *
   * Ele entrava com um cliente, esperava a horda nascer e SÓ ENTÃO trazia um segundo — provando que
   * quem chega depois recebe os corpos que já estão em campo. Duas coisas tiraram o chão dele: o
   * lobby parou de simular (não há horda antes da largada) e a sala passou a TRANCAR quando a
   * corrida começa (não há entrada tardia). A recusa do retardatário é afirmada em
   * `tests/coop-four-clients`, caso 14.
   *
   * O que este caso protegia continua valendo e continua aqui: os dois clientes veem EXATAMENTE a
   * mesma horda, com os mesmos ids — nenhum deles inventa corpo, e nenhum deles perde corpo. A
   * diferença é que agora os dois entram antes da largada, que é como a sala funciona.
   */
  it('os dois veem exatamente a mesma horda, sem inventar nem perder corpo', async () => {
    const a = await colyseus.sdk.joinOrCreate<FarmState>('farm', { seed: 'net-enemies-3' });
    const b = await colyseus.sdk.joinOrCreate<FarmState>('farm', { seed: 'net-enemies-3' });
    const room = colyseus.getRoomById<FarmRoom>(a.roomId);
    await untilPlayer(room, a.sessionId); await untilPlayer(room, b.sessionId);
    await largar([a, b]);

    expect(await until(() => rows(a.state).length > 0 && rows(b.state).length > 0)).toBe(true);
    expect(await until(() => JSON.stringify(ids(a.state)) === JSON.stringify(ids(room.state))
      && JSON.stringify(ids(b.state)) === JSON.stringify(ids(room.state)))).toBe(true);
    expect(ids(a.state)).toEqual(ids(room.state));
    expect(ids(b.state)).toEqual(ids(room.state));
    await a.leave(); await b.leave();
  }, 120_000);
});
