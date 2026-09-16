import {describe,it,expect} from 'vitest';
import fs from 'node:fs';
import zlib from 'node:zlib';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {Scene} from '@babylonjs/core/scene';
import {AssetContainer} from '@babylonjs/core/assetContainer';
import {CreateBox} from '@babylonjs/core/Meshes/Builders/boxBuilder';
import {DirectionalLight} from '@babylonjs/core/Lights/directionalLight';
import {ShadowGenerator} from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {LoadAssetContainerAsync} from '@babylonjs/core/Loading/sceneLoader';
import '@babylonjs/loaders/glTF';
import {EventBus} from '../src/core/EventBus';
import type {GameEvents,Vec3} from '../src/core/contracts';
import {RunRNG} from '../src/core/RunRNG';
import {RunProgression} from '../src/run/RunProgression';
import {EnemySwarm} from '../src/game/EnemySwarm';
import {CollisionWorld} from '../src/physics/CollisionWorld';
import {PlayerMotor} from '../src/player/PlayerMotor';
import {PlanetFrame} from '../src/planet/PlanetFrame';
import {PlanetCollision} from '../src/planet/PlanetCollision';
import {SphereSurface} from '../src/physics/SphereSurface';
import {FruitFragments} from '../src/vfx/FruitFragments';
import {CorpseDebris} from '../src/physics/CorpseDebris';
import {ElementalEffects} from '../src/vfx/ElementalEffects';
import type {FragmentLoader} from '../src/vfx/FragmentLibrary';
import type {TrainingTarget} from '../src/world/TrainingYard';
import type {Mesh} from '@babylonjs/core/Meshes/mesh';

const MANIFEST='public/models/planet-archipelago.json.gz';
const FRAGMENTS='public/models/fruit-fragments.glb';
const ready=fs.existsSync(MANIFEST)&&fs.existsSync(FRAGMENTS);
const FRAMES=Number(process.env.PERF_FRAMES??240);
const now=()=>Number(process.hrtime.bigint())/1e6;

/**
 * Perfil do laço de APRESENTAÇÃO da horda contra o mapa autoral de 1,75 M de triângulos.
 *
 * O campo relatou `presentation 45,59 ms` com `sim 2,48 ms` e ZERO ragdolls logo depois de uma
 * habilidade matar ~6 pragas. Isto mede, com o mapa de verdade e a `SphereSurface` de produção,
 * quanto dessa conta é do subsistema de inimigos — e onde exatamente.
 *
 * Não é um teste de limiar apertado (a máquina de CI varia): ele IMPRIME o perfil e só falha se o
 * custo sair da ordem de grandeza em que foi medido, que é o que pegaria uma regressão de verdade.
 */
