import { describe, expect, it, vi } from 'vitest';

// Legacy EF_RAIN driven against a logging fake GL over the scripted scene of
// support/rainScene.js (seeded Math.random, fake Date.now). Every GL call is hashed in
// order, and the puddle pass (the part drawn by RainWeather's own program) is kept
// verbatim, so the exact draw sequence is pinned across refactors.
const mocks = vi.hoisted(() => ({
	session: { Entity: null },
	map: { currentMap: '', fog: null },
	renderer: { tick: 0 },
	camera: { zoom: 2, getLatitude: () => -45, angle: [0, 0], modelView: null, projection: null, position: [0, 0, 0] }
}));

vi.mock('Utils/WebGL.js', () => ({
	default: {
		createShaderProgram: (_gl, vs) => ({
			id: vs.includes('uWorldPosition') ? 'puddleProgram' : 'program',
			attribute: new Proxy({}, { get: (_t, k) => `attr:${String(k)}` }),
			uniform: new Proxy({}, { get: (_t, k) => `uni:${String(k)}` })
		})
	}
}));
vi.mock('Renderer/Camera.js', () => ({ default: mocks.camera }));
vi.mock('Renderer/Renderer.js', () => ({ default: mocks.renderer }));
vi.mock('Renderer/MapRenderer.js', () => ({ default: mocks.map }));
vi.mock('Renderer/Map/Altitude.js', () => ({ default: { getCellHeight: (x, y) => 0.1 * x - 0.05 * y + 0.25 } }));
vi.mock('Engine/SessionStorage.js', () => ({ default: mocks.session }));
vi.mock('Preferences/Audio.js', () => ({ default: { Sound: { play: true, volume: 1 } } }));

import { installDeterminism } from '../../modernized/webgpu-reimagined/test-harness/src/determinism/installDeterminism.js';
import { SeededRng } from '../../modernized/webgpu-reimagined/test-harness/src/determinism/SeededRng.js';
import { FakeClock } from '../../modernized/webgpu-reimagined/test-harness/src/determinism/FakeClock.js';
import { makeGl, makeGlLog } from './support/weatherScene.js';
import { RAIN_SEED, runLegacyRain } from './support/rainScene.js';

/** Fresh legacy modules (module state: singleton, procedural textures, puddle program). */
async function loadLegacy() {
	vi.resetModules();
	const { default: RainWeather } = await import('Renderer/Effects/RainWeather.js');
	const { default: SpriteRenderer } = await import('Renderer/SpriteRenderer.js');
	return { RainWeather, SpriteRenderer };
}

/** Run the scene; returns the GL summary and the native records (when observed). */
async function script({ observe = false, modules = null } = {}) {
	const { RainWeather, SpriteRenderer } = modules ?? (await loadLegacy());
	// Puddle-pass calls are kept verbatim on every 10th frame (the rest is in the hash).
	let inPuddles = false;
	let frame = 0;
	const puddleDraws = [];
	const log = makeGlLog((name, args) => {
		if (name === 'useProgram') {
			inPuddles = args[0] && args[0].id === 'puddleProgram';
		}
		if (inPuddles && name === 'uniform2f') {
			puddleDraws.push(args[1]);
		}
		return inPuddles && frame % 10 === 0;
	});
	const gl = makeGl(log.onCall);
	const sprites = [];
	const puddles = [];
	const stops = observe
		? [
				SpriteRenderer.addRecordSink(r => sprites.push(r)),
				...(RainWeather.addRecordSink ? [RainWeather.addRecordSink(r => puddles.push(r))] : [])
			]
		: [];
	const clock = new FakeClock();
	const { restore } = installDeterminism({ rng: new SeededRng(RAIN_SEED), clock });
	try {
		runLegacyRain({ RainWeather, SpriteRenderer, gl, mocks, clock, onPass: (i, pass) => {
				log.mark([i, pass]);
				frame = i + 1;
			} });
	} finally {
		restore();
		stops.forEach(stop => stop());
	}
	return { summary: { ...log.summary(), puddleDraws: puddleDraws.length }, puddleDraws, sprites, puddles };
}

describe('RainWeather GL draw path', { timeout: 60000 }, () => {
	it('issues the pinned GL call sequence (no visual change across refactors)', async () => {
		const { summary } = await script();
		expect(summary.calls).toBeGreaterThan(100000);
		expect(summary.puddleDraws).toBeGreaterThan(1000);
		expect(summary).toMatchSnapshot();
	});

	it('emits one record per puddle draw and observing does not change GL calls', async () => {
		const unobserved = (await script()).summary;
		const { summary, puddles, puddleDraws } = await script({ observe: true });
		expect(summary).toEqual(unobserved);

		expect(puddles).toHaveLength(puddleDraws.length);
		expect(new Set(puddles).size).toBe(puddles.length);
		expect(puddles.map(r => r.params.size)).toEqual(puddleDraws);
		for (const r of puddles) {
			expect(r).toMatchObject({
				kind: 'effect',
				family: 'rainPuddle',
				pass: 'before',
				blend: { src: 'SRC_ALPHA', dst: 'ONE_MINUS_SRC_ALPHA' },
				depthTest: true,
				depthWrite: false,
				depthCorrection: false
			});
		}
	});

	it('stops emitting after unsubscribe', async () => {
		const modules = await loadLegacy();
		const records = [];
		modules.RainWeather.addRecordSink(r => records.push(r))();
		await script({ modules });
		expect(records).toHaveLength(0);
	});
});
