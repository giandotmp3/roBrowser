import { GROUND_ALPHA_CUTOFF, GROUND_ATLAS_CELL, LIGHTMAP_BLOCK, POSTERIZE_STEP, SMOOTHLIGHT_POW } from '../constants.js';
import { clamp01 } from '../math.js';
import { nextPot } from '../residency/imageKey.js';
import { NotImplementedError } from '../errors.js';

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * R-MAP-002: lightmap rgb by `smoothlight` preference.
 * 0 → posterise to 16 levels; 1 → raw; 2 → pow(rgb, 1.1).
 * @param {number[]} rgb
 * @param {0|1|2} smoothlight
 */
export function lightmapColor(rgb, smoothlight) {
	if (smoothlight === 2) {
		return rgb.map(c => Math.pow(c, SMOOTHLIGHT_POW));
	}
	if (smoothlight === 1) {
		return [...rgb];
	}
	return rgb.map(c => (Math.floor((c * 255) / POSTERIZE_STEP) * POSTERIZE_STEP) / 255);
}

/**
 * CPU reference of shaders/ground.frag (R-MAP-001/002/003). Returns null when
 * the fragment is discarded.
 * @param {{
 *   tex: number[], tileColor: number[], tileUV: number[], normal: number[],
 *   light: {dir: number[], diffuse: number[], ambient: number[], env: number[]},
 *   lightmap: number[]|null, lightmapPref: boolean, smoothlight: 0|1|2
 * }} f
 */
export function shadeGround(f) {
	if (f.tex[3] < GROUND_ALPHA_CUTOFF) {
		return null;
	}
	let rgb = f.tex.slice(0, 3);
	if (f.tileUV[0] !== 0 || f.tileUV[1] !== 0) {
		rgb = rgb.map((c, i) => c * f.tileColor[i]);
	}
	const nl = Math.max(dot(f.normal, f.light.dir), 0);
	rgb = rgb.map((c, i) => c * clamp01(nl * f.light.diffuse[i] + f.light.ambient[i]));
	rgb = rgb.map((c, i) => c * clamp01(f.light.env[i]));
	if (f.lightmapPref && f.lightmap) {
		const lm = lightmapColor(f.lightmap.slice(0, 3), f.smoothlight);
		const shadow = f.lightmap[3];
		rgb = rgb.map((c, i) => c * shadow + clamp01(lm[i]));
	}
	return [...rgb, f.tex[3]];
}

/**
 * R-MAP-005 layout: grid round(√N) wide of 258 px cells, POT atlas.
 * @param {number} n
 */
export function groundAtlasLayout(n) {
	const cols = Math.max(1, Math.round(Math.sqrt(n)));
	const rows = Math.ceil(n / cols);
	const size = nextPot(Math.max(cols, rows) * GROUND_ATLAS_CELL);
	return { cols, rows, cell: GROUND_ATLAS_CELL, width: size, height: size };
}

/**
 * R-MAP-005 pixels: each 256 px texture is first drawn stretched to 258 to form
 * the 1 px border, then the 256 px image in the centre.
 * @returns {never}
 */
export function composeGroundAtlas() {
	throw new NotImplementedError('R-MAP-005 atlas composition (needs OffscreenCanvas port)');
}

/**
 * R-MAP-006: UVs sample the inner 0.125–0.875 of each 8×8 lightmap block.
 * @param {number} blockX
 * @param {number} blockY
 * @param {number} atlasSize  POT, in px
 */
export function lightmapBlockUV(blockX, blockY, atlasSize) {
	const px = LIGHTMAP_BLOCK;
	const u0 = (blockX * px + 0.125 * px) / atlasSize;
	const v0 = (blockY * px + 0.125 * px) / atlasSize;
	const u1 = (blockX * px + 0.875 * px) / atlasSize;
	const v1 = (blockY * px + 0.875 * px) / atlasSize;
	return [u0, v0, u1, v1];
}

/**
 * R-MAP-007: tile colour bytes are BGRA; cells with no top tile get colour 0.
 * @param {Uint8Array|null} bgra
 */
export function tileColorRgba(bgra) {
	if (!bgra) {
		return [0, 0, 0, 0];
	}
	return [bgra[2], bgra[1], bgra[0], bgra[3]];
}
