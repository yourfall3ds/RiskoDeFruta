import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'colyseus';
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { FarmRoom, NetInput } from '../server/rooms/FarmRoom';
import { PHASE, type FarmState } from '../server/schema';
import type { FarmSimulation } from '../server/FarmSimulation';
import type { DamageContext } from '../src/core/contracts';
import { HOME_CHESTS } from '../src/run/ChestCatalog';

/**
 * QUATRO CLIENTES REAIS, UMA SALA REAL.
 *
 * Os arquivos `net-*` e `coop-*` já provam o co-op com DOIS clientes. A mesa cheia é outra coisa:
 * numeração 1..4, alvo que não pode depender do jogador 1, dano por vítima, concorrência de quatro
 * no mesmo corpo, inventário por sobrevivente e a queda de um no meio da corrida. Nada aqui é
 * simulado: sala de verdade, SDK de verdade, e a autoridade continua sendo só do servidor.
 *
 * Porta sorteada e registro por `initializeGameServer` pelo motivo longo de `tests/net-lobby.ts`:
 * `boot(server, port)` ignora a porta no outro ramo e o vitest roda os arquivos em paralelo.
 */
let colyseus: ColyseusTestServer;
beforeAll(async () => {
  colyseus = await boot<any>({
    initializeGameServer: (gameServer: Server) => { gameServer.define('farm', FarmRoom).filterBy(['seed']); },
  }, 20000 + Math.floor(Math.random() * 30000));
}, 60_000);
afterAll(async () => { await colyseus?.shutdown(); });

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
async function until(condition: () => boolean, attempts = 240): Promise<boolean> {
  for (let i = 0; i < attempts; i++) { if (condition()) return true; await wait(25); }
  return false;
}
/** A contagem da sala é de 3 s; esperar além dela é o que prova que a largada aconteceu (ou não). */
const PAST_COUNTDOWN = 4200;

let seedCounter = 0;
const nextSeed = () => `quarteto-${++seedCounter}`;

/**
 * O cliente como o SDK o devolve, descrito pelo que este arquivo USA dele.
 *
 * `colyseus.js` não é dependência declarada do projeto (o SDK chega por `@colyseus/testing`), então
 * nomear o tipo por estrutura é o que evita um import que o `tsc` não resolve — sem `any` nenhum.
 */
type Espelho = {
  readonly sessionId: string;
  readonly roomId: string;
  readonly state: FarmState;
  send(type: string, message?: unknown): void;
  onMessage<Payload>(type: string, callback: (payload: Payload) => void): unknown;
  leave(consented?: boolean): Promise<number>;
  input(options: { type: typeof NetInput }): { data: InstanceType<typeof NetInput>; send(): void };
};

type Mesa = {
  seed: string;
  clients: Espelho[];
  room: FarmRoom;
  sim: FarmSimulation;
  close(): Promise<void>;
};

/**
 * LARGAR A CORRIDA — que passou a ser obrigatório para a simulação andar.
 *
 * O lobby não simula mais: enquanto a sala está escolhendo personagem, o mundo fica PARADO. Antes
 * ele corria, e era um defeito — a horda nascia e feria quem ainda estava no menu, e o jogador
 * entrava em campo já machucado, ou morto, sem ter visto o que o matou.
 *
 * Os casos que mexem com MOVIMENTO, ALVO ou SOCO precisam do mundo andando, então largam aqui. Os
 * que só empurram estado na simulação (dano direto, compra, inventário) continuam sem largar: eles
 * não dependem do passo, e largar só os deixaria mais lentos.
 */
async function largar(m: Mesa): Promise<void> {
  for (const client of m.clients) { client.send('chooseClass', { classId: 'gunslinger' }); client.send('setReady', { ready: true }); }
  await wait(PAST_COUNTDOWN);
  expect(m.room.state.phase).toBe(PHASE.playing);
}

/** A,B,C,D na MESMA sala, em ordem de entrada — é a ordem que decide anfitrião e `entityId`. */
async function mesa(seed: string, count = 4, names = ['ANA', 'BENTO', 'CLARA', 'DINO']): Promise<Mesa> {
  const clients: Espelho[] = [];
  for (let i = 0; i < count; i++) clients.push(await colyseus.sdk.joinOrCreate<FarmState>('farm', { seed, name: names[i] }));
  const room = colyseus.getRoomById<FarmRoom>(clients[0]!.roomId);
  for (const client of clients) {
    const ok = await until(() => !!room.state.players.get(client.sessionId));
    if (!ok) throw new Error(`jogador ${client.sessionId} não entrou no estado`);
  }
  /**
   * A ENTRADA NO SCHEMA NÃO É O ESTADO ESPELHADO.
   *
   * `onJoin` cria o `PlayerState` com os campos numéricos ainda por escrever; quem lê vida ou
   * posição antes do primeiro `mirror()` recebe `undefined` — e `undefined > 0` é falso sem erro
   * nenhum, que é a forma mais silenciosa de um caso destes mentir.
   */
  const pronto = await until(() => [...room.state.players.values()].every(p => p.hp > 0 && Number.isFinite(p.x) && Number.isFinite(p.z)));
  if (!pronto) throw new Error('a sala não espelhou os jogadores');
  const sim = room['sim'] as FarmSimulation;
  return {
    seed, clients, room, sim,
    /**
     * Desmontagem que não pendura a suíte.
     *
     * `leave()` num cliente que JÁ saiu (ou numa sala encerrada) nunca resolve: o `onLeave` que a
     * promessa espera já aconteceu. Sem a corrida contra o relógio, um caso que derruba um jogador
     * de propósito travava no `finally` até o limite do `it`.
     */
    async close() {
      for (const client of clients)
        await Promise.race([client.leave().catch(() => 0), wait(1500)]);
    },
  };
}

