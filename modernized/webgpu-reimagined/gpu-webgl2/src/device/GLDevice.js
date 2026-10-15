import { ContextUnavailableError, DeviceLimitError } from '../errors.js';
import { CLEAR_DEPTH, CONTEXT_ATTRIBUTES, CONTEXT_NAMES, REQUIRED_LIMITS } from '../constants.js';
import { GL } from '../pipeline/glEnums.js';

/**
 * Session-scoped WebGL2 device. All GL handles hang off an instance
 * (spec §2.3 item 1): no module-level `_program` / `_buffer` singletons.
 */
export class GLDevice {
	/** @param {{canvas: import('../ports.js').CanvasPort}} deps */
	constructor({ canvas }) {
		this._canvas = canvas;
		/** @type {WebGL2RenderingContext|null} */
		this.gl = null;
		this.contextName = null;
	}

	/**
	 * R-CTX-001: request `webgl2`, then `experimental-webgl2`, with the fixed
	 * attributes. Throws (and therefore never renders) when neither is available.
	 * @returns {WebGL2RenderingContext}
	 */
	init() {
		for (const name of CONTEXT_NAMES) {
			let gl = null;
			try {
				gl = this._canvas.getContext(name, { ...CONTEXT_ATTRIBUTES });
			} catch {
				gl = null;
			}
			if (gl) {
				this.gl = gl;
				this.contextName = name;
				this._checkLimits();
				applyDefaultState(gl);
				return gl;
			}
		}
		throw new ContextUnavailableError();
	}

	/** NFR-08: legacy never checked limits; the rebuild does. */
	_checkLimits() {
		for (const [name, required] of Object.entries(REQUIRED_LIMITS)) {
			const available = this.gl.getParameter(GL[name]) ?? 0;
			if (available < required) {
				throw new DeviceLimitError(name, required, available);
			}
		}
	}
}

/**
 * R-CTX-002: default GL state, applied at init and on context restore.
 * Every pass that changes blend must return here (see GLStateCache.restoreDefault).
 * @param {WebGL2RenderingContext} gl
 */
export function applyDefaultState(gl) {
	gl.clearDepth(CLEAR_DEPTH);
	gl.enable(GL.DEPTH_TEST);
	gl.depthFunc(GL.LEQUAL);
	gl.enable(GL.BLEND);
	gl.blendFunc(GL.SRC_ALPHA, GL.ONE_MINUS_SRC_ALPHA);
	gl.depthMask(true);
}
