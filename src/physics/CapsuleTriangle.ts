import {Vector3} from '@babylonjs/core/Maths/math.vector';
// Closest features of a vertical capsule and a triangle. Used by conservative advancement.
function pointTriangle(p:Vector3,a:Vector3,b:Vector3,c:Vector3):Vector3 {
 const ab=b.subtract(a),ac=c.subtract(a),ap=p.subtract(a),d1=Vector3.Dot(ab,ap),d2=Vector3.Dot(ac,ap);if(d1<=0&&d2<=0)return a;
 const bp=p.subtract(b),d3=Vector3.Dot(ab,bp),d4=Vector3.Dot(ac,bp);if(d3>=0&&d4<=d3)return b;
 const vc=d1*d4-d3*d2;if(vc<=0&&d1>=0&&d3<=0)return a.add(ab.scale(d1/(d1-d3)));
 const cp=p.subtract(c),d5=Vector3.Dot(ab,cp),d6=Vector3.Dot(ac,cp);if(d6>=0&&d5<=d6)return c;
 const vb=d5*d2-d1*d6;if(vb<=0&&d2>=0&&d6<=0)return a.add(ac.scale(d2/(d2-d6)));
 const va=d3*d6-d5*d4;if(va<=0&&d4-d3>=0&&d5-d6>=0)return b.add(c.subtract(b).scale((d4-d3)/(d4-d3+d5-d6)));
 const inv=1/(va+vb+vc);return a.add(ab.scale(vb*inv)).addInPlace(ac.scale(vc*inv));
}
const clamp=(v:number)=>Math.max(0,Math.min(1,v));
function segments(p:Vector3,q:Vector3,a:Vector3,b:Vector3):[Vector3,Vector3] {
 const d1=q.subtract(p),d2=b.subtract(a),r=p.subtract(a),aa=Vector3.Dot(d1,d1),ee=Vector3.Dot(d2,d2),f=Vector3.Dot(d2,r);let s=0,t=0;
 if(aa<1e-12)t=ee>1e-12?clamp(f/ee):0;
 else {const c=Vector3.Dot(d1,r);if(ee<1e-12)s=clamp(-c/aa);else{const bb=Vector3.Dot(d1,d2),den=aa*ee-bb*bb;s=den!==0?clamp((bb*f-c*ee)/den):0;t=(bb*s+f)/ee;if(t<0){t=0;s=clamp(-c/aa);}else if(t>1){t=1;s=clamp((bb-c)/aa);}}}
 return[p.add(d1.scale(s)),a.add(d2.scale(t))];
}
export function capsuleTriangle(position:Vector3,radius:number,height:number,a:Vector3,b:Vector3,c:Vector3):{distance:number;normal:Vector3} {
 const p=position.add(new Vector3(0,radius,0)),q=position.add(new Vector3(0,Math.max(radius,height-radius),0));
 let best=Infinity,normal=Vector3.Up();
 const consider=(x:Vector3,y:Vector3)=>{const delta=x.subtract(y),distance=delta.lengthSquared();if(distance<best){best=distance;normal=delta;}};
 consider(p,pointTriangle(p,a,b,c));consider(q,pointTriangle(q,a,b,c));
 for(const [x,y] of [[a,b],[b,c],[c,a]]){const pair=segments(p,q,x!,y!);consider(pair[0],pair[1]);}
 const n=Vector3.Cross(b.subtract(a),c.subtract(a)),den=Vector3.Dot(n,q.subtract(p));
 if(Math.abs(den)>1e-10){const t=Vector3.Dot(n,a.subtract(p))/den;if(t>=0&&t<=1){const point=Vector3.Lerp(p,q,t);if(Vector3.DistanceSquared(pointTriangle(point,a,b,c),point)<1e-10){best=0;normal=n;}}}
 if(normal.lengthSquared()<1e-12)normal.copyFrom(n);return{distance:Math.sqrt(best),normal:normal.normalize()};
}
export function sweepCapsuleTriangle(origin:Vector3,delta:Vector3,radius:number,height:number,a:Vector3,b:Vector3,c:Vector3):{time:number;normal:Vector3}|undefined {
 const speed=delta.length();if(speed<1e-10)return;let time=0;
 for(let i=0;i<24;i++){
  const nearest=capsuleTriangle(origin.add(delta.scale(time)),radius,height,a,b,c),gap=nearest.distance-radius;
  if(gap<.0005){if(Vector3.Dot(nearest.normal,delta)>=-1e-8)return;return{time,normal:nearest.normal};}
  time+=gap/speed;if(time>1)return;
 }
 // A grazing convergence is treated as contact, never as permission to tunnel.
 const nearest=capsuleTriangle(origin.add(delta.scale(time)),radius,height,a,b,c);if(Vector3.Dot(nearest.normal,delta)<0)return{time,normal:nearest.normal};
}
