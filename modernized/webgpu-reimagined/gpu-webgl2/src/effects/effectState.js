import { POISON_TINT } from '../constants.js';

/**
 * R-EFX-013: overlay effects disable depth test and correction; non-overlay
 * effects test depth; 2D effects also write it.
 * @param {{overlay: boolean, family: string}} e
 */
export function effectDepthState(e) {
	if (e.overlay) {
		return { depthTest: false, depthWrite: false, depthCorrection: false };
	}
	return { depthTest: true, depthWrite: e.family === '2d', depthCorrection: true };
}

/** R-EFX-014: families drawn with SRC_ALPHA, ONE. */
export const ADDITIVE_FAMILIES = Object.freeze([
	'groundAura',
	'swirlingAura',
	'level99Bubble',
	'spiritSphere',
	'warlockSphere',
	'pokjuk',
	'waterfall'
]);

/** @param {string} family */
export function familyBlend(family) {
	return ADDITIVE_FAMILIES.includes(family)
		? { src: 'SRC_ALPHA', dst: 'ONE' }
		: { src: 'SRC_ALPHA', dst: 'ONE_MINUS_SRC_ALPHA' };
}

/**
 * R-EFX-018: local player poisoned → 4000×4000 billboard (0.5, 0, 0.5, 0.15) at the player, no depth.
 * @param {number[]} playerPos
 */
export function poisonTintQuad(playerPos) {
	return {
		position: [...playerPos],
		size: [POISON_TINT.size, POISON_TINT.size],
		color: [...POISON_TINT.color],
		depthTest: false,
		depthWrite: false
	};
}
