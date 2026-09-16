import {describe, expect, it} from 'vitest';
import type {Vec3} from '../src/core/contracts';
import type {FollowStep} from '../src/planet-nav';
import {PLANET, PlanetFrame, add, cross, dot, length, normalize, scale, sub} from '../src/planet/PlanetFrame';
import {
  PlanetActorRouting, ROUTING_DEFAULTS,
  type NavigationPort, type RouteFollower, type RoutedActor,
} from '../src/planet-game/PlanetActorRouting';

const frame = new PlanetFrame(PLANET);

/** Ator sintético sobre o convés nominal, na direção dada. */
function actorAt(key: string, direction: Vec3, recoveries = 0): RoutedActor {
  const position = frame.fromDirection(direction, 0.2);
  const up = frame.up(position);
  return {key, position, up, forward: tangent(up, {x: 0, y: 1, z: 0}), recoveries};
}

function tangent(up: Vec3, hint: Vec3): Vec3 {
  const planar = sub(hint, scale(up, dot(hint, up)));
  return length(planar) > 1e-6 ? normalize(planar) : normalize(cross(up, {x: 1, y: 0, z: 0}));
}

/** Seguidor falso: devolve sempre a MESMA direção tangente, marcada com a assinatura do ator. */
class FakeFollower implements RouteFollower {
  done = false;
  strayed = false;
  arrived = false;
  updates = 0;
  constructor(readonly signature: Vec3) {}
  update(_position: Vec3): FollowStep {
    this.updates++;
    return {
      direction: this.arrived ? {x: 0, y: 0, z: 0} : this.signature,
      remaining: 40, arrived: this.arrived, strayed: this.strayed,
      target: {x: 0, y: 0, z: 0},
    };
  }
}

/** Serviço falso: uma rota distinta por `actorKey`, e registro de quem pediu o quê. */
class FakeNavigation implements NavigationPort {
  ready = true;
  readonly asked: {key: string | undefined; from: Vec3; to: Vec3}[] = [];
  readonly issued = new Map<string, FakeFollower>();
  /** Quando ligado, `request` devolve `undefined` (resposta ainda não chegou do worker). */
  silent = false;
  constructor(private readonly route: (key: string | undefined, from: Vec3) => Vec3) {}
  request(from: Vec3, to: Vec3, actorKey?: string): RouteFollower | undefined {
    this.asked.push({key: actorKey, from: {...from}, to: {...to}});
    if (this.silent) return undefined;
    const follower = new FakeFollower(this.route(actorKey, from));
    if (actorKey) this.issued.set(actorKey, follower);
    return follower;
  }
}

/** Assinatura tangente única por ator: gira a tangente base por um ângulo que depende da chave. */
const signatureFor = (key: string | undefined, from: Vec3): Vec3 => {
  const up = frame.up(from);
  const base = tangent(up, {x: 0, y: 1, z: 0});
  const right = cross(up, base);
  const angle = (key ?? '').length * 0.37 + (key?.charCodeAt(key.length - 1) ?? 0) * 0.011;
  return normalize(add(scale(base, Math.cos(angle)), scale(right, Math.sin(angle))), base);
};

const FAR: Vec3 = frame.fromDirection({x: 0, y: 0, z: 1}, 0.2);

