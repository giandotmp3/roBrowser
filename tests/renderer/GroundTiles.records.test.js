import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Legacy ground tiles (Tiles.FlatTexture / HoveringTexture, LPEffect, SpiderWeb,
// FlatColorTile) driven against a logging fake GL: every call and its arguments are
// captured so the exact draw sequence is pinned across refactors.
const log = vi.hoisted(() => []);

vi.mock('Utils/WebGL.js', async () => (await import('./support/legacyEffectMocks.js')).webglMock);
vi.mock('Utils/Texture.js', async () => (await import('./support/legacyEffectMocks.js')).textureMock);
vi.mock('Core/Client.js', async () => (await import('./support/legacyEffectMocks.js')).clientMock);
vi.mock('Core/Configs.js', () => ({ default: { get: key => key === 'enableMipmap' } }));
vi.mock('Renderer/SpriteRenderer.js', () => ({
	default: {
		runWithDepth: (depthTest, depthMask, depthCorrection, fn) => {
			log.push(`@runWithDepth ${depthTest} ${depthMask} ${depthCorrection}`);
			fn();
		}
	}
}));

import { createLoggingGl, fogAt, installCanvasStub, renderClassFrame } from './support/legacyEffectMocks.js';
import { TILE_TICKS, buildTileGroups } from './support/groundTileScene.js';

const gl = createLoggingGl(log);
let uninstallCanvas;
beforeAll(() => {
	uninstallCanvas = installCanvasStub();
});
afterAll(() => uninstallCanvas());

/** Fresh legacy modules (factory caches and phase counters reset). */
async function loadModules() {
	vi.resetModules();
	return {
		Tiles: await import('Renderer/Effects/Tiles.js'),
		LPEffect: (await import('Renderer/Effects/LPEffect.js')).default,
		SpiderWeb: (await import('Renderer/Effects/SpiderWeb.js')).default,
		FlatColorTile: (await import('Renderer/Effects/FlatColorTile.js')).default
	};
}

/**
 * Scripted ticks over every group, framed like EffectManager.render.
 * @param {function} [onModules] called with the fresh modules before the run
 */
async function script(onModules) {
	const mods = await loadModules();
	onModules?.(mods);
	gl.resetIds();
	const groups = buildTileGroups(mods);
	TILE_TICKS.forEach((tick, i) => {
		for (const { group, Ctor, live } of groups) {
			log.push(`@group ${group}`);
			renderClassFrame(gl, Ctor, live, tick, fogAt(i), ({ name }, t, drawn) => {
				log.push(`@state ${name} ${t} ${drawn}`);
			});
		}
	});
	for (const { Ctor } of groups) {
		Ctor.free(gl);
	}
	return groups;
}

/** Subscribe to every record seam of the tile family. */
function subscribeAll(mods, sink) {
	const stops = [
		mods.Tiles.addRecordSink(sink),
		mods.LPEffect.addRecordSink(sink),
		mods.SpiderWeb.addRecordSink(sink),
		mods.FlatColorTile.addRecordSink(sink)
	];
	return () => stops.forEach(stop => stop());
}

describe('ground tile GL draw path', () => {
	it('issues the pinned GL call sequence (no visual change across refactors)', async () => {
		log.length = 0;
		await script();
		expect(log).toMatchSnapshot();
	});

	it('emits one record per draw and observing does not change GL calls', async () => {
		log.length = 0;
		await script();
		const unobserved = log.slice();

		const records = [];
		let stop;
		log.length = 0;
		await script(mods => {
			stop = subscribeAll(mods, r => records.push(r));
		});
		stop();
		expect(log).toEqual(unobserved);

		const draws = log.filter(l => l.startsWith('drawArrays '));
		expect(records).toHaveLength(draws.length);
		expect(new Set(records).size).toBe(records.length);
		expect(records.map(r => `drawArrays TRIANGLES 0 ${r.params.vertexCount}`)).toEqual(draws);
		const positions = log.filter(l => l.startsWith('uniform3fv uni:uPosition '));
		expect(records.map(r => `uniform3fv uni:uPosition [${Array.from(r.position).join(',')}]`)).toEqual(positions);

		const families = new Set(records.map(r => r.family));
		expect(families).toEqual(new Set(['flat-texture', 'hovering-texture', 'lp', 'spider-web', 'flat-color-tile']));
		for (const r of records) {
			expect(r).toMatchObject({
				kind: 'effect',
				pass: 'before',
				blend: { src: 'SRC_ALPHA', dst: 'ONE_MINUS_SRC_ALPHA' },
				depthCorrection: false
			});
			// FlatTexture.render turns depth off; every other tile inherits the pass state
			expect(r.depthTest).toBe(r.family !== 'flat-texture');
			expect(r.depthWrite).toBe(r.family !== 'flat-texture');
			// only the Tiles shader applies fog
			if (r.family === 'lp' || r.family === 'spider-web' || r.family === 'flat-color-tile') {
				expect(r.fog).toBe(false);
			}
		}
		expect(records.some(r => r.fog)).toBe(true);
		// the never-loaded texture class and the foreign FlatColorTile instance are never drawn
		expect(records.some(r => String(r.texture?.id).includes('missing'))).toBe(false);
		expect(records.some(r => r.color[0] === 0.9 && r.color[3] === 0.3)).toBe(false);
	});

	it('stops emitting after unsubscribe', async () => {
		const records = [];
		await script(mods => subscribeAll(mods, r => records.push(r))());
		expect(records).toHaveLength(0);
	});
});
