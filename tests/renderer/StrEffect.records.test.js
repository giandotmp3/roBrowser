import { beforeAll, describe, expect, it, vi } from 'vitest';

// Legacy STR keyframe effects driven against a logging fake GL: every call and its
// arguments are captured so the exact draw sequence is pinned across refactors.
const files = vi.hoisted(() => ({}));

vi.mock('Utils/WebGL.js', () => ({
	default: {
		createShaderProgram: () => ({
			attribute: new Proxy({}, { get: (_t, k) => `attr:${String(k)}` }),
			uniform: new Proxy({}, { get: (_t, k) => `uni:${String(k)}` })
		})
	}
}));
vi.mock('Core/Client.js', () => ({
	default: {
		loadFile: (filename, _onload, onerror) => {
			if (!(filename in files) && onerror) {
				onerror('404');
			}
			return files[filename] ?? null;
		}
	}
}));

import StrEffect from 'Renderer/Effects/StrEffect.js';
import { STR_FILES, TICKS, spawnEffects } from './support/strEffectScene.js';

const log = [];
const serialize = v =>
	v === null || v === undefined || typeof v !== 'object'
		? v
		: ArrayBuffer.isView(v) || Array.isArray(v)
			? Array.from(v, Number)
			: (v.id ?? '[obj]');

const gl = new Proxy(
	{},
	{
		get(_t, k) {
			if (typeof k === 'string' && /^[A-Z_0-9]+$/.test(k)) {
				return k;
			}
			return (...args) => {
				log.push([k, ...args.map(serialize)]);
				return k === 'createBuffer' ? { id: 'buffer' } : undefined;
			};
		}
	}
);

const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
const PROJECTION = new Float32Array([2, 0, 0, 0, 0, 2, 0, 0, 0, 0, -1, -1, 0, 0, -0.2, 0]);
const FOG = { use: true, exist: true, near: 10, far: 100, color: new Float32Array([0.5, 0.6, 0.7]) };

/** Scripted ticks over every effect, framed like EffectManager.render. */
function script() {
	const effects = spawnEffects(StrEffect);
	for (const tick of TICKS) {
		effects.forEach(({ move }) => move?.(tick));
		StrEffect.beforeRender(gl, IDENTITY, PROJECTION, FOG, tick);
		for (const { name, effect } of effects) {
			log.push(['@render', name, tick]);
			effect.render(gl, tick);
			log.push(['@state', name, Boolean(effect.needCleanUp), effect.startTick]);
		}
		StrEffect.afterRender(gl);
	}
}

describe('StrEffect GL draw path', () => {
	beforeAll(() => {
		Object.assign(files, STR_FILES);
		StrEffect.init(gl);
	});

	it('issues the pinned GL call sequence (no visual change across refactors)', () => {
		log.length = 0;
		script();
		expect(log).toMatchSnapshot();
	});

	it('emits one record per layer draw and observing does not change GL calls', () => {
		log.length = 0;
		script();
		const unobserved = log.slice();

		const records = [];
		const stop = StrEffect.addRecordSink(r => records.push(r));
		log.length = 0;
		script();
		stop();
		expect(log).toEqual(unobserved);

		const draws = log.filter(c => c[0] === 'bindTexture');
		expect(records).toHaveLength(draws.length);
		expect(new Set(records).size).toBe(records.length);
		expect(records.map(r => r.texture.id)).toEqual(draws.map(c => c[2]));
		for (const r of records) {
			expect(r).toMatchObject({ kind: 'effect', family: 'str', depthWrite: false, fog: false });
		}

		const byTexture = id => records.filter(r => r.texture.id === id);
		// D3D blend pairs, normalised to factor names; codes outside the table give null
		expect(byTexture('b0')[0].blend).toEqual({ src: 'SRC_ALPHA_SATURATE', dst: 'ONE_MINUS_SRC_ALPHA' });
		expect(byTexture('b1')[0].blend).toEqual({ src: 'CONSTANT_COLOR', dst: 'ONE_MINUS_CONSTANT_ALPHA' });
		expect(byTexture('u0')[0]).toMatchObject({ blend: null, params: { srcBlend: 12, dstBlend: 2 } });
		// attachments: scale (10 + 8) / 2 / 5, no vertical base, offsets scaled
		const hat = byTexture('k0')[0];
		expect(hat).toMatchObject({ strAttachment: true, params: { scale: 1.8, yLower: 0 } });
		expect(hat.params.offset[0]).toBeCloseTo(3 * 0.2 * 35 * 1.8);
		expect(hat.params.offset[1]).toBeCloseTo(2 * 0.2 * 35 * 1.8);
		expect(byTexture('l0')[0]).toMatchObject({ strAttachment: false, params: { scale: 1, yLower: 0.5 } });
		// the never-loaded fallback material is skipped, not drawn
		expect(records.some(r => r.texture === undefined)).toBe(false);
	});

	it('stops emitting after unsubscribe', () => {
		const records = [];
		StrEffect.addRecordSink(r => records.push(r))();
		script();
		expect(records).toHaveLength(0);
	});
});
