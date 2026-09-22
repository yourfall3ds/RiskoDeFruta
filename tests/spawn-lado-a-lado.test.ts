import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { FarmSimulation, type CollisionData } from '../server/FarmSimulation';

/**
 * NINGUÉM NASCE DENTRO DE NINGUÉM.
 *
 * ## O que estava errado
 *
 * O ponto de nascimento era SORTEADO: `range(-2, 2)` em x por `range(-17, -10)` em z. Numa faixa
 * de quatro metros por sete, dois sorteios podem cair a centímetros um do outro — e caíam. Dois
 * corpos no mesmo ponto se empurram, e o primeiro quadro da partida começa com os dois sendo
 * cuspidos para lados aleatórios. Na tela isso parece bug de rede, e não é.
 *
 * ## O que existe agora
 *
 * Fileira fixa: a posição é do NÚMERO do jogador, não da sorte. Determinístico, e por construção
 * sem colisão — P1..P4 em vagas próprias, centradas no eixo.
 *
 * ## Por que sem sala nem servidor
 *
 * `FarmSimulation` é pura: não conhece Colyseus nem Babylon. A regra de nascimento mora nela, e é
 * onde ela se afirma mais rápido. A prova de que isso CHEGA às duas telas é outra, e vive nos
 * testes de sala.
 */

/** A largura de um corpo, folgada. Dois jogadores mais perto que isto estão encavalados. */
const LARGURA_DO_CORPO = 1;

/** A mesma colisão que `tests/enemy-simulation` usa: a fazenda de verdade, lida do disco. */
function collision(): CollisionData {
  const read = (name: string) => JSON.parse(readFileSync(`public/models/${name}`, 'utf8'));
  const farm = read('farm-collision.json');
  const data: CollisionData = { boxes: farm.boxes, surfaces: farm.surfaces, mesh: read('world-collision-mesh.json'), solid: read('solid-island-collision.json') };
  if (existsSync('public/models/farm-city-collision.json')) data.city = read('farm-city-collision.json');
  return data;
}

function simulacao(): FarmSimulation {
  return new FarmSimulation('teste-nascimento', collision());
}

describe('a fileira de nascimento', () => {
  it('quatro jogadores, quatro lugares distintos — e nenhum par encostado', () => {
    const sim = simulacao();
    const pontos = ['a', 'b', 'c', 'd'].map(id => sim.addPlayer(id));

    expect(pontos.map(p => p.entityId)).toEqual([1, 2, 3, 4]);
    for (let i = 0; i < pontos.length; i++) {
      for (let j = i + 1; j < pontos.length; j++) {
        const distancia = Math.hypot(pontos[i]!.x - pontos[j]!.x, pontos[i]!.z - pontos[j]!.z);
        expect(distancia).toBeGreaterThan(LARGURA_DO_CORPO);
      }
    }
  });

  /**
   * LADO A LADO, e não em fila indiana: os dois têm de estar na MESMA linha de frente, separados
   * na lateral. Um atrás do outro seria "distinto" e continuaria errado — o de trás começa a
   * partida olhando para a nuca do companheiro.
   */
  it('dois jogadores nascem na mesma linha, separados na lateral', () => {
    const sim = simulacao();
    const [a, b] = [sim.addPlayer('a'), sim.addPlayer('b')];

    expect(a.z).toBeCloseTo(b.z, 5);
    expect(Math.abs(a.x - b.x)).toBeGreaterThan(LARGURA_DO_CORPO);
  });

  /** O mesmo número sempre no mesmo lugar: sem isto, "nasceu torto" vira um caso irreproduzível. */
  it('é determinístico: a mesma vaga dá sempre o mesmo ponto', () => {
    const primeira = simulacao(), segunda = simulacao();
    const a1 = primeira.addPlayer('x'), a2 = segunda.addPlayer('outro-id-qualquer');
    expect({ x: a2.x, z: a2.z }).toEqual({ x: a1.x, z: a1.z });
  });

  /**
   * A VAGA LIBERADA volta a ser usada, e continua sendo a MESMA vaga. Quem entra no lugar de quem
   * saiu ocupa o buraco 1..4 — e tem de cair no lugar daquele número, não num quinto ponto.
   */
  it('quem entra no lugar de quem saiu nasce na vaga que vagou', () => {
    const sim = simulacao();
    sim.addPlayer('a'); const b = sim.addPlayer('b'); sim.addPlayer('c');
    sim.removePlayer('b');
    const novo = sim.addPlayer('d');

    expect(novo.entityId).toBe(b.entityId);
    expect({ x: novo.x, z: novo.z }).toEqual({ x: b.x, z: b.z });
  });
});
