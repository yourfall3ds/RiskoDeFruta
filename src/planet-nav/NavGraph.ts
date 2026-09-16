import type {Vec3} from '../core/contracts';

/**
 * Grafo de nós de navegação: coordenadas, vizinhança espacial em balde 3D, componentes conexos
 * e A\* sobre distância real.
 *
 * O balde existe por uma razão só: ligar 36 mil nós comparando todos com todos são 650 milhões de
 * pares. Com célula do tamanho do raio de ligação, cada nó olha 27 células e ~oito candidatos —
 * linear no número de nós, e é isso que permite construir o planeta inteiro em fatias de 8 ms.
 */

/** Fila de prioridade mínima sobre pares (nó, f). Só o que o A\* precisa. */
class MinHeap {
  private readonly items: number[] = [];
  private readonly keys: number[] = [];

  get size(): number {return this.items.length;}
  clear(): void {this.items.length = 0; this.keys.length = 0;}

  push(item: number, key: number): void {
    this.items.push(item); this.keys.push(key);
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.keys[parent]! <= this.keys[i]!) break;
      this.swap(i, parent); i = parent;
    }
  }

  pop(): number {
    const top = this.items[0]!;
    const item = this.items.pop()!, key = this.keys.pop()!;
    if (this.items.length > 0) {
      this.items[0] = item; this.keys[0] = key;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let best = i;
        if (l < this.items.length && this.keys[l]! < this.keys[best]!) best = l;
        if (r < this.items.length && this.keys[r]! < this.keys[best]!) best = r;
        if (best === i) break;
        this.swap(i, best); i = best;
      }
    }
    return top;
  }

  private swap(a: number, b: number): void {
    const item = this.items[a]!; this.items[a] = this.items[b]!; this.items[b] = item;
    const key = this.keys[a]!; this.keys[a] = this.keys[b]!; this.keys[b] = key;
  }
}

export interface NavSearchResult {
  readonly nodes: number[];
  readonly distance: number;
}

export class NavGraph {
  private readonly xs: number[] = [];
  private readonly ys: number[] = [];
  private readonly zs: number[] = [];
  private readonly owners: string[] = [];
  private readonly links: number[][] = [];
  private readonly costs: number[][] = [];
  private readonly buckets = new Map<string, number[]>();
  private readonly cell: number;

  private component = new Int32Array(0);
  private componentCount = 0;

  // Rascunho do A*, alocado uma vez; `stamp` evita limpar os arrays a cada consulta.
  private gScore = new Float64Array(0);
  private cameFrom = new Int32Array(0);
  private stamp = new Int32Array(0);
  private generation = 0;
  private readonly heap = new MinHeap();

  constructor(cellSize: number) {this.cell = Math.max(0.5, cellSize);}

  private key(x: number, y: number, z: number): string {
    return `${Math.floor(x / this.cell)},${Math.floor(y / this.cell)},${Math.floor(z / this.cell)}`;
  }

  get size(): number {return this.xs.length;}
  get components(): number {return this.componentCount;}
  owner(index: number): string {return this.owners[index] ?? '';}
  point(index: number): Vec3 {return {x: this.xs[index]!, y: this.ys[index]!, z: this.zs[index]!};}
  degree(index: number): number {return this.links[index]?.length ?? 0;}
  neighbours(index: number): readonly number[] {return this.links[index] ?? [];}
  componentOf(index: number): number {return this.component[index] ?? -1;}

  get edgeCount(): number {
    let total = 0;
    for (const list of this.links) total += list.length;
    return total / 2;
  }

  add(point: Vec3, owner: string): number {
    const index = this.xs.length;
    this.xs.push(point.x); this.ys.push(point.y); this.zs.push(point.z);
    this.owners.push(owner);
    this.links.push([]); this.costs.push([]);
    const key = this.key(point.x, point.y, point.z);
    const bucket = this.buckets.get(key);
    if (bucket) bucket.push(index); else this.buckets.set(key, [index]);
    return index;
  }

  connect(a: number, b: number, cost: number): void {
    this.links[a]!.push(b); this.costs[a]!.push(cost);
    this.links[b]!.push(a); this.costs[b]!.push(cost);
  }

  distanceBetween(a: number, b: number): number {
    return Math.hypot(this.xs[a]! - this.xs[b]!, this.ys[a]! - this.ys[b]!, this.zs[a]! - this.zs[b]!);
  }

  distanceTo(index: number, p: Vec3): number {
    return Math.hypot(this.xs[index]! - p.x, this.ys[index]! - p.y, this.zs[index]! - p.z);
  }

