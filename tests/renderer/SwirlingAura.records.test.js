import { describe, expect, it, vi } from 'vitest';

// Legacy SwirlingAura (EF_LEVEL99) driven against a logging fake GL: every call and its
// arguments are captured so the exact draw sequence is pinned across refactors.
const log = vi.hoisted(() => []);

vi.mock('Utils/WebGL.js', () => ({
	default: {
		createShaderProgram: () => ({
			id: 'program',
			attribute: new Proxy({}, { get: (_t, k) => `attr:${String(k)}` }),
			uniform: new Proxy({}, { get: (_t, k) => `uni:${String(k)}` })
		}),
		texture: (_gl, buffer, onload) => onload({ id: buffer })
	}
}));
vi.mock('Core/Client.js', () => ({
	default: {
		loadFile: (filename, onload) => {
			if (!filename.includes('missing')) {
				onload(filename);
			}
		}
	}
}));
vi.mock('Renderer/Map/Altitude.js', async () => {
	const { cellHeight } = await import('./support/auraScene.js');
	return { default: { getCellHeight: cellHeight } };
});
vi.mock('Renderer/SpriteRenderer.js', () => ({
	default: {
		runWithDepth: (depthTest, depthMask, depthCorrection, fn) => {
			log.push(`@depth ${depthTest} ${depthMask} ${depthCorrection}`);
			fn();
			log.push('@depthEnd');
		}
	}
}));

import SwirlingAura from 'Renderer/Effects/SwirlingAura.js';
import { SWIRLING_AURA_SPAWNS, TICKS, fogAt, makeOwner, moveOwner, renderLegacyFrame, spawnLegacy } from './support/auraScene.js';

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

/** Scripted ticks over every spawn, framed like EffectManager.render. */
function script() {
	buffers = 0;
	SwirlingAura.init(gl);
	const owner = makeOwner();
	const live = spawnLegacy(SwirlingAura, SWIRLING_AURA_SPAWNS, owner);
	TICKS.forEach((tick, i) => {
		moveOwner(owner, tick);
		renderLegacyFrame(gl, SwirlingAura, live, tick, fogAt(i), ({ name }, t, drawn) => {
			log.push(`@state ${name} ${t} ${drawn}`);
		});
	});
	SwirlingAura.free(gl);
}

describe('SwirlingAura GL draw path', () => {
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
		const stop = SwirlingAura.addRecordSink(r => records.push(r));
		log.length = 0;
		script();
		stop();
		expect(log).toEqual(unobserved);

		const draws = log.filter(c => c.startsWith('drawElements '));
		expect(records).toHaveLength(draws.length);
		expect(new Set(records).size).toBe(records.length);
		expect(records.map(r => `drawElements TRIANGLES ${r.params.indexCount} UNSIGNED_SHORT 0`)).toEqual(draws);
		const uploads = log.filter(c => c.startsWith('bufferSubData '));
		expect(records.map(r => `bufferSubData ARRAY_BUFFER 0 [${Array.from(r.params.vertices).join(',')}]`)).toEqual(
			uploads
		);
		for (const r of records) {
			// R-EFX-014: additive; drawn before entities, depth test without write
			expect(r).toMatchObject({
				kind: 'effect',
				family: 'swirlingAura',
				pass: 'before',
				blend: { src: 'SRC_ALPHA', dst: 'ONE' },
				depthTest: true,
				depthWrite: false,
				depthCorrection: false,
				strAttachment: false
			});
			expect(r.color[3]).toBe(120 / 255);
			expect(String(r.texture.id)).not.toContain('missing');
		}
		expect(new Set(records.map(r => r.fog))).toEqual(new Set([true, false]));
		expect(new Set(records.map(r => r.params.band))).toEqual(new Set([0, 1, 2]));
		expect(new Set(records.map(r => r.color[1]))).toEqual(new Set([100 / 255, 1]));
	});

	it('stops emitting after unsubscribe', () => {
		const records = [];
		SwirlingAura.addRecordSink(r => records.push(r))();
		script();
		expect(records).toHaveLength(0);
	});
});
