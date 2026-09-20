import {describe, expect, it} from 'vitest';
import {readFileSync} from 'node:fs';
import HavokPhysics from '@babylonjs/havok';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {Scene} from '@babylonjs/core/scene';
import {LoadAssetContainerAsync} from '@babylonjs/core/Loading/sceneLoader';
import '@babylonjs/loaders/glTF';
import {HavokPlugin} from '@babylonjs/core/Physics/v2/Plugins/havokPlugin';
import {PhysicsAggregate} from '@babylonjs/core/Physics/v2/physicsAggregate';
import {PhysicsShapeType} from '@babylonjs/core/Physics/v2/IPhysicsEnginePlugin';
import {Vector3, Quaternion} from '@babylonjs/core/Maths/math.vector';
import {Mesh} from '@babylonjs/core/Meshes/mesh';
import {VertexData} from '@babylonjs/core/Meshes/mesh.vertexData';
import {TransformNode} from '@babylonjs/core/Meshes/transformNode';
import type {AssetContainer} from '@babylonjs/core/assetContainer';
import type {Skeleton} from '@babylonjs/core/Bones/skeleton';
import {PlayerRagdoll} from '../src/player/PlayerRagdoll';
import {bodyFrame, openLimb, readBonePoses} from '../src/player/CorpsePose';

/**
 * O cadáver NÃO se enrola numa bola — a queda começa com os braços abertos e as juntas têm limite.
 *
 * Duas causas foram MEDIDAS no `.temp/claude-ragdoll-open-report.md` e cada uma tem teste aqui:
 *
 * 1. O `Ragdoll` do Babylon cria a restrição `BALL_AND_SOCKET` travando só os três eixos LINEARES
 *    (`havokPlugin.js`, `initConstraint`); os `min`/`max` da configuração são guardados e **nunca
 *    usados** (`ragdoll.js`, `_initJoints`). Sem limite angular, e com a colisão entre pai e filho
 *    desligada pela própria restrição, cada junta dobra 180° e a corrente inteira desaba sobre si
 *    mesma. Medido ANTES da correção, a partir da pose de bind: quadril→pé caiu de 0,64 m para
 *    0,29 m; quadril→cabeça de 0,49 m para 0,30 m; a caixa da malha skinada foi de 1,27 × 1,70 ×
 *    0,54 m para 0,97 × 0,51 × 1,00 m — uma bola de um metro no lugar de um corpo de 1,70 m.
 * 2. A pose copiada é a de segurar o rifle com as duas mãos: as mãos nascem a 13 cm uma da outra e
 *    nada as abre.
 */

const GLB = 'public/models/gunslinger.glb';
const DT = 1 / 60;

async function havok() {
  return HavokPhysics({wasmBinary: new Uint8Array(readFileSync('node_modules/@babylonjs/havok/lib/esm/HavokPhysics.wasm')).buffer});
}

function floor(scene: Scene, y = 0, size = 60): void {
  const mesh = new Mesh('test-floor', scene);
  const data = new VertexData();
  data.positions = [-size, y, -size, size, y, -size, size, y, size, -size, y, size];
  data.indices = [0, 1, 2, 0, 2, 3];
  data.applyToMesh(mesh);
  mesh.isVisible = false;
  new PhysicsAggregate(mesh, PhysicsShapeType.MESH, {mass: 0, friction: .8, restitution: .05}, scene);
}

interface Live {skeleton: Skeleton; root: Mesh; frame: TransformNode}
function liveRig(container: AssetContainer, scene: Scene, at: Vector3): Live {
  const instance = container.instantiateModelsToScene(name => 'live-' + name, false, {doNotInstantiate: true});
  const frame = new TransformNode('live-frame', scene);
  for (const node of instance.rootNodes) node.parent = frame;
  frame.position.copyFrom(at);
  frame.computeWorldMatrix(true);
  const root = instance.rootNodes[0]!.getChildMeshes().find(m => m.getTotalVertices() > 0) as Mesh;
  root.computeWorldMatrix(true);
  const skeleton = instance.skeletons[0]!;
  skeleton.computeAbsoluteMatrices(true);
  return {skeleton, root, frame};
}

function boneAt(live: Live, name: string): Vector3 {
  live.root.computeWorldMatrix(true);
  live.skeleton.computeAbsoluteMatrices(true);
  return live.skeleton.bones.find(b => b.name === name)!.getAbsolutePosition(live.root).clone();
}

/**
 * Dobra os dois braços na pose COMPACTA de rifle — a que o jogo copia ao morrer.
 *
 * A rotação não é chutada: para cada osso, procura entre eixos e ângulos a que mais aproxima a mão
 * do esterno. É a pose de duas mãos na arma reproduzida por medida, no rig de verdade.
 */
