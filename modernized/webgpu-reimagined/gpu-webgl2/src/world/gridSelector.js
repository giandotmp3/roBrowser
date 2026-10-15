import { GRID_SELECTOR } from '../constants.js';

/**
 * R-MAP-021: build selector quads. Walkable cells only; captcha floor-pick
 * draws every walkable cell in the square range. Each quad sits on the cell's
 * four corner heights lowered by 0.1 (RO's inverted Y: lower value = higher).
 * @param {{x: number, y: number}|null} hit
 * @param {{isWalkable(x: number, y: number): boolean, cornerHeights(x: number, y: number): number[]}} altitude
 * @param {{range: number}|null} captcha
 */
export function selectorQuads(hit, altitude, captcha = null) {
	if (!hit) {
		return [];
	}
	const cells = [];
	const r = captcha ? captcha.range : 0;
	for (let dy = -r; dy <= r; dy++) {
		for (let dx = -r; dx <= r; dx++) {
			const x = hit.x + dx;
			const y = hit.y + dy;
			if (altitude.isWalkable(x, y)) {
				cells.push({ x, y, heights: altitude.cornerHeights(x, y).map(h => h - GRID_SELECTOR.lift) });
			}
		}
	}
	return cells;
}

/** R-MAP-021: grid.tga at alpha 0.6 tinted rgb(50,240,160) via source-atop (done once at upload). */
export const GRID_MATERIAL = Object.freeze({ texture: GRID_SELECTOR.texture, alpha: GRID_SELECTOR.alpha, tint: GRID_SELECTOR.tint, composite: 'source-atop' });
