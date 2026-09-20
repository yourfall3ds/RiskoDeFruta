"""
Miniaturas da tela de selecao de personagem.

Renderiza, com fundo TRANSPARENTE, os retratos das classes e os icones das armas a partir dos
MESMOS GLBs que o jogo carrega â€” nada de arte paralela que envelhece separada do modelo.

Chamado por `scripts/build-select-portraits.cmd`; ver o cabecalho de `ClassSelect.ts` para onde
cada arquivo e' consumido.
"""
import bpy, sys, math, os
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
GLB, OUT, SIZE, PITCH, YAW, MARGIN = argv[0], argv[1], int(argv[2]), float(argv[3]), float(argv[4]), float(argv[5])
# `bust` = retrato do TRONCO PRA CIMA, que e' o que uma miniatura de selecao de personagem mostra.
# Corpo inteiro num quadrado de 96 px vira um boneco de 12 px de cabeca e nao se reconhece ninguem.
BUST = len(argv) > 6 and argv[6] == 'bust'

# ---- cena limpa -------------------------------------------------------------------------------
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)

meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
if not meshes:
    raise SystemExit('sem malha em ' + GLB)

# ---- caixa envolvente do conjunto -------------------------------------------------------------
lo = Vector((1e9, 1e9, 1e9))
hi = Vector((-1e9, -1e9, -1e9))
for o in meshes:
    for corner in o.bound_box:
        p = o.matrix_world @ Vector(corner)
        lo = Vector((min(lo.x, p.x), min(lo.y, p.y), min(lo.z, p.z)))
        hi = Vector((max(hi.x, p.x), max(hi.y, p.y), max(hi.z, p.z)))
centre = (lo + hi) / 2
radius = max((hi - lo).length / 2, 1e-4)

if BUST:
    # Altura do busto: do alto da cabeca ate' pouco abaixo do peito â€” 42% do corpo. O alvo sobe
    # para o meio dessa faixa e o raio vira metade dela, que e' o que a camera ortografica usa
    # para decidir o quanto cabe no quadro.
    altura = hi.z - lo.z
    faixa = altura * 0.30
    centre = Vector((centre.x, centre.y, hi.z - faixa / 2))
    radius = faixa / 2

# ---- camera ortografica: retrato de catalogo nao tem perspectiva exagerada ---------------------
cam_data = bpy.data.cameras.new('cam')
cam_data.type = 'ORTHO'
cam_data.ortho_scale = radius * 2 * MARGIN
cam = bpy.data.objects.new('cam', cam_data)
bpy.context.scene.collection.objects.link(cam)

yaw, pitch = math.radians(YAW), math.radians(PITCH)
dist = radius * 4
cam.location = centre + Vector((
    math.sin(yaw) * math.cos(pitch) * dist,
    -math.cos(yaw) * math.cos(pitch) * dist,
    math.sin(pitch) * dist,
))
direction = (centre - cam.location).normalized()
cam.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
bpy.context.scene.camera = cam

# ---- luz de tres pontos, para o volume aparecer sem estourar -----------------------------------
# SOL e nao AREA: a irradiancia do sol nao cai com a distancia, entao a exposicao fica igual para
# um personagem de 1,8 m e para uma pistola de 30 cm. Com area light o brilho escalava com o
# quadrado do raio e estourava o retrato inteiro em branco.
def lamp(name, offset, strength):
    d = bpy.data.lights.new(name, 'SUN')
    d.energy = strength
    d.angle = math.radians(12)          # penumbra suave, sem sombra recortada de estudio
    o = bpy.data.objects.new(name, d)
    o.location = centre + Vector(offset) * radius * 3
    o.rotation_euler = (centre - o.location).normalized().to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.collection.objects.link(o)

lamp('key',  (-1.1, -1.3,  1.2), 3.1)
lamp('fill', ( 1.4, -0.8,  0.3), 1.1)
lamp('rim',  ( 0.2,  1.5,  0.9), 2.2)

# ---- saida ------------------------------------------------------------------------------------
scene = bpy.context.scene
# O nome do EEVEE mudou no Blender 4.2 (`BLENDER_EEVEE` â†’ `BLENDER_EEVEE_NEXT`). Descobrir por
# introspecÃ§Ã£o das subclasses quebra: nem toda subclasse registrada expÃµe `bl_idname`
# (`HydraRenderEngine`, por exemplo). A lista de opÃ§Ãµes da prÃ³pria propriedade Ã© a fonte confiÃ¡vel.
_engines = {item.identifier for item in scene.bl_rna.properties['render'].fixed_type.properties['engine'].enum_items}
scene.render.engine = 'BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in _engines else 'BLENDER_EEVEE'
try:
    scene.eevee.taa_render_samples = 64
except Exception:
    pass
scene.render.film_transparent = True          # fundo transparente: o CSS poe o fundo
scene.render.resolution_x = SIZE
scene.render.resolution_y = SIZE
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'
scene.render.filepath = OUT
bpy.ops.render.render(write_still=True)
print('OK ' + OUT)

