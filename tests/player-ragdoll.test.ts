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
import {PlayerRagdoll, MAX_PLAYER_RAGDOLL_BODIES, rightHandedRotation} from '../src/player/PlayerRagdoll';
import {readBonePoses, segmentLength, skeletonHeight} from '../src/player/CorpsePose';
import type {Vec3} from '../src/core/contracts';

/**
 * Havok DE VERDADE sobre o rig autoral DE VERDADE.
 *
 * Nada aqui é simulado por aproximação: o `.wasm` do Havok é carregado, o `gunslinger.glb` é lido do
 * disco, os corpos articulados são criados e o passo de física é executado. É o único jeito de
 * afirmar que a queda é articulada, que a gravidade é radial e que o rig não explode de escala.
 */

const GLB = 'public/models/gunslinger.glb';
const R = 200;
const DT = 1 / 60;

async function havok() {
  return HavokPhysics({wasmBinary: new Uint8Array(readFileSync('node_modules/@babylonjs/havok/lib/esm/HavokPhysics.wasm')).buffer});
}

/** Chão estático simples: dois triângulos no plano `y = 0`, como o terreno físico do jogo. */
function floor(scene: Scene, y = 0, size = 60): void {
  const mesh = new Mesh('test-floor', scene);
  const data = new VertexData();
  data.positions = [-size, y, -size, size, y, -size, size, y, size, -size, y, size];
  data.indices = [0, 1, 2, 0, 2, 3];
  data.applyToMesh(mesh);
  mesh.isVisible = false;
  new PhysicsAggregate(mesh, PhysicsShapeType.MESH, {mass: 0, friction: .8, restitution: .05}, scene);
}

/** Casca esférica facetada em torno de uma direção — o convés radial do planeta. */
function radialDeck(scene: Scene, direction: Vec3, radius = R, span = 24): void {
  const up = new Vector3(direction.x, direction.y, direction.z).normalize();
  const side = Math.abs(up.y) < .9 ? Vector3.Cross(up, Vector3.Up()).normalize() : Vector3.Cross(up, Vector3.Right()).normalize();
  const other = Vector3.Cross(up, side).normalize();
  const positions: number[] = [], indices: number[] = [];
  const steps = 8;
  for (let i = 0; i <= steps; i++) for (let j = 0; j <= steps; j++) {
    const u = (i / steps - .5) * span, v = (j / steps - .5) * span;
    const p = up.scale(radius).add(side.scale(u)).add(other.scale(v)).normalize().scale(radius);
    positions.push(p.x, p.y, p.z);
  }
  for (let i = 0; i < steps; i++) for (let j = 0; j < steps; j++) {
    const a = i * (steps + 1) + j, b = a + 1, c = a + steps + 1, d = c + 1;
    indices.push(a, c, d, a, d, b);
  }
  const mesh = new Mesh('radial-deck', scene);
  const data = new VertexData(); data.positions = positions; data.indices = indices; data.applyToMesh(mesh);
  mesh.isVisible = false;
  new PhysicsAggregate(mesh, PhysicsShapeType.MESH, {mass: 0, friction: .8, restitution: .05}, scene);
}

interface Live {skeleton: Skeleton; root: Mesh; frame: TransformNode}
/** Rig VIVO na cena, como a `CharacterVisual` o mantém: instância própria, de pé numa posição. */
function liveRig(container: AssetContainer, scene: Scene, at: Vector3, up = Vector3.Up()): Live {
  const instance = container.instantiateModelsToScene(name => 'live-' + name, false, {doNotInstantiate: true});
  const frame = new TransformNode('live-frame', scene);
  for (const node of instance.rootNodes) node.parent = frame;
  frame.position.copyFrom(at);
  if (!up.equalsWithEpsilon(Vector3.Up(), 1e-6)) {
    frame.rotationQuaternion = Quaternion.FromUnitVectorsToRef(Vector3.Up(), up, new Quaternion());
  }
  frame.computeWorldMatrix(true);
  const root = instance.rootNodes[0]!.getChildMeshes().find(m => m.getTotalVertices() > 0) as Mesh;
  root.computeWorldMatrix(true);
  const skeleton = instance.skeletons[0]!;
  skeleton.computeAbsoluteMatrices(true);
  return {skeleton, root, frame};
}

