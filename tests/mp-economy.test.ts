import { describe,it,expect } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { AssetContainer } from '@babylonjs/core/assetContainer';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { EventBus } from '../src/core/EventBus';
import type { DamageContext,GameEvents } from '../src/core/contracts';
import { RunRNG } from '../src/core/RunRNG';
import { RunProgression } from '../src/run/RunProgression';
import { EnemySwarm } from '../src/game/EnemySwarm';
import { CollisionWorld } from '../src/physics/CollisionWorld';
import { PlayerMotor } from '../src/player/PlayerMotor';
import { Health } from '../src/combat/Health';
import { MPCharge,MP_COSTS,MP_HIT_GAIN,MP_HIT_WINDOW_CAP } from '../src/combat/MPCharge';
import type { TrainingTarget } from '../src/world/TrainingYard';

const TICK=1/60;
/** Contexto de um acerto básico de pistola, exatamente como `DualPistols.shoot` monta. */
function bullet(victimId:number,damage=12,over:Partial<DamageContext>={}):DamageContext {
  return {attackerId:1,victimId,sourceId:'dual_pistols',attackId:'right',baseDamage:damage,finalDamage:damage,crit:false,
    procCoefficient:1,procChainDepth:0,damageTags:['bullet'],hitPosition:{x:0,y:1,z:0},hitNormal:{x:0,y:0,z:-1},
    forceDirection:{x:0,y:0,z:1},forceMagnitude:2,...over};
}
/** Contexto do golpe desarmado, como `PlayerScene.resolveMelee` monta. */
function melee(victimId:number,damage=14):DamageContext {
  return bullet(victimId,damage,{sourceId:'unarmed_jab',attackId:'jab',damageTags:['melee'],procCoefficient:.8});
}

