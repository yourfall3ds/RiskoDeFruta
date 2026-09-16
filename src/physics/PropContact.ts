import type {Vec3} from '../core/contracts';
import type {PropBox, RadialProps} from './RadialProps';
import {FLOOR_COS, type SlideResult, type SurfaceFrame, type SurfaceRayHit} from './SurfaceFrame';

/**
 * Camada de CONTATO dos corpos compactos, por cima do `withProps` do dono do loot.
 *
 * ## Por que ela existe (medido, não suposto)
 *
 * `withProps` mescla corretamente as consultas de CONSULTA — `support`, `steepSupport`, `sweep` e
 * `raycast` — e é por isso que o jogador já sobe no baú. Mas `slide` lá é resolvido por VARREDURA, e
 * varredura só descreve o quadro do PRIMEIRO toque. `sweepBox` devolve `{time: 0, normal: (0,0,0)}`
 * assim que o centro da esfera entra na caixa expandida pelo raio: aí `along = dot(rest, 0) = 0`, o
 * deslocamento inteiro é reaplicado e o corpo **atravessa**. Medição em
 * `.temp/real-game-physics-props-result.md` §2: a janela de bloqueio é de 2 mm de arco (de
 * `localZ = −0.751` para `−0.749`) e depois o baú deixa de barrar.
 *
 * O contato SUSTENTADO não é varredura, é penetração: a esfera inferior da cápsula contra a OBB,
 * empurrada pelo eixo de menor profundidade. É isso que esta camada faz, DEPOIS do passo, e é o que
 * transforma "meio-sólido" em sólido.
 *
 * Dois defeitos menores do mesmo módulo também são corrigidos aqui, na fronteira:
 *
 * - `RadialProps.insideSolid` estica a caixa pela meia-altura do corpo
 *   (`|local.y| < half.y + height/2`), então ficar EM PÉ AO LADO de um caixote na altura do joelho,
 *   com a cintura sobre a pegada dele, conta como "enterrado" — e o motor original teleporta para o
 *   ponto seguro, num laço. Aqui "enterrado" volta a ser o que a palavra diz: o PÉ dentro da caixa.
 * - `RadialProps.raycast` devolve a normal da face de ENTRADA invertida (aponta para dentro do
 *   corpo). Um tiro de cima no baú devolvia `dot(normal, up) = −1`. Aqui a normal é orientada contra
 *   a direção do raio, que é o contrato universal de um `raycast`.
 *
 * Nada em `src/physics/RadialProps.ts` foi editado — é propriedade do dono do loot, e a nota com
 * estes três pontos está no resultado desta sessão. Quando ele corrigir na origem, esta camada pode
 * sair sem que nenhuma assinatura mude.
 */

const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const sub = (a: Vec3, b: Vec3): Vec3 => ({x: a.x - b.x, y: a.y - b.y, z: a.z - b.z});
const clamp = (v: number, limit: number): number => v < -limit ? -limit : v > limit ? limit : v;
const toLocal = (box: PropBox, v: Vec3): Vec3 => ({x: dot(v, box.right), y: dot(v, box.up), z: dot(v, box.forward)});
const toWorld = (box: PropBox, v: Vec3): Vec3 => ({
  x: box.right.x * v.x + box.up.x * v.y + box.forward.x * v.z,
  y: box.right.y * v.x + box.up.y * v.y + box.forward.y * v.z,
  z: box.right.z * v.x + box.up.z * v.y + box.forward.z * v.z,
});

/** Folga de contato: abaixo disto não vale empurrar, é ruído de ponto flutuante. */
const CONTACT_EPSILON = 1e-4;

/**
 * Penetração de uma esfera contra uma caixa ORIENTADA, resolvida no espaço do corpo.
 *
 * Fora da caixa: o vetor do ponto mais próximo até o centro dá direção e profundidade. Centro DENTRO
 * da caixa: não existe direção mais próxima, então o empurrão sai pelo eixo de menor penetração —
 * é o que evita escolher a face errada e cuspir o corpo pelo lado oposto.
 */
export function spherePush(box: PropBox, centre: Vec3, radius: number): {depth: number; normal: Vec3} | undefined {
  const local = toLocal(box, sub(centre, box.centre));
  const nx = clamp(local.x, box.half.x), ny = clamp(local.y, box.half.y), nz = clamp(local.z, box.half.z);
  const dx = local.x - nx, dy = local.y - ny, dz = local.z - nz;
  const outside = dx * dx + dy * dy + dz * dz;
  if (outside > 1e-12) {
    const distance = Math.sqrt(outside);
    if (distance >= radius) return undefined;
    return {depth: radius - distance, normal: toWorld(box, {x: dx / distance, y: dy / distance, z: dz / distance})};
  }
  const px = box.half.x - Math.abs(local.x), py = box.half.y - Math.abs(local.y), pz = box.half.z - Math.abs(local.z);
  const axis: Vec3 = {x: 0, y: 0, z: 0};
  let depth: number;
  if (px <= py && px <= pz) {axis.x = local.x < 0 ? -1 : 1; depth = px + radius;}
  else if (py <= pz) {axis.y = local.y < 0 ? -1 : 1; depth = py + radius;}
  else {axis.z = local.z < 0 ? -1 : 1; depth = pz + radius;}
  return {depth, normal: toWorld(box, axis)};
}

