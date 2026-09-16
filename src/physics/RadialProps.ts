import type {Vec3} from '../core/contracts';
import {sweepBox} from './CollisionWorld';
import {FLOOR_COS, type SupportPoint, type SurfaceFrame, type SurfaceRayHit, type SurfaceSweepHit} from './SurfaceFrame';

/**
 * Corpos sólidos COMPACTOS criados em tempo de execução — hoje, os baús do planeta.
 *
 * ## Por que este arquivo existe
 *
 * Uma malha do Babylon **não colide com nada**. No mundo plano o baú era sólido porque o
 * `RunInteractables` empurrava uma `BoxCollider` para `CollisionWorld.movingBoxes`; no planeta o
 * apoio vem da `PlanetCollision`, que é uma BVH assada sobre o manifesto e **não contém** nada
 * criado depois. Sem este adaptador, o baú do planeta é desenhado e o jogador atravessa — é o
 * defeito que a revisão do root apontou.
 *
 * ## Por que não entrar na BVH do planeta
 *
 * A malha do planeta tem ~1,75 milhão de triângulos. Reassar a árvore para acrescentar uma caixa de
 * 12 triângulos custaria centenas de milissegundos por baú. Aqui a estrutura é uma LISTA de OBB com
 * rejeição por esfera envolvente: são dezenas de corpos, não milhões, então a varredura linear é
 * mais barata que qualquer árvore — e não há nada para reconstruir por quadro. `add`/`remove` são
 * O(1) e O(n).
 *
 * ## Como o teste exato é feito
 *
 * Cada corpo é uma caixa ORIENTADA (a vertical dele é a radial da ilha, não `+Y`). Levar o raio ou
 * a esfera para o espaço local da caixa transforma o problema em caixa alinhada aos eixos — e aí
 * reaproveito o `sweepBox` do `CollisionWorld`, que é função pura e já é o algoritmo contínuo do
 * jogo plano. Mesma matemática, outro referencial.
 *
 * Contrato publicado em `.temp/real-game-loot-api.md` §7.
 */

/** Um corpo sólido compacto, em coordenadas de MUNDO. */
export interface PropBox {
  readonly id: string;
  /** Centro do corpo. */
  readonly centre: Vec3;
  /** Base ortonormal local. `up` é a vertical do corpo — a radial da ilha, no planeta. */
  readonly right: Vec3;
  readonly up: Vec3;
  readonly forward: Vec3;
  /** Meias-extensões ao longo de `right`, `up` e `forward`. */
  readonly half: Vec3;
}

export interface PropRayHit extends SurfaceRayHit {readonly id: string}
export interface PropSweepHit {readonly time: number; readonly normal: Vec3; readonly id: string}

const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const sub = (a: Vec3, b: Vec3): Vec3 => ({x: a.x - b.x, y: a.y - b.y, z: a.z - b.z});
const add = (a: Vec3, b: Vec3, s = 1): Vec3 => ({x: a.x + b.x * s, y: a.y + b.y * s, z: a.z + b.z * s});
/** Vetor de mundo → componentes na base do corpo. */
const toLocal = (box: PropBox, v: Vec3): Vec3 => ({x: dot(v, box.right), y: dot(v, box.up), z: dot(v, box.forward)});
/** Componentes locais → vetor de mundo. */
const toWorld = (box: PropBox, v: Vec3): Vec3 => ({
  x: box.right.x * v.x + box.up.x * v.y + box.forward.x * v.z,
  y: box.right.y * v.x + box.up.y * v.y + box.forward.y * v.z,
  z: box.right.z * v.x + box.up.z * v.y + box.forward.z * v.z,
});

export class RadialProps {
  private readonly boxes: PropBox[] = [];
  /** Raio envolvente por corpo, na mesma ordem. Rejeição barata antes do teste exato. */
  private readonly bounds: number[] = [];

  get count(): number {return this.boxes.length;}
  /** Cópia só-leitura, para diagnóstico e teste. */
  get all(): readonly PropBox[] {return this.boxes;}

  add(box: PropBox): void {
    this.remove(box.id);
    this.boxes.push(box);
    this.bounds.push(Math.hypot(box.half.x, box.half.y, box.half.z));
  }

  remove(id: string): boolean {
    const index = this.boxes.findIndex(b => b.id === id);
    if (index < 0) return false;
    this.boxes.splice(index, 1); this.bounds.splice(index, 1);
    return true;
  }

