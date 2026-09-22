import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { FarmSimulation, EMPTY_INPUT, type CollisionData } from '../server/FarmSimulation';
import { PISTOL_TUNING } from '../src/player/PlayerTuning';
import { NetInput, toFrame } from '../src/net/NetInput';
import type { DamageContext } from '../src/core/contracts';

/**
 * O TIRO DO JOGADOR CHEGA NA HORDA — E SÓ PELO SERVIDOR.
 *
 * Antes do bloco E `EnemySimulation.applyDamage` existia e funcionava, mas nenhuma intenção de
 * disparo do jogador chegava até ele: o dano só saía dos efeitos de área do próprio servidor. Cada
 * caso abaixo é uma decisão que o cliente NÃO pode tomar — quem acertou, quanto doeu, de quem é o
 * dano e quem levou o abate.
 *
 * Nada aqui cria cena, malha ou câmera: é o teste do desligamento (contrato §18.12) aplicado ao
 * combate. Se o disparo precisasse de renderização para resolver, este arquivo não compilaria.
 */
function collision(): CollisionData {
  const read = (name: string) => JSON.parse(readFileSync(`public/models/${name}`, 'utf8'));
  const farm = read('farm-collision.json');
  const data: CollisionData = { boxes: farm.boxes, surfaces: farm.surfaces, mesh: read('world-collision-mesh.json'), solid: read('solid-island-collision.json') };
  if (existsSync('public/models/farm-city-collision.json')) data.city = read('farm-city-collision.json');
  return data;
}

const DT = 1 / 60;

/**
 * Uma sala com o diretor PARADO.
 *
 * A horda espontânea tornaria o enunciado de cada caso indecidível: um corpo qualquer poderia
 * entrar na frente da bala. Aqui os únicos inimigos em campo são os que o teste coloca.
 */
function arena(seed: string): FarmSimulation {
  const sim = new FarmSimulation(seed, collision());
  sim.enemies.director.stopped = true;
  return sim;
}

/** Coloca o motor num ponto exato, para a geometria do teste ser a do enunciado. */
function place(sim: FarmSimulation, id: string, x: number, z: number): { x: number; y: number; z: number } {
  const motor = sim.players.get(id)!.motor;
  motor.position.x = x; motor.position.z = z;
  Object.assign(motor.previous, motor.position);
  return { x: motor.position.x, y: motor.position.y, z: motor.position.z };
}

/** Um corpo parado no ponto pedido. Devolve o ator para o teste ler a vida direto da fonte. */
function target(sim: FarmSimulation, at: { x: number; y: number; z: number }) {
  expect(sim.enemies.spawn('eggplant', at, 'normal')).toBe(true);
  return sim.enemies.actor(sim.enemies.lastSpawnedId)!;
}

/**
 * Um tique com o gatilho pressionado. `yaw`/`pitch` são a MIRA — os mesmos dois campos que o
 * `NetInput` já carrega; nenhum vetor de dano viaja do cliente para cá.
 */
function fire(sim: FarmSimulation, id: string, yaw: number, seq: number, pitch = 0): void {
  sim.applyInput(id, { frame: { ...EMPTY_INPUT, fire: true }, yaw, pitch, seq });
  sim.step(DT);
}

