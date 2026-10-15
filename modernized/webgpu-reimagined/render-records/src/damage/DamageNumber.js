/**
 * Damage numbers (R-DMG-001..009). Pure motion/colour logic plus record
 * emission; glyph texture composition is owned by the backends' atlas.
 */

/** Legacy Damage.TYPE bitflags (callers pass these to damage.add). */
export const DamageType = Object.freeze({
	HEAL: 1 << 0,
	MISS: 1 << 1,
	DAMAGE: 1 << 2,
	ENEMY: 1 << 3,
	COMBO: 1 << 4,
	COMBO_FINAL: 1 << 5,
	SP: 1 << 6,
	CRIT: 1 << 7,
	LUCKY: 1 << 8,
	ENDURE: 1 << 9,
	COMBO_B: 1 << 10
});

export const DAMAGE_LIFETIME_MS = 1500;
export const COMBO_LIFETIME_MS = 3000;
/** R-DMG-004 FIX: Miss/Lucky live exactly as long as they are visible. */
export const MISS_LIFETIME_MS = 800;

/**
 * R-DMG-002..005 motion branch, in legacy render precedence (Damage.js:566-650): combo title,
 * damage/crit, heal, miss, lucky. A type matching none of them (e.g. a bare SP or ENDURE flag,
 * which no legacy caller sends) has no branch.
 * @param {number} type
 * @returns {'combo'|'damage'|'heal'|'miss'|'lucky'|null}
 */
export function damageBranch(type) {
	if (type & (DamageType.COMBO | DamageType.COMBO_B)) {
		return 'combo';
	}
	if (type & (DamageType.DAMAGE | DamageType.CRIT)) {
		return 'damage';
	}
	if (type & DamageType.HEAL) {
		return 'heal';
	}
	if (type & DamageType.MISS) {
		return 'miss';
	}
	if (type & DamageType.LUCKY) {
		return 'lucky';
	}
	return null;
}

const CRIT_BG_COLOR = Object.freeze([0.66, 0.66, 0.66, 1]);

/**
 * R-DMG-001 / R-DMG-006 add-time style: one if/else chain in legacy (Damage.js:343-421), so the
 * precedence SP, heal, enemy (hit on a PC), combo, crit, blue combo also decides the 3000 ms combo
 * delay and the critical background. A combo or crit on a PC is therefore red, lives 1500 ms and
 * gets no background.
 * @param {number} type  ENEMY is set by the caller for hits on a PC
 * @returns {{color: [number, number, number, number], delay: number,
 *   background: null|{sheet: 'msg'|'msgBlue', type: number, spawnEffectId: number|null}}}
 */
export function damageStyle(type) {
	if (type & DamageType.SP) {
		return { color: [0.13, 0.19, 0.75, 1], delay: DAMAGE_LIFETIME_MS, background: null };
	}
	if (type & DamageType.HEAL) {
		return { color: [0, 1, 0, 1], delay: DAMAGE_LIFETIME_MS, background: null };
	}
	if (type & DamageType.ENEMY) {
		return { color: [1, 0, 0, 1], delay: DAMAGE_LIFETIME_MS, background: null };
	}
	if (type & DamageType.COMBO) {
		return { color: [0.9, 0.9, 0.15, 1], delay: COMBO_LIFETIME_MS, background: null };
	}
	if (type & DamageType.CRIT) {
		return {
			color: [0.9, 0.9, 0.15, 1],
			delay: DAMAGE_LIFETIME_MS,
			// The grey background moves as a crit number (type CRIT) and spawns the hit effect.
			background: { sheet: 'msg', type: DamageType.CRIT, spawnEffectId: 1 }
		};
	}
	if (type & DamageType.COMBO_B) {
		return {
			color: [1, 1, 1, 1],
			delay: DAMAGE_LIFETIME_MS,
			// The blue background keeps the number's type, so it moves as a combo title.
			background: { sheet: 'msgBlue', type, spawnEffectId: null }
		};
	}
	return { color: [1, 1, 1, 1], delay: DAMAGE_LIFETIME_MS, background: null };
}

/**
 * R-DMG-001 lifetime (with the R-DMG-004 fix for Miss / Lucky).
 * @param {number} type
 */
export function damageLifetime(type) {
	const branch = damageBranch(type);
	if (branch === 'miss' || branch === 'lucky') {
		return MISS_LIFETIME_MS;
	}
	return damageStyle(type).delay;
}

/**
 * R-DMG-001 base colour (legacy precedence: SP, heal, enemy, combo, crit).
 * @param {number} type  ENEMY is set by the caller for hits on a PC
 * @returns {[number, number, number, number]}
 */
export function damageColor(type) {
	return damageStyle(type).color;
}

/**
 * Motion of one damage number at `elapsed` ms (R-DMG-001..005).
 * @param {Object} s
 * @param {number} s.type
 * @param {number} s.elapsed
 * @param {[number, number, number]} s.entityPosition
 * @param {number} [s.damageMotion]  GraphicsSettings.damageMotion
 * @param {number} [s.delay]  the add-time delay (damageStyle), which perc is relative to
 * @returns {{position: [number, number, number], scale: number, alpha: number}}
 */