  clear(): void {this.boxes.length = 0; this.bounds.length = 0;}

  /**
   * Raio contra os corpos. `direction` não precisa ser unitário.
   *
   * O raio é levado para o espaço da caixa e resolvido por fatias (slab). A normal devolvida é a
   * da FACE atingida, já em mundo — é ela que decide se o contato é piso ou parede lá em cima.
   */
  /**
   * Meia-extensão do corpo projetada num eixo unitário. É a largura REAL da caixa naquela direção,
   * não o raio envolvente — é o que permite limitar uma sonda infinita sem encolher corpo alto.
   */
  private extentAlong(box: PropBox, axis: Vec3): number {
    return Math.abs(box.half.x * dot(box.right, axis))
      + Math.abs(box.half.y * dot(box.up, axis))
      + Math.abs(box.half.z * dot(box.forward, axis));
  }

  /**
   * Distância, ao longo de `unit`, além da qual não existe mais corpo nenhum.
   *
   * É o limite ANALÍTICO que substitui um `Infinity` recebido: a projeção mais distante entre os
   * corpos, somada à extensão daquele corpo naquele eixo. Nenhum prop alto é perdido, porque a
   * extensão é medida no eixo da sonda em vez de chutada por uma janela pequena.
   * `undefined` quando não há corpo algum.
   */
  private reachAlong(origin: Vec3, unit: Vec3): number | undefined {
    let far = -Infinity;
    for (const box of this.boxes) far = Math.max(far, dot(sub(box.centre, origin), unit) + this.extentAlong(box, unit));
    return Number.isFinite(far) ? far : undefined;
  }

  raycast(origin: Vec3, direction: Vec3, maxDistance: number): PropRayHit | undefined {
    const length = Math.hypot(direction.x, direction.y, direction.z);
    if (length < 1e-12 || !(maxDistance > 0) || this.boxes.length === 0) return undefined;
    const unit = {x: direction.x / length, y: direction.y / length, z: direction.z / length};
    // `Infinity` (ou o `Number.MAX_VALUE` do `Ray` do Babylon) vira um alcance finito de verdade.
    const reach = this.reachAlong(origin, unit);
    if (reach === undefined || reach < 0) return undefined;
    maxDistance = Math.min(maxDistance, reach + 1e-3);
    if (!(maxDistance > 0)) return undefined;
    let best: PropRayHit | undefined;
    for (let i = 0; i < this.boxes.length; i++) {
      const box = this.boxes[i]!;
      // Rejeição barata: distância do centro à LINHA do raio, limitada ao trecho percorrido.
      const toCentre = sub(box.centre, origin), along = dot(toCentre, unit);
      if (along < -this.bounds[i]! || along > maxDistance + this.bounds[i]!) continue;
      const clamped = Math.max(0, Math.min(maxDistance, along));
      const near = sub(toCentre, {x: unit.x * clamped, y: unit.y * clamped, z: unit.z * clamped});
      if (Math.hypot(near.x, near.y, near.z) > this.bounds[i]!) continue;
      const hit = rayBox(box, origin, unit, best?.distance ?? maxDistance);
      if (hit) best = hit;
    }
    return best;
  }

  /**
   * Varredura de esfera. Mesma semântica de `SurfaceFrame.sweep`: `time` é a fração de `delta`.
   *
   * No espaço da caixa a esfera continua sendo esfera (a base é ortonormal), então o problema vira
   * esfera × AABB — exatamente o que `sweepBox` resolve, com a mesma tolerância do jogo plano.
   */
  sweep(from: Vec3, delta: Vec3, radius: number): PropSweepHit | undefined {
    const travel = Math.hypot(delta.x, delta.y, delta.z);
    let best: PropSweepHit | undefined;
    for (let i = 0; i < this.boxes.length; i++) {
      const box = this.boxes[i]!;
      const centreDistance = Math.hypot(from.x - box.centre.x, from.y - box.centre.y, from.z - box.centre.z);
      if (centreDistance > travel + radius + this.bounds[i]!) continue;
      const localOrigin = toLocal(box, sub(from, box.centre));
      const localDelta = toLocal(box, delta);
      const hit = sweepBox(localOrigin, localDelta,
        {id: box.id, min: {x: -box.half.x, y: -box.half.y, z: -box.half.z}, max: {x: box.half.x, y: box.half.y, z: box.half.z}},
        radius);
      if (!hit || (best && hit.time >= best.time)) continue;
      best = {time: hit.time, normal: toWorld(box, hit.normal), id: box.id};
    }
    return best;
  }

