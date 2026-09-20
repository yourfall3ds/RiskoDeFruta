/**
 * pipeline.mjs - Pos-processamento JS de malhas geradas por IA.
 *
 * Problema que resolve:
 *   Hunyuan3D/TRELLIS cospem "triangle soup" densa (200-500k tris), sem UV util
 *   e sem orcamento de textura. Isso nao entra num jogo. Aqui a malha crua vira
 *   um GLB com contagem de tris controlada, texturas dentro do orcamento e
 *   normais coerentes - tudo em JS, sem Blender no caminho.
 *
 * Nota sobre topologia:
 *   Nao geramos quads. Quad importa para edicao manual e subdivisao; o Babylon
 *   triangula tudo no load de qualquer jeito. O que importa para asset de jogo e
 *   tri count baixo + UV limpa + normais boas, e e isso que meshoptimizer entrega.
 */

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import {
  dedup,
  prune,
  weld,
  simplify,
  textureCompress,
  flatten,
  join,
} from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { gerarNormaisPorAngulo } from './normais.mjs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

// ---------------------------------------------------------------------------
// TUNING_REQUIRED - orcamento por classe de asset.
// Espelha BUDGET de tools/blender/optimize_assets.py para os dois pipelines
// nao divergirem.
// ---------------------------------------------------------------------------
export const BUDGET = {
  player: { tex: 2048, tris: 0 },     // heroi: sempre na tela
  enemy: { tex: 1024, tris: 20000 },  // dezenas simultaneos
  tile: { tex: 1024, tris: 0 },       // geometria ja e barata
  prop: { tex: 1024, tris: 15000 },   // gerado por IA vem absurdamente denso
};

async function makeIO() {
  await MeshoptDecoder.ready;
  await MeshoptEncoder.ready;
  return new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({
      'meshopt.decoder': MeshoptDecoder,
      'meshopt.encoder': MeshoptEncoder,
    });
}

/** Conta triangulos somando todas as primitivas do documento. */
export function countTris(document) {
  let tris = 0;
  for (const mesh of document.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const indices = prim.getIndices();
      const count = indices
        ? indices.getCount()
        : (prim.getAttribute('POSITION')?.getCount() ?? 0);
      tris += count / 3;
    }
  }
  return Math.round(tris);
}

/**
 * Clareia as texturas de base color ate uma luminancia media alvo.
 *
 * Por que e necessario: o Hunyuan3D-Paint assa iluminacao na textura. O modelo
 * de delight reduz, nao elimina, e concept art com luz dramatica sai bem mais
 * escura que o cenario onde o asset vai viver. Medindo os tiles do jogo dá o
 * alvo; medindo o prop dá o quanto falta.
 *
 * Por que gama e nao ganho linear: a escuridao esta concentrada nas sombras e
 * meios-tons. Multiplicar tudo estoura os realces (metal, reflexos) antes de
 * resolver as sombras. Gama levanta a parte de baixo da curva e quase nao mexe
 * no topo.
 *
 * A cor propria de cada peca e preservada - o ajuste e por luminancia, nao por
 * tintura. Um celeiro vermelho continua vermelho, so deixa de estar na penumbra.
 */
async function gradeBaseColor(document, alvoLum, liftSombra = 0, saturacao = 1) {
  const vistas = new Set();
  const relato = [];

  for (const material of document.getRoot().listMaterials()) {
    const textura = material.getBaseColorTexture();
    if (!textura || vistas.has(textura)) continue;
    vistas.add(textura);

    const original = Buffer.from(textura.getImage());
    const { channels } = await sharp(original).stats();
    const [r, g, b] = channels.slice(0, 3).map((c) => c.mean);
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (lum <= 0 || lum >= alvoLum) continue;

    // Queremos saida = entrada^(1/gama) tal que a media atual caia no alvo.
    const gama = Math.log(lum / 255) / Math.log(alvoLum / 255);
    const seguro = Math.min(3, Math.max(1, gama));

    // NAO use sharp.gamma(): ele e definido como correcao EM TORNO de um
    // resize - escurece antes, clareia depois - e sem resize no meio as duas
    // metades se cancelam, sem efeito nenhum. Aplicamos a curva nos pixels.
    //
    // liftSombra levanta o ponto de preto. Gama sozinha corrige a MEDIA, mas
    // as sombras que o modelo assou na textura ficam esmagadas perto do zero e
    // continuam lendo como sujeira preta. Comprimir a faixa para [lift..255]
    // tira esse peso - custa contraste, que e o que se quer perder aqui.
    const lut = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      const curva = Math.pow(i / 255, 1 / seguro);
      lut[i] = Math.round(liftSombra + (255 - liftSombra) * curva);
    }

    const { data, info } = await sharp(original)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    for (let i = 0; i < data.length; i += info.channels) {
      data[i] = lut[data[i]];
      data[i + 1] = lut[data[i + 1]];
      data[i + 2] = lut[data[i + 2]];
    }

    let img = sharp(data, { raw: info });
    // Clarear lava a cor; a saturacao devolve o que a curva tirou.
    if (saturacao !== 1) img = img.modulate({ saturation: saturacao });
    const ajustada = await img.png().toBuffer();
    textura.setImage(ajustada).setMimeType('image/png');
    relato.push({ de: Math.round(lum), para: alvoLum, gama: +seguro.toFixed(3) });
  }
  return relato;
}

