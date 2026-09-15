"""Close authored floating islands with continuous, UV-mapped geology. No changes to enemies."""
import bpy,math,json,bmesh
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parent.parent
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.preferences.filepaths.save_version=0
scene=bpy.context.scene

def material(name,folder):
 m=bpy.data.materials.new(name);m.use_nodes=True;n=m.node_tree.nodes;l=m.node_tree.links;b=n.get('Principled BSDF');b.inputs['Roughness'].default_value=.92
 for kind,socket in [('Diffuse','Base Color'),('nor_gl','Normal')]:
  t=n.new('ShaderNodeTexImage');t.image=bpy.data.images.load(str(ROOT/'public/textures'/folder/(kind+'.jpg')),check_existing=True)
  if kind=='nor_gl':
   t.image.colorspace_settings.name='Non-Color';normal=n.new('ShaderNodeNormalMap');l.new(t.outputs['Color'],normal.inputs['Color']);l.new(normal.outputs[0],b.inputs[socket])
  else:l.new(t.outputs['Color'],b.inputs[socket])
 return m
rock=material('Continuous weathered cliff','rock_face_03');earth=material('Exposed soil strata','brown_mud_leaves_01')
positions=[];indices=[];boxes=[];audit=[]
islands=[('Main',0,0,0,24,26,23),('Barn plateau',0,34,5,17,14,24),('West outpost',-45,0,0,10.5,12,20),('East outpost',44,8,2,10,11,22)]
for i,(x,z,h,rx,rz) in enumerate([(-55,25,5,13,12),(53,50,11,14,13),(-38,83,18,11,10),(28,105,24,15,12),(-80,115,30,13,14),(85,110,22,16,15)]):islands.append(('Distant '+str(i),x,z,h,rx,rz,26))
# Main walkable landforms. The rim exactly follows the existing 64-segment cultivated floor.
for name,x,z,h,rx,rz,depth in islands:
 count=48 if 'outpost' in name else 64
 rings=[(.035,1),(.38,1),(1.5,.99),(4,.96),(8,.88),(depth*.65,.68),(depth,.28)]
 game=[]
 for j,(drop,scale) in enumerate(rings):
  for i in range(count):
   a=i/count*math.tau;rough=0 if j<2 else (.014*math.sin(a*7+j*.7)+.012*math.sin(a*13-j))
   game.append((x+math.cos(a)*rx*(scale+rough),h-drop,z+math.sin(a)*rz*(scale+rough)))
 game.extend([(x,h-.035,z),(x,h-depth,z)])
 faces=[]
 for j in range(len(rings)-1):
  for i in range(count):
   a=j*count+i;b=j*count+(i+1)%count;c=b+count;d=a+count;faces.append((a,d,c,b))
 top=len(game)-2;bottom=len(game)-1
 for i in range(count):faces.append((top,i,(i+1)%count));faces.append((bottom,(len(rings)-1)*count+(i+1)%count,(len(rings)-1)*count+i))
 mesh=bpy.data.meshes.new(name+' closed geology');mesh.from_pydata([(-v[0],-v[2],v[1]) for v in game],[],faces);mesh.materials.append(rock);mesh.materials.append(earth)
 obj=bpy.data.objects.new(name+' solid earth',mesh);scene.collection.objects.link(obj)
 bm=bmesh.new();bm.from_mesh(mesh);bmesh.ops.recalc_face_normals(bm,faces=bm.faces);bm.to_mesh(mesh);nonmanifold=sum(not e.is_manifold for e in bm.edges);bm.free()
 uv=mesh.uv_layers.new(name='Geology UV')
 for p in mesh.polygons:
  p.material_index=1 if p.center.z>h-.7 else 0
  for li in p.loop_indices:
   v=mesh.vertices[mesh.loops[li].vertex_index].co
   # Per-face triplanar-style UV projection, metres rather than stretched full-island textures.
   if abs(p.normal.z)>.65:u,w=v.x/4,v.y/4
   elif abs(p.normal.x)>abs(p.normal.y):u,w=v.y/4,v.z/4
   else:u,w=v.x/4,v.z/4
   uv.data[li].uv=(u,w)
 mesh.calc_loop_triangles();offset=len(positions)//3
 positions.extend(c for v in mesh.vertices for c in (-v.co.x,v.co.z,-v.co.y))
 for tri in mesh.loop_triangles:indices.extend([offset+tri.vertices[0],offset+tri.vertices[2],offset+tri.vertices[1]])
 # Filled columns prevent entering the previously hollow raised plateau; the upper faces remain walkable.
 if h>0 and not name.startswith('Distant'):
  step=1
  for ix in range(math.floor(x-rx),math.ceil(x+rx)):
   for iz in range(math.floor(z-rz),math.ceil(z+rz)):
    if all(((xx-x)/rx)**2+((zz-z)/rz)**2<.995 for xx in [ix,ix+step] for zz in [iz,iz+step]):boxes.append({'id':name+' earth','min':{'x':ix,'y':-3,'z':iz},'max':{'x':ix+step,'y':h-.02,'z':iz+step}})
 audit.append({'name':name,'nonManifoldEdges':nonmanifold,'triangles':len(mesh.loop_triangles),'depth':depth})
 if nonmanifold:raise RuntimeError('Open shell: '+name)
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art/blender/Solid_Island_Geology.blend'))
bpy.ops.export_scene.gltf(filepath=str(ROOT/'public/models/solid-island-geology.glb'),export_format='GLB',export_animations=False)
(ROOT/'public/models/solid-island-collision.json').write_text(json.dumps({'positions':positions,'indices':indices,'boxes':boxes},separators=(',',':')))
(ROOT/'docs/solid-geology.json').write_text(json.dumps(audit,indent=2))
print('CLOSED GEOLOGY',audit,'colliders',len(boxes),flush=True)
