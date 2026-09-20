"""Author a fixed, textured farm composition. Photogrammetry assets supply rocks and plants."""
import bpy, math, random, json
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parent.parent
bpy.ops.wm.read_factory_settings(use_empty=True);scene=bpy.context.scene
random.seed(417);art=[];colliders=[]
def pos(v):return Vector((-v[0],-v[2],v[1]))
def pbr(name,asset,tint=(1,1,1,1),rough=.8,metal=0):
    m=bpy.data.materials.new(name);m.use_nodes=True;n=m.node_tree.nodes;l=m.node_tree.links;b=n.get('Principled BSDF');b.inputs['Roughness'].default_value=rough;b.inputs['Metallic'].default_value=metal
    if asset:
        path=ROOT/'public/textures'/asset
        d=n.new('ShaderNodeTexImage');d.image=bpy.data.images.load(str(path/'Diffuse.jpg'),check_existing=True)
        mix=n.new('ShaderNodeMixRGB');mix.blend_type='MULTIPLY';mix.inputs[0].default_value=1;mix.inputs[2].default_value=tint;l.new(d.outputs['Color'],mix.inputs[1]);l.new(mix.outputs[0],b.inputs['Base Color'])
        # Export tint as the PBR factor while retaining the original texture.
        l.remove(b.inputs['Base Color'].links[0]);l.new(d.outputs['Color'],b.inputs['Base Color']);b.inputs['Base Color'].default_value=tint
        normal=n.new('ShaderNodeTexImage');normal.image=bpy.data.images.load(str(path/'nor_gl.jpg'),check_existing=True);normal.image.colorspace_settings.name='Non-Color'
        bump=n.new('ShaderNodeNormalMap');l.new(normal.outputs['Color'],bump.inputs['Color']);l.new(bump.outputs[0],b.inputs['Normal'])
    else:b.inputs['Base Color'].default_value=tint
    m.diffuse_color=tint;return m
wood=pbr('Weathered timber','wood_planks',(.55,.39,.20,1));red=pbr('Barn red weathered wood','wood_planks',(.62,.08,.035,1));cream=pbr('Ivory trim','wood_planks',(.85,.78,.57,1));rock=pbr('Cliff stone','rock_face_03');soil=pbr('Leaf litter soil','brown_mud_leaves_01');metal=pbr('Aged silo steel','rusty_painted_metal',(.58,.66,.58,1),.65,.45);roof=pbr('Oxidized roof','rusty_painted_metal',(.20,.26,.25,1),.75,.5)
purple=pbr('Corruption glow',None,(.16,.015,.27,1));bs=purple.node_tree.nodes.get('Principled BSDF');bs.inputs['Emission Color'].default_value=(.35,.02,.65,1);bs.inputs['Emission Strength'].default_value=2
lamp=pbr('Lantern glass',None,(1,.48,.09,1));lamp.node_tree.nodes['Principled BSDF'].inputs['Emission Color'].default_value=(1,.35,.035,1);lamp.node_tree.nodes['Principled BSDF'].inputs['Emission Strength'].default_value=4
def box(name,xyz,size,mat,bevel=.035,solid=False):
    bpy.ops.mesh.primitive_cube_add(size=1,location=pos(xyz));o=bpy.context.object;o.name=name;o.dimensions=(size[0],size[2],size[1]);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.data.materials.append(mat)
    if bevel:mod=o.modifiers.new('Worn edges','BEVEL');mod.width=bevel;mod.segments=2;bpy.ops.object.modifier_apply(modifier=mod.name)
    art.append(o)
    if solid:colliders.append({'id':name,'min':dict(zip(['x','y','z'],[xyz[i]-size[i]/2 for i in range(3)])),'max':dict(zip(['x','y','z'],[xyz[i]+size[i]/2 for i in range(3)]))})
    return o
