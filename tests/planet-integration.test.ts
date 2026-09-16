import {describe, expect, it} from 'vitest';
import type {Vec3} from '../src/core/contracts';
import {PLANET, PlanetFrame, cross, dot, length, normalize, reject, sub} from '../src/planet/PlanetFrame';
import {PlanetCollision} from '../src/planet/PlanetCollision';
import {PlanetMotor} from '../src/planet/PlanetMotor';
import {
  PlanetManifestError, loadPlanetManifest, parsePlanetManifest, type PlanetManifest,
} from '../src/planet-game/PlanetManifest';
import {PlanetGraph} from '../src/planet-game/PlanetGraph';
import {localVector, localYaw, createLocalPose, LOCAL_POSE_FIELDS} from '../src/planet-game/PlanetAvatar';
import {findIslandSpawn, probeSpawn, respawnAbove, SPAWN_DEFAULTS} from '../src/planet-game/PlanetSpawn';
import {PlanetObjective} from '../src/planet-game/PlanetObjective';

// ---------------------------------------------------------------- fixtures

/** Casca esférica de teste. É dado de teste, não arte de mundo: nada disto entra na cena. */
function sphereMesh(radius: number, rings: number, sectors: number): {positions: number[]; indices: number[]} {
  const positions: number[] = [], indices: number[] = [];
  for (let r = 0; r <= rings; r++) {
    const phi = r / rings * Math.PI;
    for (let s = 0; s <= sectors; s++) {
      const theta = s / sectors * Math.PI * 2;
      positions.push(
        radius * Math.sin(phi) * Math.cos(theta),
        radius * Math.cos(phi),
        radius * Math.sin(phi) * Math.sin(theta),
      );
    }
  }
  const stride = sectors + 1;
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < sectors; s++) {
      const a = r * stride + s, b = a + stride;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  return {positions, indices};
}

/** Retângulo horizontal na direção `up`, centrado em `centre`. */
function deck(centre: Vec3, up: Vec3, half: number): {positions: number[]; indices: number[]} {
  const east = normalize(cross(Math.abs(up.y) < 0.9 ? {x: 0, y: 1, z: 0} : {x: 1, y: 0, z: 0}, up));
  const north = cross(up, east);
  const corner = (a: number, b: number): number[] => [
    centre.x + east.x * a * half + north.x * b * half,
    centre.y + east.y * a * half + north.y * b * half,
    centre.z + east.z * a * half + north.z * b * half,
  ];
  return {
    positions: [...corner(-1, -1), ...corner(1, -1), ...corner(1, 1), ...corner(-1, 1)],
    indices: [0, 1, 2, 0, 2, 3],
  };
}

const direction = (x: number, y: number, z: number): Vec3 => normalize({x, y, z});

/** Topologia do contrato: 6 cardeais + 8 cantos de cubo, cada canto ligado aos 3 cardeais. */
function archipelagoManifest(radius = 200): PlanetManifest {
  const cardinals: Record<string, Vec3> = {
    east: {x: 1, y: 0, z: 0}, west: {x: -1, y: 0, z: 0},
    north: {x: 0, y: 1, z: 0}, south: {x: 0, y: -1, z: 0},
    front: {x: 0, y: 0, z: 1}, back: {x: 0, y: 0, z: -1},
  };
  const islands: PlanetManifest['islands'][number][] = [];
  const bridges: PlanetManifest['bridges'][number][] = [];
  const push = (id: string, up: Vec3): void => {
    const unit = normalize(up);
    const centre = {x: unit.x * radius, y: unit.y * radius, z: unit.z * radius};
    islands.push({id, name: id, up: unit, centre, spawn: centre, radius: 40, source: 'test'});
  };
  for (const [id, up] of Object.entries(cardinals)) push(id, up);
  let corner = 0;
  for (const sx of [1, -1]) for (const sy of [1, -1]) for (const sz of [1, -1]) {
    const id = `junction-${corner++}`;
    push(id, direction(sx, sy, sz));
    for (const [cardinalId, up] of Object.entries(cardinals)) {
      if (dot(up, direction(sx, sy, sz)) <= 0.01) continue;
      const a = islands.at(-1)!.centre, b = {x: up.x * radius, y: up.y * radius, z: up.z * radius};
      bridges.push({
        id: `${id}~${cardinalId}`, a: id, b: cardinalId, width: 6,
        waypoints: [a, {x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2}, b],
      });
    }
  }
  return {
    version: 1, centre: {x: 0, y: 0, z: 0}, radius,
    positions: new Float64Array([0, 0, 0, 1, 0, 0, 0, 0, 1]),
    indices: new Uint32Array([0, 1, 2]),
    islands, bridges,
  };
}

