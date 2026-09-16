import {ReliefField,type ReliefPlan} from './ReliefField';
import {buildTerrainPatch,appendGeometry,type TerrainGeometry} from './TerrainPatch';
import {reliefPlansFor,type ReliefSource} from './ReliefPlans';

export interface TerrainPatchResult {plan:ReliefPlan;field:ReliefField;geometry:TerrainGeometry;sample:(x:number,z:number)=>number}

/**
 * Relevo esculpido de uma região, pronto para os dois consumidores.
 *
 * `geometry` vai para a colisão (cliente e servidor) e para a malha visível (cliente) — os MESMOS
 * arrays. `offsetAt` é o que levanta prop, vegetação e decalque de trilha para a cota nova, e é a
 * mesma função que gerou os vértices, então nada fica flutuando nem enterrado por desacordo.
 */
export class SculptedTerrain {
 readonly patches:readonly TerrainPatchResult[];
 constructor(readonly region:string,source:ReliefSource){
  this.patches=reliefPlansFor(region,source).map(plan=>{
   const build=buildTerrainPatch(plan);
   return{plan,field:new ReliefField(plan),geometry:build.geometry,sample:build.sample};
  });
 }
 get empty():boolean{return this.patches.every(patch=>!patch.geometry.indices.length);}
 get triangles():number{return this.patches.reduce((total,patch)=>total+patch.geometry.indices.length/3,0);}

 /**
  * Quanto o chão subiu no ponto, LIDO DA MALHA gerada (0 onde não há retalho).
  *
  * Esta é a função que prop, vegetação e decalque de trilha usam para acompanhar o terreno: como ela
  * lê a mesma superfície que virou colisão, nada sobe de menos nem de mais.
  */
 offsetAt(x:number,z:number):number{
  let offset=0;
  for(const patch of this.patches){
   const {minX,maxX,minZ,maxZ}=patch.plan.bounds;
   if(x<minX||x>maxX||z<minZ||z>maxZ)continue;
   offset=Math.max(offset,patch.sample(x,z));
  }
  return offset;
 }

 /** Altura absoluta da superfície esculpida, ou undefined onde não existe retalho. */
 heightAt(x:number,z:number):number|undefined{
  let height:number|undefined;
  for(const patch of this.patches){
   const {minX,maxX,minZ,maxZ}=patch.plan.bounds;
   if(x<minX||x>maxX||z<minZ||z>maxZ)continue;
   const lift=patch.sample(x,z);if(lift<=0)continue;
   const candidate=patch.plan.base(x,z)+lift;
   if(height===undefined||candidate>height)height=candidate;
  }
  return height;
 }

 /** Triângulos de colisão de todos os retalhos, já concatenados. */
 collisionGeometry():{positions:number[];indices:number[]}{
  const merged={positions:[] as number[],indices:[] as number[]};
  for(const patch of this.patches)appendGeometry(merged,patch.geometry);
  return merged;
 }
}

/**
 * Acrescenta o relevo de uma região a um par (positions,indices) de colisão já carregado.
 * Devolve o terreno criado para quem precisar levantar props e desenhar a malha.
 */
export function attachSculptedTerrain(region:string,source:ReliefSource,target:{positions:number[];indices:number[]}):SculptedTerrain {
 const terrain=new SculptedTerrain(region,source);
 for(const patch of terrain.patches)if(patch.geometry.indices.length)appendGeometry(target,patch.geometry);
 return terrain;
}
