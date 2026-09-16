"""Atlas autorais de chuva: rastros de gota, respingo em coroa e véu distante.

**Procedência honesta.** Estas texturas NÃO são fotografia nem gravação. São geradas offline por
este script, com numpy dentro do Blender (o mesmo Blender que o projeto já usa para os GLBs), e o
script É a fonte editável — não há um binário sem origem. O que elas trazem de "não procedural" é
a *variedade*: 16 rastros diferentes, cada um com comprimento, espessura, ondulação e
encordoamento próprios, em vez de um único ícone geométrico repetido 900 vezes.

Saídas (PNG RGBA, RGB branco para o material tingir, forma inteira no alfa):
- `public/textures/weather/rain-streaks.png`  512² · 4×4 células · 16 rastros distintos
- `public/textures/weather/rain-splash.png`   512² · 4×4 células · flipbook de coroa de respingo
- `public/textures/weather/rain-haze.png`     256² · véu distante, uma célula

Uso: "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b -P scripts/build-rain-atlas.py
"""
import bpy,math
import numpy as np
from pathlib import Path

ROOT=Path(__file__).resolve().parent.parent
OUT=ROOT/'public/textures/weather';OUT.mkdir(parents=True,exist_ok=True)

ATLAS=512
GRID=4
CELL=ATLAS//GRID
HAZE=256

def save(name,rgba):
 """`rgba` chega com a linha 0 no TOPO (convenção de atlas); o Blender grava de baixo para cima."""
 h,w,_=rgba.shape
 img=bpy.data.images.new(name,w,h,alpha=True)
 img.colorspace_settings.name='Non-Color'
 img.alpha_mode='STRAIGHT'
 img.pixels.foreach_set(np.ascontiguousarray(rgba[::-1]).reshape(-1).astype(np.float32))
 path=OUT/(name+'.png')
 img.filepath_raw=str(path);img.file_format='PNG';img.save()
 return path

def readback(path,expected):
 """Confere o arquivo gravado de verdade, em vez de confiar no buffer em memória."""
 check=bpy.data.images.load(str(path),check_existing=False)
 got=np.empty(len(check.pixels),dtype=np.float32);check.pixels.foreach_get(got)
 mean=float(got.reshape(-1,4)[:,3].mean())
 bpy.data.images.remove(check)
 assert abs(mean-expected)<.02,f'{path.name}: alfa médio {mean:.4f} != {expected:.4f} gravado'
 return mean

def smoothstep(t):
 t=np.clip(t,0,1);return t*t*(3-2*t)

# ---------------------------------------------------------------- rastros
def streak(rng,kind):
 """Um rastro de chuva visto por uma câmera: núcleo fino, pontas dissolvidas e o encordoamento
 que o olho lê como gotas emendadas. Cada célula sorteia os seus parâmetros."""
 a=np.zeros((CELL,CELL),np.float32)
 xs=np.arange(CELL,dtype=np.float32)+.5
 if kind=='drop':
  # Gota grande de primeiro plano: cabeça redonda com um rabo curto.
  length=rng.uniform(.20,.34)*CELL;core=rng.uniform(4.5,7.5)
 elif kind=='broken':
  length=rng.uniform(.62,.9)*CELL;core=rng.uniform(1.1,2.4)
 else:
  length=rng.uniform(.55,.95)*CELL;core=rng.uniform(1.3,4.0)
 y0=rng.uniform(0,CELL-length)
 taper=rng.uniform(1.1,2.5)
 wob_amp=rng.uniform(.4,3.4);wob_freq=rng.uniform(.6,1.9);wob_phase=rng.uniform(0,math.tau)
 f1,f2=rng.uniform(2.5,6.5),rng.uniform(7,15)
 p1,p2=rng.uniform(0,math.tau),rng.uniform(0,math.tau)
 bead=rng.uniform(.12,.42)
 peak=rng.uniform(.72,1.0)
 gaps=[(rng.uniform(.15,.8),rng.uniform(.04,.11)) for _ in range(rng.integers(2,4))] if kind=='broken' else []
 for iy in range(CELL):
  y=iy+.5
  s=(y-y0)/length
  if s<0 or s>1:continue
  env=(1-s)**taper
  # Entrada suave na cabeça: sem corte reto, que é o que faz parecer ícone.
  env*=smoothstep(s/.07) if s<.07 else 1.0
  env*=1+bead*(.62*math.sin(math.tau*f1*s+p1)+.38*math.sin(math.tau*f2*s+p2))
  for centre,width in gaps:
   env*=1-.92*math.exp(-((s-centre)/width)**2)
  if kind=='drop':
   env*=1+2.6*math.exp(-((s-.12)/.10)**2)
  env=max(env,0.0)
  if env<=.004:continue
  cx=CELL/2+wob_amp*math.sin(math.tau*wob_freq*s+wob_phase)
  w=core*(.35+.65*min(env,1.4))
  a[iy]=np.maximum(a[iy],np.exp(-((xs-cx)/max(w,.6))**2)*env*peak)
 return np.clip(a,0,1)

rng=np.random.default_rng(20260915)
KINDS=['streak']*10+['broken']*4+['drop']*2
streaks=np.zeros((ATLAS,ATLAS,4),np.float32);streaks[...,:3]=1.0
tiles=[]
for cell,kind in enumerate(KINDS):
 tile=streak(rng,kind)
 r,c=divmod(cell,GRID)
 streaks[r*CELL:(r+1)*CELL,c*CELL:(c+1)*CELL,3]=tile
 tiles.append(tile)
