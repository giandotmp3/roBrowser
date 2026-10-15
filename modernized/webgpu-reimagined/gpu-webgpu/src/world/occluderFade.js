import { OCCLUDER_QUERY } from '../constants.js';
import { clamp, smoothstep } from '../math.js';

/** R-MAP-018: active for 'dither' or 'alpha', except in first-person mode. */
export function occluderFadeActive(mode, cameraMode) {
	return (mode === 'dither' || mode === 'alpha') && cameraMode !== 'first';
}

/** R-MAP-019: strength up by Δt/150 when blocked, down by Δt/300 when clear, Δt capped at 100. */
export function nextStrength(strength, blocked, dtMs) {
	const dt = Math.min(dtMs, OCCLUDER_QUERY.dtCapMs);
	return clamp(blocked ? strength + dt / OCCLUDER_QUERY.fadeInMs : strength - dt / OCCLUDER_QUERY.fadeOutMs);
}

/**
 * R-MAP-019 query cadence (reference): a new query is not issued while one is pending;
 * the result is read back 1–2 frames late (architecture m3). The GPU side (an `occlusion`
 * GPUQuerySet of 2 slots attached to the scene pass, resolveQuerySet after it, mapAsync
 * after the submit) is MapWorld's (world/MapWorld.js), with the same cadence per slot.
 */
export class OccluderQueryScheduler {
	constructor() {
		this.pending = false;
		/** Last resolved result: did any sample pass? */
		this.lastBlocked = false;
	}

	/** @returns {boolean} true if a query should be attached to this frame's pass */
	beginFrame() {
		if (this.pending) {
			return false;
		}
		this.pending = true;
		return true;
	}

	/** Called when the mapped query-resolve buffer is available. */
	resolve(anySamplesPassed) {
		this.pending = false;
		this.lastBlocked = anySamplesPassed;
	}
}

/** 4×4 Bayer matrix, row-major. */
export const BAYER4 = Object.freeze([0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]);
export const bayerThreshold = (px, py) => (BAYER4[(py % 4) * 4 + (px % 4)] + 0.5) / 16;

/**
 * R-MAP-020 shape (reference for shaders/occluder_fade.wgsl).
 * fade = radial(1 − smoothstep(R/2, R, axisDist)) × along(1 − smoothstep(−0.5, 0, pastFocus)) × strength
 */
export function occluderFade({ axisDist, pastFocus, radius, strength }) {
	const radial = 1 - smoothstep(radius / 2, radius, axisDist);
	const along = 1 - smoothstep(-0.5, 0, pastFocus);
	return radial * along * strength;
}

export const occluderVisibility = (fade, opacity) => 1 - fade * (1 - opacity);

/**
 * R-MAP-020 per-fragment decision.
 * @param {'dither'|'alpha'} mode
 * @param {'opaque'|'blend'} pass   alpha mode only: the blend pass runs after entities
 * @returns {{discard: boolean, alphaScale: number}}
 */
export function occluderFragment({ mode, pass = 'opaque', fade, opacity, px = 0, py = 0 }) {
	const visibility = occluderVisibility(fade, opacity);
	if (mode === 'dither') {
		return { discard: visibility <= bayerThreshold(px, py), alphaScale: 1 };
	}
	if (pass === 'opaque') {
		return { discard: fade >= 0.01, alphaScale: 1 };
	}
	return { discard: fade < 0.01, alphaScale: visibility };
}

/** R-MAP-020 alpha-mode blend pass depth state. */
export const OCCLUDER_BLEND_PASS_DEPTH = Object.freeze({ depthTest: true, depthWrite: false });
