import {readFileSync, writeFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import type {Vec3} from '../src/core/contracts';
import {PlanetCollision} from '../src/planet/PlanetCollision';
import {PLANET, PlanetFrame, add, cross, distance, dot, normalize, scale, sub} from '../src/planet/PlanetFrame';
import {PLANET_MOTOR_TUNING, PlanetMotor} from '../src/planet/PlanetMotor';
import {footAt, routeLength, walkRoute, type RouteWalkResult} from '../src/planet/RouteWalk';
import {findIslandSpawn} from '../src/planet-game/PlanetSpawn';
import type {IslandRecord, PlanetManifest} from '../src/planet-game/PlanetManifest';

/**
 * Auditoria de TRAVESSIA sobre a colisão real do arquipélago.
 *
 * Diferente de `audit-planet-assets.ts`, que amostra pontos e anda alguns metros no meio de cada
 * ponte, aqui o corpo atravessa cada ponte INTEIRA, nos DOIS sentidos, dirigido waypoint a
 * waypoint pelo manifesto. O que se mede é o que o jogador sente: chegou do outro lado, ficou no
 * chão, não caiu no vazio, não ficou pendurado no ar.
 *
 * Quando a arte barra o corpo, o ponto exato e a causa vão para o relatório. Nada de física
 * afrouxada para "passar" — os extremos das pontes encostam de propósito no solo das ilhas, e a
 * correção certa é geometria, não tolerância.
 *
 *   npx tsx scripts/audit-planet-traversal.ts
 */

const t = PLANET_MOTOR_TUNING;
const MANIFEST = 'public/models/planet-archipelago.json.gz';
const JSON_OUT = 'docs/planet-traversal-audit.json';
const NOTE_OUT = '.temp/planet-traversal-result.md';

/** Limites duros: uma travessia de 124 m a 6,8 m/s leva ~18 s; 90 s é teto com folga larga. */
const WALK = {dt: 1 / 60, sprint: true, maxSeconds: 90, endpointRadius: 3} as const;
/** Critérios de aprovação da travessia. */
const PASS = {groundedRate: 0.9, longestHangSeconds: 1.2, gapWhileGrounded: 0.35, lateral: 12} as const;

const round = (v: number, places = 3): number => Number(v.toFixed(places));
const point = (v: Vec3): {x: number; y: number; z: number} => ({x: round(v.x), y: round(v.y), z: round(v.z)});

const loaded = performance.now();
const manifest = JSON.parse(gunzipSync(readFileSync(MANIFEST)).toString('utf8')) as PlanetManifest;
const frame = new PlanetFrame({
  ...PLANET, centre: manifest.centre, surfaceRadius: manifest.radius, voidRadius: manifest.radius - 32,
});
const world = new PlanetCollision();
world.setGeometry(manifest.positions, manifest.indices);
console.log(`manifesto ${manifest.islands.length} ilhas / ${manifest.bridges.length} pontes, ` +
  `${world.triangleCount} triângulos, ${Math.round(performance.now() - loaded)} ms`);

function verdict(walk: RouteWalkResult): {pass: boolean; faults: string[]} {
  const faults: string[] = [];
  if (!walk.reached) faults.push('não chegou ao outro extremo');
  if (walk.recoveries > 0) faults.push(`caiu no vazio ${walk.recoveries}×`);
  if (walk.groundedRate < PASS.groundedRate) faults.push(`apoiado só ${(walk.groundedRate * 100).toFixed(1)}%`);
  if (walk.longestHangSeconds > PASS.longestHangSeconds) faults.push(`pendurado ${walk.longestHangSeconds.toFixed(2)} s`);
  if (walk.maxGapWhileGrounded > PASS.gapWhileGrounded) faults.push(`flutuou ${walk.maxGapWhileGrounded.toFixed(2)} m "apoiado"`);
  if (walk.maxLateralDeviation > PASS.lateral) faults.push(`desviou ${walk.maxLateralDeviation.toFixed(1)} m da rota`);
  return {pass: faults.length === 0, faults};
}

/**
 * Perfil do piso em volta de um bloqueio, ao longo da própria rota.
 *
 * Serve para o Codex achar a instância culpada sem abrir o Blender às cegas: diz onde o piso sobe,
 * onde o volume da cápsula começa a encostar, e qual é o degrau entre a rampa e o convés de chegada.
 * `d` negativo aponta para o extremo mais próximo, `d` positivo para o meio da ponte.
 */
function blockageProfile(route: readonly Vec3[], at: Vec3, span = 6, step = 0.5) {
  const up = frame.up(at);
  const middle = route[Math.floor(route.length / 2)]!;
  const along = sub(middle, at);
  const tangent = normalize(sub(along, scale(up, dot(along, up))));
  const samples = [];
  for (let d = -span; d <= span + 1e-9; d += step) {
    const probe = add(at, scale(tangent, d));
    const u = frame.up(probe);
    const support = world.supportBelow(probe, u, 3, 4);
    const contact = support ? world.deepestContact(add(support.point, scale(u, 0.035)), u, t.radius, t.height) : undefined;
    samples.push({
      d: round(d, 1),
      altitude: support ? round(frame.altitude(support.point), 3) : null,
      slopeDegrees: support ? round(support.slopeDegrees, 1) : null,
      capsuleDepth: contact ? round(contact.depth) : 0,
    });
  }
  return samples;
}

function report(walk: RouteWalkResult, from: string, to: string, id: string, direction: 'a→b' | 'b→a') {
  const {pass, faults} = verdict(walk);
  return {
    id, direction, from, to, pass, faults,
    reached: walk.reached,
    routeLength: round(walk.routeLength, 2),
    progress: round(walk.progress, 2),
    travelled: round(walk.travelled, 2),
    reachedWaypoint: walk.reachedWaypoint,
    seconds: round(walk.seconds, 2),
    groundedRate: round(walk.groundedRate, 4),
    longestHangSeconds: round(walk.longestHangSeconds, 3),
    maxGapWhileGrounded: round(walk.maxGapWhileGrounded),
    maxGapWhileAirborne: round(walk.maxGapWhileAirborne),
    maxLateralDeviation: round(walk.maxLateralDeviation, 2),
    minAltitude: round(walk.minAltitude, 2),
    maxAltitude: round(walk.maxAltitude, 2),
    recoveries: walk.recoveries,
    endPosition: point(walk.endPosition),
    ...(walk.blockage ? {
      blockage: {
        reason: walk.blockage.reason,
        waypoint: walk.blockage.waypoint,
        position: point(walk.blockage.position),
        altitude: round(frame.altitude(walk.blockage.position), 3),
        ...(walk.blockage.normal ? {normal: point(walk.blockage.normal)} : {}),
        ...(walk.blockage.depth === undefined ? {} : {depth: round(walk.blockage.depth)}),
        ...(walk.blockage.hitTime === undefined ? {} : {hitTime: round(walk.blockage.hitTime, 4)}),
      },
    } : {}),
  };
}

/**
 * Quanto de desvio lateral abriria a passagem.
 *
 * O condutor segue a linha autoral e não desvia de propósito. Sem esta medida, "bloqueado" não
 * distingue "corredor inteiro fechado" de "a instância está em cima da linha e sobra deck ao lado".
 * Repete a travessia com os últimos waypoints deslocados e diz o menor desvio que passa — é
 * exatamente a correção de autoria a aplicar (mover a instância ou os waypoints).
 */
function clearanceSweep(route: readonly Vec3[], tail = 4) {
  const offsets = [-3, -2.5, -2, -1.5, -1, -0.5, 0.5, 1, 1.5, 2, 2.5, 3];
  const tried = [];
  for (const offset of offsets) {
    const shifted = route.map((p, i) => {
      if (i < route.length - tail) return p;
      const up = frame.up(p);
      const previous = route[Math.max(0, i - 1)]!;
      const along = normalize(sub(sub(p, previous), scale(up, dot(sub(p, previous), up))));
      return add(p, scale(cross(up, along), offset));
    });
    const walk = walkRoute(world, frame, shifted, WALK);
    tried.push({offset, reached: walk.reached, progress: round(walk.progress, 2)});
  }
  const cleared = tried.filter(x => x.reached).sort((a, b) => Math.abs(a.offset) - Math.abs(b.offset));
  return {
    tail,
    tried,
    /** Menor desvio lateral que completa a travessia; `null` = corredor fechado nos dois lados. */
    smallestClearing: cleared.length ? cleared[0]!.offset : null,
    /** Ponto para onde o último waypoint teria de ir com esse desvio. */
    suggestedEndpoint: cleared.length ? point(shiftPoint(route, cleared[0]!.offset)) : null,
  };
}

function shiftPoint(route: readonly Vec3[], offset: number): Vec3 {
  const last = route[route.length - 1]!, previous = route[route.length - 2]!;
  const up = frame.up(last);
  const along = normalize(sub(sub(last, previous), scale(up, dot(sub(last, previous), up))));
  return add(last, scale(cross(up, along), offset));
}

/** Degrau entre onde o corpo travou e o convés logo à frente — o número que a autoria precisa. */
function entranceStep(route: readonly Vec3[], at: Vec3): {deckAltitude: number | null; step: number | null} {
  const endpoint = distance(at, route[0]!) < distance(at, route[route.length - 1]!) ? route[0]! : route[route.length - 1]!;
  const support = world.supportBelow(endpoint, frame.up(endpoint), 3, 4);
  if (!support) return {deckAltitude: null, step: null};
  const deck = frame.altitude(support.point);
  return {deckAltitude: round(deck, 3), step: round(deck - frame.altitude(at), 3)};
}

// ---------------------------------------------------------------- pontes, nos dois sentidos
type BridgeReport = ReturnType<typeof report> & {
  profile?: ReturnType<typeof blockageProfile>;
  entrance?: ReturnType<typeof entranceStep>;
  clearance?: ReturnType<typeof clearanceSweep>;
};
const bridges: BridgeReport[] = [];
for (const bridge of manifest.bridges) {
  const forward = [...bridge.waypoints];
  const backward = [...forward].reverse();
  const a = walkRoute(world, frame, forward, WALK);
  const b = walkRoute(world, frame, backward, WALK);
  const entries: {walk: RouteWalkResult; route: readonly Vec3[]; record: BridgeReport}[] = [
    {walk: a, route: forward, record: report(a, bridge.a, bridge.b, bridge.id, 'a→b')},
    {walk: b, route: backward, record: report(b, bridge.b, bridge.a, bridge.id, 'b→a')},
  ];
  for (const entry of entries) {
    // O perfil só é levantado para quem falhou: é caro e não interessa em travessia limpa.
    if (!entry.record.pass && entry.walk.blockage) {
      entry.record.profile = blockageProfile(entry.route, entry.walk.blockage.position);
      entry.record.entrance = entranceStep(entry.route, entry.walk.blockage.position);
      entry.record.clearance = clearanceSweep(entry.route);
    }
    bridges.push(entry.record);
  }
  const mark = (r: RouteWalkResult) => (verdict(r).pass ? 'ok' : 'FALHA');
  console.log(`${bridge.id.padEnd(20)} ${routeLength(forward).toFixed(1).padStart(6)} m  ` +
    `a→b ${mark(a).padEnd(5)} b→a ${mark(b)}`);
}

// ---------------------------------------------- ilhas cardeais: parado, salto e volta do vazio
const CARDINALS: {name: string; direction: Vec3}[] = [
  {name: '+Y', direction: {x: 0, y: 1, z: 0}}, {name: '-Y', direction: {x: 0, y: -1, z: 0}},
  {name: '+X', direction: {x: 1, y: 0, z: 0}}, {name: '-X', direction: {x: -1, y: 0, z: 0}},
  {name: '+Z', direction: {x: 0, y: 0, z: 1}}, {name: '-Z', direction: {x: 0, y: 0, z: -1}},
];

/** Ilha cujo `up` mais se aproxima da direção cardeal pedida. */
function nearestIsland(direction: Vec3): IslandRecord {
  let best = manifest.islands[0]!, score = -Infinity;
  for (const island of manifest.islands) {
    const value = dot(normalize(island.up), direction);
    if (value > score) {score = value; best = island;}
  }
  return best;
}

const idle = {x: 0, z: 0, jump: false, sprint: false};
const cardinals = CARDINALS.map(({name, direction}) => {
  const island = nearestIsland(direction);
  const spawn = findIslandSpawn(world, frame, island);
  if (!spawn) {
    return {cardinal: name, island: island.id, pass: false, faults: ['findIslandSpawn não achou apoio']};
  }
  const motor = new PlanetMotor({frame, collision: world, spawn: spawn.position});
  for (let i = 0; i < 180; i++) motor.fixedUpdate(WALK.dt, idle);
  const settled = {...motor.position};
  const drift = distance(spawn.position, settled);
  const idleGrounded = motor.grounded;

  // Escorregamento silencioso: 5 s parado não pode mover o corpo.
  for (let i = 0; i < 300; i++) motor.fixedUpdate(WALK.dt, idle);
  const creep = distance(settled, motor.position);

  motor.fixedUpdate(WALK.dt, {...idle, jump: true});
  let apex = 0;
  for (let i = 0; i < 150; i++) {
    motor.fixedUpdate(WALK.dt, idle);
    apex = Math.max(apex, dot(sub(motor.position, settled), spawn.up));
  }
  const landed = motor.grounded && distance(motor.position, settled) < 1;

  // Volta do vazio: jogado bem abaixo do convés, precisa reaparecer sobre apoio caminhável.
  const before = motor.recoveries;
  motor.teleport(frame.fromDirection(spawn.up, -45));
  for (let i = 0; i < 360; i++) motor.fixedUpdate(WALK.dt, idle);
  const support = world.supportBelow(motor.position, motor.up, 0.3, 1);
  const recovered = motor.recoveries > before && motor.grounded
    && !!support && support.slopeDegrees <= t.maxSlopeDegrees;

  const faults: string[] = [];
  if (!idleGrounded) faults.push('não ficou apoiado parado');
  if (drift > 0.3) faults.push(`deriva de nascimento ${drift.toFixed(3)} m`);
  if (creep > 0.02) faults.push(`escorregou ${creep.toFixed(3)} m parado`);
  if (apex < t.jumpApex - 0.35) faults.push(`salto só ${apex.toFixed(2)} m`);
  if (!landed) faults.push('não voltou ao ponto depois do salto');
  if (!recovered) faults.push('não recuperou da queda em apoio caminhável');
  return {
    cardinal: name, island: island.id, pass: faults.length === 0, faults,
    up: point(spawn.up), alignment: round(dot(normalize(island.up), direction), 4),
    spawn: point(spawn.position), slopeDegrees: round(spawn.slopeDegrees, 2),
    idleGrounded, drift: round(drift), creep: round(creep, 5),
    jumpApex: round(apex), landedBack: landed, recovered,
  };
});
for (const c of cardinals) console.log(`cardinal ${c.cardinal} (${c.island}) ${c.pass ? 'ok' : 'FALHA: ' + c.faults.join('; ')}`);

// ---------------------------------------------------------------------------------- relatório
const failedBridges = bridges.filter(b => !b.pass);
const failedCardinals = cardinals.filter(c => !c.pass);
const summary = {
  generatedFrom: MANIFEST,
  radius: manifest.radius,
  triangles: world.triangleCount,
  sprint: WALK.sprint,
  dt: WALK.dt,
  thresholds: PASS,
  bridgeRuns: bridges.length,
  bridgeFailures: failedBridges.length,
  cardinalFailures: failedCardinals.length,
};
writeFileSync(JSON_OUT, JSON.stringify({summary, bridges, cardinals}, null, 2));

const lines: string[] = [];
lines.push('# Auditoria de travessia do planeta', '');
lines.push(`Gerado por \`scripts/audit-planet-traversal.ts\` sobre \`${MANIFEST}\` ` +
  `(${world.triangleCount} triângulos, raio ${manifest.radius} m).`, '');
lines.push(`Corpo dirigido waypoint a waypoint com \`PlanetMotor\`, passo fixo ${WALK.dt.toFixed(5)} s, ` +
  `corrida ${WALK.sprint ? 'ligada' : 'desligada'}, teto de ${WALK.maxSeconds} s por travessia.`, '');
lines.push('## Resultado', '');
lines.push(`- travessias de ponte: **${bridges.length - failedBridges.length}/${bridges.length}** ` +
  `(${manifest.bridges.length} pontes × 2 sentidos)`);
lines.push(`- verificações cardeais (parado + salto + volta do vazio): ` +
  `**${cardinals.length - failedCardinals.length}/${cardinals.length}**`, '');
if (failedBridges.length) {
  lines.push('## Pontes com problema', '');
  lines.push('| ponte | sentido | avanço | waypoint | causa | ponto exato |');
  lines.push('|---|---|---|---|---|---|');
  for (const b of failedBridges) {
    const p = b.blockage?.position;
    lines.push(`| \`${b.id}\` | ${b.direction} | ${b.progress}/${b.routeLength} m | ` +
      `${b.blockage?.waypoint ?? b.reachedWaypoint} | ${b.blockage?.reason ?? b.faults.join('; ')} | ` +
      `${p ? `\`${p.x}, ${p.y}, ${p.z}\`` : '—'} |`);
  }
  lines.push('');
  for (const b of failedBridges) {
    lines.push(`### \`${b.id}\` ${b.direction} (${b.from} → ${b.to})`);
    lines.push(`- falhas: ${b.faults.join('; ')}`);
    lines.push(`- avanço ${b.progress} m de ${b.routeLength} m, waypoint ${b.reachedWaypoint}, ${b.seconds} s`);
    lines.push(`- apoiado ${(b.groundedRate * 100).toFixed(1)}%, maior tempo no ar ${b.longestHangSeconds} s, ` +
      `desvio lateral máximo ${b.maxLateralDeviation} m`);
    if (b.blockage) {
      lines.push(`- **bloqueio \`${b.blockage.reason}\`** em \`${b.blockage.position.x}, ` +
        `${b.blockage.position.y}, ${b.blockage.position.z}\` (altitude ${b.blockage.altitude} m)` +
        (b.blockage.normal ? `, normal \`${b.blockage.normal.x}, ${b.blockage.normal.y}, ${b.blockage.normal.z}\`` : '') +
        (b.blockage.depth === undefined ? '' : `, profundidade ${b.blockage.depth} m`));
    }
    if (b.entrance && b.entrance.step !== null) {
      lines.push(`- convés do extremo mais próximo a ${b.entrance.deckAltitude} m; ` +
        `**degrau de ${b.entrance.step} m** entre onde o corpo travou e esse convés ` +
        `(o motor sobe no máximo ${t.stepHeight} m)`);
    }
    if (b.clearance) {
      const best = b.clearance.smallestClearing;
      lines.push(best === null
        ? `- **corredor fechado**: nenhum desvio lateral entre −3 m e +3 m dos últimos ` +
          `${b.clearance.tail} waypoints completa a travessia`
        : `- **desvio de ${best > 0 ? '+' : ''}${best} m** nos últimos ${b.clearance.tail} waypoints ` +
          `completa a travessia ⇒ a instância está EM CIMA da linha autoral, com deck livre ao lado. ` +
          `Extremo sugerido: \`${b.clearance.suggestedEndpoint!.x}, ${b.clearance.suggestedEndpoint!.y}, ` +
          `${b.clearance.suggestedEndpoint!.z}\``);
      lines.push('- varredura lateral: ' + b.clearance.tried
        .map(x => `${x.offset > 0 ? '+' : ''}${x.offset}${x.reached ? '✓' : '✗'}`).join(' '));
    }
    if (b.profile) {
      lines.push('');
      lines.push('Perfil ao longo da rota (`d` negativo = para o extremo, positivo = para o meio da ponte):', '');
      lines.push('| d (m) | altitude do piso | inclinação | penetração da cápsula |');
      lines.push('|---|---|---|---|');
      for (const s of b.profile) {
        lines.push(`| ${s.d} | ${s.altitude ?? 'sem piso'} | ${s.slopeDegrees ?? '—'}° | ${s.capsuleDepth || '—'} |`);
      }
    }
    lines.push('');
  }
} else lines.push('Nenhuma ponte reprovou nos dois sentidos.', '');
if (failedCardinals.length) {
  lines.push('## Cardeais com problema', '');
  for (const c of failedCardinals) lines.push(`- \`${c.cardinal}\` (${c.island}): ${c.faults.join('; ')}`);
  lines.push('');
}
lines.push('## Tabela completa', '');
lines.push('| ponte | sentido | ok | avanço (m) | rota (m) | apoiado | ar máx (s) | flutuação (m) | lateral (m) |');
lines.push('|---|---|---|---|---|---|---|---|---|');
for (const b of bridges) {
  lines.push(`| \`${b.id}\` | ${b.direction} | ${b.pass ? '✓' : '✗'} | ${b.progress} | ${b.routeLength} | ` +
    `${(b.groundedRate * 100).toFixed(1)}% | ${b.longestHangSeconds} | ${b.maxGapWhileGrounded} | ${b.maxLateralDeviation} |`);
}
lines.push('');
lines.push('| cardeal | ilha | ok | deriva (m) | escorrega (m) | salto (m) | recuperou |');
lines.push('|---|---|---|---|---|---|---|');
for (const c of cardinals) {
  lines.push(`| ${c.cardinal} | \`${c.island}\` | ${c.pass ? '✓' : '✗'} | ${c.drift ?? '—'} | ` +
    `${c.creep ?? '—'} | ${c.jumpApex ?? '—'} | ${c.recovered ?? '—'} |`);
}
writeFileSync(NOTE_OUT, lines.join('\n') + '\n');

console.log(`\npontes ${bridges.length - failedBridges.length}/${bridges.length} · ` +
  `cardeais ${cardinals.length - failedCardinals.length}/${cardinals.length}`);
console.log(`relatório em ${JSON_OUT} e ${NOTE_OUT}`);
if (failedBridges.length || failedCardinals.length) process.exitCode = 1;
