import { STR } from '../constants.js';

/**
 * R-EFX-009: STR billboard corner in world units: 1/35 per px, pivot at
 * pos − (320,320), Y lowered 0.5 except attachments.
 * @param {number[]} px  layer-space pixel position
 * @param {boolean} attachment
 */
export function strCorner(px, attachment) {
	const x = (px[0] - STR.pivot) * STR.pxRatio;
	const y = (px[1] - STR.pivot) * STR.pxRatio - (attachment ? 0 : STR.baseLift);
	return [x, y];
}

/** R-EFX-009: clip z reduced by 0.1. */
export const strClipZ = z => z - STR.clipZBias;

/** R-EFX-009: pure-black or zero-alpha texels are discarded. */
export function strDiscard(texel) {
	return texel[3] === 0 || (texel[0] === 0 && texel[1] === 0 && texel[2] === 0);
}

/**
 * R-EFX-010 [FLAG → fixed]: legacy never set uFogUse for STR. The rebuild
 * applies scene fog via the shared fog include when the record asks for it.
 * @param {{fog: boolean}} record
 * @param {{use: boolean, near: number, far: number, color: number[]}} sceneFog
 */
export function strFogUniforms(record, sceneFog) {
	return { ...sceneFog, use: Boolean(record.fog && sceneFog.use) };
}

/** R-EFX-008: STR runs never write depth. */
export const STR_DEPTH_WRITE = false;
