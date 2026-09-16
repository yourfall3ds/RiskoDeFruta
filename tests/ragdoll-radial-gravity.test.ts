import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import HavokPhysics from '@babylonjs/havok';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {Scene} from '@babylonjs/core/scene';
import {LoadAssetContainerAsync} from '@babylonjs/core/Loading/sceneLoader';
import '@babylonjs/loaders/glTF';
import {HavokPlugin} from '@babylonjs/core/Physics/v2/Plugins/havokPlugin';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import type {Mesh} from '@babylonjs/core/Meshes/mesh';
import {TransformNode} from '@babylonjs/core/Meshes/transformNode';
import {RagdollWorld} from '../src/physics/RagdollWorld';
import type {DamageContext,Vec3} from '../src/core/contracts';

const R=180;
/** Gravidade do planeta: para o centro, a partir de onde o CORPO estiver. */
const planetDown=(p:Vec3):Vec3=>{
  const l=Math.hypot(p.x,p.y,p.z)||1;
  return{x:-p.x/l,y:-p.y/l,z:-p.z/l};
};
const context=(at:Vec3):DamageContext=>({
  attackerId:1,victimId:2,sourceId:'test',attackId:'test',baseDamage:999,finalDamage:999,crit:false,
  procCoefficient:0,procChainDepth:1,damageTags:['test'],hitPosition:at,
  hitNormal:{x:0,y:0,z:-1},forceDirection:{x:0,y:0,z:1},forceMagnitude:3,
});

