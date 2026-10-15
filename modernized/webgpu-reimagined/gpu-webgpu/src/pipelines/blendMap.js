/**
 * Maps the backend-neutral blend enum from render-records (BlendFactor names)
 * onto GPUBlendFactor. WebGPU has a single blend constant; GL CONSTANT_ALPHA
 * factors are expressed as 'constant'/'one-minus-constant' with the constant
 * splatted to (a,a,a,a) and set via setBlendConstant as run state (architecture §2.2).
 * Legacy never calls gl.blendColor, so the default constant is (0,0,0,0).
 */
const FACTORS = Object.freeze({
	ZERO: 'zero',
	ONE: 'one',
	SRC_COLOR: 'src',
	ONE_MINUS_SRC_COLOR: 'one-minus-src',
	SRC_ALPHA: 'src-alpha',
	ONE_MINUS_SRC_ALPHA: 'one-minus-src-alpha',
	DST_COLOR: 'dst',
	ONE_MINUS_DST_COLOR: 'one-minus-dst',
	DST_ALPHA: 'dst-alpha',
	ONE_MINUS_DST_ALPHA: 'one-minus-dst-alpha',
	SRC_ALPHA_SATURATE: 'src-alpha-saturated',
	CONSTANT_COLOR: 'constant',
	ONE_MINUS_CONSTANT_COLOR: 'one-minus-constant',
	CONSTANT_ALPHA: 'constant',
	ONE_MINUS_CONSTANT_ALPHA: 'one-minus-constant'
});

export const LEGACY_BLEND_CONSTANT = Object.freeze([0, 0, 0, 0]);

/**
 * STR files use D3DBLEND numbering (R-EFX-008). Kept here as a GPU-side
 * cross-check table; normalisation itself happens in render-records.
 */
export const D3D_TO_GPU = Object.freeze({
	1: 'zero',
	2: 'one',
	3: 'src',
	4: 'one-minus-src',
	5: 'src-alpha',
	6: 'one-minus-src-alpha',
	7: 'dst-alpha',
	8: 'one-minus-dst-alpha',
	9: 'dst',
	10: 'one-minus-dst',
	11: 'src-alpha-saturated',
	14: 'constant',
	15: 'one-minus-constant'
});

/**
 * @param {string} factor  BlendFactor name from render-records
 * @returns {GPUBlendFactor}
 */
export function toGpuFactor(factor) {
	const out = FACTORS[factor];
	if (!out) {
		throw new RangeError(`Unknown blend factor ${factor}`);
	}
	return /** @type {GPUBlendFactor} */ (out);
}

/**
 * @param {{src: string, dst: string}} blend
 * @returns {{color: GPUBlendComponent, alpha: GPUBlendComponent}}
 */
export function toGpuBlend(blend) {
	const srcFactor = toGpuFactor(blend.src);
	const dstFactor = toGpuFactor(blend.dst);
	const component = { srcFactor, dstFactor, operation: 'add' };
	return { color: { ...component }, alpha: { ...component } };
}

/**
 * Blend constant to set as run state for a blend pair.
 * @param {{src: string, dst: string}} blend
 * @param {[number, number, number, number]} [constant]
 */
export function blendConstantFor(blend, constant = /** @type {any} */ (LEGACY_BLEND_CONSTANT)) {
	const usesAlphaConstant = [blend.src, blend.dst].some(
		f => f === 'CONSTANT_ALPHA' || f === 'ONE_MINUS_CONSTANT_ALPHA'
	);
	if (usesAlphaConstant) {
		const a = constant[3];
		return [a, a, a, a];
	}
	return [...constant];
}

const NORMAL_PAIR = Object.freeze({ src: 'SRC_ALPHA', dst: 'ONE_MINUS_SRC_ALPHA' });
const CONSTANT_COLOR_FACTORS = Object.freeze(['CONSTANT_COLOR', 'ONE_MINUS_CONSTANT_COLOR']);
const CONSTANT_ALPHA_FACTORS = Object.freeze(['CONSTANT_ALPHA', 'ONE_MINUS_CONSTANT_ALPHA']);

/**
 * A pair that reads both the constant colour and the constant alpha (e.g. the STR
 * D3D pair 14/15: CONSTANT_COLOR, ONE_MINUS_CONSTANT_ALPHA). WebGPU has one blend
 * constant, so it expresses such a pair only for a splat constant (r = g = b = a);
 * WebGL rejects it outright (INVALID_OPERATION, WebGL 1.0 §6.13), so legacy keeps the
 * previous draw's blend there, which is not reproducible. Both backends draw it as
 * normal alpha (gpu-webgl2 `isWebGLInvalidBlend`), so they agree.
 * @param {{src?: string, dst?: string}|null|undefined} blend
 */
export function isMixedConstantBlend(blend) {
	const factors = [blend?.src, blend?.dst];
	return (
		factors.some(f => CONSTANT_COLOR_FACTORS.includes(/** @type {string} */ (f))) &&
		factors.some(f => CONSTANT_ALPHA_FACTORS.includes(/** @type {string} */ (f)))
	);
}

/**
 * The blend pair a record is drawn with. Unknown factors and a missing state (legacy
 * invalid codes, #41/#49, decided: normal alpha) and pairs WebGPU cannot express
 * faithfully (`isMixedConstantBlend`) fall back to the R-CTX-002 normal pair, as
 * gpu-webgl2 `toGlBlend` does. Every other pair of the unified enum is valid WebGPU
 * (all 13×13 factor pairs pass pipeline validation in Dawn), so it is kept verbatim.
 * @param {{src?: string, dst?: string}|null|undefined} blend
 * @returns {{src: string, dst: string}}
 */
export function resolveBlend(blend) {
	if (!FACTORS[/** @type {string} */ (blend?.src)] || !FACTORS[/** @type {string} */ (blend?.dst)]) {
		return NORMAL_PAIR;
	}
	if (isMixedConstantBlend(blend)) {
		return NORMAL_PAIR;
	}
	return /** @type {{src: string, dst: string}} */ (blend);
}

/**
 * Whether a (resolved) pair reads the blend constant, which is then set as run state
 * (`setBlendConstant(blendConstantFor(pair))`; legacy's is the GL default 0, 0, 0, 0).
 * @param {{src: string, dst: string}} blend
 */
export function usesBlendConstant(blend) {
	return [blend.src, blend.dst].some(f => typeof f === 'string' && f.includes('CONSTANT'));
}