  /**
   * Apoio sob `p` ao longo de `up` — é isto que deixa o jogador FICAR EM PÉ no baú.
   *
   * Sonda de `p + up·above` descendo `above + below`, igual ao contrato de `SurfaceFrame.support`.
   * `offset` é quanto o apoio está abaixo de `p`; negativo quando está acima do pé.
   */
  support(p: Vec3, up: Vec3, above: number, below: number): (SupportPoint & {id: string}) | undefined {
    if (this.boxes.length === 0) return undefined;
    const down = {x: -up.x, y: -up.y, z: -up.z};
    // `above`/`below` infinitos são o contrato — `StageSpawn` sonda assim de propósito. Somar
    // `up · Infinity` produziria `NaN` em todo eixo zerado (com `up = (0,1,0)`, `0 · ∞ = NaN`) e o
    // apoio sumiria em silêncio. O limite vem das projeções REAIS dos corpos no eixo `up`.
    let top = -Infinity, bottom = Infinity;
    for (const box of this.boxes) {
      const centre = dot(sub(box.centre, p), up), extent = this.extentAlong(box, up);
      top = Math.max(top, centre + extent);
      bottom = Math.min(bottom, centre - extent);
    }
    // Começar mais baixo que o pedido nunca muda o primeiro contato descendo; começar mais ALTO
    // que o corpo mais alto só desperdiça alcance.
    const start = Math.min(above, top + 1e-3);
    const end = Number.isFinite(below) ? -below : bottom - 1e-3;
    const span = start - end;
    if (!(span > 0)) return undefined;
    const hit = this.raycast(add(p, up, start), down, span);
    if (!hit) return undefined;
    // Um convés apoia por qualquer face: a normal é orientada para o mesmo lado de `up`.
    const facing = dot(hit.normal, up);
    const normal = facing >= 0 ? hit.normal : {x: -hit.normal.x, y: -hit.normal.y, z: -hit.normal.z};
    return {
      point: hit.point, normal,
      // Geométrico, e não `distância − above`: assim o recorte do início da sonda não contamina o
      // resultado, e `offset` continua sendo "quanto o apoio está abaixo de `p`".
      offset: dot(sub(p, hit.point), up),
      slopeDegrees: Math.acos(Math.max(-1, Math.min(1, Math.abs(facing)))) * 180 / Math.PI,
      id: hit.id,
    };
  }

  /**
   * Varredura da CÁPSULA orientada por `up`, que é o corpo real do jogador.
   *
   * Uma esfera só no pé enxerga o baú, mas não enxerga saliência na altura do peito: o corpo
   * atravessaria a parte de cima do obstáculo. A cápsula é a união de esferas ao longo do segmento,
   * então amostrar esferas com espaçamento menor que o raio reconstrói o volume com folga máxima de
   * ~3 % do raio — conservador e sem inventar um kernel novo: cada esfera usa o mesmo `sweepBox`
   * contínuo do jogo plano, no espaço da caixa.
   */
  sweepCapsule(foot: Vec3, up: Vec3, delta: Vec3, radius: number, height: number): PropSweepHit | undefined {
    const low = radius, high = Math.max(radius, height - radius);
    const steps = Math.max(1, Math.min(16, Math.ceil((high - low) / Math.max(1e-3, radius * .5))));
    let best: PropSweepHit | undefined;
    for (let i = 0; i <= steps; i++) {
      const hit = this.sweep(add(foot, up, low + (high - low) * (i / steps)), delta, radius);
      if (hit && (!best || hit.time < best.time)) best = hit;
    }
    return best;
  }

