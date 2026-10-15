import { notImplemented } from '../util/errors.js';

export const GR2_POSE_HZ = 40;
export const GR2_MAX_BONES = 48;
export const GR2_CULL_MARGIN = 0.2;

/**
 * R-GR2-003 pose time quantised to 40 Hz.
 * @param {number} modelClockMs  ms since the last action change
 */
export function quantisePoseTime(modelClockMs) {
	return Math.floor((modelClockMs * GR2_POSE_HZ) / 1000);
}

/**
 * R-GR2-003 pose cache key (path, anim, quantised t).
 * @param {string} path
 * @param {string|number} anim
 * @param {number} q
 */
export function poseCacheKey(path, anim, q) {
	return `${path}|${anim}|${q}`;
}

/**
 * R-GR2-003 model clock restarts on every action change.
 * @param {{action: number, clockStart: number}} state
 * @param {number} action
 * @param {number} tick
 */
export function advanceModelClock(state, action, tick) {
	if (state.action !== action) {
		return { action, clockStart: tick };
	}
	return state;
}

/**
 * R-GR2-003 bone palette limit.
 * @param {number} boneCount
 */
export function assertBoneCount(boneCount) {
	if (boneCount > GR2_MAX_BONES) {
		throw new RangeError(`GR2 model has ${boneCount} bones; at most ${GR2_MAX_BONES} are supported`);
	}
	return boneCount;
}

/**
 * R-GR2-003 one-frame lag: GR2 poses use the entity state of the previous
 * frame (intentional legacy parity, architecture §7 m8). Pending.
 * @param {Object} _prevEntityState
 * @param {Object} _currentEntityState
 */
export function gr2FrameState(_prevEntityState, _currentEntityState) {
	return notImplemented('R-GR2-003', 'one-frame-behind GR2 entity state');
}

/**
 * R-GR2-004 facing.
 * @param {number} dir 0..7
 */
export function gr2Yaw(dir) {
	return dir * 45;
}

/**
 * R-GR2-004 frustum cull by ground anchor (NDC) with a 0.2 margin; skipped
 * when the entity itself is culled. A culled instance neither poses nor draws.
 * @param {[number, number]} anchorNdc
 * @param {boolean} entityCulled
 */
export function gr2Visible([x, y], entityCulled) {
	if (entityCulled) {
		return false;
	}
	const lim = 1 + GR2_CULL_MARGIN;
	return x >= -lim && x <= lim && y >= -lim && y <= lim;
}

/**
 * R-GR2-005 no removal fade by default; only effectColor alpha; no shadow blob.
 * @param {{effectColorAlpha: number, removing: boolean}} s
 */
export function gr2DrawState({ effectColorAlpha, removing }) {
	return { visible: !removing, alpha: effectColorAlpha, shadow: false };
}
