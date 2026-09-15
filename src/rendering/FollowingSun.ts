import {Vector3} from '@babylonjs/core/Maths/math.vector';
import type {DirectionalLight} from '@babylonjs/core/Lights/directionalLight';
import type {Vec3} from '../core/contracts';
/** A fixed-size shadow volume follows exploration; snapping in light space stabilizes texels. */
export function followSun(light:DirectionalLight,focus:Vec3,resolution:number):void{
 const direction=light.direction.normalizeToNew(),right=Vector3.Cross(Vector3.Up(),direction).normalize(),up=Vector3.Cross(direction,right).normalize();
 const center=new Vector3(focus.x,focus.y,focus.z),texel=light.shadowFrustumSize/Math.max(1,resolution);
 const x=Math.round(Vector3.Dot(center,right)/texel)*texel,y=Math.round(Vector3.Dot(center,up)/texel)*texel,z=Vector3.Dot(center,direction);
 light.position.copyFrom(right.scale(x).addInPlace(up.scale(y)).addInPlace(direction.scale(z-80)));
}
