import type {Vec3} from '../core/contracts';
import {capsuleTriangle, sweepCapsuleTriangle} from './OrientedCapsule';

/**
 * Colisão de triângulos em ESPAÇO DE MUNDO, sem nenhuma hipótese de "para cima".
 *
 * Entrada: exatamente o mesmo par `positions/indices` que o jogo já entrega hoje para
 * `CollisionWorld.setGeometry` — nenhum formato novo de asset é exigido. O Codex funde as malhas
 * de ilha/ponte já transformadas e passa aqui.
 *
 * O que substitui o quê:
 *   `groundAt(x, z)`            → `supportBelow(p, up, ...)`, sonda ao longo da vertical LOCAL
 *   `sweepCapsule` com Y fixo   → `sweepCapsule(base, axis, ...)`, eixo arbitrário
 *   inclinação por `normal.y`   → inclinação por `dot(normal, up)`
 */

export interface RayHit {distance: number; point: Vec3; normal: Vec3; triangle: number}
export interface CapsuleHit {time: number; normal: Vec3; triangle: number}
export interface SupportSample {
  /** Ponto de contato na superfície. */
  point: Vec3;
  /** Normal orientada para o mesmo lado de `up` — um convés apoia por qualquer face. */
  normal: Vec3;
  /** Quanto o apoio está ABAIXO do ponto sondado, medido ao longo de `up`. Negativo = acima. */
  offset: number;
  /** Ângulo entre a normal e a vertical local, em graus. */
  slopeDegrees: number;
  triangle: number;
}

interface Node {
  minX: number; minY: number; minZ: number;
  maxX: number; maxY: number; maxZ: number;
  start: number; end: number; left?: Node; right?: Node;
}

const LEAF = 12;

export class PlanetCollision {
  private positions = new Float64Array(0);
  private indices = new Int32Array(0);
  private order = new Int32Array(0);
  private root: Node | undefined;
  /** Máscara de triângulos removidos do mundo. `1` = ignorado por raio, varredura e apoio. */
  private disabled = new Uint8Array(0);
  /** Quantos triângulos estão removidos agora. Zero ⇒ nem se consulta a máscara. */
  private masked = 0;
  private readonly a: Vec3 = {x: 0, y: 0, z: 0};
  private readonly b: Vec3 = {x: 0, y: 0, z: 0};
  private readonly c: Vec3 = {x: 0, y: 0, z: 0};

  get triangleCount(): number {return this.order.length;}
  get ready(): boolean {return this.root !== undefined;}
  /** Triângulos hoje removidos por destruição. */
  get disabledCount(): number {return this.masked;}

  /**
   * Compact live geometry for local Havok bodies; traverses the existing BVH.
   *
   * `maxTriangles` é um TETO DE CUSTO, não uma regra de jogo: a malha que sai daqui vira um corpo
   * estático de Havok (`PhysicsShapeType.MESH`), e construir esse corpo é trabalho síncrono que
   * cresce com a contagem de triângulos. Numa ilha densa uma esfera de 16 m pode conter dezenas de
   * milhares de triângulos, e foi isso que transformou "um cadáver caiu" em um congelamento de
   * quadro. Estourado o teto, a varredura PARA e devolve o que já juntou — a travessia da BVH é
   * espacialmente coerente, então o que sobra é um pedaço contíguo em volta do ponto, não um
   * recorte salpicado. O limite honesto: um cadáver num aglomerado extremo pode ficar com chão
   * físico menor que o raio pedido.
   */
  trianglesAround(centre: Vec3, radius: number, maxTriangles = Infinity): {positions: number[]; indices: number[]} {
    const positions:number[]=[],indices:number[]=[],vertices=new Map<number,number>();
    const budget=Math.max(1,maxTriangles);
    const overlaps=(n:{minX:number;minY:number;minZ:number;maxX:number;maxY:number;maxZ:number}):boolean=>{
      const x=Math.max(n.minX-centre.x,0,centre.x-n.maxX);
      const y=Math.max(n.minY-centre.y,0,centre.y-n.maxY);
      const z=Math.max(n.minZ-centre.z,0,centre.z-n.maxZ);
      return x*x+y*y+z*z<=radius*radius;
    };
    const visit=(node:Node):void=>{
      if(indices.length>=budget*3)return;
      if(!overlaps(node))return;
      if(node.left&&node.right){visit(node.left);visit(node.right);return;}
      for(let i=node.start;i<node.end;i++){
        if(indices.length>=budget*3)return;
        const triangle=this.order[i]!;
        if(this.isTriangleDisabled(triangle))continue;
        this.load(triangle);
        if(!overlaps({minX:Math.min(this.a.x,this.b.x,this.c.x),maxX:Math.max(this.a.x,this.b.x,this.c.x),
          minY:Math.min(this.a.y,this.b.y,this.c.y),maxY:Math.max(this.a.y,this.b.y,this.c.y),
          minZ:Math.min(this.a.z,this.b.z,this.c.z),maxZ:Math.max(this.a.z,this.b.z,this.c.z)}))continue;
        for(let k=0;k<3;k++){
          const source=this.indices[triangle*3+k]!;
          let index=vertices.get(source);
          if(index===undefined){index=positions.length/3;vertices.set(source,index);
            positions.push(this.positions[source*3]!,this.positions[source*3+1]!,this.positions[source*3+2]!);}
          indices.push(index);
        }
      }
    };
    if(this.root&&radius>0)visit(this.root);
    return {positions,indices};
  }

