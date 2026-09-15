import {readFileSync,writeFileSync,appendFileSync} from 'node:fs';const edit=(p,a,b)=>{let s=readFileSync(p,'utf8');if(!s.includes(a))throw Error(p+' missing '+a.slice(0,35));writeFileSync(p,s.replace(a,b));};
edit('src/world/FarmWorld.ts',"import { Waterfalls }", "import {AlienWorld} from './AlienWorld';\nimport type {PlayerMotor} from '../player/PlayerMotor';\nimport { Waterfalls }");
edit('src/world/FarmWorld.ts','private waterfalls:Waterfalls|undefined;', 'private waterfalls:Waterfalls|undefined;private alien:AlienWorld|undefined;');
edit('src/world/FarmWorld.ts','this.waterfalls=new Waterfalls(this.scene);this.ready=true;', 'this.waterfalls=new Waterfalls(this.scene);this.alien=new AlienWorld(this.scene,this.collision);await this.alien.load();this.ready=true;');
edit('src/world/FarmWorld.ts','update(dt:number):void {this.waterfalls?.update(dt);}', 'fixedUpdate(dt:number,player:PlayerMotor):void {this.alien?.fixedUpdate(dt,player);}\n  update(dt:number):void {this.waterfalls?.update(dt);this.alien?.update(dt);}');
edit('src/world/FarmWorld.ts','dispose():void {this.disposed=true;}','dispose():void {this.disposed=true;this.alien?.dispose();}');
edit('src/game/PlayerScene.ts','this.player.fixedUpdate(dt,input,this.input.yaw);','if(this.yard instanceof FarmWorld)this.yard.fixedUpdate(dt,this.player);\n    this.player.fixedUpdate(dt,input,this.input.yaw);');
edit('src/physics/CollisionWorld.ts','for(const b of this.nearbyBoxes(x,z,0)) {','for(const b of this.nearbyBoxes(x,z,0)) {\n      if(b.id.startsWith("moving-"))continue;');
appendFileSync('src/style.css','\n.island-ferry-hint{position:fixed;bottom:22%;left:50%;transform:translateX(-50%);padding:10px 18px;border:1px solid #ade49488;background:#071822dd;color:#ddf5bc;font:bold 13px system-ui;pointer-events:none;z-index:5;border-radius:5px;}\n');
edit('scripts/build-alien-world.py',"bpy.ops.wm.save_as_mainfile",`# Batch decorative parts by material without changing their local parent transforms.
for parent in [islet,ufo]:
 for material in [rock,soil,metal,glow,green]:
  objects=[o for o in scene.objects if o.type=='MESH' and o.parent==parent and len(o.data.materials)==1 and o.data.materials[0]==material]
  if len(objects)>1:
   bpy.ops.object.select_all(action='DESELECT')
   for o in objects:o.select_set(True)
   bpy.context.view_layer.objects.active=objects[0];bpy.ops.object.join()
bpy.ops.wm.save_as_mainfile`);
