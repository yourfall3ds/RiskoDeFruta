import {Vector3,Quaternion} from '@babylonjs/core/Maths/math.vector';
import {Ray} from '@babylonjs/core/Culling/ray';
/**
 * Um contato do ricochete. `targetId` e `triangle` são MUTUAMENTE exclusivos por construção: quem
 * monta o contato elege o mais próximo entre ator e mundo, então ou venceu um inimigo (e há
 * `targetId`), ou venceu o cenário (e há `triangle`, quando o backend souber dizer qual).
 */
export interface FanHit {point:Vector3;normal:Vector3;distance:number;targetId?:number;
 /** Índice do triângulo de colisão, para a destruição resolver o prop por intervalo. */
 triangle?:number}
export interface FanBullet {position:Vector3;direction:Vector3;axis:Vector3;turn:number;age:number;bounces:number;hitIds:Set<number>}

/**
 * Perpendicular unitária estável a `up`, usada só quando a mira coincide com a vertical e o
 * produto vetorial degenera.
 *
 * Com `up=+Y` devolve EXATAMENTE `(1,0,0)` — o literal que o leque plano sempre usou como saída
 * degenerada. Fora disso devolve um eixo bem condicionado em vez de repetir um `+X` que, num
 * planeta, pode ser paralelo à própria vertical.
 */
export function stablePerpendicular(up:Vector3):Vector3 {
 const seed=Math.abs(up.x)<.9?new Vector3(1,0,0):new Vector3(0,0,1);
 const p=seed.subtract(up.scale(Vector3.Dot(seed,up)));
 return p.lengthSquared()<1e-12?new Vector3(0,0,1):p.normalize();
}

/**
 * Rodrigues: gira `v` em torno de `axis` (unitário) por `angle`.
 *
 * Com `axis=+Y` reproduz termo a termo a guinada literal que o MP II fazia
 * (`x·cos + z·sin`, `y` intacto, `z·cos − x·sin`) — por isso trocar a fórmula antiga por esta
 * função não muda um único número do jogo plano.
 */
export function rotateAboutAxis(v:Vector3,axis:Vector3,angle:number,result=new Vector3()):Vector3 {
 const cos=Math.cos(angle),sin=Math.sin(angle),d=Vector3.Dot(axis,v)*(1-cos);
 return result.copyFromFloats(
  v.x*cos+(axis.y*v.z-axis.z*v.y)*sin+axis.x*d,
  v.y*cos+(axis.z*v.x-axis.x*v.z)*sin+axis.y*d,
  v.z*cos+(axis.x*v.y-axis.y*v.x)*sin+axis.z*d);
}

/** Free-aim curved ballistics. Reflections depend on surfaces, never on a selected target. */
export class RicochetFan {
 readonly bullets:FanBullet[]=[];readonly count=10;readonly interval=.055;
 constructor(private readonly cast:(ray:Ray,ignore:ReadonlySet<number>)=>FanHit|undefined,private readonly impact:(hit:FanHit,direction:Vector3)=>void,private readonly trail:(from:Vector3,to:Vector3)=>void){}
 /**
  * `up` é a vertical LOCAL de quem atira e define o plano em que o leque abre. O padrão `+Y`
  * mantém o jogo plano idêntico; numa superfície curva quem chama passa a vertical do ponto e o
  * leque continua horizontal no equador, no polo e de cabeça para baixo.
  */
 launch(origin:Vector3,forward:Vector3,index:number,count:number=this.count,up:Vector3=Vector3.Up()):Vector3 {
  const f=forward.normalizeToNew(),u=up.normalizeToNew(),right=Vector3.Cross(u,f).normalize();if(right.lengthSquared()<.001)right.copyFrom(stablePerpendicular(u));
  const axis=Vector3.Cross(f,right).normalize(),angle=(index/(count-1)-.5)*.95;
  const direction=f.scale(Math.cos(angle)).add(right.scale(Math.sin(angle))).normalize();
  if(this.bullets.length<24)this.bullets.push({position:origin.clone(),direction,axis,turn:(index<count/2?-1:1)*.85,age:0,bounces:0,hitIds:new Set()});
  return direction;
 }
 update(dt:number):void {
  // Substeps cap the chord error, including when render and simulation rates differ.
  const steps=Math.max(1,Math.ceil(dt/(1/60))),step=dt/steps;
  for(let tick=0;tick<steps;tick++)for(let i=this.bullets.length-1;i>=0;i--){const b=this.bullets[i]!;b.age+=step;if(b.age>1.5){this.bullets.splice(i,1);continue;}
   if(b.age<.5&&b.bounces===0)b.direction.applyRotationQuaternionInPlace(Quaternion.RotationAxis(b.axis,b.turn*step*(1-b.age/.5)));
   let remaining=38*step;
   for(let contact=0;contact<3&&remaining>.001;contact++){
    const from=b.position.clone(),hit=this.cast(new Ray(from,b.direction,remaining),b.hitIds);
    if(!hit){b.position.addInPlace(b.direction.scale(remaining));this.trail(from,b.position);break;}
    b.position.copyFrom(hit.point);this.trail(from,b.position);
    const incoming=b.direction.clone();if(hit.targetId!==undefined)b.hitIds.add(hit.targetId);this.impact(hit,incoming);
    if(b.bounces++>=2){this.bullets.splice(i,1);break;}
    const normal=hit.normal.lengthSquared()>.001?hit.normal.normalizeToNew():incoming.negate();
    if(Vector3.Dot(normal,incoming)>0)normal.negateInPlace();
    b.direction.subtractInPlace(normal.scale(2*Vector3.Dot(b.direction,normal))).normalize();
    b.position.addInPlace(normal.scale(.035));remaining=Math.max(0,remaining-hit.distance-.035);
   }
  }
 }
 clear():void {this.bullets.length=0;}
}
