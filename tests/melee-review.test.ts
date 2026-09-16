import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {Scene} from '@babylonjs/core/scene';
import {Quaternion} from '@babylonjs/core/Maths/math.vector';
import {ImportMeshAsync} from '@babylonjs/core/Loading/sceneLoader';
import '@babylonjs/loaders/glTF';
import type {AnimationGroup} from '@babylonjs/core/Animations/animationGroup';
import {MeleeReview,meleeReviewShot,MELEE_REVIEW_RATES} from '../src/animation/MeleeReview';
import {MELEE_CLIPS} from '../src/animation/MeleeClips';
import {MELEE_TUNING} from '../src/player/PlayerTuning';
import {CharacterVisual} from '../src/animation/CharacterVisual';
import {PlayerMotor} from '../src/player/PlayerMotor';
import {CollisionWorld} from '../src/physics/CollisionWorld';
import {EventBus} from '../src/core/EventBus';

const STEPS=MELEE_TUNING.steps.map(s=>s.id);

it('cycles the whole combo slowly and reports where the review is',()=>{
 const review=new MeleeReview();
 review.enter();
 expect(review.active).toBe(true);
 expect(review.rate).toBe(MELEE_REVIEW_RATES[0]);
 expect(review.pose.stepId).toBe(STEPS[0]);
 const seen=new Set<string>();const phases=new Set<string>();
 for(let i=0;i<60*400&&review.loops<1;i++){review.update(1/60);seen.add(review.pose.stepId);phases.add(review.pose.phase);}
 // Todas as cinco etapas e as três fases aparecem numa volta.
 expect([...seen].sort()).toEqual([...STEPS].sort());
 expect([...phases].sort()).toEqual(['active','recover','windup']);
 expect(review.loops).toBe(1);
 expect(review.label).toContain('do ritmo');
});

it('holds the contact pose and steps frame by frame without the clock running away',()=>{
 const review=new MeleeReview();review.enter();
 for(const [index,id] of STEPS.entries()){
  review.select(index);
  review.holdContact();
  const pose=review.pose;
  expect(pose.stepId).toBe(id);
  // Contato = início da janela ativa, que é onde a pose autoral chega ao pico.
  expect(pose.phase).toBe('active');
  expect(pose.progress).toBeLessThan(.05);
  for(let i=0;i<120;i++)review.update(1/60);
  expect(review.pose).toEqual(pose);
  expect(review.label).toContain('CONGELADO');
 }
 review.select(2);review.holdContact();
 const before=review.pose.progress;
 review.nudge(.02);
 expect(review.pose.progress).toBeGreaterThan(before);
 for(let i=0;i<200;i++)review.nudge(.02);
 expect(review.pose.progress).toBeLessThanOrEqual(1);
 for(let i=0;i<400;i++)review.nudge(-.02);
 expect(review.clock).toBe(0);
 expect(review.pose.phase).toBe('windup');
 review.play();
 expect(review.frozen).toBe(false);
});

it('walks the combo in both directions and cycles the rate back to the slowest',()=>{
 const review=new MeleeReview();review.enter();
 review.previous();expect(review.pose.stepId).toBe(STEPS.at(-1));
 review.next();expect(review.pose.stepId).toBe(STEPS[0]);
 for(let i=0;i<MELEE_REVIEW_RATES.length;i++)review.cycleRate();
 expect(review.rate).toBe(MELEE_REVIEW_RATES[0]);
 // A etapa pesada é o giro final — é ela que autoriza a lentidão de finalização no jogo.
 review.select(STEPS.indexOf('spin-kick'));
 expect(review.pose.heavy).toBe(true);
 review.select(0);expect(review.pose.heavy).toBe(false);
 review.exit();
 expect(review.active).toBe(false);expect(review.frozen).toBe(false);expect(review.clock).toBe(0);expect(review.stepIndex).toBe(0);
});

it('frames the whole body instead of a close-up',()=>{
 const shot=meleeReviewShot({x:10,y:4,z:-3},1.2);
 const distance=Math.hypot(shot.position.x-10,shot.position.z+3);
 expect(distance).toBeGreaterThan(3.5);
 expect(distance).toBeLessThan(6);
 // Câmera acima do quadril e alvo no peito: pés e punhos cabem no enquadramento.
 expect(shot.position.y).toBeGreaterThan(4+1);
 expect(shot.target).toEqual({x:10,y:4.95,z:-3});
});

