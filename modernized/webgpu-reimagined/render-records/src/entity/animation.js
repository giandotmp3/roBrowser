import { DEFAULT_FRAME_DELAY_MS, EntityType, WALK_MOTION_CONSTANT } from './constants.js';

/**
 * Action ids a render rule needs, per entity (legacy `entity.ACTION`, EntityAction.js:37-59,
 * 157-276). The defaults are the player table (EntityAction.js:159-173). An entity snapshot may
 * carry its own `actions` table (mobs, homunculi, NPCs use other ids); unknown ids are -1.
 */
export const PC_ACTIONS = Object.freeze({
	IDLE: 0,
	WALK: 1,
	SIT: 2,
	PICKUP: 3,
	READYFIGHT: 4,
	ATTACK: -2,
	ATTACK1: 5,
	HURT: 6,
	FREEZE: 7,
	DIE: 8,
	FREEZE2: 9,
	ATTACK2: 10,
	ATTACK3: 11,
	SKILL: 12
});

/**
 * @typedef {Object} AnimationState
 * @property {number} tick      Start time of the current action (spawn or setAction time, never epoch 0)
 * @property {number} frame     Start / held frame
 * @property {boolean} repeat
 * @property {boolean} play
 * @property {Object|false} next Action option applied when a one-shot body animation ends
 * @property {number} delay     Deferred-action due time (with `save`)
 * @property {number|false} speed  Per-frame delay override (ms)
 * @property {number|false} length Frame-count override
 * @property {Object|false} save   Deferred action option
 */

/**
 * Fresh animation state, as legacy `new Animation()` (EntityAction.js:64-72) but keyed to a start
 * time. Discrepancy #13 FIX: legacy left `tick` at 0 after an `objecttype` spawn, so idle frames
 * followed the wall-clock epoch; here the clock always starts at spawn / setAction time.
 * @param {number} tick
 * @returns {AnimationState}
 */
export function createAnimationState(tick) {
	return {
		tick,
		frame: 0,
		repeat: true,
		play: true,
		next: false,
		delay: 0,
		speed: false,
		length: false,
		save: false
	};
}

/**
 * Start an action (render-relevant part of legacy setAction, EntityAction.js:118, 133-142).
 * Deferred options (`delay`), the ATTACK → ATTACK1..3 weapon mapping and route resets
 * (EntityAction.js:82-131) belong to the scene's setAction, not to frame composition.
 * @param {{action: number, animation?: AnimationState, actions?: Object}} entity mutated
 * @param {Object} option {action, frame, speed, length, repeat, play, next}
 * @param {number} tick
 */
export function startAction(entity, option, tick) {
	const actions = entity.actions ?? PC_ACTIONS;
	entity.action = option.action === -1 || option.action === undefined ? actions.IDLE : option.action;
	entity.animation = {
		...createAnimationState(tick),
		frame: option.frame || 0,
		speed: option.speed || false,
		length: option.length || false,
		repeat: option.repeat || false,
		play: option.play !== undefined ? option.play : true,
		next: option.next || false
	};
}

/**
 * R-SPR-028 walk cadence follows distance.
 * @param {number} walkDistance cells walked
 * @param {number} actDelayMs
 * @param {number} motionCount
 */
export function walkFrame(walkDistance, actDelayMs, motionCount) {
	return Math.floor((walkDistance * WALK_MOTION_CONSTANT) / actDelayMs) % motionCount;
}

const isAttack = (action, actions) =>
	action === actions.ATTACK || action === actions.ATTACK1 || action === actions.ATTACK2 || action === actions.ATTACK3;

/**
 * R-SPR-027 per-frame delay (legacy getAnimationDelay, EntityRender.js:889-913).
 * @param {string} part legacy element type ('body', 'head', 'weapon', ...)
 * @param {Object} entity
 * @param {{delay?: number}} act ACT action
 * @param {number} frameCount
 */
function animationDelay(part, entity, act, frameCount) {
	const actions = entity.actions ?? PC_ACTIONS;
	if (part === 'body' && entity.action === actions.WALK && entity.walk) {
		return (act.delay / 150) * entity.walk.speed;
	}
	if (isAttack(entity.action, actions)) {
		if (act.delay > 0) {
			return act.delay;
		}
		if (entity.attackSpeed && frameCount > 0) {
			return Math.max(entity.attackSpeed / frameCount, 100);
		}
		return DEFAULT_FRAME_DELAY_MS;
	}
	return act.delay || DEFAULT_FRAME_DELAY_MS;
}

