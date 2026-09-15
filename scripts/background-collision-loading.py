from pathlib import Path
p=Path('src/physics/StaticRayIndex.ts');s=p.read_text(encoding='utf-8');s=s.replace('interface Node {', 'interface PackedNode {min:number[];max:number[];start:number;end:number;left?:PackedNode;right?:PackedNode}\nexport interface RayIndexSnapshot {faces:number[];root:PackedNode}\ninterface Node {')
s=s.replace('private readonly indices:readonly number[]){', 'private readonly indices:readonly number[],snapshot?:RayIndexSnapshot){')
s=s.replace('this.faces=Array.from({length:indices.length/3},(_,i)=>i);this.root=this.build(0,this.faces.length);', "this.faces=snapshot?.faces??Array.from({length:indices.length/3},(_,i)=>i);const unpack=(n:PackedNode):Node=>({min:Vector3.FromArray(n.min),max:Vector3.FromArray(n.max),start:n.start,end:n.end,...(n.left?{left:unpack(n.left)}:{}),...(n.right?{right:unpack(n.right)}:{})});this.root=snapshot?unpack(snapshot.root):this.build(0,this.faces.length);")
s=s.replace(' private build(start:number', " snapshot():RayIndexSnapshot{const pack=(n:Node):PackedNode=>({min:n.min.asArray(),max:n.max.asArray(),start:n.start,end:n.end,...(n.left?{left:pack(n.left)}:{}),...(n.right?{right:pack(n.right)}:{})});return{faces:this.faces,root:pack(this.root)};}\n private build(start:number")
p.write_text(s,encoding='utf-8')
p=Path('src/physics/CollisionWorld.ts');s=p.read_text(encoding='utf-8').replace("import {StaticRayIndex}","import {StaticRayIndex,type RayIndexSnapshot}")
pos=s.index('  prepareRaycasts():');s=s[:pos]+'''  async prepareRaycastsAsync():Promise<void>{
    if(!this.geometry||this.rays)return;if(typeof Worker==='undefined'){this.prepareRaycasts();return;}
    const geometry=this.geometry,worker=new Worker(new URL('../workers/collision-index.worker.ts',import.meta.url),{type:'module'});
    try{const snapshot=await new Promise<RayIndexSnapshot>((resolve,reject)=>{worker.onmessage=(e:MessageEvent<{snapshot?:RayIndexSnapshot;error?:string}>)=>e.data.snapshot?resolve(e.data.snapshot):reject(Error(e.data.error));worker.onerror=e=>reject(Error(e.message));worker.postMessage(geometry);});if(this.geometry===geometry)this.rays=new StaticRayIndex(geometry.positions,geometry.indices,snapshot);}finally{worker.terminate();}
  }
''' +s[pos:];p.write_text(s,encoding='utf-8')
p=Path('src/world/FarmWorld.ts');s=p.read_text(encoding='utf-8').replace('this.collision.prepareRaycasts();','await this.collision.prepareRaycastsAsync();if(this.disposed)return;');p.write_text(s,encoding='utf-8')
p=Path('src/game/PlayerScene.ts');s=p.read_text(encoding='utf-8').replace('    if(this.cinematic.preparing)this.camera.skillClose', "    if(this.arrival.active){const w=1-this.arrival.recovery,origin=this.visual.position,forward=new Vector3(Math.sin(this.input.yaw),0,Math.cos(this.input.yaw)),wanted=origin.subtract(forward.scale(5.5)).addInPlaceFromFloats(0,2.4,0);this.camera.camera.position.copyFrom(Vector3.Lerp(this.camera.camera.position,wanted,w));this.camera.camera.setTarget(origin.add(new Vector3(0,1+Math.min(8,this.arrival.height)*.4,0)));}\n    if(this.cinematic.preparing)this.camera.skillClose")
p.write_text(s,encoding='utf-8')
