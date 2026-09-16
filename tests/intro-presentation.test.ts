import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {Scene} from '@babylonjs/core/scene';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {ImportMeshAsync} from '@babylonjs/core/Loading/sceneLoader';
import '@babylonjs/loaders/glTF';
import type {AnimationGroup} from '@babylonjs/core/Animations/animationGroup';
import {CharacterVisual} from '../src/animation/CharacterVisual';
import {PlayerMotor} from '../src/player/PlayerMotor';
import {CollisionWorld} from '../src/physics/CollisionWorld';
import {EventBus} from '../src/core/EventBus';
import {IntroSequence,DECK_TREAD_HEIGHT} from '../src/player/IntroSequence';

const LANDING={x:0,y:0,z:-10},YAW=.3;

async function rig(scene:Scene){
 const visual=new CharacterVisual(scene,()=>{});
 const imported=await ImportMeshAsync(new Uint8Array(readFileSync('public/models/gunslinger.glb')),scene,{pluginExtension:'.glb',pluginOptions:{gltf:{skipMaterials:true}}});
 const clips=(visual as unknown as {clips:Map<string,AnimationGroup>}).clips;
 for(const group of imported.animationGroups){group.stop();clips.set(group.name,group);}
 for(const mesh of imported.meshes)if(!mesh.parent)mesh.parent=visual.root;
 const bones=(visual as unknown as {bones:Map<string,unknown>}).bones as Map<string,unknown>;
 for(const node of imported.transformNodes)bones.set(node.name,node as never);
 visual.ready=true;
 return {visual,imported};
}

/** Ponto mais baixo da superfície já deformada pelo esqueleto. */
function lowest(meshes:{getPositionData(a:boolean,b:boolean):Float32Array|number[]|null;computeWorldMatrix(f:boolean):never}[]):number {
 const point=new Vector3();let minimum=Infinity;
 for(const mesh of meshes){
  const vertices=mesh.getPositionData(true,true);if(!vertices)continue;
  const matrix=mesh.computeWorldMatrix(true);
  for(let i=0;i<vertices.length;i+=3){Vector3.TransformCoordinatesFromFloatsToRef(vertices[i]!,vertices[i+1]!,vertices[i+2]!,matrix as never,point);minimum=Math.min(minimum,point.y);}
 }
 return minimum;
}

it('runs the deck on the real rig with the feet on the plating and the dive still head first',async()=>{
 const engine=new NullEngine(),scene=new Scene(engine);
 const {visual,imported}=await rig(scene);
 try{
  const player=new PlayerMotor(new CollisionWorld(),new EventBus(),LANDING);
  const intro=new IntroSequence();intro.beginStandby();
  for(let i=0;i<30;i++)intro.update(1/60);
  const deckY=intro.deckEdge(LANDING,YAW).y;
  const seen=new Set<string>();let deckFrames=0,diveFrames=0;
  intro.start();
  for(let i=0;i<700&&intro.visible;i++){
   intro.update(1/60);
   const pose=intro.pose(LANDING,YAW);if(!pose)break;
   visual.arrivalPose={sway:pose.roll,rootLift:pose.stride?0:intro.flight.rootLift,height:intro.flight.height,
     recovery:intro.flight.recovery,dive:intro.flight.dive,time:pose.flutterTime,flutter:pose.flutter,
     position:pose.position,stride:pose.stride};
   visual.update(player,1,1/60,false);
   seen.add(pose.phase);
   for(const node of imported.transformNodes)node.computeWorldMatrix(true);
   for(const skeleton of imported.skeletons)skeleton.prepare(true);
   // A raiz desenhada é exatamente a pose da entrada.
   expect(visual.root.position.x).toBeCloseTo(pose.position.x,5);
   expect(visual.root.position.z).toBeCloseTo(pose.position.z,5);
   expect(Number.isFinite(visual.root.rotation.x)&&Number.isFinite(visual.root.rotation.y)).toBe(true);
   if(pose.phase==='run'){
    deckFrames++;
    // Corpo em cima do deck: a sola nunca atravessa a chapa e nada sai flutuando alto.
    // Só o primeiro quadro mistura a partir da pose de espera parada.
    if(i>0){
     const floor=lowest(imported.meshes as never);
     expect(floor,`quadro ${i}`).toBeGreaterThan(deckY-.003);
     expect(floor,`quadro ${i}`).toBeLessThan(deckY+.32);
    }
    expect(visual.root.rotation.y).toBeCloseTo(YAW,5);
   }
   // Mergulho de cabeça: só o balanço do `freefallFlutter` desvia da vertical invertida.
   if(pose.phase==='dive'){diveFrames++;expect(Math.abs(visual.root.rotation.x-Math.PI),`quadro ${i}`).toBeLessThan(.1);}
   // O motor nunca sai do lugar: a entrada é só apresentação.
   expect(player.position).toEqual({x:0,y:0,z:-10});
  }
  expect([...seen]).toEqual(['run','leap','dive','recover']);
  expect(deckFrames).toBeGreaterThan(60);
  expect(diveFrames).toBeGreaterThan(180);
  // Terminada a entrada, o corpo volta ao caminho normal sem resíduo de rotação.
  visual.arrivalPose=undefined;visual.update(player,1,1/60,false);
  expect(visual.root.rotation.x).toBe(0);
  expect(visual.root.rotation.y).toBeCloseTo(player.yaw,3);
 }finally{visual.dispose();scene.dispose();engine.dispose();}
});

