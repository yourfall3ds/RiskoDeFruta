import HavokPhysics from '@babylonjs/havok';
import havokWasm from '@babylonjs/havok/lib/esm/HavokPhysics.wasm?url';
import {HavokPlugin} from '@babylonjs/core/Physics/v2/Plugins/havokPlugin';
import '@babylonjs/core/Physics/v2/physicsEngineComponent';
import '@babylonjs/core/Physics/joinedPhysicsEngineComponent';
import {PhysicsAggregate} from '@babylonjs/core/Physics/v2/physicsAggregate';
import {PhysicsShapeType,PhysicsConstraintType} from '@babylonjs/core/Physics/v2/IPhysicsEnginePlugin';
import {Ragdoll,type RagdollBoneProperties} from '@babylonjs/core/Physics/v2/ragdoll';
import {Mesh} from '@babylonjs/core/Meshes/mesh';
import {VertexData} from '@babylonjs/core/Meshes/mesh.vertexData';
import {Vector3,Matrix,Quaternion} from '@babylonjs/core/Maths/math.vector';
import type {Observer} from '@babylonjs/core/Misc/observable';
import type {Scene} from '@babylonjs/core/scene';
import type {Skeleton} from '@babylonjs/core/Bones/skeleton';
import type {DamageContext} from '../core/contracts';

const physicsInitialization=new WeakMap<Scene,Promise<void>>();
/** Scene-local initialization: loading another region never replaces a running physics world. */
export function ensureRagdollPhysics(scene:Scene):Promise<void>{
  if(scene.isDisposed)return Promise.reject(Error('Cannot initialize a disposed physics scene'));
  if(scene.getPhysicsEngine())return Promise.resolve();
  const pending=physicsInitialization.get(scene);if(pending)return pending;
  const initialization=HavokPhysics({locateFile:()=>havokWasm}).then(hk=>{
    if(scene.isDisposed)return;
    scene.enablePhysics(new Vector3(0,-18,0),new HavokPlugin(true,hk));scene.getPhysicsEngine()?.setSubTimeStep(1000/60);
  }).catch(error=>{physicsInitialization.delete(scene);throw error;});
  physicsInitialization.set(scene,initialization);return initialization;
}
/** Owns exactly one static terrain body; release is idempotent and does not touch other regions. */
export function addRagdollTerrain(scene:Scene,id:string,geometry:{positions:number[];indices:number[]}):()=>void {
  if(scene.isDisposed||!scene.getPhysicsEngine())throw Error('Physics must be ready before terrain activation');
  if(!geometry.positions.length||!geometry.indices.length)throw Error('Terrain geometry is empty');
  const mesh=new Mesh('terrain-physics-'+id,scene);let aggregate:PhysicsAggregate|undefined;
  try{const data=new VertexData();data.positions=geometry.positions;data.indices=geometry.indices;data.applyToMesh(mesh);mesh.isVisible=false;mesh.isPickable=false;mesh.freezeWorldMatrix();aggregate=new PhysicsAggregate(mesh,PhysicsShapeType.MESH,{mass:0,friction:.8,restitution:.08},scene);}
  catch(error){aggregate?.dispose();mesh.dispose();throw error;}
  let released=false;return()=>{if(released)return;released=true;aggregate?.dispose();mesh.dispose();};
}
export async function enableRagdollPhysics(scene:Scene,geometry:{positions:number[];indices:number[]}):Promise<void>{
  await ensureRagdollPhysics(scene);if(scene.isDisposed)return;addRagdollTerrain(scene,'base',geometry);
}

