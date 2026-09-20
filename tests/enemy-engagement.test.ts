import {describe,it,expect} from 'vitest';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {Scene} from '@babylonjs/core/scene';
import {AssetContainer} from '@babylonjs/core/assetContainer';
import {CreateBox} from '@babylonjs/core/Meshes/Builders/boxBuilder';
import {DirectionalLight} from '@babylonjs/core/Lights/directionalLight';
import {ShadowGenerator} from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {EventBus} from '../src/core/EventBus';
import type {GameEvents} from '../src/core/contracts';
import {RunRNG} from '../src/core/RunRNG';
import {RunProgression} from '../src/run/RunProgression';
import {EnemySwarm} from '../src/game/EnemySwarm';
import {CollisionWorld} from '../src/physics/CollisionWorld';
import {PlayerMotor} from '../src/player/PlayerMotor';
import {ENEMIES,type EnemyKind} from '../src/run/MonsterDirector';
import {ENEMY_BEHAVIORS,BITE,BOSS_SWEEP_REACH,MELEE_COMMIT,RUSH,rushImpulse,type TelegraphPlan} from '../src/enemies/EnemyBehaviors';
import type {TrainingTarget} from '../src/world/TrainingYard';

/**
 * Alcance de ENGAJAMENTO por arquétipo.
 *
 * A regra que estes casos travam é uma só: o corpo só pode COMPROMETER um ataque de onde o golpe
 * que ele vai desenhar ainda alcança o jogador. Antes existia um `range` único por espécie no
 * catálogo, usado para todas as receitas da rotação — e era por isso que a Praga Alfa anunciava
 * uma varredura de sete metros parada a dezoito, e que a bomba de ácido caía a seis metros de um
 * círculo que prometia acertar os pés do jogador.
 */
async function setup(){
  const engine=new NullEngine(),scene=new Scene(engine),events=new EventBus<GameEvents>(),collision=new CollisionWorld();
  collision.surfaces.push({id:'field',x:0,z:0,width:200,depth:200,height:0});
  const player=new PlayerMotor(collision,events,{x:0,y:0,z:0}),run=new RunProgression(events),world={targets:[] as TrainingTarget[],collision};
  const light=new DirectionalLight('sun',new Vector3(0,-1,0),scene),shadows=new ShadowGenerator(128,light);
  const swarm=new EnemySwarm(scene,world,events,shadows,player,run,new RunRNG('engagement-test'));
  await swarm.load(async model=>{const c=new AssetContainer(scene),mesh=CreateBox(model,{size:1},scene);c.meshes.push(mesh);c.populateRootNodes();c.removeAllFromScene();return c;});
  swarm.initialize();swarm.populationCap=50;swarm.benchmark=true;swarm.director.stopped=true;
  return {engine,scene,events,player,run,swarm,collision,close:()=>{swarm.dispose();scene.dispose();engine.dispose();}};
}
type Harness=Awaited<ReturnType<typeof setup>>;

/** Alcance que o aviso daquele windup PROMETE, lido da forma concreta que ele desenhou. */
function promised(kind:EnemyKind,plan:TelegraphPlan):number {
  if(plan.shape==='band')return plan.reach;
  if(plan.shape==='cone')return plan.radius;
  // `none` no corpo a corpo é mordida; no chefe é uma receita de longe que não pinta chão nenhum.
  if(plan.shape==='none'&&(kind==='eggplant'||kind==='watermelon'))return BITE[kind].reach;
  return ENEMIES[kind].range;
}

/**
 * Deixa o bicho fechar a distância sozinho e devolve o quadro EXATO em que ele comprometeu o ataque
 * pedido da rotação. Nada de forçar `state='windup'`: o que está sendo medido é a decisão.
 */
function commit(t:Harness,kind:EnemyKind,attack:number,from:number){
  expect(t.swarm.spawn(kind,{x:0,y:0,z:from},'normal')).toBe(true);
  const a=t.swarm.actors[t.swarm.actors.length-1]!;
  for(let frame=0;frame<3600;frame++){
    if(a.state==='chase')a.attack=attack-1;
    t.swarm.fixedUpdate(1/60);
    if(a.state!=='windup')continue;
    expect(a.attack).toBe(attack);
    return {actor:a,distance:Math.hypot(a.root.position.x,a.root.position.z),plan:ENEMY_BEHAVIORS[kind].telegraph(a)};
  }
  throw new Error(`${kind} nunca comprometeu o ataque ${attack}`);
}

