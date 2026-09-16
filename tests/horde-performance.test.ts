import { describe,it,expect } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { AssetContainer } from '@babylonjs/core/assetContainer';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { EventBus } from '../src/core/EventBus';
import type { GameEvents } from '../src/core/contracts';
import { RunRNG } from '../src/core/RunRNG';
import { RunProgression } from '../src/run/RunProgression';
import { TacticalNavigation } from '../src/ai/TacticalNavigation';
import { EnemySwarm } from '../src/game/EnemySwarm';
import { CollisionWorld } from '../src/physics/CollisionWorld';
import { PlayerMotor } from '../src/player/PlayerMotor';
import type { EnemyKind } from '../src/run/MonsterDirector';
import { ENEMY_BEHAVIORS } from '../src/enemies/EnemyBehaviors';
import type { TrainingTarget } from '../src/world/TrainingYard';

/**
 * Custo de CPU da horda medido sobre a implementação real (`EnemySwarm.fixedUpdate` +
 * `EnemySwarm.update` + `updateCameraVisibility`), não sobre um laço inventado.
 *
 * LIMITES HONESTOS DESTA MEDIÇÃO — ela NÃO é FPS:
 * - `NullEngine` não rasteriza: GPU, draw calls, overdraw e shadow map ficam de fora.
 * - Os modelos são caixas sem esqueleto nem clipes, então o custo de skinning/`AnimationStateMachine`/
 *   `PosePalette` NÃO entra na conta; o que sobra é IA, colisão, telegraph, seleção e alocação.
 * - Número absoluto depende da máquina. O que vale é a comparação antes/depois no mesmo host.
 */
const KINDS=['eggplant','corn','watermelon','tomato','carrot'] as const satisfies readonly EnemyKind[];
const MEASURE=process.env.HORDE_BENCH==='1';

async function setup(nav:'tactical'|'grid'){
  const engine=new NullEngine(),scene=new Scene(engine),events=new EventBus<GameEvents>(),collision=new CollisionWorld();
  collision.surfaces.push({id:'field',x:0,z:0,width:200,depth:200,height:0});
  const player=new PlayerMotor(collision,events,{x:0,y:0,z:0}),run=new RunProgression(events),world={targets:[] as TrainingTarget[],collision};
  player.debugInvincible=true;
  const light=new DirectionalLight('sun',new Vector3(0,-1,0),scene),shadows=new ShadowGenerator(128,light);
  const swarm=new EnemySwarm(scene,world,events,shadows,player,run,new RunRNG('horde-perf'));
  await swarm.load(async model=>{const c=new AssetContainer(scene),mesh=CreateBox(model,{size:1},scene);c.meshes.push(mesh);c.populateRootNodes();c.removeAllFromScene();return c;});
  if(nav==='tactical')swarm.tactical=await TacticalNavigation.create(collision);
  swarm.initialize();
  swarm.benchmark=true;swarm.director.stopped=true;
  // Contadores determinísticos: não dependem de relógio nem da máquina, então servem de prova
  // algorítmica do antes/depois mesmo quando o wall-clock oscila.
  const counters={sweepSphere:0,groundAt:0,move:0};
  const sweep=collision.sweepSphere.bind(collision),ground=collision.groundAt.bind(collision),move=collision.move.bind(collision);
  collision.sweepSphere=((...a:Parameters<typeof sweep>)=>{counters.sweepSphere++;return sweep(...a);}) as typeof sweep;
  collision.groundAt=((...a:Parameters<typeof ground>)=>{counters.groundAt++;return ground(...a);}) as typeof ground;
  collision.move=((...a:Parameters<typeof move>)=>{counters.move++;return move(...a);}) as typeof move;
  return {engine,scene,events,player,run,swarm,collision,counters,close:()=>{swarm.dispose();scene.dispose();engine.dispose();}};
}

/** Anéis de 7 a 38 m: cobre as três faixas do `AIScheduler` (perto/médio/longe) como numa horda real. */
function populate(swarm:EnemySwarm,count:number):void {
  swarm.populationCap=count;
  for(let i=0;i<count;i++){
    const ring=7+(i%6)*6.2,angle=i/count*Math.PI*2*3.7;
    swarm.spawn(KINDS[i%KINDS.length]!,{x:Math.sin(angle)*ring,y:0,z:Math.cos(angle)*ring},'normal');
  }
}

