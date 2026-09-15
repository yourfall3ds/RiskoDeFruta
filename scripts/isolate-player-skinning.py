from pathlib import Path
p=Path('src/animation/CharacterVisual.ts');s=p.read_text(encoding='utf-8').replace('mesh.alwaysSelectAsActiveMesh=true;', 'mesh.alwaysSelectAsActiveMesh=true;mesh.computeBonesUsingShaders=false;');p.write_text(s,encoding='utf-8')