  /** Índices dentro de `radius` de `p`. Varre só as células que o raio toca. */
  query(p: Vec3, radius: number, out: number[] = []): number[] {
    out.length = 0;
    const reach = Math.ceil(radius / this.cell);
    const cx = Math.floor(p.x / this.cell), cy = Math.floor(p.y / this.cell), cz = Math.floor(p.z / this.cell);
    const limit = radius * radius;
    for (let ix = cx - reach; ix <= cx + reach; ix++) {
      for (let iy = cy - reach; iy <= cy + reach; iy++) {
        for (let iz = cz - reach; iz <= cz + reach; iz++) {
          const bucket = this.buckets.get(`${ix},${iy},${iz}`);
          if (!bucket) continue;
          for (const index of bucket) {
            const dx = this.xs[index]! - p.x, dy = this.ys[index]! - p.y, dz = this.zs[index]! - p.z;
            if (dx * dx + dy * dy + dz * dz <= limit) out.push(index);
          }
        }
      }
    }
    return out;
  }

  /** Existe algum nó a menos de `radius` de `p`? Usado para não duplicar nó no refino. */
  occupied(p: Vec3, radius: number): boolean {
    const reach = Math.ceil(radius / this.cell);
    const cx = Math.floor(p.x / this.cell), cy = Math.floor(p.y / this.cell), cz = Math.floor(p.z / this.cell);
    const limit = radius * radius;
    for (let ix = cx - reach; ix <= cx + reach; ix++) {
      for (let iy = cy - reach; iy <= cy + reach; iy++) {
        for (let iz = cz - reach; iz <= cz + reach; iz++) {
          const bucket = this.buckets.get(`${ix},${iy},${iz}`);
          if (!bucket) continue;
          for (const index of bucket) {
            const dx = this.xs[index]! - p.x, dy = this.ys[index]! - p.y, dz = this.zs[index]! - p.z;
            if (dx * dx + dy * dy + dz * dz <= limit) return true;
          }
        }
      }
    }
    return false;
  }

  /** Pares `(a, b)` com `a < b`, achatados — cada aresta uma vez. Formato de gravação. */
  edgePairs(): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.links.length; i++) {
      for (const other of this.links[i]!) if (other > i) out.push(i, other);
    }
    return out;
  }

  longestEdge(): number {
    let longest = 0;
    for (let i = 0; i < this.links.length; i++) {
      for (const cost of this.costs[i]!) if (cost > longest) longest = cost;
    }
    return longest;
  }

  /** Rotula componentes conexos e prepara o rascunho do A\*. Idempotente. */
  finish(): void {
    const count = this.xs.length;
    this.component = new Int32Array(count).fill(-1);
    this.componentCount = 0;
    const queue = new Int32Array(count);
    for (let seed = 0; seed < count; seed++) {
      if (this.component[seed] !== -1) continue;
      const label = this.componentCount++;
      this.component[seed] = label;
      queue[0] = seed;
      for (let head = 0, tail = 1; head < tail; head++) {
        const current = queue[head]!;
        for (const next of this.links[current]!) {
          if (this.component[next] !== -1) continue;
          this.component[next] = label;
          queue[tail++] = next;
        }
      }
    }
    this.gScore = new Float64Array(count);
    this.cameFrom = new Int32Array(count);
    this.stamp = new Int32Array(count);
    this.generation = 0;
  }

  /**
   * A\* com heurística euclidiana.
   *
   * A corda entre dois pontos é sempre ≤ a soma das cordas de qualquer caminho entre eles
   * (desigualdade triangular), então a heurística é admissível e o caminho é ótimo no grafo.
   * O arco geodésico NÃO seria admissível — ele é maior que a corda e superestimaria.
   */
  search(start: number, goal: number): NavSearchResult | undefined {
    if (start < 0 || goal < 0 || start >= this.size || goal >= this.size) return undefined;
    if (this.component.length !== this.size) this.finish();
    if (this.component[start] !== this.component[goal]) return undefined;
    if (start === goal) return {nodes: [start], distance: 0};
    const mark = ++this.generation;
    this.heap.clear();
    this.stamp[start] = mark; this.gScore[start] = 0; this.cameFrom[start] = -1;
    this.heap.push(start, this.distanceBetween(start, goal));
    const closed = new Set<number>();
    while (this.heap.size > 0) {
      const current = this.heap.pop();
      if (current === goal) break;
      if (closed.has(current)) continue;
      closed.add(current);
      const links = this.links[current]!, costs = this.costs[current]!;
      const base = this.gScore[current]!;
      for (let i = 0; i < links.length; i++) {
        const next = links[i]!, candidate = base + costs[i]!;
        if (this.stamp[next] === mark && this.gScore[next]! <= candidate) continue;
        this.stamp[next] = mark; this.gScore[next] = candidate; this.cameFrom[next] = current;
        this.heap.push(next, candidate + this.distanceBetween(next, goal));
      }
    }
    if (this.stamp[goal] !== mark) return undefined;
    const nodes: number[] = [goal];
    for (let at = goal; at !== start;) {
      const back = this.cameFrom[at]!;
      if (back < 0) return undefined;
      nodes.unshift(back); at = back;
    }
    return {nodes, distance: this.gScore[goal]!};
  }
}