def beam(name,a,b,width,mat):
    delta=pos(b)-pos(a);o=box(name,tuple((a[i]+b[i])/2 for i in range(3)),(width,delta.length,width),mat,.015);o.rotation_euler=delta.to_track_quat('Z','Y').to_euler();return o
def cylinder(name,xyz,radius,height,mat,vertices=32):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices,radius=radius,depth=height,location=pos(xyz));o=bpy.context.object;o.name=name;o.data.materials.append(mat);art.append(o)
    for face in o.data.polygons:face.use_smooth=True
    return o
def surface(name,vertices,faces,mat,uvscale=4):
    mesh=bpy.data.meshes.new(name);mesh.from_pydata([pos(v) for v in vertices],[],faces);mesh.update();o=bpy.data.objects.new(name,mesh);scene.collection.objects.link(o);mesh.materials.append(mat);art.append(o)
    uv=mesh.uv_layers.new(name='UVMap')
    for polygon in mesh.polygons:
        for li in polygon.loop_indices:
            co=mesh.vertices[mesh.loops[li].vertex_index].co;uv.data[li].uv=(co.x/uvscale,co.y/uvscale)
    return o
def load_asset(name):
    prior=set(scene.objects);bpy.ops.import_scene.gltf(filepath=str(ROOT/f'art/source/{name}/{name}.gltf'))
    imported=set(scene.objects)-prior;meshes=[o for o in imported if o.type=='MESH']
    bpy.ops.object.select_all(action='DESELECT')
    for o in meshes:o.select_set(True)
    bpy.context.view_layer.objects.active=meshes[0];bpy.ops.object.join();o=bpy.context.object
    bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
    corners=[o.matrix_world@Vector(c) for c in o.bound_box];lo=Vector([min(v[i] for v in corners) for i in range(3)]);hi=Vector([max(v[i] for v in corners) for i in range(3)])
    for v in o.data.vertices:v.co-=Vector(((lo.x+hi.x)/2,(lo.y+hi.y)/2,lo.z))
    for other in imported:
        try:
            if other!=o and other.name in bpy.data.objects:bpy.data.objects.remove(other,do_unlink=True)
        except ReferenceError:pass
    o.parent=None;o.location=(0,0,-10000);return o,hi-lo
def load_glb(name,split=False):
    """Irmao de `load_asset()` para os props ja' empacotados em `public/models/*.glb`.

    Mesma normalizacao do irmao: junta as malhas, recentra para a base assentar em Z=0 e devolve
    `(objeto, dims)` — e' `dims` que o `instance()` usa para converter altura em metros para escala.

    `split=True` devolve UMA entrada por malha. E' o caso de `farm-flowers.glb`: sao nove moitas de
    margarida, cada uma ja' recentrada na propria origem. Juntar as nove viraria um tapete unico com
    origem no meio do nada, impossivel de espalhar — o valor do asset esta' justamente em serem nove.
    """
    prior=set(scene.objects);bpy.ops.import_scene.gltf(filepath=str(ROOT/f'public/models/{name}.glb'))
    imported=set(scene.objects)-prior;meshes=[o for o in imported if o.type=='MESH'];out=[]
    for group in ([[m] for m in meshes] if split else [meshes]):
        bpy.ops.object.select_all(action='DESELECT')
        for o in group:o.select_set(True)
        bpy.context.view_layer.objects.active=group[0]
        if len(group)>1:bpy.ops.object.join()
        o=bpy.context.object
        # O importador de glTF pendura a malha num empty rotacionado (Y-up -> Z-up). Zerar o pai
        # MANTENDO a transformada antes de aplicar evita que o milho nasca deitado.
        bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM');bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
        corners=[o.matrix_world@Vector(c) for c in o.bound_box];lo=Vector([min(v[i] for v in corners) for i in range(3)]);hi=Vector([max(v[i] for v in corners) for i in range(3)])
        for v in o.data.vertices:v.co-=Vector(((lo.x+hi.x)/2,(lo.y+hi.y)/2,lo.z))
        o.location=(0,0,-10000);out.append((o,hi-lo))
    kept={o for o,_ in out}
    for other in imported:
        try:
            if other not in kept and other.name in bpy.data.objects:bpy.data.objects.remove(other,do_unlink=True)
        except ReferenceError:pass
    return out if split else out[0]
