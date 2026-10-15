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
 * R-DMG-001 lifetime (with the R-DMG-004 fix for Miss / Lucky).
 * @param {number} type
 */
export function damageLifetime(type) {
	if (type & (DamageType.MISS | DamageType.LUCKY)) {
		return MISS_LIFETIME_MS;
	}
	if (type & DamageType.COMBO) {
		return COMBO_LIFETIME_MS;
	}
	return DAMAGE_LIFETIME_MS;
}

/**
 * R-DMG-001 base colour (legacy precedence: SP, heal, enemy, combo, crit).
 * @param {number} type  ENEMY is set by the caller for hits on a PC
 * @returns {[number, number, number, number]}
 */
export function damageColor(type) {
	if (type & DamageType.SP) {
		return [0.13, 0.19, 0.75, 1];
	}
	if (type & DamageType.HEAL) {
		return [0, 1, 0, 1];
	}
	if (type & DamageType.ENEMY) {
		return [1, 0, 0, 1];
	}
	if (type & (DamageType.COMBO | DamageType.CRIT)) {
		return [0.9, 0.9, 0.15, 1];
	}
	return [1, 1, 1, 1];
}

/**
 * Motion of one damage number at `elapsed` ms (R-DMG-001..005).
 * @param {Object} s
 * @param {number} s.type
 * @param {number} s.elapsed
 * @param {[number, number, number]} s.entityPosition
 * @param {number} [s.damageMotion]  GraphicsSettings.damageMotion
 * @returns {{position: [number, number, number], scale: number, alpha: number}}
 */
export function damageMotion({ type, elapsed, entityPosition, damageMotion: motion = 0 }) {
	const [ex, ey, ez] = entityPosition;
	const delay = damageLifetime(type);
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
 * R-DMG-006 critical background.
 * @param {number} type
 */
export function critBackground(type) {
	if (!(type & DamageType.CRIT)) {
		return null;
	}
	return {
		sprite: type & DamageType.COMBO_B ? 'bluemsg' : 'critbg',
		scale: 0.6,
		color: [0.66, 0.66, 0.66, 1],
		offset: [0, -6],
		spawnEffectId: 1
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
 * R-DMG-008 effective skin.
 * @param {number} skin
 * @param {number} packetver
 * @returns {{skin: number, suppressed: boolean}}
 */
export function effectiveSkin(skin, packetver) {
	const s = packetver < 20220821 ? DamageSkin.DEFAULT : skin;
	return { skin: s, suppressed: s === DamageSkin.INVI };
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
