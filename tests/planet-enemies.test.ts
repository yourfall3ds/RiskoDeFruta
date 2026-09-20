import {describe,it,expect} from 'vitest';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {Scene} from '@babylonjs/core/scene';
import {AssetContainer} from '@babylonjs/core/assetContainer';
import {CreateBox} from '@babylonjs/core/Meshes/Builders/boxBuilder';
import {DirectionalLight} from '@babylonjs/core/Lights/directionalLight';
import {ShadowGenerator} from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {EventBus} from '../src/core/EventBus';
import type {DamageContext,GameEvents,Vec3} from '../src/core/contracts';
import {RunRNG} from '../src/core/RunRNG';
import {RunProgression} from '../src/run/RunProgression';
import {EnemySwarm} from '../src/game/EnemySwarm';
import {CollisionWorld} from '../src/physics/CollisionWorld';
import {PlayerMotor} from '../src/player/PlayerMotor';
import {PlanetFrame} from '../src/planet/PlanetFrame';
import {PlanetCollision} from '../src/planet/PlanetCollision';
import {chooseSpawnAround} from '../src/ai/SpawnPlanner';
import {ENEMY_BEHAVIORS} from '../src/enemies/EnemyBehaviors';
import {SAUCER_SPECIES} from '../src/run/MonsterDirector';
import type {TrainingTarget} from '../src/world/TrainingYard';
import {radialSurface,SIX_POLES,onDeck,sphereShell} from './support/radial-surface';

const R=180;
const frame=new PlanetFrame({centre:{x:0,y:0,z:0},surfaceRadius:R,voidRadius:168,ceilingRadius:320,islandRadius:72});
/** Uma casca só, compartilhada pelos casos: construir a BVH de 65 k triângulos por teste é caro. */
const shell=sphereShell(R);
const planet=new PlanetCollision();
planet.setGeometry(shell.positions,shell.indices);
const surface=radialSurface(frame,planet);

const radius=(p:Vec3)=>Math.hypot(p.x,p.y,p.z);
const altitude=(p:Vec3)=>radius(p)-R;
/** Vertical local que a horda escreveu na pose da raiz, lida da matriz de mundo do nó. */
const poseUp=(node:{computeWorldMatrix:(force:boolean)=>unknown;getWorldMatrix:()=>never}):Vector3=>{
  node.computeWorldMatrix(true);
  return Vector3.TransformNormal(Vector3.Up(),node.getWorldMatrix()).normalize();
};

async function setup(direction:Vec3){
  const engine=new NullEngine(),scene=new Scene(engine),events=new EventBus<GameEvents>();
  const collision=new CollisionWorld();
  const start=onDeck(frame,direction);
  const player=new PlayerMotor(collision,events,start),run=new RunProgression(events);
  player.position.x=start.x;player.position.y=start.y;player.position.z=start.z;
  const world={targets:[] as TrainingTarget[],collision,surface};
  const light=new DirectionalLight('sun',new Vector3(0,-1,0),scene),shadows=new ShadowGenerator(128,light);
  const swarm=new EnemySwarm(scene,world,events,shadows,player,run,new RunRNG('planet-enemies'));
  await swarm.load(async model=>{const c=new AssetContainer(scene),mesh=CreateBox(model,{size:1},scene);c.meshes.push(mesh);c.populateRootNodes();c.removeAllFromScene();return c;});
  swarm.initialize();swarm.populationCap=50;swarm.benchmark=true;swarm.director.stopped=true;
  return{engine,scene,events,player,run,swarm,collision,start,
    close:()=>{swarm.dispose();scene.dispose();engine.dispose();}};
}
type Harness=Awaited<ReturnType<typeof setup>>;

/** Ponto do convés a `arc` metros do jogador, na direção tangente `angle`. */
function nearby(t:Harness,arc:number,angle=0):Vec3 {
  const basis=frame.basisAt(t.player.position,{x:0,y:0,z:1});
  const s=Math.sin(angle)*arc,c=Math.cos(angle)*arc;
  const guess={
    x:t.player.position.x+basis.right.x*s+basis.forward.x*c,
    y:t.player.position.y+basis.right.y*s+basis.forward.y*c,
    z:t.player.position.z+basis.right.z*s+basis.forward.z*c,
  };
  const support=surface.support(guess,8,20);
  return support?{...support.point}:guess;
}

