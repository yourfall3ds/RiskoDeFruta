from pathlib import Path
p=Path('src/vfx/ElementalEffects.ts');s=p.read_text(encoding='utf-8').replace('gl_FragColor=vec4(color,alpha);','gl_FragColor=vec4(color,alpha*tex.a);');s=s.replace('water.subSurface.isRefractionEnabled=true;water.subSurface.refractionTexture=scene.environmentTexture;water.subSurface.linkRefractionWithTransparency=true;','')
s=s.replace('private serial=0;', 'private serial=0;private readonly auraSlots:Slot[]=[];')
a=s.index(' get activeCount():number');s=s[:a]+''' aura(kind:ElementKind,origins:Vector3[],time:number,power:number):void{
  if(power<=0){for(const slot of this.auraSlots){slot.active=false;for(const mesh of slot.meshes)mesh.setEnabled(false);}this.auraSlots.length=0;return;}
  for(let index=0;index<origins.length;index++){
   let slot=this.auraSlots[index];if(!slot){slot=this.slots.find(s=>!s.active&&!this.auraSlots.includes(s));if(!slot)break;this.auraSlots[index]=slot;}
   slot.active=true;slot.kind=kind;slot.age=0;slot.serial=++this.serial;slot.material.setFloat('element',ELEMENTS.indexOf(kind));slot.material.setFloat('glow',ELEMENT_PRESETS[kind].glow);slot.material.setFloat('age',time);slot.material.setFloat('opacity',power*.8);slot.material.alphaMode=kind==='fire'||kind==='electricity'?Constants.ALPHA_ADD:Constants.ALPHA_COMBINE;
   for(let j=0;j<3;j++){const mesh=slot.meshes[j]!,a=time*(j%2?-3:3)+j*2.094,indexScale=index===2?1.5:.75,r=index===2?.55:.13;mesh.setEnabled(true);mesh.position.copyFrom(origins[index]!).addInPlaceFromFloats(Math.cos(a)*r,Math.sin(a*1.3)*r,Math.sin(a)*r);mesh.scaling.set(indexScale*(.8+power*.5),indexScale*(1.1+power*.45),1);mesh.rotation.z=a*.3;}
  }
 }
''' +s[a:]
s=s.replace('for(const s of this.slots){if(!s.active)continue;', 'for(const s of this.slots){if(!s.active||this.auraSlots.includes(s))continue;')
s=s.replace(' clear():void{for(', ' clear():void{this.auraSlots.length=0;for(')
p.write_text(s,encoding='utf-8')
p=Path('src/vfx/SkillAura.ts');s=p.read_text(encoding='utf-8');s="import {StandardMaterial} from '@babylonjs/core/Materials/standardMaterial';\n"+s;s=s.replace('material:PBRMaterial;color:Color3','material:StandardMaterial;color:Color3')
s=s.replace("for(const material of container.materials){material.backFaceCulling=false;if(material instanceof PBRMaterial){material.unlit=true;this.emission.push({material,color:material.emissiveColor.clone()});}}", "for(const original of [...container.materials]){const material=new StandardMaterial(original.name+' ritual glow',this.scene);material.disableLighting=true;material.backFaceCulling=false;material.diffuseColor=Color3.Black();material.specularColor=Color3.Black();material.emissiveColor=original instanceof PBRMaterial?original.emissiveColor.clone():new Color3(.05,1,1);for(const mesh of container.meshes)if(mesh.material===original)mesh.material=material;this.emission.push({material,color:material.emissiveColor.clone()});}")
s=s.replace('for(const light of this.lights)light.dispose();}', 'for(const light of this.lights)light.dispose();for(const entry of this.emission)entry.material.dispose();}')
p.write_text(s,encoding='utf-8')
p=Path('src/game/PlayerScene.ts');s=p.read_text(encoding='utf-8');a=s.index('    if(this.cinematic.active){if(this.cinematic.elapsed<this.auraLast)');b=s.index('\n',a)
s=s[:a]+'''    if(this.cinematic.active){const elapsed=this.cinematic.elapsed,power=this.cinematic.preparing?Math.sin(this.cinematic.progress*Math.PI/2):Math.min(1,(1-this.cinematic.actionProgress)*5);this.elements.aura('electricity',[this.weapons.muzzlePose(0).position,this.weapons.muzzlePose(1).position,this.visual.position.add(new Vector3(0,.6,0))],elapsed,power);if(elapsed<this.auraLast)this.auraClock=0;if(this.cinematic.preparing&&elapsed>=this.auraClock&&elapsed<.9){this.auraClock=elapsed+.3;this.elements.emit('earth',this.visual.position,.45);}this.auraLast=elapsed;}else if(this.auraLast>=0){this.elements.clear();this.auraLast=-1;this.auraClock=0;}
''' +s[b:]
p.write_text(s,encoding='utf-8')
p=Path('docs/CURRENT_IMPLEMENTATION.md');s=p.read_text(encoding='utf-8');s += '\nCorreção da revisão: o atlas gerado contém alpha real (RGBA, alpha 0–254). Os blocos eram causados pelo shader ignorar tex.a; agora preserva a transparência. As auras são contínuas e acompanham as duas armas e o corpo. Margem vocal de +0,50 s solicitada após escuta pelo usuário: duração atual I 3,90 s, II 3,86 s, III 4,40 s.\n';p.write_text(s,encoding='utf-8')