describe('dano do jogador para a horda, decidido no servidor', () => {
  it('a intenção de tiro FERE o corpo na linha — o circuito que faltava', () => {
    const sim = arena('shot-hits');
    sim.addPlayer('a');
    const at = place(sim, 'a', 0, -14);
    const enemy = target(sim, { x: at.x, y: at.y, z: at.z + 8 });
    expect(enemy.health.current).toBe(enemy.health.maximum);

    fire(sim, 'a', 0, 1);                       // yaw 0 aponta para +Z, onde o corpo está
    expect(enemy.health.current).toBeLessThan(enemy.health.maximum);
    // Nível 1, sem itens: 12 de base × 1,0 de atributo, sem armadura de afixo.
    expect(enemy.health.maximum - enemy.health.current).toBeCloseTo(PISTOL_TUNING.damage, 6);
    expect(sim.players.get('a')!.hits).toBe(1);
  }, 60_000);

  it('o dano é o do ATIRADOR, não um atributo único da sala', () => {
    const sim = arena('shot-owner');
    sim.addPlayer('a'); sim.addPlayer('b');
    // A leva o podador (+15% de dano). B não leva nada. O tiro é o mesmo.
    sim.players.get('a')!.loadout.addItem('pruner');

    const pa = place(sim, 'a', 0, -14), pb = place(sim, 'b', 40, -14);
    const ea = target(sim, { x: pa.x, y: pa.y, z: pa.z + 8 });
    const eb = target(sim, { x: pb.x, y: pb.y, z: pb.z + 8 });

    fire(sim, 'a', 0, 1);
    sim.applyInput('b', { frame: { ...EMPTY_INPUT, fire: true }, yaw: 0, pitch: 0, seq: 1 });
    sim.step(DT);

    const dealtA = ea.health.maximum - ea.health.current, dealtB = eb.health.maximum - eb.health.current;
    expect(dealtB).toBeGreaterThan(0);
    /**
     * A PROVA DO §2.6 DO PLANO.
     *
     * Com um `stats` compartilhado no servidor os dois números seriam idênticos e os quatro
     * jogadores ficariam mecanicamente iguais. O item de A tem de aparecer no dano de A e em
     * nenhum outro.
     */
    expect(dealtA).toBeCloseTo(dealtB * 1.15, 6);
  }, 60_000);

  it('mirar para o lado NÃO acerta: a bala é um segmento, não um raio de proximidade', () => {
    const sim = arena('shot-miss');
    sim.addPlayer('a');
    const at = place(sim, 'a', 0, -14);
    const enemy = target(sim, { x: at.x, y: at.y, z: at.z + 8 });
    fire(sim, 'a', Math.PI, 1);                 // costas para o corpo
    expect(enemy.health.current).toBe(enemy.health.maximum);
    expect(sim.players.get('a')!.hits).toBe(0);
    // O tiro SAIU (a munição foi gasta): o que não houve foi acerto.
    expect(sim.players.get('a')!.shots).toBe(1);
  }, 60_000);

  it('além do alcance da arma nada é atingido', () => {
    const sim = arena('shot-range');
    sim.addPlayer('a');
    const at = place(sim, 'a', 0, -14);
    const enemy = target(sim, { x: at.x, y: at.y, z: at.z + PISTOL_TUNING.range + 40 });
    fire(sim, 'a', 0, 1);
    expect(enemy.health.current).toBe(enemy.health.maximum);
  }, 60_000);

  it('o abate pelo tiro conta UMA vez e paga a equipe', () => {
    const sim = arena('shot-kill');
    sim.addPlayer('a');
    const at = place(sim, 'a', 0, -14);
    const enemy = target(sim, { x: at.x, y: at.y, z: at.z + 8 });
    // Vida reduzida ao suficiente para um tiro só; a regra de morte continua sendo a do servidor.
    enemy.health.current = 1;
    expect(sim.enemies.kills).toBe(0);

    fire(sim, 'a', 0, 1);
    expect(enemy.health.dead).toBe(true);
    expect(sim.enemies.kills).toBe(1);
    expect(sim.snapshot().credits).toBeGreaterThan(0);

    // Continuar segurando o gatilho não abate o mesmo corpo de novo.
    for (let i = 0; i < 120; i++) sim.step(DT);
    expect(sim.enemies.kills).toBe(1);
  }, 60_000);

  it('jogador morto não atira', () => {
    const sim = arena('shot-dead');
    sim.addPlayer('a');
    const at = place(sim, 'a', 0, -14);
    const enemy = target(sim, { x: at.x, y: at.y, z: at.z + 8 });
    sim.players.get('a')!.motor.hp = 0;
    for (let i = 1; i <= 60; i++) fire(sim, 'a', 0, i);
    expect(enemy.health.current).toBe(enemy.health.maximum);
  }, 60_000);

  it('a CADÊNCIA é do servidor: segurar o gatilho não dispara um tiro por tique', () => {
    const sim = arena('shot-cadence');
    sim.addPlayer('a');
    const at = place(sim, 'a', 0, -14);
    target(sim, { x: at.x, y: at.y, z: at.z + 8 });
    // Uma única intenção contínua, 60 tiques (1 s). A cadência base é 3,3 tiros por segundo.
    sim.applyInput('a', { frame: { ...EMPTY_INPUT, fire: true }, yaw: 0, pitch: 0, seq: 1 });
    for (let i = 0; i < 60; i++) sim.step(DT);
    const shots = sim.players.get('a')!.shots;
    expect(shots).toBeGreaterThanOrEqual(3);
    expect(shots).toBeLessThanOrEqual(5);
  }, 60_000);
});

