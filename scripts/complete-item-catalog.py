from pathlib import Path
import json,re
rows='''2|Seringa revitalizante|maxHP|15
5|Moeda de trevo|crit|.05
6|Anel de caveira|damage|.12
7|Ímã de campo|mp|.12
11|Granada de sementes|damage|.15
13|Bússola do explorador|moveSpeed|.08
14|Cogumelo curativo|regeneration|.8
15|Chave dourada|maxHP|20
17|Garras de osso|damage|.13
19|Broche alado|jump|.15
20|Gancho de escalada|jump|.12
21|Manopla de combate|damage|.14
22|Olho vigilante|crit|.07
23|Âncora de proteção|armor|16
24|Sino da colheita|regeneration|.7
26|Elixir verde|maxHP|18
27|Chifre entalhado|mp|.15
29|Drone foguete|attackSpeed|.1
30|Coroa quebrada|armor|18
31|Pé de coelho|moveSpeed|.09
32|Dados do destino|crit|.06
33|Máscara de gás|armor|14
34|Ídolo lunar|mp|.16
35|Gancho de correntes|damage|.13
36|Máscara oni|damage|.18
37|Ampulheta|dodgeRecharge|.18
38|Punho foguete|attackSpeed|.12
39|Escudo alado|armor|22
40|Frasco de sangue|regeneration|1
41|Carta do destino|crit|.08
42|Bobina elétrica|attackSpeed|.14
43|Lanterna do campo|maxHP|22
44|Presa de lobo|damage|.17
45|Caixa de música|regeneration|1.2
46|Turbina|moveSpeed|.12
47|Coroa de espinhos|armor|20
48|Gema do coração|maxHP|28
49|Detonador|mp|.18
50|Amuleto de nós|dodgeRecharge|.16
51|Broche de aranha|jump|.18
52|Cubo enigmático|mp|.2
53|Totem do corvo|crit|.09
54|Máscara de porcelana|armor|24
55|Aljava ligeira|attackSpeed|.13
56|Pergaminho estelar|mp|.2
57|Medalhão de safira|maxHP|26
58|Glaive flamejante|damage|.2
59|Pingente de caixão|regeneration|1.2
60|Pluma de fênix|jump|.22
61|Olho do dragão|crit|.1
62|Cálice de caveira|maxHP|30
63|Coroa estelar|mp|.22
64|Fragmento cristalino|damage|.18
65|Orbe cósmico|mp|.24
66|Cruz alada|regeneration|1.4
67|Geodo de magma|damage|.22
68|Caveira coroada|armor|28
69|Medalhão solar|maxHP|32
70|Cimitarra lunar|attackSpeed|.16
71|Frasco de tempestade|mp|.24
72|Coração perfurado|maxHP|34
73|Prisma do vazio|crit|.12
74|Núcleo arcano|mp|.26
75|Lanterna das almas|regeneration|1.5
76|Anel de serpente|attackSpeed|.17
77|Sinete de leão|armor|30
78|Bússola astral|moveSpeed|.14
79|Lótus cristalino|regeneration|1.6
80|Sino espiritual|dodgeRecharge|.22
81|Jarro de almas|maxHP|36
82|Manopla dourada|damage|.24
83|Chave do trovão|attackSpeed|.18
84|Tomo alado|jump|.25
85|Brasão flamejante|damage|.25
86|Totem da tempestade|mp|.28
87|Relógio cósmico|dodgeRecharge|.25
88|Máscara de plumas|moveSpeed|.15
89|Trevo de gemas|crit|.13'''
labels={'maxHP':'vida máxima','damage':'dano','attackSpeed':'cadência','moveSpeed':'velocidade','jump':'altura do salto','dodgeRecharge':'recarga da esquiva','crit':'chance de crítico antes dos retornos decrescentes','armor':'armadura','regeneration':'HP/s de regeneração','mp':'poder de habilidade'}
extra=[]
for row in rows.splitlines():
 icon,name,stat,val=row.split('|');value=float(val);number=str(round(value*100) if stat not in ['maxHP','armor','regeneration'] else value).removesuffix('.0');unit='%' if stat not in ['maxHP','armor','regeneration'] else ''
 extra.append({'id':'perk_'+icon.zfill(2),'name':name,'description':f'+{number}{unit} de {labels[stat]} por unidade.','icon':int(icon),'rarity':'common' if int(icon)<40 else 'uncommon','stat':stat,'value':value})
p=Path('src/run/RunProgression.ts');s=p.read_text();s=s.replace('\n];\nexport class RunProgression','\n'+',\n'.join(json.dumps(x,ensure_ascii=False) for x in extra)+',\n];\nexport class RunProgression');p.write_text(s)
print('Added',len(extra),'item definitions')
