import {describe,it,expect} from 'vitest';
import fs from 'node:fs';
import zlib from 'node:zlib';
import {IslandChart,IslandChartSet,CHART_SLOPE_LIMIT_DEGREES,type IslandChartSetSource} from '../src/ai/IslandChart';
import type {Vec3} from '../src/core/contracts';

const R=180;
const CENTRE:Vec3={x:0,y:0,z:0};
const dir=(x:number,y:number,z:number):Vec3=>{const l=Math.hypot(x,y,z);return{x:x/l,y:y/l,z:z/l};};
const at=(d:Vec3,radius=R):Vec3=>({x:d.x*radius,y:d.y*radius,z:d.z*radius});
const gap=(a:Vec3,b:Vec3)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);

/** Seis verticais muito diferentes, para nenhum teste passar por acidente de ficar no polo norte. */
const POLES:readonly Vec3[]=[
  dir(0,1,0),dir(0,-1,0),dir(1,0,0),dir(-1,0,0),dir(0,0,1),dir(0,0,-1),dir(.4,-.7,.59),
];

const island=(id:string,d:Vec3,radius:number)=>({id,centre:at(d),up:d,radius});

/** Dois pares de ilhas ligadas, a ~50 m de arco — a mesma escala das pontes reais. */
function archipelago():IslandChartSetSource {
  const a=dir(0,1,0),b=dir(Math.sin(.28),Math.cos(.28),0),c=dir(Math.sin(.56),Math.cos(.56),0);
  return{
    centre:CENTRE,radius:R,
    islands:[island('a',a,20),island('b',b,20),island('c',c,20)],
    bridges:[
      {a:'a',b:'b',waypoints:[at(dir(Math.sin(.11),Math.cos(.11),0)),at(dir(Math.sin(.17),Math.cos(.17),0))]},
      {a:'b',b:'c',waypoints:[at(dir(Math.sin(.39),Math.cos(.39),0)),at(dir(Math.sin(.45),Math.cos(.45),0))]},
    ],
  };
}

describe('carta rígida por ilha',()=>{
  it.each(POLES.map((d,i)=>[i,d] as const))('a carta %i é uma rotação rígida: inversa exata e distâncias preservadas',(_i,d)=>{
    const chart=new IslandChart(island('probe',d,30),90,CENTRE,R);
    // Ida e volta fecha em coordenadas de mundo.
    for(const sample of [at(d),at(d,R+12),{x:at(d).x+7,y:at(d).y-3,z:at(d).z+11},at(dir(d.x+.2,d.y+.1,d.z-.3))]){
      const round=chart.toWorld(chart.toChart(sample));
      expect(gap(round,sample)).toBeLessThan(1e-9);
    }
    // Rígida ⇒ preserva distância entre QUAISQUER dois pontos, não só perto do centro.
    const p=at(dir(d.x+.15,d.y+.05,d.z-.2)),q={x:at(d).x-19,y:at(d).y+31,z:at(d).z+7};
    expect(gap(chart.toChart(p),chart.toChart(q))).toBeCloseTo(gap(p,q),9);
    // E leva a vertical da ilha exatamente em +Y — é isso que o Recast precisa.
    const up=chart.rotateToChart(d);
    expect(up.x).toBeCloseTo(0,12);expect(up.y).toBeCloseTo(1,12);expect(up.z).toBeCloseTo(0,12);
    // O centro do convés é a origem da carta, e o centro do planeta fica em (0,−R,0).
    const origin=chart.toChart(at(d));
    expect(Math.hypot(origin.x,origin.y,origin.z)).toBeLessThan(1e-9);
    const core=chart.toChart(CENTRE);
    expect(core.x).toBeCloseTo(0,9);expect(core.y).toBeCloseTo(-R,9);expect(core.z).toBeCloseTo(0,9);
  });

  it('a bacia da carta tem a inclinação prevista `s/R` e cabe no limite do Recast',()=>{
    const d=dir(.4,-.7,.59),chart=new IslandChart(island('probe',d,30),120,CENTRE,R);
    expect(chart.edgeSlopeDegrees).toBeCloseTo(120/R*180/Math.PI,6);
    expect(chart.edgeSlopeDegrees).toBeLessThan(CHART_SLOPE_LIMIT_DEGREES);
    // A arco `s` o convés desce `R(1−cos(s/R))` na carta, e é isso que o Recast voxeliza.
    for(const arc of [20,60,100]){
      const angle=arc/R;
      const point=at({
        x:d.x*Math.cos(angle)+Math.sin(angle)*perp(d).x,
        y:d.y*Math.cos(angle)+Math.sin(angle)*perp(d).y,
        z:d.z*Math.cos(angle)+Math.sin(angle)*perp(d).z,
      });
      const local=chart.toChart(point);
      expect(local.y).toBeCloseTo(-R*(1-Math.cos(angle)),6);
      expect(Math.hypot(local.x,local.z)).toBeCloseTo(R*Math.sin(angle),6);
    }
  });

  it('escolhe a carta com histerese, para o agente não trocar de multidão no meio da ponte',()=>{
    const charts=new IslandChartSet(archipelago());
    const a=charts.get('a')!,b=charts.get('b')!;
    expect(charts.chartFor(at(dir(0,1,0)))!.id).toBe('a');
    // Ponto exatamente no meio do vão: sem estado anterior escolhe o mais próximo…
    const middle=at(dir(Math.sin(.14),Math.cos(.14),0));
    const free=charts.chartFor(middle)!.id;
    // …mas com estado anterior mantém a carta em que já estava, nos DOIS sentidos.
    expect(charts.chartFor(middle,'a')!.id).toBe('a');
    expect(charts.chartFor(middle,'b')!.id).toBe('b');
    expect(['a','b']).toContain(free);
    // Longe o bastante, a histerese cede e a troca acontece de verdade.
    expect(charts.chartFor(at(dir(Math.sin(.28),Math.cos(.28),0)),'a')!.id).toBe('b');
    expect(a.covers(middle)&&b.covers(middle)).toBe(true);
  });

  it('cada carta cobre a ponte INTEIRA da ilha, então as cartas vizinhas se sobrepõem',()=>{
    const source=archipelago(),charts=new IslandChartSet(source);
    for(const bridge of source.bridges){
      for(const id of [bridge.a,bridge.b]){
        const chart=charts.get(id)!;
        for(const point of bridge.waypoints)expect(chart.covers(point)).toBe(true);
      }
    }
  });

  it('acha o primeiro salto de ponte e recusa uma ilha desligada',()=>{
    const source=archipelago();
    const charts=new IslandChartSet({...source,islands:[...source.islands,island('orphan',dir(0,0,1),10)]});
    expect(charts.firstHop('a','c')?.to).toBe('b');
    expect(charts.firstHop('c','a')?.to).toBe('b');
    expect(charts.firstHop('a','b')?.to).toBe('b');
    expect(charts.firstHop('a','a')).toBeUndefined();
    expect(charts.connected('a','c')).toBe(true);
    expect(charts.connected('a','orphan')).toBe(false);
    expect(charts.firstHop('a','orphan')).toBeUndefined();
  });

  it('o recorte devolve triângulos já em coordenadas de carta e descarta o resto do globo',()=>{
    const charts=new IslandChartSet(archipelago());
    const chart=charts.get('a')!;
    // Dois triângulos: um sobre a ilha `a`, outro do lado oposto do planeta.
    const near=at(dir(0,1,0)),far=at(dir(0,-1,0));
    const positions=[
      near.x,near.y,near.z, near.x+2,near.y,near.z, near.x,near.y,near.z+2,
      far.x,far.y,far.z, far.x+2,far.y,far.z, far.x,far.y,far.z+2,
    ];
    const slice=charts.slice(chart,positions,[0,1,2,3,4,5]);
    expect(slice.triangles).toBe(1);
    expect(slice.positions).toHaveLength(9);
    // O vértice no centro do convés vira a origem da carta.
    expect(Math.hypot(slice.positions[0]!,slice.positions[1]!,slice.positions[2]!)).toBeLessThan(1e-4);
  });
});

