import { EntityType } from './constants.js';

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
 * Direction 0..7 from an entity cell toward a target (legacy lookTo, Entity.js:506-519): offsets
 * are rounded first; 0 = south (also the own cell), 2 = west, 4 = north, 6 = east.
 * @param {number} dx target x - entity x (cells)
 * @param {number} dy target y - entity y (cells)
 * @returns {number}
 */
export function directionTo(dx, dy) {
	const x = Math.round(dx);
	const y = Math.round(dy);
	if (x >= 1) {
		if (y >= 1) {
			return 5;
		}
		return y === 0 ? 6 : 7;
	}
	if (x === 0) {
		return y >= 1 ? 4 : 0;
	}
	if (y >= 1) {
		return 3;
	}
	return y === 0 ? 2 : 1;
}

/**
 * R-SPR-029 head turning (legacy lookTo, Entity.js:521-571). The head only ever sits one step off
 * the body (headDir 1 = body one step clockwise of the target, 2 = one step counter-clockwise).
 * With d = (current - target + 8) % 8:
 *  - d 0: the head straightens, the body stays;
 *  - d 1 / 7: only the head turns (2 / 1), unless it already turned that way, then the body takes
 *    the target and the head straightens;
 *  - d 2, 3 / 5, 6: the body stops one step short of the target and the head turns (2 / 1);
 *  - d 4 (opposite): a turned head keeps its side and the body stops one step short; a straight
 *    head turns the whole body.
 * Legacy switches on d - 4 (cases -3..3), so its `default` "turn" branch is unreachable.
 * @param {{direction: number, headDir: number}} current
 * @param {number} target direction 0..7 (see directionTo)
 * @returns {{direction: number, headDir: number}}
 */
export function lookTo({ direction, headDir }, target) {
	if (direction === target) {
		return { direction, headDir: 0 };
	}
	const left = { direction: (target + 9) % 8, headDir: 2 };
	const right = { direction: (target + 7) % 8, headDir: 1 };
	switch ((direction - target + 8) % 8) {
		case 1:
			return headDir === 2 ? { direction: target, headDir: 0 } : left;
		case 2:
		case 3:
			return left;
		case 5:
		case 6:
			return right;
		case 7:
			return headDir === 1 ? { direction: target, headDir: 0 } : right;
		default:
			// d 4: opposite
			if (headDir === 2) {
				return { direction: left.direction, headDir };
			}
			if (headDir === 1) {
				return { direction: right.direction, headDir };
			}
			return { direction: target, headDir: 0 };
	}
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
