import { GL } from './glEnums.js';

/**
 * Unified blend enum (render-records) → GL blend factor. The STR D3D table and
 * the 2D/3D GL-order table were normalised upstream (R-EFX-008, R-EFX-011), so
 * this backend has exactly one mapping.
 * @type {Readonly<Record<string, number>>}
 */
export const GL_BLEND_FACTOR = Object.freeze({
	ZERO: GL.ZERO,
	ONE: GL.ONE,
	SRC_COLOR: GL.SRC_COLOR,
	ONE_MINUS_SRC_COLOR: GL.ONE_MINUS_SRC_COLOR,
	SRC_ALPHA: GL.SRC_ALPHA,
	ONE_MINUS_SRC_ALPHA: GL.ONE_MINUS_SRC_ALPHA,
	DST_COLOR: GL.DST_COLOR,
	ONE_MINUS_DST_COLOR: GL.ONE_MINUS_DST_COLOR,
	DST_ALPHA: GL.DST_ALPHA,
	ONE_MINUS_DST_ALPHA: GL.ONE_MINUS_DST_ALPHA,
	SRC_ALPHA_SATURATE: GL.SRC_ALPHA_SATURATE,
	CONSTANT_COLOR: GL.CONSTANT_COLOR,
	ONE_MINUS_CONSTANT_COLOR: GL.ONE_MINUS_CONSTANT_COLOR,
	CONSTANT_ALPHA: GL.CONSTANT_ALPHA,
	ONE_MINUS_CONSTANT_ALPHA: GL.ONE_MINUS_CONSTANT_ALPHA
});

/** R-CTX-002 default pair. */
export const DEFAULT_BLEND = Object.freeze({ src: 'SRC_ALPHA', dst: 'ONE_MINUS_SRC_ALPHA' });

/**
 * Map a unified BlendState to GL enums. Unknown factors fall back to the
 * default pair (visible, never silently additive).
 * @param {import('../ports.js').BlendState} blend
 * @returns {{src: number, dst: number}}
 */
export function toGlBlend(blend) {
	const src = GL_BLEND_FACTOR[blend?.src];
	const dst = GL_BLEND_FACTOR[blend?.dst];
	if (src === undefined || dst === undefined) {
		return { src: GL.SRC_ALPHA, dst: GL.ONE_MINUS_SRC_ALPHA };
	}
	return { src, dst };
}

/**
 * @param {import('../ports.js').BlendState} blend
 * @returns {boolean} Whether a blend constant must be set as run state (D3D 14/15)
 */
export function usesBlendConstant(blend) {
	return [blend?.src, blend?.dst].some(f => typeof f === 'string' && f.includes('CONSTANT'));
}
