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

const CONSTANT_COLOR_FACTORS = Object.freeze(['CONSTANT_COLOR', 'ONE_MINUS_CONSTANT_COLOR']);
const CONSTANT_ALPHA_FACTORS = Object.freeze(['CONSTANT_ALPHA', 'ONE_MINUS_CONSTANT_ALPHA']);

/**
 * WebGL rejects (INVALID_OPERATION) a blend pair that mixes a constant-colour factor
 * with a constant-alpha factor (WebGL 1.0 §6.13, kept by WebGL 2), e.g. the STR
 * D3D pair 14/15. Legacy then keeps the previous draw's blend: not reproducible.
 * @param {import('../ports.js').BlendState} blend
 */
export function isWebGLInvalidBlend(blend) {
	const factors = [blend?.src, blend?.dst];
	return (
		factors.some(f => CONSTANT_COLOR_FACTORS.includes(/** @type {string} */ (f))) &&
		factors.some(f => CONSTANT_ALPHA_FACTORS.includes(/** @type {string} */ (f)))
	);
}

/**
 * Map a unified BlendState to GL enums. Unknown factors, a missing state (legacy
 * invalid codes, #41/#49) and pairs WebGL rejects (`isWebGLInvalidBlend`) fall
 * back to the default pair (visible, never silently additive), as decided for
 * #41/#49: legacy's result there depends on prior GL state.
 * @param {import('../ports.js').BlendState} blend
 * @returns {{src: number, dst: number}}
 */
export function toGlBlend(blend) {
	const src = GL_BLEND_FACTOR[blend?.src];
	const dst = GL_BLEND_FACTOR[blend?.dst];
	if (src === undefined || dst === undefined || isWebGLInvalidBlend(blend)) {
		return { src: GL.SRC_ALPHA, dst: GL.ONE_MINUS_SRC_ALPHA };
	}
	return { src, dst };
}

/**
 * @param {import('../ports.js').BlendState} blend
 * @returns {boolean} Whether a blend constant must be set as run state (D3D 14/15)
 */
export function usesBlendConstant(blend) {
	return (
		!isWebGLInvalidBlend(blend) &&
		[blend?.src, blend?.dst].some(f => typeof f === 'string' && f.includes('CONSTANT'))
	);
}
