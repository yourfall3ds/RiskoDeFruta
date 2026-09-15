import bpy,json
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parent.parent
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'art/blender/Rootwood_Region_Trails.blend'))
art=list(bpy.context.selected_objects)
path=ROOT/'art/rootwood-staging/rootwood-collision.json'
c=json.loads((ROOT/'art/rootwood-staging/rootwood-before-pavilions-collision.json').read_text())
posts=[b for b in c['boxes'] if b['id']=='Orchard store pier']
changes=[]
for b in posts:
 old=b['max']['y'];low=b['min'];high=b['max'];count=0
 for o in art:
  if o.type!='MESH' or o.data.users>1:continue
  inverse=o.matrix_world.inverted()
  for v in o.data.vertices:
   w=o.matrix_world@v.co;x,y,z=-w.x,w.z,-w.y
   if low['x']-.001<=x<=high['x']+.001 and low['z']-.001<=z<=high['z']+.001 and abs(y-old)<.002:
    w.z=41;v.co=inverse@w;count+=1
 assert count==4,(b,count)
 for key in ['positions','solidPositions']:
  p=c[key]
  for i in range(0,len(p),3):
   if low['x']-.001<=p[i]<=high['x']+.001 and low['z']-.001<=p[i+2]<=high['z']+.001 and abs(p[i+1]-old)<.002:p[i+1]=41
 b['max']['y']=41
 changes.append({'x':(low['x']+high['x'])/2,'z':(low['z']+high['z'])/2,'oldTop':old,'newTop':41,'gapRemoved':41-old})
wood=bpy.data.materials.get('Weathered timber')
assert wood
for z in [338,382]:
 # Crossbeam directly below the middle of the pitched roof; roof slope is 1:4.
 for center,dimensions in [((940,40.7,z),(15,.6,.5)),((933,41,z),(.4,.35,8)),((947,41,z),(.4,.35,8))]:
  x,y,zz=center;dx,dy,dz=dimensions
  bpy.ops.mesh.primitive_cube_add(size=1,location=(-x,-zz,y));o=bpy.context.object;o.name='Rootwood pavilion supporting timber';o.dimensions=(dx,dz,dy)
  if dz==8:o.rotation_euler.x=-__import__('math').atan(.25)
  bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.data.materials.append(wood);art.append(o)
  # Overhead beam triangles block the camera and projectiles, leaving ground routes untouched.
  o.data.calc_loop_triangles()
  for poskey,ixkey in [('positions','indices'),('solidPositions','solidIndices')]:
   p=c[poskey];ix=c[ixkey];offset=len(p)//3
   for v in o.data.vertices:
    w=o.matrix_world@v.co;p.extend([-w.x,w.z,-w.y])
   for t in o.data.loop_triangles:ix.extend([offset+t.vertices[0],offset+t.vertices[2],offset+t.vertices[1]])
bpy.ops.object.select_all(action='DESELECT')
for o in art:o.select_set(True)
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art/blender/Rootwood_Region_Pavilions.blend'),compress=True)
bpy.ops.export_scene.gltf(filepath=str(ROOT/'art/rootwood-staging/rootwood.glb'),export_format='GLB',use_selection=True,export_animations=False)
path.write_text(json.dumps(c,separators=(',',':')))
(ROOT/'docs/rootwood-pavilion-repair.json').write_text(json.dumps({'posts':changes,'overheadBeams':6,'groundFootprintsUnchanged':True},indent=2))
print('PAVILION SUPPORTS REPAIRED',changes,flush=True)