  /**
   * Corpo dentro de um destes sólidos.
   *
   * Mesmo teste do `CollisionWorld.insideSolid` original: é o CENTRO da cápsula que precisa estar
   * estritamente dentro da caixa, com as mesmas margens (0,04 lateral, 0,02 vertical). Ficar em pé
   * EM CIMA não é estar dentro.
   */
  insideSolid(p: Vec3, up: Vec3, height: number, radius = 0): boolean {
    const centre = add(p, up, height * .5);
    for (const box of this.boxes) {
      const local = toLocal(box, sub(centre, box.centre));
      if (Math.abs(local.x) < box.half.x - radius - .04
        && Math.abs(local.z) < box.half.z - radius - .04
        && Math.abs(local.y) < box.half.y - .02) return true;
    }
    return false;
  }
}

/** Raio × caixa orientada, por fatias no espaço do corpo. */
function rayBox(box: PropBox, origin: Vec3, unit: Vec3, limit: number): PropRayHit | undefined {
  const o = toLocal(box, sub(origin, box.centre)), d = toLocal(box, unit);
  // Origem DENTRO do corpo não tem face de entrada. Sem esta guarda o teste de fatias devolvia um
  // contato a distância zero com a normal do eixo default (+X), e quem consultasse — a sonda de
  // degrau, uma bala disparada de dentro — recebia um apoio inventado. Penetração é assunto do
  // desencrave, como no resto do motor, não de um apoio fabricado aqui.
  if (Math.abs(o.x) < box.half.x && Math.abs(o.y) < box.half.y && Math.abs(o.z) < box.half.z) return undefined;
  let enter = 0, exit = limit;
  let axis: 'x' | 'y' | 'z' = 'x', sign = 1;
  for (const key of ['x', 'y', 'z'] as const) {
    const half = box.half[key];
    if (Math.abs(d[key]) < 1e-12) {if (o[key] < -half || o[key] > half) return undefined; continue;}
    const inv = 1 / d[key];
    let low = (-half - o[key]) * inv, high = (half - o[key]) * inv;
    // Normal EXTERNA da face de ENTRADA, e ela não depende da troca:
    //   d > 0 ⇒ entra pela face −h, normal −1;   d < 0 ⇒ entra pela face +h, normal +1.
    // A versão anterior invertia o sinal junto com a troca de `low`/`high`, que só acontece quando
    // `d < 0` — ou seja, justamente o caso em que o sinal inicial já estava certo. Toda sonda para
    // BAIXO (que é como `support` trabalha) devolvia a normal apontando para dentro do corpo.
    const facing = d[key] > 0 ? -1 : 1;
    if (low > high) {const t = low; low = high; high = t;}
    if (low > enter) {enter = low; axis = key; sign = facing;}
    exit = Math.min(exit, high);
    if (enter > exit) return undefined;
  }
  if (enter < 0 || enter > limit) return undefined;
  const local = {x: 0, y: 0, z: 0}; local[axis] = sign;
  return {distance: enter, point: add(origin, unit, enter), normal: toWorld(box, local), id: box.id};
}

/**
 * `SurfaceFrame` que enxerga o terreno E os corpos compactos.
 *
 * É o caminho de UMA LINHA para a integração deixar os baús sólidos sem que o dono da física
 * precise mexer no `SphereSurface`: basta entregar ao jogo `withProps(collision.surface, props)` em
 * vez de `collision.surface`. Quando a física absorver as consultas nativamente, este envoltório
 * some sem que nada mais mude — as assinaturas são as mesmas.
 *
 * Seis métodos são interceptados; todo o resto delega. `support` escolhe o apoio MAIS ALTO (menor
 * `offset`), que é o que faz o jogador subir no baú em vez de atravessá-lo; `slide` é o que impede
 * de atravessar o baú DE LADO. Sem `slide` o corpo seria meio-sólido: dava para ficar em pé em cima
 * e para andar através dele, que é pior do que não ter colisão nenhuma.
 */
