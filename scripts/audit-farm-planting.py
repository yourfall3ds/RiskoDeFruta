"""Prova que nenhum prop plantado invade a pegada reservada de uma estrutura.

Roda o autor ate' o plantio (sem exportar) e confere, um por um, cada milho/espantalho/margarida
contra `keepouts` — a mesma lista que `reserve()` alimenta. Um talhao que "parece" certo na camera
nao prova nada; o que prova e' medir a distancia de cada pe' ate' cada parede reservada.
"""
import sys
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
which=sys.argv[-1] if sys.argv[-1] in ('world','city') else 'world'
script=ROOT/('scripts/build-farm-world.py' if which=='world' else 'scripts/build-farm-city.py')
source=script.read_bytes().lstrip(b'\xef\xbb\xbf').decode('utf-8')
stop=source.index('# Join authored structural meshes by material' if which=='world' else '# Bake before render batching')
exec(compile(source[:stop],str(script),'exec'),globals())
PROPS={'milho':.55,'espantalho':1.3,'margarid':.5}
counts={k:0 for k in PROPS};worst=None;bad=[]
for o in art:
    name=o.name.lower();kind=next((k for k in PROPS if k in name),None)
    if not kind:continue
    counts[kind]+=1;x,z=-o.location.x,-o.location.y;r=PROPS[kind]
    for kx,kz,hx,hz in keepouts:
        slack=max(abs(x-kx)-hx-r,abs(z-kz)-hz-r)
        if worst is None or slack<worst[0]:worst=(slack,kind,round(x,2),round(z,2))
        if slack<0:bad.append((kind,round(x,2),round(z,2),round(slack,3)))
tris=0
for o in art:
    o.data.calc_loop_triangles();tris+=len(o.data.loop_triangles)
propTris={k:0 for k in PROPS}
for o in art:
    kind=next((k for k in PROPS if k in o.name.lower()),None)
    if kind:propTris[kind]+=len(o.data.loop_triangles)
print('=== AUDITORIA DE PLANTIO (%s) ==='%which)
print('plantados            :',counts)
print('triangulos por prop  :',propTris)
print('triangulos totais    :',tris)
print('keepouts registrados :',len(keepouts))
print('folga minima (m)     : %.3f em %s @ (%s, %s)'%worst)
print('INVASOES             :',len(bad))
for b in bad[:20]:print('   ',b)
print('RESULTADO            :','APROVADO' if not bad else 'REPROVADO',flush=True)
