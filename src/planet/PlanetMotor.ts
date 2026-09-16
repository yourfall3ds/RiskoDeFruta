import type {Vec3} from '../core/contracts';
import {PLAYER_TUNING} from '../player/PlayerTuning';
import {PlanetCollision, type SupportSample} from './PlanetCollision';
import {
  PlanetFrame, add, copy, cross, dot, length, normalize, quaternionFromBasis, reject, scale, sub,
  transport, type Quat, type SurfaceBasis,
} from './PlanetFrame';

/**
 * Motor de locomoção com "para cima" arbitrário.
 *
 * Diferenças estruturais em relação a `src/player/PlayerMotor.ts` (que fica intocado):
 *   - gravidade ao longo de −up(p), não de −Y;
 *   - velocidade decomposta em RADIAL + TANGENCIAL a cada passo, com a parte tangencial
 *     TRANSPORTADA (Rodrigues) quando a vertical muda — sem isso a corrida perde velocidade
 *     e a direção deriva ao dar a volta;
 *   - apoio por sonda radial (`supportBelow`) no lugar de `groundAt(x, z)`;
 *   - inclinação medida por `dot(normal, up)`;
 *   - a frente do personagem é um VETOR tangente transportado, não um ângulo `yaw` global —
 *     é isso que faz o polo deixar de ser singularidade.
 */

export interface PlanetMotorTuning {
  speed: number; sprintMultiplier: number; accelerationSeconds: number; airControl: number;
  gravity: number; jumpApex: number; terminalVelocity: number;
  coyoteSeconds: number; jumpBufferSeconds: number;
  radius: number; height: number; stepHeight: number; maxSlopeDegrees: number;
  safeGroundInterval: number;
  slideAcceleration: number; slideMaxSpeed: number; slideFriction: number;
  /** Quanto a sonda de apoio olha acima do pé e abaixo dele. */
  probeAbove: number; probeBelow: number;
  /** Fração de vida perdida ao cair no vazio; espelha `voidDamageFraction` do jogo plano. */
  voidDamageFraction: number;
}

/** Mesmos números do jogo plano — o toque não muda por virar planeta. */
export const PLANET_MOTOR_TUNING: PlanetMotorTuning = {
  speed: PLAYER_TUNING.speed, sprintMultiplier: PLAYER_TUNING.sprintMultiplier,
  accelerationSeconds: PLAYER_TUNING.accelerationSeconds, airControl: PLAYER_TUNING.airControl,
  gravity: PLAYER_TUNING.gravity, jumpApex: PLAYER_TUNING.jumpApex,
  terminalVelocity: PLAYER_TUNING.terminalVelocity,
  coyoteSeconds: PLAYER_TUNING.coyoteSeconds, jumpBufferSeconds: PLAYER_TUNING.jumpBufferSeconds,
  radius: PLAYER_TUNING.radius, height: PLAYER_TUNING.height, stepHeight: PLAYER_TUNING.stepHeight,
  maxSlopeDegrees: PLAYER_TUNING.maxSlopeDegrees, safeGroundInterval: PLAYER_TUNING.safeGroundInterval,
  slideAcceleration: PLAYER_TUNING.slideAcceleration, slideMaxSpeed: PLAYER_TUNING.slideMaxSpeed,
  slideFriction: PLAYER_TUNING.slideFriction,
  probeAbove: PLAYER_TUNING.stepHeight, probeBelow: PLAYER_TUNING.stepHeight,
  voidDamageFraction: PLAYER_TUNING.voidDamageFraction,
};

/**
 * Folga do pé sobre a superfície de apoio, por causa da ponta ARREDONDADA da cápsula.
 *
 * Numa rampa de inclinação θ, pousar o pé exatamente no ponto de contato da sonda enfia a esfera
 * inferior `r·(1 − cos θ)` dentro da rampa. O desencrave então empurra o corpo ao longo da normal,
 * cuja parte tangencial aponta ladeira abaixo, e o encaixe seguinte repete tudo: o personagem
 * escorrega sozinho, com velocidade zero. Levantar o pé por `r·(1/cos θ − 1)` elimina a penetração
 * na origem. É o mesmo termo que o motor plano usa em `supportGap`.
 */
