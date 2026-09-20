import {describe,it,expect,vi} from 'vitest';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {Scene} from '@babylonjs/core/scene';
import {AssetContainer} from '@babylonjs/core/assetContainer';
import {CreateBox} from '@babylonjs/core/Meshes/Builders/boxBuilder';
import {DirectionalLight} from '@babylonjs/core/Lights/directionalLight';
import {ShadowGenerator} from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {EventBus} from '../src/core/EventBus';
import type {DamageContext,GameEvents} from '../src/core/contracts';
import {RunRNG} from '../src/core/RunRNG';
import {RunProgression} from '../src/run/RunProgression';
import {EnemySwarm,STRAY_DISTANCE,STRAY_REPLACEMENT_INTERVAL,SAUCER_FLEE_DISTANCE} from '../src/game/EnemySwarm';
import {CollisionWorld} from '../src/physics/CollisionWorld';
import {PlayerMotor} from '../src/player/PlayerMotor';
import {SPAWN_RING_MAX} from '../src/ai/SpawnPlanner';
import type {DirectorMode} from '../src/run/MonsterDirector';
import type {TrainingTarget} from '../src/world/TrainingYard';

/**
 * Reciclagem por distância da horda.
 *
 * O problema real: numa expedição o jogador troca de ilha e deixa para trás uma fila de hostis que
 * continua perseguindo por cem metros de arco. Cada um desses corpos continua custando IA, agente
 * do Detour, sondagem de chão e — o que dói — uma vaga do teto de população, então a horda PERTO do
 * jogador fica vazia enquanto o orçamento está todo gasto do outro lado do mapa.
 *
 * A coleira recolhe todos eles de uma vez (parar o trabalho é o objetivo) e devolve UM por intervalo
 * perto do jogador. Nada disso pode virar abate, XP, crédito, colheita, nem sumir com o chefe.
 */
const FRAME=16.7;
async function setup(mode:DirectorMode='expedition'){
  const engine=new NullEngine(),scene=new Scene(engine),events=new EventBus<GameEvents>(),collision=new CollisionWorld();
  collision.surfaces.push({id:'field',x:0,z:0,width:600,depth:600,height:0});
  const player=new PlayerMotor(collision,events,{x:0,y:0,z:0}),run=new RunProgression(events),world={targets:[] as TrainingTarget[],collision};
  const light=new DirectionalLight('sun',new Vector3(0,-1,0),scene),shadows=new ShadowGenerator(128,light);
  const swarm=new EnemySwarm(scene,world,events,shadows,player,run,new RunRNG('recycling-test'),mode);
  await swarm.load(async model=>{const c=new AssetContainer(scene),mesh=CreateBox(model,{size:1},scene);c.meshes.push(mesh);c.populateRootNodes();c.removeAllFromScene();return c;});
  swarm.initialize();
  // `benchmark` FICA falso: é ele que liga a gestão de população. Só a geração normal do diretor é simulada, para
  // que toda mudança de contagem nos casos abaixo tenha vindo da coleira e de mais nada.
  vi.spyOn(swarm.director,'update').mockImplementation(()=>{});
  return {engine,scene,events,player,run,swarm,collision,close:()=>{swarm.dispose();scene.dispose();engine.dispose();}};
}
type Harness=Awaited<ReturnType<typeof setup>>;
const far=(z=STRAY_DISTANCE+8)=>({x:0,y:0,z});
const distanceToPlayer=(t:Harness,p:{x:number;z:number})=>Math.hypot(p.x-t.player.position.x,p.z-t.player.position.z);
const tick=(t:Harness,frames:number)=>{for(let i=0;i<frames;i++){t.swarm.updateBudget(1/60,FRAME);t.swarm.fixedUpdate(1/60);}};
const kill=(id:number):DamageContext=>({attackerId:1,victimId:id,sourceId:'dual_pistols',attackId:'right',baseDamage:999999,finalDamage:999999,crit:false,procCoefficient:1,procChainDepth:0,damageTags:['bullet'],hitPosition:{x:0,y:1,z:0},hitNormal:{x:0,y:0,z:1},forceDirection:{x:0,y:0,z:1},forceMagnitude:2});