assets={name:load_asset(name) for name in ['coast_land_rocks_02','fern_02','grass_medium_01','island_tree_01']}
assets['farm-corn']=load_glb('farm-corn');assets['farm-scarecrow']=load_glb('farm-scarecrow')
for i,clump in enumerate(load_glb('farm-flowers',split=True)):assets[f'farm-flower-{i}']=clump
flowerClumps=[f'farm-flower-{i}' for i in range(9)]
# ---- ZONAS RESERVADAS -------------------------------------------------------------------------
# Onde existe estrutura, nada de vegetacao por cima.
#
# O script ja' montava `colliders` para a fisica, mas o espalhamento de arvore NUNCA consultava
# essa lista. Era exatamente por isso que o carvalho das seis ilhas-satelite crescia atravessando
# o telhado do celeiro: a arvore ia para `x-8`, a parede do celeiro esta' em `x-5`, e a copa na
# escala 7 e' maior que os 3 m de folga.
#
# `reserve()` e' chamado pelas proprias estruturas, entao acrescentar um predio novo passa a
# empurrar a vegetacao automaticamente — em vez de exigir que alguem lembre de ajustar uma
# constante solta la' embaixo.
keepouts=[]
def reserve(x,z,half_x,half_z,margin=1.5):
    """Registra a pegada de uma estrutura. `margin` e' o respiro entre a parede e qualquer planta."""
    keepouts.append((x,z,half_x+margin,half_z+margin))
def clear(x,z,radius=0.):
    """Verdadeiro quando um objeto de raio `radius` cabe em (x,z) sem invadir estrutura."""
    return all(abs(x-kx)>hx+radius or abs(z-kz)>hz+radius for kx,kz,hx,hz in keepouts)
def clear_spot(x,z,radius,origin,step=1.5,tries=24):
    """
    Empurra (x,z) para LONGE de `origin` ate' caber.

    Afastar radialmente, e nao sortear outro ponto, preserva a intencao da composicao autoral: a
    arvore continua no mesmo lado da ilha que o autor escolheu, so' que fora do predio.
    """
    ox,oz=origin;dx,dz=x-ox,z-oz
    length=math.hypot(dx,dz) or 1.
    dx,dz=dx/length,dz/length
    for i in range(tries):
        px,pz=x+dx*step*i,z+dz*step*i
        if clear(px,pz,radius):return px,pz
    return x,z
def instance(name,xyz,size,angle=0):
    template,dims=assets[name];o=bpy.data.objects.new(name,template.data);scene.collection.objects.link(o);o.location=pos(xyz);o.rotation_euler.z=angle
    if isinstance(size,tuple):o.scale=(size[0]/max(.01,dims.x),size[2]/max(.01,dims.y),size[1]/max(.01,dims.z))
    else:o.scale=(size/max(.01,dims.z),)*3
    art.append(o);return o
# ---- PLANTIO ----------------------------------------------------------------------------------
# `keepouts` responde por ESTRUTURA: celeiro, silo, moinho. E' a lista dura, e todo prop novo passa
# por `clear()` antes de existir.
#
# Mas arvore, cerca, rampa e canteiro nao sao estrutura e mesmo assim nao podem receber um pe' de
# milho por cima. Registra-los em `keepouts` mudaria onde as arvores JA' autoradas caem (elas usam
# `clear_spot`), reescrevendo a composicao por efeito colateral. Entao o terreno macio mora numa
# segunda lista, consultada so' pelo plantio.
softspots=[]
def occupy(x,z,radius):
    """Terreno macio ja' ocupado — cerca, copa, canteiro. Nao e' estrutura, nao entra em `keepouts`."""
    softspots.append((x,z,radius))
