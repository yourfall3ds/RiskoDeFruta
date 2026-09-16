import {NearbyShadowCasters} from '../../rendering/NearbyShadowCasters';
import {OrchardLods} from './OrchardLods';
import type {Scene} from '@babylonjs/core/scene';
import type {AbstractMesh} from '@babylonjs/core/Meshes/abstractMesh';
import type {ShadowGenerator} from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import type {Observer} from '@babylonjs/core/Misc/observable';
import {applyStochasticGround} from '../materials/GroundMaterials';
import {PBRMaterial} from '@babylonjs/core/Materials/PBR/pbrMaterial';
import {Color3} from '@babylonjs/core/Maths/math.color';
import {DetailVisibility,type WorldDetail} from '../DetailVisibility';
import type {Vec3} from '../../core/contracts';
import {FoliageWind,hasFoliageWind} from '../materials/FoliageMaterials';
export const WORLD_MATERIAL_TINT:Record<string,string>={'Barn red weathered wood':'#ad3928','Weathered timber':'#d0b58c','Ivory trim':'#fff1cc','Aged silo steel':'#e8e1cc','Oxidized roof':'#606961','Sunlit farm track':'#ffd799','Leaf litter soil':'#d6cf94','Tractor rubber':'#242824'};

/**
 * Orçamento de copas do bosque.
 *
 * Medido em `docs/CLAUDE_ROOTWOOD_PERF_REVIEW.md` no ponto exato do QA: com `mediumLimit:20` e
 * `farDistance:85` o bosque entregava 2 × 97.998 + 20 × 28.673 = 769.456 triângulos de folha
 * alpha-test de dupla face — alpha-test desliga early-Z, então cada fragmento roda o PBR inteiro
 * antes do `discard`. O corte aqui é de orçamento, não de qualidade próxima: `nearDistance` SUBIU
 * (18 → 24 m) para as copas de perto ficarem mais legíveis, e a economia vem do meio da faixa, onde
 * `FarCanopies` já cobre com billboard. Total no mesmo ponto: 3 × 97.998 + 10 × 28.673 ≈ 581 k.
 */
export const ROOTWOOD_CANOPY_BUDGET={nearDistance:24,farDistance:62,nearLimit:3,mediumLimit:10,farCanopies:true} as const;

/**
 * Raio de ocultação por tipo de peça.
 *
 * `trail`/`worn earth` entrou por causa do achado 3 da revisão: a união de trilhas é UMA malha de
 * 25 mil triângulos cobrindo a região inteira, e sem raio ela era desenhada em todo quadro,
 * independentemente da distância. O raio é generoso porque a trilha é referência de rota.
 */
/**
 * Peças preparadas por quadro ao ativar uma região.
 *
 * 300 cobre uma região comum (236–384 nós) em um a dois quadros e fatia o bosque (2.671 nós) em ~9,
 * em vez de um único tick de centenas de milissegundos.
 */
export const WARM_UP_BUDGET=300;

