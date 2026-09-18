import {PRISM_MODES,type PrismMode} from '../combat/PrismTuning';

/** O que o painel de arma mostra: nome, munição e os controles que valem AGORA. */
export interface WeaponReadoutView {
  readonly label: string;
  readonly ammo: string;
  readonly hint: string;
}

/** Estado das duas armas, do ponto de vista do painel. Só leitura — nada aqui muda jogo. */
export interface WeaponReadoutState {
  /** `V`: punhos. Nem pistola nem PRISM nas mãos. */
  readonly holstered: boolean;
  /** O rig autoral da PRISM subiu; sem ele a tecla `B` nem é anunciada. */
  readonly prismReady: boolean;
  readonly prismEquipped: boolean;
  readonly prismMode: PrismMode;
  readonly prismAmmo: number;
  readonly prismCapacity: number;
  readonly prismReloading: boolean;
  /** 0…1 */
  readonly prismProgress: number;
  /** Transformação tocando: disparo, recarga e nova troca estão travados. */
  readonly prismBusy: boolean;
  readonly pistolAmmo: number;
  readonly pistolCapacity: number;
  readonly pistolReloading: boolean;
  readonly pistolProgress: number;
}

/**
 * Texto do painel de arma.
 *
 * Função pura, fora do DOM, porque é aqui que mora uma promessa ao jogador: o painel tem de dizer
 * QUAL arma está na mão, QUAL forma está montada e QUAIS teclas valem naquele instante. Anunciar
 * `R · RECARREGAR` durante uma transformação (quando a recarga está travada) é mentir para quem
 * está jogando — e é exatamente o tipo de coisa que só um teste pega.
 */
export function weaponReadout(state: WeaponReadoutState): WeaponReadoutView {
  const percent=(value: number): string=>`${Math.round(Math.max(0,Math.min(1,value))*100)}%`;
  if(state.holstered)
    return {label:'CORPO A CORPO',ammo:'COMBO',hint:'CLIQUE · GOLPEAR / V · SACAR'};
  if(state.prismEquipped){
    const mode=PRISM_MODES[state.prismMode];
    const hint=state.prismBusy?'TRANSFORMANDO · AGUARDE'
      :state.prismReloading?`RECARREGANDO · ${percent(state.prismProgress)}`
      :'R · RECARREGAR / T · FORMA / B · PISTOLAS / V · GUARDAR';
    return {label:mode.name,ammo:`${state.prismAmmo} / ${state.prismCapacity}`,hint};
  }
  const hint=state.pistolReloading?`RECARREGANDO · ${percent(state.pistolProgress)}`
    :state.prismReady?'R · RECARREGAR / B · PRISM / V · GUARDAR'
    :'R · RECARREGAR / V · GUARDAR';
  return {label:'PISTOLAS DUPLAS',ammo:`${state.pistolAmmo} / ${state.pistolCapacity}`,hint};
}
