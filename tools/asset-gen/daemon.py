"""
daemon.py - Servidor local de geracao 3D. Sem UI, sem Gradio.

Por que daemon e nao script por chamada:
  Carregar os pesos do Hunyuan3D leva 60-120s. Rodando como processo residente
  esse custo e pago uma vez; cada geracao depois disso custa so a inferencia.

Protocolo (HTTP em localhost, JSON in / binario out):
  GET  /health          -> {"ok": true, "model": "...", "device": "cuda"}
  POST /generate        -> body JSON {"image": "<base64>", "steps": int,
                                      "octree": int, "seed": int}
                        -> resposta: GLB cru (application/octet-stream)

Uso:
    tools/asset-gen/.venv/Scripts/python.exe tools/asset-gen/daemon.py --port 8731
"""

import argparse
import base64
import io
import json
import os
import sys
import threading
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# O servidor e threaded (para /health responder durante uma geracao longa), mas
# a GPU nao e compartilhavel: duas geracoes simultaneas estouram a VRAM. Este
# lock serializa a inferencia; clientes concorrentes esperam a vez.
GPU_LOCK = threading.Lock()

# hy3dgen nao e instalavel via pip - vive no repo vendorizado ao lado deste arquivo.
VENDOR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "vendor", "Hunyuan3D-2")
if VENDOR not in sys.path:
    sys.path.insert(0, VENDOR)

# ---------------------------------------------------------------------------
# TUNING_REQUIRED - a RTX 3080 Ti tem 12 GB. Cabe o shape sem offload; a etapa
# de textura precisa de offload sequencial e de kernels compilados (nvcc).
# ---------------------------------------------------------------------------
DEFAULT_MODEL = "tencent/Hunyuan3D-2mini"
DEFAULT_SUBFOLDER = "hunyuan3d-dit-v2-mini-turbo"

# O modulo de pintura nao existe no 2mini - vem do repo padrao e funciona sobre
# malha de qualquer modelo de shape.
PAINT_MODEL = "tencent/Hunyuan3D-2"
PAINT_SUBFOLDER = "hunyuan3d-paint-v2-0-turbo"
USAR_OFFLOAD = True
PAINT_RES = 0     # 0 = mantem o padrao do modelo (2048)
VIEW_SIZE = 0     # 0 = mantem o padrao (512) - FONTE do detalhe da textura
VISTAS_EXTRA = False  # True = 10 vistas em vez de 6

STATE = {
    "pipeline": None, "model": None, "device": None,
    "rembg": None, "paint": None,
    # Trabalho em andamento, para o painel mostrar o que esta acontecendo em vez
    # de so o que ja existe em disco. `label` vem do cliente: o daemon recebe uma
    # imagem, nao sabe sozinho que peca esta gerando.
    "job": None,
    "historico": [],
}


def marcar(etapa: str, label: str = "") -> None:
    """Registra a etapa atual do trabalho para o endpoint /status."""
    job = STATE["job"]
    if job is None or label:
        STATE["job"] = {"label": label or "?", "etapa": etapa, "inicio": time.time()}
    else:
        job["etapa"] = etapa


def encerrar_job(ok: bool) -> None:
    job = STATE["job"]
    if job:
        job["fim"] = time.time()
        job["ok"] = ok
        STATE["historico"] = ([job] + STATE["historico"])[:12]
    STATE["job"] = None


