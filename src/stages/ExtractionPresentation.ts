import type {Vec3} from '../core/contracts';
import type {JourneyPhase} from './StageJourney';
import {deckClearance} from '../player/IntroSequence';

const clamp=(n:number)=>Math.max(0,Math.min(1,n));
const smooth=(n:number)=>{const p=clamp(n);return p*p*(3-2*p);};

/** Boarding choreography, using the real deck and recorded locomotion; physics stays paused. */
export function extractionPresentation(phase:JourneyPhase,clock:number,origin:Vec3,yaw:number){
 if(phase!=='board'&&phase!=='travel')return undefined;
 const t=phase==='travel'?2.4:Math.max(0,clock),forward={x:Math.sin(yaw),z:Math.cos(yaw)},right={x:Math.cos(yaw),z:-Math.sin(yaw)};
 const lift=phase==='travel'?4+Math.min(100,Math.max(0,clock)*8):4*smooth((t-1.85)/.55);
 const height=1.6+22*(1-smooth(t/.55))+lift;
 const edge={x:origin.x+forward.x*3.8,y:origin.y+height,z:origin.z+forward.z*3.8};
 let distance=0,y=origin.y,clip='Idle',progress=(t*.34)%1;
 if(t>.55&&t<1.15){distance=3.3*(t-.55)/.6;clip='Run';progress=((t-.55)*2.1)%1;}
 else if(t>=1.15&&t<1.85){
  const p=(t-1.15)/.7;distance=3.3+2.9*p;y=origin.y+(1.6+deckClearance('Idle'))*smooth(p)+2*Math.sin(Math.PI*p);
  clip='Jump';progress=.15+.7*p;
 }else if(t>=1.85){distance=6.2;y=edge.y+deckClearance('Idle');}
 const body={x:origin.x+forward.x*distance,y,z:origin.z+forward.z*distance};
 const target={x:origin.x+forward.x*4,y:body.y+1.2,z:origin.z+forward.z*4};
 return {edge,shipYaw:yaw+Math.PI,body,clip,progress,
  camera:{x:target.x+right.x*9-forward.x*5,y:target.y+3,z:target.z+right.z*9-forward.z*5},target,
 };
}
