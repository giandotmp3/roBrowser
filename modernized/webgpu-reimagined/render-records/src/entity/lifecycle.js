import { EntityType } from './constants.js';
import { notImplemented } from '../util/errors.js';

/**
 * R-SPR-026 removal plan.
 * @param {{reason: 'outOfSight'|'death'|'other', type: string}} s
 */
export function removalPlan({ reason, type }) {
	if (reason === 'outOfSight') {
		return { fadeMs: 1000, playDie: false, loopDie: false, remove: true };
	}
	if (reason === 'death') {
		if (type === EntityType.PC) {
			return { fadeMs: 0, playDie: true, loopDie: true, remove: false };
		}
		if (type !== EntityType.WUG) {
			return { fadeMs: 5000, playDie: true, loopDie: false, remove: true };
		}
	}
	return { fadeMs: 0, playDie: false, loopDie: false, remove: true };
}

/**
 * R-SPR-026 alpha multiplier during removal.
 * @param {number} elapsedMs
 * @param {number} delayMs
 */
export function removalAlpha(elapsedMs, delayMs) {
	if (delayMs <= 0) {
		return 0;
	}
	return Math.max(0, 1 - elapsedMs / delayMs);
}

/**
 * R-SPR-029 head turning (lookTo). Pending implementation.
 * @param {{direction: number, headDir: number}} _current
 * @param {number} _targetDirection
 * @returns {{direction: number, headDir: number}}
 */
export function lookTo(_current, _targetDirection) {
	return notImplemented('R-SPR-029', 'lookTo head/body turning');
}

/**
 * R-SPR-033 dropped item fall: 25 cells per second, never below ground.
 * @param {number} groundHeight
 * @param {number} z0
 * @param {number} elapsedMs
 */
export function droppedItemZ(groundHeight, z0, elapsedMs) {
	return Math.max(groundHeight, z0 - elapsedMs / 40);
}
