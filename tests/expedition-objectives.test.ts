import {describe,it,expect} from 'vitest';
import {CollisionWorld} from '../src/physics/CollisionWorld';
import {ExpeditionObjectives,planExpedition,findTotemSite,isOpenGround,CHALICE_JUICE_TARGETS,TOTEM_RADIUS,BOSS_RECOVERY_SECONDS,type TotemAnchor} from '../src/run/ExpeditionObjectives';
import {HarvestResonance,RESONANCE_MAX,RESONANCE_DECAY_SECONDS} from '../src/run/HarvestResonance';

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
    expect(isOpenGround(w,0,0,0,TOTEM_RADIUS)).toBe(true);
    expect(isOpenGround(w,0,80,0,TOTEM_RADIUS)).toBe(false);
    expect(isOpenGround(w,200,0,0,TOTEM_RADIUS)).toBe(false);
  });
  it('não devolve sítio quando nenhum anel ao redor da âncora tem piso largo',()=>{
    expect(findTotemSite(world(),{id:'islet',name:'Ilhota',x:200,y:0,z:0},TOTEM_RADIUS,()=>true)).toBeUndefined();
  });
  it('planeja marcos alcançáveis, separados e com os tempos pedidos',()=>{
    const sites=planExpedition(world(),anchors,{x:0,y:0,z:-20},()=>true);
    expect(sites).toHaveLength(2); // só as duas praças validam nesta maquete
    expect(sites.map(s=>s.id)).toEqual(['a','b']);
    expect(sites.map(s=>s.juiceTarget)).toEqual([CHALICE_JUICE_TARGETS[0],CHALICE_JUICE_TARGETS[1]]);
    expect(Math.hypot(sites[0]!.position.x-sites[1]!.position.x,sites[0]!.position.z-sites[1]!.position.z)).toBeGreaterThan(TOTEM_RADIUS*2.2);
  });
  it('descarta destino sem rota mesmo com piso válido',()=>{
    const sites=planExpedition(world(),anchors,{x:0,y:0,z:-20},p=>p.z<80);
    expect(sites.map(s=>s.id)).toEqual(['a']);
  });
});

let harvestSequence=0;
function collect(o:ExpeditionObjectives,count:number,at:{x:number;y:number;z:number},alive=true):void{
 for(let i=0;i<count;i++)o.harvest({sequence:++harvestSequence,kind:'carrot',position:at},at,alive);
}
describe('cálice por abates reais',()=>{
  const sites=planExpedition(world(),anchors,{x:0,y:0,z:-20},()=>true);
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
    const o=make(),at=sites[0]!.position;o.activate(at);collect(o,39,at);
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
    expect(o.rewardsPending).toBe(1);
    expect(o.activeIndex).toBe(-1);
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
  it('ativar outro marco pausa o anterior preservando o progresso',()=>{
    const o=make(),first=sites[0]!.position,second=sites[1]!.position;
    o.activate(first);collect(o,9,first);
    o.activate(second);
    expect(o.totems[0]!.state).toBe('paused');
    expect(o.totems[0]!.charged).toBeCloseTo(9,1);
    expect(o.current!.site.id).toBe(sites[1]!.id);
  });
  it('a ressonância acelera a carga sem ser necessária',()=>{
    const o=make(),at=sites[0]!.position;o.chargeMultiplier=1.36;o.activate(at);run(o,10,at);collect(o,10,at);
    expect(o.current!.charged).toBeCloseTo(13.6,1);
  });
});

describe('chefe e fenda',()=>{
  const sites=planExpedition(world(),anchors,{x:0,y:0,z:-20},()=>true);
  function completed():ExpeditionObjectives {
    const o=new ExpeditionObjectives();o.setSites(sites);
    for(const totem of o.totems){o.activate(totem.site.position);collect(o,totem.site.juiceTarget,totem.site.position);}
    return o;
  }
  it('entra na fase do chefe só depois dos marcos e abre a fenda ao derrotá-lo',()=>{
    const o=completed();
    expect(o.completed).toBe(o.total);
    expect(o.phase).toBe('boss');
    o.bossSpawned=true;o.onBossKilled();
    expect(o.phase).toBe('rift');
    expect(o.bossDefeated).toBe(true);
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
