import {computeNormals,type TerrainGeometry} from './TerrainPatch';
import {HIGHLAND_ISLANDS,highlandElevation} from './ReliefPlans';
import type {SculptedTerrain} from './SculptedTerrain';

/**
 * Afloramentos de rocha: substituem o anel de picos idênticos da borda das ilhas.
 *
 * O problema relatado pela direção de arte é concreto e está no script de autoria: cada ilha dos
 * planaltos recebe 14 instâncias de `coast_land_rocks_02` em ângulos EXATAMENTE regulares, no MESMO
 * raio (0,86) e com a MESMA escala (10 × 4 × 8) — daí a fileira de picos alinhados no horizonte.
 *
 * A troca aqui não é "girar cada pedra um pouco". É:
 *  1. remover de verdade os triângulos de colisão daquelas instâncias (`ringVolumes` + `carveVolumes`),
 *  2. esconder as malhas correspondentes,
 *  3. gerar aglomerados irregulares — quantidade, ângulo, raio, escala, giro, inclinação e DEFORMAÇÃO
 *     de forma variados — com a mesma geometria escaneada, nunca com primitiva procedural.
 *
 * Cada afloramento gera visual e colisão do MESMO array de vértices, e nasce parcialmente enterrado
 * no terreno esculpido, então tem topo pisável coerente, encosta íngreme onde a malha é íngreme, e
 * nunca flutua. Não existe nenhuma caixa invisível: a colisão é a própria rocha.
 */

/**
 * Geometria normalizada da rocha escaneada (`public/models/outcrop-rocks.json`).
 * `sourceExtent` é o tamanho ORIGINAL do scan em metros — é ele que define a densidade de texel
 * para a qual a UV foi autorada.
 */
export interface OutcropShape {positions:readonly number[];uvs:readonly number[];indices:readonly number[];sourceExtent?:readonly number[]}

export interface OutcropPlacement {
 id:string;x:number;y:number;z:number;
 /** Extensão em metros nos eixos do mundo, antes do giro. */
 size:[number,number,number];
 /** Giro em torno de Y, e duas inclinações pequenas que tiram a pedra do prumo. */
 rotation:number;tiltX:number;tiltZ:number;
 /** Amplitude da deformação de silhueta, em fração do tamanho. */
 warp:number;seed:number;
}

/** Caixa orientada usada para apagar a colisão de uma instância antiga. */
export interface OrientedVolume {x:number;y:number;z:number;hx:number;hy:number;hz:number;rotation:number}

function hash(seed:number,salt:number):number{
 let h=Math.imul(seed|0,374761393)^Math.imul(salt|0,668265263);
 h=Math.imul(h^(h>>>13),1274126177);
 return((h^(h>>>16))>>>0)/4294967296;
}

/**
 * Volumes das 14 instâncias de borda de cada ilha, reproduzindo o laço do script de autoria
 * (inclusive a folga de ponte, que já pulava algumas). São eles que saem da colisão.
 */
export function ringVolumes():OrientedVolume[] {
 const volumes:OrientedVolume[]=[];
 for(const island of HIGHLAND_ISLANDS){
  for(let k=0;k<14;k++){
   const angle=k/14*Math.PI*2;
   const x=island.x+Math.cos(angle)*island.rx*.86,z=island.z+Math.sin(angle)*island.rz*.86;
   if(!clearOfHighlandBridges(x,z))continue;
   // O `instance()` do Blender entrega 10 m em X, 4 m em altura e 8 m em Z, e o `load_asset` deixa a
   // BASE da rocha em z=0 local: a instância ocupa [y, y+4], não y±2. O giro medido contra a malha
   // assada é `+angle` (o espelhamento de X do glTF já está embutido no eixo que gira).
   const base=highlandElevation(x,z,island)-1.4;
   volumes.push({x,y:base+2,z,hx:5.3,hy:2.3,hz:4.3,rotation:angle});
  }
 }
 return volumes;
}

/** Mesma folga de ponte do script de autoria dos planaltos. */
function clearOfHighlandBridges(x:number,z:number):boolean {
 const segments=[[354,280,410,280],[586,297,636,306],[539,363,573,434],[689,393,658,440]] as const;
 for(const [ax,az,bx,bz] of segments){
  const dx=bx-ax,dz=bz-az,t=Math.max(0,Math.min(1,((x-ax)*dx+(z-az)*dz)/(dx*dx+dz*dz)));
  if(Math.hypot(x-ax-t*dx,z-az-t*dz)<12)return false;
 }
 return true;
}

