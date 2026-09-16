/**
 * Numeric audit of the six baked combo clips, read back out of the shipped player GLB.
 *
 * The point is to *measure* instead of claiming the poses look right: joint angles, ground contact,
 * foot skating, torso twist and the neutral at both ends. Anything a render could hide — a knee bent
 * backwards, a support foot drifting a centimetre a frame, a fist further from the shoulder than the
 * arm is long — shows up here as a number.
 *
 * Run: node scripts/audit-combo-clips.mjs
 * Writes: docs/combo-animation-audit.json
 */
import {readFileSync, writeFileSync} from 'node:fs';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine.js';
import {Scene} from '@babylonjs/core/scene.js';
import {ImportMeshAsync} from '@babylonjs/core/Loading/sceneLoader.js';
import '@babylonjs/loaders/glTF/index.js';
import {Vector3} from '@babylonjs/core/Maths/math.vector.js';

const manifest = JSON.parse(readFileSync('docs/combo-clip-manifest.json', 'utf8'));
const engine = new NullEngine(), scene = new Scene(engine);
const model = await ImportMeshAsync(new Uint8Array(readFileSync('public/models/gunslinger.glb')), scene,
  {pluginExtension: '.glb', pluginOptions: {gltf: {skipMaterials: true}}});
const nodes = new Map(model.transformNodes.map(node => [node.name, node]));
const clips = new Map(model.animationGroups.map(group => {group.stop(); return [group.name, group];}));
const root = model.transformNodes.find(node => !node.parent) ?? model.meshes.find(mesh => !mesh.parent);

// Writing straight into `rotationQuaternion` does not mark a node dirty, so world matrices have to
// be rebuilt parents first — otherwise a child is solved against its parent's previous frame and the
// measurements silently lag by one frame.
const ordered = [...model.transformNodes].sort((a, b) => depth(a) - depth(b));
function depth(node) {let count = 0; for (let n = node.parent; n; n = n.parent) count++; return count;}
function refresh() {for (const node of ordered) node.computeWorldMatrix(true);}
refresh();
const at = name => nodes.get(name).getAbsolutePosition().clone();
const REST = {
  arm: {Right: at('RightArm').subtract(at('RightForeArm')).length() + at('RightForeArm').subtract(at('RightHand')).length(),
        Left: at('LeftArm').subtract(at('LeftForeArm')).length() + at('LeftForeArm').subtract(at('LeftHand')).length()},
  leg: {Right: at('RightUpLeg').subtract(at('RightLeg')).length() + at('RightLeg').subtract(at('RightFoot')).length(),
        Left: at('LeftUpLeg').subtract(at('LeftLeg')).length() + at('LeftLeg').subtract(at('LeftFoot')).length()},
  toeY: {Right: at('RightToeBase').y, Left: at('LeftToeBase').y},
};
const GROUND = Math.min(REST.toeY.Right, REST.toeY.Left);

function sample(clip, frame) {
  for (const track of clip.targetedAnimations) {
    const value = track.animation.evaluate(frame), node = track.target;
    if (track.animation.targetProperty === 'rotationQuaternion') node.rotationQuaternion?.copyFrom(value);
    else if (track.animation.targetProperty === 'position') node.position.copyFrom(value);
    else if (track.animation.targetProperty === 'scaling') node.scaling.copyFrom(value);
  }
  refresh();
}

function jointAngle(a, b, c) {
  const first = at(a).subtract(at(b)), second = at(c).subtract(at(b));
  if (first.length() < 1e-6 || second.length() < 1e-6) return 180;
  return Math.acos(Math.max(-1, Math.min(1, Vector3.Dot(first.normalize(), second.normalize())))) * 180 / Math.PI;
}

/**
 * Yaw of a body segment, taken from a pair of joints that are genuinely wide apart in the
 * horizontal plane. Measuring the pelvis from `Hips`→`Spine02` does not work: that vector is almost
 * vertical, so its horizontal heading is pure noise and every clip reads as a 180 degree corkscrew.
 */