export const DETAIL_RADIUS:readonly{match:RegExp;radius:number}[]=[
 {match:/fern|grass/i,radius:65},
 {match:/coast_land/i,radius:135},
 {match:/trail|worn earth/i,radius:220},
 {match:/tree/i,radius:180},
];
/** Presentation owned by one resident container. Nothing here outlives that container. */
export class RegionPresentation {
 private details:DetailVisibility|undefined;
 private readonly orchard:OrchardLods;
 private readonly casters:NearbyShadowCasters;
 private readonly wind:FoliageWind;
 private readonly detailNodes:WorldDetail[]=[];
 private pending:AbstractMesh[]=[];
 private prepared=0;
 private freezeObserver:Observer<Scene>|undefined;
 private disposed=false;
 constructor(private readonly scene:Scene,meshes:readonly AbstractMesh[],shadows:ShadowGenerator,regionId=''){
  this.orchard=new OrchardLods(meshes,regionId==='rootwood'?ROOTWOOD_CANOPY_BUDGET:{});this.orchard.update(1,scene.activeCamera?.globalPosition??{x:0,y:0,z:0});
  const materials=new Set(meshes.map(m=>m.material));
  // Amostragem estocástica do chão: antes do freeze do primeiro render.
  applyStochasticGround(materials);
  for(const material of materials)if(material instanceof PBRMaterial){
   material.unfreeze();material.maxSimultaneousLights=4;
   const tint=WORLD_MATERIAL_TINT[material.name];if(tint){material.albedoColor=Color3.FromHexString(tint);material.roughness=.82;}
   if(material.albedoTexture)material.albedoTexture.anisotropicFilteringLevel=8;
  }
  // Alpha-test, dois lados, corte de copa e vento — inclusive nos decalques de trilha, que o filtro
  // antigo (`/fern|grass|tree/`) não pegava e deixava em passe transparente sobre a região inteira.
  this.wind=new FoliageWind(materials);
  // `details` é preenchido em fatias por `warmUp`; a lista é a MESMA referência que a visibilidade
  // consulta, então cada peça passa a ser gerenciada assim que é preparada.
  this.details=new DetailVisibility(this.detailNodes);
  this.pending=[...meshes];
  this.warmUp(WARM_UP_BUDGET);
  this.casters=new NearbyShadowCasters(meshes,shadows);this.casters.update(1,scene.activeCamera?.globalPosition??{x:0,y:0,z:0});
  // Material com vento fica fora do congelamento: congelado, o Babylon pula o bind e o tempo trava.
  this.freezeObserver=scene.onAfterRenderObservable.addOnce(()=>{this.freezeObserver=undefined;if(!this.disposed)for(const material of materials)if(!hasFoliageWind(material))material?.freeze();});
 }

 /**
  * Prepara um lote de peças por quadro.
  *
  * `computeWorldMatrix(true)` + `getBoundingInfo()` + `freezeWorldMatrix()` sobre TODAS as malhas da
  * região num único tick é o achado 1 de `docs/CLAUDE_ROOTWOOD_PERF_REVIEW.md`: no bosque são 2.671
  * nós, e o pico bate junto com o parse do JSON de colisão e a subida de textura — exatamente o
  * momento em que o QA viu a interface travar. Fatiado, o mesmo trabalho vira alguns quadros curtos.
  * Até ser preparada, a peça continua desenhada como veio do glTF: nada some.
  */
 private warmUp(budget:number):void {
  const limit=Math.min(budget,this.pending.length-this.prepared);
  for(let processed=0;processed<limit;processed++){
   const mesh=this.pending[this.prepared++]!;
   mesh.receiveShadows=true;mesh.isPickable=!/fern|grass|tree/i.test(mesh.name);mesh.computeWorldMatrix(true);
   const center=mesh.getBoundingInfo().boundingSphere.centerWorld.clone();
   mesh.freezeWorldMatrix();
   if(this.orchard.owns(mesh)||!mesh.getTotalVertices()||!mesh.isVisible)continue;
   const radius=DETAIL_RADIUS.find(entry=>entry.match.test(mesh.name))?.radius??0;
   if(radius)this.detailNodes.push({center,radius,visible:true,setVisible:visible=>{mesh.isVisible=visible;}});
  }
  if(this.prepared>=this.pending.length)this.pending.length=0;
 }

 /** Quantas peças ainda faltam preparar. Zero significa região totalmente aquecida. */
 get warming():number{return Math.max(0,this.pending.length-this.prepared);}
 get hidden():number{return (this.details?.hidden??0)+this.orchard.hidden;}
 update(dt:number,viewer:Vec3):void{if(!this.disposed){if(this.warming)this.warmUp(WARM_UP_BUDGET);this.wind.update(dt);this.details?.update(dt,viewer);this.orchard.update(dt,viewer);this.casters.update(dt,viewer);}}
 dispose():void{if(this.disposed)return;this.disposed=true;if(this.freezeObserver)this.scene.onAfterRenderObservable.remove(this.freezeObserver);this.freezeObserver=undefined;this.wind.dispose();this.orchard.dispose();this.details?.restore();this.details=undefined;this.casters.dispose();}
}
