"""Compose a radial archipelago from shipped landscapes and real Quaternius bridge modules.

No new world primitive: source GLB triangles are separated by authored island footprint,
subdivided for curvature, and bent onto the planet. Collision uses the SAME final triangles.
Run with Blender --background --python scripts/build-planet-archipelago.py.
"""
import bpy, bmesh, math, json, shutil, gzip,sys,random
from pathlib import Path
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

ROOT=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(ROOT/'scripts'))
from pack_planet_buffers import compact
OUT=ROOT/'public/models'
R=180.0
KIT=Path(r'C:/Users/darck/transformice/assets/itens 3d/Assets baixados novos/Medieval Village MegaKit[Standard]/Medieval Village MegaKit[Standard]/glTF')
NATURE=Path(r'C:/Users/darck/transformice/assets/itens 3d/Assets baixados novos/Stylized Nature MegaKit[Standard]/glTF')
LOCAL=ROOT/'art/source/planet-bridge'
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.preferences.filepaths.save_version=0
scene=bpy.context.scene

def game(v): return Vector((-v.x,v.z,-v.y))
def blender(v): return Vector((-v.x,-v.z,v.y))
def vec(v): return dict(zip('xyz',(round(c,5) for c in v)))
def foliage(text):
    # "Leaf litter soil" is solid terrain, not a tree leaf.
    return any(s in text for s in ['fern','grass','leaves','foliage','canopy','petal']) or ('leaf' in text and 'litter' not in text)
def basis(up):
    seed=Vector((0,0,1)) if abs(up.z)<.9 else Vector((0,1,0))
    east=up.cross(seed).normalized()
    north=east.cross(up).normalized()
    return east,north
def arc(a,b,t):
    angle=math.acos(max(-1,min(1,a.dot(b))))
    return (a*math.sin((1-t)*angle)+b*math.sin(t*angle))/math.sin(angle)
def rim(isle,other):
    tangent=(other-isle['up']*isle['up'].dot(other)).normalized()
    east,north=basis(isle['up'])
    x,z=tangent.dot(east),tangent.dot(north);spin=isle['spin']
    x,z=x*math.cos(spin)+z*math.sin(spin),-x*math.sin(spin)+z*math.cos(spin)
    return 1/math.sqrt((x/isle['rx'])**2+(z/isle['rz'])**2)
def bend(p,anchor,up,spin=0):
    east,north=basis(up)
    x,z=p.x-anchor[0],p.z-anchor[2]
    x,z=x*math.cos(spin)-z*math.sin(spin),x*math.sin(spin)+z*math.cos(spin)
    d=math.hypot(x,z)
    radial=up if d<1e-8 else up*math.cos(d/R)+(east*x+north*z)*(math.sin(d/R)/d)
    return radial*(R+p.y-anchor[1])

# Six large island sectors and eight smaller junction islands.
SOURCES={
 'seeds':('farm-city',(100,2,8),30,26),
 'solar':('farm-city',(105,12,72),28,23),
 'harvest':('farm-city',(160,7,45),25,23),
 'orchard':('solar-frontier',(248,9,45),48,43),
 'port':('solar-frontier',(285,15,147),48,45),
 'glasshouse':('solar-frontier',(285,15,280),74,72),
 'field':('farm-world',(0,0,0),24,26),
 'barn':('farm-world',(0,5,34),17,14),
 'west':('farm-world',(-45,0,0),10.5,12),
 'east':('farm-world',(44,2,8),10,11),
}
slots=[
 ('north','Pomar Boreal','orchard',(0,1,0)),
 ('east','Distrito das Sementes','seeds',(1,0,0)),
 ('front','Cúpula das Estufas','glasshouse',(0,0,1)),
 ('south','Porto Austral','port',(0,-1,0)),
 ('west','Fazenda do Poente','solar',(-1,0,0)),
 ('back','Mercado da Colheita','harvest',(0,0,-1)),
]
small=['field','barn','west','east','seeds','solar','harvest','field']
for i,(x,y,z) in enumerate(( (x,y,z) for x in [-1,1] for y in [-1,1] for z in [-1,1])):
    slots.append(('junction-'+str(i),['Campo das Brisas','Celeiro do Alto','Mirante da Rocha','Horta Suspensa','Entreposto Verde','Terraço Solar','Feira das Nuvens','Campo do Retorno'][i],small[i],(x,y,z)))