const rawManifest = (): Record<string, unknown> => ({
  version: 1, centre: {x: 0, y: 0, z: 0}, radius: 200,
  positions: [0, 200, 0, 5, 200, 0, 0, 200, 5],
  indices: [0, 1, 2],
  islands: [{id: 'north', name: 'Norte', up: {x: 0, y: 1, z: 0}, centre: {x: 0, y: 200, z: 0},
    spawn: {x: 0, y: 200, z: 0}, radius: 40, source: 'farm-world.glb'}],
  bridges: [],
});

// ---------------------------------------------------------------- manifesto

describe('manifesto do planeta', () => {
  it('aceita o formato do contrato e devolve buffers tipados', () => {
    const manifest = parsePlanetManifest(rawManifest());
    expect(manifest.radius).toBe(200);
    expect(manifest.positions).toBeInstanceOf(Float64Array);
    expect(manifest.indices).toBeInstanceOf(Uint32Array);
    expect(manifest.islands[0]!.name).toBe('Norte');
    expect(length(manifest.islands[0]!.up)).toBeCloseTo(1, 12);
  });

  it('recusa vértice NaN com o índice culpado na mensagem', () => {
    const data = rawManifest();
    (data.positions as number[])[4] = Number.NaN;
    expect(() => parsePlanetManifest(data)).toThrow(/positions\[4\]/);
  });

  it('recusa índice fora dos vértices', () => {
    const data = rawManifest();
    (data.indices as number[])[2] = 99;
    expect(() => parsePlanetManifest(data)).toThrow(/indices\[2\]/);
  });

  it('recusa ponte que aponta para ilha inexistente', () => {
    const data = rawManifest();
    data.bridges = [{id: 'x', a: 'north', b: 'lugar-nenhum', width: 6, waypoints: [{x: 0, y: 200, z: 0}, {x: 1, y: 200, z: 0}]}];
    expect(() => parsePlanetManifest(data)).toThrow(/lugar-nenhum/);
  });

  it('recusa `up` degenerado em vez de produzir NaN mais tarde', () => {
    const data = rawManifest();
    (data.islands as Record<string, unknown>[])[0]!.up = {x: 0, y: 0, z: 0};
    expect(() => parsePlanetManifest(data)).toThrow(/degenerado/);
  });

  it('transforma 404 numa instrução, não num erro cru', async () => {
    const fetcher = (async () => new Response('', {status: 404})) as unknown as typeof fetch;
    await expect(loadPlanetManifest('/models/planet-archipelago.json', fetcher))
      .rejects.toBeInstanceOf(PlanetManifestError);
    await expect(loadPlanetManifest('/models/planet-archipelago.json', fetcher))
      .rejects.toThrow(/ainda não foi gerado/);
  });
});

// ---------------------------------------------------------------- grafo

