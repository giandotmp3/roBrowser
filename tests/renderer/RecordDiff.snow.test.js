/**
 * Phase 2 record-diff of render-records' SnowWeather (EF_SNOW, R-EFX-017) against legacy
 * Renderer/Effects/SnowWeather.js.
 *
 * Legacy snow draws only through SpriteRenderer, so it needs no record seam: its native
 * records come from SpriteRenderer.addRecordSink while ScreenEffectManager's pass
 * (bind3DContext → renderAll → unbind) runs. render-records' SnowWeather gets the same
 * events (start, revive, stop, map change, missing player / sprite), player path,
 * terrain and seeded random sequence. Records are diffed per frame, field by field
 * (tolerance 1e-5, relative above 1).
 *
 * Declared divergences: none.
 */
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	session: { Entity: null },
	map: { currentMap: '' },
	renderer: { tick: 0 },
	camera: { zoom: 2, getLatitude: () => -45, angle: [0, 0] },
	files: { missing: false, table: {} }
}));

vi.mock('Utils/WebGL.js', () => ({
	default: { createShaderProgram: () => ({ attribute: {}, uniform: {} }) }
}));
vi.mock('Core/Client.js', () => ({
	default: { loadFile: path => (mocks.files.missing ? null : (mocks.files.table[path] ?? null)) }
}));
vi.mock('Renderer/Camera.js', () => ({ default: mocks.camera }));
vi.mock('Renderer/Renderer.js', () => ({ default: mocks.renderer }));
vi.mock('Renderer/MapRenderer.js', () => ({ default: mocks.map }));
vi.mock('Renderer/Map/Altitude.js', () => ({ default: { getCellHeight: (x, y) => 0.1 * x - 0.05 * y + 0.25 } }));
vi.mock('Engine/SessionStorage.js', () => ({ default: mocks.session }));

import SpriteRenderer from 'Renderer/SpriteRenderer.js';
import SnowWeatherLegacy from 'Renderer/Effects/SnowWeather.js';
import { SNOW_SPRITE_PATH, SnowWeather } from '../../modernized/webgpu-reimagined/render-records/src/index.js';
import { installDeterminism } from '../../modernized/webgpu-reimagined/test-harness/src/determinism/installDeterminism.js';
import { SeededRng } from '../../modernized/webgpu-reimagined/test-harness/src/determinism/SeededRng.js';
import { WEATHER_SPRITES, cellHeight, makeGl } from './support/weatherScene.js';
import { emitterFrames, runEmitterDiff } from './support/emitterWeatherDiff.js';

mocks.files.table = WEATHER_SPRITES;

const FRAMES = emitterFrames({ stopAt: 11000, reviveAt: 15000, stop2At: 16500, endAt: 42500 });
// The sprite is not resident on two frames (nothing advances).
FRAMES[6].events.push('noSprite');
FRAMES[30].events.push('noSprite');

function run(seed, mutate = null) {
	const rng = new SeededRng(seed).fn;
	const { restore } = installDeterminism({ rng: new SeededRng(seed) });
	try {
		return runEmitterDiff({
			Legacy: SnowWeatherLegacy,
			SpriteRenderer,
			gl: makeGl(),
			mocks,
			frames: FRAMES,
			params: tick => ({ Inst: { effectID: 162, startTick: tick, endTick: -1 }, Init: { ownerAID: -1 } }),
			create: (tick, p) => new SnowWeather({ startTick: p.Inst.startTick, endTick: p.Inst.endTick }, { rng }),
			beforeLegacyFrame: i => {
				mocks.files.missing = FRAMES[i].events.includes('noSprite');
			},
			frameCtx: (tick, player) => ({
				player,
				cellHeight: mutate?.cellHeight ?? cellHeight,
				sprite: mocks.files.missing
					? null
					: { spr: WEATHER_SPRITES[`${SNOW_SPRITE_PATH}.spr`], act: WEATHER_SPRITES[`${SNOW_SPRITE_PATH}.act`] }
			})
		});
	} finally {
		restore();
		mocks.files.missing = false;
	}
}

describe('SnowWeather record-diff (legacy vs render-records)', { timeout: 60000 }, () => {
	it('reproduces every legacy snow record field by field', () => {
		const { mismatches, records, framesDrawn } = run(0x5a0);
		expect(mismatches.slice(0, 20)).toEqual([]);
		expect(records).toBeGreaterThan(50000);
		expect(framesDrawn).toBeGreaterThan(60);
	});

	it('is deterministic per seed', () => {
		expect(run(7).mismatches.slice(0, 5)).toEqual([]);
	});

	it('fails the diff when a rule is broken (mutation guard)', () => {
		const { mismatches } = run(0x5a0, { cellHeight: (x, y) => cellHeight(x, y) + 0.01 });
		expect(mismatches.length).toBeGreaterThan(100);
	});
});
