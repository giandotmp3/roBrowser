import { nextPow2 } from '../math.js';

/**
 * R-SPR-014 upload side: an indexed SPR frame becomes an r8 index image,
 * POT-padded and centred; indices whose palette colour is exactly
 * magenta (255,0,255) become 0 (transparent).
 *
 * @param {{width: number, height: number, indices: Uint8Array}} frame
 * @param {Uint8Array} palette  256 x RGBA
 * @returns {{width: number, height: number, data: Uint8Array, offsetX: number, offsetY: number}}
 */
export function prepareIndexedFrame(frame, palette) {
	const width = nextPow2(frame.width);
	const height = nextPow2(frame.height);
	const offsetX = Math.floor((width - frame.width) / 2);
	const offsetY = Math.floor((height - frame.height) / 2);
	const data = new Uint8Array(width * height);
	for (let y = 0; y < frame.height; y++) {
		for (let x = 0; x < frame.width; x++) {
			let idx = frame.indices[y * frame.width + x];
			const p = idx * 4;
			if (palette[p] === 255 && palette[p + 1] === 0 && palette[p + 2] === 255) {
				idx = 0;
			}
			data[(y + offsetY) * width + (x + offsetX)] = idx;
		}
	}
	return { width, height, data, offsetX, offsetY };
}

/**
 * R-SPR-016: RGBA SPR frames are stored bottom-up in ABGR order. Flip
 * vertically, reorder to RGBA, and zero the whole pixel when alpha is 0.
 *
 * @param {{width: number, height: number, abgr: Uint8Array}} frame
 * @returns {Uint8Array} RGBA8, top-down
 */
export function prepareRgbaFrame({ width, height, abgr }) {
	const out = new Uint8Array(width * height * 4);
	for (let y = 0; y < height; y++) {
		const srcRow = height - 1 - y;
		for (let x = 0; x < width; x++) {
			const s = (srcRow * width + x) * 4;
			const d = (y * width + x) * 4;
			const a = abgr[s];
			if (a === 0) {
				continue;
			}
			out[d] = abgr[s + 3];
			out[d + 1] = abgr[s + 2];
			out[d + 2] = abgr[s + 1];
			out[d + 3] = a;
		}
	}
	return out;
}
