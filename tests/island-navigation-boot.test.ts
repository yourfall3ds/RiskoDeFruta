import {describe,it,expect} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {TacticalNavigation,ISLAND_NAVMESH_URL} from '../src/ai/TacticalNavigation';
import type {Vec3} from '../src/core/contracts';

const MANIFEST='public/models/planet-archipelago.json.gz';
const BAKED='public/models/island-navmesh';
const ready=fs.existsSync(MANIFEST)&&fs.existsSync(BAKED)&&fs.readdirSync(BAKED).some(f=>f.endsWith('.bin'));

function manifestSource(){
  const manifest=JSON.parse(zlib.gunzipSync(fs.readFileSync(MANIFEST)).toString());
  return{
    centre:manifest.centre??{x:0,y:0,z:0},radius:manifest.radius as number,
    islands:manifest.islands as {id:string;centre:Vec3;up:Vec3;radius:number}[],
    bridges:manifest.bridges as {a:string;b:string;waypoints:Vec3[]}[],
    positions:manifest.positions as number[],indices:manifest.indices as number[],
  };
}
const readBaked=async(id:string)=>{
  const file=path.join(BAKED,`${id}.bin`);
  return fs.existsSync(file)?new Uint8Array(fs.readFileSync(file)):undefined;
};

describe.skipIf(!ready)('arranque da navegação do planeta não pode travar a aba',()=>{
  it('a URL publicada é a que o bake escreve',()=>{
    // O caminho é UM só. Divergir aqui faz todo `fetch` dar 404 em silêncio — foi o que aconteceu.
    expect(ISLAND_NAVMESH_URL('north')).toBe('/models/island-navmesh/north.bin');
    expect(fs.existsSync(path.join(BAKED,'north.bin'))).toBe(true);
  });

  it('com os 38 assados reais, o arranque é carga pura e nenhuma carta é assada em runtime',async()=>{
    const source=manifestSource();
    const started=performance.now();
    const nav=await TacticalNavigation.createIslands({...source,baked:readBaked});
    const elapsed=performance.now()-started;
    try{
      expect(nav.readyCharts).toHaveLength(source.islands.length);
      expect(nav.missingCharts).toEqual([]);
      // O ponto do assado offline: ZERO Recast no arranque.
      expect(nav.runtimeBakes).toBe(0);
      // Medido em ~24 ms no manifesto real; o teto generoso aqui é só para não ficar frágil em CI.
      expect(elapsed).toBeLessThan(4000);
    }finally{nav.dispose();}
  },60000);

  it('TODAS as URLs em 404 degradam em vez de assar 38 cartas e congelar a thread',async()=>{
    const source=manifestSource();
    // Exatamente o bug de campo: o carregador existe, mas nenhuma URL responde.
    const missing=async()=>undefined;
    const started=performance.now();
    let nav:TacticalNavigation|undefined;
    try{
      nav=await TacticalNavigation.createIslands({...source,baked:missing});
      expect.unreachable('createIslands deveria recusar quando nenhuma carta carrega');
    }catch(error){
      const elapsed=performance.now()-started;
      // Assar as 38 custaria ~30 s. Recusar tem de ser praticamente instantâneo.
      expect(elapsed).toBeLessThan(2000);
      // E a mensagem tem de dizer ONDE procurar, senão o próximo a depurar isto perde o dia.
      expect(String(error)).toContain('island-navmesh');
    }finally{nav?.dispose();}
  },60000);

  it('uma carta faltando não vira Recast escondido: fica ausente e aparece no diagnóstico',async()=>{
    const source=manifestSource();
    const absent=new Set(['north','front','south']);
    const partial=async(id:string)=>absent.has(id)?undefined:readBaked(id);
    const started=performance.now();
    const nav=await TacticalNavigation.createIslands({...source,baked:partial});
    const elapsed=performance.now()-started;
    try{
      expect(nav.readyCharts).toHaveLength(source.islands.length-absent.size);
      expect([...nav.missingCharts].sort()).toEqual([...absent].sort());
      expect(nav.runtimeBakes).toBe(0);
      expect(elapsed).toBeLessThan(4000);
      // O HUD precisa conseguir dizer o porquê sem inventar texto.
      expect(nav.residencyDescription).toContain('SEM ASSADO');
      // E o jogo continua jogável: as cartas que chegaram respondem normalmente.
      const alive=source.islands.find(i=>!absent.has(i.id))!;
      expect(nav.closest(alive.centre)).toBeDefined();
    }finally{nav.dispose();}
  },60000);

  it('carta em 404 não vira tempestade de requisições quadro a quadro',async()=>{
    const source=manifestSource();
    const absent='north';
    let attempts=0;
    const counted=async(id:string)=>{if(id===absent)attempts++;return readBaked(id);};
    const nav=await TacticalNavigation.createIslands({...source,baked:async id=>id===absent?(await counted(id),undefined):counted(id)});
    try{
      expect(nav.missingCharts).toEqual([absent]);
      const afterBoot=attempts;
      // `regionFor` bate nesta ilha a cada `step`/`closest`. Sem a lista de falhas isto seriam
      // sessenta requisições por segundo, para sempre, por um arquivo que não existe.
      const chart=source.islands.find(i=>i.id===absent)!;
      for(let i=0;i<120;i++){nav.closest(chart.centre);nav.step(1/60,chart.centre);}
      await Promise.resolve();
      expect(attempts).toBe(afterBoot);
      expect(nav.runtimeBakes).toBe(0);
    }finally{nav.dispose();}
  },60000);

  it('assar em runtime continua possível quando é PEDIDO, e só uma carta por vez',async()=>{
    const source=manifestSource();
    // Sem `baked` é o modo de desenvolvimento documentado: assa a ilha de partida e mais nenhuma.
    const started=performance.now();
    const nav=await TacticalNavigation.createIslands({...source,origin:source.islands[0]!.centre});
    const elapsed=performance.now()-started;
    try{
      expect(nav.readyCharts).toHaveLength(1);
      expect(nav.runtimeBakes).toBe(1);
      // Uma carta, não 38: o arranque paga ~1 s, não ~30 s.
      expect(elapsed).toBeLessThan(8000);
      expect(nav.missingCharts).toHaveLength(source.islands.length-1);
    }finally{nav.dispose();}
  },60000);
});