function tuckArms(live: Live): void {
  for (const side of ['Left', 'Right'] as const) {
    for (const name of [side + 'Arm', side + 'ForeArm']) {
      const node = live.skeleton.bones.find(b => b.name === name)!.getTransformNode()!;
      const base = (node.rotationQuaternion ?? Quaternion.Identity()).clone();
      let best = base.clone(), bestScore = Infinity;
      for (const axis of [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)]) {
        for (const angle of [-2, -1.6, -1.2, -.8, .8, 1.2, 1.6, 2]) {
          node.rotationQuaternion = Quaternion.RotationAxis(axis, angle).multiply(base).normalize();
          live.skeleton.prepare(true);
          const score = Vector3.Distance(boneAt(live, side + 'Hand'), boneAt(live, 'Spine'));
          if (score < bestScore) {bestScore = score; best = node.rotationQuaternion.clone();}
        }
      }
      node.rotationQuaternion = best;
      live.skeleton.prepare(true);
    }
  }
  live.skeleton.computeAbsoluteMatrices(true);
}

function frameStep(scene: Scene, ragdoll: PlayerRagdoll, dt = DT): void {
  ragdoll.update(dt);
  scene.getPhysicsEngine()!._step(dt);
  scene.onBeforeRenderObservable.notifyObservers(scene);
  scene.onAfterRenderObservable.notifyObservers(scene);
}

function bodyNodes(ragdoll: PlayerRagdoll): TransformNode[] {
  const rig = (ragdoll as unknown as {rig: {getAggregate(i: number): {transformNode: TransformNode}}}).rig;
  const out: TransformNode[] = [];
  for (let i = 0; i < ragdoll.bodies; i++) out.push(rig.getAggregate(i).transformNode);
  return out;
}

/** Comprimentos que a física NÃO pode encurtar de verdade — só dobrando a corrente sobre si mesma. */
function chain(ragdoll: PlayerRagdoll): {spine: number; leg: number; arm: number; hands: number} {
  const n = bodyNodes(ragdoll);
  return {
    spine: Vector3.Distance(n[0]!.position, n[3]!.position),
    leg: Vector3.Distance(n[4]!.position, n[12]!.position),
    arm: Vector3.Distance(n[8]!.position, n[14]!.position),
    hands: Vector3.Distance(n[14]!.position, n[15]!.position),
  };
}

/** Caixa envolvente da malha SKINADA do cadáver: é o que o jogador enxerga. */
function meshBox(ragdoll: PlayerRagdoll): {long: number; short: number} {
  const root = ragdoll.corpseRoot!;
  let long = 0, short = 0;
  for (const mesh of root.getChildMeshes()) {
    if (!mesh.getTotalVertices()) continue;
    mesh.computeWorldMatrix(true);
    mesh.refreshBoundingInfo({applySkeleton: true});
    const box = mesh.getBoundingInfo().boundingBox;
    const sizes = [box.maximumWorld.x - box.minimumWorld.x, box.maximumWorld.y - box.minimumWorld.y, box.maximumWorld.z - box.minimumWorld.z].sort((a, b) => b - a);
    long = Math.max(long, sizes[0]!);
    short = Math.max(short, sizes[2]!);
  }
  return {long, short};
}