describe('grafo do arquipélago', () => {
  const graph = new PlanetGraph(archipelagoManifest());

  // O fixture sintético tem 6 cardeais + 8 cantos; a cena real lê TUDO do manifesto e não depende
  // destas contagens — o Codex já está gerando um planeta com mais ilhas e mais pontes.
  it('o arquipélago do fixture é conexo e toda ilha tem ponte', () => {
    expect(graph.size).toBe(14);
    expect(graph.islands.every(island => graph.neighbours(island.id).length > 0)).toBe(true);
    expect(graph.connected('north')).toBe(true);
  });

  it('o alvo distante nunca é vizinho de ponte', () => {
    for (const island of graph.islands) {
      const target = graph.farthestFrom(island.id);
      expect(target).toBeDefined();
      expect(graph.neighbours(island.id)).not.toContain(target!.id);
      expect(target!.id).not.toBe(island.id);
    }
  });

  it('a rota segue as pontes e é mais longa que a reta pelo vazio', () => {
    const route = graph.route('north', 'south');
    expect(route).toBeDefined();
    expect(route!.hops).toBeGreaterThanOrEqual(2);
    const chord = length(sub(graph.island('south')!.centre, graph.island('north')!.centre));
    expect(route!.length).toBeGreaterThan(chord);
    // A polilinha nunca passa perto do centro: atravessar o planeta seria "reta pelo vazio".
    for (const point of route!.waypoints) expect(length(point)).toBeGreaterThan(graph.radius * 0.6);
  });

  it('identifica a ilha sob um ponto qualquer da superfície', () => {
    expect(graph.islandAt({x: 0, y: 260, z: 0})?.id).toBe('north');
    expect(graph.islandAt({x: -230, y: 2, z: 0})?.id).toBe('west');
  });
});

// ---------------------------------------------------------------- pose local do avatar

describe('pose local do avatar', () => {
  it('no polo norte a base local é a identidade do jogo plano', () => {
    const up = {x: 0, y: 1, z: 0}, reference = {x: 0, y: 0, z: 1};
    expect(localYaw(up, reference, {x: 0, y: 0, z: 1})).toBeCloseTo(0, 12);
    expect(localYaw(up, reference, {x: 1, y: 0, z: 0})).toBeCloseTo(Math.PI / 2, 12);
    const v = localVector(up, reference, {x: 3, y: -2, z: 5});
    expect(v).toEqual({x: 3, y: -2, z: 5});
  });

  it('no antípoda (de cabeça para baixo) o yaw continua finito e contínuo', () => {
    const up = {x: 0, y: -1, z: 0};
    const reference = normalize(reject({x: 0, y: 0, z: 1}, up));
    for (let i = 0; i <= 64; i++) {
      const angle = i / 64 * Math.PI * 2;
      const right = cross(up, reference);
      const facing = {
        x: reference.x * Math.cos(angle) + right.x * Math.sin(angle),
        y: reference.y * Math.cos(angle) + right.y * Math.sin(angle),
        z: reference.z * Math.cos(angle) + right.z * Math.sin(angle),
      };
      const yaw = localYaw(up, reference, facing);
      expect(Number.isFinite(yaw)).toBe(true);
      // O ângulo recuperado reconstrói a mesma direção.
      const back = {
        x: reference.x * Math.cos(yaw) + right.x * Math.sin(yaw),
        y: reference.y * Math.cos(yaw) + right.y * Math.sin(yaw),
        z: reference.z * Math.cos(yaw) + right.z * Math.sin(yaw),
      };
      expect(length(sub(back, facing))).toBeLessThan(1e-9);
    }
  });

  it('entrada degenerada não vira NaN', () => {
    expect(localYaw({x: 0, y: 1, z: 0}, {x: 0, y: 0, z: 0}, {x: 0, y: 0, z: 0})).toBe(0);
    const v = localVector({x: 0, y: 1, z: 0}, {x: 0, y: 0, z: 0}, {x: 1, y: 1, z: 1});
    expect(Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z)).toBe(true);
  });

  it('a pose local declara exatamente os campos documentados do elenco', () => {
    const pose = createLocalPose() as unknown as Record<string, unknown>;
    expect(Object.keys(pose).sort()).toEqual([...LOCAL_POSE_FIELDS].sort());
    for (const field of LOCAL_POSE_FIELDS) expect(pose[field]).toBeDefined();
  });
});

