import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'colyseus';
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { FarmRoom } from '../server/rooms/FarmRoom';
import type { FarmState } from '../server/schema';
import type { FarmSimulation } from '../server/FarmSimulation';
import { NetworkClient, type PurchaseVerdict } from '../src/net/NetworkClient';
import { EconomyMirror } from '../src/run/RunEconomy';
import { RunInteractables } from '../src/run/RunInteractables';
import { RunProgression } from '../src/run/RunProgression';
import { CollisionWorld } from '../src/physics/CollisionWorld';
import { PlayerMotor } from '../src/player/PlayerMotor';
import { EventBus } from '../src/core/EventBus';
import { RunRNG } from '../src/core/RunRNG';
import type { GameEvents } from '../src/core/contracts';
import { HOME_CHESTS, chestPrice } from '../src/run/ChestCatalog';

/**
 * A ECONOMIA ATRAVESSA A REDE COMO INTENÇÃO E VOLTA COMO ESTADO (contrato §21.6).
 *
 * Os dois casos do contrato, com sala de verdade dos dois lados: o caminho feliz, em que o cliente
 * exibe o saldo do servidor e a compra é resolvida lá; e o caminho hostil, em que o espelho do
 * cliente está ATRASADO e mesmo assim não autoriza nada.
 *
 * O ponto que os dois travam não é "o saldo aparece": é que NENHUM crédito é debitado no cliente e
 * NENHUM item é sorteado no cliente. Até o bloco F `FarmRoom:193` publicava a carteira e não havia
 * leitor nenhum — o saldo era calculado, transportado e ignorado, enquanto `RunInteractables`
 * decidia a compra contra uma carteira que ninguém pagava.
 */
let colyseus: ColyseusTestServer;
beforeAll(async () => {
  // Porta sorteada — ver `tests/net-room.test.ts`: porta fixa pendura o `beforeAll` e PULA os casos.
  colyseus = await boot<any>({
    initializeGameServer: (gameServer: Server) => { gameServer.define('farm', FarmRoom); },
  }, 20000 + Math.floor(Math.random() * 30000));
}, 60_000);
afterAll(async () => { await colyseus?.shutdown(); });

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
async function until(condition: () => boolean, attempts = 200): Promise<boolean> {
  for (let i = 0; i < attempts; i++) { if (condition()) return true; await wait(25); }
  return false;
}
async function untilPlayer(room: FarmRoom, sessionId: string): Promise<void> {
  for (let i = 0; i < 100; i++) { if (room.state.players.get(sessionId)) return; await wait(50); }
  throw new Error(`jogador ${sessionId} não entrou no estado`);
}

/** A caixa de suprimentos autoral: 30 créditos no estágio 1, que é o número do contrato §21.6. */
const CHEST = HOME_CHESTS.find(c => c.id === 'supply-0')!;

/**
 * O CLIENTE, do jeito que ele existe em produção — sem Babylon inventado à mão.
 *
 * `NetworkClient` é o leitor real do schema (`economy()`), `EconomyMirror` é o objeto de
 * apresentação real, e `RunInteractables` é a classe que até ontem debitava a carteira sozinha. O
 * `RunProgression` local entra com saldo ZERO de propósito: se alguma linha do cliente voltasse a
 * decidir a compra, ela decidiria contra esse zero e o caso morreria na hora.
 */
function client(room: unknown) {
  const engine = new NullEngine(), scene = new Scene(engine), events = new EventBus<GameEvents>();
  const world = new CollisionWorld();
  world.surfaces.push({ id: 'test-floor', x: 0, z: 0, width: 200, depth: 200, height: 0 });
  const player = new PlayerMotor(world, events, { x: CHEST.x, y: CHEST.y, z: CHEST.z });
  const run = new RunProgression(events);
  run.credits = 0;
  const net = new NetworkClient('', '');
  (net as unknown as { room: unknown }).room = room;
  const mirror = new EconomyMirror();
  const chest = new RunInteractables(scene, player, run, events, new RunRNG('coop-economy').stream('interactable'), world);
  chest.attachAuthority({ request: (id, requestId) => net.buyChest(id, requestId) });
  chest.update(0, false);
  return {
    scene, events, world, player, run, net, mirror, chest,
    /** Uma adoção do saldo autoritativo. É a ÚNICA escrita de economia do lado do cliente. */
    sync() { this.mirror.adopt(this.net.economy()); },
    close() { chest.dispose(); scene.dispose(); engine.dispose(); },
  };
}

