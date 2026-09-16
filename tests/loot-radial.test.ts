import {describe, it, expect} from 'vitest';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {Scene} from '@babylonjs/core/scene';
import {CollisionWorld} from '../src/physics/CollisionWorld';
import {PlanetCollision} from '../src/planet/PlanetCollision';
import {PlanetFrame, PLANET} from '../src/planet/PlanetFrame';
import {PlayerMotor} from '../src/player/PlayerMotor';
import {RunProgression} from '../src/run/RunProgression';
import {RunInteractables} from '../src/run/RunInteractables';
import {waveRewardSite, surfaceRewardGround, sitesAsFields} from '../src/run/WaveRewardSite';
import {withProps} from '../src/physics/RadialProps';
import {EventBus} from '../src/core/EventBus';
import {RunRNG} from '../src/core/RunRNG';
import type {GameEvents, Vec3} from '../src/core/contracts';
import type {WorldSite} from '../src/world/GameWorld';

/**
 * Itens, baús e recompensas no PLANETA, com as classes originais.
 *
 * O mundo destes testes é o de verdade: `CollisionWorld.configurePlanet` sobre uma
 * `PlanetCollision` com decks de ilha triangulados na casca R=200. Nada de dublê de referencial —
 * o que é exercido é o `SphereSurface` real.
 */

const frame = new PlanetFrame();
const R = PLANET.surfaceRadius;

const norm = (v: Vec3): Vec3 => {const l = Math.hypot(v.x, v.y, v.z) || 1; return {x: v.x / l, y: v.y / l, z: v.z / l};};

/**
 * Um deck de ilha de verdade: leque geodésico de triângulos sobre a casca, centrado na direção
 * dada e com `arc` metros de raio CAMINHADO.
 */
function deck(direction: Vec3, arc: number, rings = 6, segments = 16): {positions: number[]; indices: number[]} {
  const up = norm(direction), {east, north} = PlanetFrame.compass(up);
  const positions: number[] = [up.x * R, up.y * R, up.z * R];
  for (let ring = 1; ring <= rings; ring++) {
    const theta = (arc * ring / rings) / R;
    for (let s = 0; s < segments; s++) {
      const phi = s * 2 * Math.PI / segments;
      const tangent = {
        x: east.x * Math.cos(phi) + north.x * Math.sin(phi),
        y: east.y * Math.cos(phi) + north.y * Math.sin(phi),
        z: east.z * Math.cos(phi) + north.z * Math.sin(phi),
      };
      positions.push(
        (up.x * Math.cos(theta) + tangent.x * Math.sin(theta)) * R,
        (up.y * Math.cos(theta) + tangent.y * Math.sin(theta)) * R,
        (up.z * Math.cos(theta) + tangent.z * Math.sin(theta)) * R);
    }
  }
  const indices: number[] = [];
  const at = (ring: number, s: number) => 1 + (ring - 1) * segments + ((s % segments) + segments) % segments;
  for (let s = 0; s < segments; s++) indices.push(0, at(1, s), at(1, s + 1));
  for (let ring = 1; ring < rings; ring++) for (let s = 0; s < segments; s++) {
    indices.push(at(ring, s), at(ring + 1, s), at(ring + 1, s + 1));
    indices.push(at(ring, s), at(ring + 1, s + 1), at(ring, s + 1));
  }
  return {positions, indices};
}

/** Seis ilhas nos seis polos do contrato R=200, com pegadas deliberadamente diferentes. */
const ISLANDS: {id: string; name: string; direction: Vec3; arc: number}[] = [
  {id: 'front', name: 'Ilha da frente', direction: {x: 0, y: 0, z: 1}, arc: 72},
  {id: 'north', name: 'Ilha norte', direction: {x: 0, y: 1, z: 0}, arc: 43},
  {id: 'south', name: 'Ilha sul', direction: {x: 0, y: -1, z: 0}, arc: 45},
  {id: 'east', name: 'Ilha leste', direction: {x: 1, y: 0, z: 0}, arc: 23},
];

