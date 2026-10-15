/**
 * Legacy `EffectManager` facade (effects.spam / spamSkill* / remove) + weather.startOrRestart.
 * Effect logic lives in render-records (EffectSystem); scene only normalises the API, including
 * class-name aliases for `remove(ctorOrName, AID, effectID)` so callers need not import renderer classes.
 *
 * @typedef {object} EffectSystemPort   render-records EffectSystem boundary
 * @property {(params: object) => void} spam
 * @property {(kind: string, args: unknown[]) => void} spamSkill
 * @property {(className: string|null, aid: number|undefined, effectId: number|undefined) => void} remove
 * @property {(ownerAid: number, tick: number) => void} startOrRestartWeather
 * @property {() => void} free
 */

/** @param {Function|string|null|undefined} ctorOrName */
export const effectClassName = ctorOrName => {
	if (ctorOrName == null) {
		return null;
	}
	if (typeof ctorOrName === 'string') {
		return ctorOrName;
	}
	if (typeof ctorOrName === 'function') {
		return ctorOrName.name || null;
	}
	throw new TypeError('EffectManager.remove expects a constructor, a class name or null');
};

/** @param {{ effects: EffectSystemPort }} deps */
export const createEffectManagerFacade = ({ effects }) => ({
	/** effects.spam — EF_Init_Par */
	spam(params) {
		effects.spam(params);
	},
	spamSkill(...args) {
		effects.spamSkill('skill', args);
	},
	spamSkillZone(...args) {
		effects.spamSkill('zone', args);
	},
	spamSkillHit(...args) {
		effects.spamSkill('hit', args);
	},
	spamSkillSuccess(...args) {
		effects.spamSkill('success', args);
	},
	/** effects.remove(ctorOrNameOrNull, AID, effectID) */
	remove(ctorOrName, aid, effectId) {
		effects.remove(effectClassName(ctorOrName), aid, effectId);
	},
	/** weather.startOrRestart */
	startOrRestartWeather(ownerAid, tick) {
		effects.startOrRestartWeather(ownerAid, tick);
	},
	free() {
		effects.free();
	}
});