const damage=(id:number,amount:number,at:Vec3):DamageContext=>({
  attackerId:1,victimId:id,sourceId:'dual_pistols',attackId:'right',baseDamage:amount,finalDamage:amount,
  crit:false,procCoefficient:1,procChainDepth:0,damageTags:['bullet'],hitPosition:at,
  hitNormal:frame.up(at),forceDirection:frame.basisAt(at,{x:0,y:0,z:1}).forward,forceMagnitude:2,
});

describe('a horda ORIGINAL na esfera, nos seis polos',()=>{
  it.each(SIX_POLES.map(p=>[p.name,p.direction] as const))('%s: nasce, persegue e continua apoiada no convés',async(_name,direction)=>{
    const t=await setup(direction);
    try{
      const at=nearby(t,14);
      expect(t.swarm.spawn('eggplant',at,'normal')).toBe(true);
      const a=t.swarm.actors[0]!;
      // Nasceu no convés, de pé na radial daquele ponto — não deitado por um `+Y` de mundo.
      expect(Math.abs(altitude(a.root.position))).toBeLessThan(.35);
      expect(a.root.rotationQuaternion).not.toBeNull();
      const up=frame.up(a.root.position);
      expect(Vector3.Dot(poseUp(a.root as never),new Vector3(up.x,up.y,up.z))).toBeGreaterThan(.999);
      const opening=frame.arcDistance(a.root.position,t.player.position);
      for(let i=0;i<240;i++)t.swarm.fixedUpdate(1/60);
      // Andou de verdade sobre a casca e NUNCA saiu dela.
      expect(Math.abs(altitude(a.root.position))).toBeLessThan(.5);
      expect(frame.arcDistance(a.root.position,t.player.position)).toBeLessThan(opening);
      expect(Number.isFinite(a.root.position.x)).toBe(true);
    }finally{t.close();}
  });

  it.each(SIX_POLES.map(p=>[p.name,p.direction] as const))('%s: o aviso de área deita no convés e o dano respeita a porta de altura radial',async(_name,direction)=>{
    const t=await setup(direction);
    try{
      const spot=nearby(t,0);
      t.swarm.effects.warning(spot,2,.1,12,7,'root');
      const w=t.swarm.effects.warnings.find(x=>x.active)!;
      // O decalque sobe pela radial, não por `+Y`, e fica encostado no convés.
      expect(altitude(w.mesh.position)).toBeGreaterThan(-.01);
      expect(altitude(w.mesh.position)).toBeLessThan(.2);
      expect(w.mesh.rotationQuaternion).not.toBeNull();
      const decalUp=Vector3.TransformNormal(Vector3.Up(),w.mesh.getWorldMatrix()).normalize();
      const radial=frame.up(spot);
      expect(Vector3.Dot(decalUp,new Vector3(radial.x,radial.y,radial.z))).toBeGreaterThan(.999);
      const before=t.player.hp;
      for(let i=0;i<9;i++)t.swarm.fixedUpdate(1/60);
      expect(t.player.hp).toBeLessThan(before);
    }finally{t.close();}
  });

  it.each(SIX_POLES.map(p=>[p.name,p.direction] as const))('%s: o projétil cai PARA O CENTRO do planeta e assenta no convés',async(_name,direction)=>{
    const t=await setup(direction);
    try{
      const origin=nearby(t,9);
      const launch={x:origin.x,y:origin.y,z:origin.z};
      const up=frame.up(launch);
      const high={x:launch.x+up.x*6,y:launch.y+up.y*6,z:launch.z+up.z*6};
      // Tiro para cima: a única coisa que pode trazê-lo de volta é a gravidade radial local.
      t.swarm.effects.projectile(high,{x:high.x+up.x*10,y:high.y+up.y*10,z:high.z+up.z*10},6,0,99,11);
      const p=t.swarm.effects.projectiles.find(x=>x.active)!;
      const peak=radius(p.position);
      let apex=peak;
      for(let i=0;i<360&&p.active;i++){t.swarm.fixedUpdate(1/60);apex=Math.max(apex,radius(p.position));}
      // Subiu e voltou: a queda aconteceu na radial DESTE ponto, em qualquer polo.
      expect(apex).toBeGreaterThan(peak);
      expect(p.active).toBe(false);
    }finally{t.close();}
  });

  it.each(SIX_POLES.map(p=>[p.name,p.direction] as const))('%s: morte, cadáver e colheita continuam iguais',async(_name,direction)=>{
    const t=await setup(direction);
    try{
      const harvests:GameEvents['FruitHarvested'][]=[];
      t.events.on('FruitHarvested',kill=>harvests.push(kill));
      const at=nearby(t,10);
      t.swarm.spawn('carrot',at,'normal');
      const a=t.swarm.actors[0]!;
      a.target.onHit!(damage(a.id,999999,at));
      expect(a.health.dead).toBe(true);
      expect(t.run.totalKills).toBe(1);
      expect(harvests).toHaveLength(1);
      // A marca de colheita sai 1 m acima do corpo NA RADIAL dele.
      expect(altitude(harvests[0]!.position)).toBeCloseTo(altitude(a.root.position)+1,3);
      for(let i=0;i<200;i++)t.swarm.fixedUpdate(1/60);
      // O cadáver assentou no convés em vez de cair para `−Y` do mundo (ou flutuar).
      expect(Math.abs(altitude(a.root.position))).toBeLessThan(1.2);
    }finally{t.close();}
  });

  it.each(SIX_POLES.map(p=>[p.name,p.direction] as const))('%s: o anel de nascimento é geodésico e sempre apoiado',async(_name,direction)=>{
    const t=await setup(direction);
    try{
      const rng=new RunRNG('spawn-ring').stream('spawn');
      let found=0;
      for(let i=0;i<24;i++){
        const p=chooseSpawnAround(t.player.position,rng,t.collision,()=>true,()=>false,15,35,surface);
        if(!p)continue;
        found++;
        // O raio pedido é a distância CAMINHÁVEL, não uma corda que corta o globo.
        const arc=frame.arcDistance(p,t.player.position);
        expect(arc).toBeGreaterThanOrEqual(15-1e-6);
        expect(arc).toBeLessThan(36);
        expect(Math.abs(altitude(p))).toBeLessThan(.3);
      }
      expect(found).toBeGreaterThan(20);
    }finally{t.close();}
  });
});

