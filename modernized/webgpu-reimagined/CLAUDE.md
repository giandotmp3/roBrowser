# roBrowser WebGPU renderer: reimagined system context

This file is the persistent context for agents and engineers working on the WebGPU rebuild of roBrowser's renderer. **Load it first.**

## What this is

This is a rebuild of `src/Renderer/**`, the legacy WebGL2 renderer, from extracted intent; it is not a port.

| Document | Location |
|---|---|
| Spec (capabilities, domain model, interface contracts, NFRs, **143 behaviour rules**) | [`../../analysis/webgpu/AI_NATIVE_SPEC.md`](../../analysis/webgpu/AI_NATIVE_SPEC.md) |
| Approved architecture (revision 2, approved at HITL #2) | [`../../analysis/webgpu/REIMAGINED_ARCHITECTURE.md`](../../analysis/webgpu/REIMAGINED_ARCHITECTURE.md) |
| System-wide assessment | [`../../analysis/roBrowser/ASSESSMENT.md`](../../analysis/roBrowser/ASSESSMENT.md) |

**HITL decisions:**
- All 20 capabilities are P0.
- 11 flagged legacy bugs are **fixed**, not copied (spec §6).
- The GR2 one-frame lag is kept on purpose.
- C-19 is split: live previews render on the GPU; baked outputs stay on Canvas2D.

## Architecture in one paragraph

Rule logic emits **backend-neutral draw records** (`SpriteDraw`, `EffectDraw`, `WorldDraw`) in **exact legacy draw order**: entities sorted far→near, then each entity's layers, each with a `zIndex++` bias. Two backends consume the same record stream: **gpu-webgpu** (the target) and **gpu-webgl2** (the fallback, removed only when the §5 gates in the architecture pass). Backends draw the stream as **contiguous runs** and split a run only when pipeline state changes. They never regroup by state, because that would reorder translucent layers. Rules live in one place, so the record stream is also the deterministic, GPU-free test oracle.

## Modules

| Module | Responsibility | Spec capabilities |
|---|---|---|
| `scene/` | Legacy-compatible public API (`Renderer.tick/render/stop`, `MapRenderer`, `EntityManager`, `EffectManager.spam*`/`remove(ctor)` aliases, `Damage`, `Camera`, `ScreenEffectManager`, `SignboardManager`, `ItemObject`). Frame clock and UI scheduler, split from the GPU loop. Camera, Altitude/GAT, CPU picking, DOM overlay projection, culling and performance mode, `ViewerScene` for the asset viewers. CPU only | C-01 (API), C-02, C-12, C-13, C-15, C-18 |
| `render-records/` | Record types, `RecordStream`, the run splitter, the unified blend enum (STR D3D table + 2D/3D GL table). Entity layer composition (`EntityRender` stays a **mixin** applied with `.call`; AGENTS.md forbids inheritance). `EffectSystem` with `FUNC(params, ctx)` injection. Damage numbers, GR2 pose, animated RSM CPU matrices. Record-side flagged-bug fixes. No GPU | C-08, C-09, C-10, C-14, C-17 |
| `gpu-webgpu/` | WebGPU backend: device and device-loss rebuild (with a mid-session fallback to WebGL2), `rgba8unorm` 4× MSAA offscreen target + blit, pipelines precompiled from a blend-pair census, `texture_2d_array` residency per power-of-two size class + palette table, world, sprite runs, effects, GR2, post chain, live previews, capture. WGSL via `?raw` | C-01, C-03…07, C-11, C-14, C-16, C-17, C-19 (live), C-20 |
| `gpu-webgl2/` | WebGL2 fallback that consumes the same records with the same run batching. GLSL 300 es with a shared fog include. Handles context loss and restore (restore also rebuilds the map) | Same GPU-side capabilities as gpu-webgpu |
| `preview2d/` | Synchronous Canvas2D composer for baked outputs (cursor sheet via `toDataURL`, guild portrait via `getImageData`, item icons) plus the cursor animation driver | C-19 (baked), R-UI-005 |
| `test-harness/` | Seeded RNG and fake clock, legacy record shim around `SpriteRenderer.render`, record-diff oracle, a catalog of all 143 rules, 12-scene perceptual smoke goldens (Playwright + Chromium WebGPU on SwiftShader) | Verification |

**Ports:** every module takes its dependencies through `ports.js` / `createX(deps)` factories, so no module imports a sibling directly. The intended dependency direction is scene → render-records → backends, with preview2d consuming `SpriteDraw` records. The integration seams are the record shapes (`render-records/src/records/*`) and the harness subject interface (`test-harness/src/subject/SubjectPort.js`).

## How to run tests

Each module is a standalone package (Node ≥ 22, Vitest ^4.1.2):

```bash
cd modernized/webgpu-reimagined/<module>
npm install            # if npm's arborist errors ("reading 'edgesOut'"), use: npm install --legacy-peer-deps
npm test               # vitest run
```

**test-harness extras:**
- `npm run test:contract`
- `npm run test:acceptance`
- `npm run smoke` (Playwright)

**Harness configuration** comes from env placeholders in `test-harness/.env.example`. Copy it to `.env` locally; it holds no credentials.

| Variable | Meaning |
|---|---|
| `HARNESS_SUBJECT` | Which subject the acceptance suite drives |
| `HARNESS_SUBJECT_MODULE` | ES module exporting `createSubject({ rng, clock })` |
| `HARNESS_REFERENCE_MODULE` | Legacy shim adapter used as the parity reference |
| `HARNESS_SMOKE_URL` | Page exposing `window.__harness` |
| `HARNESS_ASSET_ROOT` | Local GRF asset root |
| `HARNESS_UPDATE_GOLDENS` | Set to `1` to regenerate goldens |

**Expected-failure tests:** unimplemented behaviour is `it.fails(...)` tagged with its rule ID, so a pending test that starts passing turns the suite red and forces you to promote it. In `test-harness`, move the rule ID into `IMPLEMENTED` in `src/rules/pending.js`.

**Results at scaffold time** (2026-10-15, Vitest 4.1.11):

| Module | Pass | Expected-fail (pending) | Skipped |
|---|---:|---:|---:|
| scene | 87 | 16 | 0 |
| render-records | 129 | 12 | 0 |
| gpu-webgpu | 128 | 8 | 0 |
| gpu-webgl2 | 192 | 3 | 0 |
| preview2d | 30 | 3 | 0 |
| test-harness | 34 | 143 (all rule tests, until a subject adapter exists) | 10 (parity, until reference and subject modules are set) |
| **Total** | **600** | **185** | **10** |

**Not yet validated:**
- WGSL has not been compiled; no GPU or WGSL compiler was available.
- GLSL is only checked with source assertions.
- No golden PNGs exist yet. Generate them on the pinned SwiftShader adapter.

## Legacy → modern traceability

Rule IDs are defined in spec §5. Legacy paths are relative to `src/`.

| Rule area | Legacy source | Modern owner(s) |
|---|---|---|
| R-CTX-001/002/005…007/009/010/012 (device, GL state, loss, clear colour, pass order, light) | `Renderer/Renderer.js`, `Utils/WebGL.js`, `Renderer/MapRenderer.js`, `Effects/Sky.js` | gpu-webgpu, gpu-webgl2 |
| R-CTX-003/004/008/011/013 (fps cap, frame order, sizing, map names, night) | `Renderer/Renderer.js`, `MapRenderer.js`, `ScreenEffectManager.js` | scene |
| R-CAM-* | `Renderer/Camera.js`, `Preferences/Camera.js` | scene |
| R-MAP-001…015, 018…022, 024 (ground, water, models, occluder fade, grid, clouds, magenta key) | `Renderer/Map/*`, `Loaders/Ground.js`, `Loaders/Model.js`, `Utils/Texture.js` | gpu-webgpu, gpu-webgl2 (shader side); render-records (R-MAP-010 water-alpha record fix) |
| R-MAP-016/017 (animated RSM timing and matrices) | `Renderer/Map/AnimatedModels.js` | render-records |
| R-MAP-023 (cell height) | `Renderer/Map/Altitude.js` | scene |
| R-SPR-001…033 (entity layers, tints, trails, attachments) | `Renderer/Entity/*`, `SpriteRenderer.js`, `EntityManager.js`, `ItemObject.js` | render-records (logic); backends (R-SPR-005/006/014/016 shader side) |
| R-SPR-034 (2D preview) | `SpriteRenderer.bind2DContext` | preview2d |
| R-EFX-001…007/011/012/015…017 (effect logic) | `EffectManager.js`, `Effects/*`, `DB/Effects/EffectTable.js` | render-records |
| R-EFX-008…010/013/014/018 (effect GPU state) | `Effects/StrEffect.*`, `Effects/*` | gpu-webgpu, gpu-webgl2 |
| R-DMG-* | `Effects/Damage.js` | render-records |
| R-PP-001…010/012 | `Effects/PostProcess.js`, `Effects/Shaders/*` | gpu-webgpu, gpu-webgl2 |
| R-PP-011 (Illusion flip; fix mirrors picking and overlays) | `ScreenEffectManager.js`, `Map/Altitude.js`, `SignboardManager.js` | scene (+ backends for the flip pass) |
| R-PICK-* | `Map/Altitude.js`, `EntityManager.js`, `Entity/EntityRender.js`, `GR2/GR2ModelRenderer.js` | scene |
| R-UI-001…004 | `Entity/Entity{Life,Display,Dialog,Cast,Room,Emblem}.js`, `SignboardManager.js` | scene |
| R-UI-005 (cursor) | `UI/CursorManager.js` | preview2d (CursorDriver) + scene (calls it) |
| R-PERF-001/002 | `EntityManager.js`, `EffectManager.js`, `PostProcess.js` | scene |
| R-PERF-003/004 (mipmaps, model batching) | `Utils/WebGL.js`, `Map/Models.js` | gpu-webgpu, gpu-webgl2 |
| R-GR2-001/002/006 | `GR2/GR2ModelRenderer.js`, `GR2/GR2Model.*` | gpu-webgpu, gpu-webgl2 |
| R-GR2-003…005 | `GR2/gr2Pack.js`, `GR2/actorAction.js` | render-records |
| GPU uploads outside the renderer (C-16) | `Core/Client.js:291-372`, `Core/MemoryManager.js:205-261` | gpu-webgpu / gpu-webgl2 residency |
| Map-loader worker (C-17) | `Loaders/MapLoader.js`, `Core/Thread.js`, `Core/ThreadEventHandler.js` | backends (`acceptMapMessage`), payload shapes unchanged, transferable |

## Integration decisions (resolved after scaffolding)

These were found at scaffold time and settled before phase 1.

1. **R-DMG-004 Miss/Lucky.** The record lives exactly as long as it is visible: **800 ms**. This is the legacy visible window with no invisible tail. render-records and the test-harness now assert the same thing.
2. **R-PP-004 vs smoke goldens.** The smoke spec passes `allowSoftwareAdapter: true` for the WebGPU backend, so the bloom golden renders on SwiftShader. The rule still holds in production.
3. **R-MAP-008/009 water frame.** Both backends use `frame = tick·60/1000`. It is exact on integer ticks; the legacy `tick/(1000/60)` dropped a frame at boundaries.
4. **Ownership:**
   - **R-UI-002 life bar:** scene owns it (DOM overlay). The render-records copy was removed.
   - **Cursor (R-UI-005):** preview2d's `CursorDriver` owns the bake, frame rate and hotspots. scene calls `render(tick)` and applies the returned style.
   - **R-MAP-010 / R-EFX-010:** the record field lives in render-records; the shader applies it in the backends.
5. **SpriteDraw units.** `size`/`offset` are **sprite pixels**, plus `xSize`/`ySize` (default 5), matching legacy `SpriteRenderer` and the legacy record shim. The 3D backends convert with `spriteToWorld` (render-records); preview2d uses the pixels directly.
6. **Copied record shapes in gpu-webgl2** stay, so the package builds on its own. `gpu-webgl2/test/contract/recordsDrift.test.js` fails as soon as they diverge from render-records.

## Still open

1. **Spec ambiguities that need an SME:**
   - the curve for the R-PP-006 fix (`fxaaSubpix`; scaffold: 0 = legacy result);
   - the R-MAP-022 cloud envelope;
   - the R-MAP-011 corner convention;
   - the R-UI-005 multiplier (legacy table kept; one `it.fails` pins the spec wording);
   - the R-SPR-007 zIndex list vs the appendix.
2. **gpu-webgl2 is not yet a working renderer.** Shader compilation, VAOs, the instance buffer, texture binding and post-processing framebuffers are still no-op ports.
3. **Tooling.**
   - `npm install` hits an npm arborist error in this container; use `--legacy-peer-deps`.
   - The root ESLint config needs `globals` installed.
   - The module files use LF line endings, but the repo's `.prettierrc` says CRLF.

## Rules for working here

- **Follow repo conventions** (`../../AGENTS.md`): ES modules, single quotes, semicolons, no trailing commas, `curly: all`, `const`/`let`. Do not touch `src/Vendors`.
- **Never reorder the record stream** for batching efficiency. Run breaks are the only batching mechanism.
- **Rule fixes go in render-records** or in a shared shader include, so both backends stay identical.
- **Configuration and credentials:**
  - The renderer has no secrets.
  - Harness settings are env-var names only (above), provisioned in a local `test-harness/.env` that is never committed.
  - The only new user setting is `GraphicsSettings.renderer = 'auto' | 'webgpu' | 'webgl'`.
- **Do not wire into `src/`** until delivery phase 2 of the architecture (§5): the record shim plus the legacy GL drawing records, with record-diff green.
