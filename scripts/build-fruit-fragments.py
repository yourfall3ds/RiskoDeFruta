"""Recorta cacos reais dos corpos de inimigo e exporta `public/models/fruit-fragments.glb`.

Origem: `public/models/original-<espécie>.glb` — os mesmos corpos que o jogador vê em jogo.
Os originais NÃO são tocados: são importados, recortados em memória e descartados.

Cada caco de casca é um pedaço de verdade da malha do inimigo, com UV e material de pele
preservados; a face cortada e a polpa saem do mesmo conjunto PBR, trocando só a cor base pela
cor de vértice. Semente de melancia/tomate/berinjela é modelada aqui (a fruta não tem semente
na superfície); grão de milho e lasca de cenoura são recortes reais do corpo.

Rodar: "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --python scripts/build-fruit-fragments.py
"""
import bpy,bmesh,json,math,hashlib
from mathutils import Vector,Matrix
from pathlib import Path

ROOT=Path(__file__).resolve().parent.parent
OUTPUT=ROOT/'public/models/fruit-fragments.glb'
PROVENANCE=ROOT/'docs/fruit-fragments-provenance.json'
BLEND=ROOT/'art/blender/Fruit_Fragments.blend'

TEXTURE_SIZE=512
TRIANGLE_BUDGET=320
VARIANTS=3

# `scale` acompanha ENEMIES em src/run/MonsterDirector.ts: o caco sai no tamanho de mundo do corpo.
# As cores estão em sRGB e viram linear na hora de gravar — é esse passo que faltava e lavava tudo.
FAMILIES={
 'melon':{'model':'original-watermelon','scale':1.35,'pulp':'#d0374d','rind':'#cfdfa2','seed':'#1d150f',
          'flesh_roughness':.46,'skin_roughness':.55,'shell_faces':55,'shell_thickness':.034,'pulp_faces':40,'pulp_thickness':.085,
          'seed_shape':(.010,.029,.006),'seed_kind':'modelada'},
 'berry':{'model':'original-tomato','scale':1.25,'pulp':'#d9584a','rind':'#eec0a8','seed':'#cdb570',
          'flesh_roughness':.34,'skin_roughness':.45,'shell_faces':55,'shell_thickness':.015,'pulp_faces':40,'pulp_thickness':.06,
          'seed_shape':(.008,.017,.0045),'seed_kind':'modelada'},
 'bulb':{'model':'original-eggplant','scale':1.2,'pulp':'#e7d9ba','rind':'#ddcfae','seed':'#6d5e35',
         'flesh_roughness':.58,'skin_roughness':.5,'shell_faces':80,'shell_thickness':.026,'pulp_faces':60,'pulp_thickness':.05,
         'seed_shape':(.007,.018,.004),'seed_kind':'modelada'},
 'cob':{'model':'original-corn','scale':1.3,'pulp':'#e8cf7a','rind':'#ded0a0','seed':'#e2ab33',
        'flesh_roughness':.62,'skin_roughness':.68,'shell_faces':100,'shell_thickness':.012,'pulp_faces':80,'pulp_thickness':.05,
        'seed_faces':16,'seed_thickness':.016,'seed_kind':'recorte'},
 'root':{'model':'original-carrot','scale':1.25,'pulp':'#e79a4e','rind':'#eec392','seed':'#dd8f42',
         'flesh_roughness':.55,'skin_roughness':.7,'shell_faces':95,'shell_thickness':.014,'pulp_faces':75,'pulp_thickness':.055,
         'seed_faces':14,'seed_thickness':.01,'seed_kind':'recorte'},
}
# Raio máximo do recorte, em metros: sem isto uma malha de faces grandes devolve meio corpo.
REACH={'shell':.18,'pulp':.13,'seed':.05}

def srgb_to_linear(value):
 out=[]
 for i in range(3):
  c=int(value.lstrip('#')[i*2:i*2+2],16)/255
  out.append(c/12.92 if c<=.04045 else ((c+.055)/1.055)**2.4)
 return out

def noise(n):
 s=math.sin(n*127.1+311.7)*43758.5453
 return s-math.floor(s)

