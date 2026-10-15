import { FRAME, PROJECTION } from '../constants.js';
import { create, perspective, toRad } from '../math/mat4.js';

/**
 * Viewport sizing (R-CTX-008). The GPU backend consumes the result; it never computes it.
 *
 * @param {object} p
 * @param {number} p.cssWidth
 * @param {number} p.cssHeight
 * @param {number} p.dpr
 * @param {number} p.quality  percentage (Configs 'quality')
 * @returns {{cssWidth:number, cssHeight:number, backingWidth:number, backingHeight:number}}
 */
export const computeViewport = ({ cssWidth, cssHeight, dpr, quality }) => {
	const scale = (quality / 100) * dpr;
	return {
		cssWidth,
		cssHeight,
		backingWidth: Math.floor(cssWidth * scale),
		backingHeight: Math.floor(cssHeight * scale)
	};
};

/**
 * @param {number} vFovDeg full vertical angle in degrees
 * @param {number} aspect
 */
export const computeProjection = (vFovDeg, aspect) =>
	perspective(create(), toRad(vFovDeg), aspect, PROJECTION.NEAR, PROJECTION.FAR);

/** Trailing-edge debounce for window resize (500 ms). */
export class ResizeDebouncer {
	/**
	 * @param {import('../ports.js').TimerPort} timers
	 * @param {() => void} onResize
	 * @param {number} [delay]
	 */
	constructor(timers, onResize, delay = FRAME.RESIZE_DEBOUNCE_MS) {
		this.timers = timers;
		this.onResize = onResize;
		this.delay = delay;
		this._handle = null;
	}

	/** Call on every window resize event. */
	notify() {
		if (this._handle !== null) {
			this.timers.clearTimeout(this._handle);
		}
		this._handle = this.timers.setTimeout(() => {
			this._handle = null;
			this.onResize();
		}, this.delay);
	}
}