// ---------------------------------------------------------------- sonda de nascimento

describe('sonda de nascimento', () => {
  const frame = new PlanetFrame(PLANET);

  const collisionOf = (...parts: {positions: number[]; indices: number[]}[]): PlanetCollision => {
    const positions: number[] = [], indices: number[] = [];
    for (const part of parts) {
      const base = positions.length / 3;
      positions.push(...part.positions);
      for (const index of part.indices) indices.push(index + base);
    }
    const collision = new PlanetCollision();
    collision.setGeometry(positions, indices);
    return collision;
  };

  it('aceita um convés plano e pousa o pé no apoio medido', () => {
    const up = {x: 0, y: 1, z: 0};
    const collision = collisionOf(deck({x: 0, y: 200, z: 0}, up, 30));
    const probe = probeSpawn(collision, frame, {x: 0, y: 202, z: 0});
    expect(probe).toBeDefined();
    expect(probe!.position.y).toBeCloseTo(200 + SPAWN_DEFAULTS.clearance, 6);
    expect(probe!.slopeDegrees).toBeLessThan(1);
  });

  it('recusa um ponto sem nenhum apoio sob a vertical local', () => {
    const collision = collisionOf(deck({x: 0, y: 200, z: 0}, {x: 0, y: 1, z: 0}, 5));
    expect(probeSpawn(collision, frame, {x: 80, y: 200, z: 0})).toBeUndefined();
  });

  it('recusa nascer sob teto mais baixo que o corpo', () => {
    const up = {x: 0, y: 1, z: 0};
    const collision = collisionOf(
      deck({x: 0, y: 200, z: 0}, up, 30),
      deck({x: 0, y: 201, z: 0}, up, 30),
    );
    // A sonda parte de baixo do teto (0,5 m acima do candidato) — é o caso "andar de baixo de um
    // prédio": existe piso, mas o corpo de 1,8 m não cabe.
    const options = {...SPAWN_DEFAULTS, above: 0.5};
    expect(probeSpawn(collision, frame, {x: 0, y: 200.2, z: 0}, options)).toBeUndefined();
    // Sem o teto, o mesmo ponto passa: o que reprova é a altura livre, não o piso.
    const open = collisionOf(deck({x: 0, y: 200, z: 0}, up, 30));
    expect(probeSpawn(open, frame, {x: 0, y: 200.2, z: 0}, options)).toBeDefined();
  });

  it('funciona igual na face de baixo do planeta', () => {
    const up = {x: 0, y: -1, z: 0};
    const collision = collisionOf(deck({x: 0, y: -200, z: 0}, up, 30));
    const probe = probeSpawn(collision, frame, {x: 0, y: -202, z: 0});
    expect(probe).toBeDefined();
    expect(probe!.up.y).toBeCloseTo(-1, 6);
    expect(probe!.position.y).toBeCloseTo(-200 - SPAWN_DEFAULTS.clearance, 6);
  });

  it('varre a pegada quando o `spawn` autoral cai fora do convés', () => {
    const up = direction(1, 1, 1);
    const centre = {x: up.x * 200, y: up.y * 200, z: up.z * 200};
    const collision = collisionOf(deck(centre, up, 25));
    const island = {
      id: 'canto', name: 'Canto', up, centre,
      // O `spawn` autoral está 90 m fora do convés: a sonda direta reprova.
      spawn: {x: centre.x + 90, y: centre.y, z: centre.z}, radius: 30, source: 'test',
    };
    const probe = findIslandSpawn(collision, frame, island);
    expect(probe).toBeDefined();
    expect(length(sub(probe!.position, centre))).toBeLessThan(island.radius);
  });

  it('o respawn fica ACIMA do apoio validado, não dentro da geologia', () => {
    const up = {x: 0, y: 1, z: 0};
    const collision = collisionOf(deck({x: 0, y: 200, z: 0}, up, 30));
    const probe = probeSpawn(collision, frame, {x: 0, y: 202, z: 0})!;
    const at = respawnAbove(probe, 1.2);
    expect(at.y).toBeCloseTo(probe.position.y + 1.2, 6);
    expect(frame.radius(at)).toBeGreaterThan(frame.radius(probe.position));
  });
});

