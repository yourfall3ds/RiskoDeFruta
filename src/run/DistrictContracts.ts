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
export type DistrictContract=typeof DISTRICT_CONTRACTS[number];
export interface ContractStatus {contract:DistrictContract;opened:number;required:number;distance:number;target:Vec3;completed:number;total:number}
/** Optional objectives follow actual paid chest openings; revisiting cannot farm rewards. */
export class DistrictContracts {
 private readonly opened=new Set<string>();private readonly completed=new Set<string>();
 readonly required=2;
 recordOpened(chestId:string):DistrictContract|undefined{
  if(this.opened.has(chestId)||![...CITY_CHESTS,...FRONTIER_CHESTS,...HIGHLAND_CHESTS,...ROOTWOOD_CHESTS].some(s=>s.id===chestId))return;
  this.opened.add(chestId);const contract=DISTRICT_CONTRACTS.find(c=>chestId.startsWith(c.prefix));
  if(!contract||this.completed.has(contract.id)||this.count(contract)<this.required)return;
  this.completed.add(contract.id);return contract;
 }
 private count(contract:DistrictContract):number{return [...this.opened].filter(id=>id.startsWith(contract.prefix)).length;}
 nearest(position:Vec3):ContractStatus|undefined{
  const contract=DISTRICT_CONTRACTS.filter(c=>!this.completed.has(c.id)).sort((a,b)=>Math.hypot(a.x-position.x,a.z-position.z)-Math.hypot(b.x-position.x,b.z-position.z))[0];
  if(!contract)return;const target=[...CITY_CHESTS,...FRONTIER_CHESTS,...HIGHLAND_CHESTS,...ROOTWOOD_CHESTS].filter(s=>s.id.startsWith(contract.prefix)&&!this.opened.has(s.id)).sort((a,b)=>Math.hypot(a.x-position.x,a.z-position.z)-Math.hypot(b.x-position.x,b.z-position.z))[0]??contract;
  return {contract,opened:this.count(contract),required:this.required,distance:Math.hypot(target.x-position.x,target.z-position.z),target,completed:this.completed.size,total:DISTRICT_CONTRACTS.length};
 }
 get completedCount():number{return this.completed.size;}
 reset():void{this.opened.clear();this.completed.clear();}
}