interface Sample {fixedMs:number;renderMs:number;crowdMs:number;frames:number;sweep:number;ground:number;move:number}
/** `crowdMs` isola o passo do Detour (WASM), que não é alvo desta tarefa, do resto da horda. */
function instrumentCrowd(swarm:EnemySwarm):()=>number {
  const tactical=swarm.tactical;if(!tactical)return ()=>0;
  const original=tactical.step.bind(tactical);let total=0;
  tactical.step=(dt:number,target:{x:number;y:number;z:number})=>{const mark=performance.now();original(dt,target);total+=performance.now()-mark;};
  return ()=>total;
}
function run(t:Awaited<ReturnType<typeof setup>>,frames:number,crowd:()=>number):Sample {
  const dt=1/60,camera={x:0,y:1.6,z:-6};
  let fixedMs=0,renderMs=0;const crowdBefore=crowd(),c={...t.counters};
  for(let i=0;i<frames;i++){
    let mark=performance.now();
    t.swarm.fixedUpdate(dt);
    fixedMs+=performance.now()-mark;
    mark=performance.now();
    t.swarm.update(dt);
    t.swarm.updateCameraVisibility(camera,dt);
    renderMs+=performance.now()-mark;
  }
  return {fixedMs,renderMs,crowdMs:crowd()-crowdBefore,frames,
    sweep:t.counters.sweepSphere-c.sweepSphere,ground:t.counters.groundAt-c.groundAt,move:t.counters.move-c.move};
}

async function measure(nav:'tactical'|'grid',count:number,frames:number,repeats:number):Promise<Sample> {
  let best:Sample|undefined;
  for(let r=0;r<repeats;r++){
    const t=await setup(nav);
    try {
      populate(t.swarm,count);
      const crowd=instrumentCrowd(t.swarm);
      run(t,30,crowd); // aquecimento: JIT + primeira alocação dos pools
      const sample=run(t,frames,crowd);
      if(!best||sample.fixedMs+sample.renderMs<best.fixedMs+best.renderMs)best=sample;
      expect(t.swarm.count).toBe(count);
      expect(t.swarm.actors.every(a=>Number.isFinite(a.root.position.x)&&Number.isFinite(a.root.position.z))).toBe(true);
    } finally {t.close();}
  }
  return best!;
}

describe('custo de CPU da horda',()=>{
  it('mantém a horda íntegra e mede o custo por frame em 24/48/80 atores',async()=>{
    const frames=MEASURE?600:120,repeats=MEASURE?3:1;
    const rows:string[]=[];
    for(const nav of ['tactical','grid'] as const)for(const count of [24,48,80]){
      const s=await measure(nav,count,frames,repeats);
      const fixed=s.fixedMs/s.frames,render=s.renderMs/s.frames,crowd=s.crowdMs/s.frames;
      rows.push(`${nav.padEnd(9)} ${String(count).padStart(3)} atores  fixedUpdate ${fixed.toFixed(3)}  update ${render.toFixed(3)}  total ${(fixed+render).toFixed(3)}  (Detour ${crowd.toFixed(3)} · horda s/ Detour ${(fixed+render-crowd).toFixed(3)}) ms/frame`
        +`  |  sweepSphere ${(s.sweep/s.frames).toFixed(1)}/frame  groundAt ${(s.ground/s.frames).toFixed(1)}/frame  move ${(s.move/s.frames).toFixed(1)}/frame`);
      expect(fixed+render).toBeGreaterThan(0);
    }
    process.stdout.write('\n[horde-cpu] '+frames+' frames/amostra, melhor de '+repeats+' (sem GPU, sem esqueleto)\n'+rows.map(r=>'  '+r).join('\n')+'\n');
  },600_000);
});

/**
 * Hotspot confirmado por QA no Babylon 9.25 instalado: o `set includedOnlyMeshes` chama
 * `_hookArrayForIncludedOnly` → `_resyncMeshes`, que percorre TODAS as malhas da cena. Reatribuir a
 * mesma lista a cada quadro, para cada luz de carga, custava uma varredura completa da cena por quadro.
 */