def load_paint():
    """Carrega o pipeline de pintura sob demanda.

    Em 12 GB o shape e o paint nao cabem residentes juntos, entao ligamos
    offload de CPU no paint: cada submodelo sobe para a GPU so enquanto roda.
    Custa tempo, nao qualidade.
    """
    if STATE["paint"] is not None:
        return STATE["paint"]

    # ORDEM OBRIGATORIA: torch antes de texgen. O custom_rasterizer_kernel.pyd
    # depende das DLLs de CUDA que o torch registra via os.add_dll_directory no
    # seu __init__. Invertendo, o import morre com "DLL load failed".
    import torch
    from hy3dgen.texgen import Hunyuan3DPaintPipeline

    t0 = time.time()
    paint = Hunyuan3DPaintPipeline.from_pretrained(PAINT_MODEL, subfolder=PAINT_SUBFOLDER)
    # O offload salva VRAM movendo submodelos entre CPU e GPU, mas nem todo
    # pipeline sobrevive a isso: o paint NAO-turbo quebra na inferencia com
    # "Expected all tensors to be on the same device". Por isso e opcional.
    if USAR_OFFLOAD:
        try:
            paint.enable_model_cpu_offload()
        except Exception as exc:  # nao fatal: sem offload ainda pode caber
            print(f"[daemon] offload indisponivel ({exc}); seguindo sem", flush=True)
    else:
        print("[daemon] offload DESLIGADO (pode estourar a VRAM)", flush=True)

    # render_size/texture_size definem o tamanho do latente da difusao multiview.
    # Baixar de 2048 para 1024 corta o pico de memoria em ~4x. Isso importa
    # porque o paint NAO-turbo liga classifier-free guidance, que DOBRA o batch:
    # em 12 GB ele estoura, e o driver Windows nao da OOM - derrama para a RAM
    # do sistema e roda ~30x mais lento sem avisar.
    if PAINT_RES:
        try:
            paint.config.render_size = PAINT_RES
            paint.config.texture_size = PAINT_RES
            print(f"[daemon] paint render/texture = {PAINT_RES}", flush=True)
        except Exception as exc:
            print(f"[daemon] nao consegui ajustar resolucao ({exc})", flush=True)

    # view_size e a resolucao em que CADA VISTA da difusao multiview e gerada -
    # a FONTE do detalhe da textura. O atlas (texture_size) e so o destino do
    # bake: ampliar o destino sem ampliar a fonte nao cria detalhe nenhum.
    # O padrao e 512.
    if VIEW_SIZE:
        try:
            paint.models["multiview_model"].view_size = VIEW_SIZE
            print(f"[daemon] view_size = {VIEW_SIZE}", flush=True)
        except Exception as exc:
            print(f"[daemon] nao consegui ajustar view_size ({exc})", flush=True)

    # Mais vistas = menos superficie deduzida. O padrao observa 6 angulos; as
    # regioes que nenhuma vista alcanca sao invencao do modelo.
    if VISTAS_EXTRA:
        try:
            c = paint.config
            c.candidate_camera_azims = [0, 45, 90, 135, 180, 225, 270, 315, 0, 180]
            c.candidate_camera_elevs = [0, 0, 0, 0, 0, 0, 0, 0, 90, -90]
            c.candidate_view_weights = [1, 0.3, 0.15, 0.3, 0.5, 0.3, 0.15, 0.3, 0.05, 0.05]
            print(f"[daemon] vistas = {len(c.candidate_camera_azims)}", flush=True)
        except Exception as exc:
            print(f"[daemon] nao consegui ajustar vistas ({exc})", flush=True)

    STATE["paint"] = paint
    torch.cuda.empty_cache()
    print(f"[daemon] paint carregado em {time.time() - t0:.1f}s", flush=True)
    return paint


def load_pipeline(model: str, subfolder: str):
    """Carrega o pipeline de shape. So torch puro - nao exige nvcc."""
    import torch
    from hy3dgen.shapegen import Hunyuan3DDiTFlowMatchingPipeline

    device = "cuda" if torch.cuda.is_available() else "cpu"
    t0 = time.time()
    pipe = Hunyuan3DDiTFlowMatchingPipeline.from_pretrained(
        model,
        subfolder=subfolder,
        use_safetensors=True,
        device=device,
    )
    STATE.update(pipeline=pipe, model=f"{model}/{subfolder}", device=device)
    print(f"[daemon] modelo carregado em {time.time() - t0:.1f}s ({device})", flush=True)
    return pipe


