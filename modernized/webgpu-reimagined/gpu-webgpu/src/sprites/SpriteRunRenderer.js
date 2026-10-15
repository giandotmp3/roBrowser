import { ZINDEX_BIAS } from '../constants.js';
import { NotImplementedError } from '../errors.js';

/**
 * R-SPR-006 (shader side, reference of shaders/sprite.wgsl):
 * clip.z −= (zIndex·0.01 + depthBias) / max(zoom, 1).
 * @returns {number} the amount subtracted from clip z
 */
export function zIndexBias(zIndex, depthBias, zoom) {
	return (zIndex * ZINDEX_BIAS + depthBias) / Math.max(zoom, 1);
}

/**
 * R-SPR-005 (shader side): replace each vertex's clip z by the depth where its
 * camera ray meets the vertical plane through the sprite centre (normal =
 * flattened camera forward); cap with min(original, corrected) unless
 * ignoreDepthMinCap (NPCs) takes the corrected z outright.
 * @returns {number} corrected clip-space z
 */
export function depthCorrectedClipZ(_vertexWorld, _spriteCentre, _camera, _ignoreDepthMinCap) {
	throw new NotImplementedError('depthCorrectedClipZ (R-SPR-005)');
}

/**
 * R-SPR-014 (shader side): index 0 is transparent; the four neighbouring
 * palette lookups are blended bilinearly (manual filter on an r8 NEAREST index
 * texture + 256×N palette table).
 */
export function samplePaletteBilinear(_indexImage, _paletteRow, _u, _v) {
	throw new NotImplementedError('samplePaletteBilinear (R-SPR-014 shader)');
}

/** Floats per sprite instance in the instance-step vertex buffer (compat-mode safe, architecture m2). */
export const SPRITE_INSTANCE_FLOATS = 24;

/**
 * Draws SpriteDraw runs (contiguous, legacy order; render-records splits runs)
 * as instanced quads with one pipeline + bind group per run.
 */
export class SpriteRunRenderer {
	constructor(deps) {
		this._deps = deps;
	}

	/** Pack one SpriteDraw record into the instance buffer at `offset` floats. */
	packInstance(_record, _out, _offset) {
		throw new NotImplementedError('SpriteRunRenderer.packInstance (C-08)');
	}

	/** Encode all runs of a frame into the scene pass. */
	encode(_pass, _records, _runs) {
		throw new NotImplementedError('SpriteRunRenderer.encode (C-08)');
	}
}
