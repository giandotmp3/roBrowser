import { notImplemented } from '../util/errors.js';

/**
 * R-SPR-014 texture class and sampler for a sprite frame.
 * @param {{indexed: boolean}} frame
 * @param {{pixelPerfectSprites?: boolean}} prefs
 */
export function frameSampling({ indexed }, { pixelPerfectSprites = false } = {}) {
	if (indexed) {
		return { textureClass: 'indexed', sampler: 'nearest' };
	}
	return { textureClass: 'rgba', sampler: pixelPerfectSprites ? 'nearest' : 'linear' };
}

/**
 * R-SPR-014 indices whose palette colour is exactly magenta become 0
 * (index 0 = transparent).
 * @param {Uint8Array} indices
 * @param {Uint8Array} palette 256 × RGBA
 * @returns {Uint8Array}
 */
export function remapMagentaIndices(indices, palette) {
	const out = new Uint8Array(indices.length);
	for (let i = 0; i < indices.length; ++i) {
		const p = indices[i] * 4;
		const magenta = palette[p] === 255 && palette[p + 1] === 0 && palette[p + 2] === 255;
		out[i] = magenta ? 0 : indices[i];
	}
	return out;
}

/**
 * R-SPR-016 RGBA frames: bottom-up ABGR → top-down RGBA, alpha 0 zeroes the pixel.
 * @param {Uint8Array} abgr
 * @param {number} width
 * @param {number} height
 * @returns {Uint8Array}
 */
export function decodeRgbaFrame(abgr, width, height) {
	const out = new Uint8Array(width * height * 4);
	for (let y = 0; y < height; ++y) {
		for (let x = 0; x < width; ++x) {
			const src = ((height - 1 - y) * width + x) * 4;
			const dst = (y * width + x) * 4;
			const a = abgr[src];
			if (a === 0) {
				continue;
			}
			out[dst] = abgr[src + 3];
			out[dst + 1] = abgr[src + 2];
			out[dst + 2] = abgr[src + 1];
			out[dst + 3] = a;
		}
	}
	return out;
}

/**
 * R-SPR-015 palette selection (external .pal vs sprite palette; mounts,
 * costumes, body styles, halter-lead mounts). Pending implementation.
 * @param {Object} _slot
 * @returns {string|number|null}
 */
export function selectPalette(_slot) {
	return notImplemented('R-SPR-015', 'palette selection');
}
