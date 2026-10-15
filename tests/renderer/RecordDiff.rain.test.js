/**
 * Phase 2 record-diff of render-records' RainWeather (EF_RAIN, R-EFX-017) against legacy
 * Renderer/Effects/RainWeather.js.
 *
 * The legacy scene of support/rainScene.js runs as ScreenEffectManager drives it. Native
 * records: the puddle pass through RainWeather.addRecordSink (EffectDraw 'rainPuddle'),
 * the filter / drops / splashes through SpriteRenderer.addRecordSink. render-records'
 * RainWeather gets the same events, player path, terrain, camera (yaw and modelView), wall
 * clock (thunder) and seeded random sequence; its puddleFrame / frame records are diffed
 * per pass, field by field (tolerance 1e-5, relative above 1). The procedural textures
 * are identified by their upload size and their pixels are compared with
 * rainTexturePixels.
 *
 * jsdom has no AudioContext, so legacy's plink sound (which draws Math.random only when
 * audio exists) never runs — the same as render-records, which has no audio.
 *
 * Declared divergences: none.
 */
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	session: { Entity: null },
	map: { currentMap: '', fog: null },
	renderer: { tick: 0 },
	camera: { zoom: 2, getLatitude: () => -45, angle: [0, 0], modelView: null, projection: null, position: [0, 0, 0] }
}));

vi.mock('Utils/WebGL.js', () => ({
	default: { createShaderProgram: () => ({ attribute: {}, uniform: {} }) }
}));
vi.mock('Renderer/Camera.js', () => ({ default: mocks.camera }));
vi.mock('Renderer/Renderer.js', () => ({ default: mocks.renderer }));
vi.mock('Renderer/MapRenderer.js', () => ({ default: mocks.map }));
vi.mock('Renderer/Map/Altitude.js', () => ({ default: { getCellHeight: (x, y) => 0.1 * x - 0.05 * y + 0.25 } }));
vi.mock('Engine/SessionStorage.js', () => ({ default: mocks.session }));
vi.mock('Preferences/Audio.js', () => ({ default: { Sound: { play: true, volume: 1 } } }));

import { FakeClock } from '../../modernized/webgpu-reimagined/test-harness/src/determinism/FakeClock.js';
import { installDeterminism } from '../../modernized/webgpu-reimagined/test-harness/src/determinism/installDeterminism.js';
import { SeededRng } from '../../modernized/webgpu-reimagined/test-harness/src/determinism/SeededRng.js';
import { RAIN_TEXTURES, RainWeather, rainTexturePixels } from '../../modernized/webgpu-reimagined/render-records/src/index.js';
import { cellHeight, diffSpriteFrame, makeGl } from './support/weatherScene.js';
import { diffEffectRecord } from './support/effectRecordDiff.js';
import { RAIN_FRAMES, RAIN_MAP, RAIN_SEED, runLegacyRain } from './support/rainScene.js';

const SIZES = { '1x16': 'drop', '1x1': 'filter', '16x16': 'splash', '64x64': 'puddle' };