def free(x,z,radius,ground=None):
    """`clear()` da estrutura, mais o terreno macio, mais (opcional) caber dentro da elipse de terra."""
    if not clear(x,z,radius):return False
    if any((x-sx)**2+(z-sz)**2<(sr+radius)**2 for sx,sz,sr in softspots):return False
    if ground:
        cx,cz,rx,rz=ground
        if ((x-cx)/max(.5,rx-radius-1.5))**2+((z-cz)/max(.5,rz-radius-1.5))**2>1:return False
    return True
def cornfield(cx,cz,h,cols,rows,ground,angle=0.,row=1.2,step=.95,jitter=.22):
    """
    Planta um talhao de milho em linhas de verdade.

    Grade exata le' como papel de parede; sorteio livre le' como mato. O que faz o olho reconhecer
    LAVOURA e' a linha ainda se enxergar de longe enquanto nenhum pe' esta' no lugar exato do
    vizinho — por isso o jitter e' fracao do passo (22%), e nao uma posicao nova.

    Cada pe' passa por `free()`: quem cairia dentro de celeiro, silo, moinho, cerca, copa ou fora da
    terra simplesmente nao nasce. O talhao e' RECORTADO pelo mundo, em vez de empurrar o mundo — e'
    o que da' a borda irregular que um campo cultivado de verdade tem contra um obstaculo.
    """
    ca,sa=math.cos(angle),math.sin(angle);planted=[]
    for i in range(cols):
        for j in range(rows):
            u=(i-(cols-1)/2)*row+random.uniform(-jitter,jitter)*row
            v=(j-(rows-1)/2)*step+random.uniform(-jitter,jitter)*step
            x=cx+u*ca-v*sa;z=cz+u*sa+v*ca
            if not free(x,z,.55,ground):continue
            o=instance('farm-corn',(x,h,z),random.uniform(2.05,2.55),random.uniform(0,math.tau))
            o.name='Milho plantado';planted.append((x,z))
    # O talhao so' se declara ocupado DEPOIS de plantado. Se cada pe' ocupasse na hora, o pe'
    # seguinte da mesma linha — a 95 cm — se reprovaria contra o anterior e metade da lavoura
    # deixaria de existir. Milho perto de milho e' o objetivo; e' de estrutura que ele se afasta.
    for x,z in planted:occupy(x,z,.45)
    return len(planted)
def scarecrow(x,z,h,ground,angle=0.):
    """Um espantalho por milharal. Se o ponto autorado nao couber, anda em volta ate' achar terra."""
    for i in range(25):
        a=i/24*math.tau;px,pz=(x,z) if i==0 else (x+math.cos(a)*2.4,z+math.sin(a)*2.4)
        if not free(px,pz,1.3,ground):continue
        o=instance('farm-scarecrow',(px,h,pz),random.uniform(2.3,2.7),angle);o.name='Espantalho'
        occupy(px,pz,1.3);return o
    return None
def wildflowers(count,h,ground,tries=9):
    """Margaridas soltas no capim: fora de estrutura, fora de talhao, fora de caminho."""
    grown=0
    for _ in range(count*tries):
        if grown>=count:break
        a=random.random()*math.tau;r=math.sqrt(random.random())
        x=ground[0]+math.cos(a)*ground[2]*r;z=ground[1]+math.sin(a)*ground[3]*r
        if not free(x,z,.5,ground):continue
        o=instance(random.choice(flowerClumps),(x,h,z),random.uniform(.45,.85),random.random()*math.tau)
        o.name='Margaridas do campo';occupy(x,z,.7);grown+=1
    return grown
