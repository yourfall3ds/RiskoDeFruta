import {describe,it,expect} from 'vitest';
import {WeatherCycle,WEATHER_STOPS,WEATHER_HOLD_SECONDS,WEATHER_BLEND_SECONDS,WEATHER_SECONDS_PER_KILL,WEATHER_MIN_FOG_END,type WeatherPhase} from '../src/world/WeatherCycle';

const run=(cycle:WeatherCycle,seconds:number,kills=0)=>{for(let i=0;i<Math.round(seconds*60);i++)cycle.update(1/60,kills);};

describe('ciclo de clima',()=>{
  it('começa no sol e percorre a ordem pedida',()=>{
    const cycle=new WeatherCycle();
    const period=WEATHER_HOLD_SECONDS+WEATHER_BLEND_SECONDS;
    const seen:WeatherPhase[]=[];
    // Lido no meio da janela estável de cada fase, longe das bordas de transição.
    for(let i=0;i<WEATHER_STOPS.length;i++){cycle.clock=period*i+WEATHER_HOLD_SECONDS/2;seen.push(cycle.phase);}
    expect(seen).toEqual(['sun','overcast','rain','dusk','night']);
    cycle.clock=period*WEATHER_STOPS.length+WEATHER_HOLD_SECONDS/2;
    expect(cycle.phase).toBe('sun'); // o ciclo fecha
  });
  it('a transição é contínua: nenhum salto entre quadros',()=>{
    const cycle=new WeatherCycle();
    let previous=cycle.sample();
    for(let i=0;i<60*60*6;i++){
      cycle.update(1/60);
      const now=cycle.sample();
      expect(Math.abs(now.sunIntensity-previous.sunIntensity)).toBeLessThan(.05);
      expect(Math.abs(now.exposure-previous.exposure)).toBeLessThan(.02);
      expect(Math.abs(now.rain-previous.rain)).toBeLessThan(.02);
      expect(Math.abs(now.fogEnd-previous.fogEnd)).toBeLessThan(2);
      previous=now;
    }
  });
  it('fica parado na fase antes de começar a misturar',()=>{
    const cycle=new WeatherCycle();
    run(cycle,WEATHER_HOLD_SECONDS-1);
    expect(cycle.position.blend).toBe(0);
    expect(cycle.sample().sunIntensity).toBe(WEATHER_STOPS[0]!.sunIntensity);
    run(cycle,2);
    expect(cycle.position.blend).toBeGreaterThan(0);
  });
  it('abates adiantam o relógio além do tempo real',()=>{
    const idle=new WeatherCycle(),busy=new WeatherCycle();
    run(idle,10);
    for(let i=0;i<600;i++)busy.update(1/60,Math.floor(i/6)); // 100 abates em 10 s
    expect(busy.clock).toBeGreaterThan(idle.clock);
    expect(busy.clock-idle.clock).toBeCloseTo(99*WEATHER_SECONDS_PER_KILL,0);
  });
  it('abates não podem retroceder o relógio',()=>{
    const cycle=new WeatherCycle();
    run(cycle,5,40);
    const before=cycle.clock;
    run(cycle,1,3); // contador menor (reinício de estágio)
    expect(cycle.clock).toBeGreaterThan(before);
  });
  it('pausa congela o clima',()=>{
    const cycle=new WeatherCycle();
    run(cycle,5);
    const held=cycle.clock;
    cycle.paused=true;run(cycle,20,50);
    expect(cycle.clock).toBe(held);
    cycle.paused=false;run(cycle,1);
    expect(cycle.clock).toBeGreaterThan(held);
  });
  it('chuva só existe na fase de chuva e arredores; o sol é seco',()=>{
    const cycle=new WeatherCycle();
    expect(cycle.sample().rain).toBe(0);
    const period=WEATHER_HOLD_SECONDS+WEATHER_BLEND_SECONDS;
    run(cycle,period*2);
    expect(cycle.phase).toBe('rain');
    expect(cycle.sample().rain).toBe(1);
    expect(cycle.sample().wetness).toBe(1);
  });
  it('a rota continua visível: a névoa nunca fecha além do limite',()=>{
    const cycle=new WeatherCycle();
    for(let i=0;i<60*60*12;i++){cycle.update(1/60);expect(cycle.sample().fogEnd).toBeGreaterThanOrEqual(WEATHER_MIN_FOG_END);}
  });
  it('as fases escuras aumentam a legibilidade em vez de apagar tudo',()=>{
    const day=WEATHER_STOPS.find(stop=>stop.phase==='sun')!;
    const night=WEATHER_STOPS.find(stop=>stop.phase==='night')!;
    expect(night.sunIntensity).toBeLessThan(day.sunIntensity);
    expect(night.readability).toBeGreaterThan(day.readability);
    for(const stop of WEATHER_STOPS)expect(stop.readability).toBeGreaterThanOrEqual(1);
  });
  it('reset volta ao sol',()=>{
    const cycle=new WeatherCycle();
    run(cycle,(WEATHER_HOLD_SECONDS+WEATHER_BLEND_SECONDS)*3);
    expect(cycle.phase).not.toBe('sun');
    cycle.reset();
    expect(cycle.phase).toBe('sun');
    expect(cycle.clock).toBe(0);
  });
  it('o rótulo do HUD acompanha a fase',()=>{
    const cycle=new WeatherCycle();
    expect(cycle.label).toBe('SOL');
    run(cycle,(WEATHER_HOLD_SECONDS+WEATHER_BLEND_SECONDS)*2);
    expect(cycle.label).toBe('CHUVA');
  });
});

describe('céu, umidade e seletor QA',()=>{
  it('a cobertura e a noite do céu acompanham a fase, não ficam num azul fixo',()=>{
    const cycle=new WeatherCycle();
    expect(cycle.sample().skyCoverage).toBe(0); // sol: panorama original intacto
    cycle.manualPhase='rain';
    expect(cycle.sample().skyCoverage).toBeGreaterThan(.6);
    cycle.manualPhase='night';
    expect(cycle.sample().skyNight).toBe(1);
    cycle.manualPhase='sun';
    expect(cycle.sample().skyNight).toBe(0);
  });
  it('a umidade sobe na chuva e escorre depois, sem voltar ao seco de um golpe',()=>{
    const cycle=new WeatherCycle();
    cycle.manualPhase='rain';
    expect(cycle.sample().wetness).toBe(1);
    cycle.manualPhase='dusk';
    expect(cycle.sample().wetness).toBeGreaterThan(0); // ainda molhado depois da chuva
    cycle.manualPhase='sun';
    expect(cycle.sample().wetness).toBe(0);
  });
  it('poeira ambiente existe no seco e some na chuva',()=>{
    const cycle=new WeatherCycle();
    expect(cycle.sample().motes).toBeGreaterThan(0);
    cycle.manualPhase='rain';
    expect(cycle.sample().motes).toBe(0);
  });
  it('o seletor QA fixa a fase e devolver ao automático retoma o relógio',()=>{
    const cycle=new WeatherCycle();
    run(cycle,40);
    const clock=cycle.clock;
    cycle.manualPhase='night';
    expect(cycle.phase).toBe('night');
    run(cycle,5); // o relógio continua andando por baixo
    cycle.manualPhase=undefined;
    expect(cycle.phase).toBe('sun');
    expect(cycle.clock).toBeGreaterThan(clock);
  });
  it('reset também libera a fase fixada',()=>{
    const cycle=new WeatherCycle();
    cycle.manualPhase='rain';cycle.reset();
    expect(cycle.manualPhase).toBeUndefined();
    expect(cycle.phase).toBe('sun');
  });
});
