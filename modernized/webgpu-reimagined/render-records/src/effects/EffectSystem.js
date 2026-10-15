import { createEffectDraw } from '../records/EffectDraw.js';
import { blendFromEffectMode } from '../records/blend.js';
import { defaultClock, defaultRng } from '../util/injectables.js';
import { CylinderEffect } from './CylinderEffect.js';
import { QuadHornEffect } from './QuadHornEffect.js';
import { RsmEffect } from './RsmEffect.js';
import { ThreeDEffectPlayer, TwoDEffectPlayer } from './SpriteBillboardEffect.js';
import { StrPlayer } from './StrPlayer.js';
import { WaterfallEffect } from './WaterfallEffect.js';
import {
	BEFORE_ENTITY_AURA_IDS,
	duplicateOffsets,
	effectTiming,
	effectsEnabled,
	isEffectInRange,
	legacyIsNum,
	normalizeDuplicate
} from './rules.js';

/**
 * @typedef {Object} EffectInst  Legacy EF_Inst_Par (one instance of one EffectTable entry)
 * @property {number} effectID
 * @property {number} duplicateID
 * @property {number} startTick
 * @property {number} endTick          −1 when open-ended
 * @property {number} duration
 * @property {number[]} position       live owner array when attachedEntity, else a copy
 * @property {number[]} otherPosition
 * @property {number} direction
 * @property {boolean} persistent
 * @property {number} repeatEnd
 * @property {number} repeatDelay
 * @property {number} delayOffset
 * @property {number} delayLate
 * @property {boolean} [noDelay]       true on repeats (R-EFX-003)
 * @property {boolean} [renderBeforeEntities]
 *
 * @typedef {Object} EffectInstance
 * @property {number} effectId
 * @property {string} family      Legacy class-name alias, matched by remove('Name', ...)
 * @property {Function} [ctor]    Constructor of an object added with add(); remove(ctor) matches it by identity (#59)
 * @property {Object} [effect]    The object added with add()
 * @property {Object} player      Record producer: frame(tick, frameState) → record(s), `finished`
 * @property {number} ownerAID
 * @property {number} startTick
 * @property {number} endTick
 * @property {string|undefined} file
 * @property {import('../records/blend.js').BlendState|null} blend  null for STR (per-layer blend)
 * @property {import('./EffectSpec.js').EffectSpec|null} spec
 * @property {'before'|'after'} pass   R-EFX-006
 * @property {EffectInst} inst
 * @property {Object} init        EF_Init_Par shared by every instance (and repeat) of one spam
 * @property {boolean} cleanup    finished while culled (R-EFX-005)
 * @property {boolean} repeated   R-EFX-004: this instance already re-spawned its successor
 *
 * @typedef {Object} EffectFrame  Per-frame state handed to emit() and on to every player
 * @property {number} tick
 * @property {ArrayLike<number>} [playerPosition]  culling centre (default ctx.session.Entity.position, else origin)
 * @property {{use: boolean}} [sceneFog]
 * @property {{angle?: ArrayLike<number>, yaw?: number, direction?: number}} [camera]
 * @property {(file: string) => *} [textures]      2D/3D texture residency
 * @property {(path: string) => *} [sprites]
 * @property {{getCellHeight: Function}} [altitude]
 */

const STR_DIR = 'data/texture/effect/';

/**
 * A spawn whose resource is not available (RSM model not loaded, or a family without a
 * player yet): tracked like legacy's never-ready instance, never draws, never finishes.
 */
class PendingEffect {
	constructor() {
		this.finished = false;
	}

	frame() {
		return [];
	}
}

/**
 * Legacy class-name alias and constructor-default pass (R-EFX-006) of every table type.
 * The default is the static `renderBeforeEntities` of the legacy class once initialised.
 */
const TABLE_TYPES = Object.freeze({
	STR: { family: 'StrEffect', before: false },
	'2D': { family: 'TwoDEffect', before: false },
	'3D': { family: 'ThreeDEffect', before: false },
	CYLINDER: { family: 'Cylinder', before: false },
	QuadHorn: { family: 'QuadHorn', before: true },
	RSM: { family: 'RsmEffect', before: false },
	RSM2: { family: 'RsmEffect', before: false },
	WATERFALL: { family: 'WaterfallEffect', before: false },
	TRAIL: { family: 'Trail', before: true }
});

