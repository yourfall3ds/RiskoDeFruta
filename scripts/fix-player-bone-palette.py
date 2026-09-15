from pathlib import Path
p=Path('src/animation/CharacterVisual.ts');s=p.read_text(encoding='utf-8').replace("for(const clip of imported.animationGroups){clip.stop();", "for(const skeleton of imported.skeletons)skeleton.useTextureToStoreBoneMatrices=false;\n      for(const clip of imported.animationGroups){clip.stop();");p.write_text(s,encoding='utf-8')