describe('MP só sobe com acerto confirmado',()=>{
  function bench(targets:number){
    const events=new EventBus<GameEvents>(),mp=new MPCharge(events);
    mp.current=0;
    const dummies=Array.from({length:targets},(_,i)=>new Health(500+i,10_000,events));
    return {events,mp,dummies,tick:(steps=1)=>{for(let i=0;i<steps;i++)mp.update(TICK,false);}};
  }

  it('sessenta segundos parado não rendem nada: a regeneração passiva acabou',()=>{
    const b=bench(1);
    b.tick(3600);
    expect(b.mp.current).toBe(0);
    expect(b.mp.hitBudget).toBe(MP_HIT_WINDOW_CAP);
  });

  it('errar não rende: sem `EnemyHit` a barra não se mexe, mesmo com `DamageDealt` emitido',()=>{
    const b=bench(1);
    // `DualPistols` emite `DamageDealt` ANTES de `target.onHit`; um tiro que não encosta em vida nenhuma
    // (parede, céu, alvo fora do raio) nunca chega a `Health.apply`.
    b.events.emit('DamageDealt',bullet(500));
    b.tick(6);
    expect(b.mp.current).toBe(0);
  });

  it('dano recusado não rende: cadáver, dano zero e vítima errada',()=>{
    const b=bench(1);const dummy=b.dummies[0]!;
    expect(dummy.apply(bullet(dummy.id,0))).toBe(false);
    expect(dummy.apply(bullet(dummy.id+999))).toBe(false);
    expect(b.mp.current).toBe(0);
    const corpse=new Health(700,10,b.events);
    corpse.apply(bullet(700,10));                 // mata: este vale
    expect(b.mp.current).toBe(MP_HIT_GAIN);
    b.tick(70);                                   // abre uma janela nova
    expect(corpse.apply(bullet(700,10))).toBe(false); // cadáver: recusado
    expect(b.mp.current).toBe(MP_HIT_GAIN);
  });

  it('pistola e corpo a corpo confirmados rendem, e dois golpes no mesmo alvo rendem duas vezes',()=>{
    const b=bench(1);const dummy=b.dummies[0]!;
    dummy.apply(bullet(dummy.id));
    expect(b.mp.current).toBe(MP_HIT_GAIN);
    dummy.apply(melee(dummy.id));
    expect(b.mp.current).toBe(MP_HIT_GAIN*2);
    // Sem dedupe permanente por nome de golpe/alvo: o mesmo `attackId` no mesmo alvo rende de novo.
    b.tick(70);
    dummy.apply(bullet(dummy.id));
    dummy.apply(bullet(dummy.id));
    expect(b.mp.current).toBe(MP_HIT_GAIN*4);
  });

  it('especiais, procs, DOT e comandos de QA/debug não rendem',()=>{
    const b=bench(1);const dummy=b.dummies[0]!;
    dummy.apply(bullet(dummy.id,18,{sourceId:'ricochet_fan',attackId:'ricochet_fan',damageTags:['bullet','skill']}));
    dummy.apply(bullet(dummy.id,24,{sourceId:'backflip_barrage',attackId:'backflip_barrage',damageTags:['bullet','skill']}));
    dummy.apply(bullet(dummy.id,18,{sourceId:'harvest_storm',attackId:'harvest_storm',damageTags:['bullet','skill']}));
    dummy.apply(bullet(dummy.id,9,{procChainDepth:1,sourceProcId:'bomb'}));
    dummy.apply(bullet(dummy.id,5,{procChainDepth:1,sourceProcId:'burn',sourceId:'burn',attackId:'burn',damageTags:['fire','dot']}));
    dummy.apply(bullet(dummy.id,999,{procChainDepth:1,sourceId:'qa',attackId:'qa',damageTags:['qa']}));
    dummy.apply(bullet(dummy.id,999,{procChainDepth:1,sourceId:'debug',attackId:'debug',damageTags:['debug']}));
    expect(b.mp.current).toBe(0);
  });

  it('sofrer dano não rende MP para quem apanhou',()=>{
    const b=bench(1);
    b.events.emit('EnemyHit',{...bullet(1,20),attackerId:300,damageTags:['enemy']});
    b.events.emit('DamageTaken',{...bullet(1,20),attackerId:300,damageTags:['enemy']});
    expect(b.mp.current).toBe(0);
  });

  it('multi-alvo e rajada param no teto de 6 MP na janela de 1 s',()=>{
    const b=bench(8);
    for(const dummy of b.dummies)dummy.apply(bullet(dummy.id)); // 8 alvos num único tick
    expect(b.mp.current).toBe(MP_HIT_WINDOW_CAP);
    expect(b.mp.hitBudget).toBe(0);
    b.tick(30);                                                  // meio segundo depois
    for(const dummy of b.dummies)dummy.apply(bullet(dummy.id));
    expect(b.mp.current).toBe(MP_HIT_WINDOW_CAP);
    b.tick(31);                                                  // passou 1 s do primeiro acerto
    for(const dummy of b.dummies)dummy.apply(bullet(dummy.id));
    expect(b.mp.current).toBe(MP_HIT_WINDOW_CAP*2);
  });

  it('a janela é deslizante de verdade: a virada não libera 12 MP em 1 s',()=>{
    const b=bench(8);
    for(const dummy of b.dummies)dummy.apply(bullet(dummy.id));   // t≈0 → 6 MP
    expect(b.mp.current).toBe(MP_HIT_WINDOW_CAP);
    b.tick(59);                                                   // t≈0,983 s, ainda dentro da janela
    for(const dummy of b.dummies)dummy.apply(bullet(dummy.id));
    // Com janela FIXA isto renderia mais 6 MP num intervalo de ~0,98 s. Com janela deslizante, zero.
    expect(b.mp.current).toBe(MP_HIT_WINDOW_CAP);
    b.tick(2);                                                    // t≈1,017 s: o mais antigo saiu
    for(const dummy of b.dummies)dummy.apply(bullet(dummy.id));
    expect(b.mp.current).toBe(MP_HIT_WINDOW_CAP*2);
  });

  it('nenhum intervalo de 1 s rende mais que 6 MP em 10 s de combate contínuo',()=>{
    const b=bench(4),seconds=10,frames=60*seconds;
    const trace:number[]=[];
    for(let frame=0;frame<frames;frame++){                        // acertando 4 alvos em TODO tick
      for(const dummy of b.dummies)dummy.apply(bullet(dummy.id,1));
      trace.push(b.mp.current);
      b.tick();
    }
    // Varredura de TODAS as janelas deslizantes de 1 s (60 quadros) do traçado.
    let worst=0;
    for(let i=60;i<trace.length;i++)worst=Math.max(worst,trace[i]!-trace[i-60]!);
    expect(worst).toBeLessThanOrEqual(MP_HIT_WINDOW_CAP);
    // 2.400 acertos confirmados em 10 s renderiam 4.800 MP sem teto; com teto rendem ~6 MP/s.
    expect(b.mp.current).toBeGreaterThanOrEqual(MP_HIT_WINDOW_CAP*(seconds-1));
    expect(b.mp.current).toBeLessThanOrEqual(MP_HIT_WINDOW_CAP*seconds);
    expect(b.mp.current).toBeLessThan(b.mp.maximum);
    // MP I sai depois de ~4,2 s de combate contínuo; MP III só perto dos 17 s.
    expect(MP_COSTS[0]/MP_HIT_WINDOW_CAP).toBeCloseTo(4.17,1);
    expect(MP_COSTS[2]/MP_HIT_WINDOW_CAP).toBeCloseTo(16.7,1);
  });

  it('custos de especial e cargas extras de item continuam independentes do ganho por acerto',()=>{
    const b=bench(1);const dummy=b.dummies[0]!;
    b.mp.current=100;b.mp.setMaxCharges(2);
    expect(b.mp.charges).toBe(2);
    for(let i=0;i<160;i++)b.mp.update(TICK,true);
    expect(b.mp.tier).toBe(3);
    expect(b.mp.update(TICK,false)).toBe(3);
    expect(b.mp.current).toBe(100-MP_COSTS[2]);
    expect(b.mp.consumeCharge()).toBe(true);                       // carga de item não depende de MP
    expect(b.mp.charges).toBe(1);
    dummy.apply(bullet(dummy.id));
    expect(b.mp.current).toBe(MP_HIT_GAIN);
  });
});

