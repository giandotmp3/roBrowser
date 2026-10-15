/**
 * Injected ports. gpu-webgl2 never imports scene, render-records or the legacy
 * client directly; everything outside the GPU arrives through these. Records
 * are consumed structurally (see the typedefs below), mirroring the shapes
 * render-records emits, so both backends draw the same stream.
 *
 * @typedef {Object} CanvasPort
 * @property {(type: string, attrs?: WebGLContextAttributes) => WebGL2RenderingContext|null} getContext
 * @property {(type: string, fn: (ev: {preventDefault(): void}) => void) => void} addEventListener
 * @property {number} width
 * @property {number} height
 *
 * @typedef {Object} OverlayPort         DOM context-loss overlay (R-CTX-006)
 * @property {(spec: {background: string, zIndex: number, title: string}) => void} show
 * @property {() => void} hide
 *
 * @typedef {Object} AssetCachePort      MemoryManager-equivalent CPU cache
 * @property {(extensions: ReadonlyArray<string>) => void} purge
 *
 * @typedef {import('./residency/Residency.js').FrameSourcePort} FrameSourcePort  Residency upload-on-miss (C-16)
 *
 * @typedef {Object} SettingsPort        GraphicsSettings / MapPreferences / Configs reads
 * @property {(key: string) => any} get
 * @property {(key: string, value: any) => void} set
 *
 * @typedef {Object} ScenePort           Callbacks into `scene` for non-GPU frame steps (R-CTX-010)
 * @property {(step: string) => void} runStep
 * @property {() => string|null} currentMap
 *
 * @typedef {Object} BlendState          Unified blend enum (render-records/blend.js)
 * @property {string} src                e.g. 'SRC_ALPHA'
 * @property {string} dst                e.g. 'ONE_MINUS_SRC_ALPHA'
 *
 * @typedef {Object} SpriteRecord        render-records SpriteDraw
 * @property {'sprite'} kind
 * @property {string|number|null} texture
 * @property {'indexed'|'rgba'} textureClass
 * @property {string|number|null} palette
 * @property {'nearest'|'linear'} sampler
 * @property {[number, number, number]} position
 * @property {[number, number]} offset
 * @property {[number, number]} size
 * @property {number} angle
 * @property {boolean} mirror
 * @property {[number, number, number, number]} color
 * @property {number} shadowFactor
 * @property {number} zIndex
 * @property {number} depthBias
 * @property {boolean} depthTest
 * @property {boolean} depthWrite
 * @property {boolean} depthCorrection
 * @property {boolean} ignoreDepthMinCap
 * @property {BlendState} blend
 *
 * @typedef {Object} EffectRecord        render-records EffectDraw
 * @property {'effect'} kind
 * @property {string} family
 * @property {'before'|'after'} pass
 * @property {BlendState} blend
 * @property {boolean} depthTest
 * @property {boolean} depthWrite
 * @property {boolean} depthCorrection
 * @property {boolean} fog
 * @property {boolean} strAttachment
 * @property {Object} params
 *
 * @typedef {Object} WorldRecord         render-records WorldDraw
 * @property {'world'} kind
 * @property {'water'|'animatedModel'} part
 * @property {number} alpha
 * @property {Float32Array|null} matrices
 * @property {number} textureIndex
 * @property {BlendState} blend
 * @property {boolean} depthTest
 * @property {boolean} depthWrite
 *
 * @typedef {SpriteRecord|EffectRecord|WorldRecord} DrawRecord
 */
export {};