describe('economia autoritativa: o cliente exibe, o servidor decide', () => {
  it('caminho feliz: 100 replicados, compra de 30 resolvida no servidor, 70 nas duas pontas', async () => {
    const a = await colyseus.sdk.joinOrCreate<FarmState>('farm', { seed: 'economy-happy' });
    const room = colyseus.getRoomById<FarmRoom>(a.roomId);
    await untilPlayer(room, a.sessionId);
    const sim = room['sim'] as FarmSimulation;
    // A horda parada: um abate espontâneo pagaria recompensa no meio do caso e mexeria no saldo.
    sim.enemies.director.stopped = true;
    // A carteira AUTORITATIVA começa em 100; o espelho do cliente, em 0.
    sim.progression.credits = 100;
    // O jogador, no servidor, encostado no baú: a distância é validada lá, não aqui.
    Object.assign(sim.players.get(a.sessionId)!.motor.position, CHEST);

    const f = client(a);
    try {
      expect(f.mirror.adopted).toBe(false);
      expect(f.mirror.credits).toBe(0);

      // 1. REPLICA 100 → o cliente EXIBE 100 sem nunca ter somado um crédito.
      expect(await until(() => { f.sync(); return f.mirror.credits === 100; })).toBe(true);
      expect(f.run.credits).toBe(0);

      const verdicts: PurchaseVerdict[] = [];
      f.net.onPurchaseResolved(v => verdicts.push(v));

      // 2. O cliente TENTA comprar. `buy()` devolve `true` porque o pedido saiu — não porque a
      //    compra aconteceu. O custo é do servidor.
      const cost = chestPrice('supply', 1, 0, 0);
      expect(cost).toBe(30);
      expect(f.chest.nearest?.id).toBe(CHEST.id);
      expect(f.chest.buy()).toBe(true);
      expect(f.chest.sentRequests).toBe(1);

      // 3. O servidor aceita, debita e publica 70.
      expect(await until(() => verdicts.length > 0)).toBe(true);
      expect(verdicts).toHaveLength(1);
      const verdict = verdicts[0]!;
      expect(verdict.ok).toBe(true);
      expect(verdict.cost).toBe(30);
      expect(sim.progression.credits).toBe(70);

      // 4. O cliente CONVERGE para 70 — adotando, nunca subtraindo.
      expect(await until(() => { f.sync(); return f.mirror.credits === 70; })).toBe(true);

      // As assertivas do §21.6, uma a uma.
      expect(f.run.credits).toBe(0);                         // o cliente nunca debitou localmente
      expect(sim.chests.purchases).toBe(1);                  // exatamente uma compra
      expect(f.mirror.purchases).toBe(1);
      const inventory = sim.players.get(a.sessionId)!.loadout.inventory;
      expect([...inventory.values()].reduce((s, n) => s + n, 0)).toBe(1); // exatamente uma recompensa
      expect(sim.progression.credits).toBe(70);              // saldo autoritativo
      expect(f.mirror.credits).toBe(70);                     // saldo exibido

      // E o baú fica consumido para TODA a sala, não só para quem clicou.
      expect(await until(() => [...a.state.usedChests].includes(CHEST.id))).toBe(true);

      // A apresentação do veredito não recalcula nada: ela abre a tampa com o item que veio.
      f.chest.adoptPurchase(verdict);
      expect(f.chest.entries.find(e => e.id === CHEST.id)!.used).toBe(true);
      expect(f.run.credits).toBe(0);
    } finally { f.close(); await a.leave(); }
  }, 120_000);

  it('caminho hostil: espelho atrasado em 100 contra servidor em 20 não compra nada', async () => {
    const a = await colyseus.sdk.joinOrCreate<FarmState>('farm', { seed: 'economy-hostile' });
    const room = colyseus.getRoomById<FarmRoom>(a.roomId);
    await untilPlayer(room, a.sessionId);
    const sim = room['sim'] as FarmSimulation;
    sim.enemies.director.stopped = true;
    sim.progression.credits = 100;
    Object.assign(sim.players.get(a.sessionId)!.motor.position, CHEST);

    const f = client(a);
    try {
      expect(await until(() => { f.sync(); return f.mirror.credits === 100; })).toBe(true);
      // O SERVIDOR ANDOU e o cliente não adota mais: é exatamente o espelho atrasado do §21.6 — um
      // companheiro gastou, um item custou, a rede atrasou. A tela continua dizendo 100.
      sim.progression.credits = 20;
      expect(f.mirror.credits).toBe(100);

      const verdicts: PurchaseVerdict[] = [];
      f.net.onPurchaseResolved(v => verdicts.push(v));

      // O cliente tenta, com o saldo velho na mão. Se o `if (credits < cost)` vivesse aqui, ele
      // AUTORIZARIA a compra — e é por isso que ele não vive aqui.
      expect(f.chest.buy()).toBe(true);
      expect(await until(() => verdicts.length > 0)).toBe(true);
      expect(verdicts).toHaveLength(1);
      expect(verdicts[0]!.ok).toBe(false);
      expect(verdicts[0]!.reason).toBe('credits');
      expect(verdicts[0]!.item).toBeUndefined();

      // Nenhum débito, nenhum item, nenhuma compra.
      expect(sim.progression.credits).toBe(20);
      expect(sim.chests.purchases).toBe(0);
      expect(sim.chests.get(CHEST.id)!.used).toBe(false);
      expect([...sim.players.get(a.sessionId)!.loadout.inventory.values()]).toHaveLength(0);
      expect(f.run.credits).toBe(0);

      // E o cliente CONVERGE para 20: a recusa não é um estado à parte, é a verdade chegando.
      expect(await until(() => { f.sync(); return f.mirror.credits === 20; })).toBe(true);

      // A apresentação da recusa não abre baú nenhum.
      f.chest.adoptPurchase(verdicts[0]!);
      expect(f.chest.entries.find(e => e.id === CHEST.id)!.used).toBe(false);
    } finally { f.close(); await a.leave(); }
  }, 120_000);

  it('o mesmo pedido chegando duas vezes cobra uma vez só', async () => {
    const a = await colyseus.sdk.joinOrCreate<FarmState>('farm', { seed: 'economy-replay' });
    const room = colyseus.getRoomById<FarmRoom>(a.roomId);
    await untilPlayer(room, a.sessionId);
    const sim = room['sim'] as FarmSimulation;
    sim.enemies.director.stopped = true;
    sim.progression.credits = 100;
    Object.assign(sim.players.get(a.sessionId)!.motor.position, CHEST);

    const first = sim.requestPurchase(a.sessionId, { interactableId: CHEST.id, requestId: 'r1' })!;
    const again = sim.requestPurchase(a.sessionId, { interactableId: CHEST.id, requestId: 'r1' })!;
    expect(first.ok).toBe(true);
    expect(again.ok).toBe(false);
    expect(again.reason).toBe('replay');
    // Um débito, uma compra, uma recompensa — por mais vezes que o pacote chegue.
    expect(sim.progression.credits).toBe(70);
    expect(sim.chests.purchases).toBe(1);
    expect([...sim.players.get(a.sessionId)!.loadout.inventory.values()].reduce((s, n) => s + n, 0)).toBe(1);

    await a.leave();
  }, 120_000);

  it('recusa por distância: o baú do outro lado do mapa não é comprável de longe', async () => {
    const a = await colyseus.sdk.joinOrCreate<FarmState>('farm', { seed: 'economy-range' });
    const room = colyseus.getRoomById<FarmRoom>(a.roomId);
    await untilPlayer(room, a.sessionId);
    const sim = room['sim'] as FarmSimulation;
    sim.enemies.director.stopped = true;
    sim.progression.credits = 500;
    Object.assign(sim.players.get(a.sessionId)!.motor.position, { x: CHEST.x + 40, y: CHEST.y, z: CHEST.z });

    const result = sim.requestPurchase(a.sessionId, { interactableId: CHEST.id, requestId: 'far' })!;
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('range');
    expect(sim.progression.credits).toBe(500);
    // Baú inexistente também não move nada: id forjado é recusa, não exceção.
    expect(sim.requestPurchase(a.sessionId, { interactableId: 'baú-do-além', requestId: 'x' })!.reason).toBe('unknown-chest');
    expect(sim.chests.purchases).toBe(0);

    await a.leave();
  }, 120_000);
});
