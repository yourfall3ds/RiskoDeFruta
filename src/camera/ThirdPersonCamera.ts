import type {AbstractMesh} from '@babylonjs/core/Meshes/abstractMesh';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Scene } from '@babylonjs/core/scene';
import type { CollisionWorld } from '../physics/CollisionWorld';
import type { Vec3 } from '../core/contracts';
import { PlanetaryHorizon } from './PlanetaryHorizon';
import { CAMERA_TUNING as t } from '../player/PlayerTuning';

export class ThirdPersonCamera {
  readonly camera: FreeCamera;
  readonly forward=new Vector3(0,0,1);
  readonly pivot=Vector3.Zero();
  private distance: number = t.distance;
  private readonly horizon=new PlanetaryHorizon(); private kick=0;private hurtKick=0;private hurtSide=1;
  private initialized=false;private readonly closeHidden:AbstractMesh[]=[];
  shake: number = t.shake;
  preferredDistance: number = t.distance;
  constructor(private readonly scene: Scene,private readonly world: CollisionWorld) {
    this.camera=new FreeCamera('player-camera',Vector3.Zero(),scene);
    this.camera.minZ=t.near;this.camera.maxZ=1200;this.camera.fov=t.fov;
    this.camera.inputs.clear();
  }
  skillClose(position:Vec3,yaw:number,tier:1|2|3,progress:number):void {
    const forward=new Vector3(Math.sin(yaw),0,Math.cos(yaw)),right=new Vector3(Math.cos(yaw),0,-Math.sin(yaw));
    const pivot=new Vector3(position.x,position.y+1.05,position.z);let close:Vector3|undefined,bestDistance=0;
    for(const angle of [0,.65,-.65,1.25,-1.25]){
      const direction=forward.scale(Math.cos(angle)).add(right.scale(Math.sin(angle)));
      const delta=direction.scale(3.45-progress*.22).add(right.scale(tier===2?-.38:.38));delta.y=.22;
      const hit=this.world.sweepSphere(pivot,delta,.16,true),fraction=hit?Math.max(0,hit.time-.05):1;
      const distance=delta.length()*fraction;if(distance>bestDistance){bestDistance=distance;close=pivot.add(delta.scale(fraction));}if(distance>2.6)break;
    }
    // A blocked close must never put the camera inside the character. Retain the normal camera if enclosed.
    if(!close||bestDistance<1.35)return;
    const weight=Math.min(1,progress*9);this.camera.position.copyFrom(Vector3.Lerp(this.camera.position,close,weight));
    this.camera.setTarget(Vector3.Lerp(this.camera.position.add(this.forward.scale(3)),pivot,weight));this.camera.rotation.z=(tier===3?-.035:.025)*weight;
    for(const mesh of this.scene.meshes){if(!mesh.isVisible||!mesh.isEnabled()||!/fern|grass/i.test(mesh.name))continue;const box=mesh.getBoundingInfo().boundingBox,p=this.camera.position;if(p.x>box.minimumWorld.x-.25&&p.x<box.maximumWorld.x+.25&&p.y>box.minimumWorld.y-.25&&p.y<box.maximumWorld.y+.25&&p.z>box.minimumWorld.z-.25&&p.z<box.maximumWorld.z+.25){mesh.isVisible=false;this.closeHidden.push(mesh);}}

  }
  impulse(strength: number): void {this.kick=Math.min(.05,this.kick+strength*this.shake);}
  hurt(strength:number,side:number):void {this.hurtKick=Math.min(.13,this.hurtKick+strength*this.shake);this.hurtSide=side<0?-1:1;}
  update(position: Vec3,yaw: number,pitch: number,dt: number): void {
    for(const mesh of this.closeHidden)mesh.isVisible=true;this.closeHidden.length=0;
    const factor=this.initialized?1-Math.exp(-Math.min(dt,.1)/t.smoothing):1;
    this.pivot.x+=(position.x-this.pivot.x)*factor;
    this.pivot.y+=(position.y+t.pivotHeight-this.pivot.y)*factor;
    this.pivot.z+=(position.z-this.pivot.z)*factor;
    this.forward.set(Math.sin(yaw)*Math.cos(pitch),-Math.sin(pitch),Math.cos(yaw)*Math.cos(pitch));
    // Keep the reference's left-third composition even in the narrow app preview.
    const aspect=this.camera.getEngine().getAspectRatio(this.camera);
    const shoulder=t.shoulderOffset*Math.min(1,aspect/(16/9));
    const delta=this.forward.scale(-this.preferredDistance).addInPlaceFromFloats(Math.cos(yaw)*shoulder,0,-Math.sin(yaw)*shoulder);
    const hit=this.world.sweepSphere(this.pivot,delta,t.radius,true);
    let allowed=hit?Math.max(.15,this.preferredDistance*hit.time-.08):this.preferredDistance;
    const ground=this.world.groundAt(this.pivot.x+delta.x,this.pivot.z+delta.z);
    if(delta.y<0 && this.pivot.y+delta.y<ground+t.radius) allowed=Math.min(allowed,Math.max(.15,(this.pivot.y-ground-t.radius)/-delta.y*this.preferredDistance));
    this.distance=allowed<this.distance?allowed:this.distance+(allowed-this.distance)*factor;
    this.camera.position.copyFrom(this.pivot).addInPlace(delta.scale(this.distance/this.preferredDistance));
    this.kick*=Math.exp(-dt*30);
    this.camera.setTarget(this.camera.position.add(this.forward).addInPlaceFromFloats(0,this.kick+this.hurtKick,0));
    this.camera.rotation.z=this.horizon.update(position,yaw,pitch,dt)+this.hurtKick*this.hurtSide*.4;this.hurtKick*=Math.exp(-dt*9);
    this.initialized=true;
  }
}

