import {describe,it,expect,vi} from 'vitest';
import {SaucerRaid,RAID_FIRST_DROP,RAID_SWARM_DROP,RAID_HOVER_HEIGHT,RAID_ARRIVAL_RADIUS} from '../src/run/SaucerRaid';
import type {Vec3} from '../src/core/contracts';

const PLAYER:Vec3={x:0,y:5,z:0};
const ORBIT:Vec3={x:-30,y:26,z:48};
/** Piso plano na altura do jogador; é o que o `CollisionWorld` devolveria num terreno liso. */
const ground=():number=>PLAYER.y;

/** Avança a investida em passos fixos de 1/60 s, como o laço do jogo. */
function run(raid:SaucerRaid,seconds:number,onDeliver:(at:Vec3,index:number,total:number)=>void=()=>{}):void {
  const step=1/60;
  for(let elapsed=0;elapsed<seconds;elapsed+=step)raid.update(step,PLAYER,ground,onDeliver);
}

describe('represália dos discos voadores',()=>{
  it('um tiro basta, e a escalada é 1 na primeira investida e 10 nas seguintes',()=>{
    const raid=new SaucerRaid();
    expect(raid.phase).toBe('patrol');
    expect(raid.provoke(ORBIT)).toBe(RAID_FIRST_DROP);
    expect(raid.phase).toBe('approach');
    // Provocar de novo no meio da investida não empilha nem reinicia nada.
    expect(raid.provoke(ORBIT)).toBe(0);
    expect(raid.pending).toBe(RAID_FIRST_DROP);
    raid.reset();
    raid.provoke(ORBIT);
    raid.reset();
    // Depois do primeiro ciclo completo, toda nova investida traz o enxame.
    const second=new SaucerRaid();
    second.provoke(ORBIT);
    run(second,40);
    expect(second.phase).toBe('patrol');
    expect(second.provoke(ORBIT)).toBe(RAID_SWARM_DROP);
  });

  it('sai da órbita, chega em cima do jogador e só então acende o feixe',()=>{
    const raid=new SaucerRaid();
    raid.provoke(ORBIT);
    expect(Math.hypot(raid.position.x-PLAYER.x,raid.position.z-PLAYER.z)).toBeGreaterThan(40);
    let beamedBeforeArrival=false;
    const step=1/60;
    for(let i=0;i<60*6;i++){
      raid.update(step,PLAYER,ground,()=>{});
      const horizontal=Math.hypot(raid.position.x-PLAYER.x,raid.position.z-PLAYER.z);
      if(raid.beaming&&horizontal>RAID_ARRIVAL_RADIUS+.5)beamedBeforeArrival=true;
      if(raid.phase==='beam')break;
    }
    expect(raid.phase).toBe('beam');
    expect(beamedBeforeArrival,'o feixe acendeu antes de a nave chegar').toBe(false);
    // Paira acima, nunca dentro do jogador.
    expect(raid.position.y-PLAYER.y).toBeGreaterThan(RAID_HOVER_HEIGHT*.6);
  });

  it('entrega exatamente um monstro por despejo, no chão, e some no fim',()=>{
    const raid=new SaucerRaid();
    raid.provoke(ORBIT);
    const deliver=vi.fn();
    run(raid,40,deliver);
    expect(deliver).toHaveBeenCalledTimes(RAID_FIRST_DROP);
    const [at]=deliver.mock.calls[0]! as [Vec3,number,number];
    expect(at.y).toBeCloseTo(PLAYER.y,5);
    expect(Math.hypot(at.x-PLAYER.x,at.z-PLAYER.z)).toBeLessThan(2);
    expect(raid.phase).toBe('patrol');
    expect(raid.pending).toBe(0);
    expect(raid.beam).toBe(0);
    expect(raid.commanding).toBe(false);
  });

  it('a investida do enxame larga os dez, um a um, espalhados em volta do jogador',()=>{
    const raid=new SaucerRaid();
    raid.provoke(ORBIT);run(raid,40);            // primeira investida, consome o "1"
    expect(raid.provoke(ORBIT)).toBe(RAID_SWARM_DROP);
    const landings:Vec3[]=[];const order:number[]=[];
    run(raid,60,(at,index,total)=>{landings.push(at);order.push(index);expect(total).toBeGreaterThanOrEqual(RAID_SWARM_DROP);});
    expect(landings).toHaveLength(RAID_SWARM_DROP);
    // Um a um e em ordem: nenhum índice repetido nem fora de sequência.
    expect(order).toEqual([...Array(RAID_SWARM_DROP).keys()]);
    // Espalhados: nenhum par exatamente sobreposto, e todos perto o bastante para assustar.
    for(let i=0;i<landings.length;i++){
      const a=landings[i]!;
      expect(Math.hypot(a.x-PLAYER.x,a.z-PLAYER.z)).toBeLessThan(6);
      for(let j=i+1;j<landings.length;j++){
        const b=landings[j]!;
        expect(Math.hypot(a.x-b.x,a.z-b.z)).toBeGreaterThan(.4);
      }
    }
    expect(raid.phase).toBe('patrol');
  });

  it('passo inválido e nave em órbita não movem nada',()=>{
    const raid=new SaucerRaid();
    const deliver=vi.fn();
    raid.update(.016,PLAYER,ground,deliver);          // em patrulha: ignora
    raid.provoke(ORBIT);
    const before={...raid.position};
    raid.update(Number.NaN,PLAYER,ground,deliver);
    raid.update(-1,PLAYER,ground,deliver);
    expect(raid.position).toEqual(before);
    expect(deliver).not.toHaveBeenCalled();
  });

  it('o piso inválido não deixa o monstro nascer flutuando',()=>{
    const raid=new SaucerRaid();
    raid.provoke(ORBIT);
    const deliver=vi.fn();
    // Sem piso resolvido, o pouso cai no nível em que o próprio jogador está pisando.
    for(let i=0;i<60*40;i++)raid.update(1/60,PLAYER,()=>Number.NaN,deliver);
    expect(deliver).toHaveBeenCalledTimes(RAID_FIRST_DROP);
    const [at]=deliver.mock.calls[0]! as [Vec3,number,number];
    expect(Number.isFinite(at.y)).toBe(true);
    expect(at.y).toBeCloseTo(PLAYER.y,5);
  });
});
