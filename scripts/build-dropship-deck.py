"""Nave de inserção com deck aberto: casco, volume estrutural, corrimão nas laterais e saída aberta.

Mesmo pipeline dos outros assets do projeto (`build-alien-world.py`, `build-interactive-chest.py`):
geometria autoral em Blender com os mapas PBR CC0 já presentes em `public/textures`, exportada como
GLB real para `public/models`. Nada disso vira primitiva de runtime — o jogo só carrega o GLB.

Eixos: **+X é a frente** (direção da corrida até a saída), +Y lateral, +Z para cima. O topo da chapa
do deck fica exatamente em Z=0, então o personagem corre com os pés na origem local do asset.
A saída aberta fica em X≈0; o casco e os propulsores ficam atrás, em X negativo.

REVISÃO 2 (render do Codex em .temp/dropship-review.png):
1. Casco e escoras liam como madeira listrada. A cor agora vem SÓ de `baseColorFactor` (grafite e
   oliva pintados); o mapa difuso marrom saiu de vez. O desgaste vem do normal e da rugosidade.
2. A boca inteira era uma placa branca acesa. Virou marcação de perigo amarelo/preto SEM emissão,
   com guias menta pequenas nas laterais.
3. As escoras diagonais ficavam penduradas. Agora nascem e terminam dentro de volumes reais
   (longarina e quilha), com cartelas nas duas pontas.
4. Os propulsores eram caixas com a face acesa. Viraram naceles de revolução com aro, recesso e o
   disco luminoso lá dentro.
5. As nervuras do piso baixaram de 8,5 cm para 0,8 cm, e a folga do pé passou a se referir à CHAPA.

Uso: "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b -P scripts/build-dropship-deck.py
"""
import bpy,bmesh,math
from mathutils import Vector
from pathlib import Path

ROOT=Path(__file__).resolve().parent.parent
bpy.ops.wm.read_factory_settings(use_empty=True);bpy.context.preferences.filepaths.save_version=0
scene=bpy.context.scene;scene.render.fps=60

# Mapas grandes demais para um asset que carrega antes do Jogar: 1K basta na escala de tela do deck.
TEXEL=1024
# Altura das nervuras acima da chapa. O piso caminhável é a CHAPA; a nervura é um friso raso, para o
# pé nunca pousar 8 cm no ar nem atravessar uma ripa alta.
TREAD=.008

def srgb(c):
 """Blender trabalha em linear; as cores de tinta abaixo estão em sRGB, como um color picker."""
 return tuple(v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4 for v in c)

def image(folder,name,linear):
 img=bpy.data.images.load(str(ROOT/'public/textures'/folder/(name+'.jpg')),check_existing=True)
 if linear:img.colorspace_settings.name='Non-Color'
 if max(img.size)>TEXEL:img.scale(TEXEL,TEXEL)
 return img

def painted(name,paint,folder=None,metal=.0,rough=.55,bump=.55,emission=0.0):
 """Metal pintado: a COR é constante (vira `baseColorFactor` no glTF) e o mapa entra só como
 relevo e variação de rugosidade. Sem mapa difuso não há como o casco voltar a parecer tábua."""
 m=bpy.data.materials.new(name);m.use_nodes=True;n=m.node_tree.nodes;l=m.node_tree.links;b=n['Principled BSDF']
 color=(*srgb(paint),1.0)
 b.inputs['Base Color'].default_value=color
 b.inputs['Metallic'].default_value=metal
 b.inputs['Roughness'].default_value=rough
 if emission:b.inputs['Emission Color'].default_value=color;b.inputs['Emission Strength'].default_value=emission
 if folder:
  normal=n.new('ShaderNodeTexImage');normal.image=image(folder,'nor_gl',True)
  mapping=n.new('ShaderNodeNormalMap');mapping.inputs['Strength'].default_value=bump
  l.new(normal.outputs['Color'],mapping.inputs['Color']);l.new(mapping.outputs['Normal'],b.inputs['Normal'])
  # Desgaste moderado: o canal verde do ARM (roughness) modula a tinta sem trazer cor nenhuma.
  # O MULTIPLY vira `roughnessFactor` no glTF; sem ele o mapa mandava sozinho e o grafite saía
  # fosco de tinta fresca em vez de semi-brilhante.
  arm=n.new('ShaderNodeTexImage');arm.image=image(folder,'arm',True)
  split=n.new('ShaderNodeSeparateColor');l.new(arm.outputs['Color'],split.inputs['Color'])
  scale=n.new('ShaderNodeMath');scale.operation='MULTIPLY';scale.inputs[1].default_value=rough
  l.new(split.outputs['Green'],scale.inputs[0]);l.new(scale.outputs['Value'],b.inputs['Roughness'])
 return m