/** Legacy class-name alias of each family player (remove('Cylinder', …) also finds FUNC-added ones). */
const LEGACY_NAMES = new Map([
	[StrPlayer, 'StrEffect'],
	[TwoDEffectPlayer, 'TwoDEffect'],
	[ThreeDEffectPlayer, 'ThreeDEffect'],
	[CylinderEffect, 'Cylinder'],
	[QuadHornEffect, 'QuadHorn'],
	[RsmEffect, 'RsmEffect'],
	[WaterfallEffect, 'WaterfallEffect']
]);

const asList = value => (Array.isArray(value) ? value : [value]);

/**
 * Effect orchestration: the render-records equivalent of legacy Renderer/EffectManager.js.
 *
 * spawn → EffectTable specs (injected `table`; FUNC entries run as FUNC(params, ctx)) →
 * duplicates (R-EFX-002) → timing (R-EFX-003) → per-pass emission (R-EFX-006) with
 * distance culling (R-EFX-005) → repeat / persistence (R-EFX-004) → cleanup. /effect and
 * /mineffect (R-EFX-001) are read live from `prefs`.
 *
 * Emission order is legacy's: instances are grouped by class and groups are visited in
 * first-insertion order (a group is dropped when it empties and re-created at the end);
 * inside a group instances keep spawn order, and a repeat appended during a pass is
 * visited in that same pass.
 *
 * Discrepancy #59 [FLAG, fixed]: groups are keyed by class identity, not by
 * `constructor.name`. Legacy's lists collide for classes that share a name (every
 * FlatColorTile colour), so a second colour spawned while the first is alive joins the
 * first one's list, is never initialised and never draws; here it has its own group (and
 * draws), appended where it was first spawned. That is the only ordering difference.
 *
 * Legacy behaviours kept for parity (spec R-EFX-004..006 refinements, proposed flags):
 * - remove(ctor, …) with no live instance of `ctor` falls back to every class
 *   (EffectManager.js:1243), so it removes the owner's other effects too.
 * - endRepeat(…, effectID) compares the effect object's own `effectID`, which table
 *   effects never set (EffectManager.js:303): with an effectID it stops nothing.
 * - a restart tick of 0 never repeats (`if (restartTick)`, EffectManager.js:245).
 */
export class EffectSystem {
	/**
	 * @param {Object} opts
	 * @param {Record<number, import('./EffectSpec.js').EffectSpec[]>} opts.table  EffectTable data
	 * @param {Omit<import('./EffectSpec.js').EffectContext, 'effects'>} opts.ctx  Injected services
	 * @param {{effect?: boolean, mineffect?: boolean, performanceMode?: boolean, viewArea?: number}} [opts.prefs]
	 *   read live (the caller may mutate it)
	 * @param {import('../util/injectables.js').Rng} [opts.rng]
	 * @param {import('../util/injectables.js').Clock} [opts.now]  current game tick (legacy Renderer.tick)
	 * @param {{skills?: Object, items?: Object, units?: Object}} [opts.skillTables]  SkillEffect / ItemEffect / SkillUnit
	 */
	constructor({ table, ctx, prefs = {}, rng = defaultRng, now = defaultClock, skillTables = {} }) {
		this.table = table;
		this.prefs = prefs;
		this.rng = rng;
		this.now = now;
		this.skillTables = skillTables;
		/** @type {import('./EffectSpec.js').EffectContext} */
		this.ctx = Object.freeze({ ...ctx, effects: this });
		/** @type {Map<Function|string, EffectInstance[]>} */
		this.groups = new Map();
		/** Soul Strike pattern state shared by the 3D instances of this system. */
		this.soulStrike = { first: null };
		/** @type {EffectInstance[]|null} */
		this._created = null;
	}

	/** @returns {EffectInstance[]} Live instances in emission order. */
	get instances() {
		return [...this.groups.values()].flat();
	}

