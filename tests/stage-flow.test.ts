import {describe,it,expect,beforeAll,afterAll} from 'vitest';
import {readFileSync} from 'node:fs';
import {init,importNavMesh,NavMeshQuery,type NavMesh} from '@recast-navigation/core';
import {CollisionWorld} from '../src/physics/CollisionWorld';
import {EventBus} from '../src/core/EventBus';
import {RunRNG} from '../src/core/RunRNG';
import {RunProgression} from '../src/run/RunProgression';
import {ExpeditionObjectives,findTotemSite,FINAL_CHALICE_JUICE,TOTEM_ACTIVATION_RANGE,TOTEM_RADIUS,type TotemSite} from '../src/run/ExpeditionObjectives';
import {STAGE_BIOMES,biomeForStage,nextBiomeForStage,WIDE_ISLAND_SEPARATION,type StageIsland} from '../src/stages/StageRoute';
import {planStage,planar,HOME_MIN_ROUTE,WIDE_MIN_ROUTE,type StagePlan} from '../src/stages/StagePlan';
import {findSpawnPoint} from '../src/stages/StageSpawn';
import {StageJourney,JOURNEY_HARVEST_SECONDS,JOURNEY_BOARD_SECONDS,JOURNEY_MIN_TRAVEL_SECONDS,JOURNEY_RETRY_SECONDS} from '../src/stages/StageJourney';
import type {GameEvents,Vec3} from '../src/core/contracts';

/**
 * Mundo de colisão real: as mesmas caixas, superfícies e triângulos que o jogo carrega.
 *
 * O relevo esculpido (`sculptRegion`) não é reproduzido aqui — ele acrescenta triângulos ao mesmo
 * conjunto em tempo de execução, então o piso do jogo é igual ou mais generoso que o medido abaixo.
 */
const worldCache=new Map<string,CollisionWorld>();
function worldFor(region:string|undefined):CollisionWorld {
  const cached=worldCache.get(region??'');
  if(cached)return cached;
  const built=buildWorld(region);
  worldCache.set(region??'',built);
  return built;
}
function buildWorld(region:string|undefined):CollisionWorld {
  const world=new CollisionWorld();
  const farm=JSON.parse(readFileSync('public/models/farm-collision.json','utf8')) as {boxes:never[];surfaces:never[]};
  world.boxes.push(...farm.boxes);world.surfaces.push(...farm.surfaces);
  const mesh=JSON.parse(readFileSync('public/models/world-collision-mesh.json','utf8')) as {positions:number[];indices:number[];boxes:never[]};
  const solid=JSON.parse(readFileSync('public/models/solid-island-collision.json','utf8')) as {positions:number[];indices:number[];boxes:never[]};
  const positions=[...mesh.positions],indices=[...mesh.indices],offset=mesh.positions.length/3;
  for(const value of solid.positions)positions.push(value);
  for(const index of solid.indices)indices.push(index+offset);
  world.boxes.push(...mesh.boxes,...solid.boxes);
  world.setGeometry(positions,indices);world.prepareRaycasts();
  world.setRecoveryVolumes(solid.positions,solid.indices);
  if(!region)return world;
  const data=JSON.parse(readFileSync(`public/models/${region}-collision.json`,'utf8')) as {positions:number[];indices:number[];boxes:never[];surfaces:never[];walkableLinks?:never[]};
  const attached=new CollisionWorld();
  attached.boxes.push(...data.boxes);attached.surfaces.push(...data.surfaces);
  attached.walkableLinks.push(...(data.walkableLinks??[]));
  attached.setGeometry(data.positions,data.indices);attached.prepareRaycasts();
  world.attachRegion(region,attached);
  world.walkableLinks.push(...(data.walkableLinks??[]));
  return world;
}

/** Arena do cálice, com a mesma cascata de raios que a cena usa. */
function chaliceAt(world:CollisionWorld,island:StageIsland):Vec3|undefined {
  for(const radius of [TOTEM_RADIUS,8.5,6.5]){
    const at=findTotemSite(world,{id:island.id,name:island.name,x:island.x,y:island.y,z:island.z},radius,()=>true);
    if(at)return at;
  }
  return undefined;
}

