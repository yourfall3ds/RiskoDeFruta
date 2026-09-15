import {FarCanopies,type FarCanopy} from './FarCanopies';
import {ViewUpdateGate} from '../../rendering/ViewUpdateGate';
import type {AbstractMesh} from '@babylonjs/core/Meshes/abstractMesh';
import type {Vec3} from '../../core/contracts';
type Tier='near'|'medium'|'hidden';
interface Tree {center:Vec3;near:AbstractMesh[];medium:AbstractMesh[];tier:Tier;canopy:FarCanopy}
/** Authored variants share geometry across placements; only one crown is drawn per tree. */
export class OrchardLods {
 private readonly trees:Tree[]=[];
 private readonly originals=new Map<AbstractMesh,boolean>();
 private readonly viewGate=new ViewUpdateGate();
 private disposed=false;private far:FarCanopies|undefined;
 constructor(meshes:readonly AbstractMesh[],private readonly budget:{nearDistance?:number;farDistance?:number;nearLimit?:number;mediumLimit?:number;farCanopies?:boolean}={}){
  const groups=new Map<string,{near:AbstractMesh[];medium:AbstractMesh[]}>();
  for(const mesh of meshes){
   const match=/^OrchardLOD_(\d+)_(near|medium)_/.exec(mesh.name);
   if(!match||!mesh.getTotalVertices())continue;
   const group=groups.get(match[1]!)??{near:[],medium:[]};group[match[2] as 'near'|'medium'].push(mesh);groups.set(match[1]!,group);
  }
  for(const group of groups.values()){
   if(!group.near.length||!group.medium.length)throw Error('Incomplete orchard tree LOD pair');
   const mesh=group.near[0]!;mesh.computeWorldMatrix(true);const center=mesh.getAbsolutePosition().clone();
   for(const part of [...group.near,...group.medium])this.originals.set(part,part.isVisible);
   const min={x:Infinity,y:Infinity,z:Infinity},max={x:-Infinity,y:-Infinity,z:-Infinity};
   for(const part of group.near){part.computeWorldMatrix(true);const b=part.getBoundingInfo().boundingBox;for(const axis of ['x','y','z'] as const){min[axis]=Math.min(min[axis],b.minimumWorld[axis]);max[axis]=Math.max(max[axis],b.maximumWorld[axis]);}}
   const canopy:FarCanopy={center:{x:(min.x+max.x)/2,y:(min.y+max.y)/2,z:(min.z+max.z)/2},size:(max.y-min.y)*1.08,visible:false};
   const tree:Tree={...group,center,tier:'medium',canopy};this.trees.push(tree);this.show(tree,budget.mediumLimit===undefined?'medium':'hidden');
  }
  if(budget.farCanopies&&this.trees.length)this.far=new FarCanopies(this.trees[0]!.near[0]!.getScene(),this.trees.length);
 }
 owns(mesh:AbstractMesh):boolean{return this.originals.has(mesh);}
 get hidden():number{return this.trees.filter(t=>t.tier==='hidden').length;}
 get counts():Record<Tier,number>{const counts={near:0,medium:0,hidden:0};for(const tree of this.trees)counts[tree.tier]++;return counts;}
 update(dt:number,viewer:Vec3):void{
  if(this.disposed||!this.viewGate.ready(dt,viewer))return;
  let nearCount=0,mediumCount=0;
  const nearDistance=this.budget.nearDistance??50,farDistance=this.budget.farDistance??190;
  const ranked=this.trees.map(tree=>({tree,d:Math.hypot(viewer.x-tree.center.x,viewer.y-tree.center.y,viewer.z-tree.center.z)})).sort((a,b)=>a.d-b.d);
  for(const {tree,d} of ranked){
   let tier:Tier=d>(tree.tier==='hidden'?farDistance-10:farDistance)?'hidden':d<=(tree.tier==='near'?nearDistance+10:nearDistance)?'near':'medium';
   if(tier==='near'){if(nearCount<(this.budget.nearLimit??Infinity))nearCount++;else tier='medium';}
   if(tier==='medium'){if(mediumCount<(this.budget.mediumLimit??Infinity))mediumCount++;else tier='hidden';}
   if(tier!==tree.tier)this.show(tree,tier);tree.canopy.visible=tier==='hidden';
  }
  this.far?.update(this.trees.map(tree=>tree.canopy),viewer);
 }
 private show(tree:Tree,tier:Tier):void{tree.tier=tier;for(const mesh of tree.near)mesh.isVisible=tier==='near';for(const mesh of tree.medium)mesh.isVisible=tier==='medium';}
 dispose():void{if(this.disposed)return;this.disposed=true;this.far?.dispose();for(const [mesh,visible] of this.originals)mesh.isVisible=visible;this.originals.clear();this.trees.length=0;}
}
