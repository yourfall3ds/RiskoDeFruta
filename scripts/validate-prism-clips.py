"""Validate exported animation endpoints against the three saved GLB poses."""
import json, struct, math
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
 entry={'clip':animation['name'],'seconds':round(times[-1][0]-times[0][0],3),'channels':len(channels)}
 if not animation['name'].endswith('Fire'):
  petal=next(i for i,n in enumerate(doc['nodes']) if n.get('name')=='Armour_petal_00')
  qs=channels[(petal,'rotation')]
  rotation=sum(2*math.acos(min(1,abs(sum(x*y for x,y in zip(a,b)))/(sum(x*x for x in a)*sum(x*x for x in b))**.5)) for a,b in zip(qs,qs[1:]))
  ps=channels[(petal,'translation')]
  vectors=[(p[1]-1.13,p[2]) for p in ps]
  orbit=sum(abs(math.atan2(a[0]*b[1]-a[1]*b[0],a[0]*b[0]+a[1]*b[1])) for a,b in zip(vectors,vectors[1:]))
  minimum=12 if animation['name'].endswith('Reload') else 6
  assert rotation>minimum,(animation['name'],'missing full plate rotation',rotation)
  assert orbit>minimum,(animation['name'],'plate must orbit the bore, not spin in place',orbit)
  entry.update(rotation_radians=round(rotation,3),orbit_radians=round(orbit,3))
 report.append(entry)
 for endpoint,reference in [(0,references[source]),(-1,references[destination])]:
  for i,node in enumerate(doc['nodes']):
   if node.get('name') not in reference or 'mesh' in node:continue
   # Fire begins with a light flash; the VFX envelope is not a geometric pose.
   if node.get('name')=='FX_charge' and endpoint==0 and animation['name'].endswith('Fire'):continue
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
