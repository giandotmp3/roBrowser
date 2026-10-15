/**
 * Level-99 aura stack (R-EFX-015) into EffectDraw records: GroundAuraEffect (EF_LEVEL99_2),
 * SwirlingAuraEffect (EF_LEVEL99) and Level99BubbleEffect (EF_LEVEL99_3), all additive
 * (R-EFX-014). Field-by-field parity with legacy GroundAura.js, SwirlingAura.js and
 * Level99Bubble.js is proved in the root suite (tests/renderer/RecordDiff.auras.test.js).
 */
import { describe, expect, it } from 'vitest';
import {
	BLEND_ADDITIVE,
	GroundAuraEffect,
	Level99BubbleEffect,
	RecordStream,
	SWIRL_ALPHA,
	SWIRL_DIVISIONS,
	SWIRL_INDICES,
	SwirlingAuraEffect,
	groundAuraSizeStep,
	level99Auras,
	level99BubbleAlpha,
	level99BubbleVariant,
	swirlingAuraHeights
} from '../../src/index.js';

const flat = () => 0.5;
const seq = values => {
	let i = 0;
	return () => values[i++ % values.length];
};

describe('aura stack selection (R-EFX-015)', () => {
	it('preference 1 shows only the bubbles, 2 the full stack', () => {
		expect(level99Auras({ auraPref: 1, baseLevel: 99, visible: true })).toEqual(['EF_LEVEL99_3']);
		expect(level99Auras({ auraPref: 2, baseLevel: 99, visible: true })).toHaveLength(3);
	});
});

describe('GroundAuraEffect', () => {
	it('two additive rings flat on the ground, lifted 0.05, depth test without write', () => {
		const owner = { position: [10, 20, 3] };
		const effect = new GroundAuraEffect(
			{ size: 100, distance: 15, textureName: 'pikapika2.bmp' },
			{ position: owner.position, startTick: 1000, follow: owner, effectId: 201 }
		);
		const stream = new RecordStream();
		const records = effect.frame(1000, { heightAt: flat, sceneFog: { use: true } }, stream);
		expect(stream.records).toEqual(records);
		expect(records.map(r => r.params.ring)).toEqual([0, 1]);
		for (const r of records) {
			expect(r).toMatchObject({
				kind: 'effect',
				family: 'groundAura',
				pass: 'before',
				texture: 'data/texture/effect/pikapika2.bmp',
				position: [10, 20, 0.55],
				color: [1, 1, 1, 0.8],
				depthTest: true,
				depthWrite: false,
				fog: true
			});
			expect(r.blend).toBe(BLEND_ADDITIVE);
		}
		// inner ring starts at size + distance, outer at size + 2·distance
		expect(records[0].params.size).toEqual([115, 115]);
		expect(records[1].params.size).toEqual([130, 130]);
		expect(records[1].params.angle).toBeCloseTo((23 * Math.PI) / 180);
	});

	it('pulses on whole 25 ms ticks, opposite directions, dt capped at 250 ms', () => {
		const effect = new GroundAuraEffect({ size: 100, distance: 15, textureName: 'a' }, { position: [0, 0, 0], startTick: 1000 });
		effect.frame(1010, { heightAt: flat });
		expect(effect.rings[0].riseAngle).toBe(0);
		effect.frame(1030, { heightAt: flat });
		expect(effect.rings[0].riseAngle).toBe(3);
		expect(effect.rings[0].size[0]).toBeGreaterThan(115);
		expect(effect.rings[1].size[0]).toBeLessThan(130);
		effect.frame(5000, { heightAt: flat });
		expect(effect.rings[0].riseAngle).toBe(33);
	});

	it('#55: a frame before the start tick does not run the pulse backwards (dt clamped to [0, 250])', () => {
		const early = new GroundAuraEffect({ size: 100, distance: 15, textureName: 'a' }, { position: [0, 0, 0], startTick: 1000 });
		const plain = new GroundAuraEffect({ size: 100, distance: 15, textureName: 'a' }, { position: [0, 0, 0], startTick: 1000 });
		early.frame(400, { heightAt: flat });
		expect(early.accum).toBe(0);
		expect(early.lastTick).toBe(1000);
		for (const tick of [1030, 1060, 1500]) {
			expect(early.frame(tick, { heightAt: flat })).toEqual(plain.frame(tick, { heightAt: flat }));
		}
		expect(early.rings[0].riseAngle).toBeGreaterThan(0);
	});

	it('keeps legacy degree-as-radian size maths', () => {
		const [w, h] = groundAuraSizeStep(15, 3, 0);
		const reach = 15 * 0.8 + 1.5 * (Math.sin(3) + 1);
		expect(w).toBeCloseTo(Math.abs(Math.cos(90) - Math.cos(0)) * reach);
		expect(h).toBeCloseTo(Math.abs(Math.sin(270) - Math.sin(180)) * reach);
	});
});

