export type WeatherPhase='sun'|'overcast'|'rain'|'dusk'|'night';

export interface WeatherStop {
  phase:WeatherPhase;
  /** Cor do sol direcional. */
  sun:[number,number,number];
  sunIntensity:number;
  /** Preenchimento hemisférico (céu). */
  fill:[number,number,number];
  fillIntensity:number;
  fog:[number,number,number];
  fogStart:number;
  fogEnd:number;
  /** Exposição do pós-processamento. */
  exposure:number;
  /** 0..1 — chuva ativa. */
  rain:number;
  /** 0..1 — quanto o chão parece molhado. */
  wetness:number;
  /**
   * Reforço de contraste das fases escuras: quanto o preenchimento hemisférico sobe para os
   * inimigos e os marcos continuarem legíveis. 1 = sem reforço.
   */
  readability:number;
  /** Cor para a qual o panorama é puxado. */
  skyTint:[number,number,number];
  /** 0..1 — quanto dessa cor cobre o céu. */
  skyCoverage:number;
  /** 0..1 — escurecimento noturno do panorama. */
  skyNight:number;
  /** 0..1 — poeira/pólen ambiente das fases secas. */
  motes:number;
}

/**
 * Ciclo sol → nublado → chuva → crepúsculo → noite → sol.
 *
 * Cada parada define um estado completo; o ciclo interpola **continuamente** entre a parada atual e
 * a seguinte, então nunca há troca em corte seco. A identidade e a navegação são preservadas:
 * `readability` sobe nas fases escuras para os inimigos e os marcos continuarem legíveis, e a névoa
 * nunca fecha a ponto de esconder a rota (`fogEnd` mínimo de 150 m).
 */
export const WEATHER_STOPS:readonly WeatherStop[]=[
  {phase:'sun',      sun:[1,.88,.72],   sunIntensity:4.2, fill:[.56,.7,1],   fillIntensity:.5,  fog:[.34,.44,.62], fogStart:70, fogEnd:260, exposure:1.4,  rain:0,  wetness:0,  readability:1, skyTint:[.72,.8,.95], skyCoverage:0,   skyNight:0,   motes:.6},
  {phase:'overcast', sun:[.82,.84,.86], sunIntensity:2.6, fill:[.62,.66,.74], fillIntensity:.66, fog:[.5,.53,.58],  fogStart:55, fogEnd:220, exposure:1.24, rain:0,  wetness:.15, readability:1.05, skyTint:[.62,.65,.7], skyCoverage:.55, skyNight:.08, motes:.25},
  {phase:'rain',     sun:[.6,.7,.72],   sunIntensity:1.6, fill:[.42,.56,.58], fillIntensity:.72, fog:[.35,.47,.48], fogStart:40, fogEnd:170, exposure:1.12, rain:1,  wetness:1,  readability:1.18, skyTint:[.38,.46,.5],  skyCoverage:.85, skyNight:.22, motes:0},
  {phase:'dusk',     sun:[1,.62,.38],   sunIntensity:2.1, fill:[.42,.4,.6],   fillIntensity:.5,  fog:[.42,.32,.42], fogStart:50, fogEnd:200, exposure:1.3,  rain:.25, wetness:.7, readability:1.12, skyTint:[.85,.45,.3],  skyCoverage:.5,  skyNight:.35, motes:.4},
  {phase:'night',    sun:[.44,.55,.9],  sunIntensity:.85, fill:[.24,.3,.52],  fillIntensity:.42, fog:[.14,.18,.3],  fogStart:45, fogEnd:185, exposure:1.5,  rain:0,  wetness:.45, readability:1.35, skyTint:[.16,.2,.36],  skyCoverage:.45, skyNight:1,   motes:.2},
];

/** Segundos de permanência em cada fase antes de começar a transição. */
export const WEATHER_HOLD_SECONDS=95;
/** Segundos da transição contínua entre duas fases. */
export const WEATHER_BLEND_SECONDS=35;
/** Cada abate adianta o relógio do clima; a viagem também muda o céu, não só o tempo parado. */
export const WEATHER_SECONDS_PER_KILL=0.9;
/** A névoa nunca fecha além disto, para a rota continuar visível. */
export const WEATHER_MIN_FOG_END=150;

