import { WALK_MOTION_CONSTANT } from './constants.js';
import { notImplemented } from '../util/errors.js';

/**
 * R-SPR-028 walk cadence follows distance.
 * @param {number} walkDistance cells walked
 * @param {number} actDelayMs
 * @param {number} motionCount
 */
export function walkFrame(walkDistance, actDelayMs, motionCount) {
	return Math.floor((walkDistance * WALK_MOTION_CONSTANT) / actDelayMs) % motionCount;
}

/**
 * R-SPR-027 animation frame selection (ACT delay, attack speed, headDir
 * frames, non-repeat hold + next, speed/length overrides). Pending.
 * @param {Object} _entity
 * @param {Object} _act
 * @param {number} _tick
 * @returns {{frame: number, next: number|null}}
 */
export function selectAnimationFrame(_entity, _act, _tick) {
	return notImplemented('R-SPR-027', 'animation frame selection');
}