/** Uma perpendicular estável à vertical, para andar sobre o convés num teste. */
function perp(d:Vec3):Vec3 {
  const seed=Math.abs(d.y)<.9?{x:0,y:1,z:0}:{x:1,y:0,z:0};
  const c={x:seed.y*d.z-seed.z*d.y,y:seed.z*d.x-seed.x*d.z,z:seed.x*d.y-seed.y*d.x};
  const l=Math.hypot(c.x,c.y,c.z);
  return{x:c.x/l,y:c.y/l,z:c.z/l};
}

const MANIFEST='public/models/planet-archipelago.json.gz';
describe.skipIf(!fs.existsSync(MANIFEST))('o arquipélago autoral real cabe nas cartas',()=>{
  it('as 38 cartas cobrem ilha e pontes abaixo do limite de 49° do Recast',()=>{
    const manifest=JSON.parse(zlib.gunzipSync(fs.readFileSync(MANIFEST)).toString());
    const charts=new IslandChartSet({centre:manifest.centre??CENTRE,radius:manifest.radius,islands:manifest.islands,bridges:manifest.bridges});
    expect(charts.charts).toHaveLength(manifest.islands.length);
    expect(charts.overSloped).toEqual([]);
    // A medida que sustenta a decisão de arquitetura: pior caso 38,0° contra o limite de 49°.
    const worst=Math.max(...charts.charts.map(c=>c.edgeSlopeDegrees));
    expect(worst).toBeLessThan(CHART_SLOPE_LIMIT_DEGREES);
    expect(worst).toBeGreaterThan(30);
    // Toda ponte cabe inteira nas cartas das DUAS pontas — é daí que vem a faixa de troca.
    for(const bridge of manifest.bridges){
      for(const id of [bridge.a,bridge.b]){
        const chart=charts.get(id)!;
        for(const point of bridge.waypoints)expect(chart.covers(point),`${bridge.id ?? id} fora da carta ${id}`).toBe(true);
      }
    }
    // E o grafo de pontes liga o arquipélago inteiro: nenhuma ilha fica sem rota.
    for(const other of manifest.islands)expect(charts.connected(manifest.islands[0].id,other.id)).toBe(true);
  });
});