def mottle(co,seed):
 """Variação por vértice: sem isto a polpa vira plástico chapado."""
 return .84+.3*noise(co.x*23.7+co.y*41.3+co.z*67.9+seed*13.1)

def tinted(color,co,seed,strength=1.0):
 """`strength` comprime a variação: na pele texturizada ela é sutil, na polpa é o que dá vida."""
 m=1+(mottle(co,seed)-1)*strength
 warm=1+(.96+.08*noise(co.y*57.1+seed*7.3)-1)*strength
 return (min(1,color[0]*m*warm),min(1,color[1]*m),min(1,color[2]*m*(2-warm)),1)

def sha256(path):
 h=hashlib.sha256()
 with open(path,'rb') as handle:
  for block in iter(lambda:handle.read(1<<20),b''):h.update(block)
 return h.hexdigest()

def activate(obj):
 bpy.ops.object.select_all(action='DESELECT');obj.select_set(True);bpy.context.view_layer.objects.active=obj

def drop_link(material,socket):
 bsdf=material.node_tree.nodes['Principled BSDF']
 for link in list(material.node_tree.links):
  if link.to_node==bsdf and link.to_socket.name==socket:material.node_tree.links.remove(link)

def import_body(family,spec):
 """Traz o corpo do inimigo já no tamanho de mundo, sem armature e sem proxy de colisão."""
 before=set(bpy.context.scene.objects)
 bpy.ops.import_scene.gltf(filepath=str(ROOT/'public/models'/(spec['model']+'.glb')))
 fresh=[o for o in bpy.context.scene.objects if o not in before]
 bodies=[o for o in fresh if o.type=='MESH' and o.data.materials and o.data.materials[0]]
 body=max(bodies,key=lambda o:len(o.data.vertices))
 world=body.matrix_world.copy()
 body.parent=None;body.matrix_world=world;body.modifiers.clear()
 body.scale=[value*spec['scale'] for value in body.scale]
 activate(body);bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
 # Corpo exportado com vértices partidos na costura de UV: sem soldar, face vizinha não é vizinha
 # e o recorte não cresce. As UV moram no canto da face, então soldar posição não perde textura.
 weld=bmesh.new();weld.from_mesh(body.data)
 bmesh.ops.remove_doubles(weld,verts=weld.verts[:],dist=1e-5)
 weld.to_mesh(body.data);weld.free();body.data.update()
 for other in fresh:
  if other is not body:bpy.data.objects.remove(other,do_unlink=True)
 body.name='corpo-'+family
 skin=body.data.materials[0];skin.name=family+'-casca'
 # O corpo do jogo é emissivo; caco emissivo vira mancha luminosa, então a emissão sai.
 drop_link(skin,'Emission Color');drop_link(skin,'Emission Strength')
 bsdf=skin.node_tree.nodes['Principled BSDF']
 bsdf.inputs['Emission Strength'].default_value=0
 bsdf.inputs['Emission Color'].default_value=(0,0,0,1)
 for node in [n for n in skin.node_tree.nodes if n.type=='TEX_IMAGE' and not n.outputs[0].links]:
  skin.node_tree.nodes.remove(node)
 for image in {n.image for n in skin.node_tree.nodes if n.type=='TEX_IMAGE' and n.image}:
  # Caco é pequeno na tela: cor em 512, relevo e rugosidade em 256. 4K aqui só engordaria o download.
  wanted=TEXTURE_SIZE if image.colorspace_settings.name=='sRGB' else TEXTURE_SIZE//2
  if image.size[0]>wanted:
   image.scale(wanted,wanted)
   # Reempacota já reduzida: sem isto o .blend guarda o 4K original de cada corpo e passa de 100 MB.
   if image.packed_file:image.unpack(method='REMOVE')
   image.pack()
 # Corpo sem mapa de rugosidade vinha com rugosidade 1: chapado feito papel. Um valor de verdade
 # devolve o brilho fosco da casca sem inventar mapa que o original não tem.
 relief=any(node.type=='NORMAL_MAP' for node in skin.node_tree.nodes)
 if not bsdf.inputs['Roughness'].links:bsdf.inputs['Roughness'].default_value=spec['skin_roughness']
 cut=skin.copy();cut.name=family+'-corte'
 # Face cortada: cor vem do atributo de vértice (fator branco), rugosidade própria, relevo mantido.
 drop_link(cut,'Base Color');drop_link(cut,'Roughness');drop_link(cut,'Metallic')
 cbsdf=cut.node_tree.nodes['Principled BSDF']
 cbsdf.inputs['Base Color'].default_value=(1,1,1,1)
 cbsdf.inputs['Roughness'].default_value=spec['flesh_roughness']
 cbsdf.inputs['Metallic'].default_value=0
 for node in cut.node_tree.nodes:
  if node.type=='NORMAL_MAP':node.inputs['Strength'].default_value=.65
 seed_material=bpy.data.materials.new(family+'-semente');seed_material.use_nodes=True
 # Caco é malha fechada: renderizar as duas faces só dobraria o custo de preenchimento.
 for material in (skin,cut,seed_material):material.use_backface_culling=True
 sbsdf=seed_material.node_tree.nodes['Principled BSDF']
 sbsdf.inputs['Base Color'].default_value=(1,1,1,1)
 sbsdf.inputs['Roughness'].default_value=.42
 sbsdf.inputs['Metallic'].default_value=0
 return body,skin,cut,seed_material,relief