export function damageMotion({
	type,
	elapsed,
	entityPosition,
	damageMotion: motion = 0,
	delay = damageStyle(type).delay
}) {
	const [ex, ey, ez] = entityPosition;
	let perc = elapsed / delay;
	let scale = 1;
	/** @type {[number, number, number]} */
	let position = [ex, ey, ez];

	if (type & (DamageType.COMBO | DamageType.COMBO_B)) {
		scale = Math.min(perc, 0.05) * 70;
		position = [ex, ey, ez + 7 + perc];
	} else if (type & (DamageType.DAMAGE | DamageType.CRIT)) {
		scale = (1 - perc) * 4;
		const zArc = Math.sin(-Math.PI / 2 + Math.PI * (0.5 + perc * 1.5)) * 5;
		let x = ex + perc * 4;
		let y = ey - perc * 4;
		if (motion === 1) {
			x = ex - perc * 4;
			y = ey;
		} else if (motion === 2) {
			x = ex;
			y = ey;
		} else if (motion === 3) {
			y = ey;
		}
		position = [x, y, ez + 2 + zArc];
	} else if (type & DamageType.HEAL) {
		scale = Math.max((1 - perc * 2) * 3, 0.8);
		position = [ex, ey, ez + 2 + (perc < 0.4 ? 0 : (perc - 0.4) * 5)];
	} else if (type & (DamageType.MISS | DamageType.LUCKY)) {
		perc = elapsed / MISS_LIFETIME_MS;
		scale = 0.5;
		position = [ex, ey, ez + 3.5 + perc * 7];
	}
	return { position, scale, alpha: 1 - perc };
}

/**
 * R-DMG-005 combo visibility: only the newest combo per entity; a non-final
 * combo is hidden after 15 % of its lifetime.
 * @param {{type: number, startTick: number, gid: number}} dmg
 * @param {number} perc
 * @param {Map<number, number>} newestComboStart gid → newest combo startTick
 */
export function comboVisible(dmg, perc, newestComboStart) {
	if ((newestComboStart.get(dmg.gid) ?? -Infinity) > dmg.startTick) {
		return false;
	}
	return Boolean(dmg.type & DamageType.COMBO_FINAL) || perc <= 0.15;
}

/**
 * R-DMG-006 critical background (legacy Damage.js:369-415): crit numbers get the grey `critbg`
 * of msg.spr and spawn hit effect 1; blue combos (COMBO_B) get the `critbg` of bluemsg.spr. The
 * add-time precedence of damageStyle applies (no background on a PC, nor on a combo).
 * @param {number} type
 */
export function critBackground(type) {
	const bg = damageStyle(type).background;
	if (!bg) {
		return null;
	}
	return {
		sprite: bg.sheet === 'msgBlue' ? 'bluemsg' : 'critbg',
		sheet: bg.sheet,
		name: 'critbg',
		type: bg.type,
		scale: 0.6,
		color: [...CRIT_BG_COLOR],
		offset: [0, -6],
		spawnEffectId: bg.spawnEffectId
	};
}

/**
 * R-DMG-007 displayed text: floored; negatives ignored; optional K/M suffix.
 * @param {number} amount
 * @param {{enableDmgSuffix?: boolean}} [opts]
 * @returns {string|null}
 */
export function formatDamage(amount, { enableDmgSuffix = false } = {}) {
	if (amount < 0) {
		return null;
	}
	const v = Math.floor(amount);
	if (enableDmgSuffix && v >= 1e8) {
		return `${Math.floor(v / 1e6)}M`;
	}
	if (enableDmgSuffix && v >= 1e6) {
		return `${Math.floor(v / 1e3)}K`;
	}
	return String(v);
}

/** @enum {number} R-DMG-008 */
export const DamageSkin = Object.freeze({ DEFAULT: 0, NEW_NUMBER: 1, HAN: 2, INVI: 3 });

/**
 * R-DMG-008 effective skin. Legacy tests for Invi before forcing skin 0 on an old PACKETVER
 * (Damage.js:271-279), so Invi suppresses numbers on every PACKETVER and stays the render skin.
 * @param {number} skin
 * @param {number} packetver
 * @returns {{skin: number, suppressed: boolean}}
 */
export function effectiveSkin(skin, packetver) {
	if (skin === DamageSkin.INVI) {
		return { skin, suppressed: true };
	}
	return { skin: packetver < 20220821 ? DamageSkin.DEFAULT : skin, suppressed: false };
}

/**
 * Emit damage records after the entities (R-DMG-009): depth test off, the
 * per-item depth bias is the list index. R-DMG-009 FIX: the bias is per record
 * and does not leak into later records.
 * @param {import('../records/RecordStream.js').RecordStream} records
 * @param {Array<{type: number, startTick: number, gid: number, entityPosition: [number, number, number], texture?: any, size?: [number, number]}>} list
 * @param {number} tick
 * @param {{damageMotion?: number}} [prefs]
 */
export function emitDamageRecords(records, list, tick, prefs = {}) {
	list.forEach((dmg, index) => {
		const elapsed = tick - dmg.startTick;
		if (elapsed < 0 || elapsed > damageLifetime(dmg.type)) {
			return;
		}
		const { position, scale, alpha } = damageMotion({ ...dmg, elapsed, damageMotion: prefs.damageMotion });
		const color = damageColor(dmg.type);
		const [w, h] = dmg.size ?? [1, 1];
		records.sprite({
			source: `damage:${dmg.gid}`,
			texture: dmg.texture ?? null,
			textureClass: 'rgba',
			sampler: 'linear',
			position,
			size: [w * scale, h * scale],
			color: [color[0], color[1], color[2], alpha],
			depthBias: index,
			depthTest: false,
			depthWrite: false,
			depthCorrection: false
		});
	});
}

/**
 * R-DMG-004 / R-DMG-008 add-time gate: "Miss" only when the `miss`
 * preference is on; skin 3 (Invi) suppresses all numbers.
 * @param {number} type
 * @param {{miss?: boolean, skin?: number, packetver?: number}} prefs
 */
export function shouldDisplayDamage(type, { miss = true, skin = 0, packetver = 20250101 } = {}) {
	if (effectiveSkin(skin, packetver).suppressed) {
		return false;
	}
	if (type & DamageType.MISS && !miss) {
		return false;
	}
	return true;
}
