import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { Vector3,Quaternion } from '@babylonjs/core/Maths/math.vector';
import type { CollisionWorld } from './CollisionWorld';
import { radialSurfaceOf,type EnemySurface } from '../enemies/EnemySpace';

/** A bounded set of actual fruit pieces separates from the boss during its fall. */
export class CorpseDebris {
  /** `up` é a vertical local guardada no nascimento do caco — `(0,1,0)` na fazenda. */
  private readonly pieces:{mesh:Mesh;velocity:Vector3;spin:Vector3;life:number;up:Vector3;resting:boolean}[]=[];
  private surface:EnemySurface|undefined;
  constructor(private readonly collision:CollisionWorld,surface?:EnemySurface){this.surface=radialSurfaceOf(surface);}
  useSurface(surface:EnemySurface|undefined):void {this.surface=radialSurfaceOf(surface);}
  private upAt(p:Vector3,out:Vector3):Vector3 {
    const u=this.surface?.up(p);return out.copyFromFloats(u?.x??0,u?.y??1,u?.z??0);
  }
  fracture(meshes:readonly Mesh[],body:Mesh):void {
    let index=0;
    for(const source of meshes){if(source===body||source.skeleton||this.pieces.length>=12)continue;
      source.computeWorldMatrix(true);const matrix=source.getWorldMatrix().clone(),piece=source.clone('broken-fruit-piece',null,true);if(!piece)continue;
      const rotation=Quaternion.Identity();matrix.decompose(piece.scaling,rotation,piece.position);piece.rotationQuaternion=null;piece.rotation.copyFrom(rotation.toEulerAngles());piece.isPickable=false;piece.receiveShadows=true;source.setEnabled(false);
      const angle=index++*2.4,up=this.upAt(piece.position,new Vector3());
      // Mesmo leque de antes, agora medido na base tangente do ponto onde o corpo se partiu.
      const basis=this.surface?.basis(piece.position,{x:0,y:0,z:1});
      const right=basis?basis.right:{x:1,y:0,z:0},forward=basis?basis.forward:{x:0,y:0,z:1};
      const s=Math.sin(angle)*5,c=Math.cos(angle)*5,lift=4+index*.3;
      this.pieces.push({mesh:piece,velocity:new Vector3(right.x*s+forward.x*c+up.x*lift,right.y*s+forward.y*c+up.y*lift,right.z*s+forward.z*c+up.z*lift),spin:new Vector3(.5+index*.3,.2,1.2-index*.17),life:7,up,resting:false});
    }
  }
  update(dt:number):void {for(let i=this.pieces.length-1;i>=0;i--){const p=this.pieces[i]!;p.life-=dt;if(p.life<=0){p.mesh.dispose();this.pieces.splice(i,1);continue;}
    // Caco parado não é re-simulado nem re-sondado.
    //
    // No plano a sonda é `groundAt` numa grade; no planeta é um RAIO na BVH de 1,75 M de triângulos,
    // ~15 µs, e sem isto cada caco pagava esse preço por quadro durante os sete segundos inteiros de
    // vida, muito depois de já ter assentado. O caco continua na cena e desaparece na mesma hora —
    // o que some é o recálculo de uma pose que não muda mais. (`FruitFragments` já fazia assim.)
    if(p.resting)continue;
    const fall=14*dt;p.velocity.set(p.velocity.x-p.up.x*fall,p.velocity.y-p.up.y*fall,p.velocity.z-p.up.z*fall);
    p.mesh.position.addInPlaceFromFloats(p.velocity.x*dt,p.velocity.y*dt,p.velocity.z*dt);p.mesh.rotation.addInPlace(p.spin.scale(dt));
    if(!this.surface){const ground=this.collision.groundAt(p.mesh.position.x,p.mesh.position.z,6);if(p.mesh.position.y<ground+.35){p.mesh.position.y=ground+.35;p.velocity.y=Math.abs(p.velocity.y)*.22;p.velocity.x*=Math.exp(-dt*7);p.velocity.z*=Math.exp(-dt*7);p.spin.scaleInPlace(Math.exp(-dt*7));if(p.velocity.lengthSquared()<.35){p.resting=true;p.velocity.setAll(0);p.spin.setAll(0);}}continue;}
    this.upAt(p.mesh.position,p.up);
    const support=this.surface.support(p.mesh.position,.5,60);
    if(!support||this.surface.heightGap(p.mesh.position,support.point)>=.35)continue;
    p.mesh.position.copyFromFloats(support.point.x+p.up.x*.35,support.point.y+p.up.y*.35,support.point.z+p.up.z*.35);
    const along=p.velocity.x*p.up.x+p.velocity.y*p.up.y+p.velocity.z*p.up.z,decay=Math.exp(-dt*7);
    // Quica na radial e amortece o tangencial, com os mesmos coeficientes .22 e exp(−7·dt).
    p.velocity.set(
      (p.velocity.x-p.up.x*along)*decay+p.up.x*Math.abs(along)*.22,
      (p.velocity.y-p.up.y*along)*decay+p.up.y*Math.abs(along)*.22,
      (p.velocity.z-p.up.z*along)*decay+p.up.z*Math.abs(along)*.22,
    );
    p.spin.scaleInPlace(decay);
    if(p.velocity.lengthSquared()<.35){p.resting=true;p.velocity.setAll(0);p.spin.setAll(0);}
  }}
  clear():void {for(const p of this.pieces)p.mesh.dispose();this.pieces.length=0;}
}