it('writes every melee bone on the real rig and never accumulates rotation on the arms',async()=>{
 const engine=new NullEngine(),scene=new Scene(engine);
 const visual=new CharacterVisual(scene,()=>{});
 try{
  const imported=await ImportMeshAsync(new Uint8Array(readFileSync('public/models/gunslinger.glb')),scene,{pluginExtension:'.glb',pluginOptions:{gltf:{skipMaterials:true}}});
  const clips=(visual as unknown as {clips:Map<string,AnimationGroup>}).clips;
  for(const group of imported.animationGroups){group.stop();clips.set(group.name,group);}
  for(const mesh of imported.meshes)if(!mesh.parent)mesh.parent=visual.root;
  const bones=(visual as unknown as {bones:Map<string,unknown>}).bones as Map<string,unknown>;
  for(const node of imported.transformNodes)bones.set(node.name,node as never);
  visual.ready=true;

  const named=new Map(imported.transformNodes.map(n=>[n.name,n]));
  const referenced=new Set(Object.values(MELEE_CLIPS).flatMap(spec=>clips.get(spec.clip)!.targetedAnimations.map(t=>(t.target as {name:string}).name)));
  // Todo osso citado pelas poses existe no rig…
  for(const bone of referenced)expect(named.has(bone),`osso ${bone}`).toBe(true);
  // …e é reescrito pelo clipe de locomoção, que é a base da camada aditiva.
  const idle=new Set(clips.get('Idle')!.targetedAnimations.map(t=>(t.target as {name:string}).name));
  for(const bone of referenced)expect(idle.has(bone),`clipe Idle cobre ${bone}`).toBe(true);

  const player=new PlayerMotor(new CollisionWorld(),new EventBus(),{x:0,y:0,z:0});
  const review=new MeleeReview();review.enter();
  const arm=named.get('RightArm')!,fore=named.get('LeftForeArm')!,leg=named.get('RightUpLeg')!,hip=named.get('Hips')!;
  // `aiming` ligado é o caso que quebrava: o filtro de mira tirava braço/antebraço do clipe e a
  // camada aditiva multiplicava a MESMA junta quadro após quadro.
  review.select(STEPS.indexOf('right-cross'));review.holdContact();
  const frozen=(aiming:boolean):Quaternion[]=>{
   visual.resetAttempt();visual.meleePose=review.pose;
   const out:Quaternion[]=[];
   for(let i=0;i<180;i++){visual.update(player,1,1/60,aiming);out.push(arm.rotationQuaternion!.clone());}
   return out;
  };
  const aimed=frozen(true),free=frozen(false);
  const angle=(a:Quaternion,b:Quaternion)=>2*Math.acos(Math.min(1,Math.abs(Quaternion.Dot(a,b))));
  // Mirando ou não, a MESMA pose congelada dá a mesma rotação: o filtro de mira deixou de mudar
  // o resultado do golpe. Com a acumulação, o caminho “mirando” divergia por radianos.
  expect(angle(aimed.at(-1)!,free.at(-1)!)).toBeLessThan(.02);
  // E a rotação não cresce com o tempo: a variação residual é só a respiração do clipe.
  expect(angle(aimed[90]!,aimed.at(-1)!)).toBeLessThan(.1);
  expect(angle(aimed[30]!,aimed[90]!)).toBeLessThan(.1);
  for(const q of aimed)expect(2*Math.acos(Math.min(1,Math.abs(q.w)))).toBeLessThan(Math.PI);

  // O combo inteiro move quadril, tronco, braços E pernas — nada de perna ignorada.
  const moved=new Map<string,number>();
  const start=new Map([['RightArm',arm],['LeftForeArm',fore],['RightUpLeg',leg],['Hips',hip]].map(([n,node])=>[n as string,(node as typeof arm).rotationQuaternion!.clone()]));
  review.play();
  for(let i=0;i<60*120&&review.loops<1;i++){
   review.update(1/60);visual.meleePose=review.pose;visual.update(player,1,1/60,true);
   for(const [name,node] of [['RightArm',arm],['LeftForeArm',fore],['RightUpLeg',leg],['Hips',hip]] as const){
    const angle=2*Math.acos(Math.min(1,Math.abs(Quaternion.Dot(start.get(name)!,node.rotationQuaternion!))));
    moved.set(name,Math.max(moved.get(name)??0,angle));
    expect(Number.isFinite(node.rotationQuaternion!.w)).toBe(true);
   }
  }
  for(const [name,angle] of moved)expect(angle,`${name} se moveu ${angle.toFixed(3)} rad`).toBeGreaterThan(.12);
  // Nenhuma junta passa de 180°, que é o sintoma clássico do empilhamento.
  for(const [name,angle] of moved)expect(angle,`${name}`).toBeLessThan(Math.PI);

  // Saída limpa: sem pose, o clipe volta a mandar sozinho.
  visual.meleePose=undefined;review.exit();
  for(let i=0;i<30;i++)visual.update(player,1,1/60,false);
  const settled=arm.rotationQuaternion!.clone();
  for(let i=0;i<30;i++)visual.update(player,1,1/60,false);
  expect(Math.abs(Quaternion.Dot(settled,arm.rotationQuaternion!))).toBeGreaterThan(.999);
 }finally{visual.dispose();scene.dispose();engine.dispose();}
});
