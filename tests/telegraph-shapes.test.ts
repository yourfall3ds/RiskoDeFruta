import { describe,it,expect } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { AssetContainer } from '@babylonjs/core/assetContainer';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { EventBus } from '../src/core/EventBus';
import type { GameEvents,Vec3 } from '../src/core/contracts';
import { RunRNG } from '../src/core/RunRNG';
import { RunProgression } from '../src/run/RunProgression';
import { EnemySwarm } from '../src/game/EnemySwarm';
import { CollisionWorld } from '../src/physics/CollisionWorld';
import { PlayerMotor } from '../src/player/PlayerMotor';
import { CombatPresentation } from '../src/vfx/CombatPresentation';
import { ENEMY_BEHAVIORS,type AttackingEnemy } from '../src/enemies/EnemyBehaviors';
import { ENEMIES,type EnemyKind } from '../src/run/MonsterDirector';
import type { TrainingTarget } from '../src/world/TrainingYard';

const spot=(x:number,z:number):Vec3=>({x,y:0,z});
const gap=(a:Vec3,b:Vec3)=>Math.hypot(a.x-b.x,a.z-b.z);
const pretend=(attack:number,from:Vec3,locked:Vec3):AttackingEnemy=>({id:1,attack,time:0,direction:{x:0,z:0},locked,root:{position:from}});

describe('a forma do aviso corresponde ao ataque concreto',()=>{
  it('mordida corpo a corpo não pinta área nenhuma',()=>{
    expect(ENEMY_BEHAVIORS.eggplant.telegraph(pretend(1,spot(0,0),spot(0,2)))).toEqual({shape:'none'});
    expect(ENEMY_BEHAVIORS.watermelon.telegraph(pretend(3,spot(0,0),spot(0,3)))).toEqual({shape:'none'});
  });
  it('investida vira faixa com a largura de contato e o alcance reais',()=>{
    expect(ENEMY_BEHAVIORS.eggplant.telegraph(pretend(1,spot(0,0),spot(0,8)))).toEqual({shape:'band',width:(ENEMIES.eggplant.radius+.55)*2,reach:9.5});
    expect(ENEMY_BEHAVIORS.watermelon.telegraph(pretend(1,spot(0,0),spot(0,8)))).toEqual({shape:'band',width:(ENEMIES.watermelon.radius+.55)*2,reach:9.35});
    // Mordida longe demais cai no ramo de investida do perform; o aviso precisa prever isso.
    expect(ENEMY_BEHAVIORS.watermelon.telegraph(pretend(3,spot(0,0),spot(0,8))).shape).toBe('band');
  });
  it('tiro direto mostra direção e nunca um anel de área',()=>{
    expect(ENEMY_BEHAVIORS.corn.telegraph(pretend(1,spot(0,0),spot(0,9)))).toEqual({shape:'aim',width:.6,length:3.2});
    expect(ENEMY_BEHAVIORS.watermelon.telegraph(pretend(2,spot(0,0),spot(0,8)))).toEqual({shape:'aim',width:.6,length:3.2});
  });
  it('laser usa linha real e o tomate mantém o círculo da poça de fogo',()=>{
    expect(ENEMY_BEHAVIORS.carrot.telegraph(pretend(1,spot(0,0),spot(0,9)))).toEqual({shape:'beam',width:1});
    // 2.3 é o mesmo raio da zona de fogo criada no impacto do projétil incendiário.
    expect(ENEMY_BEHAVIORS.tomato.telegraph(pretend(1,spot(0,0),spot(0,9)))).toEqual({shape:'circle',radius:2.3,kind:'fire-intent'});
  });
  it('o chefe só desenha cone na varredura e nada nos outros quatro ataques',()=>{
    expect(ENEMY_BEHAVIORS.boss.telegraph(pretend(4,spot(0,0),spot(0,9)))).toEqual({shape:'cone',radius:7});
    for(const attack of [1,2,3,5,6,7,8])if(attack%5!==4)expect(ENEMY_BEHAVIORS.boss.telegraph(pretend(attack,spot(0,0),spot(0,9)))).toEqual({shape:'none'});
  });
  it('círculo só sobra para quem tem zona de dano real',()=>{
    const circles=new Set<string>();
    for(const kind of Object.keys(ENEMY_BEHAVIORS) as EnemyKind[])for(let attack=1;attack<=10;attack++){
      for(const away of [1.5,3,8,14]){const plan=ENEMY_BEHAVIORS[kind].telegraph(pretend(attack,spot(0,0),spot(0,away)));if(plan.shape==='circle')circles.add(`${kind}:${plan.kind}`);}
    }
    expect([...circles]).toEqual(['tomato:fire-intent']);
  });
});

