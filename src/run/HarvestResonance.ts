export type ResonanceAction='shot'|'melee'|'air';
export const RESONANCE_MAX=3;
/** Sem uma ação válida nova, cada nível expira depois deste intervalo. */
export const RESONANCE_DECAY_SECONDS=6;
/** Bônus modesto por nível na carga do totem. Todos os marcos continuam concluíveis sem ele. */
export const RESONANCE_CHARGE_BONUS=.12;

/**
 * Ressonância da Colheita: alternar tiro, corpo a corpo e ação aérea acumula um bônus temporário.
 * Repetir o mesmo tipo não acrescenta nível — e só contam eventos de combate válidos
 * (acerto real, não tecla pressionada), para não permitir farm de inputs.
 * Proposta de design deste projeto; não há alegação de ineditismo.
 */
export class HarvestResonance {
  level=0;
  private last:ResonanceAction|undefined;
  private idle=0;
  register(action:ResonanceAction):boolean {
    if(action===this.last){this.idle=0;return false;}
    this.last=action;this.idle=0;
    if(this.level>=RESONANCE_MAX)return false;
    this.level++;return true;
  }
  update(dt:number):void {
    if(this.level<=0){this.idle=0;this.last=undefined;return;}
    this.idle+=Math.max(0,dt);
    while(this.idle>=RESONANCE_DECAY_SECONDS&&this.level>0){this.idle-=RESONANCE_DECAY_SECONDS;this.level--;}
    if(this.level<=0){this.idle=0;this.last=undefined;}
  }
  get chargeMultiplier():number {return 1+this.level*RESONANCE_CHARGE_BONUS;}
  /** 0..1 até perder o próximo nível; o HUD usa para comunicar a duração. */
  get decayProgress():number {return this.level>0?Math.max(0,1-this.idle/RESONANCE_DECAY_SECONDS):0;}
  get nextAction():ResonanceAction[] {return (['shot','melee','air'] as const).filter(a=>a!==this.last);}
  reset():void {this.level=0;this.idle=0;this.last=undefined;}
}
