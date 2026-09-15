import json,shutil
from pathlib import Path
bank=json.loads(Path('public/audio/foley-manifest.json').read_text(encoding='utf-8-sig'))
voices={
'eggplant':{'growl':['Beast Growl 1','Beast Growl 2'],'attack':['Yucky Beast 1','Yucky Beast 2'],'hurt':['Yucky Beast 4','Yucky Beast 5'],'death':['Dieing Beast'],'spawn':['Beast Growl']},
'corn':{'growl':['Beast Growl 5'],'attack':['Yucky Beast 3'],'hurt':['Yucky Beast 6'],'death':['Dieing pixie'],'spawn':['Spirit Shout']},
'carrot':{'growl':['Pixie'],'attack':['Spirit Shout'],'hurt':['Yucky Beast 5'],'death':['Dieing pixie'],'spawn':['Pixie']},
'watermelon':{'growl':['Demon Growl'],'attack':['Yucky Beast','Yucky Beast 2'],'hurt':['Beast Growl 4'],'death':['Dieing Beast'],'spawn':['Beast Growl 3']},
 'tomato':{'growl':['Beast Growl 5'],'attack':['Demon Call One Voice'],'hurt':['Yucky Beast 6'],'death':['Dieing pixie'],'spawn':['Demon Call One Voice']},
 'boss':{'growl':['Demon Growl','Beast Growl 3'],'attack':['Demon Call'],'hurt':['Beast Growl 4'],'death':['Dieing Beast'],'spawn':['Demon Call']}}
for kind,events in voices.items():
 for event,files in events.items():
  key=f'enemy-{kind}-{event}';bank[key]=[]
  for i,file in enumerate(files):
   target=Path('public/audio/foley')/('enemy-voice-'+file.lower().replace(' ','-')+'.wav');shutil.copyfile(Path('art/source/foley-monsters/Monsters or Beasts')/(file+'.wav'),target);bank[key].append('/audio/foley/'+target.name)
for group,source in [('enemy-earth-impact','impactMining_000.ogg'),('enemy-wood-snap','impactWood_heavy_000.ogg')]:
 path=Path('art/source/foley-impact/Audio')/source
 if path.exists():shutil.copyfile(path,Path('public/audio/foley')/source);bank[group]=['/audio/foley/'+source]
Path('public/audio/foley-manifest.json').write_text(json.dumps(bank,indent=2),encoding='utf-8')
p=Path('src/audio/RecordedAudio.ts');s=p.read_text(encoding='utf-8');start=s.index('  const pitch=kind===');end=s.index('\n\r',start) if '\n\r' in s[start:] else -1
old="""  const pitch=kind==='boss'?.65:kind==='watermelon'?.78:kind==='carrot'?1.2:kind==='corn'?1.05:.95;

  this.play(group,(event==='hit'?.2:.35)/(1+distance*distance/64),pitch,pan,event==='hit'?.15:.35);"""
new="""  const voiceGroup='enemy-'+kind+'-'+group,selected=this.buffers.has(voiceGroup)?voiceGroup:group;
  const loudness=(event==='hit'?.3:event==='windup'?.58:.46)/(1+distance*distance/144);
  this.play(selected,loudness,kind==='boss'?.9:1,pan,event==='hit'?.18:.45);
  if(event==='attack'){const impact=kind==='corn'?'pistol':kind==='tomato'?'swish':kind==='carrot'?'enemy-wood-snap':'heavy';this.play(impact,loudness*.75,1,pan,.18);}"""
assert old in s;s=s.replace(old,new);p.write_text(s,encoding='utf-8')
print('Species/event groups:',len([k for k in bank if k.startswith('enemy-')]))
