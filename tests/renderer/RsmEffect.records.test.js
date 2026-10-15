import { describe, expect, it, vi } from 'vitest';

// Legacy RSM effects (RsmEffect) driven against a logging fake GL: every call and its
// arguments are captured so the exact draw sequence is pinned across refactors.

vi.mock('Utils/WebGL.js', () => ({
	default: {
		createShaderProgram: () => ({
			id: 'program',
			attribute: new Proxy({}, { get: (_t, k) => `attr:${String(k)}` }),
			uniform: new Proxy({}, { get: (_t, k) => `uni:${String(k)}` })
		}),
		// a failed file load leaves the path string: the image never loads
		texture: (_gl, data, onload, ...args) => {
			if (typeof data !== 'string') {
				onload({ id: data.name }, ...args);
			}
		}
	}
}));
vi.mock('Core/Client.js', () => ({
	default: {
		getFile: (filename, onload) => {
			if (!filename.includes('missing')) {
				onload(filename);
			}
		},
		loadFile: (filename, onload, onerror) => {
			if (filename.includes('missing')) {
				onerror?.();
			} else {
				onload({ name: filename });
			}
		}
	}
}));
vi.mock('Loaders/Model.js', async () => {
	const { FakeModel } = await import('./support/rsmEffectScene.js');
	return { default: FakeModel };
});

import RsmEffect from 'Renderer/Effects/RsmEffect.js';
import { installDeterminism } from '../../modernized/webgpu-reimagined/test-harness/src/determinism/installDeterminism.js';
import { SeededRng } from '../../modernized/webgpu-reimagined/test-harness/src/determinism/SeededRng.js';
import { RSM_SPAWNS, TICKS, fogAt, makeOwner, moveOwner, renderLegacyFrame, spawnLegacy } from './support/rsmEffectScene.js';

// one line per call keeps the snapshot compact; numbers print exactly (String)
const log = [];
const serialize = v =>
	v === null || v === undefined || typeof v !== 'object'
		? String(v)
		: ArrayBuffer.isView(v) || Array.isArray(v)
			? `[${Array.from(v, Number).join(',')}]`
			: String(v.id ?? '[obj]');

let buffers = 0;
const gl = new Proxy(
	{},
	{
		get(_t, k) {
			if (typeof k === 'string' && /^[A-Z_0-9]+$/.test(k)) {
				return k;
			}
			return (...args) => {
				log.push([k, ...args.map(serialize)].join(' '));
				return k === 'createBuffer' ? { id: `buffer${++buffers}` } : undefined;
			};
		}
	}
);

/** Scripted ticks over every spawn, framed like EffectManager.render (seeded Math.random). */
function script() {
	buffers = 0;
	const { restore } = installDeterminism({ rng: new SeededRng(0x45a) });
	try {
		RsmEffect.init(gl);
		const owner = makeOwner();
		const live = spawnLegacy(RsmEffect, RSM_SPAWNS, owner);
		TICKS.forEach((tick, i) => {
			moveOwner(owner, tick);
			renderLegacyFrame(gl, RsmEffect, live, tick, fogAt(i), ({ name }, t, drawn) => {
				log.push(`@state ${name} ${t} ${drawn}`);
			});
		});
		live.forEach(({ effect }) => effect.free(gl));
		RsmEffect.free(gl);
	} finally {
		restore();
	}
}

describe('RsmEffect GL draw path', () => {
	it('issues the pinned GL call sequence (no visual change across refactors)', () => {
		log.length = 0;
		script();
		expect(log).toMatchSnapshot();
	});

	it('emits one record per draw and observing does not change GL calls', () => {
		log.length = 0;
		script();
		const unobserved = log.slice();

		const records = [];
		const stop = RsmEffect.addRecordSink(r => records.push(r));
		log.length = 0;
		script();
		stop();
		expect(log).toEqual(unobserved);

		const draws = log.filter(c => c.startsWith('drawArrays '));
		expect(records).toHaveLength(draws.length);
		expect(new Set(records).size).toBe(records.length);
		expect(records.map(r => `drawArrays TRIANGLES ${r.params.vertOffset} ${r.params.vertCount}`)).toEqual(draws);
		const binds = log.filter(c => c.startsWith('bindTexture '));
		expect(records.map(r => `bindTexture TEXTURE_2D ${serialize(r.texture)}`)).toEqual(binds);
		for (const r of records) {
			// RSM effects set no blend or depth state: they inherit the after-entities pass
			expect(r).toMatchObject({
				kind: 'effect',
				family: 'rsm',
				pass: 'after',
				blend: { src: 'SRC_ALPHA', dst: 'ONE_MINUS_SRC_ALPHA' },
				depthTest: true,
				depthWrite: true,
				depthCorrection: false,
				strAttachment: false
			});
			expect(r.params.vertices).toHaveLength(r.params.vertCount * 9);
		}
		expect(new Set(records.map(r => r.fog))).toEqual(new Set([true, false]));
		// animated draws carry their keyframe; static ones null
		expect(records.some(r => r.params.frame === null)).toBe(true);
		expect(records.some(r => r.params.frame > 0)).toBe(true);
		// a texture that fails in the rebuild path is drawn with no texture bound
		expect(records.some(r => r.texture === null)).toBe(true);
	});

	it('stops emitting after unsubscribe', () => {
		const records = [];
		RsmEffect.addRecordSink(r => records.push(r))();
		script();
		expect(records).toHaveLength(0);
	});
});