it('stands on the plating while the menu waits: no floating feet, no sinking',async()=>{
 const engine=new NullEngine(),scene=new Scene(engine);
 const {visual,imported}=await rig(scene);
 try{
  const player=new PlayerMotor(new CollisionWorld(),new EventBus(),LANDING);
  const intro=new IntroSequence();intro.beginStandby();
  const deckY=intro.deckStart(LANDING,YAW).y;
  // QA do Codex no menu real: "feet floating above deck". A causa era a folga presa a um friso de
  // 8,5 cm; agora o piso caminhável inteiro está a 8 mm da chapa e a sola encosta nele.
  for(let i=0;i<240;i++){
   intro.update(1/60);
   const pose=intro.pose(LANDING,YAW)!;
   expect(pose.phase).toBe('standby');
   visual.arrivalPose={sway:pose.roll,rootLift:0,height:intro.flight.height,recovery:0,dive:0,
     time:pose.flutterTime,flutter:pose.flutter,position:pose.position,stride:pose.stride};
   visual.update(player,1,1/60,false);
   // Os primeiros quadros ainda misturam a partir da pose de bind; no jogo isso acontece no
   // carregamento, muito antes de alguém ver o menu.
   if(i<15)continue;
   for(const node of imported.transformNodes)node.computeWorldMatrix(true);
   for(const skeleton of imported.skeletons)skeleton.prepare(true);
   const floor=lowest(imported.meshes as never)-deckY;
   expect(floor,`quadro ${i}`).toBeGreaterThan(-.002);
   expect(floor,`quadro ${i}`).toBeLessThan(DECK_TREAD_HEIGHT+.006);
  }
 }finally{visual.dispose();scene.dispose();engine.dispose();}
});

it('lands on the ground and never below it while the body recovers and stands up',async()=>{
 const engine=new NullEngine(),scene=new Scene(engine);
 const {visual,imported}=await rig(scene);
 try{
  const player=new PlayerMotor(new CollisionWorld(),new EventBus(),LANDING);
  const intro=new IntroSequence();intro.beginStandby();intro.start();
  let landed=false,head=0;
  for(let i=0;i<900&&intro.visible;i++){
   intro.update(1/60);
   const pose=intro.pose(LANDING,YAW);if(!pose)break;
   visual.arrivalPose={sway:pose.roll,rootLift:pose.stride?0:intro.flight.rootLift,height:intro.flight.height,
     recovery:intro.flight.recovery,dive:intro.flight.dive,time:pose.flutterTime,flutter:pose.flutter,
     position:pose.position,stride:pose.stride};
   visual.update(player,1,1/60,false);
   if(pose.phase!=='recover')continue;
   landed=true;
   for(const node of imported.transformNodes)node.computeWorldMatrix(true);
   for(const skeleton of imported.skeletons)skeleton.prepare(true);
   expect(lowest(imported.meshes as never),`recuperação ${intro.flight.recovery.toFixed(2)}`).toBeGreaterThan(LANDING.y-.01);
   const node=imported.transformNodes.find(n=>n.name==='Head')!;node.computeWorldMatrix(true);
   head=node.getAbsolutePosition().y;
  }
  expect(landed).toBe(true);
  // O corpo termina de pé, não deitado: a cabeça volta à altura de caminhada.
  expect(head).toBeGreaterThan(LANDING.y+1.3);
 }finally{visual.dispose();scene.dispose();engine.dispose();}
});

it('does not drift the root yaw when an additive layer adds rotation on top of the damper',async()=>{
 const engine=new NullEngine(),scene=new Scene(engine);
 const {visual}=await rig(scene);
 try{
  const player=new PlayerMotor(new CollisionWorld(),new EventBus(),LANDING);
  player.yaw=.4;
  for(let i=0;i<60;i++)visual.update(player,1,1/60,false);
  expect(visual.root.rotation.y).toBeCloseTo(.4,3);
  // Camada aditiva constante: o desvio é o da pose, NÃO `pose/k` acumulado pelo amortecedor.
  visual.meleePose={stepId:'left-hook',phase:'active',progress:.5,heavy:false};
  const offsets:number[]=[];
  for(let i=0;i<120;i++){visual.update(player,1,1/60,true);offsets.push(visual.root.rotation.y-.4);}
  expect(Math.max(...offsets)).toBeLessThan(.3);
  expect(Math.abs(offsets.at(-1)!-offsets[20]!)).toBeLessThan(.02);
  // E a mesma pose a 120 Hz dá o mesmo desvio: sem dependência de taxa de quadros.
  visual.meleePose=undefined;
  for(let i=0;i<60;i++)visual.update(player,1,1/60,false);
  visual.meleePose={stepId:'left-hook',phase:'active',progress:.5,heavy:false};
  const quick:number[]=[];
  for(let i=0;i<240;i++){visual.update(player,1,1/120,true);quick.push(visual.root.rotation.y-.4);}
  expect(Math.abs(quick.at(-1)!-offsets.at(-1)!)).toBeLessThan(.03);
 }finally{visual.dispose();scene.dispose();engine.dispose();}
});
