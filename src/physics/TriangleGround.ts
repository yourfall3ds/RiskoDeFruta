import type {Vec3} from '../core/contracts';
interface Face {a:Vec3;b:Vec3;c:Vec3;nx:number;ny:number;nz:number;den:number}
export interface GroundSample {height:number;normal:Vec3;slopeDegrees:number}
/** Spatially indexed barycentric floor queries on the same solid geometry used by navigation. */
export class TriangleGround {
  private readonly cells=new Map<string,Face[]>();
  constructor(positions:readonly number[],indices:readonly number[]){
    const point=(i:number):Vec3=>({x:positions[i*3]!,y:positions[i*3+1]!,z:positions[i*3+2]!});
    for(let i=0;i<indices.length;i+=3){const a=point(indices[i]!),b=point(indices[i+1]!),c=point(indices[i+2]!),ux=b.x-a.x,uy=b.y-a.y,uz=b.z-a.z,vx=c.x-a.x,vy=c.y-a.y,vz=c.z-a.z;
      // 0,08 ⇒ até ~85,4°. O filtro antigo (0,25 ⇒ 75,5°) descartava justamente as faces que
      // precisam ser vistas pelo deslizamento, deixando a cápsula suspensa contra a rampa.
      // `height()` continua recusando qualquer face acima da inclinação jogável.
      const nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx,length=Math.hypot(nx,ny,nz);if(length<1e-8||Math.abs(ny)/length<.08)continue;
      const den=(b.z-c.z)*(a.x-c.x)+(c.x-b.x)*(a.z-c.z);if(Math.abs(den)<1e-7)continue;
      const flip=ny<0?-1:1,face={a,b,c,nx:nx*flip/length,ny:Math.abs(ny)/length,nz:nz*flip/length,den};
      for(let x=Math.floor(Math.min(a.x,b.x,c.x)/3);x<=Math.floor(Math.max(a.x,b.x,c.x)/3);x++)for(let z=Math.floor(Math.min(a.z,b.z,c.z)/3);z<=Math.floor(Math.max(a.z,b.z,c.z)/3);z++){const key=`${x},${z}`,list=this.cells.get(key)??[];list.push(face);this.cells.set(key,list);}
    }
  }
  height(x:number,z:number,maxHeight:number,maxSlope:number):number {let height=-Infinity;const minNormal=Math.cos(maxSlope*Math.PI/180);for(const {a,b,c,den,ny} of this.cells.get(`${Math.floor(x/3)},${Math.floor(z/3)}`)??[]){if(ny<minNormal)continue;const u=((b.z-c.z)*(x-c.x)+(c.x-b.x)*(z-c.z))/den,v=((c.z-a.z)*(x-c.x)+(a.x-c.x)*(z-c.z))/den;if(u<-.0001||v<-.0001||u+v>1.0001)continue;const y=u*a.y+v*b.y+(1-u-v)*c.y;if(y<=maxHeight+.0001&&y>height)height=y;}return height;}
  /** Superfície real sob o ponto, incluindo faces mais íngremes que o limite jogável, para o deslizamento. */
  sample(x:number,z:number,maxHeight:number):GroundSample|undefined {
    let best:GroundSample|undefined;
    for(const {a,b,c,den,nx,ny,nz} of this.cells.get(`${Math.floor(x/3)},${Math.floor(z/3)}`)??[]){
      const u=((b.z-c.z)*(x-c.x)+(c.x-b.x)*(z-c.z))/den,v=((c.z-a.z)*(x-c.x)+(a.x-c.x)*(z-c.z))/den;
      if(u<-.0001||v<-.0001||u+v>1.0001)continue;const y=u*a.y+v*b.y+(1-u-v)*c.y;
      if(y>maxHeight+.0001||(best&&y<=best.height))continue;
      best={height:y,normal:{x:nx,y:ny,z:nz},slopeDegrees:Math.acos(Math.min(1,ny))*180/Math.PI};
    }
    return best;
  }
}
