/** Remove unused authoring iterations from GLB buffers without changing any live accessor. */
import {readGlb,writeGlb} from './glb-tools.mjs';
const path='public/models/gunslinger.glb',g=readGlb(path),json=g.json,accessors=new Set(),views=new Set();
function primitiveRefs(p,visit){
 if(p.extensions)throw Error('Review extension buffer references before compacting');
 for(const key of Object.keys(p.attributes))p.attributes[key]=visit(p.attributes[key]);
 if(p.indices!==undefined)p.indices=visit(p.indices);
 for(const t of p.targets??[])for(const key of Object.keys(t))t[key]=visit(t[key]);
}
function refs(visit){
 for(const m of json.meshes)for(const p of m.primitives)primitiveRefs(p,visit);
 for(const skin of json.skins)if(skin.inverseBindMatrices!==undefined)skin.inverseBindMatrices=visit(skin.inverseBindMatrices);
 for(const a of json.animations)for(const s of a.samplers){s.input=visit(s.input);s.output=visit(s.output);}
}
refs(i=>{accessors.add(i);return i;});
const ids=[...accessors].sort((a,b)=>a-b),map=new Map(ids.map((id,i)=>[id,i]));
const kept=ids.map(id=>json.accessors[id]);
for(const a of kept){if(a.sparse)throw Error('Sparse accessor requires explicit handling');if(a.bufferView!==undefined)views.add(a.bufferView);}
for(const i of json.images??[])if(i.bufferView!==undefined)views.add(i.bufferView);
const viewIds=[...views].sort((a,b)=>a-b),viewMap=new Map(viewIds.map((id,i)=>[id,i])),chunks=[],newViews=[];let size=0;
for(const id of viewIds){const v=json.bufferViews[id];if(v.extensions)throw Error('Unsupported buffer extension');
 const pad=(4-size%4)%4;if(pad){chunks.push(Buffer.alloc(pad));size+=pad;}
 const bytes=g.binary.subarray(v.byteOffset??0,(v.byteOffset??0)+v.byteLength);chunks.push(bytes);newViews.push({...v,byteOffset:size});size+=bytes.length;
}
refs(i=>map.get(i));for(const a of kept)if(a.bufferView!==undefined)a.bufferView=viewMap.get(a.bufferView);
for(const i of json.images??[])if(i.bufferView!==undefined)i.bufferView=viewMap.get(i.bufferView);
json.accessors=kept;json.bufferViews=newViews;const before=g.binary.length;g.binary=Buffer.concat(chunks);writeGlb(path,g);
console.log({before,after:g.binary.length,saved:before-g.binary.length});
