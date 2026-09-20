"""Conta nos com malha lendo o chunk JSON do .glb — sem Blender, sem importar nada.

Serve de prova de que a compressao foi NAO destrutiva: o numero antes e depois tem de ser igual.
Um numero menor depois significa que alguma transformacao fundiu ou apagou no', e o arquivo nao
deve ser entregue.
"""
import json,re,struct,sys
from pathlib import Path
def survey(path):
    data=Path(path).read_bytes()
    assert data[:4]==b'glTF','nao e um .glb: %s'%path
    off=12
    while off<len(data):
        length,kind=struct.unpack_from('<II',data,off)
        if kind==0x4E4F534A:doc=json.loads(data[off+8:off+8+length].decode('utf-8'));break
        off+=8+length+(-length)%4
    nodes=[n for n in doc.get('nodes',[]) if 'mesh' in n]
    # Mesmo filtro de `tests/render-budget.test.ts`: o que e' vegetacao/cenario barato e nao conta
    # contra o orcamento de sombra nem de estrutura.
    cheap=re.compile(r'grass|fern|coast_land|connected earth trails|trail union|OrchardLOD|harvest\s+(tomato|watermelon)|milho plantado|margaridas do campo',re.I)
    matched=sum(1 for n in nodes if cheap.search(n.get('name','')))
    prims=sum(len(m.get('primitives',[])) for m in doc.get('meshes',[]))
    return dict(file=Path(path).name,bytes=len(data),meshNodes=len(nodes),cheap=matched,meshes=len(doc.get('meshes',[])),primitives=prims,accessors=len(doc.get('accessors',[])),materials=len(doc.get('materials',[])),images=len(doc.get('images',[])))
argv=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else sys.argv[1:]
rows=[survey(p) for p in argv]
for r in rows:print('%-22s %8.2f MB  meshNodes=%-5d regexVegetacao=%-5d meshes=%-4d prims=%-4d accessors=%-5d mats=%-4d imgs=%d'%(r['file'],r['bytes']/1048576,r['meshNodes'],r['cheap'],r['meshes'],r['primitives'],r['accessors'],r['materials'],r['images']))
if len(rows)==2:
    same=rows[0]['meshNodes']==rows[1]['meshNodes'] and rows[0]['meshes']==rows[1]['meshes']
    print('ESTRUTURA PRESERVADA:','SIM' if same else 'NAO — a compressao destruiu nos/malhas, nao entregar')