	/**
	 * effects.spam(EF_Init_Par) (spec §3.1, EffectManager.spam). Specs are instantiated
	 * `duplicate` times, timeBetweenDupli apart (R-EFX-002).
	 * @param {import('./EffectSpec.js').EffectParams} params
	 * @returns {EffectInstance[]} Instances created by this call (FUNC-added ones included)
	 */
	spam(params) {
		if (!params || !effectsEnabled(this.prefs)) {
			return [];
		}
		const init = this.prepareInit(params);
		const specs = this.table[init.effectId];
		if (!specs) {
			return [];
		}
		const outer = this._created;
		const created = (this._created = []);
		try {
			for (const spec of specs) {
				const count = normalizeDuplicate(spec.duplicate);
				const spacing = legacyIsNum(spec.timeBetweenDupli) ? spec.timeBetweenDupli : undefined;
				duplicateOffsets(count, spacing).forEach((offset, duplicateID) => {
					this.spawnInstance(
						spec,
						{ effectID: init.effectId, duplicateID, startTick: init.startTick + offset },
						init
					);
				});
			}
		} finally {
			this._created = outer;
			outer?.push(...created);
		}
		return created;
	}

	/**
	 * Legacy PrepareInit: EF_Init_Par defaults, startTick 0 → now, owner / other entity lookup.
	 * @param {import('./EffectSpec.js').EffectParams} params
	 */
	prepareInit(params) {
		const init = {
			effectId: -1,
			skillId: null,
			ownerAID: null,
			position: null,
			startTick: null,
			duration: null,
			persistent: false,
			repeatEnd: null,
			repeatDelay: 0,
			otherAID: null,
			otherPosition: null,
			...params
		};
		if (!init.startTick) {
			init.startTick = this.now();
		}
		init.ownerEntity = this.entity(init.ownerAID);
		init.otherEntity = this.entity(init.otherAID);
		return init;
	}

	/** @param {number|null} aid */
	entity(aid) {
		return aid === null || aid === undefined ? null : (this.ctx.entities?.get?.(aid) ?? null);
	}

	/**
	 * Legacy spamEffect: resolve one instance's position, repeat and timing fields
	 * (R-EFX-003/004), then dispatch it to its family player (or run its FUNC).
	 * @param {import('./EffectSpec.js').EffectSpec} spec
	 * @param {Partial<EffectInst>} inst  effectID, duplicateID, startTick (+ noDelay on repeats)
	 * @param {Object} init  EF_Init_Par after prepareInit
	 */
	spawnInstance(spec, inst, init) {
		inst.position = init.position;
		inst.otherPosition = init.otherPosition;
		if (spec.renderBeforeEntities !== undefined) {
			inst.renderBeforeEntities = Boolean(spec.renderBeforeEntities);
		}
		if (!inst.position) {
			if (!init.ownerEntity) {
				return;
			}
			inst.position = init.ownerEntity.position;
		}
		if (!inst.otherPosition) {
			inst.otherPosition = init.otherEntity
				? init.otherEntity.position
				: [inst.position[0] - 5, inst.position[1] + 5, inst.position[2]];
		}
		// attached effects share the owner's live array
		if (!spec.attachedEntity) {
			inst.position = [inst.position[0], inst.position[1], inst.position[2]];
		}

		inst.persistent = init.persistent || false;
		if (spec.repeat !== undefined && spec.repeat !== null) {
			inst.persistent = spec.repeat;
		}
		inst.repeatEnd = init.repeatEnd ? init.repeatEnd : spec.repeatEnd || 0;
		inst.repeatDelay = spec.repeatDelay ? spec.repeatDelay : init.repeatDelay;

		if (spec.wav) {
			this.playSound(spec, inst);
		}

		inst.direction = spec.attachedEntity && init.ownerEntity ? init.ownerEntity.direction : 0;
		const timing = effectTiming({
			spawnTick: inst.startTick,
			spec,
			duplicateID: inst.duplicateID,
			noDelay: Boolean(inst.noDelay),
			initDuration: init.duration
		});
		inst.duration = timing.duration;
		inst.delayOffset = timing.delayOffset;
		inst.delayLate = timing.delayLate;
		inst.startTick = timing.startTick;
		inst.endTick = timing.endTick;

		const params = { ...init, effect: spec, Inst: inst, Init: init };
		const func = spec.FUNC ?? spec.func;
		if (spec.type === 'FUNC' || (!spec.type && typeof func === 'function')) {
			if (typeof func === 'function' && (!spec.attachedEntity || init.ownerEntity)) {
				func(params, this.ctx);
			}
			return;
		}
		if (spec.type === 'SPR') {
			// entity attachments belong to the entity layer (EntityAttachments)
			this.ctx.entities?.attachEffectSprite?.(params);
			return;
		}
		const type = TABLE_TYPES[spec.type];
		if (!type) {
			return;
		}
		const player = this.createPlayer(spec, inst, init);
		this.track(player, params, {
			family: type.family,
			key: player instanceof PendingEffect ? type.family : player.constructor,
			before: type.before,
			file: player.file,
			blend: spec.type === 'STR' ? null : blendFromEffectMode(spec.blendMode ?? 0),
			spec
		});
	}