const contactLift = (radius: number, facing: number): number =>
  radius * (1 / Math.max(0.2, Math.min(1, facing)) - 1);

export interface PlanetInput {x: number; z: number; jump: boolean; sprint: boolean}

export interface PlanetMotorListener {
  jumped?(): void;
  /** `impact` em m/s de velocidade radial no instante do contato. */
  landed?(impact: number): void;
  /** Voltou do vazio; `damageFraction` é a fração de vida a descontar. */
  recovered?(damageFraction: number): void;
}

export interface PlanetMotorOptions {
  frame: PlanetFrame;
  collision: PlanetCollision;
  spawn: Vec3;
  /** Direção de marcha inicial; qualquer vetor com projeção tangente serve. */
  heading?: Vec3;
  tuning?: Partial<PlanetMotorTuning>;
  listener?: PlanetMotorListener;
}

export class PlanetMotor {
  readonly position: Vec3;
  readonly previous: Vec3;
  readonly velocity: Vec3 = {x: 0, y: 0, z: 0};
  /** Vertical local do corpo. Também é o eixo da cápsula de colisão. */
  up: Vec3;
  /** Frente do personagem: unitário TANGENTE, transportado a cada passo. Não existe `yaw` global. */
  forward: Vec3;
  grounded = false;
  sliding = false;
  slideSeconds = 0;
  groundNormal: Vec3;
  groundSlopeDegrees = 0;
  /** Último ponto com apoio caminhável; destino da recuperação de queda. */
  readonly safe: Vec3;
  private safeForward: Vec3;
  jumps = 0; recoveries = 0; slides = 0; airborneSeconds = 0;

  private readonly frame: PlanetFrame;
  private readonly collision: PlanetCollision;
  private readonly tuning: PlanetMotorTuning;
  private readonly listener: PlanetMotorListener;
  private readonly spawn: Vec3;
  private coyote: number;
  private jumpBuffer = 0;
  private safeElapsed = 0;
  /** Saiu do chão por vontade própria (salto/arremesso). Enquanto falso, o corpo gruda no apoio. */
  private launched = false;

  constructor(options: PlanetMotorOptions) {
    this.frame = options.frame;
    this.collision = options.collision;
    this.tuning = {...PLANET_MOTOR_TUNING, ...options.tuning};
    this.listener = options.listener ?? {};
    this.spawn = copy(options.spawn);
    this.position = copy(options.spawn);
    this.previous = copy(options.spawn);
    this.safe = copy(options.spawn);
    this.up = this.frame.up(this.position);
    this.forward = this.frame.basisAt(this.position, options.heading ?? {x: 0, y: 0, z: 1}).forward;
    this.safeForward = copy(this.forward);
    this.groundNormal = copy(this.up);
    this.coyote = this.tuning.coyoteSeconds;
  }

  /** Base de superfície do corpo agora: `right = up × forward`. */
  get basis(): SurfaceBasis {return {up: this.up, forward: this.forward, right: cross(this.up, this.forward)};}
  /** Quaternion de raiz pronto para a malha do personagem. */
  get rotation(): Quat {const b = this.basis; return quaternionFromBasis(b.right, b.up, b.forward);}
  get altitude(): number {return this.frame.altitude(this.position);}
  /** Velocidade no plano tangente — o análogo de `hypot(vx, vz)` do jogo plano. */
  get tangentialSpeed(): number {return length(reject(this.velocity, this.up));}
  get verticalSpeed(): number {return dot(this.velocity, this.up);}

  /** Reorienta a marcha a partir de uma direção do mundo (a frente da câmera, por exemplo). */
  setHeading(heading: Vec3): void {
    const tangent = reject(heading, this.up);
    if (length(tangent) > 1e-6) this.forward = normalize(tangent);
  }
  /** Gira a marcha no plano tangente. Substitui `yaw += dx`; imune a polo. */
  turn(radians: number): void {
    const right = cross(this.up, this.forward), c = Math.cos(radians), s = Math.sin(radians);
    this.forward = normalize(add(scale(this.forward, c), scale(right, s)));
  }

