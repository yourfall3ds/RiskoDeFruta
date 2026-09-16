export type FootSide=0|1;
/** Altura do pé acima do piso, em metros, medida no osso real do clipe dominante. */
export interface FootSample {side:FootSide;height:number}

/**
 * Passos disparados pelo **contato real do pé**, não por um relógio de áudio nem por distância.
 * Como lê a altura do osso depois de o clipe dominante ser amostrado, funciona igual para
 * frente, trás, laterais e diagonais — e acompanha sozinho corrida e velocidade variável.
 *
 * A máquina é a mesma de qualquer detector de passada por pose: o pé precisa **levantar** acima de
 * `liftHeight` (fica *armado*) e só depois **descer** até `contactHeight` para virar apoio. A ideia
 * vem do `FootStepDetector` de https://github.com/dropecho/unity_footstep (MIT, © 2023 Benjamin
 * Van Treese — cópia em `docs/licenses/unity_footstep-LICENSE.md`); nenhum código foi transcrito e
 * três defeitos da referência foram deixados de fora de propósito:
 *
 * - lá o intervalo mínimo é **global**, então numa passada rápida o segundo pé some sem aviso.
 *   Aqui o intervalo é por pé e um contato barrado por ele soma em `crowded` em vez de sumir calado;
 * - lá `previousFootHeight` começa em zero, o que inventa uma descida no primeiro quadro. Aqui o
 *   primeiro quadro de cada pé só **semeia** o estado (`previous` começa `NaN`) e nunca emite;
 * - lá a velocidade do pé é a diferença bruta por quadro, logo o limiar muda com o FPS. Aqui a
 *   descida é medida em m/s e o teste é "não está subindo", que sobrevive ao platô do apoio.
 *
 * Os limiares são absolutos e medidos no rig real (`scripts/audit-footstep-clips.ts` →
 * `docs/footstep-clip-contacts.json`), não chutados: no `gunslinger.glb` o pivô do dedo apoiado
 * fica a ~3,7 cm do chão, o `Idle` respira entre 7,3 e 7,7 cm e o clipe de menor amplitude
 * (`WalkBackward`/`StrafeLeft`/`StrafeRight`) levanta o pé até 15,7 cm.
 */
export class FootstepSync {
  /**
   * Apoio: abaixo disto, descendo, o pé encostou.
   *
   * 4,8 cm fica numa janela estreita e medida: o platô de apoio mais ALTO de todos os clipes é
   * 3,8 cm (`StrafeRight`, pé esquerdo) e o mergulho falso mais BAIXO é 5,9 cm — o meio-balanço do
   * pé esquerdo no `Walk`, que descia, subia de novo até 17,6 cm e voltava. Com o valor antigo
   * (8,5 cm) esse mergulho contava como apoio e o `Walk` soava ~3,75 passos/s com pés repetidos.
   */
  contactHeight=.048;
  /** Rearme: o pé precisa passar disto para poder virar apoio de novo. Acima da respiração do `Idle`. */
  liftHeight=.095;
  /** Intervalo mínimo POR PÉ. O apoio mais curto medido é o da corrida, 0,3 s por pé. */
  minIntervalSeconds=.09;
  /** Abaixo desta velocidade o corpo está parado — o mesmo corte que troca o clipe para `Idle`. */
  minSpeed=.5;
  /** Subida (m/s) ainda aceita como contato. Sem folga, o quadro do platô perderia o apoio. */
  descentTolerance=.03;
  /**
   * Janela em que a aterrissagem vale por UM som.
   *
   * O clipe de pouso desce os dois pés quase juntos — medido: o pé esquerdo cruza o apoio 8 quadros
   * depois do toque no chão e o direito 14, ou seja 0,23 s entre eles. Sem janela saíam dois sons
   * coladinhos, que é o "aterrissagem duplicada". Dentro dela o primeiro apoio soa (mesmo parado,
   * porque pousar é audível) e o segundo apoia calado.
   */
  landingWindowSeconds=.26;
  /** Silencia sem perder o estado: combate, intro e morte apoiam o pé mas não tocam nada. */
  muted=false;
  steps=0;
  /** Apoios reais barrados pelo intervalo mínimo. Diagnóstico: deve ficar em 0 nos clipes do jogo. */
  crowded=0;
  private readonly armed=[false,false];
  private readonly planted=[false,false];
  private readonly previous=[Number.NaN,Number.NaN];
  private readonly cooldown=[0,0];
  private airborne=false;
  private landing=0;private landingHeard=false;

  update(dt:number,samples:readonly FootSample[],grounded:boolean,speed:number,emit:(side:FootSide,strength:number)=>void):void {
    const step=Math.max(0,dt);
    for(let i=0;i<2;i++)this.cooldown[i]=Math.max(0,this.cooldown[i]!-step);
    this.landing=Math.max(0,this.landing-step);
    const strength=Math.max(.35,Math.min(1,speed/8));
    if(!grounded){
      // No ar nada fica armado nem apoiado, mas a altura continua sendo guardada: sem isso o
      // primeiro quadro no chão compara contra um valor velho e inventa uma descida.
      this.airborne=true;this.landing=0;this.landingHeard=false;
      for(const {side,height} of samples)this.previous[side]=height;
      this.armed[0]=this.armed[1]=this.planted[0]=this.planted[1]=false;
      return;
    }
    if(this.airborne){
      // Tocar o chão NÃO é o passo. No quadro em que `grounded` vira verdadeiro os pés ainda estão
      // a 37 e 32 cm do chão no clipe de pouso — emitir aqui era um som antes da pisada aparecer.
      // O que abre é só a janela; quem soa é o pé quando ele realmente chega ao chão, abaixo.
      this.airborne=false;this.landing=this.landingWindowSeconds;this.landingHeard=false;
    }
    for(const {side,height} of samples){
      const previous=this.previous[side]!;this.previous[side]=height;
      if(Number.isNaN(previous)){
        // Primeiro quadro deste pé: só semeia. Um contato aqui seria adivinhação, não medição.
        this.armed[side]=height>this.liftHeight;this.planted[side]=height<=this.contactHeight;
        continue;
      }
      if(height>this.liftHeight){this.armed[side]=true;this.planted[side]=false;}
      if(!this.armed[side]||this.planted[side]||height>this.contactHeight)continue;
      const rising=step>0?(height-previous)/step>this.descentTolerance:height>previous;
      if(rising)continue;
      this.planted[side]=true;this.armed[side]=false;
      if(this.cooldown[side]!>0){this.crowded++;continue;}
      this.cooldown[side]=this.minIntervalSeconds;
      if(this.muted)continue;
      if(this.landing>0){
        // Pousar é audível mesmo parado; o segundo pé da MESMA aterrissagem apoia calado.
        if(this.landingHeard)continue;
        this.landingHeard=true;
      } else if(speed<this.minSpeed)continue;
      this.steps++;emit(side,strength);
    }
  }
  reset():void {
    this.armed[0]=this.armed[1]=this.planted[0]=this.planted[1]=false;
    this.previous[0]=this.previous[1]=Number.NaN;this.cooldown[0]=this.cooldown[1]=0;
    this.airborne=false;this.landing=0;this.landingHeard=false;this.steps=0;this.crowded=0;this.muted=false;
  }
}
