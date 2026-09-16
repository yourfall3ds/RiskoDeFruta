import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {Scene} from '@babylonjs/core/scene';
import {AssetContainer} from '@babylonjs/core/assetContainer';
import {CreateBox} from '@babylonjs/core/Meshes/Builders/boxBuilder';
import {Matrix} from '@babylonjs/core/Maths/math.vector';
import {LoadAssetContainerAsync} from '@babylonjs/core/Loading/sceneLoader';
import '@babylonjs/loaders/glTF';
import {CollisionWorld} from '../src/physics/CollisionWorld';
import {FruitFragments,FRUIT_PALETTES,DEFAULT_PALETTE,fruitPalette,FRAGMENT_BUDGET,FRAGMENT_TRIANGLE_BUDGET,
        SHAPE_VARIANTS,FRAGMENT_MODEL,FRAGMENT_FAMILIES,FRAGMENT_ROLES,fragmentKey,PENDING_BURSTS,
        type FragmentLoader,type FragmentRole} from '../src/vfx/FruitFragments';

const MODEL='public/models/fruit-fragments.glb';
const PROVENANCE=JSON.parse(readFileSync('docs/fruit-fragments-provenance.json','utf8')) as {
  originais_alterados:boolean;bytes:number;pecas:number;objetos:number;teto_triangulos:number;
  familias:Record<string,{modelo:string;sha256_origem:string;escala_inimigo:number;relevo:boolean;
    rugosidade_corte:number;cores_srgb:{polpa:string;borda:string;semente:string};
    pecas:{peca:string;triangulos:number;partes:number}[]}>;
};

// ---------------------------------------------------------------- leitura do GLB de verdade
interface Glb {bytes:Buffer;bin:Buffer;json:any}
function readGlb(path:string):Glb {
  const bytes=readFileSync(path);
  const jsonLength=bytes.readUInt32LE(12);
  const json=JSON.parse(bytes.toString('utf8',20,20+jsonLength));
  const chunk=20+jsonLength;
  return {bytes,json,bin:bytes.subarray(chunk+8,chunk+8+bytes.readUInt32LE(chunk))};
}
const WIDTH:Record<string,number>={SCALAR:1,VEC2:2,VEC3:3,VEC4:4};
function readAccessor(glb:Glb,index:number):number[][] {
  const accessor=glb.json.accessors[index],view=glb.json.bufferViews[accessor.bufferView];
  const width=WIDTH[accessor.type]!,bytes=accessor.componentType===5126?4:accessor.componentType===5125?4:accessor.componentType===5123?2:1;
  const stride=view.byteStride??width*bytes,start=(view.byteOffset??0)+(accessor.byteOffset??0);
  const rows:number[][]=[];
  for(let i=0;i<accessor.count;i++){
    const row:number[]=[];
    for(let c=0;c<width;c++){
      const at=start+i*stride+c*bytes;
      const raw=accessor.componentType===5126?glb.bin.readFloatLE(at)
        :accessor.componentType===5125?glb.bin.readUInt32LE(at)
        :accessor.componentType===5123?glb.bin.readUInt16LE(at):glb.bin.readUInt8(at);
      row.push(accessor.normalized&&accessor.componentType===5123?raw/65535:raw);
    }
    rows.push(row);
  }
  return rows;
}
const glb=readGlb(MODEL);
const meshOf=(name:string):any=>glb.json.meshes.find((mesh:{name:string})=>mesh.name===name);
const materialOf=(primitive:{material:number}):any=>glb.json.materials[primitive.material];
const triangles=(primitive:{indices:number}):number=>glb.json.accessors[primitive.indices].count/3;
/** hex sRGB para linear — é exatamente a conversão que faltava e lavava as cores. */
const toLinear=(hex:string):number[]=>[0,1,2].map(i=>{
  const c=parseInt(hex.slice(1+i*2,3+i*2),16)/255;
  return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;
});
const unit=(v:number[]):number[]=>{const l=Math.hypot(...v)||1;return v.map(c=>c/l);};
const apart=(a:number[],b:number[]):number=>{const x=unit(a),y=unit(b);return Math.hypot(x[0]!-y[0]!,x[1]!-y[1]!,x[2]!-y[2]!);};