  teleport(position: Vec3, heading?: Vec3): void {
    this.position.x = position.x; this.position.y = position.y; this.position.z = position.z;
    Object.assign(this.previous, this.position);
    this.velocity.x = 0; this.velocity.y = 0; this.velocity.z = 0;
    this.up = this.frame.up(this.position);
    this.forward = this.frame.basisAt(this.position, heading ?? this.forward).forward;
    this.groundNormal = copy(this.up);
    this.grounded = false; this.sliding = false; this.slideSeconds = 0; this.launched = false;
    this.coyote = this.tuning.coyoteSeconds; this.jumpBuffer = 0; this.safeElapsed = 0;
    this.airborneSeconds = 0;
  }

  /**
   * Força o corpo a soltar do apoio — empurrão, explosão, plataforma que some.
   * Sem isto a aderência puxaria o personagem de volta para o chão no mesmo quadro.
   */
  leaveGround(radialSpeed = 0): void {
    this.grounded = false;
    this.launched = true;
    this.coyote = 0;
    if (radialSpeed !== 0) {
      const current = dot(this.velocity, this.up), delta = radialSpeed - current;
      this.velocity.x += this.up.x * delta;
      this.velocity.y += this.up.y * delta;
      this.velocity.z += this.up.z * delta;
    }
  }

  fixedUpdate(dt: number, input: PlanetInput, heading?: Vec3): void {
    if (!(dt > 0)) return;
    const t = this.tuning;
    Object.assign(this.previous, this.position);
    if (heading) this.setHeading(heading);
    this.unstick();

    const floorCos = Math.cos(t.maxSlopeDegrees * Math.PI / 180);
    const wasGrounded = this.grounded;
    this.coyote = wasGrounded ? t.coyoteSeconds : Math.max(0, this.coyote - dt);
    this.jumpBuffer = input.jump ? t.jumpBufferSeconds : Math.max(0, this.jumpBuffer - dt);

    // --- intenção no plano tangente ---
    const right = cross(this.up, this.forward);
    let ix = input.x, iz = input.z;
    const magnitude = Math.hypot(ix, iz);
    if (magnitude > 1) {ix /= magnitude; iz /= magnitude;}
    const wishDirection = add(scale(this.forward, iz), scale(right, ix));
    const sprinting = input.sprint && magnitude > 0.1;
    const speed = t.speed * (sprinting ? t.sprintMultiplier : 1);

    // --- decomposição radial / tangencial ---
    let radial = dot(this.velocity, this.up);
    let tangential = reject(this.velocity, this.up);
    const control = wasGrounded ? 1 : t.airControl;
    const accel = 1 - Math.exp(-dt * control / t.accelerationSeconds);
    const target = scale(wishDirection, speed);
    tangential = add(tangential, scale(sub(target, tangential), accel));

    radial = Math.max(-t.terminalVelocity, radial - t.gravity * dt);
    if (this.jumpBuffer > 0 && this.coyote > 0 && !this.sliding) {
      radial = Math.sqrt(2 * t.gravity * t.jumpApex);
      this.grounded = false; this.launched = true; this.coyote = 0; this.jumpBuffer = 0; this.jumps++;
      this.listener.jumped?.();
    }
    this.velocity.x = tangential.x + this.up.x * radial;
    this.velocity.y = tangential.y + this.up.y * radial;
    this.velocity.z = tangential.z + this.up.z * radial;

    /**
     * Deslocamento com colisão.
     *
     * Apoiado, o passo é PURAMENTE TANGENCIAL e ignora contatos de piso — quem acompanha o
     * relevo é a sonda de apoio, dentro de `stepHeight`. É a mesma divisão de trabalho do motor
     * plano (`move` horizontal + encaixe vertical) e é o que impede o travamento por leque de
     * triângulos coplanares. No ar o passo é 3D completo e nada é ignorado.
     */
    const onFoot = wasGrounded && !this.launched;
    const wanted = onFoot ? scale(reject(this.velocity, this.up), dt) : scale(this.velocity, dt);
    const contact = this.slideMove(wanted, floorCos, wasGrounded, onFoot);

    // --- transporte: a vertical mudou, as tangentes vão junto ---
    const movedUp = this.frame.up(this.position);
    const rotate = (v: Vec3): Vec3 => transport(v, this.up, movedUp);
    const carried = rotate(this.velocity);
    this.velocity.x = carried.x; this.velocity.y = carried.y; this.velocity.z = carried.z;
    this.forward = normalize(reject(rotate(this.forward), movedUp), this.forward);
    this.up = movedUp;

    // --- apoio ---
    const impact = dot(this.velocity, this.up);
    const support = this.settleOnGround(wasGrounded, contact.floor, floorCos);
    if (support) {
      if (!wasGrounded) this.listener.landed?.(-Math.min(0, impact));
      this.airborneSeconds = 0;
    } else {
      this.airborneSeconds += dt;
    }
    this.resolveSteepSlope(dt, floorCos);

    // --- pontos seguros e vazio ---
    if (this.grounded && !this.sliding) {
      this.safeElapsed += dt;
      if (this.safeElapsed >= t.safeGroundInterval) {
        Object.assign(this.safe, this.position); this.safeForward = copy(this.forward); this.safeElapsed = 0;
      }
    } else this.safeElapsed = 0;
    if (this.frame.radius(this.position) < this.frame.voidRadius) this.recover();
  }

