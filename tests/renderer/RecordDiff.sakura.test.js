/**
 * Phase 2 record-diff of render-records' SakuraWeather (EF_SAKURA / EF_MAPLE, R-EFX-017)
 * against legacy Renderer/Effects/SakuraWeatherEffect.js.
 *
 * Legacy sakura draws only through SpriteRenderer (no record seam needed): its native
 * records come from SpriteRenderer.addRecordSink inside ScreenEffectManager's pass.
 * render-records' SakuraWeather gets the same events (start, revive, kind switch, stop,
 * map change, missing player / sprite), player path, terrain and seeded random sequence
 * (sway retargeting consumes it per frame). Records are diffed per frame, field by field
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
import SakuraWeatherLegacy from 'Renderer/Effects/SakuraWeatherEffect.js';
import { EF_MAPLE, EF_SAKURA, SakuraWeather } from '../../modernized/webgpu-reimagined/render-records/src/index.js';
import { installDeterminism } from '../../modernized/webgpu-reimagined/test-harness/src/determinism/installDeterminism.js';
import { SeededRng } from '../../modernized/webgpu-reimagined/test-harness/src/determinism/SeededRng.js';
import { WEATHER_SPRITES, cellHeight, makeGl } from './support/weatherScene.js';
import { emitterFrames, runEmitterDiff } from './support/emitterWeatherDiff.js';

mocks.files.table = WEATHER_SPRITES;

const FRAMES = emitterFrames({ stopAt: 17000, step: i => (i % 3 ? 140 : 260), reviveAt: 21000, stop2At: 22500, endAt: 48500 });
FRAMES[6].events.push('noSprite');
FRAMES[40].events.push('noSprite');

/**
 * @param {number} seed
 * @param {function} kindAt (frameIndex) => effect id of a start event
 */
function run(seed, kindAt) {
	const rng = new SeededRng(seed).fn;
	const { restore } = installDeterminism({ rng: new SeededRng(seed) });
	try {
		return runEmitterDiff({
			Legacy: SakuraWeatherLegacy,
			SpriteRenderer,
			gl: makeGl(),
			mocks,
			frames: FRAMES,
			params: (tick, i) => ({ Inst: { effectID: kindAt(i), startTick: tick, endTick: -1 }, Init: { ownerAID: -1 } }),
			create: (tick, p) =>
				new SakuraWeather({ effectId: p.Inst.effectID, startTick: p.Inst.startTick, endTick: p.Inst.endTick }, { rng }),
			reuse: (modern, p) => modern.isMaple === (p.Inst.effectID === EF_MAPLE),
			beforeLegacyFrame: i => {
				mocks.files.missing = FRAMES[i].events.includes('noSprite');
			},
			...withSprite()
		});
	} finally {
		restore();
		mocks.files.missing = false;
	}
}

/**
 * frameCtx resolving the live instance's sprite through the legacy file table
 * (`withSprite.cellHeight` overrides the terrain for the mutation guard).
 */
function withSprite() {
	let current = null;
	return {
		onEvent: (_event, _i, _tick, modern) => {
			current = modern;
		},
		frameCtx: (tick, player) => {
			const path = current?.spritePath;
			const sprite =
				mocks.files.missing || !path ? null : { spr: WEATHER_SPRITES[`${path}.spr`], act: WEATHER_SPRITES[`${path}.act`] };
			return { player, cellHeight: withSprite.cellHeight ?? cellHeight, sprite };
		}
	};
}

describe('SakuraWeather record-diff (legacy vs render-records)', { timeout: 60000 }, () => {
	it('reproduces every legacy sakura record field by field', () => {
		const { mismatches, records } = run(0x5a1, () => EF_SAKURA);
		expect(mismatches.slice(0, 20)).toEqual([]);
		expect(records).toBeGreaterThan(5000);
	});

	it('reproduces every legacy maple record field by field', () => {
		const { mismatches, records } = run(0x3a9, () => EF_MAPLE);
		expect(mismatches.slice(0, 20)).toEqual([]);
		expect(records).toBeGreaterThan(2000);
	});

	it('recreates the instance when the kind switches', () => {
		const { mismatches, records } = run(11, i => (i >= 9 && i < 60 ? EF_MAPLE : EF_SAKURA));
		expect(mismatches.slice(0, 20)).toEqual([]);
		expect(records).toBeGreaterThan(2000);
	});

	it('fails the diff when a rule is broken (mutation guard)', () => {
		withSprite.cellHeight = (x, y) => cellHeight(x, y) - 0.02;
		try {
			expect(run(0x5a1, () => EF_SAKURA).mismatches.length).toBeGreaterThan(100);
		} finally {
			withSprite.cellHeight = null;
		}
	});
});