def torso_candidates(body):
 """Faces do tronco viradas para fora: caco sai da barriga/costas, não da ponta de um pé."""
 mesh=body.data;mesh.calc_loop_triangles()
 low=min(v.co.z for v in mesh.vertices);high=max(v.co.z for v in mesh.vertices)
 axis=Vector((sum(v.co.x for v in mesh.vertices)/len(mesh.vertices),sum(v.co.y for v in mesh.vertices)/len(mesh.vertices),0))
 span=high-low
 out=[]
 for poly in mesh.polygons:
  centre=poly.center
  height=(centre.z-low)/span
  if height<.34 or height>.78:continue
  radial=Vector((centre.x-axis.x,centre.y-axis.y,0))
  if radial.length<1e-4:continue
  if poly.normal.dot(radial.normalized())<.35:continue
  out.append((math.atan2(radial.y,radial.x),poly.index))
 out.sort()
 return [index for _,index in out]

def patch(body,seed_index,target,phase,limit):
 """Cresce uma mancha conexa em torno da face semente, com borda rasgada e sem dobrar o corpo."""
 bm=bmesh.new();bm.from_mesh(body.data);bm.faces.ensure_lookup_table();bm.normal_update()
 start=bm.faces[seed_index];origin=start.calc_center_median();normal=start.normal.normalized()
 tangent=Vector((0,0,1)).cross(normal)
 if tangent.length<1e-3:tangent=Vector((1,0,0))
 tangent.normalize();bitangent=normal.cross(tangent)
 reach=[];seen={start.index};stack=[start]
 while stack and len(reach)<target*4:
  face=stack.pop(0)
  offset=face.calc_center_median()-origin
  reach.append((offset.length,face.index,offset))
  for edge in face.edges:
   for other in edge.link_faces:
    if other.index in seen:continue
    # Recorte plano: passar de ~63° dobraria o caco em volta de um braço e ele viraria bola.
    if other.normal.dot(normal)<.45:continue
    seen.add(other.index);stack.append(other)
 reach.sort(key=lambda item:item[0])
 radius=min(limit,reach[min(target,len(reach))-1][0])
 keep=set()
 for distance,index,offset in reach:
  angle=math.atan2(offset.dot(bitangent),offset.dot(tangent))
  torn=radius*(.74+.26*(.5+.5*math.sin(angle*3+phase)*math.cos(angle*2+phase*1.7)))
  if distance<=torn:keep.add(index)
 # Só o pedaço grudado na semente: ilha solta viraria caco flutuando sozinho.
 connected={seed_index};stack=[bm.faces[seed_index]]
 while stack:
  face=stack.pop()
  for edge in face.edges:
   for other in edge.link_faces:
    if other.index in keep and other.index not in connected:
     connected.add(other.index);stack.append(other)
 bm.free()
 return connected,normal