let navMesh:NavMesh|undefined,query:NavMeshQuery|undefined;
/**
 * `PlayerScene.routeLength` reproduzido sobre o navmesh assado de verdade: soma a polilinha do
 * Detour, em metros. `undefined` quando não há rota — é também a checagem de alcançabilidade.
 */
function routeLength(from:Vec3,to:Vec3):number|undefined {
  const near=query!.findClosestPoint(from);
  if(!near.success||Math.hypot(from.x-near.point.x,from.z-near.point.z)>1.4)return undefined;
  const route=query!.computePath(near.point,to,{maxPathPolys:2048,maxStraightPathPoints:2048});
  const path=route.success?route.path:undefined;
  if(!path?.length)return undefined;
  const end=path[path.length-1]!;
  if(Math.hypot(end.x-to.x,end.z-to.z)>3)return undefined;
  let length=0;
  for(let i=1;i<path.length;i++)length+=Math.hypot(path[i]!.x-path[i-1]!.x,path[i]!.z-path[i-1]!.z);
  return length;
}
const routeExists=(from:Vec3,to:Vec3):boolean=>routeLength(from,to)!==undefined;

beforeAll(async()=>{
  await init();
  navMesh=importNavMesh(new Uint8Array(readFileSync('public/models/farm-navmesh.bin'))).navMesh;
  query=new NavMeshQuery(navMesh,{maxNodes:8192});
  query.defaultQueryHalfExtents={x:2,y:3,z:2};
});
afterAll(()=>{query?.destroy();navMesh?.destroy();});

/** Plano do estágio sobre colisão e navegação reais, como `PlayerScene.buildStageSetup`. */
function realPlan(seed:string,stage:number):StagePlan|undefined {
  const biome=biomeForStage(stage),world=worldFor(biome.region);
  const rng=new RunRNG(`${seed}:stage:${stage}`).stream('scene');
  return planStage(biome,rng,{
    spawnPoint:island=>findSpawnPoint(world,island),
    chalicePoint:island=>chaliceAt(world,island),
    route:(spawn,chalice)=>routeLength(spawn,chalice),
  },{minRoute:minRouteFor(biome)});
}
const minRouteFor=(biome:{separation:number}):number=>
  biome.separation>=WIDE_ISLAND_SEPARATION?WIDE_MIN_ROUTE:HOME_MIN_ROUTE;

