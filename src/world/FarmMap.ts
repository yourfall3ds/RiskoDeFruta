import type { MapDefinition, SpawnPoint } from './MapDefinition';

/**
 * O MAPA DA FAZENDA — só o que o servidor precisa para simular.
 *
 * A colisão dele NÃO mora aqui: são megabytes de JSON lidos do disco (`FarmRoom.loadCollision`), e
 * carregá-los de um módulo compartilhado com o cliente faria o navegador baixar o mundo duas
 * vezes. O que mora aqui é o que a simulação precisa e o disco não diz: ONDE OS JOGADORES PISAM.
 *
 * ## De onde saem estes números
 *
 * Da faixa que o jogo já conhecia como chão limpo em frente ao celeiro — `|x| ≤ 2`, `z ≤ -10` —, a
 * mesma que `tests/net-simulation` afirma desde antes deste trabalho. O nascimento era SORTEADO
 * dentro dela, e dois sorteios podiam cair a centímetros um do outro: dois corpos no mesmo ponto se
 * empurram, e a partida começava com os dois sendo cuspidos para lados aleatórios, o que na tela
 * parece falha de rede e não é.
 *
 * Agora são quatro assentos fixos dentro da mesma faixa. 1,3 m entre vizinhos é mais que a largura
 * de um corpo, e o extremo (±1,95) fica dentro do `|x| ≤ 2` provado. Apertado de propósito: nascer
 * "bem separado" fora do chão bom seria trocar um defeito por outro pior.
 */
const Z = -13.5;
const ESPACAMENTO = 1.3;

/** Centrada para quatro: as vagas caem em -1,5 · -0,5 · +0,5 · +1,5 vezes o espaçamento. */
const posicao = (indice: number): SpawnPoint => ({ x: (indice - 1.5) * ESPACAMENTO, y: 0, z: Z });

export const FARM_MAP_ID = '';
export const FARM_MAP_NAME = 'FAZENDA';

export const FARM_MAP: MapDefinition = {
  id: FARM_MAP_ID,
  displayName: FARM_MAP_NAME,
  playerSpawns: [posicao(0), posicao(1), posicao(2), posicao(3)],
};
