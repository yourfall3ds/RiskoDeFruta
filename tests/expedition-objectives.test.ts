import {describe,it,expect} from 'vitest';
import {CollisionWorld} from '../src/physics/CollisionWorld';
import {ExpeditionObjectives,planExpedition,findTotemSite,isOpenGround,CHALICE_JUICE_TARGETS,TOTEM_RADIUS,BOSS_RECOVERY_SECONDS,type TotemAnchor} from '../src/run/ExpeditionObjectives';
import {HarvestResonance,RESONANCE_MAX,RESONANCE_DECAY_SECONDS} from '../src/run/HarvestResonance';
import {chooseChalice,FINAL_CHALICE_JUICE} from '../src/run/ExpeditionObjectives';
import {RunRNG} from '../src/core/RunRNG';

/** Duas praças largas, uma ponte estreita entre elas e uma ilhota curta. */
function world():CollisionWorld {
  const w=new CollisionWorld();
  w.surfaces.push({id:'plaza-a',x:0,z:0,width:80,depth:80,height:0});
  w.surfaces.push({id:'plaza-b',x:0,z:160,width:80,depth:80,height:0});
  w.surfaces.push({id:'narrow-bridge',x:0,z:80,width:4,depth:80,height:0});
  w.surfaces.push({id:'islet',x:200,z:0,width:9,depth:9,height:0});
  return w;
}
const anchors:readonly TotemAnchor[]=[
  {id:'a',name:'Praça sul',x:0,y:0,z:0},
  {id:'bridge',name:'Ponte',x:0,y:0,z:80},
  {id:'islet',name:'Ilhota',x:200,y:0,z:0},
  {id:'b',name:'Praça norte',x:0,y:0,z:160},
];

describe('colocação dos totens',()=>{
  it('aceita praça larga e recusa ponte estreita e ilhota curta',()=>{
    const w=world();
    expect(isOpenGround(w.surface,{x:0,y:0,z:0},TOTEM_RADIUS)).toBe(true);
    expect(isOpenGround(w.surface,{x:0,y:0,z:80},TOTEM_RADIUS)).toBe(false);
    expect(isOpenGround(w.surface,{x:200,y:0,z:0},TOTEM_RADIUS)).toBe(false);
  });
  it('recusa chão amplo cercado por parede fina ou sob um teto',()=>{
    const w=world();
    w.boxes.push({id:'thin-wall',min:{x:-15,y:0,z:6},max:{x:15,y:6,z:6.1}});
    expect(isOpenGround(w.surface,{x:0,y:0,z:0},TOTEM_RADIUS)).toBe(false);
    w.boxes.length=0;
    w.boxes.push({id:'roof',min:{x:-20,y:5,z:-20},max:{x:20,y:5.2,z:20}});
    expect(isOpenGround(w.surface,{x:0,y:0,z:0},TOTEM_RADIUS)).toBe(false);
  });
  it('não devolve sítio quando nenhum anel ao redor da âncora tem piso largo',()=>{
    expect(findTotemSite(world().surface,{id:'islet',name:'Ilhota',x:200,y:0,z:0},TOTEM_RADIUS,()=>true)).toBeUndefined();
  });
  it('planeja marcos alcançáveis, separados e com os tempos pedidos',()=>{
    const sites=planExpedition(world().surface,anchors,{x:0,y:0,z:-20},()=>true);
    expect(sites).toHaveLength(2); // só as duas praças validam nesta maquete
    expect(sites.map(s=>s.id)).toEqual(['a','b']);
    expect(sites.map(s=>s.juiceTarget)).toEqual([CHALICE_JUICE_TARGETS[0],CHALICE_JUICE_TARGETS[1]]);
    expect(Math.hypot(sites[0]!.position.x-sites[1]!.position.x,sites[0]!.position.z-sites[1]!.position.z)).toBeGreaterThan(TOTEM_RADIUS*2.2);
  });
  it('descarta destino sem rota mesmo com piso válido',()=>{
    const sites=planExpedition(world().surface,anchors,{x:0,y:0,z:-20},p=>p.z<80);
    expect(sites.map(s=>s.id)).toEqual(['a']);
  });
});