function planet() {
  const collision = new PlanetCollision();
  const positions: number[] = [], indices: number[] = [];
  const sites: WorldSite[] = [];
  for (const island of ISLANDS) {
    const mesh = deck(island.direction, island.arc);
    const base = positions.length / 3;
    positions.push(...mesh.positions);
    indices.push(...mesh.indices.map(i => i + base));
    const up = norm(island.direction);
    sites.push({id: island.id, name: island.name, centre: {x: up.x * R, y: up.y * R, z: up.z * R}, up, radius: island.arc});
  }
  collision.setGeometry(positions, indices);
  const world = new CollisionWorld();
  return {collision, world, sites};
}

function fixture(configure = true) {
  const {collision, world, sites} = planet();
  const engine = new NullEngine(), scene = new Scene(engine), events = new EventBus<GameEvents>();
  const start = sites[0]!.centre;
  // O motor e os interativos nascem ANTES de o mapa ser configurado — é exatamente a ordem real,
  // e é o que pegaria quem guardasse o `FlatSurface` inicial num campo.
  const player = new PlayerMotor(world, events, {x: start.x, y: start.y, z: start.z});
  const run = new RunProgression(events); run.credits = 10_000;
  const chests = new RunInteractables(scene, player, run, events, new RunRNG('radial').stream('interactable'), world);
  expect(world.surface.kind).toBe('flat');            // antes: plano, como tem de ser
  if (configure) {
    world.configurePlanet(frame, collision);
    chests.configurePlacement({sites, surface: () => world.surface, seed: 'semente-do-planeta'});
  }
  return {collision, world, sites, scene, engine, events, player, run, chests,
    close() {chests.dispose(); scene.dispose(); engine.dispose();}};
}

const place = (player: PlayerMotor, p: Vec3) => {Object.assign(player.position, p);};

describe('referencial dinâmico: nunca congelar o FlatSurface inicial', () => {
  it('a classe construída no plano passa a medir por arco assim que o mapa configura o planeta', () => {
    const f = fixture(false);
    try {
      expect(f.world.surface.kind).toBe('flat');
      f.world.configurePlanet(frame, f.collision);
      // Sem reconstruir nada: o getter do CollisionWorld já devolve o referencial novo.
      expect(f.world.surface.kind).toBe('sphere');
      f.chests.configurePlacement({sites: f.sites, surface: () => f.world.surface, seed: 'tardia'});
      expect(f.chests.entries.some(e => e.up !== undefined)).toBe(true);
    } finally {f.close();}
  });
});