	/**
	 * Legacy: the wav plays (with the same random pick) at the instance's undelayed start
	 * + delayWav; the audio port schedules it.
	 */
	playSound(spec, inst) {
		let file = spec.wav;
		if (spec.rand) {
			file = file.replace('%d', Math.round(spec.rand[0] + (spec.rand[1] - spec.rand[0]) * this.rng()));
		}
		const at = inst.startTick + (legacyIsNum(spec.delayWav) ? spec.delayWav : 0);
		this.ctx.audio?.playPosition?.(`${file}.wav`, inst.position, { at });
	}

	/**
	 * The family player of one table instance.
	 * @param {import('./EffectSpec.js').EffectSpec} spec
	 * @param {EffectInst} inst
	 * @param {Object} init
	 */
	createPlayer(spec, inst, init) {
		const rng = this.rng;
		const follow = spec.attachedEntity ? { position: inst.position } : null;
		const common = {
			position: inst.position,
			otherPosition: inst.otherPosition,
			direction: inst.direction,
			startTick: inst.startTick,
			endTick: inst.endTick,
			follow,
			effectId: inst.effectID,
			renderBeforeEntities: inst.renderBeforeEntities
		};
		switch (spec.type) {
			case 'STR':
				return this.createStrPlayer(spec, inst);
			case '2D':
				return new TwoDEffectPlayer({ ...common, spec, owner: init.ownerEntity, rng });
			case '3D':
				return new ThreeDEffectPlayer({
					...common,
					spec,
					duplicateID: inst.duplicateID,
					owner: init.ownerEntity,
					rng,
					soulStrike: this.soulStrike
				});
			case 'CYLINDER':
				return new CylinderEffect(spec, common, { rng });
			case 'QuadHorn':
				return new QuadHornEffect(spec, common, { rng });
			case 'RSM':
			case 'RSM2': {
				const model = this.ctx.resources?.model?.(`data\\model\\${spec.file}.rsm`);
				return model ? new RsmEffect(spec, common, { model }) : new PendingEffect();
			}
			case 'WATERFALL':
				return new WaterfallEffect(spec, common, { rng });
			default:
				return new PendingEffect();
		}
	}

	/**
	 * Legacy spamSTR: /mineffect `min` file (R-EFX-001), one random `%d` pick shared by every
	 * candidate, then the fallbacks (under /mineffect the full file first). The first
	 * candidate the resource port resolves plays; when none does the instance is finished
	 * without drawing. Without a `resources.str` port the file stays "loading".
	 */
	createStrPlayer(spec, inst) {
		const texturePath = spec.texturePath || '';
		const minimal = Boolean(this.prefs.mineffect && spec.min);
		let pick = name => name;
		if (spec.rand) {
			const n = Math.round(spec.rand[0] + (spec.rand[1] - spec.rand[0]) * this.rng());
			pick = name => name.replace('%d', n);
		}
		const file = pick(minimal ? spec.min : spec.file);
		const candidates = [
			{ filename: `${STR_DIR}${file}.str`, texturePath },
			...(minimal ? [{ filename: `${STR_DIR}${pick(spec.file)}.str`, texturePath }] : []),
			...(spec.fallback || []).map(f => ({
				filename: `${STR_DIR}${pick(f)}.str`,
				texturePath: f.substring(0, f.lastIndexOf('/') + 1)
			}))
		];
		const player = new StrPlayer({ str: null, startTick: inst.startTick, position: inst.position });
		player.file = file;
		const resolve = this.ctx.resources?.str;
		if (resolve) {
			const found = candidates.map(c => resolve(c.filename, c.texturePath)).find(Boolean);
			if (found) {
				player.str = found;
			} else {
				player.fail();
			}
		}
		return player;
	}

