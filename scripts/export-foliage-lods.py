"""Export lightweight local geometry LODs; textures remain shared with the master mesh."""
import bpy,json
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
bpy.ops.wm.read_factory_settings(use_empty=True);bpy.ops.import_scene.gltf(filepath=str(ROOT/'public/models/farm-world.glb'))
source=next(o for o in bpy.context.scene.objects if o.type=='MESH' and 'fern' in o.name.lower())
result=[]
for budget,distance in [(850,12),(250,30)]:
    o=bpy.data.objects.new('Foliage LOD',source.data.copy());bpy.context.scene.collection.objects.link(o);bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o
    mod=o.modifiers.new('Distance silhouette','DECIMATE');mod.ratio=budget/len(o.data.polygons);bpy.ops.object.modifier_apply(modifier=mod.name);mesh=o.data;mesh.calc_loop_triangles()
    positions=[];normals=[];uvs=[];indices=[];uv=mesh.uv_layers.active
    for tri in mesh.loop_triangles:
        for vi,li in zip(tri.vertices,tri.loops):
            v=mesh.vertices[vi];p=v.co;n=v.normal;positions.extend(round(float(x),5) for x in (p.x,p.z,-p.y));normals.extend(round(float(x),4) for x in (n.x,n.z,-n.y));uvs.extend(round(float(x),5) for x in (uv.data[li].uv.x,1-uv.data[li].uv.y));indices.append(len(indices))
    result.append(dict(distance=distance,positions=positions,normals=normals,uvs=uvs,indices=indices))
(ROOT/'public/models/foliage-lods.json').write_text(json.dumps(result,separators=(',',':')))
print('FOLIAGE LODS READY',flush=True)

