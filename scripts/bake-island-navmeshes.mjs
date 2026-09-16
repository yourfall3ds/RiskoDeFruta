/**
 * Assa uma navmesh Recast por ILHA do arquipélago esférico, em coordenadas de CARTA RÍGIDA.
 *
 * Por que não uma navmesh só: o Recast voxeliza em `+Y` absoluto. Num globo inteiro só a calota
 * norte passaria no `walkableSlopeAngle`. A carta de cada ilha é uma rotação rígida que leva a
 * vertical DELA em `+Y` — exata, não é projeção — e a inclinação que o Recast vê a arco `s` é
 * `s / R`. No manifesto real (R = 180) o pior caso, já com margem, é 38°, contra o limite de 49°.
 *
 * Saída: `public/models/island-navmesh/<id>.bin` + `docs/island-navmeshes.json` com o relatório.
 * Sem estes arquivos o jogo AINDA funciona — `TacticalNavigation.createIslands` assa a carta em
 * runtime na primeira vez que a ilha é usada. Com eles, a troca de ilha não engasga.
 *
 * Uso:
 *   node --max-old-space-size=8192 scripts/bake-island-navmeshes.mjs [--only=north,front] [--limit=N]
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {init, exportNavMesh, NavMeshQuery} from '@recast-navigation/core';
import {generateTiledNavMesh} from '@recast-navigation/generators';
import {IslandChartSet} from '../src/ai/IslandChart.ts';

const MANIFEST_GZ = 'public/models/planet-archipelago.json.gz';
const MANIFEST_JSON = 'public/models/planet-archipelago.json';
const OUTPUT_DIR = 'public/models/island-navmesh';

/** Os MESMOS números do navmesh da fazenda: a tática dos agentes não pode divergir entre mundos. */
const RECAST_TUNING = {
  tileSize: 128, cs: .2, ch: .1, walkableSlopeAngle: 49, walkableHeight: 18,
  walkableClimb: 6, walkableRadius: 3, minRegionArea: 8, mergeRegionArea: 20,
  maxSimplificationError: 1.1, detailSampleDist: 6, detailSampleMaxError: 1,
};

const argument = (name, fallback) => {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

function loadManifest() {
  if (fs.existsSync(MANIFEST_GZ)) return JSON.parse(zlib.gunzipSync(fs.readFileSync(MANIFEST_GZ)));
  if (fs.existsSync(MANIFEST_JSON)) return JSON.parse(fs.readFileSync(MANIFEST_JSON));
  throw Error(`O mapa do planeta ainda não foi gerado (${MANIFEST_GZ} não existe)`);
}

function alignedBounds(positions) {
  const low = [Infinity, Infinity, Infinity], high = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i++) {
    const axis = i % 3;
    low[axis] = Math.min(low[axis], positions[i]); high[axis] = Math.max(high[axis], positions[i]);
  }
  for (let axis = 0; axis < 3; axis++) {
    const cell = axis === 1 ? .1 : 25.6;
    low[axis] = Math.floor((low[axis] - 2) / cell) * cell;
    high[axis] = Math.ceil((high[axis] + 2) / cell) * cell;
  }
  return {low, high};
}

const manifest = loadManifest();
const source = {
  centre: manifest.centre ?? {x: 0, y: 0, z: 0},
  radius: manifest.radius,
  islands: manifest.islands,
  bridges: manifest.bridges,
};
const charts = new IslandChartSet(source);

const over = charts.overSloped;
if (over.length) throw Error('Carta acima do limite do Recast: ' + over.map(c => `${c.id} ${c.edgeSlopeDegrees.toFixed(1)}°`).join(', '));

console.log(`PLANETA R=${manifest.radius} · ${manifest.islands.length} ilhas · ${manifest.bridges.length} pontes · ${manifest.indices.length / 3} triângulos`);
console.log(`CARTA pior inclinação de borda ${Math.max(...charts.charts.map(c => c.edgeSlopeDegrees)).toFixed(1)}° (limite ${RECAST_TUNING.walkableSlopeAngle}°)`);

const only = argument('only', '');
const wanted = only ? new Set(only.split(',').map(s => s.trim()).filter(Boolean)) : undefined;
const limit = Number(argument('limit', String(charts.charts.length)));

await init();
fs.mkdirSync(OUTPUT_DIR, {recursive: true});