describe('partida sorteada e cálice em outra ilha, no mundo real',()=>{
  it.each(STAGE_BIOMES.map((biome,index)=>[biome.id,index+1] as const))
  ('%s: nasce numa ilha e o cálice fica em outra, longe e com rota',(_id,stage)=>{
    const biome=biomeForStage(stage),plan=realPlan('rota-real',stage);
    expect(plan,`sem par de ilhas válido em ${biome.name}`).toBeDefined();
    expect(plan!.spawnIsland.id).not.toBe(plan!.chaliceIsland.id);
    expect(plan!.distance).toBeGreaterThanOrEqual(biome.separation);
    expect(plan!.distance).toBeGreaterThanOrEqual(100);
    // A rota é medida nos DOIS sentidos sobre o navmesh que o jogo usa.
    expect(routeExists(plan!.chalice,plan!.spawn)).toBe(true);
    expect(routeExists(plan!.spawn,plan!.chalice)).toBe(true);
  });

  it('a ilha de partida varia entre sementes e nunca coincide com a do cálice',()=>{
    const spawns=new Set<string>();
    for(const seed of ['a','b','c','d','e','f','g','h']){
      const plan=realPlan(seed,1);
      expect(plan).toBeDefined();
      expect(plan!.spawnIsland.id).not.toBe(plan!.chaliceIsland.id);
      expect(planar(plan!.spawn,plan!.chalice)).toBeGreaterThanOrEqual(100);
      spawns.add(plan!.spawnIsland.id);
    }
    expect(spawns.size).toBeGreaterThanOrEqual(2);
  });

  /**
   * Mede a CAMINHADA real, não a reta, sobre o navmesh que o jogo carrega.
   *
   * É este teste que sustenta o piso de `HOME_MIN_ROUTE`/`WIDE_MIN_ROUTE`: sem ele o número seria um
   * palpite. Falhar aqui significa que a topologia autoral atual não sustenta o piso pedido — o que
   * é informação, não bug do planejador.
   */
  it.each(STAGE_BIOMES.map((biome,index)=>[biome.id,index+1] as const))
  ('%s: a caminhada até o cálice cumpre o piso de rota em todas as sementes',(_id,stage)=>{
    const biome=biomeForStage(stage),floor=minRouteFor(biome),measured:number[]=[];
    for(const seed of Array.from({length:24},(_,i)=>`semente-${i}`)){
      const plan=realPlan(seed,stage);
      expect(plan,`sem par de ilhas válido em ${biome.name}`).toBeDefined();
      // O comprimento guardado no plano é o mesmo que o Detour devolve, medido de novo aqui.
      const walked=routeLength(plan!.spawn,plan!.chalice);
      expect(walked,`cálice inalcançável em ${biome.name}`).toBeDefined();
      expect(walked!).toBeCloseTo(plan!.routeLength,0);
      measured.push(walked!);
      expect(plan!.shortfall,
        `${biome.name}: melhor caminhada ${Math.round(walked!)} m < piso ${floor} m (semente ${seed},`
        +` ${plan!.spawnIsland.name} → ${plan!.chaliceIsland.name})`).toBe(false);
    }
    // Medido no navmesh assado em 2026-09: mínimos de 187 m (cidade), 244 m (fronteira),
    // 272 m (campos altos) e 226 m (bosque) — o piso tem folga real, não passa raspando.
    expect(Math.min(...measured)).toBeGreaterThanOrEqual(floor);
  });

  it('o pouso real fica em piso de topo, fora de sólidos e com apoio em volta',()=>{
    const plan=realPlan('pouso',1)!;
    const world=worldFor(biomeForStage(1).region);
    expect(plan).toBeDefined();
    expect(Number.isFinite(plan.spawn.y)).toBe(true);
    expect(world.insideSolid(plan.spawn,1.8)).toBe(false);
    expect(world.sweepSphere({x:plan.spawn.x,y:plan.spawn.y+1,z:plan.spawn.z},{x:0,y:1.6,z:0},.4,true)).toBeFalsy();
    for(let i=0;i<8;i++){
      const angle=i*Math.PI/4,px=plan.spawn.x+Math.sin(angle)*2.5,pz=plan.spawn.z+Math.cos(angle)*2.5;
      expect(Math.abs(world.groundAt(px,pz,plan.spawn.y+1.5)-plan.spawn.y)).toBeLessThanOrEqual(1.5);
    }
  });

  it('cada estágio troca de bioma e o plano é reprodutível pela semente',()=>{
    for(let stage=1;stage<=4;stage++){
      expect(nextBiomeForStage(stage).id).not.toBe(biomeForStage(stage).id);
      const first=realPlan('estável',stage),again=realPlan('estável',stage);
      expect(first).toBeDefined();
      expect([first!.spawnIsland.id,first!.chaliceIsland.id]).toEqual([again!.spawnIsland.id,again!.chaliceIsland.id]);
      expect(first!.spawn).toEqual(again!.spawn);
    }
  });
});

