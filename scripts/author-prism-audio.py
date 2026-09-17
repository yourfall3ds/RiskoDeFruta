"""Offline PRISM sound design: existing project foley + deterministic energy layers."""
from pathlib import Path
import numpy as np, wave, json
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'public/audio/prism';OUT.mkdir(parents=True,exist_ok=True)
SR=48000;rng=np.random.default_rng(715)
def foley(path,duration,pitch=1,offset=0):
 with wave.open(str(ROOT/'public/audio'/path),'rb') as w:
  width=w.getsampwidth();assert width in (2,4),path
  x=np.frombuffer(w.readframes(w.getnframes()),dtype='<i2' if width==2 else '<i4').astype(float)/(2**(width*8-1))
  x=x.reshape(-1,w.getnchannels()).mean(axis=1);rate=w.getframerate()
 x=np.interp(np.arange(int(duration*SR))*rate*pitch/SR+offset*rate,np.arange(len(x)),x,left=0,right=0)
 return x/(max(.05,np.max(np.abs(x))))
def noise(t,low,high):
 x=rng.normal(0,1,len(t));f=np.fft.rfftfreq(len(x),1/SR);s=np.fft.rfft(x)
 s*=np.exp(-(f/high)**4)*(1-np.exp(-(f/low)**4))
 x=np.fft.irfft(s,len(x));return x/max(.1,np.max(np.abs(x)))
def tone(t,start,end,decay):
 return np.sin(2*np.pi*(end*t+(start-end)*(.04)*(1-np.exp(-t/.04))))*np.exp(-t/decay)
def save(name,duration,kind):
 t=np.arange(int(SR*duration))/SR
 if kind.startswith('alien-'):
  # Soft FM/formant phrases: no metallic transients, engine ramps or foley.
  x=np.zeros_like(t)
  for i,when in enumerate([.02,.38,.81,1.23]):
   u=np.maximum(0,t-when);env=(t>=when)*(1-np.exp(-u/.035))*np.exp(-u/.22)
   if kind=='alien-organic':
    phase=2*np.pi*(390*u+9*np.sin(2*np.pi*2.2*u))
    voice=np.sin(phase+1.8*np.sin(2*np.pi*137*u))* .22
   elif kind=='alien-crystal':
    voice=sum(a*np.sin(2*np.pi*f*u+ .7*np.sin(2*np.pi*4*u)) for f,a in [(730,.13),(1097,.08),(1731,.035)])
   elif kind=='alien-portal':
    voice=.2*np.sin(2*np.pi*285*u+3*np.sin(2*np.pi*71*u))+.07*np.sin(2*np.pi*573*u)
   else:
    f=[510,680,605,850][i];voice=.24*np.sin(2*np.pi*f*u+2*np.exp(-u/.16)*np.sin(2*np.pi*f*.51*u))
   x+=voice*env
  x+=.035*noise(t,900,2600)*np.sin(np.pi*t/duration)**2
 elif kind=='tech-servo':
  env=np.sin(np.pi*t/duration)**1.4
  phase=2*np.pi*(210*t+110*t*t/duration)
  x=env*(.22*np.sin(phase)+.095*np.sin(phase*2.013)+.04*np.sin(phase*4.07)+.27*noise(t,1300,4300))
  for when in [.08,.28,.48]:
   u=np.maximum(0,t-when);x+=(t>=when)*(.06*np.sin(2*np.pi*1870*u)+.04*np.sin(2*np.pi*3021*u))*np.exp(-u/.035)
 elif kind in ('tech-unlock','tech-lock'):
  decay=.065 if kind=='tech-unlock' else .13
  x=.25*noise(t,1600,7000)*np.exp(-t/.012)+.18*np.sin(2*np.pi*170*t)*np.exp(-t/.025)
  for f,a in [(980,.13),(1586,.085),(2520,.045)]:x+=a*np.sin(2*np.pi*f*t)*np.exp(-t/decay)
 elif kind=='assault':x=.58*foley('pistol-1.wav',duration,1.15)+.30*noise(t,280,6500)*np.exp(-t/ .065)+.25*tone(t,900,145,.08)
 elif kind=='sniper':x=.60*foley('pistol-4.wav',duration,.8)+.38*tone(t,1300,100,.17)+.3*noise(t,600,8500)*np.exp(-t/.22)
 elif kind=='grenade':
  # Preserve the legacy generator's RNG sequence for all unrelated sounds.
  noise(t,90,1800)
  x=.8*foley('prism/source/launcher-boom.wav',duration,1,.20)*np.exp(-t/.19)
 elif kind=='explosion':x=.6*foley('combat/punch-heavy.wav',duration,.65)+.65*noise(t,25,1400)*np.exp(-t/.38)+.42*tone(t,95,32,.4)
 elif kind.startswith('impact'):x=.36*foley('combat/punch-hit.wav',duration,1.15)+.4*noise(t,400,6000)*np.exp(-t/.08)+.16*tone(t,1200,260,.12)
 elif kind=='servo':x=.4*noise(t,200,1800)*np.sin(np.pi*t/duration)**1.2+.13*np.sin(2*np.pi*(170*t+100*t*t))*(np.sin(np.pi*t/duration)**2)
 else:
  x=.7*foley('foley/reload.wav',duration,1.4 if kind=='unlock' else .9)+.18*noise(t,350,4500)*np.exp(-t/.025)
 # Short asymmetrical stereo reflections add body without a long ringing tail.
 x=np.tanh(x*1.25);fade=np.minimum(t/.003,1)*np.minimum((duration-t)/.045,1);x*=fade
 left=x.copy();right=x.copy()
 for delay,gain in [(.013,.12),(.029,.07),(.051,.035)]:
  d=int(delay*SR);left[d:]+=x[:-d]*gain;right[d+37:]+=x[:-(d+37)]*gain
 y=np.stack([left,right],axis=1);y*=.76/max(.76,np.max(np.abs(y)))
 with wave.open(str(OUT/(name+'.wav')),'wb') as w:w.setnchannels(2);w.setsampwidth(2);w.setframerate(SR);w.writeframes((y*32767).astype('<i2').tobytes())
 return {'name':name,'seconds':duration,'peak':float(np.max(np.abs(y))),'rms':float(np.sqrt(np.mean(y*y)))}
