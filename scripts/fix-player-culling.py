from pathlib import Path
p=Path('src/animation/CharacterVisual.ts');s=p.read_text(encoding='utf-8').replace('mesh.isPickable=false;mesh.receiveShadows=true;','mesh.isPickable=false;mesh.receiveShadows=true;mesh.alwaysSelectAsActiveMesh=true;');p.write_text(s,encoding='utf-8')
