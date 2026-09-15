import sys,subprocess,json
from pathlib import Path
R=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(R/'.tools/python'));import imageio_ffmpeg
exe=imageio_ffmpeg.get_ffmpeg_exe();frames=R/'art/loading-loop/headfirst-frames'
assert all((frames/f'frame-{i:04d}.png').is_file() for i in range(1,121))
video=R/'public/ui/cosmic-descent-v2.mp4';poster=R/'public/ui/loading-poster-v2.jpg'
subprocess.run([exe,'-y','-framerate','30','-i',str(frames/'frame-%04d.png'),'-frames:v','120','-c:v','libx264','-crf','20','-pix_fmt','yuv420p','-movflags','+faststart',str(video)],check=True)
subprocess.run([exe,'-y','-i',str(video),'-frames:v','1','-q:v','2',str(poster)],check=True)
reader=imageio_ffmpeg.read_frames(str(video),pix_fmt='rgb24');meta=next(reader);count=sum(1 for _ in reader)
assert meta['size']==(1280,720) and abs(meta['fps']-30)<.01 and count==120,(meta,count)
report={'width':1280,'height':720,'fps':meta['fps'],'decodedFrames':count,'durationSeconds':meta['duration'],'bytes':video.stat().st_size,'source':'art/blender/Headfirst_Loading_Review.blend','runtimeMapRequired':False,'review':'Frames 1, 60 and 120 reviewed offline. Browser playback and orbital transition remain pending.'}
(R/'docs/loading-headfirst-validation.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
for name in ['index.html','src/ui/PlayerHUD.ts']:
 p=R/name;s=p.read_text(encoding='utf-8-sig').replace('/ui/cosmic-descent.mp4','/ui/cosmic-descent-v2.mp4').replace('/ui/loading-poster.jpg','/ui/loading-poster-v2.jpg');p.write_text(s,encoding='utf-8')
print(json.dumps(report),flush=True)
