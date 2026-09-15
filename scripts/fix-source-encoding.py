from pathlib import Path
for p in Path('src').rglob('*.ts'):
 b=p.read_bytes()
 try:b.decode('utf-8')
 except UnicodeDecodeError:
  s=b.decode('utf-8','surrogateescape');s=''.join(bytes([ord(c)-0xdc00]).decode('cp1252') if 0xdc80<=ord(c)<=0xdcff else c for c in s);p.write_text(s,encoding='utf-8');print('encoding repaired',p)
s=Path('scripts/integrate-hordes.py').read_text();exec(s[s.index("p=Path('src/ui/CombatHUD.ts')"):])
