/**
 * Vento coerente da chuva.
 *
 * Uma única função pura alimenta **todas** as camadas: perto, meio, véu distante e o ângulo do
 * respingo. Sem isso cada sistema de partículas escolheria a própria deriva e a chuva lia como três
 * efeitos independentes sobrepostos — parte do que fazia a versão anterior parecer procedural.
 *
 * O resultado é contínuo por construção (soma de senos), limitado e determinístico: o mesmo relógio
 * devolve o mesmo vento em qualquer máquina, o que também vale para dois clientes de co-op.
 */

/** Velocidade horizontal de base, em m/s. */
export const WIND_BASE_SPEED=3.2;
/** Amplitude da rajada somada à base. */
export const WIND_GUST_SPEED=2.6;
/** Segundos para a direção dar uma volta lenta. */
export const WIND_TURN_SECONDS=47;
/** Período da rajada principal. */
export const WIND_GUST_SECONDS=7.4;
/** Teto absoluto da velocidade — a chuva inclina, não vira ventania horizontal. */
export const WIND_MAX_SPEED=WIND_BASE_SPEED+WIND_GUST_SPEED;

export interface RainWind {
  /** Direção horizontal normalizada. */
  x:number;
  z:number;
  /** Velocidade em m/s no plano. */
  speed:number;
  /** 0..1 — quanto da rajada está aplicado neste instante. */
  gust:number;
}

const clamp01=(n:number)=>Math.max(0,Math.min(1,Number.isFinite(n)?n:0));

/**
 * `clock` é o relógio da apresentação em segundos; `rain` é a intensidade 0..1 do ciclo.
 * Com chuva fraca o vento não some: fica na fração de repouso, senão a transição daria um corte.
 */
export function rainWind(clock:number,rain:number):RainWind {
  const t=Number.isFinite(clock)?clock:0;
  const strength=.45+.55*clamp01(rain);
  // Direção: uma volta lenta com uma segunda harmônica, para não ser uma rotação perfeitamente
  // regular. Continuidade vem de graça por ser soma de senos.
  const angle=t/WIND_TURN_SECONDS*Math.PI*2+.6*Math.sin(t/(WIND_TURN_SECONDS*.37)*Math.PI*2);
  const gust=clamp01(.5+.32*Math.sin(t/WIND_GUST_SECONDS*Math.PI*2)+.18*Math.sin(t/(WIND_GUST_SECONDS*.41)*Math.PI*2+1.7));
  return {
    x:Math.sin(angle),
    z:Math.cos(angle),
    speed:(WIND_BASE_SPEED+WIND_GUST_SPEED*gust)*strength,
    gust,
  };
}

/** Deriva horizontal aplicada a uma camada, em m/s. Camadas lentas derivam menos. */
export function windDrift(wind:RainWind,factor:number):{x:number;z:number} {
  return {x:wind.x*wind.speed*factor,z:wind.z*wind.speed*factor};
}