# Tinta industrial: casco grafite, deck oliva, corrimão aço claro.
HULL=painted('Dropship hull graphite',(.26,.275,.29),'rusty_painted_metal',.78,.44,.5)
DECK=painted('Dropship deck olive',(.35,.365,.285),'corrugated_iron',.6,.58,.65)
RAIL=painted('Dropship rail steel',(.55,.575,.56),'rusty_painted_metal',.85,.35,.4)
# Perigo: amarelo e preto FOSCOS, sem emissão. A luz da boca são só as guias menta.
HAZARD=painted('Dropship hazard yellow',(.86,.66,.10),None,.1,.52)
SHADOW=painted('Dropship hazard black',(.075,.075,.08),None,.1,.5)
GLOW=painted('Dropship reactor glow',(.30,1.0,.72),None,.0,.3,0,2.2)
GLASS=painted('Dropship canopy glass',(.10,.30,.19),None,.62,.16)

root=bpy.data.objects.new('DropshipDeck',None);scene.collection.objects.link(root)

def uvs(o,tile):
 """Projeção em caixa na escala do mundo: sem isso o relevo de 2 m esticaria por 19 m de deck."""
 bpy.context.view_layer.objects.active=o;o.select_set(True)
 bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT')
 bpy.ops.uv.cube_project(cube_size=tile,correct_aspect=False)
 bpy.ops.object.mode_set(mode='OBJECT');o.select_set(False)

def box(name,center,size,material,tile=2.5,bevel=.02,rotation=(0,0,0)):
 bpy.ops.mesh.primitive_cube_add(size=1,location=center,rotation=rotation)
 o=bpy.context.object;o.name=name;o.dimensions=size
 bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
 o.data.materials.append(material)
 if bevel:
  mod=o.modifiers.new('Edge wear','BEVEL');mod.width=bevel;mod.segments=2;bpy.ops.object.modifier_apply(modifier=mod.name)
 uvs(o,tile)
 o.parent=root;o.matrix_parent_inverse=root.matrix_world.inverted()
 return o

def strut(name,a,b,width,height,material,tile=1.5,gusset=True):
 """Viga entre DOIS pontos reais. As escoras antigas eram caixas giradas no chão do espaço e as
 pontas ficavam penduradas no ar; aqui cada extremidade é dada e termina dentro de outro volume."""
 a,b=Vector(a),Vector(b);direction=b-a;length=direction.length
 rotation=direction.to_track_quat('X','Z').to_euler()
 o=box(name,tuple((a+b)/2),(length,width,height),material,tile,.015,tuple(rotation))
 if gusset:
  for end in (a,b):box(name+' gusset',tuple(end),(width*2.2,width*2.2,height*1.6),material,tile,.02)
 return o