spec=[('assault',.30,'assault'),('sniper',.75,'sniper'),('grenade',.48,'grenade'),('impact-small',.23,'impact'),('impact-ion',.42,'impact-ion'),('explosion',1.1,'explosion'),('unlock',.16,'unlock'),('servo',.60,'servo'),('lock',.22,'lock'),('eject',.20,'unlock'),('insert',.25,'lock'),('tech-unlock',.18,'tech-unlock'),('tech-servo',.68,'tech-servo'),('tech-lock',.30,'tech-lock')]
spec += [(name,2.1,name) for name in ['alien-pulse','alien-organic','alien-crystal','alien-portal']]
report=[save(*entry) for entry in spec]
# Recorded explosion from the user's earlier game replaces the punch-based impact.
# Render after the synthetic bank so every other sound remains deterministic.
explosion=foley('prism/source/grenade-explosion.wav',2.72,1)
explosion*=np.minimum(np.arange(len(explosion))/(SR*.004),1)*np.minimum(np.arange(len(explosion))[::-1]/(SR*.06),1)
explosion*=.76/max(.76,np.max(np.abs(explosion)))
with wave.open(str(OUT/'explosion.wav'),'wb') as w:
 w.setnchannels(2);w.setsampwidth(2);w.setframerate(SR);w.writeframes((np.repeat(explosion[:,None],2,axis=1)*32767).astype('<i2').tobytes())
report=[entry if entry['name']!='explosion' else {'name':'explosion','seconds':2.72,'peak':float(np.max(np.abs(explosion))),'rms':float(np.sqrt(np.mean(explosion**2)))} for entry in report]
(OUT/'manifest.json').write_text(json.dumps({'source':'Existing project pistol, reload, launch and punch foley; original offline energy design. No downloaded audio.','sounds':report},indent=2))
print(json.dumps(report,indent=2))
