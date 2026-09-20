import {ViewUpdateGate} from './ViewUpdateGate';
import type {AbstractMesh} from '@babylonjs/core/Meshes/abstractMesh';
import type {ShadowGenerator} from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import type {Vec3} from '../core/contracts';

/**
 * Peças que não projetam sombra.
 *
 * Grupos numerosos e pequenos — pedras de borda, forrações de terreno, frutas no chão, decalques de
 * trilha — cujo custo por projetor não se paga: o SSAO já entrega o contato.
 *
 * `OrchardLOD` entrou pelo achado 4 de `docs/CLAUDE_ROOTWOOD_PERF_REVIEW.md`: as 300 árvores do
 * bosque viram uma malha mestre mais instâncias, e o `ShadowGenerator` renderiza a SUBMALHA inteira
 * pela lista de instâncias visíveis — ou seja, incluir *uma* folha de 80 mil triângulos no
 * `renderList` arrasta todas as instâncias visíveis dela para o shadow map, e o teto de 16
 * projetores deixa de ser teto. Folha alpha-test num mapa de 2048 com PCF rende pouco e custa caro.
 *
 * O milho e as margaridas entraram com a lavoura: são ~350 pés e ~76 moitas, o maior grupo do mapa
 * depois das samambaias. O problema não é o custo de cada um — é o TETO de 16 projetores: parado
 * dentro do milharal, os 16 vizinhos mais próximos são todos pé de milho, e o celeiro atrás para de
 * projetar sombra. Sombra de folha fina com PCF rende quase nada e custaria justamente a sombra que
 * se vê. O espantalho NÃO entra: são seis no mapa inteiro, e é alto — a sombra dele é o efeito.
 *
 * Fonte ÚNICA da regra: `FarmWorld` reexporta esta constante para o teste de orçamento conferir o
 * comportamento real, em vez de uma cópia divergente.
 */
export const SHADOW_EXEMPT=/grass|fern|coast_land|connected earth trails|trail union|OrchardLOD|harvest\s+(tomato|watermelon)|milho plantado|margaridas do campo/i;

/** Owns only this container's casters. Bounds distance also handles meshes batched across a district. */
export class NearbyShadowCasters {
 private readonly selected=new Set<AbstractMesh>();private readonly viewGate=new ViewUpdateGate();private disposed=false;
 constructor(private readonly meshes:readonly AbstractMesh[],private readonly shadows:ShadowGenerator,private readonly limit=16){}
 update(dt:number,viewer:Vec3):void{
  if(this.disposed||!this.viewGate.ready(dt,viewer))return;
  const ranked=this.meshes.filter(m=>m.getTotalVertices()>0&&m.isVisible&&m.visibility>0&&m.isEnabled()&&!SHADOW_EXEMPT.test(m.name)).map(mesh=>{
   const b=mesh.getBoundingInfo().boundingBox,min=b.minimumWorld,max=b.maximumWorld;
   return {mesh,distance:Math.hypot(Math.max(min.x-viewer.x,0,viewer.x-max.x),Math.max(min.y-viewer.y,0,viewer.y-max.y),Math.max(min.z-viewer.z,0,viewer.z-max.z))};
  }).filter(({mesh,distance})=>distance<=(this.selected.has(mesh)?90:70)).sort((a,b)=>a.distance-b.distance||a.mesh.uniqueId-b.mesh.uniqueId).slice(0,this.limit);
  const next=new Set(ranked.map(r=>r.mesh));
  for(const mesh of this.selected)if(!next.has(mesh)){this.shadows.removeShadowCaster(mesh,false);this.selected.delete(mesh);}
  for(const mesh of next)if(!this.selected.has(mesh)){this.shadows.addShadowCaster(mesh,false);this.selected.add(mesh);}
 }
 get count():number{return this.selected.size;}
 dispose():void{if(this.disposed)return;for(const mesh of this.selected)this.shadows.removeShadowCaster(mesh,false);this.selected.clear();this.disposed=true;}
}
