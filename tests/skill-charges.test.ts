import {describe,it,expect} from 'vitest';
import {EventBus} from '../src/core/EventBus';
import {MPCharge,SKILL_CHARGE_RECHARGE} from '../src/combat/MPCharge';
import {RunProgression} from '../src/run/RunProgression';

const advance=(mp:MPCharge,seconds:number)=>{for(let i=0;i<Math.round(seconds*60);i++)mp.update(1/60,false);};

describe('cargas extras de especial',()=>{
  it('sem item não há carga e nada pode ser consumido',()=>{
    const mp=new MPCharge(new EventBus());
    expect(mp.maxCharges).toBe(0);
    expect(mp.consumeCharge()).toBe(false);
    expect(mp.chargeSecondsLeft).toBe(0);
  });
  it('o item entrega a carga cheia e o consumo é real',()=>{
    const mp=new MPCharge(new EventBus());
    mp.setMaxCharges(1);
    expect(mp.charges).toBe(1);
    expect(mp.consumeCharge()).toBe(true);
    expect(mp.charges).toBe(0);
    expect(mp.consumeCharge()).toBe(false); // sem carga, sem continuação
  });
  it('recarrega sozinha no tempo comunicado e não passa do teto',()=>{
    const mp=new MPCharge(new EventBus());
    mp.setMaxCharges(1);mp.consumeCharge();
    expect(mp.chargeSecondsLeft).toBeCloseTo(SKILL_CHARGE_RECHARGE,1);
    advance(mp,SKILL_CHARGE_RECHARGE/2);
    expect(mp.charges).toBe(0);
    expect(mp.chargeProgress).toBeGreaterThan(.45);
    expect(mp.chargeProgress).toBeLessThan(.55);
    advance(mp,SKILL_CHARGE_RECHARGE/2+.1);
    expect(mp.charges).toBe(1);
    advance(mp,SKILL_CHARGE_RECHARGE*3);
    expect(mp.charges).toBe(1);
    expect(mp.chargeProgress).toBe(1);
  });
  it('empilha por unidade do item e acompanha os atributos da partida',()=>{
    const run=new RunProgression(new EventBus()),mp=new MPCharge(new EventBus());
    expect(run.stats.skillCharges).toBe(0);
    run.addItem('reservoir');run.addItem('reservoir');
    expect(run.stats.skillCharges).toBe(2);
    mp.setMaxCharges(run.stats.skillCharges);
    expect(mp.charges).toBe(2);
    mp.consumeCharge();mp.consumeCharge();
    expect(mp.consumeCharge()).toBe(false);
  });
  it('perder o teto nunca deixa o contador acima do máximo',()=>{
    const mp=new MPCharge(new EventBus());
    mp.setMaxCharges(3);expect(mp.charges).toBe(3);
    mp.setMaxCharges(1);expect(mp.charges).toBe(1);
    mp.setMaxCharges(0);expect(mp.charges).toBe(0);
  });
  it('o item de corrida afeta só a corrida e o de caminhada afeta as duas',()=>{
    const run=new RunProgression(new EventBus());
    run.addItem('turbine');
    expect(run.stats.sprintSpeed).toBeCloseTo(1.12);
    expect(run.stats.moveSpeed).toBe(1);
    run.addItem('boot');
    expect(run.stats.moveSpeed).toBeCloseTo(1.1);
  });
});
