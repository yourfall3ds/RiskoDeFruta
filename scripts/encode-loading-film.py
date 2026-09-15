import sys,subprocess
from pathlib import Path
sys.path.insert(0,str(Path('.tools/python').resolve()));import imageio_ffmpeg
exe=imageio_ffmpeg.get_ffmpeg_exe()
subprocess.run([exe,'-y','-framerate','30','-i','art/loading-loop/frames/frame-%04d.png','-c:v','libx264','-crf','20','-pix_fmt','yuv420p','-movflags','+faststart','public/ui/cosmic-descent.mp4'],check=True)
subprocess.run([exe,'-y','-i','art/loading-loop/cinematic-preview.png','-frames:v','1','-q:v','2','public/ui/loading-poster.jpg'],check=True)
