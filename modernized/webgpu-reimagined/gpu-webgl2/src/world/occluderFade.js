import { OCCLUDER_DEFAULTS, OCCLUDER_QUERY } from '../constants.js';
import { smoothstep } from '../math.js';

/** R-MAP-018: active for 'dither' or 'alpha', never in first person. */
export function occluderFadeActive(mode, firstPerson) {
	return (mode === 'dither' || mode === 'alpha') && !firstPerson;
}

/**
 * R-MAP-019: occlusion-query driven strength. The GL query object is behind
 * `queries` so the fake GL can drive it.
 */
export class OccluderFade {
	/** @param {{begin(): void, end(): void, poll(): boolean|null}} queries  poll → null while pending */
	constructor(queries) {
		this._q = queries;
		this.pending = false;
		this.lastBlocked = false;
		this.strength = 0;
	}

	/** Issue a query unless one is still pending. @returns {boolean} issued */
	issue() {
		if (this.pending) {
			return false;
		}
		this._q.begin();
		this._q.end();
		this.pending = true;
		return true;
	}

	/** Collect a finished query (1–2 frames late is tolerated). */
	collect() {
		if (!this.pending) {
			return;
		}
		const result = this._q.poll();
		if (result !== null) {
			this.lastBlocked = result;
			this.pending = false;
		}
	}

	/** Up by Δt/150 when blocked, down by Δt/300 when clear, Δt capped at 100. */
	update(dtMs) {
		const dt = Math.min(dtMs, OCCLUDER_QUERY.dtCapMs);
		const delta = this.lastBlocked ? dt / OCCLUDER_QUERY.fadeInMs : -dt / OCCLUDER_QUERY.fadeOutMs;
		this.strength = Math.min(1, Math.max(0, this.strength + delta));
		return this.strength;
	}
}

/** R-MAP-019: query fragments kept only within 0.7 of the axis and > 0.5 before the focus. */
export function queryKeepsFragment(distToAxis, distBeforeFocus) {
	return distToAxis <= OCCLUDER_QUERY.axisRadius && distBeforeFocus > OCCLUDER_QUERY.beforeFocus;
}

/**
 * R-MAP-020 shape: fade = radial · along · strength; visibility = 1 − fade·(1 − opacity).
 */
export function occluderVisibility({
	distToAxis,
	signedPastFocus,
	strength,
	radius = OCCLUDER_DEFAULTS.radius,
	opacity = OCCLUDER_DEFAULTS.opacity
}) {
	const radial = 1 - smoothstep(radius / 2, radius, distToAxis);
	const along = 1 - smoothstep(-0.5, 0, signedPastFocus);
	const fade = radial * along * strength;
	return { fade, visibility: 1 - fade * (1 - opacity) };
}

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** R-MAP-020 dither: discard when visibility ≤ (b + 0.5)/16. */
export function ditherDiscard(visibility, px, py) {
	const b = BAYER4[(py & 3) * 4 + (px & 3)];
	return visibility <= (b + 0.5) / 16;
}

/** R-MAP-020 alpha mode: opaque pass discards fade ≥ 0.01; blend pass after entities, test on, write off. */
export function alphaModeOpaqueDiscard(fade) {
	return fade >= 0.01;
}
export const FADED_PASS_STATE = Object.freeze({
	depthTest: true,
	depthWrite: false,
	blend: Object.freeze({ src: 'SRC_ALPHA', dst: 'ONE_MINUS_SRC_ALPHA' })
});
