"""Final composition/light-readability pass; run after finish-farm-world.py."""
import bpy,json,math,random
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'art/blender/Farm_World_Final.blend'))
bpy.context.preferences.filepaths.save_version=0
scene=bpy.context.scene;random.seed(53)
# Rebuild the broken grass LOD with complete fern fronds, keeping the original layout.
fern=next(o for o in scene.objects if 'fern' in o.name.lower() and o.type=='MESH' and o.location.z>-1000)
fernHeight=max(v.co.z for v in fern.data.vertices)-min(v.co.z for v in fern.data.vertices)
for o in list(scene.objects):
    if o.type!='MESH' or o.location.z<-1000:continue
    if 'grass' in o.name.lower():
        o.data=fern.data;s=random.uniform(.18,.38)/max(.01,fernHeight);o.scale=(s,s,s)
    if o.data.users>1 or not any(m and m.name in ['Barn red weathered wood','Weathered timber','Ivory trim','Oxidized roof','Lantern glass'] for m in o.data.materials):continue
    inverse=o.matrix_world.inverted()
    for v in o.data.vertices:
        p=o.matrix_world@v.co;x,z,h=-p.x,-p.y,p.z
        if abs(x)<5.31 and 29.25<z<41 and 5<=h<17.1:p.x=-x*1.5;p.y=-(35+(z-35)*1.2);p.z=5+(h-5)*1.35;v.co=inverse@p
red=bpy.data.materials.get('Barn red weathered wood')
if red:
    bs=red.node_tree.nodes.get('Principled BSDF')
    for link in list(bs.inputs['Base Color'].links):red.node_tree.links.remove(link)
    tex=red.node_tree.nodes.new('ShaderNodeTexImage');tex.image=bpy.data.images.load(str(ROOT/'public/textures/barn-red.png'));red.node_tree.links.new(tex.outputs['Color'],bs.inputs['Base Color'])
# Extend the lower vegetation onto rock lips so soil no longer ends in a clean disc.
rock=next(o for o in scene.objects if 'coast_land' in o.name and o.type=='MESH' and o.location.z>-1000)
for i in range(28):
    a=i*math.tau/28;x=math.cos(a)*23;z=math.sin(a)*25
    if abs(z)<2 and abs(x)>18:continue
    o=bpy.data.objects.new('Living cliff fern',fern.data);scene.collection.objects.link(o);o.location=(-x,-z,-.25);s=random.uniform(.5,1)/max(.01,fernHeight);o.scale=(s,s,s);o.rotation_euler=(random.uniform(-.4,.4),random.uniform(-.4,.4),a)
collision=json.loads((ROOT/'public/models/farm-collision.json').read_text())
for b in collision['boxes']:
    if b['id'] not in ['Barn side wall','Barn rear wall','Barn facade']:continue
    if abs((b['min']['x']+b['max']['x'])/2)>6 or not 29<(b['min']['z']+b['max']['z'])/2<41:continue
    for side in ['min','max']:
        p=b[side];p['x']*=1.5;p['z']=35+(p['z']-35)*1.2;p['y']=5+(p['y']-5)*1.35
(ROOT/'public/models/farm-collision.json').write_text(json.dumps(collision))
bpy.ops.object.select_all(action='DESELECT')
for o in scene.objects:
    if o.type=='MESH' and o.location.z>-1000 and not o.hide_render:o.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(ROOT/'public/models/farm-world.glb'),export_format='GLB',use_selection=True,export_animations=False,export_image_format='JPEG',export_jpeg_quality=88)
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art/blender/Farm_World_Polished.blend'),compress=True)
print('POLISHED FARM READY',flush=True)
