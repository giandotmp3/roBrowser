import { Action, BODY_Z, DEFAULT_BODY_ZINDEX, EntityType, FALCON_ZINDEX } from './constants.js';
import { PC_ACTIONS } from './animation.js';
import { shouldDrawShadow } from './shadow.js';

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

const DEPTH_WRITING_TYPES = new Set([
	EntityType.PC,
	EntityType.MERC,
	EntityType.HOM,
	EntityType.FALCON,
	EntityType.NPC
]);

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
 * @property {string} slot   'shadow' | 'cartShadow' | 'cart' | 'robe' | 'body' | 'head' | 'hatMid' | 'hatTop' |
 *                           'hatBottom' | 'weapon' | 'weaponTrail' | 'shield' (also the view key)
 * @property {string} part   Legacy element type driving frame selection: hats are 'head', the cart
 *                           shadow is 'cartshadow', the weapon trail 'weapon_trail' (EntityRender.js:420-510)
 * @property {number|null} zIndex  Value the element resets zIndex to; null = no reset, continue the
 *                           running counter (weapon trail after weapon, back cart after its shadow)
 * @property {boolean} depthWrite
 * @property {boolean} main  Legacy `is_main`: drawn at the origin and its first anchor becomes the
 *                           attach point of later non-main elements (EntityRender.js:786-789, 873-876)
 * @property {boolean} [ignoreDepthMinCap]  R-SPR-005 (NPC bodies)
 */

const entry = (slot, part, zIndex, depthWrite, main) => ({ slot, part, zIndex, depthWrite, main });

/**
 * R-SPR-011 shadow element: zIndex -1, depth test on, write off (EntityRender.js:330-342).
 * @returns {LayerPlanEntry[]}
 */
function shadowPlan({ action = Action.IDLE, actions = PC_ACTIONS, job = 0, hideShadow = false }) {
	// The shadow test uses the clamped action (EntityRender.js:325, 331)
	const clamped = action < 0 ? actions.IDLE : action;
	if (!shouldDrawShadow({ action: clamped, job, hideShadow }, actions)) {
		return [];
	}
	return [entry('shadow', 'shadow', -1, false, false)];
}

/**
 * R-SPR-007 player / mercenary layer composition: ordered elements with the zIndex each one resets
 * to and its depth write (EntityRender.js:358-518), including R-SPR-008 duplicate headgear
 * suppression (:462-484), R-SPR-009 robe correction (:379-402, 426-430, 489-493), the R-SPR-010
 * cart gate (:414-424, 495-503) and R-SPR-011 shadow (:330-342). Draw order is the array order;
 * it differs from zIndex order (discrepancy #14).
 *
 * @param {Object} s
 * @param {string} [s.type]        EntityType.PC or EntityType.MERC
 * @param {number} [s.direction]   Visual direction 0..7 (camera + entity, R-SPR-001)
 * @param {number} [s.action]
 * @param {Object} [s.actions]     Action id table (default PC_ACTIONS)
 * @param {number} [s.job]
 * @param {boolean} [s.hideShadow]
 * @param {number} [s.weapon]
 * @param {number} [s.shield]
 * @param {number} [s.robe]
 * @param {{top?: number, mid?: number, bottom?: number}} [s.hats] accessory2 / accessory3 / accessory
 * @param {boolean|number} [s.cart] A cart is shown (hasCart while Session.Playing)
 * @param {boolean} [s.riding]
 * @param {number} [s.robeHeight]  Last measured robe height (legacy entity.robeHeight)
 * @param {number} [s.bodyHeight]  Last measured body height (legacy entity.bodyHeight)
 * @returns {LayerPlanEntry[]}
 */
export function planPlayerLayers(s) {
	const {
		direction = 0,
		action = Action.IDLE,
		actions = PC_ACTIONS,
		weapon = 0,
		shield = 0,
		robe = 0,
		hats = {},
		cart = false,
		riding = false,
		robeHeight = 0,
		bodyHeight = 0
	} = s;
	const plan = shadowPlan(s);
	const behind = direction > 1 && direction < 6;
	const back = direction > 2 && direction < 6;
	const sitting = action === actions.SIT;
	const walking = action === actions.WALK;
	const robeZ = lookingFront => robeZCorrection({ lookingFront, sitting, riding: !!riding, robeHeight, bodyHeight });

	// Shield behind the body on directions 2-5 (EntityRender.js:404-410)
	if (shield && behind) {
		plan.push(entry('shield', 'shield', -1, false, true));
	}

	if (!back) {
		if (cart) {
			// Front cart: drawn first, no depth write (EntityRender.js:414-424)
			plan.push(entry('cartShadow', 'cartshadow', -1, false, false));
			plan.push(entry('cart', 'cart', 1, false, false));
		}
		if (robe > 0) {
			plan.push(entry('robe', 'robe', robeZ(true), true, true));
		}
	}

	// Body; a rider sitting or walking toward the front doubles it (EntityRender.js:433-443)
	const bodyZIndex = riding && !back && (sitting || walking) ? DEFAULT_BODY_ZINDEX * 2 : DEFAULT_BODY_ZINDEX;
	plan.push(entry('body', 'body', bodyZIndex, true, true));

	// bodyZ (EntityRender.js:445-452)
	let bodyZ = BODY_Z;
	if (riding) {
		bodyZ *= 2;
		if (walking && !back) {
			bodyZ += BODY_Z;
		}
	}

	plan.push(entry('head', 'head', bodyZ + 50, true, false));

	// R-SPR-008: mid skipped when equal to lower, top when equal to lower or mid
	const shown = suppressDuplicateHeadgears({ top: hats.top ?? 0, mid: hats.mid ?? 0, bottom: hats.bottom ?? 0 });
	if (shown.mid > 0) {
		plan.push(entry('hatMid', 'head', bodyZ + 100, true, false));
	}
	if (shown.top > 0) {
		plan.push(entry('hatTop', 'head', bodyZ + 200, true, false));
	}
	if (shown.bottom > 0) {
		plan.push(entry('hatBottom', 'head', bodyZ + 300, true, false));
	}

	if (back) {
		// Back robe after the hats, back cart at bodyZ + 500 (EntityRender.js:486-504)
		if (robe > 0) {
			plan.push(entry('robe', 'robe', bodyZ + robeZ(false), true, true));
		}
		if (cart) {
			plan.push(entry('cartShadow', 'cartshadow', bodyZ + 500, false, false));
			plan.push(entry('cart', 'cart', null, false, false));
		}
	}

	if (weapon > 0) {
		plan.push(entry('weapon', 'weapon', bodyZ + 250, true, true));
		plan.push(entry('weaponTrail', 'weapon_trail', null, true, true));
	}

	if (shield > 0 && !behind) {
		plan.push(entry('shield', 'shield', bodyZ + 300, true, true));
	}

	return plan;
}

/**
 * Layer plan for any entity type: R-SPR-007 for PC / mercenary, otherwise shadow + one body with
 * the R-SPR-013 depth state (EntityRender.js:519-552) and R-SPR-005 NPC min-cap bypass (:533-541).
 * @param {Object} s see planPlayerLayers; `type` selects the branch
 * @returns {LayerPlanEntry[]}
 */
export function planEntityLayers(s) {
	const type = s.type ?? EntityType.PC;
	if (type === EntityType.PC || type === EntityType.MERC) {
		return planPlayerLayers(s);
	}
	const { depthWrite, zIndex } = bodyDepthState(type);
	return [
		...shadowPlan(s),
		{ ...entry('body', 'body', zIndex, depthWrite, true), ignoreDepthMinCap: type === EntityType.NPC }
	];
}
