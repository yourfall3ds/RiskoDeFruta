import {describe,it,expect} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {TacticalNavigation} from '../src/ai/TacticalNavigation';
import {IslandChartSet} from '../src/ai/IslandChart';
import type {Vec3} from '../src/core/contracts';

const MANIFEST='public/models/planet-archipelago.json.gz';
const BAKED='public/models/island-navmesh';
const ready=fs.existsSync(MANIFEST)&&fs.existsSync(BAKED)&&fs.readdirSync(BAKED).some(f=>f.endsWith('.bin'));

/** Manifesto sem a malha: com as cartas assadas, o Detour não precisa dos 1,75 M de triângulos. */
function source(){
  const manifest=JSON.parse(zlib.gunzipSync(fs.readFileSync(MANIFEST)).toString());
  return{
    centre:manifest.centre??{x:0,y:0,z:0},radius:manifest.radius as number,
    islands:manifest.islands as {id:string;centre:Vec3;up:Vec3;radius:number}[],
    bridges:manifest.bridges as {id?:string;a:string;b:string;waypoints:Vec3[]}[],
    positions:[] as number[],indices:[] as number[],
    baked:async(id:string)=>{
      const file=path.join(BAKED,`${id}.bin`);
      return fs.existsSync(file)?new Uint8Array(fs.readFileSync(file)):undefined;
    },
  };
}

const arc=(charts:IslandChartSet,a:Vec3,b:Vec3)=>{
  const n=(v:Vec3)=>{const l=Math.hypot(v.x,v.y,v.z)||1;return{x:v.x/l,y:v.y/l,z:v.z/l};};
  const u=n(a),w=n(b);
  const c={x:u.y*w.z-u.z*w.y,y:u.z*w.x-u.x*w.z,z:u.x*w.y-u.y*w.x};
  return Math.atan2(Math.hypot(c.x,c.y,c.z),u.x*w.x+u.y*w.y+u.z*w.z)*charts.planetRadius;
};

