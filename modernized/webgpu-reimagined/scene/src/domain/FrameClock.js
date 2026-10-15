import { FRAME } from '../constants.js';

/**
 * Frame throttle (R-CTX-003). Owns the fps cap decision only; the GPU backend never
 * decides whether a frame is due.
 */
export class FrameClock {
	/**
	 * @param {object} deps
	 * @param {import('../ports.js').SessionPort} deps.session
	 * @param {import('../ports.js').GraphicsSettingsPort} deps.settings
	 */
	constructor({ session, settings }) {
		this.session = session;
		this.settings = settings;
		/** Last accepted frame time, snapped to the interval boundary. */
		this.lastFrame = -Infinity;
	}

	/** @returns {number} effective cap in fps; <= 0 means uncapped. */
	effectiveCap() {
		let cap = this.settings.fpslimit ?? FRAME.DEFAULT_FPS_LIMIT;
		if (!this.session.Playing && (cap <= 0 || cap > FRAME.OUT_OF_GAME_CAP)) {
			cap = FRAME.OUT_OF_GAME_CAP;
		}
		return cap;
	}

	/**
	 * Decide whether a frame is due at `now` (one call per rAF).
	 * @param {number} now
	 * @returns {boolean}
	 */
	isFrameDue(now) {
		const cap = this.effectiveCap();
		if (cap <= 0) {
			this.lastFrame = now;
			return true;
		}
		const interval = 1000 / cap;
		if (this.lastFrame === -Infinity) {
			this.lastFrame = now;
			return true;
		}
		const elapsed = now - this.lastFrame;
		if (elapsed < interval) {
			return false;
		}
		this.lastFrame = now - (elapsed % interval);
		return true;
	}
}
