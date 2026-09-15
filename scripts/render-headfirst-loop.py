import bpy
from pathlib import Path
R=Path(__file__).resolve().parent.parent
bpy.ops.wm.open_mainfile(filepath=str(R/'art/blender/Headfirst_Loading_Review.blend'))
s=bpy.context.scene;s.render.engine='BLENDER_EEVEE';s.eevee.taa_render_samples=16;s.render.resolution_x=1280;s.render.resolution_y=720;s.render.image_settings.file_format='PNG';s.render.fps=30;s.frame_start=1;s.frame_end=120
out=R/'art/loading-loop/headfirst-frames';out.mkdir(exist_ok=True);s.render.filepath=str(out/'frame-');bpy.ops.render.render(animation=True)
