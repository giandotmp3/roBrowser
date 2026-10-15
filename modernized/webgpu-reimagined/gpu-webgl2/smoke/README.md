# Sprite pixel parity: legacy SpriteRenderer vs gpu-webgl2

Two pages: the phase 3a synthetic record page (`parity`, below) and the phase 3b real-stream entity page
(`entities`, see [Real-stream parity](#real-stream-parity-the-legacy-entity-path-200-entities)).

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
npm run smoke:parity:entities    # real legacy entity stream, ~200 entities (phase 3b)
npm run smoke:parity:entities:aa # the same with MSAA
```

You need a Playwright Chromium. Set `PLAYWRIGHT_BROWSERS_PATH` to it; the script never runs `playwright install`.
`vite` also resolves from the repository root `node_modules`.

**Options** (`node smoke/run-parity.mjs …`):

| Option             | Meaning                                                                            |
| ------------------ | ---------------------------------------------------------------------------------- |
| `--page=P`         | `parity` (default, phase 3a) or `entities` (phase 3b)                              |
| `--aa`             | Turn MSAA on                                                                       |
| `--tol=N`          | Per-channel tolerance (default 2)                                                  |
| `--max-diff-pct=P` | Fail when more than P % of pixels exceed the tolerance (default 0)                 |
| `--out=dir`        | Write `legacy`/`modern`/`diff` PNGs per frame (default `smoke/.out/`, git-ignored) |

The exit code is 1 on failure. The run also fails if the **sensitivity control** shows no difference. The control nudges one record by 0.01 world units in the gpu-webgl2 stream only, so a silent comparison cannot pass.

## Files

| File                           | Role                                                                                                                            |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `scene.js`                     | Seeded synthetic scene: the camera (pitch 50°, fovy 20°, zoom 30), fog, and 40 SpriteDraw records                               |
| `parity.html`, `parity.js`     | The phase 3a page. It renders both paths and puts its stats on `window.__parity`                                                |
| `entities.html`, `entities.js` | The phase 3b page (below)                                                                                                       |
| `entities/`                    | `stubs.js` (legacy seams), `assets.js` (synthetic SPR/ACT/PAL), `scene.js` (the 200 entities)                                   |
| `common.js`                    | Shared page helpers: canvases, draw counting, read-back, comparison, diff image, camera matrices                                |
| `cameraStub.js`                | The legacy `Renderer/Camera.js` stand-in (zoom, latitude, direction, matrices)                                                  |
| `vite.config.js`               | Serves the package root, resolves the repo `src/` aliases read-only, and swaps the `LEGACY_STUBS` seams for `entities/stubs.js` |
| `run-parity.mjs`               | Starts Vite, launches Chromium, prints the results, writes the PNGs                                                             |

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

## Real-stream parity: the legacy entity path, 200 entities

Phase 3b check. The first page feeds hand-made records through the legacy `SpriteRenderer` API. This one runs the
**real legacy entity render path**, unmodified: `Renderer/EntityManager.js` → `Renderer/Entity/Entity.js` (all mixins,
`Controls/EntityControl.js` included) → `EntityRender.js` → `SpriteRenderer.js`. The batching numbers it reports are
therefore the realistic ones.

1. **Seams.** `vite.config.js` swaps the modules the entity path reads but the page does not exercise for
   `entities/stubs.js`: `Core/Client.js`, `Renderer/Camera.js`, `Renderer/Renderer.js`, ground, altitude, DB, session,
   network, sounds and UI components. This is the set the root suite mocks in Node
   (`tests/renderer/support/legacySceneMocks.js`), with the same answers. The ground is non-uniform (cell height and
   shadow factor vary per cell). `Utils/WebGL.js`, `Loaders/Sprite.js` and every other legacy module are real.
2. **Assets** (`entities/assets.js`). 19 sprites, 218 frames, 11 palettes. Each sprite is a real legacy `SPR` object
   with raw frames: indexed indices, or bottom-up ABGR. The real `SPR.compile()` compiles it (and the real
   `switchToRGBA()` for `to_rgba` loads), and it is uploaded the way `Core/Client.js:313-351` uploads sprites. Frames
   are non-POT, so centring matters. Every POT class from 32 to 256 is used. Palettes carry a magenta entry, which is
   keyed to 0, and colour indices 1, 254 and 255. Five external `.pal` dyes are included.
3. **Scene** (`entities/scene.js`, seeded):
    - 120 PCs: two bodies, head, up to three headgears, weapon (with the alpha-0 layer that legacy skips), shield,
      robe, body and head dyes, and all 8 directions. They idle, walk, attack, sit or stand ready.
    - 52 mobs: an RGBA mob with scaled, tinted, rotated and mirrored layers, an indexed mob, and a 256-class boss.
      They idle, walk, attack, take a hit, or die and fade.
    - 28 NPCs, some walking.
    - Six carts.
    - Status tints: stone, freeze (with the ice attachment), poison, curse (with its attachment) and cloak.
    - Berserk, whose layers draw additive.
4. **Capture.** Legacy plays the scene under a fake clock and seeded `Math.random`, at 40 ms per frame. Each frame is
   one `EntityManager.render` pass into canvas A, with its real depth sort. On three frames,
   `SpriteRenderer.addRecordSink` captures every native record of that pass.
5. **Replay.** `fromLegacySpriteRecord` (`src/sprites/legacyRecord.js`) turns each native record into a SpriteDraw:
   GL textures become residency handles, the blend name becomes a pair, and the sampler is derived. `RunRenderer`
   draws the records into canvas B. Residency starts empty and **uploads on miss** through a `FrameSourcePort` over
   the same raw SPR frames, decoded by `decodeSprFrame` (C-16: `padIndexedFrame`, `convertRgbaFrame`, POT centring).
6. **Residency churn.** Before the second capture, gpu-webgl2 evicts every slot and palette row, so the frame
   re-uploads into recycled free-list layers. Before the third, it disposes the pools and purges, as on a context
   loss. The upload-on-miss and eviction contract (`FrameSourcePort`, free-list layers, refcounted palette rows,
   `beginFrame`, idle eviction, purge) is documented in `src/residency/Residency.js`.
7. **#64 compensation.** It is the same as in the first page: legacy palette textures are uploaded with entry 0 set
   to entry 255.

**Controls.** Both run on the first frame, and the run fails if either shows no difference.

- **Sensitivity.** The last visible record is nudged 0.01 world units in the gpu-webgl2 stream only.
- **#64.** gpu-webgl2 is drawn with the legacy wrap emulated (entry 255 set to entry 0). It must differ from the
  compensated legacy frame, which proves the stream really uses index 255.

### Results (SwiftShader, 640×480)

| Frame                                | Records | Max channel diff | Pixels differing | Legacy `drawArrays` | gpu-webgl2 `drawArraysInstanced` | Uploads on miss |
| ------------------------------------ | ------: | ---------------: | ---------------: | ------------------: | -------------------------------: | --------------: |
| t = 120 ms                           |    1052 |                0 |                0 |                1052 |                      648 (1.62×) |              86 |
| t = 520 ms, fog, after full eviction |    1043 |                0 |                0 |                1043 |                      594 (1.76×) |              91 |
| t = 1240 ms, after context purge     |     954 |                0 |                0 |                 954 |                      537 (1.78×) |              88 |

- The MSAA run (`:aa`) also gives 0 px on all three frames.
- The sensitivity control differs on about 9.2k px (max 72).
- The #64 control differs on about 18.2k px (max 210).
- GL errors: none on either context.

**Why the batching ratio is only about 1.7×.** Runs never reorder; they break only on state changes. In this stream:

| Frame | Breaks on texture class (indexed ↔ RGBA) | Breaks on depth write | Breaks on blend |
| ----- | ---------------------------------------: | --------------------: | --------------: |
| 1     |                                      452 |                   326 |              74 |
| 2     |                                      390 |                   323 |              74 |
| 3     |                                      368 |                   279 |              24 |

A break can count under more than one column. A typical PC alternates:

- shadow (RGBA, no depth write);
- body and head (indexed);
- headgears and weapon (RGBA).

Mob bodies draw without depth write. So the realistic stream gives short runs: 1.6–1.8 layers per run on average,
and up to 7 for groups of same-state layers. The largest remaining win is to let one run mix indexed and RGBA layers, for example with
a per-instance class flag in place of the `uIndexedRun` uniform. That removes the texture-class breaks without
reordering anything.
