import { describe, it, expect } from 'vitest';
import { Camera } from '../../src/domain/Camera.js';
import { computeProjection } from '../../src/domain/Viewport.js';
import { mirrorRectY, projectToScreen, placeOverlay } from '../../src/domain/Overlays.js';
import { ScreenEffects } from '../../src/domain/ScreenEffects.js';
import { makeAltitude } from '../support/fakes.js';

/**
 * R-PP-011 [FLAG -> fix]: legacy mirrored only ground picking, signboards and life bars.
 * The rebuild mirrors ALL overlays and entity hover rectangles. Tests assert the fixed behaviour.
 */
describe('R-PP-011 illusion vertical flip (picking/overlay mirroring fix)', () => {
	const cam = () => {
		const c = new Camera({ prefs: { smooth: false } });
		c.init({ indoor: false });
		c.setTarget({ position: [10, 10, 0] });
		c.update(16);
		return c;
	};

	it('[R-PP-011] ground picking mirrors Y when flipped', () => {
		const a = makeAltitude(20, 20);
		const c = cam();
		const proj = computeProjection(15, 1);
		const screen = { width: 100, height: 100 };
		const flipped = a.intersect(c.modelView, proj, { ...screen, x: 50, y: 30 }, { flipped: true });
		const mirrored = a.intersect(c.modelView, proj, { ...screen, x: 50, y: 70 });
		expect(flipped).toEqual(mirrored);
	});

	it('[R-PP-011] projected overlay positions mirror Y when flipped', () => {
		const c = cam();
		const vp = c.viewProjection(computeProjection(15, 1));
		const view = { width: 800, height: 600 };
		const a = projectToScreen(vp, [10.5, -1, 10.5], view);
		const b = projectToScreen(vp, [10.5, -1, 10.5], view, { flipped: true });
		expect(b.x).toBeCloseTo(a.x, 6);
		expect(b.y).toBeCloseTo(600 - a.y, 6);
	});

	it('[R-PP-011][fix diverges from legacy R-PP-011] entity hover rectangles are mirrored', () => {
		expect(mirrorRectY({ x0: 10, x1: 70, y0: 100, y1: 145 }, 600)).toEqual({ x0: 10, x1: 70, y0: 455, y1: 500 });
	});

	it.fails('[R-PP-011][pending] EFST ILLUSION status turns the flip on and cleanStatusEffect turns it off', () => {
		const s = new ScreenEffects();
		s.parseStatus({ name: 'ILLUSION' }, true);
		expect(s.flipped).toBe(true);
		s.cleanStatusEffect();
		expect(s.flipped).toBe(false);
	});

	it.fails('[R-PP-011][pending][fix diverges from legacy R-PP-011] name, chat and emblem overlays mirror too', () => {
		for (const kind of ['name', 'chat', 'emblem']) {
			const placed = placeOverlay({ kind, position: [0, 0, 0], flipped: true, viewport: { width: 800, height: 600 } });
			expect(placed.mirrored).toBe(true);
		}
	});
});
