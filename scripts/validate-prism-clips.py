"""Validate exported animation endpoints against the three saved GLB poses."""
import json, struct
from pathlib import Path
root=Path(__file__).resolve().parents[1]
base=root/'public/models/weapons'
def read(name):
 data=(base/name).read_bytes();length=struct.unpack_from('<I',data,12)[0]
 return json.loads(data[20:20+length]),data[28+length:]
def values(doc,data,index):
 a=doc['accessors'][index];view=doc['bufferViews'][a['bufferView']]
 offset=view.get('byteOffset',0)+a.get('byteOffset',0)
 components={'SCALAR':1,'VEC3':3,'VEC4':4}[a['type']]
 return [struct.unpack_from('<'+'f'*components,data,offset+j*view.get('byteStride',components*4)) for j in range(a['count'])]
defaults={'translation':[0,0,0],'rotation':[0,0,0,1],'scale':[1,1,1]}
doc,data=read('prism-triform.glb')
references={p:{n.get('name'):n for n in read('prism-'+p+'.glb')[0]['nodes']} for p in ['assault','sniper','grenade']}
failures=[];report=[]
assert len(doc['animations'])==9
for animation in doc['animations']:
 parts=animation['name'].lower().split('_');source=parts[0];destination=parts[-1] if 'to' in parts else source
 channels={(c['target']['node'],c['target']['path']):values(doc,data,animation['samplers'][c['sampler']]['output']) for c in animation['channels']}
 times=values(doc,data,animation['samplers'][0]['input'])
 report.append({'clip':animation['name'],'seconds':round(times[-1][0]-times[0][0],3),'channels':len(channels)})
 for endpoint,reference in [(0,references[source]),(-1,references[destination])]:
  for i,node in enumerate(doc['nodes']):
   if node.get('name') not in reference or 'mesh' in node:continue
   for path,default in defaults.items():
    actual=channels[(i,path)][endpoint] if (i,path) in channels else node.get(path,default)
    expected=reference[node['name']].get(path,default)
    error=max(abs(x-y) for x,y in zip(actual,expected))
    if path=='rotation':error=min(error,max(abs(x+y) for x,y in zip(actual,expected)))
    if error>1e-4:failures.append((animation['name'],node['name'],path,endpoint,round(error,5)))
result={'clips':report,'endpoint_mismatches':failures,'runtime_meshes':len(doc['meshes'])}
(root/'art/blender/prism-triform/validation.json').write_text(json.dumps(result,indent=2))
print(json.dumps(result,indent=2))
assert not failures,'Animation endpoints differ from saved forms'
