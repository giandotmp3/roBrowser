import { describe, it, expect, vi } from 'vitest';
import { Camera } from '../../src/domain/Camera.js';
import { computeProjection } from '../../src/domain/Viewport.js';
import {
	pickPriority,
	pickEntity,
	isPickable,
	updateMouseWorld,
	HoverTracker,
	computePickRect,
	computeGr2PickRect
} from '../../src/domain/Picking.js';
import { EntityKind } from '../../src/domain/EntityTypes.js';
import { makeAltitude, makeEntity, makeScene } from '../support/fakes.js';

describe('R-PICK-001 ground ray-march', () => {
	it('[R-PICK-001] first in-map sample with |height + y| < 0.5 is the hit', () => {
		const a = makeAltitude(10, 10);
		expect(a.rayMarch([5, -10, 5], [0, 1, 0])).toEqual([5, 5]);
	});

	it('[R-PICK-001] samples outside the map are skipped', () => {
		const a = makeAltitude(10, 10);
		// starts outside at ground height: would "hit" immediately if out-of-map samples counted
		expect(a.rayMarch([-50, 0, -50], [0, 0, -1])).toBeNull();
	});

	it('[R-PICK-001] marches at most 200 unit steps', () => {
		const a = makeAltitude(10, 10);
		expect(a.rayMarch([-195, 0, 5], [1, 0, 0])).toEqual([0, 5]);
		expect(a.rayMarch([-201, 0, 5], [1, 0, 0])).toBeNull();
	});

	it('[R-PICK-001] unprojects the mouse through the far plane (screen centre hits near the focus cell)', () => {
		const a = makeAltitude(20, 20);
		const cam = new Camera({ prefs: { smooth: false } });
		cam.init({ indoor: false });
		cam.setTarget({ position: [10, 10, 0] });
		cam.update(16);
		const hit = a.intersect(cam.modelView, computeProjection(15, 1), { x: 50, y: 50, width: 100, height: 100 });
		expect(hit).not.toBeNull();
		expect(Math.abs(hit[0] - 10.5)).toBeLessThan(1.5);
		expect(Math.abs(hit[1] - 10.5)).toBeLessThan(1.5);
	});
});

describe('R-PICK-002 mouse world state and walk cursor', () => {
	const setup = (packetVer, walkable) => {
		const mouse = { world: { x: 9, y: 9, z: 9 } };
		const cursor = { setType: vi.fn() };
		const altitude = makeAltitude(10, 10, () => 2, () => (walkable ? 1 : 0));
		return { mouse, cursor, altitude, packetVer, isWalkable: (t) => t === 1 };
	};

	it('[R-PICK-002] Mouse.world resets to -1 when nothing is hit', () => {
		const ctx = setup(20220101, true);
		updateMouseWorld({ ...ctx, hit: null });
		expect(ctx.mouse.world).toEqual({ x: -1, y: -1, z: -1 });
	});

	it('[R-PICK-002] Mouse.world is the hit cell and its height', () => {
		const ctx = setup(20220101, true);
		updateMouseWorld({ ...ctx, hit: [3.7, 4.2] });
		expect(ctx.mouse.world).toEqual({ x: 3, y: 4, z: -2 });
	});

	it('[R-PICK-002] PACKETVER >= 20200101 swaps DEFAULT / NOWALK by walkability', () => {
		const w = setup(20200101, true);
		updateMouseWorld({ ...w, hit: [1, 1] });
		expect(w.cursor.setType).toHaveBeenCalledWith('DEFAULT');
		const nw = setup(20200101, false);
		updateMouseWorld({ ...nw, hit: [1, 1] });
		expect(nw.cursor.setType).toHaveBeenCalledWith('NOWALK');
		const old = setup(20191231, false);
		updateMouseWorld({ ...old, hit: [1, 1] });
		expect(old.cursor.setType).not.toHaveBeenCalled();
	});
});

describe('R-PICK-003 entity hit rectangle', () => {
	it.fails('[R-PICK-003][pending] rect is widened to at least 60 px (30 px for items)', () => {
		const r = computePickRect({ kind: EntityKind.PC, bodyExtents: { x0: -5, x1: 5, y0: 0, y1: 80 }, size: 175 });
		expect(r.x1 - r.x0).toBeGreaterThanOrEqual(60);
		const i = computePickRect({ kind: EntityKind.ITEM, bodyExtents: { x0: -2, x1: 2, y0: 0, y1: 10 }, size: 175 });
		expect(i.x1 - i.x0).toBeGreaterThanOrEqual(30);
	});

	it.fails('[R-PICK-003][pending] no body -> x +/-25, y 0..45 px; job 139 and invisible entities get no update', () => {
		expect(computePickRect({ kind: EntityKind.PC, bodyExtents: null, size: 175 })).toMatchObject({ x0: -25, x1: 25, y0: 0, y1: 45 });
		expect(computePickRect({ kind: EntityKind.NPC, job: 139, bodyExtents: null })).toBeNull();
	});
});