describe.skipIf(!ready)('perfil da apresentação da horda no planeta',()=>{
  it('mede update/fixedUpdate e cada pool de efeito com a malha autoral',async()=>{
    const manifest=JSON.parse(zlib.gunzipSync(fs.readFileSync(MANIFEST)).toString());
    const planet=new PlanetCollision();
    const buildStart=now();
    planet.setGeometry(manifest.positions,manifest.indices);
    const buildMs=now()-buildStart;
    const frame=new PlanetFrame({
      centre:manifest.centre??{x:0,y:0,z:0},surfaceRadius:manifest.radius,
      voidRadius:manifest.radius-12,ceilingRadius:manifest.radius*1.8,islandRadius:72,
    });
    const surface=new SphereSurface(frame,planet);
    console.log(`\n[planeta] ${manifest.indices.length/3} triângulos · BVH ${buildMs.toFixed(0)} ms`);

    const island=[...manifest.islands].sort((a:{radius:number},b:{radius:number})=>b.radius-a.radius)[0];
    const start=surface.support(island.centre,12,30)?.point??island.centre;

    const engine=new NullEngine(),scene=new Scene(engine),events=new EventBus<GameEvents>();
    const collision=new CollisionWorld();
    const player=new PlayerMotor(collision,events,start);
    player.position.x=start.x;player.position.y=start.y;player.position.z=start.z;
    const progression=new RunProgression(events);
    const world={targets:[] as TrainingTarget[],collision,surface};
    const light=new DirectionalLight('sun',new Vector3(0,-1,0),scene),shadows=new ShadowGenerator(128,light);
    const swarm=new EnemySwarm(scene,world,events,shadows,player,progression,new RunRNG('perf'));
    await swarm.load(async model=>{const c=new AssetContainer(scene),mesh=CreateBox(model,{size:1},scene);c.meshes.push(mesh);c.populateRootNodes();c.removeAllFromScene();return c;});
    swarm.initialize();swarm.populationCap=60;swarm.benchmark=true;swarm.director.stopped=true;

    const near=(arc:number,angle:number):Vec3=>{
      const basis=frame.basisAt(player.position,{x:0,y:0,z:1});
      const s=Math.sin(angle)*arc,c=Math.cos(angle)*arc;
      const guess={
        x:player.position.x+basis.right.x*s+basis.forward.x*c,
        y:player.position.y+basis.right.y*s+basis.forward.y*c,
        z:player.position.z+basis.right.z*s+basis.forward.z*c,
      };
      return surface.support(guess,8,20)?.point??guess;
    };
    const kinds=['eggplant','carrot','corn','tomato','watermelon'] as const;
    for(let i=0;i<12;i++)swarm.spawn(kinds[i%kinds.length]!,near(6+(i%5)*2,i/12*Math.PI*2),'normal');
    // A habilidade 2 mata ~6 de uma vez: é esse instante que precisa ser medido.
    for(const actor of swarm.actors.filter(a=>a.active).slice(0,6))actor.target.onHit?.({
      attackerId:1,victimId:actor.id,sourceId:'dual_pistols',attackId:'right',baseDamage:999999,
      finalDamage:999999,crit:false,procCoefficient:1,procChainDepth:0,damageTags:['bullet'],
      hitPosition:actor.root.position,hitNormal:frame.up(actor.root.position),
      forceDirection:frame.basisAt(actor.root.position,{x:0,y:0,z:1}).forward,forceMagnitude:2,
    });
    swarm.update(1/60);

    const measure=(label:string,fn:()=>void):number=>{
      for(let i=0;i<30;i++)fn();
      const t0=now();
      for(let i=0;i<FRAMES;i++)fn();
      const ms=(now()-t0)/FRAMES;
      console.log(`  ${label.padEnd(34)} ${ms.toFixed(3).padStart(8)} ms/quadro`);
      return ms;
    };

    console.log(`[horda] ${swarm.count} vivos · ${swarm.actors.filter(a=>a.active).length} atores ativos · ragdolls ${swarm.ragdollCount}`);
    const update=measure('swarm.update',()=>swarm.update(1/60));
    const fixed=measure('swarm.fixedUpdate',()=>swarm.fixedUpdate(1/60));
    const render=measure('  effects.render',()=>swarm.effects.render(1/60));

    // Os cacos REAIS precisam do molde autoral, que em node entra como data URL.
    const bytes='data:base64,'+fs.readFileSync(FRAGMENTS).toString('base64');
    const loader:FragmentLoader=(_url,target)=>LoadAssetContainerAsync(bytes,target,{pluginExtension:'.glb'});
    const fragments=new FruitFragments(scene,collision,loader);
    fragments.useSurface(surface);
    await fragments.ready;
    const body=CreateBox('victim',{size:1},scene) as Mesh;
    body.position.set(start.x,start.y,start.z);body.computeWorldMatrix(true);
    for(let i=0;i<6;i++)fragments.burst(kinds[i%kinds.length]!,near(2+i,i),{x:0,y:0,z:1},body,1);
    fragments.update(1/60);
    console.log(`[cacos] ${fragments.active}/${fragments.capacity} ativos`);
    const restingMs=measure('  fragments.update (assentados)',()=>fragments.update(1/60));
    /**
     * O caso caro é o caco NO AR: assentado ele sai cedo do laço e nem sonda o apoio. Medir só o
     * regime permanente mediria o barato e esconderia o pico que acontece logo depois da morte.
     */
    const airborne=(():number=>{
      let total=0,samples=0;
      for(let round=0;round<12;round++){
        for(let i=0;i<6;i++)fragments.burst(kinds[i%kinds.length]!,near(2+i,i),{x:0,y:0,z:1},body,1);
        for(let f=0;f<30;f++){const t0=now();fragments.update(1/60);total+=now()-t0;samples++;}
      }
      return total/samples;
    })();
    console.log(`  ${'fragments.update (NO AR)'.padEnd(34)} ${airborne.toFixed(3).padStart(8)} ms/quadro`);
    const fragmentMs=Math.max(restingMs,airborne);

    const debris=new CorpseDebris(collision,surface);
    const shards=Array.from({length:12},(_,i)=>{const m=CreateBox('shard-'+i,{size:.4},scene) as Mesh;m.position.set(start.x+i*.3,start.y+2,start.z);m.computeWorldMatrix(true);return m;});
    debris.fracture([body,...shards],body);
    const debrisMs=measure('  debris.update (12 cacos)',()=>debris.update(1/60));

    const elements=new ElementalEffects(scene,collision,surface);
    elements.emit('earth',new Vector3(start.x,start.y,start.z),1.4);
    const grainMs=measure('  elemental.update (grãos)',()=>elements.update(1/60));

    const owned=update+fragmentMs+debrisMs+grainMs;
    console.log(`\n[total do subsistema de inimigos por quadro] ${owned.toFixed(2)} ms`);
    console.log(`  (o campo relatou 45,59 ms de apresentação; o que não estiver aqui está fora destes arquivos)`);

    // O contrato: a apresentação da horda tem de caber com folga num quadro de 60 Hz.
    expect(fragments.active).toBeGreaterThan(0);
    expect(owned).toBeLessThan(8);
    expect(fixed).toBeLessThan(8);
    expect(render).toBeLessThan(2);

    elements.dispose();fragments.dispose();debris.clear();
    swarm.dispose();scene.dispose();engine.dispose();
  },300000);
});