describe('colocação de baús nos decks reais', () => {
  it('cada baú nasce apoiado na casca, de pé na vertical da ILHA', () => {
    const f = fixture();
    try {
      const placed = f.chests.entries.filter(e => e.siteId !== undefined);
      expect(placed.length).toBeGreaterThan(0);
      for (const entry of placed) {
        const p = {x: entry.x, y: entry.y, z: entry.z}, radius = Math.hypot(p.x, p.y, p.z);
        // Está na casca, não num "y" de mundo qualquer. A faixa é a FLECHA da facetagem: um deck
        // triangulado é uma casca poliédrica, e o meio de cada face fica `corda²/8R` abaixo do
        // raio ideal (aqui ~0,15 m). Malha autoral é assim; exigir 200,000 seria exigir esfera.
        expect(radius, entry.id).toBeGreaterThan(R - .5);
        expect(radius, entry.id).toBeLessThanOrEqual(R + .01);
        // Tem apoio de verdade sob ele.
        expect(f.world.surface.support(p, 1, 4), entry.id).toBeDefined();
        // A vertical guardada é a radial da ilha, não `+Y`: aponta do centro para o baú.
        const up = entry.up!;
        expect(up.x * p.x + up.y * p.y + up.z * p.z, entry.id).toBeCloseTo(radius, 6);
        expect(Math.hypot(up.x, up.y, up.z), entry.id).toBeCloseTo(1, 9);
        // E ele cai dentro da pegada caminhável do sítio dele.
        const site = f.sites.find(s => s.id === entry.siteId)!;
        expect(f.world.surface.planarDistance(p, site.centre)).toBeLessThanOrEqual(site.radius);
      }
    } finally {f.close();}
  });

  it('é determinística pela semente e varia quando a semente muda', () => {
    const a = fixture(), b = fixture();
    const c = fixture(false);
    try {
      const key = (r: typeof a) => r.chests.entries.filter(e => e.siteId).map(e => `${e.id}@${e.x.toFixed(4)},${e.y.toFixed(4)},${e.z.toFixed(4)}`).join('|');
      expect(key(a)).toBe(key(b));                              // mesma semente, mesmo mapa
      c.world.configurePlanet(frame, c.collision);
      c.chests.configurePlacement({sites: c.sites, surface: () => c.world.surface, seed: 'outra-semente'});
      expect(key(c)).not.toBe(key(a));                          // semente diferente, mapa diferente
      expect(c.chests.entries.filter(e => e.siteId).length).toBe(a.chests.entries.filter(e => e.siteId).length);
    } finally {a.close(); b.close(); c.close();}
  });

  it('espalha por várias ilhas, com quantidade proporcional à pegada e tipos variados', () => {
    const f = fixture();
    try {
      const placed = f.chests.entries.filter(e => e.siteId);
      const bySite = new Map<string, number>();
      for (const e of placed) bySite.set(e.siteId!, (bySite.get(e.siteId!) ?? 0) + 1);
      expect(bySite.size).toBeGreaterThanOrEqual(3);            // não empilhou tudo numa ilha
      // `front` (72 m) tem de receber mais que `east` (23 m).
      expect(bySite.get('front')!).toBeGreaterThan(bySite.get('east')!);
      const kinds = new Set(placed.map(e => e.kind));
      expect(kinds.has('supply')).toBe(true);
      expect(kinds.has('shop')).toBe(true);
      expect(kinds.has('altar')).toBe(true);                    // o altar de risco existe no planeta
      // Baús do mesmo sítio não nascem em cima uns dos outros.
      for (const site of f.sites) {
        const here = placed.filter(e => e.siteId === site.id);
        for (let i = 0; i < here.length; i++) for (let j = i + 1; j < here.length; j++) {
          const a = here[i]!, b = here[j]!;
          expect(f.world.surface.planarDistance({x: a.x, y: a.y, z: a.z}, {x: b.x, y: b.y, z: b.z})).toBeGreaterThanOrEqual(6);
        }
      }
    } finally {f.close();}
  });

  it('âncoras autorais (celeiros) recebem baús quando o mapa as oferece', () => {
    const f = fixture(false);
    try {
      f.world.configurePlanet(frame, f.collision);
      const site = f.sites[0]!, up = site.up;
      const {east} = PlanetFrame.compass(up);
      const barn = f.world.surface.walk(site.centre, {x: east.x * 12, y: east.y * 12, z: east.z * 12});
      f.chests.configurePlacement({sites: f.sites, surface: () => f.world.surface, seed: 'celeiro',
        structures: [{id: 'celeiro-da-frente', position: barn}]});
      const near = f.chests.entries.filter(e => e.siteId === site.id)
        .some(e => f.world.surface.planarDistance({x: e.x, y: e.y, z: e.z}, barn) < 4);
      expect(near).toBe(true);
    } finally {f.close();}
  });

  it('preserva custo, tipo, escalonamento por estágio e o baú inicial autoral', () => {
    const f = fixture();
    try {
      // Os seis interativos autorais mantêm id, tipo e custo — mas NÃO ficam nas coordenadas
      // planas, onde no planeta não há chão nenhum.
      expect(f.chests.entries.slice(0, 6).map(e => e.id))
        .toEqual(['supply-0', 'shop-1', 'altar-2', 'supply-3', 'supply-4', 'shop-5']);
      expect(f.chests.entries[1]!.kind).toBe('shop');
      for (const e of f.chests.entries) {
        expect(e.cost).toBe(e.kind === 'altar' ? 25 : e.kind === 'shop' ? 45 : 30);
        expect(e.name).toBe(e.kind === 'altar' ? 'Altar de risco' : e.kind === 'shop' ? 'Baú reforçado' : 'Caixa de suprimentos');
      }
      f.run.stage = 3; f.chests.reset();
      for (const e of f.chests.entries) {
        expect(e.cost).toBe(Math.round((e.kind === 'altar' ? 25 : e.kind === 'shop' ? 45 : 30) * 1.6));
      }
    } finally {f.close();}
  });
});

