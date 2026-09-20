import {describe,it,expect,vi} from 'vitest';
import {SaucerRaid,RAID_FIRST_DROP,RAID_SWARM_DROP,RAID_HOVER_HEIGHT,RAID_ARRIVAL_RADIUS} from '../src/run/SaucerRaid';
import type {Vec3} from '../src/core/contracts';

const PLAYER:Vec3={x:0,y:5,z:0};
const ORBIT:Vec3={x:-30,y:26,z:48};
const ground=():number=>PLAYER.y;

type Delivery=[Vec3,number,number,boolean];

function run(raid:SaucerRaid,seconds:number,onDeliver:(at:Vec3,index:number,total:number,wave:boolean)=>void=()=>{}):void {
  const step=1/60;
  for(let elapsed=0;elapsed<seconds;elapsed+=step)raid.update(step,PLAYER,ground,onDeliver);
}

describe('evento do disco voador',()=>{
  it('um tiro abre o evento e a primeira visita deixa UM corpo',()=>{
    const raid=new SaucerRaid();
    expect(raid.phase).toBe('patrulha');
    expect(raid.provoke(ORBIT)).toBe(RAID_FIRST_DROP);
    expect(raid.phase).toBe('primeira-chegada');
    // Tiros durante o evento não empilham investidas.
    expect(raid.provoke(ORBIT)).toBe(0);
    const deliveries:Delivery[]=[];
    run(raid,40,(at,index,total,wave)=>deliveries.push([at,index,total,wave]));
    expect(deliveries).toHaveLength(RAID_FIRST_DROP);
    expect(deliveries[0]![3],'o primeiro despejo não é da onda').toBe(false);
    // Entregue o E.T., a nave sai e o evento espera a luta.
    expect(raid.phase).toBe('luta-et');
    expect(raid.commanding).toBe(false);
  });

  it('se o jogador foge e o E.T. desiste, o disco volta à patrulha em vez de travar na luta',()=>{
    const raid=new SaucerRaid();
    raid.provoke(ORBIT);
    run(raid,40);
    expect(raid.phase).toBe('luta-et');

    raid.abandoned();

    // Fuga NÃO é vitória: a segunda visita não é chamada e o evento volta ao começo...
    expect(raid.phase).toBe('patrulha');
    expect(raid.engaged).toBe(false);
    expect(raid.etDefeated()).toBe(0);
    // ...mas o disco volta a ser provocável, com um tiro novo, do zero.
    expect(raid.provoke(ORBIT)).toBe(RAID_FIRST_DROP);
  });

  it('a onda inteira desistindo encerra sem o item e sem deixar a nave presa',()=>{
    const raid=new SaucerRaid();
    raid.provoke(ORBIT);run(raid,40);
    expect(raid.etDefeated()).toBe(RAID_SWARM_DROP);
    const deliveries:Delivery[]=[];
    run(raid,60,(at,index,total,wave)=>deliveries.push([at,index,total,wave]));
    expect(deliveries).toHaveLength(RAID_SWARM_DROP);
    expect(raid.phase).toBe('onda-ativa');

    raid.abandoned();
    expect(raid.phase).toBe('patrulha');
    // `waveCleared` (que é o caminho do ITEM) já não tem onda para encerrar.
    raid.waveCleared();
    expect(raid.phase).toBe('patrulha');
  });

  it('desistência fora da luta não mexe em nada',()=>{
    const raid=new SaucerRaid();
    raid.abandoned();
    expect(raid.phase).toBe('patrulha');
    raid.provoke(ORBIT);
    raid.abandoned();
    // Em pleno voo de chegada a desistência é ignorada: ainda não há corpo em campo para fugir.
    expect(raid.phase).toBe('primeira-chegada');
  });

  it('sai da órbita e só acende o feixe depois de chegar em cima do jogador',()=>{
    const raid=new SaucerRaid();
    raid.provoke(ORBIT);
    expect(Math.hypot(raid.position.x-PLAYER.x,raid.position.z-PLAYER.z)).toBeGreaterThan(40);
    let beamedEarly=false;
    for(let i=0;i<60*8;i++){
      raid.update(1/60,PLAYER,ground,()=>{});
      if(raid.beaming&&Math.hypot(raid.position.x-PLAYER.x,raid.position.z-PLAYER.z)>RAID_ARRIVAL_RADIUS+.5)beamedEarly=true;
      if(raid.phase==='depositando-et')break;
    }
    expect(raid.phase).toBe('depositando-et');
    expect(beamedEarly,'o feixe acendeu antes de a nave chegar').toBe(false);
    expect(raid.position.y-PLAYER.y).toBeGreaterThan(RAID_HOVER_HEIGHT*.6);
  });

  it('é a MORTE do E.T. que chama o disco de volta, sem novo tiro',()=>{
    const raid=new SaucerRaid();
    raid.provoke(ORBIT);
    run(raid,40);
    expect(raid.phase).toBe('luta-et');
    // Enquanto o E.T. vive, nada acontece por mais que o tempo passe.
    const idle=vi.fn();
    run(raid,30,idle);
    expect(idle).not.toHaveBeenCalled();
    expect(raid.phase).toBe('luta-et');
    // Morreu: a segunda visita é anunciada na hora, e traz dez.
    expect(raid.etDefeated()).toBe(RAID_SWARM_DROP);
    expect(raid.phase).toBe('retornando');
    // Chamar de novo não repete o evento.
    expect(raid.etDefeated()).toBe(0);
  });

  it('a segunda visita despeja dez, um a um, espalhados e sem repetir índice',()=>{
    const raid=new SaucerRaid();
    raid.provoke(ORBIT);run(raid,40);
    raid.etDefeated();
    const deliveries:Delivery[]=[];
    run(raid,90,(at,index,total,wave)=>deliveries.push([{...at},index,total,wave]));
    expect(deliveries).toHaveLength(RAID_SWARM_DROP);
    expect(deliveries.map(d=>d[1])).toEqual([...Array(RAID_SWARM_DROP).keys()]);
    expect(deliveries.every(d=>d[3]),'todos os dez são da onda').toBe(true);
    for(let i=0;i<deliveries.length;i++){
      const a=deliveries[i]![0];
      expect(a.y).toBeCloseTo(PLAYER.y,5);
      expect(Math.hypot(a.x-PLAYER.x,a.z-PLAYER.z)).toBeLessThan(9);
      for(let j=i+1;j<deliveries.length;j++){
        const b=deliveries[j]![0];
        expect(Math.hypot(a.x-b.x,a.z-b.z),`despejo ${i} e ${j} no mesmo ponto`).toBeGreaterThan(.5);
      }
    }
    expect(raid.phase).toBe('onda-ativa');
    raid.waveCleared();
    expect(raid.phase).toBe('concluido');
    // Evento encerrado: nem tiro reabre.
    expect(raid.provoke(ORBIT)).toBe(0);
  });

  it('passo inválido e fases sem nave não movem nada',()=>{
    const raid=new SaucerRaid();
    const deliver=vi.fn();
    raid.update(.016,PLAYER,ground,deliver);      // em patrulha
    raid.provoke(ORBIT);
    const before={...raid.position};
    raid.update(Number.NaN,PLAYER,ground,deliver);
    raid.update(-1,PLAYER,ground,deliver);
    expect(raid.position).toEqual(before);
    expect(deliver).not.toHaveBeenCalled();
  });

  it('piso inválido não deixa ninguém nascer flutuando',()=>{
    const raid=new SaucerRaid();
    raid.provoke(ORBIT);
    const deliver=vi.fn();
    for(let i=0;i<60*40;i++)raid.update(1/60,PLAYER,()=>Number.NaN,deliver);
    expect(deliver).toHaveBeenCalledTimes(RAID_FIRST_DROP);
    const [at]=deliver.mock.calls[0]! as Delivery;
    expect(Number.isFinite(at.y)).toBe(true);
    expect(at.y).toBeCloseTo(PLAYER.y,5);
  });

  it('reset devolve tudo ao repouso',()=>{
    const raid=new SaucerRaid();
    raid.provoke(ORBIT);run(raid,40);raid.etDefeated();run(raid,20);
    raid.reset();
    expect(raid.phase).toBe('patrulha');
    expect(raid.pending).toBe(0);
    expect(raid.beam).toBe(0);
    expect(raid.commanding).toBe(false);
    expect(raid.provoke(ORBIT)).toBe(RAID_FIRST_DROP);
  });
});
