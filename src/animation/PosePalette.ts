import type { Bone } from '@babylonjs/core/Bones/bone';
import type { Skeleton } from '@babylonjs/core/Bones/skeleton';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode';

/** Upload bone changes only when an authored pose advances, matching animation LOD. */
export class PosePalette {
  private readonly links:{bone:Bone;node:TransformNode}[]=[];
  constructor(skeletons:readonly Skeleton[]){
    for(const skeleton of skeletons)for(const bone of skeleton.bones){const node=bone.getTransformNode();if(node){this.links.push({bone,node});bone.linkTransformNode(null);}}
    this.sync();
  }
  sync():void {
    for(const {bone,node} of this.links){
      if(!bone.position.equals(node.position))bone.position=node.position;
      if(node.rotationQuaternion){if(!bone.rotationQuaternion.equals(node.rotationQuaternion))bone.rotationQuaternion=node.rotationQuaternion;}
      else if(!bone.rotation.equals(node.rotation))bone.rotation=node.rotation;
      if(!bone.scaling.equals(node.scaling))bone.scaling=node.scaling;
    }
  }
}