def carve(name,body,faces,normal,thickness,materials,inset,jitter,seed,split_materials):
 bm=bmesh.new();bm.from_mesh(body.data);bm.faces.ensure_lookup_table();bm.normal_update()
 bmesh.ops.delete(bm,geom=[f for f in bm.faces if f.index not in faces],context='FACES')
 # Vértice/aresta solto sobrando faz o exportador reclamar de malha inválida.
 bmesh.ops.delete(bm,geom=[v for v in bm.verts if not v.link_faces],context='VERTS')
 bmesh.ops.delete(bm,geom=[e for e in bm.edges if not e.link_faces],context='EDGES')
 bm.normal_update()
 if inset or jitter:
  for vert in bm.verts:
   direction=vert.normal.normalized() if vert.normal.length>1e-6 else normal
   vert.co-=direction*inset
   vert.co+=direction*jitter*(noise(vert.co.x*31.1+vert.co.y*17.7+vert.co.z*53.3+seed)*2-1)
 mesh=bpy.data.meshes.new(name);bm.to_mesh(mesh);bm.free()
 obj=bpy.data.objects.new(name,mesh);bpy.context.scene.collection.objects.link(obj)
 for material in materials:mesh.materials.append(material)
 modifier=obj.modifiers.new('Espessura','SOLIDIFY')
 modifier.thickness=thickness;modifier.offset=-1;modifier.use_rim=True;modifier.use_quality_normals=True
 modifier.material_offset=1 if split_materials else 0
 modifier.material_offset_rim=1 if split_materials else 0
 activate(obj);bpy.ops.object.modifier_apply(modifier=modifier.name)
 return obj

def split_parts(obj,name,materials):
 """Um material por objeto.

 O exportador glTF do Blender 5.2 grava COLOR_0 branco na segunda primitiva de uma malha com dois
 materiais (conferido em isolado). Como a cor da polpa mora justamente na parte cortada, a peça sai
 em objetos separados: `<nome>` para a pele e `<nome>--corte` para o corte.
 """
 source=bmesh.new();source.from_mesh(obj.data)
 # Some com o objeto E com a malha de trabalho antes de criar as partes: se o nome continuar
 # ocupado, o Blender renomeia a primeira para `nome.001` e o runtime não acha mais a peça.
 stale=obj.data
 bpy.data.objects.remove(obj,do_unlink=True);bpy.data.meshes.remove(stale)
 parts=[]
 for slot,(suffix,material) in enumerate([('',materials[0]),('--corte',materials[-1])]):
  if slot and len(materials)<2:break
  bm=source.copy();bm.faces.ensure_lookup_table()
  drop=[face for face in bm.faces if face.material_index!=slot]
  if len(drop)==len(bm.faces):bm.free();continue
  bmesh.ops.delete(bm,geom=drop,context='FACES')
  bmesh.ops.delete(bm,geom=[v for v in bm.verts if not v.link_faces],context='VERTS')
  data=bpy.data.meshes.new(name+suffix);bm.to_mesh(data);bm.free()
  for poly in data.polygons:poly.material_index=0
  data.materials.append(material)
  part=bpy.data.objects.new(name+suffix,data);bpy.context.scene.collection.objects.link(part)
  parts.append(part)
 source.free()
 return parts

def paint(obj,normal,colors,seed,split,strength=1.0):
 """Cor por vértice: pele intacta fora, polpa dentro, borda clara no corte.

 A separação sai da orientação da face (e do material, quando a casca tem dois): contar índice de
 vértice depois do Solidify dependia da ordem que o modificador devolve, e ela não é garantida.
 """
 mesh=obj.data
 bm=bmesh.new();bm.from_mesh(mesh);bmesh.ops.triangulate(bm,faces=bm.faces[:]);bm.to_mesh(mesh);bm.free()
 mesh.validate(verbose=False,clean_customdata=False);mesh.update()
 layer=mesh.color_attributes.new('Cor','FLOAT_COLOR','CORNER')
 # Sem marcar como ativa/de render o exportador grava COLOR_0 branco e a cor da polpa some.
 index=mesh.color_attributes.find('Cor')
 mesh.color_attributes.active_color_index=index;mesh.color_attributes.render_color_index=index
 for poly in mesh.polygons:
  facing=poly.normal.dot(normal)
  if split:face='outer' if poly.material_index==0 else 'inner' if facing<-.15 else 'rim'
  else:face='outer' if facing>.25 else 'inner' if facing<-.25 else 'rim'
  for loop in poly.loop_indices:
   co=mesh.vertices[mesh.loops[loop].vertex_index].co
   layer.data[loop].color=tinted(colors[face]or(1,1,1),co,seed,strength)
 return len(mesh.polygons)

