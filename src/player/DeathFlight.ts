import type {Vec3} from '../core/contracts';
import type {CollisionWorld} from '../physics/CollisionWorld';
import type {SurfaceFrame} from '../physics/SurfaceFrame';
/**
 * Fatal launch is isolated from the living motor, but still sweeps the real world.
 *
 * Referencial: o arremesso, a gravidade, a varredura, o apoio e o limite de queda passam todos por
 * `collision.surface`, lido A CADA passo — capturar no construtor congelaria o `FlatSurface`, e a
 * cena constrói isto antes de o planeta ser configurado.
 *
 * **A cadência e o relatório de morte não mudam:** os mesmos `ceil(min(dt,.1)*120)` subpassos, o
 * mesmo amortecimento `exp(-step*.75)`, o mesmo `landed` e o mesmo teto de 18 m de descida. No
 * mundo plano cada número sai idêntico ao de antes, porque a base é exata.
 */
export class DeathFlight {
 readonly position:Vec3={x:0,y:0,z:0};
 /** Velocidade em MUNDO. */
 private velocity:Vec3={x:0,y:0,z:0};
 /** Altitude do instante da morte: no mundo plano é o `startY` de sempre. */
 private startAltitude=0;
 landed=false;
 constructor(private readonly world:CollisionWorld){}
 private get frame():SurfaceFrame {return this.world.surface;}
 /**
  * `frame` é OPCIONAL e recomendado: `{up, forward}` do motor. Sem ele a base tangente é derivada
  * de `yaw` como dica de mundo — no plano isso é exatamente `(sin yaw, 0, cos yaw)`, e no planeta é
  * uma reserva funcional (o `yaw` do motor lá é LOCAL, então a dica do motor é melhor).
  */
 start(position:Vec3,yaw:number,frame?:{up:Vec3;forward:Vec3}):void {
  Object.assign(this.position,position);
  const surface=this.frame;
  this.startAltitude=surface.altitude(position);
  const basis=frame??surface.basis(position,{x:Math.sin(yaw),y:0,z:Math.cos(yaw)});
  // Para trás e para FORA: −forward·5,8 + up·7,2. No plano: (−sin yaw·5,8, 7,2, −cos yaw·5,8).
  this.velocity={
   x:-basis.forward.x*5.8+basis.up.x*7.2,
   y:-basis.forward.y*5.8+basis.up.y*7.2,
   z:-basis.forward.z*5.8+basis.up.z*7.2,
  };
  this.landed=false;
 }
 update(dt:number):void {
  if(!Number.isFinite(dt)||dt<=0||this.landed)return;
  const surface=this.frame;
  const count=Math.ceil(Math.min(dt,.1)*120),step=Math.min(dt,.1)/count;
  for(let i=0;i<count&&!this.landed;i++){
   const old={...this.position},oldAltitude=surface.altitude(old);
   const up=surface.up(old);
   this.velocity.x-=up.x*13*step;this.velocity.y-=up.y*13*step;this.velocity.z-=up.z*13*step;
   const radial=this.velocity.x*up.x+this.velocity.y*up.y+this.velocity.z*up.z;
   surface.slide(this.position,{x:this.velocity.x*step,y:this.velocity.y*step,z:this.velocity.z*step},.4,1.8,0,{stepUp:false});
   /**
    * A velocidade tangencial é relida do deslocamento REAL (parede barra, rampa desvia) e
    * amortecida, exatamente como antes; a radial segue a queda. No plano `right=(1,0,0)` e
    * `forward=(0,0,1)`, então isto é literalmente `(position.x−old.x)/step*exp(−step*.75)`.
    */
   const moved={x:this.position.x-old.x,y:this.position.y-old.y,z:this.position.z-old.z};
   const carried=surface.up(this.position);
   const basis=surface.basis(this.position,{x:0,y:0,z:1});
   const damping=Math.exp(-step*.75);
   const tx=(moved.x*basis.right.x+moved.y*basis.right.y+moved.z*basis.right.z)/step*damping;
   const tz=(moved.x*basis.forward.x+moved.y*basis.forward.y+moved.z*basis.forward.z)/step*damping;
   this.velocity.x=basis.right.x*tx+basis.forward.x*tz+carried.x*radial;
   this.velocity.y=basis.right.y*tx+basis.forward.y*tz+carried.y*radial;
   this.velocity.z=basis.right.z*tx+basis.forward.z*tz+carried.z*radial;
   // Apoio: `groundAt(x, z, old.y + .01)` virou a sonda radial com o mesmo teto relativo.
   const altitude=surface.altitude(this.position);
   const support=surface.support(this.position,oldAltitude+.01-altitude,Infinity);
   if(radial<0&&support&&support.offset<=.04){
    this.position.x=support.point.x;this.position.y=support.point.y;this.position.z=support.point.z;
    this.landed=true;
   }
   if(surface.altitude(this.position)<=this.startAltitude-18)this.landed=true;
  }
 }
}
