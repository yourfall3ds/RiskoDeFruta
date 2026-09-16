import {appendGeometry,type TerrainGeometry} from './TerrainPatch';
import {buildOutcropGeometry,type OrientedVolume,type OutcropPlacement,type OutcropShape} from './RockOutcrops';

/**
 * Correção das pedras do CAMPO INICIAL que invadem ponte, cerca e plataforma.
 *
 * A causa está medida em `scripts/plan-initial-rocks.mjs`: `finish-farm-world.py` escala a laje
 * costeira pela ALTURA pedida (`s = height / extensão-local-Z`), então "7 m de altura" multiplica os
 * três eixos por 5,09 e transforma uma laje de 4,89 × 10,45 m numa de 29,9 × 63,8 m. Dezesseis
 * dessas em volta de um posto de 10 × 11 m atravessam o deck da ponte e sobem acima do piso.
 *
 * Aqui só se APLICA o plano derivado: apagar a colisão das instâncias ofensoras, esconder a malha
 * delas e acrescentar a saia nova — visual e colisão saindo do mesmo array, como no resto do relevo.
 */

export interface InitialRockFix {
 offenders:readonly{name:string;material?:string;before?:number;box:OrientedVolume}[];
 replacements:readonly OutcropPlacement[];
 walkableReach?:number;
 headRoom?:number;
}

/** Folga somada à caixa do plano, para absorver a decimação da malha de colisão. */
const CARVE_MARGIN=.35;
/**
 * Mínimo de triângulos para um pedaço conectado dentro da caixa contar como a PEDRA.
 *
 * Este é o critério que impede a correção de comer estrutura. As instâncias de rocha entram na
 * colisão decimadas para ~500 triângulos; tábua de ponte, poste, corda de suspensão e caixote têm
 * uma ou duas dezenas, e o disco de solo do posto tem 48. Cortar por "triângulo pequeno dentro da
 * caixa" apagaria as cordas laterais da ponte — que são justamente a barreira que impede cair.
 */
const MIN_INSTANCE_TRIANGLES=100;

function inside(volume:OrientedVolume,x:number,y:number,z:number,margin:number):boolean {
 if(Math.abs(y-volume.y)>volume.hy+margin)return false;
 const cos=Math.cos(volume.rotation),sin=Math.sin(volume.rotation),dx=x-volume.x,dz=z-volume.z;
 return Math.abs(dx*cos+dz*sin)<=volume.hx+margin&&Math.abs(-dx*sin+dz*cos)<=volume.hz+margin;
}

/**
 * Apaga da colisão as INSTÂNCIAS contidas nos volumes, preservando tudo que não é instância.
 *
 * Trabalha por componente conectado: um triângulo só cai se o pedaço conectado a que ele pertence
 * estiver inteiro dentro de um volume E for grande o bastante para ser a rocha. Assim a tábua, o
 * poste e a corda que passam por dentro da mesma caixa continuam colidindo.
 */
