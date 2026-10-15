/**
 * R-SPR-024 Assumptio halo: derive a halo record from a layer record.
 * @param {import('../records/SpriteDraw.js').SpriteDraw} layer
 * @returns {Partial<import('../records/SpriteDraw.js').SpriteDraw>}
 */
export function haloFromLayer(layer) {
	return {
		...layer,
		size: [layer.size[0] * 1.15, layer.size[1] * 1.15],
		color: [1, 1, 1, 0.6],
		zIndex: -100,
		depthWrite: false
	};
}

/**
 * R-SPR-025 after-image trail configuration.
 * @param {{blurType: number, fastMove?: boolean, performanceMode?: boolean}} s
 */
export function trailConfig({ blurType, fastMove = false, performanceMode = false }) {
	let interval = 80;
	if (fastMove) {
		interval = 30;
	} else if (blurType === 3 || blurType === 5) {
		interval = 560;
	}
	let maxSnapshots = performanceMode ? 2 : 5;
	if (blurType === 4) {
		maxSnapshots = 1;
	}
	const duration = blurType === 3 || blurType === 4 ? 800 : 400;
	return { interval, maxSnapshots, duration, white: blurType !== 1 };
}

/**
 * R-SPR-025 snapshot alpha; returns 0 when the snapshot must be dropped (< 0.05).
 * @param {number} blurType
 * @param {number} ageMs
 */
export function trailAlpha(blurType, ageMs) {
	const { duration } = trailConfig({ blurType });
	let alpha = 0.4 * (1 - ageMs / duration);
	if (blurType === 3) {
		alpha *= 2;
	}
	return alpha < 0.05 ? 0 : alpha;
}

/**
 * R-SPR-025 trail snapshot zIndex: original −10−i, no depth write.
 * @param {number} originalZIndex
 * @param {number} i snapshot index
 */
export function trailLayerDepth(originalZIndex, i) {
	return { zIndex: originalZIndex - 10 - i, depthWrite: false };
}