// ---------------------------------------------------------------- objetivo do cálice

describe('objetivo do cálice no planeta', () => {
  const frame = new PlanetFrame(PLANET);
  const manifest = archipelagoManifest();
  const graph = new PlanetGraph(manifest);

  /** Um convés por ilha, para a sonda ter o que validar. */
  const shellCollision = (): PlanetCollision => {
    const positions: number[] = [], indices: number[] = [];
    for (const island of manifest.islands) {
      const part = deck(island.centre, island.up, 20);
      const base = positions.length / 3;
      positions.push(...part.positions);
      for (const index of part.indices) indices.push(index + base);
    }
    const collision = new PlanetCollision();
    collision.setGeometry(positions, indices);
    return collision;
  };

  it('planta o cálice longe: nunca vizinho, sempre com apoio validado', () => {
    const collision = shellCollision();
    for (const home of manifest.islands) {
      const objective = new PlanetObjective(frame, graph);
      const site = objective.plan(collision, home);
      expect(site).toBeDefined();
      expect(site!.island.id).not.toBe(home.id);
      expect(graph.neighbours(home.id)).not.toContain(site!.island.id);
      expect(site!.probe.slopeDegrees).toBeLessThanOrEqual(SPAWN_DEFAULTS.maxSlopeDegrees);
    }
  });

  it('a distância anunciada é a de caminhada, não a corda pelo vazio', () => {
    const collision = shellCollision();
    const home = graph.island('north')!;
    const objective = new PlanetObjective(frame, graph);
    const site = objective.plan(collision, home)!;
    const walking = objective.walkingDistance(home.centre);
    const chord = length(sub(site.position, home.centre));
    expect(walking).toBeGreaterThan(chord);
    expect(Number.isFinite(walking)).toBe(true);
  });

  it('percorre procurar → encontrado → ativo e só aceita `E` ao lado do cálice', () => {
    const collision = shellCollision();
    const home = graph.island('north')!;
    const objective = new PlanetObjective(frame, graph);
    const site = objective.plan(collision, home)!;
    expect(objective.phase).toBe('procurar');

    objective.update(home.centre);
    expect(objective.phase).toBe('procurar');
    expect(objective.label(home.centre)).toMatch(/Explore o planeta/);

    // A 30 m do cálice, na mesma ilha: descoberto, mas ainda longe do alcance do `E`.
    const tangent = cross(site.probe.up, normalize(cross(
      Math.abs(site.probe.up.y) < 0.9 ? {x: 0, y: 1, z: 0} : {x: 1, y: 0, z: 0}, site.probe.up)));
    const near = frame.geodesicStep(site.position, {x: tangent.x * 30, y: tangent.y * 30, z: tangent.z * 30}).position;
    objective.update(near);
    expect(objective.phase).toBe('encontrado');
    expect(objective.activate(near)).toBeUndefined();

    objective.update(site.position);
    expect(objective.phase).toBe('ativo');
    expect(objective.label(site.position)).toMatch(/\[E\]/);
    // O primeiro `E` acorda a horda final; a coleta é o SEGUNDO uso e tem porta própria,
    // coberta em `tests/planet-combat.test.ts`.
    expect(objective.activate(site.position)).toBe('horda');
    expect(objective.hordeActive).toBe(true);
    expect(objective.complete).toBe(false);
  });
});

// ---------------------------------------------------------------- travessia real

