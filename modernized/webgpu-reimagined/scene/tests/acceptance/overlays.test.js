import { describe, it, expect } from 'vitest';
import { overlayAnchor, placeOverlay, applyCullToOverlays, signboardAnchor } from '../../src/domain/Overlays.js';
import { lifeBarLayout } from '../../src/domain/LifeBar.js';
import { cursorSpeedMultiplier, cursorFrame, applyMagnetism, cursorHotspot, StandaloneCursorLoop } from '../../src/domain/Cursor.js';
import { EntityKind } from '../../src/domain/EntityTypes.js';
import { makeAltitude, makeEntity, makeScene } from '../support/fakes.js';

describe('R-UI-001 overlay anchors', () => {
	it('[R-UI-001] billboard-space offsets per overlay kind', () => {
		const pos = [10, 20, 3];
		expect(overlayAnchor('life', pos)).toEqual({ origin: [10.5, -3, 20.5], billboardY: -0.5, pxOffsetY: 0 });
		expect(overlayAnchor('name', pos)).toMatchObject({ billboardY: -0.5, pxOffsetY: 13 });
		expect(overlayAnchor('chat', pos).billboardY).toBeCloseTo(90 / 35, 10);
		expect(overlayAnchor('cast', pos).billboardY).toBeCloseTo(90 / 35, 10);
		expect(overlayAnchor('room', pos).billboardY).toBeCloseTo(120 / 35, 10);
		expect(overlayAnchor('emblem', pos).billboardY).toBeCloseTo(140 / 35, 10);
	});

	it.fails('[R-UI-001][pending] DOM placement projects the anchor through the billboard; chat is bottom-aligned with 2 px', () => {
		const placed = placeOverlay({ kind: 'chat', position: [0, 0, 0], viewport: { width: 800, height: 600 } });
		expect(placed).toHaveProperty('bottom');
	});
});

describe('R-UI-002 life bar (FLAG fixed)', () => {
	it('[R-UI-002] 60x5, +4 px per extra bar; border/empty colours', () => {
		const l = lifeBarLayout({ kind: EntityKind.PC, hpRatio: 1, hasSp: true });
		expect([l.width, l.height, l.border, l.empty]).toEqual([60, 9, '#10189c', '#424242']);
	});

	it('[R-UI-002] HP colours by kind, low-HP colours below 25%', () => {
		expect(lifeBarLayout({ kind: EntityKind.MOB, hpRatio: 1 }).hpColor).toBe('#FF00E7');
		expect(lifeBarLayout({ kind: EntityKind.PET, hpRatio: 1 }).hpColor).toBe('#FFE7E7');
		expect(lifeBarLayout({ kind: EntityKind.PC, hpRatio: 1 }).hpColor).toBe('#10ef21');
		expect(lifeBarLayout({ kind: EntityKind.MOB, hpRatio: 0.2 }).hpColor).toBe('#FFFF00');
		expect(lifeBarLayout({ kind: EntityKind.PC, hpRatio: 0.2 }).hpColor).toBe('#FF0000');
	});

	it('[R-UI-002] SP/AP colours; PC life bars sit above others', () => {
		const l = lifeBarLayout({ kind: EntityKind.PC, hpRatio: 1 });
		expect([l.spColor, l.apColor, l.zIndex]).toEqual(['#1863de', '#ffc663', 2]);
		expect(lifeBarLayout({ kind: EntityKind.MOB, hpRatio: 1 }).zIndex).toBe(1);
	});

	it('[R-UI-002] AP adds 4 px only for 4th-class jobs', () => {
		expect(lifeBarLayout({ kind: EntityKind.PC, hpRatio: 1, hasSp: true, hasAp: true }).height).toBe(9);
		expect(lifeBarLayout({ kind: EntityKind.PC, hpRatio: 1, hasSp: true, hasAp: true, isFourthClass: true }).height).toBe(13);
	});

	it('[R-UI-002][fix diverges from legacy R-UI-002] AP and hunger rows do not overlap', () => {
		const l = lifeBarLayout({ kind: EntityKind.HOM, hpRatio: 1, hasSp: true, hasAp: true, isFourthClass: true, hasHunger: true });
		const ys = l.rows.map((r) => r.y);
		expect(new Set(ys).size).toBe(ys.length);
		const ap = l.rows.find((r) => r.bar === 'ap');
		const hunger = l.rows.find((r) => r.bar === 'hunger');
		expect(hunger.y >= ap.y + ap.height || ap.y >= hunger.y + hunger.height).toBe(true);
		expect(l.height).toBe(17);
	});
});

