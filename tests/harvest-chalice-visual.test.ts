import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {Scene} from '@babylonjs/core/scene';
import '@babylonjs/loaders/glTF';
import {CHALICE_FILL_LEVELS,CHALICE_MODEL_URL,CHALICE_NODES,HarvestChaliceVisual,type ChaliceVisualOptions} from '../src/vfx/HarvestChaliceVisual';

const GLB=new Uint8Array(readFileSync('public/models/harvest-chalice.glb'));
const offline:ChaliceVisualOptions={source:GLB,pluginExtension:'.glb'};

async function stage(options:ChaliceVisualOptions={}){
 const engine=new NullEngine(),scene=new Scene(engine);
 const chalice=new HarvestChaliceVisual(scene,{...offline,...options});
 return {engine,scene,chalice,close:()=>{chalice.dispose();scene.dispose();engine.dispose();}};
}

describe('harvest chalice visual module',()=>{
 it('points at the shipped asset and its concept reference',()=>{
  expect(CHALICE_MODEL_URL).toBe('/models/harvest-chalice.glb');
 });

 it('exists as an empty node before the model arrives — no white proxy',async()=>{
  const {scene,chalice,close}=await stage();
  try {
   expect(chalice.ready).toBe(false);
   expect(scene.meshes).toHaveLength(0);
   // Pedidos feitos cedo não podem explodir nem sumir.
   chalice.place({x:4,y:2,z:-7});
   chalice.setFill(.5);
   chalice.splash({x:4,y:2,z:-9});
   chalice.update(1/60);
   expect(chalice.activeDrops).toBe(0);
   expect(chalice.requestedFill).toBeCloseTo(.5,6);
   expect(await chalice.load()).toBe(true);
   expect(chalice.ready).toBe(true);
   expect(chalice.error).toBe('');
   for(const name of [CHALICE_NODES.bowl,CHALICE_NODES.frame,CHALICE_NODES.juice,CHALICE_NODES.droplet])
    expect(chalice.meshes.some(mesh=>mesh.name===name),name).toBe(true);
   expect(chalice.root.position.x).toBe(4);
  } finally {close();}
 });

 it('applies a fill requested before loading and blends only two authored levels',async()=>{
  const {chalice,close}=await stage();
  try {
   chalice.setFill(.6,true);
   await chalice.load();
   const manager=chalice.meshes.find(mesh=>mesh.name===CHALICE_NODES.juice)!.morphTargetManager!;
   expect(manager.numTargets).toBe(CHALICE_FILL_LEVELS.length-1);
   const influences=Array.from({length:manager.numTargets},(_,i)=>manager.getTarget(i).influence);
   expect(influences.reduce((sum,value)=>sum+value,0)).toBeCloseTo(1,6);
   expect(influences.filter(value=>value>0)).toHaveLength(1);       // 60% cai exatamente no Fill60
   chalice.setFill(.7,true);
   const blended=Array.from({length:manager.numTargets},(_,i)=>manager.getTarget(i).influence);
   expect(blended.filter(value=>value>0)).toHaveLength(2);
   expect(blended.reduce((sum,value)=>sum+value,0)).toBeCloseTo(1,6);
  } finally {close();}
 });

 it('reports a surface height that rises with the fill and stays inside the bowl',async()=>{
  const {chalice,close}=await stage();
  try {
   chalice.place({x:0,y:12,z:0});
   await chalice.load();
   let previous=-Infinity;
   for(const fraction of [0,.1,.25,.5,.75,.9,1]){
    chalice.setFill(fraction,true);
    const height=chalice.surfaceHeight();
    expect(height).toBeGreaterThan(previous);
    expect(height).toBeGreaterThanOrEqual(12+CHALICE_FILL_LEVELS[0]!);
    expect(height).toBeLessThan(chalice.rimPoint().y);
    previous=height;
   }
   chalice.setFill(-5,true);expect(chalice.fill).toBe(0);
   chalice.setFill(9,true);expect(chalice.fill).toBe(1);
   chalice.setFill(Number.NaN,true);expect(chalice.fill).toBe(0);
  } finally {close();}
 });

 it('caps the droplet pool and recycles it instead of growing',async()=>{
  const {chalice,close}=await stage({dropCapacity:6});
  try {
   await chalice.load();
   for(let i=0;i<200;i++)chalice.splash({x:i,y:0,z:0});
   expect(chalice.activeDrops).toBe(6);
   const droplet=chalice.meshes.find(mesh=>mesh.name===CHALICE_NODES.droplet) as unknown as {thinInstanceCount:number;isVisible:boolean};
   chalice.update(1/60);
   expect(droplet.thinInstanceCount).toBe(6);
   for(let i=0;i<60;i++)chalice.update(1/60);
   expect(chalice.activeDrops).toBe(0);
   expect(droplet.thinInstanceCount).toBe(0);
   expect(droplet.isVisible).toBe(false);
   chalice.splash({x:0,y:0,z:0});                                  // pool volta a aceitar
   expect(chalice.activeDrops).toBe(1);
  } finally {close();}
 });

 it('smooths the displayed fill without ever changing the requested one',async()=>{
  const {chalice,close}=await stage();
  try {
   await chalice.load();
   chalice.setFill(1);
   expect(chalice.fill).toBe(0);
   chalice.update(.1);
   expect(chalice.fill).toBeGreaterThan(0);
   expect(chalice.fill).toBeLessThan(1);
   expect(chalice.requestedFill).toBe(1);
   for(let i=0;i<120;i++)chalice.update(1/60);
   expect(chalice.fill).toBe(1);
   chalice.update(0);chalice.update(-1);                           // dt inválido não mexe em nada
   expect(chalice.fill).toBe(1);
  } finally {close();}
 });

 it('pulses on completion and returns the material to its authored emissive',async()=>{
  const {chalice,close}=await stage();
  try {
   await chalice.load();
   const juice=chalice.meshes.find(mesh=>mesh.name===CHALICE_NODES.juice)!;
   const material=juice.material as unknown as {emissiveColor:{r:number}};
   const authored=material.emissiveColor.r;
   chalice.pulse();
   chalice.update(.3);
   expect(material.emissiveColor.r).toBeGreaterThan(authored);
   expect(chalice.root.scaling.x).toBeGreaterThan(1);
   for(let i=0;i<120;i++)chalice.update(1/60);
   expect(material.emissiveColor.r).toBeCloseTo(authored,6);
   expect(chalice.root.scaling.x).toBeCloseTo(1,6);
  } finally {close();}
 });

 it('resets an attempt without reloading the model',async()=>{
  const {chalice,close}=await stage();
  try {
   await chalice.load();
   const meshes=chalice.meshes.length;
   chalice.setFill(.8,true);
   chalice.splash({x:1,y:0,z:1});
   chalice.pulse();
   chalice.reset();
   expect(chalice.fill).toBe(0);
   expect(chalice.requestedFill).toBe(0);
   expect(chalice.activeDrops).toBe(0);
   expect(chalice.root.scaling.x).toBeCloseTo(1,6);
   expect(chalice.meshes).toHaveLength(meshes);
   expect(chalice.ready).toBe(true);
  } finally {close();}
 });

 it('loads once however many times it is asked',async()=>{
  const {scene,chalice,close}=await stage();
  try {
   const [first,second]=await Promise.all([chalice.load(),chalice.load()]);
   expect(first).toBe(true);
   expect(second).toBe(true);
   const after=scene.meshes.length;
   await chalice.load();
   expect(scene.meshes).toHaveLength(after);
  } finally {close();}
 });

 it('disposes every mesh and material it created, and survives a double dispose',async()=>{
  const engine=new NullEngine(),scene=new Scene(engine);
  try {
   const chalice=new HarvestChaliceVisual(scene,offline);
   await chalice.load();
   expect(scene.meshes.length).toBeGreaterThan(3);
   chalice.dispose();
   chalice.dispose();
   expect(scene.meshes).toHaveLength(0);
   expect(scene.materials).toHaveLength(0);
   expect(scene.transformNodes).toHaveLength(0);
   expect(chalice.ready).toBe(false);
   chalice.update(1/60);
   chalice.setFill(.5);
   chalice.splash({x:0,y:0,z:0});
   expect(chalice.activeDrops).toBe(0);
  } finally {scene.dispose();engine.dispose();}
 });

 it('does not leak meshes when disposed while the model is still in flight',async()=>{
  const engine=new NullEngine(),scene=new Scene(engine);
  try {
   const chalice=new HarvestChaliceVisual(scene,offline);
   const pending=chalice.load();
   chalice.dispose();
   expect(await pending).toBe(false);
   expect(scene.meshes).toHaveLength(0);
   expect(chalice.ready).toBe(false);
  } finally {scene.dispose();engine.dispose();}
 });

 it('reports a load failure instead of throwing, and keeps the marker usable',async()=>{
  const engine=new NullEngine(),scene=new Scene(engine);
  try {
   const chalice=new HarvestChaliceVisual(scene,{source:new Uint8Array([1,2,3,4]),pluginExtension:'.glb'});
   expect(await chalice.load()).toBe(false);
   expect(chalice.ready).toBe(false);
   expect(chalice.error).not.toBe('');
   chalice.setFill(.75);
   chalice.splash({x:0,y:0,z:0});
   chalice.update(1/60);
   expect(chalice.requestedFill).toBe(.75);
   chalice.dispose();
  } finally {scene.dispose();engine.dispose();}
 });
});