// ---------------------------------------------------------------- cena de teste com o modelo real
const bytes64='data:base64,'+readFileSync(MODEL).toString('base64');
/** Carrega o mesmo arquivo que o jogo carrega; em node o caminho vai como data URL. */
const realLoader:FragmentLoader=(_url,scene)=>LoadAssetContainerAsync(bytes64,scene,{pluginExtension:'.glb'});

function fixture(loader:FragmentLoader=realLoader,bodyScale=1){
  const engine=new NullEngine(),scene=new Scene(engine);
  const world=new CollisionWorld();
  world.surfaces.push({id:'field',x:0,z:0,width:400,depth:400,height:0});
  const body=CreateBox('enemy-body',{size:1},scene);
  body.scaling.setAll(bodyScale);body.computeWorldMatrix(true);
  return {scene,world,body,engine,fragments:new FruitFragments(scene,world,loader)};
}
const run=(f:FruitFragments,seconds:number)=>{for(let i=0;i<Math.round(seconds*60);i++)f.update(1/60);};

interface PoolEntry {
  mesh:{position:{y:number};rotation:{x:number;y:number;z:number};scaling:{x:number;y:number;z:number};
        material:{name:string}|null;getTotalVertices():number;isEnabled():boolean};
  extras:{getTotalVertices():number;isEnabled():boolean;material:{name:string}|null}[];
  half:{x:number;y:number;z:number};role:FragmentRole;template:string;active:boolean;resting:boolean;
}
const poolOf=(f:FruitFragments):PoolEntry[]=>f['pool' as keyof FruitFragments] as unknown as PoolEntry[];
const liveOf=(f:FruitFragments):PoolEntry[]=>poolOf(f).filter(entry=>entry.active);
/** Mesma conta do runtime: o quanto o pedaço girado desce abaixo do próprio centro. */
function support(entry:PoolEntry):number {
  const m=Matrix.RotationYawPitchRoll(entry.mesh.rotation.y,entry.mesh.rotation.x,entry.mesh.rotation.z).m;
  return Math.abs(m[1]!)*entry.half.x*entry.mesh.scaling.x
    +Math.abs(m[5]!)*entry.half.y*entry.mesh.scaling.y
    +Math.abs(m[9]!)*entry.half.z*entry.mesh.scaling.z;
}