def volume(parts):
 """Volume com sinal das partes somadas: uma peça que dobrou sobre si mesma quase zera aqui."""
 total=0
 for part in parts:
  mesh=part.data
  for poly in mesh.polygons:
   points=[mesh.vertices[index].co for index in poly.vertices]
   for k in range(1,len(points)-1):
    total+=points[0].cross(points[k]).dot(points[k+1])/6
 return total

def settle(parts,normal):
 """Deita o caco com a face chata em Z: o contato com o piso no jogo conta com isso.

 Pele e corte giram e transladam juntos, senão as duas metades da mesma peça se separam.
 """
 rotation=normal.rotation_difference(Vector((0,0,1))).to_matrix().to_4x4()
 for part in parts:part.data.transform(rotation)
 points=[vertex.co for part in parts for vertex in part.data.vertices]
 low=Vector((min(p.x for p in points),min(p.y for p in points),min(p.z for p in points)))
 high=Vector((max(p.x for p in points),max(p.y for p in points),max(p.z for p in points)))
 shift=Matrix.Translation(-(low+high)/2)
 for part in parts:
  part.data.transform(shift);part.matrix_world=Matrix.Identity(4)
 return [round(value,4) for value in (high-low)]

def modelled_seed(name,spec,material,variant):
 """Semente/caroço: a fruta não traz semente na superfície, então esta parte é modelada aqui."""
 bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2,radius=1)
 obj=bpy.context.object;obj.name=name;mesh=obj.data;mesh.name=name
 wide,long,flat=spec['seed_shape']
 for vert in mesh.vertices:
  point=vert.co.copy()
  taper=1-.5*max(0.,point.y)**1.4
  bump=1+.09*(noise(point.x*7.1+point.y*11.3+point.z*5.7+variant*3.1)*2-1)
  vert.co=Vector((point.x*wide*taper*bump,point.y*long*bump,point.z*flat*taper*bump))
 mesh.materials.append(material)
 for poly in mesh.polygons:poly.use_smooth=True
 return obj

