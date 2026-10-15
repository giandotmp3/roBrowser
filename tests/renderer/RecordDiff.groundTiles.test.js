/**
 * Phase 2 record-diff of render-records' ground tiles (FlatTextureTileEffect,
 * HoveringTextureEffect, LandProtectorEffect, SpiderWebEffect, FlatColorTileEffect)
 * against legacy Renderer/Effects/Tiles.js, LPEffect.js, SpiderWeb.js and
 * FlatColorTile.js.
 *
 * The real legacy tiles run the synthetic groups of support/groundTileScene.js the way
 * EffectManager drives them; their native records are collected through the record
 * sinks. render-records gets the same specs, positions, spawn numbers (the legacy phase
 * counters) and scene fog. Both streams are diffed per instance and per tick, field by
 * field (tolerance 1e-5, relative above 1).
 *
 * Declared divergences: none.
 *
 * Not diffed:
 * - a class whose texture never loads (legacy's ready gate; residency is the backend's job);
 * - 'apple-foreign': a FlatColorTile instance that EffectManager files under another
 *   colour's list (every FlatColorTile class is named 'FlatColorTile') is never drawn by
 *   legacy. That is an EffectManager keying bug, not tile behaviour; the rebuild draws it.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('Utils/WebGL.js', async () => (await import('./support/legacyEffectMocks.js')).webglMock);
vi.mock('Utils/Texture.js', async () => (await import('./support/legacyEffectMocks.js')).textureMock);
vi.mock('Core/Client.js', async () => (await import('./support/legacyEffectMocks.js')).clientMock);
vi.mock('Core/Configs.js', () => ({ default: { get: () => false } }));
vi.mock('Renderer/SpriteRenderer.js', () => ({ default: { runWithDepth: (_t, _w, _c, fn) => fn() } }));

import {
	FlatColorTileEffect,
	FlatTextureTileEffect,
	HoveringTextureEffect,
	LandProtectorEffect,
	SpiderWebEffect
} from '../../modernized/webgpu-reimagined/render-records/src/index.js';
import { createLoggingGl, fogAt, installCanvasStub, renderClassFrame } from './support/legacyEffectMocks.js';
import { diffEffectRecord } from './support/effectRecordDiff.js';
import { TILE_TICKS, buildTileGroups } from './support/groundTileScene.js';

const gl = createLoggingGl(null);
let uninstallCanvas;
beforeAll(() => {
	uninstallCanvas = installCanvasStub();
});
afterAll(() => uninstallCanvas());

/** render-records counterpart of a legacy instance (index = legacy phase counter value). */
function rebuild(spec, effect, index) {
	const inst = { position: effect.position, index };
	switch (spec.kind) {
		case 'flat':
			return new FlatTextureTileEffect(spec, inst);
		case 'hover':
			return new HoveringTextureEffect(spec, inst);
		case 'lp':
			return new LandProtectorEffect(inst);
		case 'spider':
			return new SpiderWebEffect(inst);
		default:
			return new FlatColorTileEffect(spec.color, inst);
	}
}

/**
 * Run legacy and render-records side by side over the scripted ticks.
 * @param {object} [mutate] { index(i) } render-records-side mutation of the spawn numbers
 */
async function runScene(mutate = {}) {
	vi.resetModules();
	const mods = {
		Tiles: await import('Renderer/Effects/Tiles.js'),
		LPEffect: (await import('Renderer/Effects/LPEffect.js')).default,
		SpiderWeb: (await import('Renderer/Effects/SpiderWeb.js')).default,
		FlatColorTile: (await import('Renderer/Effects/FlatColorTile.js')).default
	};
	const groups = buildTileGroups(mods);
	// legacy phase counters: one shared by every HoveringTexture, one per LP / SpiderWeb
	const counters = { hover: 0, lp: 0, spider: 0 };
	const rebuilt = [];
	for (const { spec, live } of groups) {
		for (const { name, effect, foreign } of live) {
			const index = spec.kind in counters ? ++counters[spec.kind] : 0;
			const skip = foreign || String(spec.texture).includes('missing');
			rebuilt.push({ name, skip, effect: rebuild(spec, effect, mutate.index ? mutate.index(index) : index) });
		}
	}

	const mismatches = [];
	const perEffect = {};
	let records = 0;
	let sink = [];
	const push = r => sink.push(r);
	const stops = [
		mods.Tiles.addRecordSink(push),
		mods.LPEffect.addRecordSink(push),
		mods.SpiderWeb.addRecordSink(push),
		mods.FlatColorTile.addRecordSink(push)
	];
	try {
		TILE_TICKS.forEach((tick, i) => {
			const fog = fogAt(i);
			const legacy = {};
			for (const { Ctor, live } of groups) {
				renderClassFrame(gl, Ctor, live, tick, fog, ({ name }, _t, drawn) => {
					expect(sink.length).toBeLessThanOrEqual(drawn ? 1 : 0);
					legacy[name] = sink[0] ?? null;
					sink = [];
				});
			}
			for (const { name, skip, effect } of rebuilt) {
				if (skip) {
					if (legacy[name]) {
						mismatches.push(`${name}@${tick}: legacy drew a skipped instance`);
					}
					continue;
				}
				const m = effect.frame(tick, { sceneFog: { use: !!(fog.use && fog.exist) } });
				const l = legacy[name];
				if (!l) {
					mismatches.push(`${name}@${tick}: only render-records drew`);
					continue;
				}
				records++;
				perEffect[name] = (perEffect[name] ?? 0) + 1;
				// untextured tiles: legacy null texture ↔ render-records null key
				for (const d of diffEffectRecord(l.texture ? l : { ...l, texture: { id: null } }, m)) {
					mismatches.push(`${name}@${tick} ${d}`);
				}
			}
		});
	} finally {
		stops.forEach(stop => stop());
	}
	return { records, mismatches, perEffect };
}

describe('ground tile record-diff (legacy vs render-records)', () => {
	it('reproduces every legacy tile record field by field', async () => {
		const { records, mismatches, perEffect } = await runScene();
		expect(mismatches).toEqual([]);
		expect(Object.keys(perEffect).sort()).toEqual(
			[
				'flat-0',
				'flat-big-0',
				'lens-0',
				'lens-1',
				'zz-0',
				'lp-0',
				'lp-1',
				'lp-2',
				'spider-0',
				'spider-1',
				'salmon-0',
				'salmon-1',
				'lullaby-0'
			].sort()
		);
		expect(records).toBe(13 * TILE_TICKS.length);
	});

	it('flags a wrong pulse phase (mutation guard)', async () => {
		const { mismatches } = await runScene({ index: i => i + 1 });
		expect(mismatches.some(m => m.startsWith('lp-0') && m.includes('params.size'))).toBe(true);
		expect(mismatches.some(m => m.startsWith('lens-0') && m.includes('position'))).toBe(true);
	});

	it('validates colour specs like legacy without mutating them', () => {
		const spec = { r: 0.1, g: 0.2, b: 0.3 };
		expect(new FlatColorTileEffect(spec, { position: [0, 0, 0] }).color).toEqual([0.1, 0.2, 0.3, 0.5]);
		expect(spec.a).toBeUndefined();
		expect(() => new FlatColorTileEffect({ r: 0.1, g: 0.2 }, { position: [0, 0, 0] })).toThrow('need to pass');
		expect(() => new FlatColorTileEffect({ r: 2, g: 0, b: 0 }, { position: [0, 0, 0] })).toThrow('0.0-1.0');
	});
});
