#!/usr/bin/env node
/**
 * Remove os FRAGMENTOS SOLTOS de um GLB gerado.
 *
 * A saída do PartCrafter vem salpicada de cacos desconexos flutuando em volta do objeto — 74 deles
 * no robô de teste. São lixo de reconstrução: pedaços de superfície que o modelo fechou longe do
 * corpo e que aparecem na cena como sujeira no ar.
 *
 * O critério é topológico, não geométrico: união-busca sobre as arestas dos triângulos separa a
 * malha em componentes CONEXOS, e cada componente pequeno demais em relação ao maior é descartado.
 * Medir por tamanho relativo (e não por um número fixo de vértices) é o que faz a regra valer tanto
 * para uma peça de 800 mil vértices quanto para uma de 70 mil.
 *
 * Trabalha POR MALHA, então a separação em partes do PartCrafter é preservada — limpar não pode
 * fundir o que o modelo separou, senão perde-se justamente o que ele tem de melhor.
 *
 * Uso:
 *   node tools/asset-gen/limpar_glb.mjs entrada.glb saida.glb [--limiar 0.02]
 */
import {readFileSync, writeFileSync} from 'node:fs';

/** Um componente menor que esta fração do MAIOR componente da malha é considerado lixo. */
const LIMIAR_PADRAO = 0.02;

const LEITOR = {
  5120: ['readInt8', 1], 5121: ['readUInt8', 1], 5122: ['readInt16LE', 2],
  5123: ['readUInt16LE', 2], 5125: ['readUInt32LE', 4], 5126: ['readFloatLE', 4],
};
const COMPONENTES = {SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16};

function abrirGlb(caminho) {
  const bytes = readFileSync(caminho);
  if (bytes.toString('ascii', 0, 4) !== 'glTF') throw new Error('não é um GLB');
  const tamanhoJson = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.toString('utf8', 20, 20 + tamanhoJson));
  const inicioBin = 20 + tamanhoJson + 8;
  return {json, bin: bytes.subarray(inicioBin)};
}

/** Lê um accessor inteiro como array plano de números. */
function lerAccessor(json, bin, indice) {
  const a = json.accessors[indice];
  const vista = json.bufferViews[a.bufferView];
  const [metodo, largura] = LEITOR[a.componentType];
  const itens = COMPONENTES[a.type];
  const base = (vista.byteOffset || 0) + (a.byteOffset || 0);
  // `byteStride` existe quando os atributos estão entrelaçados no mesmo buffer.
  const passo = vista.byteStride || largura * itens;
  const saida = new Array(a.count * itens);
  for (let i = 0; i < a.count; i++)
    for (let c = 0; c < itens; c++) saida[i * itens + c] = bin[metodo](base + i * passo + c * largura);
  return {dados: saida, itens, tipo: a.type, componentType: a.componentType, normalizado: a.normalized === true};
}

/** Componentes conexos por união-busca sobre as arestas dos triângulos. */
function componentes(indices, totalVertices) {
  const pai = new Int32Array(totalVertices);
  for (let i = 0; i < totalVertices; i++) pai[i] = i;
  const raiz = x => {while (pai[x] !== x) {pai[x] = pai[pai[x]]; x = pai[x];} return x;};
  for (let i = 0; i < indices.length; i += 3) {
    const a = raiz(indices[i]), b = raiz(indices[i + 1]), c = raiz(indices[i + 2]);
    pai[b] = a; pai[c] = a;
  }
  const tamanho = new Map();
  for (let i = 0; i < totalVertices; i++) {
    const r = raiz(i);
    tamanho.set(r, (tamanho.get(r) ?? 0) + 1);
  }
  return {raiz, tamanho};
}

