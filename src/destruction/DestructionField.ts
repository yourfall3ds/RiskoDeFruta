import type {Vec3} from '../core/contracts';
import type {DestructibleRecord} from './DestructibleTypes';
import {DestructibleState} from './DestructionModel';

/**
 * Índice espacial dos destrutíveis: de um tiro para o corpo atingido, em tempo constante.
 *
 * Duas entradas, porque o jogo tem dois jeitos de acertar alguma coisa:
 *
 * 1. **por triângulo** — `PlanetCollision.raycast` já devolve o índice do triângulo atingido. Uma
 *    busca binária sobre os intervalos ordenados resolve em O(log n) sem tocar em geometria. É o
 *    caminho exato: o prop atingido é o dono daquele triângulo, ponto.
 * 2. **por ponto** — dano em área, explosão em cadeia do barril, e o legado (que não tem intervalo
 *    de triângulo nenhum). Uma grade uniforme com célula de 8 m visita só a vizinhança.
 *
 * Não existe varredura linear sobre todos os props em nenhum caminho de tiro. Com centenas de props
 * marcados e 6,6 tiros por segundo, varredura linear seria a conta mais cara do quadro sem precisar.
 */

const CELL = 8;

interface Range {start: number; end: number; state: DestructibleState; component: number}

export interface FieldHit {
  readonly state: DestructibleState;
  /** Índice do componente atingido, ou −1 quando o acerto é no corpo do prop. */
  readonly component: number;
}

const cellKey = (x: number, y: number, z: number): string => `${x}|${y}|${z}`;

export class DestructionField {
  private readonly states = new Map<string, DestructibleState>();
  /** Intervalos de triângulo ordenados por início, sem sobreposição (o parser garante). */
  private readonly ranges: Range[] = [];
  /** Maior `end` entre `ranges[0..i]`. Corta a busca de um tiro que não acertou prop nenhum. */
  private maxEnd: number[] = [];
  private readonly grid = new Map<string, DestructibleState[]>();

  constructor(records: readonly DestructibleRecord[] = []) {
    this.add(records);
  }

  get size(): number {return this.states.size;}
  get all(): Iterable<DestructibleState> {return this.states.values();}
  get(id: string): DestructibleState | undefined {return this.states.get(id);}

  add(records: readonly DestructibleRecord[]): void {
    for (const record of records) {
      if (this.states.has(record.id)) continue;
      const state = new DestructibleState(record);
      this.states.set(record.id, state);

      // Componentes primeiro: um acerto dentro do telhado é do telhado, não do celeiro inteiro.
      for (const [index, part] of record.components.entries()) {
        if (part.triangleCount > 0) {
          this.ranges.push({start: part.triangleStart, end: part.triangleStart + part.triangleCount, state, component: index});
        }
      }
      // `triangleCount === 0` é o prop sem intervalo de colisão — o caso do legado, que resolve tudo
      // por posição. Registrar um intervalo vazio faria a busca binária apontar para o nada.
      if (record.triangleCount > 0) {
        this.ranges.push({start: record.triangleStart, end: record.triangleStart + record.triangleCount, state, component: -1});
      }

      const {centre, extents} = record;
      const x0 = Math.floor((centre.x - extents.x) / CELL), x1 = Math.floor((centre.x + extents.x) / CELL);
      const y0 = Math.floor((centre.y - extents.y) / CELL), y1 = Math.floor((centre.y + extents.y) / CELL);
      const z0 = Math.floor((centre.z - extents.z) / CELL), z1 = Math.floor((centre.z + extents.z) / CELL);
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
        const key = cellKey(x, y, z);
        const bucket = this.grid.get(key);
        if (bucket) bucket.push(state); else this.grid.set(key, [state]);
      }
    }
    // Intervalos de componente e de pai compartilham triângulos; o desempate é pela largura, então
    // ordenar por início e, em empate, pelo menor intervalo mantém o mais específico primeiro.
    this.ranges.sort((a, b) => a.start - b.start || (a.end - a.start) - (b.end - b.start));
    this.maxEnd = new Array<number>(this.ranges.length);
    let running = -Infinity;
    for (let i = 0; i < this.ranges.length; i++) {
      running = Math.max(running, this.ranges[i]!.end);
      this.maxEnd[i] = running;
    }
  }

  /**
   * Dono do triângulo atingido. Prefere o componente ao pai quando os dois cobrem o triângulo.
   *
   * Busca binária pelo último intervalo que começa em `triangle` ou antes, seguida de uma varredura
   * para trás que para assim que `maxEnd` mostra que nenhum intervalo anterior alcança o alvo.
   *
   * É esse corte por `maxEnd` que torna o caso comum barato: a esmagadora maioria dos tiros acerta
   * terreno, e terreno não é prop — sem ele, todo tiro perdido varreria a lista inteira para trás.
   */
  byTriangle(triangle: number): FieldHit | undefined {
    if (!(triangle >= 0) || this.ranges.length === 0) return undefined;
    let lo = 0, hi = this.ranges.length - 1, at = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.ranges[mid]!.start <= triangle) {at = mid; lo = mid + 1;} else hi = mid - 1;
    }
    let parent: FieldHit | undefined;
    for (let i = at; i >= 0; i--) {
      if (this.maxEnd[i]! <= triangle) break;
      const range = this.ranges[i]!;
      if (range.end <= triangle) continue;
      // Componente ganha do pai: um acerto no telhado é do telhado.
      if (range.component >= 0) return {state: range.state, component: range.component};
      parent ??= {state: range.state, component: -1};
    }
    return parent;
  }

  /** Destrutíveis cujo centro está a até `radius` do ponto, do mais próximo ao mais distante. */
  near(point: Vec3, radius: number): DestructibleState[] {
    if (!(radius > 0)) return [];
    const found = new Set<DestructibleState>();
    const x0 = Math.floor((point.x - radius) / CELL), x1 = Math.floor((point.x + radius) / CELL);
    const y0 = Math.floor((point.y - radius) / CELL), y1 = Math.floor((point.y + radius) / CELL);
    const z0 = Math.floor((point.z - radius) / CELL), z1 = Math.floor((point.z + radius) / CELL);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
      const bucket = this.grid.get(cellKey(x, y, z));
      if (!bucket) continue;
      for (const state of bucket) found.add(state);
    }
    const limit = radius * radius;
    return [...found]
      .map(state => ({state, d: squared(state.record.centre, point)}))
      .filter(entry => entry.d <= limit)
      .sort((a, b) => a.d - b.d)
      .map(entry => entry.state);
  }

  /**
   * Destrutível cuja caixa envolvente contém o ponto (com folga). Usado quando o acerto não trouxe
   * índice de triângulo — legado, dano de corpo a corpo, habilidade que resolve por posição.
   */
  atPoint(point: Vec3, slack = 0.25): DestructibleState | undefined {
    for (const state of this.near(point, 12)) {
      const {centre, extents} = state.record;
      if (Math.abs(point.x - centre.x) <= extents.x + slack
        && Math.abs(point.y - centre.y) <= extents.y + slack
        && Math.abs(point.z - centre.z) <= extents.z + slack) return state;
    }
    return undefined;
  }

  resetAll(): void {for (const state of this.states.values()) state.reset();}

  clear(): void {
    this.states.clear();
    this.ranges.length = 0;
    this.grid.clear();
  }
}

const squared = (a: Vec3, b: Vec3): number =>
  (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2;
