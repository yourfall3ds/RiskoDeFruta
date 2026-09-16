/**
 * Merge the six Blender-authored combo actions into `public/models/gunslinger.glb`.
 *
 * The player GLB carries the mesh, the material, the skin and 28 other animations, plus the two
 * `*WeaponGrip` nodes that are not skin joints. Re-exporting the whole character from Blender would
 * put all of that at risk, so nothing here is replaced: only new animation tracks are appended.
 *
 * Two guards run before anything is written:
 *   1. Round-trip parity. The sibling export also carries an untouched `Idle`. If Blender's bone
 *      convention had drifted, the re-exported `Idle` would no longer match the one already in the
 *      player GLB — so `Idle` is compared joint by joint and the merge aborts if it moved.
 *   2. Rest translation. Every joint except `Hips` must still sit on its rest translation, which
 *      proves no bone length changed on the way through Blender.
 *
 * Only `rotation` is merged for every joint, plus `translation` for `Hips` (the pelvis weight
 * shift). `scale` is deliberately dropped: a stray scale track on a bone is what made the ragdoll
 * explode before, and the combo has no business scaling anything.
 *
 * Run: node scripts/merge-combo-clips.mjs
 */
import {readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync} from 'node:fs';
import {readGlb, writeGlb, values, append} from './glb-tools.mjs';

const TARGET = 'public/models/gunslinger.glb';
const SOURCE = 'art/processed/gunslinger-combos.glb';
const BACKUP = 'art/processed/gunslinger-before-combos.glb';
const MANIFEST = 'docs/combo-clip-manifest.json';
// Joint translations inside the GLB are centimetres (the rig node carries the 0.01 scale), and bone
// lengths run from 10 to 40 of them. These limits are float noise; a real drift is orders bigger.
const PARITY_LIMIT = 2e-3;          // quaternion components / centimetres
const REST_LIMIT = 5e-3;            // centimetres — 50 microns on a 10 cm bone

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const wanted = new Set(manifest.clips.map(clip => clip.clip));

mkdirSync('art/processed', {recursive: true});
if (!existsSync(BACKUP)) copyFileSync(TARGET, BACKUP);
const target = readGlb(BACKUP), source = readGlb(SOURCE);

const targetIndex = new Map(target.json.nodes.map((node, index) => [node.name, index]));
const sourceName = source.json.nodes.map(node => node.name);
const joints = new Set(target.json.skins[0].joints.map(id => target.json.nodes[id].name));

/** Times and per-time values of one channel, as plain arrays. */
function track(glb, animation, nodeName, path, names) {
  const channel = animation.channels.find(c => names[c.target.node] === nodeName && c.target.path === path);
  if (!channel) return undefined;
  const sampler = animation.samplers[channel.sampler];
  return {
    times: values(glb, sampler.input).map(row => row[0]),
    rows: values(glb, sampler.output),
    interpolation: sampler.interpolation ?? 'LINEAR',
  };
}

function sampleAt(data, time) {
  const {times, rows} = data;
  if (time <= times[0]) return rows[0];
  if (time >= times.at(-1)) return rows.at(-1);
  let i = 1;
  while (i < times.length && times[i] < time) i++;
  const a = times[i - 1], b = times[i], s = b > a ? (time - a) / (b - a) : 0;
  return rows[i - 1].map((v, c) => v + (rows[i][c] - v) * s);
}

const targetNames = target.json.nodes.map(node => node.name);
const failures = [];

// ---- guard 1: the untouched Idle must survive the Blender round trip unchanged -----------------
const originalIdle = target.json.animations.find(a => a.name === 'Idle');
const rebuiltIdle = source.json.animations.find(a => a.name === 'Idle');
if (!originalIdle || !rebuiltIdle) throw new Error('missing Idle on one side; cannot prove parity');
let worstParity = 0, worstJoint = '';
for (const joint of joints) {
  for (const path of ['rotation', 'translation']) {
    const before = track(target, originalIdle, joint, path, targetNames);
    const after = track(source, rebuiltIdle, joint, path, sourceName);
    if (!before || !after) continue;
    const span = Math.min(before.times.at(-1), after.times.at(-1));
    for (let i = 0; i <= 24; i++) {
      const time = span * i / 24;
      const a = sampleAt(before, time), b = sampleAt(after, time);
      // Quaternions: q and -q are the same rotation, so compare the shorter of the two.
      const flip = path === 'rotation' && a.reduce((sum, v, c) => sum + v * b[c], 0) < 0 ? -1 : 1;
      const error = Math.max(...a.map((v, c) => Math.abs(v - b[c] * flip)));
      if (error > worstParity) {worstParity = error; worstJoint = `${joint}/${path}`;}
    }
  }
}
if (worstParity > PARITY_LIMIT) failures.push(`Idle round-trip drifted ${worstParity.toFixed(5)} at ${worstJoint}`);

