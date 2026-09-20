#!/usr/bin/env node
/**
 * cli.mjs - Imagem de referencia -> GLB pronto para o Babylon.
 *
 * A geracao roda no daemon Python (unica parte que precisa de torch/CUDA);
 * todo o resto - decimacao, orcamento de textura, empacotamento - e JS.
 *
 * Uso:
 *   node tools/asset-gen/cli.mjs --ref "art/concept/celeiro.png" \
 *        --out public/assets/props/barn.glb --kind prop
 *
 * Flags:
 *   --ref <img>     imagem de referencia (fundo limpo, objeto centralizado)
 *   --out <glb>     destino final
 *   --kind <k>      player|enemy|tile|prop  (define orcamento; default prop)
 *   --tris <n>      sobrescreve o alvo de triangulos do orcamento
 *   --tex <n>       sobrescreve o lado maximo da textura
 *   --steps <n>     passos de difusao (default 30; mais = mais detalhe, mais lento)
 *   --octree <n>    resolucao da extracao de malha (default 256)
 *   --seed <n>      semente (default 42) - troque para variar a forma
 *   --port <n>      porta do daemon (default 8731)
 *   --texture       gera textura PBR (bem mais lento; exige CUDA Toolkit)
 *   --keep-raw      guarda tambem o GLB cru do modelo, para inspecao
 *
 * Correcao de exposicao (o modelo assa iluminacao na textura):
 *   --lum <n>       luminancia media alvo da base color. Meça a do seu cenario.
 *   --lift <n>      levanta o ponto de preto; tira o peso das sombras assadas
 *   --sat <n>       saturacao (1 = neutro); devolve a cor que clarear lavou
 *
 * Qualidade x tempo:
 *   --octree 512 gera ~4x mais geometria bruta que 256, por ~2,6x o tempo, e o
 *   ganho SOBREVIVE a decimacao. Custo e cubico: cada dobra multiplica por 8 os
 *   voxels. 384 e o meio-termo. --steps nao ajuda: o modelo turbo e destilado.
 *
 * Modos:
 *   draft (default) - so geometria, ~26s. E o que voce roda 20x ajustando a ref.
 *   --texture       - geometria + PBR, minutos. Roda uma vez, no keeper.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import http from 'node:http';
import { processGlb, BUDGET } from './pipeline.mjs';

/**
 * Requisicao HTTP sem timeout.
 *
 * Nao use fetch() aqui: o undici do Node aborta com UND_ERR_HEADERS_TIMEOUT
 * apos 5 min esperando o cabecalho, e a primeira pintura baixa ~10 GB de pesos
 * antes de responder qualquer coisa.
 */
function request(url, { method = 'GET', body } = {}) {
  // Content-Length e OBRIGATORIO: sem ele o Node usa chunked encoding, e o
  // BaseHTTPRequestHandler do Python nao decodifica chunked - le corpo vazio.
  const payload = body ? Buffer.from(body) : null;
  return new Promise((resolve, reject) => {
    const req = http.request(url, {
      method,
      headers: payload
        ? {
            'Content-Type': 'application/json',
            'Content-Length': payload.length,
          }
        : {},
      timeout: 0,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        ok: res.statusCode >= 200 && res.statusCode < 300,
        buffer: Buffer.concat(chunks),
      }));
    });
    req.setTimeout(0);
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function parseArgs(argv) {
  const args = { kind: 'prop', steps: 30, octree: 256, seed: 42, port: 8731 };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (!key.startsWith('--')) continue;
    const name = key.slice(2);
    if (name === 'keep-raw') { args.keepRaw = true; continue; }
    if (name === 'texture') { args.texture = true; continue; }
    args[name] = argv[++i];
  }
  return args;
}

const NUMERIC = ['tris', 'tex', 'steps', 'octree', 'seed', 'port', 'lum', 'lift', 'sat', 'normais'];

