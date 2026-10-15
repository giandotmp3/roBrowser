/**
 * DamageComposer unit checks. The field-by-field parity with legacy Damage.js lives in the root
 * suite (tests/renderer/RecordDiff.damage.test.js).
 */
import { describe, expect, it } from 'vitest';
import {
	DamageComposer,
	DamageType as T,
	RecordStream,
	damageGlyphs,
	layoutDamageMessage,
	layoutDamageNumber,
	loadedDamageSkins
} from '../../src/index.js';

const frame = (width, height) => ({ width, height });
const skin = {
	numbers: Array.from({ length: 12 }, (_, i) => frame(8 + (i % 3), 12 + (i % 2))),
	msg: { miss: frame(30, 12), critbg: frame(40, 20) },
	msgBlue: { miss: frame(30, 12), critbg: frame(36, 18) },
	scale: [1, 1]
};
const target = { gid: 7, position: [10, 10, 0] };
const compose = (opts = {}) => new DamageComposer({ skins: { 0: skin }, packetver: 20250101, ...opts });
const emit = (composer, tick) => {
	const stream = new RecordStream();
	composer.emit(stream, tick);
	return stream.records;
};

describe('DamageComposer', () => {
	it('R-DMG-007: number layout pads 2 px, centres glyphs, POT×DPR canvas', () => {
		const layout = layoutDamageNumber(damageGlyphs('10K'), skin.numbers, 2);
		// widths 9 + 8 + 9 (+2 each) = 32 → POT 32, height 13 → 16; × DPR 2
		expect([layout.width, layout.height]).toEqual([64, 32]);
		expect(layout.placements).toEqual([
			{ glyph: 1, x: 16, y: 9 },
			{ glyph: 0, x: 27, y: 9 },
			{ glyph: 10, x: 37, y: 9 }
		]);
		expect(layoutDamageMessage(frame(30, 12))).toEqual({ width: 32, height: 16, x: 1, y: 2 });
	});

	it('R-DMG-007/008: texture key names sheet, skin and text; suffix; old PACKETVER loads skin 0', () => {
		const composer = compose({ enableDmgSuffix: true });
		composer.add({ amount: 1234567.9, entity: target, tick: 0 });
		expect(emit(composer, 10)[0].texture).toBe('damage/num/0/1234K');
		expect(loadedDamageSkins(20211103)).toEqual([0]);
		expect(loadedDamageSkins(20220821)).toEqual([0, 1, 2, 3]);
	});

	it('R-DMG-004 FIX: a miss leaves the list at 800 ms; depthBias is the live list index (R-DMG-009)', () => {
		const composer = compose();
		composer.add({ amount: 0, entity: target, tick: 0 });
		composer.add({ amount: 5, entity: target, tick: 0 });
		expect(emit(composer, 400).map(r => r.depthBias)).toEqual([0, 1]);
		expect(emit(composer, 800).map(r => r.texture)).toEqual(['damage/num/0/5']); // miss alpha 0
		const after = emit(composer, 801);
		expect(after.map(r => [r.texture, r.depthBias])).toEqual([['damage/num/0/5', 0]]);
		expect(composer.size).toBe(1);
	});

	it('R-DMG-006: a crit adds the grey background first and returns the hit effect', () => {
		const composer = compose();
		const { effects } = composer.add({ amount: 9, entity: target, tick: 0, type: T.CRIT });
		expect(effects).toEqual([{ effectId: 1, ownerAID: 7, position: target.position, startTick: 0 }]);
		const [bg, num] = emit(composer, 0);
		expect(bg.texture).toBe('damage/msg/0/critbg');
		expect(bg.offset).toEqual([0, -6]);
		expect(bg.size).toEqual([64 * 0.6 * 4, 32 * 0.6 * 4]);
		expect(num.color).toEqual([0.9, 0.9, 0.15, 1]);
		expect([bg.depthTest, bg.depthWrite, bg.depthCorrection]).toEqual([false, false, false]);
	});

	it('R-DMG-008: Invi suppresses and makes later draws lose the ACT scale of the drawn skin', () => {
		const composer = new DamageComposer({ skins: { 0: { ...skin, scale: [2, 2] } }, packetver: 20211103 });
		composer.add({ amount: 1, entity: target, tick: 0 });
		const before = emit(composer, 0)[0].size;
		composer.add({ amount: 2, entity: target, tick: 0 }, { damageSkin: 3 });
		expect(composer.size).toBe(1);
		expect(emit(composer, 0)[0].size).toEqual([before[0] / 2, before[1] / 2]);
	});
});