let harvestSequence=0;
function collect(o:ExpeditionObjectives,count:number,at:{x:number;y:number;z:number},alive=true):void{
 for(let i=0;i<count;i++)o.harvest({sequence:++harvestSequence,kind:'carrot',position:at},at,alive);
}
describe('cálice por abates reais',()=>{
  const sites=planExpedition(world().surface,anchors,{x:0,y:0,z:-20},()=>true);
  const make=()=>{const o=new ExpeditionObjectives();o.setSites(sites);return o;};
  const run=(o:ExpeditionObjectives,seconds:number,p:{x:number;y:number;z:number},alive=true)=>{for(let i=0;i<seconds*60;i++)o.update(1/60,p,alive);};

  it('credits each combat death once, including different deaths of a pooled actor',()=>{
    const o=make(),at=sites[0]!.position;o.activate(at);
    const kill={sequence:++harvestSequence,kind:'watermelon',position:at};
    expect(o.harvest(kill,at,true)?.amount).toBe(4);
    expect(o.harvest(kill,at,true)).toBeUndefined();
    expect(o.harvest({...kill,sequence:++harvestSequence},at,true)?.amount).toBe(4);
    expect(o.current!.charged).toBe(8);
  });
  it('rejects distant deaths and kills while the player is outside, without banking them for later',()=>{
    const o=make(),at=sites[0]!.position;o.activate(at);
    const far={x:at.x+100,y:at.y,z:at.z};
    const distant={sequence:++harvestSequence,kind:'watermelon',position:far};
    expect(o.harvest(distant,at,true)).toBeUndefined();
    const outside={sequence:++harvestSequence,kind:'watermelon',position:at};
    expect(o.harvest(outside,far,true)).toBeUndefined();
    expect(o.harvest(outside,at,true)).toBeUndefined();
    expect(o.current!.charged).toBe(0);
  });
  it('completes on a decisive kill, clamps overflow and keeps that exact reward position',()=>{
    const o=make(),at=sites[0]!.position;o.activate(at);o.onBossKilled(at);collect(o,39,at);
    const decisive={x:at.x+6,y:at.y+1,z:at.z};
    const result=o.harvest({sequence:++harvestSequence,kind:'watermelon',position:decisive},at,true);
    expect(result).toEqual({index:0,amount:1,complete:true});
    expect(o.totems[0]!.charged).toBe(40);
    expect(o.nextRewardPosition).toEqual(decisive);
    expect(o.rewardsPending).toBe(1);
    expect(o.harvest({sequence:++harvestSequence,kind:'watermelon',position:at},at,true)).toBeUndefined();
    o.takeReward();expect(o.nextRewardPosition).toBeUndefined();
  });

  it('requires activation and kills; waiting alone never fills the cup',()=>{
    const o=make(),at=sites[0]!.position;
    expect(o.activate({x:60,y:0,z:0})).toBeUndefined();
    expect(o.activate(at)).toBeDefined();
    run(o,10,at);
    expect(o.current!.charged).toBe(0);
    expect(o.current!.state).toBe('charging');
    collect(o,CHALICE_JUICE_TARGETS[0],at);
    expect(o.completed).toBe(1);
    expect(o.rewardsPending).toBe(0);
    expect(o.activeIndex).toBe(0);
    expect(o.phase).toBe('boss');
  });
  it('sair pausa a carga sem apagá-la e voltar retoma de onde parou',()=>{
    const o=make(),at=sites[0]!.position,away={x:at.x+60,y:0,z:at.z};
    o.activate(at);collect(o,12,at);
    const held=o.totems[0]!.charged;
    run(o,20,away);
    expect(o.totems[0]!.state).toBe('paused');
    expect(o.totems[0]!.charged).toBeCloseTo(held,3);
    run(o,5,at);collect(o,5,at);
    expect(o.totems[0]!.charged).toBeCloseTo(held+5,1);
  });
  it('morrer pausa a carga, não zera',()=>{
    const o=make(),at=sites[0]!.position;o.activate(at);collect(o,8,at);
    const held=o.totems[0]!.charged;run(o,10,at,false);collect(o,10,at,false);
    expect(o.totems[0]!.charged).toBeCloseTo(held,3);
  });
  it('só existe um cálice e ativar outra vez não reinicia a horda',()=>{
    const o=make(),first=sites[0]!.position,second=sites[1]!.position;
    o.activate(first);collect(o,9,first);
    o.activate(second);
    expect(o.totems).toHaveLength(1);
    expect(o.activate(first)).toBeUndefined();
    expect(o.totems[0]!.state).toBe('charging');
    expect(o.totems[0]!.charged).toBeCloseTo(9,1);
    expect(o.current!.site.id).toBe(sites[0]!.id);
  });
  it('a ressonância acelera a carga sem ser necessária',()=>{
    const o=make(),at=sites[0]!.position;o.chargeMultiplier=1.36;o.activate(at);run(o,10,at);collect(o,10,at);
    expect(o.current!.charged).toBeCloseTo(13.6,1);
  });
});

