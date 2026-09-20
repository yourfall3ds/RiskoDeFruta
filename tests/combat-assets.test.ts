import { describe,it,expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Health } from '../src/combat/Health';
import { EventBus } from '../src/core/EventBus';
import type { DamageContext,GameEvents } from '../src/core/contracts';

function readGlb(path:string){const bytes=readFileSync(path);return {bytes,json:JSON.parse(bytes.toString('utf8',20,20+bytes.readUInt32LE(12)))};}
describe('weapon attachment and imported enemies',()=>{
  it('exports a weapon grip as a child of each animated hand',()=>{
    const {json}=readGlb('public/models/gunslinger.glb');
    for(const side of ['Right','Left']){const index=json.nodes.findIndex((node:{name:string})=>node.name===`${side}WeaponGrip`);expect(index).toBeGreaterThan(-1);const hand=json.nodes.find((node:{name:string})=>node.name===`${side}Hand`);expect(hand.children).toContain(index);}
  });
  it('ships the textured gun below 45k triangles and 8 MiB',()=>{
    const {bytes,json}=readGlb('public/models/pistol.glb');const triangles=json.meshes.flatMap((mesh:{primitives:{indices:number}[]})=>mesh.primitives).reduce((sum:number,primitive:{indices:number})=>sum+json.accessors[primitive.indices].count/3,0);
    expect(triangles).toBeLessThanOrEqual(45000);expect(bytes.length).toBeLessThan(8*1048576);expect(json.images.length).toBeGreaterThanOrEqual(3);
  });
  // A pasta `assets/` com os GLBs originais fica fora do Git (.gitignore), então a integridade é conferida
  // contra as assinaturas registradas em docs/original-enemy-integrity.json — mesma garantia, sem arquivo ausente.
  it.each(['carrot','corn','eggplant','tomato','watermelon'])('preserves %s original geometry, embedded textures and skin byte for byte',(name)=>{
    const audit=JSON.parse(readFileSync('docs/original-enemy-integrity.json','utf8')).find((x:{species:string})=>x.species===name);
    expect(audit?.preservedSectionsSHA256,`assinatura ausente para ${name}`).toBeTruthy();
    const {bytes,json}=readGlb(`public/models/original-${name}.glb`);
    const sha=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
    for(const section of ['meshes','materials','images','skins'] as const)expect(sha(json[section]),`seção ${section} de ${name}`).toBe(audit.preservedSectionsSHA256[section]);
    const runtime=bytes.subarray(28+bytes.readUInt32LE(12));
    expect(runtime.length).toBeGreaterThanOrEqual(audit.originalBinaryBytes);
    expect(createHash('sha256').update(runtime.subarray(0,audit.originalBinaryBytes)).digest('hex')).toBe(audit.originalBinarySHA256);
    expect(json.animations.map((a:{name:string})=>a.name)).toEqual(expect.arrayContaining(['Run','Walk','Hit','Death','Attack']));
  });
});
describe('enemy damage lifecycle',()=>{
  it('rejects wrong/invalid damage, emits one death, and allows an explicit training reset',()=>{
    const events=new EventBus<GameEvents>();const health=new Health(100,96,events);let hits=0,kills=0;events.on('EnemyHit',()=>hits++);events.on('EnemyKilled',()=>kills++);
    const context:DamageContext={attackerId:1,victimId:100,sourceId:'dual_pistols',attackId:'right',baseDamage:12,finalDamage:12,crit:false,procCoefficient:1,procChainDepth:0,damageTags:['bullet'],hitPosition:{x:0,y:0,z:0},hitNormal:{x:0,y:0,z:-1},forceDirection:{x:0,y:0,z:1},forceMagnitude:2};
    expect(health.apply({...context,victimId:999})).toBe(false);expect(health.apply({...context,finalDamage:NaN})).toBe(false);
    for(let i=0;i<12;i++)health.apply(context);expect(health.current).toBe(0);expect(hits).toBe(8);expect(kills).toBe(1);
    health.reset();expect(health.apply(context)).toBe(true);expect(health.current).toBe(84);
  });
});
