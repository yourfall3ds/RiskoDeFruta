"""Baixa os pesos do Hunyuan3D-2 COMPLETO (nao o mini), por pedido do usuario."""
import sys
from huggingface_hub import snapshot_download

repo = "tencent/Hunyuan3D-2"
# Forma (DiT) + pintura. Sem os .onnx do rembg, que ja vem pelo pacote.
patterns = ["hunyuan3d-dit-v2-0/*", "hunyuan3d-paint-v2-0/*", "*.json", "*.md"]
path = snapshot_download(repo_id=repo, allow_patterns=patterns, resume_download=True)
print("PESOS EM:", path)