async function run(seed, mutate = {}) {
	vi.resetModules();
	const { default: RainLegacy } = await import('Renderer/Effects/RainWeather.js');
	const { default: SpriteRenderer } = await import('Renderer/SpriteRenderer.js');

	// legacy texture object → render-records key, from its upload size; pixels checked
	const keys = new Map();
	const pixelMismatches = [];
	let bound = null;
	const gl = makeGl((name, args) => {
		if (name === 'bindTexture') {
			bound = args[1];
		} else if (name === 'texImage2D' && args.length === 9) {
			const which = SIZES[`${args[3]}x${args[4]}`];
			keys.set(bound, RAIN_TEXTURES[which]);
			const expected = rainTexturePixels(which);
			if (expected.width !== args[3] || expected.height !== args[4] || Array.from(expected.data).join() !== Array.from(args[8]).join()) {
				pixelMismatches.push(which);
			}
		}
	});
	const textureKey = t => keys.get(t) ?? t;

	const clock = new FakeClock();
	const rng = new SeededRng(seed).fn;
	const sounds = [];
	let modern = null;
	let modernMap = '';
	let legacySprites = [];
	let legacyPuddles = [];
	const mismatches = [];
	const counts = { sprites: 0, puddles: 0, flashes: 0, splashes: 0, events: [] };
	const stops = [
		SpriteRenderer.addRecordSink(r => legacySprites.push(r)),
		RainLegacy.addRecordSink(r => legacyPuddles.push({ ...r, texture: { id: textureKey(r.texture) } }))
	];
	const ctxOf = i => {
		const player = mocks.session.Entity ? mocks.session.Entity.position : null;
		return {
			player,
			cellHeight: mutate.cellHeight ?? cellHeight,
			camera: { yaw: mocks.camera.angle[1], modelView: mocks.camera.modelView },
			sceneFog: { use: !!(mocks.map.fog.use && mocks.map.fog.exist) },
			i
		};
	};

	const { restore } = installDeterminism({ rng: new SeededRng(seed), clock });
	try {
		runLegacyRain({
			RainWeather: RainLegacy,
			SpriteRenderer,
			gl,
			mocks,
			clock,
			onEvent: (i, event, tick) => {
				counts.events.push(event);
				if (event === 'start' || event === 'restart' || event === 'revive') {
					if (modernMap !== mocks.map.currentMap) {
						modern = null;
						modernMap = mocks.map.currentMap;
					}
					if (modern && !modern.finished) {
						modern.restart(tick);
					} else {
						modern = new RainWeather(
							{ startTick: tick, endTick: -1 },
							{ rng, now: () => clock.dateNow(), playSound: name => sounds.push(name) }
						);
						modernMap = mocks.map.currentMap;
					}
				} else if (event === 'stop' || event === 'stop2') {
					modern?.stop(tick);
				}
			},
			onPass: (i, pass) => {
				const { tick } = RAIN_FRAMES[i];
				if (pass === 'before') {
					const mine = modern ? modern.puddleFrame(tick, ctxOf(i)) : [];
					if (legacyPuddles.length !== mine.length) {
						mismatches.push(`puddles ${i}: ${legacyPuddles.length} vs ${mine.length}`);
					}
					legacyPuddles.forEach((l, k) => {
						for (const d of mine[k] ? diffEffectRecord(l, mine[k]) : []) {
							mismatches.push(`puddle ${i}#${k} ${d}`);
						}
					});
					counts.puddles += legacyPuddles.length;
					legacyPuddles = [];
					return;
				}
				if (modern && modernMap !== mocks.map.currentMap) {
					modern = null;
				}
				const mine = modern ? modern.frame(tick, ctxOf(i)) : [];
				if (modern?.finished) {
					modern = null;
				}
				mismatches.push(...diffSpriteFrame(`frame ${i} @${tick}`, legacySprites, mine, textureKey));
				counts.sprites += legacySprites.length;
				counts.flashes += legacySprites.filter(r => r.zIndex === -1000 && r.color[0] > 0.8).length;
				counts.splashes += legacySprites.filter(r => textureKey(r.texture) === RAIN_TEXTURES.splash).length;
				legacySprites = [];
			}
		});
	} finally {
		restore();
		stops.forEach(stop => stop());
	}
	return { mismatches, pixelMismatches, counts, sounds, keys };
}

describe('RainWeather record-diff (legacy vs render-records)', { timeout: 60000 }, () => {
	it('reproduces every legacy rain record (puddles, filter, drops, splashes) field by field', async () => {
		const { mismatches, pixelMismatches, counts, sounds, keys } = await run(RAIN_SEED);
		expect(mismatches.slice(0, 20)).toEqual([]);
		expect(pixelMismatches).toEqual([]);
		expect(new Set(keys.values()).size).toBe(4);
		expect(counts.sprites).toBeGreaterThan(40000);
		expect(counts.puddles).toBeGreaterThan(1000);
		expect(counts.splashes).toBeGreaterThan(100);
		expect(counts.flashes).toBeGreaterThan(2);
		expect(sounds.filter(s => s === 'thunder').length).toBeGreaterThan(2);
		expect(RAIN_MAP).toBe('rain_map.rsw');
	});

	it('is deterministic per seed', async () => {
		expect((await run(99)).mismatches.slice(0, 5)).toEqual([]);
	});

	it('fails the diff when a rule is broken (mutation guard)', async () => {
		const { mismatches } = await run(RAIN_SEED, { cellHeight: (x, y) => cellHeight(x, y) + 0.01 });
		expect(mismatches.length).toBeGreaterThan(100);
	});
});
