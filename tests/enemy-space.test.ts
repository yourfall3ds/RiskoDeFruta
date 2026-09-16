import {describe,it,expect} from 'vitest';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {Scene} from '@babylonjs/core/scene';
import {TransformNode} from '@babylonjs/core/Meshes/transformNode';
import {CollisionWorld} from '../src/physics/CollisionWorld';
import {FlatSpace,RadialSpace,enemySpace,type Heading} from '../src/enemies/EnemySpace';
import {PlanetFrame} from '../src/planet/PlanetFrame';
import {PlanetCollision} from '../src/planet/PlanetCollision';
import {radialSurface,SIX_POLES,onDeck,sphereShell} from './support/radial-surface';
import type {SurfaceFrame} from '../src/physics/SurfaceFrame';
import type {EnemySurface} from '../src/enemies/EnemySpace';
import type {Vec3} from '../src/core/contracts';

/**
 * A trava do contrato entre os dois donos: o `SurfaceFrame` da física (que eu NÃO edito) tem de
 * continuar satisfazendo, por tipagem estrutural, o porto que a horda consome. Se alguém mudar uma
 * assinatura lá, isto para de compilar aqui — em vez de quebrar em runtime só no planeta.
 */
const _contract=(frame:SurfaceFrame):EnemySurface=>frame;
void _contract;

/**
 * `FlatSpace` é o ORÁCULO de regressão da fazenda: cada método tem de devolver exatamente a mesma
 * coisa que a expressão que estava embutida no `EnemySwarm`. Se algum destes casos falhar, a
 * fazenda mudou — que é precisamente o que o porte não pode fazer.
 */
function farm(){
  const collision=new CollisionWorld();
  collision.surfaces.push({id:'field',x:0,z:0,width:200,depth:200,height:0});
  collision.surfaces.push({id:'terrace',x:40,z:0,width:20,depth:20,height:3});
  collision.boxes.push({id:'wall',min:{x:-2,y:0,z:8},max:{x:2,y:4,z:8.2}});
  return{collision,space:new FlatSpace(collision)};
}
const sample=(seed:number):Vec3=>({
  x:Math.sin(seed*12.9898)*60,y:Math.sin(seed*4.1414)*6,z:Math.cos(seed*78.233)*60,
});

