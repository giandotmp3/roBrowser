/**
 * Weather, sky and waterfall effects into records (R-EFX-014/016/017, R-CTX-009,
 * R-MAP-022). Field-by-field parity with the legacy effects is proved in the root suite
 * (tests/renderer/RecordDiff.{snow,sakura,cloudWeather,sky,pokJuk,rain,waterfall}.test.js).
 */
import { describe, expect, it } from 'vitest';
import {
	BLACK_CLEAR,
	BLEND_ADDITIVE,
	BLEND_NORMAL,
	CloudWeather,
	EF_MAPLE,
	EF_SAKURA,
	POKJUK_TEXTURE,
	PokJukWeather,
	RAIN_TEXTURES,
	RainWeather,
	SKY_CLOUD_COUNT,
	SakuraWeather,
	SkyClouds,
	SnowWeather,
	WATERFALL_OPACITY,
	WaterfallEffect,
	actFrameDraws,
	cloudWeatherTextures,
	rainDropTilt,
	rainFlashAlpha,
	rainTexturePixels,
	rainWind,
	sakuraSway,
	waterfallModelMatrix
} from '../../src/index.js';

/** Deterministic rng cycling through a fixed list. */
const cycle = values => {
	let i = 0;
	return () => values[i++ % values.length];
};
const flat = () => 0;
const player = [100, 100, 0];

const spr = {
	frames: [
		{ texture: 'f0', width: 10, height: 20 },
		{ texture: 'f1', width: 4, height: 4 }
	],
	texture: 'pal',
	rgba_index: 1,
	old_rgba_index: 1
};
const layer = fields => ({ index: 0, spr_type: 0, scale: [1, 1], is_mirror: false, color: [1, 1, 1, 1], angle: 0, pos: [0, 0], ...fields });
const act = { actions: [{ delay: 100, animations: [{ layers: [layer({})] }] }] };

describe('actFrameDraws', () => {
	it('draws indexed, RGBA and mirrored layers, skipping index −1 and alpha 0', () => {
		const draws = actFrameDraws({
			spr,
			layers: [layer({}), layer({ index: -1 }), layer({ spr_type: 1, is_mirror: true }), layer({ color: [1, 1, 1, 0] })],
			sizeScale: 0.5,
			alpha: 0.5,
			position: [1, 2, 3]
		});
		expect(draws).toHaveLength(2);
		expect(draws[0]).toMatchObject({ texture: 'f0', palette: 'pal', textureClass: 'indexed', size: [5, 10], zIndex: 0 });
		expect(draws[0].paletteSize).toEqual([20, 40]);
		expect(draws[1]).toMatchObject({ texture: 'f1', palette: null, textureClass: 'rgba', size: [-2, 2], zIndex: 1 });
		expect(draws[1].color[3]).toBe(0.5);
		expect(draws[0]).toMatchObject({ depthTest: false, depthWrite: false, depthCorrection: false, blend: BLEND_NORMAL });
	});
});

describe('SnowWeather', () => {
	it('emits 2 flakes per 25 ms rag tick and fades them in over 250 ms', () => {
		const snow = new SnowWeather({ startTick: 0 }, { rng: () => 0.5 });
		snow.frame(100, { player, cellHeight: flat, sprite: { spr, act } });
		expect(snow.flakes).toHaveLength(8);
		const draws = snow.frame(150, { player, cellHeight: flat, sprite: { spr, act } });
		expect(snow.flakes).toHaveLength(12);
		// newest first: the flakes born at 125 have age 25 → alpha 0.1
		expect(draws[0].color[3]).toBeCloseTo(0.1);
		expect(draws[0].position[2]).toBeCloseTo(20 - 0.1);
	});

	it('stops emitting on stop() and finishes at the end of the tail', () => {
		const snow = new SnowWeather({ startTick: 0 }, { rng: () => 0.5 });
		snow.frame(50, { player, cellHeight: flat, sprite: { spr, act } });
		snow.stop(50);
		snow.frame(500, { player, cellHeight: flat, sprite: { spr, act } });
		expect(snow.flakes).toHaveLength(4);
		expect(snow.frame(50 + 25000, { player, cellHeight: flat, sprite: { spr, act } })).toEqual([]);
		expect(snow.finished).toBe(true);
	});

	it('does nothing without a player or a sprite', () => {
		const snow = new SnowWeather({ startTick: 0 }, { rng: () => 0.5 });
		expect(snow.frame(1000, { player: null, cellHeight: flat, sprite: { spr, act } })).toEqual([]);
		expect(snow.frame(1000, { player, cellHeight: flat, sprite: null })).toEqual([]);
		expect(snow.flakes).toHaveLength(0);
	});
});

