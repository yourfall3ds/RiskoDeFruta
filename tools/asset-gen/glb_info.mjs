#!/usr/bin/env node
/**
 * glb_info.mjs - Inspeciona um GLB e imprime o que o projeto precisa saber.
 *
 * Serve a dois momentos do fluxo:
 *   1. Validar o que o modelo REALMENTE entregou (textura? UV? normais?) -
 *      isso varia por versao do Hunyuan3D e supor errado custa caro.
 *   2. Obter o bounding box para o campo `size` de registries de asset, que
 *      normalmente exigem as dimensoes do GLB cru.
 *
 * Uso:
 *   node glb_info.mjs caminho.glb [--json]
 *
 * Depende de @gltf-transform/core e @gltf-transform/extensions, ja instalados
 * no projeto pelo pipeline. Rode a partir da raiz do projeto.
 */

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { statSync } from 'node:fs';

const file = process.argv[2];
const asJson = process.argv.includes('--json');

if (!file) {
  console.error('uso: node glb_info.mjs <arquivo.glb> [--json]');
  process.exit(2);
}

const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(file);
const root = doc.getRoot();

// Bounding box no espaco local das primitivas. Nao aplica transform de node -
// e o mesmo criterio que registries costumam usar para "dimensoes do arquivo".
const lo = [Infinity, Infinity, Infinity];
const hi = [-Infinity, -Infinity, -Infinity];
let tris = 0;

for (const mesh of root.listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION');
    if (!pos) continue;
    const min = pos.getMin([]);
    const max = pos.getMax([]);
    for (let i = 0; i < 3; i++) {
      lo[i] = Math.min(lo[i], min[i]);
      hi[i] = Math.max(hi[i], max[i]);
    }
    const idx = prim.getIndices();
    tris += (idx ? idx.getCount() : pos.getCount()) / 3;
  }
}

const size = lo[0] === Infinity
  ? [0, 0, 0]
  : hi.map((h, i) => Number((h - lo[i]).toFixed(3)));

const prim = root.listMeshes()[0]?.listPrimitives()[0];
const info = {
  file,
  mb: Number((statSync(file).size / 1048576).toFixed(2)),
  tris: Math.round(tris),
  size,
  attributes: prim ? prim.listSemantics() : [],
  textures: root.listTextures().map((t) => ({
    name: t.getName() || null,
    mime: t.getMimeType(),
    resolution: (t.getSize() || []).join('x') || null,
  })),
  materials: root.listMaterials().length,
  animations: root.listAnimations().map((a) => a.getName()),
};

if (asJson) {
  console.log(JSON.stringify(info, null, 2));
} else {
  console.log(`arquivo   : ${info.file}`);
  console.log(`tamanho   : ${info.mb} MB`);
  console.log(`triangulos: ${info.tris}`);
  console.log(`size      : [${info.size.join(', ')}]   <- campo do registry`);
  console.log(`atributos : ${info.attributes.join(', ') || '(nenhum)'}`);
  console.log(`texturas  : ${info.textures.map((t) => `${t.mime} ${t.resolution}`).join(', ') || '(nenhuma)'}`);
  console.log(`materiais : ${info.materials}`);
  console.log(`animacoes : ${info.animations.join(', ') || '(nenhuma)'}`);

  // Avisos sobre coisas que costumam passar despercebidas.
  if (!info.attributes.includes('NORMAL')) {
    console.log('\nAVISO: sem atributo NORMAL - o loader vai calcular no runtime.');
    console.log('       Para hard-surface, normais flat preservam melhor as quinas.');
  }
  if (!info.attributes.includes('TEXCOORD_0') && info.textures.length) {
    console.log('\nAVISO: ha textura mas nao ha UV - o mapeamento nao vai funcionar.');
  }
  if (info.textures.length === 1) {
    console.log('\nNOTA: textura unica = so albedo (sem metallic/roughness/normal).');
  }
}