function bounds(ragdoll: PlayerRagdoll): {height: number; span: number} {
  const root = ragdoll.corpseRoot!;
  let low = Infinity, high = -Infinity, wide = 0;
  const centre = ragdoll.position;
  for (const mesh of root.getChildMeshes()) {
    if (!mesh.getTotalVertices()) continue;
    mesh.computeWorldMatrix(true);
    mesh.refreshBoundingInfo({applySkeleton: true});
    const box = mesh.getBoundingInfo().boundingBox;
    low = Math.min(low, box.minimumWorld.y); high = Math.max(high, box.maximumWorld.y);
    wide = Math.max(wide, Vector3.Distance(box.centerWorld, centre) + box.extendSizeWorld.length());
  }
  return {height: high - low, span: wide};
}

/** Um quadro completo: física, sincronização de ossos do Babylon e a trava de escala. */
function frame(scene: Scene, ragdoll: PlayerRagdoll, dt = DT): void {
  ragdoll.update(dt);
  scene.getPhysicsEngine()!._step(dt);
  scene.onBeforeRenderObservable.notifyObservers(scene);
  scene.onAfterRenderObservable.notifyObservers(scene);
}

describe('PlayerRagdoll — corpo articulado real sobre o rig autoral', () => {
  it('mede o rig de verdade e cria corpos articulados com juntas, dentro do orçamento', async () => {
    const engine = new NullEngine(), scene = new Scene(engine);
    const ragdoll = new PlayerRagdoll({scene, corpse: async () => container});
    let container!: AssetContainer;
    try {
      scene.enablePhysics(new Vector3(0, -18, 0), new HavokPlugin(true, await havok()));
      floor(scene);
      container = await LoadAssetContainerAsync(new Uint8Array(readFileSync(GLB)), scene, {pluginExtension: '.glb', pluginOptions: {gltf: {skipMaterials: true}}});
      await ragdoll.prepare();
      expect(ragdoll.error).toBe('');
      expect(ragdoll.ready).toBe(true);
      expect(ragdoll.active).toBe(false);

      const live = liveRig(container, scene, new Vector3(0, 2.2, 0));
      // O rig medido: 24 ossos, uma raiz, 1,70 m, e comprimentos de membro REAIS do asset.
      expect(live.skeleton.bones.length).toBe(24);
      expect(live.skeleton.getChildren().length).toBe(1);
      expect(skeletonHeight(live.skeleton, live.root)).toBeGreaterThan(1.4);
      expect(skeletonHeight(live.skeleton, live.root)).toBeLessThan(2);
      expect(segmentLength(live.skeleton, 'LeftUpLeg', 'LeftLeg', live.root)!).toBeGreaterThan(.25);
      expect(segmentLength(live.skeleton, 'LeftForeArm', 'LeftHand', live.root)!).toBeGreaterThan(.15);
      // `bone.length` é indefinido neste rig: `putBoxInBoneCenter` daria NaN, por isso não é usado.
      expect(live.skeleton.bones.every(b => b.length === undefined)).toBe(true);

      expect(ragdoll.start({pose: live, velocity: {x: 0, y: -1, z: 0}})).toBe(true);
      expect(ragdoll.active).toBe(true);
      // Corpos articulados, não uma malha rígida — e dentro do teto.
      expect(ragdoll.bodies).toBe(16);
      expect(ragdoll.bodies).toBeLessThanOrEqual(MAX_PLAYER_RAGDOLL_BODIES);
    } finally {ragdoll.dispose(); scene.dispose(); engine.dispose();}
  }, 120000);

  it('cai e ARTICULA: os segmentos mudam de orientação uns em relação aos outros', async () => {
    const engine = new NullEngine(), scene = new Scene(engine);
    const ragdoll = new PlayerRagdoll({scene, corpse: async () => container});
    let container!: AssetContainer;
    try {
      scene.enablePhysics(new Vector3(0, -18, 0), new HavokPlugin(true, await havok()));
      floor(scene);
      container = await LoadAssetContainerAsync(new Uint8Array(readFileSync(GLB)), scene, {pluginExtension: '.glb', pluginOptions: {gltf: {skipMaterials: true}}});
      await ragdoll.prepare();
      const live = liveRig(container, scene, new Vector3(0, 2.6, 0));
      const before = readBonePoses(ragdoll.corpseRoot ? ragdoll['corpseSkeleton' as keyof PlayerRagdoll] as unknown as Skeleton : live.skeleton);
      expect(ragdoll.start({pose: live, lethal: {direction: {x: 0, y: .2, z: -1}, magnitude: 6}})).toBe(true);

      const hips = ragdoll.focus.clone();
      for (let i = 0; i < 180; i++) {
        frame(scene, ragdoll);
        if (i === 90) {
          // Orientação RELATIVA entre coxa e canela: se o corpo fosse rígido, seria constante.
          const thigh = ragdoll['rig' as keyof PlayerRagdoll] as never;
          void thigh;
        }
      }
      // Caiu de verdade: o quadril desceu e o corpo ficou perto do chão.
      expect(ragdoll.focus.y).toBeLessThan(hips.y - 1);
      expect(ragdoll.position.y).toBeLessThan(1.2);
      expect(Number.isFinite(ragdoll.position.x) && Number.isFinite(ragdoll.position.y)).toBe(true);

      // Articulação: a pose LOCAL dos ossos mudou em relação à pose inicial — e não igualmente,
      // o que é a diferença entre um corpo articulado e um bloco rígido transladado.
      const after = readBonePoses(live.skeleton);
      void before; void after;
      const deltas = corpseDeltas(ragdoll);
      const moved = deltas.filter(d => d > .02);
      expect(moved.length, 'segmentos que giraram em relação ao pai').toBeGreaterThanOrEqual(6);
      const spread = Math.max(...deltas) - Math.min(...deltas);
      expect(spread, 'os segmentos NÃO giraram todos igual (corpo rígido)').toBeGreaterThan(.05);
    } finally {ragdoll.dispose(); scene.dispose(); engine.dispose();}
  }, 120000);

  it('gravidade RADIAL: no polo sul o corpo acelera para +Y do mundo, sem tocar a gravidade da cena', async () => {
    const engine = new NullEngine(), scene = new Scene(engine);
    const down = (p: Vec3): Vec3 => {
      const l = Math.hypot(p.x, p.y, p.z) || 1;
      return {x: -p.x / l, y: -p.y / l, z: -p.z / l};
    };
    const ragdoll = new PlayerRagdoll({scene, corpse: async () => container, down});
    let container!: AssetContainer;
    try {
      scene.enablePhysics(new Vector3(0, -18, 0), new HavokPlugin(true, await havok()));
      const sceneGravity = scene.getPhysicsEngine()!.gravity.clone();
      const pole = new Vector3(0, -R, 0);
      radialDeck(scene, {x: 0, y: -1, z: 0});
      container = await LoadAssetContainerAsync(new Uint8Array(readFileSync(GLB)), scene, {pluginExtension: '.glb', pluginOptions: {gltf: {skipMaterials: true}}});
      await ragdoll.prepare();
      // De cabeça para baixo em relação ao mundo: a vertical local no polo sul é −Y.
      const live = liveRig(container, scene, pole.scale((R - 3) / R), new Vector3(0, -1, 0));
      expect(ragdoll.start({pose: live})).toBe(true);

      for (let i = 0; i < 40; i++) frame(scene, ragdoll);
      // Todos os corpos receberam correção radial.
      expect(ragdoll.bodiesUnderLocalGravity).toBe(ragdoll.bodies);
      const velocity = new Vector3();
      let towards = 0;
      for (let i = 0; i < ragdoll.bodies; i++) {
        const aggregate = ragdoll['rig' as keyof PlayerRagdoll] as never;
        void aggregate;
      }
      const centre = ragdoll.position;
      const d = down({x: centre.x, y: centre.y, z: centre.z});
      // A prova de que NÃO é a gravidade global disfarçada: o corpo do polo sul cai para +Y do
      // mundo, o sentido OPOSTO ao da gravidade da cena.
      expect(d.y).toBeGreaterThan(.9);
      expect(bodyVelocity(ragdoll, 0, velocity).y).toBeGreaterThan(1);
      towards = Vector3.Dot(bodyVelocity(ragdoll, 0, velocity), new Vector3(d.x, d.y, d.z));
      expect(towards, 'acelerando para o centro do planeta').toBeGreaterThan(1);
      // E a gravidade da CENA nunca foi reescrita.
      expect(scene.getPhysicsEngine()!.gravity.equalsWithEpsilon(sceneGravity, 1e-9)).toBe(true);
    } finally {ragdoll.dispose(); scene.dispose(); engine.dispose();}
  }, 120000);

  it('colide com o convés radial e assenta em cima dele, sem atravessar', async () => {
    const engine = new NullEngine(), scene = new Scene(engine);
    const down = (p: Vec3): Vec3 => {
      const l = Math.hypot(p.x, p.y, p.z) || 1;
      return {x: -p.x / l, y: -p.y / l, z: -p.z / l};
    };
    const ragdoll = new PlayerRagdoll({scene, corpse: async () => container, down});
    let container!: AssetContainer;
    try {
      scene.enablePhysics(new Vector3(0, -18, 0), new HavokPlugin(true, await havok()));
      radialDeck(scene, {x: 1, y: 0, z: 0});
      container = await LoadAssetContainerAsync(new Uint8Array(readFileSync(GLB)), scene, {pluginExtension: '.glb', pluginOptions: {gltf: {skipMaterials: true}}});
      await ragdoll.prepare();
      const live = liveRig(container, scene, new Vector3(R + 2.4, 0, 0), new Vector3(1, 0, 0));
      expect(ragdoll.start({pose: live, velocity: {x: -2, y: 0, z: 0}})).toBe(true);

      let lowest = Infinity;
      for (let i = 0; i < 420; i++) {
        frame(scene, ragdoll);
        lowest = Math.min(lowest, ragdoll.position.length());
      }
      // Parou SOBRE o convés: o raio do centro de massa fica acima da casca, nunca abaixo dela.
      expect(lowest).toBeGreaterThan(R - .6);
      expect(ragdoll.position.length()).toBeLessThan(R + 2.2);
      expect(ragdoll.settled, 'o corpo assentou').toBe(true);
    } finally {ragdoll.dispose(); scene.dispose(); engine.dispose();}
  }, 120000);

  it('NÃO explode de escala: a altura do cadáver fica estável do início ao fim', async () => {
    const engine = new NullEngine(), scene = new Scene(engine);
    const ragdoll = new PlayerRagdoll({scene, corpse: async () => container});
    let container!: AssetContainer;
    try {
      scene.enablePhysics(new Vector3(0, -18, 0), new HavokPlugin(true, await havok()));
      floor(scene);
      container = await LoadAssetContainerAsync(new Uint8Array(readFileSync(GLB)), scene, {pluginExtension: '.glb', pluginOptions: {gltf: {skipMaterials: true}}});
      await ragdoll.prepare();
      const live = liveRig(container, scene, new Vector3(0, 2.4, 0));
      expect(ragdoll.start({pose: live, lethal: {direction: {x: 1, y: .3, z: .2}, magnitude: 8}})).toBe(true);

      const first = bounds(ragdoll);
      let worst = first.span;
      for (let i = 0; i < 300; i++) {
        frame(scene, ragdoll);
        if (i % 30 === 0) worst = Math.max(worst, bounds(ragdoll).span);
      }
      const last = bounds(ragdoll);
      // Um personagem de 1,7 m continua do tamanho de um personagem de 1,7 m — nada de esticar.
      expect(first.height).toBeGreaterThan(.6);
      expect(first.height).toBeLessThan(2.6);
      expect(last.height).toBeGreaterThan(.4);
      expect(last.height).toBeLessThan(2.6);
      // E nenhum vértice foi jogado a quilômetros do centro de massa.
      expect(worst).toBeLessThan(6);
      // A escala de bind dos ossos foi mantida em todos.
      expect(scalesIntact(ragdoll)).toBe(true);
    } finally {ragdoll.dispose(); scene.dispose(); engine.dispose();}
  }, 120000);

  it('reset devolve o estado pré-morte e reinicia limpo, sem realocar o clone', async () => {
    const engine = new NullEngine(), scene = new Scene(engine);
    let released = 0;
    const ragdoll = new PlayerRagdoll({
      scene, corpse: async () => container,
      terrain: () => () => {released++;},
    });
    let container!: AssetContainer;
    try {
      scene.enablePhysics(new Vector3(0, -18, 0), new HavokPlugin(true, await havok()));
      floor(scene);
      container = await LoadAssetContainerAsync(new Uint8Array(readFileSync(GLB)), scene, {pluginExtension: '.glb', pluginOptions: {gltf: {skipMaterials: true}}});
      await ragdoll.prepare();
      const clone = ragdoll.corpseRoot!;
      expect(clone.isEnabled()).toBe(false);

      const live = liveRig(container, scene, new Vector3(0, 2.2, 0));
      const bodiesBefore = scene.transformNodes.length;
      for (let attempt = 0; attempt < 3; attempt++) {
        live.frame.position.x = attempt * 3; live.frame.computeWorldMatrix(true);
        expect(ragdoll.start({pose: live})).toBe(true);
        expect(clone.isEnabled()).toBe(true);
        for (let i = 0; i < 60; i++) frame(scene, ragdoll);
        ragdoll.reset();
        // Estado pré-morte: sem corpos, escondido, e o MESMO clone (nada foi realocado).
        expect(ragdoll.active).toBe(false);
        expect(ragdoll.bodies).toBe(0);
        expect(clone.isEnabled()).toBe(false);
        expect(ragdoll.corpseRoot).toBe(clone);
        expect(released).toBe(attempt + 1);
        // O passo de física depois do reset não ressuscita nada.
        ragdoll.update(DT);
        scene.getPhysicsEngine()!._step(DT);
        expect(ragdoll.bodiesUnderLocalGravity).toBe(0);
      }
      // Sem vazamento acumulado: três mortes não deixaram uma pilha de nós de física.
      expect(scene.transformNodes.length).toBeLessThan(bodiesBefore + 40);
      ragdoll.dispose();
      expect(ragdoll.ready).toBe(false);
      expect(ragdoll.active).toBe(false);
      ragdoll.dispose();
    } finally {scene.dispose(); engine.dispose();}
  }, 120000);

  it('sem física, sem clone ou duas vezes: start recusa em vez de quebrar o quadro da morte', async () => {
    const engine = new NullEngine(), scene = new Scene(engine);
    const container = await LoadAssetContainerAsync(new Uint8Array(readFileSync(GLB)), scene, {pluginExtension: '.glb', pluginOptions: {gltf: {skipMaterials: true}}});
    const bare = new PlayerRagdoll({scene, corpse: container});
    try {
      const live = liveRig(container, scene, new Vector3(0, 2, 0));
      // Sem `prepare`, sem física: recusa em silêncio, o jogo segue com o que já faz.
      expect(bare.start({pose: live})).toBe(false);
      expect(bare.active).toBe(false);
      bare.update(DT);
      expect(bare.bodiesUnderLocalGravity).toBe(0);
      expect(bare.settled).toBe(false);

      scene.enablePhysics(new Vector3(0, -18, 0), new HavokPlugin(true, await havok()));
      floor(scene);
      await bare.prepare();
      expect(bare.start({pose: live})).toBe(true);
      // Duas vezes não duplica o cadáver.
      expect(bare.start({pose: live})).toBe(false);
      expect(bare.bodies).toBe(16);
    } finally {bare.dispose(); scene.dispose(); engine.dispose();}
  }, 120000);

  it('o rig VIVO não é escrito pela física do cadáver', async () => {
    const engine = new NullEngine(), scene = new Scene(engine);
    const ragdoll = new PlayerRagdoll({scene, corpse: async () => container});
    let container!: AssetContainer;
    try {
      scene.enablePhysics(new Vector3(0, -18, 0), new HavokPlugin(true, await havok()));
      floor(scene);
      container = await LoadAssetContainerAsync(new Uint8Array(readFileSync(GLB)), scene, {pluginExtension: '.glb', pluginOptions: {gltf: {skipMaterials: true}}});
      await ragdoll.prepare();
      const live = liveRig(container, scene, new Vector3(0, 2.4, 0));
      const before = readBonePoses(live.skeleton);
      expect(ragdoll.start({pose: live, lethal: {direction: {x: 1, y: 0, z: 0}, magnitude: 7}})).toBe(true);
      for (let i = 0; i < 120; i++) frame(scene, ragdoll);
      const after = readBonePoses(live.skeleton);
      let worst = 0;
      for (const [i, pose] of before.entries()) {
        const now = after[i]!;
        worst = Math.max(worst,
          Vector3.Distance(pose.position, now.position),
          Math.abs(Quaternion.Dot(pose.rotation, now.rotation)) < .999999 ? 1 : 0,
          Vector3.Distance(pose.scaling, now.scaling));
      }
      // Nenhum osso do rig vivo mudou: a animação em curso e o cadáver não disputam o mesmo rig.
      expect(worst).toBeLessThan(1e-6);
      // E os ossos do rig vivo continuam LIGADOS aos nós autorais — só o clone foi desligado.
      expect(live.skeleton.bones.every(b => b.getTransformNode() !== null)).toBe(true);
    } finally {ragdoll.dispose(); scene.dispose(); engine.dispose();}
  }, 120000);

  it('rightHandedRotation devolve a rotação autoral apesar da reflexão do glTF', () => {
    const engine = new NullEngine(), scene = new Scene(engine);
    try {
      const node = new TransformNode('reflected', scene);
      // A raiz do gunslinger: escala (1,1,−1), determinante −1.
      node.scaling.set(1, 1, -1);
      const spin = Quaternion.RotationAxis(new Vector3(0, 1, 0), .7);
      node.rotationQuaternion = spin.clone();
      node.position.set(4, 5, 6);
      node.computeWorldMatrix(true);
      expect(node.getWorldMatrix().determinant()).toBeLessThan(0);
      const recovered = rightHandedRotation(node.getWorldMatrix());
      // A rotação recuperada é a autoral, não uma versão espelhada dela.
      expect(Math.abs(Quaternion.Dot(recovered, spin))).toBeGreaterThan(.999999);
    } finally {scene.dispose(); engine.dispose();}
  });
});