describe('gravidade radial POR CORPO no ragdoll',()=>{
  it('três cadáveres em verticais diferentes caem cada um para o centro do planeta, ao mesmo tempo',async()=>{
    const engine=new NullEngine(),scene=new Scene(engine),manager=new RagdollWorld();
    try{
      const hk=await HavokPhysics({wasmBinary:new Uint8Array(readFileSync('node_modules/@babylonjs/havok/lib/esm/HavokPhysics.wasm')).buffer});
      // A gravidade da CENA continua sendo a original do jogo. Nada aqui a reescreve.
      scene.enablePhysics(new Vector3(0,-18,0),new HavokPlugin(true,hk));
      const sceneGravity=scene.getPhysicsEngine()!.gravity.clone();
      const container=await LoadAssetContainerAsync(new Uint8Array(readFileSync('public/models/original-eggplant.glb')),scene,{pluginExtension:'.glb',pluginOptions:{gltf:{skipMaterials:true}}});

      // Três ilhas com verticais MUITO diferentes: polo norte, polo sul e equador em +X.
      const places:{name:string;at:Vec3}[]=[
        {name:'polo norte',at:{x:0,y:R,z:0}},
        {name:'polo sul',at:{x:0,y:-R,z:0}},
        {name:'equador +X',at:{x:R,y:0,z:0}},
      ];
      const corpses=places.map((place,index)=>{
        const instance=container.instantiateModelsToScene(n=>`corpse-${index}-${n}`,false,{doNotInstantiate:true});
        const root=new TransformNode(`corpse-${index}`,scene);
        root.position.set(place.at.x,place.at.y,place.at.z);
        for(const n of instance.rootNodes)n.parent=root;
        const body=root.getChildMeshes().find(m=>m.getTotalVertices()>0) as Mesh;
        const skeleton=instance.skeletons[0]!;
        root.computeWorldMatrix(true);body.computeWorldMatrix(true);skeleton.computeAbsoluteMatrices(true);
        const handle=manager.create(skeleton,body,context(place.at),1);
        expect(handle,`ragdoll de ${place.name}`).toBeDefined();
        return{...place,handle:handle!};
      });
      expect(manager.count).toBe(3);

      const bones=corpses.reduce((total,c)=>total+c.handle.bodies,0);
      for(let frame=0;frame<120;frame++){
        manager.applyLocalGravity(planetDown,1/60);
        scene.getPhysicsEngine()!._step(1/60);
        scene.onBeforeRenderObservable.notifyObservers(scene);
      }
      // Todos os ossos dos três corpos foram corrigidos, não só os do corpo perto do jogador.
      expect(manager.bodiesUnderLocalGravity).toBe(bones);

      const velocity=new Vector3();
      for(const corpse of corpses){
        for(let i=0;i<corpse.handle.bodies;i++){
          const aggregate=corpse.handle.rig.getAggregate(i);
          aggregate.body.getLinearVelocityToRef(velocity);
          const p=aggregate.transformNode.position;
          const down=planetDown({x:p.x,y:p.y,z:p.z});
          // A velocidade de cada osso aponta para o CENTRO do planeta, seja qual for a ilha.
          const towardCentre=velocity.x*down.x+velocity.y*down.y+velocity.z*down.z;
          expect(towardCentre,`${corpse.name} osso ${i} caindo para o centro`).toBeGreaterThan(1);
          expect(Number.isFinite(p.x)&&Number.isFinite(p.y)&&Number.isFinite(p.z)).toBe(true);
        }
      }

      // A prova de que isto NÃO é a gravidade global disfarçada: o corpo do polo SUL acelera para
      // `+Y` do mundo — o sentido OPOSTO ao da gravidade da cena e ao do corpo do polo norte.
      const northUp=corpses[0]!.handle.rig.getAggregate(0),southUp=corpses[1]!.handle.rig.getAggregate(0);
      northUp.body.getLinearVelocityToRef(velocity);const northY=velocity.y;
      southUp.body.getLinearVelocityToRef(velocity);const southY=velocity.y;
      expect(northY).toBeLessThan(-1);
      expect(southY).toBeGreaterThan(1);
      // E o do equador cai em `−X`, sem nenhuma componente `Y` dominante.
      const eastBody=corpses[2]!.handle.rig.getAggregate(0);
      eastBody.body.getLinearVelocityToRef(velocity);
      expect(velocity.x).toBeLessThan(-1);
      expect(Math.abs(velocity.y)).toBeLessThan(Math.abs(velocity.x));

      // A gravidade da CENA nunca foi tocada: terreno estático e qualquer outro corpo seguem iguais.
      expect(scene.getPhysicsEngine()!.gravity.equalsWithEpsilon(sceneGravity,1e-9)).toBe(true);
    }finally{manager.clear();scene.dispose();engine.dispose();}
  },60000);

  it('sem chamada a fazenda continua com a gravidade de cena e nenhum corpo corrigido',async()=>{
    const engine=new NullEngine(),scene=new Scene(engine),manager=new RagdollWorld();
    try{
      const hk=await HavokPhysics({wasmBinary:new Uint8Array(readFileSync('node_modules/@babylonjs/havok/lib/esm/HavokPhysics.wasm')).buffer});
      scene.enablePhysics(new Vector3(0,-18,0),new HavokPlugin(true,hk));
      const container=await LoadAssetContainerAsync(new Uint8Array(readFileSync('public/models/original-eggplant.glb')),scene,{pluginExtension:'.glb',pluginOptions:{gltf:{skipMaterials:true}}});
      const instance=container.instantiateModelsToScene(n=>`farm-${n}`,false,{doNotInstantiate:true});
      const root=new TransformNode('farm-corpse',scene);root.position.set(3,0,2);
      for(const n of instance.rootNodes)n.parent=root;
      const body=root.getChildMeshes().find(m=>m.getTotalVertices()>0) as Mesh,skeleton=instance.skeletons[0]!;
      root.computeWorldMatrix(true);body.computeWorldMatrix(true);skeleton.computeAbsoluteMatrices(true);
      const handle=manager.create(skeleton,body,context({x:3,y:1,z:2}),1)!;
      expect(handle).toBeDefined();
      for(let frame=0;frame<60;frame++){
        scene.getPhysicsEngine()!._step(1/60);
        scene.onBeforeRenderObservable.notifyObservers(scene);
      }
      // Ninguém chamou `applyLocalGravity`: o contador fica em zero e o corpo caiu em `−Y`, igual
      // ao jogo de sempre.
      expect(manager.bodiesUnderLocalGravity).toBe(0);
      const velocity=new Vector3();
      handle.rig.getAggregate(0).body.getLinearVelocityToRef(velocity);
      expect(velocity.y).toBeLessThan(-1);
      expect(scene.getPhysicsEngine()!.gravity.equalsWithEpsilon(new Vector3(0,-18,0),1e-9)).toBe(true);
    }finally{manager.clear();scene.dispose();engine.dispose();}
  },60000);
});
