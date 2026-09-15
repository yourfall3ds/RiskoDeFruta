"""Conform a connected, textured track network to the existing collision surface.
Run after highland terrain/landing authoring. Collision and navigation are unchanged.
"""
import bpy,json,math
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree
ROOT=Path(__file__).resolve().parent.parent
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'art/blender/Highland_Farms.blend'))
art=list(bpy.context.selected_objects)
def pos(x,y,z):return Vector((-x,-z,y))
data=json.loads((ROOT/'public/models/highland-farms-collision.json').read_text())
p=data['navPositions'];ix=data['navIndices']
bvh=BVHTree.FromPolygons([pos(*p[i:i+3]) for i in range(0,len(p),3)],[ix[i:i+3] for i in range(0,len(ix),3)],all_triangles=True)
trails=json.loads((ROOT/'docs/highland-trails.json').read_text(encoding='utf-8'))
segments=[(a,b,t['width']/2) for t in trails for a,b in zip(t['points'],t['points'][1:])]
def distance(x,z,a,b):
 dx=b[0]-a[0];dz=b[1]-a[1];t=max(0,min(1,((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz)))
 return math.hypot(x-a[0]-t*dx,z-a[1]-t*dz)
def coverage(x,z):
 d=min(distance(x,z,a,b)-w for a,b,w in segments)
 # Worn boundaries, with a narrow transparent transition into existing soil.
 edge=.12*math.sin(x*1.7+z*.8)+.07*math.sin(z*3.3)
 return max(0,min(1,(.32-d+edge)/.55))
mat=bpy.data.materials.new('Highland worn earth trails');mat.use_nodes=True
nodes=mat.node_tree.nodes;links=mat.node_tree.links;bs=next(n for n in nodes if n.type=='BSDF_PRINCIPLED');bs.inputs['Roughness'].default_value=.91
for filename,normal in [('Diffuse.jpg',False),('nor_gl.jpg',True)]:
 tex=nodes.new('ShaderNodeTexImage');tex.image=bpy.data.images.load(str(ROOT/'public/textures/brown_mud_02'/filename),check_existing=True)
 if normal:
  tex.image.colorspace_settings.name='Non-Color';nm=nodes.new('ShaderNodeNormalMap');nm.inputs['Strength'].default_value=.7;links.new(tex.outputs['Color'],nm.inputs['Color']);links.new(nm.outputs[0],bs.inputs['Normal'])
 else:links.new(tex.outputs['Color'],bs.inputs['Base Color'])
col=nodes.new('ShaderNodeVertexColor');col.layer_name='Trail edge';links.new(col.outputs['Alpha'],bs.inputs['Alpha']);mat.surface_render_method='DITHERED'
verts=[];faces=[];colors=[];lookup={};step=.65
for center,ranges in [(0,(405,592,245,369)),(1,(631,788,294,399)),(2,(567,664,428,586))]:
 xmin,xmax,zmin,zmax=ranges
 for gx in range(math.floor(xmin/step),math.ceil(xmax/step)):
  for gz in range(math.floor(zmin/step),math.ceil(zmax/step)):
   corners=[(gx,gz),(gx+1,gz),(gx+1,gz+1),(gx,gz+1)]
   alpha=[coverage(x*step,z*step) for x,z in corners]
   if max(alpha)<=0:continue
   hits=[bvh.ray_cast(pos(x*step,100,z*step),Vector((0,0,-1)))[0] for x,z in corners]
   if any(hit is None for hit in hits):continue
   ids=[]
   for (x,z),a,hit in zip(corners,alpha,hits):
    key=(x,z)
    if key not in lookup:
     lookup[key]=len(verts);verts.append(tuple(hit+Vector((0,0,.055))));colors.append((1,1,1,a))
    ids.append(lookup[key])
   faces.extend([(ids[0],ids[1],ids[2]),(ids[0],ids[2],ids[3])])
mesh=bpy.data.meshes.new('Terrain conforming trail union');mesh.from_pydata(verts,[],faces);mesh.update()
obj=bpy.data.objects.new('Highland connected earth trails',mesh);bpy.context.scene.collection.objects.link(obj);obj.data.materials.append(mat);art.append(obj)
uv=mesh.uv_layers.new(name='UVMap');color=mesh.color_attributes.new(name='Trail edge',type='FLOAT_COLOR',domain='CORNER')
for poly in mesh.polygons:
 for li in poly.loop_indices:
  vi=mesh.loops[li].vertex_index;v=mesh.vertices[vi].co;uv.data[li].uv=(v.x/3,v.y/3);color.data[li].color=colors[vi]
# Remove only non-colliding foliage obscuring the authored routes; preserve source scans.
removed=[]
for o in list(art):
 if 'fern' in o.name.lower() and coverage(-o.location.x,-o.location.y)>.05:
  removed.append(o.name);art.remove(o);bpy.data.objects.remove(o,do_unlink=True)
bpy.ops.object.select_all(action='DESELECT')
for o in art:o.select_set(True)
bpy.context.view_layer.objects.active=obj
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art/blender/Highland_Farms_Trails.blend'),compress=True)
bpy.ops.export_scene.gltf(filepath=str(ROOT/'public/models/highland-farms.glb'),export_format='GLB',use_selection=True,export_animations=False)
report={'trails':len(trails),'triangles':len(faces),'vertices':len(verts),'clearedNonCollidingFerns':len(removed),'collisionChanged':False,'source':'art/blender/Highland_Farms_Trails.blend'}
(ROOT/'docs/highland-trails-authoring.json').write_text(json.dumps(report,indent=2))
# Offline overview for artistic review, excluded from exported region.
scene=bpy.context.scene
for o in scene.objects:o.hide_render=o not in art
world=bpy.data.worlds.new('Trail review daylight');scene.world=world;world.use_nodes=True;next(n for n in world.node_tree.nodes if n.type=='BACKGROUND').inputs[0].default_value=(.16,.21,.3,1);next(n for n in world.node_tree.nodes if n.type=='BACKGROUND').inputs[1].default_value=.7
light=bpy.data.lights.new('Review sun','SUN');light.energy=3;lo=bpy.data.objects.new('Review sun',light);scene.collection.objects.link(lo);lo.rotation_euler=(.35,-.5,-.4)
camera=bpy.data.cameras.new('Review camera');co=bpy.data.objects.new('Review camera',camera);scene.collection.objects.link(co);co.location=pos(590,460,90);target=pos(590,20,395);co.rotation_euler=(target-co.location).to_track_quat('-Z','Y').to_euler();camera.type='ORTHO';camera.ortho_scale=480;scene.camera=co
scene.render.engine='CYCLES';scene.cycles.samples=12;scene.cycles.use_denoising=True
scene.render.resolution_x=1440;scene.render.resolution_y=1080;scene.render.resolution_percentage=100;scene.render.image_settings.file_format='PNG';scene.render.filepath=str(ROOT/'art/highland-trails-overview.png');bpy.ops.render.render(write_still=True)
print('HIGHLAND TRAILS COMPLETE',report,flush=True)
