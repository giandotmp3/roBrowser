/**
 * C-09 effects (logic side): R-EFX-001..007, 010 (fix), 011, 012, 015..017,
 * plus the EffectTable FUNC(params, ctx) injection contract.
 */
import { describe, expect, it, vi } from 'vitest';
import {
	BEFORE_ENTITY_AURA_IDS,
	BLEND_NORMAL,
	BlendFactor,
	EffectSystem,
	RecordStream,
	WEATHER_PARAMS,
	alphaEnvelope,
	blendFromEffectMode,
	blendFromStr,
	duplicateOffsets,
	effectPass,
	effectTiming,
	effectsEnabled,
	interpolateStrLayer,
	isEffectInRange,
	level99Auras,
	mapWeather,
	normalizeDuplicate,
	resolveStrFile,
	strFinished,
	strKeyIndex,
	strLayerDrawFields,
	usesBlendConstant
} from '../../src/index.js';

const fakeCtx = () => ({
	camera: { setQuake: vi.fn() },
	altitude: { getCellHeight: () => 0 },
	screenFx: {},
	audio: { playPosition: vi.fn() },
	session: { Playing: true }
});

const fixedClock = () => 0;
const seededRng = () => 0.5;

describe('C-09 effects', () => {
	it('R-EFX-001: /effect off suppresses all spawned effects; /mineffect uses the min STR', () => {
		expect(effectsEnabled({ effect: false })).toBe(false);
		expect(effectsEnabled({})).toBe(true);
		const FUNC = vi.fn();
		const system = new EffectSystem({
			table: { 10: [{ type: 'STR', file: 'a.str' }, { FUNC }] },
			ctx: fakeCtx(),
			prefs: { effect: false },
			now: fixedClock,
			rng: seededRng
		});
		expect(system.spam({ effectId: 10, startTick: 0 })).toEqual([]);
		expect(FUNC).not.toHaveBeenCalled();
		expect(resolveStrFile({ file: 'full.str', min: 'min.str' }, { mineffect: true })).toBe('min.str');
		expect(resolveStrFile({ file: 'full.str' }, { mineffect: true })).toBe('full.str');
		expect(resolveStrFile({ file: 'full.str', min: 'min.str' }, { mineffect: false })).toBe('full.str');
	});

	it('R-EFX-002: duplicate −1 → 999, capped at 999, default 1; spaced 200 ms', () => {
		expect(normalizeDuplicate(-1)).toBe(999);
		expect(normalizeDuplicate(5000)).toBe(999);
		expect(normalizeDuplicate(undefined)).toBe(1);
		expect(duplicateOffsets(3)).toEqual([0, 200, 400]);
		const system = new EffectSystem({ table: { 7: [{ type: '2D', duplicate: 3, duration: 100 }] }, ctx: fakeCtx() });
		expect(system.spam({ effectId: 7, startTick: 1000 }).map(i => i.startTick)).toEqual([1000, 1200, 1400]);
	});

	it('R-EFX-003: start = spawn + delayStart; end = start + duration, or −1 when open-ended', () => {
		expect(effectTiming({ spawnTick: 1000, spec: { delayStart: 100, duration: 500 } })).toMatchObject({ startTick: 1100, endTick: 1600 });
		expect(effectTiming({ spawnTick: 1000, spec: { duration: 0 } }).endTick).toBe(-1);
		expect(
			effectTiming({ spawnTick: 1000, spec: { delayStart: 100, delayOffset: 50, delayLate: 20, duration: 500 }, noDelay: true })
		).toMatchObject({ startTick: 1070, endTick: 1620 });
	});

	it.fails('R-EFX-004 [pending]: persistent effects re-spawn at endTick + repeatDelay', () => {
		const system = new EffectSystem({ table: { 3: [{ type: '2D', duration: 100, repeatDelay: 50 }] }, ctx: fakeCtx() });
		system.spam({ effectId: 3, startTick: 0, persistent: true });
		system.tick(151);
		expect(system.instances.some(i => i.startTick === 150)).toBe(true);
	});

	it('R-EFX-005: effects beyond 20 cells (viewArea in performance mode) are culled in XY', () => {
		expect(isEffectInRange([20, 0, 0], [0, 0, 0])).toBe(true);
		expect(isEffectInRange([21, 0, 0], [0, 0, 0])).toBe(false);
		expect(isEffectInRange([0, 0, 500], [0, 0, 0])).toBe(true);
		expect(isEffectInRange([15, 0, 0], [0, 0, 0], { performanceMode: true, viewArea: 14 })).toBe(false);
	});

	it.fails('R-EFX-005 [pending]: culled effects emit no records but keep their lifetime', () => {
		const system = new EffectSystem({ table: { 2: [{ type: '2D', duration: 1000 }] }, ctx: fakeCtx() });
		system.spam({ effectId: 2, startTick: 0, position: [50, 50, 0] });
		const records = new RecordStream();
		system.emit(records, 'after', { tick: 10, playerPosition: [0, 0, 0], fog: { use: false } });
		expect(records.records).toHaveLength(0);
		expect(system.instances).toHaveLength(1);
	});

	it('R-EFX-006: aura IDs always before entities; own flag beats constructor default', () => {
		expect(BEFORE_ENTITY_AURA_IDS).toEqual([200, 201, 202, 362, 397, 398, 881]);
		expect(effectPass({ effectId: 881, renderBeforeEntities: false }, false)).toBe('before');
		expect(effectPass({ effectId: 5, renderBeforeEntities: true }, false)).toBe('before');
		expect(effectPass({ effectId: 5, renderBeforeEntities: false }, true)).toBe('after');
		expect(effectPass({ effectId: 5 }, true)).toBe('before');
	});

	it('R-EFX-007: STR key index, linear interpolation, anitype, removal at maxKey', () => {
		expect(strKeyIndex(500, 60, 20, true)).toBeCloseTo(10);
		expect(strKeyIndex(500, 60, 20, false)).toBeCloseTo(30);
		expect(strFinished(20, 20, false)).toBe(true);
		expect(strFinished(20, 20, true)).toBe(false);

		const key = (o) => ({ angle: 0, aniframe: 0, color: [1, 1, 1, 1], pos: [0, 0], uv: [0, 0, 0, 0, 0, 0, 0, 0], xy: [0, 0, 0, 0, 0, 0, 0, 0], srcalpha: 5, destalpha: 2, delay: 0, anitype: 0, ...o });
		const layer = (anitype, delay) => ({
			texcnt: 4,
			animations: [key({ frame: 0, type: 0 }), key({ frame: 0, type: 1, color: [0, -0.1, 0, 0], angle: 10, anitype, delay, aniframe: 1 })]
		});
		const normal = interpolateStrLayer(layer(1, 0), 2);
		expect(normal.color[1]).toBeCloseTo(0.8);
		expect(normal.angle).toBeCloseTo(20);
		expect(normal.aniframe).toBe(2);
		expect(interpolateStrLayer(layer(2, 5), 2).aniframe).toBe(3);
		expect(interpolateStrLayer(layer(3, 3), 2).aniframe).toBe(2);
		expect(interpolateStrLayer({ texcnt: 1, animations: [] }, 0)).toBeNull();
	});

	it('R-EFX-010 FIX (legacy never fogged STR): STR layer records obey the scene fog', () => {
		const frame = { srcalpha: 5, destalpha: 2, color: [1, 1, 1, 1] };
		expect(strLayerDrawFields(frame, { position: [0, 0, 0], sceneFog: { use: true } }).fog).toBe(true);
		expect(strLayerDrawFields(frame, { position: [0, 0, 0], sceneFog: { use: false } }).fog).toBe(false);
		expect(strLayerDrawFields(frame, { position: [0, 0, 0], sceneFog: { use: true } }).depthWrite).toBe(false);
	});

	it('R-EFX-011 FIX (two numberings normalised into one enum, same visual result)', () => {
		// 2D/3D GL order: src always SRC_ALPHA
		expect(blendFromEffectMode(5)).toEqual({ src: BlendFactor.SRC_ALPHA, dst: BlendFactor.DST_COLOR });
		expect(blendFromEffectMode(7)).toEqual({ src: BlendFactor.SRC_ALPHA, dst: BlendFactor.SRC_ALPHA });
		expect(blendFromEffectMode(0)).toBe(BLEND_NORMAL);
		expect(blendFromEffectMode(16)).toBe(BLEND_NORMAL);
		// STR D3D order
		expect(blendFromStr(5, 2)).toEqual({ src: BlendFactor.SRC_ALPHA, dst: BlendFactor.ONE });
		expect(blendFromStr(9, 6).src).toBe(BlendFactor.DST_COLOR);
		// The same visual factor from both tables maps to the same enum value
		expect(blendFromStr(5, 9).dst).toBe(blendFromEffectMode(5).dst);
		expect(usesBlendConstant(blendFromStr(5, 14))).toBe(true);
		expect(blendFromStr(5, 12)).toBe(BLEND_NORMAL);
	});

	it('#41: invalid D3D blend codes (0, 12, 13, out of range, non-integer, inherited keys) fall back to normal alpha', () => {
		for (const [src, dst] of [
			[0, 2],
			[12, 2],
			[5, 13],
			[0, 0],
			[16, 2],
			[-1, 2],
			[5.5, 2],
			[5, 6.25],
			['constructor', 2],
			[undefined, 2]
		]) {
			expect(blendFromStr(src, dst), `${src}/${dst}`).toBe(BLEND_NORMAL);
		}
		expect(blendFromStr(5, 6)).toEqual({ src: BlendFactor.SRC_ALPHA, dst: BlendFactor.ONE_MINUS_SRC_ALPHA });
	});

	it('#49: invalid or non-integer 2D/3D/Cylinder/QuadHorn blend codes fall back to normal alpha', () => {
		for (const code of [0, -1, 16, 1.5, 2.5, 7.25, 14.9, NaN, undefined, null, '', '2.5', 'constructor']) {
			const blend = blendFromEffectMode(code);
			expect(blend, String(code)).toBe(BLEND_NORMAL);
			expect(blend.dst).toBeDefined();
		}
		for (let code = 1; code <= 15; code++) {
			expect(blendFromEffectMode(code).dst, String(code)).toBeDefined();
			expect(blendFromEffectMode(String(code))).toEqual(blendFromEffectMode(code));
		}
	});

	it('R-EFX-012: fadeIn / fadeOut over a quarter of the duration; sparkling; clamped to [0,1]', () => {
		const base = { duration: 800, alphaMax: 0.8 };
		expect(alphaEnvelope({ ...base, elapsed: 0, fadeIn: true })).toBe(0);
		expect(alphaEnvelope({ ...base, elapsed: 100, fadeIn: true })).toBeCloseTo(0.4);
		expect(alphaEnvelope({ ...base, elapsed: 700, fadeOut: true })).toBeCloseTo(0.4);
		expect(alphaEnvelope({ ...base, elapsed: 400, sparkling: true, steps: 0 })).toBeCloseTo(0.8);
		expect(alphaEnvelope({ duration: 800, alphaMax: 1.5, elapsed: 400 })).toBe(1);
	});

	it('R-EFX-015: level-99 aura selection', () => {
		expect(level99Auras({ auraPref: 0, baseLevel: 99, visible: true })).toEqual([]);
		expect(level99Auras({ auraPref: 2, baseLevel: 98, visible: true })).toEqual([]);
		expect(level99Auras({ auraPref: 2, baseLevel: 99, visible: false })).toEqual([]);
		expect(level99Auras({ auraPref: 1, baseLevel: 99, visible: true })).toEqual(['EF_LEVEL99_3']);
		expect(level99Auras({ auraPref: 2, baseLevel: 150, visible: true })).toEqual(['EF_LEVEL99', 'EF_LEVEL99_2', 'EF_LEVEL99_3']);
		expect(level99Auras({ auraPref: 2, baseLevel: 120, visible: true, minLevel: 150 })).toEqual([]);
	});

	it.fails('R-EFX-016 [pending]: WeatherTable map flag starts weather at map load', () => {
		expect(mapWeather('xmas', { effects: { xmas: { weather: 'snow' } } })).toEqual(['snow']);
	});

	it('R-EFX-017: weather parameters', () => {
		expect(WEATHER_PARAMS.snow).toMatchObject({ perTick: 2, lifeMs: 8000, fadeInMs: 250, radius: 60, spawnHeight: [18, 22], fallPerTick: 0.1 });
		expect(WEATHER_PARAMS.rain).toMatchObject({ perTick: 10, maxDrops: 1100, radius: 70, spawnHeight: [22, 42], maxPuddles: 600, maxPuddleAlpha: 0.45 });
		expect(WEATHER_PARAMS.sakura).toEqual({ spawnIntervalMs: 150, lifeMs: 15000 });
	});
});