function presentation(){const engine=new NullEngine(),scene=new Scene(engine);return{effects:new CombatPresentation(scene),close:()=>{scene.dispose();engine.dispose();}};}

describe('faixa retangular e pools sem vazamento',()=>{
  it('line desenha um retângulo com direção, largura e comprimento reais',()=>{
    const t=presentation();try{
      t.effects.line(spot(0,0),spot(6,0),2,1,9);
      const w=t.effects.warnings.find(x=>x.active)!;
      expect(w.kind).toBe('band');expect(w.radius).toBe(2);expect(w.stretch).toBe(6);
      expect(w.position).toEqual({x:3,y:0,z:0});
      expect(w.mesh.name.startsWith('band-warning')).toBe(true);
      expect(w.mesh.rotation.y).toBeCloseTo(Math.PI/2,6);
      expect(w.mesh.rotation.x).toBe(0);
      expect([w.mesh.scaling.x,w.mesh.scaling.y,w.mesh.scaling.z]).toEqual([2,1,6]);
      expect([w.mesh.position.x,w.mesh.position.y,w.mesh.position.z]).toEqual([3,.05,0]);
      t.effects.render(1/60);
      expect(w.mesh.scaling.z).toBe(6);expect(w.mesh.scaling.x).toBeGreaterThan(2*.96);expect(w.mesh.scaling.x).toBeLessThan(2*1.04);
    }finally{t.close();}
  });
  it('círculo continua redondo depois do render, sem elipse de torus esticado',()=>{
    const t=presentation();try{
      t.effects.warning(spot(0,0),3,1,12,4,'root');
      const w=t.effects.warnings.find(x=>x.active)!;
      expect(w.mesh.name.startsWith('attack-warning')).toBe(true);
      for(let i=0;i<8;i++)t.effects.render(1/60);
      expect(w.mesh.scaling.x).toBe(w.mesh.scaling.z);
      expect(w.stretch).toBe(1);
    }finally{t.close();}
  });
  it('invocação usa sinal próprio, diferente do anel vermelho de perigo',()=>{
    const t=presentation();try{
      t.effects.warning(spot(2,2),1,.8,0,4,'summon');
      t.effects.warning(spot(4,4),2,.8,26,4,'root');
      const [portal,danger]=t.effects.warnings.filter(x=>x.active);
      expect(portal!.mesh.name.startsWith('summon-warning')).toBe(true);
      expect(danger!.mesh.name.startsWith('attack-warning')).toBe(true);
      expect(portal!.mesh.material?.name).not.toBe(danger!.mesh.material?.name);
      expect(portal!.damage).toBe(0);
    }finally{t.close();}
  });
  it('cone aponta para o alvo com o setor de 120° da varredura',()=>{
    const t=presentation();try{
      t.effects.cone(spot(0,0),spot(5,5),7,1,4);
      const w=t.effects.warnings.find(x=>x.active)!;
      expect(w.kind).toBe('cone');expect(w.mesh.name.startsWith('cone-warning')).toBe(true);
      expect(w.mesh.rotation.x).toBeCloseTo(Math.PI/2,6);
      expect(w.mesh.rotation.y).toBeCloseTo(Math.atan2(5,5)-Math.PI/6,6);
      expect(w.mesh.scaling.x).toBe(7);
    }finally{t.close();}
  });
  it('pools de faixa, cone e invocação devolvem tudo no clear e aceitam reuso',()=>{
    const t=presentation();try{
      for(let i=0;i<20;i++)t.effects.line(spot(0,i),spot(6,i),1.5,1,9);
      for(let i=0;i<10;i++)t.effects.cone(spot(i,0),spot(i,5),7,1,9);
      for(let i=0;i<14;i++)t.effects.warning(spot(i,3),1,1,0,9,'summon');
      expect(t.effects.attachedShapes).toBe(16+8+12);
      t.effects.clear();
      expect(t.effects.active).toBe(0);expect(t.effects.attachedShapes).toBe(0);
      expect(t.effects.warnings.every(w=>w.mesh===w.circle&&!w.mesh.isEnabled())).toBe(true);
      t.effects.line(spot(0,0),spot(3,0),1,1,9);
      expect(t.effects.warnings.filter(w=>w.active)).toHaveLength(1);
      expect(t.effects.attachedShapes).toBe(1);
    }finally{t.close();}
  });
  it('faixa expirada libera o mesh auxiliar e o slot volta a ser círculo',()=>{
    const t=presentation();try{
      t.effects.line(spot(0,0),spot(6,0),2,.5,9);
      const w=t.effects.warnings.find(x=>x.active)!;
      w.active=false;w.mesh.setEnabled(false);
      expect(t.effects.attachedShapes).toBe(0);
      t.effects.warning(spot(0,0),2,1,26,9,'root');
      expect(w.mesh).toBe(w.circle);expect(t.effects.attachedShapes).toBe(0);
    }finally{t.close();}
  });
});