/** `p` está DENTRO de um destes corpos, com folga — o pé enterrado, não a cintura de passagem. */
export function buriedInProps(registries: Iterable<RadialProps>, p: Vec3, margin = .04): boolean {
  for (const props of registries) {
    for (const box of props.all) {
      const local = toLocal(box, sub(p, box.centre));
      if (Math.abs(local.x) < box.half.x - margin
        && Math.abs(local.y) < box.half.y - margin
        && Math.abs(local.z) < box.half.z - margin) return true;
    }
  }
  return false;
}

/**
 * Envolve um `SurfaceFrame` (já mesclado por `withProps`) com o contato sustentado.
 *
 * Só três métodos são interceptados; todo o resto — inclusive `support`, que é o que faz subir no
 * baú — continua vindo do `withProps`.
 */
export function withPropContact(
  base: SurfaceFrame, registries: readonly RadialProps[],
  /**
   * O referencial de TERRENO, sem envoltório. `insideSolid` precisa dele porque a versão do
   * `withProps` inclui o teste de "enterrado" que dá o falso positivo descrito acima — delegar para
   * a cadeia manteria o laço de teleporte.
   */
  terrain: SurfaceFrame,
): SurfaceFrame {
  const merged: SurfaceFrame = Object.create(base) as SurfaceFrame;
  return Object.assign(merged, {
    /**
     * Passo normal e, depois dele, desencrave do contato sustentado.
     *
     * O empurrão é ao longo da normal da face, para FORA — nunca para dentro da geometria — e a
     * normal encontrada é devolvida como piso ou parede, então o motor original zera a componente
     * de velocidade que entrava na face, exatamente como faz contra o terreno.
     */
    slide(p: Vec3, delta: Vec3, radius: number, height: number, step: number,
          options?: Parameters<SurfaceFrame['slide']>[5]): SlideResult {
      const start = {x: p.x, y: p.y, z: p.z};
      const result = base.slide(p, delta, radius, height, step, options);
      const up = base.up(p);
      const floorCos = options?.floorCos ?? FLOOR_COS;
      let floor = result.floor, ceiling = result.ceiling, wall = result.wall;
      let blocked = result.blocked, vertical = result.verticalContact, pushed = false;
      // Três iterações resolvem quina entre dois corpos; mais que isso é corpo dentro de corpo.
      for (let pass = 0; pass < 3; pass++) {
        const centre = {x: p.x + up.x * radius, y: p.y + up.y * radius, z: p.z + up.z * radius};
        let worst: {depth: number; normal: Vec3} | undefined;
        for (const props of registries) {
          for (const box of props.all) {
            const push = spherePush(box, centre, radius);
            if (push && push.depth > CONTACT_EPSILON && (!worst || push.depth > worst.depth)) worst = push;
          }
        }
        if (!worst) break;
        p.x += worst.normal.x * worst.depth; p.y += worst.normal.y * worst.depth; p.z += worst.normal.z * worst.depth;
        pushed = true;
        const facing = dot(worst.normal, up);
        if (facing >= floorCos) {floor ??= worst.normal; vertical = true;}
        else if (facing <= -.2) {ceiling ??= worst.normal; vertical = true;}
        else wall = worst.normal;
      }
      if (!pushed) return result;
      blocked = true;
      return {
        moved: sub(p, start), verticalContact: vertical, blocked, stepped: result.stepped,
        ...(floor ? {floor} : {}), ...(ceiling ? {ceiling} : {}), ...(wall ? {wall} : {}),
      };
    },
    /** Enterrado = o PÉ dentro do corpo. Estar em pé ao lado de um caixote não é estar enterrado. */
    insideSolid(p: Vec3, height: number): boolean {
      return terrain.insideSolid(p, height) || buriedInProps(registries, p);
    },
    /** Normal do raio orientada CONTRA a direção dele, como todo `raycast` promete. */
    raycast(ray: Parameters<SurfaceFrame['raycast']>[0]): SurfaceRayHit | undefined {
      const hit = base.raycast(ray);
      if (!hit) return hit;
      if (dot(hit.normal, ray.direction) <= 0) return hit;
      return {distance: hit.distance, point: hit.point, normal: {x: -hit.normal.x, y: -hit.normal.y, z: -hit.normal.z}};
    },
  });
}