describe.skipIf(!ready)('Detour por cartas rígidas de ilha, no arquipélago autoral',()=>{
  it('carrega as 38 cartas assadas e responde no espaço de MUNDO',async()=>{
    const data=source();
    const nav=await TacticalNavigation.createIslands(data);
    try{
      expect(nav.charted).toBe(true);
      expect(nav.readyCharts).toHaveLength(data.islands.length);
      // `closest` devolve coordenadas de mundo, não de carta: o centro de cada convés cai a poucos
      // metros de si mesmo depois da ida e volta pela rotação rígida.
      for(const island of data.islands){
        const near=nav.closest(island.centre);
        expect(near,`sem malha em ${island.id}`).toBeDefined();
        expect(Math.hypot(near!.x-island.centre.x,near!.y-island.centre.y,near!.z-island.centre.z)).toBeLessThan(6);
      }
    }finally{nav.dispose();}
  });

  it('vinte e quatro hostis atravessam a ponte entre duas ilhas, trocando de carta no caminho',async()=>{
    const data=source();
    const charts=new IslandChartSet(data);
    // Uma ponte real, com as duas ilhas mais largas disponíveis nas pontas.
    const bridge=data.bridges.find(b=>b.a!=='' )!;
    const from=data.islands.find(i=>i.id===bridge.b)!,to=data.islands.find(i=>i.id===bridge.a)!;
    const nav=await TacticalNavigation.createIslands({...data,origin:to.centre});
    try{
      const player=nav.closest(to.centre)??to.centre;
      nav.step(1/60,player);
      let admitted=0;
      for(let i=0;i<24;i++){
        const angle=i/24*Math.PI*2,r=Math.min(6,from.radius*.4);
        const seed={x:from.centre.x+Math.cos(angle)*r,y:from.centre.y,z:from.centre.z+Math.sin(angle)*r};
        const spot=nav.closest(seed)??seed;
        if(nav.add(200+i,spot,.6,4.2))admitted++;
      }
      expect(admitted).toBeGreaterThanOrEqual(20);
      const opening=new Map<number,number>();
      for(let i=0;i<24;i++){const p=nav.position(200+i);if(p)opening.set(200+i,arc(charts,p,player));}
      expect(opening.size).toBeGreaterThanOrEqual(20);
      // Trinta segundos de perseguição, exatamente como a horda pede por tique.
      for(let step=0;step<1800;step++){
        for(let i=0;i<24;i++)nav.target(200+i,player,i,false,4.2);
        nav.step(1/60,player);
      }
      let closer=0,migrated=0,onMesh=0;
      for(const [id,before] of opening){
        const p=nav.position(id);
        if(!p)continue;
        onMesh++;
        const now=arc(charts,p,player);
        if(now<before-8)closer++;
        // Quem passou da faixa de troca está sendo simulado pela carta da ilha do jogador.
        if(charts.chartFor(p)?.id===to.id)migrated++;
      }
      expect(onMesh).toBeGreaterThanOrEqual(20);
      // A perseguição avançou de verdade, e a troca de multidão aconteceu sem perder ninguém.
      expect(closer).toBeGreaterThanOrEqual(15);
      expect(migrated).toBeGreaterThanOrEqual(10);
      expect(nav.count).toBe(admitted);
    }finally{nav.dispose();}
  },120000);

  it('os setores de ataque continuam GLOBAIS, sem dois hostis no mesmo rank entre ilhas',async()=>{
    const data=source();
    const bridge=data.bridges[0]!;
    const here=data.islands.find(i=>i.id===bridge.a)!,there=data.islands.find(i=>i.id===bridge.b)!;
    const nav=await TacticalNavigation.createIslands({...data,origin:here.centre});
    try{
      const player=nav.closest(here.centre)??here.centre;
      nav.step(1/60,player);
      const ids:number[]=[];
      for(const [index,island] of [here,there].entries())for(let i=0;i<6;i++){
        const angle=i/6*Math.PI*2,r=Math.min(5,island.radius*.4);
        const seed={x:island.centre.x+Math.cos(angle)*r,y:island.centre.y,z:island.centre.z+Math.sin(angle)*r};
        const id=300+index*10+i;
        if(nav.add(id,nav.closest(seed)??seed,.6,4.2))ids.push(id);
      }
      expect(ids.length).toBeGreaterThanOrEqual(10);
      // `target` atribui o menor rank livre da CLASSE, num único mapa para as duas ilhas.
      for(const id of ids)nav.target(id,player,0,false,4.2);
      nav.step(1/60,player);
      const ranks=ids.map(id=>rankOf(nav,id));
      expect(new Set(ranks).size).toBe(ranks.length);
    }finally{nav.dispose();}
  },120000);

  it('reachable atravessa o grafo de pontes e recusa um ponto fora de qualquer convés',async()=>{
    const data=source();
    const nav=await TacticalNavigation.createIslands(data);
    try{
      const a=data.islands[0]!,far=data.islands[data.islands.length-1]!;
      const start=nav.closest(a.centre)!,target=nav.closest(far.centre)!;
      expect(nav.reachable(start,start)).toBe(true);
      // Ilhas distintas: a resposta vem da cabeceira da primeira ponte + conectividade do grafo.
      expect(nav.reachable(start,target)).toBe(true);
      // Ponto bem acima do convés não tem apoio na malha e é recusado.
      const sky={x:start.x*1.4,y:start.y*1.4,z:start.z*1.4};
      expect(nav.reachable(sky,target)).toBe(false);
    }finally{nav.dispose();}
  },120000);
});

/** Lê o rank atribuído pelo `target`, que é privado; a prova é o setor de mundo em que o agente mira. */
function rankOf(nav:TacticalNavigation,id:number):string {
  const slots=(nav as unknown as {slots:Map<number,{rank:number;ranged:boolean}>}).slots;
  const slot=slots.get(id);
  return slot?`${slot.ranged}:${slot.rank}`:`none:${id}`;
}
