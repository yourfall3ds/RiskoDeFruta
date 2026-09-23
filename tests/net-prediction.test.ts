import { describe, it, expect } from 'vitest';
import { FarmSimulation, STARVED_STEPS } from '../server/FarmSimulation';
import { TEST_MAP, testMapCollision } from '../src/world/TestMap';
import { PlayerMotor } from '../src/player/PlayerMotor';
import { EventBus } from '../src/core/EventBus';
import { EMPTY_INPUT, type InputFrame } from '../src/input/InputFrame';

/**
 * O PULO TRAVADO DO CO-OP, pelas duas pontas.
 *
 * 1. O servidor dava passo com a última entrada quando o buffer esvaziava — um passo que o cliente
 *    nunca simulou. No arco do pulo isso é ~0,16 m de erro e correção a cada confirmação.
 * 2. A reconciliação reexecutava a partir da velocidade/coyote do quadro MAIS RECENTE. O pulo
 *    entre os pendentes não se repetia e o arco saía encurtado.
 */
const DT = 1 / 60;
const andar: InputFrame = { ...EMPTY_INPUT, z: 1 };
const pular: InputFrame = { ...EMPTY_INPUT, z: 1, jump: true };

async function laboratorio(): Promise<FarmSimulation> {
  const sim = new FarmSimulation('pred', testMapCollision(), TEST_MAP);
  await sim.prepare();
  return sim;
}

describe('servidor em lockstep', () => {
  it('não anda o corpo sem entrada nova, e volta a simular depois de faminto', async () => {
    const sim = await laboratorio();
    sim.lockstep = true;
    sim.addPlayer('a');
    for (let i = 0; i < 30; i++) sim.step(DT);   // assentar no chão
    const p = sim.players.get('a')!;
    sim.applyInput('a', { frame: andar, yaw: 0, pitch: 0, seq: 1 });
    sim.step(DT);
    const depoisDeUm = p.motor.position.z;
    for (let i = 0; i < STARVED_STEPS - 2; i++) sim.step(DT);
    expect(p.motor.position.z).toBeCloseTo(depoisDeUm, 6);   // parado esperando entrada

    sim.applyInput('a', { frame: andar, yaw: 0, pitch: 0, seq: 2 });
    sim.stepPlayerById('a', DT);                               // a sala recuperando fila
    expect(p.motor.position.z).toBeGreaterThan(depoisDeUm);
  });

  it('fora do lockstep (simulação pura) a última entrada continua valendo', async () => {
    const sim = await laboratorio();
    sim.addPlayer('a');
    for (let i = 0; i < 30; i++) sim.step(DT);
    const p = sim.players.get('a')!;
    sim.applyInput('a', { frame: andar, yaw: 0, pitch: 0, seq: 1 });
    sim.step(DT); const um = p.motor.position.z;
    sim.step(DT);
    expect(p.motor.position.z).toBeGreaterThan(um);
  });
});

describe('reconciliação com o estado completo do motor', () => {
  it('restaurar o estado de um seq e reexecutar reproduz o arco do pulo exatamente', async () => {
    const sim = await laboratorio();
    const spawn = TEST_MAP.playerSpawns[0]!;
    const entradas: InputFrame[] = [...Array(20).fill(andar), pular, ...Array(40).fill(andar)];

    const original = new PlayerMotor(sim.collision, new EventBus(), { x: spawn.x, y: spawn.y, z: spawn.z });
    for (let i = 0; i < 30; i++) original.fixedUpdate(DT, EMPTY_INPUT, 0);
    const estados = [], posicoes = [];
    for (const f of entradas) { original.fixedUpdate(DT, f, 0); estados.push(original.captureState()); posicoes.push({ ...original.position }); }

    // O "servidor" confirmou o passo 15 (antes do pulo); os pendentes incluem o pulo.
    const k = 15;
    const replay = new PlayerMotor(sim.collision, new EventBus(), { x: spawn.x, y: spawn.y, z: spawn.z });
    for (let i = 0; i < 50; i++) replay.fixedUpdate(DT, andar, 0);   // estado "mais recente" bagunçado
    replay.restoreState(estados[k]!);
    Object.assign(replay.position, posicoes[k]!); Object.assign(replay.previous, replay.position);
    replay.replaying = true;
    for (let i = k + 1; i < entradas.length; i++) replay.fixedUpdate(DT, entradas[i]!, 0);

    const fim = posicoes.at(-1)!;
    expect(replay.position.x).toBeCloseTo(fim.x, 5);
    expect(replay.position.y).toBeCloseTo(fim.y, 5);
    expect(replay.position.z).toBeCloseTo(fim.z, 5);
    const apice = Math.max(...posicoes.map(p => p.y));
    expect(apice).toBeGreaterThan(posicoes[k]!.y + .5);   // houve pulo de verdade
  });

  it('a reexecução não repete os eventos de pulo', async () => {
    const sim = await laboratorio();
    const spawn = TEST_MAP.playerSpawns[0]!;
    const bus = new EventBus<import('../src/core/contracts').GameEvents>();
    let pulos = 0; bus.on('SkillUsed', e => { if (e.skillId === 'jump') pulos++; });
    const m = new PlayerMotor(sim.collision, bus, { x: spawn.x, y: spawn.y, z: spawn.z });
    for (let i = 0; i < 30; i++) m.fixedUpdate(DT, EMPTY_INPUT, 0);
    m.replaying = true; m.fixedUpdate(DT, pular, 0); m.replaying = false;
    expect(pulos).toBe(0);
    m.fixedUpdate(DT, EMPTY_INPUT, 0); for (let i = 0; i < 90; i++) m.fixedUpdate(DT, EMPTY_INPUT, 0);
    m.fixedUpdate(DT, pular, 0);
    expect(pulos).toBe(1);
  });
});