/**
 * R-SPR-027 animation frame selection (legacy calcAnimation, EntityRender.js:918-1053) with
 * R-SPR-028 distance-driven walk frames (EntityRender.js:981-1018). Pure: a finished one-shot
 * body animation is reported through `ended` / `next`; the caller holds the frame and starts
 * `next` (legacy did both inside calcAnimation, EntityRender.js:1044-1050).
 *
 * @param {Object} entity  {type, action, actions?, headDir, animation, walk?, attackSpeed?}
 * @param {{animations?: Array, frames?: number, delay?: number}} act ACT action (or a frame count)
 * @param {number} elapsedMs  time since `animation.tick`
 * @param {{part?: string, walkPhase?: {phase?: number}}} [opts] legacy element type; per-frame
 *        shared walk phase (EntityRender.js:993-1009: body is authoritative, other parts reuse it)
 * @returns {{frame: number, ended: boolean, next: Object|null}}
 */
export function selectAnimationFrame(entity, act, elapsedMs, { part = 'body', walkPhase = null } = {}) {
	const result = frame => ({ frame, ended: false, next: null });

	// Shadows always show frame 0 (EntityRender.js:919-922, R-SPR-011)
	if (part === 'shadow' || part === 'cartshadow') {
		return result(0);
	}

	const actions = entity.actions ?? PC_ACTIONS;
	const animation = entity.animation ?? createAnimationState(0);
	const action = entity.action;
	const animSize = act.animations ? act.animations.length : (act.frames ?? 0);
	const animLastIndex = animSize - 1;
	const isIdle = action === actions.IDLE || action === actions.SIT;
	const isPlayer = entity.type === EntityType.PC || entity.type === EntityType.MERC;
	let animCount = animSize;
	let delay = animationDelay(part, entity, act, animSize);
	let headDir = 0;

	// speed / length overrides (EntityRender.js:936-942)
	if (animation.length) {
		animCount = animation.length;
	}
	if (animation.speed) {
		delay = animation.speed;
	}

	// An idle cart shows frame 0 (EntityRender.js:944-946, R-SPR-010)
	if (part === 'cart' && isIdle) {
		return result(0);
	}

	// Idle PC body / robe: frame = headDir, no doridori (EntityRender.js:950-959)
	if ((part === 'body' || part === 'robe') && isPlayer && isIdle) {
		return result(entity.headDir <= animLastIndex ? entity.headDir : animLastIndex);
	}

	// Idle PC head and hats: 3 head-direction groups (EntityRender.js:963-970)
	if (part === 'head' && isPlayer && isIdle) {
		animCount = Math.floor(animCount / 3);
		headDir = entity.headDir <= animLastIndex ? entity.headDir : animLastIndex;
	}

	// Paused: stay on the current frame (EntityRender.js:973-979)
	if (animation.play === false) {
		return result((animCount * headDir + animation.frame) % animSize);
	}

	// R-SPR-028 walk: frame follows walked distance, falcons excluded (EntityRender.js:986-1018)
	if (action === actions.WALK && entity.walk && entity.type !== EntityType.FALCON) {
		const motionCount = Math.max(animation.length || animCount || 1, 1);
		const motionSpeed = Math.max(act.delay || 1, 1);
		let phase;
		if (!walkPhase || walkPhase.phase === undefined || part === 'body') {
			phase = (entity.walk.dist * WALK_MOTION_CONSTANT) / motionSpeed;
			if (walkPhase) {
				walkPhase.phase = phase;
			}
		} else {
			phase = walkPhase.phase;
		}
		return result(((Math.floor(phase) % motionCount) + motionCount * headDir + animation.frame) % animSize);
	}

	const step = Math.floor(elapsedMs / delay);

	// Repeating (EntityRender.js:1021-1032)
	if (animation.repeat) {
		return result(((step % animCount) + animCount * headDir + animation.frame) % animSize);
	}

	// One-shot: hold the last frame, then switch to `next` (EntityRender.js:1034-1052)
	let anim = Math.min(step, animCount ? animCount - 1 : 0);
	anim = ((anim % animCount) + animCount * headDir + animation.frame) % animSize;
	if (part === 'body' && step >= animCount - 1) {
		return {
			frame: Math.min(animation.frame + animCount - 1, animSize - 1),
			ended: true,
			next: animation.next || null
		};
	}
	return result(Math.min(anim, animSize - 1));
}
