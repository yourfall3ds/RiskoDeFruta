import type {Vec3} from '../core/contracts';
import type {Ray} from '@babylonjs/core/Culling/ray';
import {PLAYER_TUNING} from '../player/PlayerTuning';
import {cross, dot, normalize, quaternionFromBasis, type Quat, type SurfaceBasis} from '../planet/PlanetFrame';

export type {Quat, SurfaceBasis};
export {quaternionFromBasis};

/**
 * O único conceito novo do porte para o planeta: **quem responde "para cima"**.
 *
 * Todo `Vec3` de gameplay continua em COORDENADAS DE MUNDO — posição, velocidade, normal, direção
 * de tiro, alvo de IA. O que deixa de ser uma hipótese implícita (`up = +Y`) e passa a ser um
 * serviço injetado é a vertical local, e com ela: apoio, deslizamento, métrica planar, diferença
 * de altura e orientação de raiz.
 *
 * Duas implementações:
 *   - `FlatSurface` — delega para o `CollisionWorld` de hoje, com as MESMAS tolerâncias. No mundo
 *     plano `up = (0,1,0)`, `reference = (0,0,1)` e `right = (1,0,0)`, então os produtos escalares
 *     são identidades exatas (`v · (1,0,0) === v.x`) e nenhum número muda — é ela quem serve de
 *     oráculo de regressão.
 *   - `SphereSurface` — delega para `PlanetFrame` + `PlanetCollision` (BVH em espaço de mundo,
 *     sonda de apoio radial, cápsula orientada), já cobertos por testes próprios.
 *
 * Contrato publicado em `.temp/real-game-surface-api.md`.
 */

/** Amostra de apoio sob um ponto, medida ao longo da vertical LOCAL. Análogo de `groundAt`. */
export interface SupportPoint {
  /** Ponto de contato em espaço de MUNDO. Plano: `{x, groundAt(x,z), z}`. */
  point: Vec3;
  /** Normal já orientada para o mesmo lado de `up` — um convés apoia por qualquer face. */
  normal: Vec3;
  /**
   * Quanto o apoio está ABAIXO do ponto sondado, ao longo de `up(p)`. Negativo = acima do pé.
   * Plano: `p.y − groundAt(...)`.
   */
  offset: number;
  /** Ângulo entre a normal e a vertical local, em graus. */
  slopeDegrees: number;
}

export interface SurfaceSweepHit {
  /** Fração de `delta` percorrida até o contato, em [0,1]. */
  time: number;
  normal: Vec3;
  /**
   * Identidade ESTÁVEL da face, para deduplicar (o wall jump não repete na mesma parede).
   * Plano: `collider.id`. Esfera: normal quantizada — uma face plana inteira dá uma chave só,
   * em vez de uma chave por triângulo.
   */
  id: string;
  /**
   * Altura do topo do obstáculo ACIMA de `from`, ao longo de `up(from)`.
   * `Infinity` quando o topo não é conhecível (malha curva autoral): trate como alto o bastante.
   */
  topGap: number;
}

export interface SurfaceRayHit {distance: number; point: Vec3; normal: Vec3}

export interface SlideOptions {
  /**
   * Contatos de PISO não barram o passo — quem resolve o vertical é `support`, dentro de
   * `stepHeight`. É a divisão de trabalho do motor plano (`move` horizontal + encaixe vertical) e
   * é o que impede o travamento contra um leque de triângulos coplanares. Default: `false`.
   */
  ignoreFloors?: boolean;
  /** Tentar subir degrau até `step` quando uma parede barra. Default: `true`. */
  stepUp?: boolean;
  /** Cosseno da inclinação máxima caminhável. Default: `cos(PLAYER_TUNING.maxSlopeDegrees)`. */
  floorCos?: number;
}

export interface SlideResult {
  /** Deslocamento efetivamente aplicado a `p`, em MUNDO. */
  moved: Vec3;
  /** Contato de piso ou teto DE VERDADE — quem chama zera a velocidade radial. */
  verticalContact: boolean;
  /** Normal do último piso tocado. Só a esfera devolve normais; no plano use `sweep`. */
  floor?: Vec3;
  /** Normal do último teto tocado (bateu a cabeça). Só a esfera devolve normais. */
  ceiling?: Vec3;
  /** Normal da última parede tocada. Só a esfera devolve normais; no plano use `sweep`. */
  wall?: Vec3;
  /** O passo foi interrompido por parede. */
  blocked: boolean;
  /** O passo subiu um degrau. */
  stepped: boolean;
}

/**
 * Alvo de `orient`. O `TransformNode` do Babylon satisfaz estruturalmente.
 * Quando `rotationQuaternion` já existe ele é MUTADO no lugar — nada de alocar por quadro.
 */
export interface OrientTarget {
  readonly position: {x: number; y: number; z: number};
  readonly rotation: {x: number; y: number; z: number};
  rotationQuaternion: {x: number; y: number; z: number; w: number} | null;
}

export interface SurfaceFrame {
  readonly kind: 'flat' | 'sphere';

  // --- vertical local --------------------------------------------------------
  up(p: Vec3): Vec3;
  down(p: Vec3): Vec3;
  /** Altura relativa ao convés nominal. Plano: `p.y`. Esfera: `|p − centro| − R`. */
  altitude(p: Vec3): number;
  /** Mesma vertical, na altitude pedida. */
  atAltitude(p: Vec3, altitude: number): Vec3;
  /** Abaixo do limite do vazio: dano e volta ao último apoio. */
  belowVoid(p: Vec3): boolean;