const mix=(a:number,b:number,t:number)=>a+(b-a)*t;
const mixColor=(a:[number,number,number],b:[number,number,number],t:number):[number,number,number]=>[mix(a[0],b[0],t),mix(a[1],b[1],t),mix(a[2],b[2],t)];

export class WeatherCycle {
  /** Relógio do clima: tempo real + crédito por abates. */
  clock=0;
  private kills=0;
  /** `true` congela o avanço (pausa, menu, cinemática). */
  paused=false;
  /**
   * Fase fixada pelo diagnóstico, para o QA ver cada tempo sem esperar dez minutos.
   * `undefined` devolve o ciclo automático exatamente de onde o relógio estava.
   */
  manualPhase:WeatherPhase|undefined;

  private get period():number {return WEATHER_HOLD_SECONDS+WEATHER_BLEND_SECONDS;}

  update(dt:number,totalKills=this.kills):void {
    if(this.paused)return;
    const gained=Math.max(0,totalKills-this.kills);
    this.kills=Math.max(this.kills,totalKills);
    this.clock+=Math.max(0,dt)+gained*WEATHER_SECONDS_PER_KILL;
  }

  /** Índice da parada atual e progresso 0..1 da transição para a seguinte. */
  get position():{index:number;blend:number} {
    if(this.manualPhase){
      const fixed=WEATHER_STOPS.findIndex(stop=>stop.phase===this.manualPhase);
      if(fixed>=0)return {index:fixed,blend:0};
    }
    const total=this.period*WEATHER_STOPS.length;
    const wrapped=((this.clock%total)+total)%total;
    const index=Math.floor(wrapped/this.period);
    const inside=wrapped-index*this.period;
    const blend=inside<=WEATHER_HOLD_SECONDS?0:(inside-WEATHER_HOLD_SECONDS)/WEATHER_BLEND_SECONDS;
    return {index,blend:Math.max(0,Math.min(1,blend))};
  }
  get phase():WeatherPhase {return WEATHER_STOPS[this.position.index]!.phase;}
  /** Fase para a qual está transicionando; igual à atual quando parado numa fase. */
  get nextPhase():WeatherPhase {
    const {index,blend}=this.position;
    return blend>0?WEATHER_STOPS[(index+1)%WEATHER_STOPS.length]!.phase:WEATHER_STOPS[index]!.phase;
  }

  /** Estado interpolado. Nunca salta: entre duas paradas todos os campos variam continuamente. */
  sample():WeatherStop {
    const {index,blend}=this.position;
    const from=WEATHER_STOPS[index]!,to=WEATHER_STOPS[(index+1)%WEATHER_STOPS.length]!;
    if(blend<=0)return {...from,fogEnd:Math.max(WEATHER_MIN_FOG_END,from.fogEnd)};
    // Suavização em S: sem quina no começo nem no fim da transição.
    const t=blend*blend*(3-2*blend);
    return {
      phase:t<.5?from.phase:to.phase,
      sun:mixColor(from.sun,to.sun,t),
      sunIntensity:mix(from.sunIntensity,to.sunIntensity,t),
      fill:mixColor(from.fill,to.fill,t),
      fillIntensity:mix(from.fillIntensity,to.fillIntensity,t),
      fog:mixColor(from.fog,to.fog,t),
      fogStart:mix(from.fogStart,to.fogStart,t),
      fogEnd:Math.max(WEATHER_MIN_FOG_END,mix(from.fogEnd,to.fogEnd,t)),
      exposure:mix(from.exposure,to.exposure,t),
      rain:mix(from.rain,to.rain,t),
      wetness:mix(from.wetness,to.wetness,t),
      readability:mix(from.readability,to.readability,t),
      skyTint:mixColor(from.skyTint,to.skyTint,t),
      skyCoverage:mix(from.skyCoverage,to.skyCoverage,t),
      skyNight:mix(from.skyNight,to.skyNight,t),
      motes:mix(from.motes,to.motes,t),
    };
  }
  /** Rótulo curto para o HUD. */
  get label():string {
    return {sun:'SOL',overcast:'NUBLADO',rain:'CHUVA',dusk:'CREPÚSCULO',night:'NOITE'}[this.sample().phase];
  }
  reset():void {this.clock=0;this.kills=0;this.paused=false;this.manualPhase=undefined;}
}
