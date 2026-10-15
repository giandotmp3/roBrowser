import { MAGENTA_KEY } from '../constants.js';

/**
 * R-MAP-024: BMP/PNG/JPG pixels with r > 230, g < 20, b > 230 become fully
 * transparent black. Mutates and returns `rgba`.
 * @param {Uint8ClampedArray|Uint8Array} rgba
 */
export function applyMagentaKey(rgba) {
	for (let i = 0; i < rgba.length; i += 4) {
		if (rgba[i] > MAGENTA_KEY.rMin && rgba[i + 1] < MAGENTA_KEY.gMax && rgba[i + 2] > MAGENTA_KEY.bMin) {
			rgba[i] = 0;
			rgba[i + 1] = 0;
			rgba[i + 2] = 0;
			rgba[i + 3] = 0;
		}
	}
	return rgba;
}

/** @param {number} n */
export function nextPot(n) {
	let p = 1;
	while (p < n) {
		p <<= 1;
	}
	return p;
}

/**
 * R-MAP-024: after keying, images are resized (stretched) to POT for upload.
 * @param {number} width
 * @param {number} height
 */
export function potStretchSize(width, height) {
	return { width: nextPot(width), height: nextPot(height) };
}
