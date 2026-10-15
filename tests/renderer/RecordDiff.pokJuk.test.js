/**
 * Phase 2 record-diff of render-records' PokJukWeather (EF_POKJUK fireworks, R-EFX-016)
 * against legacy Renderer/Effects/PokJukWeatherEffect.js.
 *
 * Legacy fireworks draw only through SpriteRenderer (no record seam needed): native
 * records come from SpriteRenderer.addRecordSink inside ScreenEffectManager's pass. Every
 * frame starts from a scripted "previous user" SpriteRenderer state (angle, offset,
 * shadow, zIndex, depth, palette) because the fireworks inherit it; render-records gets
 * the same state as ctx.inherited. Same events, player path and seeded random sequence;
 * records are diffed per frame, field by field (tolerance 1e-5, relative above 1).
 *
 * Declared divergences: none.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	session: { Entity: null },
	map: { currentMap: '' },
	renderer: { tick: 0 },
	camera: { zoom: 2, getLatitude: () => -45, angle: [0, 0] },
	sounds: []
}));

vi.mock('Utils/WebGL.js', () => ({
	default: { createShaderProgram: () => ({ attribute: {}, uniform: {} }) }
}));
vi.mock('Renderer/Camera.js', () => ({ default: mocks.camera }));
vi.mock('Renderer/Renderer.js', () => ({ default: mocks.renderer }));
vi.mock('Renderer/MapRenderer.js', () => ({ default: mocks.map }));
vi.mock('Engine/SessionStorage.js', () => ({ default: mocks.session }));
vi.mock('Audio/SoundManager.js', () => ({ default: { play: name => mocks.sounds.push(name) } }));

import SpriteRenderer from 'Renderer/SpriteRenderer.js';
import PokJukLegacy from 'Renderer/Effects/PokJukWeatherEffect.js';
import { POKJUK_TEXTURE, PokJukWeather } from '../../modernized/webgpu-reimagined/render-records/src/index.js';
import { installDeterminism } from '../../modernized/webgpu-reimagined/test-harness/src/determinism/installDeterminism.js';
import { SeededRng } from '../../modernized/webgpu-reimagined/test-harness/src/determinism/SeededRng.js';
import { makeGl } from './support/weatherScene.js';
import { emitterFrames, runEmitterDiff } from './support/emitterWeatherDiff.js';

beforeAll(() => {
	// jsdom has no 2D canvas: the procedural particle texture only needs the calls to exist.
	const ctx2d = new Proxy({}, { get: (_t, k) => (k === 'createRadialGradient' ? () => ({ addColorStop: () => {} }) : () => {}) });
	HTMLCanvasElement.prototype.getContext = () => ctx2d;
});

const FRAMES = emitterFrames({ stopAt: 47000, step: i => (i % 3 ? 180 : 240), reviveAt: 47600, stop2At: 52000, endAt: 53000 });
const PALETTE = { id: 'leftover-palette' };

/** SpriteRenderer state the previous user left, per frame. */
function inheritedAt(i) {
	return {
		angle: (i * 7) % 40,
		offset: [i % 5, -2],
		shadowFactor: i % 4 ? 1 : 0.75,
		zIndex: 10 + (i % 3),
		depthBias: i % 6 ? 0 : 0.05,
		palette: i % 11 === 0 ? PALETTE : null,
		paletteSize: [32, 64]
	};
}

const textureKey = t => (t && String(t.id).startsWith('texture') ? POKJUK_TEXTURE : t);

function run(seed, mutate = null) {
	const rng = new SeededRng(seed).fn;
	const sounds = [];
	mocks.sounds.length = 0;
	const { restore } = installDeterminism({ rng: new SeededRng(seed) });
	try {
		const result = runEmitterDiff({
			Legacy: PokJukLegacy,
			SpriteRenderer,
			gl: makeGl(),
			mocks,
			frames: FRAMES,
			params: tick => ({ Inst: { effectId: 316, startTick: tick, endTick: -1 }, Init: { ownerAID: -1 } }),
			create: () =>
				new PokJukWeather(
					{ player: mocks.session.Entity ? mocks.session.Entity.position : null },
					{ rng, playSound: name => sounds.push(name) }
				),
			legacyStop: L => L.stop(),
			beforeLegacyFrame: inheritedAt,
			frameCtx: (tick, player, inherited) => ({
				player,
				inherited: mutate ? { ...inherited, zIndex: inherited.zIndex + 1 } : inherited
			}),
			textureKey
		});
		return { ...result, sounds, legacySounds: mocks.sounds.slice() };
	} finally {
		restore();
	}
}

describe('PokJukWeather record-diff (legacy vs render-records)', { timeout: 60000 }, () => {
	it('reproduces every legacy fireworks record field by field', () => {
		const { mismatches, records, sounds, legacySounds } = run(0xf1e);
		expect(mismatches.slice(0, 20)).toEqual([]);
		expect(records).toBeGreaterThan(20000);
		// more launches than fireworks: spent fireworks were replaced
		expect(sounds.length).toBeGreaterThan(3);
		expect(sounds).toEqual(legacySounds);
	});

	it('is deterministic per seed', () => {
		expect(run(5).mismatches.slice(0, 5)).toEqual([]);
	});

	it('fails the diff when the inherited zIndex is ignored (mutation guard)', () => {
		expect(run(0xf1e, true).mismatches.length).toBeGreaterThan(100);
	});
});
