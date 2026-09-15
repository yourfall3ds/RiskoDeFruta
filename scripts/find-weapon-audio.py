from urllib.request import urlopen,Request
from pathlib import Path
import re,json
for name,url in [('casings','https://freesound.org/people/GryffDavid/sounds/318964/'),('reload','https://opengameart.org/content/handgun-reload-sound-effect')]:
 text=urlopen(Request(url,headers={'User-Agent':'Mozilla/5.0'})).read().decode()
 Path('art/'+name+'-source.html').write_text(text)
 links=re.findall(r'https?[^\s"<>]+(?:\.mp3|\.wav|\.ogg)',text)
 print(name,links)
