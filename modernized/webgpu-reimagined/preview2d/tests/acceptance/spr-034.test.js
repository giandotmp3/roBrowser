import { describe, it, expect } from 'vitest';
import { Preview2DComposer } from '../../src/api/Preview2DComposer.js';
import { VariantCache } from '../../src/domain/VariantCache.js';
import { colorizeFrame } from '../../src/domain/colorize.js';
import { computeDrawTransform } from '../../src/domain/DrawTransform.js';
import { createSpriteFrame } from '../../src/domain/SpriteFrame.js';
import { CELL_MIDDLE_Y, MAX_COLOR_VARIANTS, FRAME_TYPE } from '../../src/constants.js';
import { fakeCanvasFactory, FakeCanvas } from '../support/FakeCanvas.js';
import { makePalette, indexedFrame, rgbaFrame, mapFrameSource, spriteRecord } from '../support/fixtures.js';

const setup = (frames, palettes) => {
	const factory = fakeCanvasFactory();
	const composer = new Preview2DComposer({ canvasFactory: factory, frameSource: mapFrameSource(frames, palettes) });
	return { factory, composer };
};

const opsOf = ctx => ctx.ops.filter(op => op[0] !== 'save' && op[0] !== 'restore');

describe('R-SPR-034 2D preview path: colour-variant cache', () => {
	it('[R-SPR-034] caches up to 8 colour variants per (frame, palette), evicting the oldest first', () => {
		const frame = indexedFrame();
		const pal = makePalette();
		const { composer, factory } = setup();
		const first = composer.variantCanvas(frame, pal, [1, 1, 1, 0.1]);
		for (let k = 2; k <= MAX_COLOR_VARIANTS; k++) {
			composer.variantCanvas(frame, pal, [1, 1, 1, k / 10]);
		}
		expect(MAX_COLOR_VARIANTS).toBe(8);
		expect(composer.cache.size(frame, pal)).toBe(8);
		// a hit does not build a new canvas
		const built = factory.created.length;
		expect(composer.variantCanvas(frame, pal, [1, 1, 1, 0.1])).toBe(first);
		expect(factory.created.length).toBe(built);
		// the 9th colour evicts the first-inserted one (FIFO)
		composer.variantCanvas(frame, pal, [0.5, 0.5, 0.5, 1]);
		expect(composer.cache.size(frame, pal)).toBe(8);
		expect(composer.variantCanvas(frame, pal, [1, 1, 1, 0.1])).not.toBe(first);
	});

	it('[R-SPR-034] the cap is per palette: a second palette has its own 8 slots', () => {
		const frame = indexedFrame();
		const palA = makePalette();
		const palB = makePalette();
		const cache = new VariantCache();
		for (let k = 0; k < 8; k++) {
			cache.getOrCreate(frame, palA, [1, 1, 1, k / 8], () => ({}));
			cache.getOrCreate(frame, palB, [1, 1, 1, k / 8], () => ({}));
		}
		expect(cache.size(frame, palA)).toBe(8);
		expect(cache.size(frame, palB)).toBe(8);
	});

	it('[R-SPR-034] RGBA frames share one bucket regardless of palette', () => {
		const frame = rgbaFrame();
		const cache = new VariantCache();
		const a = cache.getOrCreate(frame, makePalette(), [1, 1, 1, 1], () => ({ id: 'a' }));
		const b = cache.getOrCreate(frame, makePalette(), [1, 1, 1, 1], () => ({ id: 'b' }));
		expect(b).toBe(a);
	});

	it('[R-SPR-034] indexed pixels: index 0 transparent, rgb x colour, alpha = 255 x colour.a', () => {
		const px = colorizeFrame(indexedFrame(), makePalette(), [1, 0.5, 1, 0.5]);
		expect(Array.from(px.slice(0, 4))).toEqual([0, 0, 0, 0]);
		// index 1 -> (1, 254, 128) x (1, .5, 1), alpha trunc(127.5) = 127
		expect(Array.from(px.slice(4, 8))).toEqual([1, 127, 128, 127]);
		expect(Array.from(px.slice(12, 16))).toEqual([3, 126, 128, 127]);
	});

	it('[R-SPR-034] RGBA pixels: transparent stays zero, identity copies, otherwise per-channel multiply', () => {
		const f = rgbaFrame();
		expect(Array.from(colorizeFrame(f, null, [1, 1, 1, 1]))).toEqual([0, 0, 0, 0, 200, 100, 50, 255]);
		expect(Array.from(colorizeFrame(f, null, [0.5, 0.5, 0.5, 0.5]))).toEqual([0, 0, 0, 0, 100, 50, 25, 127]);
	});
});

