# Phase 5 integration: work in progress (not applied)

`phase5-integration-WIP.patch` is the partial work of the Phase 5 opt-in client integration agent. It was stopped on 2026-10-16 when the session was asked to find a stopping point.

**It is NOT applied and NOT verified.** It touches 24 files in `src/Renderer` (+282/−31 lines), adding an "observe only" flag to each record-emitting draw path (`SpriteRenderer`, the effect classes, `GR2ModelRenderer`, `AnimatedModels`). With that flag set, the record is still built but the legacy GL draw is skipped.

The rest of Phase 5 was not started or not saved when the agent stopped:

- the `GraphicsSettings.renderer` preference (`legacy` default / `webgl2` / `webgpu` / `auto`);
- the `RenderBackend` seam;
- forwarding `MAP_*` payloads to the backend;
- skipping legacy PostProcess when a backend is active;
- the canvas swap;
- the integration smoke.

To resume:

1. `git apply analysis/webgpu/wip/phase5-integration-WIP.patch`, or restart the task from scratch using the plan in `modernized/webgpu-reimagined/CLAUDE.md`.
2. Re-run the full root suite. All GL snapshot tests must stay byte-identical with the flag off.
3. Complete the remaining items above.
