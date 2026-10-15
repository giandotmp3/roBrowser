/**
 * The world parity page's script: cameras, fog, sky, grid-selector cells, and the
 * captured ticks with their preference variants (fog, lightmap, smoothlight, occluder
 * fade). Every tick from START_TICK to the last capture renders on both sides (animated
 * RSM matrices and the occluder strength are stateful); captured ticks avoid the ones
 * where legacy's tick/(1000/60) and the rebuild's tick·60/1000 water frame disagree.
 */
import { cameraMatrices } from '../common.js';
import { invert } from '../../src/world/glm32.js';
import { heightAt } from './assets.js';

/** Map camera: pitch 230° (legacy angle[0] range: looking down from RO's negative Y). */
export const CAMERA = Object.freeze({ target: [14, 13], distance: 46, pitch: 230, yaw: 25, fovy: 20 });

/** Map fog entry (DB values × 240 already applied): near/far bracket the map's depth. */
export const FOG = Object.freeze({ near: 30, far: 62, color: [0.62, 0.68, 0.8] });

/** WeatherTable.sky entry (R-CTX-009): the clear colour. */
export const SKY = Object.freeze({ skyColor: [0.42, 0.55, 0.78, 1], cloudColor: null });

/** Mouse hit cell (R-MAP-021), without captcha range. */
export const GRID = Object.freeze({ x: 13, y: 16 });

export const START_TICK = 600;
export const TICK_MS = 30;

/**
 * Occluder camera: the focus (camera target) is placed so the line of sight from the
 * eye passes through the static box at (12, 9) (R-MAP-019 query hits).
 */
export const OCCLUDER_CAMERA = (() => {
	const base = { distance: 46, pitch: 230, yaw: 25, fovy: 20 };
	const { modelView } = cameraMatrices({ ...base, target: [0, 0] }, 640, 480);
	const inv = invert(new Float32Array(16), modelView);
	const eye = [inv[12] - 0.5, inv[13], inv[14] - 0.5];
	const box = [12, heightAt(12, 9) - 1.6, 9];
	const f = box[1] / eye[1];
	const focus = [box[0] - f * eye[0], box[2] - f * eye[2]];
	return Object.freeze({ ...base, target: [focus[0] - 0.5, focus[1] - 0.5] });
})();

/**
 * Captured ticks. A capture's settings hold until the next capture (the phase).
 * `waterCheck` / `animatedCheck`: run the R-MAP-010 / R-MAP-013 fix checks there.
 */
export const CAPTURES = Object.freeze([
	{ name: 'world-t660', at: 660 },
	{ name: 'world-t720-fog', at: 720, fog: true },
	{ name: 'world-t780-smoothlight1', at: 780, smoothlight: 1 },
	{ name: 'world-t840-smoothlight2-fog', at: 840, smoothlight: 2, fog: true },
	{ name: 'world-t960-lightmap-off', at: 960, lightmap: false, animatedCheck: true },
	{ name: 'world-t1200-anim', at: 1200, waterCheck: true },
	{ name: 'world-t1500-anim-fog', at: 1500, fog: true },
	{ name: 'world-t1680-captcha-grid', at: 1680, grid: { x: 16, y: 11, range: 2 } },
	{ name: 'world-t2220-occluder-dither-start', at: 2220, occluder: { mode: 'dither' } },
	{ name: 'world-t2280-occluder-dither', at: 2280, occluder: { mode: 'dither' } },
	{ name: 'world-t2400-occluder-dither-full', at: 2400, occluder: { mode: 'dither' } },
	{ name: 'world-t2490-occluder-alpha', at: 2490, occluder: { mode: 'alpha' }, fog: true }
]);