describe('R-UI-003 culled entities hide their overlays', () => {
	it('[R-UI-003] all overlay canvases go display:none while culled and come back after', () => {
		const e = makeEntity({ overlays: { life: { style: { display: '' } }, name: { style: { display: '' } } } });
		applyCullToOverlays(e, true);
		expect(Object.values(e.overlays).map((o) => o.style.display)).toEqual(['none', 'none']);
		applyCullToOverlays(e, false);
		expect(Object.values(e.overlays).map((o) => o.style.display)).toEqual(['', '']);
	});

	it('[R-UI-003] EntityManager.cull applies overlay hiding with the per-frame cull set', () => {
		const { scene, deps } = makeScene();
		deps.settings.performanceMode = true;
		deps.session.Entity = makeEntity({ position: [0, 0, 0] });
		const far = scene.EntityManager.add(makeEntity({ position: [30, 0, 0], overlays: { life: { style: { display: '' } } } }));
		scene.EntityManager.cull();
		expect(far.overlays.life.style.display).toBe('none');
	});
});

describe('R-UI-004 signboards', () => {
	it('[R-UI-004] full signboard: ground at cell centre, lifted 140/35, shifted left 70 px', () => {
		const a = makeAltitude(10, 10, () => 2);
		const s = signboardAnchor(3, 4, { iconOnly: false }, a);
		expect(s.origin).toEqual([3.5, 2, 4.5]);
		expect(s.billboardY).toBeCloseTo(140 / 35, 10);
		expect(s.shiftLeftPx).toBe(70);
	});

	it('[R-UI-004] icon-only: lifted 120/35, shifted left 15 px', () => {
		const s = signboardAnchor(3, 4, { iconOnly: true }, makeAltitude(10, 10));
		expect(s.billboardY).toBeCloseTo(120 / 35, 10);
		expect(s.shiftLeftPx).toBe(15);
	});

	it('[R-UI-004] SignboardManager.add picks the variant from the DB entry', () => {
		const { scene } = makeScene();
		expect(scene.SignboardManager.add(1, 1, { icon: 'x.bmp' }).anchor.shiftLeftPx).toBe(15);
		expect(scene.SignboardManager.add(1, 1, { icon: 'x.bmp', description: 'Tool Shop' }).anchor.shiftLeftPx).toBe(70);
	});
});

describe('R-UI-005 game cursor', () => {
	it('[R-UI-005] frame rate = ACT delay x per-type multiplier (DEFAULT 2.0, TARGET 0.5, others 1.0)', () => {
		expect(cursorSpeedMultiplier('DEFAULT')).toBe(2.0);
		expect(cursorSpeedMultiplier('TARGET')).toBe(0.5);
		expect(cursorSpeedMultiplier('TALK')).toBe(1.0);
		expect(cursorFrame({ elapsed: 400, actDelay: 100, type: 'DEFAULT', frameCount: 10, oneShot: false })).toBe(2);
	});

	it('[R-UI-005] one-shot cursors clamp at their last frame', () => {
		expect(cursorFrame({ elapsed: 10_000, actDelay: 100, type: 'CLICK', frameCount: 4, oneShot: true })).toBe(3);
		expect(cursorFrame({ elapsed: 500, actDelay: 100, type: 'CLICK', frameCount: 4, oneShot: false })).toBe(1);
	});

	it('[R-UI-005] magnetism snaps to hovered mob (snap) or item (itemsnap) centre', () => {
		const mouse = { x: 1, y: 1 };
		const mob = { kind: 'MOB', screenCenter: { x: 50, y: 60 } };
		const item = { kind: 'ITEM', screenCenter: { x: 70, y: 80 } };
		expect(applyMagnetism(mouse, mob, { snap: true, itemsnap: false })).toEqual({ x: 50, y: 60 });
		expect(applyMagnetism(mouse, mob, { snap: false, itemsnap: true })).toEqual({ x: 1, y: 1 });
		expect(applyMagnetism(mouse, item, { snap: false, itemsnap: true })).toEqual({ x: 70, y: 80 });
	});

	it.fails('[R-UI-005][pending] hotspots come from a per-type table', () => {
		expect(cursorHotspot('DEFAULT')).toEqual(expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }));
	});

	it.fails('[R-UI-005][pending] when the scene loop is stopped the cursor animates on its own rAF', () => {
		const loop = new StandaloneCursorLoop({});
		expect(() => loop.start()).not.toThrow();
	});
});