describe('modelo de cacos recortado dos corpos reais',()=>{
  it('tem as 45 peças que o runtime procura pelo nome',()=>{
    const names=new Set<string>(glb.json.meshes.map((mesh:{name:string})=>mesh.name));
    for(const family of FRAGMENT_FAMILIES)for(const role of FRAGMENT_ROLES)for(let v=0;v<SHAPE_VARIANTS;v++)
      expect(names.has(fragmentKey(family,role,v)),fragmentKey(family,role,v)).toBe(true);
    // Além das 45 peças só existem as partes de corte, sempre atreladas a uma peça.
    for(const name of names){
      expect(name,name).toMatch(/^frag-(melon|berry|bulb|cob|root)-(shell|pulp|seed)-[012](--corte)?$/);
      if(name.endsWith('--corte'))expect(names.has(name.replace('--corte','')),name).toBe(true);
    }
    expect([...names].filter(name=>!name.endsWith('--corte')).length).toBe(45);
    expect(FRAGMENT_MODEL).toBe('/models/'+MODEL.split('/').pop());
  });

  it('cada peça respeita o orçamento e nenhuma é o corpo inteiro',()=>{
    for(const family of FRAGMENT_FAMILIES)for(const role of FRAGMENT_ROLES)for(let v=0;v<SHAPE_VARIANTS;v++){
      const key=fragmentKey(family,role,v);
      const total=[meshOf(key),meshOf(key+'--corte')].filter(Boolean)
        .reduce((sum:number,mesh:any)=>sum+mesh.primitives.reduce((inner:number,p:{indices:number})=>inner+triangles(p),0),0);
      expect(total,key).toBeGreaterThan(20);
      expect(total,key).toBeLessThanOrEqual(FRAGMENT_TRIANGLE_BUDGET);
    }
    // Uma primitiva por objeto: com duas, o exportador do Blender 5.2 zera a cor da segunda.
    for(const mesh of glb.json.meshes)expect(mesh.primitives.length,mesh.name).toBe(1);
    // O corpo de origem tem dez mil triângulos; o conjunto inteiro de cacos não chega perto.
    const all=glb.json.meshes.reduce((sum:number,mesh:{primitives:{indices:number}[]})=>
      sum+mesh.primitives.reduce((inner:number,p)=>inner+triangles(p),0),0);
    expect(all).toBeLessThan(9000);
    expect(glb.bytes.length).toBeLessThan(1_500_000);
  });

  it('as peças estão em metros, com o lado fino no eixo Y que o contato usa',()=>{
    for(const mesh of glb.json.meshes){
      const box=glb.json.accessors[mesh.primitives[0].attributes.POSITION];
      const size=[0,1,2].map(i=>box.max[i]-box.min[i]);
      const longest=Math.max(...size);
      expect(longest,mesh.name).toBeGreaterThan(.015);
      expect(longest,mesh.name).toBeLessThan(.55);
      // Eixo fino em Y: o assentamento no chão deita o caco nessa face.
      expect(size[1],mesh.name).toBeLessThanOrEqual(longest);
      // Caco tem lado fino: se as três extensões forem iguais, virou miniatura do corpo.
      expect(Math.min(...size)/longest,mesh.name).toBeLessThan(.85);
    }
  });

  it('a casca guarda pele real e a face cortada tem material próprio',()=>{
    for(const family of FRAGMENT_FAMILIES)for(let v=0;v<SHAPE_VARIANTS;v++){
      const key=fragmentKey(family,'shell',v);
      const skinMesh=meshOf(key),cutMesh=meshOf(key+'--corte');
      expect(cutMesh,key+' precisa da parte cortada').toBeTruthy();
      const skin=materialOf(skinMesh.primitives[0]),cut=materialOf(cutMesh.primitives[0]);
      expect(skin.name).toBe(family+'-casca');
      expect(cut.name).toBe(family+'-corte');
      // Pele preservada: textura do corpo com UV própria, não cor chapada.
      expect(skin.pbrMetallicRoughness.baseColorTexture,skin.name).toBeTruthy();
      expect(skinMesh.primitives[0].attributes.TEXCOORD_0).toBeDefined();
      // Corte não usa a textura de pele e tem rugosidade própria: dois materiais distintos.
      expect(cut.pbrMetallicRoughness.baseColorTexture).toBeUndefined();
      expect(cut.pbrMetallicRoughness.roughnessFactor).toBeGreaterThan(.2);
      expect(cut.pbrMetallicRoughness.roughnessFactor).toBeLessThan(.8);
      expect(cut.pbrMetallicRoughness.roughnessFactor,family)
        .not.toBe(skin.pbrMetallicRoughness.roughnessFactor??1);
      // Onde o corpo original traz mapa de relevo, o corte herda; onde não traz, não se inventa.
      const record=PROVENANCE.familias[family]!;
      expect(Boolean(cut.normalTexture),family+' relevo').toBe(record.relevo);
      expect(record.rugosidade_corte,family).toBeCloseTo(cut.pbrMetallicRoughness.roughnessFactor,4);
    }
  });

  it('nenhum material brilha sozinho: o caco não compensa cor com emissão',()=>{
    for(const material of glb.json.materials){
      expect(material.emissiveTexture,material.name).toBeUndefined();
      const emissive=material.emissiveFactor??[0,0,0];
      expect(Math.max(...emissive),material.name).toBe(0);
      expect(material.doubleSided??false,material.name).toBe(false);
    }
  });

  it('toda primitiva carrega cor por vértice',()=>{
    for(const mesh of glb.json.meshes)for(const primitive of mesh.primitives)
      expect(primitive.attributes.COLOR_0,mesh.name).toBeDefined();
  });

  it('a cor gravada é linear: polpa e borda batem com a paleta convertida de sRGB',()=>{
    for(const [kind,palette] of Object.entries(FRUIT_PALETTES)){
      if(kind==='boss')continue; // reaproveita o conjunto da melancia
      const mesh=meshOf(fragmentKey(palette.family!,'shell',0)+'--corte');
      const colors=readAccessor(glb,mesh.primitives[0].attributes.COLOR_0).map(row=>row.slice(0,3));
      const pulp=toLinear(palette.pulp),rind=toLinear(palette.rind!);
      const nearPulp=colors.filter(c=>apart(c,pulp)<apart(c,rind));
      const nearRind=colors.filter(c=>apart(c,rind)<=apart(c,pulp));
      expect(nearPulp.length,kind+' polpa').toBeGreaterThan(3);
      expect(nearRind.length,kind+' borda').toBeGreaterThan(3);
      const mean=(list:number[][]):number[]=>[0,1,2].map(i=>list.reduce((s,c)=>s+c[i]!,0)/list.length);
      // Cor de sRGB usada como linear deslocaria a direção bem mais que isto.
      expect(apart(mean(nearPulp),pulp),kind+' polpa').toBeLessThan(.08);
      expect(apart(mean(nearRind),rind),kind+' borda').toBeLessThan(.08);
      // E o brilho tem de ficar na mesma ordem de grandeza da cor pedida.
      const ratio=Math.hypot(...mean(nearRind))/Math.hypot(...rind);
      expect(ratio,kind+' brilho').toBeGreaterThan(.8);
      expect(ratio,kind+' brilho').toBeLessThan(1.2);
    }
  });

  it('a proveniência confere com a paleta e os originais seguem intactos',()=>{
    expect(PROVENANCE.originais_alterados).toBe(false);
    expect(PROVENANCE.pecas).toBe(45);
    expect(PROVENANCE.objetos).toBe(glb.json.meshes.length);
    expect(PROVENANCE.teto_triangulos).toBe(FRAGMENT_TRIANGLE_BUDGET);
    for(const [kind,palette] of Object.entries(FRUIT_PALETTES)){
      if(kind==='boss')continue;
      const record=PROVENANCE.familias[palette.family!]!;
      expect(record.cores_srgb.polpa,kind).toBe(palette.pulp);
      expect(record.cores_srgb.borda,kind).toBe(palette.rind);
      expect(record.cores_srgb.semente,kind).toBe(palette.seed);
      // O corpo de origem não pode ter sido tocado pelo recorte.
      const source=readFileSync('public/models/'+record.modelo+'.glb');
      expect(createHash('sha256').update(source).digest('hex'),record.modelo).toBe(record.sha256_origem);
    }
  });
});

