import { BLEND_NORMAL } from './blend.js';

/**
 * World-side records whose CPU logic lives in render-records: water opacity
 * (R-MAP-010 fix), animated RSM matrices (R-MAP-016/017) and GR2 instance draws
 * (R-GR2-001/003…005: bone palette, world matrix, emblem, light). Static ground and
 * model geometry is owned by the gpu-* backends.
 *
 * @typedef {Object} WorldDraw
 * @property {'world'} kind
 * @property {'water'|'animatedModel'|'gr2'} part
 * @property {number} alpha
 * @property {Float32Array|null} matrices  Node × instance matrices (animatedModel) or the bone palette (gr2), 16 floats each
 * @property {number} textureIndex        Water frame index (R-MAP-009)
 * @property {import('./blend.js').BlendState} blend
 * @property {boolean} depthTest
 * @property {boolean} depthWrite
 * @property {Object} params
 */

/** @type {Readonly<Omit<WorldDraw, 'kind'>>} */
export const WORLD_DEFAULTS = Object.freeze({
	part: 'water',
	alpha: 1,
	matrices: null,
	textureIndex: 0,
	blend: BLEND_NORMAL,
	depthTest: true,
	depthWrite: true,
	params: {}
});

/**
 * @param {Partial<WorldDraw>} fields
 * @returns {Readonly<WorldDraw>}
 */
export function createWorldDraw(fields = {}) {
	return Object.freeze({ ...WORLD_DEFAULTS, ...fields, kind: 'world' });
}