def island(x,z,h,rx,rz,detail=True):
    count=64;verts=[(x,h,z)]+[(x+math.cos(i/count*math.tau)*rx,h,z+math.sin(i/count*math.tau)*rz) for i in range(count)]
    surface('Island cultivated ground',verts,[(0,i+1,(i+1)%count+1) for i in range(count)],soil)
    for i in range(22 if detail else 12):
        a=i/(22 if detail else 12)*math.tau
        instance('coast_land_rocks_02',(x+math.cos(a)*rx*.86,h-7,z+math.sin(a)*rz*.86),(rx*.48,9,rz*.45),a)
    # Layered scanned rock volumes taper underneath the floating landmass.
    for j in range(6):instance('coast_land_rocks_02',(x+math.cos(j)*rx*.35,h-15,z+math.sin(j)*rz*.35),(rx*.6,12,rz*.55),j)
def fence(a,b,h=0):
    distance=math.hypot(b[0]-a[0],b[1]-a[1]);n=max(1,round(distance/2.4))
    for i in range(n+1):
        x=a[0]+(b[0]-a[0])*i/n;z=a[1]+(b[1]-a[1])*i/n;box('Split rail post',(x,h+.75,z),(.18,1.5,.18),wood,.025);occupy(x,z,1.)
        if i<n:
            nx=a[0]+(b[0]-a[0])*(i+1)/n;nz=a[1]+(b[1]-a[1])*(i+1)/n
            for y in [.55,1.08]:beam('Fence rail',(x,h+y,z),(nx,h+y,nz),.12,wood)
def barn(x,z,h,scale=1):
    # Boarded gambrel barn with open door recess, braces, trim and cupola.
    w=10;d=10
    # A pegada e' 10x10 (paredes em x±5, z±5); a reserva sai daqui para a vegetacao respeitar.
    reserve(x,z,5*scale,5*scale)
    for side in [-1,1]:
        box('Barn side wall',(x+side*5,h+3,z),(0.2,6,10),red,solid=True)
        for i in range(26):box('Side wall batten',(x+side*5.13,h+3,z-5+i*.4),(.06,6,.07),red,.008)
    box('Barn rear wall',(x,h+3,z+5),(10,6,.22),red,solid=True)
    for side in [-1,1]:box('Barn facade',(x+side*3.65,h+3,z-5),(2.7,6,.22),red,solid=True)
    box('Door header',(x,h+5.5,z-5),(4.6,1,.3),red)
    for dx in [-5,5]:box('Corner trim',(x+dx,h+3,z-5.15),(.19,6,.2),cream)
    for dx in [-2.3,2.3]:box('Door jamb',(x+dx,h+2.3,z-5.18),(.19,4.6,.25),cream)
    box('Lintel',(x,h+4.7,z-5.18),(4.8,.18,.25),cream)
    for side in [-1,1]:
        door=box('Open barn door',(x+side*3.4,h+2.2,z-5.4),(2.0,4.4,.18),wood)
        beam('Door crossbrace',(x+side*2.45,h+.25,z-5.52),(x+side*4.35,h+4.2,z-5.52),.12,cream)
    profile=[(-5,6),(-3.5,8.8),(0,10.2),(3.5,8.8),(5,6)]
    for i in range(4):
        a,b=profile[i:i+2];surface('Gambrel roof',[(x+a[0],h+a[1],z-5.5),(x+b[0],h+b[1],z-5.5),(x+b[0],h+b[1],z+5.5),(x+a[0],h+a[1],z+5.5)],[(0,1,2,3)],roof,2)
        beam('Roof edge trim',(x+a[0],h+a[1],z-5.55),(x+b[0],h+b[1],z-5.55),.18,cream)
    surface('Front gable',[(x-5,h+6,z-5),(x-3.5,h+8.8,z-5),(x,h+10.2,z-5),(x+3.5,h+8.8,z-5),(x+5,h+6,z-5)],[(0,1,2,3,4)],red)
    box('Loft window',(x,h+8,z-5.13),(1.2,1.4,.1),roof);box('Loft cross',(x,h+8,z-5.22),(.12,1.5,.1),cream);box('Loft cross',(x,h+8,z-5.22),(1.3,.1,.1),cream)
    box('Cupola',(x,h+10.65,z+1),(1.4,1.4,1.4),cream);cylinder('Cupola roof',(x,h+11.5,z+1),1.1,.28,roof,4)
    for dx in [-2.65,2.65]:
        box('Lantern housing',(x+dx,h+2.8,z-5.45),(.25,.48,.26),roof)
        box('Warm lamp',(x+dx,h+2.8,z-5.6),(.17,.32,.09),lamp,0)
