import {LoadAssetContainerAsync} from '@babylonjs/core/Loading/sceneLoader';
import type {AssetContainer} from '@babylonjs/core/assetContainer';
import {TransformNode} from '@babylonjs/core/Meshes/transformNode';
import type {Scene} from '@babylonjs/core/scene';
import type {CollisionWorld} from '../physics/CollisionWorld';
import type {PlayerMotor} from '../player/PlayerMotor';
import {IslandFerry} from './IslandFerry';
export class AlienWorld {
 private container:AssetContainer|undefined;private readonly roots:TransformNode[]=[];private readonly decoration:{root:TransformNode;x:number;y:number;z:number;phase:number;saucer:boolean}[]=[];
 ferry:IslandFerry|undefined;private ferryRoot:TransformNode|undefined;private time=0;private disposed=false;private readonly label:HTMLDivElement|undefined;
 constructor(private readonly scene:Scene,private readonly collision:CollisionWorld){if(typeof document!=='undefined'){this.label=document.createElement('div');this.label.className='island-ferry-hint';this.label.hidden=true;document.body.append(this.label);}}
 async load():Promise<void>{
  const container=await LoadAssetContainerAsync('/models/alien-world.glb',this.scene);if(this.disposed){container.dispose();return;}this.container=container;
  const instance=(kind:'AlienIslet'|'FruitSaucer')=>{const group=container.instantiateModelsToScene(n=>'living-'+this.roots.length+'-'+n,false,{doNotInstantiate:true}),root=new TransformNode('living-world-'+this.roots.length,this.scene);for(const node of group.rootNodes)node.parent=root;for(const node of root.getChildTransformNodes())if(node.name.endsWith('AlienIslet')||node.name.endsWith('FruitSaucer'))node.setEnabled(node.name.endsWith(kind));for(const mesh of root.getChildMeshes()){mesh.isPickable=false;mesh.receiveShadows=true;}this.roots.push(root);return root;};
  this.ferry=new IslandFerry(this.collision);this.ferryRoot=instance('AlienIslet');this.ferryRoot.position.copyFrom(this.ferry.position);
  for(const [i,p] of [[-30,26,48],[44,31,61]].entries()){const root=instance('FruitSaucer');root.scaling.setAll(1.5);this.decoration.push({root,x:p[0]!,y:p[1]!,z:p[2]!,phase:i*3,saucer:true});}
  this.update(0);
 }
 fixedUpdate(dt:number,player:PlayerMotor):void {this.ferry?.update(dt,player);if(this.ferryRoot&&this.ferry)this.ferryRoot.position.copyFrom(this.ferry.position);if(this.label&&this.ferry){this.label.hidden=Math.hypot(player.position.x-this.ferry.position.x,player.position.z+8)>13;const phase=this.ferry.time%18;this.label.textContent=this.ferry.dock>=0?`ILHA ALINHADA · embarque (${Math.ceil(this.ferry.dock===0?3-phase:12-phase)} s)`:'ILHA À DERIVA · travessia entre fazendas';}}
 update(dt:number):void {this.time+=dt;for(const d of this.decoration){const t=this.time*(d.saucer?.14:.09)+d.phase;d.root.position.set(d.x+Math.sin(t)*(d.saucer?9:1.8),d.y+Math.sin(t*.7)*(d.saucer?1.8:.65),d.z+Math.cos(t)*(d.saucer?5:1.2));d.root.rotation.set(d.saucer?Math.sin(t)*.08:0,t*(d.saucer?.6:.07),d.saucer?Math.cos(t)*.10:0);}}
 dispose():void {this.disposed=true;this.ferry?.dispose();this.label?.remove();for(const root of this.roots)root.dispose();this.container?.dispose();}
}
