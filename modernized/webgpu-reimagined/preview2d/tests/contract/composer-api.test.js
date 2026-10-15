import { describe, it, expect } from 'vitest';
import * as api from '../../src/index.js';
import { fakeCanvasFactory, FakeCanvas } from '../support/FakeCanvas.js';
import { mapFrameSource, spriteRecord, indexedFrame, makePalette } from '../support/fixtures.js';

const composer = () =>
	new api.Preview2DComposer({ canvasFactory: fakeCanvasFactory(), frameSource: mapFrameSource({ f0: indexedFrame() }, { p0: makePalette() }) });

describe('preview2d public API (spec §3.1 entity.renderEntity2D, C-19 baked outputs)', () => {
	it('exports the composer, cursor driver and domain helpers', () => {
		for (const name of ['Preview2DComposer', 'Preview2DTarget', 'CursorDriver', 'VariantCache', 'colorizeFrame', 'computeDrawTransform', 'selectCursorFrame', 'cursorHotspot', 'CURSOR_ACTION']) {
			expect(api[name], name).toBeDefined();
		}
	});

	it('requires its ports (no hidden globals)', () => {
		expect(() => new api.Preview2DComposer({})).toThrow(api.Preview2DError);
		expect(() => new api.CursorDriver({})).toThrow(api.Preview2DError);
	});

	it('bind() replaces the global bind2DContext with an immutable target', () => {
		const ctx = new FakeCanvas(8, 8).getContext('2d');
		const t = composer().bind(ctx, 30, 130);
		expect(t.origin).toEqual([30, 130]);
		expect(Object.isFrozen(t.origin)).toBe(true);
	});

	it('non-sprite records are ignored by drawAll', () => {
		const ctx = new FakeCanvas(8, 8).getContext('2d');
		expect(composer().bind(ctx, 0, 0).drawAll([{ kind: 'effect' }, null])).toBe(0);
	});

	it('secure default: an indexed frame without a palette is skipped instead of crashing (legacy threw)', () => {
		const ctx = new FakeCanvas(8, 8).getContext('2d');
		expect(composer().bind(ctx, 0, 0).draw(spriteRecord({ palette: 'missing' }))).toBe(false);
	});

	it.fails('[C-19] PENDING: bakeGuildPortrait returns getImageData pixels synchronously', () => {
		const out = composer().bakeGuildPortrait({ records: [spriteRecord()], box: 64, cellShift: 10 });
		expect(out.data).toBeInstanceOf(Uint8ClampedArray);
	});

	it.fails('[C-19] PENDING: bakeIcon draws ItemInfo/ItemCompare/CartDecoration/PvPCount records at a fixed origin', () => {
		const ctx = new FakeCanvas(32, 32).getContext('2d');
		expect(composer().bakeIcon({ ctx, origin: [10, 25], records: [spriteRecord()] })).toBe(1);
	});
});