describe('coleira: quem ficou longe demais para de custar',()=>{
  it('recolhe o retardatário no mesmo quadro e devolve vaga, agente e alvo clicável',async()=>{
    const t=await setup();
    try{
      expect(t.swarm.spawn('eggplant',{x:0,y:0,z:10},'normal')).toBe(true);
      expect(t.swarm.spawn('eggplant',far(),'normal')).toBe(true);
      t.swarm.director.stopped=true;
      const [near,stray]=t.swarm.actors;
      expect(t.swarm.scheduler.size).toBe(2);

      t.swarm.updateBudget(1/60,FRAME);

      expect(stray!.active).toBe(false);
      expect(stray!.root.isEnabled()).toBe(false);
      expect(stray!.body.isPickable).toBe(false);
      expect((stray!.target.meshes??[stray!.body]).every(mesh=>!mesh.isPickable)).toBe(true);
      // Quem estava perto não é tocado, e o escalonador perdeu exatamente um emprego.
      expect(near!.active).toBe(true);
      expect(t.swarm.scheduler.size).toBe(1);
      expect(t.swarm.strays).toBe(1);
    }finally{t.close();}
  });

  it('recolher NÃO é abater: sem morte, sem abate, sem XP, sem crédito e sem colheita',async()=>{
    const t=await setup();
    try{
      const harvests:GameEvents['FruitHarvested'][]=[];
      t.events.on('FruitHarvested',h=>harvests.push(h));
      expect(t.swarm.spawn('watermelon',far(),'normal')).toBe(true);
      const stray=t.swarm.actors[0]!;

      t.swarm.updateBudget(1/60,FRAME);

      expect(stray.health.dead).toBe(false);
      expect(stray.state).not.toBe('dead');
      expect(t.swarm.kills).toBe(0);
      expect(t.run.totalKills).toBe(0);
      expect(t.run.xp).toBe(0);
      expect(t.run.credits).toBe(0);
      expect(t.swarm.lastKill).toBeUndefined();
      expect(harvests).toHaveLength(0);
    }finally{t.close();}
  });

  it('o chefe nunca é recolhido, por mais longe que o jogador vá',async()=>{
    const t=await setup();
    try{
      expect(t.swarm.spawn('boss',{x:0,y:0,z:STRAY_DISTANCE*2},'normal')).toBe(true);
      const boss=t.swarm.boss!;
      tick(t,240);
      expect(boss.active).toBe(true);
      expect(boss.health.dead).toBe(false);
      expect(t.swarm.boss).toBe(boss);
      expect(t.swarm.strays).toBe(0);
      // Fora de alcance ele deixa de ser objetivo jogável — e quem recoloca é a cena, não a coleira.
      expect(t.swarm.bossReachable).toBe(false);
    }finally{t.close();}
  });

  it('cadáver longe segue o próprio relógio de 7 s em vez de virar retardatário',async()=>{
    const t=await setup();
    try{
      expect(t.swarm.spawn('eggplant',{x:0,y:0,z:8},'normal')).toBe(true);
      const body=t.swarm.actors[0]!;
      body.target.onHit!(kill(body.id));
      expect(body.health.dead).toBe(true);
      body.root.position.set(0,0,STRAY_DISTANCE+20);

      t.swarm.updateBudget(1/60,FRAME);
      expect(t.swarm.strays).toBe(0);
      expect(body.active).toBe(true);
      // E o relógio normal do cadáver continua valendo.
      tick(t,460);
      expect(body.active).toBe(false);
    }finally{t.close();}
  });

  it('avisos e projéteis do corpo recolhido saem do ar e param de ferir',async()=>{
    const t=await setup();
    try{
      expect(t.swarm.spawn('tomato',{x:0,y:0,z:12},'normal')).toBe(true);
      const stray=t.swarm.actors[0]!;
      // Uma poça de fogo com dano real e um projétil, os dois em nome dele.
      expect(t.swarm.effects.warning({x:0,y:0,z:0},2.3,.4,40,stray.id,'fire')).toBeTruthy();
      t.swarm.effects.projectile({x:0,y:3,z:12},{x:0,y:.9,z:0},11,18,stray.id,0,{zone:'fire'});
      expect(t.swarm.effects.warnings.some(w=>w.active&&w.owner===stray.id)).toBe(true);
      expect(t.swarm.effects.projectiles.some(p=>p.active&&p.owner===stray.id)).toBe(true);

      stray.root.position.set(0,0,STRAY_DISTANCE+30);
      const hp=t.player.hp;
      t.swarm.updateBudget(1/60,FRAME);

      expect(t.swarm.effects.warnings.some(w=>w.active&&w.owner===stray.id)).toBe(false);
      expect(t.swarm.effects.projectiles.some(p=>p.active&&p.owner===stray.id)).toBe(false);
      // E o jogador não leva o dano órfão de quem não está mais em campo.
      for(let i=0;i<60;i++){t.player.invulnerable=0;t.swarm.fixedUpdate(1/60);}
      expect(t.player.hp).toBe(hp);
    }finally{t.close();}
  });

  it('modo de medição (`benchmark`) mantém a população QA intacta',async()=>{
    const t=await setup('classic');
    try{
      t.swarm.benchmark=true;
      expect(t.swarm.spawn('eggplant',far(),'normal')).toBe(true);
      tick(t,120);
      expect(t.swarm.actors[0]!.active).toBe(true);
      expect(t.swarm.strays).toBe(0);
      expect(t.swarm.recycled).toBe(0);
    }finally{t.close();}
  });
});

