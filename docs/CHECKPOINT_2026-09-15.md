# Session checkpoint

This checkpoint contains the current game implementation, runtime assets, tests and
implementation reports. It is not a declaration that every requested feature is complete.

Validation before push:
- Client and server TypeScript checks passed.
- Production build passed.
- Full suite: 785 passed, 6 failed. All six failures need unavailable original art
  sources (five enemy originals under `assets/`, and
  `art/processed/gunslinger-before-directional.glb`). Runtime GLBs are present.

Still incomplete: initial bridge rock replacement integration, final footstep blend
corrections, baked Blender combo integration, chalice objective integration, terrain
destruction and final gameplay/visual/performance review. CPU and DOM optimizations
are not proof that crowded gameplay FPS is resolved.

Heavy source art and local tools remain outside Git, following `.gitignore`.
The unrelated imported `Itens 3d/` source directory remains local and unchanged.
