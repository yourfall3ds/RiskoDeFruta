import {PRISM_MODES,type PrismMode} from './PrismTuning';

/**
 * Carregador de UM modo da PRISM.
 *
 * Mesma semântica do `PistolMagazine` (inclusive a tolerância de ponto flutuante no fim da
 * recarga), com capacidade e tempo por modo em vez de fixos. Não herda de propósito: o carregador
 * da pistola é contrato de outra arma e mudar a assinatura dele para caber aqui mexeria em todo o
 * combate original.
 */
export class PrismMagazine {
  ammo: number;
  remaining = 0;
  constructor(readonly capacity: number, readonly reloadSeconds: number) {this.ammo=capacity;}
  get reloading(): boolean {return this.remaining>0;}
  get progress(): number {return this.reloading?1-this.remaining/this.reloadSeconds:0;}
  /** `false` quando já está recarregando ou o carregador está cheio. */
  request(): boolean {if(this.reloading||this.ammo===this.capacity)return false;this.remaining=this.reloadSeconds;return true;}
  consume(): boolean {if(this.reloading||this.ammo<=0)return false;this.ammo--;return true;}
  /** `true` no quadro em que a recarga fecha. */
  update(dt: number): boolean {
    if(!this.reloading)return false;
    const left=this.remaining-dt;this.remaining=left<=1e-9?0:left;
    if(this.remaining===0){this.ammo=this.capacity;return true;}
    return false;
  }
  /** Interrompe a recarga SEM devolver munição — é o que impede o exploit de recarga cancelada. */
  cancel(): void {this.remaining=0;}
  /** Reinício de tentativa: carregador cheio, sem recarga pendente. */
  refill(): void {this.remaining=0;this.ammo=this.capacity;}
}

/**
 * Os três carregadores e a forma em vigor.
 *
 * **Munição é POR MODO.** Alternar a forma nunca cria bala: o saldo de cada carregador fica onde
 * estava e volta exatamente como estava quando a forma volta. Isso fecha o exploit óbvio de um
 * carregador compartilhado — trocar de forma para "recarregar de graça" — sem precisar de nenhuma
 * regra extra: a troca simplesmente não toca em munição.
 *
 * Uma recarga em curso é CANCELADA ao trocar de forma (sem devolver munição). Deixá-la correndo
 * encheria o carregador de uma arma que não está nas mãos, com a animação de outra tocando.
 *
 * Puro de propósito: nenhuma dependência de cena, então o teste fecha o contrato sem Babylon.
 */
export class PrismArsenal {
  private readonly magazines: readonly [PrismMagazine,PrismMagazine,PrismMagazine];
  private current: PrismMode = 0;
  constructor() {
    this.magazines=[
      new PrismMagazine(PRISM_MODES[0].capacity,PRISM_MODES[0].reloadSeconds),
      new PrismMagazine(PRISM_MODES[1].capacity,PRISM_MODES[1].reloadSeconds),
      new PrismMagazine(PRISM_MODES[2].capacity,PRISM_MODES[2].reloadSeconds),
    ];
  }
  get mode(): PrismMode {return this.current;}
  get tuning() {return PRISM_MODES[this.current];}
  get magazine(): PrismMagazine {return this.magazines[this.current]!;}
  magazineOf(mode: PrismMode): PrismMagazine {return this.magazines[mode]!;}
  /** A próxima forma do ciclo autoral: assault → sniper → granada → assault. */
  get nextMode(): PrismMode {return ((this.current+1)%3) as PrismMode;}
  /**
   * Adota a forma recém-terminada pelo rig. Cancela uma recarga pendente do modo ANTERIOR: a arma
   * já é outra, e um carregador enchendo sozinho fora das mãos é munição de graça.
   */
  setMode(mode: PrismMode): void {
    if(mode===this.current)return;
    this.magazine.cancel();
    this.current=mode;
  }
  /** Munição total carregada, só para diagnóstico. */
  get loaded(): number {return this.magazines.reduce((total,m)=>total+m.ammo,0);}
  /** `true` quando qualquer forma está recarregando (só a em vigor pode estar). */
  get reloading(): boolean {return this.magazine.reloading;}
  resetAttempt(): void {this.current=0;for(const magazine of this.magazines)magazine.refill();}
  cancel(): void {for(const magazine of this.magazines)magazine.cancel();}
}
