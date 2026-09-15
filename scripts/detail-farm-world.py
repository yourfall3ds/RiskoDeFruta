"""Second authored dressing pass; uses shared scan LODs and existing game-ready source."""
import bpy, math, random, json
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parent.parent
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'art/blender/Farm_World_GameReady.blend'))
scene=bpy.context.scene;random.seed(714)
def pos(x,y,z):return Vector((-x,-z,y))
# The upper island starts at z=20. End the ramp there, before it crosses the plateau floor.
for obj in list(scene.objects):
    if obj.type!='MESH' or obj.location.z<-1000:continue
    if 'coast_land' in obj.name:
        if abs(obj.location.x)<7 and 19<-obj.location.y<29 and obj.location.z>-4:obj.location.z-=7
    elif not any(name in obj.name for name in ['fern','grass','tree']):
        inverse=obj.matrix_world.inverted()
        for vertex in obj.data.vertices:
            world=obj.matrix_world@vertex.co;x,h,z=-world.x,world.z,-world.y
            ramp=abs(abs(x)-4)<.001 and abs(h-5)<.001 and abs(z-26)<.001
            railing=4.12<abs(x)<4.48 and 9.85<z<26.15 and 0<h<6.4
            if ramp or railing:world.y=-(10+(z-10)*10/16);vertex.co=inverse@world
collision=json.loads((ROOT/'public/models/farm-collision.json').read_text())
for surface in collision['surfaces']:
    if surface['id']=='ramp':surface.update(z=15,depth=10,slopeZ=.5)
(ROOT/'public/models/farm-collision.json').write_text(json.dumps(collision))
def lod(data,limit):
    if len(data.polygons)<=limit:return data
    mesh=data.copy();o=bpy.data.objects.new('LOD temp',mesh);scene.collection.objects.link(o)
    bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o
    mod=o.modifiers.new('Screen size budget','DECIMATE');mod.ratio=limit/len(mesh.polygons);bpy.ops.object.modifier_apply(modifier=mod.name)
    result=o.data;bpy.data.objects.remove(o,do_unlink=True);return result
groups={}
for o in scene.objects:
    if o.type=='MESH' and o.location.z>-1000:groups.setdefault(o.data,[]).append(o)
for data,users in groups.items():
    name=users[0].name
    if 'coast_land' in name:
        near=lod(data,6000);far=lod(data,1400)
        for o in users:o.data=near if abs(o.location.x)<30 and abs(o.location.y)<50 else far
    elif 'island_tree' in name:
        near=lod(data,30000);far=lod(data,12000)
        for o in users:o.data=near if abs(o.location.x)<30 and abs(o.location.y)<50 else far
    elif 'fern' in name or 'grass' in name:
        reduced=lod(data,2000 if 'fern' in name else 1500)
        for o in users:o.data=reduced
def texture(material,asset):
    n=material.node_tree.nodes;l=material.node_tree.links;bs=n.get('Principled BSDF')
    for socket in ['Base Color','Normal']:
        for link in list(bs.inputs[socket].links):l.remove(link)
    tex=n.new('ShaderNodeTexImage');tex.image=bpy.data.images.load(str(ROOT/f'public/textures/{asset}/Diffuse.jpg'),check_existing=True);l.new(tex.outputs['Color'],bs.inputs['Base Color'])
    normal=n.new('ShaderNodeTexImage');normal.image=bpy.data.images.load(str(ROOT/f'public/textures/{asset}/nor_gl.jpg'),check_existing=True);normal.image.colorspace_settings.name='Non-Color'
    bump=n.new('ShaderNodeNormalMap');l.new(normal.outputs['Color'],bump.inputs['Color']);l.new(bump.outputs[0],bs.inputs['Normal'])
texture(bpy.data.materials['Aged silo steel'],'corrugated_iron')
track=bpy.data.materials['Leaf litter soil'].copy();track.name='Sunlit farm track';texture(track,'brown_mud_02')
verts=[];faces=[]
for i,z in enumerate(sorted(set([-24+j*1.6 for j in range(35)]+[10,20]))):
    h=max(0,min(5,(z-10)*.5))+.028
    width=2.9+math.sin(i*1.7)*.13
    verts.extend([pos(-width,h,z),pos(width,h,z)])
    if i:faces.append((2*i-2,2*i-1,2*i+1,2*i))
mesh=bpy.data.meshes.new('Worn track');mesh.from_pydata(verts,[],faces);mesh.materials.append(track)
o=bpy.data.objects.new('Worn track',mesh);scene.collection.objects.link(o)
uv=mesh.uv_layers.new(name='UVMap')
for p in mesh.polygons:
    for li in p.loop_indices:
        co=mesh.vertices[mesh.loops[li].vertex_index].co;uv.data[li].uv=(co.x/3,co.y/3)
# Place photographic plant meshes along the approach, keeping the firing corridor clear.
def scan(name,x,y,z,height):
    source=next(o for o in scene.objects if name in o.name and o.type=='MESH' and o.location.z>-1000)
    o=bpy.data.objects.new(name+' path dressing',source.data);scene.collection.objects.link(o);o.location=pos(x,y,z)
    localheight=max(v.co.z for v in o.data.vertices)-min(v.co.z for v in o.data.vertices)
    o.scale=(height/max(.01,localheight),)*3;o.rotation_euler.z=random.random()*math.tau
for side in [-1,1]:
    for j in range(60):
        z=random.uniform(-20,9);x=side*random.uniform(3.7,5.7)
        scan('fern_02' if j%3==0 else 'grass_medium_01',x,.035,z,random.uniform(.3,.78))
    for j in range(16):
        scan('fern_02',side*random.uniform(7,9),.035,random.uniform(-17,5),random.uniform(.75,1.2))
for image in bpy.data.images:
    if image.size[0]:
        f=min(1,2048/max(image.size));image.scale(round(image.size[0]*f),round(image.size[1]*f))
bpy.ops.object.select_all(action='DESELECT')
for obj in scene.objects:
    if obj.type=='MESH' and obj.location.z>-1000:obj.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(ROOT/'public/models/farm-world.glb'),export_format='GLB',use_selection=True,export_animations=False,export_image_format='JPEG',export_jpeg_quality=88,export_image_quality=88)
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art/blender/Farm_World_Dressed.blend'))
print('DRESSED', (ROOT/'public/models/farm-world.glb').stat().st_size,flush=True)