  // --- apoio -----------------------------------------------------------------
  /**
   * Substitui `groundAt(x, z, maxHeight, maxSlope)`: sonda de `p + up·above` descendo
   * `above + below`. Para reproduzir `groundAt` exatamente, use `above = maxHeight − p.y` e
   * `below = Infinity` (que a implementação plana trata como "sem limite inferior").
   */
  support(p: Vec3, above: number, below: number, maxSlopeDegrees?: number): SupportPoint | undefined;
  /** Superfície real mais alta sob `p`, SEM descartar inclinação — análogo de `surfaceAt`. */
  steepSupport(p: Vec3, above: number, below: number): SupportPoint | undefined;

  // --- deslocamento ----------------------------------------------------------
  /** Avança `p` por `delta` (MUNDO, 3D) com deslizamento e degrau. **Muta `p`.** */
  slide(p: Vec3, delta: Vec3, radius: number, height: number, step: number, options?: SlideOptions): SlideResult;
  /** Varredura de esfera sem mover nada. Substitui `sweepSphere(o, d, r, true)`. */
  sweep(from: Vec3, delta: Vec3, radius: number): SurfaceSweepHit | undefined;
  /** Raio de mundo. Mesma semântica de `CollisionWorld.raycast(ray)`. */
  raycast(ray: Ray): SurfaceRayHit | undefined;
  /** Corpo dentro da geometria. Substitui `insideSolid(p, height)`. */
  insideSolid(p: Vec3, height: number): boolean;
  /** Empurrão para fora quando a cápsula apareceu dentro do sólido. Plano: não se aplica. */
  depenetrate(p: Vec3, radius: number, height: number): {depth: number; normal: Vec3} | undefined;

  // --- métrica ---------------------------------------------------------------
  /** Distância CAMINHANDO. Plano: `hypot(dx,dz)`. Esfera: arco no convés nominal. */
  planarDistance(a: Vec3, b: Vec3): number;
  /** Diferença de altura. Plano: `a.y − b.y`. Esfera: `dot(a − b, up(b))`. */
  heightGap(a: Vec3, b: Vec3): number;
  /** Anda uma tangente sobre a superfície. Plano: `p + d`. Esfera: passo geodésico exato. */
  walk(p: Vec3, tangentDelta: Vec3): Vec3;
  /** Transporte paralelo de uma tangente entre dois pontos. Plano: identidade. */
  transport(v: Vec3, from: Vec3, to: Vec3): Vec3;
  /** Chave de grade espacial coerente (separação de horda). */
  bucket(p: Vec3, size: number): string;

  // --- orientação ------------------------------------------------------------
  /** Base ortonormal em `p`; `forwardHint` só precisa ter projeção tangente. */
  basis(p: Vec3, forwardHint: Vec3): SurfaceBasis;
  /** Quaternion de raiz da base de `p` olhando para `forward`. */
  quaternion(p: Vec3, forward: Vec3): Quat;
  /** Posiciona e orienta um nó. Plano: `rotation.y`. Esfera: `rotationQuaternion` radial. */
  orient(node: OrientTarget, p: Vec3, forward: Vec3): void;
}

/** Cosseno da inclinação máxima caminhável — o mesmo limite do jogo plano. */
export const FLOOR_COS = Math.cos(PLAYER_TUNING.maxSlopeDegrees * Math.PI / 180);

/** Tangente de mundo a partir de componentes locais (`x` em `right`, `z` em `forward`). */
export function tangentFrom(basis: SurfaceBasis, x: number, z: number): Vec3 {
  return {
    x: basis.right.x * x + basis.forward.x * z,
    y: basis.right.y * x + basis.forward.y * z,
    z: basis.right.z * x + basis.forward.z * z,
  };
}

/** Componentes locais de um vetor de mundo: `{x: v·right, y: v·up, z: v·forward}`. */
export function localComponents(basis: SurfaceBasis, v: Vec3): Vec3 {
  return {x: dot(v, basis.right), y: dot(v, basis.up), z: dot(v, basis.forward)};
}

/**
 * Ângulo em torno de `up` que leva a tangente `reference` até `facing`.
 * Mão-esquerda, igual ao jogo: `right = up × forward`, `facing = (sin y, 0, cos y)`.
 */
export function localYawOf(up: Vec3, reference: Vec3, facing: Vec3): number {
  const forward = normalize(reference), right = cross(up, forward);
  const value = Math.atan2(dot(facing, right), dot(facing, forward));
  return Number.isFinite(value) ? value : 0;
}

/**
 * Folga do pé sobre a superfície de apoio por causa da ponta ARREDONDADA da cápsula.
 *
 * Numa rampa de inclinação θ, pousar o pé no ponto de contato da sonda enfia a esfera inferior
 * `r·(1 − cos θ)` dentro da rampa; o desencrave empurra ladeira abaixo e o corpo escorrega sozinho.
 * Levantar por `r·(1/cos θ − 1)` elimina a penetração na origem. É o mesmo termo do `supportGap`
 * do motor plano.
 */
export const contactLift = (radius: number, facing: number): number =>
  radius * (1 / Math.max(0.2, Math.min(1, facing)) - 1);