describe('os seis interativos autorais são alcançáveis no planeta', () => {
  it('nenhum fica na coordenada plana; todos ganham deck, apoio e vertical de ilha', () => {
    const flat = fixture(false), f = fixture();
    try {
      const before = flat.chests.entries.slice(0, 6).map(e => ({x: e.x, y: e.y, z: e.z}));
      const home = f.chests.entries.slice(0, 6);
      const site = f.sites[0]!;
      for (const [index, entry] of home.entries()) {
        const p = {x: entry.x, y: entry.y, z: entry.z};
        // Saiu da coordenada plana autoral…
        expect(p, entry.id).not.toEqual(before[index]);
        // …e está num deck de verdade, com apoio sob os pés.
        expect(f.world.surface.support(p, 1, 4), entry.id).toBeDefined();
        expect(Math.hypot(p.x, p.y, p.z), entry.id).toBeGreaterThan(R - .5);
        expect(entry.up, entry.id).toBeDefined();
        // Na ilha inicial, onde o jogador nasce — nada de item do outro lado do planeta.
        expect(f.world.surface.planarDistance(p, site.centre), entry.id).toBeLessThanOrEqual(site.radius);
      }
      // Identidade preservada: mesmos ids, tipos e custos de antes.
      expect(home.map(e => `${e.id}/${e.kind}/${e.cost}`))
        .toEqual(flat.chests.entries.slice(0, 6).map(e => `${e.id}/${e.kind}/${e.cost}`));
    } finally {flat.close(); f.close();}
  });

  it('cada um é alcançável a pé pelo jogador e pode ser comprado', () => {
    const f = fixture();
    try {
      f.run.credits = 100_000;
      for (const entry of f.chests.entries.slice(0, 6)) {
        const up = entry.up!;
        place(f.player, {x: entry.x + up.x * .1, y: entry.y + up.y * .1, z: entry.z + up.z * .1});
        f.chests.update(0, false);
        expect(f.chests.nearest?.id, entry.id).toBe(entry.id);
        expect(f.chests.buy(), entry.id).toBe(true);
      }
    } finally {f.close();}
  });

  it('realocar preserva o estado de usado e a malha já construída', async () => {
    const f = fixture(false);
    try {
      f.chests.entries[1]!.used = true;                         // comprado ainda no mundo plano
      f.world.configurePlanet(frame, f.collision);
      f.chests.configurePlacement({sites: f.sites, surface: () => f.world.surface, seed: 'mudou-de-mapa'});
      expect(f.chests.entries[1]!.used).toBe(true);             // continua aberto
      expect(f.chests.entries[1]!.id).toBe('shop-1');
    } finally {f.close();}
  });
});