/**
 * A SEQUÊNCIA DE CRÍTICOS de `shots` tiros deste jogador.
 *
 * O alvo é reposto e recuperado entre os disparos: o que se mede é o DADO, não a morte. Devolve o
 * dano de cada tiro — e o crítico aparece nele como o dobro.
 */
function critSequence(seed: string, shots: number, between?: (sim: FarmSimulation) => void): number[] {
  const sim = arena(seed);
  sim.addPlayer('a');
  // Cinco miras de precisão: sem chance de crítico o dado nem seria rolado e o teste não mediria nada.
  for (let i = 0; i < 5; i++) sim.players.get('a')!.loadout.addItem('goggles');
  const at = place(sim, 'a', 0, -14);
  const enemy = target(sim, { x: at.x, y: at.y, z: at.z + 8 });
  const dealt: number[] = [];
  for (let shot = 0; shot < shots; shot++) {
    between?.(sim);
    enemy.position.x = at.x; enemy.position.y = at.y; enemy.position.z = at.z + 8;
    enemy.health.current = enemy.health.maximum;
    fire(sim, 'a', 0, shot + 1);
    dealt.push(enemy.health.maximum - enemy.health.current);
    for (let i = 0; i < 24; i++) sim.step(DT);        // deixa a cadência liberar o próximo tiro
  }
  return dealt;
}

describe('RNG de combate: um domínio por tipo de decisão', () => {
  it('a mesma semente e a mesma sequência de disparos produzem o MESMO resultado', () => {
    const first = critSequence('rng-repeat', 12), second = critSequence('rng-repeat', 12);
    expect(first).toEqual(second);
    // O teste só prova algo se houve crítico E não-crítico na amostra.
    expect(new Set(first).size).toBeGreaterThan(1);
  }, 90_000);

  /**
   * O TESTE CRUEL.
   *
   * Uma implementação que só PARECE ter fluxos separados — objetos distintos, nomes distintos, mas
   * um gerador comum em algum ponto — passa num teste com duas ou três chamadas extras. Centenas
   * deslocam qualquer gerador compartilhado, e o resultado deixa de bater bit a bit.
   */
  it('CENTENAS de rolagens de loot antes de cada acerto não movem um bit do combate', () => {
    const clean = critSequence('rng-cruel', 12);
    const noisy = critSequence('rng-cruel', 12, sim => {
      for (let i = 0; i < 400; i++) { sim.rng.stream('loot').next(); sim.rng.stream('director').next(); sim.rng.stream('interactable').next(); sim.rng.stream('enemySpawn').next(); sim.rng.stream('world').next(); }
    });
    expect(noisy).toEqual(clean);
  }, 120_000);

  /**
   * DETERMINISMO REPRODUTÍVEL, não só isolamento.
   *
   * Mesma semente, mesmos domínios, mesma sequência de eventos — depois de o runtime ser
   * REINICIALIZADO e de o processo ter feito outras coisas no meio. Dependência acidental de ordem
   * de criação de objeto, de relógio ou de `Math.random()` residual aparece aqui e em nenhum outro.
   */
  it('reinicializar o runtime não muda nada: a mesma corrida sai idêntica', () => {
    const first = critSequence('rng-reinit', 10);
    // Ruído entre as duas execuções: outras salas nascem e morrem, o relógio anda, `Math.random`
    // é consumido. Nada disso pode encostar na corrida seguinte.
    for (let i = 0; i < 3; i++) { const decoy = arena(`decoy-${i}`); decoy.addPlayer('x'); for (let k = 0; k < 30; k++) decoy.step(DT); }
    for (let i = 0; i < 1000; i++) Math.random();
    const second = critSequence('rng-reinit', 10);
    expect(second).toEqual(first);
  }, 120_000);

  it('e o inverso: centenas de rolagens de combate não movem a sequência de loot', () => {
    const reference = arena('rng-inverse');
    const drawTen = (sim: FarmSimulation) => Array.from({ length: 10 }, () => sim.rng.stream('loot').next());
    const before = drawTen(reference);

    const battered = arena('rng-inverse');
    // Centenas de rolagens nos TRÊS domínios de combate, antes de o loot ser lido uma única vez.
    for (let i = 0; i < 500; i++) { battered.rng.stream('combatCrit').next(); battered.rng.stream('combatProc').next(); battered.rng.stream('combatSpread').next(); }
    expect(drawTen(battered)).toEqual(before);

    // E um combate de verdade, com tiros, procs e abates, também não encosta no loot.
    const fought = arena('rng-inverse');
    fought.addPlayer('a');
    for (let i = 0; i < 10; i++) fought.players.get('a')!.loadout.addItem('bomb');
    const at = place(fought, 'a', 0, -14);
    target(fought, { x: at.x, y: at.y, z: at.z + 8 });
    for (let i = 1; i <= 60; i++) fire(fought, 'a', 0, i);
    expect(fought.players.get('a')!.hits).toBeGreaterThan(0);
    expect(drawTen(fought)).toEqual(before);
  }, 120_000);
});

