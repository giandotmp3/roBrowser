/**
 * R-PP-006 test support: small RGB images, a bilinear clamp-to-edge sampler (what the
 * GPU sampler does) and a transcription of legacy Shaders/GLSL/FXAA.fs as the oracle
 * for `fxaaSubpix` 0.
 */

/** @param {number} w @param {number} h @param {(x: number, y: number) => number[]} fn */
export const makeImage = (w, h, fn) => ({
	w,
	h,
	px: Array.from({ length: w * h }, (_, i) => fn(i % w, Math.floor(i / w)))
});

/** Bilinear, clamp-to-edge sampler centred on pixel (cx, cy); offsets are in texels. */
export function samplerAt(img, cx, cy) {
	const at = (x, y) =>
		img.px[Math.min(Math.max(y, 0), img.h - 1) * img.w + Math.min(Math.max(x, 0), img.w - 1)];
	return (dx, dy) => {
		const x = cx + dx;
		const y = cy + dy;
		const x0 = Math.floor(x);
		const y0 = Math.floor(y);
		const fx = x - x0;
		const fy = y - y0;
		const c00 = at(x0, y0);
		const c10 = at(x0 + 1, y0);
		const c01 = at(x0, y0 + 1);
		const c11 = at(x0 + 1, y0 + 1);
		return [0, 1, 2].map(
			k => (c00[k] * (1 - fx) + c10[k] * fx) * (1 - fy) + (c01[k] * (1 - fx) + c11[k] * fx) * fy
		);
	};
}

/** Deterministic LCG in [0, 1). */
export function lcg(seed) {
	let s = seed >>> 0;
	return () => {
		s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
		return s / 4294967296;
	};
}

export const noiseImage = (seed, w = 8, h = 8) => {
	const r = lcg(seed);
	return makeImage(w, h, () => [r(), r(), r()]);
};
export const stepImage = (w = 8, h = 8) => makeImage(w, h, x => (x < w / 2 ? [0, 0, 0] : [1, 1, 1]));
export const diagonalImage = (w = 8, h = 8) => makeImage(w, h, (x, y) => (x > y ? [1, 0.5, 0.25] : [0.1, 0.1, 0.1]));
export const dotImage = (w = 5, h = 5) =>
	makeImage(w, h, (x, y) => (x === Math.floor(w / 2) && y === Math.floor(h / 2) ? [1, 1, 1] : [0, 0, 0]));
export const flatImage = (w = 4, h = 4) => makeImage(w, h, () => [0.4, 0.4, 0.4]);

/** Legacy Shaders/GLSL/FXAA.fs, transcribed (fxaaSubpix uploaded but unused). */
export function legacyFxaaFs(sample, edgeThreshold) {
	const luminance = c => c[0] * 0.299 + c[1] * 0.587 + c[2] * 0.114;
	const rgbM = sample(0, 0);
	const lumaM = luminance(rgbM);
	const lumaNW = luminance(sample(-1, -1));
	const lumaNE = luminance(sample(1, -1));
	const lumaSW = luminance(sample(-1, 1));
	const lumaSE = luminance(sample(1, 1));
	const lumaMin = Math.min(lumaM, Math.min(Math.min(lumaNW, lumaNE), Math.min(lumaSW, lumaSE)));
	const lumaMax = Math.max(lumaM, Math.max(Math.max(lumaNW, lumaNE), Math.max(lumaSW, lumaSE)));
	if (lumaMax - lumaMin < Math.max(0, lumaMax * edgeThreshold)) {
		return rgbM;
	}
	let dx = -(lumaNW + lumaNE - (lumaSW + lumaSE));
	let dy = lumaNW + lumaSW - (lumaNE + lumaSE);
	const dirReduce = Math.max((lumaNW + lumaNE + lumaSW + lumaSE) * 0.03125, 0.0078125);
	const rcpDirMin = 1 / (Math.min(Math.abs(dx), Math.abs(dy)) + dirReduce);
	dx = Math.min(8, Math.max(-8, dx * rcpDirMin));
	dy = Math.min(8, Math.max(-8, dy * rcpDirMin));
	const t1 = sample(dx * (1 / 3 - 0.5), dy * (1 / 3 - 0.5));
	const t2 = sample(dx * (2 / 3 - 0.5), dy * (2 / 3 - 0.5));
	const rgbA = [0, 1, 2].map(k => 0.5 * (t1[k] + t2[k]));
	const t3 = sample(dx * -0.5, dy * -0.5);
	const t4 = sample(dx * 0.5, dy * 0.5);
	const rgbB = [0, 1, 2].map(k => rgbA[k] * 0.5 + 0.25 * (t3[k] + t4[k]));
	const lumaB = luminance(rgbB);
	return lumaB < lumaMin || lumaB > lumaMax ? rgbA : rgbB;
}

/** Every pixel of an image through `fn(sample)`. */
export const eachPixel = (img, fn) =>
	img.px.map((_, i) => fn(samplerAt(img, i % img.w, Math.floor(i / img.w)), i));