  /** Salto pedido fora do quadro de entrada (script, cinemática). */
  requestJump(): void {this.jumpBuffer = this.tuning.jumpBufferSeconds;}

  /**
   * Avanço com deslizamento contra os triângulos fornecidos, com tentativa de DEGRAU.
   * Devolve a normal de piso encontrada, se houve.
   */
  private slideMove(
    delta: Vec3, floorCos: number, wasGrounded: boolean, ignoreFloors: boolean,
  ): {floor?: Vec3; blocked: boolean} {
    const startPosition = copy(this.position);
    const plain = this.sweepAndSlide(delta, floorCos, ignoreFloors);
    if (!plain.wall || !wasGrounded) return {...(plain.floor ? {floor: plain.floor} : {}), blocked: !!plain.wall};
    const stepped = this.stepUpOver(delta, startPosition);
    if (!stepped) return {...(plain.floor ? {floor: plain.floor} : {}), blocked: true};
    Object.assign(this.position, stepped.point);
    return {floor: stepped.normal, blocked: false};
  }

  /**
   * Degrau: sonda o piso logo ADIANTE da face que bloqueou e sobe direto para ele.
   *
   * A alternativa — erguer a cápsula, repetir a varredura e descer — não funciona sobre geometria
   * autoral: o corpo erguido continua encostado na face lateral, cada iteração devolve contato em
   * `time = 0` e o personagem oscila entre subir e cair. Sondar adiante decide numa consulta só,
   * e a checagem de encaixe (`deepestContact`) impede subir para um lugar onde a cápsula não cabe.
   */
  private stepUpOver(delta: Vec3, startPosition: Vec3): {point: Vec3; normal: Vec3} | undefined {
    const t = this.tuning;
    const tangent = reject(delta, this.up), travel = length(tangent);
    if (travel < 1e-6) return undefined;
    const reach = t.radius + Math.min(travel, t.radius) + 0.08;
    const ahead = this.frame.geodesicStep(this.position, scale(tangent, reach / travel)).position;
    const raised = add(ahead, scale(this.frame.up(ahead), t.stepHeight + 0.05));
    const landing = this.collision.supportBelow(raised, this.frame.up(raised), 0.02, t.stepHeight * 2 + 0.1);
    if (!landing || landing.slopeDegrees > t.maxSlopeDegrees) return undefined;
    const rise = dot(sub(landing.point, startPosition), this.up);
    if (rise < 0.02 || rise > t.stepHeight) return undefined;
    const lift = contactLift(t.radius, dot(landing.normal, this.up)) + 0.005;
    const point = add(landing.point, scale(this.frame.up(landing.point), lift));
    const contact = this.collision.deepestContact(point, this.frame.up(point), t.radius, t.height);
    if (contact && contact.depth > 0.02) return undefined;
    return {point, normal: landing.normal};
  }