  setGeometry(positions: ArrayLike<number>, indices: ArrayLike<number>): void {
    this.positions = Float64Array.from(positions as ArrayLike<number>);
    this.indices = Int32Array.from(indices as ArrayLike<number>);
    const count = Math.floor(this.indices.length / 3);
    this.order = new Int32Array(count);
    for (let i = 0; i < count; i++) this.order[i] = i;
    this.disabled = new Uint8Array(count);
    this.masked = 0;
    this.root = count > 0 ? this.build(0, count) : undefined;
  }

  /**
   * Remove do mundo um intervalo CONTÍGUO de triângulos — é assim que uma caixa quebrada deixa de
   * barrar bala e corpo.
   *
   * O custo é `count` escritas num `Uint8Array`: a BVH **não** é reconstruída. Com um milhão de
   * triângulos no planeta, refazer a árvore a cada tiro custaria centenas de milissegundos; o preço
   * escolhido aqui é uma leitura de byte por triângulo já testado, dentro de um teste de
   * Möller–Trumbore que é ordens de grandeza mais caro. Quando nada está removido (`masked === 0`)
   * nem essa leitura acontece.
   *
   * O intervalo é o mesmo `triangleStart`/`triangleCount` do manifesto, em TRIÂNGULOS.
   * Devolve quantos triângulos mudaram de estado — chamar duas vezes devolve zero na segunda.
   */
  disableTriangles(start: number, count: number): number {
    return this.setTriangleMask(start, count, 1);
  }

  /** Devolve ao mundo um intervalo removido. Usado na reinicialização da tentativa. */
  enableTriangles(start: number, count: number): number {
    return this.setTriangleMask(start, count, 0);
  }

  private setTriangleMask(start: number, count: number, value: 0 | 1): number {
    // O intervalo é recortado contra o buffer, não deslocado: um `start` negativo encolhe a janela
    // em vez de escorregar para o começo da malha e apagar o chão de outra pessoa.
    const first = Math.max(0, Math.floor(start));
    const last = Math.min(this.disabled.length, Math.floor(start) + Math.max(0, Math.floor(count)));
    let changed = 0;
    for (let t = first; t < last; t++) {
      if (this.disabled[t] === value) continue;
      this.disabled[t] = value;
      changed++;
    }
    this.masked += value === 1 ? changed : -changed;
    return changed;
  }

  /** Devolve o mundo inteiro. */
  clearDisabledTriangles(): void {
    if (this.masked === 0) return;
    this.disabled.fill(0);
    this.masked = 0;
  }

  isTriangleDisabled(triangle: number): boolean {
    return this.masked > 0 && this.disabled[triangle] === 1;
  }

  private load(triangle: number): void {
    const p = this.positions, x = this.indices;
    const i0 = x[triangle * 3]! * 3, i1 = x[triangle * 3 + 1]! * 3, i2 = x[triangle * 3 + 2]! * 3;
    this.a.x = p[i0]!; this.a.y = p[i0 + 1]!; this.a.z = p[i0 + 2]!;
    this.b.x = p[i1]!; this.b.y = p[i1 + 1]!; this.b.z = p[i1 + 2]!;
    this.c.x = p[i2]!; this.c.y = p[i2 + 1]!; this.c.z = p[i2 + 2]!;
  }