def generate_glb(
    image_bytes: bytes,
    steps: int,
    octree: int,
    seed: int,
    texture: bool = False,
    target_faces: int = 40000,
    label: str = "",
) -> bytes:
    """Imagem -> GLB.

    Ordem importa: limpamos e decimamos ANTES de pintar. O unwrap de UV roda
    sobre a malha final, entao pintar 1,1M faces desperdicia tempo e produz UV
    inutilizavel. Decimar depois de pintar destruiria a textura.
    """
    import torch
    from PIL import Image

    image = Image.open(io.BytesIO(image_bytes))

    # O modelo condiciona no alpha: fundo opaco vira geometria parasita. Concept
    # art costuma vir com fundo chapado, entao removemos quando nao ha alpha util.
    if image.mode != "RGBA" or image.getchannel("A").getextrema()[0] == 255:
        if STATE["rembg"] is None:
            from hy3dgen.rembg import BackgroundRemover
            STATE["rembg"] = BackgroundRemover()
        image = STATE["rembg"](image.convert("RGB"))
    image = image.convert("RGBA")

    marcar("forma", label)
    torch.cuda.reset_peak_memory_stats()
    t0 = time.time()
    generator = torch.Generator(device=STATE["device"]).manual_seed(seed)
    meshes = STATE["pipeline"](
        image=image,
        num_inference_steps=steps,
        octree_resolution=octree,
        generator=generator,
    )
    t_shape = time.time() - t0
    mesh = meshes[0]
    raw_faces = len(mesh.faces)

    # Limpeza + decimacao. Sempre antes da pintura (ver docstring).
    from hy3dgen.shapegen import DegenerateFaceRemover, FaceReducer, FloaterRemover

    marcar("limpeza")
    t1 = time.time()
    mesh = FloaterRemover()(mesh)
    mesh = DegenerateFaceRemover()(mesh)
    if target_faces > 0:
        mesh = FaceReducer()(mesh, max_facenum=target_faces)
    t_clean = time.time() - t1

    t_paint = 0.0
    if texture:
        # O modelo de FORMA ja cumpriu seu papel e nao e usado na pintura, mas
        # continua ocupando VRAM. Mandando ele para a CPU aqui, o pipeline de
        # pintura ganha varios GB de folga - e essa folga e o que decide entre
        # rodar na GPU ou derramar para a RAM do sistema (30x mais lento).
        # Devolvemos para a GPU no fim, senao a proxima geracao roda na CPU.
        movido = False
        try:
            STATE["pipeline"].to("cpu")
            movido = True
            torch.cuda.empty_cache()
            print(
                f"[daemon] forma -> CPU; VRAM em uso "
                f"{torch.cuda.memory_allocated() / 2**30:.1f} GB",
                flush=True,
            )
        except Exception as exc:
            print(f"[daemon] nao consegui liberar a forma ({exc})", flush=True)

        marcar("pintura")
        t2 = time.time()
        try:
            mesh = load_paint()(mesh, image=image)
        finally:
            t_paint = time.time() - t2
            if movido:
                try:
                    STATE["pipeline"].to(STATE["device"])
                except Exception as exc:
                    print(f"[daemon] falha ao devolver a forma ({exc})", flush=True)
            torch.cuda.empty_cache()

    buf = io.BytesIO()
    mesh.export(buf, file_type="glb")
    data = buf.getvalue()
    print(
        f"[daemon] shape {t_shape:.1f}s ({raw_faces} faces) + limpeza {t_clean:.1f}s "
        f"({len(mesh.faces)} faces)"
        + (f" + pintura {t_paint:.1f}s" if texture else " | sem textura")
        + f" | pico VRAM {torch.cuda.max_memory_allocated()/2**30:.1f}/{torch.cuda.get_device_properties(0).total_memory/2**30:.1f} GB"
        + f" | {len(data) / 1048576:.1f} MB",
        flush=True,
    )
    return data


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass  # silencia o log de acesso; o que importa ja e impresso acima

    def _cors(self):
        # O painel roda no Vite (porta 5173) e consulta este daemon (8731). Sao
        # origens diferentes: sem estes cabecalhos o navegador bloqueia a leitura
        # e o painel nao consegue distinguir "gerador desligado" de "bloqueado".
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")

    def _json(self, code, payload):
        body = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        if self.path == "/health":
            self._json(200, {
                "ok": STATE["pipeline"] is not None,
                "model": STATE["model"],
                "device": STATE["device"],
            })
        elif self.path == "/status":
            agora = time.time()
            job = STATE["job"]
            self._json(200, {
                "ocupado": job is not None,
                "atual": None if job is None else {
                    "label": job["label"],
                    "etapa": job["etapa"],
                    "segundos": round(agora - job["inicio"], 1),
                },
                "historico": [
                    {
                        "label": h["label"],
                        "ok": h.get("ok", False),
                        "segundos": round(h.get("fim", agora) - h["inicio"], 1),
                    }
                    for h in STATE["historico"]
                ],
            })
        else:
            self._json(404, {"error": "rota desconhecida"})

    def do_POST(self):
        if self.path != "/generate":
            return self._json(404, {"error": "rota desconhecida"})
        try:
            length = int(self.headers.get("Content-Length", 0))
            req = json.loads(self.rfile.read(length))
            if GPU_LOCK.locked():
                print("[daemon] GPU ocupada; requisicao na fila", flush=True)
            with GPU_LOCK:
                glb = generate_glb(
                    base64.b64decode(req["image"]),
                    int(req.get("steps", 30)),
                    int(req.get("octree", 256)),
                    int(req.get("seed", 42)),
                    bool(req.get("texture", False)),
                    int(req.get("target_faces", 40000)),
                    str(req.get("label", "")),
                )
            encerrar_job(True)
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Length", str(len(glb)))
            self.end_headers()
            self.wfile.write(glb)
        except Exception as exc:
            encerrar_job(False)
            traceback.print_exc()
            self._json(500, {"error": str(exc)})


def main():
    ap = argparse.ArgumentParser()
    # O `global` precisa vir antes de qualquer LEITURA do nome nesta funcao -
    # inclusive a que aparece como default do argumento abaixo.
    global PAINT_SUBFOLDER, USAR_OFFLOAD, PAINT_RES, VIEW_SIZE, VISTAS_EXTRA

    ap.add_argument("--port", type=int, default=8731)
    ap.add_argument("--model", default=DEFAULT_MODEL)
    ap.add_argument("--subfolder", default=DEFAULT_SUBFOLDER)
    # O turbo e destilado: rapido, um degrau abaixo. O nao-turbo
    # ("hunyuan3d-paint-v2-0") e bem mais lento e rende mais textura.
    ap.add_argument("--paint-subfolder", default=PAINT_SUBFOLDER)
    ap.add_argument("--no-offload", action="store_true")
    ap.add_argument("--paint-res", type=int, default=0)
    ap.add_argument("--view-size", type=int, default=0)
    ap.add_argument("--vistas-extra", action="store_true")
    args = ap.parse_args()

    PAINT_SUBFOLDER = args.paint_subfolder
    USAR_OFFLOAD = not args.no_offload
    PAINT_RES = args.paint_res
    VIEW_SIZE = args.view_size
    VISTAS_EXTRA = args.vistas_extra

    load_pipeline(args.model, args.subfolder)
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"[daemon] ouvindo em http://127.0.0.1:{args.port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    sys.exit(main())
