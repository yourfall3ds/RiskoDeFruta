from pathlib import Path
from urllib.request import urlopen
import sys,json,wave
sys.path.insert(0,r'D:\Riskodefruta2\.tools\asr')
from faster_whisper.audio import decode_audio
import numpy as np
sources=[('casings-recording.mp3','https://cdn.freesound.org/previews/318/318964_5421667-hq.mp3'),('reload-recording.wav','https://opengameart.org/sites/default/files/reload.wav')]
for file,url in sources:Path('assets/'+file).write_bytes(urlopen(url).read())
x=decode_audio('assets/casings-recording.mp3',sampling_rate=44100);blocks=np.max(np.abs(x[:len(x)//441*441].reshape(-1,441)),axis=1);threshold=max(.015,float(blocks.max())*.22);starts=[]
for i in range(1,len(blocks)):
 if blocks[i]>=threshold and blocks[i-1]<threshold and (not starts or i-starts[-1]>130):starts.append(i)
manifest=json.loads(Path('public/audio/foley-manifest.json').read_text());manifest['casing']=[]
for n,start in enumerate(starts[:6]):
 clip=x[max(0,(start-2)*441):(start+95)*441];clip=clip/max(.1,float(np.max(np.abs(clip))))*.72
 file=f'public/audio/foley/casing-{n}.wav'
 with wave.open(file,'wb') as w:w.setnchannels(1);w.setsampwidth(2);w.setframerate(44100);w.writeframes((clip*32767).astype('<i2').tobytes())
 manifest['casing'].append('/audio/foley/casing-'+str(n)+'.wav')
Path('public/audio/foley/reload.wav').write_bytes(Path('assets/reload-recording.wav').read_bytes());manifest['reload']=['/audio/foley/reload.wav'];Path('public/audio/foley-manifest.json').write_text(json.dumps(manifest,indent=2))
print('casing cuts (seconds)',[i/100 for i in starts[:6]])
from faster_whisper import WhisperModel
model=WhisperModel('base',device='cpu',compute_type='int8',download_root=r'D:\Riskodefruta2\.tools\models')
x=decode_audio('assets/som das skills/furia-magronica-skill3.mp3',sampling_rate=16000)
segments,_=model.transcribe(x[16000:],language='pt',word_timestamps=True,initial_prompt='Fúria magrônica!')
print('skill3 cropped +1 second',[(w.word,w.start+1,w.end+1) for s in segments for w in s.words])
energy=np.sqrt(np.mean(x[:len(x)//160*160].reshape(-1,160)**2,axis=1));print('voice3 silent windows',[(i/100,round(float(v),4)) for i,v in enumerate(energy[:180]) if v<.01])