def lathe(name,rings,material,segments=40,center=(0,0,0),tile=2.5,axis='Z'):
 """Volume de revolução em torno de Z, mesmo helper do disco voador do mundo alienígena.
 `axis='X'` gira o resultado para deitar a nacele ao longo da direção de voo."""
 vertices=[(math.cos(i/segments*math.tau)*r,math.sin(i/segments*math.tau)*r,z) for r,z in rings for i in range(segments)]
 faces=[]
 for j in range(len(rings)-1):
  for i in range(segments):
   faces.append((j*segments+i,j*segments+(i+1)%segments,(j+1)*segments+(i+1)%segments,(j+1)*segments+i))
 faces+=[tuple(reversed(range(segments))),tuple((len(rings)-1)*segments+i for i in range(segments))]
 mesh=bpy.data.meshes.new(name);mesh.from_pydata(vertices,[],faces);mesh.materials.append(material)
 o=bpy.data.objects.new(name,mesh);scene.collection.objects.link(o)
 bm=bmesh.new();bm.from_mesh(mesh);bmesh.ops.recalc_face_normals(bm,faces=bm.faces);bm.to_mesh(mesh);bm.free()
 # Comprimento de arco real no U: o `atan2*2` antigo espremia o mapa em faixas no disco de 46 m.
 span=max(r for r,_ in rings)*math.tau
 uv=mesh.uv_layers.new()
 for p in mesh.polygons:
  for li in p.loop_indices:
   v=mesh.vertices[mesh.loops[li].vertex_index].co
   uv.data[li].uv=(v.x/tile,v.y/tile) if abs(p.normal.z)>.6 else (math.atan2(v.y,v.x)/math.tau*span/tile,v.z/tile)
 o.rotation_euler=(0,math.pi/2,0) if axis=='X' else (0,0,0)
 o.location=center
 bpy.context.view_layer.objects.active=o;o.select_set(True)
 bpy.ops.object.transform_apply(location=True,rotation=True,scale=True);o.select_set(False)
 o.parent=root
 return o

# ---------------------------------------------------------------- deck aberto
DECK_BACK,DECK_FRONT=-18.4,.8
box('Deck plating',((DECK_BACK+DECK_FRONT)/2,0,-.18),(DECK_FRONT-DECK_BACK,6.8,.36),DECK,2.5)
for side in (-1,1):
 box('Deck kick plate',((DECK_BACK+DECK_FRONT)/2,side*3.18,.13),(DECK_FRONT-DECK_BACK,.48,.30),DECK,1.8)
# Frisos antiderrapantes rasos, em grafite contra o oliva da chapa: leem como piso de metal sem
# virar degrau de 8 cm sob o pé de quem corre.
for i in range(9):
 box('Deck traction rib',(DECK_BACK+1.1+i*2.1,0,TREAD/2-.03),(.42,6.76,.06+TREAD),HULL,1.0,.006)