async function main() {
  const args = parseArgs(process.argv.slice(2));
  for (const k of NUMERIC) if (args[k] !== undefined) args[k] = Number(args[k]);

  if (!args.ref || !args.out) {
    console.error('uso: --ref <imagem> --out <arquivo.glb> [--kind prop] [--tris N]');
    process.exit(2);
  }

  const budget = BUDGET[args.kind];
  if (!budget) {
    console.error(`--kind invalido: ${args.kind}. use ${Object.keys(BUDGET).join('|')}`);
    process.exit(2);
  }
  const targetTris = args.tris ?? budget.tris;
  const texSize = args.tex ?? budget.tex;

  const base = `http://127.0.0.1:${args.port}`;

  // 1. daemon vivo?
  let health;
  try {
    health = JSON.parse((await request(`${base}/health`)).buffer.toString());
  } catch {
    console.error(
      `daemon nao respondeu em ${base}\n` +
      `inicie com:\n` +
      `  tools/asset-gen/.venv/Scripts/python.exe tools/asset-gen/daemon.py --port ${args.port}`,
    );
    process.exit(1);
  }
  console.log(`daemon  : ${health.model} em ${health.device}`);

  // 2. geracao (Python)
  const image = await readFile(args.ref);
  console.log(`ref     : ${basename(args.ref)} (${(image.length / 1024).toFixed(0)} KB)`);
  console.log(
    `gerando : steps=${args.steps} octree=${args.octree} seed=${args.seed} ` +
    `alvo=${targetTris} textura=${args.texture ? 'sim' : 'nao'} ...`,
  );

  const t0 = Date.now();
  const res = await request(`${base}/generate`, {
    method: 'POST',
    body: JSON.stringify({
      image: image.toString('base64'),
      steps: args.steps,
      octree: args.octree,
      seed: args.seed,
      texture: Boolean(args.texture),
      // A decimacao acontece no daemon, antes da pintura - o unwrap de UV
      // precisa rodar sobre a malha final.
      target_faces: targetTris,
      // Nome da peca, so para o painel poder mostrar o que esta gerando.
      label: basename(args.out).replace(/\.glb$/, ''),
    }),
  });
  if (!res.ok) {
    console.error('falha na geracao:', res.buffer.toString());
    process.exit(1);
  }
  const raw = res.buffer;
  const tGen = (Date.now() - t0) / 1000;
  console.log(`gerado  : ${(raw.length / 1048576).toFixed(1)} MB cru em ${tGen.toFixed(1)}s`);

  // 3. GLB cru em disco - o pipeline le de arquivo.
  // Fica em art/raw/, NUNCA em public/: o bundler serve public/ inteiro e o cru
  // tem varios MB, que iriam parar no build.
  //
  // Escrevemos primeiro num temporario com o pid no nome. Duas geracoes
  // concorrentes com o mesmo --out colidiam neste arquivo e uma sobrescrevia a
  // outra no meio do pos-processamento.
  const rawFinal = join('art', 'raw', basename(args.out));
  const rawTmp = `${rawFinal}.${process.pid}.tmp`;
  await mkdir(dirname(rawFinal), { recursive: true });
  await mkdir(dirname(args.out), { recursive: true });
  await writeFile(rawTmp, raw);

  // 4. pos-processamento (JS)
  const t1 = Date.now();
  const stats = await processGlb({
    input: rawTmp,
    output: args.out,
    // Se veio texturizado, o daemon ja decimou e desembrulhou o UV. Decimar de
    // novo aqui colapsaria costuras e estragaria a textura.
    targetTris: args.texture ? 0 : targetTris,
    texSize,
    // Correcao de exposicao. Sem --lum nada disso roda.
    alvoLum: args.lum ?? 0,
    liftSombra: args.lift ?? 0,
    saturacao: args.sat ?? 1,
    // Angulo de dobra das normais. Sem NORMAL o renderizador usa o normal da
    // face (flat), o que faceta superficie curva - ver normais.mjs.
    normaisAngulo: args.normais ?? 0,
  });
  const tPost = (Date.now() - t1) / 1000;

  // Só agora o temporário vira o nome estável, para reprocessar depois com
  // outro orçamento sem gerar de novo.
  const fs = await import('node:fs/promises');
  if (args.keepRaw) await fs.rename(rawTmp, rawFinal);
  else await fs.unlink(rawTmp);

  console.log('---');
  console.log(`antes   : ${stats.before.tris} tris, ${(stats.before.bytes / 1048576).toFixed(2)} MB`);
  console.log(`depois  : ${stats.after.tris} tris, ${(stats.after.bytes / 1048576).toFixed(2)} MB`);
  console.log(`tempos  : geracao ${tGen.toFixed(1)}s + pos ${tPost.toFixed(1)}s = ${(tGen + tPost).toFixed(1)}s`);
  console.log(`saida   : ${args.out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
