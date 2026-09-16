import type {Vec3} from '../core/contracts';
import {CITY_CHESTS,FRONTIER_CHESTS,HIGHLAND_CHESTS,ROOTWOOD_CHESTS} from '../world/ExplorationSites';
export const DISTRICT_CONTRACTS=[
 {id:'seeds',name:'Distrito das Sementes',prefix:'seeds-',x:100,y:2,z:8},
 {id:'solar',name:'Fazenda Solar',prefix:'solar-',x:105,y:12,z:72},
 {id:'harvest',name:'Mercado da Colheita',prefix:'harvest-',x:160,y:7,z:45},
 {id:'orchard',name:'Pomar dos Ventos',prefix:'orchard-',x:248,y:9,z:45},
 {id:'port',name:'Porto dos Grãos',prefix:'port-',x:285,y:15,z:147},
 {id:'glasshouse',name:'Distrito das Estufas',prefix:'glasshouse-',x:285,y:15,z:280},
 {id:'highland',name:'Campos Altos',prefix:'highland-',x:500,y:23,z:280},
 {id:'windmill',name:'Moinhos do Leste',prefix:'windmill-',x:720,y:31,z:320},
 {id:'valley',name:'Vale das Sementes',prefix:'valley-',x:610,y:25,z:520},
 {id:'root-grove',name:'Bosque da Colheita',prefix:'root-grove-',x:940,y:35,z:360},
 {id:'root-mill',name:'Ruínas do Engenho',prefix:'root-mill-',x:1150,y:43,z:420},
 {id:'root-seed',name:'Terraços das Sementes',prefix:'root-seed-',x:1030,y:29,z:630},
] as const;
/**
 * Um distrito. A tupla literal acima satisfaz esta forma, e é ela que permite ao planeta ter
 * distritos vindos das ILHAS do mapa em vez das coordenadas fixas da fazenda.
 */
export interface DistrictContract {readonly id:string;readonly name:string;readonly prefix:string;readonly x:number;readonly y:number;readonly z:number}

/**
 * Distritos e baús do MAPA, quando ele não é a fazenda autoral.
 *
 * Sem isto, no planeta os contratos morriam calados: `recordOpened` valida o id do baú contra as
 * listas planas de `ExplorationSites`, e um baú de ilha (`front-shop-0`) não está em nenhuma delas —
 * nenhum contrato jamais completaria. Contrato desligado é regressão, então ele passa a ser
 * alimentado pelo mesmo sorteio que coloca os baús.
 */
export interface ContractSource {
 readonly districts:readonly DistrictContract[];
 /** Baús válidos para contrato AGORA. Função porque a colocação pode ser refeita. */
 chests():readonly {readonly id:string;readonly x:number;readonly y:number;readonly z:number}[];
 /** Distância CAMINHANDO. Ausente ⇒ `hypot(dx,dz)`, o plano de hoje. */
 planarDistance?(a:Vec3,b:Vec3):number;
}

export interface ContractStatus {contract:DistrictContract;opened:number;required:number;distance:number;target:Vec3;completed:number;total:number}
/** Optional objectives follow actual paid chest openings; revisiting cannot farm rewards. */
export class DistrictContracts {
 private readonly opened=new Set<string>();private readonly completed=new Set<string>();
 readonly required=2;
 private source:ContractSource|undefined;
 /** Liga distritos vindos do mapa. `undefined` volta aos distritos autorais da fazenda. */
 configureSource(source:ContractSource|undefined):void {this.source=source;}
 private get districts():readonly DistrictContract[]{return this.source?.districts??DISTRICT_CONTRACTS;}
 private chests():readonly {readonly id:string;readonly x:number;readonly y:number;readonly z:number}[]{
  return this.source?this.source.chests():[...CITY_CHESTS,...FRONTIER_CHESTS,...HIGHLAND_CHESTS,...ROOTWOOD_CHESTS];
 }
 private span(a:Vec3,b:Vec3):number{return this.source?.planarDistance?.(a,b)??Math.hypot(a.x-b.x,a.z-b.z);}
 /**
  * Quantos baús o distrito exige. Uma ilha pequena pode ter um baú só; exigir dois ali seria um
  * contrato impossível de fechar, que é a mesma coisa que estar desligado.
  */
 private requirementOf(contract:DistrictContract):number{
  const available=this.chests().filter(s=>s.id.startsWith(contract.prefix)).length;
  return Math.max(1,Math.min(this.required,available));
 }
 recordOpened(chestId:string):DistrictContract|undefined{
  if(this.opened.has(chestId)||!this.chests().some(s=>s.id===chestId))return;
  this.opened.add(chestId);const contract=this.districts.find(c=>chestId.startsWith(c.prefix));
  if(!contract||this.completed.has(contract.id)||this.count(contract)<this.requirementOf(contract))return;
  this.completed.add(contract.id);return contract;
 }
 private count(contract:DistrictContract):number{return [...this.opened].filter(id=>id.startsWith(contract.prefix)).length;}
 nearest(position:Vec3):ContractStatus|undefined{
  const districts=this.districts;
  const contract=districts.filter(c=>!this.completed.has(c.id)).sort((a,b)=>this.span(a,position)-this.span(b,position))[0];
  if(!contract)return;const target=this.chests().filter(s=>s.id.startsWith(contract.prefix)&&!this.opened.has(s.id)).sort((a,b)=>this.span(a,position)-this.span(b,position))[0]??contract;
  return {contract,opened:this.count(contract),required:this.requirementOf(contract),distance:this.span(target,position),target,completed:this.completed.size,total:districts.length};
 }
 get completedCount():number{return this.completed.size;}
 reset():void{this.opened.clear();this.completed.clear();}
}
