import { describe, it, expect } from 'vitest';
import { spawnFor, type MapDefinition } from '../src/world/MapDefinition';
import { TEST_MAP, TEST_MAP_SIZE } from '../src/world/TestMap';
import { FARM_MAP } from '../src/world/FarmMap';

/**
 * O ASSENTO É DO `entityId`; A COORDENADA É DO MAPA.
 *
 * A fileira de nascimento começou como constante global dentro da `FarmSimulation` — número entra,
 * coordenada sai. Funciona com um mapa só. Com dois já quebra, e vão existir vários: fazenda, mapa
 * de teste, planeta, arena de chefe. Cada um tem chão seguro em lugar diferente, e a faixa firme na
 * fazenda pode ser abismo na arena.
 *
 * Então a regra que se afirma aqui não é "onde P1 nasce", e sim a PROPRIEDADE que todo mapa tem de
 * cumprir: quatro assentos, distintos, lado a lado, sem ninguém atrás de ninguém. Um mapa novo
 * entra nesta lista e é checado pelas mesmas regras — sem tocar na simulação.
 */

/** Largura folgada de um corpo. Vizinhos mais perto que isto estariam encavalados. */
const LARGURA_DO_CORPO = 1;

const MAPAS: readonly MapDefinition[] = [FARM_MAP, TEST_MAP];

describe.each(MAPAS.map(m => [m.displayName, m] as const))('o mapa %s', (_nome, mapa) => {
  it('declara quatro assentos, um por vaga da sala', () => {
    expect(mapa.playerSpawns).toHaveLength(4);
  });

  it('nenhum par de assentos se sobrepõe', () => {
    for (let i = 0; i < mapa.playerSpawns.length; i++) {
      for (let j = i + 1; j < mapa.playerSpawns.length; j++) {
        const a = mapa.playerSpawns[i]!, b = mapa.playerSpawns[j]!;
        expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(LARGURA_DO_CORPO);
      }
    }
  });

  /**
   * FILEIRA, e não fila indiana. Todos na mesma linha de frente: quem nasce atrás começa a partida
   * olhando para a nuca do companheiro, e isso é "distinto" sendo errado do mesmo jeito.
   */
  it('todos na mesma linha e na mesma altura', () => {
    const primeiro = mapa.playerSpawns[0]!;
    for (const assento of mapa.playerSpawns) {
      expect(assento.z).toBeCloseTo(primeiro.z, 5);
      expect(assento.y).toBeCloseTo(primeiro.y, 5);
    }
  });

  it('o assento sai pelo número do jogador, em ordem', () => {
    for (let entityId = 1; entityId <= 4; entityId++) {
      expect(spawnFor(mapa, entityId)).toBe(mapa.playerSpawns[entityId - 1]);
    }
  });

  /**
   * Um número fora da faixa tem de cair em chão CONHECIDO. Devolver `undefined` viraria `NaN` de
   * posição três passos adiante, num lugar sem nenhuma pista de onde nasceu o defeito.
   */
  it('número fora da faixa cai no primeiro assento, nunca em indefinido', () => {
    expect(spawnFor(mapa, 0)).toBe(mapa.playerSpawns[0]);
    expect(spawnFor(mapa, 99)).toBe(mapa.playerSpawns[3]);
  });
});

describe('o mapa de teste, especificamente', () => {
  it('cabe folgado dentro do próprio chão', () => {
    const meio = TEST_MAP_SIZE / 2;
    for (const assento of TEST_MAP.playerSpawns) {
      expect(Math.abs(assento.x)).toBeLessThan(meio - 5);
      expect(Math.abs(assento.z)).toBeLessThan(meio - 5);
    }
  });

  /** Todos encarando a mesma direção — que é para onde o corpo de teste nasce. */
  it('os quatro olham para o mesmo lado, e o corpo de teste está à frente deles', () => {
    for (const assento of TEST_MAP.playerSpawns) expect(assento.yaw).toBe(0);
    const corpo = TEST_MAP.enemySpawns?.[0];
    expect(corpo).toBeDefined();
    expect(corpo!.z).toBeGreaterThan(TEST_MAP.playerSpawns[0]!.z);
  });
});
