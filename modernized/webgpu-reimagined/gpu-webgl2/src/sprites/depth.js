import { ZINDEX_BIAS } from '../constants.js';
import { NotImplementedError } from '../errors.js';

/**
 * R-SPR-006: clip.z −= (zIndex·0.01 + depth) / max(zoom, 1).
 * CPU reference of the same line in shaders/sprite.vert.
 */
export function zIndexBias(zIndex, depthBias, zoom) {
	return (zIndex * ZINDEX_BIAS + depthBias) / Math.max(zoom, 1);
}

/**
 * R-SPR-005 cap: corrected z is capped with min(original, corrected) except
 * NPCs (ignoreDepthMinCap) which take the corrected z outright.
 */
export function cappedDepth(originalZ, correctedZ, ignoreDepthMinCap) {
	return ignoreDepthMinCap ? correctedZ : Math.min(originalZ, correctedZ);
}

/**
 * R-SPR-005: depth where the vertex's camera ray meets the vertical plane
 * through the sprite centre (normal = flattened camera forward), in clip z.
 * @returns {never}
 */
export function correctedClipZ() {
	throw new NotImplementedError('R-SPR-005 billboard depth correction (ray/plane)');
}
