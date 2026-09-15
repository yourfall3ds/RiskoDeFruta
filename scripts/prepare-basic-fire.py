from pathlib import Path
source=Path('scripts/author-directional-animation.mjs').read_text(encoding='utf-8');prefix=source[:source.index('const authored=')];prefix=prefix.replace("const backup='art/processed/gunslinger-before-directional.glb';if(!existsSync(backup))copyFileSync('public/models/gunslinger.glb',backup);", "const backup='public/models/gunslinger.glb';")
body='''const audit=[];
for(const side of ['Right','Left']){const name=side==='Right'?'Fire_R':'Fire_L',sign=side==='Right'?1:-1,times=[],rotations=new Map();
 for(let f=0;f<=60;f++){const phase=f/60;reset();const kick=phase<.16?Math.sin(phase/.16*Math.PI/2):Math.exp(-(phase-.16)*4.5)*(1-phase)/.84;
  bend('Spine',Vector3.Up(),sign*.07*kick);bend('Spine1',Vector3.Right(),-.085*kick);bend('Head',Vector3.Right(),.045*kick);
  bend(side+'Shoulder',Vector3.Up(),sign*.055*kick);bend(side+'Arm',Vector3.Right(),-.16*kick);bend(side+'ForeArm',Vector3.Right(),-.12*kick);bend(side+'Hand',Vector3.Right(),-.065*kick);
  times.push([phase*.21]);for(const id of g.json.skins[0].joints){const n=nodes.get(g.json.nodes[id].name);if(n){const keys=rotations.get(id)??[];keys.push(n.rotationQuaternion.asArray());rotations.set(id,keys);}}
 }
 g.json.animations=g.json.animations.filter(a=>a.name!==name);const input=append(g,times,'SCALAR'),animation={name,channels:[],samplers:[]};for(const [id,keys]of rotations){animation.channels.push({sampler:animation.samplers.length,target:{node:id,path:'rotation'}});animation.samplers.push({input,output:append(g,keys,'VEC4'),interpolation:'LINEAR'});}g.json.animations.push(animation);audit.push({name,frames:61,duration:.21});
}
writeGlb('public/models/gunslinger.glb',g);writeFileSync('docs/basic-fire-animation-audit.json',JSON.stringify(audit,null,2));console.log(audit);scene.dispose();engine.dispose();
'''
Path('scripts/author-basic-fire.mjs').write_text(prefix+body,encoding='utf-8')
p=Path('src/animation/CharacterVisual.ts');s=p.read_text(encoding='utf-8').replace('private readonly firing=[1,1];','private readonly firing=[1,1];private lastShotSide=0;');s=s.replace('this.firing[side]=0;','this.firing[side]=0;this.lastShotSide=side;');s=s.replace('this.firing[side]!+dt/.23','this.firing[side]!+dt/.21');s=s.replace("name=>name.startsWith(prefix)&&upper(name)","name=>(name.startsWith(prefix)&&upper(name))||(side===this.lastShotSide&&!casting&&name.startsWith('Spine'))");p.write_text(s,encoding='utf-8')
