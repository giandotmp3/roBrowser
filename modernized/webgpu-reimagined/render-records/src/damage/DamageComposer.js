/**
 * Damage-number composer (C-10, R-DMG-001..009): the stateful counterpart of legacy
 * Renderer/Effects/Damage.js. `add` mirrors Damage.add (skin choice, glyph layout, crit
 * background, miss gate) and `emit` mirrors one Damage.render pass, writing SpriteDraw records
 * instead of driving the global SpriteRenderer.
 *
 * Glyph textures are named, not built: a damage texture is the key
 * `damage/<sheet>/<skin>/<name>` (sheet `num` with the displayed text, or `msg` / `msgBlue` with
 * a msg.spr frame name). The backend atlas resolves the key; the layout helpers below give it
 * the canvas size and glyph placements legacy used (R-DMG-007).
 *
 * Fixed flagged rules: R-DMG-004 (Miss/Lucky leave the list after 800 ms, legacy kept them
 * invisible until 1500 ms) and R-DMG-009 (depthBias is per record, never leaked).
 */
import {
	DAMAGE_LIFETIME_MS,
	DamageSkin,
	DamageType,
	MISS_LIFETIME_MS,
	critBackground,
	damageBranch,
	damageMotion,
	damageStyle,
	effectiveSkin,
	formatDamage
} from './DamageNumber.js';

/** R-DMG-007 padding between digit glyphs, in source pixels. */
export const DAMAGE_GLYPH_PADDING = 2;

/** R-DMG-008: older clients load (and use) skin 0 only. */
export const DAMAGE_SKIN_PACKETVER = 20220821;

/** Frame order of msg.spr / bluemsg.spr (legacy `_msgNames`). */
export const DAMAGE_MSG_NAMES = Object.freeze(['miss', 'guard', 'crit', 'critbg', 'luckybg', 'lucky']);

/** Number-sheet frames after the ten digits: suffix glyphs (enableDmgSuffix). */
export const DAMAGE_SUFFIX_GLYPHS = Object.freeze({ K: 10, M: 11 });

/** Same rounding as legacy Utils/WebGL.toPowerOfTwo. */
export function toPowerOfTwo(n) {
	return Math.pow(2, Math.ceil(Math.log(n) / Math.log(2)));
}

/**
 * R-DMG-008 skins loaded at map init: skin 0 only before PACKETVER 20220821.
 * @param {number} packetver
 * @param {number[]} [skinIds]
 */
export function loadedDamageSkins(packetver, skinIds = Object.values(DamageSkin)) {
	return packetver < DAMAGE_SKIN_PACKETVER ? skinIds.slice(0, 1) : [...skinIds];
}

const isMissBranch = type => ['miss', 'lucky'].includes(damageBranch(type));

/** @param {'num'|'msg'|'msgBlue'} sheet */
export const damageTextureKey = (sheet, skin, name) => `damage/${sheet}/${skin}/${name}`;

/**
 * Glyph frame indices of a formatted number ('1234K' → [1, 2, 3, 4, 10]).
 * @param {string} text
 */
export function damageGlyphs(text) {
	return text.split('').map(c => DAMAGE_SUFFIX_GLYPHS[c] ?? Number(c));
}

/**
 * R-DMG-007 number canvas: glyphs side by side with 2 px padding (trailing one included),
 * vertically centred, the run centred on a POT×DPR canvas (Damage.js:438-468).
 * @param {number[]} glyphs frame indices
 * @param {Array<{width: number, height: number}>} frames number-sheet frame sizes
 * @param {number} [dpr]
 */
export function layoutDamageNumber(glyphs, frames, dpr = 1) {
	let width = 0;
	let height = 0;
	for (const g of glyphs) {
		width += frames[g].width + DAMAGE_GLYPH_PADDING;
		height = Math.max(height, frames[g].height);
	}
	const canvasWidth = toPowerOfTwo(width) * dpr;
	const canvasHeight = toPowerOfTwo(height) * dpr;
	const startX = (canvasWidth - width) >> 1;
	const startY = (canvasHeight - height) >> 1;
	let x = 0;
	const placements = glyphs.map(glyph => {
		const frame = frames[glyph];
		const placement = { glyph, x: startX + x, y: startY + ((height - frame.height) >> 1) };
		x += frame.width + DAMAGE_GLYPH_PADDING;
		return placement;
	});
	return { width: canvasWidth, height: canvasHeight, placements };
}