	/**
	 * Track one effect object created outside the table types (e.g. by a FUNC entry), per
	 * instance (#59): two classes that share a name stay separate.
	 *
	 * `params` is either the legacy `{effect, Inst, Init}` a FUNC received (then the object
	 * inherits that instance's pass, culling position, lifetime and repeat), or a plain
	 * `{effectId, ownerAID, startTick, endTick, position, renderBeforeEntities}`.
	 * The pass default is the class's static `renderBeforeEntities`, else the object's own `pass`.
	 * @param {Object} effect  instance of its own class, with frame(tick, frameState)
	 * @param {Object} [params]
	 * @returns {EffectInstance}
	 */
	add(effect, params = {}) {
		let legacy = params;
		if (!params.Inst) {
			const { effectId = -1, ownerAID = 0, startTick = 0, endTick = -1, position = null } = params;
			const inst = {
				effectID: effectId,
				startTick,
				endTick,
				duration: endTick > 0 ? endTick - startTick : -1,
				position
			};
			if (params.renderBeforeEntities !== undefined) {
				inst.renderBeforeEntities = params.renderBeforeEntities;
			}
			legacy = { effect: null, Inst: inst, Init: { ownerAID } };
		}
		const ctor = effect.constructor;
		const own = ctor.renderBeforeEntities;
		return this.track(effect, legacy, {
			family: LEGACY_NAMES.get(ctor) ?? ctor.name,
			key: ctor,
			before: typeof own === 'boolean' ? own : effect.pass === 'before',
			ctor,
			effect,
			file: undefined,
			blend: null,
			spec: legacy.effect ?? null
		});
	}

	/**
	 * Legacy EffectManager.add: per-instance pass (R-EFX-006: the instance flag, else the
	 * class default; the aura IDs always before entities) and group membership.
	 */
	track(player, { Inst, Init }, { key, before, ...fields }) {
		const flag = Inst.renderBeforeEntities;
		const pass =
			BEFORE_ENTITY_AURA_IDS.includes(Inst.effectID) || (flag !== undefined ? Boolean(flag) : before)
				? 'before'
				: 'after';
		/** @type {EffectInstance} */
		const instance = {
			effectId: Inst.effectID,
			player,
			ownerAID: Init.ownerAID,
			startTick: Inst.startTick,
			endTick: Inst.endTick,
			pass,
			inst: Inst,
			init: Init,
			cleanup: false,
			repeated: false,
			...fields
		};
		if (!this.groups.has(key)) {
			this.groups.set(key, []);
		}
		this.groups.get(key).push(instance);
		this._created?.push(instance);
		return instance;
	}

	/**
	 * Emit the records of one pass (legacy EffectManager.render(…, renderBeforeEntities)).
	 * Per instance of the pass: distance culling against the player in XY (R-EFX-005; 20
	 * cells, viewArea in performance mode) — a culled instance draws nothing, is dropped
	 * once its duration has elapsed, and still repeats; otherwise its player draws. Then
	 * repeat (R-EFX-004) and cleanup.
	 * @param {import('../records/RecordStream.js').RecordStream|null} records  appended to, when given
	 * @param {'before'|'after'} pass
	 * @param {EffectFrame} frame
	 * @returns {Object[]} The records of this pass, in emission order
	 */
	emit(records, pass, frame) {
		const { tick } = frame;
		const center = frame.playerPosition ?? this.ctx.session?.Entity?.position ?? [0, 0, 0];
		const out = [];
		for (const key of [...this.groups.keys()]) {
			const list = this.groups.get(key);
			if (!list) {
				continue;
			}
			if (!list.length) {
				this.groups.delete(key);
				continue;
			}
			for (let j = 0; j < list.length; j++) {
				const instance = list[j];
				if (instance.pass !== pass) {
					continue;
				}
				const pos = instance.inst.position;
				if (pos && !isEffectInRange(pos, center, this.prefs)) {
					if (!this.expired(instance, tick)) {
						this.repeat(instance, tick);
						continue;
					}
					instance.cleanup = true;
				} else {
					for (const record of asList(instance.player.frame(tick, frame) ?? [])) {
						out.push(this.stamp(record, pass, records));
					}
				}
				this.repeat(instance, tick);
				if (this.finished(instance)) {
					list.splice(j, 1);
					j--;
				}
			}
			if (!list.length) {
				this.groups.delete(key);
			}
		}
		return out;
	}