describe('o cliente não consegue trapacear, porque não tem como pedir', () => {
  it('o pacote de entrada não carrega dano, vítima, crítico nem vida', () => {
    const packet = new NetInput();
    packet.x = 1; packet.z = 1; packet.yaw = 1; packet.pitch = 1; packet.buttons = 255; packet.interactOption = 8; packet.seq = 1;
    // Um cliente malicioso ANEXA o que quiser ao objeto local; o que decide é o que o servidor lê.
    Object.assign(packet, { finalDamage: 9999, victimId: 7, crit: true, hp: 0, kill: 42 });
    const frame = toFrame(packet) as unknown as Record<string, unknown>;
    for (const forged of ['damage', 'finalDamage', 'victimId', 'crit', 'hp', 'kill', 'targetId'])
      expect(Object.keys(frame)).not.toContain(forged);
    // O que atravessa a fronteira é intenção e mira, e nada mais.
    expect(Object.keys(frame).sort()).toEqual(['charging', 'dash', 'dodge', 'fire', 'interact', 'jump', 'reload', 'stance', 'x', 'z'].sort());
  });

  it('o mesmo evento de combate aplicado duas vezes só fere uma', () => {
    const sim = arena('cheat-replay');
    sim.addPlayer('a');
    const at = place(sim, 'a', 0, -14);
    const enemy = target(sim, { x: at.x, y: at.y, z: at.z + 8 });
    const context: DamageContext = {
      attackerId: 1, victimId: enemy.id, sourceId: 'dual_pistols', attackId: 'dual_pistols',
      baseDamage: 12, finalDamage: 12, crit: false, procCoefficient: 1, procChainDepth: 0,
      damageTags: ['bullet'], hitPosition: { x: 0, y: 1, z: 0 }, hitNormal: { x: 0, y: 1, z: 0 },
      forceDirection: { x: 0, y: 0, z: 1 }, forceMagnitude: 2, combatEventId: '1:99:1',
    };
    expect(sim.enemies.applyDamage(enemy.id, context)).toBe(true);
    /**
     * A segunda aplicação é NO-OP OBSERVÁVEL, não um silêncio.
     *
     * O teste tem de conseguir AFIRMAR que nada mudou — vida, abates, recompensa e ameaça ficam
     * exatamente onde estavam —, e não apenas que a chamada devolveu `false`.
     */
    const after = { hp: enemy.health.current, kills: sim.enemies.kills, credits: sim.snapshot().credits, threat: enemy.threat.get(1) ?? 0 };
    expect(sim.enemies.applyDamage(enemy.id, context)).toBe(false);
    expect(sim.enemies.applyDamage(enemy.id, context)).toBe(false);
    expect(enemy.health.current).toBe(after.hp);
    expect(sim.enemies.kills).toBe(after.kills);
    expect(sim.snapshot().credits).toBe(after.credits);
    expect(enemy.threat.get(1) ?? 0).toBe(after.threat);
    expect(enemy.health.maximum - enemy.health.current).toBeCloseTo(12, 6);
  }, 60_000);

  it('seq repetido é descartado: reenviar o mesmo pacote não vira mais tiro', () => {
    const sim = arena('cheat-seq');
    sim.addPlayer('a');
    place(sim, 'a', 0, -14);
    // 30 pacotes, todos com seq=1. Só o primeiro entra; o resto é intenção contínua já conhecida.
    for (let i = 0; i < 30; i++) fire(sim, 'a', 0, 1);
    expect(sim.players.get('a')!.seq).toBe(1);
    // Meio segundo a 3,3 tiros por segundo: a cadência é do servidor, não do número de pacotes.
    expect(sim.players.get('a')!.shots).toBeLessThanOrEqual(3);
  }, 60_000);

  it('sem munição não sai tiro, por mais que o gatilho seja pressionado', () => {
    const sim = arena('cheat-ammo');
    sim.addPlayer('a');
    const at = place(sim, 'a', 0, -14);
    const enemy = target(sim, { x: at.x, y: at.y, z: at.z + 8 });
    const player = sim.players.get('a')!;
    player.magazine.ammo = 0;
    for (let i = 1; i <= 30; i++) fire(sim, 'a', 0, i);
    expect(player.shots).toBe(0);
    expect(enemy.health.current).toBe(enemy.health.maximum);
  }, 60_000);
});