function limpar(entrada, saida, limiar) {
  const {json, bin} = abrirGlb(entrada);
  const blocos = [];
  let deslocamento = 0;
  const novasVistas = [], novosAccessors = [];

  /** Grava um array plano num bufferView/accessor novos e devolve o índice do accessor. */
  function gravar(valores, itens, tipo, componentType, alvoABO, normalizado) {
    const [metodo, largura] = LEITOR[componentType];
    const escrever = metodo.replace('read', 'write');
    const buffer = Buffer.alloc(valores.length * largura);
    for (let i = 0; i < valores.length; i++) buffer[escrever](valores[i], i * largura);
    // Alinhamento de 4 bytes: o glTF exige, e sem isso alguns leitores recusam o arquivo.
    const sobra = (4 - (deslocamento % 4)) % 4;
    if (sobra) {blocos.push(Buffer.alloc(sobra)); deslocamento += sobra;}
    const vista = {buffer: 0, byteOffset: deslocamento, byteLength: buffer.length};
    if (alvoABO !== undefined) vista.target = alvoABO;
    novasVistas.push(vista);
    blocos.push(buffer);
    deslocamento += buffer.length;
    const contagem = valores.length / itens;
    const accessor = {bufferView: novasVistas.length - 1, componentType, count: contagem, type: tipo};
    // Sem `normalized`, um COLOR_0 de byte é lido como 0..255 em vez de 0..1 e a peça sai
    // BRANCA estourada. A flag é do accessor de origem e tem de viajar junto com os dados.
    if (normalizado) accessor.normalized = true;
    if (tipo === 'VEC3') {
      const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < contagem; i++)
        for (let c = 0; c < 3; c++) {
          const v = valores[i * 3 + c];
          if (v < min[c]) min[c] = v;
          if (v > max[c]) max[c] = v;
        }
      accessor.min = min; accessor.max = max;
    }
    novosAccessors.push(accessor);
    return novosAccessors.length - 1;
  }

  const relatorio = [];
  for (const [indiceMalha, malha] of json.meshes.entries()) {
    for (const primitiva of malha.primitives) {
      const indices = lerAccessor(json, bin, primitiva.indices).dados;
      const totalVertices = json.accessors[primitiva.attributes.POSITION].count;
      const {raiz, tamanho} = componentes(indices, totalVertices);
      const maior = Math.max(...tamanho.values());
      const manter = new Set();
      let descartados = 0;
      for (const [r, n] of tamanho) {
        if (n >= maior * limiar) manter.add(r); else descartados++;
      }

      // Remapeia só os vértices que sobrevivem, na ordem em que aparecem.
      const mapa = new Int32Array(totalVertices).fill(-1);
      let proximo = 0;
      for (let v = 0; v < totalVertices; v++) if (manter.has(raiz(v))) mapa[v] = proximo++;

      const novosIndices = [];
      for (let i = 0; i < indices.length; i += 3) {
        if (!manter.has(raiz(indices[i]))) continue;
        novosIndices.push(mapa[indices[i]], mapa[indices[i + 1]], mapa[indices[i + 2]]);
      }

      const atributos = {};
      for (const [nome, indiceAccessor] of Object.entries(primitiva.attributes)) {
        const {dados, itens, tipo, componentType, normalizado} = lerAccessor(json, bin, indiceAccessor);
        const filtrado = new Array(proximo * itens);
        for (let v = 0; v < totalVertices; v++) {
          if (mapa[v] < 0) continue;
          for (let c = 0; c < itens; c++) filtrado[mapa[v] * itens + c] = dados[v * itens + c];
        }
        atributos[nome] = gravar(filtrado, itens, tipo, componentType, 34962, normalizado);
      }
      /**
       * Normais, quando o gerador não as entrega.
       *
       * A saída do PartCrafter traz só `POSITION` e `COLOR_0`. Sem `NORMAL` o Babylon cai em
       * sombreamento chapado e a peça aparece como uma silhueta branca — é a MESMA armadilha já
       * registrada neste projeto (o silo que "parecia cheio de polígonos tortos" com a geometria
       * intacta). Calcular aqui é obrigatório, não enfeite: o asset sairia inutilizável.
       *
       * Acumulação por área: o produto vetorial não normalizado já tem comprimento proporcional
       * ao dobro da área do triângulo, então somá-lo cru pondera cada face pelo tamanho dela — que
       * é o que dá superfície lisa sem precisar de peso explícito.
       */
      if (!atributos['NORMAL']) {
        const posicoes = lerAccessor(json, bin, primitiva.attributes.POSITION ?? 0);
        const pos = new Float64Array(proximo * 3);
        for (let v = 0; v < totalVertices; v++) {
          if (mapa[v] < 0) continue;
          for (let c = 0; c < 3; c++) pos[mapa[v] * 3 + c] = posicoes.dados[v * 3 + c];
        }
        const normais = new Float64Array(proximo * 3);
        for (let i = 0; i < novosIndices.length; i += 3) {
          const a = novosIndices[i] * 3, b = novosIndices[i + 1] * 3, c = novosIndices[i + 2] * 3;
          const abx = pos[b] - pos[a], aby = pos[b + 1] - pos[a + 1], abz = pos[b + 2] - pos[a + 2];
          const acx = pos[c] - pos[a], acy = pos[c + 1] - pos[a + 1], acz = pos[c + 2] - pos[a + 2];
          const nx = aby * acz - abz * acy, ny = abz * acx - abx * acz, nz = abx * acy - aby * acx;
          for (const base of [a, b, c]) {normais[base] += nx; normais[base + 1] += ny; normais[base + 2] += nz;}
        }
        const plano = new Array(proximo * 3);
        for (let v = 0; v < proximo; v++) {
          const x = normais[v * 3], y = normais[v * 3 + 1], z = normais[v * 3 + 2];
          const comprimento = Math.hypot(x, y, z);
          // Vértice órfão (sem triângulo) recebe uma normal qualquer, válida: zero quebra o shader.
          if (comprimento < 1e-12) {plano[v * 3] = 0; plano[v * 3 + 1] = 1; plano[v * 3 + 2] = 0; continue;}
          plano[v * 3] = x / comprimento; plano[v * 3 + 1] = y / comprimento; plano[v * 3 + 2] = z / comprimento;
        }
        atributos['NORMAL'] = gravar(plano, 3, 'VEC3', 5126, 34962);
      }

      primitiva.attributes = atributos;
      primitiva.indices = gravar(novosIndices, 1, 'SCALAR', 5125, 34963);

      relatorio.push({
        malha: malha.name ?? indiceMalha,
        pedacos: tamanho.size, descartados,
        verticesAntes: totalVertices, verticesDepois: proximo,
        trianglesAntes: indices.length / 3, trianglesDepois: novosIndices.length / 3,
      });
    }
  }

  json.bufferViews = novasVistas;
  json.accessors = novosAccessors;
  const novoBin = Buffer.concat(blocos);
  json.buffers = [{byteLength: novoBin.length}];

  let textoJson = Buffer.from(JSON.stringify(json), 'utf8');
  const sobraJson = (4 - (textoJson.length % 4)) % 4;
  if (sobraJson) textoJson = Buffer.concat([textoJson, Buffer.alloc(sobraJson, 0x20)]);
  const sobraBin = (4 - (novoBin.length % 4)) % 4;
  const binFinal = sobraBin ? Buffer.concat([novoBin, Buffer.alloc(sobraBin)]) : novoBin;

  const cabecalho = Buffer.alloc(12);
  cabecalho.write('glTF', 0); cabecalho.writeUInt32LE(2, 4);
  cabecalho.writeUInt32LE(12 + 8 + textoJson.length + 8 + binFinal.length, 8);
  const cabJson = Buffer.alloc(8);
  cabJson.writeUInt32LE(textoJson.length, 0); cabJson.write('JSON', 4);
  const cabBin = Buffer.alloc(8);
  cabBin.writeUInt32LE(binFinal.length, 0); cabBin.write('BIN\0', 4);
  writeFileSync(saida, Buffer.concat([cabecalho, cabJson, textoJson, cabBin, binFinal]));
  return relatorio;
}