/** Cena mínima com a MESMA ordem de chamadas do `PlayerScene`, sem Babylon. */
class JourneyHarness {
  readonly events=new EventBus<GameEvents>();
  readonly progression=new RunProgression(this.events);
  readonly objectives=new ExpeditionObjectives();
  readonly journey=new StageJourney();
  /** Quantas vezes o destino foi carregado; mede "carrega e avança uma vez só". */
  loads=0;advances=0;applied=0;
  /** Falhas restantes a simular no carregamento do destino. */
  failures=0;
  private pending:TotemSite|undefined;
  constructor(private readonly site:TotemSite){this.objectives.setSites([site]);}
  /** `E` no cálice: só funciona com o cálice cheio, o chefe morto e nenhuma viagem em curso. */
  interact():boolean {
    if(this.journey.failed){this.journey.retryNow();return false;}
    if(this.journey.active)return false;
    if(!this.objectives.collect({...this.site.position}))return false;
    if(!this.journey.begin(this.progression.stage,nextBiomeForStage(this.progression.stage).name)){this.objectives.collected=false;return false;}
    return true;
  }
  frame(dt=1/60):void {
    this.journey.update(dt);
    if(this.journey.takeLoadRequest()){
      this.loads++;
      if(this.failures>0){this.failures--;this.journey.routeFailed('A região não carregou');}
      else{this.pending={...this.site,position:{x:this.site.position.x+180,y:this.site.position.y,z:this.site.position.z}};this.journey.routeReady();}
    }
    if(this.journey.takeArrival()){
      if(this.journey.consumeAdvance())this.progression.advanceStage();
      this.advances++;this.applied++;
      this.objectives.reset();this.objectives.setSites([this.pending!]);
    }
    if(this.journey.phase==='arrival')this.journey.arrived();
    if(this.journey.phase==='done')this.journey.reset();
  }
  run(seconds:number):void {for(let i=0;i<Math.round(seconds*60);i++)this.frame();}
}

function filledChalice():JourneyHarness {
  const site:TotemSite={id:'seeds',name:'Distrito das Sementes',index:0,position:{x:100,y:2,z:8},radius:TOTEM_RADIUS,juiceTarget:FINAL_CHALICE_JUICE};
  const harness=new JourneyHarness(site);
  harness.progression.addItem('pruner');harness.progression.addItem('pruner');harness.progression.addItem('belt');
  for(let i=0;i<40;i++)harness.progression.reward();
  return harness;
}
/** Enche o cálice com abates reais dentro da área e derrota o chefe. */
function completeStage(h:JourneyHarness,bossFirst:boolean):void {
  const at=h.objectives.totems[0]!.site.position;
  h.objectives.activate(at);
  let sequence=0;
  const fill=()=>{while(h.objectives.current&&h.objectives.current.state!=='complete'){
    h.objectives.harvest({sequence:++sequence,kind:'watermelon',position:at},at,true);
  }};
  if(bossFirst){h.objectives.bossSpawned=true;h.objectives.onBossKilled(at);fill();}
  else{fill();h.objectives.bossSpawned=true;h.objectives.onBossKilled(at);}
}

