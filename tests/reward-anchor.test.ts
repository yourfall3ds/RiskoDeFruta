import {describe,it,expect} from 'vitest';
import {CollisionWorld} from '../src/physics/CollisionWorld';
import {safeRewardGround,resolveRewardPlacement} from '../src/run/RewardAnchor';

function field(){
  const w=new CollisionWorld();
  w.surfaces.push({id:'field',x:0,z:0,width:120,depth:120,height:0});
  return w;
}

describe('recompensa onde a praga caiu',()=>{
  it('usa o ponto do abate quando há piso seguro em volta',()=>{
    const w=field(),ground=safeRewardGround(w,{x:12,y:0,z:-7});
    expect(ground).toEqual({x:12,y:0,z:-7});
  });
  it('morte no ar desce para o piso abaixo',()=>{
    const w=field(),ground=safeRewardGround(w,{x:4,y:9,z:4});
    expect(ground).toBeDefined();
    expect(ground!.y).toBe(0);
    expect(Math.hypot(ground!.x-4,ground!.z-4)).toBeLessThan(1e-6);
  });
  it('morte na borda escorrega para o anel seguro mais próximo, não some',()=>{
    const w=new CollisionWorld();
    w.surfaces.push({id:'ledge',x:0,z:0,width:40,depth:40,height:0});
    const edge={x:19.6,y:0,z:0}; // a folga de 2,3 m passa da beira
    expect(safeRewardGround(w,edge,0)).toBeUndefined();
    const ground=safeRewardGround(w,edge);
    expect(ground).toBeDefined();
    expect(Math.hypot(ground!.x-edge.x,ground!.z-edge.z)).toBeGreaterThan(0);
    expect(Math.hypot(ground!.x-edge.x,ground!.z-edge.z)).toBeLessThanOrEqual(14.1);
  });
  it('sem piso seguro em lugar nenhum devolve indefinido em vez de item inalcançável',()=>{
    const w=new CollisionWorld();
    w.surfaces.push({id:'pilar',x:0,z:0,width:1.5,depth:1.5,height:0});
    expect(safeRewardGround(w,{x:0,y:0,z:0})).toBeUndefined();
  });
});

describe('prioridade da âncora',()=>{
  it('abate decisivo vence o objetivo',()=>{
    const w=field();
    const placement=resolveRewardPlacement(w,[{position:{x:8,y:0,z:8},source:'kill'},{position:{x:0,y:0,z:0},source:'objective'}]);
    expect(placement?.source).toBe('kill');
    expect(placement?.position).toEqual({x:8,y:0,z:8});
  });
  it('sem abate válido cai para o objetivo',()=>{
    const w=field();
    const placement=resolveRewardPlacement(w,[{position:undefined,source:'kill'},{position:{x:-6,y:0,z:3},source:'objective'}]);
    expect(placement?.source).toBe('objective');
  });
  it('abate sem piso seguro cede a vez ao objetivo',()=>{
    const w=new CollisionWorld();
    w.surfaces.push({id:'plaza',x:0,z:0,width:40,depth:40,height:0});
    // Abate a 80 m do piso: nenhum anel encontra chão.
    const placement=resolveRewardPlacement(w,[{position:{x:400,y:0,z:400},source:'kill'},{position:{x:0,y:0,z:0},source:'objective'}]);
    expect(placement?.source).toBe('objective');
  });
  it('sem nenhum candidato válido devolve indefinido',()=>{
    expect(resolveRewardPlacement(field(),[])).toBeUndefined();
  });
});
