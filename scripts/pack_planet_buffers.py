"""Losslessly share identical embedded buffers/textures from the source landscape GLBs."""
import hashlib,json,struct
from pathlib import Path

def compact(path):
    path=Path(path);raw=path.read_bytes();size=struct.unpack_from('<I',raw,12)[0]
    doc=json.loads(raw[20:20+size]);binary=raw[28+size:]
    packed=bytearray();seen={}
    for view in doc.get('bufferViews',[]):
        start=view.get('byteOffset',0);data=binary[start:start+view['byteLength']]
        key=(len(data),hashlib.sha256(data).digest())
        if key not in seen:
            packed.extend(b'\0'*((-len(packed))%4));seen[key]=len(packed);packed.extend(data)
        view['byteOffset']=seen[key]
    doc['buffers'][0]['byteLength']=len(packed)
    meta=json.dumps(doc,separators=(',',':')).encode();meta+=b' '*((-len(meta))%4)
    packed.extend(b'\0'*((-len(packed))%4))
    result=struct.pack('<4sII',b'glTF',2,28+len(meta)+len(packed))+struct.pack('<I4s',len(meta),b'JSON')+meta+struct.pack('<I4s',len(packed),b'BIN\0')+packed
    path.write_bytes(result)
    print('SHARED BUFFERS',round(len(raw)/1048576,1),'->',round(len(result)/1048576,1),'MiB',flush=True)

if __name__=='__main__':compact(Path(__file__).resolve().parent.parent/'public/models/planet-archipelago.glb')