describe('FlatSpace reproduz a fazenda expressão por expressão',()=>{
  const {collision,space}=farm();
  it('distância, quadrado e porta de altura',()=>{
    for(let i=1;i<=400;i++){
      const a=sample(i),b=sample(i+.5);
      expect(space.distance(a,b)).toBe(Math.hypot(a.x-b.x,a.z-b.z));
      const dx=a.x-b.x,dz=a.z-b.z;
      expect(space.distanceSquared(a,b)).toBe(dx*dx+dz*dz);
      // COM SINAL: o `EnemySwarm` aplica `Math.abs` do lado dele, e depende disso.
      expect(space.heightGap(a,b)).toBe(a.y-b.y);
    }
  });
  it('apoio, sonda de queda e decalque usam os mesmos argumentos de `groundAt`',()=>{
    const out=new Vector3();
    for(let i=1;i<=400;i++){
      const p=sample(i);
      const legacy=collision.groundAt(p.x,p.z,p.y+.85);
      expect(space.groundUnder(p,.85,out)).toBe(Number.isFinite(legacy));
      if(Number.isFinite(legacy))expect([out.x,out.y,out.z]).toEqual([p.x,legacy,p.z]);
      const fall=collision.groundAt(p.x,p.z,6);
      expect(space.fallGround(p,out)).toBe(Number.isFinite(fall));
      if(Number.isFinite(fall))expect([out.x,out.y,out.z]).toEqual([p.x,fall,p.z]);
      const reference=sample(i+.25);
      const decal=collision.groundAt(p.x,p.z,reference.y+.5);
      space.decal(p,reference,out);
      expect([out.x,out.y,out.z]).toEqual([p.x,Number.isFinite(decal)?decal:reference.y,p.z]);
    }
  });
  it('deslizamento e varredura chamam `move`/`sweepSphere` com o mesmo resultado',()=>{
    for(let i=1;i<=200;i++){
      const p=sample(i),delta={x:Math.sin(i)*3,y:0,z:Math.cos(i)*3};
      const mine={x:p.x,y:p.y,z:p.z},legacy={x:p.x,y:p.y,z:p.z};
      space.slide(mine,delta,.8,1.8,.8);
      collision.move(legacy,delta.x,delta.z,.8,1.8,.8);
      expect(mine).toEqual(legacy);
      const hit=collision.sweepSphere(p,delta,.05);
      expect(space.sweepTime(p,delta,.05)).toBe(hit?.time);
    }
  });
  it('gravidade, elevação e anel continuam em `+Y`',()=>{
    const v=new Vector3(1,5,-2);
    space.gravity({x:0,y:0,z:0},v,12,1/60);
    expect([v.x,v.y,v.z]).toEqual([1,5-12/60,-2]);
    space.raise({x:0,y:0,z:0},v,3);
    expect(v.y).toBe(5-12/60+3);
    const out=new Vector3();
    space.lift({x:1,y:2,z:3},1.8,out);
    expect([out.x,out.y,out.z]).toEqual([1,3.8,3]);
    space.ringPoint({x:1,y:2,z:3},.7,4,.06,out);
    expect([out.x,out.y,out.z]).toEqual([1+Math.sin(.7)*4,2.06,3+Math.cos(.7)*4]);
    space.tangentInto({x:0,y:0,z:0},{x:1,y:9,z:2},out);
    expect([out.x,out.y,out.z]).toEqual([1,0,2]);
  });
  it('a grade de separação é a chave 2D de 3 m, com a mesma vizinhança de nove células',()=>{
    for(let i=1;i<=200;i++){
      const p=sample(i);
      expect(space.bucketKey(p)).toBe(Math.floor(p.x/3)*1048576+Math.floor(p.z/3));
    }
    const seen:number[]=[];
    space.neighbourhood({x:7,y:0,z:-4},key=>seen.push(key));
    const x=Math.floor(7/3),z=Math.floor(-4/3),expected:number[]=[];
    for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++)expected.push((x+dx)*1048576+(z+dz));
    expect(seen).toEqual(expected);
  });
  it('o giro é o mesmo `rotation.y` incremental, e o quaternion fica nulo',()=>{
    const engine=new NullEngine(),scene=new Scene(engine);
    try{
      const node=new TransformNode('actor',scene);
      space.faceAt(node,new Vector3(),{x:0,y:0,z:0},{x:3,y:0,z:4});
      expect(node.rotationQuaternion).toBeNull();
      expect(node.rotation.y).toBeCloseTo(Math.atan2(3,4),12);
      const before=node.rotation.y,heading={x:-1,y:0,z:0};
      space.face(node,new Vector3(),{x:0,y:0,z:0},heading,Math.min(1,(1/60)*10));
      const yaw=Math.atan2(-1,0);
      expect(node.rotation.y).toBeCloseTo(before+Math.atan2(Math.sin(yaw-before),Math.cos(yaw-before))*(10/60),12);
      expect(node.rotationQuaternion).toBeNull();
    }finally{scene.dispose();engine.dispose();}
  });
  it('rotação de direção mantém a fórmula XZ e `y` continua ausente',()=>{
    const heading:Heading={x:1,z:0};
    space.rotateHeading({x:0,y:0,z:0},heading,.5);
    expect(heading.x).toBeCloseTo(Math.cos(.5),12);
    expect(heading.z).toBeCloseTo(Math.sin(.5),12);
    expect(heading.y).toBeUndefined();
  });
  it('sem superfície a fábrica devolve o caminho plano; com superfície, o radial',()=>{
    expect(enemySpace(collision)).toBeInstanceOf(FlatSpace);
    expect(enemySpace(collision).radial).toBe(false);
  });
});

const R=180;
const frame=new PlanetFrame({centre:{x:0,y:0,z:0},surfaceRadius:R,voidRadius:168,ceilingRadius:320,islandRadius:72});
const planet=new PlanetCollision();
const shell=sphereShell(R,128,64);
planet.setGeometry(shell.positions,shell.indices);
const surface=radialSurface(frame,planet);