describe('o que a esfera quebraria se ninguém olhasse',()=>{
  it('um hostil no polo OPOSTO não vê nem ataca o jogador através do globo',async()=>{
    const t=await setup({x:0,y:1,z:0});
    try{
      // Mesmo (x,z) do jogador — o que a medida planar antiga leria como distância zero.
      const antipode=onDeck(frame,{x:0,y:-1,z:0});
      expect(t.swarm.spawn('corn',antipode,'normal')).toBe(true);
      const a=t.swarm.actors[0]!;
      expect(Math.hypot(a.root.position.x-t.player.position.x,a.root.position.z-t.player.position.z)).toBeLessThan(1e-6);
      // Arco de meia volta: nada de alcance, nada de janela de altura.
      expect(frame.arcDistance(a.root.position,t.player.position)).toBeCloseTo(Math.PI*R,3);
      const before=t.player.hp;
      for(let i=0;i<240;i++)t.swarm.fixedUpdate(1/60);
      expect(a.state).not.toBe('windup');
      expect(t.player.hp).toBe(before);
      expect(t.swarm.effects.projectiles.some(p=>p.active)).toBe(false);
    }finally{t.close();}
  });

  it('a grade de separação é 3D: corpos antípodas não empurram um ao outro',async()=>{
    const t=await setup({x:0,y:1,z:0});
    try{
      const here=nearby(t,6),there=onDeck(frame,{x:0,y:-1,z:0});
      t.swarm.spawn('eggplant',here,'normal');
      t.swarm.spawn('eggplant',there,'normal');
      const [a,b]=t.swarm.actors;
      const antipodeStart=b!.root.position.clone();
      for(let i=0;i<60;i++)t.swarm.fixedUpdate(1/60);
      // O corpo do outro lado do globo continua apoiado no convés dele, sem empurrão fantasma.
      expect(Math.abs(altitude(b!.root.position))).toBeLessThan(.5);
      expect(Math.abs(altitude(a!.root.position))).toBeLessThan(.5);
      // Ele anda (persegue pelo arco), mas o deslocamento é o da própria perseguição — em 1 s, a
      // velocidade de catálogo do berinjela. Um empurrão de separação antípoda daria um salto.
      expect(Vector3.Distance(antipodeStart,b!.root.position)).toBeLessThan(8);
      // E os dois continuam a meia volta um do outro: ninguém foi teletransportado.
      expect(frame.arcDistance(a!.root.position,b!.root.position)).toBeGreaterThan(R*2.5);
    }finally{t.close();}
  });

  it('a investida comprometida anda pelo convés e não vira corda para dentro do planeta',async()=>{
    const t=await setup({x:.4,y:-.7,z:.59});
    try{
      const at=nearby(t,8);
      t.swarm.spawn('eggplant',at,'normal');
      const a=t.swarm.actors[0]!;
      a.state='windup';a.time=0;a.locked={...t.player.position};a.direction={x:0,z:0};
      let lowest=0;
      for(let i=0;i<180;i++){t.swarm.fixedUpdate(1/60);lowest=Math.min(lowest,altitude(a.root.position));}
      expect(lowest).toBeGreaterThan(-1);
      expect(Math.abs(altitude(a.root.position))).toBeLessThan(.6);
      // Chegou perto o bastante para o contato do `recover` — a receita não foi cancelada.
      expect(frame.arcDistance(a.root.position,t.player.position)).toBeLessThan(8);
    }finally{t.close();}
  });

  it('todas as receitas do catálogo continuam existindo e decidindo igual',async()=>{
    const t=await setup({x:0,y:0,z:1});
    try{
      // Nenhuma espécie, afixo ou aviso sumiu no porte: o catálogo da fazenda é o de sempre.
      // A lista deixou de ser igualdade exata quando as espécies dos discos voadores entraram
      // (`SAUCER_SPECIES`): o invariante que este teste defende é que nada SUMIU, não que nada
      // possa ser acrescentado. As duas metades são verificadas separadamente, sem "contém".
      const kinds=Object.keys(ENEMY_BEHAVIORS).sort();
      expect(kinds.filter(kind=>!SAUCER_SPECIES.includes(kind as never)))
        .toEqual(['boss','carrot','corn','eggplant','tomato','watermelon']);
      expect(kinds.filter(kind=>SAUCER_SPECIES.includes(kind as never)))
        .toEqual([...SAUCER_SPECIES].sort());
      const at=nearby(t,3);
      const close={id:1,attack:1,time:0,direction:{x:0,z:0},locked:at,root:{position:at}};
      // A 3 m o berinjela morde; a decisão é a MESMA com e sem superfície, porque a medida é arco.
      expect(ENEMY_BEHAVIORS.eggplant.telegraph(close)).toEqual({shape:'none'});
      const far=nearby(t,9);
      const lunge={id:1,attack:1,time:0,direction:{x:0,z:0},locked:far,root:{position:at}};
      expect(ENEMY_BEHAVIORS.eggplant.telegraph(lunge).shape).toBe('band');
      expect(ENEMY_BEHAVIORS.tomato.telegraph(close)).toEqual({shape:'circle',radius:2.3,kind:'fire-intent'});
      expect(ENEMY_BEHAVIORS.boss.telegraph({...close,attack:4})).toEqual({shape:'cone',radius:7});
    }finally{t.close();}
  });

  it('o chefe nasce, é alcançável e o abate segue emitindo os mesmos eventos',async()=>{
    const t=await setup({x:-1,y:0,z:0});
    try{
      const spawned:number[]=[];
      t.events.on('BossSpawned',e=>spawned.push(e.entityId));
      let killed=false;
      t.events.on('BossKilled',()=>{killed=true;});
      expect(t.swarm.requestBoss()).toBe(true);
      const boss=t.swarm.boss!;
      expect(spawned).toHaveLength(1);
      expect(Math.abs(altitude(boss.root.position))).toBeLessThan(.4);
      // O anel do chefe é 20–34 m de ARCO a partir do jogador.
      const arc=frame.arcDistance(boss.root.position,t.player.position);
      expect(arc).toBeGreaterThan(19);expect(arc).toBeLessThan(35);
      expect(t.swarm.bossReachable).toBe(true);
      boss.target.onHit!(damage(boss.id,999999,boss.root.position));
      expect(killed).toBe(true);
      expect(t.swarm.director.state).toBe(5);
    }finally{t.close();}
  });
});