/** Lista as texturas e suas resolucoes, para o manifest. */
function describeTextures(document) {
  return document.getRoot().listTextures().map((t) => {
    const size = t.getSize();
    return [t.getName() || 'texture', size ? `${size[0]}x${size[1]}` : '?'];
  });
}

/**
 * Processa um GLB cru e escreve o otimizado.
 *
 * @param {object} opts
 * @param {string} opts.input      caminho do GLB cru
 * @param {string} opts.output     caminho do GLB final
 * @param {number} opts.targetTris 0 = nao decimar
 * @param {number} opts.texSize    lado maximo da textura
 * @returns {Promise<object>} estatisticas antes/depois
 */
export async function processGlb({
  input,
  output,
  targetTris = 0,
  texSize = 1024,
  // Luminancia media alvo da base color. 0 desliga. 73 e a media medida dos
  // tiles de "Risco de Fruta" - meça os seus antes de reaproveitar o numero.
  alvoLum = 0,
  liftSombra = 0,
  saturacao = 1,
  // Angulo de dobra para gerar NORMAL. 0 desliga (deixa o renderizador usar o
  // normal da face, que e flat e faceta superficie curva).
  normaisAngulo = 0,
  // OBRIGATORIO para asset com esqueleto/animacao.
  //
  // flatten() achata a hierarquia de nos e join() funde malhas - os dois
  // destroem o rig, e o glTF resultante continua VALIDO: carrega sem erro e
  // simplesmente nao anima mais. Neste modo so a textura e tocada.
  apenasTextura = false,
}) {
  const io = await makeIO();
  const document = await io.read(input);

  const before = {
    tris: countTris(document),
    textures: describeTextures(document),
    bytes: (await readFile(input)).length,
  };

  // Guarda: asset animado nao pode passar pelas transformacoes de geometria.
  const temRig =
    document.getRoot().listSkins().length > 0 ||
    document.getRoot().listAnimations().length > 0;
  const soTextura = apenasTextura || temRig;
  if (temRig && !apenasTextura) {
    console.warn(
      '[pipeline] esqueleto/animacao detectados: pulando transformacoes de ' +
      'geometria para nao quebrar o rig (so a textura sera otimizada).',
    );
  }

  // Ordem importa: achatar hierarquia e juntar primitivas antes de soldar,
  // senao a simplificacao trabalha em pedacos isolados e abre buracos nas
  // fronteiras entre eles.
  if (!soTextura) {
    await document.transform(
      dedup(),
      flatten(),
      join(),
      weld(),
    );
  }

  // meshoptimizer trabalha com razao, e para de decimar quando o erro geometrico
  // estoura o limite - entao uma passada so nao honra o alvo. Escalonamos a
  // tolerancia ate bater o alvo, mantendo o menor erro que resolve.
  if (targetTris > 0 && !soTextura) {
    await MeshoptSimplifier.ready;
    for (const error of [0.005, 0.02, 0.05, 0.1, 0.25, 0.5]) {
      const current = countTris(document);
      if (current <= targetTris) break;
      await document.transform(
        simplify({
          simplifier: MeshoptSimplifier,
          ratio: targetTris / current,
          error,
          lockBorder: false,
        }),
      );
    }
  }

  // Correcao de exposicao ANTES de reamostrar e comprimir: trabalhar no PNG
  // original evita reencodar WebP duas vezes.
  let grade = [];
  if (alvoLum > 0) grade = await gradeBaseColor(document, alvoLum, liftSombra, saturacao);

  // Texturas: reamostra para o orcamento e converte para WebP.
  if (document.getRoot().listTextures().length > 0) {
    await document.transform(
      textureCompress({
        encoder: sharp,
        targetFormat: 'webp',
        resize: [texSize, texSize],
        resizeFilter: 'lanczos3',
      }),
    );
  }

  // Depois de decimar e comprimir: as normais precisam refletir a malha FINAL.
  // Gerar antes da decimacao seria descrever uma geometria que nao existe mais.
  let normais = null;
  if (normaisAngulo > 0 && !soTextura) {
    normais = gerarNormaisPorAngulo(document, normaisAngulo);
  }

  await document.transform(prune());

  await mkdir(dirname(output), { recursive: true });
  const glb = await io.writeBinary(document);
  await writeFile(output, glb);

  return {
    before,
    grade,
    normais,
    after: {
      tris: countTris(document),
      textures: describeTextures(document),
      bytes: glb.length,
    },
  };
}