describe('SakuraWeather', () => {
	it('sways towards a target and retargets on reaching it', () => {
		expect(sakuraSway(10, 100, () => 0.5)).toEqual({ c: 13, t: 100 });
		expect(sakuraSway(99, 100, () => 0.5)).toEqual({ c: 102, t: 51 });
		expect(sakuraSway(1, 0, () => 0.5)).toEqual({ c: 0, t: 359 });
	});

	it('maple leaves use their own sprite; sakura alpha is capped at 0.5 only during the fades', () => {
		expect(new SakuraWeather({ effectId: EF_MAPLE, startTick: 0 }).spritePath).toMatch(/\xb4\xdc\xc7\xb3$/);
		const sakura = new SakuraWeather({ effectId: EF_SAKURA, startTick: 0 }, { rng: () => 0.5 });
		const ctx = { player, cellHeight: flat, sprite: { spr, act } };
		sakura.frame(150, ctx);
		expect(sakura.frame(400, ctx)[0].color[3]).toBeCloseTo(0.25);
		expect(sakura.frame(700, ctx).at(-1).color[3]).toBe(1);
	});
});

describe('CloudWeather', () => {
	it('only ever picks the first two of its three textures', () => {
		const clouds = new CloudWeather({ effectId: 233, startTick: 0 }, { rng: cycle([0.999, 0.1, 0.7, 0.3]) });
		clouds.setUp(0, player);
		expect(cloudWeatherTextures(233)[0]).toBe('data/texture/effect/fog1.tga');
		expect(new Set(clouds.clouds.map(c => c.sprite))).toEqual(new Set([0, 1]));
	});

	it('overlay profiles draw without depth test; dead clouds reach negative alpha', () => {
		const clouds = new CloudWeather({ effectId: 229, startTick: 0 }, { rng: () => 0.25 });
		clouds.setUp(0, player);
		const [first] = clouds.frame(10, { player });
		expect(first).toMatchObject({ depthTest: false, depthCorrection: true, zIndex: -125, size: [1000, 1000] });
		// death = 2000 (0.25·8000): alpha 0.18 − Δ/2000 < 0 from 360 ms after death
		const late = clouds.frame(2000 + 1500, { player });
		expect(late[0].color[3]).toBeLessThan(0);
	});

	it('ends 2 s after stop()', () => {
		const clouds = new CloudWeather({ effectId: 230, startTick: 0 }, { rng: () => 0.25 });
		clouds.setUp(0, player);
		clouds.stop(100);
		expect(clouds.frame(2099, { player }).length).toBeGreaterThan(0);
		expect(clouds.frame(2100, { player })).toEqual([]);
		expect(clouds.finished).toBe(true);
	});
});

describe('SkyClouds', () => {
	it('clear colour from the sky table; black and no clouds without an entry (R-CTX-009)', () => {
		const sky = new SkyClouds({ rng: () => 0.5, now: () => 0 });
		expect(sky.init(undefined)).toEqual({ clearColor: BLACK_CLEAR, display: false, loadTextures: [] });
		const init = sky.init({ skyColor: [0.4, 0.6, 0.8, 1], cloudColor: [1, 1, 1] });
		expect(init.clearColor).toEqual([0.4, 0.6, 0.8, 1]);
		expect(init.loadTextures).toHaveLength(7);
		expect(sky.init({ skyColor: [0.4, 0.6, 0.8, 1], cloudColor: [1, 1, 1] }).loadTextures).toEqual([]);
	});

	it('150 clouds of 500 px at z −10, depth test on, no depth write or correction (R-MAP-022)', () => {
		const sky = new SkyClouds({ rng: () => 0.5, now: () => 10000 });
		sky.init({ skyColor: [0, 0, 0, 1], cloudColor: [1, 0.5, 0.5] });
		sky.setUp(player);
		const draws = sky.frame(10000, { player });
		expect(draws).toHaveLength(SKY_CLOUD_COUNT);
		expect(draws[0]).toMatchObject({ size: [500, 500], depthTest: true, depthWrite: false, depthCorrection: false, zIndex: 0 });
		expect(draws[0].position[2]).toBe(-10);
		expect(draws[0].color).toEqual([1, 0.5, 0.5, 1]);
	});
});

