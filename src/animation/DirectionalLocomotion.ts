export function directionalLocomotion(vx:number,vz:number,yaw:number):{primary:string;secondary:string;weight:number} {
 const x=vx*Math.cos(yaw)-vz*Math.sin(yaw),z=vx*Math.sin(yaw)+vz*Math.cos(yaw),speed=Math.hypot(x,z),run=speed>4;
 if(speed<.5)return{primary:'Idle',secondary:'Idle',weight:0};
 const side=x<0?(run?'RunStrafeLeft':'StrafeLeft'):(run?'RunStrafeRight':'StrafeRight'),long=z<0?(run?'RunBackward':'WalkBackward'):(run?'Run':'Walk'),total=Math.abs(x)+Math.abs(z);
 return Math.abs(x)>Math.abs(z)?{primary:side,secondary:long,weight:Math.abs(z)/total}:{primary:long,secondary:side,weight:Math.abs(x)/total};
}