/**
 * msg.spr / bluemsg.spr frame centred on its POT×DPR canvas (Damage.js:188-203).
 * @param {{width: number, height: number}} frame
 * @param {number} [dpr]
 */
export function layoutDamageMessage(frame, dpr = 1) {
	const width = toPowerOfTwo(frame.width) * dpr;
	const height = toPowerOfTwo(frame.height) * dpr;
	return { width, height, x: (width - frame.width) / 2, y: (height - frame.height) / 2 };
}

/**
 * @typedef {Object} DamageSkinMetrics  One loaded skin, as the atlas read it from the SPR/ACT.
 * @property {Array<{width: number, height: number}>} numbers  number-sheet frames
 * @property {Object<string, {width: number, height: number}>} msg  msg.spr frames by name
 * @property {Object<string, {width: number, height: number}>} msgBlue  bluemsg.spr frames by name
 * @property {number[]} [scale]  layer 0 scale of the number ACT (R-DMG-002 size multiplier)
 */

/**
 * @typedef {Object} DamageTarget
 * @property {number} gid
 * @property {[number, number, number]} position  read live at emit time, as legacy does
 */

export class DamageComposer {
	/**
	 * @param {Object} opts
	 * @param {Object<number, DamageSkinMetrics>} opts.skins  loaded skins (see loadedDamageSkins)
	 * @param {number} opts.packetver
	 * @param {number} [opts.dpr]  window.devicePixelRatio at load
	 * @param {boolean} [opts.enableDmgSuffix]  config read at map init
	 */
	constructor({ skins, packetver, dpr = 1, enableDmgSuffix = false }) {
		this._skins = skins;
		this._packetver = packetver;
		this._dpr = dpr;
		this._enableDmgSuffix = enableDmgSuffix;
		/** Live numbers in add order; the list index is the record's depthBias (R-DMG-009). */
		this._list = [];
		/** gid → startTick of the newest combo title drawn (R-DMG-005). */
		this._prevCombo = new Map();
		/** Legacy `_skin`: the skin of the latest add, whose ACT scale every number is drawn at. */
		this._renderSkin = DamageSkin.DEFAULT;
	}

	/** Number of live entries (diagnostics). */
	get size() {
		return this._list.length;
	}

	/** Drop every number (legacy Damage.free on map change). */
	clear() {
		this._list.length = 0;
	}