	/** A record of the instance's pass (players that do not know their pass default to 'after'). */
	stamp(record, pass, records) {
		if (record.kind === 'sprite') {
			return records ? records.sprite(record) : record;
		}
		const stamped = record.pass === pass ? record : createEffectDraw({ ...record, pass });
		return records ? records.effect(stamped) : stamped;
	}

	/** Culled-instance lifetime check (EffectManager.js:481-487). */
	expired({ inst }, tick) {
		return inst.duration > 0 && inst.endTick > 0 && tick > inst.endTick;
	}

	/** @param {EffectInstance} instance */
	finished(instance) {
		return instance.cleanup || Boolean(instance.player.finished);
	}

	/**
	 * Advance lifetimes and repeats without drawing (every instance is treated like a culled
	 * one: dropped once its duration has elapsed, repeated when due). Records come from emit().
	 * @param {number} tick
	 */
	tick(tick) {
		for (const [key, list] of [...this.groups]) {
			for (let j = 0; j < list.length; j++) {
				const instance = list[j];
				if (this.expired(instance, tick)) {
					instance.cleanup = true;
				}
				this.repeat(instance, tick);
				if (this.finished(instance)) {
					list.splice(j, 1);
					j--;
				}
			}
			if (!list.length) {
				this.groups.delete(key);
			}
		}
	}

	/**
	 * R-EFX-004 (legacy repeatEffect): a persistent or repeatEnd instance re-spawns once,
	 * at endTick + repeatDelay when it has a duration and that time has passed, otherwise at
	 * tick + repeatDelay once it finished; never once repeatEnd is reached. The successor
	 * keeps effectID / duplicateID, skips delayStart and starts after delayOffset + delayLate.
	 * @param {EffectInstance} instance
	 * @param {number} tick
	 */
	repeat(instance, tick) {
		const { inst, init, spec } = instance;
		if (!spec || !(inst.persistent || inst.repeatEnd) || instance.repeated) {
			return;
		}
		let restartTick = 0;
		const due = inst.endTick + inst.repeatDelay;
		if (inst.duration && inst.duration > 0 && tick > due) {
			if (!inst.repeatEnd || inst.repeatEnd > due) {
				restartTick = due;
			}
		} else if (this.finished(instance)) {
			if (!inst.repeatEnd || inst.repeatEnd > tick + inst.repeatDelay) {
				restartTick = tick + inst.repeatDelay;
			}
		}
		if (restartTick) {
			this.spawnInstance(
				spec,
				{ effectID: inst.effectID, duplicateID: inst.duplicateID, startTick: restartTick, noDelay: true },
				init
			);
			instance.repeated = true;
		}
	}

	/**
	 * Groups selected by a constructor / class-name alias (legacy `effect.name in _list`):
	 * null, or a class with no live group, selects every group (legacy fallback).
	 * @param {Function|string|null} ctor
	 */
	select(ctor) {
		if (!ctor) {
			return [...this.groups.keys()];
		}
		const byCtor = typeof ctor === 'function';
		const name = byCtor ? ctor.name : ctor;
		// objects added with add() match a constructor by identity only (#59); table
		// instances (and any string alias) match by legacy class name
		const matches = [...this.groups].filter(
			([key, list]) => (byCtor && key === ctor) || list.some(i => i.family === name && !(byCtor && i.ctor))
		);
		return matches.length ? matches.map(([key]) => key) : [...this.groups.keys()];
	}

