import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {Ray} from '@babylonjs/core/Culling/ray';
import {StaticRayIndex} from './StaticRayIndex';
import type {Vec3} from '../core/contracts';
/** Disconnected closed shells are tested separately, so overlapping islands remain solid. */
export class SolidInteriors {
 private readonly shells:{min:Vector3;max:Vector3;index:StaticRayIndex}[]=[];
 constructor(positions:readonly number[],indices:readonly number[]){
  const parent=Array.from({length:positions.length/3},(_,i)=>i),find=(n:number):number=>{while(parent[n]!==n){parent[n]=parent[parent[n]!]!;n=parent[n]!;}return n;};
  for(let i=0;i<indices.length;i+=3){const a=find(indices[i]!);parent[find(indices[i+1]!)]=a;parent[find(indices[i+2]!)]=a;}
  const groups=new Map<number,number[]>();for(let i=0;i<indices.length;i+=3){const root=find(indices[i]!),list=groups.get(root)??[];list.push(indices[i]!,indices[i+1]!,indices[i+2]!);groups.set(root,list);}
  for(const faces of groups.values()){const min=new Vector3(Infinity,Infinity,Infinity),max=new Vector3(-Infinity,-Infinity,-Infinity);for(const id of faces){const p=Vector3.FromArray(positions,id*3);min.minimizeInPlace(p);max.maximizeInPlace(p);}this.shells.push({min,max,index:new StaticRayIndex(positions,faces)});}
 }
 contains(p:Vec3):boolean {
  for(const shell of this.shells){if(p.x<=shell.min.x||p.x>=shell.max.x||p.y<=shell.min.y||p.y>=shell.max.y||p.z<=shell.min.z||p.z>=shell.max.z)continue;
   const direction=new Vector3(.8123,.3171,.4897).normalize();let origin=new Vector3(p.x,p.y,p.z),crossings=0;
   for(let i=0;i<32;i++){const hit=shell.index.cast(new Ray(origin,direction,200));if(!hit)break;crossings++;origin=hit.point.add(direction.scale(.004));}
   if(crossings%2===1)return true;
  }return false;
 }
}
