# Replace timed totems with fruit-juice chalices

Read docs/HARVEST_CHALICE_DESIGN.md. User explicitly changed objective: each fruit death sends juice into a chalice; fill it to complete marker. Current timer-based charge must go, no passive waiting progression. Generated image public/images/objectives/harvest-chalice-concept.png is the design reference (view it using file image tool if available). Need actual Blender-authored GLB chalice with separate vessel/metal/liquid, not runtime geometry placeholders. Blender 5.2 installed. Use leaf/brass/crystal design, roughness/glass readable outdoors, limited glass cost, broad enough silhouette. Editable .blend and reproducible script. Liquid level should rise, incoming juice arcs represent real credited deaths, completion pulse. Icon can use PNG in HUD.

Own: ExpeditionObjectives.ts, ExpeditionAnchors.ts, HarvestResonance.ts where necessary, ExpeditionSites.ts, new chalice/VFX modules/assets, CombatHUD/PlayerHUD objective copy, EnemySwarm death-event hook and PlayerScene integration. Don't touch CharacterVisual/Blender combos, terrain/rocks, weather, audio, CSS (Codex owns styles). Intro polish task must be finished before PlayerScene edits. Preserve all concurrent edits. No commit/stash/reset/push. No browser/Playwright/Puppeteer/UI; Codex handles browser.

Implementation requirements:
- Capture each REAL combat death exactly once with id/kind/position; despawn/recycle/cleanup/debugfinish not juice. A low-FPS frame with multiple kills must credit each, not just lastKill. Bounded event consumption, no memory growth, clear/reset/dispose lifecycle.
- Active chalice credits deaths nearby (roughly capture radius20-28m, state explicit) while player alive; no credit before activation; leaving preserves juice. Continuous local spawns/director stays on. Explain radius in UI plainly.
- Tunable per-species yields (common1, heavy3, optionalelite multiplier) and four finite targets; progression can continue regardless of one stuck enemy. Server/client consistent where co-op supports objectives. Don't silently make co-op fake if current mode doesn't support it, report exact scope.
- Ressonancia may multiply juice modestly, no leftover timer bonuses. No timer property naming/copy mistakes.
- Completion is idempotent; reward anchor is decisive death position, falls back valid nearby terrain. Don't pick arbitrary most recent kill later. HUD juice current/target/percent, prompt 'ATIVAR CÁLICE', route four chalices, death report still milestone count, menu updated.
- New image referenced from project; model loaded async safe, no white proxy. Safely handle first kill before VFXmodelready; logic independent of VFX. Perf bounded droplets/pools and material disposal.
- Tests: no passive progression, multi-kill batch, out-of-range/before activation/recycle ignored, exact once completion/anchor, reset, upgraded yield, no stale old UI time copy.

If need broader route distribution, keep first nearby and use distinct reachable districts for others once ground is available; avoid all four within100m. Don't sacrifice verified reachable route to force unstreamed location. Record pending limit honestly if routing cannot be safely changed in bounded task.

Write docs/CLAUDE_CHALICE_DELIVERY.md, focused tests/typecheck, render offline concept preview. Do not claim visually approved. Respect user's no-procedural-3d skill: proper Blender mesh authoring, no primitive stand-ins masquerading as asset by exporting.