describe('chefe e embarque no cálice',()=>{
  const sites=planExpedition(world().surface,anchors,{x:0,y:0,z:-20},()=>true);
  function completed():ExpeditionObjectives {
    const o=new ExpeditionObjectives();o.setSites(sites);
    for(const totem of o.totems){o.activate(totem.site.position);collect(o,totem.site.juiceTarget,totem.site.position);}
    return o;
  }
  it('cálice cheio espera o chefe e a recompensa cai na morte dele',()=>{
    const o=completed();
    expect(o.completed).toBe(o.total);
    expect(o.phase).toBe('boss');
    expect(o.rewardsPending).toBe(0);
    const bossPosition={x:6,y:0,z:4};
    o.bossSpawned=true;o.onBossKilled(bossPosition);
    expect(o.phase).toBe('extract');
    expect(o.bossDefeated).toBe(true);
    expect(o.nextRewardPosition).toEqual(bossPosition);
    o.onBossKilled(bossPosition);expect(o.rewardsPending).toBe(1);
  });
  it('ativação chama o chefe imediatamente; matá-lo cedo não libera o embarque',()=>{
    const o=new ExpeditionObjectives();o.setSites(sites);
    const at=sites[0]!.position;
    expect(o.phase).toBe('totems');
    o.activate(at);expect(o.phase).toBe('boss');expect(o.completed).toBe(0);
    o.bossSpawned=true;o.onBossKilled(at);
    expect(o.phase).toBe('boss');expect(o.rewardsPending).toBe(0);
    collect(o,sites[0]!.juiceTarget-1,at);
    const last={x:at.x+5,y:at.y,z:at.z};
    o.harvest({sequence:++harvestSequence,kind:'carrot',position:last},at,true);
    expect(o.phase).toBe('extract');expect(o.nextRewardPosition).toEqual(last);
    expect(o.rewardsPending).toBe(1);
  });
  it('descobre o cálice ao se aproximar, sem iniciar o evento',()=>{
    const o=new ExpeditionObjectives();o.setSites(sites);
    o.update(1,{x:100,y:0,z:0},true);expect(o.discovered).toBe(false);
    o.update(1,{x:30,y:0,z:0},true);expect(o.discovered).toBe(true);
    expect(o.phase).toBe('totems');expect(o.current).toBeUndefined();
    o.reset();expect(o.discovered).toBe(false);
  });
  it('pede recuperação quando o chefe fica inacessível e zera ao recuperá-lo',()=>{
    const o=completed();o.bossSpawned=true;
    for(let i=0;i<BOSS_RECOVERY_SECONDS*60-1;i++)o.updateBoss(1/60,false);
    expect(o.needsBossRecovery).toBe(false);
    o.updateBoss(1/60,false);o.updateBoss(1/60,false);
    expect(o.needsBossRecovery).toBe(true);
    o.recoveredBoss();
    expect(o.needsBossRecovery).toBe(false);
    expect(o.bossRecoveries).toBe(1);
    for(let i=0;i<600;i++)o.updateBoss(1/60,true);
    expect(o.needsBossRecovery).toBe(false);
  });
  it('reset devolve todos os marcos e o chefe ao estado inicial',()=>{
    const o=completed();o.bossSpawned=true;o.onBossKilled();o.reset();
    expect(o.phase).toBe('totems');expect(o.completed).toBe(0);expect(o.rewardsPending).toBe(0);
    expect(o.totems.every(t=>t.state==='available'&&t.charged===0)).toBe(true);
    expect(o.bossSpawned).toBe(false);expect(o.bossDefeated).toBe(false);
  });
});

describe('um destino de exploração por estágio',()=>{
  const origin={x:0,y:0,z:0};
  const candidates=[0,80,160].map((x,index)=>({id:index?'island-'+index:'initial-field',name:'Ilha',index,position:{x,y:0,z:0},radius:11,juiceTarget:40}));
  const pick=(seed:string)=>chooseChalice(candidates,origin,new RunRNG(seed).stream('scene'));
  it('é determinístico, escolhe uma ilha distante e define o objetivo de suco',()=>{
    expect(pick('same')).toEqual(pick('same'));
    const found=new Set<string>();
    for(let i=0;i<30;i++){
      const site=pick(String(i))!;found.add(site.id);
      expect(site.position.x).toBeGreaterThanOrEqual(60);
      expect(site.juiceTarget).toBe(FINAL_CHALICE_JUICE);expect(site.index).toBe(0);
    }
    expect(found.size).toBe(2);
  });
  it('não inventa uma ilha sem rota quando não há candidato',()=>{
    expect(chooseChalice([],origin,new RunRNG('empty').stream('scene'))).toBeUndefined();
    expect(chooseChalice(candidates.slice(0,1),origin,new RunRNG('spawn').stream('scene'))).toBeUndefined();
  });
});

describe('Ressonância da Colheita',()=>{
  it('só sobe alternando tipos e respeita o teto',()=>{
    const r=new HarvestResonance();
    expect(r.register('shot')).toBe(true);
    expect(r.register('shot')).toBe(false);
    expect(r.level).toBe(1);
    r.register('melee');r.register('air');
    expect(r.level).toBe(RESONANCE_MAX);
    expect(r.register('shot')).toBe(false);
    expect(r.level).toBe(RESONANCE_MAX);
    expect(r.chargeMultiplier).toBeCloseTo(1.36,5);
  });
  it('perde níveis com o tempo e volta a zero',()=>{
    const r=new HarvestResonance();r.register('shot');r.register('melee');
    for(let i=0;i<RESONANCE_DECAY_SECONDS*60+1;i++)r.update(1/60);
    expect(r.level).toBe(1);
    for(let i=0;i<RESONANCE_DECAY_SECONDS*60+1;i++)r.update(1/60);
    expect(r.level).toBe(0);
    expect(r.chargeMultiplier).toBe(1);
    expect(r.register('shot')).toBe(true); // o tipo anterior foi esquecido ao zerar
  });
  it('não sugere repetir o último tipo',()=>{
    const r=new HarvestResonance();r.register('melee');
    expect(r.nextAction).toEqual(['shot','air']);
  });
});
