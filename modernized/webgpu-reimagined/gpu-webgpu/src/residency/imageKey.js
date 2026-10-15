import { nextPow2 } from '../math.js';
import { POT_CLASSES } from '../constants.js';

/**
 * R-MAP-024: BMP/PNG/JPG pixels with r > 230, g < 20, b > 230 become
 * fully transparent black. Operates in place on RGBA8 data.
 * @param {Uint8Array|Uint8ClampedArray} rgba
 * @returns {typeof rgba}
 */
export function applyMagentaKey(rgba) {
	for (let i = 0; i < rgba.length; i += 4) {
		if (rgba[i] > 230 && rgba[i + 1] < 20 && rgba[i + 2] > 230) {
			rgba[i] = rgba[i + 1] = rgba[i + 2] = rgba[i + 3] = 0;
		}
	}
	return rgba;
}

/** R-MAP-024: images are stretched to POT for upload. */
export function potSize(width, height) {
	return { width: nextPow2(width), height: nextPow2(height) };
}

/**
 * Residency size class: smallest POT class (32..512) holding the larger side.
 * Larger images get a dedicated texture ('oversize'), checked against
 * maxTextureDimension2D by the caller (NFR-08).
 * @returns {number|'oversize'}
 */
export function sizeClass(width, height) {
	const side = nextPow2(Math.max(width, height, 1));
	return POT_CLASSES.find(c => c >= side) ?? 'oversize';
}

/** R-PERF-003: mip levels only when `enableMipmap` is on. */
export function mipLevelCount(width, height, enableMipmap) {
	if (!enableMipmap) {
		return 1;
	}
	return Math.floor(Math.log2(Math.max(width, height))) + 1;
}

/**
 * R-PERF-003 sampler descriptors. `pixelPerfect` selects the NEAREST variant
 * for RGBA sprites without a re-upload (two samplers, R-SPR-014).
 */
export function samplerDescriptor({ kind, enableMipmap = false, pixelPerfect = false }) {
	const base = { addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' };
	if (kind === 'indexed' || kind === 'palette') {
		return { ...base, magFilter: 'nearest', minFilter: 'nearest', mipmapFilter: 'nearest' };
	}
	if (kind === 'spriteRgba') {
		const f = pixelPerfect ? 'nearest' : 'linear';
		return { ...base, magFilter: f, minFilter: f, mipmapFilter: 'nearest' };
	}
	// world / ground / damage textures
	return { ...base, magFilter: 'linear', minFilter: 'linear', mipmapFilter: enableMipmap ? 'linear' : 'nearest' };
}
