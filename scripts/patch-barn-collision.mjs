/**
 * Merge the barn interior colliders into the collision files the game already ships.
 *
 * The props live in their own GLB, but their COLLISION cannot: `farm-collision.json`,
 * `farm-city-collision.json` and `highland-farms-collision.json` are the single source every
 * consumer already reads — the client through `FarmWorld`, the authoritative server through
 * `mergeCollision`, and the navmesh through `bake-navigation.mjs`. Writing the boxes anywhere else
 * would mean a crate the player bumps into, the server walks through and the enemies path across.
 *
 * Idempotent: every box it owns is prefixed `barn-interior-`, and each run strips the previous set
 * before appending the current one, so re-running after an authoring change never accumulates.
 *
 * Run: node scripts/patch-barn-collision.mjs
 */
import fs from 'node:fs';

const OWNED = /^barn-interior-/;
const manifest = JSON.parse(fs.readFileSync('public/models/barn-interiors.json', 'utf8'));

const byFile = new Map();
for (const barn of manifest.barns) {
  if (!byFile.has(barn.collision)) byFile.set(barn.collision, []);
  byFile.get(barn.collision).push(...barn.colliders);
}

const seen = new Set();
for (const boxes of byFile.values()) for (const box of boxes) {
  if (seen.has(box.id)) throw Error('Duplicate barn interior collider id: ' + box.id);
  seen.add(box.id);
}

for (const [name, boxes] of byFile) {
  const path = `public/models/${name}.json`;
  const data = JSON.parse(fs.readFileSync(path, 'utf8'));
  const kept = data.boxes.filter(box => !OWNED.test(box.id));
  const removed = data.boxes.length - kept.length;
  data.boxes = [...kept, ...boxes];
  fs.writeFileSync(path, JSON.stringify(data));
  console.log(`${name}: ${kept.length} existing + ${boxes.length} barn interior boxes (replaced ${removed})`);
}
console.log('BARN COLLISION PATCHED', seen.size, 'boxes across', byFile.size, 'files');
