import { CURSOR_CELL_SIZE } from '../constants.js';
import { ENTITY_TYPE, cursorInfo } from './CursorTypes.js';

/**
 * R-UI-005: choose the animation frame of the current cursor action.
 *
 * delay = ACT action delay x per-type multiplier; frame = floor((tick - start) / delay).
 * One-shot cursors clamp at their last frame; others loop. When paused, the
 * explicitly selected frame is kept.
 *
 * @param {Object} p
 * @param {number} p.type            CURSOR_ACTION.*
 * @param {number} p.actDelay        ACT action delay (ms)
 * @param {number} p.frameCount      animations in the action
 * @param {number} p.tick            now (ms)
 * @param {number} p.startTick       when the cursor type was set (ms)
 * @param {boolean} [p.oneShot]      legacy `_norepeat`
 * @param {boolean} [p.playing]      legacy `_play`
 * @param {number} [p.pausedFrame]   legacy `_animation`
 * @returns {number}
 */
export function selectCursorFrame({
	type,
	actDelay,
	frameCount,
	tick,
	startTick,
	oneShot = false,
	playing = true,
	pausedFrame = 0
}) {
	if (!playing) {
		return pausedFrame;
	}
	if (frameCount <= 0) {
		return 0;
	}
	const delay = actDelay * cursorInfo(type).delayMult;
	const frame = Math.max(0, Math.floor((tick - startTick) / delay));
	return oneShot ? Math.min(frame, frameCount - 1) : frame % frameCount;
}

/**
 * R-UI-005: the cursor's top-left translation (hotspot), including magnetism.
 *
 * With magnetism on (and not blocked) and a hovered entity:
 * - mobs, NPC_ABR and NPC_BIONIC snap when the `snap` preference is on;
 * - items snap when `itemsnap` is on;
 * - the hotspot is shifted by floor(mouse - rectCentre) so the drawn cursor
 *   lands on the entity's screen-rect centre.
 *
 * @param {Object} p
 * @param {number} p.type
 * @param {boolean} [p.magnetism]
 * @param {boolean} [p.blockMagnetism]
 * @param {{objecttype: number, boundingRect: {x1: number, y1: number, x2: number, y2: number}}|null} [p.overEntity]
 * @param {{x: number, y: number}} [p.mouse]
 * @param {{snap?: boolean, itemsnap?: boolean}} [p.prefs]
 * @returns {{x: number, y: number}}
 */
export function cursorHotspot({
	type,
	magnetism = false,
	blockMagnetism = false,
	overEntity = null,
	mouse = { x: 0, y: 0 },
	prefs = {}
}) {
	const info = cursorInfo(type);
	let x = info.startX;
	let y = info.startY;

	if (magnetism && !blockMagnetism && overEntity) {
		let snap = false;
		switch (overEntity.objecttype) {
			case ENTITY_TYPE.MOB:
			case ENTITY_TYPE.NPC_ABR:
			case ENTITY_TYPE.NPC_BIONIC:
				snap = !!prefs.snap;
				break;
			case ENTITY_TYPE.ITEM:
				snap = !!prefs.itemsnap;
				break;
			default:
				break;
		}
		if (snap) {
			const r = overEntity.boundingRect;
			x += Math.floor(mouse.x - (r.x1 + (r.x2 - r.x1) / 2));
			y += Math.floor(mouse.y - (r.y1 + (r.y2 - r.y1) / 2));
		}
	}
	return { x, y };
}

/**
 * CSS for the cursor element given the sheet cell and hotspot.
 * @param {number} cellIndex
 * @param {{x: number, y: number}} hotspot
 */
export function cursorStyle(cellIndex, hotspot) {
	return {
		spriteLeft: `${-cellIndex * CURSOR_CELL_SIZE}px`,
		// Legacy wrote `translate(-${x}px, ...)`, which yields invalid `--5px` once
		// magnetism makes the hotspot negative; negate numerically instead.
		transform: `translate(${-hotspot.x}px, ${-hotspot.y}px)`
	};
}
