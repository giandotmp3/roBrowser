/**
 * EffectSystem orchestration (legacy EffectManager parity): spawn → specs → duplicates →
 * timing → per-pass emission → repeat → cleanup, plus the skill / item spawn tables and the
 * remove / endRepeat semantics. The record-level parity lives in the root suite
 * (tests/renderer/RecordDiff.effectManager.test.js).
 */
import { describe, expect, it, vi } from 'vitest';
import { EffectSystem, RecordStream, StrPlayer, CylinderEffect } from '../../src/index.js';

const STR = { fps: 10, maxKey: 5, layernum: 0, layers: [] };

function makeSystem(table, extra = {}) {
	return new EffectSystem({
		table,
		ctx: {
			camera: {},
			altitude: { getCellHeight: () => 0.5 },
			screenFx: {},
			audio: { playPosition: vi.fn() },
			session: {},
			entities: { get: aid => extra.entities?.[aid] ?? null, addSkillUnit: vi.fn() },
			resources: { str: path => extra.files?.[path] ?? null }
		},
		prefs: extra.prefs ?? {},
		now: () => extra.now ?? 500,
		rng: () => 0.5,
		skillTables: extra.skillTables
	});
}

describe('EffectSystem spawn', () => {
	it('drops spawns with no position and no owner entity; startTick 0 means now', () => {
		const system = makeSystem({ 1: [{ type: 'CYLINDER', textureName: 't' }] });
		expect(system.spam({ effectId: 1, startTick: 100 })).toEqual([]);
		const [inst] = system.spam({ effectId: 1, startTick: 0, position: [1, 2, 3] });
		expect(inst.startTick).toBe(500);
		expect(inst.player).toBeInstanceOf(CylinderEffect);
		expect(inst.family).toBe('Cylinder');
	});

	it('copies the position unless attachedEntity; other position defaults to (−5, +5)', () => {
		const owner = { position: [10, 10, 0], direction: 2 };
		const system = makeSystem(
			{ 1: [{ type: 'CYLINDER' }, { type: 'CYLINDER', attachedEntity: true }] },
			{ entities: { 7: owner } }
		);
		const [copied, attached] = system.spam({ effectId: 1, startTick: 1, ownerAID: 7 });
		expect(copied.inst.position).not.toBe(owner.position);
		expect(attached.inst.position).toBe(owner.position);
		expect(copied.inst.otherPosition).toEqual([5, 15, 0]);
		expect(attached.inst.direction).toBe(2);
		expect(copied.inst.direction).toBe(0);
	});

	it('runs FUNC once per duplicate with the legacy Params, and attachedEntity FUNC only with an owner', () => {
		const FUNC = vi.fn();
		const system = makeSystem({ 1: [{ type: 'FUNC', FUNC, duplicate: 2, attachedEntity: true }] }, { entities: { 7: { position: [0, 0, 0] } } });
		system.spam({ effectId: 1, startTick: 10, position: [1, 1, 1] });
		expect(FUNC).not.toHaveBeenCalled();
		system.spam({ effectId: 1, startTick: 10, ownerAID: 7 });
		expect(FUNC).toHaveBeenCalledTimes(2);
		const [params, ctx] = FUNC.mock.calls[1];
		expect(params.Inst).toMatchObject({ effectID: 1, duplicateID: 1, startTick: 210 });
		expect(params.Init.ownerAID).toBe(7);
		expect(ctx.effects).toBe(system);
	});

	it('/mineffect plays `min`, falling back to the full file; a file with no candidate is finished', () => {
		const files = { 'data/texture/effect/full.str': STR, 'data/texture/effect/r2.str': STR };
		const table = { 1: [{ type: 'STR', file: 'full', min: 'nomin' }], 2: [{ type: 'STR', file: 'gone' }], 3: [{ type: 'STR', file: 'r%d', rand: [1, 3] }] };
		const system = makeSystem(table, { files, prefs: { mineffect: true } });
		const [min] = system.spam({ effectId: 1, startTick: 1, position: [0, 0, 0] });
		expect(min.player).toBeInstanceOf(StrPlayer);
		expect(min.player.str).toBe(STR);
		expect(min.file).toBe('nomin');
		expect(system.spam({ effectId: 2, startTick: 1, position: [0, 0, 0] })[0].player.finished).toBe(true);
		expect(system.spam({ effectId: 3, startTick: 1, position: [0, 0, 0] })[0].player.str).toBe(STR);
	});

	it('plays the wav at the undelayed start + delayWav through the audio port', () => {
		const system = makeSystem({ 1: [{ type: 'CYLINDER', wav: 'snd', delayWav: 30, delayStart: 100 }] });
		system.spam({ effectId: 1, startTick: 50, position: [1, 2, 3] });
		expect(system.ctx.audio.playPosition).toHaveBeenCalledWith('snd.wav', [1, 2, 3], { at: 80 });
	});
});

