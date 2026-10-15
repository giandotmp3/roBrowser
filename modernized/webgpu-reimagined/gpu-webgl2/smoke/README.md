# Sprite pixel parity: legacy SpriteRenderer vs gpu-webgl2

Three pages: the phase 3a synthetic record page (`parity`, below), the phase 3b real-stream entity page
(`entities`, see [Real-stream parity](#real-stream-parity-the-legacy-entity-path-200-entities)) and the effect page
(`effects`, see [Effect parity](#effect-parity-str-3d-and-2d-effects)).

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
npm run smoke:parity:effects     # real legacy STR / 3D / 2D effect classes
npm run smoke:parity:effects:aa  # the same with MSAA
```

You need a Playwright Chromium. Set `PLAYWRIGHT_BROWSERS_PATH` to it; the script never runs `playwright install`.
`vite` also resolves from the repository root `node_modules`.

**Options** (`node smoke/run-parity.mjs …`):

| Option             | Meaning                                                                            |
| ------------------ | ---------------------------------------------------------------------------------- |
| `--page=P`         | `parity` (default, phase 3a), `entities` (phase 3b) or `effects`                   |
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
| `effects.html`, `effects.js`   | The effect page (below)                                                                                                         |
| `effects/`                     | `assets.js` (images, effect SPR/ACT), `scene.js` (STR, 3D and 2D spawns)                                                        |
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
| no fog       |                0 |                0 | 39 `drawArrays` | 15 `drawArraysInstanced` |
| fog          |                0 |                0 |              39 |                       15 |
| no fog, MSAA |                0 |                0 |              39 |                       15 |
| fog, MSAA    |                0 |                0 |              39 |                       15 |

The sensitivity control shows about 600 differing pixels (max 58).

**Why 40 records give 39 legacy draws:** legacy skips the zero-alpha layer before drawing. gpu-webgl2 packs it, and the shader discards it.

**Why 15 runs:** the scene changes state on purpose (blend, depth flags), so the run count is high for its size. It was 23 before sprite runs could mix indexed and RGBA layers (see the batching section below). Same-state layers of consecutive entities merge into one run.

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
| t = 120 ms                           |    1052 |                0 |                0 |                1052 |                      330 (3.19×) |              86 |
| t = 520 ms, fog, after full eviction |    1043 |                0 |                0 |                1043 |                      327 (3.19×) |              91 |
| t = 1240 ms, after context purge     |     954 |                0 |                0 |                 954 |                      282 (3.38×) |              88 |

- The MSAA run (`:aa`) also gives 0 px on all three frames.
- The sensitivity control differs on about 9.2k px (max 72).
- The #64 control differs on about 18.2k px (max 210).
- GL errors: none on either context.

**Batching: about 3.2× since sprite runs mix texture classes.** Runs never reorder; they break only on state changes.
Before, they also broke on every indexed ↔ RGBA change (648 / 594 / 537 draws, about 1.7×). Now gpu-webgl2 batches by a
backend-local `batchKey` (`src/batching/runs.js`): render-records' `pipelineKey` without the sprite texture class.
`pipelineKey` itself stays identical to render-records (`test/contract/recordsDrift.test.js`), and that test also
proves batchKey ⊆ pipelineKey: two records share a batch only if kind, blend pair, depth test, depth write and STR
attachment are equal, so a batch is always a union of whole render-records runs.

- **Shader.** `aLayer.w` carries a per-instance sampling mode (`SPRITE_SAMPLING`: 0 RGBA nearest, 1 RGBA linear,
  2 indexed) in place of the `uIndexedRun` uniform; `sprite.frag` branches on it per instance.
- **Texture units.** Every sprite run binds the palette table and both array sets (r8 and rgba8, 5 POT classes each):
  11 fragment units, under the 16 every WebGL2 context guarantees. If `MAX_TEXTURE_IMAGE_UNITS` reports fewer than 11,
  `SpritePipeline.mixedClasses` is false: the program is built with `SPRITE_SPLIT_CLASSES` (one set on units 1..5,
  6 units), the run's class set is rebound per run, and `splitBatches` splits on texture class again (verified by
  forcing it on this page: 0 px, 648 / 594 / 537 draws).

What still breaks runs in this stream (`changes`: consecutive records whose state differs; `batch`: the subset at real
draw boundaries):

| Frame | Texture-class changes (all / at a draw boundary) | Depth-write changes | Blend changes |
| ----- | -----------------------------------------------: | ------------------: | ------------: |
| 1     |                                        452 / 134 |                 326 |            74 |
| 2     |                                        390 / 123 |                 323 |            74 |
| 3     |                                        368 / 113 |                 279 |            24 |

The texture-class changes left at a boundary coincide with a depth-write or blend change; they no longer cause a break
on their own. **Depth write is now the dominant break** (about 280–326 per frame): a PC's shadow and a mob's body draw
without depth write, the rest with it. `depthMask` is GL pipeline state, not per-fragment state, so it cannot change
inside one draw call, so runs keep splitting on it; merging them is not attempted.

## Effect parity: STR, 3D and 2D effects

The **real legacy effect classes**, unmodified, play a scripted scene: `Renderer/Effects/StrEffect.js`,
`ThreeDEffect.js` and `TwoDEffect.js`, drawing through the real `SpriteRenderer.js`, with their textures made by the
real `Utils/WebGL.texture` and `Utils/Texture.load`. `vite.config.js` serves the real `StrEffect.js` to the effects
page only (`REAL_FOR`); the entity path keeps its stub.

1. **Scene** (`effects/scene.js`). It is a browser-safe port of the root suite's
   `tests/renderer/support/strEffectScene.js` and `spriteEffectScene.js`: the same keyframes, flags and blend codes,
   moved around one camera target.
    - STR: multi-layer interpolation, anitype 1–4 and default, D3D blend pairs (saturate, constant colour and constant
      alpha), a persistent loop, hat attachments (persistent with blank-frame restart, and one-shot) on a moving owner,
      a missing material, a texture-less layer and a 200×100 material.
    - 3D: fades, sparkle, every GL-order `blendMode` 1–15 plus 0/16/−1/unset, overlay, rotating, smooth and linear
      paths, random spreads, fromSrc/toSrc arcs, the soul-strike pattern, attached, file lists, and sprite-backed
      effects (indexed shadow, `to_rgba` RGBA SPR with `spr_type` 1 layers, indexed SPR with a palette, overlay).
    - 2D: the same blend codes, overlay, smooth/linear/fixed/random paths, circle pattern, rotate-to-target and
      attached with a shadow.
2. **Assets** (`effects/assets.js`). 26 PNG data-URL images: STR materials are BMP-like (opaque, magenta and
   near-magenta blocks, pure-black blocks); EffectTable textures have alpha ramps and holes; sizes are mostly non-POT.
   Three SPRs are built with the real `Loaders/Sprite.js` and uploaded as `Core/Client.js` does (#64 compensation on
   the palettes, as on the entity pages).
3. **Capture.** Legacy renders every 20 ms from t = 980 ms, one pass per class per tick (3D, then STR, then 2D),
   as `EffectManager.render` does, and removes an effect after the frame that sets `needCleanUp`. On five ticks
   each class's `addRecordSink` captures every draw record.
4. **Replay.** `fromLegacyEffectRecord` (`src/effects/legacyRecord.js`) maps each native record onto the
   EffectDraw shape: GL textures become residency handles; a `null` blend becomes normal (#41/#49); STR `fog`
   becomes the scene fog (R-EFX-010 fix). `RunRenderer` then draws:
    - STR layers with the instanced STR program (`str.vert`/`str.frag`: legacy `StrEffect.vs/.fs` operation for
      operation; per-instance corners, rotation, offset, colour, yLower, clip-z bias and fog);
    - 2D/3D records with the instanced sprite program (`spriteEffectView`);
    - everything in batches of equal blend/depth state and equal program, in stream order.
      Residency uploads on miss: images through `decodeImageTexture`, which repeats legacy's magenta key and POT
      stretch on the same canvases and takes the texels from a WebGL unpack, and SPR frames through `decodeSprFrame`.

**Declared divergence, R-EFX-010 (fixed in the rebuild).** Legacy never fogs STR layers. The parity frames compare
the rebuild with its STR fog **off**, and that includes the fog frame, where 2D and 3D are fogged on both sides.
Three checks cover the fix itself:

- **Fog frame with the STR fog on:** it must differ from legacy, and only inside the STR footprint. The footprint is
  the STR records drawn alone, with colour 1, an overwrite blend, no depth test, and a white fog over black.
- **CPU-expected mix:** an isolated opaque STR quad in fog must equal `legacy·(1−f) + fogColour·f` within 2 levels.
  `f` is computed on the CPU from the billboard depth, which is constant over a screen-aligned quad.
- **Texels:** every legacy image texture is read back and compared with the residency decode.

**Kept out of the scene, by decision:**

- Invalid blend codes (#41, #49) and the STR pair 14/15. WebGL rejects constant colour with constant alpha, so legacy
  keeps the previous draw's blend; the rebuild draws normal alpha (`isWebGLInvalidBlend`).
- The #47 leak: a plain 3D effect after a sprite-backed one inherits offset and palette. The fix lives in
  render-records and cannot be recovered from a native record.
- A missing STR file: legacy `render` dereferences it and throws.
- A `spr_type` 0 layer on an RGBA frame of a mixed SPR. Legacy samples that RGBA texture through the palette path.

Constant-colour factors use the legacy blend constant (0, 0, 0, 0): legacy never calls `blendColor`
(`LEGACY_BLEND_CONSTANT`). Page parameter `?only=str|3d|2d` keeps one class, for diagnosis.

### Results (SwiftShader, 640×480)

| Frame         | Records (STR / 3D / 2D) | Max channel diff | Pixels differing | Legacy `drawArrays` | gpu-webgl2 `drawArraysInstanced` |
| ------------- | ----------------------: | ---------------: | ---------------: | ------------------: | -------------------------------: |
| t = 1040 ms   |       52 (14 / 25 / 13) |                0 |                0 |                  52 |                       31 (1.68×) |
| t = 1200 ms   |       65 (17 / 30 / 18) |                0 |                0 |                  65 |                       45 (1.44×) |
| t = 1300, fog |       72 (16 / 35 / 21) |                0 |                0 |                  72 |                       51 (1.41×) |
| t = 1400 ms   |       79 (16 / 38 / 25) |                0 |                0 |                  79 |                       57 (1.39×) |
| t = 1560 ms   |        65 (7 / 35 / 23) |                0 |                0 |                  65 |                       38 (1.71×) |

- The MSAA run (`:aa`) also gives 0 px on all five frames.
- Fog frame with the STR fog on: about 47.6k px differ, none outside the STR footprint (about 57.6k px).
- CPU fog mix: f = 0.3167, 16 352 interior px, maximum error 0.84 levels.
- Texels: 26 images, 129 792 texels, 0 differ.
- Sensitivity controls (0.01 world units, gpu-webgl2 side only): an STR layer gives about 14.7k px; a 3D record gives
  8 px (small, soft-edged quads).
- GL errors: none on either context.

**Batching.** STR layers batch well; for example, the seven blend pairs of `blends.str` share one state with the other
STR layers, and runs of 14–17 STR layers appear. The 3D/2D part of the scene changes blend on purpose almost every
record, because it has one effect per blend code, so its runs are mostly single records. Runs never reorder.

**Texel note.** `getImageData` and `texImage2D(canvas)` un-premultiply translucent pixels with different rounding
in Chromium: they differed by one level on about 0.1 % of channels. That alone gave 1–2-level diffs on about 150 px
per frame. `decodeImageTexture(image, { gl })` therefore reads the texels back through the WebGL unpack
(`unpackViaGl`). Without `gl` it falls back to `getImageData`.
