import {ReliefField,type ReliefPlan} from './ReliefField';

/** Malha esculpida. Os MESMOS arrays viram VertexData no cliente e triângulos de colisão nos dois lados. */
export interface TerrainGeometry {positions:number[];normals:number[];uvs:number[];indices:number[]}

export interface TerrainPatchBuild {
 geometry:TerrainGeometry;
 /**
  * Deslocamento vertical LIDO DA MALHA no ponto (0 fora do retalho).
  *
  * É a mesma interpolação de triângulo que a cápsula pisa e que o olho vê, não o campo analítico:
  * onde a máscara varia rápido dentro de uma célula, os dois divergem em dezenas de centímetros, e é
  * a malha que manda. Prop, vegetação e decalque de trilha sobem por aqui — por isso nada flutua.
  */
 sample(x:number,z:number):number;
}

/**
 * Gera a malha de relevo de um plano.
 *
 * Só nasce geometria onde o deslocamento é relevante: a célula é emitida quando algum canto passa de
 * `minLift*2`, e todo vértice emitido é levantado a pelo menos `minLift` acima do chão autorado.
 * Duas consequências que valem mais que a economia de triângulos:
 *
 * 1. Dentro das exclusões (porta, ponte, celeiro, âncora de loot) NÃO existe geometria nova, então o
 *    piso ali continua sendo exatamente o assado — nenhuma cota de referência se move.
 * 2. Em nenhum lugar a malha nova fica coplanar com a antiga, então não há z-fighting nem empate no
 *    `max()` de `groundAt`.
 *
 * A borda do retalho é um degrau de `minLift` (2 cm por padrão) contra o chão antigo: abaixo de
 * qualquer limite de passo e invisível, e é o preço de não precisar recortar a malha assada.
 */
export function buildTerrainPatch(plan:ReliefPlan):TerrainPatchBuild {
 const field=new ReliefField(plan),{minX,maxX,minZ,maxZ}=plan.bounds;
 const step=Math.max(plan.resolution,.05);
 const columns=Math.max(1,Math.ceil((maxX-minX)/step)),rows=Math.max(1,Math.ceil((maxZ-minZ)/step));
 const stride=columns+1;
 const offsets=new Float64Array(stride*(rows+1));
 for(let iz=0;iz<=rows;iz++)for(let ix=0;ix<=columns;ix++)offsets[iz*stride+ix]=field.offsetAt(minX+ix*step,minZ+iz*step);
 const geometry:TerrainGeometry={positions:[],normals:[],uvs:[],indices:[]};
 const emitted=new Int32Array(stride*(rows+1)).fill(-1);
 const live=new Uint8Array(columns*rows);
 const threshold=plan.minLift*2;
 const vertex=(ix:number,iz:number):number=>{
  const slot=iz*stride+ix;
  const existing=emitted[slot]!;if(existing>=0)return existing;
  const x=minX+ix*step,z=minZ+iz*step,y=plan.base(x,z)+Math.max(offsets[slot]!,plan.minLift);
  const index=geometry.positions.length/3;
  geometry.positions.push(x,y,z);geometry.normals.push(0,1,0);
  // Mesmo enquadramento de UV do chão autorado no Blender (x e z invertidos na exportação).
  geometry.uvs.push(-x/plan.uvScale,-z/plan.uvScale);
  emitted[slot]=index;return index;
 };
 for(let iz=0;iz<rows;iz++)for(let ix=0;ix<columns;ix++){
  const a=offsets[iz*stride+ix]!,b=offsets[iz*stride+ix+1]!;
  const c=offsets[(iz+1)*stride+ix]!,d=offsets[(iz+1)*stride+ix+1]!;
  if(a<threshold&&b<threshold&&c<threshold&&d<threshold)continue;
  live[iz*columns+ix]=1;
  const v00=vertex(ix,iz),v10=vertex(ix+1,iz),v01=vertex(ix,iz+1),v11=vertex(ix+1,iz+1);
  // Diagonal pela menor variação: evita a serrilha diagonal característica em crista e terraço.
  // A ordem dos índices reproduz a de `CreateGround` do Babylon, que é a face vista de cima.
  if(Math.abs(a-d)<=Math.abs(b-c))geometry.indices.push(v00,v10,v11,v00,v11,v01);
  else geometry.indices.push(v10,v11,v01,v00,v10,v01);
 }
 computeNormals(geometry);
 const lift=(slot:number):number=>Math.max(offsets[slot]!,plan.minLift);
 const sample=(x:number,z:number):number=>{
  const gx=(x-minX)/step,gz=(z-minZ)/step;
  if(!(gx>=0&&gz>=0&&gx<=columns&&gz<=rows))return 0;
  const ix=Math.min(columns-1,Math.floor(gx)),iz=Math.min(rows-1,Math.floor(gz));
  if(!live[iz*columns+ix])return 0;
  const fx=gx-ix,fz=gz-iz;
  const a=lift(iz*stride+ix),b=lift(iz*stride+ix+1),c=lift((iz+1)*stride+ix),d=lift((iz+1)*stride+ix+1);
  // Mesma diagonal escolhida na emissão, interpolada dentro do triângulo correspondente.
  if(Math.abs(offsets[iz*stride+ix]!-offsets[(iz+1)*stride+ix+1]!)<=Math.abs(offsets[iz*stride+ix+1]!-offsets[(iz+1)*stride+ix]!))
   return fz<=fx?a+(b-a)*fx+(d-b)*fz:a+(d-c)*fx+(c-a)*fz;
  return fx+fz<=1?a+(b-a)*fx+(c-a)*fz:d+(c-d)*(1-fx)+(b-d)*(1-fz);
 };
 return{geometry,sample};
}

/**
 * Normais por acúmulo das faces reais, na mesma convenção de `VertexData.ComputeNormals`
 * (`(a-b) × (c-b)`), que para o winding acima aponta para cima.
 *
 * Deliberadamente NÃO se usa o gradiente analítico do campo: onde o deslocamento é achatado em
 * `minLift` a malha é plana e o gradiente não seria. Sombrear pela face é o que faz a superfície
 * desenhada corresponder à superfície que a cápsula pisa.
 */
export function computeNormals(geometry:TerrainGeometry):void {
 const {positions,indices,normals}=geometry;
 normals.fill(0);
 for(let i=0;i<indices.length;i+=3){
  const a=indices[i]!*3,b=indices[i+1]!*3,c=indices[i+2]!*3;
  const ux=positions[a]!-positions[b]!,uy=positions[a+1]!-positions[b+1]!,uz=positions[a+2]!-positions[b+2]!;
  const vx=positions[c]!-positions[b]!,vy=positions[c+1]!-positions[b+1]!,vz=positions[c+2]!-positions[b+2]!;
  const nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;
  for(const base of [a,b,c]){normals[base]!+=nx;normals[base+1]!+=ny;normals[base+2]!+=nz;}
 }
 for(let i=0;i<normals.length;i+=3){
  const length=Math.hypot(normals[i]!,normals[i+1]!,normals[i+2]!)||1;
  normals[i]=normals[i]!/length;normals[i+1]=normals[i+1]!/length;normals[i+2]=normals[i+2]!/length;
 }
}

/** Anexa uma geometria a um par (positions,indices) deslocando os índices, como `FarmWorld.load`. */
export function appendGeometry(target:{positions:number[];indices:number[]},source:{positions:readonly number[];indices:readonly number[]}):void {
 const offset=target.positions.length/3;
 for(const value of source.positions)target.positions.push(value);
 for(const index of source.indices)target.indices.push(index+offset);
}
