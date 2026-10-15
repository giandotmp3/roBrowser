import { GR2_ALPHA_REF, GR2_EMBLEM, GR2_FALLBACK_SPRITE, GR2_ROSTER } from '../constants.js';

/** Rec.601 luma. */
const grey601 = ([r, g, b]) => 0.299 * r + 0.587 * g + 0.114 * b;

/**
 * R-GR2-001: only the roster is drawn in 3D; everything else (or a 404)
 * falls back to a Poring sprite. Flag: diffuse 100/255, ambient = Rec.601
 * grey of the map ambient; others: diffuse 128/255, ambient 127/255.
 * @param {string} model     e.g. 'guildflag90_1'
 * @param {number[]} mapAmbient
 * @param {{loaded?: boolean}} [opts]
 */
export function gr2ModelInfo(model, mapAmbient, { loaded = true } = {}) {
	if (!GR2_ROSTER.includes(model) || !loaded) {
		return { draw3d: false, fallbackSprite: GR2_FALLBACK_SPRITE };
	}
	if (model === 'guildflag90_1') {
		const a = grey601(mapAmbient);
		return { draw3d: true, diffuse: 100 / 255, ambient: [a, a, a] };
	}
	return { draw3d: true, diffuse: 128 / 255, ambient: [127 / 255, 127 / 255, 127 / 255] };
}

/** R-GR2-002 (reference of shaders/gr2.wgsl): alpha < 207/255 discarded, the rest opaque. */
export function gr2AlphaTest(tex) {
	if (tex[3] < GR2_ALPHA_REF) {
		return null;
	}
	return [tex[0], tex[1], tex[2], 1];
}

/**
 * R-GR2-002 pipeline: depth test + write on, correction disabled; no blending
 * unless the entity is fading (effectColor alpha < 1).
 */
export function gr2PipelineState(effectAlpha) {
	return { depthTest: true, depthWrite: true, depthCorrection: false, blend: effectAlpha < 1 ? 'normal' : 'none' };
}

/**
 * R-GR2-006: live guild emblem -> 32×32 rgba8. Magenta-keyed (r ≥ 248, g < 8,
 * b ≥ 248), quantised to A4R4G4B4 (nibble ×0x11), placed top-left in the POT pad.
 * @param {Uint8Array} rgba24  24×24 RGBA
 */
export function prepareEmblem(rgba24) {
	const { srcSize, potSize, keyHigh, keyLow } = GR2_EMBLEM;
	const out = new Uint8Array(potSize * potSize * 4);
	for (let y = 0; y < srcSize; y++) {
		for (let x = 0; x < srcSize; x++) {
			const s = (y * srcSize + x) * 4;
			const d = (y * potSize + x) * 4;
			if (rgba24[s] >= keyHigh && rgba24[s + 1] < keyLow && rgba24[s + 2] >= keyHigh) {
				continue;
			}
			for (let c = 0; c < 4; c++) {
				out[d + c] = (rgba24[s + c] >> 4) * 0x11;
			}
		}
	}
	return out;
}

/** R-GR2-006: the emblem submesh is skipped until the emblem has loaded. */
export function shouldDrawSubmesh(submesh, emblemLoaded) {
	return !(submesh.isEmblem && !emblemLoaded);
}
