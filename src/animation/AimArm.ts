import {Vector3,Quaternion,Matrix} from '@babylonjs/core/Maths/math.vector';
import type {TransformNode} from '@babylonjs/core/Meshes/transformNode';

/** Rotate the complete arm chain so its attached barrel follows the camera direction.
 * Both vectors are compared in parent space, including the glTF root reflection. */
export function aimArmAt(arm:TransformNode,grip:TransformNode,direction:Vector3):void {
 if(!arm.parent||!arm.rotationQuaternion)return;
 const parent=arm.parent.computeWorldMatrix(true),inverse=Matrix.Invert(parent);
 const current=Vector3.TransformNormal(Vector3.Forward(),grip.computeWorldMatrix(true));
 const from=Vector3.TransformNormal(current,inverse).normalize(),to=Vector3.TransformNormal(direction,inverse).normalize();
 const axis=Vector3.Cross(from,to),dot=Math.max(-1,Math.min(1,Vector3.Dot(from,to)));
 if(axis.lengthSquared()<1e-10)return;
 arm.rotationQuaternion=Quaternion.RotationAxis(axis.normalize(),Math.acos(dot)).multiply(arm.rotationQuaternion).normalize();
 arm.computeWorldMatrix(true);grip.computeWorldMatrix(true);
}