describe('RadialSpace responde no referencial local em qualquer vertical',()=>{
  const space=new RadialSpace(surface);
  it('a fábrica escolhe o radial quando existe superfície',()=>{
    expect(enemySpace(new CollisionWorld(),surface)).toBeInstanceOf(RadialSpace);
    expect(enemySpace(new CollisionWorld(),surface).radial).toBe(true);
  });
  it.each(SIX_POLES.map(p=>[p.name,p.direction] as const))('%s: vertical, elevação, gravidade e tangente',(_n,direction)=>{
    const p=onDeck(frame,direction),up=frame.up(p),out=new Vector3();
    space.upInto(p,out);
    expect([out.x,out.y,out.z].map(v=>+v.toFixed(9))).toEqual([up.x,up.y,up.z].map(v=>+v.toFixed(9)));
    space.lift(p,2,out);
    expect(Math.hypot(out.x,out.y,out.z)).toBeCloseTo(R+2,6);
    // Gravidade aponta para o CENTRO: o produto escalar com a radial é negativo, sempre.
    const v=new Vector3(0,0,0);
    space.gravity(p,v,12,1/60);
    expect(v.x*up.x+v.y*up.y+v.z*up.z).toBeCloseTo(-12/60,9);
    // Tangente de um vetor puramente radial é nula, em qualquer polo.
    space.tangentInto(p,up,out);
    expect(out.length()).toBeLessThan(1e-9);
  });
  it.each(SIX_POLES.map(p=>[p.name,p.direction] as const))('%s: distância é ARCO e a porta de altura é radial',(_n,direction)=>{
    const a=onDeck(frame,direction);
    const basis=frame.basisAt(a,{x:0,y:0,z:1});
    const b=frame.geodesicStep(a,{x:basis.forward.x*30,y:basis.forward.y*30,z:basis.forward.z*30}).position;
    expect(space.distance(a,b)).toBeCloseTo(30,6);
    expect(space.distanceSquared(a,b)).toBeCloseTo(900,4);
    // Corda < arco: é exatamente a diferença que a medida planar antiga não enxergava.
    expect(Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z)).toBeLessThan(30);
    const high={x:a.x+frame.up(a).x*4,y:a.y+frame.up(a).y*4,z:a.z+frame.up(a).z*4};
    expect(space.heightGap(high,a)).toBeCloseTo(4,6);
    expect(space.heightGap(a,high)).toBeCloseTo(-4,6);
  });
  it('dois pontos antípodas com o mesmo (x,z) ficam a meia volta, não a zero',()=>{
    const north=onDeck(frame,{x:0,y:1,z:0}),south=onDeck(frame,{x:0,y:-1,z:0});
    expect(Math.hypot(north.x-south.x,north.z-south.z)).toBeLessThan(1e-9);
    expect(space.distance(north,south)).toBeCloseTo(Math.PI*R,6);
    // E a grade 3D os separa em células diferentes, então não há empurrão fantasma.
    expect(space.bucketKey(north)).not.toBe(space.bucketKey(south));
  });
  it.each(SIX_POLES.map(p=>[p.name,p.direction] as const))('%s: a pose da raiz fica com a vertical local',(_n,direction)=>{
    const engine=new NullEngine(),scene=new Scene(engine);
    try{
      const node=new TransformNode('actor',scene),facing=new Vector3(0,0,1);
      const p=onDeck(frame,direction),basis=frame.basisAt(p,{x:0,y:0,z:1});
      node.position.set(p.x,p.y,p.z);
      space.faceAt(node,facing,p,{x:p.x+basis.forward.x*5,y:p.y+basis.forward.y*5,z:p.z+basis.forward.z*5});
      expect(node.rotationQuaternion).not.toBeNull();
      node.computeWorldMatrix(true);
      const poseUp=Vector3.TransformNormal(Vector3.Up(),node.getWorldMatrix()).normalize();
      const up=frame.up(p);
      expect(Vector3.Dot(poseUp,new Vector3(up.x,up.y,up.z))).toBeGreaterThan(.99999);
      // O giro incremental mantém o corpo no plano tangente: nunca inclina para fora da casca.
      for(let i=0;i<40;i++)space.face(node,facing,p,{x:basis.right.x,y:basis.right.y,z:basis.right.z},Math.min(1,10/60));
      node.computeWorldMatrix(true);
      const after=Vector3.TransformNormal(Vector3.Up(),node.getWorldMatrix()).normalize();
      expect(Vector3.Dot(after,new Vector3(up.x,up.y,up.z))).toBeGreaterThan(.99999);
      expect(Math.abs(facing.x*up.x+facing.y*up.y+facing.z*up.z)).toBeLessThan(1e-6);
    }finally{scene.dispose();engine.dispose();}
  });
  it.each(SIX_POLES.map(p=>[p.name,p.direction] as const))('%s: o apoio radial encontra o convés e o vazio devolve `false`',(_n,direction)=>{
    const p=onDeck(frame,direction,1.5),out=new Vector3();
    expect(space.groundUnder(p,2,out)).toBe(true);
    expect(Math.hypot(out.x,out.y,out.z)).toBeCloseTo(R,0);
    // Do lado de DENTRO da casca, olhando para o centro, não há convés abaixo.
    const inside=onDeck(frame,direction,-40);
    expect(space.groundUnder(inside,.5,out)).toBe(false);
  });
});