interface Handle {rig:Ragdoll;disposed:boolean;scene:Scene;observer:Observer<Scene>}
const activeRagdolls=new WeakMap<Scene,Set<Handle>>();
export function activeRagdollPositions(scene:Scene):Vector3[]{return [...(activeRagdolls.get(scene)??[])].filter(h=>!h.disposed).map(h=>h.rig.getAggregate(0).transformNode.position.clone());}
/** Articulated bodies are allocated on death, with a bounded simultaneous simulation budget. */
export class RagdollWorld {
  private handles:Handle[]=[];
  create(skeleton:Skeleton|undefined,body:Mesh,context:DamageContext,scale:number):Handle|undefined {
    if(!skeleton||!body.getScene().getPhysicsEngine())return;
    const roots=skeleton.getChildren();if(roots.length!==1)return;
    const selected=skeleton.bones.filter(b=>b===roots[0]||/(Hips|Spine|Head|LeftArm|RightArm|LeftForeArm|RightForeArm|LeftUpLeg|RightUpLeg|LeftLeg|RightLeg|Bone_000|Bone_001|Bone_003|Bone_016|Bone_019|Bone_022|Bone_025|Bone_042|Bone_045)$/.test(b.name));
    const config=selected.map(b=>({bone:b.name,size:(b===roots[0]?.35:/Hips|Spine|Bone_00[01]$/.test(b.name)?.4:.18)*scale,height:(/Leg|Arm/.test(b.name)?.24:.3)*scale,joint:PhysicsConstraintType.BALL_AND_SOCKET,min:-65,max:65,mass:b===roots[0]?8:2,restitution:.05})) as RagdollBoneProperties[];
    body.computeWorldMatrix(true);skeleton.computeAbsoluteMatrices(true);
    const bind=selected.map(b=>({world:b.getAbsoluteMatrix().multiply(body.getWorldMatrix()),scale:b.scaling.clone()}));
    const rig=new Ragdoll(skeleton,body,config);rig.ragdoll();rig.pauseSync=true;
    // Babylon's world-space bone rotation setter accumulates scale for centimetre rigs
    // under glTF's reflected root. Convert physical world matrices into local rotations
    // explicitly; physics must never author a bone's scale or stretch its children.
    const observer=body.getScene().onBeforeRenderObservable.add(()=>{
      for(const [i,bone] of selected.entries()){
        const physical=rig.getAggregate(i).transformNode,rotation=Matrix.Identity();Matrix.FromQuaternionToRef(physical.rotationQuaternion??Quaternion.Identity(),rotation);
        const desired=bind[i]!.world.multiply(rotation);desired.setTranslation(physical.position);
        const parent=bone.getParent(),parentWorld=parent?parent.getAbsoluteMatrix().multiply(body.getWorldMatrix()):body.getWorldMatrix();
        const local=desired.multiply(Matrix.Invert(parentWorld)),scale=bind[i]!.scale;
        const values=local.asArray().slice();for(let row=0;row<3;row++){const divisor=[scale.x,scale.y,scale.z][row]!;for(let col=0;col<3;col++)values[row*4+col]!/=divisor;}
        bone.rotationQuaternion=Quaternion.FromRotationMatrix(Matrix.FromArray(values)).normalize();bone.scaling=scale;
        if(bone===roots[0])bone.position=local.getTranslation();
        skeleton.computeAbsoluteMatrices(true);
      }
    });
    for(let i=0;i<selected.length;i++){const aggregate=rig.getAggregate(i);aggregate.body.setLinearVelocity(new Vector3(context.forceDirection.x*3,2.2,context.forceDirection.z*3));aggregate.body.setAngularVelocity(new Vector3(.6,0,.9));}
    const handle={rig,disposed:false,scene:body.getScene(),observer};this.handles.push(handle);const active=activeRagdolls.get(handle.scene)??new Set<Handle>();active.add(handle);activeRagdolls.set(handle.scene,active);if(this.handles.length>4)this.release(this.handles[0]);return handle;
  }
  release(handle:Handle|undefined):void {if(!handle||handle.disposed)return;handle.disposed=true;activeRagdolls.get(handle.scene)?.delete(handle);handle.scene.onBeforeRenderObservable.remove(handle.observer);handle.rig.dispose();const i=this.handles.indexOf(handle);if(i>=0)this.handles.splice(i,1);}
  get count():number{return this.handles.length;}
  clear():void{for(const handle of [...this.handles])this.release(handle);}
}
