import wave
with wave.open('public/audio/foley/reload.wav') as w:print('reload recording seconds',w.getnframes()/w.getframerate())
