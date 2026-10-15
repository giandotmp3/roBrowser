import { deg2rad } from '../math.js';
import {
	WATER_FRAMES,
	WATER_OPACITY_DEFAULT,
	WATER_OPAQUE_TYPES,
	WATER_RSW_SCALE,
	WATER_UV_REPEAT_TILES
} from '../constants.js';

/** R-MAP-008: RSW wave height and water level are /5. */
export function waterParamsFromRsw({ level, waveHeight, waveSpeed, wavePitch, animSpeed, type }) {
	return {
		level: level / WATER_RSW_SCALE,
		waveHeight: waveHeight / WATER_RSW_SCALE,
		waveSpeed,
		wavePitch,
		animSpeed,
		type
	};
}

/**
 * Frame number at 60 fps. Computed as tick·60/1000 rather than tick/(1000/60):
 * identical in intent, but exact on integer ticks (the division form yields
 * 59.999… at tick 1000 and drops a frame at boundaries). Must match gpu-webgpu.
 */
const frameAt = tick => (tick * 60) / 1000;

/** R-MAP-008: offset = (frame·speed mod 360) − 180, frame = tick·60/1000. */
export function waveOffset(tick, waveSpeed) {
	const frame = frameAt(tick);
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

/** R-MAP-009: index = floor(frame/animSpeed) % 32, frame = tick·60/1000. */
export function waterFrameIndex(tick, animSpeed) {
	return Math.floor(frameAt(tick) / animSpeed) % WATER_FRAMES;
}

/**
 * R-MAP-010 [FLAG → fixed]: legacy squared uOpacity (0.64 effective). The
 * rebuild applies it once: 0.8, or 1.0 for types 4 and 6. Texture alpha ignored; unlit.
 * @param {number} type
 */
export function waterAlpha(type) {
	return WATER_OPAQUE_TYPES.includes(type) ? 1.0 : WATER_OPACITY_DEFAULT;
}

/**
 * R-MAP-011 corner convention (HITL round 2: legacy convention, to be confirmed by a
 * world-record diff). Mirrors legacy Loaders/Ground.js:547-585, which builds the water
 * mesh the backends receive in the MAP payload.
 *
 * A water quad exists where at least one of the cell's four ground corners is below the
 * wave crest. Heights use RO's inverted-Y convention ("below" means a larger value), and
 * legacy tests against `level - waveHeight`, not `level` (both already /5, R-MAP-008).
 * @param {number[]} cornerHeights  the cell's four corner heights
 * @param {number} waterLevel
 * @param {number} [waveHeight]
 */
export function hasWaterQuad(cornerHeights, waterLevel, waveHeight = 0) {
	return cornerHeights.some(h => h > waterLevel - waveHeight);
}

/** R-MAP-011: UVs repeat every 5 ground tiles (near corner of tile x, y). */
export function waterUV(tileX, tileY) {
	return [
		(tileX % WATER_UV_REPEAT_TILES) / WATER_UV_REPEAT_TILES,
		(tileY % WATER_UV_REPEAT_TILES) / WATER_UV_REPEAT_TILES
	];
}

/**
 * R-MAP-011 legacy far-corner convention: the x + 1 / y + 1 corners use `|| 1`, so a
 * coordinate that wraps to 0 on a 5-tile boundary reads 1 instead; the near (x, y)
 * corners keep 0. Each quad therefore spans [u, u + 0.2] without a backwards wrap.
 * @param {number} tile  x + 1 or y + 1
 */
const farUV = tile => (tile % WATER_UV_REPEAT_TILES) / WATER_UV_REPEAT_TILES || 1;

/**
 * R-MAP-011: the six water vertices of cell (x, y), `[x, level, z, u, v]` each, in legacy
 * order (Ground.js:555-585): two triangles (x0,y0)(x1,y0)(x1,y1) and (x1,y1)(x0,y1)(x0,y0),
 * at world scale 2 per tile.
 * @param {number} x
 * @param {number} y
 * @param {number} waterLevel
 */
export function waterQuadVertices(x, y, waterLevel) {
	const [u0, v0] = waterUV(x, y);
	const u1 = farUV(x + 1);
	const v1 = farUV(y + 1);
	const x0 = x * 2;
	const x1 = (x + 1) * 2;
	const z0 = y * 2;
	const z1 = (y + 1) * 2;
	return [
		[x0, waterLevel, z0, u0, v0],
		[x1, waterLevel, z0, u1, v0],
		[x1, waterLevel, z1, u1, v1],
		[x1, waterLevel, z1, u1, v1],
		[x0, waterLevel, z1, u0, v1],
		[x0, waterLevel, z0, u0, v0]
	];
}

/** R-MAP-011: water draws after opaque entities, depth test on, write off. */
export const WATER_PASS_STATE = Object.freeze({
	depthTest: true,
	depthWrite: false,
	blend: Object.freeze({ src: 'SRC_ALPHA', dst: 'ONE_MINUS_SRC_ALPHA' })
});
