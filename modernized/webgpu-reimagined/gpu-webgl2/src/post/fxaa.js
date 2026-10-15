import { FXAA } from '../constants.js';

/**
 * R-PP-006 CPU reference for the FXAA pass (HITL round 2).
 *
 * This file is the single source the tests check. `shaders/fxaa.frag` mirrors it
 * line for line, and gpu-webgpu's `src/post/fxaa.js` must stay identical (a parity
 * test in gpu-webgl2/test/contract/fxaaParity.test.js checks both on a grid of inputs).
 *
 * Edge path: legacy Shaders/GLSL/FXAA.fs, unchanged. Rec.601 luma, early exit when
 * `range < max(edgeThresholdMin, lumaMax * edgeThreshold)` over M and the diagonals,
 * span 8, reduce `max(sum * 1/32, 1/128)`, then rgbA or rgbB.
 *
 * Subpixel term: FXAA 3.11 (Timothy Lottes, quality preset) subpix block driven by
 * `fxaaSubpix` (0 = off). The 3x3 lowpass luma gives subpixA..H; FXAA 3.11 picks the
 * edge normal and the steeper neighbour across the edge, then blends towards it by
 * `max(edgeBlend, subpixH)`. The legacy edge path has no pixel offset of its own, so
 * `edgeBlend` is the fraction of the way to that neighbour the edge result already
 * moved M (in luma). When `subpixH <= edgeBlend` the legacy edge result is kept, so
 * `fxaaSubpix` 0 is identical to legacy.
 */

/** Legacy FXAA.fs luminance (Rec.601). */
export const fxaaLuma = rgb => rgb[0] * 0.299 + rgb[1] * 0.587 + rgb[2] * 0.114;

const saturate = v => Math.min(Math.max(v, 0), 1);
const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/**
 * FXAA 3.11 subpix block.
 * @param {{m: number, n: number, s: number, w: number, e: number, nw: number, ne: number, sw: number, se: number}} l
 *   lumas of the 3x3 neighbourhood
 * @param {number} subpix  fxaaQualitySubpix (0 = off)
 * @returns {number} subpixH
 */
export function fxaaSubpixH(l, subpix) {
	const range = Math.max(l.m, l.n, l.s, l.w, l.e) - Math.min(l.m, l.n, l.s, l.w, l.e);
	const subpixA = (l.n + l.s + l.w + l.e) * 2 + (l.nw + l.sw + l.ne + l.se);
	const subpixB = subpixA * (1 / 12) - l.m;
	const subpixC = range > 0 ? saturate(Math.abs(subpixB) / range) : 0;
	const subpixD = -2 * subpixC + 3;
	const subpixE = subpixC * subpixC;
	const subpixF = subpixD * subpixE;
	const subpixG = subpixF * subpixF;
	return subpixG * subpix;
}

/**
 * FXAA 3.11 edge orientation: the neighbour across the edge (offset in texels).
 * @param {{m: number, n: number, s: number, w: number, e: number, nw: number, ne: number, sw: number, se: number}} l
 * @returns {[number, number]}
 */
export function fxaaAcrossOffset(l) {
	const edgeHorz =
		Math.abs(-2 * l.w + (l.nw + l.sw)) + Math.abs(-2 * l.m + (l.n + l.s)) * 2 + Math.abs(-2 * l.e + (l.ne + l.se));
	const edgeVert =
		Math.abs(-2 * l.s + (l.sw + l.se)) + Math.abs(-2 * l.m + (l.w + l.e)) * 2 + Math.abs(-2 * l.n + (l.nw + l.ne));
	const horzSpan = edgeHorz >= edgeVert;
	const lumaN = horzSpan ? l.n : l.w;
	const lumaS = horzSpan ? l.s : l.e;
	const pairN = Math.abs(lumaN - l.m) >= Math.abs(lumaS - l.m);
	const sign = pairN ? -1 : 1;
	return horzSpan ? [0, sign] : [sign, 0];
}

/**
 * R-PP-006 FXAA for one pixel.
 * @param {(dx: number, dy: number) => number[]} sample  rgb at a texel offset from the pixel
 *   (bilinear, clamp-to-edge, as the GPU sampler does)
 * @param {{edgeThreshold: number, edgeThresholdMin: number, span?: number, reduceMul?: number,
 *   reduceMin?: number, subpix: number}} u  the `fxaaUniforms` output
 * @returns {number[]} rgb
 */
export function fxaaReference(sample, u) {
	const { span = FXAA.span, reduceMul = FXAA.reduceMul, reduceMin = FXAA.reduceMin } = u;
	const rgbM = sample(0, 0);
	const m = fxaaLuma(rgbM);
	const nw = fxaaLuma(sample(-1, -1));
	const ne = fxaaLuma(sample(1, -1));
	const sw = fxaaLuma(sample(-1, 1));
	const se = fxaaLuma(sample(1, 1));
	const lumaMin = Math.min(m, nw, ne, sw, se);
	const lumaMax = Math.max(m, nw, ne, sw, se);
	if (lumaMax - lumaMin < Math.max(u.edgeThresholdMin, lumaMax * u.edgeThreshold)) {
		return rgbM;
	}

	// Legacy edge path (FXAA.fs).
	let dirX = -(nw + ne - (sw + se));
	let dirY = nw + sw - (ne + se);
	const dirReduce = Math.max((nw + ne + sw + se) * reduceMul, reduceMin);
	const rcpDirMin = 1 / (Math.min(Math.abs(dirX), Math.abs(dirY)) + dirReduce);
	dirX = Math.min(span, Math.max(-span, dirX * rcpDirMin));
	dirY = Math.min(span, Math.max(-span, dirY * rcpDirMin));
	const a0 = sample(dirX * (1 / 3 - 0.5), dirY * (1 / 3 - 0.5));
	const a1 = sample(dirX * (2 / 3 - 0.5), dirY * (2 / 3 - 0.5));
	const b0 = sample(dirX * -0.5, dirY * -0.5);
	const b1 = sample(dirX * 0.5, dirY * 0.5);
	const rgbA = [0.5 * (a0[0] + a1[0]), 0.5 * (a0[1] + a1[1]), 0.5 * (a0[2] + a1[2])];
	const rgbB = [
		rgbA[0] * 0.5 + 0.25 * (b0[0] + b1[0]),
		rgbA[1] * 0.5 + 0.25 * (b0[1] + b1[1]),
		rgbA[2] * 0.5 + 0.25 * (b0[2] + b1[2])
	];
	const lumaB = fxaaLuma(rgbB);
	const rgbEdge = lumaB < lumaMin || lumaB > lumaMax ? rgbA : rgbB;

	// FXAA 3.11 subpixel aliasing removal.
	const l = {
		m,
		nw,
		ne,
		sw,
		se,
		n: fxaaLuma(sample(0, -1)),
		s: fxaaLuma(sample(0, 1)),
		w: fxaaLuma(sample(-1, 0)),
		e: fxaaLuma(sample(1, 0))
	};
	const subpixH = fxaaSubpixH(l, u.subpix);
	const [ax, ay] = fxaaAcrossOffset(l);
	const rgbAcross = sample(ax, ay);
	const toAcross = fxaaLuma(rgbAcross) - m;
	const edgeBlend = toAcross !== 0 ? saturate((fxaaLuma(rgbEdge) - m) / toAcross) : 1;
	return Math.max(edgeBlend, subpixH) === edgeBlend ? rgbEdge : mix3(rgbM, rgbAcross, subpixH);
}
