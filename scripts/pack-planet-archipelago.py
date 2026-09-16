"""Repack an already authored planet, preserving the Blender source and collision precision."""
import bpy,gzip,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(ROOT/'scripts'))
from pack_planet_buffers import compact
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'art/blender/Planet_Archipelago.blend'))
textures=ROOT/'.temp/planet-textures';textures.mkdir(parents=True,exist_ok=True)
for index,image in enumerate(bpy.data.images):
    if not image.size[0]:continue
    if max(image.size)>1024:
        factor=1024/max(image.size);image.scale(max(1,int(image.size[0]*factor)),max(1,int(image.size[1]*factor)))
    # Re-encode the resized pixels; otherwise glTF reuses the original packed 4K file.
    alpha=any(s in image.name.lower() for s in ['leaf','leaves','fern','grass','canopy','foliage'])
    if image.packed_file:image.unpack(method='REMOVE')
    image.file_format='PNG' if alpha else 'JPEG'
    image.filepath_raw=str(textures/(str(index)+('.png' if alpha else '.jpg')))
    image.save();image.pack()
with gzip.open(ROOT/'public/models/planet-archipelago.json.gz','wb',compresslevel=6) as stream:
    stream.write((ROOT/'public/models/planet-archipelago.json').read_bytes())
bpy.ops.export_scene.gltf(filepath=str(ROOT/'public/models/planet-archipelago.glb'),export_format='GLB',export_animations=False,
  export_draco_mesh_compression_enable=True,export_draco_mesh_compression_level=6,
  export_draco_position_quantization=18,export_draco_normal_quantization=12,export_draco_texcoord_quantization=14)
compact(ROOT/'public/models/planet-archipelago.glb')
print('PLANET PACKED',flush=True)