describe('rotas por ator', () => {
  it('cada ator recebe a SUA rota: a chave estável vai junto no pedido', () => {
    const navigation = new FakeNavigation(signatureFor);
    const routing = new PlanetActorRouting(navigation);
    const a = actorAt('planet-enemy-101', {x: 1, y: 0, z: 0});
    const b = actorAt('planet-enemy-102', {x: 0.98, y: 0.02, z: 0});

    // Primeiro passo: longe do alvo, ainda sem rota — pede e segue local sem parar.
    for (const actor of [a, b]) {
      const first = routing.steer(actor, FAR, 1 / 60);
      expect(first.routed).toBe(false);
      expect(length(first.heading)).toBeCloseTo(1, 9);
    }
    expect(navigation.asked.map(entry => entry.key)).toEqual(['planet-enemy-101', 'planet-enemy-102']);

    // Segundo passo: a rota de cada um já está adotada e é a dele.
    const steerA = routing.steer(a, FAR, 1 / 60);
    const steerB = routing.steer(b, FAR, 1 / 60);
    expect(steerA.routed).toBe(true);
    expect(steerB.routed).toBe(true);
    expect(navigation.issued.get('planet-enemy-101')!.updates).toBe(1);
    expect(navigation.issued.get('planet-enemy-102')!.updates).toBe(1);
    // A direção de cada um bate com a assinatura da PRÓPRIA rota — ninguém andou com a do outro.
    expect(angleBetween(steerA.heading, signatureFor('planet-enemy-101', a.position))).toBeLessThan(1e-6);
    expect(angleBetween(steerB.heading, signatureFor('planet-enemy-102', b.position))).toBeLessThan(1e-6);
    expect(angleBetween(steerA.heading, steerB.heading)).toBeGreaterThan(1e-3);
    expect(routing.active).toBe(2);
  });

  it('o rumo entregue é sempre TANGENTE, venha da rota ou da perseguição local', () => {
    // Uma rota "suja" com componente radial não pode empurrar o bicho para dentro do planeta.
    const navigation = new FakeNavigation((_key, from) => {
      const up = frame.up(from);
      return normalize(add(tangent(up, {x: 0, y: 1, z: 0}), scale(up, 3)));
    });
    const routing = new PlanetActorRouting(navigation);
    const actor = actorAt('sujo', {x: 0, y: -1, z: 0});
    routing.steer(actor, FAR, 1 / 60);
    const steer = routing.steer(actor, FAR, 1 / 60);
    expect(steer.routed).toBe(true);
    expect(Math.abs(dot(steer.heading, actor.up))).toBeLessThan(1e-9);
    expect(length(steer.heading)).toBeCloseTo(1, 9);
  });

  it('sem serviço, ou com o grafo ainda não pronto, ninguém consulta nada', () => {
    const offline = new PlanetActorRouting(undefined);
    const actor = actorAt('sozinho', {x: 1, y: 0, z: 0});
    const steer = offline.steer(actor, FAR, 1 / 60);
    expect(steer.routed).toBe(false);
    expect(length(steer.heading)).toBeCloseTo(1, 9);

    const navigation = new FakeNavigation(signatureFor);
    navigation.ready = false;
    const routing = new PlanetActorRouting(navigation);
    routing.steer(actor, FAR, 1 / 60);
    routing.steer(actor, FAR, 1 / 60);
    expect(navigation.asked).toHaveLength(0);
    expect(routing.active).toBe(0);
  });

  it('a resposta que ainda não chegou não trava o ator', () => {
    const navigation = new FakeNavigation(signatureFor);
    navigation.silent = true;
    const routing = new PlanetActorRouting(navigation);
    const actor = actorAt('esperando', {x: 1, y: 0, z: 0});
    for (let i = 0; i < 5; i++) {
      const steer = routing.steer(actor, FAR, 1 / 60);
      expect(steer.routed).toBe(false);
      // Perseguição local continua valendo: nada de rumo nulo enquanto a rota não vem.
      expect(length(steer.heading)).toBeCloseTo(1, 9);
    }
    expect(navigation.asked.length).toBeGreaterThan(0);
    expect(routing.active).toBe(0);
  });

  it('perto do alvo a rota é largada: o último trecho é do motor', () => {
    const navigation = new FakeNavigation(signatureFor);
    const routing = new PlanetActorRouting(navigation);
    const actor = actorAt('perto', {x: 1, y: 0, z: 0});
    routing.steer(actor, FAR, 1 / 60);
    expect(routing.steer(actor, FAR, 1 / 60).routed).toBe(true);

    // Alvo agora a poucos metros, no plano tangente.
    const close = frame.geodesicStep(actor.position, scale(actor.forward, ROUTING_DEFAULTS.directMetres - 2)).position;
    const steer = routing.steer(actor, close, 1 / 60);
    expect(steer.routed).toBe(false);
    expect(routing.active).toBe(0);
    // E o rumo aponta para o alvo, não para o próximo nó do caminho.
    expect(angleBetween(steer.heading, tangentTo(actor, close))).toBeLessThan(1e-6);
  });

  it('recuperação do vazio invalida a rota daquele ator, e só dele', () => {
    const navigation = new FakeNavigation(signatureFor);
    const routing = new PlanetActorRouting(navigation);
    const a = actorAt('caiu', {x: 1, y: 0, z: 0});
    const b = actorAt('firme', {x: 0.98, y: 0.02, z: 0});
    for (const actor of [a, b]) {routing.steer(actor, FAR, 1 / 60); routing.steer(actor, FAR, 1 / 60);}
    expect(routing.active).toBe(2);

    // O motor recuperou o corpo: a rota antiga parte de onde ele não está mais.
    // O serviço fica mudo neste passo para o teste ver a INVALIDAÇÃO, e não a substituição
    // imediata (o serviço real tem intervalo mínimo entre despachos e também não responderia já).
    navigation.silent = true;
    const before = navigation.asked.length;
    const recovered = {...a, recoveries: a.recoveries + 1};
    const steer = routing.steer(recovered, FAR, 1 / 60);
    expect(steer.routed).toBe(false);
    expect(routing.active).toBe(1);
    // E o novo pedido sai da posição de AGORA, com a chave daquele ator.
    expect(navigation.asked.length).toBe(before + 1);
    expect(navigation.asked.at(-1)!.key).toBe(recovered.key);
    // O vizinho não foi afetado: a invalidação é por ator.
    expect(routing.steer(b, FAR, 1 / 60).routed).toBe(true);
  });

  it('desvio, chegada e idade derrubam a rota; morte e aposentadoria esquecem o slot', () => {
    const navigation = new FakeNavigation(signatureFor);
    const routing = new PlanetActorRouting(navigation);
    const actor = actorAt('planet-enemy-7', {x: 1, y: 0, z: 0});
    routing.steer(actor, FAR, 1 / 60);
    routing.steer(actor, FAR, 1 / 60);
    navigation.issued.get('planet-enemy-7')!.strayed = true;
    expect(routing.steer(actor, FAR, 1 / 60).routed).toBe(false);
    expect(routing.strayed).toBe(1);

    // Nova rota, agora morta pela idade.
    routing.steer(actor, FAR, 1 / 60);
    expect(routing.steer(actor, FAR, 1 / 60).routed).toBe(true);
    expect(routing.steer(actor, FAR, ROUTING_DEFAULTS.maxRouteSeconds + 1).routed).toBe(false);

    // E outra, largada porque o alvo andou para longe de onde a rota ia dar.
    routing.steer(actor, FAR, 1 / 60);
    expect(routing.steer(actor, FAR, 1 / 60).routed).toBe(true);
    const drifted = frame.fromDirection({x: 0, y: 1, z: 0}, 0.2);
    expect(routing.steer(actor, drifted, 1 / 60).routed).toBe(false);

    // Aposentadoria/morte: o slot some e o contador de invalidação registra.
    routing.steer(actor, FAR, 1 / 60);
    routing.steer(actor, FAR, 1 / 60);
    expect(routing.active).toBe(1);
    routing.forget(actor.key);
    expect(routing.active).toBe(0);
    routing.clear();
    expect(routing.active).toBe(0);
  });

  it('a consulta leva a posição ATUAL do ator e o alvo atual, não os do pedido anterior', () => {
    const navigation = new FakeNavigation(signatureFor);
    navigation.silent = true;
    const routing = new PlanetActorRouting(navigation);
    const first = actorAt('andando', {x: 1, y: 0, z: 0});
    routing.steer(first, FAR, 1 / 60);
    const moved: RoutedActor = {...first, position: frame.geodesicStep(first.position, scale(first.forward, 25)).position};
    routing.steer(moved, FAR, 1 / 60);
    const last = navigation.asked.at(-1)!;
    expect(length(sub(last.from, moved.position))).toBeLessThan(1e-9);
    expect(length(sub(last.to, FAR))).toBeLessThan(1e-9);
  });
});

function angleBetween(a: Vec3, b: Vec3): number {
  const cosine = Math.max(-1, Math.min(1, dot(normalize(a), normalize(b))));
  return Math.acos(cosine);
}

function tangentTo(actor: RoutedActor, goal: Vec3): Vec3 {
  const delta = sub(goal, actor.position);
  return normalize(sub(delta, scale(actor.up, dot(delta, actor.up))));
}