def silo(x,z,h,r=1.7,height=10):
    reserve(x,z,r,r)
    cylinder('Weathered agricultural silo',(x,h+height/2,z),r,height,metal,48)
    colliders.append({'id':'silo','min':{'x':x-r,'y':h,'z':z-r},'max':{'x':x+r,'y':h+height,'z':z+r}})
    for y in range(1,int(height),2):
        bpy.ops.mesh.primitive_torus_add(major_radius=r+.025,minor_radius=.035,major_segments=48,minor_segments=6,location=pos((x,h+y,z)));o=bpy.context.object;o.data.materials.append(roof);art.append(o)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=32,ring_count=12,radius=r,location=pos((x,h+height,z)));o=bpy.context.object;o.scale.z=.45;o.data.materials.append(metal);art.append(o)
    for dx in [-.3,.3]:beam('Silo ladder',(x+dx,h+.3,z-r-.1),(x+dx,h+height,z-r-.1),.045,roof)
    for j in range(int(height/.35)):beam('Ladder rung',(x-.3,h+j*.35,z-r-.12),(x+.3,h+j*.35,z-r-.12),.03,roof)
def windmill(x,z,h):
    # A torre tem 2,8 m de base, mas a roda de 3 m de raio gira em z-1: a reserva cobre a roda,
    # senao uma copa encostaria nas pas. O moinho nao tem colisor nenhum — mais um motivo para a
    # reserva ser explicita aqui e nao derivada de `colliders`.
    reserve(x,z-1,3.2,3.2)
    for dx in [-1,1]:
        for dz in [-1,1]:beam('Windmill tower',(x+dx*1.4,h,z+dz*1.4),(x+dx*.4,h+12,z+dz*.4),.14,wood)
    for y in [2,5,8]:
        for side in [-1,1]:beam('Tower brace',(x-1.2,h+y,z+side),(x+1.2,h+y+3,z+side),.09,metal)
    for i in range(10):
        a=i/10*math.tau
        beam('Wind wheel spoke',(x,h+13,z-1),(x+math.cos(a)*3,h+13+math.sin(a)*3,z-1),.08,metal)
        o=box('Wind blade',(x+math.cos(a)*2.5,h+13+math.sin(a)*2.5,z-1),(.75,1.65,.09),metal,.01);o.rotation_euler.y=-a
    cylinder('Windmill hub',(x,h+13,z-1),.25,.4,roof)
island(0,0,0,24,26);island(0,34,5,17,14)
barn(0,35,5);silo(9,35,5);silo(-8,38,5,1.3,12);windmill(13,29,5)
# Broad rising track joins the two elevations without stairs obstructing movement.
# A rampa termina em z=20, nao em z=26. O planalto `upper` e' uma elipse centrada em z=34 com
# depth 28: o piso na cota 5 ja' comeca em z=20. Indo ate' z=26 a rampa passava os ultimos 6 m POR
# BAIXO do piso do planalto e, como `groundAt` toma o maximo das superficies, o jogador batia num
# degrau vertical de 1,9 m em z=20 em vez de encontrar a borda do planalto na mesma cota.
surface('Rising farm path',[(-4,0,4),(4,0,4),(4,5,20),(-4,5,20)],[(0,1,2,3)],soil,3)
for x in [-4.3,4.3]:
    for j in range(9):
        z=4+j*2;y=j*5/8;box('Ramp railing post',(x,y+.65,z),(.16,1.3,.16),wood);occupy(x,z,1.)
        if j<8:beam('Ramp rope rail',(x,y+1,z),(x,y+1+5/8,z+2),.1,wood)
