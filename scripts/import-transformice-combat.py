"""Import only the combat recordings used by this game; leave the source project untouched."""
from pathlib import Path
import hashlib, json, shutil, wave
import numpy as np

ROOT=Path(__file__).resolve().parents[1]
SOURCE=Path('C:/Users/darck/transformice/assets/Sound FX')
SELECTED={
 'melee-punch': [('punch-hit.wav','socos/soco quando acerta.wav')],
 'melee-heavy-punch': [('punch-heavy.wav','socos/soco critico.wav')],
 'melee-kick': [('kick-hit.wav','chutes/chute medio.wav'),('kick-hit-2.wav','chutes/chute.wav')],
 'melee-heavy-kick': [('kick-heavy.wav','chutes/Golpe Critico forte.wav')],
 'melee-swing': [(f'swing-{i}.wav',f'ataque/ataque {i}.wav') for i in range(1,4)],
 'melee-launch': [('launch.wav','voos e rushs/Barulho do cara voando longe quando recebe um golpe forte.wav')],
 'body-ground': [('body-ground.wav','voos e rushs/groundhit.wav')],
}
out=ROOT/'public/audio/combat';out.mkdir(parents=True,exist_ok=True)
manifest_path=ROOT/'public/audio/foley-manifest.json'
manifest=json.loads(manifest_path.read_text(encoding='utf-8'))
report=[]
for group,files in SELECTED.items():
 manifest[group]=[]
 for name,relative in files:
  source=SOURCE/relative
  with wave.open(str(source),'rb') as clip:
   channels,rate,width,frames=clip.getnchannels(),clip.getframerate(),clip.getsampwidth(),clip.getnframes()
   raw=clip.readframes(frames)
  if width not in (1,2):raise ValueError(f'Unsupported PCM width: {source}')
  samples=(np.frombuffer(raw,dtype=np.uint8).astype(float)-128)/128 if width==1 else np.frombuffer(raw,dtype='<i2').astype(float)/32768
  if frames<=0 or len(samples)==0 or not np.isfinite(samples).all():raise ValueError(source)
  shutil.copyfile(source,out/name)
  path='/audio/combat/'+name;manifest[group].append(path)
  report.append(dict(group=group,file=path,source=str(source),sha256=hashlib.sha256(source.read_bytes()).hexdigest(),seconds=round(frames/rate,4),channels=channels,rate=rate,peak=round(float(np.max(np.abs(samples))),5),rms=round(float(np.sqrt(np.mean(samples*samples))),5)))
manifest['player-hit']=manifest['melee-punch']
manifest_path.write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
(ROOT/'docs/transformice-combat-import.json').write_text(json.dumps(dict(origin='User-owned transformice project, explicitly supplied for reuse. Original third-party license not independently established.',recordings=report),ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps(report,ensure_ascii=False,indent=2))
