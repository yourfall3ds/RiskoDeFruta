"""Dense textured leaf clusters over the original three-dimensional scanned branches."""
import bpy,bmesh,math
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parent.parent
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'art/blender/Farm_World_Polished.blend'))
bpy.context.preferences.filepaths.save_version=0
trees=[o for o in bpy.context.scene.objects if o.type=='MESH' and o.name.startswith('island_tree')]
layout=[]
for tree in trees:
    points=[tree.matrix_world@Vector(v) for v in tree.bound_box]
    lo=Vector(tuple(min(p[k] for p in points) for k in range(3)));hi=Vector(tuple(max(p[k] for p in points) for k in range(3)))
    layout.append((tree.name,lo,hi))
for data in set(o.data for o in trees):
    leaves={i for i,m in enumerate(data.materials) if m and '_leaves' in m.name}
    bm=bmesh.new();bm.from_mesh(data);bmesh.ops.delete(bm,geom=[f for f in bm.faces if f.material_index in leaves],context='FACES');bm.to_mesh(data);bm.free()
material=bpy.data.materials.new('tree-canopy-oak-leaves');material.use_nodes=True
bs=material.node_tree.nodes.get('Principled BSDF');bs.inputs['Roughness'].default_value=.88
texture=material.node_tree.nodes.new('ShaderNodeTexImage');texture.image=bpy.data.images.load(str(ROOT/'public/textures/leaf-canopy.png'))
material.node_tree.links.new(texture.outputs['Color'],bs.inputs['Base Color']);material.node_tree.links.new(texture.outputs['Alpha'],bs.inputs['Alpha'])
material.surface_render_method='DITHERED';material.use_backface_culling=False
vertices=[];faces=[];uvs=[]
for i in range(3):
    a=i*math.pi/3
    for x,z in [(-.75,-.5),(.75,-.5),(.75,.5),(-.75,.5)]:vertices.append((x*math.cos(a),x*math.sin(a),z))
    faces.append(tuple(range(i*4,i*4+4)))
data=bpy.data.meshes.new('Dense crossed foliage');data.from_pydata(vertices,[],faces);data.materials.append(material)
uv=data.uv_layers.new()
for p in data.polygons:
    for li,coord in zip(p.loop_indices,[(0,0),(1,0),(1,1),(0,1)]):uv.data[li].uv=coord
for name,lo,hi in layout:
    width=max(hi.x-lo.x,hi.y-lo.y);height=hi.z-lo.z;center=(lo+hi)/2
    for i,(dx,dy,dz) in enumerate([(-.18,0,.66),(.18,.07,.7),(0,-.05,.9)]):
        o=bpy.data.objects.new(f'tree-canopy-{name}-{i}',data);bpy.context.scene.collection.objects.link(o)
        o.location=(center.x+dx*width,center.y+dy*width,lo.z+height*dz)
        o.scale=(width*.36,width*.36,height*.37);o.rotation_euler.z=i*.7
bpy.ops.object.select_all(action='DESELECT')
for o in bpy.context.scene.objects:
    if o.type=='MESH' and o.location.z>-1000 and not o.hide_render:o.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(ROOT/'public/models/farm-world.glb'),export_format='GLB',use_selection=True,export_animations=False,export_image_format='AUTO')
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art/blender/Farm_World_Polished.blend'),compress=True)
print('TEXTURED CANOPIES READY',len(layout),flush=True)