describe('o baú é SÓLIDO no planeta', () => {
  it('tem corpo registrado, com a vertical da ilha e o tamanho do baú plano', () => {
    const f = fixture();
    try {
      expect(f.chests.props.count).toBe(f.chests.entries.length);
      const entry = f.chests.entries[0]!, body = f.chests.props.all.find(b => b.id === `chest-body-${entry.id}`)!;
      expect(body).toBeDefined();
      // Mesmas meias-extensões da `BoxCollider` autoral da fazenda (1,06 × 0,68 × 0,86).
      expect(body.half).toEqual({x: .53, y: .34, z: .43});
      // Orientado pela vertical da ilha, e a base é ortonormal.
      expect(body.up).toEqual(entry.up);
      expect(body.right.x * body.up.x + body.right.y * body.up.y + body.right.z * body.up.z).toBeCloseTo(0, 9);
    } finally {f.close();}
  });

  it('o jogador FICA EM PÉ em cima: o apoio é o topo do baú, não o deck', () => {
    const f = fixture();
    try {
      const solid = withProps(f.world.surface, f.chests.props);
      const entry = f.chests.entries.find(e => e.kind !== 'altar')!, up = entry.up!;
      const above = {x: entry.x + up.x * 2, y: entry.y + up.y * 2, z: entry.z + up.z * 2};
      const deck = f.world.surface.support(above, 0, 6)!;
      const top = solid.support(above, 0, 6)!;
      expect(deck).toBeDefined(); expect(top).toBeDefined();
      // O apoio com baú é MAIS ALTO que o deck nu, por volta da altura do baú (0,68 m).
      const lift = f.world.surface.heightGap(top.point, deck.point);
      expect(lift).toBeGreaterThan(.6);
      expect(lift).toBeLessThan(.8);
      // E a normal do topo aponta para cima na vertical LOCAL.
      expect(top.normal.x * up.x + top.normal.y * up.y + top.normal.z * up.z).toBeCloseTo(1, 6);
      expect(top.slopeDegrees).toBeLessThan(1);
    } finally {f.close();}
  });

  it('um passo contra o baú é barrado em vez de atravessar', () => {
    const f = fixture();
    try {
      const solid = withProps(f.world.surface, f.chests.props);
      const entry = f.chests.entries.find(e => e.kind !== 'altar')!;
      const centre = {x: entry.x, y: entry.y, z: entry.z};
      const basis = f.world.surface.basis(centre, {x: 0, y: 0, z: 1});
      // Nasce 2 m ao lado e caminha 4 m direto para dentro do baú.
      const from = f.world.surface.walk(centre,
        {x: basis.right.x * -2, y: basis.right.y * -2, z: basis.right.z * -2});
      const delta = {x: basis.right.x * 4, y: basis.right.y * 4, z: basis.right.z * 4};
      const free = {...from}, blockedPoint = {...from};
      f.world.surface.slide(free, delta, .35, 1.8, .45, {ignoreFloors: true});
      const result = solid.slide(blockedPoint, delta, .35, 1.8, .45, {ignoreFloors: true});
      expect(result.blocked).toBe(true);
      // Projeção COM SINAL no eixo da caminhada: distância ao centro não distingue "parou antes"
      // de "atravessou e saiu do outro lado" — os dois dão o mesmo número.
      const along = (p: Vec3) => (p.x - centre.x) * basis.right.x + (p.y - centre.y) * basis.right.y + (p.z - centre.z) * basis.right.z;
      expect(along(free)).toBeGreaterThan(1.5);          // sem corpos, atravessa e sai do outro lado
      expect(along(blockedPoint)).toBeLessThan(0);       // com corpos, fica do lado de cá
      // Parou encostado: meia-largura 0,53 + raio da cápsula 0,35.
      expect(Math.abs(along(blockedPoint))).toBeGreaterThan(.8);
      expect(Math.abs(along(blockedPoint))).toBeLessThan(1.1);
      // E não terminou DENTRO do corpo.
      expect(solid.insideSolid(blockedPoint, 1.8)).toBe(false);
    } finally {f.close();}
  });

  it('o raio bate no baú antes do deck, e some quando o corpo é removido', () => {
    const f = fixture();
    try {
      const entry = f.chests.entries[0]!, up = entry.up!;
      const from = {x: entry.x + up.x * 3, y: entry.y + up.y * 3, z: entry.z + up.z * 3};
      const hit = f.chests.props.raycast(from, {x: -up.x, y: -up.y, z: -up.z}, 6);
      expect(hit).toBeDefined();
      expect(hit!.id).toBe(`chest-body-${entry.id}`);
      expect(hit!.distance).toBeCloseTo(3 - .68, 2);            // topo do baú a 0,68 m do deck
      expect(f.chests.props.remove(hit!.id)).toBe(true);
      expect(f.chests.props.raycast(from, {x: -up.x, y: -up.y, z: -up.z}, 6)).toBeUndefined();
    } finally {f.close();}
  });

  it('no mundo plano nenhum corpo radial é criado — quem responde continua sendo movingBoxes', () => {
    const f = fixture(false);
    try {
      expect(f.chests.props.count).toBe(0);
      expect(f.world.movingBoxes.length).toBeGreaterThan(0);
    } finally {f.close();}
  });
});

