import { FRAME_TYPE } from '../constants.js';

/**
 * Convert a sprite frame into RGBA pixels with the layer colour applied
 * (legacy `fillImageData`, SpriteRenderer.js:108-202).
 *
 * - Transparent pixels stay fully zero (n * 0 = 0).
 * - INDEXED: palette index 0 is transparent; alpha = trunc(255 * a).
 * - RGBA: each channel = trunc(channel * mul).
 *
 * Deviation (secure default): channels are clamped to 255. Legacy packed
 * bits with `<<` and let multipliers > 1 bleed into neighbouring channels.
 *
 * @param {import('./SpriteFrame.js').SpriteFrame} frame
 * @param {Uint8Array|null} palette  1024 bytes (RGBA x 256); required for INDEXED
 * @param {ArrayLike<number>} color  [r, g, b, a] floats
 * @param {Uint8ClampedArray} [out]  width*height*4; allocated when omitted
 * @returns {Uint8ClampedArray}
 */
export function colorizeFrame(frame, palette, color, out) {
	const { width, height, data } = frame;
	const n = width * height;
	const dst = out ?? new Uint8ClampedArray(n * 4);
	const [rm, gm, bm, am] = color;
	const ch = v => Math.min(255, Math.trunc(v));

	if (frame.type === FRAME_TYPE.RGBA) {
		const identity = rm === 1 && gm === 1 && bm === 1 && am === 1;
		for (let i = 0; i < n; i++) {
			const o = i * 4;
			const r = data[o];
			const g = data[o + 1];
			const b = data[o + 2];
			const a = data[o + 3];
			if ((r | g | b | a) === 0) {
				dst[o] = dst[o + 1] = dst[o + 2] = dst[o + 3] = 0;
				continue;
			}
			if (identity) {
				dst[o] = r;
				dst[o + 1] = g;
				dst[o + 2] = b;
				dst[o + 3] = a;
			} else {
				dst[o] = ch(r * rm);
				dst[o + 1] = ch(g * gm);
				dst[o + 2] = ch(b * bm);
				dst[o + 3] = ch(a * am);
			}
		}
		return dst;
	}

	// Indexed: precompute a colour-modulated palette once (O(256)), then O(pixels).
	const lut = new Uint8ClampedArray(256 * 4);
	const alpha = ch(255 * am);
	for (let i = 1; i < 256; i++) {
		const p = i * 4;
		lut[p] = ch(palette[p] * rm);
		lut[p + 1] = ch(palette[p + 1] * gm);
		lut[p + 2] = ch(palette[p + 2] * bm);
		lut[p + 3] = alpha;
	}
	for (let i = 0; i < n; i++) {
		const p = data[i] * 4;
		const o = i * 4;
		dst[o] = lut[p];
		dst[o + 1] = lut[p + 1];
		dst[o + 2] = lut[p + 2];
		dst[o + 3] = lut[p + 3];
	}
	return dst;
}
