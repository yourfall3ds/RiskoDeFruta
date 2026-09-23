import {PRISM_MODES,type PrismMode} from '../combat/PrismTuning';
import {prismSkill} from '../combat/PrismSkills';
import {MARIJUANO_SMG,marijuanoSkill} from '../combat/SmgTuning';
import {AIM_MODES,aimKindFor,type AimKind} from '../combat/AimState';
import {PLAYER_CLASSES,type PlayerClassId} from '../run/PlayerClass';

/**
 * O que o botão direito faz com CADA arma na mão.
 *
 * O painel não pode prometer luneta a quem está com o assalto nem zoom a quem está com o
 * lança-granadas: a mira apurada é diferente por arma, e o texto segue a tabela real (`AIM_MODES`).
 */
const AIM_HINTS:Readonly<Record<AimKind,string>>={
  pistols:'DIREITO · MIRA',
  assault:'DIREITO · ALÇA',
  sniper:'DIREITO · LUNETA',
  grenade:'DIREITO · TRAJETÓRIA',
  smg:'DIREITO · FECHAR LEQUE',
};

/** O que o painel de arma mostra: nome, munição e os controles que valem AGORA. */
export interface WeaponReadoutView {
  readonly label: string;
  readonly ammo: string;
  readonly hint: string;
  /**
   * Rótulos da barra de carga do `Q`, indexados pelo NÍVEL (`0` = ainda carregando).
   *
   * Vêm daqui porque quem sabe o que o `Q` faz é a classe — e, no soldado, a FORMA que está nas
   * mãos. O HUD só desenha o que recebe: prometer "barragem com mortal" a um soldado com a lança de
   * íons montada seria exatamente a mentira que este módulo existe para evitar.
   */
  readonly charge: readonly [string,string,string,string];
  /** `true` quando o nível I não cobra MP (soldado: transformar é grátis). */
  readonly freeFirstTier: boolean;
  /** Habilidade no ar NESTE quadro; `''` quando não há nenhuma. */
  readonly active: string;
}

/** Estado das armas, do ponto de vista do painel. Só leitura — nada aqui muda jogo. */
export interface WeaponReadoutState {
  /**
   * A classe escolhida no menu. Ela é FIXA durante a tentativa: não existe tecla de troca de arma,
   * e por isso nenhuma dica de troca sai daqui.
   */
  readonly playerClass: PlayerClassId;
  /** `V`: punhos. Nem pistola nem PRISM nas mãos. */
  readonly holstered: boolean;
  /** O rig autoral da PRISM subiu. Sem ele o soldado cai nas pistolas, com o motivo no F1. */
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
  /** O rig da submetralhadora subiu. Sem ele o Marijuano cai nas pistolas, com o motivo no F1. */
  readonly smgReady?: boolean;
  readonly smgEquipped?: boolean;
  readonly smgAmmo?: number;
  readonly smgCapacity?: number;
  readonly smgReloading?: boolean;
  /** 0…1 */
  readonly smgProgress?: number;
  readonly pistolAmmo: number;
  readonly pistolCapacity: number;
  readonly pistolReloading: boolean;
  readonly pistolProgress: number;
  /** Mira apurada em curso NESTE quadro. Só ela revela a roda da luneta. */
  readonly aiming?: boolean;
  /** Nome da habilidade que está no ar, quando houver. */
  readonly activeSkill?: string;
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
  const active=state.activeSkill??'';
  const percent=(value: number): string=>`${Math.round(Math.max(0,Math.min(1,value))*100)}%`;
  // Os rótulos seguem a ARMA que está na mão, não o nome da classe.
  //
  // A distinção importa numa degradação real: um Soldado cujo rig da PRISM não subiu joga com as
  // pistolas, e a cena roteia o `Q` dele pelas habilidades de pistola. Anunciar "habilidade II da
  // forma" ali seria prometer o que a tecla não faz.
  const prism=state.prismEquipped;
  const smg=Boolean(state.smgEquipped);
  const charge:[string,string,string,string]=prism
    ?['CARREGANDO',PLAYER_CLASSES.soldier.charge[0],prismSkill(state.prismMode,2).name,prismSkill(state.prismMode,3).name]
    :smg
    ?['CARREGANDO',...PLAYER_CLASSES.marijuano.charge]
    :['CARREGANDO',...PLAYER_CLASSES.gunslinger.charge];
  const freeFirstTier=prism&&PLAYER_CLASSES.soldier.freeFirstTier;
  if(state.holstered)
    return {label:'CORPO A CORPO',ammo:'COMBO',hint:'CLIQUE · GOLPEAR / V · SACAR / Q · ESPECIAL',
      charge,freeFirstTier,active};
  // O que o botão direito faz agora, e — só com a luneta aberta — a roda que a ajusta.
  const kind=aimKindFor(state);
  const aim=state.aiming&&AIM_MODES[kind].wheelStep>1?`${AIM_HINTS[kind]} · RODA · ZOOM`:AIM_HINTS[kind];
  if(state.prismEquipped){
    const mode=PRISM_MODES[state.prismMode];
    const skill=prismSkill(state.prismMode,2);
    const ultimate=prismSkill(state.prismMode,3);
    const hint=state.prismBusy?'TRANSFORMANDO · AGUARDE'
      :active?`${active} · EM CURSO`
      :state.prismReloading?`RECARREGANDO · ${percent(state.prismProgress)}`
      // Nada de `B`: a arma é a da CLASSE e não muda dentro da expedição.
      :`${aim} / R · RECARREGAR / Q I · TRANSFORMAR / ${skill.hint} / ${ultimate.hint}`;
    return {label:mode.name,ammo:`${state.prismAmmo} / ${state.prismCapacity}`,hint,charge,freeFirstTier,active};
  }
  if(smg){
    const hint=active?`${active} · EM CURSO`
      :state.smgReloading?`RECARREGANDO · ${percent(state.smgProgress??0)}`
      :`${aim} / R · RECARREGAR / V · GUARDAR / ${marijuanoSkill(1).hint} / ${marijuanoSkill(2).hint} / ${marijuanoSkill(3).hint}`;
    return {label:MARIJUANO_SMG.name,ammo:`${state.smgAmmo??0} / ${state.smgCapacity??0}`,hint,
      charge,freeFirstTier,active};
  }
  const hint=state.pistolReloading?`RECARREGANDO · ${percent(state.pistolProgress)}`
    :`${aim} / R · RECARREGAR / V · GUARDAR / Q · ESPECIAL`;
  return {label:'PISTOLAS DUPLAS',ammo:`${state.pistolAmmo} / ${state.pistolCapacity}`,hint,
    charge,freeFirstTier,active};
}