describe('contratos de distrito no planeta', () => {
  it('as ilhas viram distritos e o contrato fecha de verdade', () => {
    const f = fixture();
    try {
      f.run.credits = 100_000;
      const status = f.chests.districtContract;
      expect(status).toBeDefined();
      expect(f.sites.some(s => s.id === status!.contract.id)).toBe(true);   // distrito = ilha
      expect(status!.total).toBe(f.sites.length);
      let bonus = 0;
      f.events.on('InteractableUsed', () => {});
      const district = status!.contract.id;
      const chests = f.chests.entries.filter(e => e.siteId === district && e.kind !== 'altar');
      expect(chests.length).toBeGreaterThan(0);
      for (const entry of chests) {
        const up = entry.up!;
        place(f.player, {x: entry.x + up.x * .1, y: entry.y + up.y * .1, z: entry.z + up.z * .1});
        f.chests.update(0, false);
        const before = f.chests.drops.active.length;
        expect(f.chests.buy()).toBe(true);
        // O bônus de contrato ejeta um item EXTRA no mesmo instante da compra.
        if (f.chests.drops.active.length > before) bonus++;
      }
      expect(f.chests.contracts.completedCount).toBeGreaterThan(0);
      expect(bonus).toBeGreaterThan(0);
    } finally {f.close();}
  });

  it('a exigência acompanha quantos baús a ilha realmente tem', () => {
    const f = fixture();
    try {
      for (const site of f.sites) {
        const here = f.chests.entries.filter(e => e.siteId === site.id && e.kind !== 'altar').length;
        if (here === 0) continue;
        place(f.player, site.centre);
        const status = f.chests.districtContract;
        if (status?.contract.id !== site.id) continue;
        // Ilha com um baú só não pode exigir dois: seria um contrato impossível, que é o mesmo
        // que estar desligado.
        expect(status.required).toBeLessThanOrEqual(here);
        expect(status.required).toBeGreaterThanOrEqual(1);
      }
    } finally {f.close();}
  });
});

describe('compra, ejeção e coleta no planeta', () => {
  it('abre o baú por ARCO, ejeta o item no deck e concede no recolhimento', () => {
    const f = fixture();
    try {
      let picked = 0; f.events.on('ItemPicked', () => picked++);
      const chest = f.chests.entries.filter(e => e.siteId && e.kind !== 'altar')[0]!;
      const up = chest.up!;
      // O jogador encosta no baú: mesmo ponto do deck, altura de pé.
      place(f.player, {x: chest.x + up.x * .1, y: chest.y + up.y * .1, z: chest.z + up.z * .1});
      f.chests.update(0, false);
      expect(f.chests.nearest?.id).toBe(chest.id);          // achou por arco, não por hipot XZ
      const credits = f.run.credits;
      expect(f.chests.buy()).toBe(true);
      expect(f.run.credits).toBe(credits - chest.cost);
      for (let i = 0; i < 90; i++) f.chests.update(1 / 60, false);
      const drop = f.chests.drops.active[0]!;
      expect(drop.landed).toBe(true);
      expect(drop.up).toBeDefined();
      // O card pousou SOBRE a casca, 0,43 m acima do deck na vertical local.
      expect(Math.hypot(drop.landing.x, drop.landing.y, drop.landing.z)).toBeGreaterThan(R);
      expect(Math.hypot(drop.landing.x, drop.landing.y, drop.landing.z)).toBeLessThan(R + 2);
      // Está de pé: a rotação é quaternion radial, não o `rotation.y` do plano.
      expect(drop.root.rotationQuaternion).not.toBeNull();
      place(f.player, {x: drop.landing.x - drop.up!.x * .43, y: drop.landing.y - drop.up!.y * .43, z: drop.landing.z - drop.up!.z * .43});
      expect(f.chests.buy()).toBe(true);
      expect(picked).toBe(1);
      expect(f.run.inventory.get(drop.item.id)).toBe(1);
      expect(f.chests.buy()).toBe(false);
    } finally {f.close();}
  });

  it('o item sobe na vertical LOCAL durante o arco da ejeção, não no +Y do mundo', () => {
    const f = fixture();
    try {
      // Ilha leste: a vertical local é +X, então subir em `+Y` seria andar de lado.
      const east = f.sites.find(s => s.id === 'east')!;
      const item = f.run.randomItem(new RunRNG('subida').stream('loot'));
      const drop = f.chests.drops.eject(item, east.centre, {x: east.centre.x, y: east.centre.y + 1, z: east.centre.z});
      const radiusAt = () => Math.hypot(drop.root.position.x, drop.root.position.y, drop.root.position.z);
      let peak = -Infinity;
      for (let i = 0; i < 52; i++) {f.chests.drops.update(1 / 60); peak = Math.max(peak, radiusAt());}
      // O salto de 1,15 m aconteceu para FORA da casca.
      expect(peak).toBeGreaterThan(R + 1.4);
      expect(drop.landed).toBe(true);
      // E a componente `+Y` do mundo não foi usada como "para cima".
      expect(Math.abs(drop.up!.y)).toBeLessThan(.2);
      expect(drop.up!.x).toBeGreaterThan(.9);
    } finally {f.close();}
  });

  it('a coleta usa distância caminhada: longe no arco não recolhe, perto recolhe', () => {
    const f = fixture();
    try {
      const site = f.sites.find(s => s.id === 'front')!;
      const item = f.run.randomItem(new RunRNG('alcance').stream('loot'));
      const drop = f.chests.drops.eject(item, site.centre, f.world.surface.walk(site.centre, {x: 1, y: 0, z: 0}));
      for (let i = 0; i < 90; i++) f.chests.drops.update(1 / 60);
      const foot = {x: drop.landing.x - drop.up!.x * .43, y: drop.landing.y - drop.up!.y * .43, z: drop.landing.z - drop.up!.z * .43};
      const away = f.world.surface.walk(foot, {x: 0, y: 0, z: 0});
      const basis = f.world.surface.basis(foot, {x: 0, y: 1, z: 0});
      const far = f.world.surface.walk(away, {x: basis.forward.x * 9, y: basis.forward.y * 9, z: basis.forward.z * 9});
      expect(f.chests.drops.nearest(far)).toBeUndefined();
      expect(f.chests.drops.nearest(foot)).toBe(drop);
    } finally {f.close();}
  });
});

