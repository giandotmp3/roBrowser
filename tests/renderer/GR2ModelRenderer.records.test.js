import { describe, expect, it, vi } from 'vitest';

// Legacy GR2 pass (Renderer/GR2/GR2ModelRenderer.js) driven against a logging fake GL over
// the synthetic skinned models of support/gr2Assets.js: every GL call and its arguments are
// captured so the exact draw sequence is pinned across refactors. The real GR2Loader,
// gr2Pack, gr2World, actorAction, gr2Banks and granny-ro-js `poseAt` run; only the file
// archive, the parse entry points, the shader compile, SpriteRenderer's depth helper,
// Altitude, the debug tile and the emblem canvas are stand-ins.

const bridge = vi.hoisted(() => ({ getFile: null, log: null }));

vi.mock('Core/Client.js', () => ({
	default: { getFile: (...args) => bridge.getFile(...args) }
}));
vi.mock('Utils/WebGL.js', () => ({
	default: { createShaderProgram: () => ({ id: 'program' }) }
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
vi.mock('Engine/SessionStorage.js', () => ({ default: { Entity: null } }));
vi.mock('Renderer/Map/Altitude.js', async () => {
	const { cellHeight } = await import('./support/gr2Scene.js');
	return { default: { getCellHeight: cellHeight } };
});
vi.mock('Renderer/Effects/FlatColorTile.js', () => ({
	default: name =>
		class {
			static init() {
				bridge.log.push(`@tile ${name} init`);
			}
			static beforeRender(_gl, _mv, _proj, _fog, tick) {
				bridge.log.push(`@tile ${name} before ${tick}`);
			}
			static afterRender() {
				bridge.log.push(`@tile ${name} after`);
			}
			constructor(position) {
				this.position = position;
			}
			render(_gl, tick) {
				bridge.log.push(`@tile ${name} render ${Array.from(this.position).join(',')} ${tick}`);
			}
		}
}));
vi.mock('granny-ro-js/wasm', async importOriginal => {
	const real = await importOriginal();
	const { grannySeam } = await import('./support/gr2Assets.js');
	return { ...real, ...grannySeam };
});

import { installEmblemCanvas, serializeGl } from './support/gr2GlLog.js';
import { buildGr2Files } from './support/gr2Assets.js';
import { createFileQueue, driveLegacy } from './support/gr2Scene.js';

const log = [];
bridge.log = log;

let objects = 0;
const enabled = new Set(['BLEND', 'DEPTH_TEST']);
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
				if (k === 'enable') {
					enabled.add(args[0]);
				} else if (k === 'disable') {
					enabled.delete(args[0]);
				} else if (k === 'isEnabled') {
					return enabled.has(args[0]);
				}
				return /^create/.test(k) ? { id: `${k.slice(6).toLowerCase()}${++objects}` } : undefined;
			};
		}
	}
);

/** The whole timeline through the legacy GR2 pass (fresh module state per run). */
async function script(onFrame, setup) {
	objects = 0;
	enabled.clear();
	enabled.add('BLEND');
	enabled.add('DEPTH_TEST');
	vi.resetModules();
	const { default: renderer } = await import('Renderer/GR2/GR2ModelRenderer.js');
	setup?.(renderer);
	const queue = createFileQueue(buildGr2Files());
	bridge.getFile = queue.getFile;
	const restoreCanvas = installEmblemCanvas(log);
	try {
		await driveLegacy({
			renderer,
			gl,
			queue,
			onFrame: tick => {
				log.push(`@frame ${tick}`);
				onFrame?.(tick, renderer);
			}
		});
	} finally {
		restoreCanvas();
	}
	return { renderer, requests: queue.requests };
}

describe('GR2ModelRenderer GL draw path', () => {
	it('issues the pinned GL call sequence (no visual change across refactors)', async () => {
		log.length = 0;
		await script();
		expect(log.filter(c => c.startsWith('drawElements ')).length).toBeGreaterThan(500);
		expect(log).toMatchSnapshot();
	});

	it('emits one record per instance draw and observing does not change GL calls', async () => {
		log.length = 0;
		await script();
		const unobserved = log.slice();

		const records = [];
		let frame = -1;
		log.length = 0;
		await script(
			tick => {
				frame = tick;
			},
			mod => mod.addRecordSink(r => records.push({ tick: frame, record: r }))
		);
		expect(log).toEqual(unobserved);

		const alphas = log.filter(c => c.startsWith('uniform1f uni:uAlpha '));
		expect(records.length).toBeGreaterThan(400);
		expect(new Set(records.map(r => r.record)).size).toBe(records.length);
		expect(records.map(({ record }) => `uniform1f uni:uAlpha ${record.alpha}`)).toEqual(alphas);
		const bones = log.filter(c => c.startsWith('uniformMatrix4fv uni:uBones[0] '));
		expect(records.map(({ record }) => `uniformMatrix4fv uni:uBones[0] false ${serializeGl(record.matrices)}`)).toEqual(bones);
		for (const { record } of records) {
			expect(record).toMatchObject({
				kind: 'world',
				part: 'gr2',
				blend: { src: 'SRC_ALPHA', dst: 'ONE_MINUS_SRC_ALPHA' },
				depthTest: true,
				depthWrite: true
			});
			expect(record.params.type).toMatch(/^data\/model\/3dmob\/.*\.gr2$/);
			expect(record.params.world).toHaveLength(16);
			expect(record.matrices.length % 16).toBe(0);
			expect(record.alpha).toBeGreaterThanOrEqual(0);
			expect(record.alpha).toBeLessThanOrEqual(1);
		}
		// fading, emblem and per-profile light variants are all observed
		expect(records.some(r => r.record.alpha < 1)).toBe(true);
		expect(new Set(records.map(r => r.record.params.emblem?.id ?? null))).toEqual(
			new Set([null, 'emblemA', 'emblemB'])
		);
		const flag = records.filter(r => r.record.params.type.includes('guildflag'));
		expect(new Set(flag.map(r => r.record.params.light.ambient[0])).size).toBe(2);
		// instances sharing a 40 Hz pose bucket share the palette array
		const perTick = Map.groupBy(records, r => r.tick);
		expect([...perTick.values()].some(list => new Set(list.map(r => r.record.matrices)).size < list.length)).toBe(true);
	});

	it('stops emitting after unsubscribe', async () => {
		const records = [];
		let stop = null;
		let stoppedAt = -1;
		await script(
			tick => {
				if (tick === 1000) {
					stop();
					stoppedAt = records.length;
				}
			},
			mod => {
				stop = mod.addRecordSink(r => records.push(r));
			}
		);
		expect(stoppedAt).toBeGreaterThan(0);
		expect(records).toHaveLength(stoppedAt);
		const late = [];
		await script(undefined, mod => mod.addRecordSink(r => late.push(r))());
		expect(late).toHaveLength(0);
	});
});
