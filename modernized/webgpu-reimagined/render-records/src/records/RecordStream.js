import { createSpriteDraw } from './SpriteDraw.js';
import { createEffectDraw } from './EffectDraw.js';
import { createWorldDraw } from './WorldDraw.js';

/**
 * Per-frame ordered record sink (`Records` in the architecture). Mixins call
 * `records.sprite({...})` instead of `SpriteRenderer.render()`.
 *
 * zIndex semantics (R-SPR-006): when a layer sets an explicit zIndex it is used,
 * otherwise the running counter is used; the counter is then set to used + 1,
 * so later layers win ties.
 *
 * depthBias is per record and never carried over (R-DMG-009 fix: legacy left
 * `SpriteRenderer.depth` at the last damage index).
 */
export class RecordStream {
	constructor() {
		/** @type {object[]} */
		this._records = [];
		this._zIndex = 0;
	}

	/** Start a new frame: drop all records and reset the z counter. */
	beginFrame() {
		this._records = [];
		this._zIndex = 0;
	}

	/**
	 * @param {Partial<import('./SpriteDraw.js').SpriteDraw>} fields
	 * @returns {Readonly<import('./SpriteDraw.js').SpriteDraw>}
	 */
	sprite(fields) {
		const zIndex = fields.zIndex ?? this._zIndex;
		const record = createSpriteDraw({ depthBias: 0, ...fields, zIndex });
		this._zIndex = zIndex + 1;
		this._records.push(record);
		return record;
	}

	/**
	 * @param {Partial<import('./EffectDraw.js').EffectDraw>} fields
	 */
	effect(fields) {
		const record = createEffectDraw(fields);
		this._records.push(record);
		return record;
	}

	/**
	 * @param {Partial<import('./WorldDraw.js').WorldDraw>} fields
	 */
	world(fields) {
		const record = createWorldDraw(fields);
		this._records.push(record);
		return record;
	}

	/** @returns {ReadonlyArray<object>} Records in emission (legacy) order */
	get records() {
		return Object.freeze([...this._records]);
	}
}
