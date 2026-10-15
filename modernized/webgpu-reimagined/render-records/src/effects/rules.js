/**
 * Pure effect rules (R-EFX-001..007, 012, 015, 017). EffectSystem composes them.
 */

/** R-EFX-006 aura effect IDs always drawn before entities. */
export const BEFORE_ENTITY_AURA_IDS = Object.freeze([200, 201, 202, 362, 397, 398, 881]);

export const DEFAULT_DUPLI_SPACING_MS = 200;
export const MAX_DUPLICATES = 999;
export const EFFECT_CULL_RADIUS = 20;

/**
 * R-EFX-001 the /effect preference off suppresses all spawned effects.
 * @param {{effect?: boolean}} prefs
 */
export function effectsEnabled({ effect = true } = {}) {
	return effect !== false;
}

/**
 * R-EFX-001 /mineffect uses the `min` STR when present.
 * @param {{file?: string, min?: string}} spec
 * @param {{mineffect?: boolean}} prefs
 */
export function resolveStrFile(spec, { mineffect = false } = {}) {
	return mineffect && spec.min ? spec.min : spec.file;
}

/**
 * Legacy `!isNaN(v)` test (EffectManager.js): true for numbers, numeric strings and null.
 * @param {*} v
 */
export function legacyIsNum(v) {
	return !Number.isNaN(Number(v));
}

/**
 * R-EFX-002 duplicate count: −1 → 999, capped at 999, default (and 0) 1.
 * @param {number|undefined} duplicate
 */
export function normalizeDuplicate(duplicate) {
	if (Number(duplicate) === -1) {
		return MAX_DUPLICATES;
	}
	return duplicate ? Math.min(duplicate, MAX_DUPLICATES) : 1;
}

/**
 * R-EFX-002 start offsets of duplicated instances.
 * @param {number} count
 * @param {number} [spacing]
 */
export function duplicateOffsets(count, spacing = DEFAULT_DUPLI_SPACING_MS) {
	return Array.from({ length: count }, (_, i) => i * spacing);
}

/**
 * R-EFX-003 start / end ticks of one instance (legacy EffectManager formula).
 * @param {Object} s
 * @param {number} s.spawnTick
 * @param {import('./EffectSpec.js').EffectSpec} s.spec
 * @param {number} [s.duplicateID]
 * @param {boolean} [s.noDelay]   true on repeats
 * @param {number} [s.initDuration]
 */
export function effectTiming({ spawnTick, spec, duplicateID = 0, noDelay = false, initDuration }) {
	const num = legacyIsNum;
	const duration = num(spec.duration) ? spec.duration : initDuration;
	const offsetDelta = num(spec.delayOffsetDelta) ? spec.delayOffsetDelta * duplicateID : 0;
	const lateDelta = num(spec.delayLateDelta) ? spec.delayLateDelta * duplicateID : 0;
	const delayOffset = num(spec.delayOffset) ? spec.delayOffset + offsetDelta : 0;
	const delayLate = num(spec.delayLate) ? spec.delayLate + lateDelta : 0;
	const startTick = spawnTick + (noDelay ? delayOffset + delayLate : spec.delayStart || 0);
	const endTick = duration > 0 ? startTick + (noDelay ? delayOffset : 0) + duration : -1;
	return { startTick, endTick, duration, delayOffset, delayLate };
}

/**
 * R-EFX-005 XY distance culling (render only; lifetime still advances).
 * @param {[number, number, number]} effectPos
 * @param {[number, number, number]} playerPos
 * @param {{performanceMode?: boolean, viewArea?: number}} prefs
 */
export function isEffectInRange(effectPos, playerPos, { performanceMode = false, viewArea = 14 } = {}) {
	const r = performanceMode ? viewArea : EFFECT_CULL_RADIUS;
	const dx = effectPos[0] - playerPos[0];
	const dy = effectPos[1] - playerPos[1];
	return dx * dx + dy * dy <= r * r;
}

/**
 * R-EFX-006 pass selection.
 * @param {{effectId: number, renderBeforeEntities?: boolean}} instance
 * @param {boolean} ctorDefaultBefore
 * @returns {'before'|'after'}
 */
export function effectPass({ effectId, renderBeforeEntities }, ctorDefaultBefore) {
	if (BEFORE_ENTITY_AURA_IDS.includes(effectId)) {
		return 'before';
	}
	const before = renderBeforeEntities ?? ctorDefaultBefore;
	return before ? 'before' : 'after';
}

/**
 * R-EFX-007 STR key index.
 * @param {number} elapsedMs
 * @param {number} fps
 * @param {number} maxKey
 * @param {boolean} persistent
 */
export function strKeyIndex(elapsedMs, fps, maxKey, persistent) {
	const key = (elapsedMs / 1000) * fps;
	return persistent && maxKey > 0 ? key % maxKey : key;
}

/**
 * R-EFX-007 the effect is removed at maxKey (non-persistent).
 * @param {number} keyIndex
 * @param {number} maxKey
 * @param {boolean} persistent
 */
export function strFinished(keyIndex, maxKey, persistent) {
	return !persistent && keyIndex >= maxKey;
}

