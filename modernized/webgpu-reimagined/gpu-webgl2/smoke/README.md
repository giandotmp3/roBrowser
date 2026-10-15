# Sprite pixel parity: legacy SpriteRenderer vs gpu-webgl2

Phase 3a check (architecture §5, phase 3: "smoke goldens within tolerance; draw count measured").
The same synthetic frame is drawn twice in headless Chromium (WebGL2 on SwiftShader):

- **Legacy:** `src/Renderer/SpriteRenderer.js` (unmodified), driven through its normal static API.
  Each record sets `SpriteRenderer.image/position/offset/size/angle/color/shadow/zIndex/depth/xSize/ySize/ignoreDepthMinCap`,
  then calls `runWithDepth(depthTest, depthWrite, !depthCorrection, () => render(additive))`.
  This draws one `drawArrays` per layer, with per-frame `TEXTURE_2D` uploads made the way `Core/Client.js` makes them.
- **gpu-webgl2:** `RunRenderer` + `SpritePipeline` + `Residency`/`TextureArrayPools` draw the same records.
  This is one `drawArraysInstanced` per run, sampling texture-array pools.

Both canvases are read back with `readPixels` and compared channel by channel.

## Run it

```bash
cd modernized/webgpu-reimagined/gpu-webgl2
npm install --legacy-peer-deps   # vite + playwright devDependencies; or symlink an existing node_modules
npm run smoke:parity             # MSAA off (exact comparison)
npm run smoke:parity:aa          # MSAA on (production context attribute)
```

You need a Playwright Chromium. Set `PLAYWRIGHT_BROWSERS_PATH` to it; the script never runs `playwright install`.
`vite` also resolves from the repository root `node_modules`.

**Options** (`node smoke/run-parity.mjs …`):

| Option             | Meaning                                                                            |
| ------------------ | ---------------------------------------------------------------------------------- |
| `--aa`             | Turn MSAA on                                                                       |
| `--tol=N`          | Per-channel tolerance (default 2)                                                  |
| `--max-diff-pct=P` | Fail when more than P % of pixels exceed the tolerance (default 0)                 |
| `--out=dir`        | Write `legacy`/`modern`/`diff` PNGs per frame (default `smoke/.out/`, git-ignored) |

The exit code is 1 on failure. The run also fails if the **sensitivity control** shows no difference. The control nudges one record by 0.01 world units in the gpu-webgl2 stream only, so a silent comparison cannot pass.

## Files

| File                       | Role                                                                                                                                            |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `scene.js`                 | Seeded synthetic scene: the camera (pitch 50°, fovy 20°, zoom 30), fog, and 40 SpriteDraw records                                               |
| `parity.html`, `parity.js` | The page. It renders both paths and puts its stats on `window.__parity`                                                                         |
| `vite.config.js`           | Serves the package root, resolves the repo `src/` aliases read-only, and stubs `Renderer/Camera.js` for SpriteRenderer (zoom and latitude only) |
| `run-parity.mjs`           | Starts Vite, launches Chromium, prints the results, writes the PNGs                                                                             |

**What `scene.js` covers:**

- Frames: 9 POT frames (6 indexed, 3 RGBA) and 3 palettes. Every POT class from 32 to 256 is used, including a 16×32 frame in the 32 class and 64×128 / 128×64 frames that use part of a layer.
- Record variations:
    - mirrored, rotated, additive;
    - depth test or depth write off, depth correction off, `ignoreDepthMinCap`;
    - depth bias, shadow factor, tints and translucency;
    - xSize 4 and 20, a 1.15× halo, and a zero-alpha layer.
- Indices 1, 254 and 255 on purpose.

## Results (SwiftShader, 320×240)

| Frame        | Max channel diff | Pixels differing |    Legacy draws |         gpu-webgl2 draws |
| ------------ | ---------------: | ---------------: | --------------: | -----------------------: |
| no fog       |                0 |                0 | 39 `drawArrays` | 23 `drawArraysInstanced` |
| fog          |                0 |                0 |              39 |                       23 |
| no fog, MSAA |                0 |                0 |              39 |                       23 |
| fog, MSAA    |                0 |                0 |              39 |                       23 |

The sensitivity control shows about 600 differing pixels (max 58).

**Why 40 records give 39 legacy draws:** legacy skips the zero-alpha layer before drawing. gpu-webgl2 packs it, and the shader discards it.

**Why 23 runs:** the scene changes state on purpose (blend, depth flags, texture class), so the run count is high for its size. Same-state layers of consecutive entities merge into one run.

**Legacy behaviour reproduced, and worth flagging:** the palette lookup `texture(LUT, vec2(index/255, 1.0))` runs on a 256-wide `NEAREST` texture with the default `REPEAT` wrap. As a result, **index 255 shows palette entry 0**. The new shader reproduces this, and parity confirms it: a variant that looks up entry 255 differs on about 6.8 % of pixels. The bilinear palette step is also `1/uTextSize` with `uTextSize = 2 × frame size`, half a texel. Records may carry `paletteSize`; otherwise it defaults to 2× the frame size.