const [entrada, saida] = process.argv.slice(2);
if (!entrada || !saida) {
  console.error('uso: node tools/asset-gen/limpar_glb.mjs <entrada.glb> <saida.glb> [--limiar 0.02]');
  process.exit(2);
}
const argLimiar = process.argv.indexOf('--limiar');
const limiar = argLimiar > 0 ? Number(process.argv[argLimiar + 1]) : LIMIAR_PADRAO;

const relatorio = limpar(entrada, saida, limiar);
console.log(`limiar ${(limiar * 100).toFixed(1)}% do maior pedaço de cada malha\n`);
let fora = 0, triAntes = 0, triDepois = 0;
for (const r of relatorio) {
  fora += r.descartados; triAntes += r.trianglesAntes; triDepois += r.trianglesDepois;
  console.log(`${String(r.malha).padEnd(14)} ${String(r.pedacos).padStart(3)} pedaços · descartou ${String(r.descartados).padStart(3)}` +
    ` · ${r.trianglesAntes.toLocaleString('pt-BR')} → ${r.trianglesDepois.toLocaleString('pt-BR')} tri`);
}
const antes = readFileSync(entrada).length, depois = readFileSync(saida).length;
console.log(`\n${fora} fragmentos removidos · ${triAntes.toLocaleString('pt-BR')} → ${triDepois.toLocaleString('pt-BR')} triângulos` +
  ` · ${(antes / 1048576).toFixed(1)} → ${(depois / 1048576).toFixed(1)} MB`);
