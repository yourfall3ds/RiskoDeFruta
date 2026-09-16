import type {Vec3} from '../core/contracts';
import type {PlanetCollision} from '../planet/PlanetCollision';
import {PlanetFrame, add, anyPerpendicular, cross, normalize, scale, sub} from '../planet/PlanetFrame';
import type {IslandRecord} from './PlanetManifest';

/**
 * Validação de ponto de nascimento por SONDA RADIAL na malha real.
 *
 * O manifesto sugere um `spawn` por ilha, mas sugestão de autor não é apoio medido: se o ponto
 * caiu sobre uma rocha inclinada, dentro de um prop ou fora do convés, o corpo nasce escorregando
 * ou atravessa. Aqui a sonda desce pela vertical LOCAL, mede a inclinação contra `up` e exige
 * espaço livre acima da cabeça antes de aceitar.
 */
export interface SpawnProbe {
  /** Posição do pé, já pousada no apoio medido com uma folga mínima. */
  readonly position: Vec3;
  /** Vertical local no ponto aceito. */
  readonly up: Vec3;
  readonly slopeDegrees: number;
  /** Altura livre medida acima do apoio, limitada pela sonda. */
  readonly headroom: number;
}

export interface SpawnOptions {
  /** Inclinação máxima aceitável, em graus. */
  readonly maxSlopeDegrees: number;
  /** Altura do corpo — o espaço livre exigido acima do apoio. */
  readonly height: number;
  /** Quanto a sonda sobe antes de descer. */
  readonly above: number;
  /** Quanto a sonda desce abaixo do ponto pedido. */
  readonly below: number;
  /** Folga do pé sobre a superfície, para o primeiro passo não nascer encravado. */
  readonly clearance: number;
  /** Raio do anel de plataforma: uma pedra menor que isto não é lugar de chegada. */
  readonly platformRadius: number;
  /** Degrau máximo aceito dentro do anel de plataforma. */
  readonly platformStep: number;
  /**
   * `false` afrouxa só o anel de plataforma. Existe porque a alternativa, numa ilha cujo convés
   * inteiro reprova o anel, seria **nenhum** nascimento — e aí não há partida. Ver `findIslandSpawn`.
   */
  readonly requirePlatform: boolean;
}

export const SPAWN_DEFAULTS: SpawnOptions = {
  maxSlopeDegrees: 48,
  height: 4.4,
  above: 14,
  below: 26,
  clearance: 0.02,
  platformRadius: 1.6,
  platformStep: 0.7,
  requirePlatform: true,
};

const finite = (v: Vec3): boolean => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);

/**
 * Testa um ponto candidato. Devolve `undefined` quando não há apoio, quando a inclinação passa do
 * limite, ou quando existe geometria dentro da altura do corpo (nascer dentro de uma rocha).
 */
export function probeSpawn(
  collision: PlanetCollision,
  frame: PlanetFrame,
  candidate: Vec3,
  options: SpawnOptions = SPAWN_DEFAULTS,
): SpawnProbe | undefined {
  if (!finite(candidate)) return undefined;
  const up = frame.up(candidate);
  const support = collision.supportBelow(candidate, up, options.above, options.below);
  if (!support || !finite(support.point)) return undefined;
  if (!(support.slopeDegrees <= options.maxSlopeDegrees)) return undefined;
  // Espaço livre: sondar para cima a partir de um pouco acima do apoio. Um teto dentro da altura
  // do corpo significa que este "convés" é o piso de baixo de um prop fechado.
  const foot = add(support.point, scale(up, options.clearance));
  const ceiling = collision.raycast(add(foot, scale(up, 0.12)), up, options.height * 1.5);
  const headroom = ceiling ? ceiling.distance + 0.12 : options.height * 1.5;
  if (headroom < options.height) return undefined;
  // Arrival needs a clear body volume, not just a clear ray through its centre.
  const contact=collision.deepestContact(foot,up,.4,options.height);
  if(contact&&contact.depth>.015)return undefined;
  // A tiny rock or ledge is not a safe arrival platform.
  if(options.requirePlatform){
    const east=anyPerpendicular(up),north=cross(up,east);
    const reach=options.platformStep;
    for(let i=0;i<8;i++){
      const angle=i*Math.PI/4;
      const sample=add(foot,add(scale(east,Math.cos(angle)*options.platformRadius),scale(north,Math.sin(angle)*options.platformRadius)));
      const floor=collision.supportBelow(sample,frame.up(sample),reach,reach);
      if(!floor||floor.slopeDegrees>options.maxSlopeDegrees)return undefined;
    }
  }
  return {position: foot, up, slopeDegrees: support.slopeDegrees, headroom};
}

