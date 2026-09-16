import type {Vec3} from '../core/contracts';
import {
  IntroSequence, INTRO_LEAP_SECONDS, INTRO_RUN_SECONDS,
  type IntroCue, type IntroPhase,
} from '../player/IntroSequence';
import {PlanetFrame, add, anyPerpendicular, copy, cross, length, normalize, reject, scale} from '../planet/PlanetFrame';

/**
 * Chegada no planeta: a MESMA entrada cinematográfica do jogo plano, vista por uma base radial.
 *
 * Espera na plataforma aberta da nave → Jogar → corrida no deck → salto pela borda → mergulho DE
 * CABEÇA → impacto no chão → levantar → controle liberado. Nada disso é reescrito aqui: quem manda
 * na coreografia continua sendo a `IntroSequence` (e, dentro dela, o `MeteorArrival` original, com
 * todas as correções de sola, folga de deck e recuperação preservadas).
 *
 * ## O truque é só de referencial
 *
 * A `IntroSequence` é rodada com `landing` na ORIGEM e `yaw = 0`. Ou seja, ela trabalha num espaço
 * local Y-up limpo: `+Y` é para cima, `+Z` é a direção da corrida, o pouso é `(0,0,0)`. Esta classe
 * guarda a base radial do desembarque — `up = frame.up(anchor)`, `reference` tangente, `right` — e
 * leva cada ponto local para o mundo com
 *
 *     mundo(p) = anchor + right·p.x + up·p.y + reference·p.z
 *
 * É exatamente o mesmo contrato do `PlanetAvatar`: o corpo continua vendo um mundo plano e o pai
 * radial faz a curvatura. Por isso a pose local sai daqui PRONTA para virar `CharacterVisual
 * .arrivalPose` sem conversão nenhuma — nenhum osso é posicionado, nenhum clipe é inventado.
 *
 * O deck fica a 900 m acima do pouso (`DESCENT_START_HEIGHT`), o que num planeta de raio 200 põe o
 * corpo a mais de cinco raios do centro: a esfera inteira aparece embaixo durante o mergulho, que é
 * o vislumbre pedido, e some de vista sozinha conforme a queda encurta.
 *
 * **Apresentação pura.** Nenhum campo aqui toca motor, colisão, diretor ou rede. O passo fixo fica
 * retido por `holdsControl` e as pragas ficam retidas por `holdsSpawns` até o corpo LEVANTAR.
 */

/** Pose de câmera do quadro. `weight` 0 devolve a câmera de jogo sem corte. */
export interface ArrivalShot {
  readonly position: Vec3;
  readonly target: Vec3;
  /** Vertical RADIAL no ponto onde a câmera está, nunca o `+Y` do mundo. */
  readonly up: Vec3;
  /** 0 = câmera normal, 1 = totalmente na pose de chegada. */
  readonly weight: number;
}

/**
 * Pose aceita por `CharacterVisual.arrivalPose`, repetida aqui em forma estrutural para este módulo
 * continuar puro (sem Babylon) e testável fora da cena.
 */
export interface CharacterArrivalPose {
  height: number;
  recovery: number;
  dive?: number;
  rootLift?: number;
  sway?: number;
  time?: number;
  flutter?: number;
  position?: Vec3;
  stride?: {clip: string; progress: number; yaw: number; pitch: number; roll: number} | undefined;
}

/** Tudo que a apresentação precisa para desenhar o corpo neste quadro. */
export interface ArrivalBody {
  readonly phase: IntroPhase;
  /** Origem do pai radial: o ponto de pouso validado. */
  readonly anchor: Vec3;
  /** Vertical local do pouso (eixo Y do pai). */
  readonly up: Vec3;
  /** Tangente de referência do pouso (eixo Z do pai) — é a direção da corrida no deck. */
  readonly reference: Vec3;
  /** Pose LOCAL para a `CharacterVisual`; já é o `arrivalPose` do jogo plano. */
  readonly local: CharacterArrivalPose;
  /** Posição de MUNDO do corpo, para `visual.position`, som posicional e efeitos. */
  readonly world: Vec3;
  /** Altitude do corpo sobre o convés nominal, em metros. */
  readonly altitude: number;
}

