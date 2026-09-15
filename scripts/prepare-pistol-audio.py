import zipfile,wave,io,numpy as np,json
from pathlib import Path
R=Path.cwd();z=zipfile.ZipFile(R/'art/source/gunshots-tabasco-cc0.zip');w=wave.open(io.BytesIO(z.read('sounds/cz.wav')));rate=w.getframerate();a=np.frombuffer(w.readframes(w.getnframes()),dtype='<i2').reshape(-1,2).mean(axis=1)/32768
out=R/'public/audio';out.mkdir(exist_ok=True)
for i,time in enumerate([.28,2.82,4.07,5.54]):
 start=max(0,int((time-.012)*rate));v=a[start:start+int(.58*rate)].copy();spectrum=np.fft.rfft(v);freq=np.fft.rfftfreq(len(v),1/rate);v=np.fft.irfft(spectrum*(freq/np.sqrt(freq**2+100**2)),n=len(v));v*=np.minimum(1,np.arange(len(v))/48);v*=np.exp(-np.arange(len(v))/rate*3.3);v[-int(rate*.05):]*=np.linspace(1,0,int(rate*.05));v=.9*v/max(.01,np.max(abs(v)))
 with wave.open(str(out/f'pistol-{i+1}.wav'),'wb') as f:f.setnchannels(1);f.setsampwidth(2);f.setframerate(rate);f.writeframes((v*32767).astype('<i2').tobytes())
(R/'docs/pistol-audio-source.json').write_text(json.dumps({'author':'Tabasco','source':'https://opengameart.org/content/gunshot-sounds','license':'CC0','recording':'sounds/cz.wav','edits':'Four individual CZ-52 shots; mono, high-pass 100 Hz, shorter ambience, peak -0.9 dBFS, tail fade','startSeconds':[.28,2.82,4.07,5.54]},indent=2))
print('Four CZ-52 pistol samples ready')
