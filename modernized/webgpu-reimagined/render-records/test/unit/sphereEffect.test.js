/**
 * SpiritSphereEffect / WarlockSphereEffect: orbiting spheres into EffectDraw records
 * (R-EFX-014). Field-by-field parity with legacy SpiritSphere.js / WarlockSphere.js is
 * proved in the root suite (tests/renderer/RecordDiff.spheres.test.js).
 */
import { describe, expect, it } from 'vitest';
import {
	BLEND_ADDITIVE,
	RecordStream,
	SPHERE_TEXTURE,
	SpiritSphereEffect,
	WarlockSphereEffect,
	sphereLayers
} from '../../src/index.js';

const camera = { angle: [230, 0], zoom: 1.5 };

describe('sphere layers', () => {
	it('i > 10 outer, i > 5 middle, otherwise core then glow', () => {
		expect(sphereLayers(11)).toEqual(['outer']);
		expect(sphereLayers(6)).toEqual(['middle']);
		expect(sphereLayers(5)).toEqual(['core', 'glow']);
		expect(sphereLayers(1)).toEqual(['core', 'glow']);
	});
});

describe('SpiritSphereEffect', () => {
	it('R-EFX-014: additive, depth test without write, no fog; follows the owner', () => {
		const owner = { position: [1, 2, 3] };
		const effect = new SpiritSphereEffect({ num: 2 }, { follow: owner });
		const stream = new RecordStream();
		owner.position = [4, 5, 6];
		const records = effect.frame(0, { camera }, stream);
		expect(stream.records).toEqual(records);
		expect(records).toHaveLength(4);
		for (const r of records) {
			expect(r).toMatchObject({
				family: 'spirit-sphere',
				pass: 'after',
				texture: SPHERE_TEXTURE,
				position: [4, 5, 6],
				depthTest: true,
				depthWrite: false,
				fog: false
			});
			expect(r.blend).toBe(BLEND_ADDITIVE);
		}
		expect(records.map(r => [r.params.index, r.params.layer])).toEqual([
			[2, 'core'],
			[2, 'glow'],
			[1, 'core'],
			[1, 'glow']
		]);
		expect(records[0].params).toMatchObject({ slot: 2, size: 0.25, zIndex: 0.02, cameraZoom: 1.5 });
	});

	it('fades in by 0.005 per drawn frame, clamped to 1; coins use the gold palette', () => {
		const effect = new SpiritSphereEffect({ num: 1, isCoin: true }, { follow: { position: [0, 0, 0] } });
		expect(effect.frame(0, { camera })[0].color).toEqual([1, 0.9, 0.4, 0]);
		expect(effect.frame(0, { camera })[0].color[3]).toBeCloseTo(0.6 * 0.005);
		const full = new SpiritSphereEffect({ num: 1 }, { follow: { position: [0, 0, 0] }, initialAlpha: 0.999 });
		full.frame(0, { camera });
		expect(full.alpha).toBe(1);
	});
});

describe('WarlockSphereEffect', () => {
	it('one sphere per element, spirit look, depth write without test', () => {
		const effect = new WarlockSphereEffect({ spheres: [68, 71] }, { follow: { position: [0, 0, 0] } });
		const records = effect.frame(0, { camera });
		expect(records).toHaveLength(4);
		expect(records[0]).toMatchObject({ family: 'warlock-sphere', depthTest: false, depthWrite: true });
		expect(records[0].color.slice(0, 3)).toEqual([0, 0, 1]);
		expect(new WarlockSphereEffect({}, { follow: { position: [0, 0, 0] } }).frame(0, { camera })).toEqual([]);
	});
});
