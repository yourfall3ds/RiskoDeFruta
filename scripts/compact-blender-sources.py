"""Store editable runtime meshes and JPEG textures, excluding imported high-res orphans."""
import bpy
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
bpy.context.preferences.filepaths.save_version=0
for name in ['tomato','watermelon','broccoli','lettuce','banana','boss']:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.preferences.filepaths.save_version=0
    bpy.ops.import_scene.gltf(filepath=str(ROOT/f'public/models/{name}.glb'))
    bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/f'art/blender/Mutant_{name}.blend'),compress=True)
    print('COMPACT',name,flush=True)
