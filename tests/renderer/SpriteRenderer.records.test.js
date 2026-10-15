import { beforeAll, describe, expect, it, vi } from 'vitest';

// The GL path is driven against a logging fake: every call and its arguments are
// captured, so the exact draw sequence can be pinned before and after refactors.
vi.mock('Utils/WebGL.js', () => ({
	default: {
		createShaderProgram: () => ({
			attribute: new Proxy({}, { get: (_t, k) => `attr:${String(k)}` }),
			uniform: new Proxy({}, { get: (_t, k) => `uni:${String(k)}` })
		})
	}
}));
vi.mock('Renderer/Camera.js', () => ({ default: { zoom: 2, getLatitude: () => -45 } }));

import SpriteRenderer from 'Renderer/SpriteRenderer.js';

const log = [];
const serialize = v =>
	v === null || v === undefined || typeof v !== 'object'
		? v
		: ArrayBuffer.isView(v)
			? Array.from(v, n => Math.round(n * 1e5) / 1e5)
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
const FOG = { use: true, exist: true, near: 10, far: 100, color: new Float32Array([0.5, 0.6, 0.7]) };
const TEX = [{ id: 'tex0' }, { id: 'tex1' }, { id: 'tex2' }];
const PAL = { id: 'pal0' };

function layer(fields) {
	const sr = SpriteRenderer;
	sr.image.texture = 'texture' in fields ? fields.texture : TEX[0];
	sr.image.palette = fields.palette ?? null;
	sr.image.size[0] = fields.texSize?.[0] ?? 64;
	sr.image.size[1] = fields.texSize?.[1] ?? 128;
	sr.sprite = fields.sprite ?? { type: fields.palette ? 0 : 1 };
	sr.position.set(fields.position ?? [10, 20, 0.2]);
	sr.color.set(fields.color ?? [1, 1, 1, 1]);
	sr.size.set(fields.size ?? [64, 128]);
	sr.offset.set(fields.offset ?? [0, -40]);
	sr.angle = fields.angle ?? 0;
	sr.shadow = fields.shadow ?? 1;
	sr.depth = fields.depth ?? 0;
	sr.ignoreDepthMinCap = fields.ignoreDepthMinCap ?? false;
	sr.xSize = fields.xSize ?? 5;
	sr.ySize = fields.ySize ?? 5;
	if (fields.zIndex !== undefined) {
		sr.zIndex = fields.zIndex;
	}
	sr.render(fields.blend);
}

/** Scripted sequence covering every branch of the 3D draw path. */
function script() {
	SpriteRenderer.bind3DContext(gl, IDENTITY, IDENTITY, FOG);
	layer({ zIndex: 150, palette: PAL });
	layer({ palette: PAL, texture: TEX[1] });
	layer({ texture: TEX[1], color: [1, 1, 1, 0] }); // alpha 0: skipped, no zIndex++
	layer({ texture: null }); // no texture: skipped
	layer({ zIndex: 300, angle: 30, offset: [5, -60], size: [-32, 64] });
	layer({ angle: 30, shadow: 0.5, depth: 0.25, blend: true });
	layer({ blend: false, ignoreDepthMinCap: true, xSize: 4 });
	SpriteRenderer.runWithDepth(true, false, true, () => {
		layer({ zIndex: -1, texture: TEX[2], color: [0.2, 0.3, 0.4, 0.5] });
	});
	SpriteRenderer.runWithDepth(false, false, false, () => {
		layer({ zIndex: 500, texture: TEX[2], blend: true });
		layer({ texture: TEX[0] });
	});
	layer({ zIndex: 550 });
	SpriteRenderer.unbind(gl);
}

describe('SpriteRenderer 3D draw path', () => {
	beforeAll(() => {
		SpriteRenderer.init(gl);
	});

	it('issues the pinned GL call sequence (no visual change across refactors)', () => {
		log.length = 0;
		script();
		expect(log).toMatchSnapshot();
	});

	it('emits one record per drawn layer and observing does not change GL calls', () => {
		log.length = 0;
		script();
		const unobserved = log.slice();

		const records = [];
		const stop = SpriteRenderer.addRecordSink(r => records.push(r));
		log.length = 0;
		script();
		stop();
		expect(log).toEqual(unobserved);

		// alpha-0 and texture-less layers draw nothing and emit nothing
		expect(records).toHaveLength(9);
		expect(new Set(records).size).toBe(9);
		expect(records.map(r => r.zIndex)).toEqual([150, 151, 300, 301, 302, -1, 500, 501, 550]);
		expect(records.map(r => r.textureClass)).toEqual([
			'indexed',
			'indexed',
			'rgba',
			'rgba',
			'rgba',
			'rgba',
			'rgba',
			'rgba',
			'rgba'
		]);
		expect(records[0]).toMatchObject({ kind: 'sprite', texture: TEX[0], palette: PAL, xSize: 5, ySize: 5 });
		expect(Array.from(records[0].paletteSize)).toEqual([64, 128]);
		expect(Array.from(records[2].size)).toEqual([-32, 64]);
		expect(records[2].angle).toBe(30);
		expect(records[3]).toMatchObject({ shadowFactor: 0.5, depthBias: 0.25, blend: 'additive', setBlend: true });
		expect(records[4]).toMatchObject({ blend: 'normal', setBlend: true, ignoreDepthMinCap: true, xSize: 4 });
		expect(records[5]).toMatchObject({ depthTest: true, depthWrite: false, depthCorrection: false });
		expect(records[6]).toMatchObject({ depthTest: false, depthWrite: false, depthCorrection: true, blend: 'additive' });
		// blend is sticky when render() is called without a mode
		expect(records[7]).toMatchObject({ blend: 'additive', setBlend: false });
		expect(records[8]).toMatchObject({ depthTest: true, depthWrite: true, depthCorrection: true });
		expect(Array.from(records[5].color, c => Math.round(c * 10) / 10)).toEqual([0.2, 0.3, 0.4, 0.5]);
	});

	it('stops emitting after unsubscribe', () => {
		const records = [];
		SpriteRenderer.addRecordSink(r => records.push(r))();
		script();
		expect(records).toHaveLength(0);
	});
});
