import { computeProjection, computeViewport } from '../domain/Viewport.js';

/**
 * Legacy `Renderer` facade (device.init, loop.register/unregister, clock.tick, viewport.size/resize).
 * The GPU device itself lives in gpu-webgpu / gpu-webgl2 behind `backend`.
 *
 * @typedef {object} BackendPort
 * @property {(opts: { alpha?: boolean, antialias?: boolean }) => Promise<void>|void} init
 * @property {(size: { backingWidth: number, backingHeight: number, cssWidth: number, cssHeight: number }) => void} resize
 * @property {boolean} contextLost
 */

/**
 * @param {object} deps
 * @param {import('../domain/Scheduler.js').Scheduler} deps.scheduler
 * @param {BackendPort} deps.backend
 * @param {import('../domain/Camera.js').Camera} deps.camera
 * @param {() => { cssWidth: number, cssHeight: number, dpr: number, quality: number }} deps.readWindow
 */
export const createRendererFacade = ({ scheduler, backend, camera, readWindow }) => {
	const facade = {
		width: 0,
		height: 0,
		projection: computeProjection(camera.vFov, 1),

		get tick() {
			return scheduler.tick;
		},

		get contextLost() {
			return Boolean(backend.contextLost);
		},

		/** device.init */
		init(opts = {}) {
			return backend.init({ alpha: false, antialias: true, ...opts });
		},

		/** loop.register — Renderer.render(fn) */
		render(fn) {
			scheduler.register(fn);
		},

		/** loop.unregister — Renderer.stop(fn?) */
		stop(fn) {
			scheduler.unregister(fn);
		},

		/** viewport.resize (call through ResizeDebouncer for window events). Ignored while context is lost. */
		resize() {
			if (backend.contextLost) {
				return;
			}
			const size = computeViewport(readWindow());
			facade.width = size.cssWidth;
			facade.height = size.cssHeight;
			facade.projection = computeProjection(camera.vFov, size.cssWidth / size.cssHeight);
			backend.resize(size);
		}
	};
	return facade;
};
