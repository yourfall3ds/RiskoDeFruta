/**
 * Conferência HEADLESS do encaixe da submetralhadora na mão do jogador.
 *
 * Usa o MESMO caminho do Babylon que o jogo (NullEngine + o carregador glTF real), então a
 * conversão canhota e as matrizes de osso são as de verdade — não uma aproximação feita à mão.
 *
 * Responde três perguntas: a arma pendura no punho? o cano aponta para a frente do corpo? o
 * comprimento bate com os ~60 cm autorais?
 */
import {NullEngine} from '@babylonjs/core/Engines/nullEngine.js';
import {Scene} from '@babylonjs/core/scene.js';
import {LoadAssetContainerAsync} from '@babylonjs/core/Loading/sceneLoader.js';
import {TransformNode} from '@babylonjs/core/Meshes/transformNode.js';
import {Matrix,Quaternion,Vector3} from '@babylonjs/core/Maths/math.vector.js';
import '@babylonjs/loaders/glTF/index.js';
import {readFileSync} from 'node:fs';

const ROOT='C:/Users/darck/Documents/Risk of Watermelon/public';
const file=path=>new Uint8Array(readFileSync(ROOT+path));

const engine=new NullEngine();
const scene=new Scene(engine);

const player=await LoadAssetContainerAsync(file('/models/gunslinger.glb'),scene,{pluginExtension:'.glb'});
player.addAllToScene();
const grip=player.transformNodes.find(n=>n.name==='RightWeaponGrip');
if(!grip)throw Error('sem RightWeaponGrip');
grip.computeWorldMatrix(true);

const smg=await LoadAssetContainerAsync(file('/models/weapons/paper-smg.glb'),scene,{pluginExtension:'.glb'});
smg.addAllToScene();
const root=new TransformNode('smg-root',scene);
for(const node of smg.rootNodes)node.parent=root;
root.rotationQuaternion=Quaternion.RotationYawPitchRoll(Math.PI/2,0,0);

const muzzle=smg.transformNodes.find(n=>n.name==='Muzzle');
const trigger=smg.transformNodes.find(n=>n.name==='Trigger');
console.log('nós do GLB:',smg.transformNodes.map(n=>n.name).join(', '));
console.log('clipes:',smg.animationGroups.map(g=>g.name).join(', '));

root.parent=grip;
root.position.setAll(0);
root.computeWorldMatrix(true);
trigger.computeWorldMatrix(true);
const local=Vector3.TransformCoordinates(trigger.getAbsolutePosition(),Matrix.Invert(grip.computeWorldMatrix(true)));
root.position.copyFrom(local.negate());
root.computeWorldMatrix(true);
for(const n of [muzzle,trigger])n.computeWorldMatrix(true);

const gripAt=grip.getAbsolutePosition();
const muzzleAt=muzzle.getAbsolutePosition();
const triggerAt=trigger.getAbsolutePosition();
const barrel=muzzleAt.subtract(triggerAt);

// A frente do corpo no espaço do punho: é a direção que `SmgRig` usa para a mão de apoio.
const forward=Vector3.TransformNormal(Vector3.Forward(),grip.getWorldMatrix()).normalize();

const fmt=v=>`(${v.x.toFixed(3)}, ${v.y.toFixed(3)}, ${v.z.toFixed(3)})`;
console.log('punho   ',fmt(gripAt));
console.log('gatilho ',fmt(triggerAt),'  distância ao punho',Vector3.Distance(gripAt,triggerAt).toFixed(4),'m');
console.log('boca    ',fmt(muzzleAt),'  cano',barrel.length().toFixed(3),'m');
console.log('frente do punho',fmt(forward));
console.log('cano · frente =',Vector3.Dot(barrel.clone().normalize(),forward).toFixed(3),'(1 = cano apontando exatamente para a frente)');

let lo=new Vector3(1e9,1e9,1e9),hi=new Vector3(-1e9,-1e9,-1e9);
for(const mesh of smg.meshes){
  const info=mesh.getBoundingInfo?.();
  if(!info)continue;
  mesh.computeWorldMatrix(true);
  lo=Vector3.Minimize(lo,info.boundingBox.minimumWorld);
  hi=Vector3.Maximize(hi,info.boundingBox.maximumWorld);
}
console.log('caixa da arma',fmt(hi.subtract(lo)),'m');
engine.dispose();
