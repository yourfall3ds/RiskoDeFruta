import {sweepCapsuleTriangle} from './CapsuleTriangle';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {Ray} from '@babylonjs/core/Culling/ray';
interface PackedNode {min:number[];max:number[];start:number;end:number;left?:PackedNode;right?:PackedNode}
export interface RayIndexSnapshot {faces:number[];root:PackedNode}
interface Node {min:Vector3;max:Vector3;start:number;end:number;left?:Node;right?:Node}
/** Static triangle BVH: built once while loading, never on the firing frame. */
export class StaticRayIndex {
 private readonly points:Vector3[];private readonly faces:number[];private readonly root:Node;
 constructor(positions:readonly number[],private readonly indices:readonly number[],snapshot?:RayIndexSnapshot){
  this.points=Array.from({length:positions.length/3},(_,i)=>Vector3.FromArray(positions,i*3));this.faces=snapshot?.faces??Array.from({length:indices.length/3},(_,i)=>i);const unpack=(n:PackedNode):Node=>({min:Vector3.FromArray(n.min),max:Vector3.FromArray(n.max),start:n.start,end:n.end,...(n.left?{left:unpack(n.left)}:{}),...(n.right?{right:unpack(n.right)}:{})});this.root=snapshot?unpack(snapshot.root):this.build(0,this.faces.length);
 }
 snapshot():RayIndexSnapshot{const pack=(n:Node):PackedNode=>({min:n.min.asArray(),max:n.max.asArray(),start:n.start,end:n.end,...(n.left?{left:pack(n.left)}:{}),...(n.right?{right:pack(n.right)}:{})});return{faces:this.faces,root:pack(this.root)};}
 private build(start:number,end:number):Node {
  const min=new Vector3(Infinity,Infinity,Infinity),max=new Vector3(-Infinity,-Infinity,-Infinity);
  for(let i=start;i<end;i++)for(let k=0;k<3;k++){const p=this.points[this.indices[this.faces[i]!*3+k]!]!;min.minimizeInPlace(p);max.maximizeInPlace(p);}
  const node:Node={min,max,start,end};if(end-start<=24)return node;
  const span=max.subtract(min),axis=span.x>span.y&&span.x>span.z?'x':span.y>span.z?'y':'z',middle=(min[axis]+max[axis])/2;
  let cut=start;for(let i=start;i<end;i++){const face=this.faces[i]!,center=(this.points[this.indices[face*3]!]![axis]+this.points[this.indices[face*3+1]!]![axis]+this.points[this.indices[face*3+2]!]![axis])/3;if(center<middle){[this.faces[i],this.faces[cut]]=[this.faces[cut]!,face];cut++;}}
  if(cut===start||cut===end)cut=Math.floor((start+end)/2);node.left=this.build(start,cut);node.right=this.build(cut,end);return node;
 }
 sweepCapsule(origin:Vector3,delta:Vector3,radius:number,height:number):{time:number;normal:Vector3;collider:{id:string;min:Vector3;max:Vector3}}|undefined {
  const end=origin.add(delta),min=Vector3.Minimize(origin,end).addInPlaceFromFloats(-radius,-.001,-radius),max=Vector3.Maximize(origin,end).addInPlaceFromFloats(radius,height+.001,radius),stack=[this.root];let answer:ReturnType<StaticRayIndex['sweepCapsule']>;
  while(stack.length){const n=stack.pop()!;if(n.max.x<min.x||n.min.x>max.x||n.max.y<min.y||n.min.y>max.y||n.max.z<min.z||n.min.z>max.z)continue;if(n.left&&n.right){stack.push(n.left,n.right);continue;}
   for(let k=n.start;k<n.end;k++){const face=this.faces[k]!,a=this.points[this.indices[face*3]!]!,b=this.points[this.indices[face*3+1]!]!,c=this.points[this.indices[face*3+2]!]!;
    const lo=Vector3.Minimize(a,Vector3.Minimize(b,c)),hi=Vector3.Maximize(a,Vector3.Maximize(b,c));if(hi.x<min.x||lo.x>max.x||hi.y<min.y||lo.y>max.y||hi.z<min.z||lo.z>max.z)continue;
    const hit=sweepCapsuleTriangle(origin,delta,radius,height,a,b,c);if(hit&&(!answer||hit.time<answer.time))answer={...hit,collider:{id:'mesh-'+face,min:lo,max:hi}};
   }
  }return answer;
 }
 cast(ray:Ray):{distance:number;point:Vector3;normal:Vector3}|undefined {
  let nearest=ray.length,answer:ReturnType<StaticRayIndex['cast']>;const stack=[this.root];
  while(stack.length){const node=stack.pop()!;if(!ray.intersectsBoxMinMax(node.min,node.max))continue;if(node.left&&node.right){stack.push(node.left,node.right);continue;}
   for(let i=node.start;i<node.end;i++){const face=this.faces[i]!,a=this.points[this.indices[face*3]!]!,b=this.points[this.indices[face*3+1]!]!,c=this.points[this.indices[face*3+2]!]!,hit=ray.intersectsTriangle(a,b,c);if(!hit||hit.distance<.002||hit.distance>=nearest)continue;nearest=hit.distance;const normal=Vector3.Cross(b.subtract(a),c.subtract(a)).normalize();if(Vector3.Dot(normal,ray.direction)>0)normal.scaleInPlace(-1);answer={distance:nearest,point:ray.origin.add(ray.direction.scale(nearest)),normal};}
  }return answer;
 }
}
