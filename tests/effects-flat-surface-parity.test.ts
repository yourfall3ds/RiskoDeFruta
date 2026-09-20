import {describe,it,expect} from 'vitest';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {Scene} from '@babylonjs/core/scene';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {CreateBox} from '@babylonjs/core/Meshes/Builders/boxBuilder';
import type {Mesh} from '@babylonjs/core/Meshes/mesh';
import {CollisionWorld} from '../src/physics/CollisionWorld';
import {CombatPresentation} from '../src/vfx/CombatPresentation';
import {FruitFragments} from '../src/vfx/FruitFragments';
import {ElementalEffects} from '../src/vfx/ElementalEffects';
import {ShellCasings} from '../src/vfx/ShellCasings';
import {CorpseDebris} from '../src/physics/CorpseDebris';
import type {EnemySurface} from '../src/enemies/EnemySpace';
import type {WeaponAudio} from '../src/audio/RecordedAudio';

/**
 * O `GameWorld` entrega `collision.surface` SEMPRE. Na fazenda isso é um `FlatSurface`, e cada
 * módulo de apresentação da horda tem de reconhecê-lo e voltar para o código plano LITERAL — não
 * para uma versão radial que por acaso dá quase o mesmo número.
 *
 * Cada caso aqui roda o mesmo efeito DUAS vezes, uma com `undefined` e outra com o `FlatSurface`
 * real que a integração passa, e exige resultado idêntico.
 */
function farm(){
  const collision=new CollisionWorld();
  collision.surfaces.push({id:'field',x:0,z:0,width:200,depth:200,height:0});
  collision.boxes.push({id:'ledge',min:{x:6,y:0,z:-4},max:{x:10,y:3,z:4}});
  return collision;
}
const flatOf=(collision:CollisionWorld):EnemySurface=>collision.surface as unknown as EnemySurface;
const pose=(mesh:{position:Vector3;rotation:Vector3;scaling:Vector3;rotationQuaternion:unknown})=>({
  position:mesh.position.asArray(),rotation:mesh.rotation.asArray(),scaling:mesh.scaling.asArray(),
  quaternion:mesh.rotationQuaternion,
});
const scene=()=>{const engine=new NullEngine();const s=new Scene(engine);return{scene:s,close:()=>{s.dispose();engine.dispose();}};};

describe('o FlatSurface da integração não liga o caminho radial em nenhum efeito',()=>{
  it('CombatPresentation: círculo, cone e faixa ficam idênticos e sem quaternion',()=>{
    const collision=farm(),t=scene();
    try{
      const shots=[undefined,flatOf(collision)].map(surface=>{
        const effects=new CombatPresentation(t.scene);
        effects.useSurface(surface);
        effects.warning({x:3,y:1,z:-2},2.5,1,12,7,'root');
        effects.cone({x:0,y:0,z:0},{x:5,y:0,z:5},7,1,4);
        effects.line({x:0,y:0,z:0},{x:6,y:0,z:0},2,1,9);
        effects.eruption({x:1,y:0,z:1},3);
        effects.burst({x:2,y:0,z:2},'seed',1.4);
        effects.projectile({x:0,y:1,z:0},{x:9,y:1,z:0},12,10,3,8);
        const live=effects.warnings.filter(w=>w.active).map(w=>({kind:w.kind,stretch:w.stretch,radius:w.radius,pose:pose(w.mesh as never)}));
        const shot=effects.projectiles.find(p=>p.active)!;
        return{live,velocity:shot.velocity.asArray(),position:shot.position.asArray()};
      });
      expect(shots[0]).toEqual(shots[1]);
      // E nenhum decalque recebeu quaternion: no plano o Babylon continua lendo `rotation`.
      for(const warning of shots[1]!.live)expect(warning.pose.quaternion).toBeNull();
    }finally{t.close();}
  });

  it('FruitFragments: a mesma quebra sai com as mesmas velocidades',()=>{
    const collision=farm(),t=scene();
    try{
      const body=CreateBox('fruit',{size:1},t.scene) as Mesh;
      body.position.set(2,1,2);body.computeWorldMatrix(true);
      const runs=[undefined,flatOf(collision)].map(surface=>{
        const fragments=new FruitFragments(t.scene,collision);
        fragments.useSurface(surface);
        fragments.burst('watermelon',{x:2,y:0,z:2},{x:0,y:0,z:1},body,1);
        for(let i=0;i<30;i++)fragments.update(1/60);
        return fragments.active;
      });
      expect(runs[0]).toBe(runs[1]);
    }finally{t.close();}
  });

  it('CorpseDebris: os cacos do chefe caem igual pelos dois caminhos',()=>{
    const collision=farm(),t=scene();
    try{
      const runs=[undefined,flatOf(collision)].map(surface=>{
        const body=CreateBox('boss',{size:2},t.scene) as Mesh;
        const shard=CreateBox('shard',{size:.5},t.scene) as Mesh;
        shard.position.set(1,2,1);shard.computeWorldMatrix(true);
        const debris=new CorpseDebris(collision,surface);
        debris.fracture([body,shard],body);
        for(let i=0;i<45;i++)debris.update(1/60);
        const spots=t.scene.meshes.filter(m=>m.name==='broken-fruit-piece').map(m=>m.position.asArray());
        // Devolver os cacos antes da próxima passada: sem isto a segunda rodada contaria os da
        // primeira e o teste acusaria diferença onde só há sobra de cena.
        debris.clear();body.dispose();shard.dispose();
        return spots;
      });
      expect(runs[0]).toEqual(runs[1]);
    }finally{t.close();}
  });

  it('ElementalEffects: os grãos saem com a mesma velocidade e morrem no mesmo quadro',()=>{
    const collision=farm(),t=scene();
    try{
      const runs=[undefined,flatOf(collision)].map(surface=>{
        const elements=new ElementalEffects(t.scene,collision,surface);
        elements.emit('earth',new Vector3(1,2,3),1.2);
        const first=elements.activeCount;
        for(let i=0;i<40;i++)elements.update(1/60);
        const result={first,after:elements.activeCount};
        elements.dispose();
        return result;
      });
      expect(runs[0]).toEqual(runs[1]);
    }finally{t.close();}
  });

  it('ShellCasings: a ejeção e o quique usam o mesmo `groundAt` de sempre',()=>{
    const collision=farm(),t=scene();
    const audio={casing:()=>{}} as unknown as WeaponAudio;
    try{
      const runs=[undefined,flatOf(collision)].map(surface=>{
        const casings=new ShellCasings(t.scene,collision,audio,surface);
        casings.eject(new Vector3(0,1.2,0),new Vector3(0,0,1),0);
        casings.eject(new Vector3(1,1.2,0),new Vector3(1,0,0),1);
        for(let i=0;i<60;i++)casings.update(1/60);
        const spots=t.scene.meshes.filter(m=>m.name==='spent-casing'&&m.isEnabled()).map(m=>m.position.asArray());
        casings.dispose();
        return spots;
      });
      expect(runs[0]).toEqual(runs[1]);
    }finally{t.close();}
  });
});
