import { describe,it,expect } from 'vitest';
import { openSync,readSync,closeSync } from 'node:fs';
import { resolveRenderScale } from '../src/engine/createEngine';
import { SHADOW_EXEMPT } from '../src/world/FarmWorld';

/** Lê só o bloco JSON do GLB — o arquivo tem 52 MB e o resto é binário. */
function farmNodeNames():string[] {
  const fd=openSync('public/models/farm-world.glb','r');
  try {
    const head=Buffer.alloc(20);readSync(fd,head,0,20,0);
    if(head.readUInt32LE(0)!==0x46546c67)throw new Error('GLB inválido');
    const chunk=Buffer.alloc(head.readUInt32LE(12));readSync(fd,chunk,0,chunk.length,20);
    return (JSON.parse(chunk.toString('utf8')) as {nodes:{name?:string;mesh?:number}[]}).nodes
      .filter(node=>node.mesh!==undefined).map(node=>node.name??'');
  } finally { closeSync(fd); }
}

describe('render budget',()=>{
  it('supersamples até o teto de pixels e nunca renderiza abaixo do nativo',()=>{
    expect(resolveRenderScale(1.5,1280,720)).toBeCloseTo(1.5);       // cabe no teto
    expect(resolveRenderScale(1.5,2560,1440)).toBeCloseTo(1.02,2);    // teto quase atingido, sobra pouca folga
    expect(resolveRenderScale(1.5,3840,2160)).toBe(1);                // tela grande nunca desce do nativo
    expect(resolveRenderScale(.5,1280,720)).toBe(1);                  // pedido abaixo do nativo é ignorado
    expect(resolveRenderScale(2,800,600,3_840_000)).toBeCloseTo(2);
  });

  it('isenta de sombra os grupos numerosos e mantém o que projeta sombra visível',()=>{
    const names=farmNodeNames();
    expect(names.length).toBe(862);
    const exempt=names.filter(name=>SHADOW_EXEMPT.test(name));
    // 455 fern + 108 pedras de borda + 96 forrações + 84 tomates + 24 melancias
    expect(exempt.length).toBe(767);
    for(const prefix of ['fern_02','coast_land_rocks_02','coast_land dressed','Harvest tomato','Harvest watermelon'])
      expect(names.some(n=>n.startsWith(prefix)&&SHADOW_EXEMPT.test(n))).toBe(true);
    // copas, troncos e as construções continuam projetando
    for(const keep of ['tree-canopy-island_tree dressed-0','island_tree dressed','Barn side wall','Gambrel roof','Weathered agricultural silo','Open barn door'])
      expect(SHADOW_EXEMPT.test(keep)).toBe(false);
  });
});
