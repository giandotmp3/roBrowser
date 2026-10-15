import { blendFromEffectMode } from '../records/blend.js';
import { defaultClock, defaultRng } from '../util/injectables.js';
import { notImplemented } from '../util/errors.js';
import { duplicateOffsets, effectTiming, effectsEnabled, normalizeDuplicate, resolveStrFile } from './rules.js';

/**
 * @typedef {Object} EffectInstance
 * @property {number} effectId
 * @property {string} family      Class-name alias, matched by remove('Name', ...)
 * @property {Function} [ctor]    Constructor of an instance added with add(); remove(ctor) matches it by identity (#59)
 * @property {Object} [effect]    The effect object of an instance added with add()
 * @property {number} ownerAID
 * @property {number} startTick
 * @property {number} endTick
 * @property {string|undefined} file
 * @property {import('../records/blend.js').BlendState|null} blend  null for STR (per-layer blend)
 * @property {import('./EffectSpec.js').EffectSpec} spec
 */

const FAMILY_BY_TYPE = Object.freeze({
	STR: 'StrEffect',
	'2D': 'TwoDEffect',
	'3D': 'ThreeDEffect',
	CYLINDER: 'Cylinder',
	RSM: 'RsmEffect',
	QuadHorn: 'QuadHorn'
});

/**
 * Effect lifecycle and record emission. Replaces the legacy EffectManager
 * logic side; GPU drawing lives in the backends.
 *
 * Discrepancy #59 [FLAG, fixed]: effects are tracked per instance. Legacy EffectManager keys
 * its lists by `constructor.name`, so two classes of the same name (every FlatColorTile
 * colour) share one list and the second one is never initialised or drawn; here every
 * instance stands alone, and remove(ctor) matches constructors by identity, not by name.
 */
export class EffectSystem {
	/**
	 * @param {Object} opts
	 * @param {Record<number, import('./EffectSpec.js').EffectSpec[]>} opts.table  EffectTable data
	 * @param {Omit<import('./EffectSpec.js').EffectContext, 'effects'>} opts.ctx  Injected services
	 * @param {{effect?: boolean, mineffect?: boolean, performanceMode?: boolean, viewArea?: number}} [opts.prefs]
	 * @param {import('../util/injectables.js').Rng} [opts.rng]
	 * @param {import('../util/injectables.js').Clock} [opts.now]
	 */
	constructor({ table, ctx, prefs = {}, rng = defaultRng, now = defaultClock }) {
		this.table = table;
		this.prefs = prefs;
		this.rng = rng;
		this.now = now;
		/** @type {import('./EffectSpec.js').EffectContext} */
		this.ctx = Object.freeze({ ...ctx, effects: this });
		/** @type {EffectInstance[]} */
		this.instances = [];
	}

	/**
	 * effects.spam (spec §3.1). FUNC specs are invoked as FUNC(params, ctx);
	 * other specs create instances (with duplication and timing).
	 * @param {import('./EffectSpec.js').EffectParams} params
	 * @returns {EffectInstance[]} Instances created by this call
	 */
	spam(params) {
		if (!effectsEnabled(this.prefs)) {
			return [];
		}
		const specs = this.table[params.effectId] ?? [];
		/** @type {EffectInstance[]} */
		const created = [];
		for (const spec of specs) {
			if (typeof spec.FUNC === 'function') {
				spec.FUNC(params, this.ctx);
			}
			if (!spec.type || spec.type === 'FUNC') {
				continue;
			}
			const count = normalizeDuplicate(spec.duplicate);
			duplicateOffsets(count, spec.timeBetweenDupli).forEach((offset, duplicateID) => {
				const { startTick, endTick } = effectTiming({
					spawnTick: params.startTick + offset,
					spec,
					duplicateID
				});
				created.push({
					effectId: params.effectId,
					family: FAMILY_BY_TYPE[spec.type] ?? spec.type,
					ownerAID: params.ownerAID ?? 0,
					startTick,
					endTick,
					file: spec.type === 'STR' ? resolveStrFile(spec, this.prefs) : spec.file,
					blend: spec.type === 'STR' ? null : blendFromEffectMode(spec.blendMode ?? 0),
					spec
				});
			});
		}
		this.instances.push(...created);
		return created;
	}

	/**
	 * Track one effect object created outside the table types (e.g. by a FUNC entry), per
	 * instance (#59): two classes that share a name stay separate.
	 * @param {Object} effect  instance of its own class
	 * @param {{effectId?: number, ownerAID?: number, startTick?: number, endTick?: number}} [inst]
	 * @returns {EffectInstance}
	 */
	add(effect, { effectId = -1, ownerAID = 0, startTick = 0, endTick = -1 } = {}) {
		const ctor = effect.constructor;
		/** @type {EffectInstance} */
		const instance = {
			effectId,
			family: ctor.name,
			ctor,
			effect,
			ownerAID,
			startTick,
			endTick,
			file: undefined,
			blend: null,
			spec: null
		};
		this.instances.push(instance);
		return instance;
	}

	/**
	 * effects.remove(ctorOrNull, AID, effectID). `ctor` may be a constructor or a
	 * class-name alias string. A constructor matches the instances added with it by
	 * identity (#59) and the table instances of its class name; a string matches by name.
	 * @param {Function|string|null} ctor
	 * @param {number} [aid]
	 * @param {number} [effectId]
	 * @returns {number} Number of instances removed
	 */
	remove(ctor, aid, effectId) {
		const byCtor = typeof ctor === 'function';
		const family = byCtor ? ctor.name : ctor;
		const matches = i =>
			byCtor ? (i.ctor ? i.ctor === ctor : i.family === family) : !family || i.family === family;
		const before = this.instances.length;
		this.instances = this.instances.filter(
			i =>
				!(
					matches(i) &&
					(aid === undefined || i.ownerAID === aid) &&
					(effectId === undefined || i.effectId === effectId)
				)
		);
		return before - this.instances.length;
	}

	/**
	 * Advance lifetimes and repeats (R-EFX-004). Pending.
	 * @param {number} _tick
	 */
	tick(_tick) {
		notImplemented('R-EFX-004', 'effect repeat / respawn');
	}

	/**
	 * Emit EffectDraw records for one pass, applying distance culling
	 * (R-EFX-005) and pass selection (R-EFX-006). Pending.
	 * @param {import('../records/RecordStream.js').RecordStream} _records
	 * @param {'before'|'after'} _pass
	 * @param {{tick: number, playerPosition: number[], fog: {use: boolean}}} _frame
	 */
	emit(_records, _pass, _frame) {
		notImplemented('R-EFX-005', 'EffectSystem.emit record emission');
	}
}
