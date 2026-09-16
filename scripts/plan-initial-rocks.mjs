/**
 * Planeja a correção das pedras do CAMPO INICIAL que invadem ponte, cerca e piso caminhável.
 *
 * Causa medida (não suposta), em `scripts/finish-farm-world.py`:
 *
 *   def scan(name,x,y,z,height,sx=1,sy=1):
 *       hz = extensão LOCAL EM Z do template;  s = height/hz;  o.scale = (s*sx, s*sy, s)
 *
 * O template `coast_land_rocks_02` é uma LAJE costeira de 4,89 × 10,45 × 1,38 m. Pedir "altura 7 m"
 * multiplica tudo por 7/1,38 = 5,09 — a laje vira 29,9 × 63,8 × 7,0 m. `ground()` põe 16 dessas em
 * volta de um posto de 10 × 11 m, então elas avançam dezenas de metros para fora, atravessam o deck
 * da ponte e sobem 1 m acima do piso do posto. É o bloco cinza da captura do usuário, e a mesma
 * conta explica a textura borrada: a UV do scan foi autorada para ~5 × 10 m e está esticada em 30 × 64 m.
 *
 * O script NÃO altera nenhum modelo original: lê `farm-world.glb` e grava um plano derivado em
 * `public/models/initial-rock-fix.json`, com
 *   - os nós ofensores e a caixa orientada de cada um (para apagar a colisão e esconder o visual);
 *   - a substituição de cada um, já VERIFICADA aqui como fora de todo volume de travessia.
 *
 *   node scripts/plan-initial-rocks.mjs
 */
import fs from 'node:fs';

const SOURCE='public/models/farm-world.glb';
const TARGET='public/models/initial-rock-fix.json';
const ROCK_MATERIAL=/coast_land|rock|stone/i;
/** Fora deste raio relativo a peça é saia de ilha e PODE aparecer; dentro, é piso e não pode. */
const WALKABLE_REACH=.92;
/** Banda vertical protegida sobre um piso caminhável, em metros. */
const HEAD_ROOM=2.6,FOOT_ROOM=.35;
/** Folga lateral e vertical do deck da ponte. */
const DECK_MARGIN=.6,DECK_HEAD=3.2,DECK_FOOT=.6;

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
 const stride=view.byteStride||parts*width,base=(view.byteOffset||0)+(accessor.byteOffset||0);
 const read=READERS[accessor.componentType],out=new Float64Array(accessor.count*parts);
 for(let i=0;i<accessor.count;i++)for(let c=0;c<parts;c++)out[i*parts+c]=read(bin,base+i*stride+c*width);
 return out;
}

const {json,bin}=readGlb(SOURCE);
const authored=JSON.parse(fs.readFileSync('public/models/farm-collision.json','utf8'));

/** Deck das pontes, direto das superfícies autoradas. */
const decks=authored.surfaces.filter(surface=>/^bridge-/.test(surface.id));
/**
 * Plataformas que precisam ficar inteiras livres de pedra.
 *
 * São os POSTOS (`outpost-*`): plataformas de 10 × 11 m onde o marco da expedição pousa, e é onde a
 * captura do usuário mostra a laje atravessando a cerca. A ilha principal e a de cima NÃO entram
 * inteiras de propósito — a franja de pedra na beira delas é autoral e não atrapalha rota; ali a
 * proteção é só o corredor de cabeceira de ponte, logo abaixo.
 */
const floors=authored.surfaces.filter(surface=>surface.ellipse&&/^outpost/.test(surface.id));

/** Cabeceiras de ponte: raio de desobstrução onde a ponte encosta em qualquer ilha. */
const LANDING_RADIUS=7.5;
const landings=[];
for(const deck of decks){
 const group=deck.id.replace(/\d+$/,'');
 const family=decks.filter(other=>other.id.startsWith(group));
 const xs=family.map(other=>other.x);
 for(const x of [Math.min(...xs),Math.max(...xs)]){
  const edge=family.find(other=>other.x===x);
  landings.push({x:x+(x===Math.min(...xs)?-1:1)*(edge.width/2+LANDING_RADIUS*.5),z:edge.z,height:edge.height,radius:LANDING_RADIUS});
 }
}