/** O diretor parado: um corpo nascendo sozinho mexeria em alvo, recompensa e saldo no meio do caso. */
function freeze(sim: FarmSimulation): void { sim.enemies.director.stopped = true; }

/** Espalha os quatro pelo campo, com a altura vinda da colisão — perto demais, "alvo" não diz nada. */
function spread(mesa: Mesa): { x: number; y: number; z: number }[] {
  const base = { ...mesa.sim.players.get(mesa.clients[0]!.sessionId)!.motor.position };
  // Seis metros: longe o bastante para "o corpo colado em C" não ser ambíguo, perto o bastante para
  // os quatro continuarem na faixa de chão do celeiro, que é onde a colisão do servidor é sólida.
  const offsets = [{ x: 0, z: 0 }, { x: 6, z: 0 }, { x: 0, z: 6 }, { x: 6, z: 6 }];
  return mesa.clients.map((client, i) => {
    const x = base.x + offsets[i]!.x, z = base.z + offsets[i]!.z;
    const ground = mesa.sim.collision.groundAt(x, z, 6);
    const at = { x, y: Number.isFinite(ground) ? ground : base.y, z };
    Object.assign(mesa.sim.players.get(client.sessionId)!.motor.position, at);
    return at;
  });
}

const entityIdOf = (mesa: Mesa, i: number) => mesa.room.state.players.get(mesa.clients[i]!.sessionId)!.entityId;

/** Dano que ENTRA PELA MESMA PORTA da horda: `PlayerMotor.applyDamage`, com a vítima nomeada. */
function hurt(mesa: Mesa, i: number, amount: number): void {
  const player = mesa.sim.players.get(mesa.clients[i]!.sessionId)!;
  const m = player.motor;
  m.invulnerable = 0;
  const context: DamageContext = {
    attackerId: 900, victimId: player.entityId, sourceId: 'eggplant_rush', attackId: 'eggplant_rush',
    baseDamage: amount, finalDamage: amount, crit: false, procCoefficient: 0, procChainDepth: 0,
    damageTags: ['enemy'], hitPosition: { ...m.position }, hitNormal: { x: 0, y: 1, z: 0 },
    forceDirection: { x: 0, y: 0, z: 1 }, forceMagnitude: 0,
  };
  m.applyDamage(context);
}

/** Estado COMPARTILHADO como cada tela o vê. Igual em todas, ou os quatro jogam mundos diferentes. */
function shared(state: FarmState): string {
  return JSON.stringify({
    stage: state.stage, phase: state.phase, seed: state.seed, playerCount: state.playerCount,
    credits: state.progression.credits, kills: state.progression.totalKills, purchases: state.progression.purchases,
    usedChests: [...state.usedChests].sort(),
    enemies: [...(state.enemies?.values() ?? [])]
      .map(e => ({ id: e.id, hp: e.hp, alive: e.alive, target: e.targetPlayerId }))
      .sort((a, b) => a.id - b.id),
  });
}

/** Estado POR JOGADOR como cada tela o vê — e toda tela vê o de TODOS, não só o do dono. */
function perPlayer(state: FarmState): string {
  return JSON.stringify([...state.players.values()]
    .map(p => ({ id: p.id, entityId: p.entityId, hp: Math.round(p.hp * 100) / 100, maxHP: p.maxHP, inventory: [...p.inventory.entries()].sort() }))
    .sort((a, b) => a.entityId - b.entityId));
}

/** Os quatro espelhos convergiram para a MESMA verdade (compartilhada e por jogador). */
async function convergent(mesa: Mesa): Promise<boolean> {
  return until(() => {
    const views = mesa.clients.map(c => c.state);
    if (views.some(v => !v?.players || v.players.size !== mesa.room.state.players.size)) return false;
    const s = views.map(shared), p = views.map(perPlayer);
    return s.every(x => x === s[0]) && p.every(x => x === p[0]) && s[0] === shared(mesa.room.state) && p[0] === perPlayer(mesa.room.state);
  });
}

