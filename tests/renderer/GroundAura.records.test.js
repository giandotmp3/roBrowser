import { describe, expect, it, vi } from 'vitest';

// Legacy GroundAura (EF_LEVEL99_2) driven against a logging fake GL: every call and its
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

import GroundAura from 'Renderer/Effects/GroundAura.js';
import { GROUND_AURA_SPAWNS, TICKS, fogAt, makeOwner, moveOwner, renderLegacyFrame, spawnLegacy } from './support/auraScene.js';

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

/** Scripted ticks over every spawn, framed like EffectManager.render. */
function script() {
	GroundAura.init(gl);
	const owner = makeOwner();
	const live = spawnLegacy(GroundAura, GROUND_AURA_SPAWNS, owner);
	TICKS.forEach((tick, i) => {
		moveOwner(owner, tick);
		renderLegacyFrame(gl, GroundAura, live, tick, fogAt(i), ({ name }, t, drawn) => {
			log.push(`@state ${name} ${t} ${drawn}`);
		});
	});
	GroundAura.free(gl);
}

describe('GroundAura GL draw path', () => {
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
		const stop = GroundAura.addRecordSink(r => records.push(r));
		log.length = 0;
		script();
		stop();
		expect(log).toEqual(unobserved);

		const draws = log.filter(c => c.startsWith('drawArrays '));
		expect(records).toHaveLength(draws.length);
		expect(new Set(records).size).toBe(records.length);
		expect(records.map(r => `drawArrays TRIANGLES 0 ${r.params.vertexCount}`)).toEqual(draws);
		const sizes = log.filter(c => c.startsWith('uniform2f '));
		expect(records.map(r => `uniform2f uni:uSize ${r.params.size[0]} ${r.params.size[1]}`)).toEqual(sizes);
		for (const r of records) {
			// R-EFX-014: additive; drawn flat on the ground before entities, depth test without write
			expect(r).toMatchObject({
				kind: 'effect',
				family: 'groundAura',
				pass: 'before',
				blend: { src: 'SRC_ALPHA', dst: 'ONE' },
				depthTest: true,
				depthWrite: false,
				depthCorrection: false,
				strAttachment: false
			});
			expect(Array.from(r.color)).toEqual([1, 1, 1, 0.8]);
			expect(String(r.texture.id)).not.toContain('missing');
		}
		expect(new Set(records.map(r => r.fog))).toEqual(new Set([true, false]));
		expect(new Set(records.map(r => r.params.ring))).toEqual(new Set([0, 1]));
	});

	it('stops emitting after unsubscribe', () => {
		const records = [];
		GroundAura.addRecordSink(r => records.push(r))();
		script();
		expect(records).toHaveLength(0);
	});
});
