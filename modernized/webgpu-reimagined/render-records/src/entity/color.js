import { BLEND_ADDITIVE, BLEND_NORMAL } from '../records/blend.js';

/** @typedef {[number, number, number, number]} Rgba */

const WHITE = /** @type {Rgba} */ ([1, 1, 1, 1]);

/**
 * Per-channel product.
 * @param {...Rgba} colors
 * @returns {Rgba}
 */
export function multiplyColors(...colors) {
	return /** @type {Rgba} */ (colors.reduce((acc, c) => acc.map((v, i) => v * (c[i] ?? 1)), [...WHITE]));
}

/**
 * R-SPR-018 effectColor = bodyState × healthState × effectState × virtue × flash.
 * @param {{bodyState?: Rgba, healthState?: Rgba, effectState?: Rgba, virtue?: Rgba, flash?: Rgba}} parts
 * @returns {Rgba}
 */
export function composeEffectColor({
	bodyState = WHITE,
	healthState = WHITE,
	effectState = WHITE,
	virtue = WHITE,
	flash = WHITE
} = {}) {
	return multiplyColors(bodyState, healthState, effectState, virtue, flash);
}

/**
 * R-SPR-017 final layer colour.
 * @param {[number, number, number, number]} layerColorBytes ACT colour bytes 0..255
 * @param {Rgba} effectColor
 * @param {number} shadowFactor
 * @returns {{color: Rgba, skip: boolean}}
 */
export function finalLayerColor(layerColorBytes, effectColor, shadowFactor) {
	const c = layerColorBytes.map((b, i) => (b / 255) * effectColor[i]);
	const color = /** @type {Rgba} */ ([c[0] * shadowFactor, c[1] * shadowFactor, c[2] * shadowFactor, c[3]]);
	return { color, skip: color[3] === 0 };
}

/**
 * R-SPR-019 body state tints.
 * @param {'NONE'|'STONE'|'STONE_WAIT'|'FREEZE'|'SLEEP'|'STUN'} state
 */
export function bodyStateTint(state) {
	switch (state) {
		case 'STONE':
			return {
				color: /** @type {Rgba} */ ([0.1, 0.1, 0.1, 1]),
				pauseAnimation: true,
				attachments: [],
				pose: null
			};
		case 'STONE_WAIT':
			return {
				color: /** @type {Rgba} */ ([0.3, 0.3, 0.3, 1]),
				pauseAnimation: false,
				attachments: [],
				pose: null
			};
		case 'FREEZE':
			return {
				color: /** @type {Rgba} */ ([0, 0.4, 0.8, 1]),
				pauseAnimation: false,
				attachments: ['ice'],
				pose: 'FREEZE2'
			};
		case 'SLEEP':
			return { color: WHITE, pauseAnimation: false, attachments: ['head:sleep'], pose: null };
		case 'STUN':
			return { color: WHITE, pauseAnimation: false, attachments: ['head:stun'], pose: null };
		default:
			return { color: WHITE, pauseAnimation: false, attachments: [], pose: null };
	}
}

/**
 * R-SPR-020 health state tints and attachments.
 * @param {{curse?: boolean, poison?: boolean, silence?: boolean}} flags
 */
export function healthStateTint({ curse = false, poison = false, silence = false } = {}) {
	/** @type {Rgba} */
	let color = [...WHITE];
	const attachments = [];
	if (curse) {
		color = multiplyColors(color, [0.5, 0.15, 0.1, 1]);
		attachments.push({ id: 'curse', opacity: 0.5 });
	}
	if (poison) {
		color = multiplyColors(color, [0.9, 0.4, 0.8, 1]);
	}
	if (silence) {
		attachments.push({ id: 'emotion:silence', depth: 5 });
	}
	return { color, attachments };
}

/**
 * R-SPR-021 invisibility states.
 * @param {'NONE'|'INVISIBLE'|'HIDE'|'CLOAK'|'CHASEWALK'|'CAMOUFLAGE'|'STEALTHFIELD'|'SHADOWFORM'} state
 * @param {boolean} localIntravision Local player has intravision
 * @returns {Rgba}
 */
export function invisibilityTint(state, localIntravision) {
	if (state === 'NONE') {
		return [...WHITE];
	}
	if (localIntravision) {
		return [0, 0, 0, 1];
	}
	switch (state) {
		case 'CAMOUFLAGE':
		case 'STEALTHFIELD':
			return [1, 1, 1, 0.1];
		case 'SHADOWFORM':
			return [0.2, 0.2, 0.2, 0.2];
		default:
			return [1, 1, 1, 0];
	}
}

/**
 * R-SPR-022 buff (virtue) tints; later checks overwrite earlier ones.
 * @param {Set<string>|string[]} flags  e.g. ['QUICKEN', 'BERSERK']
 * @returns {Rgba}
 */
export function virtueTint(flags) {
	const has = new Set(flags);
	/** @type {Rgba} */
	const c = [1, 1, 1, 1];
	const set = (r, g, b, a) => {
		[r, g, b, a].forEach((v, i) => {
			if (v !== undefined) {
				c[i] = v;
			}
		});
	};
	if (has.has('QUICKEN')) {
		set(undefined, undefined, 0);
	}
	if (has.has('EXPLOSIONSPIRITS')) {
		set(1, 0.75, 0.75);
	}
	if (has.has('BLADESTOP')) {
		set(0.25, 0.25, 0.25);
	}
	if (has.has('ENERGYCOAT') || has.has('BUNSIN')) {
		set(0.5, 0.5, 0.85);
	}
	if (has.has('OVERTHRUST')) {
		set(undefined, 0.75, 0.75);
	}
	if (has.has('WARM')) {
		set(undefined, 0.4, 0.4);
	}
	if (has.has('SOULLINK')) {
		set(0.35, 0.35, 0.9, 0.9);
	}
	if (has.has('UNDEAD')) {
		set(0.7, undefined, 0.65);
	}
	if (has.has('MARIONETTE')) {
		set(1, 0.34, 0.71, 0.5);
	}
	if (has.has('BERSERK')) {
		set(1, 0.4, 0.4, 1);
	}
	return c;
}

/**
 * R-SPR-023 additive bodies (Berserk on non-shadow layers, or Marionette).
 * @param {{berserk?: boolean, marionette?: boolean, isShadowLayer?: boolean}} s
 */
export function layerBlend({ berserk = false, marionette = false, isShadowLayer = false } = {}) {
	if (marionette || (berserk && !isShadowLayer)) {
		return BLEND_ADDITIVE;
	}
	return BLEND_NORMAL;
}
