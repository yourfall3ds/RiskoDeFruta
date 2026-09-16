/**
 * QA de arranque da navegação do planeta.
 *
 * Responde três perguntas que só se respondem medindo:
 *   1. Os 38 `.bin` existem, são binário válido e o Detour os aceita?
 *   2. Quanto custa `createIslands` com os assados reais — CPU e memória?
 *   3. Quanto custaria o caminho de ASSAR em runtime, que é o que acontece se as URLs derem 404?
 *
 * Uso: npx tsx scripts/benchmark-island-navigation.mjs [--bake=N]
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {init, importNavMesh} from '@recast-navigation/core';
import {TacticalNavigation} from '../src/ai/TacticalNavigation.ts';
import {IslandChartSet} from '../src/ai/IslandChart.ts';

const MANIFEST = 'public/models/planet-archipelago.json.gz';
const BAKED = 'public/models/island-navmesh';
const argument = (name, fallback) => {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const mb = bytes => (bytes / 1024 / 1024).toFixed(1);
const heap = () => process.memoryUsage().heapUsed;
const rss = () => process.memoryUsage().rss;

console.log('=== 1. Integridade dos assados ===');
const files = fs.existsSync(BAKED) ? fs.readdirSync(BAKED).filter(f => f.endsWith('.bin')) : [];
console.log(`${files.length} arquivos em ${BAKED}`);
if (!files.length) throw Error('Nenhum .bin assado — rode scripts/bake-island-navmeshes.mjs');

await init();
let total = 0, smallest = Infinity, largest = 0, accepted = 0;
const started = Date.now();
for (const file of files) {
  const bytes = fs.readFileSync(path.join(BAKED, file));
  total += bytes.length;
  smallest = Math.min(smallest, bytes.length);
  largest = Math.max(largest, bytes.length);
  if (bytes.length < 16) {console.log(`  ${file} SUSPEITO: ${bytes.length} bytes`); continue;}
  // Um .bin truncado ou servido como HTML de erro passa no `fs.readFileSync` e só explode aqui.
  let mesh;
  try {mesh = importNavMesh(new Uint8Array(bytes)).navMesh;}
  catch (error) {console.log(`  ${file} REJEITADO pelo Detour: ${error.message}`); continue;}
  const tiles = mesh.getMaxTiles();
  let polygons = 0;
  for (let i = 0; i < tiles; i++) {
    const header = mesh.getTile(i).header();
    if (header) polygons += header.polyCount();
  }
  if (!polygons) {console.log(`  ${file} VAZIO: nenhum polígono`); continue;}
  accepted++;
  mesh.destroy();
}
console.log(`aceitos pelo Detour: ${accepted}/${files.length} · total ${mb(total)} MB · menor ${(smallest / 1024).toFixed(0)} KiB · maior ${(largest / 1024).toFixed(0)} KiB · ${Date.now() - started} ms`);
if (accepted !== files.length) throw Error('Há .bin inválidos — o cliente cairia no bake de runtime por causa disto');

console.log('\n=== 2. createIslands com os 38 assados (o caminho do jogo) ===');
const manifest = JSON.parse(zlib.gunzipSync(fs.readFileSync(MANIFEST)).toString());
const base = {
  centre: manifest.centre ?? {x: 0, y: 0, z: 0}, radius: manifest.radius,
  islands: manifest.islands, bridges: manifest.bridges,
};
const readBaked = async id => {
  const file = path.join(BAKED, `${id}.bin`);
  return fs.existsSync(file) ? new Uint8Array(fs.readFileSync(file)) : undefined;
};

globalThis.gc?.();
const beforeHeap = heap(), beforeRss = rss(), bootStart = process.hrtime.bigint();
const nav = await TacticalNavigation.createIslands({
  ...base, positions: manifest.positions, indices: manifest.indices, baked: readBaked,
});
const bootMs = Number(process.hrtime.bigint() - bootStart) / 1e6;
console.log(`boot ${bootMs.toFixed(0)} ms · cartas prontas ${nav.readyCharts.length}/${manifest.islands.length}`);
console.log(`heap +${mb(heap() - beforeHeap)} MB · rss +${mb(rss() - beforeRss)} MB`);

const stepStart = process.hrtime.bigint();
const player = nav.closest(manifest.islands[0].centre) ?? manifest.islands[0].centre;
for (let i = 0; i < 600; i++) nav.step(1 / 60, player);
const stepMs = Number(process.hrtime.bigint() - stepStart) / 1e6;
console.log(`step() ocioso: ${(stepMs / 600).toFixed(3)} ms/quadro em 600 quadros (38 cartas carregadas, 0 agentes)`);
nav.dispose();

console.log('\n=== 2b. Degradação: TODAS as URLs em 404 ===');
const degradedStart = process.hrtime.bigint();
let degradedMs = 0, degradedMessage = '';
try {
  const broken = await TacticalNavigation.createIslands({
    ...base, positions: manifest.positions, indices: manifest.indices, baked: async () => undefined,
  });
  degradedMs = Number(process.hrtime.bigint() - degradedStart) / 1e6;
  console.log(`  NÃO recusou (${broken.readyCharts.length} cartas) — verifique a guarda`);
  broken.dispose();
} catch (error) {
  degradedMs = Number(process.hrtime.bigint() - degradedStart) / 1e6;
  degradedMessage = String(error.message ?? error);
  console.log(`  recusou em ${degradedMs.toFixed(0)} ms (sem assar nada) · "${degradedMessage.slice(0, 90)}…"`);
}

console.log('\n=== 3. O custo do caminho de RUNTIME (o que acontece se as URLs derem 404) ===');
const charts = new IslandChartSet(base);
const count = Number(argument('bake', '3'));
let sliceMs = 0, bakeMs = 0;
for (const chart of charts.charts.slice(0, count)) {
  const t0 = process.hrtime.bigint();
  const slice = charts.slice(chart, manifest.positions, manifest.indices);
  const t1 = process.hrtime.bigint();
  sliceMs += Number(t1 - t0) / 1e6;
  const single = await TacticalNavigation.createIslands({
    ...base, positions: manifest.positions, indices: manifest.indices, origin: chart.centre,
  });
  const t2 = process.hrtime.bigint();
  bakeMs += Number(t2 - t1) / 1e6;
  console.log(`  ${chart.id.padEnd(14)} recorte ${(Number(t1 - t0) / 1e6).toFixed(0).padStart(5)} ms · ${slice.triangles} tri · carta inteira ${(Number(t2 - t1) / 1e6).toFixed(0).padStart(5)} ms`);
  single.dispose();
}
const perChart = (sliceMs + bakeMs) / count;
console.log(`média por carta: ${perChart.toFixed(0)} ms`);
console.log(`EXTRAPOLAÇÃO 38 cartas assadas em runtime: ~${(perChart * 38 / 1000).toFixed(1)} s de thread principal BLOQUEADA`);