	/**
	 * Add one damage number (legacy Damage.add).
	 * @param {Object} d
	 * @param {number} d.amount
	 * @param {DamageTarget} d.entity
	 * @param {number} d.tick  start tick (may be in the future)
	 * @param {number} [d.type]  DamageType flags; 0 picks DAMAGE or MISS from the amount
	 * @param {boolean} [d.isPC]  target is a player (adds ENEMY)
	 * @param {{damageSkin?: number, miss?: boolean}} [prefs]  GraphicsSettings / MapPreferences
	 * @returns {{effects: Array<{effectId: number, ownerAID: number, position: number[], startTick: number}>}}
	 */
	add({ amount, entity, tick, type = 0, isPC = false }, { damageSkin = 0, miss = true } = {}) {
		const effects = [];
		const { skin, suppressed } = effectiveSkin(damageSkin || 0, this._packetver);
		this._renderSkin = skin;
		if (suppressed) {
			return { effects };
		}
		const sheetSkin = this._skins[skin] ? skin : DamageSkin.DEFAULT;
		const data = this._skins[sheetSkin];
		if (!data) {
			return { effects };
		}
		const text = formatDamage(amount, { enableDmgSuffix: this._enableDmgSuffix });
		if (text === null) {
			return { effects };
		}
		const value = Math.floor(amount);
		let t = type || (value ? DamageType.DAMAGE : DamageType.MISS);
		if (isPC) {
			t |= DamageType.ENEMY;
		}
		const style = damageStyle(t);
		const push = (fields, itemType = t, delay = style.delay) =>
			this._list.push({
				type: itemType,
				delay,
				// R-DMG-004 FIX: Miss/Lucky leave after 800 ms; everything else after its delay.
				lifetime: isMissBranch(itemType) ? MISS_LIFETIME_MS : delay,
				startTick: tick,
				entity,
				offset: null,
				...fields
			});

		const bg = critBackground(t);
		if (bg) {
			const frame = layoutDamageMessage(data[bg.sheet].critbg, this._dpr);
			push(
				{
					color: bg.color,
					texture: damageTextureKey(bg.sheet, sheetSkin, 'critbg'),
					width: frame.width * bg.scale,
					height: frame.height * bg.scale,
					offset: bg.offset
				},
				bg.type,
				DAMAGE_LIFETIME_MS
			);
			if (bg.spawnEffectId !== null) {
				effects.push({
					effectId: bg.spawnEffectId,
					ownerAID: entity.gid,
					position: entity.position,
					startTick: tick
				});
			}
		}

		if (!value) {
			if (miss) {
				const frame = layoutDamageMessage(data.msg.miss, this._dpr);
				push({
					color: style.color,
					texture: damageTextureKey('msg', sheetSkin, 'miss'),
					width: frame.width,
					height: frame.height
				});
			}
			return { effects };
		}

		const layout = layoutDamageNumber(damageGlyphs(text), data.numbers, this._dpr);
		push({
			color: style.color,
			texture: damageTextureKey('num', sheetSkin, text),
			width: layout.width,
			height: layout.height
		});
		return { effects };
	}

	/**
	 * One damage pass (legacy Damage.render), drawn after the entities.
	 * @param {import('../records/RecordStream.js').RecordStream} records
	 * @param {number} tick
	 * @param {{damageMotion?: number}} [prefs]
	 */
	emit(records, tick, { damageMotion: motion = 0 } = {}) {
		const scale = this._skins[this._renderSkin]?.scale;
		for (let i = 0; i < this._list.length; ++i) {
			const d = this._list[i];
			if (d.startTick > tick) {
				continue;
			}
			if (d.startTick + d.lifetime < tick) {
				this._list.splice(i, 1);
				--i;
				continue;
			}
			const branch = damageBranch(d.type);
			if (!branch) {
				// Legacy draws these with the previous draw's size/position; no caller sends one.
				continue;
			}
			const elapsed = tick - d.startTick;
			if (branch === 'combo') {
				// R-DMG-005: only the newest combo title per entity.
				if (d.startTick < (this._prevCombo.get(d.entity.gid) ?? -Infinity)) {
					continue;
				}
				this._prevCombo.set(d.entity.gid, d.startTick);
			}
			const m = damageMotion({
				type: d.type,
				elapsed,
				entityPosition: d.entity.position,
				damageMotion: motion,
				delay: d.delay
			});
			if (branch === 'combo' && !(d.type & DamageType.COMBO_FINAL) && elapsed / d.delay > 0.15) {
				// Legacy zeroes startTick: drawn this pass, dropped on the next.
				d.startTick = 0;
			}
			const size = [d.width * m.scale, d.height * m.scale];
			if (scale) {
				size[0] *= scale[0];
				size[1] *= scale[1];
			}
			// SpriteRenderer skips a draw whose (float32) alpha is 0.
			if (!Math.fround(m.alpha)) {
				continue;
			}
			records.sprite({
				source: `damage:${d.entity.gid}`,
				texture: d.texture,
				textureClass: 'rgba',
				sampler: 'linear',
				position: m.position,
				offset: d.offset ? [...d.offset] : [0, 0],
				size,
				color: [d.color[0], d.color[1], d.color[2], m.alpha],
				depthBias: i,
				depthTest: false,
				depthWrite: false,
				depthCorrection: false
			});
		}
	}
}
