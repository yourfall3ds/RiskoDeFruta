/**
 * Molhado que chega rápido e seca devagar.
 *
 * Antes a umidade era `state.wetness` aplicado direto: o chão secava no mesmo ritmo em que a nuvem
 * passava e todos os materiais molhavam exatamente igual. O olho lê isso como um filtro, não como
 * água. Aqui existem duas correções:
 *
 * 1. **Histerese.** Molhar leva segundos, secar leva minutos. Depois que a chuva para, o chão
 *    continua escuro e brilhante por um tempo, que é o que acontece de verdade.
 * 2. **Variação por material.** Terra batida encharca e demora a soltar; pedra brilha logo e seca
 *    logo. A absorvência vem de um hash estável do nome, então é sempre a mesma para o mesmo
 *    material — sem sorteio por sessão.
 *
 * É puro: nenhuma referência a Babylon, para o teste conseguir percorrer horas simuladas.
 */

/** Segundos para o chão exposto encharcar por completo. */
export const WET_RISE_SECONDS=11;
/** Segundos para secar por completo — bem mais longo, é o que dá o rastro da chuva. */
export const WET_DRY_SECONDS=110;
/** Quanto a rugosidade original cai com a superfície encharcada. */
export const WET_ROUGHNESS_DROP=.5;
/** Quanto o albedo original escurece com a superfície encharcada. */
export const WET_ALBEDO_DROP=.32;
/** Reforço do brilho especular (F0) do filme de água, quando o material expõe o parâmetro. */
export const WET_SPECULAR_GAIN=.35;

const clamp01=(n:number)=>Math.max(0,Math.min(1,Number.isFinite(n)?n:0));

/**
 * Absorvência 0..1 a partir do nome do material. Estável entre sessões e entre clientes.
 * Terra e folhagem seguram água; pedra, chapa e trilha batida soltam rápido.
 */
export function absorbency(name:string):number {
  const lower=name.toLowerCase();
  let base=.5;
  if(/soil|dirt|mud|terra|leaf|litter|field|cultivat/.test(lower))base=.82;
  else if(/rock|stone|cliff|metal|iron|roof|plank|wood/.test(lower))base=.22;
  else if(/track|trilha|path|road/.test(lower))base=.55;
  // Pequena dispersão por nome, para dois materiais da mesma família não responderem idênticos.
  let hash=2166136261;
  for(let i=0;i<name.length;i++){hash^=name.charCodeAt(i);hash=Math.imul(hash,16777619);}
  return clamp01(base+(((hash>>>0)%1000)/1000-.5)*.18);
}

/** Estado de um material acompanhado pela chuva. */
export interface WetEntry {
  /** 0..1 — quanto de água este material está segurando agora. */
  level:number;
  /** 0..1 — quanto ele segura e quanto demora a soltar. */
  absorbency:number;
}

export class WetnessField {
  /** Nível exposto, sem variação por material. É o valor que o HUD e os testes leem. */
  level=0;
  private readonly entries=new Map<string,WetEntry>();

  /** Registra (ou devolve) o acompanhamento de um material pelo nome. */
  track(name:string):WetEntry {
    let entry=this.entries.get(name);
    if(!entry){entry={level:this.level*(.55+.45*absorbency(name)),absorbency:absorbency(name)};this.entries.set(name,entry);}
    return entry;
  }
  forget(name:string):void {this.entries.delete(name);}
  get tracked():number {return this.entries.size;}

  /**
   * `target` é a umidade pedida pelo ciclo (0..1). Subir é rápido, descer é lento, e materiais
   * absorventes atrasam as duas coisas — principalmente a secagem.
   */
  update(dt:number,target:number):void {
    const step=Number.isFinite(dt)&&dt>0?Math.min(dt,1):0;
    if(step===0)return;
    const wanted=clamp01(target);
    this.level=approach(this.level,wanted,step,WET_RISE_SECONDS,WET_DRY_SECONDS);
    for(const entry of this.entries.values()){
      // Quem absorve mais chega a um nível mais alto e demora bem mais para largar.
      const ceiling=wanted*(.62+.38*entry.absorbency);
      const dry=WET_DRY_SECONDS*(.55+.9*entry.absorbency);
      const rise=WET_RISE_SECONDS*(.7+.6*entry.absorbency);
      entry.level=approach(entry.level,ceiling,step,rise,dry);
    }
  }

  /** Umidade efetiva de um material, já com a variação aplicada. */
  wetnessOf(name:string):number {return clamp01(this.track(name).level);}

  reset(level=0):void {
    this.level=clamp01(level);
    for(const [name,entry] of this.entries)entry.level=this.level*(.55+.45*absorbency(name));
  }
  clear():void {this.entries.clear();this.level=0;}
}

/** Aproximação exponencial com constantes diferentes para subir e para descer. */
function approach(current:number,target:number,dt:number,rise:number,dry:number):number {
  const seconds=target>current?rise:dry;
  if(seconds<=0)return target;
  // Exponencial: independente da taxa de quadros e sem ultrapassar o alvo.
  return current+(target-current)*(1-Math.exp(-dt/(seconds/3)));
}
