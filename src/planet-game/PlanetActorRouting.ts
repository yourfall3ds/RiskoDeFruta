import type {Vec3} from '../core/contracts';
import type {FollowStep} from '../planet-nav';
import {length, normalize, reject, sub} from '../planet/PlanetFrame';

/**
 * Rotas por ator: quem pede, quando pede, quando desiste.
 *
 * Fica separado de `PlanetEnemies` (e sem nada de Babylon) porque é a parte que precisa de teste
 * de verdade: correlação por ator, invalidação e o momento em que a rota deixa de valer. A regra
 * central é uma só — **a rota só diz PARA ONDE; quem anda é o `PlanetMotor`**, que continua dono
 * do encaixe no solo, do degrau e do vazio.
 */

/** O `PathFollower` de `src/planet-nav`, visto por quem consome. */
export interface RouteFollower {
  readonly done: boolean;
  update(position: Vec3): FollowStep;
}

/**
 * A porta da navegação. `PlanetNavigationService` a satisfaz por estrutura — sem import cruzado,
 * e é por aqui que o teste injeta um serviço falso com rotas conhecidas por ator.
 */
export interface NavigationPort {
  readonly ready: boolean;
  request(from: Vec3, to: Vec3, actorKey?: string): RouteFollower | undefined;
}

export interface RoutingOptions {
  /**
   * Abaixo desta distância tangencial o ator vai direto ao alvo.
   *
   * O último trecho é trabalho do motor de colisão, não do grafo: a API da navegação diz
   * explicitamente que `points[0]` é o nó encaixado e não a origem crua. Insistir na rota de perto
   * faria o bicho contornar um nó que ele já ultrapassou.
   */
  readonly directMetres: number;
  /** Acima disto vale a pena pedir rota; abaixo, a perseguição local já resolve. */
  readonly routeMetres: number;
  /** Idade máxima de uma rota antes de pedir outra, em segundos. */
  readonly maxRouteSeconds: number;
  /** Deslocamento do alvo que invalida a rota (o jogador andou para longe de onde ela ia dar). */
  readonly goalDriftMetres: number;
}

export const ROUTING_DEFAULTS: RoutingOptions = {
  directMetres: 9,
  routeMetres: 14,
  maxRouteSeconds: 6,
  goalDriftMetres: 12,
};

/** Estado do ator que o roteador precisa ver. Propositalmente mínimo. */
export interface RoutedActor {
  /** Identidade ESTÁVEL — é o que garante que a rota do inimigo 7 volte para o inimigo 7. */
  readonly key: string;
  readonly position: Vec3;
  readonly up: Vec3;
  /** Marcha atual, usada quando não há nada melhor. */
  readonly forward: Vec3;
  /** Contador de recuperações do motor; mudou = o corpo saltou e a rota morreu. */
  readonly recoveries: number;
}

export interface SteerResult {
  /** Tangente unitária que o motor consome como rumo. */
  readonly heading: Vec3;
  /** `true` quando o rumo veio de uma rota do grafo, `false` quando é perseguição local. */
  readonly routed: boolean;
  /** `true` quando o ator deve parar de avançar (já está em cima do alvo). */
  readonly arrived: boolean;
}

interface Slot {
  follower: RouteFollower | undefined;
  age: number;
  /** Alvo que originou a rota; se o jogador se afastar dele, a rota deixa de servir. */
  goal: Vec3;
  recoveries: number;
}

export class PlanetActorRouting {
  private readonly slots = new Map<string, Slot>();
  /** Diagnóstico: quantas rotas foram adotadas, e por que as anteriores morreram. */
  adopted = 0;
  invalidated = 0;
  strayed = 0;

  constructor(
    private readonly navigation: NavigationPort | undefined,
    private readonly options: RoutingOptions = ROUTING_DEFAULTS,
  ) {}

  /** Rotas vivas agora. Usado pelo painel de verificação e pelos testes. */
  get active(): number {
    let count = 0;
    for (const slot of this.slots.values()) if (slot.follower) count++;
    return count;
  }

  /**
   * Rumo do ator neste passo.
   *
   * Ordem das decisões, e o motivo de cada uma:
   *  1. perto do alvo ⇒ direto (o grafo não ajuda no último metro);
   *  2. rota viva e ainda válida ⇒ direção do `PathFollower`;
   *  3. longe e sem rota ⇒ pede uma (o serviço tem o próprio teto de despacho) e, **enquanto ela
   *     não chega**, segue na perseguição local. Nunca se fica parado esperando resposta.
   */
  steer(actor: RoutedActor, goal: Vec3, dt: number): SteerResult {
    const up = actor.up;
    const direct = this.tangentTowards(actor, goal);
    const planar = length(reject(sub(goal, actor.position), up));
    const slot = this.slots.get(actor.key);

    // Salto de posição (vazio, empurrão, teleporte): a rota antiga aponta de onde não se está mais.
    if (slot && slot.recoveries !== actor.recoveries) {this.drop(slot); slot.recoveries = actor.recoveries;}

    if (planar <= this.options.directMetres) {
      if (slot?.follower) this.drop(slot);
      return {heading: direct, routed: false, arrived: planar <= 0.35};
    }

    if (slot?.follower) {
      slot.age += dt;
      const step = slot.follower.update(actor.position);
      const drifted = length(sub(goal, slot.goal)) > this.options.goalDriftMetres;
      if (step.strayed) {this.strayed++; this.drop(slot);}
      else if (step.arrived || slot.follower.done || slot.age > this.options.maxRouteSeconds || drifted) this.drop(slot);
      else if (length(step.direction) > 1e-6) {
        return {heading: normalize(reject(step.direction, up), direct), routed: true, arrived: false};
      }
    }

    if (planar >= this.options.routeMetres) this.ask(actor, goal);
    return {heading: direct, routed: false, arrived: false};
  }

  /** Esquece a rota de um ator — morte, aposentadoria, troca de ilha. */
  forget(key: string): void {
    const slot = this.slots.get(key);
    if (slot?.follower) this.invalidated++;
    this.slots.delete(key);
  }

  /** Esquece tudo. Recomeço de tentativa, próximo estágio, teleporte de QA. */
  clear(): void {
    for (const slot of this.slots.values()) if (slot.follower) this.invalidated++;
    this.slots.clear();
    this.adopted = 0; this.strayed = 0;
  }

  private ask(actor: RoutedActor, goal: Vec3): void {
    const navigation = this.navigation;
    if (!navigation?.ready) return;
    // `actorKey` é o contrato de identidade do serviço: sem ele a correspondência vira geométrica
    // e, com horda, dois bichos colados poderiam trocar de rota entre si.
    const follower = navigation.request(actor.position, goal, actor.key);
    if (!follower) return;
    const slot = this.slots.get(actor.key)
      ?? {follower: undefined, age: 0, goal: {...goal}, recoveries: actor.recoveries};
    slot.follower = follower;
    slot.age = 0;
    slot.goal = {...goal};
    slot.recoveries = actor.recoveries;
    this.slots.set(actor.key, slot);
    this.adopted++;
  }

  private drop(slot: Slot): void {
    if (slot.follower) this.invalidated++;
    slot.follower = undefined;
    slot.age = 0;
  }

  private tangentTowards(actor: RoutedActor, goal: Vec3): Vec3 {
    const tangent = reject(sub(goal, actor.position), actor.up);
    return length(tangent) > 1e-6 ? normalize(tangent) : actor.forward;
  }
}