/**
 * Remove triângulos contidos nos volumes.
 *
 * O critério é duplo de propósito: além de estar inteiramente dentro da caixa orientada, o triângulo
 * precisa ser PEQUENO (aresta menor que `maxEdge`). A malha de terreno da ilha tem arestas de ~8 m e
 * caberia numa caixa de 10 × 8 m; a malha escaneada da pedra tem arestas de centímetros. Sem o teste
 * de tamanho, apagar as pedras abriria um buraco no chão.
 */
export function carveVolumes(
 positions:readonly number[],indices:readonly number[],volumes:readonly OrientedVolume[],maxEdge=2.5,
):{indices:number[];removed:number} {
 if(!volumes.length)return{indices:[...indices],removed:0};
 const kept:number[]=[];let removed=0;
 // Grade de 16 m sobre os volumes: sem ela, cada um dos ~180 mil triângulos da região testaria os
 // 41 volumes, e a esculpida vira custo de ativação visível ao entrar na região.
 const cell=16,grid=new Map<string,OrientedVolume[]>();
 const reach=Math.max(...volumes.map(v=>Math.hypot(v.hx,v.hz)));
 for(const volume of volumes)
  for(let cx=Math.floor((volume.x-reach)/cell);cx<=Math.floor((volume.x+reach)/cell);cx++)
   for(let cz=Math.floor((volume.z-reach)/cell);cz<=Math.floor((volume.z+reach)/cell);cz++){
    const key=`${cx},${cz}`,list=grid.get(key);
    if(list)list.push(volume);else grid.set(key,[volume]);
   }
 const inside=(x:number,y:number,z:number,v:OrientedVolume):boolean=>{
  if(Math.abs(y-v.y)>v.hy)return false;
  const cos=Math.cos(v.rotation),sin=Math.sin(v.rotation),dx=x-v.x,dz=z-v.z;
  return Math.abs(dx*cos+dz*sin)<=v.hx&&Math.abs(-dx*sin+dz*cos)<=v.hz;
 };
 const maxEdgeSquared=maxEdge*maxEdge;
 for(let i=0;i<indices.length;i+=3){
  const a=indices[i]!*3;
  const candidates=grid.get(`${Math.floor(positions[a]!/cell)},${Math.floor(positions[a+2]!/cell)}`);
  let drop=false;
  if(candidates){
   const b=indices[i+1]!*3,c=indices[i+2]!*3;
   const longest=Math.max(
    (positions[b]!-positions[a]!)**2+(positions[b+1]!-positions[a+1]!)**2+(positions[b+2]!-positions[a+2]!)**2,
    (positions[c]!-positions[b]!)**2+(positions[c+1]!-positions[b+1]!)**2+(positions[c+2]!-positions[b+2]!)**2,
    (positions[a]!-positions[c]!)**2+(positions[a+1]!-positions[c+1]!)**2+(positions[a+2]!-positions[c+2]!)**2,
   );
   if(longest<=maxEdgeSquared)for(const volume of candidates){
    if(inside(positions[a]!,positions[a+1]!,positions[a+2]!,volume)&&inside(positions[b]!,positions[b+1]!,positions[b+2]!,volume)&&inside(positions[c]!,positions[c+1]!,positions[c+2]!,volume)){drop=true;break;}
   }
  }
  if(drop){removed++;continue;}
  kept.push(indices[i]!,indices[i+1]!,indices[i+2]!);
 }
 return{indices:kept,removed};
}

/** Distância mínima entre afloramentos e qualquer estrutura/ponte/âncora, em metros. */
const CLEARANCE=6;

/**
 * Aglomerados irregulares por ilha.
 *
 * Quantidade por aglomerado, ângulo, raio, escala e deformação saem todos de um hash determinístico
 * da ilha e do índice — mesmo resultado no cliente e no servidor, nenhuma chamada a `Math.random`.
 * Nenhum afloramento nasce sobre o corredor de uma ponte, sobre uma estrutura ou sobre uma âncora de
 * recompensa: a checagem reaproveita as MESMAS exclusões do plano de relevo.
 */
