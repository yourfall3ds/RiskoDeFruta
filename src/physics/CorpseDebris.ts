import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { Vector3,Quaternion } from '@babylonjs/core/Maths/math.vector';
import type { CollisionWorld } from './CollisionWorld';

/** A bounded set of actual fruit pieces separates from the boss during its fall. */
export class CorpseDebris {
  private readonly pieces:{mesh:Mesh;velocity:Vector3;spin:Vector3;life:number}[]=[];
  constructor(private readonly collision:CollisionWorld){}
  fracture(meshes:readonly Mesh[],body:Mesh):void {
    let index=0;
    for(const source of meshes){if(source===body||source.skeleton||this.pieces.length>=12)continue;
      source.computeWorldMatrix(true);const matrix=source.getWorldMatrix().clone(),piece=source.clone('broken-fruit-piece',null,true);if(!piece)continue;
      const rotation=Quaternion.Identity();matrix.decompose(piece.scaling,rotation,piece.position);piece.rotationQuaternion=null;piece.rotation.copyFrom(rotation.toEulerAngles());piece.isPickable=false;piece.receiveShadows=true;source.setEnabled(false);
      const angle=index++*2.4;this.pieces.push({mesh:piece,velocity:new Vector3(Math.sin(angle)*5,4+index*.3,Math.cos(angle)*5),spin:new Vector3(.5+index*.3,.2,1.2-index*.17),life:7});
    }
  }
  update(dt:number):void {for(let i=this.pieces.length-1;i>=0;i--){const p=this.pieces[i]!;p.life-=dt;if(p.life<=0){p.mesh.dispose();this.pieces.splice(i,1);continue;}p.velocity.y-=14*dt;p.mesh.position.addInPlace(p.velocity.scale(dt));p.mesh.rotation.addInPlace(p.spin.scale(dt));const ground=this.collision.groundAt(p.mesh.position.x,p.mesh.position.z,6);if(p.mesh.position.y<ground+.35){p.mesh.position.y=ground+.35;p.velocity.y=Math.abs(p.velocity.y)*.22;p.velocity.x*=Math.exp(-dt*7);p.velocity.z*=Math.exp(-dt*7);p.spin.scaleInPlace(Math.exp(-dt*7));}}}
  clear():void {for(const p of this.pieces)p.mesh.dispose();this.pieces.length=0;}
}