const report = [];
let baked = 0;
for (const chart of charts.charts) {
  if (wanted && !wanted.has(chart.id)) continue;
  if (baked >= limit) break;
  const started = Date.now();
  const slice = charts.slice(chart, manifest.positions, manifest.indices);
  if (!slice.triangles) {
    report.push({id: chart.id, ok: false, reason: 'recorte vazio'});
    console.log(`  ${chart.id.padEnd(14)} SEM TRIÂNGULOS`);
    continue;
  }
  const {low, high} = alignedBounds(slice.positions);
  const result = generateTiledNavMesh(slice.positions, slice.indices, {...RECAST_TUNING, bounds: [low, high]});
  if (!result.success) {
    report.push({id: chart.id, ok: false, reason: result.error, triangles: slice.triangles});
    console.log(`  ${chart.id.padEnd(14)} FALHOU · ${result.error}`);
    continue;
  }
  // Prova de que a carta é caminhável de verdade. Dois critérios, com pesos diferentes:
  //   `entry` — rota do centro do convés até a CABECEIRA da ponte, do lado desta ilha. É o que o
  //             agente precisa de verdade: passada essa cabeceira ele migra para a carta vizinha.
  //             Falha aqui é falha de bake.
  //   `far`   — rota até o desembarque do OUTRO lado. É a folga de sobreposição, e pode faltar sem
  //             quebrar nada: a ponta da ponte fica na borda do recorte, onde os triângulos são
  //             cortados no meio. Relatada, não fatal.
  const query = new NavMeshQuery(result.navMesh, {maxNodes: 32768});
  const centre = query.findClosestPoint(chart.toChart(chart.centre));
  const routes = [];
  const routeTo = point => {
    const target = query.findClosestPoint(chart.toChart(point));
    if (!centre.success || !target.success) return false;
    const route = query.computePath(centre.point, target.point, {maxPathPolys: 4096, maxStraightPathPoints: 4096});
    const end = route.success && route.path.length ? route.path.at(-1) : undefined;
    return Boolean(end) && Math.hypot(end.x - target.point.x, end.y - target.point.y, end.z - target.point.z) < 3;
  };
  for (const bridge of source.bridges) {
    if (bridge.a !== chart.id && bridge.b !== chart.id) continue;
    const mine = bridge.a === chart.id ? bridge.waypoints[0] : bridge.waypoints.at(-1);
    const far = bridge.a === chart.id ? bridge.waypoints.at(-1) : bridge.waypoints[0];
    routes.push({bridge: bridge.id ?? `${bridge.a}~${bridge.b}`, ok: routeTo(mine), overlap: routeTo(far)});
  }
  const bytes = exportNavMesh(result.navMesh);
  fs.writeFileSync(path.join(OUTPUT_DIR, `${chart.id}.bin`), bytes);
  const crossings = routes.filter(r => r.ok).length, overlaps = routes.filter(r => r.overlap).length;
  report.push({
    id: chart.id, ok: true, triangles: slice.triangles, bytes: bytes.length,
    reachArc: Number(chart.reach.toFixed(1)), edgeSlopeDegrees: Number(chart.edgeSlopeDegrees.toFixed(1)),
    onMesh: centre.success, bridges: routes.length, crossings, overlaps, routes, ms: Date.now() - started,
  });
  console.log(`  ${chart.id.padEnd(14)} ${String(slice.triangles).padStart(8)} tri · ${(bytes.length / 1024).toFixed(0).padStart(5)} KiB · alcance ${chart.reach.toFixed(0).padStart(3)} m · borda ${chart.edgeSlopeDegrees.toFixed(1).padStart(4)}° · cabeceiras ${crossings}/${routes.length} · sobreposição ${overlaps}/${routes.length} · ${Date.now() - started} ms`);
  query.destroy();
  result.navMesh.destroy();
  baked++;
}

fs.mkdirSync('docs', {recursive: true});
fs.writeFileSync('docs/island-navmeshes.json', JSON.stringify({
  radius: manifest.radius, islands: manifest.islands.length, bridges: manifest.bridges.length,
  tuning: RECAST_TUNING, charts: report,
}, null, 2));

const failed = report.filter(r => !r.ok);
const disconnected = report.filter(r => r.ok && r.crossings < r.bridges);
console.log(`\nAssadas ${report.filter(r => r.ok).length}/${report.length} · falhas ${failed.length} · pontes sem rota ${disconnected.length}`);
if (failed.length) throw Error('Cartas que não assaram: ' + failed.map(r => r.id).join(', '));
