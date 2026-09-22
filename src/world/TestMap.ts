import type { BoxCollider, GroundSurface } from '../physics/CollisionWorld';
import type { MapDefinition, SpawnPoint } from './MapDefinition';

/**
 * TEST MAP V1.0 — o mapa que existe para o teste ser rápido.
 *
 * ## Por que ele existe
 *
 * A fazenda leva CINQUENTA E DOIS SEGUNDOS para montar do lado do cliente (medido: `farm.world.done
 * 52715ms`), e a corrida inteira passa de um minuto e meio até o primeiro quadro jogável. Validar
 * "os dois se veem", "ninguém nasce dentro do outro" ou "o inimigo aparece nas duas telas" em cima
 * disso é pagar noventa segundos por tentativa — e a máquina de desenvolvimento não aguenta duas
 * instâncias da fazenda ao mesmo tempo.
 *
 * Este mapa é um CHÃO. Sem GLB, sem malha, sem cidade, sem afloramento, sem arquivo nenhum: uma
 * superfície plana descrita por seis números. Nasce instantâneo dos dois lados, e é isso que
 * permite abrir duas janelas, errar, corrigir e repetir em segundos em vez de minutos.
 *
 * ## O que ele NÃO é
 *
 * Não é conteúdo de jogo e não entra em corrida de verdade. É bancada de teste: o que se prova
 * aqui é MECANISMO — nascimento, visibilidade mútua, replicação de inimigo, dano —, nunca
 * equilíbrio, ritmo ou dificuldade. Um mecanismo que funciona no plano pode falhar no relevo da
 * fazenda; por isso o mapa de teste ACELERA a validação, não a substitui.
 */

export const TEST_MAP_ID = 'test-v1';
export const TEST_MAP_NAME = 'TEST MAP V1.0';

/** Lado do quadrado, em metros. Oitenta dá espaço para correr sem virar um mapa para explorar. */
export const TEST_MAP_SIZE = 80;
/** A altura do chão. Zero para que `groundAt` e o nascimento concordem sem conta nenhuma. */
export const TEST_MAP_HEIGHT = 0;

/**
 * A colisão do mapa de teste: UMA superfície plana, e nada mais.
 *
 * `mesh` e `solid` vão vazios de propósito. Eles existem para o relevo esculpido e para os volumes
 * sob as ilhas da fazenda; num plano não há o que esculpir nem sob o que cair, e enchê-los com
 * geometria inventada só daria trabalho à física para descrever o nada.
 */
export function testMapCollision(): {
  boxes: BoxCollider[];
  surfaces: GroundSurface[];
  mesh: { positions: number[]; indices: number[]; boxes: BoxCollider[] };
  solid: { positions: number[]; indices: number[]; boxes: BoxCollider[] };
} {
  return {
    boxes: [],
    surfaces: [{ id: 'test-ground', x: 0, z: 0, width: TEST_MAP_SIZE, depth: TEST_MAP_SIZE, height: TEST_MAP_HEIGHT }],
    mesh: { positions: [], indices: [], boxes: [] },
    solid: { positions: [], indices: [], boxes: [] },
  };
}

/**
 * OS QUATRO ASSENTOS DO MAPA DE TESTE, declarados um a um.
 *
 * Nada de fórmula: quatro linhas que se leem de uma vez. Três metros entre vizinhos é o triplo da
 * largura de um corpo — ninguém nasce encavalado, ninguém é empurrado no primeiro quadro, e os
 * quatro ficam perto o bastante para se enxergarem sem virar a câmera.
 *
 * Todos no MESMO z e no MESMO y: fileira, não fila indiana. Um atrás do outro seria "separado" e
 * continuaria errado — o de trás começaria a partida olhando para a nuca do companheiro.
 *
 * `yaw: 0` nos quatro: todos encarando a mesma direção, que é para onde o corpo de teste nasce.
 *
 * O chão tem oitenta metros de lado (`TEST_MAP_SIZE`), então ±4,5 está longe de qualquer borda.
 */
export const TEST_MAP_PLAYER_SPAWNS: readonly SpawnPoint[] = [
  { x: -4.5, y: TEST_MAP_HEIGHT, z: -6, yaw: 0 },
  { x: -1.5, y: TEST_MAP_HEIGHT, z: -6, yaw: 0 },
  { x: 1.5, y: TEST_MAP_HEIGHT, z: -6, yaw: 0 },
  { x: 4.5, y: TEST_MAP_HEIGHT, z: -6, yaw: 0 },
];

/**
 * Onde o corpo de teste nasce: à frente da fileira, à vista dos quatro.
 *
 * Doze metros adiante — longe o bastante para ninguém nascer em cima dele, perto o bastante para
 * caber na tela sem andar.
 */
export const TEST_MAP_ENEMY_SPAWNS: readonly SpawnPoint[] = [
  { x: 0, y: TEST_MAP_HEIGHT, z: 6 },
];

export const TEST_MAP: MapDefinition = {
  id: TEST_MAP_ID,
  displayName: TEST_MAP_NAME,
  playerSpawns: TEST_MAP_PLAYER_SPAWNS,
  enemySpawns: TEST_MAP_ENEMY_SPAWNS,
};

/** `true` quando o valor guardado na sala pede o mapa de teste. Um só lugar decide isso. */
export function isTestMap(value: string | undefined): boolean {
  return (value ?? '').trim().toLowerCase() === TEST_MAP_ID;
}

/**
 * Os mapas que o anfitrião pode escolher na sala.
 *
 * Lista de dados, não de telas: o menu desenha o que estiver aqui, e acrescentar um mapa novo é
 * acrescentar uma linha — sem tocar em `MenuShell`.
 */
export const MAP_CHOICES: readonly { id: string; name: string; note: string }[] = [
  { id: '', name: 'FAZENDA', note: 'O mapa do jogo · carga longa' },
  { id: TEST_MAP_ID, name: TEST_MAP_NAME, note: 'Plano e instantâneo · só para teste' },
];