describe('CorpsePose — abertura de membro medida no rig', () => {
  it('bodyFrame mede os eixos do corpo no rig autoral, e openLimb gira a FRAÇÃO pedida', async () => {
    const engine = new NullEngine(), scene = new Scene(engine);
    try {
      const container = await LoadAssetContainerAsync(new Uint8Array(readFileSync(GLB)), scene, {pluginExtension: '.glb', pluginOptions: {gltf: {skipMaterials: true}}});
      const live = liveRig(container, scene, new Vector3(0, 0, 0));
      const frame = bodyFrame(live.skeleton, live.root)!;
      expect(frame).toBeTruthy();
      // Eixos ortonormais e coerentes com um personagem em pé.
      expect(frame.up.length()).toBeCloseTo(1, 5);
      expect(frame.side.length()).toBeCloseTo(1, 5);
      expect(Math.abs(Vector3.Dot(frame.up, frame.side))).toBeLessThan(1e-5);
      expect(frame.up.y).toBeGreaterThan(.9);
      // O eixo lateral aponta para o ombro ESQUERDO: é o que dá o sinal do empurrão assimétrico.
      const lateral = boneAt(live, 'LeftArm').subtract(boneAt(live, 'RightArm')).normalize();
      expect(Vector3.Dot(frame.side, lateral)).toBeGreaterThan(.9);

      tuckArms(live);
      const tucked = boneAt(live, 'LeftForeArm').subtract(boneAt(live, 'LeftArm')).normalize();
      const target = frame.side.scale(.8).add(frame.up.scale(-.6));
      const full = Math.acos(Math.max(-1, Math.min(1, Vector3.Dot(tucked, target.clone().normalize()))));
      const shoulder = boneAt(live, 'LeftArm');
      const applied = openLimb(live.skeleton, live.root, {bone: 'LeftArm', tip: 'LeftForeArm', towards: target, blend: .5, maxDegrees: 180});
      // Metade do caminho, não a pose inteira: o cadáver relaxa, não assume um T.
      expect(applied).toBeCloseTo(full * .5, 3);
      const after = boneAt(live, 'LeftForeArm').subtract(boneAt(live, 'LeftArm')).normalize();
      const rest = Math.acos(Math.max(-1, Math.min(1, Vector3.Dot(after, target.clone().normalize()))));
      expect(rest).toBeCloseTo(full * .5, 3);
      // O osso girou NO LUGAR: a articulação do ombro não se mudou de posição.
      expect(Vector3.Distance(boneAt(live, 'LeftArm'), shoulder)).toBeLessThan(1e-4);
      // Osso inexistente não quebra o quadro da morte.
      expect(openLimb(live.skeleton, live.root, {bone: 'Nope', tip: 'LeftHand', towards: target, blend: 1, maxDegrees: 60})).toBe(0);
      // `blend` fora da faixa é saturado, e `maxDegrees` é um teto de verdade.
      const capped = openLimb(live.skeleton, live.root, {bone: 'RightArm', tip: 'RightForeArm', towards: frame.side.scale(-1), blend: 5, maxDegrees: 10});
      expect(capped).toBeLessThanOrEqual(10 * Math.PI / 180 + 1e-6);
      expect(capped).toBeGreaterThan(0);
    } finally {scene.dispose(); engine.dispose();}
  }, 120000);
});

