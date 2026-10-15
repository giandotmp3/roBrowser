/**
 * PropertyGroundEffect / MagicRingEffect into EffectDraw records. Field-by-field parity
 * with legacy PropertyGround.js / MagicRing.js is proved in the root suite
 * (tests/renderer/RecordDiff.groundRings.test.js).
 */
import { describe, expect, it } from 'vitest';
import {
	BLEND_NORMAL,
	MagicRingEffect,
	PropertyGroundEffect,
	RING_CONE_VERTEX_COUNT,
	RecordStream,
	propertyGroundPulse,
	propertyGroundRotation,
	ringConeMesh
} from '../../src/index.js';

const spec = { topSize: 3, bottomSize: 1, height: 2, texture: 'ring_red' };

describe('ring cone mesh', () => {
	it('20 sides plus the degenerate extra triangle', () => {
		const mesh = ringConeMesh();
		expect(mesh.length).toBe(RING_CONE_VERTEX_COUNT * 5);
		// last triangle: bottom[20], top[20], top[20]
		expect(mesh.slice(-10, -5)).toEqual(mesh.slice(-5));
	});
});

describe('PropertyGroundEffect', () => {
	it('pulse floors at 0.5; slots are 22.5° apart and spin tick/8 degrees', () => {
		expect(propertyGroundPulse(0, -1)).toBe(0.5);
		expect(propertyGroundPulse(0, Math.PI / 2)).toBe(1);
		expect(propertyGroundRotation(4, 0)[0]).toBeCloseTo(0);
		expect(propertyGroundRotation(0, 720)[0]).toBeCloseTo(0);
	});

	it('after pass, normal alpha, alpha 0.42, scene fog; one random phase per spawn', () => {
		const effect = new PropertyGroundEffect(spec, { position: [1, 2, 0], index: 17 }, { rng: () => Math.PI / 20 });
		const stream = new RecordStream();
		const r = effect.frame(0, { sceneFog: { use: true } }, stream);
		expect(stream.records).toEqual([r]);
		expect(r).toMatchObject({
			family: 'property-ground',
			pass: 'after',
			texture: 'data/texture/effect/ring_red.tga',
			color: [1, 1, 1, 0.42],
			depthTest: true,
			depthWrite: true,
			fog: true
		});
		expect(r.blend).toBe(BLEND_NORMAL);
		expect(r.params).toMatchObject({ slot: 1, sizeMult: 1, topSize: 3, bottomSize: 1, height: 2 });
	});
});

describe('MagicRingEffect', () => {
	it('follows the caster and finishes after endTick or when the cast bar hides', () => {
		const caster = { position: [5, 6, 7], cast: { display: true } };
		const effect = new MagicRingEffect(spec, { follow: caster, endTick: 1000 });
		expect(effect.frame(1000).position).toEqual([5, 6, 7]);
		expect(effect.finished).toBe(false);
		caster.cast.display = false;
		const last = effect.frame(1001);
		expect(last).toMatchObject({ family: 'magic-ring', color: [1, 1, 1, 0.7], pass: 'after' });
		expect(effect.finished).toBe(true);
	});
});
