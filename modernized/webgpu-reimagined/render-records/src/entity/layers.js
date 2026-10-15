import { DEFAULT_BODY_ZINDEX, EntityType, FALCON_ZINDEX } from './constants.js';
import { notImplemented } from '../util/errors.js';

/**
 * R-SPR-008 duplicate headgear suppression.
 * @param {{top: number, mid: number, bottom: number}} hats
 */
export function suppressDuplicateHeadgears({ top, mid, bottom }) {
	return {
		bottom,
		mid: mid && mid === bottom ? 0 : mid,
		top: top && (top === bottom || top === mid) ? 0 : top
	};
}

const HEAD_SIZE = 64;
const ROBE_COMPENSATION = 25;

/**
 * R-SPR-009 robe z-correction.
 * @param {Object} s
 * @param {boolean} s.lookingFront
 * @param {boolean} s.sitting
 * @param {boolean} s.riding
 * @param {number} [s.robeHeight]
 * @param {number} [s.bodyHeight]
 */
export function robeZCorrection({ lookingFront, sitting, riding, robeHeight = 0, bodyHeight = 0 }) {
	if (robeHeight && bodyHeight) {
		let bonus = ROBE_COMPENSATION;
		if (sitting) {
			bonus = 0;
		} else if (riding && lookingFront) {
			bonus = ROBE_COMPENSATION * 2;
		}
		if (robeHeight + bonus > bodyHeight + HEAD_SIZE) {
			if (sitting) {
				if (lookingFront) {
					return -450;
				}
				return riding ? 1 : -100;
			}
			if (lookingFront) {
				return -300;
			}
			return riding ? 100 : 1;
		}
	}
	if (sitting) {
		return lookingFront ? -100 : 550;
	}
	return lookingFront ? 1 : 400;
}

const DEPTH_WRITING_TYPES = new Set([EntityType.PC, EntityType.MERC, EntityType.HOM, EntityType.FALCON, EntityType.NPC]);

/**
 * R-SPR-013 body depth write / zIndex by entity type.
 * @param {string} type EntityType
 */
export function bodyDepthState(type) {
	return {
		depthTest: true,
		depthWrite: DEPTH_WRITING_TYPES.has(type),
		zIndex: type === EntityType.FALCON ? FALCON_ZINDEX : DEFAULT_BODY_ZINDEX
	};
}

/**
 * @typedef {Object} LayerPlanEntry
 * @property {string} slot   'shadow' | 'cartShadow' | 'cart' | 'robe' | 'body' | 'head' | 'hatMid' | 'hatTop' | 'hatBottom' | 'weapon' | 'weaponTrail' | 'shield'
 * @property {number} zIndex
 * @property {boolean} depthWrite
 */

/**
 * R-SPR-007 player / mercenary layer composition: ordered slots with zIndex
 * and depth-write. Pending implementation.
 * @param {Object} _entity  Mixin-composed entity snapshot
 * @returns {LayerPlanEntry[]}
 */
export function planPlayerLayers(_entity) {
	return notImplemented('R-SPR-007', 'player/mercenary layer plan');
}