describe('receitas do chefe não anunciam área falsa',()=>{
  const cast=(effects:CombatPresentation,attack:number,from:Vec3)=>{
    const hurts:string[]=[];
    ENEMY_BEHAVIORS.boss.perform({actor:pretend(attack,from,spot(0,0)),player:spot(0,0),effects,hurt:(_damage:number,source:string)=>{hurts.push(source);},spawn:()=>true,nearby:0});
    return {hurts,warnings:effects.warnings.filter(w=>w.active)};
  };
  it('invocação marca só onde o bicho nasce',()=>{
    const t=presentation();try{
      const {warnings}=cast(t.effects,5,spot(0,12));
      expect(warnings).toHaveLength(6);
      expect(warnings.every(w=>w.kind==='summon'&&w.damage===0)).toBe(true);
    }finally{t.close();}
  });
  it('raízes mantêm círculo porque o dano de área é real',()=>{
    const t=presentation();try{
      const {warnings}=cast(t.effects,1,spot(0,12));
      expect(warnings).toHaveLength(5);
      expect(warnings.every(w=>w.kind==='root'&&w.damage===26)).toBe(true);
    }finally{t.close();}
  });
  it('ácido usa um círculo do mesmo raio da poça criada no impacto',()=>{
    const t=presentation();try{
      const {warnings}=cast(t.effects,2,spot(0,12));
      expect(warnings).toHaveLength(1);
      expect(warnings[0]!.kind).toBe('acid-intent');
      expect(warnings[0]!.radius).toBe(4);
      expect(warnings[0]!.pulses).toBe(0);
    }finally{t.close();}
  });
  it('barragem direta só marca os projéteis que invocam',()=>{
    const t=presentation();try{
      const {warnings}=cast(t.effects,3,spot(0,12));
      expect(warnings.map(w=>w.kind)).toEqual(['summon','summon','summon']);
      expect(t.effects.projectiles.filter(p=>p.active)).toHaveLength(7);
      expect(t.effects.projectiles.filter(p=>p.active&&p.impact?.summon)).toHaveLength(3);
    }finally{t.close();}
  });
  it('varredura fere sem criar círculo no chão',()=>{
    const t=presentation();try{
      const {hurts,warnings}=cast(t.effects,4,spot(0,5));
      expect(hurts).toEqual(['massive_swipe']);
      expect(warnings).toHaveLength(0);
    }finally{t.close();}
  });
});

