import { WATER_FRAMES, WATER_OPACITY_DEFAULT, WATER_OPAQUE_TYPES } from '../constants.js';

/**
 * Frame number at 60 fps. Computed as tick·60/1000 rather than tick/(1000/60):
 * identical in intent, but exact on integer ticks (the division form yields
 * 59.999… at tick 1000 and drops a frame at boundaries).
 */
const frameAt = tick => (tick * 60) / 1000;

/** R-MAP-008: wave and level are RSW values /5. */
export function waterParams(rsw) {
	return {
		level: rsw.level / 5,
		waveHeight: rsw.waveHeight / 5,
		waveSpeed: rsw.waveSpeed,
		wavePitch: rsw.wavePitch,
		animSpeed: rsw.animSpeed,
		type: rsw.type
	};
}

/** R-MAP-008: offset = (frame·speed mod 360) − 180, frame = tick / (1000/60). */
export function waveOffset(tick, waveSpeed) {
	const frame = frameAt(tick);
	return ((frame * waveSpeed) % 360) - 180;
}

/** R-MAP-008 vertex displacement (reference for shaders/water.wgsl). */
export function waveY(y, { x, z, diff }, { offset, wavePitch, waveHeight }) {
	return y + Math.sin(((offset + 0.5 * wavePitch * (x + z + diff)) * Math.PI) / 180) * waveHeight;
}

/** R-MAP-009: frame index floor(frame / animSpeed) % 32, frame = tick / 16.67. */
export function waterFrameIndex(tick, animSpeed) {
	return Math.floor(frameAt(tick) / animSpeed) % WATER_FRAMES;
}

/** R-MAP-010: uOpacity is 0.8, or 1.0 for types 4 and 6. */
export function waterOpacity(type) {
	return WATER_OPAQUE_TYPES.includes(type) ? 1.0 : WATER_OPACITY_DEFAULT;
}

/**
 * Reference of shaders/water.wgsl (R-MAP-010 FIX): alpha = opacity applied
 * once (legacy squared it to 0.64). Texture alpha ignored; water is unlit.
 */
export function shadeWater(tex, opacity) {
	return [tex[0], tex[1], tex[2], opacity];
}

/** R-MAP-011: water pipeline depth state; drawn after opaque entities. */
export const WATER_DEPTH = Object.freeze({ depthTest: true, depthWrite: false });
