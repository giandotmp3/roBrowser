import { CELL_MIDDLE_Y } from '../constants.js';

/**
 * Canvas2D transform for one SpriteDraw record (legacy RenderCanvas2D,
 * SpriteRenderer.js:252-290).
 *
 * In the 2D path the record's `offset` and `size` are **pixels** (render-records
 * emits them with the bind2DContext sprite size of 5, i.e. 1 px per sprite px).
 *
 * Mirroring: a negative size component, or `mirror: true` on the record, flips
 * that axis via `scale(-1, ...)`; the drawn size is always positive.
 *
 * @typedef {Object} DrawTransform
 * @property {number} tx       translate x (integer, `| 0`)
 * @property {number} ty       translate y (integer, `| 0`), includes the -17.5 px cell middle
 * @property {number} rotation radians
 * @property {number} scaleX   ±1
 * @property {number} scaleY   ±1
 * @property {number} dx       destination x (-w >> 1)
 * @property {number} dy       destination y (-h >> 1)
 * @property {number} dw       destination width (w | 0)
 * @property {number} dh       destination height (h | 0)
 *
 * @param {{offset?: ArrayLike<number>, size: ArrayLike<number>, angle?: number, mirror?: boolean}} record
 * @param {[number, number]} origin  bound 2D origin (legacy `bind2DContext(ctx, x, y)`)
 * @returns {DrawTransform}
 */
export function computeDrawTransform(record, origin) {
	const offset = record.offset ?? [0, 0];
	let w = record.size[0];
	let h = record.size[1];
	let scaleX = 1;
	let scaleY = 1;

	if (w < 0) {
		scaleX = -1;
		w = -w;
	}
	if (h < 0) {
		scaleY = -1;
		h = -h;
	}
	if (record.mirror) {
		scaleX = -scaleX;
	}

	return {
		tx: (origin[0] + offset[0]) | 0,
		ty: (origin[1] + offset[1] - CELL_MIDDLE_Y) | 0,
		rotation: ((record.angle ?? 0) / 180) * Math.PI,
		scaleX,
		scaleY,
		dx: -w >> 1,
		dy: -h >> 1,
		dw: w | 0,
		dh: h | 0
	};
}
