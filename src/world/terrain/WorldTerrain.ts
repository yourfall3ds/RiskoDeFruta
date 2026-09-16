import type {BoxCollider} from '../../physics/CollisionWorld';
import type {Vec3} from '../../core/contracts';
import {SculptedTerrain} from './SculptedTerrain';
import {SCULPTED_REGIONS,HIGHLAND_ISLANDS} from './ReliefPlans';
import {HIGHLAND_CHESTS} from '../HighlandSites';
import {appendGeometry,type TerrainGeometry} from './TerrainPatch';
import {ringVolumes,carveVolumes,highlandOutcrops,outcropBlocker,buildOutcropGeometry,type OutcropPlacement,type OutcropShape,type OrientedVolume} from './RockOutcrops';
export {SculptedTerrain} from './SculptedTerrain';
export {SCULPTED_REGIONS} from './ReliefPlans';
export type {OutcropShape,OutcropPlacement,OrientedVolume} from './RockOutcrops';

/** Dados de colisão de onde saem as exclusões — o formato que os dois lados já carregam do disco. */
export interface TerrainRegionData {
 boxes?:readonly BoxCollider[];
 walkableLinks?:readonly{a:Vec3;b:Vec3;width:number}[];
}

/** Colisão mutável de uma região: é nela que o relevo e os afloramentos são acrescentados. */
export interface TerrainCollisionData extends TerrainRegionData {positions:number[];indices:number[]}

/** Resultado da esculpida de uma região, consumido pela apresentação (cliente) e pelos testes. */
export interface SculptedRegion {
 region:string;
 terrain:SculptedTerrain|undefined;
 /** Uma malha de afloramentos por ilha — separadas para o frustum culling continuar funcionando. */
 outcrops:readonly{id:string;geometry:TerrainGeometry}[];
 placements:readonly OutcropPlacement[];
 /** Instâncias antigas aposentadas: a colisão delas já saiu; o visual precisa sumir junto. */
 retired:readonly OrientedVolume[];
 carvedTriangles:number;
 offsetAt(x:number,z:number):number;
}

/** `true` se a região tem relevo esculpido integrado. Regiões fora da lista não pagam nada. */
export function isSculptedRegion(region:string):boolean{return (SCULPTED_REGIONS as readonly string[]).includes(region);}

/**
 * Ponto de entrada ÚNICO do relevo, usado por `FarmWorld` (cliente) e `FarmSimulation` (servidor).
 *
 * Passar os mesmos dados de colisão dos dois lados produz exatamente os mesmos triângulos — é essa
 * propriedade que mantém a predição local e a simulação autoritativa pisando no mesmo chão.
 * Devolve `undefined` quando a região não tem plano, para o chamador seguir sem ramificação extra.
 */
export function worldTerrain(region:string,data:TerrainRegionData):SculptedTerrain|undefined {
 if(!isSculptedRegion(region))return undefined;
 const terrain=new SculptedTerrain(region,{boxes:data.boxes??[],walkableLinks:data.walkableLinks??[]});
 return terrain.empty?undefined:terrain;
}

/**
 * Esculpe uma região DENTRO dos seus arrays de colisão.
 *
 * A ordem importa e é a mesma dos dois lados:
 *  1. apaga os triângulos das instâncias de pedra aposentadas (antes de qualquer acréscimo, senão a
 *     rocha nova, que também tem triângulo pequeno, entraria no critério de remoção);
 *  2. acrescenta os afloramentos novos;
 *  3. acrescenta os retalhos de relevo.
 *
 * Muta `data` de propósito: quem chama já é dono desse JSON recém-parseado, e assim colisão, índice
 * de raios, navegação e ragdoll passam a enxergar exatamente a mesma superfície que a câmera.
 */
export function sculptRegion(region:string,data:TerrainCollisionData,shape?:OutcropShape):SculptedRegion {
 const terrain=worldTerrain(region,data);
 const outcrops:{id:string;geometry:TerrainGeometry}[]=[];
 let placements:OutcropPlacement[]=[],retired:OrientedVolume[]=[],carvedTriangles=0;
 if(region==='highland-farms'&&shape){
  retired=ringVolumes();
  const carved=carveVolumes(data.positions,data.indices,retired);
  carvedTriangles=carved.removed;
  // Substituição por referência: `push(...)` com centenas de milhares de índices estoura a pilha.
  data.indices=carved.indices;
  placements=highlandOutcrops(terrain,outcropBlocker(terrain,HIGHLAND_CHESTS.map(site=>({x:site.x,z:site.z,radius:7}))));
  for(const island of HIGHLAND_ISLANDS){
   const group=placements.filter(placement=>placement.id.startsWith(island.id+'-'));
   if(!group.length)continue;
   const geometry=buildOutcropGeometry(shape,group,{naturalSize:shape.sourceExtent});
   outcrops.push({id:`${island.id}-outcrops`,geometry});
   appendGeometry(data,geometry);
  }
 }
 if(terrain)appendGeometry(data,terrain.collisionGeometry());
 return{region,terrain,outcrops,placements,retired,carvedTriangles,offsetAt:(x,z)=>terrain?.offsetAt(x,z)??0};
}
