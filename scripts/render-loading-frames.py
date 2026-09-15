import bpy
from pathlib import Path
R=Path('D:/Riskodefruta2');bpy.ops.wm.open_mainfile(filepath=str(R/'art/blender/Independent_Cosmic_Loading.blend'));s=bpy.context.scene;s.render.engine='BLENDER_EEVEE';s.eevee.taa_render_samples=16;s.render.resolution_x=960;s.render.resolution_y=540;s.render.image_settings.file_format='PNG';s.render.filepath=str(R/'art/loading-loop/frames/frame-');(R/'art/loading-loop/frames').mkdir(exist_ok=True);s.frame_start=1;s.frame_end=120;bpy.ops.render.render(animation=True)