describe('a mesa cheia: quatro clientes reais contra a FarmRoom', () => {
  it('1. A cria, B/C/D entram: quatro ids estáveis e distintos, e os quatro veem os quatro', async () => {
    const m = await mesa(nextSeed());
    try {
      freeze(m.sim);
      expect(m.room.state.playerCount).toBe(4);
      const ids = m.clients.map(c => c.sessionId);
      expect(new Set(ids).size).toBe(4);
      expect([...m.room.state.players.values()].map(p => p.entityId).sort()).toEqual([1, 2, 3, 4]);
      expect(m.room.state.hostId).toBe(m.clients[0]!.sessionId);

      // Cada tela enxerga o roster inteiro, com os MESMOS ids e os mesmos números.
      expect(await until(() => m.clients.every(c => c.state.players?.size === 4))).toBe(true);
      for (const client of m.clients) {
        const roster = [...client.state.players.values()];
        expect(roster.map(p => p.id).sort()).toEqual([...ids].sort());
        expect(roster.map(p => p.entityId).sort()).toEqual([1, 2, 3, 4]);
        expect(roster.map(p => p.name).sort()).toEqual(['ANA', 'BENTO', 'CLARA', 'DINO']);
      }
      // Os ids não mudam por um passo da simulação: identidade é fixada na entrada.
      await wait(400);
      for (const [i, client] of m.clients.entries()) expect(m.room.state.players.get(client.sessionId)!.entityId).toBe(i + 1);
    } finally { await m.close(); }
  }, 120_000);

  it('2. três prontos não largam; o quarto larga a corrida EXATAMENTE uma vez', async () => {
    const m = await mesa(nextSeed());
    try {
      freeze(m.sim);
      const [a, b, c, d] = m.clients as [typeof m.clients[0], typeof m.clients[0], typeof m.clients[0], typeof m.clients[0]];
      let started = 0, announced = 0;
      const counters = m.clients.map(() => ({ started: 0 }));
      for (const [i, client] of m.clients.entries()) client.onMessage('runStarted', () => { counters[i]!.started++; });
      a.onMessage('runStarted', () => { started++; });
      a.onMessage('runStarting', () => { announced++; });

      for (const client of m.clients) client.send('chooseClass', { classId: 'gunslinger' });
      for (const client of [a, b, c]) client.send('setReady', { ready: true });
      await wait(PAST_COUNTDOWN);
      // Unanimidade ESTRITA: três de quatro não é unanimidade.
      expect(m.room.state.phase).toBe(PHASE.lobby);
      expect(started).toBe(0);
      expect(announced).toBe(0);

      d.send('setReady', { ready: true });
      await wait(PAST_COUNTDOWN);
      expect(m.room.state.phase).toBe(PHASE.playing);
      expect(announced).toBe(1);
      expect(started).toBe(1);
      // Uma largada para a sala, não uma por cliente.
      for (const counter of counters) expect(counter.started).toBe(1);
    } finally { await m.close(); }
  }, 120_000);

  it('3. os quatro andam para lados diferentes e as quatro telas veem a mesma posição autoritativa', async () => {
    const m = await mesa(nextSeed());
    try {
      freeze(m.sim);
      await largar(m);
      // Números copiados um a um: espalhar um `Schema` copia os campos internos, não os valores.
      const before = m.clients.map(c => { const p = m.room.state.players.get(c.sessionId)!; return { x: p.x, z: p.z }; });
      const direction = [{ x: 0, z: 1 }, { x: 0, z: -1 }, { x: 1, z: 0 }, { x: -1, z: 0 }];
      const inputs = m.clients.map(c => c.input({ type: NetInput }));
      for (let i = 1; i <= 45; i++) {
        for (const [k, input] of inputs.entries()) {
          input.data.x = direction[k]!.x; input.data.z = direction[k]!.z;
          input.data.yaw = 0; input.data.pitch = 0; input.data.buttons = 0; input.data.seq = i; input.send();
        }
        await wait(1000 / 60);
      }
      for (const [k, input] of inputs.entries()) { input.data.x = 0; input.data.z = 0; input.data.seq = 46; input.send(); void k; }

      // Convergência com limite: servidor parado e as quatro telas casando com ele.
      const server = () => m.clients.map(c => m.room.state.players.get(c.sessionId)!);
      let previous = '', converged = false;
      for (let i = 0; i < 80 && !converged; i++) {
        await wait(50);
        const now = JSON.stringify(server().map(p => [Math.round(p.x * 1e3), Math.round(p.z * 1e3)]));
        converged = now === previous && m.clients.every(view => server().every(p => {
          const seen = view.state.players.get(p.id);
          return seen !== undefined && Math.abs(seen.x - p.x) < .05 && Math.abs(seen.z - p.z) < .05;
        }));
        previous = now;
      }
      expect(converged).toBe(true);

      // Cada um andou para o SEU lado — e o eixo de cada um é o que o servidor moveu.
      const after = m.clients.map(c => m.room.state.players.get(c.sessionId)!);
      expect(after[0]!.z).toBeGreaterThan(before[0]!.z + 1);
      expect(after[1]!.z).toBeLessThan(before[1]!.z - 1);
      expect(after[2]!.x).toBeGreaterThan(before[2]!.x + 1);
      expect(after[3]!.x).toBeLessThan(before[3]!.x - 1);
      // Mesmos `entityId` nas quatro telas, sem renumerar ninguém no meio do movimento.
      for (const client of m.clients)
        expect([...client.state.players.values()].map(p => `${p.id}:${p.entityId}`).sort())
          .toEqual([...m.room.state.players.values()].map(p => `${p.id}:${p.entityId}`).sort());
    } finally { await m.close(); }
  }, 180_000);

  it('4. o alvo aponta para um vivo e NÃO depende do jogador 1: 2, 3 e 4 também são caçados', async () => {
    const m = await mesa(nextSeed());
    try {
      freeze(m.sim);
      await largar(m);
      const spots = spread(m);
      // Um corpo colado em cada um dos quatro. Se o alvo fosse "o jogador 1", nenhum deles caçaria
      // o vizinho — que é exatamente a regressão que este caso fecha.
      const planted: number[] = [];
      for (const spot of spots) {
        if (m.sim.enemies.spawn('eggplant', { x: spot.x + 2, y: spot.y, z: spot.z + 2 }, 'normal')) planted.push(m.sim.enemies.lastSpawnedId);
      }
      expect(planted.length).toBeGreaterThanOrEqual(2);

      const living = new Set([...m.room.state.players.values()].filter(p => p.hp > 0).map(p => p.entityId));
      const others = new Set([...living].filter(id => id !== entityIdOf(m, 0)));
      const targets = () => [...m.room.state.enemies.values()].map(e => e.targetPlayerId);
      // Um alvo que não é 1 prova que a política roda entre os vivos. "Distribuição perfeita" não é
      // exigida: a política é por arquétipo, não um rodízio.
      expect(await until(() => targets().some(id => others.has(id)))).toBe(true);

      // E TODO alvo publicado é de um jogador vivo — nunca lixo, nunca um morto, nunca um ausente.
      for (let i = 0; i < 20; i++) {
        for (const enemy of m.room.state.enemies.values())
          expect(enemy.targetPlayerId === 0 || living.has(enemy.targetPlayerId)).toBe(true);
        await wait(50);
      }
      // As quatro telas veem o MESMO alvo em cada corpo.
      expect(await until(() => {
        const rowOf = (s: FarmState) => JSON.stringify([...(s.enemies?.values() ?? [])].map(e => [e.id, e.targetPlayerId]).sort());
        return m.clients.every(c => rowOf(c.state) === rowOf(m.room.state));
      })).toBe(true);
    } finally { await m.close(); }
  }, 180_000);

  it('5. o dano é POR VÍTIMA: A, B, C e D perdem vida cada um na sua vez', async () => {
    const m = await mesa(nextSeed());
    try {
      freeze(m.sim);
      spread(m);
      const hpOf = (i: number) => m.room.state.players.get(m.clients[i]!.sessionId)!.hp;
      const inicial = [0, 1, 2, 3].map(hpOf);
      expect(inicial.every(hp => hp > 0)).toBe(true);

      for (const victim of [0, 1, 2, 3]) {
        const antes = [0, 1, 2, 3].map(hpOf);
        hurt(m, victim, 12);
        expect(await until(() => hpOf(victim) < antes[victim]!)).toBe(true);
        // Os outros três não pagaram o dano do companheiro. (Regeneração é por segundo; a folga de
        // 1 hp mantém o caso honesto sem depender do relógio.)
        for (const other of [0, 1, 2, 3]) if (other !== victim) expect(hpOf(other)).toBeGreaterThanOrEqual(antes[other]! - 1);
      }
      // E as quatro telas leem a vida dos quatro, não só a própria.
      expect(await convergent(m)).toBe(true);
    } finally { await m.close(); }
  }, 180_000);

  it('6. os quatro socam o mesmo corpo na mesma janela: UMA morte e UMA recompensa', async () => {
    const m = await mesa(nextSeed());
    try {
      freeze(m.sim);
      await largar(m);
      const base = { ...m.sim.players.get(m.clients[0]!.sessionId)!.motor.position };
      expect(m.sim.enemies.spawn('eggplant', { x: base.x, y: base.y, z: base.z + 3 }, 'normal')).toBe(true);
      const enemy = m.sim.enemies.actor(m.sim.enemies.lastSpawnedId)!;
      enemy.health.current = 1;                                   // um golpe basta: a morte é do servidor

      // Os quatro em volta do corpo, virados para ele. Nenhum deles decide nada — só pede.
      const ring = [{ x: 0, z: -1.2 }, { x: 1.2, z: 0 }, { x: -1.2, z: 0 }, { x: 0, z: 1.2 }];
      for (const [i, client] of m.clients.entries()) {
        const player = m.sim.players.get(client.sessionId)!;
        Object.assign(player.motor.position, { x: enemy.position.x + ring[i]!.x, y: enemy.position.y, z: enemy.position.z + ring[i]!.z });
        player.yaw = Math.atan2(enemy.position.x - (enemy.position.x + ring[i]!.x), enemy.position.z - (enemy.position.z + ring[i]!.z));
      }

      const mortes: number[] = [];
      // `EnemyKilled` viaja como `DamageContext`: a vítima é `victimId` (o id do corpo).
      m.clients[0]!.onMessage('EnemyKilled', (payload: { victimId?: number }) => { mortes.push(Number(payload?.victimId ?? -1)); });
      const killsAntes = m.sim.progression.totalKills, creditosAntes = m.sim.progression.credits;

      for (const client of m.clients) client.send('melee', { requestId: `golpe-${client.sessionId}` });
      await wait(1200);

      expect(enemy.health.dead).toBe(true);
      // UMA morte: nem quatro, nem uma por cliente.
      expect(m.sim.progression.totalKills).toBe(killsAntes + 1);
      expect(mortes.filter(id => id === enemy.id)).toHaveLength(1);
      const creditosDepois = m.sim.progression.credits;
      expect(creditosDepois).toBeGreaterThan(creditosAntes);

      // Uma segunda salva no MESMO corpo não paga nada: a recompensa acontece uma vez.
      for (const client of m.clients) client.send('melee', { requestId: `golpe2-${client.sessionId}` });
      await wait(900);
      expect(m.sim.progression.totalKills).toBe(killsAntes + 1);
      expect(m.sim.progression.credits).toBe(creditosDepois);
      expect(mortes.filter(id => id === enemy.id)).toHaveLength(1);

      // Os quatro veem a MESMA morte, com o mesmo número.
      expect(await until(() => m.clients.every(c => c.state.enemies?.get(String(enemy.id))?.alive === false))).toBe(true);
    } finally { await m.close(); }
  }, 180_000);

  it('7. quatro baús, um por jogador: inventários próprios e os MESMOS baús consumidos nas quatro telas', async () => {
    const m = await mesa(nextSeed());
    try {
      freeze(m.sim);
      m.sim.progression.credits = 5000;                           // o preço sobe a cada baú aberto
      const chests = ['supply-0', 'shop-1', 'supply-3', 'supply-4'].map(id => HOME_CHESTS.find(c => c.id === id)!);
      const verdicts: { ok: boolean; item?: { id: string } }[][] = m.clients.map(() => []);
      for (const [i, client] of m.clients.entries()) client.onMessage('purchaseResolved', (v: { ok: boolean; item?: { id: string } }) => { verdicts[i]!.push(v); });

      for (const [i, client] of m.clients.entries()) {
        // Cada um encostado NO SEU baú: a distância é validada no servidor.
        Object.assign(m.sim.players.get(client.sessionId)!.motor.position, chests[i]!);
        client.send('buyChest', { interactableId: chests[i]!.id, requestId: `compra-${i}` });
        expect(await until(() => verdicts[i]!.length > 0)).toBe(true);
        expect(verdicts[i]![0]!.ok).toBe(true);
      }

      // Cada sobrevivente ficou com a SUA pilha — o item de um não entra no loadout dos outros.
      for (const client of m.clients) {
        const inventory = m.sim.players.get(client.sessionId)!.loadout.inventory;
        expect([...inventory.values()].reduce((s, n) => s + n, 0)).toBe(1);
      }
      expect(m.sim.chests.purchases).toBe(4);
      expect(m.room.state.progression.purchases).toBe(4);

      // As quatro telas veem os mesmos quatro baús consumidos e o inventário de TODOS.
      const esperados = chests.map(c => c.id).sort();
      expect(await until(() => m.clients.every(c => JSON.stringify([...(c.state.usedChests ?? [])].sort()) === JSON.stringify(esperados)))).toBe(true);
      expect(await convergent(m)).toBe(true);
      for (const client of m.clients)
        for (const other of m.clients)
          expect([...client.state.players.get(other.sessionId)!.inventory.values()].reduce((s, n) => s + n, 0)).toBe(1);
    } finally { await m.close(); }
  }, 180_000);

  it('8. só A compra: a carteira da SALA paga, o item é de A, e os quatro veem a tampa aberta', async () => {
    const m = await mesa(nextSeed());
    try {
      freeze(m.sim);
      m.sim.progression.credits = 300;
      const chest = HOME_CHESTS.find(c => c.id === 'supply-0')!;
      Object.assign(m.sim.players.get(m.clients[0]!.sessionId)!.motor.position, chest);
      const verdicts: { ok: boolean; cost: number }[] = [];
      m.clients[0]!.onMessage('purchaseResolved', (v: { ok: boolean; cost: number }) => { verdicts.push(v); });

      const antes = m.sim.progression.credits;
      m.clients[0]!.send('buyChest', { interactableId: chest.id, requestId: 'so-a' });
      expect(await until(() => verdicts.length > 0)).toBe(true);
      expect(verdicts[0]!.ok).toBe(true);
      expect(m.sim.progression.credits).toBe(antes - verdicts[0]!.cost);

      // A CARTEIRA É DA SALA (`ProgressionState.credits`), não de cada jogador: o débito é único e
      // aparece igual nas quatro telas. O que é de cada um é o INVENTÁRIO.
      expect([...m.sim.players.get(m.clients[0]!.sessionId)!.loadout.inventory.values()].reduce((s, n) => s + n, 0)).toBe(1);
      for (const i of [1, 2, 3]) expect([...m.sim.players.get(m.clients[i]!.sessionId)!.loadout.inventory.values()]).toHaveLength(0);

      expect(await until(() => m.clients.every(c => [...(c.state.usedChests ?? [])].includes(chest.id)))).toBe(true);
      expect(await until(() => m.clients.every(c => c.state.progression?.credits === m.sim.progression.credits))).toBe(true);
      expect(await convergent(m)).toBe(true);
    } finally { await m.close(); }
  }, 180_000);

  it('9. C cai: A, B e D continuam, a corrida continua e a IA para de considerar C', async () => {
    const m = await mesa(nextSeed());
    try {
      freeze(m.sim);
      for (const client of m.clients) { client.send('chooseClass', { classId: 'gunslinger' }); client.send('setReady', { ready: true }); }
      await wait(PAST_COUNTDOWN);
      expect(m.room.state.phase).toBe(PHASE.playing);

      const spots = spread(m);
      const c = m.clients[2]!, entidadeC = entityIdOf(m, 2);
      // Um corpo colado em C, para provar que ele DEIXA de ser alvo quando morre.
      expect(m.sim.enemies.spawn('eggplant', { x: spots[2]!.x + 2, y: spots[2]!.y, z: spots[2]!.z + 2 }, 'normal')).toBe(true);
      const caçador = m.sim.enemies.actor(m.sim.enemies.lastSpawnedId)!;

      const mortos: number[] = [];
      m.clients[0]!.onMessage('PlayerKilled', (payload: { victimId?: number }) => { mortos.push(Number(payload?.victimId ?? -1)); });
      hurt(m, 2, 10_000);

      expect(await until(() => m.room.state.players.get(c.sessionId)!.hp <= 0)).toBe(true);
      // Morto continua NA corrida (o schema não tem `alive` de jogador: vida zero é o estado).
      expect(m.room.state.players.get(c.sessionId)).toBeDefined();
      expect(m.room.state.playerCount).toBe(4);
      expect(m.room.state.phase).toBe(PHASE.playing);
      for (const i of [0, 1, 3]) expect(m.room.state.players.get(m.clients[i]!.sessionId)!.hp).toBeGreaterThan(0);
      expect(mortos).toContain(entidadeC);

      // O alvo de C é invalidado: um cadáver com as coordenadas certas não é alvo.
      expect(await until(() => caçador.targetPlayerId !== entidadeC)).toBe(true);
      for (let i = 0; i < 20; i++) {
        for (const enemy of m.room.state.enemies.values()) expect(enemy.targetPlayerId).not.toBe(entidadeC);
        await wait(50);
      }
      expect(await convergent(m)).toBe(true);
    } finally { await m.close(); }
  }, 180_000);

  it('13. D cai enquanto está sendo caçado: o alvo é reavaliado e NADA estoura', async () => {
    const m = await mesa(nextSeed());
    const erros: unknown[] = [];
    const onError = (e: unknown) => { erros.push(e); };
    process.on('uncaughtException', onError);
    process.on('unhandledRejection', onError);
    try {
      freeze(m.sim);
      await largar(m);
      const spots = spread(m);
      const d = m.clients[3]!, entidadeD = entityIdOf(m, 3);
      expect(m.sim.enemies.spawn('eggplant', { x: spots[3]!.x + 2, y: spots[3]!.y, z: spots[3]!.z + 2 }, 'normal')).toBe(true);
      const caçador = m.sim.enemies.actor(m.sim.enemies.lastSpawnedId)!;
      // O corpo tem de estar MESMO caçando D antes da queda, senão o caso não diz nada.
      expect(await until(() => caçador.targetPlayerId === entidadeD)).toBe(true);

      await d.leave();
      expect(await until(() => m.room.state.players.size === 3)).toBe(true);

      // O alvo some ou troca — nunca fica apontando para quem saiu da sala.
      expect(await until(() => caçador.targetPlayerId !== entidadeD)).toBe(true);
      const vivos = new Set([...m.room.state.players.values()].filter(p => p.hp > 0).map(p => p.entityId));
      for (let i = 0; i < 30; i++) {
        for (const enemy of m.room.state.enemies.values()) {
          expect(enemy.targetPlayerId).not.toBe(entidadeD);
          expect(enemy.targetPlayerId === 0 || vivos.has(enemy.targetPlayerId)).toBe(true);
        }
        await wait(50);
      }
      expect(erros).toEqual([]);
      // E os três que ficaram continuam com a mesma verdade nas três telas.
      expect(await until(() => m.clients.slice(0, 3).every(c => c.state.players.size === 3))).toBe(true);
    } finally {
      process.off('uncaughtException', onError);
      process.off('unhandledRejection', onError);
      await m.close();
    }
  }, 180_000);

  /**
   * A PORTA FECHA QUANDO A CORRIDA LARGA.
   *
   * Antes não fechava: `joinOrCreate` com a mesma semente entregava um desconhecido no meio do
   * estágio, sem itens e sem nível, numa mesa que não o convidou. A sala agora tranca ao largar.
   *
   * A recusa não é um erro na cara de quem procura: a sala trancada sai do emparelhamento, então
   * `joinOrCreate` devolve uma sala NOVA. É por isso que o caso afirma "outra sala", e não
   * "rejeitou" — quem quer jogar continua conseguindo jogar, só não por cima da corrida alheia.
   */
  it('14. entrada TARDIA com a corrida em PLAYING: a porta está trancada e o tardio ganha OUTRA sala', async () => {
    const seed = nextSeed();
    const m = await mesa(seed, 3, ['ANA', 'BENTO', 'CLARA']);
    let tardio: Espelho | undefined;
    try {
      freeze(m.sim);
      for (const client of m.clients) { client.send('chooseClass', { classId: 'gunslinger' }); client.send('setReady', { ready: true }); }
      await wait(PAST_COUNTDOWN);
      expect(m.room.state.phase).toBe(PHASE.playing);

      tardio = await colyseus.sdk.joinOrCreate<FarmState>('farm', { seed, name: 'DINO' });
      // Sala OUTRA: a corrida em curso não ganhou passageiro.
      expect(tardio.roomId).not.toBe(m.room.roomId);
      expect(m.room.state.playerCount).toBe(3);
      expect(m.room.state.phase).toBe(PHASE.playing);
      expect(m.room.state.players.size).toBe(3);
      // E entrar PELO ID da sala trancada é recusado de vez: não há porta lateral.
      await expect(colyseus.sdk.joinById(m.room.roomId, { seed })).rejects.toBeDefined();
    } finally { if (tardio) await tardio.leave(); await m.close(); }
  }, 180_000);

  /**
   * SAIR DE PROPÓSITO é definitivo: quem clica em SAIR abre mão do sobrevivente, e o inventário
   * morre com ele. NO LOBBY a vaga volta a ser ocupável — a sala ainda não largou, e é justamente
   * aí que um amigo entra no lugar de quem desistiu.
   *
   * Duas coisas que este caso NÃO cobre, e que vivem em outro lugar de propósito:
   *
   * - a QUEDA, em `tests/coop-reconnect`: lá a vaga é segurada por trinta segundos e a volta é a
   *   MESMA corrida, com o mesmo inventário. A diferença entre os dois é o código de fecho do
   *   WebSocket, e é ela que separa "eu quis sair" de "a internet caiu";
   * - a corrida JÁ LARGADA, no caso 14: aí a sala está trancada e ninguém entra por cima.
   */
  it('12. quem SAI de propósito perde o sobrevivente, e no LOBBY a vaga é reocupada por outro', async () => {
    const seed = nextSeed();
    const m = await mesa(seed);
    let volta: Espelho | undefined;
    try {
      freeze(m.sim);
      m.sim.progression.credits = 300;
      const chest = HOME_CHESTS.find(c => c.id === 'supply-0')!;
      const d = m.clients[3]!;
      Object.assign(m.sim.players.get(d.sessionId)!.motor.position, chest);
      m.sim.requestPurchase(d.sessionId, { interactableId: chest.id, requestId: 'antes-da-queda' });
      expect([...m.sim.players.get(d.sessionId)!.loadout.inventory.values()].reduce((s, n) => s + n, 0)).toBe(1);

      const idAntes = d.sessionId, entidadeAntes = entityIdOf(m, 3);
      // A sala ainda está no LOBBY: é isso que mantém a porta aberta para o substituto.
      expect(m.room.state.phase).toBe(PHASE.lobby);
      await d.leave();
      expect(await until(() => m.room.state.players.size === 3)).toBe(true);
      // Saída PEDIDA: `onLeave` apaga o jogador da simulação e do schema, e o inventário morre com
      // ele. Sem janela de volta — essa é só para a queda, e com a corrida em curso.
      expect(m.sim.players.get(idAntes)).toBeUndefined();

      volta = await colyseus.sdk.joinOrCreate<FarmState>('farm', { seed, name: 'DINO' });
      expect(await until(() => !!m.room.state.players.get(volta!.sessionId))).toBe(true);
      expect(volta!.roomId).toBe(m.room.roomId);                   // a MESMA sala: ela não largou
      expect(volta!.sessionId).not.toBe(idAntes);                  // sessão nova, sobrevivente novo
      expect(m.room.state.players.get(volta!.sessionId)!.entityId).toBe(entidadeAntes); // o buraco 1..4 é reaproveitado
      expect([...m.sim.players.get(volta!.sessionId)!.loadout.inventory.values()]).toHaveLength(0);
      expect(m.room.state.seed).toBe(m.sim.seed);
    } finally { if (volta) await volta.leave(); await m.close(); }
  }, 180_000);

  it('11. o estágio avança: os quatro aterrissam no mesmo número, com ids e inventários preservados', async () => {
    const m = await mesa(nextSeed());
    try {
      freeze(m.sim);
      m.sim.progression.credits = 300;
      const chest = HOME_CHESTS.find(c => c.id === 'supply-0')!;
      Object.assign(m.sim.players.get(m.clients[2]!.sessionId)!.motor.position, chest);
      m.sim.requestPurchase(m.clients[2]!.sessionId, { interactableId: chest.id, requestId: 'antes-do-estagio' });

      const idsAntes = m.clients.map((c, i) => `${c.sessionId}:${entityIdOf(m, i)}`);
      const estagioAntes = m.room.state.stage;
      const inventarioC = [...m.sim.players.get(m.clients[2]!.sessionId)!.loadout.inventory.entries()].sort();
      expect(inventarioC.length).toBe(1);

      // `RunProgression.advanceStage` é o avanço que EXISTE hoje (XP, carteira zerada, estágio + 1).
      // A sala não tem evento de estágio, nem viagem, nem ressurreição — ver o relatório do bloco.
      m.sim.progression.advanceStage();

      expect(await until(() => m.room.state.stage === estagioAntes + 1)).toBe(true);
      // Os quatro aterrissam no MESMO estágio, pela replicação — nenhuma tela o calcula.
      expect(await until(() => m.clients.every(c => c.state.stage === estagioAntes + 1))).toBe(true);
      expect(m.clients.map((c, i) => `${c.sessionId}:${entityIdOf(m, i)}`)).toEqual(idsAntes);
      // O inventário do sobrevivente atravessa a virada de estágio.
      expect([...m.sim.players.get(m.clients[2]!.sessionId)!.loadout.inventory.entries()].sort()).toEqual(inventarioC);
      expect(await convergent(m)).toBe(true);
    } finally { await m.close(); }
  }, 180_000);

  it('15. depois de cada passo, as quatro telas contam a MESMA história', async () => {
    const m = await mesa(nextSeed());
    try {
      freeze(m.sim);
      expect(await convergent(m)).toBe(true);                      // passo 0: a sala em repouso

      // Passo 1: um corpo em campo.
      const base = { ...m.sim.players.get(m.clients[0]!.sessionId)!.motor.position };
      expect(m.sim.enemies.spawn('eggplant', { x: base.x + 3, y: base.y, z: base.z + 3 }, 'normal')).toBe(true);
      const enemy = m.sim.enemies.actor(m.sim.enemies.lastSpawnedId)!;
      expect(await until(() => m.clients.every(c => !!c.state.enemies?.get(String(enemy.id))))).toBe(true);
      expect(await convergent(m)).toBe(true);

      // Passo 2: dano em dois jogadores diferentes.
      hurt(m, 1, 9); hurt(m, 3, 15);
      expect(await until(() => m.room.state.players.get(m.clients[3]!.sessionId)!.hp < m.room.state.players.get(m.clients[3]!.sessionId)!.maxHP)).toBe(true);
      expect(await convergent(m)).toBe(true);

      // Passo 3: uma compra (carteira da sala + inventário de um só).
      m.sim.progression.credits = 300;
      const chest = HOME_CHESTS.find(c => c.id === 'supply-0')!;
      Object.assign(m.sim.players.get(m.clients[1]!.sessionId)!.motor.position, chest);
      m.sim.requestPurchase(m.clients[1]!.sessionId, { interactableId: chest.id, requestId: 'divergencia' });
      expect(await until(() => m.clients.every(c => [...(c.state.usedChests ?? [])].includes(chest.id)))).toBe(true);
      expect(await convergent(m)).toBe(true);

      // Passo 4: a morte do corpo.
      m.sim.enemies.applyDamage(enemy.id, {
        attackerId: entityIdOf(m, 0), victimId: enemy.id, sourceId: 'qa', attackId: 'qa',
        baseDamage: enemy.health.maximum * 10, finalDamage: enemy.health.maximum * 10, crit: false,
        procCoefficient: 0, procChainDepth: 0, damageTags: ['qa'],
        hitPosition: { ...enemy.position }, hitNormal: { x: 0, y: 1, z: 0 },
        forceDirection: { x: 0, y: 0, z: 1 }, forceMagnitude: 0,
      });
      expect(await until(() => m.clients.every(c => c.state.enemies?.get(String(enemy.id))?.alive === false))).toBe(true);
      expect(await convergent(m)).toBe(true);

      // A prova por jogador: cada tela lê a vida e o inventário dos QUATRO, não só os seus.
      for (const view of m.clients) {
        for (const [i, owner] of m.clients.entries()) {
          const seen = view.state.players.get(owner.sessionId)!;
          const authoritative = m.room.state.players.get(owner.sessionId)!;
          expect(seen.entityId).toBe(authoritative.entityId);
          expect(seen.hp).toBeCloseTo(authoritative.hp, 2);
          expect([...seen.inventory.entries()].sort()).toEqual([...authoritative.inventory.entries()].sort());
          void i;
        }
      }
    } finally { await m.close(); }
  }, 240_000);
});
