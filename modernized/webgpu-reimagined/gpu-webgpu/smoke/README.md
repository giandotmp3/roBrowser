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
npm run smoke:parity:entities:aa # the same with MSAA (gate 0.1 %, see below)
npm run smoke:parity:post        # legacy PostProcess chain vs gpu-webgpu PostChain, 26 configurations (gate 0.05 %)
npm run smoke:parity:effects     # real legacy STR / 3D / 2D effect classes (gate 0.05 %)
npm run smoke:parity:effects:aa  # the same with MSAA (0.05 % in ANGLE's raster orientation; native 0.75 %, see below)
npm run smoke:parity:effects2    # real legacy mesh effect classes (0.05 % in ANGLE's raster orientation; native 0.075 %)
npm run smoke:parity:effects2:aa # the same with MSAA (0.1 % in ANGLE's raster orientation; native 2.5 %, see below)
npm run smoke:parity:backend     # WebGpuBackend end to end (entities + effects + post) and a real device loss (gate 0.05 %; see below)
```

You need a Playwright Chromium. Set `PLAYWRIGHT_BROWSERS_PATH` to it; the script never runs `playwright install`.

**Options** (`node smoke/run-parity.mjs …`):

| Option             | Meaning                                                                                 |
| ------------------ | --------------------------------------------------------------------------------------- |
| `--page=P`         | `parity` (default), `entities`, `post`, `effects`, `effects2` or `backend`              |
| `--aa`             | Turn MSAA on                                                                            |
| `--tol=N`          | Per-channel tolerance (default 2)                                                       |
| `--max-diff-pct=P` | Fail when more than P % of pixels exceed the tolerance (default 0)                      |
| `--out=dir`        | Write `legacy`/`modern`/`diff` PNGs per frame (default `smoke/.out/`, git-ignored)      |
| `--isolate`        | Diagnostics: also draw each record alone and print its differing pixel count            |
| `--only=F`         | Diagnostics: `effects` keeps one class (`str`, `3d`, `2d`); `effects2` one mesh program |
| `--flags="…"`      | Replace the Chromium flags (space-separated)                                            |

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
| `post.html`, `post.js`            | The post-processing page (below)                                                                                                                                       |
| `effects.html`, `effects.js`      | The effect page (below); `vite.config.js` serves it the real `Renderer/Effects/StrEffect.js` (`REAL_FOR`), every other importer keeps the stub                         |
| `effects/`                        | Copies of `gpu-webgl2/smoke/effects/*` (`assets.js`: 26 images, 3 SPRs; `scene.js`: STR, 3D and 2D spawns); keep them identical                                        |
| `effects2.html`, `effects2.js`    | The mesh effect page (below); port of `gpu-webgl2/smoke/effects2.js`                                                                                                   |
| `effects2/`                       | `scene.js`: copy of `gpu-webgl2/smoke/effects2/scene.js` (keep identical); `assets.js`: its port (same 29 images, same four decodes)                                   |
| `backend.html`, `backend.js`      | The backend page (below): `WebGpuBackend` end to end plus a real device loss; `REAL_FOR` serves it the real `StrEffect.js` too                                         |
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

## Post-processing page (`--page=post`)

C-11, R-PP-001…012. One deterministic synthetic scene image (gradients, a rotated square and a circle for
diagonal edges, 1 px lines, an 8 px checkerboard, saturated R/G/B/Y patches, a black patch, grey noise and three
white spots above the 0.88 bloom threshold) is fed to both chains at the scene size, at 322×242 (odd on purpose:
the 0.75× scene and the 0.25×/0.125× bloom targets all floor).

- **Legacy:** the real `Effects/PostProcess.js` and `Effects/Shaders/*` (unmodified) on a WebGL2 canvas. The page
  registers the modules once in `MapRenderer.registerPostProcessModules` order, with its `detectBadWebGL` bloom
  guard. Then, per configuration, it calls `PostProcess.prepare`, draws the scene image texel for texel into whatever
  `prepare` bound (the RGB8 FBO, or the screen when nothing is active), and calls `PostProcess.render`.
  `GraphicsSettings` is the seam stub (`entities/stubs.js` `graphics`), `Camera.zoomFinal` comes from the camera stub,
  and Blind and VerticalFlip are switched with their own `setActive`.
- **gpu-webgpu:** `buildPostPasses` (`src/post/postPasses.js`) plus `PostChain` (`src/post/PostChainRenderer.js`),
  from an `rgba8unorm` scene texture holding the same image, into the `bgra8unorm` canvas.

The image is top-down on the WebGPU side and bottom-up (GL rows) on the legacy side, so both show the same picture.
The WGSL passes get every texel step with a negative y, so each tap is the mirror image of the legacy tap
(`shaders/post/common.wgsl`). RGB is compared; alpha is 255 on both sides.

**Gates:** each configuration must have at most 0.05 % of pixels over tolerance 2, unless it declares a `gatePct`.
Three configurations are not gated against legacy output:

- `fxaa default` runs the R-PP-006 fix (`fxaaSubpix` 0.25 drives the FXAA 3.11 subpixel term). It is gated against the
  CPU reference `src/post/fxaa.js`, evaluated with a double-precision bilinear clamp-to-edge sampler. Its distance
  from legacy is also printed, for information.
- `cas sharpening 0` (R-PP-007 fix) and `vibrance 0` (R-PP-009 fix) are compared with legacy run without that module.
  Legacy cannot express a value of 0 (`||` fallbacks); the fixed module is the identity.

A sensitivity control (WebGPU bloom intensity 0.5 against legacy 0.55) must differ.

**R-PP-004 on SwiftShader:** the legacy guard does **not** trigger here. Chrome reports `gl.VENDOR` as `WebKit` and
`gl.RENDERER` as `WebKit WebGL` (masked), so `detectBadWebGL` sees neither "swiftshader" nor "intel". Legacy
registers Bloom, and both bloom configurations compare WebGPU against real legacy bloom. `bloomSupported` is true for
the `google swiftshader` WebGPU adapter even without `allowSoftwareAdapter`, because the vendor is not Intel.

### Results (SwiftShader, 322×242, tolerance 2)

| Configuration                      | WebGPU passes (→ target)                         | Max diff | Differing |           Over tol 2 |
| ---------------------------------- | ------------------------------------------------ | -------: | --------: | -------------------: |
| none                               | Copy → swapchain                                 |        0 |         0 |                    0 |
| bloom                              | Bloom.prefilter → bloom 80×60, Bloom → swapchain |        1 |    1.81 % |                    0 |
| bloom intensity 1.5                | same                                             |        1 |    1.77 % |                    0 |
| blur                               | Blur                                             |        1 |    0.34 % |                    0 |
| blur area 30, intensity 6          | Blur                                             |        1 |    0.02 % |                    0 |
| fxaa subpix 0 (= legacy)           | FXAA                                             |        1 |    0.09 % |                    0 |
| fxaa threshold 0.063, subpix 0     | FXAA                                             |        1 |    0.09 % |                    0 |
| fxaa default (subpix 0.25), vs CPU | FXAA                                             |       18 |    0.20 % |              0.019 % |
| cas                                | CAS                                              |        1 |    0.04 % |                    0 |
| cas contrast 0.6, sharpening 0.5   | CAS                                              |        1 |    0.60 % |                    0 |
| cas sharpening 0 (fix)             | CAS (identity)                                   |        0 |         0 |                    0 |
| cartoon                            | Cartoon                                          |        1 |    0.03 % |                    0 |
| cartoon power 3, slope 1           | Cartoon                                          |        1 |    0.01 % |                    0 |
| vibrance / 0.8 / −0.5              | Vibrance                                         |        1 |  ≤ 0.12 % |                    0 |
| vibrance 0 (fix)                   | Vibrance (identity)                              |        0 |         0 |                    0 |
| vertical flip                      | VerticalFlip                                     |        0 |         0 |                    0 |
| blind, zoom 63 / 125 / 30          | Blind                                            |        1 |  ≤ 0.02 % |                    0 |
| performance mode                   | Upsampling (241×181 → 322×242)                   |        1 |    0.02 % |                    0 |
| performance + bloom                | prefilter → 30×22, Bloom → 241×181, Upsampling   |        1 |    0.35 % |                    0 |
| performance + fxaa, cas, cartoon   | 3 passes at 241×181, Upsampling                  |        2 |    0.39 % |                    0 |
| all on (+ illusion, blind zoom 90) | 9 passes, ping-pong, Blind → swapchain           |       24 |    1.51 % | 0.058 % (gate 0.1 %) |
| all on + performance               | 10 passes, Upsampling last                       |        2 |    0.64 % |                    0 |

- Legacy draw counts match the active-only pass list on every configuration (bloom counts 2 draws), except the two
  declared-fix configurations, where legacy runs without the module.
- The FXAA (informational) result for the default subpix against legacy is 2.6 % over tolerance, with a max of 77. That
  is the intended R-PP-006 divergence.
- The sensitivity control gives about 17.4k px differing, max 2. There are no WebGPU validation errors and no GL error.
- Every single-module configuration is within 1 level of legacy. The 1-level pixels are cross-API rounding (Tint/SPIR-V
  vs ANGLE on the same SwiftShader): `inverseSqrt`, divisions and bilinear weights round at unorm boundaries. Flipping
  the texel-y sign changes no legacy-path pixel (the legacy FXAA, CAS and cartoon taps are symmetric); only the FXAA 3.11
  tie-break (CPU-reference configuration, 15 → 14 px) depends on it.

### Gate for `all on` (0.1 %)

Only this configuration needs more than 0.05 %. It is 45 px (0.058 %). Its passes are Bloom, Blur, FXAA, CAS, Cartoon,
Vibrance, VerticalFlip and Blind, eight full-resolution passes in a row, each of which matches legacy to 1 level on its own.

Removing modules one at a time (diagnostic runs) showed two mechanisms:

- **Branch flips in FXAA.** A 1-level difference from an upstream pass flips FXAA's early exit or its `lumaB` range
  test on a few edge pixels. Blur + FXAA alone already gives a max of 24 (4 px over tolerance); without FXAA the max
  falls to 10.
- **Amplification by CAS and Cartoon.** Bloom leaves about 1.8 % of pixels 1 level off. CAS sharpening and the
  cartoon edge term amplify those differences to 2–5 levels. Without Bloom the result is 6 px (0.008 %); without Blur,
  44 px; without CAS, 30 px.

So no single pass diverges. The chain amplifies per-pass cross-API rounding. The same chain at 0.75× (`all on +
performance`, where texel steps stay canvas-sized as in legacy) is 0 px over tolerance. Raise the gate only with a new
analysis.

## Effect page (`--page=effects`)

The port of `gpu-webgl2/smoke/effects.js`, on the same scene (`effects/scene.js`, `effects/assets.js`: copies). The
**real legacy effect classes**, unmodified (`StrEffect.js`, `ThreeDEffect.js`, `TwoDEffect.js`, drawing through the real
`SpriteRenderer.js`, textures from the real `Utils/WebGL.texture` / `Utils/Texture.load`), play the scripted scene into
the WebGL2 canvas, one pass per class per tick (3D, STR, 2D) as `EffectManager.render` does. On five ticks each class's
`addRecordSink` captures every draw; `fromLegacyEffectRecord` (`src/effects/legacyRecord.js`) maps them to EffectDraws
(GL textures → residency handles, `null` blend → normal for #41/#49, STR `fog` = scene fog for R-EFX-010), and
`RunRenderer` (`src/batching/RunRenderer.js`) draws them into the WebGPU canvas in **one render pass, stream order**:

- **STR layers:** `StrPipeline` + `str.wgsl`, legacy `StrEffect.vs/.fs` operation for operation (same as gpu-webgl2
  `str.vert/.frag`): one 26-float instance per layer (`effects/strInstance.js`, byte-identical to gpu-webgl2), no
  per-vertex buffer (`vertex_index` picks the keyframe corner and the uv), `Project()` billboard, 1/35 px, `yLower`,
  clip-z bias −0.1 in GL clip space, then the GL → WebGPU depth remap `z' = (z + w)/2` as `sprite.wgsl` does. Clip y is
  up in both APIs and texel row 0 is the image's top row on both sides, so nothing is flipped.
- **2D/3D:** the sprite pipeline (`spriteEffectView` maps SpriteRenderer-shaped params; same `SpriteRunRenderer`).
- **Batches:** `batchKey` = run key + drawing program for effects (`effectProgram`, as gpu-webgl2), so a render-records
  run holding an STR layer and a 3D effect with equal state splits at the program change; never reordered.
  `encodeBatches` rebinds vertex buffers only on a program switch and sets bind group/pipeline only when they change.
- **Blend:** pairs map 1:1 onto `GPUBlendState`; all 13×13 factor pairs pass Dawn's pipeline validation. Constant
  factors read the legacy constant (0, 0, 0, 0): legacy never calls `blendColor`, and it is WebGPU's default at pass
  begin (`setBlendConstant` only if a pair needs another value; `blendConstantFor` splats alpha for CONSTANT_ALPHA).
  `resolveBlend` draws normal alpha for a `null`/unknown pair (#41/#49) and for a pair mixing constant colour with
  constant alpha (STR 14/15): WebGPU's single constant expresses it only for a splat constant, WebGL rejects it, so
  legacy keeps the previous blend; both backends draw normal alpha (gpu-webgl2 `isWebGLInvalidBlend`).
- **No destination alpha:** legacy draws into buffers without alpha (context `alpha: false`; the PostProcess FBO is
  `gl.RGB`), so DST_ALPHA reads 1 and SRC_ALPHA_SATURATE = min(As, 0) = 0. Scene pipelines therefore write RGB only
  (`SCENE_WRITE_MASK`, `PipelineSet.js`) and the target keeps its clear alpha 1. Before this, the D3D 7/8 and 11 pairs
  of `blends.str` gave ≈2.1k px over tolerance per frame.
- **Images:** residency uploads on miss through `decodeImageTexture` (`src/residency/imageTexture.js`, copy of
  gpu-webgl2's): magenta key on a `willReadFrequently` canvas, POT stretch on a second canvas, texels from a WebGL
  unpack of that canvas, top-left of an rgba8 layer, edge-replicated, sampled at uv × size/class (LINEAR). The page
  passes a **scratch WebGL2 context** for the unpack (`gl`), which makes the texels legacy's exactly. A WebGPU-only
  client has no GL context and falls back to `getImageData`, whose un-premultiply rounds differently in Chromium: 505
  channel values of 129 792 texels differ by one level (translucent texels only), reported by the texel check.

Declared divergences and kept-out cases are gpu-webgl2's (its README, "Effect parity"): R-EFX-010 (parity frames
with the STR fog off; the fog frame redrawn with it on must differ from legacy, and what the fog changes against the
STR-fog-off frame must lie inside the STR footprint; an isolated STR must match the CPU fog mix within 2 levels),
#41/#49 and STR 14/15 (normal alpha), the #47 leak and a missing STR file (kept out of the scene). The page also fails
on a skipped batch or a normal-alpha fallback (`RunRenderer.warm` compiles the stream's pipelines first).

### Results (SwiftShader, 640×480, tolerance 2)

| Frame         | Records (STR / 3D / 2D) | Max diff | Over tol 2 (MSAA off) | Over tol 2, MSAA, ANGLE orientation | Over tol 2, MSAA, native | Legacy draws | gpu-webgpu draws |
| ------------- | ----------------------: | -------: | --------------------: | ----------------------------------: | -----------------------: | -----------: | ---------------: |
| t = 1040 ms   |       52 (14 / 25 / 13) |       36 |          20 (0.007 %) |                         3 (0.001 %) |           1401 (0.456 %) |           52 |       31 (1.68×) |
| t = 1200 ms   |       65 (17 / 30 / 18) |       58 |          44 (0.014 %) |                        69 (0.023 %) |           1840 (0.599 %) |           65 |       45 (1.44×) |
| t = 1300, fog |       72 (16 / 35 / 21) |       52 |          44 (0.014 %) |                        70 (0.023 %) |           1493 (0.486 %) |           72 |       51 (1.41×) |
| t = 1400 ms   |       79 (16 / 38 / 25) |       60 |          44 (0.014 %) |                        69 (0.023 %) |           1351 (0.440 %) |           79 |       57 (1.39×) |
| t = 1560 ms   |        65 (7 / 35 / 23) |       68 |           6 (0.002 %) |                         2 (0.001 %) |            851 (0.277 %) |           65 |       38 (1.71×) |

- Same draw counts as gpu-webgl2 (equal batch boundaries); 46 pipelines compiled, 0 fallbacks, 0 skipped batches, no
  WebGPU validation error, no GL error.
- STR alone (`--only=str`, MSAA off): max diff 1, 0 px over tolerance on all five frames.
- Texels: 26 images, 129 792 texels, 0 differ (WebGL unpack).
- Fog frame, STR fog on: 47 586 px differ from legacy; the STR fog changes 47 585 px, 0 outside the STR footprint
  (57 581 px). CPU fog mix: f = 0.3167, 15 600 interior px (2-px erosion), max error 0.84 levels (MSAA: ANGLE
  orientation, 0.86).
- Sensitivity controls (0.01 world units, gpu-webgpu side only): an STR layer ≈14.7k px, a 3D record 32 px (MSAA:
  15.9k and 1.6k).

**Residual without MSAA** (≤ 44 px): 2D only (`--only=2d` gives the same 20/43/44/43/6). At t = 1200 the 43 px are one
5×17 px strip where two depth-writing, depth-corrected 2D quads (`effect/c.tga`, blend modes 4 and 5) overlap;
removing either record from the stream changes the strip and nothing else. Their centres differ by a vector at 25.00°,
the camera yaw, so both lie in one depth-correction plane: their depths tie, and `less-equal` resolves the tie per pixel
on sub-ulp differences between the ANGLE and Tint depth paths (rows alternate between the two quads). Changing the
WebGPU depth-remap arithmetic does not remove it. Same class as the entity page's depth ties.

### Gate for `smoke:parity:effects:aa`

With MSAA every frame is compared twice:

- **ANGLE raster orientation** (`<frame>-angle-orientation`, gate 0.05 %): the same records drawn with a y-flipped
  projection (`F·P`, `F = diag(1, −1, 1, 1)`; depth and fog unchanged) and read back top-down. ≤ 0.023 %.
- **Native orientation** (declared gate **0.75 %**, `NATIVE_AA_GATE_PCT` in `effects.js`): ≤ 0.599 %.

The native residual sits on triangle edges that are not axis-aligned (see `effects-*-diff-aa.png`): STR quads are
rotated, and STR keyframe quads with corners 0, 1, 3, 2 against the strip uv split into overlapping triangles whose
shared edges are diagonals inside the effect. ANGLE draws a WebGL default framebuffer upside down, which mirrors the
standard 4× sample pattern relative to the scene. Mirroring keeps the set of x and the set of y sample offsets, so
horizontal and vertical edges (sprites, entities) resolve the same coverage; diagonal edges do not. Drawing the WebGPU
frame upside down, as ANGLE does, removes it (0.6 % → 0.023 %; the CPU fog check, which crosses such an internal
diagonal, goes from 34 to 0.86 levels), so the CPU fog check runs in that orientation under MSAA. Production keeps
WebGPU's native orientation: a y-flipped scene target would have to be flipped back by the blit and the post chain, and
the difference is a sub-pixel coverage step on antialiased diagonal edges. Raise the native gate only with a new
analysis.

## Mesh effect page (`--page=effects2`)

The port of `gpu-webgl2/smoke/effects2.js` on the same scene (`effects2/scene.js`, a copy) and images. The **real legacy
classes**, unmodified (`Cylinder`, `QuadHorn`, `RsmEffect`, `GroundAura`, `SwirlingAura`, `Level99Bubble`,
`SpiritSphere`, `WarlockSphere`, `Tiles`, `LPEffect`, `SpiderWeb`, `FlatColorTile`, `PropertyGround`, `MagicRing`,
`LockOnTarget`, `MagicTarget`, `RainWeather` puddles, `WaterfallEffect`), play the scripted scene into the WebGL2 canvas;
each class's `addRecordSink` captures the five frames; `fromLegacyEffectRecord` adds the magic-target ground plane and
the puddles' camera position (what the native records lack, as in gpu-webgl2); `RunRenderer` draws them in one render
pass, stream order. Seams as gpu-webgl2: `vite.config.js` also stubs `Renderer/MapRenderer.js` and `Loaders/Model.js`.

- **Programs** (`src/effects/mesh/`): gpu-webgl2's table, 20 record families → 15 programs (`meshFamilies.js`), the
  same per-record packing (`programs.js`, byte-identical floats, copied) and the legacy shader pairs operation for
  operation in WGSL (`src/shaders/effects/*.wgsl` + `common.wgsl`: pass block, sampler, the five rgba8 pools,
  `effect_texture`, the legacy effect fog `mix(c, vec4(fogColor, c.a), f)` keyed on each record's flag). Every program
  stays in GL clip space through the legacy clip-z biases and remaps once, `z' = (z + w)/2`, as `sprite.wgsl`.
- **Draws** (`MeshEffectPipeline`): instanced programs set the cached static mesh (one GPU buffer per mesh key) on slot 0
  and the batch's records on slot 1 (waterfall: records on slot 0, `vertex_index` corners) and draw `(meshCount,
records)`; stream programs (RSM, swirling band, bubble quads, magic-target planes) draw the batch's vertices. All
  batches of a frame are one ring write; `encodeBatches` calls the program's `drawBatch` with its staged descriptor.
- **Wrap**: the batch key holds program, wrap and static mesh (`effectProgram`, same keys as gpu-webgl2); the bind
  group of a batch carries its sampler (clamp, repeat, or repeat-u for `repeatTextureX` cylinders), same pools.
- **Pipelines**: one family per program (`mesh-<id>`), topology per program, record blend/depth, RGB-only writes;
  census = normal alpha × depth write on/off per program; `RunRenderer.warm` compiles the rest (53 in this scene).
- **Textures**: `decodeTileTexture` / `decodeSelfDrawnTexture` copied into `src/residency/imageTexture.js`; the texel
  check reads back every legacy texture the records use: 81 textures, 337 408 texels, 0 differ.

### Results (SwiftShader, 640×480, tolerance 2)

| Frame         | Records | Over tol, native | ANGLE orientation |   MSAA native | MSAA, ANGLE orientation | Legacy / gpu-webgpu draws |
| ------------- | ------: | ---------------: | ----------------: | ------------: | ----------------------: | ------------------------: |
| t = 480 ms    |     221 |     77 (0.025 %) |       4 (0.001 %) | 4062 (1.32 %) |            10 (0.003 %) |           221 / 41 (5.4×) |
| t = 1200 ms   |     226 |    122 (0.040 %) |      54 (0.018 %) | 5496 (1.79 %) |           131 (0.043 %) |           226 / 41 (5.5×) |
| t = 2000, fog |     224 |    165 (0.054 %) |     114 (0.037 %) | 4907 (1.60 %) |           224 (0.073 %) |           224 / 38 (5.9×) |
| t = 2800 ms   |     221 |     94 (0.031 %) |      24 (0.008 %) | 5500 (1.79 %) |            34 (0.011 %) |           221 / 37 (6.0×) |
| t = 4400 ms   |     209 |     43 (0.014 %) |      17 (0.006 %) | 5020 (1.63 %) |            29 (0.009 %) |           209 / 25 (8.4×) |

- Same draw counts as gpu-webgl2 (equal batch boundaries); 0 fallbacks, 0 skipped batches, no WebGPU or GL error,
  every program drawn. Fog control: 132 records fogged, ≈167k px differ with fog off. Sensitivity controls (0.01
  units): cylinder ≈3.3k px, RSM ≈2.5k px, LP tile ≈1.9k px.

### Gates for effects2

Every frame is drawn twice: in WebGPU's native orientation (production) and in ANGLE's raster orientation (y-flipped
projection, rows read top-down, `-angle-orientation`, the script's `--max-diff-pct`).

- **ANGLE orientation: 0.05 % without MSAA (≤ 0.037 %), 0.1 % with MSAA (≤ 0.073 %).** What is left is z-fighting the
  scene has in legacy too: overlapping ground tiles lie in one plane and write depth, so `less-equal` picks the
  winner per pixel on sub-ulp depth differences (row-alternating stripes on both sides, different stripes).
  `--only=tile` gives 0 / 49 / 110 / 15 / 10 px in both orientations. Changing the remap (`z·½ + w·½`,
  `(z/w·½ + ½)·w`), the product order (`P·(MV·p)`) or the depth format (`depth32float` = `depth24plus` here) does not
  remove it; under MSAA it is evaluated per sample, hence the 0.1 % gate (precedent: `entities:aa`).
- **Native without MSAA: declared 0.075 %** (`NATIVE_GATE_PCT`, ≤ 0.054 %). ANGLE draws a WebGL default framebuffer
  upside down, which turns the top-left fill rule into a bottom-left one: edges through pixel centres (the waterfall
  curtains' shared horizontal edges, the magic-target plane cells) go to the other row. Flipping removes it
  (165 → 114 px on the fog frame).
- **Native with MSAA: declared 2.5 %** (`NATIVE_AA_GATE_PCT`, ≤ 1.79 %): the mirrored 4× sample pattern of the
  effects page (`effects:aa`), on every non-axis-aligned edge, and here nearly every edge is one.

Raise a gate only with a new analysis.

## Backend page (`--page=backend`)

`WebGpuBackend` (`src/WebGpuBackend.js`) end to end against legacy rendering the same frame, 640×480, MSAA off (the legacy
page canvas and the PostProcess FBO have none).

- **Legacy**, per 40 ms frame as `MapRenderer` does: R-CTX-002 state and the sky clear colour, `PostProcess.prepare`
  (scene FBO when a module is active, else the screen), the real entity path (the entities page scene, ~200 entities),
  the real `ThreeDEffect` / `StrEffect` / `TwoDEffect` classes (22 effects-page spawns that follow no owner, moved into
  the entity area), then `PostProcess.render` with the real modules registered in `MapRenderer` order.
- **gpu-webgpu**: the captured records as one R-CTX-010 stream (`{entitiesNonEffect, effectsAfterEntities}`) into
  `backend.drawFrame(stream, frame)`: one scene pass through `RunRenderer`, then `PostChain` or the blit, read back with
  `backend.capture()` (C-20, the swapchain texture copied in the frame's encoder). The `graphics` seam stub is both
  sides' GraphicsSettings (the backend's `SettingsPort`), so the same post modules run; every other port is recorded.
  Both asset sets build `data/sprite/shadow`; the entity one is kept. STR fog is off (R-EFX-010, declared).
- **Device loss**: after the blit frame the page calls `backend.device.destroy()` (resolves `device.lost` with
  `'destroyed'`). Checks: overlay shown with the R-CTX-006 spec, `.bmp/.jpg/.png/.spr/.pal/.str` purged, residency
  emptied, `drawFrame` refused while lost; rebuilt on a new device (no fallback), overlay hidden after it,
  `setMap(currentMap)` re-run; the blit frame redrawn first on the new device re-uploads every texture and equals the
  pre-loss gpu-webgpu frame pixel for pixel (and legacy within the gate); the next post-chain frame matches as before.
- Also fails on an unsupported record, a normal-alpha fallback, a skipped batch, a WebGPU error or a render error.

### Results (SwiftShader, 640×480, tolerance 2)

| Frame                        | Post (gpu-webgpu)            | Over tol 2, depth24plus (production) | Over tol 2, depth16unorm |
| ---------------------------- | ---------------------------- | -----------------------------------: | -----------------------: |
| t = 1080                     | Bloom + FXAA + Vibrance      |             2239 (0.729 %), gate 1 % |            136 (0.044 %) |
| t = 1160, fog                | Bloom + FXAA + Vibrance      |             1963 (0.639 %), gate 1 % |            123 (0.040 %) |
| t = 1200, performance mode   | Bloom + Upsampling (480×360) |             1297 (0.422 %), gate 1 % |             71 (0.023 %) |
| t = 1240                     | blit                         |                         28 (0.009 %) |                        — |
| t = 1240, redrawn after loss | blit                         |       28 (0.009 %), 0 px vs pre-loss |                        — |
| t = 1320, after loss         | Bloom + FXAA + Vibrance      |             2197 (0.715 %), gate 1 % |            130 (0.042 %) |

- 980–985 records per frame (954 entity layers, 26–31 STR/3D/2D); legacy ≈ 984–989 `drawArrays` vs 307–312
  instanced draws; 0 fallbacks, 0 unsupported records, no WebGPU or GL error. Sensitivity control ≈ 4.4k px.
- After the loss: 101 uploads on miss, ports `assets.purge → overlay.show → overlay.hide → scene.setMap`.

### Gate for post-chain frames (declared 1 %, `FBO_DEPTH_GATE_PCT`)

With a module active, legacy draws the scene into its PostProcess FBO, whose depth renderbuffer is
`DEPTH_COMPONENT16` (`PostProcess.createFramebuffer`); without one it draws into the default framebuffer (24 bits).
The zIndex bias separates an entity's stacked layers by about 1e-6 of window depth, below 16-bit resolution
(1.5e-5), so in the FBO coincident layers tie and `LEQUAL` resolves them by draw order. The diff images show the
depth-tie signature of the entities page (short horizontal runs inside entities). gpu-webgpu keeps depth24plus
whether post is on or off. The page draws every post-chain frame a second time on a second backend whose scene
target is `depth16unorm` (`depthFormat` port): 0.023–0.044 %, under the page gate. The blit frame, where legacy has
24 bits too, is 0.009 % in production. Raise the gate only with a new analysis.