describe('reposição perto do jogador, sem bando instantâneo',()=>{
  it('devolve um corpo por intervalo, no anel do jogador e reaproveitando o mesmo ator',async()=>{
    const t=await setup();
    try{
      for(let i=0;i<6;i++)expect(t.swarm.spawn('eggplant',{x:i*3,y:0,z:STRAY_DISTANCE+12},'normal')).toBe(true);
      expect(t.swarm.count).toBe(6);
      const pooled=t.swarm.actors.length;

      // Primeiro quadro: os seis saem de cena de uma vez, e exatamente UM volta.
      t.swarm.updateBudget(1/60,FRAME);
      expect(t.swarm.strays).toBe(6);
      expect(t.swarm.count).toBe(1);
      expect(t.swarm.recycled).toBe(1);
      // Nenhum corpo novo foi instanciado: a reposição reaproveita o que acabou de sair.
      expect(t.swarm.actors.length).toBe(pooled);

      const back=t.swarm.actors.find(a=>a.active)!;
      expect(distanceToPlayer(t,back.root.position)).toBeLessThanOrEqual(SPAWN_RING_MAX+.01);

      // Um segundo depois ainda é um só: o intervalo é o que impede a emboscada.
      tick(t,60);
      expect(t.swarm.count).toBe(1);
      tick(t,12);
      expect(t.swarm.count).toBe(2);
    }finally{t.close();}
  });

  it('seis retardatários voltam em fila, nunca mais de um por intervalo',async()=>{
    const t=await setup();
    try{
      for(let i=0;i<6;i++)expect(t.swarm.spawn('eggplant',{x:i*3,y:0,z:STRAY_DISTANCE+12},'normal')).toBe(true);
      let previous=t.swarm.count,peakJump=0,samples=0;
      for(let frame=0;frame<60*10;frame++){
        t.swarm.updateBudget(1/60,FRAME);t.swarm.fixedUpdate(1/60);
        peakJump=Math.max(peakJump,t.swarm.count-previous);previous=t.swarm.count;
        if(frame===Math.round(60*STRAY_REPLACEMENT_INTERVAL*2))samples=t.swarm.count;
      }
      // Nunca dois no mesmo quadro, e a dois intervalos ainda não havia horda montada.
      expect(peakJump).toBeLessThanOrEqual(1);
      expect(samples).toBeLessThanOrEqual(3);
      // Dez segundos depois a horda está inteira de volta — a cota não se perdeu no caminho.
      expect(t.swarm.count).toBe(6);
      expect(t.swarm.recycled).toBe(6);
      expect(t.swarm.actors.every(a=>!a.active||distanceToPlayer(t,a.root.position)<STRAY_DISTANCE)).toBe(true);
    }finally{t.close();}
  });

  it('trocar de ilha reconstrói a horda em volta da nova posição do jogador',async()=>{
    const t=await setup();
    try{
      for(let i=0;i<5;i++)expect(t.swarm.spawn('eggplant',{x:-45+i*2,y:0,z:-45},'normal')).toBe(true);
      expect(t.swarm.count).toBe(5);

      // Ambos os destinos estão dentro da grade de navegação da fazenda; separados por mais de 100 m.
      Object.assign(t.player.position,{x:35,y:0,z:35});
      t.swarm.fixedUpdate(1/60);
      tick(t,60*8);

      expect(t.swarm.strays).toBe(5);
      expect(t.swarm.count).toBe(5);
      for(const a of t.swarm.actors)if(a.active)expect(distanceToPlayer(t,a.root.position)).toBeLessThan(STRAY_DISTANCE);
      expect(t.run.totalKills).toBe(0);
    }finally{t.close();}
  });
});

