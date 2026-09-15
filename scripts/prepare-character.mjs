import { readFile, writeFile, mkdir } from 'node:fs/promises';
const species=process.argv[2];
if(species&&!['carrot','corn','eggplant'].includes(species))throw new Error('Unknown species');
const prefix = species?`assets/Meshy_AI_enemy_${species}_rigged_biped/Meshy_AI_enemy_${species}_rigged_biped/Meshy_AI_enemy_${species}_rigged_biped_`:'assets/Meshy_AI_gunslinger_v2_rigged_biped/Meshy_AI_gunslinger_v2_rigged_biped/Meshy_AI_gunslinger_v2_rigged_biped_';
async function readGlb(file) {
  const data = await readFile(file); const jsonLength = data.readUInt32LE(12);
  return { json: JSON.parse(data.toString('utf8', 20, 20 + jsonLength).trim()), binary: data.subarray(28 + jsonLength) };
}
const base = await readGlb(prefix + 'Character_output.glb');
const chunks = [base.binary]; let length = base.binary.length;
base.json.animations = [];
const nodeMap = new Map(base.json.nodes.map((node,index)=>[node.name,index]));
const clips = species?{Run:'Running',Walk:'Walking',Hit:'Hit_Reaction',Death:'Knock_Down_1'}:{ Idle: 'Idle_02', Run: 'Running', Walk: 'Walking', Jump: 'Regular_Jump', Dodge: 'Roll_Dodge_3', Draw: 'Cowboy_Quick_Draw_Shooting', Hit: 'Hit_Reaction', Death: 'Knock_Down_1' };
for (const [name,source] of Object.entries(clips)) {
  const input = await readGlb(prefix + `Animation_${source}_withSkin.glb`);
  const accessors = new Map();
  function copyAccessor(index, rootMotion = false) {
    const key = `${index}:${rootMotion}`;
    if (accessors.has(key)) return accessors.get(key);
    const accessor = structuredClone(input.json.accessors[index]);
    if (accessor.sparse) throw new Error('Sparse animation accessor requires explicit handling');
    const view = input.json.bufferViews[accessor.bufferView];
    const bytes = Buffer.from(input.binary.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength));
    if (rootMotion && accessor.componentType === 5126 && accessor.type === 'VEC3') {
      const start = accessor.byteOffset ?? 0; const stride = view.byteStride ?? 12;
      const first = [0,1,2].map(axis=>bytes.readFloatLE(start+axis*4));
      for (let sample=0;sample<accessor.count;sample++) {
        bytes.writeFloatLE(first[0],start+sample*stride);
        bytes.writeFloatLE(first[2],start+sample*stride+8);
        if (name === 'Jump') bytes.writeFloatLE(first[1],start+sample*stride+4);
      }
      delete accessor.min; delete accessor.max;
    }
    const pad = (4-length%4)%4; if(pad) {chunks.push(Buffer.alloc(pad)); length+=pad;}
    accessor.bufferView = base.json.bufferViews.length;
    base.json.bufferViews.push({...view,buffer:0,byteOffset:length});
    chunks.push(bytes); length+=bytes.length;
    const result = base.json.accessors.length; base.json.accessors.push(accessor); accessors.set(key,result); return result;
  }
  const animation = structuredClone(input.json.animations[0]); animation.name=name;
  const rootSamplers = new Set(animation.channels.filter(channel => input.json.nodes[channel.target.node].name==='Hips' && channel.target.path==='translation').map(channel=>channel.sampler));
  animation.samplers.forEach((sampler,index)=>{sampler.input=copyAccessor(sampler.input);sampler.output=copyAccessor(sampler.output,rootSamplers.has(index));});
  animation.channels.forEach(channel=>{const mapped=nodeMap.get(input.json.nodes[channel.target.node].name);if(mapped===undefined)throw new Error('Rig mismatch');channel.target.node=mapped;});
  base.json.animations.push(animation);
}
base.json.buffers=[{byteLength:length}];
const raw=Buffer.from(JSON.stringify(base.json)); const json=Buffer.concat([raw,Buffer.alloc((4-raw.length%4)%4,0x20)]);
const binary=Buffer.concat([...chunks,Buffer.alloc((4-length%4)%4)]);
const header=Buffer.alloc(20);header.writeUInt32LE(0x46546c67,0);header.writeUInt32LE(2,4);header.writeUInt32LE(28+json.length+binary.length,8);header.writeUInt32LE(json.length,12);header.writeUInt32LE(0x4e4f534a,16);
const binHeader=Buffer.alloc(8);binHeader.writeUInt32LE(binary.length,0);binHeader.writeUInt32LE(0x004e4942,4);
await mkdir('art/processed',{recursive:true});
await writeFile(`art/processed/${species??'gunslinger'}-animated.glb`,Buffer.concat([header,json,binHeader,binary]));
console.log(`Merged ${base.json.animations.length} clips into one rig, without duplicating textures/geometry. ${(binary.length/1048576).toFixed(1)} MiB before texture optimization.`);