async function setup(){const engine=new NullEngine(),scene=new Scene(engine),events=new EventBus<GameEvents>(),collision=new CollisionWorld();collision.surfaces.push({id:'field',x:0,z:0,width:100,depth:100,height:0});const player=new PlayerMotor(collision,events,{x:0,y:0,z:0}),run=new RunProgression(events),world={targets:[] as TrainingTarget[],collision};const light=new DirectionalLight('sun',new Vector3(0,-1,0),scene),shadows=new ShadowGenerator(128,light);const swarm=new EnemySwarm(scene,world,events,shadows,player,run,new RunRNG('telegraph-test'));await swarm.load(async model=>{const c=new AssetContainer(scene),mesh=CreateBox(model,{size:1},scene);c.meshes.push(mesh);c.populateRootNodes();c.removeAllFromScene();return c;});swarm.initialize();swarm.populationCap=50;swarm.benchmark=true;swarm.director.stopped=true;return{engine,scene,events,player,run,swarm,collision,close:()=>{swarm.dispose();scene.dispose();engine.dispose();}};}
type Harness=Awaited<ReturnType<typeof setup>>;
/** Deixa o bicho chegar sozinho ao windup, fixando qual ataque da rotação vai sair. */
function chargeUp(t:Harness,kind:EnemyKind,at:Vec3,attack=1,eager=false){
  expect(t.swarm.spawn(kind,at,'normal')).toBe(true);
  const a=t.swarm.actors[t.swarm.actors.length-1]!;
  for(let i=0;i<900&&a.state!=='windup';i++){if(a.state==='chase'){a.attack=attack-1;if(eager)a.cooldown=0;}t.swarm.fixedUpdate(1/60);}
  expect(a.state).toBe('windup');
  return a;
}
const live=(t:Harness)=>t.swarm.effects.warnings.filter(w=>w.active);

