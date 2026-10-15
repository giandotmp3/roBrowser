import { beforeAll, describe, expect, it, vi } from 'vitest';

// Legacy CYLINDER effects driven against a logging fake GL: every call and its
// arguments are captured so the exact draw sequence is pinned across refactors.
const camera = vi.hoisted(() => ({ angle: [240, 0] }));
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
vi.mock('Renderer/Camera.js', () => ({ default: camera }));
vi.mock('Renderer/SpriteRenderer.js', () => ({
	default: {
		runWithDepth: (depthTest, depthMask, depthCorrection, fn) => {
			log.push(['@runWithDepth', depthTest, depthMask, depthCorrection]);
			fn();
		}
	}
}));

import Cylinder from 'Renderer/Effects/Cylinder.js';
import { installDeterminism } from '../../modernized/webgpu-reimagined/test-harness/src/determinism/installDeterminism.js';
import { SeededRng } from '../../modernized/webgpu-reimagined/test-harness/src/determinism/SeededRng.js';
import {
	CYLINDER_SPAWNS,
	TICKS,
	cameraAngleAt,
	fogAt,
	makeOwner,
	moveOwner,
	renderLegacyFrame,
	spawnLegacy
} from './support/cylinderQuadHornScene.js';

const serialize = v =>
	v === null || v === undefined || typeof v !== 'object'
		? v
		: ArrayBuffer.isView(v) || Array.isArray(v)
			? Array.from(v, Number)
			: (v.id ?? '[obj]');

let buffers = 0;
const gl = new Proxy(
	{},
	{
		get(_t, k) {
			if (typeof k === 'string' && /^[A-Z_0-9]+$/.test(k)) {
				return k;
			}
			return (...args) => {
				log.push([k, ...args.map(serialize)]);
				return k === 'createBuffer' ? { id: `buffer${++buffers}` } : undefined;
			};
		}
	}
);

/** Scripted ticks over every spawn, framed like EffectManager.render (seeded Math.random). */
function script() {
	buffers = 0;
	const { restore } = installDeterminism({ rng: new SeededRng(0xc11) });
	try {
		Cylinder.init(gl);
		const owner = makeOwner();
		const live = spawnLegacy(Cylinder, CYLINDER_SPAWNS, owner);
		TICKS.forEach((tick, i) => {
			moveOwner(owner, tick);
			camera.angle = cameraAngleAt(tick);
			renderLegacyFrame(gl, Cylinder, live, tick, fogAt(i), ({ name, effect }, t, drawn) => {
				log.push(['@state', name, t, drawn, Boolean(effect.needCleanUp)]);
			});
		});
		Cylinder.free(gl);
	} finally {
		restore();
	}
}

describe('Cylinder GL draw path', () => {
	beforeAll(() => {
		log.length = 0;
	});

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
		const stop = Cylinder.addRecordSink(r => records.push(r));
		log.length = 0;
		script();
		stop();
		expect(log).toEqual(unobserved);

		const draws = log.filter(c => c[0] === 'drawArrays');
		expect(records).toHaveLength(draws.length);
		expect(new Set(records).size).toBe(records.length);
		expect(records.map(r => r.params.vertexCount)).toEqual(draws.map(c => c[3]));
		const binds = log.filter(c => c[0] === 'bindTexture');
		expect(records.map(r => r.texture.id)).toEqual(binds.map(c => c[2]));
		for (const r of records) {
			expect(r).toMatchObject({
				kind: 'effect',
				family: 'cylinder',
				pass: 'after',
				depthTest: true,
				depthWrite: false,
				depthCorrection: false
			});
		}
		// GL-order blend table (R-EFX-011), src always SRC_ALPHA; 0 / 16 are normal alpha
		const blendOf = mode => records.find(r => r.params.blendMode === mode).blend;
		const normal = { src: 'SRC_ALPHA', dst: 'ONE_MINUS_SRC_ALPHA' };
		expect(blendOf(5)).toEqual({ src: 'SRC_ALPHA', dst: 'DST_COLOR' });
		expect(blendOf(7)).toEqual({ src: 'SRC_ALPHA', dst: 'SRC_ALPHA' });
		expect(blendOf(15)).toEqual({ src: 'SRC_ALPHA', dst: 'SRC_ALPHA_SATURATE' });
		expect(blendOf(0)).toEqual(normal);
		expect(blendOf(16)).toEqual(normal);
		expect(blendOf(undefined)).toEqual(normal);
		// the never-loaded texture is never drawn
		expect(records.some(r => String(r.texture.id).includes('missing'))).toBe(false);
	});

	it('stops emitting after unsubscribe', () => {
		const records = [];
		Cylinder.addRecordSink(r => records.push(r))();
		script();
		expect(records).toHaveLength(0);
	});
});
