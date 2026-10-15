import { BLEND_ADDITIVE } from '../records/blend.js';

/** R-SPR-024 halo scale (EntityRender.js:607). */
export const HALO_SCALE = 1.15;
/** R-SPR-024 halo effect colour (EntityRender.js:600-603). */
export const HALO_COLOR = Object.freeze([1, 1, 1, 0.6]);
/** R-SPR-024 halo zIndex offset from the element's own zIndex (EntityRender.js:608-609). */
export const HALO_ZINDEX_OFFSET = -100;

/**
 * R-SPR-024 Assumptio halo: derive a halo record from a layer record. Legacy redraws every layer
 * of the element first (EntityRender.js:588-623): layer scale ×1.15, effect colour (1,1,1,0.6)
 * times the layer colour, zIndex starting at the element's zIndex − 100 (relative, not absolute),
 * no depth write and the ADDITIVE blend (renderLayer(…, true), :614).
 * @param {import('../records/SpriteDraw.js').SpriteDraw} layer
 * @returns {Partial<import('../records/SpriteDraw.js').SpriteDraw>}
 */
export function haloFromLayer(layer) {
	return {
		...layer,
		size: [layer.size[0] * HALO_SCALE, layer.size[1] * HALO_SCALE],
		color: [0, 1, 2, 3].map(i => layer.color[i] * HALO_COLOR[i]),
		zIndex: layer.zIndex + HALO_ZINDEX_OFFSET,
		depthWrite: false,
		blend: BLEND_ADDITIVE
	};
}

/**
 * R-SPR-025 after-image trail configuration (EntityRender.js:650-651, 695).
 * @param {{blurType: number, fastMove?: boolean, performanceMode?: boolean, trailLength?: number}} s
 *        fastMove is legacy `isFastMoving` (the moving state, not `_fastMoveTrail`)
 */
export function trailConfig({ blurType, fastMove = false, performanceMode = false, trailLength = 5 }) {
	let interval = 80;
	if (fastMove) {
		interval = 30;
	} else if (blurType === 3 || blurType === 5) {
		interval = 560;
	}
	let maxSnapshots = performanceMode ? Math.floor(trailLength / 2) : trailLength;
	if (blurType === 4) {
		maxSnapshots = 1;
	}
	const duration = blurType === 3 || blurType === 4 ? 800 : 400;
	return { interval, maxSnapshots, duration, white: blurType !== 1 };
}

/**
 * R-SPR-025 snapshot alpha (EntityRender.js:697-708); 0 means the snapshot is not drawn.
 * Legacy drops a snapshot older than the duration or whose base alpha is ≤ 0.05 *before* the
 * type-3 doubling; a type-4 snapshot is never dropped (it fades to alpha 0 and stays stored).
 * @param {number} blurType
 * @param {number} ageMs
 */
export function trailAlpha(blurType, ageMs) {
	const { duration } = trailConfig({ blurType });
	const alpha = Math.max(0, 0.4 * (1 - ageMs / duration));
	if (blurType !== 4 && (ageMs > duration || alpha <= 0.05)) {
		return 0;
	}
	return blurType === 3 ? alpha * 2 : alpha;
}

/**
 * R-SPR-025 trail snapshot zIndex: original −10−i, no depth write.
 * @param {number} originalZIndex
 * @param {number} i snapshot index (newest first; dropped snapshots still count)
 */
export function trailLayerDepth(originalZIndex, i) {
	return { zIndex: originalZIndex - 10 - i, depthWrite: false };
}

/**
 * R-SPR-024/025 halo and trail switches for one frame (legacy renderElement, EntityRender.js:843-865).
 * @param {Object} s
 * @param {Object} s.opt3 {assumptio, energyCoat, bunshin, hallucinationWalk, quicken, overthrust,
 *        explosionSpirits, berserk}
 * @param {boolean} [s.enableHalo]    legacy `_enableHalo` (skill effects)
 * @param {boolean} [s.enableTrail]   legacy `_enableTrail`
 * @param {boolean} [s.fastMoveTrail] legacy `_fastMoveTrail`
 * @param {number} [s.blurType]       legacy `_blurType`
 * @returns {{halo: boolean, trail: boolean, blurType: number}}
 */
export function afterImageFlags({
	opt3 = {},
	enableHalo = false,
	enableTrail = false,
	fastMoveTrail = false,
	blurType
}) {
	const trail =
		!!opt3.energyCoat ||
		!!opt3.bunshin ||
		!!opt3.hallucinationWalk ||
		!!opt3.quicken ||
		!!opt3.overthrust ||
		!!opt3.explosionSpirits ||
		!!opt3.berserk ||
		!!fastMoveTrail ||
		!!enableTrail;
	let type = blurType || 1;
	if (opt3.hallucinationWalk) {
		type = 3;
	}
	if (opt3.bunshin) {
		type = 5;
	}
	return { halo: !!opt3.assumptio || !!enableHalo, trail, blurType: type };
}

/**
 * R-SPR-025 whether a snapshot is taken this frame (EntityRender.js:653-668).
 * @param {Object} s
 * @param {number} s.blurType
 * @param {number} s.action current action id
 * @param {Object} s.actions entity action table (WALK, ATTACK, ATTACK1..3, SKILL)
 * @param {boolean} s.fastMove legacy `isFastMoving`
 * @param {number} s.sinceLast ms since the last snapshot of this trail
 * @param {number} s.stored snapshots currently stored
 * @param {number} s.interval trailConfig().interval
 */
export function shouldCaptureTrail({ blurType, action, actions, fastMove, sinceLast, stored, interval }) {
	if (blurType === 1 || blurType === 3) {
		return (action === actions.WALK || !!fastMove) && sinceLast > interval;
	}
	if (blurType === 4) {
		return stored === 0;
	}
	if (blurType === 5) {
		const combat = [actions.ATTACK, actions.ATTACK1, actions.ATTACK2, actions.ATTACK3, actions.SKILL].includes(
			action
		);
		return (combat || !!fastMove) && sinceLast > interval;
	}
	return false;
}