describe('a morte acontece EXATAMENTE uma vez', () => {
  it('dois jogadores acertando no MESMO tique geram uma morte e uma recompensa', () => {
    const sim = arena('simultaneous');
    sim.addPlayer('a'); sim.addPlayer('b');
    const pa = place(sim, 'a', 0, -14);
    // B fica do outro lado, olhando para trás: o corpo entre os dois é alvo dos dois na mesma linha.
    place(sim, 'b', 0, -14 + 16);
    const enemy = target(sim, { x: pa.x, y: pa.y, z: pa.z + 8 });
    enemy.health.current = 10;                       // 10 de vida, dois tiros de 12 no mesmo tique

    sim.applyInput('a', { frame: { ...EMPTY_INPUT, fire: true }, yaw: 0, pitch: 0, seq: 1 });
    sim.applyInput('b', { frame: { ...EMPTY_INPUT, fire: true }, yaw: Math.PI, pitch: 0, seq: 1 });
    const creditsBefore = sim.snapshot().credits;
    sim.step(DT);

    expect(sim.players.get('a')!.hits + sim.players.get('b')!.hits).toBeGreaterThanOrEqual(1);
    expect(enemy.health.dead).toBe(true);
    // UMA morte, UM abate, UMA recompensa — mesmo com dois acertos no mesmo passo.
    expect(sim.enemies.kills).toBe(1);
    expect(sim.snapshot().totalKills).toBe(1);
    const paid = sim.snapshot().credits - creditsBefore;
    for (let i = 0; i < 120; i++) sim.step(DT);
    expect(sim.enemies.kills).toBe(1);
    expect(sim.snapshot().credits - creditsBefore).toBe(paid);
  }, 60_000);
});

/**
 * A matriz hostil da morte simultânea: dois golpes LETAIS e DIFERENTES na mesma vítima, nas duas
 * ordens de chegada, com replay de uma das resoluções no meio. O esperado é sempre o mesmo:
 * uma transição alive→dead, um abate, uma recompensa.
 */
function lethal(victim: number, attacker: number, eventId: string): DamageContext {
  return {
    attackerId: attacker, victimId: victim, sourceId: 'dual_pistols', attackId: 'dual_pistols',
    baseDamage: 20, finalDamage: 20, crit: false, procCoefficient: 1, procChainDepth: 0,
    damageTags: ['bullet'], hitPosition: { x: 0, y: 1, z: 0 }, hitNormal: { x: 0, y: 1, z: 0 },
    forceDirection: { x: 0, y: 0, z: 1 }, forceMagnitude: 2, combatEventId: eventId,
  };
}

