import {Quaternion,Vector3} from '@babylonjs/core/Maths/math.vector';
import type {AnimationGroup} from '@babylonjs/core/Animations/animationGroup';
import type {TransformNode} from '@babylonjs/core/Meshes/transformNode';
interface Pose {rotation:Quaternion|undefined;position:Vector3;scale:Vector3}
/** Explicit animation states with a frozen outgoing pose and finite transition duration. */
export class AnimationStateMachine {
  state='';private fade=1;private readonly outgoing=new Map<TransformNode,Pose>();
  constructor(private readonly clips:Map<string,AnimationGroup>,private readonly transition=.16){}
  sample(state:string,progress:number,dt:number,filter:(name:string)=>boolean=()=>true,clipName=state):void {
    const clip=this.clips.get(clipName);if(!clip)return;
    if(state!==this.state){this.state=state;this.fade=0;this.outgoing.clear();for(const group of this.clips.values())for(const track of group.targetedAnimations){const node=track.target as TransformNode;if(!this.outgoing.has(node))this.outgoing.set(node,{rotation:node.rotationQuaternion?.clone(),position:node.position.clone(),scale:node.scaling.clone()});}}
    this.fade=Math.min(1,this.fade+dt/this.transition);const blend=this.fade*this.fade*(3-2*this.fade),frame=clip.from+(clip.to-clip.from)*Math.max(0,Math.min(1,progress));
    for(const track of clip.targetedAnimations){const node=track.target as TransformNode;if(!filter(node.name))continue;const value:unknown=track.animation.evaluate(frame),previous=this.outgoing.get(node);
      if(value instanceof Quaternion&&track.animation.targetProperty==='rotationQuaternion'){node.rotationQuaternion??=Quaternion.Identity();Quaternion.SlerpToRef(previous?.rotation??value,value,blend,node.rotationQuaternion);}
      else if(value instanceof Vector3&&track.animation.targetProperty==='position')Vector3.LerpToRef(previous?.position??value,value,blend,node.position);
      else if(value instanceof Vector3&&track.animation.targetProperty==='scaling')Vector3.LerpToRef(previous?.scale??value,value,blend,node.scaling);
    }
  }
  reset():void{this.state='';this.fade=1;this.outgoing.clear();}
}
