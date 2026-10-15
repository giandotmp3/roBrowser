import { beforeAll, describe, expect, it, vi } from 'vitest';

// Legacy 3D and 2D EffectTable effects (ThreeDEffect / TwoDEffect) driven through the
// real SpriteRenderer against a logging fake GL: every call and its arguments are
// captured so the exact draw sequence is pinned across refactors.
const files = vi.hoisted(() => ({}));
const camera = vi.hoisted(() => ({ zoom: 2, getLatitude: () => -45, angle: [0, 0, 0], direction: 0 }));
const side = vi.hoisted(() => []);

vi.mock('Utils/WebGL.js', () => ({
	default: {
		createShaderProgram: () => ({
			attribute: new Proxy({}, { get: (_t, k) => `attr:${String(k)}` }),
			uniform: new Proxy({}, { get: (_t, k) => `uni:${String(k)}` })
		}),
		texture: (_gl, buffer, callback) => {
			side.push(['@texture', buffer.name]);
			callback({ id: buffer.name });
		}
	}
}));
vi.mock('Core/Client.js', () => ({
	default: {
		loadFile: (filename, onload) => {
			const value = files[filename] ?? null;
			if (value && onload) {
				onload(value);
			}
			return value;
		}
	}
}));
vi.mock('Renderer/Camera.js', () => ({ default: camera }));
vi.mock('Renderer/Map/Altitude.js', () => ({
	default: { getCellHeight: (x, y) => 0.1 * x - 0.05 * y + 0.25 }
}));
vi.mock('Renderer/Entity/Entity.js', () => ({
	default: class Entity {
		static TYPE_EFFECT = 9;
		action = 0;
		direction = 0;
	}
}));
vi.mock('Renderer/EntityManager.js', () => ({
	default: { add: entity => side.push(['@entity', entity.GID, entity.objecttype, entity.hideShadow]) }
}));

import SpriteRenderer from 'Renderer/SpriteRenderer.js';
import ThreeDEffect from 'Renderer/Effects/ThreeDEffect.js';
import TwoDEffect from 'Renderer/Effects/TwoDEffect.js';
import { installDeterminism } from '../../modernized/webgpu-reimagined/test-harness/src/determinism/installDeterminism.js';
import { SeededRng } from '../../modernized/webgpu-reimagined/test-harness/src/determinism/SeededRng.js';
import { ALL_FILES, LEAK_3D, SPAWNS_2D, SPAWNS_3D, TICKS, cameraAt, spawnEffects } from './support/spriteEffectScene.js';

// one line per call keeps the snapshot compact; numbers print exactly (String)
const log = [];
const line = entry => entry.map(v => (Array.isArray(v) ? `[${v.join(',')}]` : String(v))).join(' ');
const push = (...entry) => log.push(line(entry));
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
				push(k, ...args.map(serialize));
				return k === 'createBuffer' ? { id: 'buffer' } : undefined;
			};
		}
	}
);

const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
const PROJECTION = new Float32Array([2, 0, 0, 0, 0, 2, 0, 0, 0, 0, -1, -1, 0, 0, -0.2, 0]);
const FOG = { use: true, exist: true, near: 10, far: 100, color: new Float32Array([0.5, 0.6, 0.7]) };

/** Spawn (seeded), then run the scripted ticks framed like EffectManager.render. */
function script() {
	const determinism = installDeterminism({ rng: new SeededRng(0x3d2d) });
	let groups;
	try {
		groups = [
			[ThreeDEffect, spawnEffects(ThreeDEffect, [...SPAWNS_3D, ...LEAK_3D])],
			[TwoDEffect, spawnEffects(TwoDEffect, SPAWNS_2D)]
		];
	} finally {
		determinism.restore();
	}
	side.length = 0;
	for (const [, list] of groups) {
		list.forEach(e => e.effect.init(gl));
	}
	push('@init', ...side.splice(0).flat());

	TICKS.forEach((tick, f) => {
		const cam = cameraAt(tick);
		camera.angle[1] = cam.angle1;
		camera.direction = cam.direction;
		for (const [Ctor, list] of groups) {
			list.forEach(e => e.move?.(tick));
			Ctor.beforeRender(gl, IDENTITY, PROJECTION, { ...FOG, use: f % 2 === 0 }, tick);
			for (const e of list) {
				if (e.done || !e.effect.ready) {
					continue;
				}
				push('@render', e.name, tick);
				e.effect.render(gl, tick);
				push('@state', e.name, Boolean(e.effect.needCleanUp), ...side.splice(0).flat());
				if (e.owner?.log.length) {
					push('@owner', e.name, ...e.owner.log.splice(0).flat(), serialize(e.owner.attachment?.position));
				}
				e.done = Boolean(e.effect.needCleanUp);
			}
			Ctor.afterRender(gl);
		}
	});
}

