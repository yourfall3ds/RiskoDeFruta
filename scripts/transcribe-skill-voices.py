import os,sys,json
os.environ['HF_HOME']=r'D:\Riskodefruta2\.tools\models'
os.environ['HF_HUB_DISABLE_SYMLINKS_WARNING']='1'
sys.path.insert(0,r'D:\Riskodefruta2\.tools\asr')
from faster_whisper import WhisperModel
from pathlib import Path
model=WhisperModel('base',device='cpu',compute_type='int8',download_root=r'D:\Riskodefruta2\.tools\models')
result={}
for path in Path('assets/som das skills').glob('*.mp3'):
 segments,info=model.transcribe(str(path),language='pt',word_timestamps=True,initial_prompt='Ora! Segura minha chibata! Rajada mortal! Fúria magrônica!')
 result[path.name]=[{'start':s.start,'end':s.end,'text':s.text,'words':[{'word':w.word,'start':w.start,'end':w.end,'probability':w.probability} for w in s.words]} for s in segments]
 print(json.dumps({path.name:result[path.name]},ensure_ascii=False),flush=True)
Path('docs/skill-voice-transcription.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
