import type { Vec3 } from '../core/contracts';
import type { CollisionWorld } from '../physics/CollisionWorld';
/** A shared reverse BFS field is rebuilt only when the player changes cells. */
export class FarmNavigation {
  readonly step=1.5;private readonly half=40;private readonly width=81;
  private readonly heights=new Float32Array(81*81).fill(NaN);private readonly distances=new Int16Array(81*81).fill(-1);private goal=-1;
  constructor(world:CollisionWorld){
    for(let z=-this.half;z<=this.half;z++)for(let x=-this.half;x<=this.half;x++){
      const px=x*this.step,pz=z*this.step,h=world.groundAt(px,pz,10);
      if(!Number.isFinite(h)||world.boxes.some(b=>b.max.y>h+.5&&b.min.y<h+1.8&&px>b.min.x-.5&&px<b.max.x+.5&&pz>b.min.z-.5&&pz<b.max.z+.5))continue;
      this.heights[this.index(x,z)]=h;
    }
  }
  private index(x:number,z:number):number{return (z+this.half)*this.width+x+this.half;}
  private cell(p:Vec3):number {const x=Math.round(p.x/this.step),z=Math.round(p.z/this.step);return Math.abs(x)<=this.half&&Math.abs(z)<=this.half?this.index(x,z):-1;}
  private neighbors(index:number):number[]{const x=index%this.width,z=Math.floor(index/this.width),out:number[]=[];for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){const nx=x+dx!,nz=z+dz!;if(nx>=0&&nx<this.width&&nz>=0&&nz<this.width)out.push(nz*this.width+nx);}return out;}
  update(goal:Vec3):void {let index=this.cell(goal);if(index<0)return;if(!Number.isFinite(this.heights[index]))index=this.neighbors(index).find(i=>Number.isFinite(this.heights[i]))??-1;if(index<0||index===this.goal)return;this.goal=index;this.distances.fill(-1);this.distances[index]=0;const queue=[index];for(let head=0;head<queue.length;head++){const current=queue[head]!;for(const next of this.neighbors(current)){if(this.distances[next]!==-1||!Number.isFinite(this.heights[next])||Math.abs(this.heights[next]!-this.heights[current]!)>1.1)continue;this.distances[next]=this.distances[current]!+1;queue.push(next);}}}
  direction(position:Vec3,target:Vec3):{x:number;z:number} {const index=this.cell(position);if(index<0)return{x:0,z:0};let best=index;for(const next of this.neighbors(index))if(this.distances[next]!>=0&&(this.distances[best]!<0||this.distances[next]!<this.distances[best]!))best=next;const x=best===index?target.x:(best%this.width-this.half)*this.step,z=best===index?target.z:(Math.floor(best/this.width)-this.half)*this.step;const dx=x-position.x,dz=z-position.z,length=Math.hypot(dx,dz);return length>.01?{x:dx/length,z:dz/length}:{x:0,z:0};}
  reachable(position:Vec3):boolean {const i=this.cell(position);return i>=0&&this.distances[i]!>=0;}
}