describe('EffectSystem passes, groups and lifecycle', () => {
	it('stamps each record with its instance pass and keeps legacy group order (dropped when empty)', () => {
		const system = makeSystem({});
		const draw = family => ({ kind: 'effect', family, pass: 'after', params: {} });
		class A {
			finished = false;
			frame = () => [draw('a')];
		}
		class B {
			static renderBeforeEntities = true;
			frame = () => [draw('b')];
		}
		const a = new A();
		system.add(a, { position: [0, 0, 0] });
		system.add(new B(), { position: [0, 0, 0] });
		system.add(new A(), { position: [0, 0, 0], effectId: 881 });
		const records = new RecordStream();
		const frame = { tick: 1, playerPosition: [0, 0, 0] };
		expect(system.emit(records, 'before', frame).map(r => `${r.family}:${r.pass}`)).toEqual(['a:before', 'b:before']);
		expect(system.emit(records, 'after', frame).map(r => r.family)).toEqual(['a']);
		expect(records.records).toHaveLength(3);
		// every A finishes: the A group is dropped and re-created behind B
		system.instances.filter(i => i.effect instanceof A).forEach(i => (i.effect.finished = true));
		system.emit(null, 'before', frame);
		system.emit(null, 'after', frame);
		system.add(new A(), { position: [0, 0, 0], renderBeforeEntities: true });
		expect(system.emit(null, 'before', frame).map(r => r.family)).toEqual(['b', 'a']);
	});

	it('remove(ctor) with no live instance of ctor removes from every class (legacy fallback)', () => {
		const system = makeSystem({ 1: [{ type: 'CYLINDER' }, { type: '2D' }] });
		system.spam({ effectId: 1, startTick: 1, position: [0, 0, 0], ownerAID: 5 });
		system.spam({ effectId: 1, startTick: 1, position: [0, 0, 0], ownerAID: 6 });
		expect(system.remove('Cylinder', 5)).toBe(1);
		expect(system.remove('LockOnTarget', 5)).toBe(1);
		expect(system.remove(null, null, [2])).toBe(0);
		expect(system.remove(null, null, [1])).toBe(2);
	});

	it('endRepeat stops chains by owner; an effectID filter matches the object’s own effectID only (parity)', () => {
		const system = makeSystem({ 1: [{ type: 'CYLINDER', duration: 100, repeat: true }] });
		system.spam({ effectId: 1, startTick: 1000, position: [0, 0, 0], ownerAID: 5 });
		system.endRepeat(null, 5, 1);
		expect(system.instances[0].inst.persistent).toBe(true);
		system.endRepeat(null, 5);
		expect(system.instances[0].inst.persistent).toBe(false);
		system.tick(1200);
		expect(system.instances).toHaveLength(0);
	});

	it('free() drops every instance', () => {
		const system = makeSystem({ 1: [{ type: 'CYLINDER' }] });
		system.spam({ effectId: 1, startTick: 1, position: [0, 0, 0] });
		system.free();
		expect(system.instances).toEqual([]);
	});
});

describe('EffectSystem skill and item spawns', () => {
	const skills = {
		10: { effectId: [1, 2], effectIdOnCaster: 3, successEffectId: 4, hitEffectIdOnCaster: 5 },
		11: { effectId: src => (src === 9 ? 6 : 7) }
	};
	const items = { 500: { effectId: 1 } };
	const table = Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8].map(id => [id, [{ type: 'FUNC', FUNC: vi.fn() }]]));

	it('maps each legacy spamSkill* / spamItem call to spam(EF_Init_Par)', () => {
		const system = makeSystem(table, { skillTables: { skills, items, units: { 0x90: 8 } } });
		const spam = vi.spyOn(system, 'spam');
		system.spamSkill('skill', [10, 20, [1, 2, 0], 100, 30]);
		expect(spam.mock.calls.map(([p]) => [p.effectId, p.ownerAID, p.otherAID])).toEqual([
			[1, 20, 30],
			[2, 20, 30],
			[3, 30, 20]
		]);
		spam.mockClear();
		system.spamSkill('skill', [10, 20, [1, 2, 0], 100]);
		expect(spam.mock.calls.map(([p]) => p.effectId)).toEqual([1, 2]);
		spam.mockClear();
		system.spamSkill('skill', [11, 20, [1, 2, 0], 100, 9]);
		system.spamSkill('success', [10, 20, 100, 30]);
		system.spamSkill('hit', [10, 20, 100, 30]);
		system.spamSkill('item', [500, 20, [0, 0, 0], 100]);
		expect(spam.mock.calls.map(([p]) => [p.effectId, p.ownerAID, p.startTick])).toEqual([
			[6, 20, 100],
			[4, 20, 100],
			[5, 30, 100],
			[1, 20, 100]
		]);
		spam.mockClear();
		system.spamSkill('zone', [0x90, 4, 5, 77, 30]);
		expect(spam.mock.calls[0][0]).toMatchObject({ effectId: 8, ownerAID: 77, position: [4, 5, 0.5], persistent: true, duration: -1, otherAID: 30 });
		expect(system.ctx.entities.addSkillUnit).toHaveBeenCalledWith({ unitId: 0x90, uid: 77, position: [4, 5, 0.5], creatorUid: 30 });
	});
});