  private sweepAndSlide(
    delta: Vec3, floorCos: number, ignoreFloors: boolean,
  ): {floor?: Vec3; wall?: Vec3; velocity: Vec3} {
    const t = this.tuning;
    const remaining = copy(delta);
    let floor: Vec3 | undefined, wall: Vec3 | undefined;
    for (let i = 0; i < 4; i++) {
      if (length(remaining) < 1e-9) break;
      const hit = this.collision.sweepCapsule(
        this.position, this.up, remaining, t.radius, t.height, ignoreFloors ? floorCos : undefined,
      );
      if (!hit) {
        this.position.x += remaining.x; this.position.y += remaining.y; this.position.z += remaining.z;
        break;
      }
      const advance = Math.max(0, hit.time - 1e-4);
      this.position.x += remaining.x * advance;
      this.position.y += remaining.y * advance;
      this.position.z += remaining.z * advance;
      const left = 1 - advance;
      remaining.x *= left; remaining.y *= left; remaining.z *= left;
      const into = dot(remaining, hit.normal);
      if (into < 0) {
        remaining.x -= hit.normal.x * into; remaining.y -= hit.normal.y * into; remaining.z -= hit.normal.z * into;
      }
      const vInto = dot(this.velocity, hit.normal);
      if (vInto < 0) {
        this.velocity.x -= hit.normal.x * vInto;
        this.velocity.y -= hit.normal.y * vInto;
        this.velocity.z -= hit.normal.z * vInto;
      }
      const facing = dot(hit.normal, this.up);
      if (facing >= floorCos) floor = hit.normal; else if (facing > -0.2) wall = hit.normal;
    }
    return {...(floor ? {floor} : {}), ...(wall ? {wall} : {}), velocity: copy(this.velocity)};
  }

  /** Encaixe no apoio pela sonda radial. Devolve a amostra aceita, ou `undefined` se ficou no ar. */
  private settleOnGround(wasGrounded: boolean, contactFloor: Vec3 | undefined, floorCos: number): SupportSample | undefined {
    const t = this.tuning;
    this.grounded = false;
    const radial = dot(this.velocity, this.up);
    /**
     * Aderência ao apoio. Numa superfície curva e facetada, cada crista de faceta dá ao corpo uma
     * velocidade radial positiva minúscula (a 6,8 m/s sobre facetas de ~1°, ≈ 0,12 m/s) e, sem isto,
     * o personagem decolava e voltava a cada quadro — `grounded` piscava metade do tempo.
     * Quem já estava apoiado e NÃO saltou continua colado enquanto houver piso dentro de `stepHeight`.
     * Andar para fora da beirada não encontra piso nenhum e a queda acontece normalmente.
     */
    const sticky = wasGrounded && !this.launched;
    const above = wasGrounded ? t.probeAbove : 0.05;
    const below = wasGrounded ? t.probeBelow : Math.max(0.05, -radial * 0.02);
    const sample = this.collision.supportBelow(this.position, this.up, above, below + 0.02);
    if (!sample) {
      // Sem sonda, mas a varredura tocou um piso real: aceita o contato para não flutuar na borda.
      if (contactFloor && (sticky || radial <= 0)) {
        this.grounded = true; this.launched = false; this.groundNormal = copy(contactFloor);
        this.groundSlopeDegrees = Math.acos(Math.min(1, dot(contactFloor, this.up))) * 180 / Math.PI;
        const kill = dot(this.velocity, this.up);
        if (kill < 0) {this.velocity.x -= this.up.x * kill; this.velocity.y -= this.up.y * kill; this.velocity.z -= this.up.z * kill;}
      }
      return undefined;
    }
    if (sample.slopeDegrees > t.maxSlopeDegrees) {
      this.groundNormal = copy(sample.normal);
      this.groundSlopeDegrees = sample.slopeDegrees;
      return undefined;
    }
    // Descer acompanha degrau/ladeira; subir também, porque o passo apoiado é tangencial e a
    // rampa fica ACIMA do pé no fim do deslocamento — sem isto não se sobe ladeira nenhuma.
    const lift = contactLift(t.radius, dot(sample.normal, this.up));
    const drop = sample.offset - lift;
    const maxDown = wasGrounded ? t.stepHeight : 0.02 + t.radius * (1 / floorCos - 1);
    const maxUp = wasGrounded ? t.stepHeight : 0.002;
    if (!sticky && radial > 0.001) return undefined;
    if (drop > maxDown || drop < -maxUp) return undefined;
    Object.assign(this.position, add(sample.point, scale(this.up, lift)));
    this.velocity.x -= this.up.x * radial; this.velocity.y -= this.up.y * radial; this.velocity.z -= this.up.z * radial;
    this.grounded = true;
    this.launched = false;
    this.groundNormal = copy(sample.normal);
    this.groundSlopeDegrees = sample.slopeDegrees;
    return sample;
  }

