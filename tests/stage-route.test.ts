import {describe,it,expect} from 'vitest';
import {CollisionWorld} from '../src/physics/CollisionWorld';
import {RunRNG} from '../src/core/RunRNG';
import {STAGE_BIOMES,biomeForStage,nextBiomeForStage,biomeById,MIN_ISLAND_SEPARATION,WIDE_ISLAND_SEPARATION,type StageBiome} from '../src/stages/StageRoute';
import {islandPairs,planStage,planar,type StagePlanValidation} from '../src/stages/StagePlan';
import {findSpawnPoint,isSafeSpawnGround,SPAWN_HEADROOM,SPAWN_FOOTING_RADIUS} from '../src/stages/StageSpawn';
import type {Vec3} from '../src/core/contracts';

describe('rota entre biomas existentes',()=>{
  it('gira pelos quatro biomas autorais e volta ao começo, sem inventar planeta novo',()=>{
    expect(STAGE_BIOMES.map(b=>b.id)).toEqual(['farm-city','solar-frontier','highland-farms','rootwood']);
    // Cada bioma é uma região transmitida que existe de verdade em `public/models`.
    for(const biome of STAGE_BIOMES)expect(biome.region).toBe(biome.id);
    expect([1,2,3,4,5,6].map(stage=>biomeForStage(stage).id))
      .toEqual(['farm-city','solar-frontier','highland-farms','rootwood','farm-city','solar-frontier']);
    expect(nextBiomeForStage(1).id).toBe('solar-frontier');
    expect(nextBiomeForStage(4).id).toBe('farm-city');
    // Cada estágio muda de bioma: nunca se "avança" para o mesmo mapa.
    for(let stage=1;stage<=9;stage++)expect(nextBiomeForStage(stage).id).not.toBe(biomeForStage(stage).id);
    expect(biomeById('rootwood')?.name).toBe('Bosque das raízes');
    expect(biomeById('nenhum')).toBeUndefined();
  });

  it('cada bioma tem pares de ilhas diferentes acima do mínimo pedido',()=>{
    for(const biome of STAGE_BIOMES){
      const pairs=islandPairs(biome);
      expect(biome.separation).toBeGreaterThanOrEqual(MIN_ISLAND_SEPARATION);
      expect(pairs.length).toBeGreaterThan(0);
      for(const pair of pairs){
        expect(pair.spawn.id).not.toBe(pair.chalice.id);
        expect(pair.distance).toBeGreaterThanOrEqual(biome.separation);
      }
      // Regiões grandes exigem mais que os 100 m mínimos.
      if(biome.id==='highland-farms'||biome.id==='rootwood')expect(biome.separation).toBe(WIDE_ISLAND_SEPARATION);
      // Ilhas com id repetido invalidariam a regra "outra ilha".
      expect(new Set(biome.islands.map(i=>i.id)).size).toBe(biome.islands.length);
    }
  });

  it('a partida varia entre ilhas do primeiro bioma conforme a semente',()=>{
    const biome=biomeForStage(1),spawns=new Set<string>(),chalices=new Set<string>();
    for(let i=0;i<40;i++){
      const plan=planStage(biome,new RunRNG(`semente-${i}:stage:1`).stream('scene'),acceptAll(biome));
      expect(plan).toBeDefined();
      spawns.add(plan!.spawnIsland.id);chalices.add(plan!.chaliceIsland.id);
    }
    expect(spawns.size).toBeGreaterThanOrEqual(3);
    expect(chalices.size).toBeGreaterThanOrEqual(2);
  });

  it('a mesma semente e o mesmo estágio reproduzem o mesmo plano',()=>{
    const biome=biomeForStage(3);
    const first=planStage(biome,new RunRNG('fixa:stage:3').stream('scene'),acceptAll(biome));
    const again=planStage(biome,new RunRNG('fixa:stage:3').stream('scene'),acceptAll(biome));
    expect(first).toBeDefined();
    expect({spawn:first!.spawnIsland.id,chalice:first!.chaliceIsland.id}).toEqual({spawn:again!.spawnIsland.id,chalice:again!.chaliceIsland.id});
  });

  it('mede a distância entre os pontos escolhidos, não entre as âncoras',()=>{
    // Duas ilhas separadas por 120 m nas âncoras, mas cujos pontos válidos ficam a 40 m.
    const biome:StageBiome={id:'teste',name:'Teste',region:undefined,separation:100,islands:[
      {id:'a',name:'A',x:0,y:0,z:0,width:20,depth:20},
      {id:'b',name:'B',x:120,y:0,z:0,width:20,depth:20},
    ]};
    expect(islandPairs(biome)).toHaveLength(2);
    const plan=planStage(biome,new RunRNG('encolhe').stream('scene'),{
      spawnPoint:island=>({x:island.x===0?40:80,y:0,z:0}),
      chalicePoint:island=>({x:island.x===0?40:80,y:0,z:0}),
      route:()=>true,
    });
    expect(plan).toBeUndefined();
  });

  it('não devolve plano quando não existe rota, em vez de aproximar o cálice',()=>{
    const biome=biomeForStage(2);
    const blocked=planStage(biome,new RunRNG('sem-rota').stream('scene'),{...acceptAll(biome),route:()=>false});
    expect(blocked).toBeUndefined();
    const noSpawn=planStage(biome,new RunRNG('sem-partida').stream('scene'),{...acceptAll(biome),spawnPoint:()=>undefined});
    expect(noSpawn).toBeUndefined();
    const noChalice=planStage(biome,new RunRNG('sem-calice').stream('scene'),{...acceptAll(biome),chalicePoint:()=>undefined});
    expect(noChalice).toBeUndefined();
  });

  it('descarta a ilha de partida inválida e usa outra sem encurtar a distância',()=>{
    const biome=biomeForStage(1),broken=biome.islands[0]!.id;
    const plan=planStage(biome,new RunRNG('ilha-quebrada').stream('scene'),{
      ...acceptAll(biome),
      spawnPoint:island=>island.id===broken?undefined:{x:island.x,y:island.y,z:island.z},
    });
    expect(plan).toBeDefined();
    expect(plan!.spawnIsland.id).not.toBe(broken);
    expect(plan!.distance).toBeGreaterThanOrEqual(biome.separation);
  });
});