# A rampa e' o unico acesso entre as duas cotas: plantar milho nela travaria a passagem.
for j in range(18):occupy(0,4+j,3.2)
for x in [-6,6]:fence((x,-18),(x,8))
fence((-17,24),(-5,24),5);fence((5,24),(17,24),5)
for x in [-13,13]:
    for z in [-12,-5,3]:
        for dx in [-2.5,2.5]:fence((x+dx,z-2),(x+dx,z+2))
        for j in range(16):instance('fern_02',(x+random.uniform(-2,2),.03,z+random.uniform(-1.6,1.6)),random.uniform(.55,1.1),random.random()*math.tau)
for i in range(105):
    x=random.uniform(-22,22);z=random.uniform(-23,18)
    if abs(x)<5.5:continue
    instance('grass_medium_01',(x,0,z),random.uniform(.3,.7),random.random()*math.tau)
# Copa de ~3,5 m no topo da faixa de escala; e' esse o raio que precisa caber longe das paredes.
for x,z,y in [(-17,-5,0),(18,6,0),(-13,29,5),(13,40,5),(-20,10,0)]:
    size=random.uniform(6,9);canopy=size*.5
    tx,tz=clear_spot(x,z,canopy,(0,35 if y>0 else 0))
    instance('island_tree_01',(tx,y,tz),size,random.random()*math.tau);occupy(tx,tz,canopy)
for i in range(24):
    a=i/24*math.tau;instance('fern_02',(math.cos(a)*22,0,math.sin(a)*24),1.2,a)
    if i%3==0:
        x,z=math.cos(a)*23,math.sin(a)*25
        for j in range(3):
            bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2,radius=.25+j*.07,location=pos((x, -.3-j*.5,z)));o=bpy.context.object;o.scale=(1,.8,1.4);o.data.materials.append(purple);art.append(o)
for x,z,y,rx,rz in [(-55,25,5,13,12),(53,50,11,14,13),(-38,83,18,11,10),(28,105,24,15,12),(-80,115,30,13,14),(85,110,22,16,15)]:
    island(x,z,y,rx,rz,False);barn(x,z,y);silo(x+8,z+1,y,1.2,10)
    # AQUI estava o bug relatado. A arvore ia cravada em `x-8`: a 3 m da parede do celeiro, com
    # copa de 3,5 m na escala 7. Medido, a copa entrava 0,5 m na parede — nas SEIS ilhas.
    #
    # Empurrar a arvore para fora nao resolve sozinho: estas ilhas tem raio 10 a 16, e nao cabe
    # um celeiro de 10x10 MAIS uma arvore de escala 7 com folga. Ou a copa invade a parede, ou a
    # arvore sai da terra e fica boiando no vazio.
    #
    # Entao a arvore passa a ser DIMENSIONADA pelo que a ilha comporta. Com `margem` de folga e a
    # copa valendo metade da escala, as duas restricoes sao:
    #     d >= 5 + margem + copa      (nao encostar no celeiro)
    #     d + copa <= raio - 1        (a copa fica sobre a terra)
    # que so' tem solucao quando `copa <= (raio - 6 - margem) / 2`. A ilha que nao comporta nem
    # uma arvore pequena simplesmente nao recebe arvore — melhor um satelite sem arvore do que um
    # satelite com arvore dentro do telhado.
    margem=1.
    raio=min(rx,rz)
    copa=(raio-5-margem-1)/2
    if copa>=1.2:
        escala=min(7,copa*2)
        copa=escala*.5
        d=max(5+margem+copa,(5+margem+copa+raio-1-copa)/2)
        tx,tz=x-d,z
        instance('island_tree_01',(tx,y,tz),escala,.5)