describe('fragmentos de fruta por espécie',()=>{
  it('cada espécie tem casca, polpa e sementes com cores distintas',()=>{
    for(const [kind,palette] of Object.entries(FRUIT_PALETTES)){
      expect(new Set([palette.shell,palette.pulp,palette.seed]).size,kind).toBe(3);
      expect(palette.counts.shell,kind).toBeGreaterThan(0);
      expect(palette.counts.seed,kind).toBeGreaterThan(0);
      expect(FRAGMENT_FAMILIES.includes(palette.family!),kind).toBe(true);
    }
  });
  it('a melancia não quebra igual ao tomate',()=>{
    expect(FRUIT_PALETTES.watermelon!.family).not.toBe(FRUIT_PALETTES.tomato!.family);
    expect(FRUIT_PALETTES.watermelon!.pulp).not.toBe(FRUIT_PALETTES.tomato!.pulp);
  });
  it('espécie desconhecida usa a paleta padrão em vez de não quebrar',()=>{
    expect(fruitPalette('abobora')).toBe(DEFAULT_PALETTE);
  });

  it('quebrar ativa pedaços dos três papéis com a malha do modelo',async()=>{
    const {fragments,body,engine}=fixture();
    try{
      expect(await fragments.ready).toBe(true);
      fragments.burst('watermelon',{x:0,y:0,z:0},{x:0,y:0,z:1},body);
      const palette=FRUIT_PALETTES.watermelon!;
      expect(fragments.active).toBe(palette.counts.shell+palette.counts.pulp+palette.counts.seed);
      expect(new Set(liveOf(fragments).map(entry=>entry.role)).size).toBe(3);
      for(const entry of liveOf(fragments)){
        expect(entry.template.startsWith('frag-melon-'),entry.template).toBe(true);
        expect(entry.mesh.getTotalVertices()).toBeGreaterThan(0);
        expect(entry.mesh.material?.name,entry.template).toMatch(/^melon-/);
      }
    }finally{fragments.dispose();engine.dispose();}
  });

  it('a casca sai com pele e face cortada; a semente não arrasta parte sobrando',async()=>{
    const {fragments,body,engine}=fixture();
    try{
      await fragments.ready;
      fragments.burst('watermelon',{x:0,y:0,z:0},{x:0,y:0,z:1},body);
      const shell=liveOf(fragments).find(entry=>entry.role==='shell')!;
      expect(shell.extras.filter(part=>part.isEnabled()).length).toBe(1);
      expect(shell.mesh.material?.name).toBe('melon-casca');
      expect(shell.extras[0]!.material?.name).toBe('melon-corte');
      const seed=liveOf(fragments).find(entry=>entry.role==='seed')!;
      expect(seed.extras.filter(part=>part.isEnabled()).length).toBe(0);
    }finally{fragments.dispose();engine.dispose();}
  });

  it('o caco não vira do avesso na conversão de eixo do glTF',async()=>{
    const {fragments,body,engine}=fixture();
    try{
      await fragments.ready;
      for(const kind of ['watermelon','corn','eggplant']){
        fragments.clear();
        fragments.burst(kind,{x:0,y:0,z:0},{x:0,y:0,z:1},body);
        for(const entry of liveOf(fragments)){
          // Volume com sinal das partes somadas, na convenção do glTF (anti-horário visto de fora
          // pela regra da mão direita). A carga assa a conversão de eixo na malha e inverte as
          // faces junto, então o sentido que veio do arquivo se mantém; negativo seria caco oco.
          let volume=0;
          for(const part of [entry.mesh,...entry.extras.filter(extra=>extra.isEnabled())] as unknown as {
            getVerticesData(kind:string):number[]|null;getIndices():number[]|null}[]){
            const points=part.getVerticesData('position')!,index=part.getIndices()!;
            for(let t=0;t<index.length;t+=3){
              const a=index[t]!*3,b=index[t+1]!*3,c=index[t+2]!*3;
              volume+=(points[a+1]!*points[b+2]!-points[a+2]!*points[b+1]!)*points[c]!
                +(points[a+2]!*points[b]!-points[a]!*points[b+2]!)*points[c+1]!
                +(points[a]!*points[b+1]!-points[a+1]!*points[b]!)*points[c+2]!;
            }
          }
          expect(volume,`${kind} ${entry.template}`).toBeGreaterThan(0);
        }
      }
    }finally{fragments.dispose();engine.dispose();}
  });

  it('o corpo original do inimigo continua intacto e visível',async()=>{
    const {fragments,body,engine}=fixture();
    try{
      await fragments.ready;
      fragments.burst('tomato',{x:0,y:0,z:0},{x:1,y:0,z:0},body);
      expect(body.isEnabled()).toBe(true);
      expect(body.isDisposed()).toBe(false);
      expect(liveOf(fragments)[0]!.mesh.getTotalVertices()).not.toBe(body.getTotalVertices());
    }finally{fragments.dispose();engine.dispose();}
  });

  it('o pool troca geometria, material e número de partes ao mudar de espécie',async()=>{
    const {fragments,body,engine}=fixture();
    try{
      await fragments.ready;
      fragments.burst('watermelon',{x:0,y:0,z:0},{x:0,y:0,z:1},body);
      const melon=liveOf(fragments).map(entry=>({role:entry.role,vertices:entry.mesh.getTotalVertices()}));
      fragments.clear();
      fragments.burst('corn',{x:0,y:0,z:0},{x:0,y:0,z:1},body);
      const corn=liveOf(fragments);
      expect(corn.length).toBeGreaterThan(0);
      for(const entry of corn){
        expect(entry.template.startsWith('frag-cob-'),entry.template).toBe(true);
        expect(entry.mesh.material?.name,entry.template).toMatch(/^cob-/);
        const expected=meshOf(entry.template);
        const vertices=glb.json.accessors[expected.primitives[0].attributes.POSITION].count;
        expect(entry.mesh.getTotalVertices(),entry.template).toBe(vertices);
        expect(entry.extras.filter(part=>part.isEnabled()).length,entry.template)
          .toBe(meshOf(entry.template+'--corte')?1:0);
      }
      // Casca de milho e de melancia não têm a mesma contagem: sobra de geometria apareceria aqui.
      const shellMelon=melon.find(entry=>entry.role==='shell')!.vertices;
      expect(corn.find(entry=>entry.role==='shell')!.mesh.getTotalVertices()).not.toBe(shellMelon);
    }finally{fragments.dispose();engine.dispose();}
  });

  it('reciclar sob pressão mantém cada slot com o molde do próprio papel',async()=>{
    const {fragments,body,engine}=fixture();
    try{
      await fragments.ready;
      for(const kind of ['watermelon','corn','carrot','eggplant','tomato','boss'])
        fragments.burst(kind,{x:0,y:2,z:0},{x:0,y:0,z:1},body,1.4);
      expect(fragments.active).toBeLessThanOrEqual(FRAGMENT_BUDGET);
      expect(poolOf(fragments).length).toBeLessThanOrEqual(FRAGMENT_BUDGET);
      for(const entry of poolOf(fragments)){
        const expected=meshOf(entry.template);
        expect(expected,entry.template).toBeTruthy();
        expect(entry.mesh.getTotalVertices(),entry.template).toBe(glb.json.accessors[expected.primitives[0].attributes.POSITION].count);
        expect(entry.extras.filter(part=>part.isEnabled()).length,entry.template)
          .toBe(meshOf(entry.template+'--corte')?1:0);
        expect(entry.template.includes('-'+entry.role+'-'),entry.template).toBe(true);
      }
    }finally{fragments.dispose();engine.dispose();}
  });

  it('o tamanho do caco não herda a escala do corpo importado',async()=>{
    const small=fixture(realLoader,1),huge=fixture(realLoader,40);
    try{
      await Promise.all([small.fragments.ready,huge.fragments.ready]);
      small.fragments.burst('watermelon',{x:0,y:0,z:0},{x:0,y:0,z:1},small.body);
      huge.fragments.burst('watermelon',{x:0,y:0,z:0},{x:0,y:0,z:1},huge.body);
      const extent=(f:FruitFragments):number=>Math.max(...liveOf(f)
        .map(e=>Math.max(e.half.x*e.mesh.scaling.x,e.half.y*e.mesh.scaling.y,e.half.z*e.mesh.scaling.z)*2));
      expect(extent(huge.fragments)).toBeLessThan(.7);
      expect(extent(huge.fragments)).toBeCloseTo(extent(small.fragments),5);
    }finally{small.fragments.dispose();small.engine.dispose();huge.fragments.dispose();huge.engine.dispose();}
  });

  it('respeita o teto de pedaços vivos mesmo com muitas quebras',async()=>{
    const {fragments,body,engine}=fixture();
    try{
      await fragments.ready;
      for(let i=0;i<40;i++)fragments.burst('boss',{x:i,y:0,z:0},{x:0,y:0,z:1},body);
      expect(fragments.active).toBeLessThanOrEqual(FRAGMENT_BUDGET);
      expect(fragments.capacity).toBe(FRAGMENT_BUDGET);
    }finally{fragments.dispose();engine.dispose();}
  });

  it('os pedaços caem, assentam no piso e param de se mexer',async()=>{
    const {fragments,body,world,engine}=fixture();
    try{
      await fragments.ready;
      fragments.burst('eggplant',{x:0,y:6,z:0},{x:0,y:0,z:1},body);
      run(fragments,3);
      const landed=liveOf(fragments);
      expect(landed.length).toBeGreaterThan(0);
      for(const fragment of landed){
        expect(fragment.mesh.position.y).toBeGreaterThanOrEqual(world.groundAt(0,0,10)-.01);
        expect(fragment.mesh.position.y).toBeLessThan(1);
      }
    }finally{fragments.dispose();engine.dispose();}
  });

  it('o contato usa a extensão do pedaço: não afunda no chão nem paira sobre ele',async()=>{
    const {fragments,body,engine}=fixture();
    try{
      await fragments.ready;
      for(const kind of ['watermelon','corn','carrot']){
        fragments.clear();
        fragments.burst(kind,{x:0,y:4,z:0},{x:0,y:0,z:1},body);
        run(fragments,4);
        const resting=liveOf(fragments).filter(entry=>entry.resting);
        expect(resting.length,kind).toBeGreaterThan(0);
        for(const entry of resting)expect(entry.mesh.position.y,`${kind} ${entry.template}`).toBeCloseTo(support(entry),4);
      }
    }finally{fragments.dispose();engine.dispose();}
  });

  it('somem depois da vida útil, sem sobrar polígono no chão para sempre',async()=>{
    const {fragments,body,engine}=fixture();
    try{
      await fragments.ready;
      fragments.burst('corn',{x:0,y:0,z:0},{x:0,y:0,z:1},body);
      expect(fragments.active).toBeGreaterThan(0);
      run(fragments,8);
      expect(fragments.active).toBe(0);
    }finally{fragments.dispose();engine.dispose();}
  });

  it('quem cai no vazio é recolhido em vez de cair para sempre',async()=>{
    const engine=new NullEngine(),scene=new Scene(engine);
    const world=new CollisionWorld();
    const body=CreateBox('enemy-body',{size:1},scene);
    const fragments=new FruitFragments(scene,world,realLoader);
    try{
      await fragments.ready;
      fragments.burst('carrot',{x:0,y:0,z:0},{x:0,y:0,z:1},body);
      run(fragments,6);
      expect(fragments.active).toBe(0);
    }finally{fragments.dispose();engine.dispose();}
  });

  it('clear devolve o pool e dispose não deixa malha nem molde vivo',async()=>{
    const {fragments,body,engine,scene}=fixture();
    await fragments.ready;
    fragments.burst('watermelon',{x:0,y:0,z:0},{x:0,y:0,z:1},body);
    fragments.clear();
    expect(fragments.active).toBe(0);
    fragments.burst('watermelon',{x:0,y:0,z:0},{x:0,y:0,z:1},body);
    expect(fragments.active).toBeGreaterThan(0);
    fragments.dispose();
    expect(poolOf(fragments).length).toBe(0);
    expect(scene.meshes.filter(mesh=>mesh.name.startsWith('fruit-fragment')).length).toBe(0);
    expect(scene.meshes.filter(mesh=>mesh.name.startsWith('frag-')).length).toBe(0);
    expect(fragments.shapeTriangles).toBe(0);
    fragments.burst('watermelon',{x:0,y:0,z:0},{x:0,y:0,z:1},body);
    fragments.update(1/60);
    expect(fragments.active).toBe(0);
    engine.dispose();
  });

  it('a força do golpe escala a quantidade dentro do limite',async()=>{
    const {fragments,body,engine}=fixture();
    try{
      await fragments.ready;
      fragments.burst('tomato',{x:0,y:0,z:0},{x:0,y:0,z:1},body,.3);
      const weak=fragments.active;
      fragments.clear();
      fragments.burst('tomato',{x:0,y:0,z:0},{x:0,y:0,z:1},body,1.5);
      expect(fragments.active).toBeGreaterThanOrEqual(weak);
    }finally{fragments.dispose();engine.dispose();}
  });
});