export function withProps(base: SurfaceFrame, props: RadialProps): SurfaceFrame {
  const merged: SurfaceFrame = Object.create(base) as SurfaceFrame;
  return Object.assign(merged, {
    raycast(ray: Parameters<SurfaceFrame['raycast']>[0]): SurfaceRayHit | undefined {
      const ground = base.raycast(ray);
      const prop = props.raycast(ray.origin, ray.direction, ground?.distance ?? ray.length);
      return prop ?? ground;
    },
    slide(p: Vec3, delta: Vec3, radius: number, height: number, step: number,
          options?: Parameters<SurfaceFrame['slide']>[5]) {
      const up = base.up(p);
      // CÁPSULA inteira, não uma esfera no pé: com só o pé, uma saliência na altura do peito não
      // era vista e o corpo atravessava a parte de cima do obstáculo.
      const hit = props.sweepCapsule(p, up, delta, radius, height);
      if (!hit || hit.time >= 1) return base.slide(p, delta, radius, height, step, options);
      // Contato de PISO não barra o passo — quem resolve o vertical é `support`, dentro de
      // `stepHeight`. É a mesma divisão de trabalho do motor original; tratar o topo do baú como
      // parede tiraria do jogador a capacidade de subir nele, e isso seria mecânica nova.
      const floorCos = options?.floorCos ?? FLOOR_COS;
      if (options?.ignoreFloors && dot(hit.normal, up) >= floorCos) {
        return base.slide(p, delta, radius, height, step, options);
      }
      // DEGRAU. Bater na face de um corpo cujo topo cabe dentro de `step` não é parede: o motor
      // original anda na horizontal e deixa `support` encaixar o vertical. Barrar aqui tiraria o
      // degrau que o jogo plano sempre teve — seria mecânica a menos, não a mais. Um baú inteiro
      // (0,68 m) continua acima de `step` e portanto continua barrando: nele se sobe pulando.
      if (step > 0) {
        // O contato é o centro da cápsula, que fica `radius` FORA da face; sondar ali erra o corpo
        // por completo. A sonda entra um passo para dentro, ao longo da anti-normal.
        const inset = radius + .05;
        const contact = {
          x: p.x + delta.x * hit.time - hit.normal.x * inset,
          y: p.y + delta.y * hit.time - hit.normal.y * inset,
          z: p.z + delta.z * hit.time - hit.normal.z * inset,
        };
        const ledge = props.support(contact, up, step, 0);
        if (ledge) return base.slide(p, delta, radius, height, step, options);
      }
      // Avança até o contato e escorrega o resto NA FACE — a mesma regra do resolvedor de parede.
      const advance = Math.max(0, hit.time - .001);
      const first = base.slide(p, {x: delta.x * advance, y: delta.y * advance, z: delta.z * advance}, radius, height, step, options);
      const rest = {x: delta.x * (1 - advance), y: delta.y * (1 - advance), z: delta.z * (1 - advance)};
      const along = dot(rest, hit.normal);
      const slid = {x: rest.x - hit.normal.x * along, y: rest.y - hit.normal.y * along, z: rest.z - hit.normal.z * along};
      const second = base.slide(p, slid, radius, height, step, options);
      const floor = first.floor ?? second.floor, ceiling = first.ceiling ?? second.ceiling;
      return {
        moved: {x: first.moved.x + second.moved.x, y: first.moved.y + second.moved.y, z: first.moved.z + second.moved.z},
        verticalContact: first.verticalContact || second.verticalContact || dot(hit.normal, up) >= .5,
        blocked: true, stepped: first.stepped || second.stepped,
        ...(floor ? {floor} : {}), ...(ceiling ? {ceiling} : {}),
        wall: second.wall ?? first.wall ?? hit.normal,
      };
    },
    support(p: Vec3, above: number, below: number, maxSlopeDegrees?: number): SupportPoint | undefined {
      const ground = base.support(p, above, below, maxSlopeDegrees);
      const prop = props.support(p, base.up(p), above, below);
      if (!prop) return ground;
      if (maxSlopeDegrees !== undefined && prop.slopeDegrees > maxSlopeDegrees) return ground;
      return !ground || prop.offset < ground.offset ? prop : ground;
    },
    steepSupport(p: Vec3, above: number, below: number): SupportPoint | undefined {
      const ground = base.steepSupport(p, above, below);
      const prop = props.support(p, base.up(p), above, below);
      if (!prop) return ground;
      return !ground || prop.offset < ground.offset ? prop : ground;
    },
    sweep(from: Vec3, delta: Vec3, radius: number): SurfaceSweepHit | undefined {
      const ground = base.sweep(from, delta, radius);
      const prop = props.sweep(from, delta, radius);
      if (!prop) return ground;
      if (ground && ground.time <= prop.time) return ground;
      return {time: prop.time, normal: prop.normal, id: prop.id, topGap: Infinity};
    },
    insideSolid(p: Vec3, height: number): boolean {
      return base.insideSolid(p, height) || props.insideSolid(p, base.up(p), height);
    },
  });
}