islands=[]
for i,(id,name,source,direction) in enumerate(slots):
    region,anchor,rx,rz=SOURCES[source];up=Vector(direction).normalized()
    islands.append(dict(id=id,name=name,source=source,region=region,anchor=anchor,rx=rx,rz=rz,up=up,spin=(i%4)*math.pi/2,objects=[]))

# Break each long crossing with a complete authored outpost island. Position it in the
# water/void gap between the actual shorelines, not halfway between unequal island centres.
connections=[]
for corner in list(islands[6:14]):
    for axis in islands[:6]:
        if corner['up'].dot(axis['up'])<.5:continue
        total=R*math.acos(axis['up'].dot(corner['up']))
        fraction=(rim(axis,corner['up'])+total-rim(corner,axis['up']))/(2*total)
        source='west';region,anchor,rx,rz=SOURCES[source]
        middle=dict(id='crossing-'+str(len(connections)//2),name='Refúgio '+str(len(connections)//2+1),
          source=source,region=region,anchor=anchor,rx=rx,rz=rz,
          up=arc(axis['up'],corner['up'],fraction),spin=0,objects=[],intermediate=True)
        islands.append(middle);connections.extend([(axis,middle),(middle,corner)])

def import_meshes(path,simplify=True):
    before=set(scene.objects)
    bpy.ops.import_scene.gltf(filepath=str(path))
    added=set(scene.objects)-before
    meshes=[];reduced={}
    for o in added:
        if o.type!='MESH':continue
        source=o.data
        text=(o.name+' '+' '.join(m.name for m in source.materials if m)).lower()
        ratio=.18 if any(s in text for s in ['fern','leaves','grass']) else .4 if any(s in text for s in ['coast','branches']) else 1
        key=(source.name,ratio)
        # A kit module shares one mesh between bark and leaves: the leaf budget would decimate the
        # trunk down to open strips. Kit geometry is already small and stays exactly as authored.
        if simplify and ratio<1 and len(source.polygons)>500:
            if key not in reduced:
                temporary=bpy.data.objects.new('source-lod',source.copy());scene.collection.objects.link(temporary)
                bpy.context.view_layer.objects.active=temporary
                modifier=temporary.modifiers.new('Repeated scan budget','DECIMATE');modifier.ratio=ratio
                bpy.ops.object.modifier_apply(modifier=modifier.name)
                reduced[key]=temporary.data
                bpy.data.objects.remove(temporary,do_unlink=True)
            source=reduced[key]
        o.data=source.copy()
        matrix=o.matrix_world.copy()
        o.parent=None
        o.matrix_world.identity()
        o.data.transform(matrix)
        meshes.append(o)
    return added,meshes

BREAKABLE=[('crate',['supply-crate','crate']),('barrel',['farm-barrels','barrel']),
 ('tree',['-solid-commontree']),('rock',['-solid-rock_']),
 # Stairs stay out: they are the way up, and a destroyed route can strand the player.
 ('structure',['barn side wall','gambrel roof','barn door',
   'transfer house','reinforced column','agricultural silo','roof glazing'])]
def breakable(name):
    text=name.lower()
    for kind,tokens in BREAKABLE:
        if any(t in text for t in tokens):return kind
    return None

def weld_parts(o,reach=6.):
    """One source mesh holds every copy of a prop: six crates spread over the whole region.
    Any vertex outside a footprint rejected the whole mesh, so those props vanished. Split into
    spatially connected parts — welding across UV seams, which duplicate a vertex in place — and
    keep parts that touch together, so a barn stays a barn instead of becoming shards."""
    mesh=o.data;parent=list(range(len(mesh.vertices)))
    def find(a):
        while parent[a]!=a:parent[a]=parent[parent[a]];a=parent[a]
        return a
    def union(a,b):
        a,b=find(a),find(b)
        if a!=b:parent[a]=b
    seen={}
    for i,v in enumerate(mesh.vertices):union(i,seen.setdefault(tuple(round(c,3) for c in v.co),i))
    for e in mesh.edges:union(e.vertices[0],e.vertices[1])
    groups={}
    for p in mesh.polygons:groups.setdefault(find(p.vertices[0]),[]).append(p.index)
    if len(groups)<2:return [o]
    box={}
    for key,faces in groups.items():
        points=[mesh.vertices[i].co for p in faces for i in mesh.polygons[p].vertices]
        box[key]=(Vector(tuple(min(p[a] for p in points) for a in range(3))),
                  Vector(tuple(max(p[a] for p in points) for a in range(3))))
    keys=list(groups)
    for a in range(len(keys)):
        for b in range(a+1,len(keys)):
            (lo,hi),(lo2,hi2)=box[keys[a]],box[keys[b]]
            # Folga proporcional à menor peça: as águas de um mesmo telhado se juntam, e prédios
            # vizinhos não encadeiam um no outro até virar um quarteirão só.
            gap=max(.5,min(reach,.6*min((hi-lo).length,(hi2-lo2).length)))
            if all(lo[c]-gap<=hi2[c] and lo2[c]-gap<=hi[c] for c in range(3)):union(keys[a],keys[b])
    final={}
    for p in mesh.polygons:final.setdefault(find(p.vertices[0]),[]).append(p.index)
    if len(final)<2:return [o]
    parts=[]
    for faces in final.values():
        keep=set(faces);bm=bmesh.new();bm.from_mesh(mesh)
        bmesh.ops.delete(bm,geom=[f for f in bm.faces if f.index not in keep],context='FACES')
        data=bpy.data.meshes.new(mesh.name)
        for material in mesh.materials:data.materials.append(material)
        bm.to_mesh(data);bm.free()
        part=bpy.data.objects.new(o.name,data);scene.collection.objects.link(part);parts.append(part)
    return parts

def split_props(added,meshes):
    kept=[]
    for o in meshes:
        parts=weld_parts(o) if breakable(o.name) else [o]
        if parts!=[o]:added.update(parts);print('SPLIT',o.name,len(parts),flush=True)
        kept.extend(parts)
    return kept

def clip_and_bend(source,isle,terrain_override=False):
    anchor,up=isle['anchor'],isle['up']
    label=(source.name+' '+' '.join(m.name for m in source.data.materials if m)).lower()
    # Never shear an authored prop at an island boundary. Only the continuous landscape
    # may be clipped/bent; decorations are retained whole and receive one rigid rotation.
    terrain=terrain_override or any(s in label for s in ['cultivated','continuous cliff','solid cultivated','outpost-west','outpost-east','worn track','solid island','geological','plateau shell'])
    if not terrain:
        points=[game(v.co) for v in source.data.vertices]
        if not points:return None
        lo=Vector(tuple(min(p[a] for p in points) for a in range(3)))
        hi=Vector(tuple(max(p[a] for p in points) for a in range(3)))
        centre=(lo+hi)/2
        if any(((p.x-anchor[0])/isle['rx'])**2+((p.z-anchor[2])/isle['rz'])**2>.94**2 for p in points):return None
        if centre.y<anchor[1]-10 or centre.y>anchor[1]+40:return None
        base=Vector((centre.x,anchor[1],centre.z));mapped=bend(base,anchor,up,isle['spin']);local_up=mapped.normalized()
        east,north=basis(up);rotation=isle['spin']
        direction=east*math.cos(rotation)+north*math.sin(rotation)
        local_east=(direction-local_up*direction.dot(local_up)).normalized();local_north=local_east.cross(local_up).normalized()
        mesh=source.data.copy()
        for v,p in zip(mesh.vertices,points):
            offset=p-base;v.co=blender(mapped+local_east*offset.x+local_up*offset.y+local_north*offset.z)
        mesh.update();o=bpy.data.objects.new(isle['id']+'-'+source.name,mesh);scene.collection.objects.link(o)
        return o
    bm=bmesh.new();bm.from_mesh(source.data)
    remove=[]
    for f in bm.faces:
        p=game(f.calc_center_median())
        if ((p.x-anchor[0])/isle['rx'])**2+((p.z-anchor[2])/isle['rz'])**2>1.04**2 or p.y<anchor[1]-35 or p.y>anchor[1]+60:
            remove.append(f)
    bmesh.ops.delete(bm,geom=remove,context='FACES')
    if not bm.faces:bm.free();return None
    loose=[v for v in bm.verts if not v.link_faces]
    if loose:bmesh.ops.delete(bm,geom=loose,context='VERTS')
    # Existing large floor polygons need intermediate vertices to follow the actual curvature.
    for _ in range(6):
        long=[e for e in bm.edges if e.calc_length()>6]
        if not long:break
        bmesh.ops.subdivide_edges(bm,edges=long,cuts=1,use_grid_fill=True)
    for v in bm.verts:v.co=blender(bend(game(v.co),anchor,up,isle['spin']))
    bm.normal_update()
    mesh=bpy.data.meshes.new(isle['id']+'-'+source.data.name)
    for material in source.data.materials:mesh.materials.append(material)
    bm.to_mesh(mesh);bm.free()
    o=bpy.data.objects.new(isle['id']+'-'+source.name,mesh);scene.collection.objects.link(o)
    return o

for region in ['farm-world','farm-city','solar-frontier']:
    added,meshes=import_meshes(OUT/(region+'.glb'))
    meshes=split_props(added,meshes)
    for isle in [i for i in islands if i['region']==region]:
        for source in meshes:
            # Old broken peripheral scan clusters are replaced by the continuous shipped geology.
            label=(source.name+' '+' '.join(m.name for m in source.data.materials if m)).lower()
            if any(s in label for s in ['coast','corruption','island_tree','tree-canopy','bridge lower','bridge weathered']):continue
            o=clip_and_bend(source,isle)
            if o:isle['objects'].append(o)
        print('ISLAND',isle['id'],len(isle['objects']),flush=True)
    for o in added:
        if o.name in bpy.data.objects:bpy.data.objects.remove(o,do_unlink=True)

# Closed geological shells for the original small islands, matching their real authored bounds.
added,meshes=import_meshes(OUT/'solid-island-geology.glb')
shell_name={'field':'Main','barn':'Barn plateau','west':'West outpost','east':'East outpost'}
for isle in [i for i in islands if i['source'] in shell_name]:
    name=shell_name[isle['source']]
    for source in meshes:
        if source.name.startswith(name+' '):
            o=clip_and_bend(source,isle,True)
            if o:isle['objects'].append(o)
for o in added:
    if o.name in bpy.data.objects:bpy.data.objects.remove(o,do_unlink=True)

def copy_module(name,kit=KIT):
    path=kit/(name+'.gltf');data=json.loads(path.read_text())
    LOCAL.mkdir(parents=True,exist_ok=True)
    shutil.copy2(path,LOCAL/path.name)
    for entry in data.get('buffers',[])+data.get('images',[]):
        uri=entry.get('uri','')
        if uri and not uri.startswith('data:'):
            dest=LOCAL/uri;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(path.parent/uri,dest)
    return LOCAL/path.name

modules={}
for kind,name in [('floor','Floor_WoodLight'),('rail','Prop_WoodenFence_Single')]:
    added,meshes=import_meshes(copy_module(name),simplify=False)
    coords=[game(v.co) for o in meshes for v in o.data.vertices]
    lo=Vector(tuple(min(v[a] for v in coords) for a in range(3)))
    hi=Vector(tuple(max(v[a] for v in coords) for a in range(3)))
    modules[kind]=(added,meshes,lo,hi)
    print('MODULE',kind,tuple(lo),tuple(hi),flush=True)

bridges=[]
landing_trees={}
for isle in islands:
    vertices=[];faces=[]
    for o in isle['objects']:
        mesh=o.data;mesh.calc_loop_triangles();offset=len(vertices)
        vertices.extend(v.co.copy() for v in mesh.vertices)
        for tri in mesh.loop_triangles:
            mat=mesh.materials[tri.material_index] if tri.material_index<len(mesh.materials) else None
            text=(o.name+' '+(mat.name if mat else '')).lower()
            if foliage(text) or any(s in text for s in ['branches','coast_land']):continue
            faces.append(tuple(offset+i for i in tri.vertices))
    landing_trees[isle['id']]=BVHTree.FromPolygons(vertices,faces,all_triangles=True)

# Closed authored rocks and complete trees replace the broken coastal scans. Every trunk
# and boulder participates in the same final collision mesh; alpha foliage does not.
nature={}
for name in ['Rock_Medium_1','Rock_Medium_2','Rock_Medium_3','CommonTree_1','CommonTree_3']:
    added,meshes=import_meshes(copy_module(name,NATURE),simplify=False)
    points=[game(v.co) for o in meshes for v in o.data.vertices]
    lo=Vector(tuple(min(p[a] for p in points) for a in range(3)))
    hi=Vector(tuple(max(p[a] for p in points) for a in range(3)))
    nature[name]=(added,meshes,lo,hi)
for number,isle in enumerate(islands):
    rng=random.Random(4300+number);count=4 if isle.get('intermediate') else 12
    for n in range(count):
        angle=rng.random()*math.tau;d=(.4+rng.random()*.23)*min(isle['rx'],isle['rz'])
        anchor=isle['anchor'];candidate=Vector((anchor[0]+math.cos(angle)*d,anchor[1],anchor[2]+math.sin(angle)*d))
        radial=bend(candidate,anchor,isle['up'],isle['spin']).normalized()
        hit,normal,_,_=landing_trees[isle['id']].ray_cast(blender(radial*(R+30)),blender(-radial),60)
        if hit is None or abs(game(normal).dot(radial))<.78:continue
        target=game(hit);east,north=basis(radial);spin=rng.random()*math.tau
        east,north=east*math.cos(spin)+north*math.sin(spin),north*math.cos(spin)-east*math.sin(spin)
        name=('CommonTree_1' if n%4==0 else 'CommonTree_3') if n%2==0 else 'Rock_Medium_'+str(n%3+1)
        _,templates,lo,hi=nature[name]
        size=(5.5+rng.random()*2.5) if n%2==0 else (1.3+rng.random()*1.6)
        factor=size/max(.001,hi.y-lo.y) if n%2==0 else size/max(.001,hi.x-lo.x,hi.z-lo.z)
        base=Vector(((lo.x+hi.x)/2,lo.y,(lo.z+hi.z)/2))
        for template in templates:
            mesh=template.data.copy()
            for v in mesh.vertices:
                p=(game(v.co)-base)*factor
                v.co=blender(target+east*p.x+radial*(p.y-.06)+north*p.z)
            mesh.update();obj=bpy.data.objects.new(isle['id']+'-solid-'+name,mesh);scene.collection.objects.link(obj)
            isle['objects'].append(obj)
for added,_,_,_ in nature.values():
    for o in added:
        if o.name in bpy.data.objects:bpy.data.objects.remove(o,do_unlink=True)

def arc(a,b,t):
    angle=math.acos(max(-1,min(1,a.dot(b))))
    return (a*math.sin((1-t)*angle)+b*math.sin(t*angle))/math.sin(angle)

for a,b in connections:
    ua,ub=a['up'],b['up'];angle=math.acos(ua.dot(ub));total=R*angle
    # Match the actual elliptical shore and its terrain height; don't drive a bridge through
    # a farm fence ten metres inland, or terminate below a raised orchard terrace.
    start=rim(a,ub)-2;end=total-rim(b,ua)+2
    def deck_height(isle,s):
        u=arc(ua,ub,s/total)
        origin=blender(u*(R+45));direction=blender(-u)
        tree=landing_trees[isle['id']]
        for _ in range(12):
            hit,normal,_,_=tree.ray_cast(origin,direction,90)
            if hit is None:break
            p=game(hit)
            if game(normal).dot(u)>.6 and p.length>R-8:return p.length-R+.045
            origin=hit+direction*.03
        return .03
    h0,h1=deck_height(a,start),deck_height(b,end)
    # A single endpoint misses a mound just before the shore. Build a gentle envelope
    # over the actual landing terrain, so the deck never passes through that mound.
    landing_profile=[]
    for isle,edge,direction in [(a,start,1),(b,end,-1)]:
        for step in range(13):
            sample=edge+direction*step
            landing_profile.append((sample,deck_height(isle,sample)))
    def deck(s):
        transition=min(20,(end-start)/2)
        base=.03+(h0-.03)*max(0,1-(s-start)/transition)+(h1-.03)*max(0,1-(end-s)/transition)
        return max(base,max(height-.23*abs(s-sample) for sample,height in landing_profile))
    tangent_axis=ua.cross(ub).normalized()
    def bridge_point(s,lateral=0):
        # This authored barn landing has an open door projecting into the centreline.
        # Curve the whole deck and its rails around it, preserving the complete building.
        clearance=-2.0*max(0,1-(s-start)/20) if a['id']=='back' and b['id']=='junction-0' else 0
        radial=arc(ua,ub,s/total);side_angle=(lateral+clearance)/R
        return radial*math.cos(side_angle)+tangent_axis*math.sin(side_angle)
    objects=[];width=6;count=math.ceil((end-start)/3)
    for n in range(count):
        s0=start+(end-start)*n/count;s1=start+(end-start)*(n+1)/count
        for kind in ['floor','rail']:
            added,templates,lo,hi=modules[kind]
            sides=[0] if kind=='floor' else [-1,1]
            for side in sides:
                for template in templates:
                    mesh=template.data.copy()
                    for v in mesh.vertices:
                        p=game(v.co)
                        q=(p.z-lo.z)/max(.001,hi.z-lo.z)
                        # The module's long axis is x for Quaternius fence pieces.
                        if kind=='rail':
                            q=(p.x-lo.x)/max(.001,hi.x-lo.x)
                            lateral=side*width/2+(p.z-(lo.z+hi.z)/2)*.5
                            height=(p.y-lo.y)/max(.001,hi.y-lo.y)*1.25
                        else:
                            lateral=(p.x-(lo.x+hi.x)/2)/max(.001,hi.x-lo.x)*width
                            height=(p.y-hi.y)/max(.001,hi.y-lo.y)*.24
                        # Overlap the shore by 12 cm: a ray exactly at the triangulated
                        # boundary must not fall through a numerical hairline seam.
                        begin=s0-.12 if kind=='floor' and n==0 else s0
                        finish=s1+.12 if kind=='floor' and n==count-1 else s1
                        along=begin+(finish-begin)*q
                        # Parallel side offsets follow the same curved radial shell.
                        radial=bridge_point(along,lateral)
                        v.co=blender(radial*(R+height+deck(along)))
                    mesh.update()
                    o=bpy.data.objects.new('bridge-'+a['id']+'-'+b['id']+'-'+kind,mesh);scene.collection.objects.link(o);objects.append(o)
    bridges.append(dict(id=a['id']+'-'+b['id'],a=a['id'],b=b['id'],width=width,
      waypoints=[vec(bridge_point(start+(end-start)*n/24)*(R+deck(start+(end-start)*n/24))) for n in range(25)],objects=objects))
    print('BRIDGE',a['id'],b['id'],count,flush=True)
for added,_,_,_ in modules.values():
    for o in added:
        if o.name in bpy.data.objects:bpy.data.objects.remove(o,do_unlink=True)

# Keep authored shoreline rocks, but leave a clear entrance at each bridge. Remove whole
# small rock instances instead of cutting holes through their visible surfaces.
for isle in islands:
    mouths=[]
    for bridge in bridges:
        if isle['id']==bridge['a']:
            mouths.extend(Vector(tuple(p[a] for a in 'xyz')) for p in bridge['waypoints'][:2])
        if isle['id']==bridge['b']:
            mouths.extend(Vector(tuple(p[a] for a in 'xyz')) for p in bridge['waypoints'][-2:])
    for o in list(isle['objects']):
        shore_rock=any('coast_land' in m.name.lower() for m in o.data.materials if m)
        # A copied open barn door can project beyond the original island footprint and
        # block the new landing. Omit that whole door leaf; preserve the barn structure.
        projecting_door='open barn door' in o.name.lower()
        solid_decoration='-solid-rock_' in o.name.lower() or '-solid-commontree_' in o.name.lower()
        if not (shore_rock or projecting_door or solid_decoration):continue
        points=[game(v.co) for v in o.data.vertices]
        if not points:continue
        lo=Vector(tuple(min(p[a] for p in points) for a in range(3)))
        hi=Vector(tuple(max(p[a] for p in points) for a in range(3)))
        if (hi-lo).length>20:continue
        blocked=False
        for mouth in mouths:
            u=mouth.normalized()
            for p in points:
                delta=p-mouth;h=delta.dot(u)
                if -2<h<3 and (delta-u*h).length<4.2:blocked=True;break
            if blocked:break
        if blocked:
            isle['objects'].remove(o);bpy.data.objects.remove(o,do_unlink=True)
            print('CLEARED LANDING PROP',isle['id'],flush=True)

# Reduce duplicated texture memory; existing material maps remain intact.
textures=ROOT/'.temp/planet-textures';textures.mkdir(parents=True,exist_ok=True)
for index,image in enumerate(bpy.data.images):
    if not image.size[0]:continue
    if image.size[0]>1024 or image.size[1]>1024:
        scale=1024/max(image.size);image.scale(max(1,int(image.size[0]*scale)),max(1,int(image.size[1]*scale)))
    alpha=any(s in image.name.lower() for s in ['leaf','leaves','fern','grass','canopy','foliage'])
    if image.packed_file:image.unpack(method='REMOVE')
    image.file_format='PNG' if alpha else 'JPEG'
    image.filepath_raw=str(textures/(str(index)+('.png' if alpha else '.jpg')))
    image.save();image.pack()

positions=[];indices=[]
def add_collision(o):
    mesh=o.data;mesh.calc_loop_triangles()
    used={}
    for tri in mesh.loop_triangles:
        material=mesh.materials[tri.material_index] if tri.material_index<len(mesh.materials) else None
        text=(o.name+' '+(material.name if material else '')).lower()
        if foliage(text):continue
        ids=[]
        for vi in tri.vertices:
            if vi not in used:
                used[vi]=len(positions)//3;positions.extend(round(c,5) for c in game(mesh.vertices[vi].co))
            ids.append(used[vi])
        indices.extend((ids[0],ids[2],ids[1]))

# Breakable props keep their own mesh/node instead of being welded into the island shell.
# Terrain, cliffs, bridge floors and rails stay merged exactly as before.
# Record follows .temp/destruction-api.md: world centre, HALF extents, triangle range.
destructibles=[]
def detach(o,group,kind,start,count):
    points=[game(v.co) for v in o.data.vertices]
    lo=Vector(tuple(min(p[a] for p in points) for a in range(3)))
    hi=Vector(tuple(max(p[a] for p in points) for a in range(3)))
    # Origin at the radial base (a tree topples from its root, a crate tips on its floor).
    up=((lo+hi)/2).normalized();base=up*min(p.dot(up) for p in points)
    o.data.transform(Matrix.Translation(-blender(base)));o.location=blender(base)
    id='%s-%s-%d'%(group,kind,len(destructibles))
    destructibles.append(dict(id=id,nodeName='prop-'+id,kind=kind,group=group,source=o.name,
      centre=vec((lo+hi)/2),extents=vec(Vector(tuple(max(.001,(hi[a]-lo[a])/2) for a in range(3)))),
      pivot=vec(base),triangleStart=start,triangleCount=count))
    o.name='prop-'+id

all_objects=[]
for group,prefix in [(i,'island-') for i in islands]+[(b,'bridge-') for b in bridges]:
    merged=[]
    for o in group['objects']:
        start=len(indices)//3
        add_collision(o)
        count=len(indices)//3-start
        kind=breakable(o.name)
        # A prop with no collision triangle (all alpha foliage) has no range to disable.
        if kind is None or count<1:merged.append(o);continue
        detach(o,group['id'],kind,start,count);all_objects.append(o)
    if not merged:continue
    bpy.ops.object.select_all(action='DESELECT')
    for o in merged:o.select_set(True)
    bpy.context.view_layer.objects.active=merged[0];bpy.ops.object.join()
    root=merged[0];root.name=prefix+group['id'];all_objects.append(root)

manifest=dict(version=2,centre=vec(Vector()),radius=R,positions=positions,indices=indices,destructibles=destructibles,
  islands=[dict(id=i['id'],name=i['name'],up=vec(i['up']),centre=vec(i['up']*R),
    spawn=vec(bend(Vector((i['anchor'][0],i['anchor'][1]+2,i['anchor'][2]-min(i['rz']*.5,12))),i['anchor'],i['up'],i['spin'])),
    radius=min(i['rx'],i['rz']),source=i['source']) for i in islands],
  bridges=[{k:v for k,v in b.items() if k!='objects'} for b in bridges])
(OUT/'planet-archipelago.json').write_text(json.dumps(manifest,separators=(',',':')),encoding='utf-8')
with gzip.open(OUT/'planet-archipelago.json.gz','wb',compresslevel=6) as packed:
    packed.write((OUT/'planet-archipelago.json').read_bytes())
bpy.ops.object.select_all(action='DESELECT')
for o in all_objects:o.select_set(True)
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art/blender/Planet_Archipelago.blend'),compress=True)
bpy.ops.export_scene.gltf(filepath=str(OUT/'planet-archipelago.glb'),export_format='GLB',use_selection=True,export_animations=False,
  export_draco_mesh_compression_enable=True,export_draco_mesh_compression_level=6,
  export_draco_position_quantization=18,export_draco_normal_quantization=12,export_draco_texcoord_quantization=14)
compact(OUT/'planet-archipelago.glb')
print('PLANET COMPLETE',len(islands),'islands',len(bridges),'bridges',len(indices)//3,'collision triangles',
  len(destructibles),'destructible props',flush=True)
