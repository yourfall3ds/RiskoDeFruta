/**
 * Diagnóstico dos alienígenas. NÃO corrige nada: só mede e compara.
 *
 * Para cada GLB informado, reporta o que o glTF declara e o que o Babylon realmente monta:
 * malhas, esqueletos, grupos de animação, transformação da raiz e — o número que decide tudo — a
 * caixa da geometria DEFORMADA pelo esqueleto, medida em três momentos:
 *
 *   1. como carregado, sem tocar nenhuma animação (a pose de vínculo);
 *   2. com `Idle` amostrado no primeiro quadro;
 *   3. com `Walk` amostrado no meio.
 *
 * É essa comparação que separa "o arquivo está quebrado" de "o arquivo está bom e o jogo não está
 * escrevendo nenhuma pose". Um corpo desabado em (1) mas de pé em (2) e (3) significa que o GLB
 * está correto e quem precisa mudar é o runtime.
 *
 * Uso: node scripts/diagnose-aliens.mjs <arquivo.glb> [...]
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { ImportMeshAsync } from '@babylonjs/core/Loading/sceneLoader.js';
import '@babylonjs/loaders/glTF/index.js';

/** Extremos da superfície já deformada pelo esqueleto: é o que a tela mostra. */
function deformedSpan(meshes) {
  const point = new Vector3();
  let low = Infinity, high = -Infinity, wide = -Infinity, narrow = Infinity, front = -Infinity, back = Infinity;
  for (const mesh of meshes) {
    const vertices = mesh.getPositionData(true, true);
    if (!vertices) continue;
    const matrix = mesh.computeWorldMatrix(true);
    for (let i = 0; i < vertices.length; i += 3) {
      Vector3.TransformCoordinatesFromFloatsToRef(vertices[i], vertices[i + 1], vertices[i + 2], matrix, point);
      low = Math.min(low, point.y); high = Math.max(high, point.y);
      narrow = Math.min(narrow, point.x); wide = Math.max(wide, point.x);
      back = Math.min(back, point.z); front = Math.max(front, point.z);
    }
  }
  return { low, high, height: high - low, width: wide - narrow, depth: front - back };
}

/**
 * Amostra um grupo de animação num instante, como o jogo faz, sem deixá-lo rodando.
 *
 * `skeleton.prepare()` depois da escrita é OBRIGATÓRIO: sem ele as matrizes dos ossos continuam as
 * do quadro anterior e `getPositionData(true,true)` devolve exatamente a mesma geometria para
 * qualquer pose — foi assim que a primeira versão deste diagnóstico mediu três poses diferentes e
 * imprimiu números idênticos, o que teria levado à conclusão errada.
 */
function sampleGroup(group, progress, scene) {
  const frame = group.from + (group.to - group.from) * progress;
  for (const track of group.targetedAnimations) {
    const node = track.target;
    const value = track.animation.evaluate(frame);
    const property = track.animation.targetProperty;
    if (property === 'rotationQuaternion' && node.rotationQuaternion) node.rotationQuaternion.copyFrom(value);
    else if (property === 'position') node.position.copyFrom(value);
    else if (property === 'scaling') node.scaling.copyFrom(value);
  }
  for (const skeleton of scene.skeletons) skeleton.prepare(true);
}

const glbJson = (file) => {
  const bytes = readFileSync(file);
  return JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
};

