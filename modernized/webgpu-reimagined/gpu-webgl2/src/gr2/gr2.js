import { GR2_ALPHA_REF, GR2_EMBLEM, GR2_FALLBACK_SPRITE, GR2_LIGHT, GR2_PROFILES } from '../constants.js';

/**
 * Lowercased .gr2 basename (no directory, no extension): the roster and lighting key
 * (legacy GR2ModelRenderer gr2Basename).
 * @param {string} path
 */
export function gr2Basename(path) {
	const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
	const dot = path.lastIndexOf('.');
	return path.slice(cut + 1, dot > cut ? dot : path.length).toLowerCase();
}

/**
 * R-GR2-001 lighting profile of a model path: 'flag', 'emp', or null (unlisted).
 * @param {string} path
 * @returns {'flag'|'emp'|null}
 */
export function gr2Profile(path) {
	return GR2_PROFILES[gr2Basename(path)] ?? null;
}

/**
 * R-GR2-001: only the roster draws in 3D; others (or 404) fall back to a Poring sprite.
 * @param {string} model  basename or path
 * @param {boolean} loaded
 */
export function gr2Route(model, loaded = true) {
	return gr2Profile(model) && loaded ? { mode: 'gr2', model } : { mode: 'sprite', sprite: GR2_FALLBACK_SPRITE };
}

/**
 * R-GR2-001 lighting. Flag: diffuse 100/255, ambient = Rec.601 grey of the
 * map ambient. Others: diffuse 128/255, ambient 127/255.
 * @param {string} model
 * @param {number[]} mapAmbient
 */
export function gr2Light(model, mapAmbient) {
	if (gr2Profile(model) === 'flag') {
		const grey = 0.299 * mapAmbient[0] + 0.587 * mapAmbient[1] + 0.114 * mapAmbient[2];
		return { diffuse: GR2_LIGHT.flagDiffuse, ambient: grey };
	}
	return { diffuse: GR2_LIGHT.diffuse, ambient: GR2_LIGHT.ambient };
}

const FLAG_DIFFUSE = new Float32Array(3).fill(GR2_LIGHT.flagDiffuse);
const EMP_DIFFUSE = new Float32Array(3).fill(GR2_LIGHT.diffuse);
const EMP_AMBIENT = new Float32Array(3).fill(GR2_LIGHT.ambient);

/**
 * R-GR2-001 per-instance light uniforms, as the legacy renderer stores them
 * (Float32Array, grey broadcast R = G = B). An unlisted model takes the map light.
 * @param {string} path
 * @param {{ambient?: ArrayLike<number>, diffuse?: ArrayLike<number>}} light  map light
 * @returns {{diffuse: Float32Array, ambient: Float32Array}}
 */