describe('pouso seguro na ilha sorteada',()=>{
  /** Pátio largo, um telhado sobre parte dele e uma passarela fina ao lado. */
  function terrain():CollisionWorld {
    const world=new CollisionWorld();
    world.surfaces.push({id:'patio',x:0,z:0,width:60,depth:60,height:0});
    world.surfaces.push({id:'passarela',x:100,z:0,width:3,depth:40,height:0});
    world.boxes.push({id:'telhado',min:{x:10,y:3,z:-10},max:{x:26,y:3.3,z:10}});
    return world;
  }

  it('aceita piso de topo com espaço acima e apoio em volta',()=>{
    const world=terrain();
    expect(isSafeSpawnGround(world,0,0,0)).toBe(true);
    expect(findSpawnPoint(world,{x:0,y:0,z:0})).toEqual({x:0,y:0,z:0});
  });

  it('recusa ficar preso sob uma laje e prefere o topo dela',()=>{
    const world=terrain();
    // Sob o telhado: existe piso, mas não há espaço de cabeça.
    expect(isSafeSpawnGround(world,18,0,0)).toBe(false);
    // `groundAt` sem teto devolve o topo da laje, que é livre — é ali que a queda termina.
    expect(world.groundAt(18,0)).toBeCloseTo(3.3,3);
    const top=findSpawnPoint(world,{x:18,y:3.3,z:0});
    expect(top).toEqual({x:18,y:3.3,z:0});
    // Um telhado plano não pode recusar a si mesmo: a varredura começa acima dos pés.
    expect(world.sweepSphere({x:top!.x,y:top!.y+1,z:top!.z},{x:0,y:SPAWN_HEADROOM-1,z:0},.4,true)).toBeFalsy();
  });

  it('recusa passarela estreita, onde o primeiro passo cairia no vazio',()=>{
    const world=terrain();
    expect(SPAWN_FOOTING_RADIUS).toBeGreaterThan(1.5);
    expect(isSafeSpawnGround(world,100,0,0)).toBe(false);
    expect(findSpawnPoint(world,{x:100,y:0,z:0})).toBeUndefined();
  });

  it('procura em anéis quando o centro da ilha não serve',()=>{
    const world=terrain();
    world.boxes.push({id:'torre',min:{x:-2,y:0,z:-2},max:{x:2,y:9,z:2}});
    const point=findSpawnPoint(world,{x:0,y:0,z:0});
    expect(point).toBeDefined();
    expect(Math.hypot(point!.x,point!.z)).toBeGreaterThan(3);
    expect(world.insideSolid(point!,1.8)).toBe(false);
  });
});

/** Validação que aprova qualquer ilha na própria âncora; isola a lógica de sorteio do terreno. */
function acceptAll(_biome:StageBiome):StagePlanValidation {
  const at=(island:{x:number;y:number;z:number}):Vec3=>({x:island.x,y:island.y,z:island.z});
  return {spawnPoint:at,chalicePoint:at,route:(a,b)=>planar(a,b)>0};
}