interface Case {name:string;kind:EnemyKind;attack:number;from:number;frames:number}
const CASES:readonly Case[]=[
  {name:'berinjela investe',kind:'eggplant',attack:1,from:16,frames:140},
  {name:'melancia rola',kind:'watermelon',attack:1,from:16,frames:140},
  {name:'melancia cospe',kind:'watermelon',attack:2,from:16,frames:220},
  {name:'melancia morde',kind:'watermelon',attack:3,from:16,frames:160},
  // O milho ARREMESSA uma espiga em parábola: o voo é longo de propósito (é o tempo de o jogador
  // ver o círculo e sair de baixo), então o impacto chega bem depois do que chegava a metralha.
  {name:'milho arremessa a espiga',kind:'corn',attack:1,from:26,frames:520},
  {name:'tomate bombardeia',kind:'tomato',attack:1,from:24,frames:320},
  {name:'cenoura dispara o feixe',kind:'carrot',attack:1,from:22,frames:120},
  {name:'chefe varre',kind:'boss',attack:4,from:16,frames:140},
  {name:'chefe joga ácido',kind:'boss',attack:2,from:24,frames:360},
];

describe('alcance de engajamento por arquétipo',()=>{
  it.each(CASES)('$name: compromete de onde o aviso ainda alcança',async({kind,attack,from})=>{
    const t=await setup();
    try{
      const {distance,plan}=commit(t,kind,attack,from);
      expect(distance).toBeLessThanOrEqual(promised(kind,plan)+1e-9);
      // E não é simplesmente "colado no jogador": o arquétipo mantém a distância dele.
      expect(distance).toBeGreaterThan(0);
    }finally{t.close();}
  });

  it.each(CASES)('$name: o impacto sai de verdade em cima do jogador parado',async({kind,attack,from,frames})=>{
    const t=await setup();
    try{
      const {actor}=commit(t,kind,attack,from);
      for(let i=0;i<frames;i++){t.player.invulnerable=0;t.swarm.fixedUpdate(1/60);}
      expect(actor.active).toBe(true);
      expect(t.player.hp).toBeLessThan(t.player.maxHP);
    }finally{t.close();}
  });

  it('a varredura do chefe deixou de ser anunciada de longe demais para conectar',async()=>{
    const t=await setup();
    try{
      const {distance,plan}=commit(t,'boss',4,16);
      expect(plan).toEqual({shape:'cone',radius:BOSS_SWEEP_REACH});
      // A regressão real: com o `range` 18 do catálogo o cone saía a dezesseis metros e o
      // `massive_swipe` (que exige `reach<7`) não podia acertar ninguém.
      expect(distance).toBeLessThan(BOSS_SWEEP_REACH);
      expect(distance).toBeLessThanOrEqual(BOSS_SWEEP_REACH*MELEE_COMMIT+1e-9);
      expect(ENEMIES.boss.range).toBeGreaterThan(BOSS_SWEEP_REACH*2);
    }finally{t.close();}
  });

  it('a poça de ácido do chefe cai dentro do círculo que ela anunciou',async()=>{
    const t=await setup();
    try{
      commit(t,'boss',2,24);
      // O círculo `acid-intent` sai no `perform`, no fim do windup; a poça real nasce onde a bomba
      // encosta no chão. Estas são as duas pontas que precisam coincidir.
      let intent:{x:number;z:number;radius:number}|undefined,pool:{x:number;z:number}|undefined;
      for(let i=0;i<420&&!pool;i++){
        t.player.invulnerable=0;t.swarm.fixedUpdate(1/60);
        for(const w of t.swarm.effects.warnings){
          if(!w.active)continue;
          if(w.kind==='acid-intent'&&!intent)intent={x:w.position.x,z:w.position.z,radius:w.radius};
          if((w.kind==='acid'||w.kind==='acid-pool')&&!pool)pool={x:w.position.x,z:w.position.z};
        }
      }
      expect(intent).toBeTruthy();
      expect(pool).toBeTruthy();
      // Guarda da elevação balística: a bomba cai DENTRO do círculo que anunciou. Sem a compensação
      // de queda que `CombatPresentation.projectile` soma, ela pararia metros antes do anel.
      expect(Math.hypot(pool!.x-intent!.x,pool!.z-intent!.z)).toBeLessThanOrEqual(intent!.radius);
      expect(t.player.hp).toBeLessThan(t.player.maxHP);
    }finally{t.close();}
  });
});

