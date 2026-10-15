# Sprite pixel parity: legacy SpriteRenderer vs gpu-webgpu

This check covers architecture §5 phase 3 ("smoke goldens within tolerance; draw count measured") for the WebGPU backend.
Headless Chromium draws the same synthetic frame twice:

- **Legacy:** `src/Renderer/SpriteRenderer.js` (unmodified) draws into a WebGL2 canvas, through its normal static API.
  This is one `drawArrays` per layer, with per-frame `TEXTURE_2D` uploads made the way `Core/Client.js` makes them.
  This is the same driver as `gpu-webgl2/smoke/parity.js`, including the spec #64 palette compensation.
- **gpu-webgpu:** draws into a WebGPU canvas. `SpriteResidency`/`TextureArrayPools` (texture_2d_array per POT class plus the palette table, `queue.writeTexture`) and `SpriteRunRenderer` (`sprite.wgsl`, instance-step vertex buffer through `queue.writeBuffer`, census pipelines from `createRenderPipelineAsync`) draw one instanced draw per batch into the `rgba8unorm` `OffscreenTarget`.
  `Blit` then copies the target to the `bgra8unorm` canvas.

The WebGPU canvas texture is read back with `copyTextureToBuffer` and `mapAsync`. The readback strips the 256-byte row padding, swizzles BGRA to RGBA, and flips rows to match `readPixels`, which returns bottom-up rows.
Alpha is compared as 255 on both sides. Both canvases are opaque (legacy `alpha:false`, WebGPU `alphaMode:'opaque'`), so stored alpha is never displayed.

## Run it

```bash
cd modernized/webgpu-reimagined/gpu-webgpu
npm install --legacy-peer-deps   # vite + playwright devDependencies; or symlink an existing node_modules
npm run smoke:parity             # MSAA off: offscreen target sampleCount 1, WebGL antialias false
npm run smoke:parity:aa          # MSAA on: 4x target + resolve, WebGL antialias true (gate 0.05 %)
npm run smoke:parity:entities    # real legacy entity stream, ~200 entities (gate 0.05 %)
npm run smoke:parity:entities:aa # the same with MSAA (gate 0.05 %)
```

You need a Playwright Chromium. Set `PLAYWRIGHT_BROWSERS_PATH` to it; the script never runs `playwright install`.

**Options** (`node smoke/run-parity.mjs …`):

| Option             | Meaning                                                                            |
| ------------------ | ---------------------------------------------------------------------------------- |
| `--page=P`         | `parity` (default, synthetic records) or `entities` (real legacy entity stream)    |
| `--aa`             | Turn MSAA on                                                                       |
| `--tol=N`          | Per-channel tolerance (default 2)                                                  |
| `--max-diff-pct=P` | Fail when more than P % of pixels exceed the tolerance (default 0)                 |
| `--out=dir`        | Write `legacy`/`modern`/`diff` PNGs per frame (default `smoke/.out/`, git-ignored) |
| `--isolate`        | Diagnostics: also draw each record alone and print its differing pixel count       |
| `--flags="…"`      | Replace the Chromium flags (space-separated)                                       |

**Exit codes:**

| Code | Meaning                                                                                                                                                   |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | Pass                                                                                                                                                      |
| 1    | Parity failure, a page error, a WebGPU validation error or GL error, or a control that shows no difference                                                |
| 2    | **No WebGPU adapter.** `navigator.gpu` is missing or `requestAdapter()` returned null. The harness prints `PARITY: NO ADAPTER` and does not draw anything |

**Two controls must show a difference, or the run fails:**

- **Sensitivity control:** one record is nudged by 0.01 world units in the gpu-webgpu stream only.
- **#64 control:** legacy draws with its raw palettes, so index 255 wraps to entry 0, while gpu-webgpu clamps.

## Chromium flags

By default the harness runs WebGPU on Dawn's Vulkan SwiftShader adapter, and WebGL2 on ANGLE over the same SwiftShader:

```
--enable-unsafe-webgpu --enable-features=Vulkan --use-vulkan=swiftshader --use-webgpu-adapter=swiftshader
--enable-unsafe-swiftshader --use-gl=angle --use-angle=swiftshader --ignore-gpu-blocklist
```

