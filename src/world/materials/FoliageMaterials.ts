import {PBRMaterial} from '@babylonjs/core/Materials/PBR/pbrMaterial';
import type {Material} from '@babylonjs/core/Materials/material';
import {attachFoliageWind,foliageWindProfile,hasFoliageWind,type FoliageWindPlugin} from './FoliageWindPlugin';
export {hasFoliageWind} from './FoliageWindPlugin';

/**
 * Materiais de vegetação: alpha-test correto, iluminação de dois lados e vento.
 *
 * Isto centraliza o que estava espalhado em `FarmWorld` e `RegionPresentation` — `twoSidedLighting`
 * mais `ALPHATEST` com corte em 0,4 — e acrescenta duas coisas que a revisão pediu:
 *
 * - `alphaCutOff` menor nas COPAS (0,33). Alpha-test alto come as bordas finas da folha e é parte do
 *   "copa rala" relatado; baixar o corte devolve massa sem custar desenho nem transparência real.
 * - Decalque de trilha convertido para alpha-test. Ele estava declarado `BLEND` no glTF e não casava
 *   com o filtro antigo `/fern|grass|tree/`, então ficava no passe transparente, sem escrita de
 *   profundidade, ordenado a cada quadro e com overdraw integral sobre a tela inteira.
 */

/** Vegetação de verdade: recebe vento, alpha-test e iluminação de dois lados. */
export const FOLIAGE_MATERIAL=/fern|grass|tree|leaves|branches|orchard/i;
/** Decalques colados no chão: alpha-test, nunca blend. */
export const GROUND_DECAL_MATERIAL=/trail|worn earth/i;

export interface FoliageSetup {plugins:FoliageWindPlugin[];decals:Material[]}

/**
 * Prepara a vegetação de uma coleção de materiais.
 *
 * Deve ser chamado ANTES do `freeze()` do primeiro quadro. Os materiais que saírem daqui com vento
 * precisam ficar de fora do congelamento — o Babylon não refaz o bind de material congelado e o
 * tempo do vento pararia. Use {@link hasFoliageWind} no laço que congela.
 */
export function applyFoliageMaterials(materials:Iterable<Material|null|undefined>):FoliageSetup {
 const plugins:FoliageWindPlugin[]=[],decals:Material[]=[];
 for(const material of materials){
  if(!(material instanceof PBRMaterial))continue;
  if(GROUND_DECAL_MATERIAL.test(material.name)){
   // Trilha sobre terreno não precisa de transparência real; alpha-test devolve early-Z e ordem.
   if(material.albedoTexture?.hasAlpha||material.transparencyMode===PBRMaterial.PBRMATERIAL_ALPHABLEND){
    material.transparencyMode=PBRMaterial.PBRMATERIAL_ALPHATEST;material.alphaCutOff=.35;
   }
   material.needDepthPrePass=false;
   decals.push(material);
   continue;
  }
  if(!FOLIAGE_MATERIAL.test(material.name))continue;
  material.twoSidedLighting=true;
  if(material.albedoTexture?.hasAlpha){
   material.transparencyMode=PBRMaterial.PBRMATERIAL_ALPHATEST;
   // Copa com corte alto perde as pontas das folhas e lê como rala; 0,33 recupera massa de graça.
   material.alphaCutOff=/leaves|tree|orchard/i.test(material.name)?.33:.4;
  }
  const profile=foliageWindProfile(material.name);
  if(!profile)continue;
  const plugin=attachFoliageWind(material,profile);
  if(plugin)plugins.push(plugin);
 }
 return{plugins,decals};
}

/**
 * Relógio do vento de uma região/cena.
 *
 * Um controlador por conjunto de materiais; `FarmWorld.update` avança o do mundo base e cada região
 * avança o seu. Sem estado global: descartar a região descarta o vento junto.
 */
export class FoliageWind {
 private readonly plugins:FoliageWindPlugin[];
 private disposed=false;
 constructor(materials:Iterable<Material|null|undefined>){this.plugins=applyFoliageMaterials(materials).plugins;}
 get materials():number{return this.plugins.length;}
 get seconds():number{return this.plugins[0]?.time??0;}
 update(dt:number):void{if(!this.disposed)for(const plugin of this.plugins)plugin.advance(dt);}
 dispose():void{this.disposed=true;this.plugins.length=0;}
}
