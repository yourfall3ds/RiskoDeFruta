import {Matrix,Quaternion,Vector3} from '@babylonjs/core/Maths/math.vector';
import type {TransformNode} from '@babylonjs/core/Meshes/transformNode';
import {aimArmAt} from './AimArm';
function rotateSegment(joint:TransformNode,child:TransformNode,worldDirection:Vector3):void {
 if(!joint.parent||!joint.rotationQuaternion)return;const inverse=Matrix.Invert(joint.parent.computeWorldMatrix(true));
 const from=Vector3.TransformNormal(child.getAbsolutePosition().subtract(joint.getAbsolutePosition()),inverse).normalize(),to=Vector3.TransformNormal(worldDirection,inverse).normalize(),axis=Vector3.Cross(from,to);
 if(axis.lengthSquared()<1e-10)return;joint.rotationQuaternion=Quaternion.RotationAxis(axis.normalize(),Math.acos(Math.max(-1,Math.min(1,Vector3.Dot(from,to))))).multiply(joint.rotationQuaternion).normalize();joint.computeWorldMatrix(true);child.computeWorldMatrix(true);
}
/** Two-bone arm pose with a stable elbow pole. Hand orientation is independent of wrist placement. */
export function poseAkimbo(arm:TransformNode,forearm:TransformNode,hand:TransformNode,grip:TransformNode,wrist:Vector3,pole:Vector3,aim:Vector3):void {
 arm.computeWorldMatrix(true);forearm.computeWorldMatrix(true);hand.computeWorldMatrix(true);
 const shoulder=arm.getAbsolutePosition().clone(),upper=Vector3.Distance(shoulder,forearm.getAbsolutePosition()),lower=Vector3.Distance(forearm.getAbsolutePosition(),hand.getAbsolutePosition()),delta=wrist.subtract(shoulder),distance=Math.max(Math.abs(upper-lower)+.001,Math.min(upper+lower-.001,delta.length())),direction=delta.normalize();
 const along=(upper*upper-lower*lower+distance*distance)/(2*distance),height=Math.sqrt(Math.max(0,upper*upper-along*along)),bend=pole.subtract(shoulder);bend.subtractInPlace(direction.scale(Vector3.Dot(bend,direction))).normalize();
 const elbow=shoulder.add(direction.scale(along)).addInPlace(bend.scale(height));rotateSegment(arm,forearm,elbow.subtract(shoulder));hand.computeWorldMatrix(true);rotateSegment(forearm,hand,shoulder.add(direction.scale(distance)).subtract(forearm.getAbsolutePosition()));aimArmAt(hand,grip,aim.subtract(hand.getAbsolutePosition()).normalize());
}