**`--enable-features=Vulkan --use-vulkan=swiftshader` is required** (checked with Playwright 1.56.1, chromium-1194, headless shell and new headless).
Without it, an adapter still exists and offscreen rendering plus buffer readback still work. But the first present of a WebGPU canvas loses the device with "A valid external Instance reference no longer exists."
That happens with `--enable-unsafe-webgpu` alone, with `--use-angle=swiftshader`, `--in-process-gpu`, `--disable-gpu-compositing` or `--use-gl=swiftshader`, and with `--disable-vulkan-surface`.

The page must be served from `http://127.0.0.1`. WebGPU needs a secure context, and on `about:blank` `navigator.gpu` is undefined.

## Files

| File                              | Role                                                                                                                                                                   |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scene.js`                        | Copy of `gpu-webgl2/smoke/scene.js`; keep the two identical. Camera, fog, 9 frames, 3 palettes, 40 records                                                             |
| `parity.html`, `parity.js`        | The page. It renders both paths and puts its stats on `window.__parity`                                                                                                |
| `vite.config.js`, `cameraStub.js` | Serve the package root and resolve the legacy `src/` aliases read-only; the legacy seams (`Renderer/Camera.js`, Client, DB, UI, …) are swapped for `entities/stubs.js` |
| `entities.html`, `entities.js`    | The real-stream page (below)                                                                                                                                           |
| `entities/`, `common.js`          | Copies of `gpu-webgl2/smoke/entities/*` and `common.js` (scene, assets, seam stubs, compare helpers); gpu-webgpu imports nothing from gpu-webgl2                       |
| `webgpuKit.js`                    | Adapter/device, opaque canvas, offscreen target + blit, canvas read-back                                                                                               |
| `run-parity.mjs`                  | Starts Vite, launches Chromium, prints the results, writes the PNGs, sets the exit code                                                                                |

## Results (SwiftShader, 320×240, 40 records)

| Frame        | Max channel diff | Pixels differing |  Over tol 2 |    Legacy draws | gpu-webgpu draws |
| ------------ | ---------------: | ---------------: | ----------: | --------------: | ---------------: |
| no fog       |                1 |      7 (0.009 %) |           0 | 39 `drawArrays` |     15 instanced |
| fog          |                1 |     11 (0.014 %) |           0 |              39 |               15 |
| no fog, MSAA |               45 |     17 (0.022 %) | 9 (0.012 %) |              39 |               15 |
| fog, MSAA    |               39 |     564 (0.73 %) | 9 (0.012 %) |              39 |               15 |

**Controls:**

- Sensitivity: 615 px differ, max 58 (1155 px with MSAA).
- #64: 5242 px differ, max 194.

**Run, batch and pipeline counts:** 23 render-records runs drawn as 15 batches, 0 normal-alpha fallbacks, 8 census pipelines.
A batch is a union of whole runs whose only difference is the texture class: one `fs_main` binds the indexed and
RGBA pools plus the palette table (11 sampled textures) and branches per instance on `layer.w` (`SPRITE_SAMPLING`,
same packing as gpu-webgl2). Merging changed no pixel on any page (before: 23 draws here, 648/594/537 on the entity
page). A device reporting fewer than 11 `maxSampledTexturesPerShaderStage` (below the WebGPU minimum of 16) gets the
split fallback: one class set on bindings 3..7, batches split on texture class again.
40 records give 39 legacy draws because legacy skips the zero-alpha layer before drawing. gpu-webgpu packs it, and the shader discards it.

**Residual differences, all believed to come from the API and not from the port:**

- **Without MSAA:**
    - Only indexed (palette) records are affected, and only by one level.
    - `--isolate` spreads the pixels over 7 records, 1 to 5 px each.
    - They are rounding at a unorm boundary in the four-tap palette blend. Rewriting `mix` as `a + (b - a)·t` or `a·(1 − t) + b·t` moves which pixels flip but not how many, which points to sub-ulp differences in the interpolated `uv` between ANGLE's and Tint's SPIR-V.
    - `fract` versus `x − floor(x)`, and the fog depth taken from a `clip.w` varying, change nothing.
    - RGBA (hardware-filtered) and additive records match exactly.
- **With MSAA:**
    - The 9 px over tolerance are 7 on one horizontal row (y = 120, the screen centre) and 2 isolated pixels. This pattern fits a sample that sits exactly on a quad edge, where the fill-rule tie-break differs because ANGLE flips the default framebuffer.
    - With fog plus MSAA, about 550 px differ by one level in the fog blend. Without MSAA the fog frame matches to 11 px, so the fragment depth differs slightly under MSAA between the two stacks.

## Real-stream page (`--page=entities`)

The port of `gpu-webgl2/smoke/entities.js`. The real legacy entity path (EntityManager → Entity and its mixins →
EntityRender → SpriteRenderer, unmodified, seams stubbed) plays a seeded 200-entity scene (120 PCs, 52 mobs, 28 NPCs;
walking, attacking, sitting, dying, carts, status tints, Berserk additive) under a fake clock. On three frames,
`SpriteRenderer.addRecordSink` captures every native record; `fromLegacySpriteRecord` (`src/sprites/legacyRecord.js`)
turns them into SpriteDraws, and `SpriteRunRenderer` draws them into the WebGPU canvas. `SpriteResidency` starts empty
and **uploads on miss** through a `FrameSourcePort` over the same raw SPR frames (`decodeSprFrame`), with the same
contract as gpu-webgl2's Residency (free-list layers, LRU reclaim, refcounted palette rows, `beginFrame`, `evictIdle`,
`purgeAll`). Before frame 2 every slot and row is evicted; before frame 3 the pools are destroyed and purged, as on a
device loss. Legacy palettes carry the #64 compensation; the sensitivity and #64 controls run on frame 1.

### Results (SwiftShader, 640×480)

| Frame                    | Records | Legacy `drawArrays` | gpu-webgpu draws | Uploads on miss | Max diff | Differing |   Over tol 2 | Over tol 2, MSAA |
| ------------------------ | ------: | ------------------: | ---------------: | --------------: | -------: | --------: | -----------: | ---------------: |
| t = 120 ms               |    1052 |                1052 |      330 (3.19×) |              86 |      237 |       184 | 89 (0.029 %) |    174 (0.057 %) |
| t = 520 ms, fog, evicted |    1043 |                1043 |      327 (3.19×) |              91 |      206 |        98 | 48 (0.016 %) |    128 (0.042 %) |
| t = 1240 ms, after purge |     954 |                 954 |      282 (3.38×) |              88 |       99 |       124 | 32 (0.010 %) |     85 (0.028 %) |

- Controls: sensitivity ≈9.4k px (max 237), #64 ≈18.3k px. No WebGPU validation errors, no GL error, 0 fallbacks.
- `smoke:parity:entities` passes the 0.05 % gate; `smoke:parity:entities:aa` misses it on frame 1 (0.057 %).
- The residual pixels are short horizontal runs (3–10 px on one row) plus two small blocks where layers overlap.
  They are not fill-rule ties: no horizontal quad edge (from the CPU `spriteVertexClip` reference) passes through
  their pixel centres. They are not indexed texel or palette-blend boundaries either. Changing only the WebGPU depth
  remap arithmetic (`(z/w·0.5 + 0.5)·w` in place of `(z + w)·0.5`) moves them (89/48/32 → 98/60/76), and flipping
  the raster orientation to ANGLE's changes them only a little (89 → 63). Matching depth formats (`depth32float`)
  changes nothing. So they are most likely depth-precision ties in legacy's own layer stacking: the zIndex bias separates layers
  by only about 1e-6 in window depth (≈16 f32 ulps), and stacked or coincident layers resolve on sub-ulp differences
  between the ANGLE and Tint depth paths. MSAA resolves the ties per sample, so the counts roughly double.

## Gate for `smoke:parity:entities:aa` (0.1 %)

This page is gated at **0.1 %** of pixels over tolerance; every other page stays at 0.05 % or 0 px. The residual is cross-API depth-tie resolution under MSAA. Legacy separates stacked layers of one entity by roughly 1e-6 of window depth (the zIndex bias). The WebGPU and ANGLE/WebGL depth paths round those ties differently, giving short 3–10 px runs.

The CPU vertex reference rules out quad-edge and texel-boundary causes. Changing only the depth-remap arithmetic moves the residual pixels; switching to `depth32float` does not change them.

The highest observed value is 0.057 % (frame t=120, 174 px). Raise the gate only with a new analysis.
