import {NearbyShadowCasters} from '../../rendering/NearbyShadowCasters';
import {OrchardLods} from './OrchardLods';
import type {Scene} from '@babylonjs/core/scene';
import type {AbstractMesh} from '@babylonjs/core/Meshes/abstractMesh';
import type {ShadowGenerator} from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import type {Observer} from '@babylonjs/core/Misc/observable';
import {PBRMaterial} from '@babylonjs/core/Materials/PBR/pbrMaterial';
import {Color3} from '@babylonjs/core/Maths/math.color';
import {DetailVisibility,type WorldDetail} from '../DetailVisibility';
import type {Vec3} from '../../core/contracts';
export const WORLD_MATERIAL_TINT:Record<string,string>={'Barn red weathered wood':'#ad3928','Weathered timber':'#d0b58c','Ivory trim':'#fff1cc','Aged silo steel':'#e8e1cc','Oxidized roof':'#606961','Sunlit farm track':'#ffd799','Leaf litter soil':'#d6cf94','Tractor rubber':'#242824'};
/** Presentation owned by one resident container. Nothing here outlives that container. */
export class RegionPresentation {
 private details:DetailVisibility|undefined;
 private readonly orchard:OrchardLods;
 private readonly casters:NearbyShadowCasters;
 private freezeObserver:Observer<Scene>|undefined;
 private disposed=false;
 constructor(private readonly scene:Scene,meshes:readonly AbstractMesh[],shadows:ShadowGenerator,regionId=''){
  this.orchard=new OrchardLods(meshes,regionId==='rootwood'?{nearDistance:18,farDistance:85,nearLimit:3,mediumLimit:20,farCanopies:true}:{});this.orchard.update(1,scene.activeCamera?.globalPosition??{x:0,y:0,z:0});
  const materials=new Set(meshes.map(m=>m.material));
  for(const material of materials)if(material instanceof PBRMaterial){
   material.unfreeze();material.maxSimultaneousLights=4;
   const tint=WORLD_MATERIAL_TINT[material.name];if(tint){material.albedoColor=Color3.FromHexString(tint);material.roughness=.82;}
   if(material.albedoTexture)material.albedoTexture.anisotropicFilteringLevel=8;
   if(/fern|grass|tree/i.test(material.name)){material.twoSidedLighting=true;if(material.albedoTexture?.hasAlpha){material.transparencyMode=PBRMaterial.PBRMATERIAL_ALPHATEST;material.alphaCutOff=.4;}}
  }
  const details:WorldDetail[]=[];
  for(const mesh of meshes){mesh.receiveShadows=true;mesh.isPickable=!/fern|grass|tree/i.test(mesh.name);mesh.computeWorldMatrix(true);
   const center=mesh.getBoundingInfo().boundingSphere.centerWorld.clone();
   mesh.freezeWorldMatrix();
   if(this.orchard.owns(mesh)||!mesh.getTotalVertices()||!mesh.isVisible)continue;
   const radius=/fern|grass/i.test(mesh.name)?65:/coast_land/i.test(mesh.name)?135:/tree/i.test(mesh.name)?180:0;
   if(radius)details.push({center,radius,visible:true,setVisible:visible=>{mesh.isVisible=visible;}});
  }
  this.details=new DetailVisibility(details);
  this.casters=new NearbyShadowCasters(meshes,shadows);this.casters.update(1,scene.activeCamera?.globalPosition??{x:0,y:0,z:0});
  this.freezeObserver=scene.onAfterRenderObservable.addOnce(()=>{this.freezeObserver=undefined;if(!this.disposed)for(const material of materials)material?.freeze();});
 }
 get hidden():number{return (this.details?.hidden??0)+this.orchard.hidden;}
 update(dt:number,viewer:Vec3):void{if(!this.disposed){this.details?.update(dt,viewer);this.orchard.update(dt,viewer);this.casters.update(dt,viewer);}}
 dispose():void{if(this.disposed)return;this.disposed=true;if(this.freezeObserver)this.scene.onAfterRenderObservable.remove(this.freezeObserver);this.freezeObserver=undefined;this.orchard.dispose();this.details?.restore();this.details=undefined;this.casters.dispose();}
}