function yawOf(left, right) {
  const delta = at(right).subtract(at(left));
  return Math.atan2(delta.x, delta.z) * 180 / Math.PI;
}
const wrap = degrees => ((degrees + 180) % 360 + 360) % 360 - 180;
const pelvisYaw = () => yawOf('LeftUpLeg', 'RightUpLeg');
const chestYaw = () => yawOf('LeftArm', 'RightArm');
function headYaw() {
  // `headfront` points out of the face, so it is turned a quarter turn from the shoulder line;
  // only differences against the same reference are used, so the constant offset cancels.
  const delta = at('headfront').subtract(at('Head'));
  return Math.atan2(delta.x, delta.z) * 180 / Math.PI;
}

// Captured with every clip stopped: the yaw pairs are only meaningful as a difference from rest.
const REST_TWIST = {torso: wrap(chestYaw() - pelvisYaw()), neck: wrap(headYaw() - chestYaw())};

const report = [], problems = [];
for (const spec of manifest.clips) {
  const clip = clips.get(spec.clip);
  if (!clip) {problems.push(`${spec.clip}: missing from the GLB`); continue;}
  const frames = [];
  for (let i = 0; i < spec.frames; i++) {
    const frame = clip.from + (clip.to - clip.from) * (spec.frames > 1 ? i / (spec.frames - 1) : 0);
    sample(clip, frame);
    const row = {
      index: i + 1,
      elbow: {Right: jointAngle('RightArm', 'RightForeArm', 'RightHand'), Left: jointAngle('LeftArm', 'LeftForeArm', 'LeftHand')},
      knee: {Right: jointAngle('RightUpLeg', 'RightLeg', 'RightFoot'), Left: jointAngle('LeftUpLeg', 'LeftLeg', 'LeftFoot')},
      fist: {Right: at('RightArm').subtract(at('RightHand')).length(), Left: at('LeftArm').subtract(at('LeftHand')).length()},
      ankleSpan: {Right: at('RightUpLeg').subtract(at('RightFoot')).length(), Left: at('LeftUpLeg').subtract(at('LeftFoot')).length()},
      toe: {Right: at('RightToeBase').clone(), Left: at('LeftToeBase').clone()},
      hips: at('Hips').clone(),
      // Shoulders against pelvis is the real corkscrew measure; head against shoulders is the neck.
      torsoTwist: wrap(chestYaw() - pelvisYaw() - REST_TWIST.torso),
      neckTwist: wrap(headYaw() - chestYaw() - REST_TWIST.neck),
      shoulderSpan: at('LeftArm').subtract(at('RightArm')).length(),
      effector: null,
    };
    const striking = spec.id.startsWith('right') || spec.id === 'uppercut' || spec.id === 'spin-kick' ? 'Right' : 'Left';
    row.effector = at(striking + (spec.id.includes('kick') ? 'ToeBase' : 'Hand'));
    frames.push(row);
  }

  /** Extreme of a per-frame measure, with the frame it happens on — so a failure is findable. */
  const extreme = (pick, comparator) => frames.reduce((best, row) => {
    const value = pick(row);
    return best === null || comparator(value, best.value) ? {value, frame: row.index} : best;
  }, null);
  const highest = pick => extreme(pick, (a, b) => a > b);
  const lowest = pick => extreme(pick, (a, b) => a < b);

  const worst = {
    elbowStraightest: highest(f => Math.max(f.elbow.Right, f.elbow.Left)),
    elbowTightest: lowest(f => Math.min(f.elbow.Right, f.elbow.Left)),
    kneeStraightest: highest(f => Math.max(f.knee.Right, f.knee.Left)),
    kneeTightest: lowest(f => Math.min(f.knee.Right, f.knee.Left)),
    fistOverReach: highest(f => Math.max(f.fist.Right / REST.arm.Right, f.fist.Left / REST.arm.Left)),
    ankleOverReach: highest(f => Math.max(f.ankleSpan.Right / REST.leg.Right, f.ankleSpan.Left / REST.leg.Left)),
    torsoTwist: highest(f => Math.abs(f.torsoTwist)),
    neckTwist: highest(f => Math.abs(f.neckTwist)),
    shoulderSpanDrift: highest(f => Math.abs(f.shoulderSpan - frames[0].shoulderSpan)),
    lowestToe: lowest(f => Math.min(f.toe.Right.y, f.toe.Left.y)),
    pelvisShift: highest(f => f.hips.subtract(frames[0].hips).length()),
  };

  // Ground contact and skating. A toe counts as planted when it sits inside a 2 cm band of the
  // floor; while planted it must not slide, which is the numeric version of "no feet skating".
  const band = GROUND + .02;
  let airborneFrames = 0, worstSkate = 0, skateAt = 0;
  for (let i = 0; i < frames.length; i++) {
    const planted = ['Right', 'Left'].filter(side => frames[i].toe[side].y <= band);
    if (!planted.length) airborneFrames++;
    if (i === 0) continue;
    for (const side of planted) {
      if (frames[i - 1].toe[side].y > band) continue;   // it only just landed
      const slide = Math.hypot(frames[i].toe[side].x - frames[i - 1].toe[side].x,
                               frames[i].toe[side].z - frames[i - 1].toe[side].z);
      if (slide > worstSkate) {worstSkate = slide; skateAt = i + 1;}
    }
  }

  // Neutral at both ends: the last frame has to land back on the first, or repeating the combo
  // would ratchet the body a little further every cycle.
  sample(clip, clip.from);
  const first = model.transformNodes.map(node => node.rotationQuaternion?.clone());
  const firstHips = at('Hips').clone();
  sample(clip, clip.to);
  let loopError = 0, loopJoint = '';
  model.transformNodes.forEach((node, index) => {
    const a = first[index], b = node.rotationQuaternion;
    if (!a || !b) return;
    const error = 2 * Math.acos(Math.min(1, Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w))) * 180 / Math.PI;
    if (error > loopError) {loopError = error; loopJoint = node.name;}
  });
  const loopHips = at('Hips').subtract(firstHips).length();

  // Does the strike actually peak inside the damage window? The strike axis is taken from the clip
  // itself — hips to the striking limb at the declared contact frame — and every frame is projected
  // onto it. A hook that peaks on the follow-through is correct; one that peaks during the windup is
  // not, and neither is a clip whose declared contact lands nowhere near the reach.
  const contact = frames[spec.contactFrame - 1];
  const axis = contact.effector.subtract(contact.hips);
  // Forward strikes are measured toward their target on the horizontal plane. A high guard
  // is not an early hit merely because its hand is further above the pelvis. Uppercuts retain
  // the vertical component because their upward reach is the actual strike direction.
  if(spec.id !== 'uppercut')axis.y=0;
  const along = axis.length() > 1e-6 ? axis.normalize() : new Vector3(0, 0, 1);
  const projection = frames.map(f => Vector3.Dot(f.effector.subtract(f.hips), along));
  const peak = projection.indexOf(Math.max(...projection)) + 1;
  const activeFrames = Math.round(spec.active * manifest.fps);
  const windowStart = spec.contactFrame - 2, windowEnd = spec.contactFrame + activeFrames + 2;
  const windupPeak = Math.max(...projection.slice(0, Math.max(1, spec.contactFrame - 3)));

  const entry = {
    id: spec.id, clip: spec.clip, frames: spec.frames, contactFrame: spec.contactFrame,
    activeFrames, strikePeakFrame: peak, strikeWindow: [windowStart, windowEnd],
    strikeReachAtContact: Number(projection[spec.contactFrame - 1].toFixed(4)),
    strikeReachInWindup: Number(windupPeak.toFixed(4)),
    ...Object.fromEntries(Object.entries(worst).map(([k, v]) => [k, {value: Number(v.value.toFixed(4)), frame: v.frame}])),
    airborneFrames, skateMetresPerFrame: Number(worstSkate.toFixed(5)), skateAtFrame: skateAt,
    loopErrorDegrees: Number(loopError.toFixed(3)), loopErrorJoint: loopJoint, loopHipsMetres: Number(loopHips.toFixed(5)),
  };
  report.push(entry);

  const fail = (condition, message) => {if (condition) problems.push(`${spec.id}: ${message}`);};
  const where = measure => `${measure.value.toFixed(1)} at frame ${measure.frame}`;
  fail(worst.elbowStraightest.value > 176, `elbow hyperextends — ${where(worst.elbowStraightest)} deg`);
  fail(worst.kneeStraightest.value > 176, `knee hyperextends — ${where(worst.kneeStraightest)} deg`);
  fail(worst.kneeTightest.value < 20, `knee folds past the joint — ${where(worst.kneeTightest)} deg`);
  fail(worst.elbowTightest.value < 25, `elbow folds past the joint — ${where(worst.elbowTightest)} deg`);
  fail(worst.fistOverReach.value > 1.001, `fist reaches ${(worst.fistOverReach.value * 100).toFixed(1)}% of the arm at ${worst.fistOverReach.frame}`);
  fail(worst.ankleOverReach.value > 1.001, `ankle reaches ${(worst.ankleOverReach.value * 100).toFixed(1)}% of the leg at ${worst.ankleOverReach.frame}`);
  fail(worst.torsoTwist.value > 55, `shoulders corkscrew off the pelvis — ${where(worst.torsoTwist)} deg`);
  fail(worst.neckTwist.value > 65, `neck twists off the shoulders — ${where(worst.neckTwist)} deg`);
  fail(worst.shoulderSpanDrift.value > .01, `shoulders collapse by ${(worst.shoulderSpanDrift.value * 100).toFixed(2)} cm at ${worst.shoulderSpanDrift.frame}`);
  fail(worst.lowestToe.value < GROUND - .012, `a toe sinks ${((GROUND - worst.lowestToe.value) * 100).toFixed(1)} cm into the floor at ${worst.lowestToe.frame}`);
  fail(airborneFrames > 0, `${airborneFrames} frames with neither foot on the ground`);
  fail(worstSkate > .012, `planted foot slides ${(worstSkate * 100).toFixed(2)} cm in one frame at ${skateAt}`);
  fail(loopError > 1.5, `clip does not return to its first frame (${loopError.toFixed(2)} deg at ${loopJoint})`);
  fail(loopHips > .005, `hips end ${(loopHips * 100).toFixed(2)} cm away from where they started`);
  fail(peak < windowStart || peak > windowEnd, `strike peaks at frame ${peak}, outside the damage window ${windowStart}..${windowEnd}`);
  fail(windupPeak >= projection[spec.contactFrame - 1], `the windup already reaches further than the contact frame`);
  fail(worst.pelvisShift.value < .03, `pelvis barely moves (${(worst.pelvisShift.value * 100).toFixed(1)} cm) — no weight shift`);
}

