/**
 * Extrai a geometria da rocha escaneada `coast_land_rocks_02` já presente no mundo para um asset
 * próprio, `public/models/outcrop-rocks.json`.
 *
 * Por que um arquivo novo em vez de ler o GLB em tempo de execução: o SERVIDOR autoritativo também
 * precisa da mesma geometria para gerar a colisão dos afloramentos, e ele não carrega GLB. Um JSON
 * pequeno, lido pelos dois lados, é o que mantém pedra visível e pedra pisável idênticas.
 *
 * Nenhum modelo original é alterado: a fonte é lida somente para leitura e o resultado é um arquivo
 * derivado, com proveniência registrada dentro do próprio JSON.
 *
 *   node scripts/extract-outcrop-rock.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const SOURCE='public/models/highland-farms.glb';
const TARGET='public/models/outcrop-rocks.json';
const NODE=/^coast_land_rocks_02/;

function readGlb(file){
 const buffer=fs.readFileSync(file);
 if(buffer.readUInt32LE(0)!==0x46546C67)throw Error('Não é um GLB: '+file);
 let offset=12,json=null,bin=null;
 while(offset<buffer.length){
  const length=buffer.readUInt32LE(offset),type=buffer.readUInt32LE(offset+4);
  const chunk=buffer.subarray(offset+8,offset+8+length);
  if(type===0x4E4F534A)json=JSON.parse(chunk.toString('utf8'));else if(type===0x004E4942)bin=chunk;
  offset+=8+length;
 }
 if(!json||!bin)throw Error('GLB sem chunk JSON/BIN: '+file);
 return{json,bin};
}

const COMPONENTS={SCALAR:1,VEC2:2,VEC3:3,VEC4:4};
const READERS={5120:(b,o)=>b.readInt8(o),5121:(b,o)=>b.readUInt8(o),5122:(b,o)=>b.readInt16LE(o),5123:(b,o)=>b.readUInt16LE(o),5125:(b,o)=>b.readUInt32LE(o),5126:(b,o)=>b.readFloatLE(o)};
const WIDTHS={5120:1,5121:1,5122:2,5123:2,5125:4,5126:4};

function readAccessor(json,bin,index){
 const accessor=json.accessors[index],view=json.bufferViews[accessor.bufferView];
 const parts=COMPONENTS[accessor.type],width=WIDTHS[accessor.componentType];
 const stride=view.byteStride||parts*width;
 const base=(view.byteOffset||0)+(accessor.byteOffset||0);
 const read=READERS[accessor.componentType];
 const out=new Array(accessor.count*parts);
 for(let i=0;i<accessor.count;i++)for(let c=0;c<parts;c++)out[i*parts+c]=read(bin,base+i*stride+c*width);
 return out;
}

const {json,bin}=readGlb(SOURCE);
const node=json.nodes.find(n=>n.mesh!==undefined&&NODE.test(n.name??''));
if(!node)throw Error('Nó da rocha não encontrado em '+SOURCE);
const primitive=json.meshes[node.mesh].primitives[0];
const positions=readAccessor(json,bin,primitive.attributes.POSITION);
const uvs=primitive.attributes.TEXCOORD_0!==undefined?readAccessor(json,bin,primitive.attributes.TEXCOORD_0):[];
const indices=readAccessor(json,bin,primitive.indices);

// Normaliza: X/Z centrados, base em Y=0, extensão 1 em cada eixo. O consumidor multiplica pelo
// tamanho desejado em metros, então o mesmo shape serve a afloramentos de qualquer porte.
const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
for(let i=0;i<positions.length;i+=3)for(let a=0;a<3;a++){min[a]=Math.min(min[a],positions[i+a]);max[a]=Math.max(max[a],positions[i+a]);}
const extent=[0,1,2].map(a=>Math.max(1e-6,max[a]-min[a]));
const normalized=new Array(positions.length);
for(let i=0;i<positions.length;i+=3){
 // glTF → mundo do jogo: o carregador do Babylon espelha X.
 normalized[i]=-((positions[i]-(min[0]+max[0])/2)/extent[0]);
 normalized[i+1]=(positions[i+1]-min[1])/extent[1];
 normalized[i+2]=(positions[i+2]-(min[2]+max[2])/2)/extent[2];
}
// O espelhamento de X inverte o winding; devolve a face para fora.
const flipped=[];
for(let i=0;i<indices.length;i+=3)flipped.push(indices[i],indices[i+2],indices[i+1]);

const data={
 provenance:{
  source:SOURCE,node:node.name,material:json.materials[primitive.material]?.name??null,
  script:path.basename(new URL(import.meta.url).pathname),
  note:'Geometria derivada do scan coast_land_rocks_02 já embarcado no mundo. Nenhum asset original foi alterado.',
 },
 triangles:flipped.length/3,vertices:normalized.length/3,
 sourceExtent:extent,
 positions:normalized.map(v=>Math.round(v*1e5)/1e5),
 uvs:uvs.map(v=>Math.round(v*1e5)/1e5),
 indices:flipped,
};
fs.writeFileSync(TARGET,JSON.stringify(data));
console.log('OUTCROP ROCK EXPORT',data.triangles,'triângulos',data.vertices,'vértices →',TARGET);
