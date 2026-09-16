import {readFileSync, writeFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {parseDestructibles} from '../src/destruction/DestructibleTypes';

const manifest=JSON.parse(gunzipSync(readFileSync('public/models/planet-archipelago.json.gz')).toString());
const glb=readFileSync('public/models/planet-archipelago.glb');
const gltf=JSON.parse(glb.subarray(20,20+glb.readUInt32LE(12)).toString().trim());
const parsed=parseDestructibles(manifest.destructibles,{centre:manifest.centre,triangleTotal:manifest.indices.length/3});
const errors=[...parsed.warnings];
const counts:Record<string,number>={};
for(const record of parsed.records){
  counts[record.kind]=(counts[record.kind]??0)+1;
  const nodes=gltf.nodes.filter((node:any)=>node.name===record.nodeName);
  if(nodes.length!==1||nodes[0].mesh===undefined)errors.push(`${record.id}: missing unique mesh node`);
  else if(!gltf.meshes[nodes[0].mesh].primitives.every((p:any)=>p.material!==undefined))errors.push(`${record.id}: missing original material`);
  bounds: for(let t=record.triangleStart;t<record.triangleStart+record.triangleCount;t++){
    for(let corner=0;corner<3;corner++){
      const vertex=manifest.indices[t*3+corner]*3;
      for(const [axis,key] of ['x','y','z'].entries()){
        if(Math.abs(manifest.positions[vertex+axis]-record.centre[key as 'x'|'y'|'z'])>record.extents[key as 'x'|'y'|'z']+.002){
          errors.push(`${record.id}: collision outside bounds`);break bounds;
        }
      }
    }
  }
}
for(const kind of ['tree','rock','crate','barrel','structure'])if(!counts[kind])errors.push(`No ${kind} props exported`);
const report={props:parsed.records.length,counts,errors};
writeFileSync('docs/planet-destruction-audit.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
if(errors.length)process.exitCode=1;
