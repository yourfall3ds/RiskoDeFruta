import type {Vec3} from '../core/contracts';

/**
 * O ÂNGULO de um arremesso em parábola — o milho que o artilheiro joga por cima.
 *
 * Sem isto não há arco: apontar para o alvo e ligar a gravidade faz o projétil cair CURTO, porque a
 * velocidade toda foi gasta na horizontal. O que um lançamento em parábola exige é resolver o
 * ângulo: dada a velocidade de saída e a gravidade, qual inclinação põe o projétil em cima do alvo.
 *
 * É a equação clássica do tiro oblíquo, escrita na base LOCAL da superfície:
 *
 *   tan θ = ( v² ± √(v⁴ − g·(g·d² + 2·h·v²)) ) / (g·d)
 *
 * onde `d` é a distância no plano TANGENTE e `h` a diferença de altura ao longo da vertical local.
 * No planeta "para cima" é a normal da casca, não `+Y` — é o mesmo cuidado que o míssil e o leque da
 * PRISM já tomam, e é o que faz o arremesso funcionar no equador.
 *
 * **Sempre a raiz POSITIVA**, o arco ALTO. As duas raízes acertam o mesmo alvo: a baixa é um tiro
 * quase reto, a alta sobe e desce por cima. O pedido é o segundo — o projétil tem de passar por
 * cima da cobertura e cair na cabeça do jogador, e é o arco alto que dá ao jogador o tempo de ver
 * a sombra chegando e sair de baixo.
 *
 * Puro: sem Babylon, sem cena. Só aritmética.
 */

export interface LobSolution {
  /** Direção unitária de lançamento, em MUNDO. Multiplique pela velocidade. */
  readonly direction: Vec3;
  /** `true` quando o alvo estava ao alcance e o arco fecha em cima dele. */
  readonly reaches: boolean;
  /** Ângulo acima do plano tangente, em radianos. Diagnóstico e teste. */
  readonly elevation: number;
}

const EPSILON = 1e-6;

/**
 * Resolve o arremesso de `origin` para `target`.
 *
 * Fora de alcance (o discriminante fica negativo) devolve **45°** na direção do alvo, que é o
 * ângulo de alcance MÁXIMO: o projétil vai o mais longe que essa velocidade permite, em vez de a
 * criatura travar sem atirar. `reaches` conta a verdade para quem quiser decidir não atirar.
 *
 * Alvo em cima da própria origem (distância tangente ~zero) vira lançamento reto para cima.
 */
export function ballisticLob(
  origin: Vec3, target: Vec3, speed: number, gravity: number, up: Vec3,
): LobSolution {
  const upLength = Math.hypot(up.x, up.y, up.z) || 1;
  const ux = up.x / upLength, uy = up.y / upLength, uz = up.z / upLength;

  const dx = target.x - origin.x, dy = target.y - origin.y, dz = target.z - origin.z;
  // Decompõe o deslocamento em "altura ao longo da vertical local" e "distância no plano tangente".
  const height = dx * ux + dy * uy + dz * uz;
  const flatX = dx - ux * height, flatY = dy - uy * height, flatZ = dz - uz * height;
  const distance = Math.hypot(flatX, flatY, flatZ);

  if (!(speed > 0) || !(gravity > 0)) {
    // Sem gravidade não há parábola: é o tiro reto de sempre, na direção do alvo.
    const length = Math.hypot(dx, dy, dz) || 1;
    return {direction: {x: dx / length, y: dy / length, z: dz / length}, reaches: true, elevation: 0};
  }

  if (distance < EPSILON) {
    // Alvo na vertical: joga reto para cima (ou para baixo, se ele estiver abaixo).
    const sign = height >= 0 ? 1 : -1;
    return {direction: {x: ux * sign, y: uy * sign, z: uz * sign}, reaches: true, elevation: Math.PI / 2 * sign};
  }

  const fx = flatX / distance, fy = flatY / distance, fz = flatZ / distance;
  const v2 = speed * speed;
  const discriminant = v2 * v2 - gravity * (gravity * distance * distance + 2 * height * v2);

  // Fora de alcance: 45° é o ângulo que leva mais longe com esta velocidade.
  const elevation = discriminant < 0
    ? Math.PI / 4
    : Math.atan2(v2 + Math.sqrt(discriminant), gravity * distance);

  const cos = Math.cos(elevation), sin = Math.sin(elevation);
  return {
    direction: {x: fx * cos + ux * sin, y: fy * cos + uy * sin, z: fz * cos + uz * sin},
    reaches: discriminant >= 0,
    elevation,
  };
}

/**
 * O ALVO de intercepção: onde o jogador estará quando o projétil chegar.
 *
 * Mirar na posição atual erra todo alvo que anda de lado — o tempo de voo de um arco alto é longo o
 * bastante para o jogador sair de lá. Uma passada de ponto fixo basta: estima o tempo com a
 * distância atual, avança o alvo, mede de novo. Duas ou três iterações convergem e é mais barato
 * que resolver o polinômio exato.
 *
 * `lead` de 0 devolve a posição atual — é o que desliga a antecipação sem tirar o código do caminho.
 */
export function interceptPoint(
  origin: Vec3, target: Vec3, velocity: Vec3, speed: number, lead = 1, iterations = 3,
): Vec3 {
  if (!(speed > 0) || lead <= 0) return {x: target.x, y: target.y, z: target.z};
  let aim = {x: target.x, y: target.y, z: target.z};
  for (let i = 0; i < iterations; i++) {
    const distance = Math.hypot(aim.x - origin.x, aim.y - origin.y, aim.z - origin.z);
    const time = distance / speed;
    aim = {
      x: target.x + velocity.x * time * lead,
      y: target.y + velocity.y * time * lead,
      z: target.z + velocity.z * time * lead,
    };
  }
  return aim;
}
