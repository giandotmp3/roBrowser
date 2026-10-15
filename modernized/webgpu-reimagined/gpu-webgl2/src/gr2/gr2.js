import { GR2_ALPHA_REF, GR2_EMBLEM, GR2_FALLBACK_SPRITE, GR2_LIGHT, GR2_ROSTER } from '../constants.js';

/**
 * R-GR2-001: only the roster draws in 3D; others (or 404) fall back to a Poring sprite.
 * @param {string} model
 * @param {boolean} loaded
 */
export function gr2Route(model, loaded = true) {
	return GR2_ROSTER.includes(model) && loaded
		? { mode: 'gr2', model }
		: { mode: 'sprite', sprite: GR2_FALLBACK_SPRITE };
}

/**
 * R-GR2-001 lighting. Flag: diffuse 100/255, ambient = Rec.601 grey of the
 * map ambient. Others: diffuse 128/255, ambient 127/255.
 * @param {string} model
 * @param {number[]} mapAmbient
 */
export function gr2Light(model, mapAmbient) {
	if (model === 'guildflag90_1') {
		const grey = 0.299 * mapAmbient[0] + 0.587 * mapAmbient[1] + 0.114 * mapAmbient[2];
		return { diffuse: GR2_LIGHT.flagDiffuse, ambient: grey };
	}
	return { diffuse: GR2_LIGHT.diffuse, ambient: GR2_LIGHT.ambient };
}

/**
 * R-GR2-002: alpha < 207/255 discarded; the rest opaque. No blending unless fading.
 * @param {number} alpha
 * @returns {number|null} output alpha, or null when discarded
 */
export function gr2AlphaTest(alpha) {
	return alpha < GR2_ALPHA_REF ? null : 1;
}

/** R-GR2-002: depth test + write + correction-disable all on; blend only while fading. */
export function gr2PassState(fading) {
	return {
		depthTest: true,
		depthWrite: true,
		disableDepthCorrection: true,
		blend: fading,
		lightmapPref: false,
		occluderFade: false
	};
}

/**
 * R-GR2-006: emblem quantised to A4R4G4B4, padded 24 → 32 POT, magenta-keyed
 * (r ≥ 248, g < 8, b ≥ 248). Returns RGBA bytes of the expanded 4-bit values.
 * @param {Uint8Array} rgba  24×24×4
 */
export function prepareEmblem(rgba) {
	const { srcSize, potSize, keyHigh, keyLow } = GR2_EMBLEM;
	const out = new Uint8Array(potSize * potSize * 4);
	const q = v => (v >> 4) * 17;
	for (let y = 0; y < srcSize; y++) {
		for (let x = 0; x < srcSize; x++) {
			const s = (y * srcSize + x) * 4;
			const d = (y * potSize + x) * 4;
			const [r, g, b, a] = [rgba[s], rgba[s + 1], rgba[s + 2], rgba[s + 3]];
			if (r >= keyHigh && g < keyLow && b >= keyHigh) {
				continue;
			}
			out[d] = q(r);
			out[d + 1] = q(g);
			out[d + 2] = q(b);
			out[d + 3] = q(a);
		}
	}
	return { width: potSize, height: potSize, data: out };
}

/** R-GR2-006: the emblem submesh is skipped until the emblem has loaded. */
export const drawEmblemSubmesh = emblemLoaded => Boolean(emblemLoaded);