export function carveInstances(
 positions:readonly number[],indices:readonly number[],volumes:readonly OrientedVolume[],
 {margin=CARVE_MARGIN,minTriangles=MIN_INSTANCE_TRIANGLES}:{margin?:number;minTriangles?:number}={},
):{indices:number[];removed:number;instances:number} {
 if(!volumes.length)return{indices:[...indices],removed:0,instances:0};
 // Grade de 16 m sobre os volumes: sem ela cada triângulo testaria todas as caixas.
 const cell=16,grid=new Map<string,OrientedVolume[]>();
 let reach=0;for(const volume of volumes)reach=Math.max(reach,Math.hypot(volume.hx,volume.hz)+margin);
 for(const volume of volumes)
  for(let cx=Math.floor((volume.x-reach)/cell);cx<=Math.floor((volume.x+reach)/cell);cx++)
   for(let cz=Math.floor((volume.z-reach)/cell);cz<=Math.floor((volume.z+reach)/cell);cz++){
    const key=`${cx},${cz}`,list=grid.get(key);
    if(list)list.push(volume);else grid.set(key,[volume]);
   }
 /** Índice do volume que contém os TRÊS vértices, ou -1; -2 quando o triângulo só encosta na região. */
 const owner:number[]=[];const candidates:number[]=[];
 const volumeIndex=new Map<OrientedVolume,number>();volumes.forEach((volume,index)=>volumeIndex.set(volume,index));
 for(let i=0;i<indices.length;i+=3){
  const a=indices[i]!*3,b=indices[i+1]!*3,c=indices[i+2]!*3;
  let touches=false,contained=-1;
  for(const corner of [a,b,c]){
   const near=grid.get(`${Math.floor(positions[corner]!/cell)},${Math.floor(positions[corner+2]!/cell)}`);
   if(!near)continue;
   for(const volume of near){
    if(!inside(volume,positions[corner]!,positions[corner+1]!,positions[corner+2]!,margin))continue;
    touches=true;
    if(contained>=0)continue;
    if(inside(volume,positions[a]!,positions[a+1]!,positions[a+2]!,margin)&&inside(volume,positions[b]!,positions[b+1]!,positions[b+2]!,margin)&&inside(volume,positions[c]!,positions[c+1]!,positions[c+2]!,margin))contained=volumeIndex.get(volume)!;
   }
   if(touches&&contained>=0)break;
  }
  if(!touches)continue;
  candidates.push(i);owner[i]=contained;
 }
 if(!candidates.length)return{indices:[...indices],removed:0,instances:0};
 // Union-find sobre tudo que ENCOSTA na região. Um componente só é instância quando TODOS os seus
 // triângulos cabem na mesma caixa: a massa profunda da ilha, que atravessa a caixa e segue abaixo
 // dela, tem triângulos de fora e por isso sobrevive inteira.
 const parent=new Map<number,number>();
 const find=(v:number):number=>{let root=parent.get(v)??v;while(root!==(parent.get(root)??root))root=parent.get(root)??root;let node=v;while(node!==root){const next=parent.get(node)??node;parent.set(node,root);node=next;}return root;};
 const union=(a:number,b:number):void=>{const ra=find(a),rb=find(b);if(ra!==rb)parent.set(ra,rb);};
 for(const i of candidates){
  const a=indices[i]!,b=indices[i+1]!,c=indices[i+2]!;
  parent.set(a,parent.get(a)??a);parent.set(b,parent.get(b)??b);parent.set(c,parent.get(c)??c);
  union(a,b);union(b,c);
 }
 const sizes=new Map<number,number>(),homes=new Map<number,number>();
 for(const i of candidates){
  const root=find(indices[i]!);
  sizes.set(root,(sizes.get(root)??0)+1);
  const home=homes.get(root);
  if(home===undefined)homes.set(root,owner[i]!);
  else if(home!==owner[i])homes.set(root,-1);
 }
 const doomed=new Set<number>();
 let instances=0;
 for(const [root,size] of sizes)if(size>=minTriangles&&(homes.get(root)??-1)>=0){doomed.add(root);instances++;}
 if(!doomed.size)return{indices:[...indices],removed:0,instances:0};
 const drop=new Set(candidates.filter(i=>doomed.has(find(indices[i]!))));
 const kept:number[]=[];
 for(let i=0;i<indices.length;i+=3){
  if(drop.has(i))continue;
  kept.push(indices[i]!,indices[i+1]!,indices[i+2]!);
 }
 return{indices:kept,removed:drop.size,instances};
}

export interface InitialRockResult {
 /** Nós que precisam sumir do visual — a colisão deles já saiu. */
 hidden:readonly string[];
 /** Saia nova: visual e colisão do mesmo array. */
 geometry:TerrainGeometry|undefined;
 removedTriangles:number;
 removedInstances:number;
 placements:readonly OutcropPlacement[];
}

/**
 * Aplica o plano na colisão do campo inicial, mutando `data` como o resto do relevo faz.
 * Sem plano ou sem a rocha escaneada, devolve um resultado vazio e nada muda.
 */
export function applyInitialRockFix(
 data:{positions:number[];indices:number[]},
 fix:InitialRockFix|undefined,
 shape:OutcropShape|undefined,
):InitialRockResult {
 const empty:InitialRockResult={hidden:[],geometry:undefined,removedTriangles:0,removedInstances:0,placements:[]};
 if(!fix?.offenders.length||!shape)return empty;
 const carved=carveInstances(data.positions,data.indices,fix.offenders.map(offender=>offender.box));
 data.indices=carved.indices;
 const geometry=fix.replacements.length?buildOutcropGeometry(shape,fix.replacements,{naturalSize:shape.sourceExtent}):undefined;
 if(geometry)appendGeometry(data,geometry);
 return{
  hidden:fix.offenders.map(offender=>offender.name),
  geometry,removedTriangles:carved.removed,removedInstances:carved.instances,
  placements:fix.replacements,
 };
}
