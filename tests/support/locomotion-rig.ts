/**
 * Rig real de locomoção rodando sem browser, para MEDIR passos em vez de supor.
 *
 * Carrega `public/models/gunslinger.glb` num `NullEngine`, entrega o `CharacterVisual` de verdade
 * (mesma máquina de estados, mesmo blend direcional, mesmos clipes assados) e devolve a altura dos
 * dois pés depois de cada quadro. É o mesmo caminho que o jogo usa — `FootingPresentation` lê
 * `CharacterVisual.footHeights()` — só que dirigido por um `PlayerMotor` com velocidade escrita à
 * mão, o que permite andar, correr, dar ré, strafar e mudar de ritmo de forma reprodutível.
 *
 * ARMADILHA que este arquivo resolve: `Node.getWorldMatrix()` só recalcula quando o `renderId` da
 * cena muda. Sem `scene.render()` as matrizes congelam depois do primeiro quadro e a altura do osso
 * viraria uma constante. Por isso `refresh()` reconstrói a hierarquia inteira dos pais para os
 * filhos antes de cada leitura. No jogo o `renderId` avança sozinho a cada quadro e a leitura
 * preguiçosa do Babylon já faz esse mesmo trabalho; aqui é explícito.
 */
import {readFileSync} from 'node:fs';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {Scene} from '@babylonjs/core/scene';
import {ImportMeshAsync} from '@babylonjs/core/Loading/sceneLoader';
import '@babylonjs/loaders/glTF';
import type {AnimationGroup} from '@babylonjs/core/Animations/animationGroup';
import type {TransformNode} from '@babylonjs/core/Meshes/transformNode';
import {CharacterVisual} from '../../src/animation/CharacterVisual';
import {PlayerMotor} from '../../src/player/PlayerMotor';
import {CollisionWorld} from '../../src/physics/CollisionWorld';
import {EventBus} from '../../src/core/EventBus';
import type {GameEvents} from '../../src/core/contracts';

/** Movimento de um quadro, em coordenadas de mundo, mais o estado que muda o clipe dominante. */
export interface Stride {
  /** Velocidade horizontal no mundo. O clipe sai daqui pelo `directionalLocomotion`. */
  vx:number;vz:number;
  /** Para onde o corpo olha. Andar de ré é `vz` contrário ao `yaw`. */
  yaw?:number;
  grounded?:boolean;
  /** Velocidade vertical; só importa para escolher `JumpRise`/`JumpFall`. */
  vy?:number;
}

export interface LocomotionRig {
  visual:CharacterVisual;
  player:PlayerMotor;
  /** Avança um quadro e devolve a altura dos dois pés, já com a hierarquia reconstruída. */
  step(dt:number,stride:Stride):{right:number;left:number};
  /** Altura atual sem avançar o tempo. */
  heights():{right:number;left:number};
  /** Nomes dos clipes presentes no GLB. */
  clips:string[];
  dispose():void;
}

/** Direções nomeadas: o eixo do pedido é exatamente "andar/correr × frente/trás/lateral". */
export const HEADINGS={
  forward:{x:0,z:1},backward:{x:0,z:-1},left:{x:-1,z:0},right:{x:1,z:0},
  'forward-left':{x:-Math.SQRT1_2,z:Math.SQRT1_2},'forward-right':{x:Math.SQRT1_2,z:Math.SQRT1_2},
  'backward-left':{x:-Math.SQRT1_2,z:-Math.SQRT1_2},'backward-right':{x:Math.SQRT1_2,z:-Math.SQRT1_2},
} as const;
export type Heading=keyof typeof HEADINGS;

/** Velocidades do jogo: acima de 4 m/s o `directionalLocomotion` troca para a família de corrida. */
export const GAITS={walk:2.6,run:7.5} as const;
export type Gait=keyof typeof GAITS;

export async function loadLocomotionRig():Promise<LocomotionRig> {
  const engine=new NullEngine(),scene=new Scene(engine);
  const visual=new CharacterVisual(scene,()=>{});
  const imported=await ImportMeshAsync(new Uint8Array(readFileSync('public/models/gunslinger.glb')),scene,
    {pluginExtension:'.glb',pluginOptions:{gltf:{skipMaterials:true}}});
  // Mesmo enxerto usado por `melee-review.test.ts`: `CharacterVisual.load()` busca o modelo por URL,
  // que não existe em Node. O estado interno montado aqui é idêntico ao que `load()` produziria.
  const internals=visual as unknown as {clips:Map<string,AnimationGroup>;bones:Map<string,TransformNode>};
  for(const group of imported.animationGroups){group.stop();internals.clips.set(group.name,group);}
  for(const node of imported.transformNodes)internals.bones.set(node.name,node);
  for(const mesh of imported.meshes)if(!mesh.parent)mesh.parent=visual.root;
  visual.hands.push(imported.transformNodes.find(n=>n.name==='RightHand'),imported.transformNodes.find(n=>n.name==='LeftHand'));
  visual.grips.push(imported.transformNodes.find(n=>n.name==='RightWeaponGrip'),imported.transformNodes.find(n=>n.name==='LeftWeaponGrip'));
  visual.ready=true;

  const depth=(node:TransformNode):number=>{let count=0;for(let n=node.parent;n;n=n.parent)count++;return count;};
  const ordered=[...imported.transformNodes].sort((a,b)=>depth(a)-depth(b));
  const refresh=():void=>{visual.root.computeWorldMatrix(true);for(const node of ordered)node.computeWorldMatrix(true);};

  const player=new PlayerMotor(new CollisionWorld(),new EventBus<GameEvents>(),{x:0,y:0,z:0});
  const heights=():{right:number;left:number}=>{refresh();return visual.footHeights()!;};
  return {
    visual,player,clips:[...internals.clips.keys()],
    heights,
    step(dt,stride){
      player.velocity.x=stride.vx;player.velocity.z=stride.vz;player.velocity.y=stride.vy??0;
      player.yaw=stride.yaw??0;player.grounded=stride.grounded??true;
      Object.assign(player.previous,player.position);
      visual.update(player,1,dt,false);
      return heights();
    },
    dispose(){scene.dispose();engine.dispose();},
  };
}
