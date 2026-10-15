import { notImplemented } from '../util/errors.js';

/**
 * R-MAP-016 animLen 0 is derived as max keyframe + 1.
 * @param {number} animLen
 * @param {number[]} keyframeFrames
 */
export function resolveAnimLen(animLen, keyframeFrames) {
	if (animLen > 0) {
		return animLen;
	}
	return keyframeFrames.length ? Math.max(...keyframeFrames) + 1 : 0;
}

/**
 * R-MAP-016 keyframe position: tick (ms) used directly as the frame value.
 * @param {number} tick
 * @param {number} animLen
 */
export function keyframePosition(tick, animLen) {
	return animLen > 0 ? tick % animLen : 0;
}

/**
 * R-MAP-016 recompute bucket; matrices are recomputed only when this changes.
 * @param {number} tick
 * @param {number} [fps]  frameRatePerSecond (default 30)
 * @param {boolean} [performanceMode]
 */
export function matrixUpdateBucket(tick, fps = 30, performanceMode = false) {
	const divisor = performanceMode ? fps / 2 : fps / 1.14;
	return Math.floor(tick / (1000 / divisor));
}

/**
 * R-MAP-017 node hierarchy → per-instance node matrices (CPU), packed for a
 * storage buffer / RGBA32F texture. Pending.
 * @param {Object} _model  MAP_ANIMATED_MODEL payload
 * @param {number} _keyframe
 * @returns {Float32Array}
 */
export function computeNodeMatrices(_model, _keyframe) {
	return notImplemented('R-MAP-017', 'animated RSM node hierarchy matrices');
}
