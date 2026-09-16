import type {Vec3} from '../core/contracts';

/**
 * Traçado do mundo: seis setores cardeais (vértices de um octaedro) e as pontes entre eles.
 * Isto é DADO, não arte: o Codex usa para posicionar os GLB autorais já existentes.
 *
 * Números fechados em .temp/planet-core-design.md §2, com R = 200 m e ilha de raio 72 m:
 *   arco entre vizinhos = π/2 · 200 = 314,16 m     vão livre de ponte = 314,16 − 144 = 170,16 m
 */

export type IslandSlotId = 'north' | 'south' | 'front' | 'east' | 'back' | 'west';

export interface IslandSlot {
  readonly id: IslandSlotId;
  /** Direção unitária do centro do convés a partir do centro do planeta. */
  readonly direction: Vec3;
  readonly longitudeDegrees: number;
  readonly latitudeDegrees: number;
  /** Giro da ilha em torno da própria vertical, em graus, a partir do norte geográfico. */
  readonly spinDegrees: number;
}

export interface BridgeSpanPlan {
  readonly id: string;
  readonly from: IslandSlotId;
  readonly to: IslandSlotId;
  /** 1 = anel equatorial fechado (mínimo jogável). 2 = ligação polar. */
  readonly stage: 1 | 2;
}

export const ISLAND_SLOTS: readonly IslandSlot[] = [
  {id: 'front', direction: {x: 0, y: 0, z: 1}, longitudeDegrees: 0, latitudeDegrees: 0, spinDegrees: 0},
  {id: 'east', direction: {x: 1, y: 0, z: 0}, longitudeDegrees: 90, latitudeDegrees: 0, spinDegrees: 0},
  {id: 'back', direction: {x: 0, y: 0, z: -1}, longitudeDegrees: 180, latitudeDegrees: 0, spinDegrees: 0},
  {id: 'west', direction: {x: -1, y: 0, z: 0}, longitudeDegrees: -90, latitudeDegrees: 0, spinDegrees: 0},
  {id: 'north', direction: {x: 0, y: 1, z: 0}, longitudeDegrees: 0, latitudeDegrees: 90, spinDegrees: 0},
  {id: 'south', direction: {x: 0, y: -1, z: 0}, longitudeDegrees: 0, latitudeDegrees: -90, spinDegrees: 0},
];

/**
 * Estágio 1 é um CICLO FECHADO no equador: sair de `front` para leste e seguir em frente
 * devolve o jogador a `front`. É o requisito "seguir uma rota volta à mesma ilha".
 */
export const BRIDGE_SPANS: readonly BridgeSpanPlan[] = [
  {id: 'front-east', from: 'front', to: 'east', stage: 1},
  {id: 'east-back', from: 'east', to: 'back', stage: 1},
  {id: 'back-west', from: 'back', to: 'west', stage: 1},
  {id: 'west-front', from: 'west', to: 'front', stage: 1},
  {id: 'north-front', from: 'north', to: 'front', stage: 2},
  {id: 'south-back', from: 'south', to: 'back', stage: 2},
];

export const PLANET_LAYOUT = {islands: ISLAND_SLOTS, bridges: BRIDGE_SPANS} as const;

export function islandSlot(id: IslandSlotId): IslandSlot {
  const found = ISLAND_SLOTS.find(slot => slot.id === id);
  if (!found) throw new Error(`Slot de ilha desconhecido: ${id}`);
  return found;
}

/** O ciclo equatorial em ordem de percurso; usado por testes e por rotas de objetivo. */
export const EQUATORIAL_LOOP: readonly IslandSlotId[] = ['front', 'east', 'back', 'west'];
