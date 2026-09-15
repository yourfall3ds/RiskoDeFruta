import {it,expect,vi} from 'vitest';
import {DistantRegionSet} from '../src/world/streaming/DistantRegions';
const proxy=()=>({setVisible:vi.fn(),dispose:vi.fn()});
it('keeps unloaded regions visible and hides only their matching detailed replacement',()=>{
 const set=new DistantRegionSet(),city=proxy(),frontier=proxy();set.attach('city',city);set.attach('frontier',frontier);expect(city.setVisible).toHaveBeenLastCalledWith(true);
 set.update(['city']);expect(city.setVisible).toHaveBeenLastCalledWith(false);expect(frontier.setVisible).toHaveBeenLastCalledWith(true);
 set.update(['frontier']);expect(city.setVisible).toHaveBeenLastCalledWith(true);expect(frontier.setVisible).toHaveBeenLastCalledWith(false);set.dispose();expect(city.dispose).toHaveBeenCalledOnce();expect(frontier.dispose).toHaveBeenCalledOnce();
});
it('never shows a late proxy over a resident detail region and disposes late arrivals after shutdown',()=>{
 const set=new DistantRegionSet(),late=proxy(),replacement=proxy(),abandoned=proxy();set.update(['city']);set.attach('city',late);expect(late.setVisible).toHaveBeenLastCalledWith(false);set.attach('city',replacement);expect(late.dispose).toHaveBeenCalledOnce();expect(replacement.setVisible).toHaveBeenLastCalledWith(false);
 set.dispose();set.dispose();set.attach('frontier',abandoned);set.update([]);expect(replacement.dispose).toHaveBeenCalledOnce();expect(abandoned.dispose).toHaveBeenCalledOnce();expect(abandoned.setVisible).not.toHaveBeenCalled();
});
import {readFileSync} from 'node:fs';
it.each(['farm-city','solar-frontier','highland-farms','rootwood'])('distant %s export budgets opaque batches separately from the worn trail and preserves textured geometry',id=>{
 const b=readFileSync(`public/models/${id}-distant.glb`),g=JSON.parse(b.subarray(20,20+b.readUInt32LE(12)).toString());
 expect(g.meshes).toHaveLength((id==='highland-farms'||id==='rootwood')?2:1);const primitives=g.meshes.flatMap((m:{primitives:unknown[]})=>m.primitives);expect(primitives.filter((p:{material:number})=>g.materials[p.material].alphaMode!=='BLEND').length).toBeLessThanOrEqual(8);expect(primitives.length).toBeLessThanOrEqual((id==='highland-farms'||id==='rootwood')?9:8);
 const triangles=primitives.reduce((n:number,p:{indices:number})=>n+g.accessors[p.indices].count/3,0);expect(triangles).toBeGreaterThan(1000);expect(triangles).toBeLessThan(id==='highland-farms'?75000:70000);
 if(id==='highland-farms'||id==='rootwood'){const alpha=primitives.filter((p:{material:number})=>g.materials[p.material].alphaMode==='BLEND');expect(alpha).toHaveLength(1);for(const p of primitives)if(!alpha.includes(p))expect(p.attributes.COLOR_0).toBeUndefined();}
 expect(g.materials.filter((m:{pbrMetallicRoughness?:{baseColorTexture?:unknown}})=>m.pbrMetallicRoughness?.baseColorTexture).length).toBeGreaterThanOrEqual(5);expect(b.length).toBeLessThan(id==='highland-farms'?6500000:5500000);
});
it('updates distant canopy batches only while their detailed region is absent',()=>{
 const set=new DistantRegionSet(),grove={...proxy(),update:vi.fn()},viewer={x:720,y:30,z:320};set.attach('rootwood',grove);
 set.updateView(.3,viewer);expect(grove.update).toHaveBeenCalledTimes(1);
 set.update(['rootwood']);set.updateView(.3,viewer);expect(grove.update).toHaveBeenCalledTimes(1);
 set.update([]);set.updateView(.3,viewer);expect(grove.update).toHaveBeenCalledTimes(2);
 set.dispose();set.updateView(.3,viewer);expect(grove.update).toHaveBeenCalledTimes(2);
});
it('ships one distant placement for every authored rootwood tree',()=>{
 const bytes=readFileSync('public/models/rootwood.glb'),g=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString());
 const ids=new Set(g.nodes.filter((n:{name?:string})=>/^OrchardLOD_\d+_near_/.test(n.name??'')).map((n:{name:string})=>n.name.split('_')[1]));
 const placements=JSON.parse(readFileSync('public/models/rootwood-canopies.json','utf8'));
 expect(placements).toHaveLength(300);expect(new Set(placements.map((p:{id:string})=>p.id))).toEqual(ids);
 for(const p of placements){expect(p.center.x).toBeGreaterThan(790);expect(p.center.x).toBeLessThan(1270);expect(p.center.z).toBeGreaterThan(260);expect(p.center.z).toBeLessThan(740);expect(p.size).toBeGreaterThan(10);expect(p.size).toBeLessThan(24);expect(p.visible).toBe(true);}
});