export function highlandOutcrops(terrain:SculptedTerrain|undefined,blocked:(x:number,z:number)=>boolean):OutcropPlacement[] {
 const placements:OutcropPlacement[]=[];
 for(const island of HIGHLAND_ISLANDS){
  const islandSeed=Math.round(island.x*7+island.z*13);
  for(let cluster=0;cluster<5;cluster++){
   const base=(cluster+hash(islandSeed,cluster*3+1)*.72)/5*Math.PI*2;
   const radius=.76+hash(islandSeed,cluster*3+2)*.15;
   const count=2+Math.floor(hash(islandSeed,cluster*3+3)*3);
   for(let k=0;k<count;k++){
    const salt=cluster*31+k*7;
    const angle=base+(hash(islandSeed,salt+11)-.5)*.16;
    const reach=radius+(hash(islandSeed,salt+12)-.5)*.07;
    const x=island.x+Math.cos(angle)*island.rx*reach,z=island.z+Math.sin(angle)*island.rz*reach;
    if(blocked(x,z))continue;
    const width=5.5+hash(islandSeed,salt+13)*8.5,depth=4.5+hash(islandSeed,salt+14)*7;
    const tall=2.6+hash(islandSeed,salt+15)*4.2;
    const ground=highlandElevation(x,z,island)+(terrain?.offsetAt(x,z)??0);
    placements.push({
     id:`${island.id}-outcrop-${cluster}-${k}`,x,z,
     // Enterrado ~38% da altura: garante encaixe no terreno, sem pedra boiando nem topo inalcançável.
     y:ground-tall*.38,
     size:[width,tall,depth],
     rotation:hash(islandSeed,salt+16)*Math.PI*2,
     tiltX:(hash(islandSeed,salt+17)-.5)*.22,tiltZ:(hash(islandSeed,salt+18)-.5)*.22,
     warp:.06+hash(islandSeed,salt+19)*.09,seed:islandSeed+salt,
    });
   }
  }
  // Dois afloramentos internos por ilha, nos relevos altos: quebram a leitura de "pedra só na borda".
  for(let k=0;k<2;k++){
   const angle=hash(islandSeed,700+k)*Math.PI*2,reach=.28+hash(islandSeed,720+k)*.22;
   const x=island.x+Math.cos(angle)*island.rx*reach,z=island.z+Math.sin(angle)*island.rz*reach;
   if(blocked(x,z))continue;
   const tall=2.2+hash(islandSeed,740+k)*2.6;
   const ground=highlandElevation(x,z,island)+(terrain?.offsetAt(x,z)??0);
   placements.push({
    id:`${island.id}-outcrop-interno-${k}`,x,z,y:ground-tall*.42,
    size:[4.5+hash(islandSeed,760+k)*4,tall,4+hash(islandSeed,780+k)*3.5],
    rotation:hash(islandSeed,800+k)*Math.PI*2,
    tiltX:(hash(islandSeed,820+k)-.5)*.18,tiltZ:(hash(islandSeed,840+k)-.5)*.18,
    warp:.07+hash(islandSeed,860+k)*.08,seed:islandSeed+900+k,
   });
  }
 }
 return placements;
}

/**
 * Bloqueio padrão: estruturas, pontes e âncoras do plano, mais os corredores das trilhas.
 *
 * As trilhas não são exclusão de relevo (elas ACOMPANHAM o relevo), mas são caminho obrigatório:
 * nenhum afloramento pode nascer em cima delas. Por isso entram aqui explicitamente.
 */
export function outcropBlocker(terrain:SculptedTerrain|undefined,extra:readonly{x:number;z:number;radius?:number}[]=[]):(x:number,z:number)=>boolean {
 const areas=terrain?.patches.flatMap(patch=>patch.plan.exclusions)??[];
 const trails=terrain?.patches.flatMap(patch=>patch.plan.paths)??[];
 return(x,z)=>{
  for(const site of extra)if(Math.hypot(x-site.x,z-site.z)<(site.radius??CLEARANCE))return true;
  for(const trail of trails){
   const reach=trail.halfWidth+CLEARANCE;
   for(let i=0;i+1<trail.points.length;i++){
    const a=trail.points[i]!,b=trail.points[i+1]!,dx=b[0]-a[0],dz=b[1]-a[1];
    const t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/Math.max(1e-9,dx*dx+dz*dz)));
    if(Math.hypot(x-a[0]-t*dx,z-a[1]-t*dz)<=reach)return true;
   }
  }
  for(const area of areas){
   if(area.shape==='disc'){if(Math.hypot((x-area.x)/Math.max(area.rx,1e-3),(z-area.z)/Math.max(area.rz,1e-3))<=1)return true;continue;}
   if(area.shape==='rect'){
    const angle=area.angle??0,cos=Math.cos(angle),sin=Math.sin(angle),dx=x-area.x,dz=z-area.z;
    if(Math.abs(dx*cos+dz*sin)<=area.hx&&Math.abs(-dx*sin+dz*cos)<=area.hz)return true;
    continue;
   }
   for(let i=0;i+1<area.points.length;i++){
    const a=area.points[i]!,b=area.points[i+1]!,dx=b[0]-a[0],dz=b[1]-a[1];
    const t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/Math.max(1e-9,dx*dx+dz*dz)));
    if(Math.hypot(x-a[0]-t*dx,z-a[1]-t*dz)<=area.halfWidth)return true;
   }
  }
  return false;
 };
}