for (const file of process.argv.slice(2)) {
  const name = path.basename(file);
  console.log('\n' + '='.repeat(78));
  console.log('MODELO:', name);
  let json;
  try { json = glbJson(file); } catch (error) { console.log('  glTF ilegível:', error.message); continue; }

  const roots = (json.scenes?.[0]?.nodes ?? []).map(i => json.nodes[i]);
  console.log('-- glTF declarado --');
  console.log('   nós', json.nodes?.length ?? 0, '| malhas', json.meshes?.length ?? 0,
    '| skins', json.skins?.length ?? 0, '| animações', json.animations?.length ?? 0);
  for (const root of roots) console.log(`   raiz "${root.name}" t=${JSON.stringify(root.translation ?? [0, 0, 0])} r=${JSON.stringify(root.rotation ?? null)} s=${JSON.stringify(root.scale ?? [1, 1, 1])}`);
  console.log('   animações:', (json.animations ?? []).map(a => a.name).join(', ') || '(nenhuma)');
  for (const skin of json.skins ?? []) console.log('   skin: juntas', skin.joints.length, '| inverseBind', skin.inverseBindMatrices !== undefined ? 'presente' : 'AUSENTE');

  const engine = new NullEngine(), scene = new Scene(engine);
  try {
    const imported = await ImportMeshAsync(new Uint8Array(readFileSync(file)), scene, { pluginExtension: '.glb' });
    const meshes = imported.meshes.filter(m => m.getTotalVertices() > 0);
    console.log('-- Babylon montado --');
    console.log('   meshes', imported.meshes.length, '(com vértices', meshes.length + ')',
      '| skeletons', imported.skeletons.length,
      '| animationGroups', imported.animationGroups.length);
    console.log('   grupos:', imported.animationGroups.map(g => `${g.name}[${g.from}..${g.to}]`).join(', ') || '(nenhum)');
    for (const skeleton of imported.skeletons) console.log(`   esqueleto "${skeleton.name}": ${skeleton.bones.length} ossos | raízes ${skeleton.bones.filter(b => !b.getParent()).map(b => b.name).join(', ').slice(0, 90)}`);
    const rootNodes = imported.meshes.filter(m => !m.parent);
    for (const root of rootNodes) console.log(`   raiz Babylon "${root.name}" pos=${root.position} scale=${root.scaling} rotQ=${root.rotationQuaternion ?? root.rotation}`);
    for (const group of imported.animationGroups) group.stop();

    for (const skeleton of scene.skeletons) skeleton.prepare(true);
    const asLoaded = deformedSpan(meshes);
    const idle = imported.animationGroups.find(g => /idle/i.test(g.name));
    const walk = imported.animationGroups.find(g => /walk/i.test(g.name));
    let afterIdle = null, afterWalk = null, backToIdle = null;
    if (idle) { sampleGroup(idle, 0, scene); afterIdle = deformedSpan(meshes); }
    if (walk) { sampleGroup(walk, .5, scene); afterWalk = deformedSpan(meshes); }
    // Idle → Walk → Idle: se a terceira medida não voltar à primeira, a troca de clipe corrompe a pose.
    if (idle) { sampleGroup(idle, 0, scene); backToIdle = deformedSpan(meshes); }

    const show = (label, s) => s && console.log(`   ${label.padEnd(18)} altura ${s.height.toFixed(3)} | pés Y ${s.low.toFixed(3)} | largura ${s.width.toFixed(3)} | profundidade ${s.depth.toFixed(3)}`);
    console.log('-- geometria deformada --');
    show('pose de vínculo', asLoaded);
    show(`Idle@0 ${idle ? '' : '(ausente)'}`, afterIdle);
    show(`Walk@0.5 ${walk ? '' : '(ausente)'}`, afterWalk);
    show('Idle de volta', backToIdle);
    const reference = afterIdle ?? asLoaded;
    // Um bípede de pé é mais ALTO que FUNDO. A largura não serve de critério: em T-pose os braços
    // abertos deixam a largura maior que a altura sem que o corpo esteja deitado.
    console.log(`   altura/profundidade = ${(reference.height / Math.max(.001, reference.depth)).toFixed(2)} (acima de 1 = de pé; perto de 0,5 = deitado)`);
    if (afterIdle && Math.abs(afterIdle.height - asLoaded.height) > .03)
      console.log(`   NOTA: amostrar Idle muda a altura em ${(afterIdle.height - asLoaded.height).toFixed(3)} m — a pose de vínculo NÃO é a pose de jogo.`);
    else if (afterIdle)
      console.log('   NOTA: Idle não muda a geometria em relação à pose de vínculo.');
    if (backToIdle && afterIdle && Math.abs(backToIdle.height - afterIdle.height) > .002)
      console.log(`   ALERTA: Idle→Walk→Idle não voltou à mesma pose (${(backToIdle.height - afterIdle.height).toFixed(4)} m de diferença).`);
  } catch (error) {
    console.log('  falhou no Babylon:', error.message);
  } finally {
    scene.dispose(); engine.dispose();
  }
}