/**
 * R-EFX-007 STR layer interpolation (port of legacy calculateAnimation).
 * Keys: type 0 = source, type 1 = delta.
 * @param {{texcnt: number, animations: Array<Object>}} layer
 * @param {number} keyIndex
 * @returns {null|{color: number[], pos: number[], uv: number[], xy: number[], angle: number, aniframe: number, srcalpha: number, destalpha: number}}
 */
export function interpolateStrLayer(layer, keyIndex) {
	const anims = layer.animations;
	let fromId = -1;
	let toId = -1;
	let lastFrame = 0;
	let lastSource = 0;
	anims.forEach((a, i) => {
		if (a.frame <= keyIndex) {
			if (a.type === 0) {
				fromId = i;
			}
			if (a.type === 1) {
				toId = i;
			}
		}
		lastFrame = Math.max(lastFrame, a.frame);
		if (a.type === 0) {
			lastSource = Math.max(lastSource, a.frame);
		}
	});
	if (fromId < 0 || (toId < 0 && lastFrame < keyIndex)) {
		return null;
	}
	const from = anims[fromId];
	const to = anims[toId];
	const base = { srcalpha: from.srcalpha, destalpha: from.destalpha };
	if (toId !== fromId + 1 || to.frame !== from.frame) {
		if (to && lastSource <= from.frame) {
			return null;
		}
		return {
			...base,
			angle: from.angle,
			aniframe: from.aniframe,
			color: [...from.color],
			pos: [...from.pos],
			uv: [...from.uv],
			xy: [...from.xy]
		};
	}
	const k = keyIndex - from.frame;
	const lerp = (f, d) => f.map((v, i) => v + d[i] * k);
	let aniframe;
	switch (to.anitype) {
		case 1:
			aniframe = from.aniframe + to.aniframe * k;
			break;
		case 2:
			aniframe = Math.min(from.aniframe + to.delay * k, layer.texcnt - 1);
			break;
		case 3:
			aniframe = (from.aniframe + to.delay * k) % layer.texcnt;
			break;
		case 4:
			aniframe = (from.aniframe - to.delay * k) % layer.texcnt;
			break;
		default:
			aniframe = 0;
	}
	return {
		...base,
		angle: from.angle + to.angle * k,
		aniframe,
		color: lerp(from.color, to.color),
		pos: [from.pos[0] + to.pos[0] * k, from.pos[1] + to.pos[1] * k],
		uv: lerp(from.uv, to.uv),
		xy: lerp(from.xy, to.xy)
	};
}

/**
 * R-EFX-012 alpha envelope for 2D/3D effects.
 * @param {Object} s
 * @param {number} s.elapsed     tick − startTick
 * @param {number} s.duration    endTick − startTick
 * @param {number} s.alphaMax
 * @param {boolean} [s.fadeIn]
 * @param {boolean} [s.fadeOut]
 * @param {boolean} [s.sparkling]
 * @param {number} [s.sparkNumber]
 * @param {number} [s.steps]     0..100
 */
export function alphaEnvelope({ elapsed, duration, alphaMax, fadeIn, fadeOut, sparkling, sparkNumber = 1, steps = 0 }) {
	let alpha = alphaMax;
	const quarter = duration / 4;
	if (fadeIn && elapsed < quarter) {
		alpha = (elapsed * alphaMax) / quarter;
	} else if (fadeOut && elapsed > duration / 2 + quarter) {
		alpha = ((duration - elapsed) * alphaMax) / quarter;
	} else if (sparkling) {
		alpha = alphaMax * ((Math.cos((steps * 11 * sparkNumber * Math.PI) / 180) + 1) / 2);
	}
	return Math.min(1, Math.max(0, alpha));
}

export const LEVEL99_EFFECTS = Object.freeze({
	LEVEL99: 'EF_LEVEL99',
	LEVEL99_2: 'EF_LEVEL99_2',
	LEVEL99_3: 'EF_LEVEL99_3'
});

/**
 * R-EFX-015 level-99 aura effects to show.
 * @param {{auraPref: number, baseLevel: number, visible: boolean, minLevel?: number}} s
 * @returns {string[]}
 */
export function level99Auras({ auraPref, baseLevel, visible, minLevel = 99 }) {
	if (!(auraPref > 0) || baseLevel < minLevel || !visible) {
		return [];
	}
	if (auraPref === 1) {
		return [LEVEL99_EFFECTS.LEVEL99_3];
	}
	return [LEVEL99_EFFECTS.LEVEL99, LEVEL99_EFFECTS.LEVEL99_2, LEVEL99_EFFECTS.LEVEL99_3];
}

/**
 * Discrepancy #55 [FLAG, fixed]: frame delta of the aura simulations (GroundAura,
 * Level99Bubble), clamped to [0, max] ms. A clock of 0 means "not seeded yet": the frame
 * delta is 0 and the clock starts at this frame. A tick earlier than the clock (a frame
 * before the start tick) gives `null`: the simulation must not step and the clock stays.
 * Legacy caps at max with no lower bound, so such a frame runs the simulation backwards
 * (GroundAura.js:267, Level99Bubble.js:463).
 * @param {number} tick
 * @param {number} lastTick
 * @param {number} max
 * @returns {number|null}
 */
export function auraFrameDelta(tick, lastTick, max) {
	const raw = tick - (lastTick || tick);
	return raw < 0 ? null : Math.min(raw, max);
}