  private build(start: number, end: number): Node {
    const node: Node = {
      minX: Infinity, minY: Infinity, minZ: Infinity,
      maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity, start, end,
    };
    const p = this.positions, x = this.indices;
    for (let i = start; i < end; i++) {
      const t = this.order[i]!;
      for (let k = 0; k < 3; k++) {
        const o = x[t * 3 + k]! * 3, px = p[o]!, py = p[o + 1]!, pz = p[o + 2]!;
        if (px < node.minX) node.minX = px; if (px > node.maxX) node.maxX = px;
        if (py < node.minY) node.minY = py; if (py > node.maxY) node.maxY = py;
        if (pz < node.minZ) node.minZ = pz; if (pz > node.maxZ) node.maxZ = pz;
      }
    }
    if (end - start <= LEAF) return node;
    const spanX = node.maxX - node.minX, spanY = node.maxY - node.minY, spanZ = node.maxZ - node.minZ;
    const axis = spanX > spanY && spanX > spanZ ? 0 : spanY > spanZ ? 1 : 2;
    const middle = (axis === 0 ? node.minX + node.maxX : axis === 1 ? node.minY + node.maxY : node.minZ + node.maxZ) / 2;
    let cut = start;
    for (let i = start; i < end; i++) {
      const t = this.order[i]!;
      let centre = 0;
      for (let k = 0; k < 3; k++) centre += p[x[t * 3 + k]! * 3 + axis]!;
      if (centre / 3 < middle) {this.order[i] = this.order[cut]!; this.order[cut] = t; cut++;}
    }
    if (cut === start || cut === end) cut = (start + end) >> 1;
    node.left = this.build(start, cut);
    node.right = this.build(cut, end);
    return node;
  }

  /** Möller–Trumbore, frente e verso: a geometria autoral não tem orientação confiável. */
  raycast(origin: Vec3, direction: Vec3, maxDistance: number): RayHit | undefined {
    if (!this.root) return undefined;
    const dl = Math.hypot(direction.x, direction.y, direction.z);
    if (dl < 1e-12 || !(maxDistance > 0)) return undefined;
    const dx = direction.x / dl, dy = direction.y / dl, dz = direction.z / dl;
    const ix = 1 / dx, iy = 1 / dy, iz = 1 / dz;
    let nearest = maxDistance, found: RayHit | undefined;
    const stack: Node[] = [this.root];
    while (stack.length) {
      const n = stack.pop()!;
      let t0 = (n.minX - origin.x) * ix, t1 = (n.maxX - origin.x) * ix;
      let lo = Math.min(t0, t1), hi = Math.max(t0, t1);
      t0 = (n.minY - origin.y) * iy; t1 = (n.maxY - origin.y) * iy;
      lo = Math.max(lo, Math.min(t0, t1)); hi = Math.min(hi, Math.max(t0, t1));
      t0 = (n.minZ - origin.z) * iz; t1 = (n.maxZ - origin.z) * iz;
      lo = Math.max(lo, Math.min(t0, t1)); hi = Math.min(hi, Math.max(t0, t1));
      if (hi < Math.max(lo, 0) || lo > nearest) continue;
      if (n.left && n.right) {stack.push(n.left, n.right); continue;}
      for (let i = n.start; i < n.end; i++) {
        const triangle = this.order[i]!;
        if (this.masked > 0 && this.disabled[triangle] === 1) continue;
        this.load(triangle);
        const {a, b, c} = this;
        const e1x = b.x - a.x, e1y = b.y - a.y, e1z = b.z - a.z;
        const e2x = c.x - a.x, e2y = c.y - a.y, e2z = c.z - a.z;
        const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
        const det = e1x * px + e1y * py + e1z * pz;
        if (Math.abs(det) < 1e-12) continue;
        const inv = 1 / det;
        const tx = origin.x - a.x, ty = origin.y - a.y, tz = origin.z - a.z;
        const u = (tx * px + ty * py + tz * pz) * inv;
        if (u < -1e-9 || u > 1 + 1e-9) continue;
        const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
        const v = (dx * qx + dy * qy + dz * qz) * inv;
        if (v < -1e-9 || u + v > 1 + 1e-9) continue;
        const distance = (e2x * qx + e2y * qy + e2z * qz) * inv;
        if (distance < 1e-6 || distance >= nearest) continue;
        const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
        const nl = Math.hypot(nx, ny, nz) || 1;
        nearest = distance;
        found = {
          distance,
          point: {x: origin.x + dx * distance, y: origin.y + dy * distance, z: origin.z + dz * distance},
          normal: {x: nx / nl, y: ny / nl, z: nz / nl},
          triangle,
        };
      }
    }
    return found;
  }

  /**
   * Sonda de apoio ao longo da vertical local: parte de `p + up·above` e desce `above + below`.
   * É o análogo exato de `groundAt(x, z)` num mundo curvo.
   *
   * A normal sai orientada para o mesmo lado de `up`: uma face autoral apoia por qualquer lado,
   * como já acontece em `TriangleGround`, e assim o sentido do winding do GLB não vira bug.
   */
  supportBelow(p: Vec3, up: Vec3, above: number, below: number): SupportSample | undefined {
    const origin = {x: p.x + up.x * above, y: p.y + up.y * above, z: p.z + up.z * above};
    const hit = this.raycast(origin, {x: -up.x, y: -up.y, z: -up.z}, above + below);
    if (!hit) return undefined;
    let {x: nx, y: ny, z: nz} = hit.normal;
    let facing = nx * up.x + ny * up.y + nz * up.z;
    if (facing < 0) {nx = -nx; ny = -ny; nz = -nz; facing = -facing;}
    return {
      point: hit.point,
      normal: {x: nx, y: ny, z: nz},
      offset: hit.distance - above,
      slopeDegrees: Math.acos(Math.min(1, Math.max(-1, facing))) * 180 / Math.PI,
      triangle: hit.triangle,
    };
  }

