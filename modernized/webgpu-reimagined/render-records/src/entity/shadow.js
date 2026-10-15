import { Action, NO_SHADOW_JOB, SHADOW_LIFT } from './constants.js';

/**
 * R-SPR-011 should a shadow be drawn?
 * @param {{action: number, job: number, hideShadow?: boolean}} e
 */
export function shouldDrawShadow({ action, job, hideShadow = false }) {
	return !(action === Action.DIE || action === Action.SIT || job === NO_SHADOW_JOB || hideShadow);
}

/**
 * R-SPR-011 shadow layer parameters.
 * @param {{job: number, isItem?: boolean, cellHeight: number}} e
 * @param {Record<number, number>} shadowTable ShadowTable[job]
 */
export function shadowLayer({ job, isItem = false, cellHeight }, shadowTable = {}) {
	return {
		z: cellHeight + SHADOW_LIFT,
		frame: 0,
		scale: isItem ? 0.25 : (shadowTable[job] ?? 1.0),
		ignoreEffectColor: true,
		color: [1, 1, 1, 1],
		depthTest: true,
		depthWrite: false,
		depthCorrection: true
	};
}

/**
 * R-SPR-012 ground shadow factor: 6×6 average of the 8-per-tile shadow map
 * around (x, y), /255. Returns 1.0 before the map has loaded.
 * Off-map samples count as 255.
 * @param {Uint8Array|null} shadowMap  (width·8) × (height·8) / 4 bytes, row-major as in Loaders/Ground
 * @param {number} mapWidth  GND width (cells/2)
 * @param {number} x
 * @param {number} y
 */
export function shadowFactorAt(shadowMap, mapWidth, x, y) {
	if (!shadowMap) {
		return 1.0;
	}
	const px = x + 0.5;
	const py = y + 0.5;
	const bx = Math.floor(px / 2) * 8 + Math.min((Math.floor(px) & 1 ? 4 : 0) + Math.floor((px % 1) * 4), 6);
	const by = Math.floor(py / 2) * 8 + Math.min((Math.floor(py) & 1 ? 4 : 0) + Math.floor((py % 1) * 4), 6);
	let sum = 0;
	for (let dy = -3; dy < 3; ++dy) {
		for (let dx = -3; dx < 3; ++dx) {
			const v = shadowMap[bx + dx + (by + dy) * mapWidth * 8];
			sum += v === undefined ? 255 : v;
		}
	}
	return sum / 36 / 255;
}
