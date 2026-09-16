/** Procedural life layered over the single-frame ArrivalDive pose: wind buffeting, alternating kicks, a wandering gaze and body roll.
 * Angles in radians around root-space axes (0 = x/right, 1 = y/up, 2 = z/forward). Pure and bounded so the menu and descent share it. */
export interface FlutterBend {bone:string;axis:0|1|2;angle:number}
export interface Flutter {roll:number;yaw:number;pitch:number;bends:FlutterBend[]}
const wind=(t:number,seed:number)=>.6*Math.sin(7.3*t+seed)+.4*Math.sin(11.9*t+seed*1.7);
export function freefallFlutter(t:number,weight:number):Flutter {
 const w=Math.max(0,Math.min(1,Number.isFinite(weight)?weight:0)),s=Number.isFinite(t)?t:0,sin=Math.sin;
 const bends:FlutterBend[]=[
  {bone:'Spine01',axis:0,angle:.07*sin(1.6*s)},{bone:'Spine01',axis:1,angle:.06*sin(.9*s+1)},
  {bone:'neck',axis:1,angle:.22*sin(.6*s)},{bone:'neck',axis:0,angle:.1*sin(.8*s+2)},{bone:'Head',axis:1,angle:.12*sin(.6*s-.5)},
 ];
 for(const [side,sign,phase] of [['Left',-1,0],['Right',1,Math.PI]] as const){
  bends.push(
   {bone:side+'Arm',axis:2,angle:sign*(.2*sin(2.1*s+phase*.6)+.05*wind(s,phase))},
   {bone:side+'Arm',axis:0,angle:.12*sin(1.4*s+phase)},
   {bone:side+'ForeArm',axis:0,angle:.15*sin(1.7*s+phase+.7)+.04*wind(s,phase+2)},
   {bone:side+'UpLeg',axis:0,angle:.24*sin(1.8*s+phase)},
   {bone:side+'Leg',axis:0,angle:.28*(.5+.5*sin(1.8*s+phase+.9))},
   {bone:side+'Foot',axis:0,angle:.15*sin(1.8*s+phase+1.6)},
  );
 }
 for(const bend of bends)bend.angle*=w;
 return {roll:w*(.09*sin(1.3*s)+.035*sin(3.1*s+1)),yaw:w*.14*sin(.55*s+.4),pitch:w*.05*sin(1.05*s+2),bends};
}
