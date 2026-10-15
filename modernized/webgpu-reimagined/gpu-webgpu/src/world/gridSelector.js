import { GRID_SELECTOR } from '../constants.js';

/**
 * R-MAP-021: cells to draw the grid selector on.
 * - normal: the hit cell only, if walkable
 * - captcha floor-pick: every walkable cell in the square range around the hit
 * @param {{hit: {x: number, y: number}|null, isWalkable: (x: number, y: number) => boolean, captchaRange?: number}} p
 */
export function gridSelectorCells({ hit, isWalkable, captchaRange = 0 }) {
	if (!hit) {
		return [];
	}
	const cells = [];
	for (let dy = -captchaRange; dy <= captchaRange; dy++) {
		for (let dx = -captchaRange; dx <= captchaRange; dx++) {
			const x = hit.x + dx;
			const y = hit.y + dy;
			if (isWalkable(x, y)) {
				cells.push({ x, y });
			}
		}
	}
	return cells;
}

/**
 * R-MAP-021 quad on the cell's four corner heights, lowered by 0.1 world
 * units (heights are negated in world space, so lowering lifts it visually).
 * @param {{x: number, y: number}} cell
 * @param {[number, number, number, number]} corners  heights at (x,y) (x+1,y) (x,y+1) (x+1,y+1)
 */
export function gridSelectorQuad(cell, corners) {
	const pts = [
		[cell.x, cell.y],
		[cell.x + 1, cell.y],
		[cell.x, cell.y + 1],
		[cell.x + 1, cell.y + 1]
	];
	return {
		vertices: pts.map(([x, y], i) => [x, corners[i] - GRID_SELECTOR.lift, y]),
		alpha: GRID_SELECTOR.alpha,
		tint: [...GRID_SELECTOR.tint],
		texture: GRID_SELECTOR.texture
	};
}
