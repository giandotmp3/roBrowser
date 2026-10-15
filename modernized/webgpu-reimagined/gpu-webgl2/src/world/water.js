import { deg2rad } from '../math.js';
import { WATER_FRAMES, WATER_FRAME_MS, WATER_OPACITY_DEFAULT, WATER_OPAQUE_TYPES, WATER_RSW_SCALE, WATER_UV_REPEAT_TILES } from '../constants.js';

/** R-MAP-008: RSW wave height and water level are /5. */
export function waterParamsFromRsw({ level, waveHeight, waveSpeed, wavePitch, animSpeed, type }) {
	return { level: level / WATER_RSW_SCALE, waveHeight: waveHeight / WATER_RSW_SCALE, waveSpeed, wavePitch, animSpeed, type };
}

/** R-MAP-008: offset = (frame·speed mod 360) − 180, frame = tick/(1000/60). */
export function waveOffset(tick, waveSpeed) {
	const frame = tick / WATER_FRAME_MS;
	return ((frame * waveSpeed) % 360) - 180;
}

/** R-MAP-008: 2×2 checker diff +1/−1/0. */
export function checkerDiff(x, z) {
	const cx = ((x % 2) + 2) % 2;
	const cz = ((z % 2) + 2) % 2;
	if (cx === 0 && cz === 0) {
		return 1;
	}
	if (cx === 1 && cz === 1) {
		return -1;
	}
	return 0;
}

/** R-MAP-008: y += sin(rad(offset + 0.5·pitch·(x+z+diff)))·height. */
export function waveY(y, x, z, offset, pitch, height) {
	return y + Math.sin(deg2rad(offset + 0.5 * pitch * (x + z + checkerDiff(x, z)))) * height;
}

/** R-MAP-009: index = floor(frame/animSpeed) % 32, frame = tick/16.67. */
export function waterFrameIndex(tick, animSpeed) {
	return Math.floor(tick / WATER_FRAME_MS / animSpeed) % WATER_FRAMES;
}

/**
 * R-MAP-010 [FLAG → fixed]: legacy squared uOpacity (0.64 effective). The
 * rebuild applies it once: 0.8, or 1.0 for types 4 and 6. Texture alpha ignored; unlit.
 * @param {number} type
 */
export function waterAlpha(type) {
	return WATER_OPAQUE_TYPES.includes(type) ? 1.0 : WATER_OPACITY_DEFAULT;
}

/** R-MAP-011: a water quad exists only where at least one ground corner is below the surface. */
export function hasWaterQuad(cornerHeights, waterLevel) {
	// Heights are in RO's inverted-Y convention: "below" means larger value.
	return cornerHeights.some(h => h > waterLevel);
}

/** R-MAP-011: UVs repeat every 5 ground tiles. */
export function waterUV(tileX, tileY) {
	return [(tileX % WATER_UV_REPEAT_TILES) / WATER_UV_REPEAT_TILES, (tileY % WATER_UV_REPEAT_TILES) / WATER_UV_REPEAT_TILES];
}

/** R-MAP-011: water draws after opaque entities, depth test on, write off. */
export const WATER_PASS_STATE = Object.freeze({ depthTest: true, depthWrite: false, blend: Object.freeze({ src: 'SRC_ALPHA', dst: 'ONE_MINUS_SRC_ALPHA' }) });