  /**
   * Varredura da cápsula orientada. `base` é o pé, `axis` a vertical local (unitária),
   * `delta` o deslocamento do passo em espaço de mundo.
   *
   * `skipFloorDot` descarta contatos cuja normal tem `dot(normal, axis) >= skipFloorDot`.
   * Serve ao deslocamento de quem já está apoiado: um piso não barra movimento tangencial, e sem
   * esse filtro um leque de triângulos coplanares (o ápice de uma calota, por exemplo) devolve
   * contato em `time = 0` por iteração e o corpo trava sem sair do lugar. Quem cuida do vertical
   * nesse caso é a sonda de apoio, exatamente como `CollisionWorld.move` faz no jogo plano.
   */
  sweepCapsule(
    base: Vec3, axis: Vec3, delta: Vec3, radius: number, height: number, skipFloorDot?: number,
  ): CapsuleHit | undefined {
    if (!this.root) return undefined;
    const low = radius, high = Math.max(radius, height - radius);
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const t of [low, high]) {
      for (const s of [0, 1]) {
        const x = base.x + axis.x * t + delta.x * s;
        const y = base.y + axis.y * t + delta.y * s;
        const z = base.z + axis.z * t + delta.z * s;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
      }
    }
    minX -= radius; minY -= radius; minZ -= radius;
    maxX += radius; maxY += radius; maxZ += radius;
    let found: CapsuleHit | undefined;
    const stack: Node[] = [this.root];
    while (stack.length) {
      const n = stack.pop()!;
      if (n.maxX < minX || n.minX > maxX || n.maxY < minY || n.minY > maxY || n.maxZ < minZ || n.minZ > maxZ) continue;
      if (n.left && n.right) {stack.push(n.left, n.right); continue;}
      for (let i = n.start; i < n.end; i++) {
        const triangle = this.order[i]!;
        if (this.masked > 0 && this.disabled[triangle] === 1) continue;
        this.load(triangle);
        const hit = sweepCapsuleTriangle(base, axis, delta, radius, height, this.a, this.b, this.c);
        if (!hit) continue;
        if (skipFloorDot !== undefined) {
          const facing = hit.normal.x * axis.x + hit.normal.y * axis.y + hit.normal.z * axis.z;
          if (facing >= skipFloorDot) continue;
        }
        if (!found || hit.time < found.time) found = {time: hit.time, normal: hit.normal, triangle};
      }
    }
    return found;
  }

  /**
   * Contato estático mais profundo da cápsula parada. Usado para desencravar um corpo que
   * apareceu dentro da geometria (troca de bioma, recuperação, teleporte de depuração).
   */
  deepestContact(base: Vec3, axis: Vec3, radius: number, height: number): {depth: number; normal: Vec3} | undefined {
    if (!this.root) return undefined;
    const low = radius, high = Math.max(radius, height - radius);
    const minX = base.x + Math.min(axis.x * low, axis.x * high) - radius;
    const maxX = base.x + Math.max(axis.x * low, axis.x * high) + radius;
    const minY = base.y + Math.min(axis.y * low, axis.y * high) - radius;
    const maxY = base.y + Math.max(axis.y * low, axis.y * high) + radius;
    const minZ = base.z + Math.min(axis.z * low, axis.z * high) - radius;
    const maxZ = base.z + Math.max(axis.z * low, axis.z * high) + radius;
    let best: {depth: number; normal: Vec3} | undefined;
    const stack: Node[] = [this.root];
    while (stack.length) {
      const n = stack.pop()!;
      if (n.maxX < minX || n.minX > maxX || n.maxY < minY || n.minY > maxY || n.maxZ < minZ || n.minZ > maxZ) continue;
      if (n.left && n.right) {stack.push(n.left, n.right); continue;}
      for (let i = n.start; i < n.end; i++) {
        const triangle = this.order[i]!;
        if (this.masked > 0 && this.disabled[triangle] === 1) continue;
        this.load(triangle);
        const near = capsuleTriangle(base, axis, radius, height, this.a, this.b, this.c);
        const depth = radius - near.distance;
        if (depth > 1e-4 && (!best || depth > best.depth)) best = {depth, normal: near.normal};
      }
    }
    return best;
  }
}