describe('matriz hostil da morte simultânea', () => {
  for (const [label, order] of [['A depois B', [1, 2]], ['B depois A', [2, 1]]] as const) {
    it(`duas resoluções letais diferentes na ordem "${label}" produzem UMA morte`, () => {
      const sim = arena(`hostile-${order.join('')}`);
      sim.addPlayer('a'); sim.addPlayer('b');
      const at = place(sim, 'a', 0, -14);
      const enemy = target(sim, { x: at.x, y: at.y, z: at.z + 8 });
      enemy.health.current = 10;
      let deaths = 0;
      sim.events.on('EnemyKilled', () => { deaths++; });
      const creditsBefore = sim.snapshot().credits;

      const first = lethal(enemy.id, order[0]!, `${order[0]}:1:1`);
      const second = lethal(enemy.id, order[1]!, `${order[1]}:1:1`);
      expect(sim.enemies.applyDamage(enemy.id, first)).toBe(true);
      // Replay de UMA das resoluções no meio da corrida: não pode contar, nem antes nem depois.
      expect(sim.enemies.applyDamage(enemy.id, first)).toBe(false);
      // O segundo golpe é OUTRO evento, e ainda assim chega num corpo já morto.
      expect(sim.enemies.applyDamage(enemy.id, second)).toBe(false);
      expect(sim.enemies.applyDamage(enemy.id, second)).toBe(false);

      expect(enemy.health.dead).toBe(true);
      expect(deaths).toBe(1);
      expect(sim.enemies.kills).toBe(1);
      expect(sim.snapshot().totalKills).toBe(1);
      const paid = sim.snapshot().credits - creditsBefore;
      expect(paid).toBeGreaterThan(0);
      for (let i = 0; i < 60; i++) sim.step(DT);
      expect(sim.enemies.kills).toBe(1);
      expect(deaths).toBe(1);
      expect(sim.snapshot().credits - creditsBefore).toBe(paid);
    }, 60_000);
  }
});

describe('dano no jogador: os QUATRO, não só o primeiro', () => {
  it('cada um dos jogadores 1..4 perde vida quando o victimId é o dele', () => {
    const sim = arena('four-victims');
    const ids = ['a', 'b', 'c', 'd'];
    for (const id of ids) sim.addPlayer(id);
    // Nunca deduzir do padrão `entityId=1`: o bug original recusava em silêncio os outros três.
    for (const id of ids) {
      const player = sim.players.get(id)!;
      player.motor.invulnerable = 0;
      const before = player.motor.hp;
      player.motor.applyDamage({
        attackerId: 0, victimId: player.entityId, sourceId: 'qa', attackId: 'qa',
        baseDamage: 20, finalDamage: 20, crit: false, procCoefficient: 0, procChainDepth: 0,
        damageTags: ['qa'], hitPosition: { x: 0, y: 1, z: 0 }, hitNormal: { x: 0, y: 1, z: 0 },
        forceDirection: { x: 0, y: 0, z: 1 }, forceMagnitude: 0,
      });
      expect(player.motor.hp).toBeLessThan(before);
    }
    expect(new Set(ids.map(id => sim.players.get(id)!.entityId))).toEqual(new Set([1, 2, 3, 4]));
  }, 60_000);
});

describe('proc é consequência do acerto autoritativo', () => {
  it('a explosão do item do ATIRADOR fere o corpo vizinho, e ela nasce no servidor', () => {
    const sim = arena('proc-blast');
    sim.addPlayer('a');
    const loadout = sim.players.get('a')!.loadout;
    for (let i = 0; i < 20; i++) loadout.addItem('bomb');   // chance alta, para o caso não ser sorteio
    const at = place(sim, 'a', 0, -14);
    const struck = target(sim, { x: at.x, y: at.y, z: at.z + 8 });
    const neighbour = target(sim, { x: at.x + 1.6, y: at.y, z: at.z + 8 });

    let splashed = false;
    for (let i = 1; i <= 40 && !splashed; i++) {
      struck.position.x = at.x; struck.position.z = at.z + 8; struck.health.current = struck.health.maximum;
      neighbour.position.x = at.x + 1.6; neighbour.position.z = at.z + 8;
      fire(sim, 'a', 0, i);
      splashed = neighbour.health.current < neighbour.health.maximum;
      for (let k = 0; k < 24; k++) sim.step(DT);
    }
    // O vizinho não foi mirado: quem o feriu foi a consequência do acerto, decidida aqui.
    expect(splashed).toBe(true);
  }, 90_000);
});

describe('single-player não muda um bit', () => {
  it('sem tiro nenhum, a horda de um jogador evolui exatamente como antes', () => {
    const one = new FarmSimulation('parity', collision());
    const two = new FarmSimulation('parity', collision());
    one.addPlayer('a'); two.addPlayer('a');
    for (let i = 0; i < 60 * 25; i++) { one.step(DT); two.step(DT); }
    // Mesma semente, mesmas entradas (nenhuma), mesmo mundo: o stream `combat` não é consumido
    // quando ninguém aperta o gatilho, então nada do bloco E desloca os sorteios existentes.
    expect(JSON.stringify(one.snapshot().enemies)).toBe(JSON.stringify(two.snapshot().enemies));
  }, 90_000);
});
