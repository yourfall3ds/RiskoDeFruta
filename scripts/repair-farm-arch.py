"""Fit the existing textured scans around the playable wormhole opening."""
import bpy, math
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parent.parent

def repair_arch(scene):
    stones=sorted([o for o in scene.objects if o.type=='MESH' and o.name.startswith('coast_land dressed') and abs(o.location.y+33)<.01 and abs(o.location.x)<3.2],key=lambda o:o.name)
    assert len(stones)==17, f'Expected 17 doorway stones, found {len(stones)}'
    for i,o in enumerate(stones):
        o.rotation_euler=(0,0,i*.71)
        o.scale=(1,1,1)
        bpy.context.view_layer.update()
        corners=[o.matrix_world@Vector(v) for v in o.bound_box]
        lo=Vector(tuple(min(v[k] for v in corners) for k in range(3)))
        hi=Vector(tuple(max(v[k] for v in corners) for k in range(3)))
        size=hi-lo
        o.scale=(1.22/size.x,1.08/size.y,1.12/size.z)
        bpy.context.view_layer.update()
        corners=[o.matrix_world@Vector(v) for v in o.bound_box]
        center=sum(corners,Vector())/8
        if i<13:
            a=i/12*math.pi
            target=Vector((-math.cos(a)*2.95,-33,7.6+math.sin(a)*2.95))
        else:
            target=Vector(((-1 if i<15 else 1)*2.95,-33,5.55+(i%2)*1.05))
        o.location+=target-center

if __name__=='__main__':
    bpy.ops.wm.open_mainfile(filepath=str(ROOT/'art/blender/Farm_World_Polished.blend'))
    bpy.context.preferences.filepaths.save_version=0
    repair_arch(bpy.context.scene)
    bpy.ops.object.select_all(action='DESELECT')
    for o in bpy.context.scene.objects:
        if o.type=='MESH' and o.location.z>-1000 and not o.hide_render:o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(ROOT/'public/models/farm-world.glb'),export_format='GLB',use_selection=True,export_animations=False,export_image_format='JPEG',export_jpeg_quality=88)
    bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art/blender/Farm_World_Polished.blend'),compress=True)
    print('DOORWAY REPAIRED',flush=True)
