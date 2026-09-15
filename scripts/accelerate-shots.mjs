import {readFileSync,writeFileSync} from 'node:fs';
const edit=(p,a,b)=>{let s=readFileSync(p,'utf8');if(!s.includes(a))throw Error(p+' missing '+a.slice(0,40));writeFileSync(p,s.replace(a,b));};
edit('src/physics/CollisionWorld.ts',"import { TriangleGround }", "import {StaticRayIndex} from './StaticRayIndex';\nimport type {Ray} from '@babylonjs/core/Culling/ray';\nimport { TriangleGround }");
edit('src/physics/CollisionWorld.ts','private triangles:TriangleGround|undefined;', 'private triangles:TriangleGround|undefined;private rays:StaticRayIndex|undefined;\n  raycast(ray:Ray):ReturnType<StaticRayIndex["cast"]>{return this.rays?.cast(ray); }');
edit('src/physics/CollisionWorld.ts','this.triangles=new TriangleGround(positions,indices);','this.triangles=new TriangleGround(positions,indices);this.rays=new StaticRayIndex(positions,indices);');
edit('src/combat/DualPistols.ts',"import { PistolCadence }", "import {PickingInfo} from '@babylonjs/core/Collisions/pickingInfo';\nimport type {CollisionWorld} from '../physics/CollisionWorld';\nimport { PistolCadence }");
edit('src/combat/DualPistols.ts',"Pick<TrainingYard,'targets'>", "Pick<TrainingYard,'targets'>&{collision?:CollisionWorld}");
edit('src/combat/DualPistols.ts','this.barrageClock= .6/14','this.barrageClock+= .6/14');
edit('src/combat/DualPistols.ts','  private skillRay(',`  private worldPick(ray:Ray):PickingInfo|null {
    if(!this.yard.collision?.geometry)return this.scene.pickWithRay(ray,mesh=>mesh.isPickable&&!this.yard.targets.some(t=>t.mesh===mesh||t.meshes?.includes(mesh as typeof t.mesh)));
    const hit=this.yard.collision.raycast(ray);if(!hit)return null;const result=new PickingInfo();result.hit=true;result.distance=hit.distance;result.pickedPoint=hit.point;result.getNormal=()=>hit.normal;return result;
  }
  private targetPick(ray:Ray,target:TrainingTarget):PickingInfo {
    // Bounding volumes are updated by the animated actor. No per-shot CPU skinning or triangle walk.
    return target.mesh.intersects(ray,false,undefined,true);
  }
  private aimPick(ray:Ray):PickingInfo|null {
    let hit=this.worldPick(ray);for(const target of this.yard.targets){if(!target.mesh.isPickable||!target.mesh.isEnabled())continue;const candidate=this.targetPick(ray,target);if(candidate.hit&&(!hit||candidate.distance<hit.distance))hit=candidate;}return hit;
  }
  private skillRay(`);
edit('src/combat/DualPistols.ts','this.scene.pickWithRay(new Ray(this.camera.camera.position,dir,t.range),mesh=>mesh.isPickable)', 'this.aimPick(new Ray(this.camera.camera.position,dir,t.range))');
edit('src/combat/DualPistols.ts','this.scene.pickWithRay(ray,mesh=>mesh.isPickable&&!this.yard.targets.some(target=>target.mesh===mesh||target.meshes?.includes(mesh as typeof target.mesh)))','this.worldPick(ray)');
edit('src/combat/DualPistols.ts','(target.meshes??[target.mesh]).map(mesh=>ray.intersectsMesh(mesh,false)).sort((a,b)=>(a.hit?a.distance:Infinity)-(b.hit?b.distance:Infinity))[0]!', 'this.targetPick(ray,target)');
edit('src/combat/DualPistols.ts','this.scene.pickWithRay(new Ray(this.camera.camera.position,dir,t.range),mesh=>mesh.isPickable)', 'this.aimPick(new Ray(this.camera.camera.position,dir,t.range))');
edit('src/combat/DualPistols.ts','this.scene.pickWithRay(ray,mesh=>mesh.isPickable)', 'this.aimPick(ray)');
