/**
 * Perceptual image comparison for smoke goldens (architecture §2.2: "perceptual tolerance,
 * not bit-exact"). YIQ colour distance per pixel (as in pixelmatch), with a mismatch-ratio
 * budget. Pure JS over RGBA8 buffers so it runs in Node and in the browser.
 */

const MAX_YIQ_DELTA = 35215; // max squared YIQ distance for 8-bit RGB

function yiqDelta(r1, g1, b1, a1, r2, g2, b2, a2) {
	// blend over white so transparent pixels compare sensibly
	const blend = (c, a) => 255 + ((c - 255) * a) / 255;
	r1 = blend(r1, a1);
	g1 = blend(g1, a1);
	b1 = blend(b1, a1);
	r2 = blend(r2, a2);
	g2 = blend(g2, a2);
	b2 = blend(b2, a2);
	const y = (r, g, b) => r * 0.29889531 + g * 0.58662247 + b * 0.11448223;
	const i = (r, g, b) => r * 0.59597799 - g * 0.2741761 - b * 0.32180189;
	const q = (r, g, b) => r * 0.21147017 - g * 0.52261711 + b * 0.31114694;
	const dy = y(r1, g1, b1) - y(r2, g2, b2);
	const di = i(r1, g1, b1) - i(r2, g2, b2);
	const dq = q(r1, g1, b1) - q(r2, g2, b2);
	return 0.5053 * dy * dy + 0.299 * di * di + 0.1957 * dq * dq;
}

/**
 * @param {{ width: number, height: number, data: Uint8Array|Uint8ClampedArray }} expected
 * @param {{ width: number, height: number, data: Uint8Array|Uint8ClampedArray }} actual
 * @param {{ threshold?: number, maxMismatchRatio?: number }} [tol]
 *   threshold: per-pixel perceptual delta in [0,1] above which a pixel counts as different
 *   maxMismatchRatio: fraction of differing pixels allowed
 * @returns {{ pass: boolean, mismatched: number, ratio: number, reason?: string }}
 */
export function compareImages(expected, actual, { threshold = 0.1, maxMismatchRatio = 0.005 } = {}) {
	if (expected.width !== actual.width || expected.height !== actual.height) {
		return {
			pass: false,
			mismatched: -1,
			ratio: 1,
			reason: `size ${actual.width}x${actual.height} != ${expected.width}x${expected.height}`
		};
	}
	const limit = MAX_YIQ_DELTA * threshold * threshold;
	const a = expected.data;
	const b = actual.data;
	let mismatched = 0;
	for (let p = 0; p < a.length; p += 4) {
		if (yiqDelta(a[p], a[p + 1], a[p + 2], a[p + 3], b[p], b[p + 1], b[p + 2], b[p + 3]) > limit) {
			mismatched++;
		}
	}
	const ratio = mismatched / (expected.width * expected.height);
	return { pass: ratio <= maxMismatchRatio, mismatched, ratio };
}
