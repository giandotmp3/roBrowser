import { describe, expect, it, vi } from 'vitest';

// Legacy PropertyGround / MagicRing effects driven against a logging fake GL: every call
// and its arguments are captured so the exact draw sequence is pinned across refactors.
const log = vi.hoisted(() => []);

vi.mock('Utils/WebGL.js', async () => (await import('./support/legacyEffectMocks.js')).webglMock);
vi.mock('Core/Client.js', async () => (await import('./support/legacyEffectMocks.js')).clientMock);

import { installDeterminism } from '../../modernized/webgpu-reimagined/test-harness/src/determinism/installDeterminism.js';
import { SeededRng } from '../../modernized/webgpu-reimagined/test-harness/src/determinism/SeededRng.js';
import { createLoggingGl, fogAt, renderClassFrame } from './support/legacyEffectMocks.js';
import {
	RING_TICKS,
	makeCaster,
	spawnMagicRings,
	spawnPropertyGrounds,
	updateCasters
} from './support/groundRingScene.js';

const gl = createLoggingGl(log);

const KINDS = {
	property: { path: 'Renderer/Effects/PropertyGround.js', family: 'property-ground' },
	ring: { path: 'Renderer/Effects/MagicRing.js', family: 'magic-ring' }
};

/**
 * Scripted ticks over every spawn on a fresh module instance, framed like
 * EffectManager.render (seeded Math.random).
 * @param {'property'|'ring'} kind
 * @param {function} [onModule] called with the fresh constructor before the run
 */
async function script(kind, onModule) {
	vi.resetModules();
	const Ctor = (await import(KINDS[kind].path)).default;
	onModule?.(Ctor);
	gl.resetIds();
	const { restore } = installDeterminism({ rng: new SeededRng(0x7a1) });
	try {
		const casters = [0, 1, 2].map(makeCaster);
		const live = kind === 'property' ? spawnPropertyGrounds(Ctor) : spawnMagicRings(Ctor, casters);
		RING_TICKS.forEach((tick, i) => {
			updateCasters(casters, tick);
			renderClassFrame(gl, Ctor, live, tick, fogAt(i), ({ name, effect }, t, drawn) => {
				log.push(`@state ${name} ${t} ${drawn} ${Boolean(effect.needCleanUp)}`);
			});
		});
		Ctor.free(gl);
	} finally {
		restore();
	}
}

describe.each(['property', 'ring'])('%s ground GL draw path', kind => {
	it('issues the pinned GL call sequence (no visual change across refactors)', async () => {
		log.length = 0;
		await script(kind);
		expect(log).toMatchSnapshot();
	});

	it('emits one record per draw and observing does not change GL calls', async () => {
		log.length = 0;
		await script(kind);
		const unobserved = log.slice();

		const records = [];
		let stop;
		log.length = 0;
		await script(kind, Ctor => {
			stop = Ctor.addRecordSink(r => records.push(r));
		});
		stop();
		expect(log).toEqual(unobserved);

		const draws = log.filter(l => l.startsWith('drawArrays '));
		expect(records).toHaveLength(draws.length);
		expect(new Set(records).size).toBe(records.length);
		expect(records.map(r => `drawArrays TRIANGLES 0 ${r.params.vertexCount}`)).toEqual(draws);
		const binds = log.filter(l => l.startsWith('bindTexture TEXTURE_2D data/'));
		expect(records.map(r => `bindTexture TEXTURE_2D ${r.texture.id}`)).toEqual(binds);
		const tops = log.filter(l => l.startsWith('uniform1f uni:uTopSize '));
		expect(records.map(r => `uniform1f uni:uTopSize ${r.params.topSize}`)).toEqual(tops);
		for (const r of records) {
			// no blend or depth state of their own: normal alpha, the after-entities pass state
			expect(r).toMatchObject({
				kind: 'effect',
				family: KINDS[kind].family,
				pass: 'after',
				blend: { src: 'SRC_ALPHA', dst: 'ONE_MINUS_SRC_ALPHA' },
				depthTest: true,
				depthWrite: true,
				depthCorrection: false
			});
		}
		expect(records.some(r => r.fog)).toBe(true);
		expect(records.some(r => !r.fog)).toBe(true);
		expect(records.some(r => String(r.texture.id).includes('missing'))).toBe(false);
	});

	it('stops emitting after unsubscribe', async () => {
		const records = [];
		await script(kind, Ctor => Ctor.addRecordSink(r => records.push(r))());
		expect(records).toHaveLength(0);
	});
});
