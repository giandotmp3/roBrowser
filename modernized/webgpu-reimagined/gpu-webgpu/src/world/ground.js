import { GROUND_ALPHA_CUTOFF, GROUND_ATLAS_CELL, LIGHTMAP_BLOCK, POSTERIZE_STEP } from '../constants.js';
import { clamp, nextPow2 } from '../math.js';

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** R-MAP-002: lightmap rgb by `smoothlight` preference. */
export function lightmapRgb(rgb, smoothlight) {
	if (smoothlight === 1) {
		return [...rgb];
	}
	if (smoothlight === 2) {
		return rgb.map(c => Math.pow(c, 1.1));
	}
	return rgb.map(c => (Math.floor((c * 255) / POSTERIZE_STEP) * POSTERIZE_STEP) / 255);
}

/**
 * CPU reference of shaders/ground.wgsl (R-MAP-001/002/003). Returns null when
 * the fragment is discarded. Fog is applied afterwards (fog.js).
 */
export function shadeGround({ tex, tileColor, tileUv, normal, light, lightmap, lightmapPref = true, smoothlight = 0 }) {
	if (tex[3] < GROUND_ALPHA_CUTOFF) {
		return null;
	}
	let rgb = tex.slice(0, 3);
	if (tileUv[0] !== 0 || tileUv[1] !== 0) {
		rgb = rgb.map((c, i) => c * tileColor[i]);
	}
	const nl = Math.max(dot(normal, light.direction), 0);
	rgb = rgb.map((c, i) => c * clamp(nl * light.diffuse[i] + light.ambient[i]));
	rgb = rgb.map((c, i) => c * clamp(light.env[i]));
	if (lightmapPref) {
		const lm = lightmapRgb(lightmap.slice(0, 3), smoothlight);
		rgb = rgb.map((c, i) => c * lightmap[3] + clamp(lm[i]));
	}
	return [...rgb, tex[3]];
}

/**
 * R-MAP-005: ground textures in a grid round(√N) wide of 258 px cells
 * (256 + 1 px border), atlas size POT.
 */
export function groundAtlasLayout(count) {
	const cols = Math.max(1, Math.round(Math.sqrt(count)));
	const rows = Math.ceil(count / cols);
	return {
		cols,
		rows,
		cell: GROUND_ATLAS_CELL,
		width: nextPow2(cols * GROUND_ATLAS_CELL),
		height: nextPow2(rows * GROUND_ATLAS_CELL),
		cellOrigin: i => ({ x: (i % cols) * GROUND_ATLAS_CELL + 1, y: Math.floor(i / cols) * GROUND_ATLAS_CELL + 1 })
	};
}

/**
 * R-MAP-006: lightmaps are 8×8 blocks (alpha = shadow, rgb = colour) in a POT
 * atlas; tile UVs sample the inner 0.125..0.875 of each block.
 */
export function lightmapAtlasLayout(count) {
	const perRow = Math.max(1, Math.ceil(Math.sqrt(count)));
	const size = nextPow2(perRow * LIGHTMAP_BLOCK);
	const uvRect = index => {
		const bx = (index % perRow) * LIGHTMAP_BLOCK;
		const by = Math.floor(index / perRow) * LIGHTMAP_BLOCK;
		return {
			u0: (bx + 0.125 * LIGHTMAP_BLOCK) / size,
			v0: (by + 0.125 * LIGHTMAP_BLOCK) / size,
			u1: (bx + 0.875 * LIGHTMAP_BLOCK) / size,
			v1: (by + 0.875 * LIGHTMAP_BLOCK) / size
		};
	};
	return { perRow, size, uvRect };
}

/**
 * R-MAP-007: tile colour bytes are BGRA -> RGBA; cells with no top tile are 0.
 * @param {(Uint8Array|number[]|null)[]} tiles  per cell: BGRA bytes of the top tile, or null
 */
export function tileColorsToRgba(tiles) {
	const out = new Uint8Array(tiles.length * 4);
	tiles.forEach((bgra, i) => {
		if (!bgra) {
			return;
		}
		out[i * 4] = bgra[2];
		out[i * 4 + 1] = bgra[1];
		out[i * 4 + 2] = bgra[0];
		out[i * 4 + 3] = bgra[3];
	});
	return out;
}
