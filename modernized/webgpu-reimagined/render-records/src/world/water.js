/**
 * R-MAP-010 water opacity: 0.8, or 1.0 for types 4 and 6.
 * @param {number} waterType
 */
export function waterOpacity(waterType) {
	return waterType === 4 || waterType === 6 ? 1.0 : 0.8;
}

/**
 * R-MAP-010 FIX (diverges from legacy, which squared the opacity to 0.64):
 * effective alpha is the opacity, applied once. Shared by both backends.
 * Also R-MAP-009 frame index and R-MAP-011 depth state.
 * @param {{waterType: number, tick: number, animSpeed: number}} s
 * @returns {Partial<import('../records/WorldDraw.js').WorldDraw>}
 */
export function waterDrawFields({ waterType, tick, animSpeed }) {
	const frame = tick / (1000 / 60);
	return {
		part: 'water',
		alpha: waterOpacity(waterType),
		textureIndex: Math.floor(frame / animSpeed) % 32,
		depthTest: true,
		depthWrite: false
	};
}