// ---- guard 2: no bone moved off its rest translation --------------------------------------------
let worstRest = 0, worstRestJoint = '';
for (const clip of wanted) {
  const animation = source.json.animations.find(a => a.name === clip);
  if (!animation) {failures.push(`sibling export is missing ${clip}`); continue;}
  for (const joint of joints) {
    if (joint === 'Hips') continue;
    const data = track(source, animation, joint, 'translation', sourceName);
    if (!data) continue;
    const rest = target.json.nodes[targetIndex.get(joint)].translation ?? [0, 0, 0];
    for (const row of data.rows) {
      const error = Math.max(...row.map((v, c) => Math.abs(v - rest[c])));
      if (error > worstRest) {worstRest = error; worstRestJoint = `${clip}/${joint}`;}
    }
  }
}
if (worstRest > REST_LIMIT) failures.push(`bone translation drifted ${worstRest.toFixed(6)} at ${worstRestJoint}`);

if (failures.length) {
  console.error('MERGE ABORTED — nothing was written:');
  for (const line of failures) console.error(' -', line);
  process.exit(1);
}

// ---- merge ---------------------------------------------------------------------------------------
const merged = [];
for (const clip of manifest.clips) {
  const animation = source.json.animations.find(a => a.name === clip.clip);
  const built = {name: clip.clip, channels: [], samplers: []};
  let duration = 0;
  for (const channel of animation.channels) {
    const name = sourceName[channel.target.node], path = channel.target.path;
    if (!joints.has(name) || !targetIndex.has(name)) continue;
    if (path === 'scale') continue;                       // never let a scale track reach a bone
    if (path === 'translation' && name !== 'Hips') continue;
    const sampler = animation.samplers[channel.sampler];
    const times = values(source, sampler.input);
    const rows = values(source, sampler.output);
    duration = Math.max(duration, times.at(-1)[0]);
    if (path === 'rotation') {
      // Keep every key on the same hemisphere as the one before it. `q` and `-q` are the same
      // rotation, so a sign flip costs nothing at a key and everything between two: the runtime
      // interpolates the short way through the *components*, and a flipped pair collapses toward
      // zero. That is what produced a one-frame elbow snap in the middle of the spin kick.
      for (let i = 1; i < rows.length; i++) {
        if (rows[i].reduce((sum, v, c) => sum + v * rows[i - 1][c], 0) < 0) {
          rows[i] = rows[i].map(v => -v);
          flips++;
        }
      }
    }
    built.channels.push({sampler: built.samplers.length, target: {node: targetIndex.get(name), path}});
    built.samplers.push({
      input: append(target, times, 'SCALAR'),
      output: append(target, rows, path === 'rotation' ? 'VEC4' : 'VEC3'),
      interpolation: sampler.interpolation ?? 'LINEAR',
    });
  }
  target.json.animations = target.json.animations.filter(a => a.name !== clip.clip);
  target.json.animations.push(built);
  merged.push({clip: clip.clip, channels: built.channels.length, seconds: Number(duration.toFixed(4)),
               expected: Number(((clip.frames - 1) / manifest.fps).toFixed(4))});
}

const kept = target.json.animations.map(a => a.name);
for (const name of manifest.preservedActions) {
  if (name !== 'Jump' && !kept.includes(name) && target.json.animations.every(a => a.name !== name))
    failures.push(`lost original animation ${name}`);
}
if (failures.length) {
  console.error('MERGE ABORTED — nothing was written:');
  for (const line of failures) console.error(' -', line);
  process.exit(1);
}

writeGlb(TARGET, target);
console.log(JSON.stringify({
  parity: {worst: Number(worstParity.toFixed(6)), at: worstJoint, limit: PARITY_LIMIT},
  restTranslation: {worst: Number(worstRest.toFixed(8)), at: worstRestJoint, limit: REST_LIMIT},
  merged,
  animations: target.json.animations.length,
  backup: BACKUP,
}, null, 1));
void writeFileSync;