describe('o catálogo deixou de ser o gatilho do corpo a corpo',()=>{
  const actor=(attack:number)=>({id:1,attack,time:0,direction:{x:0,z:0},locked:{x:0,y:0,z:0},root:{position:{x:0,y:0,z:0}}});

  it('cada arquétipo engaja no alcance do próprio golpe, e não num número único de espécie',()=>{
    // Investida: o impulso comprometido (velocidade × duração) com margem para o alvo andar.
    expect(ENEMY_BEHAVIORS.eggplant.engage(actor(0))).toBeCloseTo(rushImpulse('eggplant')*MELEE_COMMIT,9);
    expect(ENEMY_BEHAVIORS.eggplant.engage(actor(0))).toBeLessThan(ENEMIES.eggplant.range);
    // Melancia alterna: rolamento e mordida são corpo a corpo, só a cusparada é de longe.
    expect(ENEMY_BEHAVIORS.watermelon.engage(actor(0))).toBeCloseTo(rushImpulse('watermelon')*MELEE_COMMIT,9);
    expect(ENEMY_BEHAVIORS.watermelon.engage(actor(1))).toBe(ENEMIES.watermelon.range);
    expect(ENEMY_BEHAVIORS.watermelon.engage(actor(2))).toBeCloseTo(rushImpulse('watermelon')*MELEE_COMMIT,9);
    expect(ENEMY_BEHAVIORS.watermelon.engage(actor(0))).toBeLessThan(ENEMIES.watermelon.range);
    // Chefe: uma varredura de contato no meio de quatro receitas de longe.
    expect(ENEMY_BEHAVIORS.boss.engage(actor(3))).toBeCloseTo(BOSS_SWEEP_REACH*MELEE_COMMIT,9);
    expect(ENEMY_BEHAVIORS.boss.engage(actor(0))).toBe(ENEMIES.boss.range);
    // Quem atira de verdade (tiro reto, sem queda) mantém o posto de tiro do catálogo.
    expect(ENEMY_BEHAVIORS.corn.engage(actor(0))).toBe(ENEMIES.corn.range);
    expect(ENEMY_BEHAVIORS.tomato.engage(actor(0))).toBe(ENEMIES.tomato.range);
    expect(ENEMY_BEHAVIORS.carrot.engage(actor(0))).toBe(ENEMIES.carrot.range);
  });

  it('os três alcances de investida saem do MESMO impulso que o recover empurra',()=>{
    for(const kind of ['eggplant','watermelon'] as const){
      // `attack` do ramo de investida: 1 na berinjela, e na melancia o windup que vira rolamento.
      const a={...actor(1),direction:{x:0,z:1},locked:{x:0,y:0,z:9}};
      // 1) o que o `recover` empurra
      expect(ENEMY_BEHAVIORS[kind].recoverySpeed(a)).toBe(RUSH[kind].speed);
      expect(ENEMY_BEHAVIORS[kind].recoverySpeed({...a,time:RUSH[kind].duration})).toBe(0);
      // 2) o que a faixa do windup desenha
      const plan=ENEMY_BEHAVIORS[kind].telegraph(a);
      expect(plan.shape).toBe('band');
      if(plan.shape==='band')expect(plan.reach).toBeCloseTo(RUSH[kind].speed*RUSH[kind].duration,9);
      // 3) e de onde o corpo pode comprometer — sempre dentro do impulso, nunca no fim exato dele.
      const rushing=kind==='eggplant'?a:{...a,attack:0};
      expect(ENEMY_BEHAVIORS[kind].engage(rushing)).toBeCloseTo(rushImpulse(kind)*MELEE_COMMIT,9);
      expect(ENEMY_BEHAVIORS[kind].engage(rushing)).toBeLessThan(rushImpulse(kind));
    }
  });

  it('corpo a corpo, investida e tiro continuam sendo três faixas distintas',()=>{
    const melee=ENEMY_BEHAVIORS.eggplant.engage(actor(0));
    const ranged=Math.min(ENEMIES.corn.range,ENEMIES.tomato.range,ENEMIES.carrot.range);
    const sweep=ENEMY_BEHAVIORS.boss.engage(actor(3));
    expect(sweep).toBeLessThan(melee);
    expect(melee).toBeLessThan(ranged);
    expect(new Set([sweep,melee,ranged]).size).toBe(3);
  });

  it('só a varredura do chefe fecha distância; as quatro receitas de longe mantêm o catálogo',()=>{
    // A munição do chefe leva elevação balística em `CombatPresentation.projectile`, então ela chega
    // aos 18 m mirados — o que não chegava era a varredura, que é contato e estava presa no mesmo 18.
    for(let attack=0;attack<10;attack++){
      const engage=ENEMY_BEHAVIORS.boss.engage(actor(attack));
      expect(engage).toBe((attack+1)%5===4?BOSS_SWEEP_REACH*MELEE_COMMIT:ENEMIES.boss.range);
    }
  });
});