# Variedade real, não o mesmo desenho deslocado. Comparar massa de tinta não serve: dois rastros
# diferentes podem somar quase o mesmo. O que vale é a diferença PIXEL A PIXEL.
for i in range(len(tiles)):
 assert tiles[i].sum()>0,f'célula {i} de rastro vazia'
 for j in range(i+1,len(tiles)):
  different=int((np.abs(tiles[i]-tiles[j])>0.03).sum())
  assert different>200,f'células {i} e {j} do atlas são a mesma imagem ({different} px distintos)'
ink=[float(t.sum()) for t in tiles]
assert max(ink)/min(ink)>2.5,'os rastros têm todos o mesmo porte'
streak_mean=float(streaks[...,3].mean())

# ---------------------------------------------------------------- respingo em coroa
def splash(rng,t):
 """Coroa de respingo no instante `t` da vida: anel abrindo, entalhado, com gotículas saindo."""
 a=np.zeros((CELL,CELL),np.float32)
 yy,xx=np.mgrid[0:CELL,0:CELL]
 xx=xx+.5-CELL/2;yy=yy+.5-CELL/2
 r=np.hypot(xx,yy);theta=np.arctan2(yy,xx)
 fade=(1-t)**1.5
 if t<.14:
  # Primeiro contato: ponto de impacto brilhante antes de a coroa abrir.
  a=np.maximum(a,np.exp(-(r/(CELL*.045))**2)*(1-t/.14))
 radius=CELL*.42*math.sqrt(max(t,.004))
 thick=CELL*(.05+.055*t)
 lobes=rng.integers(5,9);phase=rng.uniform(0,math.tau)
 crown=np.exp(-((r-radius)/thick)**2)*fade
 # A coroa real é entalhada, não um anel perfeito.
 crown*=.5+.5*np.abs(np.sin(lobes*theta+phase))
 a=np.maximum(a,crown*.9)
 for _ in range(10):
  ang=rng.uniform(0,math.tau);speed=rng.uniform(.75,1.5);size=rng.uniform(.018,.05)*CELL
  dr=radius*speed;lift=1-(t*speed)**2
  if lift<=0:continue
  dx,dy=math.cos(ang)*dr,math.sin(ang)*dr
  a=np.maximum(a,np.exp(-(((xx-dx)**2+(yy-dy)**2)/(2*size*size)))*fade*lift*rng.uniform(.5,.95))
 if t<.45:
  column=np.exp(-((r/(CELL*.035))**2))*(1-t/.45)**1.2
  a=np.maximum(a,column*.8)
 return np.clip(a,0,1)

srng=np.random.default_rng(80081)
splashes=np.zeros((ATLAS,ATLAS,4),np.float32);splashes[...,:3]=1.0
frames=[]
for cell in range(GRID*GRID):
 tile=splash(srng,cell/(GRID*GRID-1))
 r,c=divmod(cell,GRID)
 splashes[r*CELL:(r+1)*CELL,c*CELL:(c+1)*CELL,3]=tile
 frames.append(float(tile.sum()))
# Flipbook de verdade: abre e some. O último quadro é bem mais fraco que o pico.
assert frames[-1]<max(frames)*.35,'o respingo não desaparece no fim do flipbook'
assert frames[0]>0,'o respingo não começa'
splash_mean=float(splashes[...,3].mean())

# ---------------------------------------------------------------- véu distante
# Não é uma folha de tela cheia: é a textura de UM cartão grande, que continua no mundo, com
# muitas hastes fracas em vez de ruído branco.
hrng=np.random.default_rng(4242)
haze=np.zeros((HAZE,HAZE,4),np.float32);haze[...,:3]=1.0
veil=np.zeros((HAZE,HAZE),np.float32)
xs=np.arange(HAZE,dtype=np.float32)+.5
for _ in range(90):
 cx=hrng.uniform(0,HAZE);w=hrng.uniform(.9,3.2);amp=hrng.uniform(.10,.30)
 top=hrng.uniform(0,HAZE*.5);length=hrng.uniform(HAZE*.35,HAZE*.9)
 tilt=hrng.uniform(-.09,.09)
 for iy in range(HAZE):
  s=(iy-top)/length
  if s<0 or s>1:continue
  env=math.sin(math.pi*min(s,1.0))**.8
  veil+= 0
  veil[iy]=np.maximum(veil[iy],np.exp(-((xs-(cx+tilt*(iy-top)))/w)**2)*env*amp)
# Queda vertical nas bordas para o cartão não mostrar recorte.
rows=np.sin(np.pi*(np.arange(HAZE)+.5)/HAZE)[:,None]**.6
cols=np.sin(np.pi*(np.arange(HAZE)+.5)/HAZE)[None,:]**.45
haze[...,3]=np.clip(veil*rows*cols,0,1)
haze_mean=float(haze[...,3].mean())
assert haze_mean<.12,'o véu ficou denso demais e vira cortina opaca'

paths=[save('rain-streaks',streaks),save('rain-splash',splashes),save('rain-haze',haze)]
for path,expected in zip(paths,[streak_mean,splash_mean,haze_mean]):
 print('RAIN ATLAS',path.name,'alfa médio',f'{readback(path,expected):.4f}',f'{path.stat().st_size/1024:.0f} KB')
print('RAIN ATLAS OK')