describe('architecture contract: EffectTable FUNC(params, ctx) injection and remove aliases', () => {
	it('FUNC closures receive (params, ctx) with injected services and the effect system', () => {
		const ctx = fakeCtx();
		const FUNC = vi.fn((params, c) => c.camera.setQuake(params.startTick, 650));
		const system = new EffectSystem({ table: { 9: [{ FUNC }] }, ctx });
		system.spam({ effectId: 9, startTick: 42 });
		expect(FUNC).toHaveBeenCalledTimes(1);
		const [params, injected] = FUNC.mock.calls[0];
		expect(params.startTick).toBe(42);
		expect(injected.effects).toBe(system);
		expect(Object.keys(injected).sort()).toEqual(['altitude', 'audio', 'camera', 'effects', 'screenFx', 'session']);
		expect(ctx.camera.setQuake).toHaveBeenCalledWith(42, 650);
	});

	it('remove(ctor, aid, id) accepts a constructor or its class-name alias', () => {
		class TwoDEffect {}
		const system = new EffectSystem({ table: { 1: [{ type: '2D' }], 2: [{ type: 'STR', file: 'x.str' }] }, ctx: fakeCtx() });
		system.spam({ effectId: 1, startTick: 0, ownerAID: 7 });
		system.spam({ effectId: 2, startTick: 0, ownerAID: 7 });
		expect(system.remove(TwoDEffect, 7)).toBe(1);
		expect(system.remove('StrEffect', 7, 2)).toBe(1);
		expect(system.instances).toHaveLength(0);
	});
});