def build():
 bpy.ops.wm.read_factory_settings(use_empty=True)
 bpy.context.preferences.filepaths.save_version=0
 report={'gerado_por':'scripts/build-fruit-fragments.py','saida':'public/models/fruit-fragments.glb',
         'originais_alterados':False,'textura_px':TEXTURE_SIZE,'teto_triangulos':TRIANGLE_BUDGET,'familias':{}}
 pieces=[]
 for family,spec in FAMILIES.items():
  body,skin,cut,seed_material,relief=import_body(family,spec)
  candidates=torso_candidates(body)
  pulp=srgb_to_linear(spec['pulp']);rind=srgb_to_linear(spec['rind']);seed_color=srgb_to_linear(spec['seed'])
  entries=[]
  for variant in range(VARIANTS):
   phase=variant*2.399+len(family)
   for role in ('shell','pulp','seed'):
    if role=='seed' and spec['seed_kind']=='modelada':
     name=f'frag-{family}-seed-{variant}'
     obj=modelled_seed(name,spec,seed_material,variant)
     count=paint(obj,Vector((0,0,1)),{'outer':seed_color,'inner':[c*.72 for c in seed_color],'rim':seed_color},variant*5+11,False)
     size=settle([obj],Vector((0,0,1)))
     entries.append({'peca':name,'papel':role,'variante':variant,'partes':1,'triangulos':count,'tamanho_m':size,'origem':'modelada'})
     pieces.append(obj);continue
    target=spec[{'shell':'shell_faces','pulp':'pulp_faces','seed':'seed_faces'}[role]]
    base=int((variant*.37+{'shell':0,'pulp':.13,'seed':.61}[role])*len(candidates))
    # Nem toda face serve de semente: vinco e ponta travam o crescimento e devolvem lasca de nada.
    best=None
    for attempt in range(14):
     got,facing=patch(body,candidates[(base+attempt*37)%len(candidates)],target,phase,REACH[role])
     if best is None or len(got)>len(best[0]):best=(got,facing)
     if len(got)>=target*.72:break
    faces,normal=best
    name=f'frag-{family}-{role}-{variant}'
    if role=='pulp':
     # Naco de dentro: sem pele, um material só, cor de polpa com miolo mais escuro.
     raw=carve(name,body,faces,normal,spec['pulp_thickness'],[cut],spec['shell_thickness'],
               spec['pulp_thickness']*.16,variant*11+5,False)
     parts=split_parts(raw,name,[cut])
     count=paint(parts[0],normal,{'outer':pulp,'inner':[c*.78 for c in pulp],'rim':[c*.9 for c in pulp]},variant*11+5,False)
    else:
     seed_of=variant*7+3 if role=='shell' else variant*13+7
     thickness=spec['shell_thickness'] if role=='shell' else spec['seed_thickness']
     raw=carve(name,body,faces,normal,thickness,[skin,cut],0,0,seed_of,True)
     parts=split_parts(raw,name,[skin,cut])
     # Pele intacta: só uma variação fraca de brilho, senão brigaria com a textura do corpo.
     count=paint(parts[0],normal,{'outer':None,'inner':None,'rim':None},seed_of,False,.35)
     inner=pulp if role=='shell' else seed_color
     if len(parts)>1:count+=paint(parts[1],normal,{'outer':rind,'inner':inner,'rim':rind},seed_of,False)
    size=settle(parts,normal)
    if count>TRIANGLE_BUDGET:raise SystemExit(f'{name} estourou o teto: {count} triângulos')
    solid=volume(parts);box=size[0]*size[1]*size[2]
    # Espessura maior que o raio de curvatura do recorte fura a própria superfície; o volume
    # despenca e a peça renderiza cruzada. Melhor a build falhar do que o caco sair torto.
    if solid<=0 or solid<box*.02:
     raise SystemExit(f'{name} dobrou sobre si mesmo: volume {solid:.6f} para caixa {box:.6f}')
    entries.append({'peca':name,'papel':role,'variante':variant,'partes':len(parts),'triangulos':count,
                    'tamanho_m':size,'origem':'recorte de '+spec['model']})
    pieces.extend(parts)
  bpy.data.objects.remove(body,do_unlink=True)
  report['familias'][family]={'modelo':spec['model'],'sha256_origem':sha256(ROOT/'public/models'/(spec['model']+'.glb')),
                              'escala_inimigo':spec['scale'],'relevo':relief,'rugosidade_corte':spec['flesh_roughness'],
                              'cores_srgb':{'polpa':spec['pulp'],'borda':spec['rind'],'semente':spec['seed']},
                              'pecas':entries}
 bpy.ops.object.select_all(action='DESELECT')
 for obj in pieces:obj.select_set(True)
 bpy.context.view_layer.objects.active=pieces[0]
 BLEND.parent.mkdir(parents=True,exist_ok=True)
 bpy.ops.wm.save_as_mainfile(filepath=str(BLEND))
 bpy.ops.export_scene.gltf(filepath=str(OUTPUT),export_format='GLB',use_selection=True,
                           export_vertex_color='ACTIVE',export_image_format='JPEG',export_jpeg_quality=88,
                           export_apply=False,export_skins=False,export_animations=False,export_morph=False,
                           export_cameras=False,export_lights=False,export_extras=False,export_tangents=False,
                           export_yup=True,export_normals=True)
 report['bytes']=OUTPUT.stat().st_size
 report['pecas']=sum(len(f['pecas']) for f in report['familias'].values());report['objetos']=len(pieces)
 PROVENANCE.write_text(json.dumps(report,indent=1,ensure_ascii=False),encoding='utf-8')
 print('cacos exportados:',len(pieces),'bytes:',report['bytes'])

build()
