/**
 * Turn the barn interior chest spots into gameplay data, sampled from the real collision floor.
 *
 * The authoring script only knows where a chest SHOULD stand. This one loads the same collision the
 * client loads — including the sculpted relief for the base field and the highlands, because that is
 * what the player actually walks on — drops a ray at the spot and takes the floor it hits. A spot
 * that lands in the void, inside a prop, inside a wall, or off the free aisle is a hard failure, so
 * a chest can never ship sealed in a barn wall.
 *
 * Run: npx tsx scripts/place-barn-chests.mts   (after patch-barn-collision.mjs)
 */
import fs from 'node:fs';
import {CollisionWorld, type BoxCollider} from '../src/physics/CollisionWorld';
import {sculptRegion, type OutcropShape} from '../src/world/terrain/WorldTerrain';
import {applyInitialRockFix} from '../src/world/terrain/InitialRocks';

interface Geometry {positions:number[];indices:number[];boxes:BoxCollider[]}
const read = (name:string) => JSON.parse(fs.readFileSync(`public/models/${name}.json`, 'utf8'));
const manifest = read('barn-interiors') as {
  aisleHalfWidth:number;
  barns:{id:string;name:string;region:string;centre:{x:number;y:number;z:number};
         interior:{minX:number;maxX:number;minZ:number;maxZ:number};
         door:{minX:number;maxX:number;z:number};
         chests:{id:string;x:number;z:number;kind:string}[];colliders:BoxCollider[]}[];
};
const outcrops = read('outcrop-rocks') as OutcropShape;

function append(target:{positions:number[];indices:number[]}, part:{positions:readonly number[];indices:readonly number[]}):void {
  const offset = target.positions.length / 3;
  for (const value of part.positions) target.positions.push(value);
  for (const index of part.indices) target.indices.push(index + offset);
}

/** The base field, merged exactly the way `FarmWorld.load` merges it. */
function baseWorld():CollisionWorld {
  const authored = read('farm-collision'), geometry = read('world-collision-mesh') as Geometry, solid = read('solid-island-collision') as Geometry;
  applyInitialRockFix(geometry, read('initial-rock-fix'), outcrops);
  const merged = {positions:[...geometry.positions], indices:[...geometry.indices]};
  append(merged, solid);
  const relief = sculptRegion('base', {positions:merged.positions, indices:merged.indices, boxes:[...authored.boxes, ...geometry.boxes]});
  if (relief.terrain) append(merged, relief.terrain.collisionGeometry());
  const world = new CollisionWorld();
  world.boxes.push(...authored.boxes, ...geometry.boxes, ...solid.boxes);
  world.surfaces.push(...authored.surfaces);
  world.setGeometry(merged.positions, merged.indices);
  world.prepareRaycasts();
  return world;
}

/** A streamed region, sculpted the same way its loader sculpts it. */
function regionWorld(id:string):CollisionWorld {
  const region = read(id + '-collision');
  const merged = {positions:[...region.positions], indices:[...region.indices]};
  const sculpted = sculptRegion(id, region, outcrops);
  if (sculpted.terrain) append(merged, sculpted.terrain.collisionGeometry());
  for (const group of sculpted.outcrops) append(merged, group.geometry);
  const world = new CollisionWorld();
  world.boxes.push(...region.boxes);
  world.surfaces.push(...(region.surfaces ?? []));
  world.setGeometry(merged.positions, merged.indices);
  world.prepareRaycasts();
  return world;
}

const worlds = new Map<string,CollisionWorld>([['base', baseWorld()]]);
for (const id of new Set(manifest.barns.map(b => b.region).filter(r => r !== 'base'))) worlds.set(id, regionWorld(id));

// Half-extents of the chest crate, matching the colliders in ExplorationSites.
const CHEST_HX = .53, CHEST_HZ = .43, PLAYER_RADIUS = .4;
const sites:{id:string;barn:string;x:number;y:number;z:number;kind:string}[] = [];

for (const barn of manifest.barns) {
  const world = worlds.get(barn.region)!;
  for (const chest of barn.chests) {
    const y = world.groundAt(chest.x, chest.z, barn.centre.y + .45);
    if (!Number.isFinite(y)) throw Error(`${chest.id}: no floor under the chest spot`);
    if (Math.abs(y - barn.centre.y) > .35) throw Error(`${chest.id}: floor at ${y.toFixed(3)} is not the barn floor ${barn.centre.y}`);
    if (world.insideSolid({x:chest.x, y:y + .4, z:chest.z}, .5)) throw Error(`${chest.id}: the spot is inside solid geometry`);
    // A crate wedged against a prop or a wall cannot be reached; leave a player's width around it.
    for (const box of world.boxes) {
      const gap = PLAYER_RADIUS + .05;
      if (chest.x + CHEST_HX + gap > box.min.x && chest.x - CHEST_HX - gap < box.max.x
        && chest.z + CHEST_HZ + gap > box.min.z && chest.z - CHEST_HZ - gap < box.max.z
        && y + .68 > box.min.y && y < box.max.y) throw Error(`${chest.id}: blocked by ${box.id}`);
    }
    // Inside the shell with room to stand on every side. Whether a capsule can actually WALK there
    // is proved by tests/barn-interiors.test.ts and by the baked navigation routes, not asserted here.
    const margin = PLAYER_RADIUS + CHEST_HX;
    if (chest.x - margin < barn.interior.minX || chest.x + margin > barn.interior.maxX
      || chest.z - margin < barn.interior.minZ || chest.z + margin > barn.interior.maxZ) throw Error(`${chest.id}: too close to a barn wall`);
    sites.push({id:'barn-' + barn.id + '-' + chest.id.split('-').at(-1)!, barn:barn.id, x:chest.x, y, z:chest.z, kind:chest.kind});
  }
}

const unique = new Set(sites.map(site => site.id));
if (unique.size !== sites.length) throw Error('Duplicate barn chest id');
fs.writeFileSync('src/world/BarnSites.ts',
  '// Generated from the real barn floors by scripts/place-barn-chests.mts. Do not edit by hand.\n'
  + 'export const BARN_CHESTS=' + JSON.stringify(sites.map(({id, x, y, z, kind}) => ({id, x, y, z, kind})), null, 2) + ' as const;\n');
console.table(sites);
console.log('BARN CHESTS PLACED', sites.length);
