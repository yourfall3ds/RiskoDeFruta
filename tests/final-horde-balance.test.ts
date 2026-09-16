import {describe,it,expect} from 'vitest';
import {RunRNG} from '../src/core/RunRNG';
import {ENEMIES,MonsterDirector,bossHealth,finalHordePressure,BOSS_BASE_HP,AMBIENT_EXPLORATION_CAP,FINAL_HORDE_PRESSURE_MIN,FINAL_HORDE_PRESSURE_MAX} from '../src/run/MonsterDirector';
import {PISTOL_TUNING} from '../src/player/PlayerTuning';
import {RunProgression} from '../src/run/RunProgression';
import {EventBus} from '../src/core/EventBus';

/** Vida da Praga Alfa antes desta entrega, para medir a diferença em vez de afirmá-la. */
const PREVIOUS_BOSS_HP=3600;

describe('a horda final deixa de ser um muro no começo',()=>{
  it('a Praga Alfa começa bem abaixo dos 3600 fixos e volta a crescer com estágio e nível',()=>{
    expect(ENEMIES.boss.hp).toBe(BOSS_BASE_HP);
    expect(bossHealth(1,1)).toBe(BOSS_BASE_HP);
    expect(bossHealth(1,1)).toBeLessThan(PREVIOUS_BOSS_HP*.5);
    // Progressão real: nunca encolhe e cresce nos dois eixos.
    for(let stage=1;stage<=6;stage++)for(let level=1;level<=20;level++){
      expect(bossHealth(stage,level+1)).toBeGreaterThan(bossHealth(stage,level));
      expect(bossHealth(stage+1,level)).toBeGreaterThan(bossHealth(stage,level));
    }
    // Quem chega longe volta a enfrentar um chefe maior que o antigo.
    expect(bossHealth(4,22)).toBeGreaterThan(PREVIOUS_BOSS_HP);
    // Entradas inválidas caem no piso em vez de produzir NaN.
    expect(bossHealth(Number.NaN,Number.NaN)).toBe(BOSS_BASE_HP);
    expect(bossHealth(0,0)).toBe(BOSS_BASE_HP);
  });

  it('o primeiro chefe cabe num combate sustentável para o nível em que ele aparece',()=>{
    const run=new RunProgression(new EventBus());
    // Perfil conservador de quem acabou de encontrar o primeiro cálice: nível 6, dois itens de dano.
    while(run.level<6)run.addXP(run.nextLevelXP);
    run.addItem('pruner');run.addItem('pruner');
    const dps=PISTOL_TUNING.rate*PISTOL_TUNING.damage*run.stats.damage;
    const seconds=bossHealth(1,run.level)/dps;
    expect(seconds).toBeLessThan(45);
    // E continua sendo uma luta: nada de derrubar a Praga Alfa em poucos segundos.
    expect(seconds).toBeGreaterThan(12);
    expect(PREVIOUS_BOSS_HP/dps).toBeGreaterThan(seconds*1.7);
  });

  it('o reforço da horda final acompanha o nível, sem portão de nível mínimo',()=>{
    expect(finalHordePressure(1)).toBe(FINAL_HORDE_PRESSURE_MIN);
    expect(finalHordePressure(1)).toBeLessThan(12); // o `+12` fixo anterior
    let previous=0;
    for(let level=1;level<=40;level++){
      const value=finalHordePressure(level);
      expect(value).toBeGreaterThanOrEqual(previous);
      expect(value).toBeGreaterThanOrEqual(FINAL_HORDE_PRESSURE_MIN);
      expect(value).toBeLessThanOrEqual(FINAL_HORDE_PRESSURE_MAX);
      previous=value;
    }
    expect(finalHordePressure(40)).toBe(FINAL_HORDE_PRESSURE_MAX);
    expect(finalHordePressure(Number.NaN)).toBe(FINAL_HORDE_PRESSURE_MIN);
  });

  /** Quantos hostis ficam vivos com o diretor livre para repor até o orçamento. */
  function population(level:number,seconds:number):number {
    const director=new MonsterDirector(new RunRNG('horda').stream('director'),1,50,'expedition');
    director.pressureCap=finalHordePressure(level);
    let alive=0;
    // Exploração até `seconds`, depois a horda final com pressão máxima.
    for(let tick=0;tick<seconds*60;tick++)director.update(1/60,0,alive,()=>{alive++;return true;},32);
    director.pressure=1;
    for(let tick=0;tick<240*60;tick++)director.update(1/60,0,alive,()=>{alive++;return true;},32);
    return alive;
  }

  it('a horda final no nível baixo cabe no campo, e cresce com o nível',()=>{
    const early=population(1,150),veteran=population(30,150);
    expect(early).toBeLessThanOrEqual(AMBIENT_EXPLORATION_CAP+FINAL_HORDE_PRESSURE_MIN);
    expect(early).toBeLessThan(15);
    expect(veteran).toBeGreaterThan(early);
    expect(veteran).toBeLessThanOrEqual(AMBIENT_EXPLORATION_CAP+FINAL_HORDE_PRESSURE_MAX);
  });

  it('explorar por muito tempo deixou de ser punido com uma horda ambiente sem teto',()=>{
    const director=new MonsterDirector(new RunRNG('exploracao').stream('director'),1,50,'expedition');
    let alive=0;
    // Vinte minutos de exploração com o orçamento inteiro disponível.
    for(let tick=0;tick<1200*60;tick++)director.update(1/60,0,alive,()=>{alive++;return true;},32);
    expect(alive).toBeLessThanOrEqual(AMBIENT_EXPLORATION_CAP);
    // A abertura suave continua exatamente como era.
    const opening=new MonsterDirector(new RunRNG('abertura').stream('director'),1,50,'expedition');
    let few=0;
    for(let tick=0;tick<30*60;tick++)opening.update(1/60,0,few,()=>{few++;return true;},32);
    expect(few).toBe(3);
    for(let tick=0;tick<30*60;tick++)opening.update(1/60,0,few,()=>{few++;return true;},32);
    expect(few).toBe(5);
  });

  it('o orçamento real de performance continua acima de tudo',()=>{
    const director=new MonsterDirector(new RunRNG('orcamento').stream('director'),1,50,'expedition');
    director.pressure=1;director.pressureCap=FINAL_HORDE_PRESSURE_MAX;
    let alive=6;
    for(let tick=0;tick<600*60;tick++)director.update(1/60,0,alive,()=>{alive++;return true;},6);
    expect(alive).toBe(6);
  });
});