/**
 * Amostras em espiral no plano tangente da ilha, do centro para a borda.
 *
 * Gira pelo ângulo áureo para cobrir o disco sem repetir raio nem direção — uma grade quadrada
 * no plano tangente concentra amostras nos cantos e deixa buracos no meio.
 */
export function* islandSamples(island: IslandRecord, count: number, maxRadius: number): Generator<Vec3> {
  const up = normalize(island.up);
  const east = anyPerpendicular(up), north = cross(up, east);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const t = count <= 1 ? 0 : i / (count - 1);
    const radius = maxRadius * Math.sqrt(t), angle = i * golden;
    yield add(island.centre, add(scale(east, Math.cos(angle) * radius), scale(north, Math.sin(angle) * radius)));
  }
}

/**
 * Anel de candidatos em torno de um ponto, entre `near` e `far` metros de ARCO.
 *
 * É o que o nascimento de hostis usa: o passo é geodésico, então a distância é medida sobre a
 * superfície e não pela corda — a 34 m num raio de 200 m a diferença já é visível. Os pontos saem
 * na altitude do ponto de origem; quem decide se ali existe chão é a sonda, nunca este gerador.
 */
export function* ringSamples(
  frame: PlanetFrame, centre: Vec3, random: () => number, near: number, far: number, count: number,
): Generator<Vec3> {
  const up = frame.up(centre);
  const east = anyPerpendicular(up), north = cross(up, east);
  for (let i = 0; i < count; i++) {
    const angle = random() * Math.PI * 2;
    const radius = near + random() * Math.max(0, far - near);
    const offset = add(scale(east, Math.cos(angle) * radius), scale(north, Math.sin(angle) * radius));
    yield frame.geodesicStep(centre, offset).position;
  }
}

/**
 * Ponto de nascimento seguro na ilha: tenta o `spawn` do autor e, se ele não passar na sonda,
 * varre a pegada da ilha. Devolve `undefined` quando a ilha inteira reprova — é um mapa a
 * corrigir, não um caso para empurrar o corpo para um lugar qualquer.
 */
export function findIslandSpawn(
  collision: PlanetCollision,
  frame: PlanetFrame,
  island: IslandRecord,
  options: SpawnOptions = SPAWN_DEFAULTS,
  samples = 128,
): SpawnProbe | undefined {
  const authored = probeSpawn(collision, frame, island.spawn, options);
  if (authored&&Math.abs(frame.altitude(authored.position))<.55&&authored.slopeDegrees<8) return authored;
  // Duas passadas: a exigente primeiro. Se o convés inteiro reprovar o anel de plataforma —
  // relevo autoral acidentado, props no meio — vale mais um apoio simples medido do que deixar a
  // ilha sem nascimento nenhum. Reprovar as duas continua sendo `undefined`: é mapa a corrigir.
  for (const pass of [options, {...options, requirePlatform: false}]) {
    let best: SpawnProbe | undefined, bestScore = Infinity;
    for (const candidate of islandSamples(island, samples, island.radius * 0.85)) {
      const probe = probeSpawn(collision, frame, candidate, pass);
      if (!probe) continue;
      const score = spawnScore(frame, island, probe);
      if (score < bestScore) {best = probe; bestScore = score;}
    }
    if (best) return best;
    if (!options.requirePlatform) break;
  }
  return undefined;
}

/**
 * Menor é melhor. A altitude domina de propósito: sem ela a varredura aceitava o telhado de um
 * celeiro ou o topo de uma rocha a 15 m do convés — apoio de verdade, mas geologia, não a ilha.
 * Depois vem a distância ao centro (margem para o primeiro passo) e a inclinação.
 */
function spawnScore(frame: PlanetFrame, island: IslandRecord, probe: SpawnProbe): number {
  const altitude = Math.abs(frame.altitude(probe.position));
  const gap = Math.hypot(...axes(sub(probe.position, island.centre)));
  return altitude * 3 + gap * 0.2 + probe.slopeDegrees * 0.1;
}

const axes = (v: Vec3): [number, number, number] => [v.x, v.y, v.z];

/**
 * Ponto de retorno depois de cair no vazio: acima do convés da ilha segura.
 *
 * Nunca devolve um ponto de geologia arbitrária — o corpo reaparece sobre a mesma sonda validada,
 * com a folga de queda pedida, de modo que o primeiro quadro já tem apoio sob os pés.
 */
export function respawnAbove(probe: SpawnProbe, dropHeight = 1.2): Vec3 {
  return add(probe.position, scale(probe.up, Math.max(0, dropHeight)));
}