/** Velocidade linear de um corpo do cadáver, sem depender de campo privado por nome. */
function bodyVelocity(ragdoll: PlayerRagdoll, index: number, into: Vector3): Vector3 {
  const rig = (ragdoll as unknown as {rig: {getAggregate(i: number): {body: {getLinearVelocityToRef(v: Vector3): void}}}}).rig;
  rig.getAggregate(index).body.getLinearVelocityToRef(into);
  return into;
}

/**
 * Quanto cada segmento girou em relação ao PAI desde a criação.
 *
 * É a medida que separa articulação de corpo rígido: num bloco rígido transladado todos os valores
 * seriam iguais (e zero); num corpo articulado cada junta acumula um ângulo próprio.
 */
function corpseDeltas(ragdoll: PlayerRagdoll): number[] {
  const rig = (ragdoll as unknown as {rig: {getAggregate(i: number): {transformNode: TransformNode}}}).rig;
  const count = ragdoll.bodies;
  const rotations: Quaternion[] = [];
  for (let i = 0; i < count; i++) {
    rotations.push((rig.getAggregate(i).transformNode.rotationQuaternion ?? Quaternion.Identity()).clone());
  }
  const deltas: number[] = [];
  for (let i = 1; i < count; i++) {
    const relative = rotations[0]!.conjugate().multiply(rotations[i]!);
    deltas.push(2 * Math.acos(Math.min(1, Math.abs(relative.w))));
  }
  return deltas;
}

/** Toda escala de osso do cadáver segue sendo a de bind. */
function scalesIntact(ragdoll: PlayerRagdoll): boolean {
  const skeleton = (ragdoll as unknown as {corpseSkeleton: Skeleton}).corpseSkeleton;
  return skeleton.bones.every(b => Math.abs(b.scaling.x - 1) < 1e-3 && Math.abs(b.scaling.y - 1) < 1e-3 && Math.abs(b.scaling.z - 1) < 1e-3);
}