describe('as espécies do disco voador fogem em vez de serem recicladas',()=>{
  /**
   * O pedido era literal: "se o usuário fugir muito longe desses mobs alienígenas eles devem
   * correr e sumir". A coleira comum faria o OPOSTO — recolheria e **reporia** o corpo ao lado do
   * jogador, e a invasão renasceria sozinha do outro lado do mapa sem ninguém provocá-la.
   */
  it('a mais de SAUCER_FLEE_DISTANCE o alien corre para longe e some, sem reposição',async()=>{
    const t=await setup();
    try{
      expect(t.swarm.spawn('grey',{x:0,y:0,z:SAUCER_FLEE_DISTANCE+6},'normal')).toBe(true);
      const alien=t.swarm.actors[0]!;
      const departed:number[]=[];
      t.swarm.onSaucerDeparted=id=>departed.push(id);
      t.swarm.director.stopped=true;

      // Primeiro quadro: ele NÃO é recolhido — entra em fuga, ainda em cena e ainda visível.
      t.swarm.updateBudget(1/60,FRAME);
      expect(alien.state).toBe('flee');
      expect(alien.active).toBe(true);
      expect(t.swarm.strays).toBe(0);

      const before=distanceToPlayer(t,alien.root.position);
      tick(t,30);
      // Correu PARA LONGE, não para cima do jogador.
      expect(distanceToPlayer(t,alien.root.position)).toBeGreaterThan(before);

      tick(t,60*12);
      expect(alien.active).toBe(false);
      expect(departed).toEqual([alien.id]);
      // E nada voltou: fuga não vira reposição.
      expect(t.swarm.recycled).toBe(0);
      expect(t.swarm.count).toBe(0);
    }finally{t.close();}
  });

  it('fugir não é morrer: sem abate, sem XP e sem crédito',async()=>{
    const t=await setup();
    try{
      expect(t.swarm.spawn('invader',{x:0,y:0,z:SAUCER_FLEE_DISTANCE+6},'normal')).toBe(true);
      const alien=t.swarm.actors[0]!;
      t.swarm.director.stopped=true;
      tick(t,60*14);
      expect(alien.active).toBe(false);
      expect(alien.health.dead).toBe(false);
      expect(t.swarm.kills).toBe(0);
      expect(t.run.totalKills).toBe(0);
      expect(t.run.xp).toBe(0);
    }finally{t.close();}
  });

  /**
   * O teto de população é orçamento de DESEMPENHO, e estava comendo o evento autorado.
   *
   * Aposentar um corpo da represália o some em silêncio — sem morte, sem `onSaucerDeparted` — e a
   * contagem da onda nunca fecha: o disco fica preso em `onda-ativa` para sempre e o item raro
   * vira inalcançável. Recusar o nascimento no teto dá exatamente o mesmo resultado, pelo outro
   * lado: o feixe já desceu e o corpo simplesmente não aparece.
   */
  it('abrir espaço no teto sacrifica o corpo comum, nunca o da represália',async()=>{
    const t=await setup();
    try{
      // O alien é, de LONGE, o corpo mais distante do jogador: pela regra de distância pura ele
      // seria o primeiro a ser aposentado, e é exatamente isso que não pode acontecer.
      expect(t.swarm.spawn('grey',{x:0,y:0,z:40},'normal')).toBe(true);
      // Os dois acima de RETIREMENT_DISTANCE (18 m) e abaixo de SAUCER_FLEE_DISTANCE (46 m): os
      // dois são aposentáveis por orçamento e o alien ainda não tem motivo para fugir.
      expect(t.swarm.spawn('eggplant',{x:0,y:0,z:25},'normal')).toBe(true);
      const alien=t.swarm.actors.find(a=>a.kind==='grey')!;
      const common=t.swarm.actors.find(a=>a.kind==='eggplant')!;

      // Quadro pesado: o orçamento encolhe o teto abaixo da população e a aposentadoria dispara.
      // `budget.limit` é o número que `updateBudget` copia para `populationCap` todo quadro — por
      // isso escrever em `populationCap` direto não testaria nada, seria sobrescrito na hora.
      t.swarm.budget.limit=1;
      t.swarm.director.stopped=true;
      t.swarm.updateBudget(1/60,FRAME);

      expect(alien.active,'o alien continua em campo').toBe(true);
      expect(common.active,'o corpo comum é que cedeu a vaga').toBe(false);
    }finally{t.close();}
  });

  it('no teto estourado o despejo do disco nasce mesmo assim, em vez de sumir em silêncio',async()=>{
    const t=await setup();
    try{
      // Campo lotado só com corpos da represália: não há ninguém aposentável para abrir espaço.
      for(const kind of ['grey','invader'] as const)
        expect(t.swarm.spawn(kind,{x:0,y:0,z:6},'normal')).toBe(true);
      t.swarm.populationCap=1;

      // O feixe está descendo o terceiro corpo: ele TEM de nascer.
      expect(t.swarm.spawn('demon',{x:2,y:0,z:6},'normal')).toBe(true);
      expect(t.swarm.lastSpawnedId).toBeGreaterThanOrEqual(0);
      expect(t.swarm.count).toBe(3);

      // E o corpo comum continua respeitando o teto: a isenção é só do evento autorado.
      expect(t.swarm.spawn('eggplant',{x:0,y:0,z:6},'normal')).toBe(false);
    }finally{t.close();}
  });

  it('perto do jogador o alien continua caçando, sem fugir de nada',async()=>{
    const t=await setup();
    try{
      expect(t.swarm.spawn('demon',{x:0,y:0,z:9},'normal')).toBe(true);
      const alien=t.swarm.actors[0]!;
      tick(t,120);
      expect(alien.active).toBe(true);
      expect(alien.state).not.toBe('flee');
    }finally{t.close();}
  });
});

