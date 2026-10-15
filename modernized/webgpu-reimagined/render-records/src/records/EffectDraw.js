import { BLEND_NORMAL } from './blend.js';

/**
 * One effect draw (STR layer, 2D, 3D, cylinder, RSM, QuadHorn, aura, sphere,
 * ground tile, weather particle, screen tint...).
 *
 * @typedef {Object} EffectDraw
 * @property {'effect'} kind
 * @property {string} family      'str' | '2d' | '3d' | 'cylinder' | 'rsm' | 'quadhorn' | 'aura' | ...
 * @property {'before'|'after'} pass  R-EFX-006
 * @property {string|number|null} texture
 * @property {[number, number, number]} position
 * @property {[number, number, number, number]} color
 * @property {import('./blend.js').BlendState} blend  Unified enum (R-EFX-008/011)
 * @property {boolean} depthTest
 * @property {boolean} depthWrite
 * @property {boolean} depthCorrection
 * @property {boolean} fog           R-EFX-010 fix: STR obeys scene fog
 * @property {boolean} strAttachment Run-splitting key component
 * @property {Object} params         Family-specific geometry (uv, xy, angle...)
 */

/** @type {Readonly<Omit<EffectDraw, 'kind'>>} */
export const EFFECT_DEFAULTS = Object.freeze({
	family: 'str',
	pass: 'after',
	texture: null,
	position: [0, 0, 0],
	color: [1, 1, 1, 1],
	blend: BLEND_NORMAL,
	depthTest: true,
	depthWrite: false,
	depthCorrection: false,
	fog: false,
	strAttachment: false,
	params: {}
});

/**
 * @param {Partial<EffectDraw>} fields
 * @returns {Readonly<EffectDraw>}
 */
export function createEffectDraw(fields = {}) {
	return Object.freeze({ ...EFFECT_DEFAULTS, ...fields, kind: 'effect' });
}
