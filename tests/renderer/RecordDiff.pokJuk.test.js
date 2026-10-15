/**
 * Phase 2 record-diff of render-records' PokJukWeather (EF_POKJUK fireworks, R-EFX-016)
 * against legacy Renderer/Effects/PokJukWeatherEffect.js.
 *
 * Legacy fireworks draw only through SpriteRenderer (no record seam needed): native
 * records come from SpriteRenderer.addRecordSink inside ScreenEffectManager's pass. Same
 * events, player path and seeded random sequence; records are diffed per frame, field by
 * field (tolerance 1e-5, relative above 1).
 *
 * Declared divergences (HITL round 2):
 *  - #51 [FLAG, fixed]: render-records draws the fireworks additive; legacy's render(false)
 *    resets normal blend before every particle. With legacy started from a fresh
 *    SpriteRenderer state, `blend` (legacy 'normal', render-records 'additive') is the only
 *    field allowed to differ.
 *  - #47/#52 [FLAG, fixed]: legacy inherits angle, offset, shadow, zIndex, depth and palette
 *    from the previous SpriteRenderer user. In the scripted "leftover state" scene only those
 *    fields (plus #51's blend) may differ, and render-records' records must equal the ones it
 *    draws in the fresh-state scene, i.e. they ignore the leftover state.
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
import { BLEND_ADDITIVE, POKJUK_TEXTURE, PokJukWeather } from '../../modernized/webgpu-reimagined/render-records/src/index.js';
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

/** A fresh SpriteRenderer state (what render-records' self-contained records use, #52). */
const FRESH = () => ({ angle: 0, offset: [0, 0], shadowFactor: 1, zIndex: 0, depthBias: 0, palette: null, paletteSize: [0, 0] });

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

function run(seed, { inherited = inheritedAt, mutate = false } = {}) {
	const rng = new SeededRng(seed).fn;
	const sounds = [];
	const modern = [];
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
			create: () => {
				const instance = new PokJukWeather(
					{ player: mocks.session.Entity ? mocks.session.Entity.position : null },
					{ rng, playSound: name => sounds.push(name) }
				);
				const frame = instance.frame.bind(instance);
				instance.frame = (tick, ctx) => {
					const records = frame(tick, ctx).map(r => (mutate ? { ...r, zIndex: r.zIndex + 1 } : r));
					modern.push(...records);
					return records;
				};
				return instance;
			},
			legacyStop: L => L.stop(),
			beforeLegacyFrame: inherited,
			frameCtx: (tick, player, state) => ({ player, inherited: state }),
			textureKey
		});
		return { ...result, modern, sounds, legacySounds: mocks.sounds.slice() };
	} finally {
		restore();
	}
}

describe('PokJukWeather record-diff (legacy vs render-records)', { timeout: 60000 }, () => {
	it('from a fresh SpriteRenderer state, every field matches except the #51 blend', () => {
		const { mismatches, records, sounds, legacySounds, modern } = run(0xf1e, { inherited: FRESH });
		expect(records).toBeGreaterThan(20000);
		const blend = mismatches.filter(m => m.endsWith(' blend: normal vs additive'));
		expect(blend.length).toBe(records); // #51: every legacy record is normal, every rebuild one additive
		expect(mismatches.filter(m => !blend.includes(m)).slice(0, 20)).toEqual([]);
		expect(modern.every(r => r.blend === BLEND_ADDITIVE)).toBe(true);
		// more launches than fireworks: spent fireworks were replaced
		expect(sounds.length).toBeGreaterThan(3);
		expect(sounds).toEqual(legacySounds);
	});

	it('#47/#52: legacy inherits the leftover SpriteRenderer state; render-records ignores it', () => {
		const leftover = run(0xf1e);
		const fresh = run(0xf1e, { inherited: FRESH });
		const INHERITED = /#\d+ (angle|offset|shadowFactor|zIndex|depthBias|palette|paletteSize|textureClass|blend): /;
		expect(leftover.mismatches.some(m => / zIndex: /.test(m))).toBe(true); // really exercised
		expect(leftover.mismatches.some(m => / palette: /.test(m))).toBe(true);
		expect(leftover.mismatches.filter(m => !INHERITED.test(m)).slice(0, 20)).toEqual([]);
		expect(leftover.modern).toEqual(fresh.modern);
	});

	it('is deterministic per seed', () => {
		expect(run(5, { inherited: FRESH }).mismatches.filter(m => !m.endsWith(' blend: normal vs additive'))).toEqual([]);
	});

	it('fails the diff when a record field is broken (mutation guard)', () => {
		expect(run(0xf1e, { inherited: FRESH, mutate: true }).mismatches.length).toBeGreaterThan(20000 * 2);
	});
});
