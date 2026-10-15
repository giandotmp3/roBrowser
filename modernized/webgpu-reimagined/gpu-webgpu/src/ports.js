/**
 * Injected ports. gpu-webgpu never imports scene, render-records or the
 * legacy client directly; everything outside the GPU arrives through these.
 *
 * @typedef {Object} GpuPort            Subset of `navigator.gpu` (faked in tests)
 * @property {(opts?: GPURequestAdapterOptions) => Promise<GPUAdapter|null>} requestAdapter
 * @property {() => string} getPreferredCanvasFormat
 *
 * @typedef {Object} CanvasPort
 * @property {(type: 'webgpu') => GPUCanvasContext|null} getContext
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
 * @typedef {Object} SettingsPort        GraphicsSettings / MapPreferences / Configs reads
 * @property {(key: string) => any} get
 * @property {(key: string, value: any) => void} set
 *
 * @typedef {Object} FallbackPort        Switch to the gpu-webgl2 backend mid-session (R-CTX-007, M1)
 * @property {(reason: string) => Promise<void>} switchToWebgl2
 *
 * @typedef {Object} ScenePort           Callbacks into `scene` for non-GPU frame steps (R-CTX-010)
 * @property {(step: string) => void} runStep
 * @property {() => string|null} currentMap
 * @property {(mapName: string) => Promise<void>} setMap
 */
export {};