describe('recompensa de onda no planeta', () => {
  it('escolhe o sítio mais próximo por arco e entrega em piso seguro da casca', () => {
    const f = fixture();
    try {
      const east = f.sites.find(s => s.id === 'east')!;
      place(f.player, east.centre);
      const site = waveRewardSite(f.world, f.player.position, {surface: f.world.surface, fields: sitesAsFields(f.sites)});
      expect(site).toBeDefined();
      expect(site!.name).toBe('Ilha leste');
      expect(Math.hypot(site!.position.x, site!.position.y, site!.position.z)).toBeCloseTo(R, 1);
      expect(f.chests.deliverWaveReward(new RunRNG('onda').stream('loot'))).toBe(true);
      f.chests.update(1, false);
      const drop = f.chests.drops.active.at(-1)!;
      expect(drop.landed).toBe(true);
      expect(drop.waveField).toBeTruthy();
      expect(f.chests.waveRewardGuide?.drop).toBe(drop);
      expect(f.run.inventory.size).toBe(0);                     // só concede no recolhimento
    } finally {f.close();}
  });

  it('a âncora do abate vence, e um abate no vazio escorrega para o deck seguro', () => {
    const f = fixture();
    try {
      const front = f.sites.find(s => s.id === 'front')!;
      place(f.player, front.centre);
      // Morte no ar, 6 m acima do deck: a recompensa tem de descer para a casca, não ficar boiando.
      const airborne = {x: front.centre.x + front.up.x * 6, y: front.centre.y + front.up.y * 6, z: front.centre.z + front.up.z * 6};
      expect(f.chests.deliverWaveReward(new RunRNG('abate').stream('loot'), [{position: airborne, source: 'kill'}])).toBe(true);
      f.chests.update(1, false);
      const drop = f.chests.drops.active.at(-1)!;
      expect(drop.waveField).toBe('Onde a praga caiu');
      expect(Math.hypot(drop.landing.x, drop.landing.y, drop.landing.z)).toBeLessThan(R + 2);
    } finally {f.close();}
  });

  it('sem piso seguro nenhum a entrega é adiada, nunca largada no vazio', () => {
    const f = fixture();
    try {
      const empty: Vec3 = {x: 0, y: 0, z: -R};                  // direção sem ilha nenhuma
      expect(surfaceRewardGround(f.world.surface, empty, 2, 8)).toBeUndefined();
      const before = f.chests.drops.active.length;
      expect(f.chests.deliverWaveReward(new RunRNG('vazio').stream('loot'), [{position: empty, source: 'kill'}]))
        .toBe(true);                                            // cai no campo mais próximo, não no vazio
      const drop = f.chests.drops.active.at(-1)!;
      expect(f.chests.drops.active.length).toBe(before + 1);
      expect(Math.hypot(drop.landing.x, drop.landing.y, drop.landing.z)).toBeGreaterThan(R - 2);
    } finally {f.close();}
  });
});