  /** Face acima da inclinação máxima empurra ladeira abaixo em vez de segurar o corpo pendurado. */
  private resolveSteepSlope(dt: number, floorCos: number): void {
    const t = this.tuning;
    if (this.grounded || dot(this.velocity, this.up) > 0) {this.sliding = false; this.slideSeconds = 0; return;}
    const sample = this.collision.supportBelow(this.position, this.up, 0.05, t.radius * (1 / floorCos - 1) + 0.35);
    if (!sample || sample.slopeDegrees <= t.maxSlopeDegrees || sample.slopeDegrees >= 89.5) {
      this.sliding = false; this.slideSeconds = 0; return;
    }
    if (!this.sliding) this.slides++;
    this.sliding = true; this.slideSeconds += dt;
    this.coyote = t.coyoteSeconds;
    const downhill = reject(sample.normal, this.up);
    const l = length(downhill);
    if (l < 1e-4) return;
    const steepness = Math.sin(sample.slopeDegrees * Math.PI / 180);
    const push = scale(downhill, 1 / l * t.slideAcceleration * steepness * dt);
    const drag = t.slideFriction * dt;
    let tangential = reject(this.velocity, this.up);
    tangential = add(add(tangential, push), scale(tangential, -drag));
    const planar = length(tangential);
    if (planar > t.slideMaxSpeed) tangential = scale(tangential, t.slideMaxSpeed / planar);
    const radial = Math.min(dot(this.velocity, this.up), -2);
    this.velocity.x = tangential.x + this.up.x * radial;
    this.velocity.y = tangential.y + this.up.y * radial;
    this.velocity.z = tangential.z + this.up.z * radial;
  }

  /** Empurra para fora quando o corpo aparece dentro da geometria, sem teleportar. */
  private unstick(): void {
    const t = this.tuning;
    const contact = this.collision.deepestContact(this.position, this.up, t.radius, t.height);
    if (!contact || contact.depth <= 1e-3) return;
    const push = Math.min(contact.depth + 1e-3, t.radius);
    this.position.x += contact.normal.x * push;
    this.position.y += contact.normal.y * push;
    this.position.z += contact.normal.z * push;
  }

  /**
   * Volta do vazio para o último apoio válido. Se o apoio guardado perdeu a superfície
   * (bioma trocado, ponte removida), procura em volta dele antes de cair no spawn.
   */
  private recover(): void {
    const destination = this.findSupported(this.safe) ?? this.findSupported(this.spawn) ?? copy(this.spawn);
    Object.assign(this.safe, destination);
    this.teleport(destination, this.safeForward);
    this.grounded = true;
    this.recoveries++;
    this.listener.recovered?.(this.tuning.voidDamageFraction);
  }

  /** O ponto dado, ou o mais próximo em volta dele, que tem apoio caminhável. */
  private findSupported(around: Vec3): Vec3 | undefined {
    const t = this.tuning;
    const {forward, right} = this.frame.basisAt(around, this.safeForward);
    for (const distance of [0, 1.5, 4, 9, 18, 34]) {
      const steps = distance === 0 ? 1 : 12;
      for (let i = 0; i < steps; i++) {
        const angle = i / steps * Math.PI * 2;
        const offset = add(scale(forward, Math.cos(angle) * distance), scale(right, Math.sin(angle) * distance));
        const probeAt = distance === 0 ? copy(around) : this.frame.geodesicStep(around, offset).position;
        const raised = add(probeAt, scale(this.frame.up(probeAt), t.height * 2));
        const sample = this.collision.supportBelow(raised, this.frame.up(probeAt), 0.05, t.height * 4);
        if (sample && sample.slopeDegrees <= t.maxSlopeDegrees) {
          const lift = contactLift(t.radius, Math.cos(sample.slopeDegrees * Math.PI / 180)) + 0.01;
          return add(sample.point, scale(this.frame.up(sample.point), lift));
        }
      }
    }
    return undefined;
  }
}
