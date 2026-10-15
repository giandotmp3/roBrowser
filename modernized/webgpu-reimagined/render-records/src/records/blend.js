/**
 * Unified blend enum (architecture §2.2: "The STR D3D table and the 2D/3D GL
 * table normalise into one blend enum here"). Backends map these neutral
 * factor names onto GL enums or WebGPU GPUBlendFactor values.
 */

/** @enum {string} */
export const BlendFactor = Object.freeze({
	ZERO: 'ZERO',
	ONE: 'ONE',
	SRC_COLOR: 'SRC_COLOR',
	ONE_MINUS_SRC_COLOR: 'ONE_MINUS_SRC_COLOR',
	SRC_ALPHA: 'SRC_ALPHA',
	ONE_MINUS_SRC_ALPHA: 'ONE_MINUS_SRC_ALPHA',
	DST_COLOR: 'DST_COLOR',
	ONE_MINUS_DST_COLOR: 'ONE_MINUS_DST_COLOR',
	DST_ALPHA: 'DST_ALPHA',
	ONE_MINUS_DST_ALPHA: 'ONE_MINUS_DST_ALPHA',
	SRC_ALPHA_SATURATE: 'SRC_ALPHA_SATURATE',
	CONSTANT_COLOR: 'CONSTANT_COLOR',
	ONE_MINUS_CONSTANT_COLOR: 'ONE_MINUS_CONSTANT_COLOR',
	CONSTANT_ALPHA: 'CONSTANT_ALPHA',
	ONE_MINUS_CONSTANT_ALPHA: 'ONE_MINUS_CONSTANT_ALPHA'
});

/**
 * @typedef {Object} BlendState
 * @property {BlendFactor} src
 * @property {BlendFactor} dst
 */

/** @type {Readonly<BlendState>} Default pipeline blend (R-CTX-002) */
export const BLEND_NORMAL = Object.freeze({ src: BlendFactor.SRC_ALPHA, dst: BlendFactor.ONE_MINUS_SRC_ALPHA });

/** @type {Readonly<BlendState>} Additive blend (R-SPR-023, R-EFX-014) */
export const BLEND_ADDITIVE = Object.freeze({ src: BlendFactor.SRC_ALPHA, dst: BlendFactor.ONE });

/**
 * STR files use the Direct3D D3DBLEND numbering (R-EFX-008).
 * 12 and 13 are not defined by the legacy table.
 * @type {Readonly<Record<number, BlendFactor>>}
 */
export const D3D_BLEND_TABLE = Object.freeze({
	1: BlendFactor.ZERO,
	2: BlendFactor.ONE,
	3: BlendFactor.SRC_COLOR,
	4: BlendFactor.ONE_MINUS_SRC_COLOR,
	5: BlendFactor.SRC_ALPHA,
	6: BlendFactor.ONE_MINUS_SRC_ALPHA,
	7: BlendFactor.DST_ALPHA,
	8: BlendFactor.ONE_MINUS_DST_ALPHA,
	9: BlendFactor.DST_COLOR,
	10: BlendFactor.ONE_MINUS_DST_COLOR,
	11: BlendFactor.SRC_ALPHA_SATURATE,
	14: BlendFactor.CONSTANT_COLOR,
	15: BlendFactor.ONE_MINUS_CONSTANT_ALPHA
});

/**
 * 2D / 3D / Cylinder / QuadHorn effects use GL-order numbering for the
 * destination factor (R-EFX-011). Source is always SRC_ALPHA.
 * @type {Readonly<Record<number, BlendFactor>>}
 */
export const GL_ORDER_BLEND_TABLE = Object.freeze({
	1: BlendFactor.ZERO,
	2: BlendFactor.ONE,
	3: BlendFactor.SRC_COLOR,
	4: BlendFactor.ONE_MINUS_SRC_COLOR,
	5: BlendFactor.DST_COLOR,
	6: BlendFactor.ONE_MINUS_DST_COLOR,
	7: BlendFactor.SRC_ALPHA,
	8: BlendFactor.ONE_MINUS_SRC_ALPHA,
	9: BlendFactor.DST_ALPHA,
	10: BlendFactor.ONE_MINUS_DST_ALPHA,
	11: BlendFactor.CONSTANT_COLOR,
	12: BlendFactor.ONE_MINUS_CONSTANT_COLOR,
	13: BlendFactor.CONSTANT_ALPHA,
	14: BlendFactor.ONE_MINUS_CONSTANT_ALPHA,
	15: BlendFactor.SRC_ALPHA_SATURATE
});

/**
 * Normalise an STR (D3DBLEND) src/dst pair into the unified enum.
 * Unknown codes fall back to normal alpha blending (secure, visible default).
 * @param {number} srcCode
 * @param {number} dstCode
 * @returns {Readonly<BlendState>}
 */
export function blendFromStr(srcCode, dstCode) {
	const src = D3D_BLEND_TABLE[srcCode];
	const dst = D3D_BLEND_TABLE[dstCode];
	if (!src || !dst) {
		return BLEND_NORMAL;
	}
	return Object.freeze({ src, dst });
}

/**
 * Normalise a 2D/3D/Cylinder/QuadHorn `blendMode` into the unified enum.
 * 0 or out-of-range means normal alpha blending (R-EFX-011).
 * @param {number} blendMode
 * @returns {Readonly<BlendState>}
 */
export function blendFromEffectMode(blendMode) {
	if (!(blendMode > 0 && blendMode < 16)) {
		return BLEND_NORMAL;
	}
	return Object.freeze({ src: BlendFactor.SRC_ALPHA, dst: GL_ORDER_BLEND_TABLE[blendMode] });
}

/**
 * @param {BlendState} blend
 * @returns {boolean} True when the backend must set a blend constant as run state
 */
export function usesBlendConstant(blend) {
	return [blend.src, blend.dst].some(f => f.includes('CONSTANT'));
}

/**
 * @param {BlendState} blend
 * @returns {string}
 */
export function blendKey(blend) {
	return `${blend.src}|${blend.dst}`;
}