describe('avisos que a horda desenha em jogo',()=>{
  it('milho artilheiro mostra direção, sem círculo no alvo',async()=>{const t=await setup();try{
    chargeUp(t,'corn',spot(0,12));
    expect(live(t).map(w=>w.kind)).toEqual(['aim']);
    const w=live(t)[0]!;
    expect(w.stretch).toBeCloseTo(3.2,6);expect(w.damage).toBe(0);
    for(let i=0;i<200;i++)t.swarm.fixedUpdate(1/60);
    expect(t.swarm.effects.attachedShapes).toBe(0);
  }finally{t.close();}});
  it('berinjela anuncia a faixa do trajeto com a largura de contato',async()=>{const t=await setup();try{
    const a=chargeUp(t,'eggplant',spot(0,8));
    const w=live(t)[0]!;
    expect(live(t)).toHaveLength(1);expect(w.kind).toBe('band');
    expect(w.radius).toBe((ENEMIES.eggplant.radius+.55)*2);
    expect(w.stretch).toBeCloseTo(9.5,2);
    expect(w.position.z).toBeCloseTo(a.root.position.z-w.stretch/2,6);
  }finally{t.close();}});
  it('faixa mostra o impulso comprometido inteiro, não a distância até o alvo inicial',async()=>{const t=await setup();try{
    const a=chargeUp(t,'eggplant',spot(0,3),1,true);
    const w=live(t)[0]!;
    expect(a.root.position.z).toBeCloseTo(3,6);
    expect(w.kind).toBe('band');
    // 10 m/s × 0.95 s de recuperação: o alvo a 3 m não encurta nada.
    expect(w.stretch).toBeCloseTo(9.5,2);
    expect(w.stretch).toBeGreaterThan(gap(a.root.position,a.locked)*3);
  }finally{t.close();}});
  it('alvo que recua depois do windup continua dentro da faixa anunciada',async()=>{const t=await setup();try{
    const a=chargeUp(t,'eggplant',spot(0,3),1,true);
    const w=live(t)[0]!,origin=spot(a.root.position.x,a.root.position.z),initial=gap(origin,a.locked);
    t.player.position.x=20;
    let traveled=0;
    for(let i=0;i<220&&a.state!=='chase';i++){t.swarm.fixedUpdate(1/60);traveled=gap(origin,a.root.position);}
    expect(traveled).toBeGreaterThan(initial);
    expect(traveled).toBeGreaterThan(w.stretch-.4);
    expect(traveled).toBeLessThanOrEqual(w.stretch+1e-6);
  }finally{t.close();}});
  it('parede real corta o alcance e a faixa termina onde a investida para',async()=>{const t=await setup();try{
    t.collision.boxes.push({id:'rush-wall',min:{x:-20,y:0,z:-2},max:{x:20,y:4,z:-1.8}});
    const a=chargeUp(t,'eggplant',spot(0,7),1,true);
    const w=live(t)[0]!,end=w.position.z-w.stretch/2;
    expect(a.root.position.z).toBeCloseTo(7,6);
    // O corpo (raio .8) encosta em z=-1.0, então sobram 8 m dos 9.5 do impulso.
    expect(w.stretch).toBeCloseTo(8,1);
    expect(w.stretch).toBeLessThan(9.5);
    expect(end).toBeGreaterThan(-1.05);
    t.player.position.x=20;
    for(let i=0;i<220&&a.state!=='chase';i++)t.swarm.fixedUpdate(1/60);
    expect(a.root.position.z).toBeCloseTo(end,1);
  }finally{t.close();}});
  it('melancia rolando anuncia o alcance do rolamento inteiro',async()=>{const t=await setup();try{
    chargeUp(t,'watermelon',spot(0,6),1,true);
    const w=live(t)[0]!;
    expect(w.kind).toBe('band');
    expect(w.radius).toBe((ENEMIES.watermelon.radius+.55)*2);
    expect(w.stretch).toBeCloseTo(9.35,2);
  }finally{t.close();}});
  it('melancia em mordida não desenha nada e o slot fica livre',async()=>{const t=await setup();try{
    chargeUp(t,'watermelon',spot(0,3),3);
    expect(live(t)).toHaveLength(0);
    expect(t.swarm.effects.attachedShapes).toBe(0);
  }finally{t.close();}});
  it('tomate mantém o círculo porque a poça de fogo existe de verdade',async()=>{const t=await setup();try{
    chargeUp(t,'tomato',spot(0,10));
    const w=live(t)[0]!;
    expect(live(t)).toHaveLength(1);expect(w.kind).toBe('fire-intent');
    expect(w.radius).toBe(2.3);expect(w.stretch).toBe(1);expect(w.damage).toBe(0);
    expect(w.position).toEqual({x:0,y:0,z:0});
  }finally{t.close();}});
  it('cenoura anuncia a linha real do feixe até onde ele alcança',async()=>{const t=await setup();try{
    const a=chargeUp(t,'carrot',spot(0,9));
    const w=live(t)[0]!;
    expect(live(t)).toHaveLength(1);expect(w.kind).toBe('band');expect(w.radius).toBe(1);
    expect(w.stretch).toBeGreaterThan(distanceTo(a.root.position));
    expect(w.mesh.rotation.y).toBeCloseTo(Math.atan2(0,-1),4);
  }finally{t.close();}});
  it('chefe desenha cone só na varredura e nada nos outros ataques',async()=>{const t=await setup();try{
    chargeUp(t,'boss',spot(0,14),4);
    expect(live(t).map(w=>w.kind)).toEqual(['cone']);
    expect(live(t)[0]!.radius).toBe(7);
    for(let i=0;i<300;i++)t.swarm.fixedUpdate(1/60);
    expect(t.swarm.effects.attachedShapes).toBe(0);
  }finally{t.close();}});
  it.each([1,2,3,5])('chefe no ataque %i não inventa área no windup',async attack=>{const t=await setup();try{
    const a=chargeUp(t,'boss',spot(0,14),attack);
    expect(live(t)).toHaveLength(0);
    expect(a.attack%5).toBe(attack%5);
  }finally{t.close();}});
  it('troca de estágio devolve todos os meshes auxiliares',async()=>{const t=await setup();try{
    chargeUp(t,'eggplant',spot(0,8));
    expect(t.swarm.effects.attachedShapes).toBe(1);
    t.swarm.nextStage();
    expect(t.swarm.effects.active).toBe(0);expect(t.swarm.effects.attachedShapes).toBe(0);
  }finally{t.close();}});
});
const distanceTo=(p:Vec3)=>Math.hypot(p.x,p.z);
