/**
 * CylinderEffect / QuadHornEffect: EffectTable 'CYLINDER' and 'QuadHorn' into EffectDraw
 * records (R-EFX-003, R-EFX-011). Field-by-field parity with legacy Cylinder.js and
 * QuadHorn.js is proved in the root suite (tests/renderer/RecordDiff.cylinder.test.js,
 * tests/renderer/RecordDiff.quadHorn.test.js).
 */
import { describe, expect, it } from 'vitest';
import {
	BLEND_NORMAL,
	BlendFactor,
	CylinderEffect,
	QUADHORN_VERTEX_COUNT,
	QuadHornEffect,
	RecordStream,
	cylinderAlpha,
	cylinderMesh,
	cylinderShape
} from '../../src/index.js';

const shape = { topSize: 2, bottomSize: 1, height: 4 };

describe('CylinderEffect', () => {
	it('animation modes shape the cylinder over time', () => {
		expect(cylinderShape({ ...shape, animation: 1, elapsed: 500, duration: 3000 }).height).toBe(2);
		expect(cylinderShape({ ...shape, animation: 1, elapsed: 1500, duration: 3000 }).height).toBe(4);
		expect(cylinderShape({ ...shape, animation: 2, elapsed: 100, duration: 400 }).topSize).toBe(0.5);
		expect(cylinderShape({ ...shape, animation: 3, elapsed: 200, duration: 800 })).toEqual({ topSize: 1.5, bottomSize: 0.75, height: 2 });
		expect(cylinderShape({ ...shape, animation: 3, elapsed: 400, duration: 800 }).height).toBe(4);
		expect(cylinderShape({ ...shape, animation: 4, elapsed: -100, duration: 400 })).toEqual({ topSize: 0, bottomSize: 0, height: 4 });
		expect(cylinderShape({ ...shape, animation: 5, elapsed: 600, duration: 800 }).height).toBe(2);
		expect(cylinderShape({ ...shape, animation: 0, elapsed: 600, duration: 800 })).toEqual(shape);
	});

	it('fade ramps over the first and last quarter, unclamped', () => {
		expect(cylinderAlpha({ fade: true, elapsed: 100, duration: 800, alphaMax: 0.8 })).toBeCloseTo(0.4);
		expect(cylinderAlpha({ fade: true, elapsed: 400, duration: 800, alphaMax: 0.8 })).toBe(0.8);
		expect(cylinderAlpha({ fade: true, elapsed: 900, duration: 800, alphaMax: 0.8 })).toBeLessThan(0);
		expect(cylinderAlpha({ fade: false, elapsed: 900, duration: 800, alphaMax: 0.8 })).toBe(0.8);
	});

	it('R-EFX-011: GL-order blend, depth test without write, scene fog; one record per frame', () => {
		const effect = new CylinderEffect(
			{ textureName: 'ring', topSize: 1, bottomSize: 1, height: 2, blendMode: 5, posZ: 1, zIndex: 2 },
			{ position: [3, 4, 0], startTick: 0, endTick: 1000 }
		);
		const stream = new RecordStream();
		const r = effect.frame(500, { sceneFog: { use: true } }, stream);
		expect(stream.records).toEqual([r]);
		expect(r).toMatchObject({
			kind: 'effect',
			family: 'cylinder',
			pass: 'after',
			texture: 'data/texture/effect/ring.tga',
			position: [3, 4, 1],
			color: [1, 1, 1, 1],
			depthTest: true,
			depthWrite: false,
			fog: true
		});
		expect(r.blend).toEqual({ src: BlendFactor.SRC_ALPHA, dst: BlendFactor.DST_COLOR });
		expect(r.params).toMatchObject({ rotate: false, zIndex: 2, vertexCount: 20 * 6 + 3, textureRepeat: false });
		expect(new CylinderEffect({ blendMode: 0 }, { position: [0, 0, 0], startTick: 0, endTick: 1 }).blend).toBe(BLEND_NORMAL);
	});

	it('R-EFX-003: finished once endTick < tick (an open-ended instance draws one frame)', () => {
		const timed = new CylinderEffect({}, { position: [0, 0, 0], startTick: 0, endTick: 100 });
		timed.frame(100);
		expect(timed.finished).toBe(false);
		timed.frame(101);
		expect(timed.finished).toBe(true);
		const open = new CylinderEffect({}, { position: [0, 0, 0], startTick: 0, endTick: -1 });
		open.frame(0);
		expect(open.finished).toBe(true);
	});

	it('meshes are shared by key; a partial ring spans the texture over the drawn sides', () => {
		expect(cylinderMesh(12, 6, 3)).toBe(cylinderMesh(12, 6, 3));
		const half = cylinderMesh(12, 6, 1);
		expect(half.length / 5).toBe(6 * 6 + 3);
		expect(half[5 * 6 + 3]).toBeCloseTo((1 / 12) * 2);
	});

	it('follows the attached entity and spins with rotate', () => {
		const entity = { position: [1, 1, 0] };
		const effect = new CylinderEffect({ rotate: true }, { position: entity.position, startTick: 0, endTick: 9999, follow: entity });
		entity.position = [5, 6, 7];
		const r = effect.frame(360);
		expect(r.position).toEqual([5, 6, 7]);
		expect(r.params.rotate).toBe(true);
		// 360 ms → 90° around Y
		expect(r.params.rotation[0]).toBeCloseTo(0);
		expect(r.params.rotation[8]).toBeCloseTo(1);
	});
});