/** Deformação suave da silhueta, em espaço normalizado. Determinística e sem descontinuidade. */
function warpVertex(px:number,py:number,pz:number,amount:number,seed:number):[number,number,number]{
 const s=(n:number)=>hash(seed,n)*Math.PI*2;
 return[
  px+amount*Math.sin(py*3.1+s(1))*Math.cos(pz*2.3+s(2)),
  py+amount*.6*Math.sin(px*2.7+s(3))*Math.cos(pz*3.3+s(4)),
  pz+amount*Math.sin(px*3.5+s(5))*Math.cos(py*2.1+s(6)),
 ];
}

/**
 * Quanto a UV pode ser reescalada para manter a densidade de texel.
 *
 * A UV do scan foi autorada para o tamanho original dele; uma pedra maior que isso estica a textura
 * — é literalmente o "mapa de baixa resolução esticado em pedra gigante" da revisão. Reescalar a UV
 * pelo fator de tamanho devolve a densidade, mas repetir demais uma textura de fotogrametria mostra
 * costura, então o fator é limitado dos dois lados.
 */
const UV_DENSITY_RANGE=[.7,2.2] as const;

function uvDensity(size:readonly number[],natural:readonly number[]|undefined):number {
 if(!natural||natural.length<3)return 1;
 const width=Math.max(1e-3,natural[0]!),depth=Math.max(1e-3,natural[2]!);
 const factor=Math.sqrt((size[0]!/width)*(size[2]!/depth));
 if(!Number.isFinite(factor)||factor<=0)return 1;
 return Math.min(UV_DENSITY_RANGE[1],Math.max(UV_DENSITY_RANGE[0],factor));
}

/**
 * Instancia os afloramentos numa única geometria.
 *
 * O mesmo retorno vira `VertexData` no cliente e triângulos de colisão nos dois lados. Uma malha só
 * para todos os afloramentos da região: uma chamada de desenho no lugar das 41 instâncias antigas.
 *
 * `naturalSize` liga a correção de densidade de UV: passe `shape.sourceExtent`.
 */
export function buildOutcropGeometry(shape:OutcropShape,placements:readonly OutcropPlacement[],{naturalSize}:{naturalSize?:readonly number[]|undefined}={}):TerrainGeometry {
 const geometry:TerrainGeometry={positions:[],normals:[],uvs:[],indices:[]};
 const vertices=shape.positions.length/3;
 for(const placement of placements){
  const density=uvDensity(placement.size,naturalSize);
  const offset=geometry.positions.length/3;
  const cos=Math.cos(placement.rotation),sin=Math.sin(placement.rotation);
  const cx=Math.cos(placement.tiltX),sx=Math.sin(placement.tiltX);
  const cz=Math.cos(placement.tiltZ),sz=Math.sin(placement.tiltZ);
  for(let i=0;i<vertices;i++){
   const [wx,wy,wz]=warpVertex(shape.positions[i*3]!,shape.positions[i*3+1]!,shape.positions[i*3+2]!,placement.warp,placement.seed);
   let x=wx*placement.size[0],y=wy*placement.size[1],z=wz*placement.size[2];
   // Inclinação: X depois Z, ambas pequenas — a pedra sai do prumo sem deitar.
   [y,z]=[y*cx-z*sx,y*sx+z*cx];
   [x,y]=[x*cz-y*sz,x*sz+y*cz];
   const rx=x*cos+z*sin,rz=-x*sin+z*cos;
   geometry.positions.push(placement.x+rx,placement.y+y,placement.z+rz);
   geometry.normals.push(0,1,0);
   // Deslocamento por instância junto com a repetição: duas pedras vizinhas não mostram o mesmo trecho.
   geometry.uvs.push((shape.uvs[i*2]??0)*density+hash(placement.seed,91),(shape.uvs[i*2+1]??0)*density+hash(placement.seed,92));
  }
  for(const index of shape.indices)geometry.indices.push(offset+index);
 }
 computeNormals(geometry);
 return geometry;
}