describe('SwirlingAuraEffect', () => {
	it('three additive bands, blue unless sizeType 7', () => {
		const effect = new SwirlingAuraEffect({ textureName: 'ring_blue.tga' }, { position: [4, 6, 0], startTick: 0 });
		const records = effect.frame(500, { heightAt: flat, sceneFog: { use: false } });
		expect(records.map(r => r.params.band)).toEqual([0, 1, 2]);
		expect(records[0]).toMatchObject({
			family: 'swirlingAura',
			pass: 'before',
			position: [4.5, -0.5, 6.5],
			color: [100 / 255, 100 / 255, 1, SWIRL_ALPHA],
			depthTest: true,
			depthWrite: false,
			fog: false
		});
		expect(records[0].blend).toBe(BLEND_ADDITIVE);
		expect(records[2].params.zIndex).toBeCloseTo(0.012);
		expect(records[0].params.vertices).toHaveLength(SWIRL_DIVISIONS * 2 * 5);
		expect(records[0].params.indexCount).toBe(SWIRL_INDICES.length);
		const green = new SwirlingAuraEffect({ textureName: 'a', sizeType: 7 }, { position: [0, 0, 0], startTick: 0 });
		expect(green.frame(0, { heightAt: flat })[0].color.slice(0, 3)).toEqual([100 / 255, 1, 100 / 255]);
	});

	it('bands spin 3/4/5° per game tick and rise over 90 game ticks', () => {
		const effect = new SwirlingAuraEffect({ textureName: 'a' }, { position: [0, 0, 0], startTick: 0 });
		const records = effect.frame(250, { heightAt: flat });
		expect(records.map(r => r.params.rotStart)).toEqual([30, 130, 230]);
		const early = swirlingAuraHeights(1, 45);
		const full = swirlingAuraHeights(1, 200);
		expect(early[10]).toBeCloseTo(Math.SQRT1_2);
		expect(full[10]).toBeCloseTo(1);
		expect(swirlingAuraHeights(1, -10)[10]).toBe(0);
	});
});

describe('Level99BubbleEffect', () => {
	it('variants: blue two passes, ghost one column, white small', () => {
		expect(level99BubbleVariant(1)).toMatchObject({ passCount: 2, columns: 4, radius: 2.4 });
		expect(level99BubbleVariant(11)).toMatchObject({ ghost: true, columns: 1, resetY: -60, fallSpeed: 0.6 });
		expect(level99BubbleVariant(0)).toMatchObject({ passCount: 1, radius: 0.8, color: [1, 1, 1] });
	});

	it('alpha fades in below the ground line', () => {
		expect(level99BubbleAlpha(0)).toBeCloseTo(250 / 255);
		expect(level99BubbleAlpha(-25)).toBeCloseTo(100 / 255);
		expect(level99BubbleAlpha(-30)).toBe(0);
	});

	it('anchors spawn above ground (not drawn) and fall into view; draws are additive', () => {
		// every draw 0: anchors spawn at y 0, phases 0
		const effect = new Level99BubbleEffect({}, { position: [1, 2, 0], startTick: 1000 }, { rng: () => 0 });
		expect(effect.texture).toBe('data/texture/effect/whitelight.tga');
		expect(effect.frame(1000, { heightAt: flat, cameraAngle: [230, 0] })).toHaveLength(32);
		const records = effect.frame(1250, { heightAt: flat, cameraAngle: [230, 0], sceneFog: { use: true } });
		expect(records).toHaveLength(32);
		expect(records[0]).toMatchObject({ family: 'level99Bubble', pass: 'before', depthTest: true, depthWrite: false, fog: true });
		expect(records[0].blend).toBe(BLEND_ADDITIVE);
		expect(records[0].params.quad).toHaveLength(30);
		expect(records.map(r => r.params.pass)).toEqual(Array.from({ length: 32 }, (_, i) => i % 2));
		// an anchor spawned above ground is skipped until it falls below 0
		const high = new Level99BubbleEffect({ flag1: 0 }, { position: [0, 0, 0], startTick: 1000 }, { rng: seq([0.5]) });
		expect(high.frame(1025, { heightAt: flat, cameraAngle: [230, 0] })).toHaveLength(0);
	});

	it('#53: a start tick of 0 seeds the frame clock at the spawn frame, not Date.now()', () => {
		const zero = new Level99BubbleEffect({ flag1: 0 }, { position: [0, 0, 0], startTick: 0 }, { rng: seq([0.3, 0.7, 0.1]) });
		const timed = new Level99BubbleEffect({ flag1: 0 }, { position: [0, 0, 0], startTick: 5000 }, { rng: seq([0.3, 0.7, 0.1]) });
		const at = tick => ({ heightAt: flat, cameraAngle: [230, (tick / 7) % 360] });
		let drawn = 0;
		for (let tick = 5000; tick <= 25000; tick += 250) {
			const records = zero.frame(tick, at(tick));
			expect(records).toEqual(timed.frame(tick, at(tick)));
			drawn += records.length;
		}
		expect(drawn).toBeGreaterThan(0);
	});

	it('#55: a frame before the start tick neither steps the bubbles nor draws randomness', () => {
		let draws = 0;
		const rng = () => (draws++ % 7) / 7;
		const effect = new Level99BubbleEffect({ flag1: 0 }, { position: [0, 0, 0], startTick: 1000 }, { rng });
		const before = JSON.stringify(effect.columns.map(c => c.anchors));
		const consumed = draws;
		effect.frame(600, { heightAt: flat, cameraAngle: [230, 0] });
		expect(draws).toBe(consumed);
		expect(JSON.stringify(effect.columns.map(c => c.anchors))).toBe(before);
		expect(effect.lastTick).toBe(1000);
		effect.frame(1100, { heightAt: flat, cameraAngle: [230, 0] });
		expect(draws).toBeGreaterThan(consumed);
	});
});
