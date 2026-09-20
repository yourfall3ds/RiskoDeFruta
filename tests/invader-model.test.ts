import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {Scene} from '@babylonjs/core/scene';
import {TransformNode} from '@babylonjs/core/Meshes/transformNode';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {ImportMeshAsync} from '@babylonjs/core/Loading/sceneLoader';
import '@babylonjs/loaders/glTF';
import type {AnimationGroup} from '@babylonjs/core/Animations/animationGroup';
import {AnimationStateMachine} from '../src/animation/AnimationStateMachine';
import {ENEMIES,ENEMY_VISUAL_DROP} from '../src/run/MonsterDirector';

/**
 * O invasor do disco no rig REAL.
 *
 * Existe por uma falha concreta: um modelo baixado pode instanciar, animar e ser mirado sem
 * aparecer, porque a escala que o autor deixou pendurada num nó intermediário não tem relação com o
 * tamanho desenhado. A primeira montagem deste asset entregou corpos de oito centímetros. Medir a
 * superfície já deformada pelo esqueleto é a única checagem que pega isso.
 */

/** Extremos verticais da superfície já deformada, como ela é desenhada. */
function span(meshes:readonly {getPositionData(a:boolean,b:boolean):Float32Array|number[]|null;computeWorldMatrix(f:boolean):never}[]):{low:number;high:number} {
  const point=new Vector3();let low=Infinity,high=-Infinity;
  for(const mesh of meshes){
    const vertices=mesh.getPositionData(true,true);if(!vertices)continue;
    const matrix=mesh.computeWorldMatrix(true);
    for(let i=0;i<vertices.length;i+=3){
      Vector3.TransformCoordinatesFromFloatsToRef(vertices[i]!,vertices[i+1]!,vertices[i+2]!,matrix as never,point);
      low=Math.min(low,point.y);high=Math.max(high,point.y);
    }
  }
  return {low,high};
}

/** Monta o ator exatamente como o `EnemySwarm` monta, inclusive a compensação vertical por espécie. */
async function invader(scene:Scene,at:Vector3){
  const definition=ENEMIES.invader;
  const imported=await ImportMeshAsync(new Uint8Array(readFileSync(`public/models/${definition.model}.glb`)),scene,{pluginExtension:'.glb'});
  const root=new TransformNode('invader-root',scene),visual=new TransformNode('invader-visual',scene);
  visual.parent=root;
  for(const mesh of imported.meshes)if(!mesh.parent)mesh.parent=visual;
  const clips=new Map<string,AnimationGroup>();
  for(const clip of imported.animationGroups){
    clip.stop();
    for(const name of ['Spawn','Walk','Run','Idle','Hit','Death','Attack'])if(clip.name.endsWith(name))clips.set(name,clip);
  }
  root.position.copyFrom(at);
  root.scaling.setAll(definition.scale);
  visual.position.set(0,-(ENEMY_VISUAL_DROP.invader??1),0);
  const meshes=visual.getChildMeshes().filter(m=>m.getTotalVertices()>0);
  return {root,visual,clips,meshes,machine:new AnimationStateMachine(clips)};
}

describe('invasor do disco no modelo real',()=>{
  it('traz os clipes que o enxame procura pelo nome',async()=>{
    const engine=new NullEngine(),scene=new Scene(engine);
    try{
      const {clips,meshes}=await invader(scene,Vector3.Zero());
      // Sem estes o ator nasce estático: o `AnimationStateMachine` desiste quando não acha o clipe.
      for(const name of ['Idle','Walk','Run','Attack','Death'])expect(clips.has(name),`clipe ${name}`).toBe(true);
      expect(meshes.length).toBeGreaterThan(0);
      expect(meshes.some(m=>m.skeleton),'nenhuma malha pesada num esqueleto').toBe(true);
    }finally{scene.dispose();engine.dispose();}
  },30000);

  it('fica de pé no chão, com o tamanho de um monstro grande, em toda a caminhada',async()=>{
    const engine=new NullEngine(),scene=new Scene(engine);
    try{
      const ground=new Vector3(3,7.5,-4);
      const {root,meshes,machine}=await invader(scene,ground);
      let shortest=Infinity,tallest=-Infinity,deepest=0;
      for(const progress of [0,.17,.33,.5,.67,.83,1]){
        machine.sample('Walk',progress,1/60);
        root.computeWorldMatrix(true);
        const {low,high}=span(meshes as never);
        shortest=Math.min(shortest,high-low);tallest=Math.max(tallest,high-low);
        deepest=Math.min(deepest,low-ground.y);
      }
      // Pé no piso: nada de corpo enterrado nem pairando. A folga de uma passada é de centímetros.
      expect(deepest,'o corpo afunda no chão').toBeGreaterThan(-.12);
      // Grande de verdade, e sem a catástrofe de escala que já aconteceu com este asset.
      expect(shortest,'invasor pequeno demais na tela').toBeGreaterThan(1.9);
      expect(tallest,'invasor gigante demais').toBeLessThan(3.6);
    }finally{scene.dispose();engine.dispose();}
  },30000);

  it('a vida é a de quatro inimigos comuns e o diretor nunca o sorteia',async()=>{
    expect(ENEMIES.invader.hp).toBe(ENEMIES.watermelon.hp*4);
    // `cost` zero mantém o invasor fora de qualquer composição de horda: só a represália o coloca.
    expect(ENEMIES.invader.cost).toBe(0);
    const {MonsterDirector}=await import('../src/run/MonsterDirector');
    const {RunRNG}=await import('../src/core/RunRNG');
    const director=new MonsterDirector(new RunRNG('invader-roll').stream('director'),1,50,true);
    const drawn=new Set<string>();
    for(let i=0;i<4000;i++)director.update(.1,0,0,kind=>{drawn.add(kind);return true;},30);
    expect(drawn.has('invader'),'o diretor sorteou o invasor numa horda').toBe(false);
  },30000);
});
