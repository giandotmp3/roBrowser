/**
 * Ports (injected dependencies). preview2d never reaches for globals
 * (document, requestAnimationFrame, Date.now, MemoryManager): everything
 * arrives through these interfaces so the module is testable in node.
 */

/**
 * Creates Canvas2D-capable canvases. In the browser: `document.createElement('canvas')`
 * or `new OffscreenCanvas(w, h)` when synchronous `toDataURL` is not needed.
 *
 * @typedef {Object} CanvasFactory
 * @property {(width: number, height: number) => CanvasLike} create
 */

/**
 * @typedef {Object} CanvasLike
 * @property {number} width
 * @property {number} height
 * @property {(type: '2d') => Context2DLike} getContext
 * @property {(type?: string) => string} [toDataURL]
 */

/**
 * The subset of CanvasRenderingContext2D used by preview2d.
 *
 * @typedef {Object} Context2DLike
 * @property {CanvasLike} [canvas]
 * @property {() => void} save
 * @property {() => void} restore
 * @property {(x: number, y: number) => void} translate
 * @property {(rad: number) => void} rotate
 * @property {(x: number, y: number) => void} scale
 * @property {(x: number, y: number, w: number, h: number) => void} clearRect
 * @property {Function} drawImage
 * @property {(w: number, h: number) => {width: number, height: number, data: Uint8ClampedArray}} createImageData
 * @property {(img: object, x: number, y: number) => void} putImageData
 * @property {(x: number, y: number, w: number, h: number) => {width: number, height: number, data: Uint8ClampedArray}} [getImageData]
 */

/**
 * Resolves the residency handles carried by SpriteDraw records to CPU data.
 * preview2d draws from CPU-side SPR frames, never from GPU textures, which is
 * what keeps `toDataURL` / `getImageData` synchronous (architecture §2.2, B3).
 *
 * @typedef {Object} FrameSource
 * @property {(handle: string|number|null) => import('./domain/SpriteFrame.js').SpriteFrame|null} getFrame
 * @property {(handle: string|number|null) => Uint8Array|null} getPalette  256 x RGBA (1024 bytes)
 */

/**
 * Supplies the SpriteDraw records for one cursor animation (emitted by render-records
 * from the cursor ACT layers with origin = (drawX, drawY)).
 *
 * @typedef {(actionIndex: number, animationIndex: number) => ReadonlyArray<object>} CursorRecordSource
 */

/**
 * Frame scheduler used by the cursor's own loop when the scene loop is stopped (R-UI-005).
 *
 * @typedef {Object} FrameScheduler
 * @property {(cb: (ts: number) => void) => number} requestFrame
 * @property {(id: number) => void} cancelFrame
 */

/**
 * @typedef {Object} Clock
 * @property {() => number} now  Milliseconds
 */

export {};
