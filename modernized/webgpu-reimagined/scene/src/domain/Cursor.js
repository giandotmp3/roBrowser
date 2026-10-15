import { CURSOR_SPEED } from '../constants.js';
import { notImplemented } from '../errors.js';

/**
 * Game cursor timing (R-UI-005). Pixel output is produced by preview2d; scene owns
 * frame cadence, magnetism and the standalone loop when the scene loop is stopped.
 */

/** @param {string} type */
export const cursorSpeedMultiplier = type => CURSOR_SPEED[type] ?? CURSOR_SPEED.OTHER;

/**
 * @param {object} p
 * @param {number} p.elapsed ms since the cursor animation started
 * @param {number} p.actDelay ms per frame from the ACT
 * @param {string} p.type
 * @param {number} p.frameCount
 * @param {boolean} p.oneShot
 */
export const cursorFrame = ({ elapsed, actDelay, type, frameCount, oneShot }) => {
	const frame = Math.floor(elapsed / (actDelay * cursorSpeedMultiplier(type)));
	return oneShot ? Math.min(frame, frameCount - 1) : frame % frameCount;
};

/**
 * Magnetism: snap to the hovered mob (snap pref) or item (itemsnap pref) centre.
 * @param {{x:number,y:number}} mouse
 * @param {{ kind: string, screenCenter: {x:number,y:number} }|null} hovered
 * @param {{ snap: boolean, itemsnap: boolean }} prefs
 */
export const applyMagnetism = (mouse, hovered, prefs) => {
	if (hovered && ((hovered.kind === 'MOB' && prefs.snap) || (hovered.kind === 'ITEM' && prefs.itemsnap))) {
		return { ...hovered.screenCenter };
	}
	return { ...mouse };
};

/** Per-type hotspot table. */
export const cursorHotspot = _type => notImplemented('cursorHotspot table', 'R-UI-005');

/** Animate the cursor on its own rAF while the scene loop is stopped. */
export class StandaloneCursorLoop {
	/** @param {object} _deps */
	constructor(_deps) {}
	start() {
		notImplemented('StandaloneCursorLoop.start', 'R-UI-005');
	}
	stop() {}
}
