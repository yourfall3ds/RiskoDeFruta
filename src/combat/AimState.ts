/**
 * A mira apurada (ADS), como REGRA — fora do DOM, fora do Babylon e fora da cena.
 *
 * O botão direito deixou de carregar o especial (isso é o `Q` agora) e passou a ser mira. O que
 * "mirar" significa depende da arma na mão, e é essa tabela que o resto do jogo consome:
 *
 *   pistolas → aproximação DISCRETA, sem luneta;
 *   assalto  → alça mais fechada, aproximação discreta;
 *   sniper   → LUNETA, com aproximação ajustável na roda do mouse;
 *   granada  → NENHUMA aproximação: só a trajetória prevista e o ponto de queda.
 *
 * A classe guarda o mínimo — se está mirando, com que arma e em que aproximação — e devolve a
 * mesma view que a sobreposição visual (`WeaponAimOverlay`, do dono da interface) e a câmera
 * consomem. Tudo o mais (quando é PERMITIDO mirar) é decisão da cena, que passa `allowed`.
 */

export type AimKind='pistols'|'assault'|'sniper'|'grenade';

export interface AimModeTuning {
  /** Aproximação padrão ao entrar na mira. `1` é "nenhuma". */
  readonly zoom:number;
  /** Menor/maior aproximação aceita pela roda. Iguais a `zoom` quando não há ajuste. */
  readonly minZoom:number;
  readonly maxZoom:number;
  /** Passo multiplicativo por entalhe da roda. `1` desliga a roda. */
  readonly wheelStep:number;
  /** `true` desenha luneta (e é o único caso que pode esconder o corpo na frente da lente). */
  readonly scope:boolean;
  /** `true` desenha a trajetória prevista da cápsula. */
  readonly trajectory:boolean;
}

/**
 * Números da mira.
 *
 * As aproximações de pistola e assalto são de propósito DISCRETAS (18% e 32%): o pedido é "leve",
 * e um zoom grande numa arma de cadência alta só tira o campo de visão numa horda. O sniper abre
 * em 3× e a roda anda entre 1,8× e 8× — é a única arma com luneta.
 */
export const AIM_MODES:Readonly<Record<AimKind,AimModeTuning>>={
  pistols:{zoom:1.18,minZoom:1.18,maxZoom:1.18,wheelStep:1,scope:false,trajectory:false},
  assault:{zoom:1.32,minZoom:1.32,maxZoom:1.32,wheelStep:1,scope:false,trajectory:false},
  sniper:{zoom:3,minZoom:1.8,maxZoom:8,wheelStep:1.25,scope:true,trajectory:false},
  grenade:{zoom:1,minZoom:1,maxZoom:1,wheelStep:1,scope:false,trajectory:true},
};

/**
 * Que mira vale para a arma que está na mão.
 *
 * Uma função só, exportada, porque a cena (que liga a câmera e a sobreposição) e o painel de arma
 * (que anuncia a tecla) precisam da MESMA resposta — anunciar "luneta" com o assalto na mão seria
 * o tipo de mentira que o painel existe para evitar.
 */
export function aimKindFor(state:{readonly prismReady:boolean;readonly prismEquipped:boolean;readonly prismMode:0|1|2}):AimKind {
  if(!state.prismReady||!state.prismEquipped)return 'pistols';
  return state.prismMode===0?'assault':state.prismMode===1?'sniper':'grenade';
}

/** Intenção do quadro, já resolvida pela cena. */
export interface AimCommand {
  /** Botão direito preso NESTE quadro. */
  readonly hold:boolean;
  /** A arma que está na mão agora. */
  readonly kind:AimKind;
  /**
   * `false` cancela a mira na hora: menu aberto, pausa, foco perdido, morte, recarga,
   * transformação, entrada pela nave, viagem, corpo a corpo e habilidade de MP.
   */
  readonly allowed:boolean;
  /** Entalhes de roda acumulados desde a última leitura. Positivo aproxima. */
  readonly wheel?:number|undefined;
}

/** O que a câmera, a sobreposição e a cena leem. É exatamente o contrato do `WeaponAimOverlay`. */
export interface AimView {
  readonly active:boolean;
  readonly kind:AimKind;
  /** Multiplicador de aproximação. Sempre `1` fora da mira — nunca acumula entre miradas. */
  readonly zoom:number;
}

export class AimState {
  private activeValue=false;
  private kindValue:AimKind='pistols';
  /** Aproximação escolhida na roda, só do sniper. Volta ao padrão a cada mira nova. */
  private scopeZoom=AIM_MODES.sniper.zoom;

  get active():boolean {return this.activeValue;}
  get kind():AimKind {return this.kindValue;}
  /** `1` fora da mira: é assim que a câmera nunca herda aproximação de uma mirada anterior. */
  get zoom():number {return this.activeValue?this.zoomFor(this.kindValue):1;}
  get tuning():AimModeTuning {return AIM_MODES[this.kindValue];}
  /** `true` só no sniper mirando; é o único estado que pode esconder o corpo na frente da lente. */
  get scoped():boolean {return this.activeValue&&AIM_MODES[this.kindValue].scope;}
  /** `true` quando a arma na mão desenha a trajetória prevista (granada). */
  get showsTrajectory():boolean {return this.activeValue&&AIM_MODES[this.kindValue].trajectory;}
  /**
   * Fator de sensibilidade do mouse: inverso da aproximação.
   *
   * Sem ele o mesmo movimento de pulso varre o dobro do mundo em 2× de zoom — que é a queixa
   * clássica de mira sem compensação.
   */
  get sensitivityScale():number {return 1/this.zoom;}

  view():AimView {return {active:this.activeValue,kind:this.kindValue,zoom:this.zoom};}

  /**
   * Um quadro de mira. Devolve a view já atualizada.
   *
   * A roda só é CONSUMIDA mirando com o sniper: rolar com a granada, com o assalto, com as
   * pistolas ou fora da mira não guarda nada, então soltar e mirar de novo nunca revela uma
   * aproximação que o jogador não pediu.
   */
  update(command:AimCommand):AimView {
    if(!command.allowed){this.cancel();return this.view();}
    const kindChanged=command.kind!==this.kindValue;
    this.kindValue=command.kind;
    // Trocar de arma (ou de forma da PRISM) mirando reinicia a aproximação: a alça é outra.
    if(kindChanged)this.scopeZoom=AIM_MODES.sniper.zoom;
    if(!command.hold){this.release();return this.view();}
    if(!this.activeValue){this.activeValue=true;this.scopeZoom=AIM_MODES.sniper.zoom;}
    const wheel=command.wheel??0;
    if(wheel&&AIM_MODES[this.kindValue].wheelStep>1)this.applyWheel(wheel);
    return this.view();
  }

  /** Solta a mira preservando a arma. A aproximação volta ao padrão — nunca acumula. */
  release():void {this.activeValue=false;this.scopeZoom=AIM_MODES.sniper.zoom;}
  /** Cancelamento duro (pausa, morte, foco perdido, reinício de tentativa). */
  cancel():void {this.release();}

  private zoomFor(kind:AimKind):number {
    const tuning=AIM_MODES[kind];
    return tuning.wheelStep>1?this.scopeZoom:tuning.zoom;
  }

  private applyWheel(notches:number):void {
    const tuning=AIM_MODES[this.kindValue];
    const wanted=this.scopeZoom*Math.pow(tuning.wheelStep,notches);
    this.scopeZoom=Math.max(tuning.minZoom,Math.min(tuning.maxZoom,wanted));
  }
}