describe('QuadHornEffect', () => {
	const rngOf = values => () => values.shift();

	it('legacy defaults: blendMode 0 → ZERO, offsetZ 0 → 0.5, offsetX 0 kept', () => {
		const effect = new QuadHornEffect({ textureFile: 'effect/ice.tga', blendMode: 0, offsetX: 0, offsetZ: 0 }, { position: [0, 0, 0], startTick: 0, endTick: 100 });
		const r = effect.frame(0);
		expect(r.blend).toEqual({ src: BlendFactor.SRC_ALPHA, dst: BlendFactor.ZERO });
		expect(r.params).toMatchObject({ offsetX: 0, offsetY: 0.5, offsetZ: 0.5, blendMode: 1, vertexCount: QUADHORN_VERTEX_COUNT });
		expect(r).toMatchObject({ family: 'quadhorn', pass: 'before', texture: 'data/texture/effect/ice.tga', depthWrite: true });
	});

	it('ranges round to 3 decimals in legacy order', () => {
		const effect = new QuadHornEffect({ height: [2, 3], rotateY: [0, 360] }, { position: [0, 0, 0], startTick: 0, endTick: 1 }, { rng: rngOf([0.12345, 0.5]) });
		expect(effect.height).toBe(2.123);
		expect(effect.rotateY).toBe(180);
	});

	it('grow intro then sink below ground after endTick, then finished', () => {
		const effect = new QuadHornEffect(
			{ animation: 1, animationSpeed: 100, height: 1, offsetZ: 0.5, animationOut: true },
			{ position: [0, 0, 0], startTick: 0, endTick: 500 }
		);
		expect(effect.frame(50).params).toMatchObject({ step: 'grow', height: 0.5 });
		expect(effect.frame(200).params).toMatchObject({ step: 'grow', height: 1 });
		expect(effect.frame(300).params.step).toBeNull();
		const sink = effect.frame(550);
		expect(sink.params.sinkOffsetZ).toBeCloseTo(-0.5);
		expect(effect.finished).toBe(false);
		effect.frame(700);
		expect(effect.finished).toBe(true);
	});

	it('fadeOut scales alpha over the last fadeOut ms of a timed instance only', () => {
		const timed = new QuadHornEffect({ fadeOut: 200, color: [1, 1, 1, 0.8] }, { position: [0, 0, 0], startTick: 0, endTick: 1000 });
		expect(timed.frame(900).color[3]).toBeCloseTo(0.4);
		const open = new QuadHornEffect({ fadeOut: 200, color: [1, 1, 1, 0.8] }, { position: [0, 0, 0], startTick: 0, endTick: -1 });
		expect(open.frame(900).color[3]).toBe(0.8);
		expect(open.finished).toBe(false);
	});
});
