/**
 * Phase 2 record-diff of render-records' CloudWeather (EF_CLOUD…EF_CLOUD8 map weather,
 * R-EFX-016) against legacy Renderer/Effects/CloudWeatherEffect.js.
 *
 * Legacy cloud weather draws only through SpriteRenderer (no record seam needed): its
 * native records come from SpriteRenderer.addRecordSink inside ScreenEffectManager's
 * pass. render-records' CloudWeather gets the same profile, events (start, revive, stop,
 * map change), player path and seeded random sequence. Records are diffed per frame,
 * field by field (tolerance 1e-5, relative above 1). Cloud positions accumulate in
 * float32 on both sides.
 *
 * Declared divergences: none.
 */
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	session: { Entity: null },
	map: { currentMap: '' },
	renderer: { tick: 0, getContext: () => null },
	camera: { zoom: 2, getLatitude: () => -45, angle: [0, 0] }
}));

vi.mock('Utils/WebGL.js', () => ({
	default: {
		createShaderProgram: () => ({ attribute: {}, uniform: {} }),
		texture: (_gl, buffer, onload) => onload({ id: buffer.name })
	}
}));
vi.mock('Core/Client.js', () => ({
	default: { loadFile: (filename, onload) => onload({ name: filename }) }
}));
vi.mock('Renderer/Camera.js', () => ({ default: mocks.camera }));
vi.mock('Renderer/Renderer.js', () => ({ default: mocks.renderer }));
vi.mock('Renderer/MapRenderer.js', () => ({ default: mocks.map }));
vi.mock('Engine/SessionStorage.js', () => ({ default: mocks.session }));

import SpriteRenderer from 'Renderer/SpriteRenderer.js';
import CloudWeatherLegacy from 'Renderer/Effects/CloudWeatherEffect.js';
import { CloudWeather } from '../../modernized/webgpu-reimagined/render-records/src/index.js';
import { installDeterminism } from '../../modernized/webgpu-reimagined/test-harness/src/determinism/installDeterminism.js';
import { SeededRng } from '../../modernized/webgpu-reimagined/test-harness/src/determinism/SeededRng.js';
import { makeGl, playerAt } from './support/weatherScene.js';
import { emitterFrames, runEmitterDiff } from './support/emitterWeatherDiff.js';

const FRAMES = emitterFrames({
	stopAt: 21000,
	step: i => (i % 4 ? 130 : 410),
	reviveAt: 21600,
	stop2At: 22400,
	endAt: 25600,
	tailStep: 300
});

function run(seed, effectId, mutate = 0) {
	const rng = new SeededRng(seed).fn;
	const { restore } = installDeterminism({ rng: new SeededRng(seed) });
	try {
		return runEmitterDiff({
			Legacy: CloudWeatherLegacy,
			SpriteRenderer,
			gl: makeGl(),
			mocks,
			frames: FRAMES,
			params: tick => ({ Inst: { effectId, startTick: tick, endTick: -1 }, Init: { ownerAID: -1 } }),
			create: (tick, p) => {
				const cloud = new CloudWeather({ effectId: p.Inst.effectId + mutate, startTick: tick }, { rng });
				cloud.setUp(p.Inst.startTick, playerAt(tick));
				return cloud;
			},
			frameCtx: (tick, player) => ({ player }),
			textureKey: t => t?.id
		});
	} finally {
		restore();
	}
}

describe('CloudWeather record-diff (legacy vs render-records)', { timeout: 60000 }, () => {
	it.each([
		['EF_CLOUD (overlay)', 229, 0xc1],
		['EF_CLOUD2', 230, 0xc2],
		['EF_CLOUD3 (fog textures, overlay)', 233, 0xc3],
		['EF_CLOUD5', 516, 0xc5],
		['EF_CLOUD8', 698, 0xc8],
		['unknown id (EF_CLOUD profile)', 4242, 0xc9]
	])('reproduces every legacy %s record field by field', (_name, effectId, seed) => {
		const { mismatches, records } = run(seed, effectId);
		expect(mismatches.slice(0, 20)).toEqual([]);
		expect(records).toBeGreaterThan(3000);
	});

	it('fails the diff when the profile is wrong (mutation guard)', () => {
		expect(run(0xc2, 230, 3).mismatches.length).toBeGreaterThan(100);
	});
});
