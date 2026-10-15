import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

// Legacy map waterfalls driven against a logging fake GL (seeded Math.random for the
// spray seeds): every GL call and its arguments are captured, so the exact draw sequence
// is pinned across refactors.
const loader = vi.hoisted(() => ({ current: null }));

vi.mock('Utils/WebGL.js', () => ({
	default: {
		createShaderProgram: (_gl, vs) => ({
			id: vs.includes('aSeed') ? 'particleProgram' : 'program',
			attribute: new Proxy({}, { get: (_t, k) => `attr:${String(k)}` }),
			uniform: new Proxy({}, { get: (_t, k) => `uni:${String(k)}` })
		}),
		texture: (_gl, buffer, onload) => onload({ id: buffer.name })
	}
}));
vi.mock('Core/Client.js', () => ({
	default: { loadFile: (filename, onload) => loader.current.loadFile(filename, onload) }
}));

import { installDeterminism } from '../../modernized/webgpu-reimagined/test-harness/src/determinism/installDeterminism.js';
import { SeededRng } from '../../modernized/webgpu-reimagined/test-harness/src/determinism/SeededRng.js';
import { makeGl, serialize } from './support/weatherScene.js';
import { WATERFALL_SEED, makeLoader, runLegacyWaterfall } from './support/waterfallScene.js';

/** Large uploads (spray seeds) are pinned by hash to keep the snapshot readable. */
const compact = v => {
	const out = serialize(v);
	if (Array.isArray(out) && out.length > 64) {
		return `${out.length} floats sha256:${createHash('sha256').update(JSON.stringify(out)).digest('hex')}`;
	}
	return out;
};

async function loadLegacy() {
	vi.resetModules();
	return (await import('Renderer/Effects/WaterfallEffect.js')).default;
}

async function script({ observe = false, WaterfallEffect = null } = {}) {
	const Waterfall = WaterfallEffect ?? (await loadLegacy());
	const log = [];
	const gl = makeGl((name, args) => log.push([name, ...args.map(compact)]));
	loader.current = makeLoader();
	const records = [];
	const stop = observe ? Waterfall.addRecordSink(r => records.push(r)) : null;
	const { restore } = installDeterminism({ rng: new SeededRng(WATERFALL_SEED) });
	try {
		runLegacyWaterfall({
			WaterfallEffect: Waterfall,
			gl,
			loader: loader.current,
			onRender: (i, name, tick) => log.push(['@render', i, name, tick])
		});
	} finally {
		restore();
		stop?.();
	}
	return { log, records };
}

describe('WaterfallEffect GL draw path', { timeout: 60000 }, () => {
	it('issues the pinned GL call sequence (no visual change across refactors)', async () => {
		const { log } = await script();
		expect(log.filter(c => c[0] === 'drawArrays').length).toBeGreaterThan(300);
		expect(log.filter(c => c[0] === 'drawArraysInstanced').length).toBeGreaterThan(15);
		expect(log).toMatchSnapshot();
	});

	it('emits one record per draw and observing does not change GL calls', async () => {
		const unobserved = (await script()).log;
		const { log, records } = await script({ observe: true });
		expect(log).toEqual(unobserved);

		const draws = log.filter(c => c[0] === 'drawArrays' || c[0] === 'drawArraysInstanced');
		expect(records).toHaveLength(draws.length);
		expect(new Set(records).size).toBe(records.length);
		expect(records.map(r => (r.family === 'waterfallSpray' ? 'drawArraysInstanced' : 'drawArrays'))).toEqual(
			draws.map(c => c[0])
		);
		const binds = log.filter(c => c[0] === 'bindTexture');
		expect(records.map(r => r.texture.id)).toEqual(binds.map(c => c[2]));
		for (const r of records) {
			expect(r).toMatchObject({ kind: 'effect', pass: 'after', depthTest: true, depthWrite: false, depthCorrection: false });
		}
		expect(records.find(r => r.family === 'waterfall').blend).toEqual({ src: 'SRC_ALPHA', dst: 'ONE_MINUS_SRC_ALPHA' });
		expect(records.find(r => r.family === 'waterfallSpray').blend).toEqual({ src: 'SRC_ALPHA', dst: 'ONE' });
	});

	it('stops emitting after unsubscribe', async () => {
		const WaterfallEffect = await loadLegacy();
		const records = [];
		WaterfallEffect.addRecordSink(r => records.push(r))();
		await script({ WaterfallEffect });
		expect(records).toHaveLength(0);
	});
});