describe('R-PICK-004 pick priority', () => {
	it('[R-PICK-004] normal priority table', () => {
		expect([EntityKind.MOB, EntityKind.ABR, EntityKind.BIONIC].map((k) => pickPriority(k))).toEqual([3, 3, 3]);
		expect(pickPriority(EntityKind.ITEM)).toBe(2);
		expect(pickPriority(EntityKind.NPC)).toBe(1);
		expect(pickPriority(EntityKind.PC)).toBe(0);
		expect([EntityKind.EFFECT, EntityKind.FALCON, EntityKind.WUG].map((k) => pickPriority(k))).toEqual([-1, -1, -1]);
	});

	it('[R-PICK-004] support-skill priority table', () => {
		expect([EntityKind.PC, EntityKind.HOM, EntityKind.MERC, EntityKind.ELEM].map((k) => pickPriority(k, true))).toEqual([3, 3, 3, 3]);
		expect(pickPriority(EntityKind.MOB, true)).toBe(2);
		expect(pickPriority(EntityKind.PET, true)).toBe(1);
		expect(pickPriority(EntityKind.NPC, true)).toBe(0);
	});

	it('[R-PICK-004] sorted by depth - priority*100 ascending; first containing rect wins', () => {
		const rect = { x0: 0, x1: 100, y0: 0, y1: 100 };
		const pc = makeEntity({ kind: EntityKind.PC, depth: 10, pickRect: rect });
		const mob = makeEntity({ kind: EntityKind.MOB, depth: 50, pickRect: rect });
		expect(pickEntity([pc, mob], { x: 50, y: 50 })).toBe(mob);
		expect(pickEntity([pc, mob], { x: 50, y: 50 }, { supportMode: true })).toBe(pc);
		expect(pickEntity([pc, mob], { x: 500, y: 50 })).toBeNull();
	});
});

describe('R-PICK-005 pick exclusions', () => {
	it('[R-PICK-005] dead non-PC and removing entities are not pickable; dead PCs are', () => {
		expect(isPickable(makeEntity({ kind: EntityKind.MOB, dead: true }))).toBe(false);
		expect(isPickable(makeEntity({ kind: EntityKind.PC, dead: true }))).toBe(true);
		expect(isPickable(makeEntity({ removing: true }))).toBe(false);
	});

	it('[R-PICK-005] in performance mode, entities beyond viewArea are not pickable', () => {
		const { scene, deps } = makeScene();
		deps.settings.performanceMode = true;
		deps.settings.viewArea = 14;
		const rect = { x0: 0, x1: 100, y0: 0, y1: 100 };
		const player = makeEntity({ position: [0, 0, 0] });
		deps.session.Entity = player;
		const far = scene.EntityManager.add(makeEntity({ kind: EntityKind.MOB, position: [20, 0, 0], pickRect: rect }));
		scene.EntityManager.cull();
		expect(scene.EntityManager.pick({ x: 10, y: 10 })).toBeNull();
		far.position = [5, 0, 0];
		scene.EntityManager.cull();
		expect(scene.EntityManager.pick({ x: 10, y: 10 })).toBe(far);
	});
});

describe('R-PICK-006 hover events', () => {
	it('[R-PICK-006] mouseOut/mouseOver fire when the target changes', () => {
		const h = new HoverTracker();
		const log = [];
		const handlers = { onOut: (e) => log.push(`out:${e.GID}`), onOver: (e) => log.push(`over:${e.GID}`) };
		const a = { GID: 1 };
		const b = { GID: 2 };
		h.update(a, false, handlers);
		h.update(a, false, handlers);
		h.update(b, false, handlers);
		h.update(null, false, handlers);
		expect(log).toEqual(['over:1', 'out:1', 'over:2', 'out:2']);
	});

	it('[R-PICK-006] mouseOut/mouseOver re-fire when only the Shift state changes', () => {
		const h = new HoverTracker();
		const log = [];
		const handlers = { onOut: () => log.push('out'), onOver: () => log.push('over') };
		const a = { GID: 1 };
		h.update(a, false, handlers);
		h.update(a, true, handlers);
		expect(log).toEqual(['over', 'out', 'over']);
	});
});

describe('R-PICK-007 GR2 pick area', () => {
	it.fails('[R-PICK-007][pending] client-faithful square at the base sphere (lower ~46% of a guild flag)', () => {
		const r = computeGr2PickRect({ baseSphere: { center: [0, 0, 0], radius: 1 }, aabb: { min: [-1, 0, -1], max: [1, 4.35, 1] } });
		expect(r.heightFractionOfAabb).toBeCloseTo(0.46, 2);
	});
});
