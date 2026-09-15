import { readFile, readdir, writeFile } from 'node:fs/promises';
const result = [];
for (const file of await readdir('art/source')) {
  const bytes = await readFile(`art/source/${file}`);
  const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)).trim());
  result.push({ file, nodes: gltf.nodes.map(n => ({ name: n.name, translation: n.translation, scale: n.scale, rotation: n.rotation })),
    meshes: gltf.meshes?.map(m => ({name:m.name, primitives:m.primitives.map(p=>({attributes:p.attributes, indices:p.indices}))})),
    materials: gltf.materials, animations: gltf.animations?.map(a=>({name:a.name,channels:a.channels.length, targets: [...new Set(a.channels.map(c => gltf.nodes[c.target.node].name))], maxTime: Math.max(...a.samplers.map(s=>gltf.accessors[s.input].max?.[0]??0))})),
    bounds: gltf.meshes?.flatMap(m=>m.primitives.map(p=>({min:gltf.accessors[p.attributes.POSITION].min,max:gltf.accessors[p.attributes.POSITION].max}))) });
}
await writeFile('docs/character-source.json', JSON.stringify(result,null,2));
console.log(JSON.stringify(result.map(({file,bounds,animations,nodes})=>({file,bounds,animations,nodes:nodes.length,root:nodes.slice(0,4)})),null,2));