export type {IntroCue, IntroPhase};

/** Duração de cada etapa, em segundos. Vem da entrada autoral — nada é redefinido aqui. */
export const ARRIVAL_TIMELINE = {
  runSeconds: INTRO_RUN_SECONDS,
  leapSeconds: INTRO_LEAP_SECONDS,
  /** Mergulho: do topo da trajetória ao impacto. */
  diveSeconds: 4,
  /** Recuperação: do impacto ao corpo de pé, com o controle devolvido no fim. */
  recoverSeconds: 2,
} as const;

const ORIGIN: Vec3 = {x: 0, y: 0, z: 0};

export class PlanetArrival {
  /** Coreografia autoral, intocada. */
  readonly intro = new IntroSequence();
  private anchorPoint: Vec3 = {x: 0, y: 0, z: 0};
  private upAxis: Vec3 = {x: 0, y: 1, z: 0};
  private forwardAxis: Vec3 = {x: 0, y: 0, z: 1};
  private rightAxis: Vec3 = {x: 1, y: 0, z: 0};
  private armed = false;
  private risen = false;

  constructor(private readonly frame: PlanetFrame) {}

  // ---------------------------------------------------------------- base radial

  /**
   * Arma a chegada no pé do jogador e deixa o corpo ESPERANDO no deck.
   *
   * `heading` é a tangente de marcha do desembarque (a mesma que o motor e a câmera recebem): é
   * nela que o eixo de corrida do deck é alinhado, então a nave aponta para onde a partida vai
   * seguir. Sem `heading` cai numa tangente estável, nunca em NaN.
   *
   * O corpo NÃO começa a correr aqui — isso é `play()`, no instante do Jogar.
   */
  start(anchor: Vec3, options: {heading?: Vec3} = {}): void {
    this.anchorPoint = copy(anchor);
    this.upAxis = this.frame.up(anchor);
    const hinted = options.heading ? reject(options.heading, this.upAxis) : ORIGIN;
    this.forwardAxis = length(hinted) > 1e-6 ? normalize(hinted) : anyPerpendicular(this.upAxis);
    this.rightAxis = cross(this.upAxis, this.forwardAxis);
    this.armed = true;
    this.risen = false;
    this.intro.reset();
    this.intro.beginStandby();
  }

  /**
   * Jogar: a corrida no deck começa do mesmo relógio da espera, sem salto na pose.
   *
   * Idempotente — chamar todo quadro enquanto a partida está ativa é o uso esperado.
   * `prologue = false` entra direto no mergulho; é a degradação de quando o GLB da nave não
   * carregou, porque correr no vazio seria pior que a queda original.
   */
  play(prologue = true): void {
    if (!this.armed || !this.intro.standby) return;
    this.intro.start(prologue);
  }

  /** O ponto de pouso desta chegada (origem do pai radial). */
  get anchor(): Vec3 {return copy(this.anchorPoint);}
  /** Vertical local do pouso. */
  get up(): Vec3 {return copy(this.upAxis);}
  /** Tangente de referência do pouso: eixo de corrida do deck. */
  get reference(): Vec3 {return copy(this.forwardAxis);}

  /** Leva um ponto do espaço local Y-up da entrada para o mundo. */
  toWorld(local: Vec3): Vec3 {
    return add(add(this.anchorPoint, scale(this.rightAxis, local.x)),
      add(scale(this.upAxis, local.y), scale(this.forwardAxis, local.z)));
  }

  // ---------------------------------------------------------------- estado