describe('ThreeDEffect / TwoDEffect GL draw path', () => {
	beforeAll(() => {
		Object.assign(files, ALL_FILES);
		SpriteRenderer.init(gl);
		ThreeDEffect.init(gl);
		TwoDEffect.init(gl);
	});

	it('issues the pinned GL call sequence (no visual change across refactors)', () => {
		log.length = 0;
		script();
		expect(log).toMatchSnapshot();
	});

	it('emits one record per visible draw and observing does not change GL calls', () => {
		log.length = 0;
		script();
		const unobserved = log.slice();

		const records = [];
		const stop3d = ThreeDEffect.addRecordSink(r => records.push(r));
		const stop2d = TwoDEffect.addRecordSink(r => records.push(r));
		const sprites = [];
		const stopSprite = SpriteRenderer.addRecordSink(r => sprites.push(r));
		log.length = 0;
		script();
		stop3d();
		stop2d();
		stopSprite();
		expect(log).toEqual(unobserved);

		// one effect record per SpriteRenderer draw, in the same order, with the same state
		expect(records).toHaveLength(sprites.length);
		expect(new Set(records).size).toBe(records.length);
		records.forEach((r, i) => {
			const s = sprites[i];
			expect(r.texture).toBe(s.texture);
			expect(Array.from(r.position)).toEqual(Array.from(s.position));
			expect(Array.from(r.color)).toEqual(Array.from(s.color));
			expect(Array.from(r.params.size)).toEqual(Array.from(s.size));
			expect(Array.from(r.params.offset)).toEqual(Array.from(s.offset));
			expect(r.params).toMatchObject({ angle: s.angle, zIndex: s.zIndex, depthBias: s.depthBias, palette: s.palette });
			expect(r).toMatchObject({ depthTest: s.depthTest, depthWrite: s.depthWrite, depthCorrection: s.depthCorrection });
		});

		const of = family => records.filter(r => r.family === family);
		expect(of('3d').length).toBeGreaterThan(100);
		expect(of('2d').length).toBeGreaterThan(100);
		for (const r of records) {
			expect(r.kind).toBe('effect');
		}
		// R-EFX-011: GL-order table, src always SRC_ALPHA; 0 / out of range -> normal
		const byMode = (family, mode) => of(family).find(r => r.params.blendMode === mode);
		for (const family of ['3d', '2d']) {
			expect(byMode(family, 5).blend).toEqual({ src: 'SRC_ALPHA', dst: 'DST_COLOR' });
			expect(byMode(family, 7).blend).toEqual({ src: 'SRC_ALPHA', dst: 'SRC_ALPHA' });
			expect(byMode(family, 15).blend).toEqual({ src: 'SRC_ALPHA', dst: 'SRC_ALPHA_SATURATE' });
			expect(byMode(family, 16).blend).toEqual({ src: 'SRC_ALPHA', dst: 'ONE_MINUS_SRC_ALPHA' });
			expect(byMode(family, undefined).blend).toEqual({ src: 'SRC_ALPHA', dst: 'ONE_MINUS_SRC_ALPHA' });
		}
		// R-EFX-013: overlay drops depth test and correction; 2D also writes depth
		expect(of('3d').find(r => r.params.overlay)).toMatchObject({ depthTest: false, depthWrite: false, depthCorrection: false });
		expect(of('3d').find(r => !r.params.overlay)).toMatchObject({ depthTest: true, depthWrite: false, depthCorrection: true });
		expect(of('2d').find(r => r.params.overlay)).toMatchObject({ depthTest: false, depthWrite: false, depthCorrection: false });
		expect(of('2d').find(r => !r.params.overlay)).toMatchObject({ depthTest: true, depthWrite: true, depthCorrection: true });
		// fog follows the scene fog (SpriteRenderer shader), alternating per frame
		expect(new Set(records.map(r => r.fog))).toEqual(new Set([true, false]));
		// sprite-backed 3D layers carry their layer index; plain draws -1
		expect(of('3d').some(r => r.params.layer === 2)).toBe(true);
		expect(of('2d').every(r => r.params.layer === -1)).toBe(true);
	});

	it('stops emitting after unsubscribe', () => {
		const records = [];
		ThreeDEffect.addRecordSink(r => records.push(r))();
		TwoDEffect.addRecordSink(r => records.push(r))();
		script();
		expect(records).toHaveLength(0);
	});
});