# ---- MILHARAIS, ESPANTALHOS E MARGARIDAS -------------------------------------------------------
# Plantado por ULTIMO de proposito: nesta altura do script toda estrutura ja' chamou `reserve()` e
# toda cerca/copa/rampa ja' chamou `occupy()`, entao o milho enxerga o mundo inteiro e nao o
# contrario. Acrescentar um predio acima daqui continua empurrando a lavoura sozinho.
#
# O espantalho vai ANTES do talhao correspondente: ele ocupa o terreno, e os pes de milho que
# cairiam em cima dele nao nascem. O inverso deixaria um espantalho enterrado no meio do milharal.
baseGround=(0,0,24,26);upperGround=(0,34,17,14);corn=0;scares=0
for cx,cz,h,cols,rows,ang,sx,sz,sa,ground in [
    ( 11,-17.5,0,10,6, .05,  7.5,-16.5, 3.1, baseGround),  # talhao do portao sul
    (-11,-17.5,0,10,6,-.07, -7.5,-16.5, 3.1, baseGround),  # talhao do poente sul
    (-13, 10.0,0, 8,10, .09,-13.0, 16.5, 1.6, baseGround), # talhao do oeste, encostado no bosque
    ( 13, 13.0,0, 8, 9,-.06, 13.0, 18.5, 4.7, baseGround), # talhao do nascente
    (-12.8,37.5,5,4,8, .12,-13.5, 33.5,  .4, upperGround), # faixa entre o bosque e o silo pequeno
    (  0, 43.5,5,11,4, .00,  6.0, 42.0, 2.2, upperGround)]:# talhao dos fundos do celeiro
    # A faixa em frente ao celeiro (z~27) foi testada e rendia 4 pes de 20: entre a cerca em z=24,
    # a reserva do celeiro em z=28,5 e a do moinho em x>8,3 nao sobra largura para uma lavoura.
    # Quatro pes de milho e um espantalho nao leem como talhao — leem como erro. Melhor vazio.
    if scarecrow(sx,sz,h,ground,sa):scares+=1
    grew=cornfield(cx,cz,h,cols,rows,ground,ang);corn+=grew
    print('  talhao (%5.1f,%5.1f) %d de %d pes'%(cx,cz,grew,cols*rows),flush=True)
flowers=wildflowers(54,0,baseGround)+wildflowers(22,5,upperGround)
print('PLANTIO',corn,'pes de milho',scares,'espantalhos',flowers,'moitas de margarida',flush=True)
# Join authored structural meshes by material; retain shared scan geometry as instances.
groups={}
for obj in list(art):
    if obj.data.users==1 and len(obj.data.materials)==1:groups.setdefault(obj.data.materials[0].name,[]).append(obj)
for objects in groups.values():
    if len(objects)<2:continue
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects:obj.select_set(True)
    bpy.context.view_layer.objects.active=objects[0];bpy.ops.object.join()
    for obj in objects[1:]:art.remove(obj)
bpy.ops.object.select_all(action='DESELECT')
for obj in art:obj.select_set(True)
scene.unit_settings.system='METRIC'
bpy.ops.export_scene.gltf(filepath=str(ROOT/'public/models/farm-world.glb'),export_format='GLB',use_selection=True,export_animations=False,export_image_format='AUTO')
(ROOT/'public/models/farm-collision.json').write_text(json.dumps({'boxes':colliders,'surfaces':[{'id':'main','x':0,'z':0,'width':48,'depth':52,'height':0,'ellipse':True},{'id':'upper','x':0,'z':34,'width':34,'depth':28,'height':5,'ellipse':True},{'id':'ramp','x':0,'z':12,'width':8,'depth':16,'height':2.5,'slopeZ':5/16}]}))
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art/blender/Farm_World.blend'))
print('FARM EXPORT COMPLETE',len(art),'objects')
