import type { EventBus } from '../core/EventBus';
import type { GameEvents } from '../core/contracts';
import type { RandomStream } from '../core/RunRNG';

export interface RunStats { maxHP:number; damage:number; attackSpeed:number; moveSpeed:number; jump:number; extraJumps:number; dodgeRecharge:number; crit:number; armor:number; regeneration:number; mp:number }
export interface ItemDefinition { id:string; name:string; description:string; icon:number; rarity:'common'|'uncommon'; stat?:keyof RunStats; value?:number; hook?:'burn'|'harvest'|'blast' }
export const ITEMS:readonly ItemDefinition[]=[
  {id:'pruner',name:'Podador de aço',description:'+15% de dano por unidade.',icon:0,rarity:'common',stat:'damage',value:.15},
  {id:'battery',name:'Célula de descarga',description:'+12% de cadência por unidade.',icon:12,rarity:'common',stat:'attackSpeed',value:.12},
  {id:'boot',name:'Botas de lavoura',description:'+10% de velocidade por unidade.',icon:3,rarity:'common',stat:'moveSpeed',value:.1},
  {id:'watch',name:'Relógio de campo',description:'Esquiva recarrega 15% mais rápido por unidade.',icon:9,rarity:'common',stat:'dodgeRecharge',value:.15},
  {id:'feather',name:'Pena orbital',description:'+1 pulo aéreo por unidade. Os pulos recarregam ao tocar o chão.',icon:4,rarity:'common',stat:'extraJumps',value:1},
  {id:'goggles',name:'Mira de precisão',description:'+8% de crítico, com retornos decrescentes.',icon:1,rarity:'common',stat:'crit',value:.08},
  {id:'bandage',name:'Atadura viva',description:'+1,5 HP/s de regeneração por unidade.',icon:10,rarity:'common',stat:'regeneration',value:1.5},
  {id:'belt',name:'Cinturão de proteção',description:'+20 de armadura por unidade.',icon:25,rarity:'common',stat:'armor',value:20},
  {id:'fire',name:'Seiva incendiária',description:'Acertos podem incendiar. Mais unidades aumentam a chance e duração.',icon:8,rarity:'uncommon',hook:'burn'},
  {id:'harvest',name:'Amuleto da colheita',description:'Abates restauram 4 HP por unidade e atraem energia verde.',icon:18,rarity:'uncommon',hook:'harvest'},
  {id:'bomb',name:'Semente explosiva',description:'Acertos podem explodir em área. Explosões não geram novas explosões.',icon:28,rarity:'uncommon',hook:'blast'},
  {id:'crystal',name:'Cristal de mutação',description:'+20% de dano de habilidade e +10% de carga MP por unidade.',icon:16,rarity:'uncommon',stat:'mp',value:.2},
{"id": "perk_02", "name": "Seringa revitalizante", "description": "+15 de vida máxima por unidade.", "icon": 2, "rarity": "common", "stat": "maxHP", "value": 15.0},
{"id": "perk_05", "name": "Moeda de trevo", "description": "+5% de chance de crítico antes dos retornos decrescentes por unidade.", "icon": 5, "rarity": "common", "stat": "crit", "value": 0.05},
{"id": "perk_06", "name": "Anel de caveira", "description": "+12% de dano por unidade.", "icon": 6, "rarity": "common", "stat": "damage", "value": 0.12},
{"id": "perk_07", "name": "Ímã de campo", "description": "+12% de poder de habilidade por unidade.", "icon": 7, "rarity": "common", "stat": "mp", "value": 0.12},
{"id": "perk_11", "name": "Granada de sementes", "description": "+15% de dano por unidade.", "icon": 11, "rarity": "common", "stat": "damage", "value": 0.15},
{"id": "perk_13", "name": "Bússola do explorador", "description": "+8% de velocidade por unidade.", "icon": 13, "rarity": "common", "stat": "moveSpeed", "value": 0.08},
{"id": "perk_14", "name": "Cogumelo curativo", "description": "+0.8 de HP/s de regeneração por unidade.", "icon": 14, "rarity": "common", "stat": "regeneration", "value": 0.8},
{"id": "perk_15", "name": "Chave dourada", "description": "+20 de vida máxima por unidade.", "icon": 15, "rarity": "common", "stat": "maxHP", "value": 20.0},
{"id": "perk_17", "name": "Garras de osso", "description": "+13% de dano por unidade.", "icon": 17, "rarity": "common", "stat": "damage", "value": 0.13},
{"id": "perk_19", "name": "Broche alado", "description": "+15% de altura do salto por unidade.", "icon": 19, "rarity": "common", "stat": "jump", "value": 0.15},
{"id": "perk_20", "name": "Gancho de escalada", "description": "+12% de altura do salto por unidade.", "icon": 20, "rarity": "common", "stat": "jump", "value": 0.12},
{"id": "perk_21", "name": "Manopla de combate", "description": "+14% de dano por unidade.", "icon": 21, "rarity": "common", "stat": "damage", "value": 0.14},
{"id": "perk_22", "name": "Olho vigilante", "description": "+7% de chance de crítico antes dos retornos decrescentes por unidade.", "icon": 22, "rarity": "common", "stat": "crit", "value": 0.07},
{"id": "perk_23", "name": "Âncora de proteção", "description": "+16 de armadura por unidade.", "icon": 23, "rarity": "common", "stat": "armor", "value": 16.0},
{"id": "perk_24", "name": "Sino da colheita", "description": "+0.7 de HP/s de regeneração por unidade.", "icon": 24, "rarity": "common", "stat": "regeneration", "value": 0.7},
{"id": "perk_26", "name": "Elixir verde", "description": "+18 de vida máxima por unidade.", "icon": 26, "rarity": "common", "stat": "maxHP", "value": 18.0},
{"id": "perk_27", "name": "Chifre entalhado", "description": "+15% de poder de habilidade por unidade.", "icon": 27, "rarity": "common", "stat": "mp", "value": 0.15},
{"id": "perk_29", "name": "Drone foguete", "description": "+10% de cadência por unidade.", "icon": 29, "rarity": "common", "stat": "attackSpeed", "value": 0.1},
{"id": "perk_30", "name": "Coroa quebrada", "description": "+18 de armadura por unidade.", "icon": 30, "rarity": "common", "stat": "armor", "value": 18.0},
{"id": "perk_31", "name": "Pé de coelho", "description": "+9% de velocidade por unidade.", "icon": 31, "rarity": "common", "stat": "moveSpeed", "value": 0.09},
{"id": "perk_32", "name": "Dados do destino", "description": "+6% de chance de crítico antes dos retornos decrescentes por unidade.", "icon": 32, "rarity": "common", "stat": "crit", "value": 0.06},
{"id": "perk_33", "name": "Máscara de gás", "description": "+14 de armadura por unidade.", "icon": 33, "rarity": "common", "stat": "armor", "value": 14.0},
{"id": "perk_34", "name": "Ídolo lunar", "description": "+16% de poder de habilidade por unidade.", "icon": 34, "rarity": "common", "stat": "mp", "value": 0.16},
{"id": "perk_35", "name": "Gancho de correntes", "description": "+13% de dano por unidade.", "icon": 35, "rarity": "common", "stat": "damage", "value": 0.13},
{"id": "perk_36", "name": "Máscara oni", "description": "+18% de dano por unidade.", "icon": 36, "rarity": "common", "stat": "damage", "value": 0.18},
{"id": "perk_37", "name": "Ampulheta", "description": "+18% de recarga da esquiva por unidade.", "icon": 37, "rarity": "common", "stat": "dodgeRecharge", "value": 0.18},
{"id": "perk_38", "name": "Punho foguete", "description": "+12% de cadência por unidade.", "icon": 38, "rarity": "common", "stat": "attackSpeed", "value": 0.12},
{"id": "perk_39", "name": "Escudo alado", "description": "+22 de armadura por unidade.", "icon": 39, "rarity": "common", "stat": "armor", "value": 22.0},
{"id": "perk_40", "name": "Frasco de sangue", "description": "+1 de HP/s de regeneração por unidade.", "icon": 40, "rarity": "uncommon", "stat": "regeneration", "value": 1.0},
{"id": "perk_41", "name": "Carta do destino", "description": "+8% de chance de crítico antes dos retornos decrescentes por unidade.", "icon": 41, "rarity": "uncommon", "stat": "crit", "value": 0.08},
{"id": "perk_42", "name": "Bobina elétrica", "description": "+14% de cadência por unidade.", "icon": 42, "rarity": "uncommon", "stat": "attackSpeed", "value": 0.14},
{"id": "perk_43", "name": "Lanterna do campo", "description": "+22 de vida máxima por unidade.", "icon": 43, "rarity": "uncommon", "stat": "maxHP", "value": 22.0},
{"id": "perk_44", "name": "Presa de lobo", "description": "+17% de dano por unidade.", "icon": 44, "rarity": "uncommon", "stat": "damage", "value": 0.17},
{"id": "perk_45", "name": "Caixa de música", "description": "+1.2 de HP/s de regeneração por unidade.", "icon": 45, "rarity": "uncommon", "stat": "regeneration", "value": 1.2},
{"id": "perk_46", "name": "Turbina", "description": "+12% de velocidade por unidade.", "icon": 46, "rarity": "uncommon", "stat": "moveSpeed", "value": 0.12},
{"id": "perk_47", "name": "Coroa de espinhos", "description": "+20 de armadura por unidade.", "icon": 47, "rarity": "uncommon", "stat": "armor", "value": 20.0},
{"id": "perk_48", "name": "Gema do coração", "description": "+28 de vida máxima por unidade.", "icon": 48, "rarity": "uncommon", "stat": "maxHP", "value": 28.0},
{"id": "perk_49", "name": "Detonador", "description": "+18% de poder de habilidade por unidade.", "icon": 49, "rarity": "uncommon", "stat": "mp", "value": 0.18},
{"id": "perk_50", "name": "Amuleto de nós", "description": "+16% de recarga da esquiva por unidade.", "icon": 50, "rarity": "uncommon", "stat": "dodgeRecharge", "value": 0.16},
{"id": "perk_51", "name": "Broche de aranha", "description": "+18% de altura do salto por unidade.", "icon": 51, "rarity": "uncommon", "stat": "jump", "value": 0.18},
{"id": "perk_52", "name": "Cubo enigmático", "description": "+20% de poder de habilidade por unidade.", "icon": 52, "rarity": "uncommon", "stat": "mp", "value": 0.2},
{"id": "perk_53", "name": "Totem do corvo", "description": "+9% de chance de crítico antes dos retornos decrescentes por unidade.", "icon": 53, "rarity": "uncommon", "stat": "crit", "value": 0.09},
{"id": "perk_54", "name": "Máscara de porcelana", "description": "+24 de armadura por unidade.", "icon": 54, "rarity": "uncommon", "stat": "armor", "value": 24.0},
{"id": "perk_55", "name": "Aljava ligeira", "description": "+13% de cadência por unidade.", "icon": 55, "rarity": "uncommon", "stat": "attackSpeed", "value": 0.13},
{"id": "perk_56", "name": "Pergaminho estelar", "description": "+20% de poder de habilidade por unidade.", "icon": 56, "rarity": "uncommon", "stat": "mp", "value": 0.2},
{"id": "perk_57", "name": "Medalhão de safira", "description": "+26 de vida máxima por unidade.", "icon": 57, "rarity": "uncommon", "stat": "maxHP", "value": 26.0},
{"id": "perk_58", "name": "Glaive flamejante", "description": "+20% de dano por unidade.", "icon": 58, "rarity": "uncommon", "stat": "damage", "value": 0.2},
{"id": "perk_59", "name": "Pingente de caixão", "description": "+1.2 de HP/s de regeneração por unidade.", "icon": 59, "rarity": "uncommon", "stat": "regeneration", "value": 1.2},
{"id": "perk_60", "name": "Pluma de fênix", "description": "+22% de altura do salto por unidade.", "icon": 60, "rarity": "uncommon", "stat": "jump", "value": 0.22},
{"id": "perk_61", "name": "Olho do dragão", "description": "+10% de chance de crítico antes dos retornos decrescentes por unidade.", "icon": 61, "rarity": "uncommon", "stat": "crit", "value": 0.1},
{"id": "perk_62", "name": "Cálice de caveira", "description": "+30 de vida máxima por unidade.", "icon": 62, "rarity": "uncommon", "stat": "maxHP", "value": 30.0},
{"id": "perk_63", "name": "Coroa estelar", "description": "+22% de poder de habilidade por unidade.", "icon": 63, "rarity": "uncommon", "stat": "mp", "value": 0.22},
{"id": "perk_64", "name": "Fragmento cristalino", "description": "+18% de dano por unidade.", "icon": 64, "rarity": "uncommon", "stat": "damage", "value": 0.18},
{"id": "perk_65", "name": "Orbe cósmico", "description": "+24% de poder de habilidade por unidade.", "icon": 65, "rarity": "uncommon", "stat": "mp", "value": 0.24},
{"id": "perk_66", "name": "Cruz alada", "description": "+1.4 de HP/s de regeneração por unidade.", "icon": 66, "rarity": "uncommon", "stat": "regeneration", "value": 1.4},
{"id": "perk_67", "name": "Geodo de magma", "description": "+22% de dano por unidade.", "icon": 67, "rarity": "uncommon", "stat": "damage", "value": 0.22},
{"id": "perk_68", "name": "Caveira coroada", "description": "+28 de armadura por unidade.", "icon": 68, "rarity": "uncommon", "stat": "armor", "value": 28.0},
{"id": "perk_69", "name": "Medalhão solar", "description": "+32 de vida máxima por unidade.", "icon": 69, "rarity": "uncommon", "stat": "maxHP", "value": 32.0},
{"id": "perk_70", "name": "Cimitarra lunar", "description": "+16% de cadência por unidade.", "icon": 70, "rarity": "uncommon", "stat": "attackSpeed", "value": 0.16},
{"id": "perk_71", "name": "Frasco de tempestade", "description": "+24% de poder de habilidade por unidade.", "icon": 71, "rarity": "uncommon", "stat": "mp", "value": 0.24},
{"id": "perk_72", "name": "Coração perfurado", "description": "+34 de vida máxima por unidade.", "icon": 72, "rarity": "uncommon", "stat": "maxHP", "value": 34.0},
{"id": "perk_73", "name": "Prisma do vazio", "description": "+12% de chance de crítico antes dos retornos decrescentes por unidade.", "icon": 73, "rarity": "uncommon", "stat": "crit", "value": 0.12},
{"id": "perk_74", "name": "Núcleo arcano", "description": "+26% de poder de habilidade por unidade.", "icon": 74, "rarity": "uncommon", "stat": "mp", "value": 0.26},
{"id": "perk_75", "name": "Lanterna das almas", "description": "+1.5 de HP/s de regeneração por unidade.", "icon": 75, "rarity": "uncommon", "stat": "regeneration", "value": 1.5},
{"id": "perk_76", "name": "Anel de serpente", "description": "+17% de cadência por unidade.", "icon": 76, "rarity": "uncommon", "stat": "attackSpeed", "value": 0.17},
{"id": "perk_77", "name": "Sinete de leão", "description": "+30 de armadura por unidade.", "icon": 77, "rarity": "uncommon", "stat": "armor", "value": 30.0},
{"id": "perk_78", "name": "Bússola astral", "description": "+14% de velocidade por unidade.", "icon": 78, "rarity": "uncommon", "stat": "moveSpeed", "value": 0.14},
{"id": "perk_79", "name": "Lótus cristalino", "description": "+1.6 de HP/s de regeneração por unidade.", "icon": 79, "rarity": "uncommon", "stat": "regeneration", "value": 1.6},
{"id": "perk_80", "name": "Sino espiritual", "description": "+22% de recarga da esquiva por unidade.", "icon": 80, "rarity": "uncommon", "stat": "dodgeRecharge", "value": 0.22},
{"id": "perk_81", "name": "Jarro de almas", "description": "+36 de vida máxima por unidade.", "icon": 81, "rarity": "uncommon", "stat": "maxHP", "value": 36.0},
{"id": "perk_82", "name": "Manopla dourada", "description": "+24% de dano por unidade.", "icon": 82, "rarity": "uncommon", "stat": "damage", "value": 0.24},
{"id": "perk_83", "name": "Chave do trovão", "description": "+18% de cadência por unidade.", "icon": 83, "rarity": "uncommon", "stat": "attackSpeed", "value": 0.18},
{"id": "perk_84", "name": "Tomo alado", "description": "+25% de altura do salto por unidade.", "icon": 84, "rarity": "uncommon", "stat": "jump", "value": 0.25},
{"id": "perk_85", "name": "Brasão flamejante", "description": "+25% de dano por unidade.", "icon": 85, "rarity": "uncommon", "stat": "damage", "value": 0.25},
{"id": "perk_86", "name": "Totem da tempestade", "description": "+28% de poder de habilidade por unidade.", "icon": 86, "rarity": "uncommon", "stat": "mp", "value": 0.28},
{"id": "perk_87", "name": "Relógio cósmico", "description": "+25% de recarga da esquiva por unidade.", "icon": 87, "rarity": "uncommon", "stat": "dodgeRecharge", "value": 0.25},
{"id": "perk_88", "name": "Máscara de plumas", "description": "+15% de velocidade por unidade.", "icon": 88, "rarity": "uncommon", "stat": "moveSpeed", "value": 0.15},
{"id": "perk_89", "name": "Trevo de gemas", "description": "+13% de chance de crítico antes dos retornos decrescentes por unidade.", "icon": 89, "rarity": "uncommon", "stat": "crit", "value": 0.13},
];
export class RunProgression {
  readonly inventory=new Map<string,number>();
  stage=1;level=1;xp=0;credits=0;totalKills=0;time=0;
  stats:RunStats=this.computeStats();
  constructor(private readonly events:EventBus<GameEvents>){}
  reset():void {this.inventory.clear();this.stage=1;this.level=1;this.xp=0;this.credits=0;this.totalKills=0;this.time=0;this.stats=this.computeStats();}
  get nextLevelXP():number{return Math.round(45*Math.pow(this.level,1.35));}
  computeStats():RunStats {
    const stats:RunStats={maxHP:130+(this.level-1)*12,damage:1+(this.level-1)*.045,attackSpeed:1,moveSpeed:1,jump:1,extraJumps:0,dodgeRecharge:1,crit:0,armor:0,regeneration:1,mp:1};
    for(const item of ITEMS){const count=this.inventory?.get(item.id)??0;if(item.stat&&item.value)stats[item.stat]+=item.value*count;}
    stats.crit=stats.crit/(1+stats.crit);return stats;
  }
  addItem(id:string):void {if(!ITEMS.some(item=>item.id===id))throw new Error(`Unknown item ${id}`);const stacks=(this.inventory.get(id)??0)+1;this.inventory.set(id,stacks);this.stats=this.computeStats();this.events.emit('ItemPicked',{entityId:1,itemId:id});this.events.emit('ItemStackChanged',{entityId:1,itemId:id,stacks});}
  addXP(amount:number):void {this.xp+=Math.max(0,amount);while(this.xp>=this.nextLevelXP){this.xp-=this.nextLevelXP;this.level++;this.stats=this.computeStats();this.events.emit('LevelUp',{entityId:1,level:this.level});}this.stats=this.computeStats();}
  reward(elite=false,multiplier=1):void {this.totalKills++;this.credits+=Math.round((elite?50:8+this.stage*2)*multiplier);this.addXP(Math.round((elite?90:10+this.stage*2)*multiplier));}
  purchase(cost:number,itemId:string):boolean {if(this.credits<cost)return false;this.credits-=cost;this.addItem(itemId);return true;}
  randomItem(rng:RandomStream):ItemDefinition {const rarity=rng.next()<.24?'uncommon':'common';return rng.pick(ITEMS.filter(item=>item.rarity===rarity));}
  advanceStage():void {this.addXP(this.credits);this.credits=0;this.stage++;}
}

