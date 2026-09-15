import { ImportMeshAsync } from '@babylonjs/core/Loading/sceneLoader';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Vector3,Quaternion } from '@babylonjs/core/Maths/math.vector';
import type { Scene } from '@babylonjs/core/scene';
import type { AnimationGroup } from '@babylonjs/core/Animations/animationGroup';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import type { EventBus } from '../core/EventBus';
import type { GameEvents } from '../core/contracts';
import type { TrainingYard,TrainingTarget } from '../world/TrainingYard';
import { Health } from '../combat/Health';

interface Specimen {name:string;root:TransformNode;target:TrainingTarget;health:Health;clips:Map<string,AnimationGroup>;action:string;time:number}
/** Textured, damageable specimens for art/combat review, not the species AI framework. */
export class EnemyReview {
  private readonly specimens:Specimen[]=[];
  private disposed=false;
  kills=0;
  error='';
  constructor(private readonly scene:Scene,private readonly yard:Pick<TrainingYard,'targets'>,private readonly events:EventBus<GameEvents>,private readonly shadows:ShadowGenerator){}
  async load():Promise<void> {
    for(const [index,name] of ['carrot','corn','eggplant','tomato','watermelon'].entries()) {
      if(this.disposed)return;
      try {
        const imported=await ImportMeshAsync(`/models/original-${name}.glb`,this.scene);
        if(this.disposed){for(const mesh of imported.meshes)mesh.dispose();return;}
        const root=new TransformNode(`specimen-${name}`,this.scene);root.position.set((index-1)*3,0,4+index%2*4);root.rotation.y=Math.PI;
        for(const mesh of imported.meshes){if(!mesh.parent)mesh.parent=root;mesh.isPickable=false;mesh.receiveShadows=true;if(mesh.getTotalVertices()>0)this.shadows.addShadowCaster(mesh);}
        const body=imported.meshes.find(mesh=>mesh.getTotalVertices()>0) as Mesh | undefined;if(!body)throw new Error(`Sem malha: ${name}`);
        body.isPickable=true;const id=100+index;const health=new Health(id,96,this.events);
        const target:TrainingTarget={id,mesh:body,hits:0};
        const clips=new Map(imported.animationGroups.map(group=>{group.stop();return [group.name,group] as const;}));
        const specimen:Specimen={name,root,target,health,clips,action:'Walk',time:0};
        target.onHit=context=>{if(!health.apply(context))return;specimen.action=health.dead?'Death':'Hit';specimen.time=0;if(health.dead){body.isPickable=false;this.kills++;}};
        this.specimens.push(specimen);this.yard.targets.push(target);
      }catch(error){if(!this.disposed)this.error=error instanceof Error?error.message:'Falha nos inimigos';}
    }
  }
  update(dt:number):void {
    for(const specimen of this.specimens) {
      specimen.time+=dt;
      if(specimen.health.dead&&specimen.time>=8){specimen.health.reset();specimen.target.mesh.isPickable=true;specimen.action='Walk';specimen.time=0;}
      const clip=specimen.clips.get(specimen.action);if(!clip)continue;
      const duration=Math.max(.01,(clip.to-clip.from)/60);
      const progress=specimen.action==='Walk'?.12:Math.min(1,specimen.time/duration);
      const frame=clip.from+(clip.to-clip.from)*progress;
      for(const track of clip.targetedAnimations){const node=track.target as TransformNode;const value:unknown=track.animation.evaluate(frame);
        if(track.animation.targetProperty==='rotationQuaternion'&&value instanceof Quaternion)node.rotationQuaternion=value.clone();
        else if(track.animation.targetProperty==='position'&&value instanceof Vector3)node.position.copyFrom(value);
      }
      if(specimen.action==='Hit'&&specimen.time>=duration){specimen.action='Walk';specimen.time=0;}
      specimen.root.computeWorldMatrix(true);
    }
  }
  get count():number{return this.specimens.length;}
  get status():string{return this.specimens.map(s=>`${s.name}: ${Math.ceil(s.health.current)}/96`).join(' · ');}
  dispose():void {this.disposed=true;for(const specimen of this.specimens){const index=this.yard.targets.indexOf(specimen.target);if(index>=0)this.yard.targets.splice(index,1);for(const clip of specimen.clips.values())clip.dispose();specimen.root.dispose();}this.specimens.length=0;}
}