/** `true` se o ponto está num volume que precisa ficar livre de pedra. */
function blocked(x,y,z){
 for(const deck of decks){
  if(Math.abs(x-deck.x)>deck.width/2+DECK_MARGIN||Math.abs(z-deck.z)>deck.depth/2+DECK_MARGIN)continue;
  const height=deck.height+(x-deck.x)*(deck.slopeX??0)+(z-deck.z)*(deck.slopeZ??0);
  if(y>height-DECK_FOOT&&y<height+DECK_HEAD)return true;
 }
 for(const floor of floors){
  const rx=floor.width/2*WALKABLE_REACH,rz=floor.depth/2*WALKABLE_REACH;
  if(Math.hypot((x-floor.x)/rx,(z-floor.z)/rz)>1)continue;
  if(y>floor.height-FOOT_ROOM&&y<floor.height+HEAD_ROOM)return true;
 }
 for(const landing of landings){
  if(Math.hypot(x-landing.x,z-landing.z)>landing.radius)continue;
  if(y>landing.height-FOOT_ROOM&&y<landing.height+HEAD_ROOM+1)return true;
 }
 return false;
}

/**
 * Ângulo em torno do eixo vertical, em espaço de jogo.
 *
 * `scan()` e `instance()` só giram em `rotation_euler.z`, que a exportação glTF entrega como giro
 * puro em Y — confirmado nos nós reais (quatérnio com x=z=0). Nós que fugirem disso (arco, portal)
 * são relatados e ficam de fora da correção automática, em vez de virarem caixa torta.
 */
function yawOf(rotation){
 const [x,y,z,w]=rotation??[0,0,0,1];
 if(Math.abs(x)>1e-4||Math.abs(z)>1e-4)return null;
 // O carregador espelha X; um giro de θ em torno de Y vira −θ.
 return -2*Math.atan2(y,w);
}

const rocks=[],tilted=[];
for(const node of json.nodes){
 if(node.mesh===undefined)continue;
 const mesh=json.meshes[node.mesh];
 const materials=mesh.primitives.map(p=>p.material!==undefined?json.materials[p.material].name:'');
 if(!materials.some(name=>ROCK_MATERIAL.test(name)))continue;
 const translation=node.translation??[0,0,0],scale=node.scale??[1,1,1],yaw=yawOf(node.rotation);
 if(yaw===null){tilted.push(node.name);continue;}
 const points=[];
 for(const primitive of mesh.primitives){
  const positions=readAccessor(json,bin,primitive.attributes.POSITION);
  for(let i=0;i<positions.length;i+=3)points.push([positions[i]*scale[0],positions[i+1]*scale[1],positions[i+2]*scale[2]]);
 }
 rocks.push({name:node.name,material:materials[0],translation,scale,yaw,points,
  origin:[-translation[0],translation[1],translation[2]]});
}
console.log('nós com material de rocha:',rocks.length,'· fora do eixo vertical (não tratados automaticamente):',tilted.length,tilted.join(', '));

/**
 * Posição de mundo de um ponto local já escalado.
 * Em espaço glTF gira em torno de Y e translada; depois o carregador espelha X.
 */
function toWorld(rock,point,factor=1,drop=0){
 const cos=Math.cos(-rock.yaw),sin=Math.sin(-rock.yaw);
 const x=point[0]*factor,y=point[1]*factor,z=point[2]*factor;
 const rx=x*cos+z*sin,rz=-x*sin+z*cos;
 return[-(rx+rock.translation[0]),y+rock.translation[1]-drop,rz+rock.translation[2]];
}

function intrusion(rock,factor=1,drop=0){
 let count=0;
 for(const point of rock.points){
  const [x,y,z]=toWorld(rock,point,factor,drop);
  if(blocked(x,y,z))count++;
 }
 return count;
}

