#!/usr/bin/env node
/**
 * Decima um GLB gerado até o orçamento de triângulos do jogo — PRESERVANDO as partes.
 *
 * A saída do PartCrafter chega com ~1,2 milhão de triângulos. O orçamento deste projeto é de
 * ~15 mil por prop, e a arma inteira do jogador tem menos de 45 mil. Sem esta etapa nada do que o
 * gerador produz entra em cena; com ela, entra.
 *
 * **Por que não reaproveitar `pipeline.mjs`:** aquele roda `join()`, que funde todas as primitivas
 * numa só. Para um asset de peça única é o certo (menos chamadas de desenho); para a saída do
 * PartCrafter destruiria justamente o que ele tem de melhor — a separação em partes, que é o que
 * dá tampa articulável e fragmento de destruição. Aqui cada malha é decimada SOZINHA, com orçamento
 * proporcional ao tamanho dela, e a contagem de partes é conferida no fim.
 *
 * Duas ordens que não são negociáveis, e ambas custaram caro a quem escreveu o pipeline original:
 *
 * 1. **Soldar antes de simplificar.** Vértices duplicados nas costuras fazem o simplificador tratar
 *    cada pedaço como ilha isolada — ele não colapsa através da fronteira e abre buracos nela.
 * 2. **Normais depois de decimar.** Gerar antes seria descrever uma geometria que a decimação já
 *    destruiu; o resultado é sombreamento sujo numa malha correta.
 *
 * Uso:
 *   node tools/asset-gen/decimar_glb.mjs entrada.glb saida.glb --tris 15000 [--angulo 40]
 */
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {dedup, weld, simplify, prune} from '@gltf-transform/functions';
import {MeshoptSimplifier} from 'meshoptimizer';

/** Orçamento padrão: o mesmo de um prop deste projeto. */
const TRIS_PADRAO = 15000;
/**
 * Escada de tolerância de erro geométrico.
 *
 * O meshoptimizer trabalha por RAZÃO e desiste quando o erro estoura o limite, então uma passada só
 * não honra o alvo: uma malha travada a 0,005 simplesmente para. Subir a tolerância aos poucos
 * mantém o MENOR erro que resolve, em vez de partir logo do mais destrutivo.
 */
const ESCADA = [0.005, 0.02, 0.05, 0.1, 0.25, 0.5, 0.8];

const argumento = (nome, padrao) => {
  const i = process.argv.indexOf('--' + nome);
  return i > 0 ? Number(process.argv[i + 1]) : padrao;
};

function contarTris(documento) {
  let total = 0;
  for (const malha of documento.getRoot().listMeshes())
    for (const primitiva of malha.listPrimitives()) {
      const indices = primitiva.getIndices();
      total += indices ? indices.getCount() / 3 : primitiva.getAttribute('POSITION').getCount() / 3;
    }
  return total;
}

function contarPorMalha(documento) {
  return documento.getRoot().listMeshes().map(malha => ({
    nome: malha.getName() || '(sem nome)',
    tris: malha.listPrimitives().reduce((soma, p) => {
      const i = p.getIndices();
      return soma + (i ? i.getCount() / 3 : p.getAttribute('POSITION').getCount() / 3);
    }, 0),
  }));
}

/**
 * Normais por vértice, ponderadas por área, sobre a malha FINAL.
 *
 * O produto vetorial não normalizado já tem comprimento proporcional ao dobro da área do triângulo,
 * então somá-lo cru pondera cada face pelo tamanho dela — superfície lisa sem peso explícito.
 */
