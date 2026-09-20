import { describe,it,expect } from 'vitest';
import { openSync,readSync,closeSync } from 'node:fs';
import { resolveRenderScale } from '../src/engine/createEngine';
import { SHADOW_EXEMPT } from '../src/world/FarmWorld';

/** Lê só o bloco JSON do GLB — o arquivo tem 16 MB e o resto é binário (Draco + WebP). */
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
    // Contagem medida no `farm-world.glb` com a lavoura plantada. Os números antigos (862 nós, 767
    // isentos) descreviam um mundo que este `build-farm-world.py` não constrói mais: o comentário
    // deles citava "84 tomates + 24 melancias", e o script de hoje carrega QUATRO assets
    // (`coast_land_rocks_02`, `fern_02`, `grass_medium_01`, `island_tree_01`) — colheita nenhuma.
    // Os nomes `Harvest tomato`/`Harvest watermelon` continuam na regex porque são de OUTROS mundos
    // (`farm-city`, `highland-farms`); só a atribuição deles a este arquivo estava errada.
    //
    // A conta de hoje bate com o script linha a linha: 253 pés de milho, 164 pedras de borda,
    // 120 samambaias, 77 forrações, 76 moitas de margarida, 11 árvores, 6 espantalhos e 8 peças
    // autorais de construção. 715 nós sobre apenas 23 malhas distintas — é essa razão que prova que
    // a compressão continuou instanciando em vez de fundir geometria.
    expect(names.length).toBe(715);
    const exempt=names.filter(name=>SHADOW_EXEMPT.test(name));
    // 253 milho + 164 pedras + 120 samambaias + 77 forrações + 76 margaridas
    expect(exempt.length).toBe(690);
    for(const prefix of ['fern_02','coast_land_rocks_02','grass_medium_01','Milho plantado','Margaridas do campo'])
      expect(names.some(n=>n.startsWith(prefix)&&SHADOW_EXEMPT.test(n)),prefix).toBe(true);
    // O espantalho é a exceção deliberada: seis no mapa inteiro, alto, e a sombra dele é o efeito.
    expect(names.some(n=>n.startsWith('Espantalho'))).toBe(true);
    expect(SHADOW_EXEMPT.test('Espantalho')).toBe(false);
    // copas, troncos e as construções continuam projetando
    for(const keep of ['tree-canopy-island_tree dressed-0','island_tree dressed','Barn side wall','Gambrel roof','Weathered agricultural silo','Open barn door'])
      expect(SHADOW_EXEMPT.test(keep)).toBe(false);
  });
});
