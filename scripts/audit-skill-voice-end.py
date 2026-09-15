import sys,json
from pathlib import Path
sys.path.insert(0,str(Path('.tools/asr').resolve()))
from faster_whisper.audio import decode_audio
from faster_whisper.vad import get_speech_timestamps,VadOptions
report={}
for p in Path('assets/som das skills').glob('*.mp3'):
 audio=decode_audio(str(p),sampling_rate=16000)
 report[p.name]={'duration':len(audio)/16000,'detections':{}}
 for threshold in [.35,.5,.65]:
  spans=get_speech_timestamps(audio,VadOptions(threshold=threshold,min_silence_duration_ms=180,speech_pad_ms=60))
  report[p.name]['detections'][str(threshold)]=[{k:round(v/16000,3) for k,v in s.items()} for s in spans]
print(json.dumps(report,indent=2))
Path('docs/skill-voice-vad.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
