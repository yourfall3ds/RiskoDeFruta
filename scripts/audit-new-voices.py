from pathlib import Path
import sys,json,hashlib
sys.path.insert(0,r'D:\Riskodefruta2\.tools\asr')
from faster_whisper.audio import decode_audio
r={}
for f in Path('assets/som das skills').glob('*.mp3'):
 x=decode_audio(str(f),sampling_rate=16000);r[f.name]={'duration':len(x)/16000,'sha256':hashlib.sha256(f.read_bytes()).hexdigest()}
Path('docs/skill-voice-audit.json').write_text(json.dumps(r,indent=2));print(r)
s=Path('docs/foley-sources.json');sources=json.loads(s.read_text());sources.extend([{'author':'GryffDavid','license':'CC0','url':'https://freesound.org/people/GryffDavid/sounds/318964/','use':'Six trimmed and level-normalized recordings of spent shell casings bouncing on tile; downloaded public HQ preview.'},{'author':'zer0_sol','license':'CC0','url':'https://opengameart.org/content/handgun-reload-sound-effect','use':'Recorded handgun magazine and slide reload.'}]);s.write_text(json.dumps(sources,ensure_ascii=False,indent=2))