describe('PlayerRagdoll — cai aberto, sem se enrolar', () => {
  it('as juntas ganham limite angular de verdade (o Babylon deixa os três eixos livres)', async () => {
    const engine = new NullEngine(), scene = new Scene(engine);
    const ragdoll = new PlayerRagdoll({scene, corpse: async () => container});
    let container!: AssetContainer;
    try {
      scene.enablePhysics(new Vector3(0, -18, 0), new HavokPlugin(true, await havok()));
      floor(scene);
      container = await LoadAssetContainerAsync(new Uint8Array(readFileSync(GLB)), scene, {pluginExtension: '.glb', pluginOptions: {gltf: {skipMaterials: true}}});
      await ragdoll.prepare();
      const live = liveRig(container, scene, new Vector3(0, 2.4, 0));
      expect(ragdoll.start({pose: live})).toBe(true);
      // Uma junta por corpo, menos a raiz — e todas limitadas, não uma amostra.
      expect(ragdoll.limitedJoints).toBe(ragdoll.bodies - 1);
      expect(ragdoll.openedLimbs).toBeGreaterThanOrEqual(4);
      ragdoll.reset();
      expect(ragdoll.limitedJoints).toBe(0);
      expect(ragdoll.openedLimbs).toBe(0);
    } finally {ragdoll.dispose(); scene.dispose(); engine.dispose();}
  }, 120000);

  it('da pose de rifle, o cadáver abre os braços e assenta com forma de gente, não de bola', async () => {
    const engine = new NullEngine(), scene = new Scene(engine);
    const ragdoll = new PlayerRagdoll({scene, corpse: async () => container});
    let container!: AssetContainer;
    try {
      scene.enablePhysics(new Vector3(0, -18, 0), new HavokPlugin(true, await havok()));
      floor(scene);
      container = await LoadAssetContainerAsync(new Uint8Array(readFileSync(GLB)), scene, {pluginExtension: '.glb', pluginOptions: {gltf: {skipMaterials: true}}});
      await ragdoll.prepare();
      const live = liveRig(container, scene, new Vector3(0, 2.6, 0));
      tuckArms(live);
      // A pose de entrada é a compacta: as mãos do rig VIVO estão quase encostadas.
      expect(Vector3.Distance(boneAt(live, 'LeftHand'), boneAt(live, 'RightHand'))).toBeLessThan(.4);
      expect(ragdoll.start({pose: live, velocity: {x: 0, y: -1, z: 0}})).toBe(true);

      const start = chain(ragdoll);
      // Os braços já NASCEM abertos: o cadáver não aparece agarrando um rifle que não existe mais.
      expect(start.hands, 'mãos separadas no quadro da morte').toBeGreaterThan(.45);
      for (let i = 0; i < 360; i++) frameStep(scene, ragdoll);
      const end = chain(ragdoll), box = meshBox(ragdoll);

      // A corrente não desabou: um corpo de 1,70 m continua com as proporções de um corpo.
      expect(end.leg, 'coxa→pé').toBeGreaterThan(start.leg * .72);
      expect(end.spine, 'quadril→cabeça').toBeGreaterThan(start.spine * .72);
      expect(end.arm, 'ombro→mão').toBeGreaterThan(start.arm * .72);
      // E os braços continuam abertos depois de assentar.
      expect(end.hands, 'mãos separadas no chão').toBeGreaterThan(.45);
      // O que o jogador VÊ: um corpo deitado, não uma bola de um metro.
      expect(box.long, 'maior lado da malha skinada').toBeGreaterThan(1.3);
      expect(box.short, 'menor lado: deitado, não em pé').toBeLessThan(.9);
      expect(ragdoll.settled).toBe(true);
    } finally {ragdoll.dispose(); scene.dispose(); engine.dispose();}
  }, 120000);

  it('mesmo da pose de bind, a coluna não dobra ao meio quando o corpo bate no chão', async () => {
    const engine = new NullEngine(), scene = new Scene(engine);
    const ragdoll = new PlayerRagdoll({scene, corpse: async () => container});
    let container!: AssetContainer;
    try {
      scene.enablePhysics(new Vector3(0, -18, 0), new HavokPlugin(true, await havok()));
      floor(scene);
      container = await LoadAssetContainerAsync(new Uint8Array(readFileSync(GLB)), scene, {pluginExtension: '.glb', pluginOptions: {gltf: {skipMaterials: true}}});
      await ragdoll.prepare();
      const live = liveRig(container, scene, new Vector3(0, 2.6, 0));
      expect(ragdoll.start({pose: live, velocity: {x: 0, y: -1, z: 0}})).toBe(true);
      const start = chain(ragdoll);
      for (let i = 0; i < 360; i++) frameStep(scene, ragdoll);
      const end = chain(ragdoll);
      // Foi esta a pose que pegou a coluna solta demais: quadril→cabeça caía para 0,11 m (o crânio
      // dentro da bacia) mesmo com limite por eixo, porque três limites de eixo compõem um desvio
      // bem maior que cada um. O teto da coluna sai desta medida.
      expect(end.spine, 'quadril→cabeça').toBeGreaterThan(start.spine * .72);
      expect(end.leg, 'coxa→pé').toBeGreaterThan(start.leg * .72);
      expect(meshBox(ragdoll).long, 'maior lado da malha skinada').toBeGreaterThan(1.3);
    } finally {ragdoll.dispose(); scene.dispose(); engine.dispose();}
  }, 120000);

  it('abrir os membros não escreve no rig VIVO nem força uma pose em T', async () => {
    const engine = new NullEngine(), scene = new Scene(engine);
    const ragdoll = new PlayerRagdoll({scene, corpse: async () => container});
    let container!: AssetContainer;
    try {
      scene.enablePhysics(new Vector3(0, -18, 0), new HavokPlugin(true, await havok()));
      floor(scene);
      container = await LoadAssetContainerAsync(new Uint8Array(readFileSync(GLB)), scene, {pluginExtension: '.glb', pluginOptions: {gltf: {skipMaterials: true}}});
      await ragdoll.prepare();
      const live = liveRig(container, scene, new Vector3(0, 2.4, 0));
      tuckArms(live);
      const before = readBonePoses(live.skeleton);
      expect(ragdoll.start({pose: live})).toBe(true);
      for (let i = 0; i < 30; i++) frameStep(scene, ragdoll);
      const after = readBonePoses(live.skeleton);
      let worst = 0;
      for (const [i, pose] of before.entries()) {
        worst = Math.max(worst, Vector3.Distance(pose.position, after[i]!.position),
          Math.abs(Quaternion.Dot(pose.rotation, after[i]!.rotation)) < .999999 ? 1 : 0);
      }
      expect(worst, 'o rig vivo continua intocado').toBeLessThan(1e-6);
      expect(live.skeleton.bones.every(b => b.getTransformNode() !== null)).toBe(true);

      // E o cadáver não virou um boneco em T: o cotovelo continua dobrado, como o da pose da morte.
      const corpse = (ragdoll as unknown as {corpseSkeleton: Skeleton}).corpseSkeleton;
      const mesh = (ragdoll as unknown as {corpseMesh: Mesh}).corpseMesh;
      corpse.computeAbsoluteMatrices(true);
      const at = (name: string): Vector3 => corpse.bones.find(b => b.name === name)!.getAbsolutePosition(mesh);
      const upper = at('LeftForeArm').subtract(at('LeftArm')).normalize();
      const lower = at('LeftHand').subtract(at('LeftForeArm')).normalize();
      const elbow = Math.acos(Math.max(-1, Math.min(1, Vector3.Dot(upper, lower))));
      expect(elbow, 'o cotovelo continua dobrado').toBeGreaterThan(10 * Math.PI / 180);
    } finally {ragdoll.dispose(); scene.dispose(); engine.dispose();}
  }, 120000);
});