# ------------------------------------------------- corrimão nas laterais, saída aberta na frente
RAIL_BACK,RAIL_FRONT=-17.6,-1.9
for side in (-1,1):
 posts=int((RAIL_FRONT-RAIL_BACK)//1.62)+1
 for i in range(posts):
  box('Rail stanchion',(RAIL_BACK+i*((RAIL_FRONT-RAIL_BACK)/max(1,posts-1)),side*3.16,.60),(.13,.13,1.14),RAIL,1.0,.012)
 box('Rail top bar',((RAIL_BACK+RAIL_FRONT)/2,side*3.16,1.14),(RAIL_FRONT-RAIL_BACK+.3,.13,.11),RAIL,1.0,.012)
 box('Rail mid bar',((RAIL_BACK+RAIL_FRONT)/2,side*3.16,.62),(RAIL_FRONT-RAIL_BACK+.3,.09,.08),RAIL,1.0,.01)
 # Fecha a lateral só até a boca: a frente continua aberta, é por onde o corpo sai.
 box('Rail mesh panel',((RAIL_BACK+RAIL_FRONT)/2,side*3.16,.30),(RAIL_FRONT-RAIL_BACK,.04,.44),RAIL,1.0,0)
 box('Exit stanchion',(-1.55,side*3.16,.40),(.22,.22,.80),RAIL,1.0,.02)
 # Guias menta pequenas: é a ÚNICA luz da boca, no lugar da antiga placa branca acesa.
 lathe('Exit beacon',[(.02,-.15),(.15,-.04),(.15,.04),(.02,.15)],GLOW,16,(-1.55,side*3.16,.95),.5)
 box('Exit guide light',(-.15,side*3.02,TREAD-.012),(.7,.10,.024),GLOW,.5,0)

# Marcação de perigo amarelo/preto, FOSCA e no mesmo plano dos frisos: quem corre pisa nela sem
# tropeçar e sem o pé atravessar uma placa saliente.
for i in range(14):
 y=-3.15+i*.45
 box('Exit hazard band',(.25,y+.225,TREAD-.015),(1.0,.45,.03),HAZARD if i%2==0 else SHADOW,1.0,.004)
for side in (-1,1):
 box('Exit hazard chevron',(-1.05,side*2.3,TREAD-.015),(1.0,.42,.03),HAZARD,1.0,.004,(0,0,side*.5))

# ---------------------------------------------------------------- volume estrutural sob o deck
box('Deck keel beam',(-9.6,0,-1.35),(17.6,1.35,2.0),HULL,2.5)
box('Deck understructure',(-9.9,0,-.78),(17.2,5.0,.95),HULL,2.5)
for i in range(7):
 box('Deck cross frame',(-17.0+i*2.5,0,-1.15),(.34,5.9,1.6),HULL,1.5,.015)
for side in (-1,1):
 box('Deck outrigger',(-10.4,side*3.05,-.80),(15.0,.6,1.0),HULL,1.5)
 # Escoras com as DUAS pontas dentro de peças reais: longarina lateral → quilha central.
 strut('Gantry strut',(-5.6,side*2.95,-1.05),(-9.4,side*.5,-2.05),.34,.34,HULL)
 strut('Gantry strut',(-13.6,side*2.95,-1.05),(-17.4,side*.5,-2.05),.34,.34,HULL)

# ---------------------------------------------------------------- casco da nave, atrás do deck
HULL_X=-25.6
lathe('Ship hull',[(1.1,-3.4),(4.6,-2.3),(7.0,-.7),(7.35,.2),(4.4,2.0),(1.4,2.6)],HULL,48,(HULL_X,0,1.1),3.5)
lathe('Ship rim reactor',[(7.28,.02),(7.46,.16),(7.28,.30)],GLOW,48,(HULL_X,0,1.1),1.0)
lathe('Ship canopy',[(3.6,1.9),(2.9,2.8),(1.8,3.5),(.3,3.9)],GLASS,40,(HULL_X,0,1.1),2.5)
lathe('Ship landing collar',[(2.2,-3.45),(3.0,-3.9),(2.9,-4.1),(1.0,-4.1)],HULL,32,(HULL_X,0,1.1),1.5)
for i in range(10):
 a=i/10*math.tau
 lathe('Ship hull light',[(.03,-.14),(.15,-.04),(.15,.05),(.03,.15)],GLOW,12,(HULL_X+math.cos(a)*5.6,math.sin(a)*5.6,.45),.4)

# Propulsores: nacele de revolução com aro, recesso e o disco luminoso LÁ DENTRO.
# O perfil sai do bico, corre pela casca, alarga no aro traseiro e volta para dentro cavando a boca.
NACELLE=[(.32,2.85),(.95,2.30),(1.14,1.10),(1.17,-2.55),(1.28,-3.24),(1.30,-3.40),
         (1.06,-3.34),(.88,-3.02),(.74,-2.60),(.64,-2.24)]
for side in (-1,1):
 pod=(-27.4,side*9.2,.35)
 lathe('Engine nacelle',NACELLE,HULL,36,pod,2.5,'X')
 # Anel do bocal e disco recuado 1,1 m dentro da boca: é cavidade, não face chapada.
 lathe('Engine nozzle ring',[(1.02,-3.30),(1.12,-3.22),(1.02,-3.14)],GLOW,36,pod,.6,'X')
 lathe('Engine core glow',[(.0,-2.30),(.58,-2.34),(.58,-2.40),(.0,-2.44)],GLOW,28,pod,.6,'X')
 # Pilone ligando a nacele ao casco, com as duas pontas dentro de volume.
 strut('Engine pylon',(-27.4,side*6.4,.35),(-27.4,side*8.6,.35),1.9,.52,HULL,1.5,False)
 # Faixa escura de tomada, rente à casca: um anel não tem como espetar para fora da nacele.
 lathe('Engine intake band',[(1.15,1.05),(1.19,1.20),(1.19,1.55),(1.15,1.70)],SHADOW,36,pod,.6,'X')

# ---------------------------------------------------------------- conferências antes de juntar
# Estas três falhas foram apontadas no render do Codex. Ficam como asserção de build para não
# voltarem em silêncio numa reexportação futura.
def world_box(o):
 corners=[o.matrix_world@Vector(c) for c in o.bound_box]
 return (Vector((min(c.x for c in corners),min(c.y for c in corners),min(c.z for c in corners))),
         Vector((max(c.x for c in corners),max(c.y for c in corners),max(c.z for c in corners))))

meshes=[o for o in scene.objects if o.type=='MESH']
def anchored(point,exclude,slack=.02):
 """A ponta da escora precisa cair DENTRO de outra peça, não pendurada no ar."""
 p=Vector(point)
 return [o.name for o in meshes if o.name!=exclude and o.name.split('.')[0]!=exclude
         and all(world_box(o)[0][i]-slack<=p[i]<=world_box(o)[1][i]+slack for i in range(3))]

for side in (-1,1):
 for a,b in [((-5.6,side*2.95,-1.05),(-9.4,side*.5,-2.05)),((-13.6,side*2.95,-1.05),(-17.4,side*.5,-2.05))]:
  for end in (a,b):
   hosts=[h for h in anchored(end,'Gantry strut') if not h.startswith('Gantry strut')]
   assert hosts,f'escora com a ponta {end} pendurada no ar'

tread_top=max(world_box(o)[1].z for o in meshes if o.name.startswith('Deck traction rib'))
assert tread_top<=TREAD+1e-6,f'nervura {tread_top:.3f} m acima da chapa; o pé pousaria no ar'
hazard_top=max(world_box(o)[1].z for o in meshes if o.name.startswith('Exit hazard'))
assert hazard_top<=TREAD+1e-6,f'faixa de perigo {hazard_top:.3f} m acima da chapa'
guide_top=max(world_box(o)[1].z for o in meshes if o.name.startswith('Exit guide light'))
assert guide_top<=TREAD+1e-6,f'guia da boca {guide_top:.3f} m acima da chapa'

for name,material in [('Exit hazard band',None),('Exit hazard chevron',None)]:
 for o in meshes:
  if o.name.startswith(name):
   assert o.data.materials[0] in (HAZARD,SHADOW),f'{o.name} não é marcação fosca'
assert HAZARD.node_tree.nodes['Principled BSDF'].inputs['Emission Strength'].default_value==0
assert SHADOW.node_tree.nodes['Principled BSDF'].inputs['Emission Strength'].default_value==0

for side in (-1,1):
 rim=[o for o in meshes if o.name.startswith('Engine nozzle ring') and world_box(o)[0].y*side>0][0]
 core=[o for o in meshes if o.name.startswith('Engine core glow') and world_box(o)[0].y*side>0][0]
 shell=[o for o in meshes if o.name.startswith('Engine nacelle') and world_box(o)[0].y*side>0][0]
 # O brilho fica recuado atrás do aro, dentro da nacele: motor com boca, não caixa com face acesa.
 assert world_box(core)[0].x>world_box(rim)[1].x,'disco do motor não está recuado no bocal'
 assert world_box(core)[0].x-world_box(shell)[0].x>.8,'recesso do bocal raso demais'

# ---------------------------------------------------------------- lote por material
GROUPS={HULL:'Dropship structure',DECK:'Dropship deck',RAIL:'Dropship railings',
        HAZARD:'Dropship hazard marks',SHADOW:'Dropship hazard shadow',
        GLOW:'Dropship reactor lights',GLASS:'Dropship canopy'}
for material,label in GROUPS.items():
 objects=[o for o in scene.objects if o.type=='MESH' and o.parent==root and o.data.materials and o.data.materials[0]==material]
 if not objects:continue
 if len(objects)>1:
  bpy.ops.object.select_all(action='DESELECT')
  for o in objects:o.select_set(True)
  bpy.context.view_layer.objects.active=objects[0];bpy.ops.object.join()
 bpy.context.view_layer.objects.active=objects[0];objects[0].name=label;objects[0].data.name=label

blend=ROOT/'art/blender';blend.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=str(blend/'Dropship_Insertion_Deck.blend'))
bpy.ops.export_scene.gltf(filepath=str(ROOT/'public/models/dropship-deck.glb'),export_format='GLB',
                          export_animations=False,export_image_format='JPEG',export_apply=True)
print('DROPSHIP OK',sorted(o.name for o in scene.objects if o.type=='MESH'))