/** Caixa orientada que contém a instância ORIGINAL, no eixo girado dela. */
function orientedBox(rock){
 const cos=Math.cos(-rock.yaw),sin=Math.sin(-rock.yaw);
 let minU=Infinity,maxU=-Infinity,minV=Infinity,maxV=-Infinity,minY=Infinity,maxY=-Infinity;
 for(const point of rock.points){
  const u=point[0],v=point[2],y=point[1];
  minU=Math.min(minU,u);maxU=Math.max(maxU,u);minV=Math.min(minV,v);maxV=Math.max(maxV,v);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
 }
 const cu=(minU+maxU)/2,cv=(minV+maxV)/2;
 const rx=cu*cos+cv*sin,rz=-cu*sin+cv*cos;
 void sin;void cos;
 return{
  x:-(rx+rock.translation[0]),y:(minY+maxY)/2+rock.translation[1],z:rz+rock.translation[2],
  // Meia-extensão no eixo local, mais uma folga pequena para o arredondamento do assado.
  hx:(maxU-minU)/2+.05,hy:(maxY-minY)/2+.05,hz:(maxV-minV)/2+.05,
  rotation:rock.yaw,
 };
}

/**
 * Pegada máxima de uma pedra do campo inicial, em metros.
 *
 * Não é gosto: a UV do scan foi autorada para ~4,9 × 10,4 m. Acima de ~16 m a textura já perde mais
 * de três vezes a densidade de texel e é isso que o usuário chama de "rocha cinza borrada". O limite
 * anda junto com a correção de UV por tamanho em `buildOutcropGeometry`.
 */
const MAX_FOOTPRINT=16,MAX_HEIGHT=8;

/** Extensões locais (largura, altura, profundidade) de uma instância, em metros de mundo. */
function extents(rock){
 let minU=Infinity,maxU=-Infinity,minV=Infinity,maxV=-Infinity,minY=Infinity,maxY=-Infinity;
 for(const point of rock.points){
  minU=Math.min(minU,point[0]);maxU=Math.max(maxU,point[0]);
  minV=Math.min(minV,point[2]);maxV=Math.max(maxV,point[2]);
  minY=Math.min(minY,point[1]);maxY=Math.max(maxY,point[1]);
 }
 return{minU,maxU,minV,maxV,minY,maxY,width:maxU-minU,depth:maxV-minV,height:maxY-minY};
}

function hash(seed,salt){
 let h=Math.imul(seed|0,374761393)^Math.imul(salt|0,668265263);
 h=Math.imul(h^(h>>>13),1274126177);
 return((h^(h>>>16))>>>0)/4294967296;
}

/** Altura mais alta da substituição que ainda fica fora de todo volume de travessia. */
function clearTop(x,z,footprint){
 let ceiling=Infinity;
 for(const floor of floors){
  const rx=floor.width/2*WALKABLE_REACH+footprint/2,rz=floor.depth/2*WALKABLE_REACH+footprint/2;
  if(Math.hypot((x-floor.x)/rx,(z-floor.z)/rz)>1)continue;
  ceiling=Math.min(ceiling,floor.height-FOOT_ROOM-.05);
 }
 for(const landing of landings){
  if(Math.hypot(x-landing.x,z-landing.z)>landing.radius+footprint/2)continue;
  ceiling=Math.min(ceiling,landing.height-FOOT_ROOM-.05);
 }
 for(const deck of decks){
  if(Math.abs(x-deck.x)>deck.width/2+DECK_MARGIN+footprint/2||Math.abs(z-deck.z)>deck.depth/2+DECK_MARGIN+footprint/2)continue;
  ceiling=Math.min(ceiling,deck.height+(x-deck.x)*(deck.slopeX??0)-DECK_FOOT-.05);
 }
 return ceiling;
}