export function gr2LightUniforms(path, light) {
	const profile = gr2Profile(path);
	if (profile === 'flag') {
		const a = light.ambient ?? EMP_AMBIENT;
		const grey = 0.299 * a[0] + 0.587 * a[1] + 0.114 * a[2];
		return { diffuse: FLAG_DIFFUSE, ambient: new Float32Array(3).fill(grey) };
	}
	if (profile === 'emp') {
		return { diffuse: EMP_DIFFUSE, ambient: EMP_AMBIENT };
	}
	return {
		diffuse: Float32Array.from(light.diffuse ?? EMP_DIFFUSE),
		ambient: Float32Array.from(light.ambient ?? EMP_AMBIENT)
	};
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

const isEmblemKey = (r, g, b) => r >= GR2_EMBLEM.keyHigh && g < GR2_EMBLEM.keyLow && b >= GR2_EMBLEM.keyHigh;

/**
 * GR2 type texture key (legacy keyGr2Magenta): an image that is fully opaque has its
 * magenta (r ≥ 248, g < 8, b ≥ 248) texels zeroed (black, alpha 0); an image with its
 * own alpha is kept verbatim. Returns the input when nothing changes.
 * @param {Uint8Array|Uint8ClampedArray} px  RGBA
 */
export function keyGr2Magenta(px) {
	for (let i = 3; i < px.length; i += 4) {
		if (px[i] < 255) {
			return px;
		}
	}
	const out = new Uint8Array(px);
	for (let i = 0; i < out.length; i += 4) {
		if (isEmblemKey(out[i], out[i + 1], out[i + 2])) {
			out[i] = out[i + 1] = out[i + 2] = out[i + 3] = 0;
		}
	}
	return out;
}

/**
 * R-GR2-006 on the 32×32 emblem canvas (emblem drawn 24×24 in the top-left corner, the
 * rest transparent): magenta key (r ≥ 248, g < 8, b ≥ 248 → 0), then A4R4G4B4
 * quantisation of every channel (nibble × 0x11). In place.
 *
 * The emblem reaching the renderer already went through the image magenta key
 * (Texture.load, r > 230, g < 20, b > 230: a superset), so legacy applies no key of its
 * own here; the key is then a no-op and the result is legacy's.
 * @param {Uint8Array|Uint8ClampedArray} rgba
 */
export function emblemTexels(rgba) {
	for (let i = 0; i < rgba.length; i += 4) {
		if (isEmblemKey(rgba[i], rgba[i + 1], rgba[i + 2])) {
			rgba[i] = rgba[i + 1] = rgba[i + 2] = rgba[i + 3] = 0;
			continue;
		}
		for (let c = 0; c < 4; c++) {
			rgba[i + c] = (rgba[i + c] >> 4) * 0x11;
		}
	}
	return rgba;
}

/**
 * R-GR2-006: emblem quantised to A4R4G4B4, padded 24 → 32 POT, magenta-keyed
 * (r ≥ 248, g < 8, b ≥ 248). Returns RGBA bytes of the expanded 4-bit values.
 * @param {Uint8Array} rgba  24×24×4
 */
export function prepareEmblem(rgba) {
	const { srcSize, potSize } = GR2_EMBLEM;
	const out = new Uint8Array(potSize * potSize * 4);
	for (let y = 0; y < srcSize; y++) {
		out.set(rgba.subarray(y * srcSize * 4, (y + 1) * srcSize * 4), y * potSize * 4);
	}
	return { width: potSize, height: potSize, data: emblemTexels(out) };
}

/** R-GR2-006: the emblem submesh is skipped until the emblem has loaded. */
export const drawEmblemSubmesh = emblemLoaded => Boolean(emblemLoaded);

/**
 * GR2 vertex interleave (legacy gr2Pack packRobrowserInterleave): position 3, normal 3,
 * uv 2, bone index 4, bone weight 4 = 16 floats, 64-byte stride, from the bind pose.
 * @param {{vcount: number, bind: ArrayLike<number>, nrm: ArrayLike<number>, uv: ArrayLike<number>, bidx: ArrayLike<number>, bw: ArrayLike<number>}} mesh
 */
export function interleaveGr2Mesh(mesh) {
	const n = mesh.vcount;
	const buf = new Float32Array(n * GR2_VERTEX_FLOATS);
	for (let i = 0; i < n; i++) {
		const o = i * GR2_VERTEX_FLOATS;
		for (let k = 0; k < 3; k++) {
			buf[o + k] = mesh.bind[i * 3 + k];
			buf[o + 3 + k] = mesh.nrm[i * 3 + k];
		}
		buf[o + 6] = mesh.uv[i * 2];
		buf[o + 7] = mesh.uv[i * 2 + 1];
		for (let k = 0; k < 4; k++) {
			buf[o + 8 + k] = mesh.bidx[i * 4 + k];
			buf[o + 12 + k] = mesh.bw[i * 4 + k];
		}
	}
	return buf;
}

/** Floats per GR2 vertex (see interleaveGr2Mesh). */
export const GR2_VERTEX_FLOATS = 16;
