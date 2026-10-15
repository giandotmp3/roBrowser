/**
 * ThreeDEffectPlayer / TwoDEffectPlayer: 3D and 2D EffectTable effects into EffectDraw
 * records (R-EFX-003, 011..013). Field-by-field parity with legacy ThreeDEffect and
 * TwoDEffect is proved in the root suite (tests/renderer/RecordDiff.threeDTwoD.test.js).
 */
import { describe, expect, it } from 'vitest';
import {
	BLEND_NORMAL,
	BlendFactor,
	ThreeDEffectPlayer,
	TwoDEffectPlayer,
	effectCurve,
	effectProgress
} from '../../src/index.js';

const textures = file => (file ? { id: file } : null);
const frame = (o = {}) => ({ camera: { yaw: 0, direction: 0 }, sceneFog: { use: true }, textures, ...o });
const three = (spec, o = {}) =>
	new ThreeDEffectPlayer({
		spec,
		position: [10, 20, 0],
		otherPosition: [5, 25, 0],
		startTick: 0,
		endTick: 800,
		rng: () => 0.5,
		...o
	});
const two = (spec, o = {}) =>
	new TwoDEffectPlayer({ spec, position: [10, 20, 0], startTick: 0, endTick: 800, rng: () => 0.5, ...o });

describe('2D / 3D effect players', () => {
	it('progress and curves: linear or log10-smooth, capped at 100 steps', () => {
		expect(effectProgress(400, 0, 800)).toEqual({ elapsed: 400, duration: 800, steps: 50 });
		expect(effectProgress(900, 0, 800).steps).toBe(100);
		expect(effectCurve(0, 10, 50, false)).toBe(5);
		expect(effectCurve(0, 10, 100, true)).toBeCloseTo(10);
		expect(effectCurve(3, 3, 50, true)).toBe(3);
	});

	it('R-EFX-011: blendMode uses the GL-order table (src SRC_ALPHA); 0 and out of range are normal', () => {
		expect(three({ file: 'a', blendMode: 5 }).frame(0, frame())[0].blend).toEqual({
			src: BlendFactor.SRC_ALPHA,
			dst: BlendFactor.DST_COLOR
		});
		expect(two({ file: 'a', size: 10, blendMode: 15 }).frame(0, frame())[0].blend.dst).toBe(
			BlendFactor.SRC_ALPHA_SATURATE
		);
		expect(three({ file: 'a', blendMode: 16 }).frame(0, frame())[0].blend).toBe(BLEND_NORMAL);
		expect(two({ file: 'a', size: 10 }).frame(0, frame())[0].blend).toBe(BLEND_NORMAL);
	});

	it('#49: a non-integer blendMode draws normal alpha (2D and 3D)', () => {
		expect(three({ file: 'a', blendMode: 2.5 }).frame(0, frame())[0].blend).toBe(BLEND_NORMAL);
		expect(two({ file: 'a', size: 10, blendMode: 7.25 }).frame(0, frame())[0].blend).toBe(BLEND_NORMAL);
	});

	it('#47: a plain 3D record is self-contained (fresh SpriteRenderer offset, no palette, own angle / zIndex)', () => {
		const [r] = three({ file: 'a', angle: 20, zIndex: 3 }).frame(400, frame());
		expect(r.params).toMatchObject({ offset: [0, 0], palette: null, paletteSize: null, angle: 20, zIndex: 3, depthBias: 0 });
		expect(r.params.shadowFactor).toBe(1);
	});

	it('R-EFX-012: fades over a quarter of the duration; 3D sparkles, 2D does not', () => {
		const fade = three({ file: 'a', fadeIn: true, fadeOut: true, alphaMax: 0.8 });
		expect(fade.frame(100, frame())[0].color[3]).toBeCloseTo(0.4);
		expect(fade.frame(700, frame())[0].color[3]).toBeCloseTo(0.4);
		expect(fade.frame(0, frame())).toEqual([]);
		expect(three({ file: 'a', sparkling: true, sparkNumber: 1 }).frame(400, frame())[0].color[3]).toBeCloseTo(
			(Math.cos((50 * 11 * Math.PI) / 180) + 1) / 2
		);
		expect(two({ file: 'a', size: 1, sparkling: true }).frame(400, frame())[0].color[3]).toBe(1);
	});

	it('R-EFX-013: overlay drops depth test and correction; only 2D writes depth', () => {
		const depth = r => [r.depthTest, r.depthWrite, r.depthCorrection];
		expect(depth(three({ file: 'a' }).frame(1, frame())[0])).toEqual([true, false, true]);
		expect(depth(three({ file: 'a', overlay: true }).frame(1, frame())[0])).toEqual([false, false, false]);
		expect(depth(two({ file: 'a', size: 1 }).frame(1, frame())[0])).toEqual([true, true, true]);
		expect(depth(two({ file: 'a', size: 1, overlay: true }).frame(1, frame())[0])).toEqual([false, false, false]);
		expect(two({ file: 'a', size: 1 }).frame(1, frame())[0].params.depthBias).toBe(10);
	});

	it('R-EFX-003: open-ended (endTick −1) instances finish after their first frame; nothing before start', () => {
		const open = three({ file: 'a' }, { endTick: -1 });
		expect(open.frame(0, frame())).toHaveLength(1);
		expect(open.finished).toBe(true);
		const late = two({ file: 'a', size: 1 }, { startTick: 100 });
		expect(late.frame(50, frame())).toEqual([]);
		expect(late.finished).toBe(false);
	});

	it('attached effects follow the shared position; fileList cycles every frameDelay ms', () => {
		const position = [1, 2, 3];
		const player = three({ fileList: ['f0', 'f1'], frameDelay: 40 }, { position });
		expect(player.frame(10, frame())[0]).toMatchObject({ texture: { id: 'f0' }, position: [1, 2, 3] });
		position[0] = 7;
		expect(player.frame(50, frame())[0]).toMatchObject({ texture: { id: 'f1' }, position: [7, 2, 3] });
		expect(
			three({ fileList: ['f0', 'missing'] }).frame(10, frame({ textures: f => (f === 'f0' ? {} : null) }))
		).toEqual([]);
	});

	it('2D position offsets rotate with the camera yaw', () => {
		const r = two({ file: 'a', size: 1, posx: 2 }).frame(1, frame({ camera: { yaw: 90, direction: 0 } }))[0];
		expect(r.position[0]).toBeCloseTo(10);
		expect(r.position[1]).toBeCloseTo(22);
	});
});