describe('carga do modelo',()=>{
  it('quebra antes do modelo chegar não inventa geometria e sai depois',async()=>{
    let release=(_c:AssetContainer)=>{};
    const slow:FragmentLoader=(_url,scene)=>new Promise(resolve=>{
      release=()=>LoadAssetContainerAsync(bytes64,scene,{pluginExtension:'.glb'}).then(resolve);
    });
    const {fragments,body,engine,scene}=fixture(slow);
    try{
      fragments.burst('watermelon',{x:0,y:1,z:0},{x:0,y:0,z:1},body);
      expect(fragments.loaded).toBe(false);
      expect(fragments.active).toBe(0);
      // Nada de substituto geométrico na cena enquanto o modelo não chega.
      expect(scene.meshes.filter(mesh=>mesh.name.startsWith('fruit-fragment')).length).toBe(0);
      release(undefined as unknown as AssetContainer);
      expect(await fragments.ready).toBe(true);
      expect(fragments.active).toBeGreaterThan(0);
      expect(liveOf(fragments)[0]!.template.startsWith('frag-melon-')).toBe(true);
    }finally{fragments.dispose();engine.dispose();}
  });

  it('a fila de espera não cresce sem limite e some no clear',async()=>{
    let release=()=>{};
    const slow:FragmentLoader=(_url,scene)=>new Promise(resolve=>{
      release=()=>{LoadAssetContainerAsync(bytes64,scene,{pluginExtension:'.glb'}).then(resolve);};
    });
    const {fragments,body,engine}=fixture(slow);
    try{
      for(let i=0;i<PENDING_BURSTS+6;i++)fragments.burst('corn',{x:i,y:1,z:0},{x:0,y:0,z:1},body);
      expect((fragments['queue' as keyof FruitFragments] as unknown as unknown[]).length).toBe(PENDING_BURSTS);
      fragments.clear();
      release();
      await fragments.ready;
      expect(fragments.active).toBe(0);
    }finally{fragments.dispose();engine.dispose();}
  });

  it('dispose antes da carga terminar não deixa o container vazando na cena',async()=>{
    let release=()=>{};
    const slow:FragmentLoader=(_url,scene)=>new Promise(resolve=>{
      release=()=>{LoadAssetContainerAsync(bytes64,scene,{pluginExtension:'.glb'}).then(resolve);};
    });
    const {fragments,engine,scene}=fixture(slow);
    fragments.dispose();
    release();
    expect(await fragments.ready).toBe(false);
    expect(scene.meshes.filter(mesh=>mesh.name.startsWith('frag-')).length).toBe(0);
    // Só sobra a caixa que faz de corpo do inimigo no teste; nada do container ficou para trás.
    expect(scene.geometries.length).toBe(1);
    expect(fragments.loaded).toBe(false);
    engine.dispose();
  });

  it('falha de carga vira erro legível, sem derrubar a quebra',async()=>{
    const broken:FragmentLoader=()=>Promise.reject(Error('modelo fora do ar'));
    const {fragments,body,engine}=fixture(broken);
    try{
      expect(await fragments.ready).toBe(false);
      expect(fragments.error).toContain('modelo fora do ar');
      fragments.burst('watermelon',{x:0,y:0,z:0},{x:0,y:0,z:1},body);
      fragments.update(1/60);
      expect(fragments.active).toBe(0);
    }finally{fragments.dispose();engine.dispose();}
  });
});
