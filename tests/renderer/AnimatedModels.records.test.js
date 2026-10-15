import { describe, expect, it, vi } from 'vitest';

// Legacy animated RSM map models (Renderer/Map/AnimatedModels.js) driven against a logging
// fake GL: every GL call and its arguments are captured so the exact draw sequence (matrix
// texture uploads included) is pinned across refactors. The real OccluderFade runs; the
// camera, graphics settings, SpriteRenderer's depth helper, the shader compile and the
// texture loads are stand-ins.

const bridge = vi.hoisted(() => ({
	log: null,
	graphics: { performanceMode: false, occluderFade: 'off', occluderFadeOpacity: 0.25, occluderFadeRadius: 5 },
	queryHit: true
}));

vi.mock('Utils/WebGL.js', () => ({
	default: {
		createShaderProgram: () => ({ id: 'program' }),
		texture: (_gl, data, onload) => onload({ id: data.name })
	}
}));
vi.mock('Core/Client.js', () => ({
	default: {
		loadFile: (filename, onload, onerror) => {
			if (filename.includes('missing')) {
				onerror?.();
			} else {
				onload({ name: filename });
			}
		}
	}
}));
vi.mock('Preferences/Graphics.js', () => ({ default: bridge.graphics }));
vi.mock('Renderer/Camera.js', () => ({
	default: { state: 1, states: { isometric: 0, third_person: 1, first_person: 2 }, focus: new Float32Array([1, 2, 3]) }
}));
vi.mock('Renderer/SpriteRenderer.js', () => ({
	default: {
		runWithDepth: (test, mask, correction, fn) => {
			bridge.log.push(`@runWithDepth ${test} ${mask} ${correction}`);
			fn();
			bridge.log.push('@runWithDepth end');
		}
	}
}));

import { serializeGl } from './support/gr2GlLog.js';
import {
	MODEL_VIEW,
	NORMAL3,
	PROJECTION,
	TICKS,
	animatedPayloads,
	fogAt,
	lightAt,
	settingsAt
} from './support/animatedModelScene.js';

const log = [];
bridge.log = log;

let objects = 0;
const gl = new Proxy(
	{},
	{
		get(_t, k) {
			if (typeof k === 'string' && /^[A-Z_0-9]+$/.test(k)) {
				return k;
			}
			return (...args) => {
				if (k === 'getUniformLocation') {
					return `uni:${args[1]}`;
				}
				if (k === 'getAttribLocation') {
					return `attr:${args[1]}`;
				}
				log.push([k, ...args.map(serializeGl)].join(' '));
				if (k === 'getQueryParameter') {
					return args[1] === 'QUERY_RESULT_AVAILABLE' ? true : bridge.queryHit;
				}
				return /^create/.test(k) ? { id: `${k.slice(6).toLowerCase()}${++objects}` } : undefined;
			};
		}
	}
);

/** Load every payload, then run the tick list (fresh module state per run). */
async function script(setup, onFrame) {
	objects = 0;
	vi.resetModules();
	const { default: AnimatedModels } = await import('Renderer/Map/AnimatedModels.js');
	const { default: OccluderFade } = await import('Renderer/Map/OccluderFade.js');
	setup?.(AnimatedModels);
	const { performanceMode, occluderFade } = settingsAt(0);
	Object.assign(bridge.graphics, { performanceMode, occluderFade });
	AnimatedModels.render(gl, MODEL_VIEW, PROJECTION, NORMAL3, fogAt(0), lightAt(0), 0);
	log.push(`@has ${AnimatedModels.hasAnimatedModels()}`);
	for (const data of animatedPayloads()) {
		AnimatedModels.add(gl, data);
	}
	log.push(`@has ${AnimatedModels.hasAnimatedModels()}`);
	TICKS.forEach((tick, i) => {
		const { queryHit, ...graphics } = settingsAt(i);
		Object.assign(bridge.graphics, graphics);
		bridge.queryHit = queryHit;
		log.push(`@frame ${tick} ${JSON.stringify(settingsAt(i))}`);
		OccluderFade.beginFrame(gl, MODEL_VIEW, tick);
		AnimatedModels.render(gl, MODEL_VIEW, PROJECTION, NORMAL3, fogAt(i), lightAt(i), tick);
		onFrame?.(tick, i);
		AnimatedModels.renderFaded(gl, MODEL_VIEW, PROJECTION, NORMAL3, fogAt(i), lightAt(i));
	});
	AnimatedModels.free(gl);
	OccluderFade.free(gl);
	log.push(`@has ${AnimatedModels.hasAnimatedModels()}`);
	return AnimatedModels;
}

describe('AnimatedModels GL draw path', () => {
	it('issues the pinned GL call sequence (no visual change across refactors)', async () => {
		log.length = 0;
		await script();
		expect(log.filter(c => c.startsWith('texSubImage2D ')).length).toBeGreaterThan(60);
		expect(log).toMatchSnapshot();
	});

	it('emits one record per model per frame and observing does not change GL calls', async () => {
		log.length = 0;
		await script();
		const unobserved = log.slice();

		const records = [];
		log.length = 0;
		await script(mod => mod.addRecordSink(r => records.push(r)));
		expect(log).toEqual(unobserved);

		// the payload with no node is ignored: 5 models, TICKS.length frames (+ the empty pre-roll)
		expect(records).toHaveLength(5 * TICKS.length);
		expect(new Set(records).size).toBe(records.length);
		const uploads = log.filter(c => c.startsWith('texSubImage2D '));
		const updated = records.filter(r => r.params.updated);
		// the first upload of each model happens at load (add), outside any record
		expect(uploads.slice(5)).toEqual(
			updated.map(r => `texSubImage2D TEXTURE_2D 0 0 0 ${r.matrices.length / 4} 1 RGBA FLOAT ${serializeGl(r.matrices)}`)
		);
		records.forEach((r, i) => {
			expect(r).toMatchObject({
				kind: 'world',
				part: 'animatedModel',
				blend: { src: 'SRC_ALPHA', dst: 'ONE_MINUS_SRC_ALPHA' },
				depthTest: true,
				depthWrite: true
			});
			expect(r.params.model).toBe(i % 5);
		});
		expect(records.filter(r => r.params.model === 1).map(r => r.alpha)).toContain(0.75);
		// static model (index 4) and frozen model (index 3, animLen 1) never recompute
		expect(records.filter(r => r.params.model >= 3 && r.params.updated)).toEqual([]);
		// observers get snapshots: later recomputes do not mutate an earlier record
		const spin = records.filter(r => r.params.model === 0 && r.params.updated);
		expect(spin.length).toBeGreaterThan(10);
		expect(new Set(spin.map(r => serializeGl(r.matrices))).size).toBeGreaterThan(5);
	});

	it('stops emitting after unsubscribe', async () => {
		const records = [];
		let stop = null;
		let stoppedAt = -1;
		await script(
			mod => {
				stop = mod.addRecordSink(r => records.push(r));
			},
			(_tick, i) => {
				if (i === 10) {
					stop();
					stoppedAt = records.length;
				}
			}
		);
		expect(stoppedAt).toBe(5 * 11);
		expect(records).toHaveLength(stoppedAt);
	});
});
