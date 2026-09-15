"""Bake walkable faces and separate solid components from the authored Blender world."""
import bpy,json,math,bmesh
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parent.parent
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'art/blender/Farm_World_Polished.blend'))
positions=[];indices=[];boxes=[];source_counts={}
def game(v):return (-v.x,v.z,-v.y)
def eligible(p):return -61<p[0]<61 and -12<p[1]<24 and -32<p[2]<55
for obj in list(bpy.context.scene.objects):
    name=obj.name.lower()
    if obj.type!='MESH' or obj.hide_render or obj.location.z<-1000 or any(x in name for x in ['fern','grass','canopy','icosphere','harvest tomato','harvest watermelon','watering']):continue
    if 'tree' in name:
        p=game(obj.location);boxes.append({'id':obj.name+' trunk','min':dict(zip('xyz',[p[0]-.32,p[1],p[2]-.32])),'max':dict(zip('xyz',[p[0]+.32,p[1]+2.7,p[2]+.32]))});continue
    mesh=obj.data.copy()
    # Collision scan budget affects only this new invisible data, never the rendered meshes.
    if 'coast' in name:
        temp=bpy.data.objects.new('collision-scan',mesh);bpy.context.scene.collection.objects.link(temp)
        bpy.context.view_layer.objects.active=temp;temp.select_set(True)
        mod=temp.modifiers.new('Collision simplification','DECIMATE');mod.ratio=min(1,500/max(1,len(mesh.polygons)))
        bpy.ops.object.modifier_apply(modifier=mod.name);mesh=temp.data.copy();bpy.data.objects.remove(temp,do_unlink=True)
    mesh.calc_loop_triangles();world=[game(obj.matrix_world@v.co) for v in mesh.vertices];offset=len(positions)//3
    positions.extend(n for p in world for n in p);count=0
    for tri in mesh.loop_triangles:
        pts=[world[i] for i in tri.vertices]
        if not any(eligible(p) for p in pts):continue
        # Babylon glTF conversion also mirrors X; reverse winding for Recast/Havok.
        indices.extend([offset+tri.vertices[0],offset+tri.vertices[2],offset+tri.vertices[1]]);count+=1
    if count:source_counts[obj.name]=count
    if any(x in name for x in ['coast','ground','outpost','track','arch','stairs','cable']):continue
    # Connected components recover individual fence rails, crates, doors and walls after render batching.
    adjacency=[[] for _ in mesh.vertices]
    for edge in mesh.edges:
        a,b=edge.vertices;adjacency[a].append(b);adjacency[b].append(a)
    seen=set()
    for start in range(len(world)):
        if start in seen:continue
        group=[start];seen.add(start)
        for v in group:
            for other in adjacency[v]:
                if other not in seen:seen.add(other);group.append(other)
        pts=[world[v] for v in group]
        lo=[min(p[i] for p in pts) for i in range(3)];hi=[max(p[i] for p in pts) for i in range(3)]
        center=[(a+b)/2 for a,b in zip(lo,hi)];size=[b-a for a,b in zip(lo,hi)]
        if not eligible(center) or size[1]<.12 or max(size[0],size[2])>22 or min(size[0],size[2])<.045:continue
        boxes.append({'id':obj.name+':'+str(start),'min':dict(zip('xyz',lo)),'max':dict(zip('xyz',hi))})
    bpy.data.meshes.remove(mesh)
# Rail barriers stop sideways exits from the stair; treads use the smooth gameplay ramp.
for side in [-1,1]:
    for i in range(10):
        x=side*4.08;z=10+i+.5;y=(z-10)*.5
        boxes.append({'id':'stair rail','min':{'x':x-.1,'y':y+.2,'z':z-.5},'max':{'x':x+.1,'y':y+1.1,'z':z+.5}})
data={'positions':[round(v,5) for v in positions],'indices':indices,'boxes':boxes}
(ROOT/'public/models/world-collision-mesh.json').write_text(json.dumps(data,separators=(',',':')))
(ROOT/'docs/collision-bake.json').write_text(json.dumps({'triangles':len(indices)//3,'solidComponents':len(boxes),'sources':source_counts},indent=2))
print('COLLISION BAKE',len(indices)//3,'triangles',len(boxes),'solids',flush=True)
