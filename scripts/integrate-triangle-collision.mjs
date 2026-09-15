import fs from 'node:fs';
function edit(p,fn){const s=fs.readFileSync(p,'utf8'),n=fn(s);if(s===n)throw Error(p);fs.writeFileSync(p,n);}
edit('src/physics/StaticRayIndex.ts',s=>{
 s="import {sweepCapsuleTriangle} from './CapsuleTriangle';\n"+s;
 const i=s.indexOf(' cast(ray:');return s.slice(0,i)+` sweepCapsule(origin:Vector3,delta:Vector3,radius:number,height:number):{time:number;normal:Vector3;collider:{id:string;min:Vector3;max:Vector3}}|undefined {
  const end=origin.add(delta),min=Vector3.Minimize(origin,end).addInPlaceFromFloats(-radius,-.001,-radius),max=Vector3.Maximize(origin,end).addInPlaceFromFloats(radius,height+.001,radius),stack=[this.root];let answer:ReturnType<StaticRayIndex['sweepCapsule']>;
  while(stack.length){const n=stack.pop()!;if(n.max.x<min.x||n.min.x>max.x||n.max.y<min.y||n.min.y>max.y||n.max.z<min.z||n.min.z>max.z)continue;if(n.left&&n.right){stack.push(n.left,n.right);continue;}
   for(let k=n.start;k<n.end;k++){const face=this.faces[k]!,a=this.points[this.indices[face*3]!]!,b=this.points[this.indices[face*3+1]!]!,c=this.points[this.indices[face*3+2]!]!;
    const lo=Vector3.Minimize(a,Vector3.Minimize(b,c)),hi=Vector3.Maximize(a,Vector3.Maximize(b,c));if(hi.x<min.x||lo.x>max.x||hi.y<min.y||lo.y>max.y||hi.z<min.z||lo.z>max.z)continue;
    const hit=sweepCapsuleTriangle(origin,delta,radius,height,a,b,c);if(hit&&(!answer||hit.time<answer.time))answer={...hit,collider:{id:'mesh-'+face,min:lo,max:hi}};
   }
  }return answer;
 }
`+s.slice(i);
});
edit('src/physics/CollisionWorld.ts',s=>{
 s=s.replace('sweepSphere(origin: Vec3,delta: Vec3,radius: number):', 'sweepSphere(origin: Vec3,delta: Vec3,radius: number,mesh=false):');
 s=s.replace('    return closest;\n  }\n  /** Continuous', `    if(mesh&&this.rays){const hit=this.rays.sweepCapsule(new Vector3(origin.x,origin.y-radius,origin.z),new Vector3(delta.x,delta.y,delta.z),radius,radius*2);if(hit&&(!closest||hit.time<closest.time))closest=hit;}
    return closest;
  }
  /** Continuous`);
 s=s.replace('      if(!nearest){position.x+=remaining.x;position.y+=remaining.y;', `      const surface=this.rays?.sweepCapsule(new Vector3(position.x,position.y,position.z),new Vector3(remaining.x,remaining.y,remaining.z),radius,height);if(surface&&(!nearest||surface.time<nearest.time))nearest=surface;
      if(!nearest){position.x+=remaining.x;position.y+=remaining.y;`);
 s=s.replace('step: number): void {', 'step: number,mesh=false): void {');
 s=s.replace('      if(!nearest) {position.x+=remaining.x;position.z+=remaining.z;break;}',`      if(mesh){const hit=this.rays?.sweepCapsule(new Vector3(position.x,position.y+step,position.z),new Vector3(remaining.x,0,remaining.z),radius,Math.max(radius*2,height-step));if(hit&&(!nearest||hit.time<nearest.time))nearest=hit;}
      if(!nearest) {position.x+=remaining.x;position.z+=remaining.z;break;}`);
 return s;
});
edit('src/player/PlayerMotor.ts',s=>s.replace('z:moveZ*.55},t.radius)', 'z:moveZ*.55},t.radius,true)').replace('motion.z,t.radius,t.height,t.stepHeight);','motion.z,t.radius,t.height,t.stepHeight,true);'));
edit('src/camera/ThirdPersonCamera.ts',s=>s.replace('this.world.sweepSphere(this.pivot,delta,t.radius)', 'this.world.sweepSphere(this.pivot,delta,t.radius,true)'));
fs.appendFileSync('docs/OBJECTIVES_QUEUE.md','\n## Novos pedidos durante a revisão\n\n- [ ] Impedir entrada nas laterais profundas das ilhas e em pedras, com colisão da malha e recuperação de sobreposição; câmera fora da rocha.\n- [ ] MP I com animação cinematográfica própria de preparação e varredura das pistolas.\n- [ ] Animações de recuo e passos laterais, escolhidas pela direção local do movimento.\n');
