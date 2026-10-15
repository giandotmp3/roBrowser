# Sprite pixel parity: legacy SpriteRenderer vs gpu-webgpu

This check covers architecture §5 phase 3 ("smoke goldens within tolerance; draw count measured") for the WebGPU backend.
Headless Chromium draws the same synthetic frame twice:

- **Legacy:** `src/Renderer/SpriteRenderer.js` (unmodified) draws into a WebGL2 canvas, through its normal static API.
  This is one `drawArrays` per layer, with per-frame `TEXTURE_2D` uploads made the way `Core/Client.js` makes them.
  This is the same driver as `gpu-webgl2/smoke/parity.js`, including the spec #64 palette compensation.
- **gpu-webgpu:** draws into a WebGPU canvas. `SpriteResidency`/`TextureArrayPools` (texture_2d_array per POT class plus the palette table, `queue.writeTexture`) and `SpriteRunRenderer` (`sprite.wgsl`, instance-step vertex buffer through `queue.writeBuffer`, census pipelines from `createRenderPipelineAsync`) draw one instanced draw per run into the `rgba8unorm` `OffscreenTarget`.
  `Blit` then copies the target to the `bgra8unorm` canvas.

The WebGPU canvas texture is read back with `copyTextureToBuffer` and `mapAsync`. The readback strips the 256-byte row padding, swizzles BGRA to RGBA, and flips rows to match `readPixels`, which returns bottom-up rows.
Alpha is compared as 255 on both sides. Both canvases are opaque (legacy `alpha:false`, WebGPU `alphaMode:'opaque'`), so stored alpha is never displayed.

## Run it

```bash
cd modernized/webgpu-reimagined/gpu-webgpu
npm install --legacy-peer-deps   # vite + playwright devDependencies; or symlink an existing node_modules
npm run smoke:parity             # MSAA off: offscreen target sampleCount 1, WebGL antialias false
npm run smoke:parity:aa          # MSAA on: 4x target + resolve, WebGL antialias true (gate 0.05 %)
```

You need a Playwright Chromium. Set `PLAYWRIGHT_BROWSERS_PATH` to it; the script never runs `playwright install`.

**Options** (`node smoke/run-parity.mjs …`):

| Option             | Meaning                                                                            |
| ------------------ | ---------------------------------------------------------------------------------- |
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

| File                              | Role                                                                                                       |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `scene.js`                        | Copy of `gpu-webgl2/smoke/scene.js`; keep the two identical. Camera, fog, 9 frames, 3 palettes, 40 records |
| `parity.html`, `parity.js`        | The page. It renders both paths and puts its stats on `window.__parity`                                    |
| `vite.config.js`, `cameraStub.js` | Serve the package root and resolve the legacy `src/` aliases read-only. `Renderer/Camera.js` is stubbed    |
| `run-parity.mjs`                  | Starts Vite, launches Chromium, prints the results, writes the PNGs, sets the exit code                    |

## Results (SwiftShader, 320×240, 40 records)

| Frame        | Max channel diff | Pixels differing |  Over tol 2 |    Legacy draws | gpu-webgpu draws |
| ------------ | ---------------: | ---------------: | ----------: | --------------: | ---------------: |
| no fog       |                1 |      7 (0.009 %) |           0 | 39 `drawArrays` |     23 instanced |
| fog          |                1 |     11 (0.014 %) |           0 |              39 |               23 |
| no fog, MSAA |               45 |     17 (0.022 %) | 9 (0.012 %) |              39 |               23 |
| fog, MSAA    |               39 |     564 (0.73 %) | 9 (0.012 %) |              39 |               23 |

**Controls:**

- Sensitivity: 615 px differ, max 58 (1155 px with MSAA).
- #64: 5242 px differ, max 194.

**Run and pipeline counts:** 23 runs, 0 normal-alpha fallbacks, 16 census pipelines.
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