describe('PokJukWeather', () => {
	it('draws white ascending fireworks with normal blend and the inherited zIndex counter', () => {
		const fireworks = new PokJukWeather({ player }, { rng: () => 0 });
		expect(fireworks.fireworks).toHaveLength(1);
		fireworks.fireworks[0].process = 0;
		fireworks.frame(1000, { player });
		const draws = fireworks.frame(1032, { player, inherited: { angle: 5, offset: [1, 2], shadowFactor: 1, zIndex: 40, depthBias: 0, palette: null, paletteSize: [0, 0] } });
		expect(draws).toHaveLength(1);
		expect(draws[0]).toMatchObject({ texture: POKJUK_TEXTURE, blend: BLEND_NORMAL, zIndex: 40, angle: 5, size: [6, 6] });
	});

	it('has no fireworks without a player', () => {
		expect(new PokJukWeather({ player: null }).fireworks).toEqual([]);
	});
});

describe('RainWeather', () => {
	it('procedural textures', () => {
		expect(rainTexturePixels('drop')).toMatchObject({ key: RAIN_TEXTURES.drop, width: 1, height: 16 });
		expect(rainTexturePixels('filter').data).toEqual(new Uint8Array([255, 255, 255, 255]));
		expect(rainTexturePixels('puddle').data.slice(0, 3)).toEqual(new Uint8Array([18, 32, 55]));
		expect(rainTexturePixels('splash').width).toBe(16);
	});

	it('wind, tilt and thunder envelopes', () => {
		const calm = rainWind(0, 0);
		expect(calm.xTick).toBeCloseTo(0.14);
		expect(calm.yTick).toBeCloseTo(0);
		expect(rainWind(0, 90).yTick).toBeCloseTo(-0.14);
		expect(rainDropTilt(0, 0, 1, null)).toBe(0);
		expect(rainDropTilt(0, 0, 1, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])).toBe(0);
		expect(rainFlashAlpha(25, 1)).toBeCloseTo(0.4);
		expect(rainFlashAlpha(400, 1)).toBeNull();
		expect(rainFlashAlpha(100, 2)).toBe(0);
		expect(rainFlashAlpha(0, 2)).toBeCloseTo(0.6);
	});

	it('draws the grey filter, emits 10 drops per rag tick and lets them land', () => {
		const rain = new RainWeather({ startTick: 0 }, { rng: () => 0.5, now: () => 0 });
		const ctx = { player, cellHeight: flat, camera: { yaw: 0, modelView: null } };
		const first = rain.frame(50, ctx);
		expect(first[0]).toMatchObject({ texture: RAIN_TEXTURES.filter, zIndex: -1000, size: [6000, 6000] });
		expect(first[0].color).toEqual([0.65, 0.67, 0.7, 0.14]);
		expect(rain.drops).toHaveLength(20);
		rain.frame(5000, ctx);
		rain.frame(5100, ctx);
		expect(rain.puddleFrame(5100, { player }).every(r => r.family === 'rainPuddle' && r.pass === 'before')).toBe(true);
	});
});

describe('WaterfallEffect', () => {
	it('20 normal-alpha curtain quads then one additive spray draw (R-EFX-014)', () => {
		const fall = new WaterfallEffect({ variant: 'waterfall_small_dark', vertical: true }, { position: [1, 2, 3], startTick: 0 }, { rng: () => 0.5 });
		const records = fall.frame(240, { sceneFog: { use: true } });
		expect(records).toHaveLength(21);
		expect(records[0]).toMatchObject({ family: 'waterfall', blend: BLEND_NORMAL, fog: true, texture: 'data/texture/effect/waterfall31.tga' });
		expect(records[0].color[3]).toBe(WATERFALL_OPACITY);
		expect(records[20]).toMatchObject({ family: 'waterfallSpray', blend: BLEND_ADDITIVE, texture: 'data/texture/effect/freeze_a_small.bmp' });
		expect(records[20].params.instanceCount).toBe(320);
		expect(Array.from(waterfallModelMatrix([1, 2, 3], false).slice(12, 15))).toEqual([1.5, -2, 2.5]);
	});
});