	/**
	 * effects.remove(ctorOrNull, AID, effectID) (legacy EffectManager.remove / clean). `ctor`
	 * is a constructor (objects added with it, by identity #59, and table instances of its
	 * class name) or a class-name alias. A falsy AID / effectID matches all; effectID may be
	 * a list. Entity-side sprite attachments are the entity layer's (ctx.entities.removeEffect).
	 * @param {Function|string|null} ctor
	 * @param {number} [aid]
	 * @param {number|number[]} [effectId]
	 * @returns {number} Number of instances removed
	 */
	remove(ctor, aid, effectId) {
		const ids = effectId ? asList(effectId) : null;
		let removed = 0;
		for (const key of this.select(ctor)) {
			const list = this.groups.get(key);
			const keep = list.filter(i => !((!aid || i.ownerAID === aid) && (!ids || ids.includes(i.effectId))));
			removed += list.length - keep.length;
			if (keep.length) {
				this.groups.set(key, keep);
			} else {
				this.groups.delete(key);
			}
		}
		if (aid !== null && aid !== undefined) {
			this.ctx.entities?.removeEffect?.(aid, effectId);
		}
		return removed;
	}

	/**
	 * Stop repeating (legacy endRepeat / cleanRepeat): clears persistent and repeatEnd of the
	 * matching instances. Parity: an effectID filter compares the object's own `effectID`.
	 * @param {Function|string|null} ctor
	 * @param {number} [aid]
	 * @param {number|number[]} [effectId]
	 */
	endRepeat(ctor, aid, effectId) {
		const ids = effectId ? asList(effectId) : null;
		for (const key of this.select(ctor)) {
			for (const i of this.groups.get(key)) {
				if ((!aid || i.ownerAID === aid) && (!ids || ids.includes(i.effect?.effectID))) {
					i.inst.persistent = false;
					i.inst.repeatEnd = false;
				}
			}
		}
	}

	/** Drop every instance (legacy EffectManager.free). */
	free() {
		this.groups.clear();
	}

	/**
	 * Skill / item spawns (legacy spamSkill*, spamItem, spamSkillZone) over the injected
	 * SkillEffect / ItemEffect / SkillUnit tables.
	 * @param {'skill'|'success'|'hit'|'release'|'beforeHit'|'cast'|'item'|'zone'} kind
	 * @param {unknown[]} args  the legacy method's arguments
	 */
	spamSkill(kind, args) {
		const { skills = {}, items = {}, units = {} } = this.skillTables;
		if (kind === 'zone') {
			const [unitId, x, y, uid, creatorUid] = args;
			if (!effectsEnabled(this.prefs) || !(unitId in units) || !(units[unitId] in this.table)) {
				return;
			}
			this.remove(null, uid);
			const position = [x, y, this.ctx.altitude?.getCellHeight?.(x, y) ?? 0];
			this.ctx.entities?.addSkillUnit?.({ unitId, uid, position: position.slice(), creatorUid });
			this.spam({
				effectId: units[unitId],
				ownerAID: uid,
				position,
				startTick: this.now(),
				persistent: true,
				duration: -1,
				otherAID: creatorUid
			});
			return;
		}
		const fields = {
			skill: ['effectId', 'effectIdOnCaster', true],
			item: ['effectId', 'effectIdOnCaster', true],
			success: ['successEffectId', 'successEffectIdOnCaster'],
			hit: ['hitEffectId', 'hitEffectIdOnCaster'],
			beforeHit: ['beforeHitEffectId', 'beforeHitEffectIdOnCaster'],
			release: ['releaseEffectId'],
			cast: ['beginCastEffectId']
		}[kind];
		const entry = (kind === 'item' ? items : skills)[args[0]];
		if (!fields || !entry) {
			return;
		}
		const [onTarget, onCaster, positioned] = fields;
		const [, destAID] = args;
		const [position, tick, srcAID] = positioned ? args.slice(2) : [undefined, ...args.slice(2)];
		const spamAll = (ids, ownerAID, otherAID) =>
			asList(ids).forEach(effectId => {
				const params = { effectId, ownerAID, startTick: tick, otherAID };
				if (positioned) {
					params.position = position;
				}
				this.spam(params);
			});
		if (entry[onTarget]) {
			const ids =
				kind === 'skill' && typeof entry[onTarget] === 'function' ? entry[onTarget](srcAID) : entry[onTarget];
			spamAll(ids, destAID, srcAID);
		}
		// spamSkill / spamItem need a source for the caster effects; the others do not check it
		if (onCaster && entry[onCaster] && (!positioned || srcAID)) {
			spamAll(entry[onCaster], srcAID, destAID);
		}
	}
}
