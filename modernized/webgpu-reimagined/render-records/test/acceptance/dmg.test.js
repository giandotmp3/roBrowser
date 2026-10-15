/**
 * C-10 damage numbers: R-DMG-001..009 (R-DMG-004 and R-DMG-009 assert the fix).
 */
import { describe, expect, it } from 'vitest';
import {
	DamageType as T,
	RecordStream,
	comboVisible,
	critBackground,
	damageColor,
	damageLifetime,
	damageMotion,
	effectiveSkin,
	emitDamageRecords,
	formatDamage,
	shouldDisplayDamage
} from '../../src/index.js';

const at = (type, elapsed, extra = {}) => damageMotion({ type, elapsed, entityPosition: [10, 10, 0], ...extra });

describe('C-10 damage numbers', () => {
	it('R-DMG-001: lifetime 1500 ms (combo 3000), colours, alpha = 1 − elapsed/delay', () => {
		expect(damageLifetime(T.DAMAGE)).toBe(1500);
		expect(damageLifetime(T.COMBO)).toBe(3000);
		// Legacy picks the colour and the combo delay in one chain: a combo on a PC is red, 1500 ms.
		expect(damageLifetime(T.COMBO | T.ENEMY)).toBe(1500);
		expect(damageColor(T.COMBO | T.ENEMY)).toEqual([1, 0, 0, 1]);
		expect(damageColor(T.DAMAGE | T.SP)).toEqual([0.13, 0.19, 0.75, 1]);
		expect(damageColor(T.HEAL)).toEqual([0, 1, 0, 1]);
		expect(damageColor(T.DAMAGE | T.ENEMY)).toEqual([1, 0, 0, 1]);
		expect(damageColor(T.CRIT)).toEqual([0.9, 0.9, 0.15, 1]);
		expect(damageColor(T.COMBO)).toEqual([0.9, 0.9, 0.15, 1]);
		expect(damageColor(T.DAMAGE)).toEqual([1, 1, 1, 1]);
		expect(at(T.DAMAGE, 750).alpha).toBeCloseTo(0.5);
	});

	it('R-DMG-002: normal hit motion and damageMotion variants', () => {
		const m = at(T.DAMAGE, 750);
		expect(m.position[0]).toBeCloseTo(12);
		expect(m.position[1]).toBeCloseTo(8);
		expect(m.position[2]).toBeCloseTo(2 + 5 * Math.sin(-Math.PI / 2 + Math.PI * 1.25));
		expect(m.scale).toBeCloseTo(2);
		expect(at(T.DAMAGE, 750, { damageMotion: 1 }).position.slice(0, 2)).toEqual([8, 10]);
		expect(at(T.DAMAGE, 750, { damageMotion: 2 }).position.slice(0, 2)).toEqual([10, 10]);
		expect(at(T.DAMAGE, 750, { damageMotion: 3 }).position.slice(0, 2)).toEqual([12, 10]);
	});

	it('R-DMG-003: heal motion', () => {
		const early = at(T.HEAL, 300);
		expect(early.scale).toBeCloseTo(1.8);
		expect(early.position[2]).toBeCloseTo(2);
		const late = at(T.HEAL, 900);
		expect(late.scale).toBeCloseTo(0.8);
		expect(late.position[2]).toBeCloseTo(3);
	});

	it('R-DMG-004 FIX (legacy kept an invisible Miss alive until 1500 ms): Miss/Lucky live 800 ms', () => {
		expect(damageLifetime(T.MISS)).toBe(800);
		expect(damageLifetime(T.LUCKY)).toBe(800);
		const m = at(T.MISS, 400);
		expect(m).toMatchObject({ scale: 0.5 });
		expect(m.alpha).toBeCloseTo(0.5);
		expect(m.position[2]).toBeCloseTo(7);
		const stream = new RecordStream();
		emitDamageRecords(stream, [{ type: T.MISS, startTick: 0, gid: 1, entityPosition: [0, 0, 0] }], 1000);
		expect(stream.records).toHaveLength(0);
		expect(shouldDisplayDamage(T.MISS, { miss: false })).toBe(false);
		expect(shouldDisplayDamage(T.MISS, { miss: true })).toBe(true);
	});

	it('R-DMG-005: combo title scale/z; only newest per entity; non-final hidden after 15 %', () => {
		const c = at(T.COMBO, 60);
		expect(c.scale).toBeCloseTo(0.02 * 70);
		expect(c.position[2]).toBeCloseTo(7.02);
		expect(at(T.COMBO, 1500).scale).toBeCloseTo(3.5);
		const newest = new Map([[1, 500]]);
		expect(comboVisible({ type: T.COMBO, startTick: 100, gid: 1 }, 0.01, newest)).toBe(false);
		expect(comboVisible({ type: T.COMBO, startTick: 500, gid: 1 }, 0.2, newest)).toBe(false);
		expect(comboVisible({ type: T.COMBO | T.COMBO_FINAL, startTick: 500, gid: 1 }, 0.2, newest)).toBe(true);
	});

	it('R-DMG-006: critical background', () => {
		expect(critBackground(T.DAMAGE)).toBeNull();
		expect(critBackground(T.CRIT)).toEqual({
			sprite: 'critbg',
			sheet: 'msg',
			name: 'critbg',
			type: T.CRIT,
			scale: 0.6,
			color: [0.66, 0.66, 0.66, 1],
			offset: [0, -6],
			spawnEffectId: 1
		});
		// Blue combos (COMBO_B) use bluemsg's critbg, keep the combo type and spawn no effect.
		expect(critBackground(T.COMBO_B | T.COMBO_FINAL)).toMatchObject({
			sprite: 'bluemsg',
			sheet: 'msgBlue',
			type: T.COMBO_B | T.COMBO_FINAL,
			spawnEffectId: null
		});
		// Legacy precedence: CRIT wins over COMBO_B; a crit on a PC (ENEMY) has no background.
		expect(critBackground(T.CRIT | T.COMBO_B).sprite).toBe('critbg');
		expect(critBackground(T.CRIT | T.ENEMY)).toBeNull();
	});

	it('R-DMG-007: value floored, negatives ignored, K/M suffix', () => {
		expect(formatDamage(12.7)).toBe('12');
		expect(formatDamage(-5)).toBeNull();
		expect(formatDamage(123456789)).toBe('123456789');
		expect(formatDamage(123456789, { enableDmgSuffix: true })).toBe('123M');
		expect(formatDamage(1234567, { enableDmgSuffix: true })).toBe('1234K');
		expect(formatDamage(999999, { enableDmgSuffix: true })).toBe('999999');
	});

	it('R-DMG-008: skins; Invi suppresses; old PACKETVER forces skin 0', () => {
		expect(effectiveSkin(2, 20220101)).toEqual({ skin: 0, suppressed: false });
		expect(effectiveSkin(2, 20220821)).toEqual({ skin: 2, suppressed: false });
		expect(effectiveSkin(3, 20230101)).toEqual({ skin: 3, suppressed: true });
		// Legacy tests Invi before forcing skin 0 (Damage.js:271-279).
		expect(effectiveSkin(3, 20220101)).toEqual({ skin: 3, suppressed: true });
		expect(shouldDisplayDamage(T.DAMAGE, { skin: 3, packetver: 20230101 })).toBe(false);
	});

	it('R-DMG-009 FIX (legacy leaked SpriteRenderer.depth): depth bias is per record, depth test off', () => {
		const stream = new RecordStream();
		emitDamageRecords(
			stream,
			[
				{ type: T.DAMAGE, startTick: 0, gid: 1, entityPosition: [0, 0, 0] },
				{ type: T.DAMAGE, startTick: 0, gid: 2, entityPosition: [1, 1, 0] }
			],
			100
		);
		const after = stream.sprite({});
		const [a, b] = stream.records;
		expect([a.depthBias, b.depthBias]).toEqual([0, 1]);
		expect(a.depthTest).toBe(false);
		expect(after.depthBias).toBe(0);
	});
});
