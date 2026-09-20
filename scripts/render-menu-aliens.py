"""Renderiza cada alienígena empacotado em quatro vistas, sobre um piso, com a pose de espera.

Responde por imagem o que número nenhum responde sozinho: para onde o bicho está virado e se ele
está de pé. As quatro vistas são nomeadas pela DIREÇÃO DA CÂMERA em espaço Blender, então a vista
em que aparece o rosto identifica a frente do modelo:

  `-Y` é a frente canônica de personagem no Blender; `+Y` é as costas; `+X`/`-X` são os perfis.

A pose usada é o primeiro quadro da animação de espera, não a pose de vínculo: nestes modelos a
pose de vínculo não é a pose de jogo, e julgar postura por ela induz a erro.

Uso:
  <blender> -b -P scripts/render-menu-aliens.py -- <pasta-de-saida>
"""
import bpy,sys,math
from mathutils import Vector
from pathlib import Path

ROOT=Path(__file__).resolve().parent.parent
OUT=Path(sys.argv[sys.argv.index('--')+1]) if '--' in sys.argv else ROOT/'.temp/alien-review'
OUT.mkdir(parents=True,exist_ok=True)

# Apelidos da espera, na mesma ordem de preferência que `MENU_ALIEN_PROFILES` usa no runtime.
IDLE_ALIASES=['A_idle','rig|Idle','Armature|await x 2','mixamo.com','rig|rigAction','Idle','idle']
MODELS=['menu-alien-grey']
VIEWS=[('-Y',Vector((0,-1,0))),('+Y',Vector((0,1,0))),('+X',Vector((1,0,0))),('-X',Vector((-1,0,0)))]

def character_objects():
 return [o for o in bpy.context.scene.objects if o.type=='MESH' and not o.name.startswith('REF_')]

def deformed_box(objects):
 lo=Vector((1e9,1e9,1e9));hi=Vector((-1e9,-1e9,-1e9))
 depsgraph=bpy.context.evaluated_depsgraph_get()
 for o in objects:
  evaluated=o.evaluated_get(depsgraph);mesh=evaluated.to_mesh()
  try:
   for v in mesh.vertices:
    w=evaluated.matrix_world@v.co
    lo=Vector((min(lo[i],w[i]) for i in range(3)));hi=Vector((max(hi[i],w[i]) for i in range(3)))
  finally:evaluated.to_mesh_clear()
 return lo,hi

for name in MODELS:
 path=ROOT/'public/models'/(name+'.glb')
 if not path.exists():
  print('SEM ARQUIVO',name);continue
 bpy.ops.wm.read_factory_settings(use_empty=True)
 scene=bpy.context.scene
 scene.render.resolution_x=460;scene.render.resolution_y=620
 bpy.ops.import_scene.gltf(filepath=str(path))

 # Pose de espera: é ela que o jogo mostra.
 rigs=[o for o in scene.objects if o.type=='ARMATURE']
 idle=None
 for alias in IDLE_ALIASES:
  idle=next((a for a in bpy.data.actions if a.name.lower().endswith(alias.lower())),None)
  if idle:break
 if rigs and idle:
  rig=rigs[0];rig.animation_data_create();rig.animation_data.action=idle
  scene.frame_set(int(idle.frame_range[0]))
 bpy.context.view_layer.update()

 objects=character_objects()
 lo,hi=deformed_box(objects)
 height=hi.z-lo.z
 print(f'{name}: altura {height:.3f} | base Z {lo.z:.3f} | largura X {hi.x-lo.x:.3f} | prof Y {hi.y-lo.y:.3f} | espera "{idle.name if idle else "(nenhuma)"}"')

 # Piso no nível da BASE do corpo, para a vista mostrar contato e não a origem do arquivo.
 bpy.ops.mesh.primitive_plane_add(size=max(10,height*8),location=(0,0,lo.z))
 floor=bpy.context.object;floor.name='REF_floor'
 mat=bpy.data.materials.new('REF_floor');mat.use_nodes=True
 checker=mat.node_tree.nodes.new('ShaderNodeTexChecker');checker.inputs['Scale'].default_value=14
 mat.node_tree.links.new(checker.outputs['Color'],mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'])
 floor.data.materials.append(mat)
 # Poste de 1 m para escala, encostado no piso.
 bpy.ops.mesh.primitive_cube_add(size=1,location=(max(1.2,height*.7),0,lo.z+.5))
 post=bpy.context.object;post.name='REF_post';post.scale=(.06,.06,1.0)
 red=bpy.data.materials.new('REF_post');red.use_nodes=True
 red.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=(.92,.06,.06,1)
 post.data.materials.append(red)

 sun=bpy.data.objects.new('REF_sun',bpy.data.lights.new('REF_sun','SUN'));scene.collection.objects.link(sun)
 sun.data.energy=4.5;sun.rotation_euler=(math.radians(52),0,math.radians(30))
 fill=bpy.data.objects.new('REF_fill',bpy.data.lights.new('REF_fill','SUN'));scene.collection.objects.link(fill)
 fill.data.energy=2.2;fill.rotation_euler=(math.radians(64),0,math.radians(205))

 camera=bpy.data.objects.new('REF_cam',bpy.data.cameras.new('REF_cam'));scene.collection.objects.link(camera)
 scene.camera=camera
 focus=Vector(((lo.x+hi.x)/2,(lo.y+hi.y)/2,lo.z+height*.55))
 distance=max(3.0,height*2.2)
 for label,direction in VIEWS:
  camera.location=focus+direction*distance+Vector((0,0,height*.30))
  camera.rotation_euler=(focus-camera.location).to_track_quat('-Z','Y').to_euler()
  scene.render.filepath=str(OUT/f'{name}-{label}.png')
  bpy.ops.render.render(write_still=True)
 print('RENDERIZADO',name)