describe('o cálice concluído é que encerra o estágio',()=>{
  it('cálice cheio e chefe morto, em qualquer ordem, liberam o embarque no próprio cálice',()=>{
    for(const bossFirst of [false,true]){
      const h=filledChalice();
      completeStage(h,bossFirst);
      expect(h.objectives.phase).toBe('extract');
      expect(h.objectives.bossDefeated).toBe(true);
      expect(h.objectives.completed).toBe(h.objectives.total);
      // O prompt só aparece JUNTO ao cálice, não em qualquer lugar da ilha.
      const at=h.objectives.totems[0]!.site.position;
      expect(h.objectives.collectable(at)).toBeDefined();
      expect(h.objectives.collectable({x:at.x+TOTEM_ACTIVATION_RANGE+2,y:at.y,z:at.z})).toBeUndefined();
    }
  });

  it('sem chefe morto ou sem cálice cheio o `E` não embarca ninguém',()=>{
    const semChefe=filledChalice(),at=semChefe.objectives.totems[0]!.site.position;
    semChefe.objectives.activate(at);
    let sequence=0;
    while(semChefe.objectives.current&&semChefe.objectives.current.state!=='complete')
      semChefe.objectives.harvest({sequence:++sequence,kind:'watermelon',position:at},at,true);
    expect(semChefe.objectives.phase).toBe('boss');
    expect(semChefe.interact()).toBe(false);
    expect(semChefe.journey.active).toBe(false);

    const semSuco=filledChalice();
    semSuco.objectives.activate(at);
    semSuco.objectives.bossSpawned=true;semSuco.objectives.onBossKilled(at);
    expect(semSuco.objectives.phase).toBe('boss');
    expect(semSuco.interact()).toBe(false);
    expect(semSuco.journey.active).toBe(false);
  });

  it('carrega o destino e avança o estágio uma única vez, por mais `E` que se aperte',()=>{
    const h=filledChalice();
    completeStage(h,false);
    expect(h.interact()).toBe(true);
    for(let i=0;i<20;i++)expect(h.interact()).toBe(false);
    h.run(JOURNEY_HARVEST_SECONDS+JOURNEY_BOARD_SECONDS+JOURNEY_MIN_TRAVEL_SECONDS+1);
    expect(h.loads).toBe(1);
    expect(h.advances).toBe(1);
    expect(h.progression.stage).toBe(2);
    // A viagem terminou e o novo cálice está em pé, sem suco recolhido.
    expect(h.journey.phase).toBe('idle');
    expect(h.objectives.phase).toBe('totems');
    expect(h.objectives.collected).toBe(false);
    h.run(10);
    expect(h.advances).toBe(1);
    expect(h.progression.stage).toBe(2);
  });

  it('preserva TODOS os itens, o nível e o XP na travessia',()=>{
    const h=filledChalice();
    completeStage(h,true);
    const inventory=[...h.progression.inventory],level=h.progression.level,xp=h.progression.xp;
    const credits=h.progression.credits,damage=h.progression.stats.damage,armor=h.progression.stats.armor;
    expect(credits).toBeGreaterThan(0);
    expect(inventory.length).toBeGreaterThan(0);
    h.interact();
    h.run(JOURNEY_HARVEST_SECONDS+JOURNEY_BOARD_SECONDS+JOURNEY_MIN_TRAVEL_SECONDS+1);
    expect([...h.progression.inventory]).toEqual(inventory);
    // Atributos nunca encolhem: os itens seguem inteiros e o nível só pode ter subido.
    expect(h.progression.stats.damage).toBeGreaterThanOrEqual(damage-1e-9);
    expect(h.progression.stats.armor).toBe(armor);
    expect(h.progression.level).toBeGreaterThanOrEqual(level);
    // Regra existente e anunciada na interface: os créditos restantes viram XP no embarque.
    expect(h.progression.credits).toBe(0);
    expect(h.progression.level>level||h.progression.xp>=xp).toBe(true);
  });

  it('uma falha de carregamento não avança de estágio nem perde inventário, e a retomada funciona',()=>{
    const h=filledChalice();
    completeStage(h,false);
    h.failures=2;
    const inventory=[...h.progression.inventory],stage=h.progression.stage;
    h.interact();
    h.run(JOURNEY_HARVEST_SECONDS+JOURNEY_BOARD_SECONDS+.1);
    expect(h.loads).toBe(1);
    expect(h.journey.failed).toBe(true);
    expect(h.progression.stage).toBe(stage);
    expect(h.advances).toBe(0);
    // Uma nova tentativa automática por espera; nada avança enquanto falha.
    h.run(JOURNEY_RETRY_SECONDS+.2);
    expect(h.loads).toBe(2);
    expect(h.progression.stage).toBe(stage);
    h.run(JOURNEY_RETRY_SECONDS+JOURNEY_MIN_TRAVEL_SECONDS+.5);
    expect(h.loads).toBe(3);
    expect(h.advances).toBe(1);
    expect(h.progression.stage).toBe(stage+1);
    expect([...h.progression.inventory]).toEqual(inventory);
  });

  it('a transição reinicia o objetivo do próximo estágio em vez de herdar o anterior',()=>{
    const h=filledChalice();
    completeStage(h,false);
    const before=h.objectives.totems[0]!.site.position;
    h.interact();
    h.run(JOURNEY_HARVEST_SECONDS+JOURNEY_BOARD_SECONDS+JOURNEY_MIN_TRAVEL_SECONDS+1);
    const after=h.objectives.totems[0]!.site.position;
    expect(after).not.toEqual(before);
    expect(h.objectives.phase).toBe('totems');
    expect(h.objectives.discovered).toBe(false);
    expect(h.objectives.bossSpawned).toBe(false);
    expect(h.objectives.bossDefeated).toBe(false);
    expect(h.objectives.current).toBeUndefined();
    expect(h.objectives.totems[0]!.charged).toBe(0);
    expect(h.objectives.rewardsPending).toBe(0);
  });
});
