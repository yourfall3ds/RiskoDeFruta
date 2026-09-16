import {describe,it,expect} from 'vitest';
import {UnarmedCombat,meleeReaches} from '../src/combat/UnarmedCombat';
import {MELEE_TUNING} from '../src/player/PlayerTuning';

const step=(melee:UnarmedCombat,seconds:number)=>{for(let i=0;i<Math.round(seconds*60);i++)melee.update(1/60);};
const total=(index:number)=>{const s=MELEE_TUNING.steps[index]!;return s.windup+s.active+s.recover;};
/** Executa uma etapa inteira registrando as fases percorridas. */
function runStep(melee:UnarmedCombat,queueNext=false):string[]{
  const phases:string[]=[];
  for(let i=0;i<600;i++){
    melee.update(1/60);
    if(phases.at(-1)!==melee.phase)phases.push(melee.phase);
    if(queueNext&&melee.phase==='recover')melee.strike();
    if(melee.phase==='idle'&&phases.length>1)break;
    if(queueNext&&phases.filter(p=>p==='active').length>1)break;
  }
  return phases;
}

describe('combate desarmado alternável',()=>{
  it('V guarda as pistolas e só então o golpe funciona',()=>{
    const melee=new UnarmedCombat();
    expect(melee.armed).toBe(true);
    expect(melee.strike()).toBe(false);
    expect(melee.toggle()).toBe(true);
    expect(melee.armed).toBe(false);
    expect(melee.strike()).toBe(true);
    expect(melee.phase).toBe('windup');
  });
  it('não troca de postura no meio de um golpe',()=>{
    const melee=new UnarmedCombat();melee.toggle();melee.strike();
    expect(melee.toggle()).toBe(false);
    expect(melee.armed).toBe(false);
  });
  it('percorre preparo, janela ativa e recuperação nesta ordem',()=>{
    const melee=new UnarmedCombat();melee.toggle();melee.strike();
    expect(runStep(melee)).toEqual(['windup','active','recover','idle']);
  });
  it('alterna direita, esquerda, gancho, chute e giro ao encadear',()=>{
    const melee=new UnarmedCombat();melee.toggle();melee.strike();
    const ids:string[]=[melee.step.id];
    for(let i=0;i<MELEE_TUNING.steps.length-1;i++){runStep(melee,true);ids.push(melee.step.id);}
    expect(ids).toEqual(MELEE_TUNING.steps.map(s=>s.id));
    expect(melee.heavy).toBe(true); // a última etapa é o giro
  });
  it('cada etapa ativa causa dano uma única vez por alvo',()=>{
    const melee=new UnarmedCombat();melee.toggle();melee.strike();
    step(melee,MELEE_TUNING.steps[0]!.windup+.01);
    expect(melee.phase).toBe('active');
    expect(melee.canHit(7)).toBe(true);melee.registerHit(7);
    expect(melee.canHit(7)).toBe(false);
    expect(melee.canHit(8)).toBe(true);
    // Na etapa seguinte o mesmo alvo pode ser atingido de novo.
    runStep(melee,true);
    expect(melee.stepIndex).toBe(1);
    expect(melee.phase).toBe('active');
    expect(melee.canHit(7)).toBe(true);
  });
  it('fora da janela ativa nenhum alvo pode ser atingido',()=>{
    const melee=new UnarmedCombat();melee.toggle();melee.strike();
    expect(melee.phase).toBe('windup');
    expect(melee.canHit(1)).toBe(false);
  });
  it('a cadência encurta a etapa inteira, não só o intervalo',()=>{
    const slow=new UnarmedCombat(),fast=new UnarmedCombat();
    slow.toggle();fast.toggle();fast.rateMultiplier=2;
    slow.strike();fast.strike();
    const measure=(melee:UnarmedCombat)=>{let t=0;while(melee.busy&&t<10){melee.update(1/60);t+=1/60;}return t;};
    const slowSeconds=measure(slow),fastSeconds=measure(fast);
    expect(slowSeconds).toBeCloseTo(total(0),1);
    expect(fastSeconds).toBeCloseTo(total(0)/2,1);
  });
  it('sacar as pistolas cancela o combo e restaura o estado inicial',()=>{
    const melee=new UnarmedCombat();melee.toggle();melee.strike();runStep(melee,true);
    while(melee.busy)melee.update(1/60);
    melee.toggle();
    expect(melee.armed).toBe(true);
    expect(melee.stepIndex).toBe(0);
    expect(melee.phase).toBe('idle');
  });
});

describe('alcance, cone e altura do golpe',()=>{
  const spin=MELEE_TUNING.steps.find(s=>s.id==='spin-kick')!,cross=MELEE_TUNING.steps[0]!;
  const origin={x:0,y:0,z:0};
  it('acerta à frente dentro do alcance',()=>{
    expect(meleeReaches(cross,origin,0,{x:0,y:0,z:2})).toBe(true);
  });
  it('recusa alvo além do alcance',()=>{
    expect(meleeReaches(cross,origin,0,{x:0,y:0,z:cross.range+1})).toBe(false);
  });
  it('recusa alvo atrás; o giro cobre os lados que o golpe frontal não alcança',()=>{
    expect(meleeReaches(cross,origin,0,{x:0,y:0,z:-2})).toBe(false);
    expect(meleeReaches(spin,origin,0,{x:0,y:0,z:-2.6})).toBe(false); // nem o giro acerta pelas costas
    expect(meleeReaches(cross,origin,0,{x:2,y:0,z:0})).toBe(false);   // 90° fora do cone frontal
    expect(meleeReaches(spin,origin,0,{x:2,y:0,z:0})).toBe(true);     // 90° dentro do arco do giro
  });
  it('respeita a diferença de altura',()=>{
    expect(meleeReaches(cross,origin,0,{x:0,y:4,z:1.5})).toBe(false);
  });
  it('o raio do alvo amplia o alcance efetivo',()=>{
    const far={x:0,y:0,z:cross.range+.9};
    expect(meleeReaches(cross,origin,0,far)).toBe(false);
    expect(meleeReaches(cross,origin,0,far,1.45)).toBe(true);
  });
  it('acompanha o yaw do jogador',()=>{
    expect(meleeReaches(cross,origin,Math.PI/2,{x:2,y:0,z:0})).toBe(true);
    expect(meleeReaches(cross,origin,Math.PI/2,{x:0,y:0,z:2})).toBe(false);
  });
});