describe('luzes de carga do tomate não ressincronizam a cena por quadro',()=>{
  function chargeLights(scene:Scene){
    return scene.lights.filter(l=>l.name.startsWith('tomato-incendiary-charge-'));
  }
  /** Comparação por identidade de malha — `toEqual` sobre `Mesh` do Babylon é recursão inútil. */
  function filtersBodyOf(light:{includedOnlyMeshes:readonly object[]},actor:{target:{meshes?:readonly object[]};body:object}):boolean {
    const expected=actor.target.meshes??[actor.body],listed=light.includedOnlyMeshes;
    return listed.length===expected.length&&expected.every((mesh,i)=>listed[i]===mesh);
  }
  function spyResync(scene:Scene){
    let calls=0;
    for(const light of chargeLights(scene)){
      const target=light as unknown as {_resyncMeshes:()=>void};
      const original=target._resyncMeshes.bind(light);
      target._resyncMeshes=()=>{calls++;original();};
    }
    return {get calls(){return calls;},reset(){calls=0;}};
  }

  it('só reatribui a lista quando o ator da luz muda, e luz sem ator fica em intensidade zero',async()=>{
    const t=await setup('grid');
    try {
      expect(t.swarm.spawn('tomato',{x:0,y:0,z:6},'normal')).toBe(true);
      expect(t.swarm.spawn('tomato',{x:0,y:0,z:20},'normal')).toBe(true);
      const [near,far]=t.swarm.actors;
      for(const a of [near!,far!]){a.state='windup';a.time=.3;}
      const lights=chargeLights(t.scene);
      expect(lights).toHaveLength(2);
      const spy=spyResync(t.scene);

      t.swarm.update(1/60);
      // Primeira filiação de cada luz: exatamente uma ressincronização por luz.
      expect(spy.calls).toBe(2);
      expect(lights[0]!.intensity).toBeGreaterThan(0);
      expect(filtersBodyOf(lights[0]!,near!)).toBe(true);

      spy.reset();
      for(let i=0;i<120;i++)t.swarm.update(1/60);
      // Dois segundos com os MESMOS atores carregando: nenhuma varredura de cena.
      expect(spy.calls).toBe(0);
      expect(lights[0]!.intensity).toBeGreaterThan(0);

      // Trocar quem está mais perto troca a filiação — e aí a reatribuição TEM de acontecer.
      near!.root.position.z=40;far!.root.position.z=5;
      t.swarm.update(1/60);
      expect(spy.calls).toBeGreaterThan(0);
      expect(filtersBodyOf(lights[0]!,far!)).toBe(true);

      // Sem tomate carregando: intensidade zero, mas a lista NÃO é esvaziada — lista vazia no Babylon
      // significa "ilumina tudo", o que acenderia o mundo inteiro.
      spy.reset();
      for(const a of [near!,far!])a.state='chase';
      t.swarm.update(1/60);
      for(const light of lights)expect(light.intensity).toBe(0);
      expect(lights[0]!.includedOnlyMeshes.length).toBeGreaterThan(0);
      expect(spy.calls).toBe(0);
    } finally {t.close();}
  },60_000);

  it('a troca de fase limpa o vínculo sem deixar a luz acesa',async()=>{
    const t=await setup('grid');
    try {
      t.swarm.spawn('tomato',{x:0,y:0,z:6},'normal');
      const actor=t.swarm.actors[0]!;actor.state='windup';actor.time=.3;
      t.swarm.update(1/60);
      const lights=chargeLights(t.scene);
      expect(lights[0]!.intensity).toBeGreaterThan(0);
      t.swarm.nextStage();
      for(const light of lights)expect(light.intensity).toBe(0);
      // Reciclado e carregando de novo: a luz volta a filtrar o corpo certo.
      expect(t.swarm.spawn('tomato',{x:0,y:0,z:6},'normal')).toBe(true);
      const revived=t.swarm.actors[0]!;revived.state='windup';revived.time=.3;
      t.swarm.update(1/60);
      expect(lights[0]!.intensity).toBeGreaterThan(0);
      expect(filtersBodyOf(lights[0]!,revived)).toBe(true);
    } finally {t.close();}
  },60_000);
});

describe('integridade da horda sob população alta',()=>{
  it.each([24,80])('%i atores continuam agendados, atacando e telegrafando dentro das vagas',async count=>{
    const t=await setup('tactical');
    try {
      populate(t.swarm,count);
      expect(t.swarm.scheduler.size).toBe(count);
      const frames=600;
      let telegraphs=0,attacks=0,peakMelee=0,peakRanged=0;
      for(let i=0;i<frames;i++){
        t.swarm.fixedUpdate(1/60);t.swarm.update(1/60);
        if(t.swarm.effects.warnings.some(w=>w.active))telegraphs++;
        let melee=0,ranged=0;
        for(const a of t.swarm.actors){
          if(!a.active||a.health.dead)continue;
          if(a.state==='recover')attacks++;
          if(a.state==='windup')(ENEMY_BEHAVIORS[a.kind].ranged?()=>ranged++:()=>melee++)();
        }
        peakMelee=Math.max(peakMelee,melee);peakRanged=Math.max(peakRanged,ranged);
      }
      expect(t.swarm.count).toBe(count);
      expect(t.swarm.scheduler.totalTicks).toBeGreaterThan(frames);
      expect(telegraphs).toBeGreaterThan(0);
      expect(attacks).toBeGreaterThan(0);
      // As vagas simultâneas de ataque continuam valendo com a contagem em cache: o `noteWindup` do
      // tique impede que vários atores do mesmo tique furem o limite que antes o `filter` garantia.
      expect(peakMelee).toBeGreaterThan(0);
      expect(peakMelee).toBeLessThanOrEqual(3);
      expect(peakRanged).toBeLessThanOrEqual(4);
      // A fila de ataque é montada uma única vez por passo fixo, independentemente da população.
      expect(t.swarm.tick.builds).toBe(frames);
      expect(t.swarm.actors.every(a=>Number.isFinite(a.root.position.x))).toBe(true);
    } finally {t.close();}
  },120_000);
});