describe('travessia sobre a casca', () => {
  const frame = new PlanetFrame(PLANET);
  const shell = sphereMesh(PLANET.surfaceRadius, 96, 192);
  const collision = new PlanetCollision();
  collision.setGeometry(shell.positions, shell.indices);

  const walk = (motor: PlanetMotor, steps: number): void => {
    for (let i = 0; i < steps; i++) motor.fixedUpdate(1 / 60, {x: 0, z: 1, jump: false, sprint: true});
  };

  it('dá a volta completa e volta ao ponto de partida', () => {
    const spawn = frame.fromDirection({x: 0, y: 0, z: 1}, 0.4);
    const motor = new PlanetMotor({frame, collision, spawn, heading: {x: 1, y: 0, z: 0}});
    walk(motor, 120);
    const start = {...motor.position};
    // Circunferência a 6,8 m/s: 1256,6 / 6,8 = 184,8 s.
    const lap = Math.round(frame.circumference / (6.8 / 60));
    walk(motor, lap);
    const gap = frame.arcDistance(start, motor.position);
    expect(gap).toBeLessThan(frame.circumference * 0.02);
    expect(motor.recoveries).toBe(0);
    expect(motor.grounded).toBe(true);
  });

  it('passa pelo polo e pela face de baixo mantendo apoio e velocidade', () => {
    const spawn = frame.fromDirection({x: 0, y: 0, z: 1}, 0.4);
    const motor = new PlanetMotor({frame, collision, spawn, heading: {x: 0, y: 1, z: 0}});
    walk(motor, 60);
    let crossedPole = false, crossedUnderside = false, minSpeed = Infinity;
    for (let i = 0; i < 12_000; i++) {
      motor.fixedUpdate(1 / 60, {x: 0, z: 1, jump: false, sprint: true});
      const up = motor.up;
      if (up.y > 0.98) crossedPole = true;
      if (up.y < -0.9) crossedUnderside = true;
      if (i > 120) minSpeed = Math.min(minSpeed, motor.tangentialSpeed);
      expect(Number.isFinite(motor.position.x + motor.position.y + motor.position.z)).toBe(true);
    }
    expect(crossedPole).toBe(true);
    expect(crossedUnderside).toBe(true);
    // "De cabeça para baixo" não pode custar velocidade: a gravidade é radial, não −Y.
    expect(minSpeed).toBeGreaterThan(5.5);
    expect(Math.abs(motor.altitude)).toBeLessThan(1);
  });

  it('o salto sobe pela vertical LOCAL na face de baixo', () => {
    const spawn = frame.fromDirection({x: 0, y: -1, z: 0}, 0.4);
    const motor = new PlanetMotor({frame, collision, spawn, heading: {x: 1, y: 0, z: 0}});
    for (let i = 0; i < 60; i++) motor.fixedUpdate(1 / 60, {x: 0, z: 0, jump: false, sprint: false});
    expect(motor.grounded).toBe(true);
    const before = frame.radius(motor.position);
    motor.fixedUpdate(1 / 60, {x: 0, z: 0, jump: true, sprint: false});
    for (let i = 0; i < 18; i++) motor.fixedUpdate(1 / 60, {x: 0, z: 0, jump: false, sprint: false});
    // Subir = aumentar o raio, mesmo com o `y` do mundo ficando mais negativo.
    expect(frame.radius(motor.position)).toBeGreaterThan(before + 0.5);
    expect(motor.position.y).toBeLessThan(0);
  });

  it('cair no vazio devolve o corpo a um apoio válido', () => {
    const spawn = frame.fromDirection({x: 0, y: 0, z: 1}, 0.4);
    const motor = new PlanetMotor({frame, collision, spawn, heading: {x: 1, y: 0, z: 0}});
    walk(motor, 120);
    motor.teleport(frame.atAltitude(motor.position, -(frame.surfaceRadius - frame.voidRadius) - 5));
    motor.fixedUpdate(1 / 60, {x: 0, z: 0, jump: false, sprint: false});
    expect(motor.recoveries).toBe(1);
    expect(frame.radius(motor.position)).toBeGreaterThan(frame.voidRadius);
  });
});