describe('a vaga recolhida nunca evapora',()=>{
  it('na horda, repor mantém a cota da onda; não repor devolve o corpo que falta nascer',async()=>{
    const replaced=await setup('horde');
    try{
      replaced.swarm.director.spawned=10;
      expect(replaced.swarm.spawn('eggplant',far(),'normal')).toBe(true);
      replaced.swarm.updateBudget(1/60,FRAME);
      // A população continua a mesma, então a cota da onda não mexe.
      expect(replaced.swarm.count).toBe(1);
      expect(replaced.swarm.recycled).toBe(1);
      expect(replaced.swarm.director.spawned).toBe(10);
    }finally{replaced.close();}

    const stranded=await setup('horde');
    try{
      stranded.swarm.director.spawned=10;
      expect(stranded.swarm.spawn('eggplant',far(),'normal')).toBe(true);
      // Sem piso válido em volta do jogador a reposição não acontece...
      stranded.collision.surfaces.length=0;
      stranded.swarm.updateBudget(1/60,FRAME);
      expect(stranded.swarm.count).toBe(0);
      expect(stranded.swarm.recycled).toBe(0);
      // ...e aí a onda volta a dever aquele corpo, em vez de dá-lo por nascido.
      expect(stranded.swarm.director.spawned).toBe(9);
    }finally{stranded.close();}
  });

  it('na expedição, a reposição impedida devolve crédito ao diretor',async()=>{
    const t=await setup('expedition');
    try{
      expect(t.swarm.spawn('eggplant',far(),'normal')).toBe(true);
      t.swarm.director.credits=5;
      t.collision.surfaces.length=0;
      t.swarm.updateBudget(1/60,FRAME);
      expect(t.swarm.count).toBe(0);
      expect(t.swarm.director.credits).toBe(6);
    }finally{t.close();}
  });

  it('a troca de estágio esquece a fila de reposição',async()=>{
    const t=await setup();
    try{
      for(let i=0;i<4;i++)expect(t.swarm.spawn('eggplant',{x:i*3,y:0,z:STRAY_DISTANCE+12},'normal')).toBe(true);
      t.swarm.updateBudget(1/60,FRAME);
      expect(t.swarm.count).toBe(1);

      t.swarm.nextStage();
      expect(t.swarm.strays).toBe(0);
      expect(t.swarm.recycled).toBe(0);
      t.swarm.director.stopped=true;
      tick(t,60*6);
      expect(t.swarm.count).toBe(0);
    }finally{t.close();}
  });
});