const FACTORS=[.9,.75,.62,.5,.4,.32,.25,.2,.16,.12];
const DROPS=[0,.8,1.6,2.4,3.2,4,5,6.5,8,10];
const offenders=[],replacements=[];
const rings=new Map();
for(const rock of rocks){
 if(!intrusion(rock))continue;
 const box=orientedBox(rock);
 offenders.push({name:rock.name,material:rock.material,before:intrusion(rock),box});
 // Laje de posto: entra na reconstrução da saia da plataforma, não numa troca 1 para 1.
 const outpost=floors.find(floor=>Math.hypot(box.x-floor.x,box.z-floor.z)<Math.max(floor.width,floor.depth));
 if(outpost&&/dressed/.test(rock.name)){
  const list=rings.get(outpost.id)??[];list.push(rock);rings.set(outpost.id,list);continue;
 }
 // Demais ofensores (franja da ilha nas cabeceiras): encolhe e afunda até sair do corredor.
 const size=extents(rock);
 let chosen;
 for(const drop of DROPS)for(const factor of FACTORS){
  if(chosen)break;
  if(Math.max(size.width,size.depth)*factor>MAX_FOOTPRINT||size.height*factor>MAX_HEIGHT)continue;
  if(intrusion(rock,factor,drop))continue;
  chosen={factor,drop};
 }
 if(!chosen){console.warn('  sem substituição limpa para',rock.name);continue;}
 const centre=toWorld(rock,[(size.minU+size.maxU)/2,size.minY,(size.minV+size.maxV)/2],chosen.factor,chosen.drop);
 replacements.push({
  id:rock.name.replace(/[^\w.]+/g,'-')+'-fix',
  x:round(centre[0]),y:round(centre[1]),z:round(centre[2]),
  // `buildOutcropGeometry` usa (largura, altura, profundidade) no eixo do mundo antes do giro.
  size:[round(size.width*chosen.factor),round(size.height*chosen.factor),round(size.depth*chosen.factor)],
  rotation:round(rock.yaw,1e6),tiltX:0,tiltZ:0,warp:.07,seed:offenders.length,
 });
}

/**
 * Saia nova de cada posto.
 *
 * As 16 lajes de 30 × 64 m viram um anel de pedras de porte coerente, encostadas na beira da
 * plataforma e com o topo abaixo do piso — a plataforma volta a ter massa de rocha embaixo sem
 * nada atravessando a cerca. Escala, giro, inclinação e deformação saem de hash determinístico.
 */
for(const [id,group] of rings){
 const floor=floors.find(surface=>surface.id===id);
 const count=Math.max(10,group.length);
 const seed=Math.round(floor.x*13+floor.z*7);
 for(let i=0;i<count;i++){
  const angle=(i+hash(seed,i*3+1)*.6)/count*Math.PI*2;
  const reach=1.02+hash(seed,i*3+2)*.16;
  const width=9+hash(seed,i*3+3)*6,depth=8+hash(seed,i*3+4)*7,height=4.5+hash(seed,i*3+5)*3;
  const x=floor.x+Math.cos(angle)*floor.width/2*reach,z=floor.z+Math.sin(angle)*floor.depth/2*reach;
  const ceiling=clearTop(x,z,Math.max(width,depth));
  const top=Math.min(floor.height-.25,ceiling);
  replacements.push({
   id:`${id}-skirt-${i}`,x:round(x),y:round(top-height),z:round(z),
   size:[round(width),round(height),round(depth)],
   rotation:round(hash(seed,i*3+6)*Math.PI*2,1e6),
   tiltX:round((hash(seed,i*3+7)-.5)*.2,1e6),tiltZ:round((hash(seed,i*3+8)-.5)*.2,1e6),
   warp:round(.06+hash(seed,i*3+9)*.08,1e6),seed:seed+i,
  });
 }
}
function round(value,factor=1e4){return Math.round(value*factor)/factor;}

console.log('ofensores:',offenders.length,'· substituições:',replacements.length);
for(const offender of offenders.slice(0,8))console.log(`  ${offender.name.padEnd(24)} vértices no corredor ${offender.before}`);

const data={
 provenance:{
  source:SOURCE,script:'scripts/plan-initial-rocks.mjs',
  note:'Plano derivado por leitura. Nenhum modelo original foi alterado. As caixas apagam a colisão '+
       'da instância ofensora e escondem a malha dela; as substituições usam a MESMA rocha escaneada '+
       '(public/models/outcrop-rocks.json) em escala coerente, e geram visual e colisão do mesmo array.',
  cause:'finish-farm-world.py scan(): s=height/extensão-local-Z multiplica os três eixos, então "altura 7 m" '+
        'estica a laje costeira de 4,89 × 10,45 m para 29,9 × 63,8 m.',
 },
 walkableReach:WALKABLE_REACH,headRoom:HEAD_ROOM,
 offenders,replacements,
};
fs.writeFileSync(TARGET,JSON.stringify(data));
console.log('INITIAL ROCK FIX',offenders.length,'ofensores →',TARGET,(fs.statSync(TARGET).size/1024).toFixed(1),'KB');