  get phase(): IntroPhase {return this.intro.phase;}
  /** A entrada está desenhando o corpo (inclui a espera no deck antes do Jogar). */
  get visible(): boolean {return this.armed && this.intro.visible;}
  /** Espera no deck, antes do Jogar. */
  get standby(): boolean {return this.armed && this.intro.standby;}
  /** Retém o passo fixo: motor, mira, diretor e rede continuam parados. */
  get holdsControl(): boolean {return this.armed && this.intro.holdsControl;}
  /**
   * Retém as pragas até o corpo LEVANTAR.
   *
   * `holdsControl` já para o passo fixo, mas esta é a garantia explícita pedida: nada de inimigo
   * solto enquanto a chegada ainda está de pé no deck, no ar ou caído no chão.
   */
  get holdsSpawns(): boolean {return this.visible && !this.risen;}
  /** O corpo já se levantou: a partir daqui o mundo pode soltar hostis. */
  get released(): boolean {return !this.holdsSpawns;}
  /** Já houve chegada nesta tentativa. */
  get consumed(): boolean {return this.intro.consumed;}
  /** A nave ainda deve aparecer: some quando o corpo se afasta o bastante na queda. */
  get deckVisible(): boolean {return this.armed && this.intro.deckVisible;}
  /** Compatibilidade com o laço de render atual: a chegada ainda tem algo a dizer. */
  get active(): boolean {return this.visible;}
  get progress(): number {
    const total = this.intro.duration;
    return total > 0 ? Math.max(0, Math.min(1, this.intro.elapsed / total)) : 1;
  }

  // ---------------------------------------------------------------- avanço

  /** Avança a apresentação. `onCue` recebe passo, salto, vento, impacto e levantar. */
  update(dt: number, onCue: (cue: IntroCue) => void = () => {}): void {
    if (!this.armed) return;
    this.intro.update(dt, cue => this.emit(cue, onCue));
  }

  /** Pula o restante: o corpo termina de pé no pouso, com impacto e levantar ainda anunciados. */
  skip(onCue: (cue: IntroCue) => void = () => {}): void {
    if (!this.armed) return;
    this.intro.skip(cue => this.emit(cue, onCue));
    this.risen = true;
  }

  /** Cancelamento duro (morte, teleporte de QA, troca de ilha): nada fica no ar. */
  abort(): void {
    if (!this.armed) return;
    this.intro.abort();
    this.risen = true;
  }

  private emit(cue: IntroCue, onCue: (cue: IntroCue) => void): void {
    if (cue === 'rise') this.risen = true;
    onCue(cue);
  }

  // ---------------------------------------------------------------- corpo

  /** Borda aberta do deck em espaço LOCAL — é onde o `DropshipDeck` é ancorado sob o pai radial. */
  get deckEdgeLocal(): Vec3 {return this.intro.deckEdge(ORIGIN, 0);}
  /** A mesma borda em espaço de mundo, para diagnóstico e testes. */
  get deckEdgeWorld(): Vec3 {return this.toWorld(this.deckEdgeLocal);}

  /**
   * Pose do corpo neste quadro, ou `undefined` quando a chegada não está desenhando.
   *
   * `local` é montado exatamente como o `PlayerScene` monta o `arrivalPose` do jogo plano — mesma
   * escolha de `rootLift`, `dive`, `flutter` e `stride` — porque o corpo é o mesmo e o rig é o
   * mesmo; só o pai que o carrega é radial.
   */
  get body(): ArrivalBody | undefined {
    if (!this.visible) return undefined;
    const pose = this.intro.pose(ORIGIN, 0);
    if (!pose) return undefined;
    const flight = this.intro.flight;
    const local: CharacterArrivalPose = {
      sway: pose.roll,
      rootLift: pose.stride ? 0 : flight.rootLift,
      height: flight.height,
      recovery: flight.recovery,
      dive: flight.dive,
      time: pose.flutterTime,
      flutter: pose.flutter,
      position: pose.position,
      stride: pose.stride,
    };
    const world = this.toWorld(pose.position);
    return {
      phase: pose.phase,
      anchor: copy(this.anchorPoint),
      up: copy(this.upAxis),
      reference: copy(this.forwardAxis),
      local,
      world,
      altitude: this.frame.altitude(world),
    };
  }

  /**
   * Enquadramento do quadro, já em mundo, ou `undefined` quando a chegada acabou.
   *
   * A vertical é a RADIAL medida na posição da câmera, não a do pouso: a 900 m de altitude com o
   * recuo da trajetória as duas já diferem vários graus, e é a local que mantém o horizonte certo.
   */
  get shot(): ArrivalShot | undefined {
    if (!this.visible) return undefined;
    const shot = this.intro.shot(ORIGIN, 0);
    if (!shot) return undefined;
    const position = this.toWorld(shot.position);
    return {position, target: this.toWorld(shot.target), up: this.frame.up(position), weight: shot.weight};
  }
}
