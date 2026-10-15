/**
 * LockOnEffect / MagicTargetEffect into EffectDraw records. Field-by-field parity with
 * legacy LockOnTarget.js / MagicTarget.js is proved in the root suite
 * (tests/renderer/RecordDiff.targetMarkers.test.js).
 */
import { describe, expect, it } from 'vitest';
import {
	BLEND_NORMAL,
	LOCK_ON_TEXTURE,
	LockOnEffect,
	MAGIC_TARGET_TEXTURE,
	MagicTargetEffect,
	RecordStream,
	lockOnShade,
	lockOnSize
} from '../../src/index.js';

describe('LockOnEffect', () => {
	it('blinks red every 400 ms and shrinks from 15 to 3 over 50–250 ms', () => {
		expect(lockOnShade(0)).toBe(1);
		expect(lockOnShade(390)).toBeCloseTo(0.05);
		expect(lockOnShade(400)).toBe(1);
		expect(lockOnShade(-30)).toBeCloseTo(1.1);
		expect(lockOnSize(0)).toBe(15);
		expect(lockOnSize(150)).toBe(9);
		expect(lockOnSize(1000)).toBe(3);
	});

	it('follows the target, before pass, normal alpha, scene fog; finished after endTick', () => {
		const target = { position: [1, 2, 3] };
		const effect = new LockOnEffect({ follow: target, startTick: 0, endTick: 100 });
		const stream = new RecordStream();
		const r = effect.frame(100, { sceneFog: { use: true } }, stream);
		expect(stream.records).toEqual([r]);
		expect(r).toMatchObject({
			family: 'lock-on',
			pass: 'before',
			texture: LOCK_ON_TEXTURE,
			position: [1, 2, 3],
			color: [1, 0.75, 0.75, 1],
			depthTest: true,
			depthWrite: true,
			fog: true
		});
		expect(r.blend).toBe(BLEND_NORMAL);
		expect(effect.finished).toBe(false);
		effect.frame(101);
		expect(effect.finished).toBe(true);
	});
});

describe('MagicTargetEffect', () => {
	it('area size from the CastSize row; size² · 6 vertices; camera latitude carried', () => {
		const effect = new MagicTargetEffect({ sizes: [3, 5, 7] }, { x: 4.5, y: 6.5, endTick: -1, skillLevel: 2 });
		const r = effect.frame(0, { cameraLatitude: 50 });
		expect(r).toMatchObject({ family: 'magic-target', texture: MAGIC_TARGET_TEXTURE, position: [4.5, 6.5, 0] });
		expect(r.params).toMatchObject({ size: 5, vertexCount: 150, cameraLatitude: 50 });
		expect(effect.finished).toBe(true);
	});
});
