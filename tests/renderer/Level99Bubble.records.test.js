import { describe, expect, it, vi } from 'vitest';

// Legacy Level99Bubble (EF_LEVEL99_3) driven against a logging fake GL: every call and its
// arguments are captured so the exact draw sequence is pinned across refactors.
const log = vi.hoisted(() => []);
const camera = vi.hoisted(() => ({ angle: [230, 0, 0] }));

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
vi.mock('Renderer/Camera.js', () => ({ default: camera }));
vi.mock('Renderer/SpriteRenderer.js', () => ({
	default: {
		runWithDepth: (depthTest, depthMask, depthCorrection, fn) => {
			log.push(`@depth ${depthTest} ${depthMask} ${depthCorrection}`);
			fn();
			log.push('@depthEnd');
		}
	}
}));

import Level99Bubble from 'Renderer/Effects/Level99Bubble.js';
import { installDeterminism } from '../../modernized/webgpu-reimagined/test-harness/src/determinism/installDeterminism.js';
import { SeededRng } from '../../modernized/webgpu-reimagined/test-harness/src/determinism/SeededRng.js';
import {
	LEVEL99_BUBBLE_SPAWNS,
	TICKS,
	cameraAngleAt,
	fogAt,
	makeOwner,
	moveOwner,
	renderLegacyFrame,
	spawnLegacy
} from './support/auraScene.js';

const serialize = v =>
	v === null || v === undefined || typeof v !== 'object'
		? String(v)
		: ArrayBuffer.isView(v) || Array.isArray(v)
			? `[${Array.from(v, Number).join(',')}]`
			: String(v.id ?? '[obj]');

const gl = new Proxy(
	{},
	{
		get(_t, k) {
			if (typeof k === 'string' && /^[A-Z_0-9]+$/.test(k)) {
				return k;
			}
			return (...args) => {
				log.push([k, ...args.map(serialize)].join(' '));
				return k === 'createBuffer' ? { id: 'buffer' } : undefined;
			};
		}
	}
);

/** Scripted ticks over every spawn, framed like EffectManager.render (seeded Math.random, fake clock). */
function script() {
	const { restore } = installDeterminism({ rng: new SeededRng(0x99b) });
	try {
		Level99Bubble.init(gl);
		const owner = makeOwner();
		const live = spawnLegacy(Level99Bubble, LEVEL99_BUBBLE_SPAWNS, owner);
		TICKS.forEach((tick, i) => {
			moveOwner(owner, tick);
			[camera.angle[0], camera.angle[1]] = cameraAngleAt(tick);
			renderLegacyFrame(gl, Level99Bubble, live, tick, fogAt(i), ({ name }, t, drawn) => {
				log.push(`@state ${name} ${t} ${drawn}`);
			});
		});
		Level99Bubble.free(gl);
	} finally {
		restore();
	}
}

describe('Level99Bubble GL draw path', () => {
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
		const stop = Level99Bubble.addRecordSink(r => records.push(r));
		log.length = 0;
		script();
		stop();
		expect(log).toEqual(unobserved);

		const draws = log.filter(c => c.startsWith('drawArrays '));
		expect(records).toHaveLength(draws.length);
		expect(new Set(records).size).toBe(records.length);
		expect(records.map(r => `drawArrays TRIANGLES 0 ${r.params.vertexCount}`)).toEqual(draws);
		const colors = log.filter(c => c.startsWith('uniform4f '));
		expect(records.map(r => `uniform4f uni:uColor ${Array.from(r.color).join(' ')}`)).toEqual(colors);
		// one quad upload per anchor, shared by its passes
		const uploads = log.filter(c => c.startsWith('bufferSubData '));
		expect(records.filter(r => r.params.pass === 0).map(r => `bufferSubData ARRAY_BUFFER 0 [${Array.from(r.params.quad).join(',')}]`)).toEqual(uploads);
		for (const r of records) {
			// R-EFX-014: additive; drawn before entities, depth test without write
			expect(r).toMatchObject({
				kind: 'effect',
				family: 'level99Bubble',
				pass: 'before',
				blend: { src: 'SRC_ALPHA', dst: 'ONE' },
				depthTest: true,
				depthWrite: false,
				depthCorrection: false,
				strAttachment: false
			});
			expect(r.color[3]).toBeGreaterThan(0);
			expect(String(r.texture.id)).not.toContain('missing');
		}
		expect(new Set(records.map(r => r.fog))).toEqual(new Set([true, false]));
		// blue draws two passes, white and ghost one
		expect(new Set(records.map(r => r.params.pass))).toEqual(new Set([0, 1]));
		expect(new Set(records.map(r => r.color[0]))).toEqual(new Set([80 / 255, 0.85, 1]));
	});

	it('stops emitting after unsubscribe', () => {
		const records = [];
		Level99Bubble.addRecordSink(r => records.push(r))();
		script();
		expect(records).toHaveLength(0);
	});
});