describe('R-SPR-034 2D preview path: transform', () => {
	it('[R-SPR-034] Y is raised 17.5 px for the cell middle and translation is truncated to integers', () => {
		expect(CELL_MIDDLE_Y).toBe(17.5);
		const t = computeDrawTransform({ offset: [3.7, 2], size: [10, 20] }, [30, 130]);
		expect(t.tx).toBe(33);
		expect(t.ty).toBe((130 + 2 - 17.5) | 0); // 114
		expect([t.dx, t.dy, t.dw, t.dh]).toEqual([-5, -10, 10, 20]);
	});

	it('[R-SPR-034] negative size mirrors that axis and draws with the absolute size', () => {
		const t = computeDrawTransform({ size: [-11, 20] }, [0, 0]);
		expect(t.scaleX).toBe(-1);
		expect(t.scaleY).toBe(1);
		expect([t.dx, t.dw]).toEqual([-6, 11]); // -11 >> 1 === -6
		const v = computeDrawTransform({ size: [4, -6] }, [0, 0]);
		expect(v.scaleY).toBe(-1);
	});

	it('[R-SPR-034] a record mirror flag flips X', () => {
		expect(computeDrawTransform({ size: [4, 4], mirror: true }, [0, 0]).scaleX).toBe(-1);
	});

	it('[R-SPR-034] angle in degrees is drawn rotated (radians)', () => {
		expect(computeDrawTransform({ size: [4, 4], angle: 90 }, [0, 0]).rotation).toBeCloseTo(Math.PI / 2, 12);
	});

	it('[R-SPR-034] drawRecord issues save/translate/rotate/scale/drawImage/restore in legacy order', () => {
		const { composer } = setup({ f0: indexedFrame() }, { p0: makePalette() });
		const ctx = new FakeCanvas(64, 64).getContext('2d');
		const drawn = composer.bind(ctx, 10, 25).draw(spriteRecord({ size: [-2, 2], angle: 180, offset: [1, 1] }));
		expect(drawn).toBe(true);
		expect(ctx.ops.map(o => o[0])).toEqual(['save', 'translate', 'rotate', 'scale', 'drawImage', 'restore']);
		const [, tx, ty] = ctx.ops[1];
		expect([tx, ty]).toEqual([11, (26 - 17.5) | 0]);
		expect(ctx.ops[2][1]).toBeCloseTo(Math.PI, 12);
		expect(ctx.ops[3].slice(1)).toEqual([-1, 1]);
		expect(ctx.ops[4].slice(2)).toEqual([0, 0, 2, 2, -1, -1, 2, 2]);
	});

	it('[R-SPR-034] empty frames draw nothing', () => {
		const empty = createSpriteFrame({ type: FRAME_TYPE.RGBA, width: 0, height: 0 });
		const { composer } = setup({ f0: empty }, {});
		const ctx = new FakeCanvas(8, 8).getContext('2d');
		expect(composer.bind(ctx, 0, 0).draw(spriteRecord())).toBe(false);
		expect(opsOf(ctx)).toEqual([]);
	});

	it('[R-SPR-034] records are drawn in the order given (layer order from render-records)', () => {
		const { composer } = setup({ a: indexedFrame(), b: rgbaFrame() }, { p0: makePalette() });
		const ctx = new FakeCanvas(32, 32).getContext('2d');
		const n = composer.bind(ctx, 0, 0).drawAll([spriteRecord({ texture: 'b', offset: [5, 0] }), spriteRecord({ texture: 'a', offset: [9, 0] })]);
		expect(n).toBe(2);
		const xs = ctx.ops.filter(o => o[0] === 'translate').map(o => o[1]);
		expect(xs).toEqual([5, 9]);
	});
});