const output = {
  ground: GROUND, restArm: REST.arm, restLeg: REST.leg, restTwistReference: REST_TWIST,
  limits: {elbow: '25..176 deg', knee: '20..176 deg', reach: '<=100% of the measured limb',
           torsoTwist: '<=55 deg off the pelvis', neckTwist: '<=65 deg off the shoulders',
           groundContact: 'at least one toe down every frame, never more than 1.2 cm under',
           skate: '<=1.2 cm per frame while planted', loop: '<=1.5 deg and <=0.5 cm back to frame 1'},
  clips: report, problems,
};
writeFileSync('docs/combo-animation-audit.json', JSON.stringify(output, null, 1));
for (const row of report) console.log(
  row.id.padEnd(12),
  'elbow', String(row.elbowTightest.value.toFixed(0)).padStart(3) + '..' + row.elbowStraightest.value.toFixed(0),
  'knee', String(row.kneeTightest.value.toFixed(0)).padStart(3) + '..' + row.kneeStraightest.value.toFixed(0),
  'reach', (row.fistOverReach.value * 100).toFixed(0) + '%/' + (row.ankleOverReach.value * 100).toFixed(0) + '%',
  'twist', row.torsoTwist.value.toFixed(0) + '/' + row.neckTwist.value.toFixed(0),
  'air', row.airborneFrames,
  'skate', (row.skateMetresPerFrame * 1000).toFixed(1) + 'mm@' + row.skateAtFrame,
  'loop', row.loopErrorDegrees.toFixed(2) + 'deg',
  'peak', row.strikePeakFrame + ' in ' + row.strikeWindow.join('..'),
  'toe', (row.lowestToe.value * 100).toFixed(1) + 'cm',
  'pelvis', (row.pelvisShift.value * 100).toFixed(1) + 'cm');
console.log(problems.length ? 'PROBLEMS:\n - ' + problems.join('\n - ') : 'AUDIT CLEAN');
scene.dispose(); engine.dispose();
void root;
process.exit(problems.length ? 1 : 0);
