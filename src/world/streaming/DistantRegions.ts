import {FarCanopies,type FarCanopy} from './FarCanopies';
import {ViewUpdateGate} from '../../rendering/ViewUpdateGate';
import type {Vec3} from '../../core/contracts';
import {LoadAssetContainerAsync} from '@babylonjs/core/Loading/sceneLoader';
import type {AssetContainer} from '@babylonjs/core/assetContainer';
import type {Scene} from '@babylonjs/core/scene';
import {PBRMaterial} from '@babylonjs/core/Materials/PBR/pbrMaterial';
import {Color3} from '@babylonjs/core/Maths/math.color';
import {WORLD_MATERIAL_TINT} from './RegionPresentation';
import {FARM_REGIONS} from './SpatialRegionInterest';
export interface DistantResource {setVisible(visible:boolean):void;update?(dt:number,viewer:Vec3):void;dispose():void}
/** Mutually exclusive with detailed residency. A proxy is visual only and never opens a passage. */
export class DistantRegionSet {
 private readonly resources=new Map<string,DistantResource>();private ready=new Set<string>();private disposed=false;
 attach(id:string,resource:DistantResource):void{if(this.disposed){resource.dispose();return;}this.resources.get(id)?.dispose();this.resources.set(id,resource);resource.setVisible(!this.ready.has(id));}
 update(ready:readonly string[]):void{if(this.disposed)return;this.ready=new Set(ready);for(const [id,resource] of this.resources)resource.setVisible(!this.ready.has(id));}
 updateView(dt:number,viewer:Vec3):void{if(!this.disposed)for(const [id,resource] of this.resources)if(!this.ready.has(id))resource.update?.(dt,viewer);}
 dispose():void{if(this.disposed)return;this.disposed=true;for(const resource of this.resources.values())resource.dispose();this.resources.clear();this.ready.clear();}
}
export class DistantRegions {
 private readonly set=new DistantRegionSet();readonly errors:string[]=[];
 constructor(private readonly scene:Scene){}
 async load():Promise<void>{await Promise.all(FARM_REGIONS.map(async region=>{
  let container:AssetContainer|undefined,canopies:FarCanopies|undefined;
  try{
   container=await LoadAssetContainerAsync(`/models/${region.id}-distant.glb`,this.scene);
   for(const material of container.materials)if(material instanceof PBRMaterial){material.maxSimultaneousLights=4;const tint=WORLD_MATERIAL_TINT[material.name];if(tint){material.albedoColor=Color3.FromHexString(tint);material.roughness=.82;}if(material.albedoTexture)material.albedoTexture.anisotropicFilteringLevel=4;}
   for(const mesh of container.meshes){mesh.isPickable=false;mesh.receiveShadows=false;mesh.computeWorldMatrix(true);mesh.freezeWorldMatrix();}
   let placements:FarCanopy[]=[];
   if(region.id==='rootwood'){const response=await fetch('/models/rootwood-canopies.json');if(!response.ok)throw Error('Missing distant grove placements');placements=await response.json();if(!Array.isArray(placements)||placements.length!==300||placements.some(p=>![p.center?.x,p.center?.y,p.center?.z,p.size].every(Number.isFinite)||p.size<=0||p.size>100))throw Error('Invalid distant grove placements');canopies=new FarCanopies(this.scene,placements.length);}
   const resource=container;container.addAllToScene();const roots=[...container.rootNodes];
   const grove=canopies,gate=new ViewUpdateGate();let active=true;
   this.set.attach(region.id,{setVisible:visible=>{active=visible;for(const root of roots)root.setEnabled(visible);grove?.mesh.setEnabled(visible);},update:(dt,viewer)=>{if(active&&grove&&gate.ready(dt,viewer))grove.update(placements,viewer);},dispose:()=>{grove?.dispose();resource.dispose();}});
  }catch(error){canopies?.dispose();container?.dispose();this.errors.push(region.id+': '+String(error));}
 }));}
 update(ready:readonly string[]):void{this.set.update(ready);}
 updateView(dt:number,viewer:Vec3):void{this.set.updateView(dt,viewer);}
 dispose():void{this.set.dispose();}
}

