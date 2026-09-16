import type {Vec3} from '../core/contracts';
import type {BridgeRecord, IslandRecord, PlanetManifest} from './PlanetManifest';

/**
 * Grafo de travessia do arquipélago: ilhas ligadas SÓ por pontes autorais.
 *
 * Existe porque no planeta a linha reta entre duas ilhas atravessa o vazio. Qualquer coisa que
 * precise "ir até lá" — o objetivo do cálice, a navegação das pragas, a seta do HUD — tem de
 * medir distância pelo caminho que um corpo realmente anda: ponte por ponte.
 */
export interface SurfaceRoute {
  /** Ilhas visitadas, da origem ao destino. */
  readonly islands: readonly string[];
  /** Polilinha no convés, já orientada da origem ao destino. */
  readonly waypoints: readonly Vec3[];
  /** Comprimento da polilinha em metros (corda somada; o arco por vão é ~igual nesta escala). */
  readonly length: number;
  /** Pontes atravessadas. */
  readonly hops: number;
}

const distance = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

export class PlanetGraph {
  private readonly byId = new Map<string, IslandRecord>();
  /** `a -> b -> ponte`, já nos dois sentidos. */
  private readonly links = new Map<string, Map<string, BridgeRecord>>();
  readonly radius: number;
  readonly centre: Vec3;

  constructor(manifest: PlanetManifest) {
    this.radius = manifest.radius;
    this.centre = manifest.centre;
    for (const entry of manifest.islands) {
      this.byId.set(entry.id, entry);
      this.links.set(entry.id, new Map());
    }
    for (const span of manifest.bridges) {
      if (span.a === span.b) continue;
      this.links.get(span.a)?.set(span.b, span);
      this.links.get(span.b)?.set(span.a, span);
    }
  }

  get islands(): readonly IslandRecord[] {return [...this.byId.values()];}
  get size(): number {return this.byId.size;}
  island(id: string): IslandRecord | undefined {return this.byId.get(id);}
  neighbours(id: string): readonly string[] {return [...(this.links.get(id)?.keys() ?? [])];}

  /** `true` quando toda ilha é alcançável a pé a partir de `from`. */
  connected(from: string): boolean {
    return this.reach(from).size === this.byId.size;
  }

  /** Número de pontes até cada ilha (a própria origem conta 0). */
  reach(from: string): Map<string, number> {
    const seen = new Map<string, number>();
    if (!this.byId.has(from)) return seen;
    seen.set(from, 0);
    const queue = [from];
    for (let head = 0; head < queue.length; head++) {
      const current = queue[head]!, depth = seen.get(current)!;
      for (const next of this.links.get(current)?.keys() ?? []) {
        if (seen.has(next)) continue;
        seen.set(next, depth + 1);
        queue.push(next);
      }
    }
    return seen;
  }

  /** Ângulo central entre os convés de duas ilhas, em radianos. */
  centralAngle(a: string, b: string): number {
    const ua = this.byId.get(a)?.up, ub = this.byId.get(b)?.up;
    if (!ua || !ub) return NaN;
    const cross = {
      x: ua.y * ub.z - ua.z * ub.y,
      y: ua.z * ub.x - ua.x * ub.z,
      z: ua.x * ub.y - ua.y * ub.x,
    };
    return Math.atan2(Math.hypot(cross.x, cross.y, cross.z), ua.x * ub.x + ua.y * ub.y + ua.z * ub.z);
  }

  /** Distância de grande círculo entre dois convés, em metros. */
  arcDistance(a: string, b: string): number {return this.centralAngle(a, b) * this.radius;}

  /**
   * Ilha alvo "longe" a partir de `from`: primeiro pelo número de pontes, e só depois pelo arco.
   *
   * O critério é grafo primeiro de propósito. Duas ilhas podem estar a poucos metros de arco e
   * ainda assim exigir a volta inteira porque não há ponte entre elas — e é a caminhada que o
   * jogador sente, não a corda. `minHops` recusa vizinhas mesmo quando o mapa é pequeno.
   */
  farthestFrom(from: string, minHops = 2): IslandRecord | undefined {
    const reach = this.reach(from);
    let best: IslandRecord | undefined, bestHops = -1, bestArc = -1;
    for (const [id, hops] of reach) {
      if (id === from || hops < minHops) continue;
      const arc = this.arcDistance(from, id);
      if (hops > bestHops || (hops === bestHops && arc > bestArc)) {
        best = this.byId.get(id); bestHops = hops; bestArc = arc;
      }
    }
    return best;
  }