function gerarNormais(documento) {
  for (const malha of documento.getRoot().listMeshes())
    for (const primitiva of malha.listPrimitives()) {
      const posicao = primitiva.getAttribute('POSITION');
      const indices = primitiva.getIndices();
      if (!posicao || !indices) continue;
      const total = posicao.getCount();
      const acumulado = new Float64Array(total * 3);
      const a = [0, 0, 0], b = [0, 0, 0], c = [0, 0, 0];
      for (let i = 0; i < indices.getCount(); i += 3) {
        const ia = indices.getScalar(i), ib = indices.getScalar(i + 1), ic = indices.getScalar(i + 2);
        posicao.getElement(ia, a); posicao.getElement(ib, b); posicao.getElement(ic, c);
        const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
        const acx = c[0] - a[0], acy = c[1] - a[1], acz = c[2] - a[2];
        const nx = aby * acz - abz * acy, ny = abz * acx - abx * acz, nz = abx * acy - aby * acx;
        for (const v of [ia, ib, ic]) {
          acumulado[v * 3] += nx; acumulado[v * 3 + 1] += ny; acumulado[v * 3 + 2] += nz;
        }
      }
      const plano = new Float32Array(total * 3);
      for (let v = 0; v < total; v++) {
        const x = acumulado[v * 3], y = acumulado[v * 3 + 1], z = acumulado[v * 3 + 2];
        const comprimento = Math.hypot(x, y, z);
        // Vértice sem triângulo recebe uma normal válida qualquer; zero quebraria o shader.
        if (comprimento < 1e-12) {plano[v * 3 + 1] = 1; continue;}
        plano[v * 3] = x / comprimento; plano[v * 3 + 1] = y / comprimento; plano[v * 3 + 2] = z / comprimento;
      }
      const existente = primitiva.getAttribute('NORMAL');
      if (existente) existente.setArray(plano).setType('VEC3');
      else {
        const acessor = documento.createAccessor().setType('VEC3').setArray(plano);
        primitiva.setAttribute('NORMAL', acessor);
      }
    }
}

const [entrada, saida] = process.argv.slice(2);
if (!entrada || !saida) {
  console.error('uso: node tools/asset-gen/decimar_glb.mjs <entrada.glb> <saida.glb> [--tris 15000]');
  process.exit(2);
}
const alvo = argumento('tris', TRIS_PADRAO);

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const documento = await io.read(entrada);

const antesPorMalha = contarPorMalha(documento);
const partesAntes = documento.getRoot().listMeshes().length;
const trisAntes = contarTris(documento);

if (documento.getRoot().listSkins().length > 0 || documento.getRoot().listAnimations().length > 0) {
  console.error('recusado: este GLB tem esqueleto ou animação, e decimar quebraria o rig.');
  process.exit(1);
}

// `dedup` e `weld` SEM `join`: soldar é obrigatório para o simplificador atravessar as costuras,
// juntar fundiria as partes e é exatamente o que não pode acontecer aqui.
await documento.transform(dedup(), weld());

await MeshoptSimplifier.ready;
for (const erro of ESCADA) {
  const atual = contarTris(documento);
  if (atual <= alvo) break;
  await documento.transform(simplify({
    simplifier: MeshoptSimplifier,
    ratio: alvo / atual,
    error: erro,
    // `lockBorder` preso manteria a borda de cada parte intacta e impediria o alvo de ser
    // alcançado numa malha que é quase toda borda.
    lockBorder: false,
  }));
}

gerarNormais(documento);
await documento.transform(prune());
await io.write(saida, documento);

const depoisPorMalha = contarPorMalha(documento);
const partesDepois = documento.getRoot().listMeshes().length;
const trisDepois = contarTris(documento);

console.log(`alvo ${alvo.toLocaleString('pt-BR')} triângulos\n`);
for (let i = 0; i < antesPorMalha.length; i++) {
  const antes = antesPorMalha[i], depois = depoisPorMalha[i];
  console.log(`${antes.nome.padEnd(14)} ${antes.tris.toLocaleString('pt-BR').padStart(9)} → ${(depois?.tris ?? 0).toLocaleString('pt-BR').padStart(7)} tri`);
}
const {size: bytesAntes} = await import('node:fs').then(m => m.promises.stat(entrada));
const {size: bytesDepois} = await import('node:fs').then(m => m.promises.stat(saida));
console.log(`\n${trisAntes.toLocaleString('pt-BR')} → ${trisDepois.toLocaleString('pt-BR')} triângulos` +
  ` · ${(bytesAntes / 1048576).toFixed(1)} → ${(bytesDepois / 1048576).toFixed(2)} MB`);
console.log(partesDepois === partesAntes
  ? `partes preservadas: ${partesDepois}`
  : `ATENÇÃO: partes ${partesAntes} → ${partesDepois} — a separação foi perdida`);