async function swarm(){
  const engine=new NullEngine(),scene=new Scene(engine),events=new EventBus<GameEvents>(),collision=new CollisionWorld();
  collision.surfaces.push({id:'field',x:0,z:0,width:100,depth:100,height:0});
  const player=new PlayerMotor(collision,events,{x:0,y:0,z:0}),run=new RunProgression(events),world={targets:[] as TrainingTarget[],collision};
  player.debugInvincible=true;
  const light=new DirectionalLight('sun',new Vector3(0,-1,0),scene),shadows=new ShadowGenerator(128,light);
  const enemies=new EnemySwarm(scene,world,events,shadows,player,run,new RunRNG('mp-economy'));
  await enemies.load(async model=>{const c=new AssetContainer(scene),mesh=CreateBox(model,{size:1},scene);c.meshes.push(mesh);c.populateRootNodes();c.removeAllFromScene();return c;});
  enemies.initialize();enemies.benchmark=true;enemies.director.stopped=true;enemies.populationCap=12;
  const mp=new MPCharge(events);mp.current=0;
  return {engine,scene,events,player,enemies,mp,close:()=>{enemies.dispose();scene.dispose();engine.dispose();}};
}

describe('MP contra a horda real',()=>{
  it('acerto de pistola e de soco em inimigo vivo rendem; queimadura, QA e cadáver não',async()=>{
    const t=await swarm();
    try {
      expect(t.enemies.spawn('eggplant',{x:0,y:0,z:6},'normal')).toBe(true);
      const actor=t.enemies.actors[0]!;
      actor.target.onHit!(bullet(actor.id,6));
      expect(t.mp.current).toBe(MP_HIT_GAIN);
      actor.target.onHit!(melee(actor.id,6));
      expect(t.mp.current).toBe(MP_HIT_GAIN*2);
      // Queimadura: o próprio enxame reaplica com profundidade de cadeia 1.
      actor.burn=2;actor.burnClock=0;
      for(let i=0;i<70;i++){t.enemies.fixedUpdate(TICK);t.mp.update(TICK,false);}
      expect(t.mp.current).toBe(MP_HIT_GAIN*2);
      // Comando de QA mata o ator: nem o golpe nem o cadáver rendem.
      actor.target.onHit!(bullet(actor.id,999_999,{procChainDepth:1,sourceId:'qa',attackId:'qa',damageTags:['qa']}));
      expect(actor.health.dead).toBe(true);
      actor.target.onHit!(bullet(actor.id,6));
      expect(t.mp.current).toBe(MP_HIT_GAIN*2);
    } finally {t.close();}
  },60_000);

  it('varrer oito inimigos no mesmo tique respeita o teto da janela',async()=>{
    const t=await swarm();
    try {
      for(let i=0;i<8;i++)t.enemies.spawn('eggplant',{x:(i-4)*3,y:0,z:9},'normal');
      expect(t.enemies.count).toBe(8);
      for(const a of t.enemies.actors)a.target.onHit!(bullet(a.id,6));
      expect(t.mp.current).toBe(MP_HIT_WINDOW_CAP);
    } finally {t.close();}
  },60_000);
});