  /**
   * Candidatas ordenadas do mais longe para o mais perto, para um sorteio com peso.
   * Usado pela escolha do cálice: longe sempre, mas não sempre a MESMA ilha.
   */
  rankedTargets(from: string, minHops = 2): readonly IslandRecord[] {
    const reach = this.reach(from);
    const list: {island: IslandRecord; hops: number; arc: number}[] = [];
    for (const [id, hops] of reach) {
      const entry = this.byId.get(id);
      if (!entry || id === from || hops < minHops) continue;
      list.push({island: entry, hops, arc: this.arcDistance(from, id)});
    }
    list.sort((a, b) => b.hops - a.hops || b.arc - a.arc);
    return list.map(entry => entry.island);
  }

  /** Polilinha do convés da ponte entre `a` e `b`, orientada de `a` para `b`. */
  bridgeWaypoints(a: string, b: string): readonly Vec3[] | undefined {
    const span = this.links.get(a)?.get(b);
    if (!span) return undefined;
    return span.a === a ? span.waypoints : [...span.waypoints].reverse();
  }

  /**
   * Caminho de superfície entre duas ilhas: Dijkstra sobre o comprimento REAL das pontes.
   *
   * O peso é o comprimento da polilinha somado ao arco de travessia das ilhas; sem isso um
   * caminho de uma ponte enorme parecia melhor que dois vãos curtos.
   */
  route(from: string, to: string): SurfaceRoute | undefined {
    if (!this.byId.has(from) || !this.byId.has(to)) return undefined;
    if (from === to) {
      const centre = this.byId.get(from)!.centre;
      return {islands: [from], waypoints: [centre], length: 0, hops: 0};
    }
    const cost = new Map<string, number>([[from, 0]]);
    const previous = new Map<string, string>();
    const pending = new Set<string>([from]);
    while (pending.size > 0) {
      let current: string | undefined, best = Infinity;
      for (const id of pending) {
        const value = cost.get(id) ?? Infinity;
        if (value < best) {best = value; current = id;}
      }
      if (current === undefined) break;
      pending.delete(current);
      if (current === to) break;
      for (const [next, span] of this.links.get(current) ?? []) {
        const candidate = best + this.spanLength(span);
        if (candidate >= (cost.get(next) ?? Infinity)) continue;
        cost.set(next, candidate); previous.set(next, current); pending.add(next);
      }
    }
    if (!cost.has(to)) return undefined;
    const islands: string[] = [to];
    for (let at = to; at !== from;) {
      const back = previous.get(at);
      if (back === undefined) return undefined;
      islands.unshift(back); at = back;
    }
    const waypoints: Vec3[] = [this.byId.get(from)!.centre];
    for (let i = 1; i < islands.length; i++) {
      const span = this.bridgeWaypoints(islands[i - 1]!, islands[i]!) ?? [];
      for (const point of span) waypoints.push(point);
      waypoints.push(this.byId.get(islands[i]!)!.centre);
    }
    let length = 0;
    for (let i = 1; i < waypoints.length; i++) length += distance(waypoints[i - 1]!, waypoints[i]!);
    return {islands, waypoints, length, hops: islands.length - 1};
  }

  private spanLength(span: BridgeRecord): number {
    let total = 0;
    for (let i = 1; i < span.waypoints.length; i++) total += distance(span.waypoints[i - 1]!, span.waypoints[i]!);
    return total;
  }

  /** Ilha cujo convés está mais próximo angularmente do ponto dado. */
  islandAt(position: Vec3): IslandRecord | undefined {
    const norm = Math.hypot(position.x - this.centre.x, position.y - this.centre.y, position.z - this.centre.z);
    if (norm < 1e-6) return undefined;
    const up = {
      x: (position.x - this.centre.x) / norm,
      y: (position.y - this.centre.y) / norm,
      z: (position.z - this.centre.z) / norm,
    };
    let best: IslandRecord | undefined, bestDot = -Infinity;
    for (const entry of this.byId.values()) {
      const value = entry.up.x * up.x + entry.up.y * up.y + entry.up.z * up.z;
      if (value > bestDot) {bestDot = value; best = entry;}
    }
    return best;
  }
}
