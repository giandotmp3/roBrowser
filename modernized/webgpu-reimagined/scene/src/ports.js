/**
 * Injectable ports. The scene module never reaches into globals (Session, GraphicsSettings,
 * Date.now, Math.random, requestAnimationFrame); everything arrives through these.
 * This is what makes the record-diff oracle deterministic (test-harness: seeded RNG + FakeClock).
 *
 * @typedef {object} Clock
 * @property {() => number} now        Monotonic ms (performance.now equivalent). Becomes Renderer.tick.
 * @property {() => number} dateNow    Wall clock ms (Date.now equivalent), drives Session.serverTick.
 *
 * @typedef {() => number} Rng          Uniform [0, 1).
 *
 * @typedef {object} SessionPort
 * @property {boolean} Playing
 * @property {number} serverTick
 * @property {number} [packetVer]       Active PACKETVER (yyyymmdd).
 * @property {object|null} [Entity]     Local player entity.
 *
 * @typedef {object} GraphicsSettingsPort
 * @property {number} fpslimit
 * @property {boolean} performanceMode
 * @property {number} viewArea
 * @property {number} quality           Percentage, from Configs 'quality'.
 *
 * @typedef {object} EventsPort
 * @property {(tick: number) => void} process
 *
 * @typedef {object} CursorPort
 * @property {(tick: number) => void} render
 * @property {(type: string) => void} [setType]
 *
 * @typedef {object} FrameRequester
 * @property {(cb: (t: number) => void) => number} request
 * @property {(id: number) => void} cancel
 *
 * @typedef {object} TimerPort
 * @property {(cb: () => void, ms: number) => unknown} setTimeout
 * @property {(handle: unknown) => void} clearTimeout
 *
 * @typedef {object} MapLoaderPort        Map loader worker channel (§3.2).
 * @property {(rswFilename: string) => number} load   Returns the load request uid.
 *
 * @typedef {object} RecordsPort          render-records module boundary (per-frame emission).
 * @property {(frame: SceneFrame) => void} emitFrame
 *
 * @typedef {object} SceneFrame
 * @property {number} tick
 * @property {Float32Array} projection
 * @property {Float32Array} modelView
 * @property {number} cameraDirection
 * @property {Set<unknown>} visibleEntities
 * @property {boolean} performanceMode
 */

/** @returns {Clock} */
export const createSystemClock = () => ({
	now: () => globalThis.performance.now(),
	dateNow: () => Date.now()
});

/** @returns {FrameRequester} */
export const createRafRequester = () => ({
	request: (cb) => globalThis.requestAnimationFrame(cb),
	cancel: (id) => globalThis.cancelAnimationFrame(id)
});

/** @returns {TimerPort} */
export const createSystemTimers = () => ({
	setTimeout: (cb, ms) => globalThis.setTimeout(cb, ms),
	clearTimeout: (h) => globalThis.clearTimeout(h)
});
