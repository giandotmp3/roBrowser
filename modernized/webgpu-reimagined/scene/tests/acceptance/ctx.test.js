import { describe, it, expect } from 'vitest';
import { FrameClock } from '../../src/domain/FrameClock.js';
import { Scheduler } from '../../src/domain/Scheduler.js';
import { computeViewport, computeProjection, ResizeDebouncer } from '../../src/domain/Viewport.js';
import { normalizeMapName, isSameMap } from '../../src/domain/MapName.js';
import { NightTransition } from '../../src/domain/ScreenEffects.js';
import { FakeClock, FakeFrames, FakeTimers, fakeSession, fakeSettings, makeScene } from '../support/fakes.js';

describe('R-CTX-003 frame-rate cap', () => {
	it('[R-CTX-003] throttles in-game to 1000/fpslimit and snaps to the interval boundary', () => {
		const fc = new FrameClock({ session: fakeSession(), settings: fakeSettings({ fpslimit: 60 }) });
		expect(fc.isFrameDue(0)).toBe(true);
		expect(fc.isFrameDue(10)).toBe(false);
		expect(fc.isFrameDue(20)).toBe(true);
		expect(fc.lastFrame).toBeCloseTo(20 - (20 % (1000 / 60)), 6);
	});

	it('[R-CTX-003] fpslimit <= 0 in-game is uncapped (one frame per rAF)', () => {
		const fc = new FrameClock({ session: fakeSession(), settings: fakeSettings({ fpslimit: 0 }) });
		expect([0, 1, 2, 3].map((t) => fc.isFrameDue(t))).toEqual([true, true, true, true]);
	});

	it('[R-CTX-003] outside the game the cap is forced to 60 when 0 or above 60', () => {
		const out = fakeSession({ Playing: false });
		expect(new FrameClock({ session: out, settings: fakeSettings({ fpslimit: 0 }) }).effectiveCap()).toBe(60);
		expect(new FrameClock({ session: out, settings: fakeSettings({ fpslimit: 144 }) }).effectiveCap()).toBe(60);
		expect(new FrameClock({ session: out, settings: fakeSettings({ fpslimit: 30 }) }).effectiveCap()).toBe(30);
		expect(new FrameClock({ session: fakeSession(), settings: fakeSettings({ fpslimit: 144 }) }).effectiveCap()).toBe(144);
	});
});

describe('R-CTX-004 order of work in each frame', () => {
	it('[R-CTX-004] serverTick += Date.now delta, events, callbacks, cursor, next rAF', () => {
		const log = [];
		const clock = new FakeClock(100, 5000);
		const session = fakeSession({ serverTick: 1000 });
		const s = new Scheduler({
			clock,
			session,
			settings: fakeSettings({ fpslimit: 0 }),
			events: { process: () => log.push(`events@${session.serverTick}`) },
			cursor: { render: () => log.push('cursor') },
			frames: new FakeFrames(log)
		});
		s.register(() => log.push('cb1'));
		s.register(() => log.push('cb2'));
		log.length = 0;
		clock.advance(16);
		s.frames.flush();
		expect(log).toEqual(['events@1016', 'cb1', 'cb2', 'cursor', 'raf']);
		expect(s.tick).toBe(116);
	});

	it('[R-CTX-004] Renderer.stop() with no argument clears every callback', () => {
		const { scene } = makeScene();
		const fn = () => {};
		scene.Renderer.render(fn);
		scene.Renderer.stop();
		expect(scene.scheduler.callbacks).toHaveLength(0);
		expect(scene.scheduler.running).toBe(false);
	});
});

describe('R-CTX-008 resize debounce, quality and DPR', () => {
	it('[R-CTX-008] 1920x1080 CSS, DPR 2, quality 50 -> 1920x1080 backing store, CSS size unchanged', () => {
		expect(computeViewport({ cssWidth: 1920, cssHeight: 1080, dpr: 2, quality: 50 })).toEqual({
			cssWidth: 1920,
			cssHeight: 1080,
			backingWidth: 1920,
			backingHeight: 1080
		});
	});

	it('[R-CTX-008] projection is perspective(vFov full vertical angle, w/h, near 1, far 1000)', () => {
		const p = computeProjection(15, 16 / 9);
		const f = 1 / Math.tan((7.5 * Math.PI) / 180);
		expect(p[5]).toBeCloseTo(f, 5);
		expect(p[0]).toBeCloseTo(f / (16 / 9), 5);
		expect(p[10]).toBeCloseTo(1001 / -999, 5);
		expect(p[14]).toBeCloseTo(2000 / -999, 5);
	});

	it('[R-CTX-008] resize runs 500 ms after the last event', () => {
		const timers = new FakeTimers();
		let n = 0;
		const d = new ResizeDebouncer(timers, () => n++);
		for (const t of [0, 200, 400]) {
			timers.advanceTo(t);
			d.notify();
		}
		timers.advanceTo(899);
		expect(n).toBe(0);
		timers.advanceTo(900);
		expect(n).toBe(1);
	});

	it('[R-CTX-008] Renderer.resize forwards the scaled size to the backend and exposes CSS size', () => {
		const { scene, calls } = makeScene();
		scene.Renderer.resize();
		expect(scene.Renderer.width).toBe(1920);
		expect(scene.Renderer.height).toBe(1080);
		expect(calls.find((c) => c[0] === 'backend.resize')[1]).toMatchObject({ backingWidth: 1920, backingHeight: 1080 });
	});

	it('[R-CTX-008] resize is ignored while the context is lost (R-CTX-006 interaction)', () => {
		const { scene, calls, deps } = makeScene();
		deps.backend.contextLost = true;
		scene.Renderer.resize();
		expect(calls.some((c) => c[0] === 'backend.resize')).toBe(false);
	});
});

describe('R-CTX-011 map name normalisation and same-map teleport', () => {
	it('[R-CTX-011] strips instance prefixes', () => {
		expect(normalizeMapName('0061@tower')).toBe('1@tower');
		expect(normalizeMapName('003#prontera')).toBe('prontera');
		expect(normalizeMapName('prontera.gat')).toBe('prontera.gat');
	});

	it('[R-CTX-011] .gat vs .rsw of the same map is the same map', () => {
		expect(isSameMap('prontera.gat', 'prontera.rsw')).toBe(true);
		expect(isSameMap('prontera.gat', 'geffen.gat')).toBe(false);
	});

	it('[R-CTX-011] same-map teleport clears entities, damage and effects without reloading', () => {
		const { scene, calls } = makeScene();
		scene.MapRenderer.setMap('prontera.gat');
		scene.EntityManager.add({ GID: 1, kind: 'PC', position: [0, 0, 0] });
		calls.length = 0;
		expect(scene.MapRenderer.setMap('prontera.rsw')).toBe(false);
		expect(calls.some((c) => c[0] === 'loader.load')).toBe(false);
		expect(calls.map((c) => c[0])).toEqual(expect.arrayContaining(['damage.free', 'effects.free']));
		expect(scene.EntityManager.get(1)).toBeNull();
	});

	it('[R-CTX-011] a new map loads the .rsw through the worker and drops stale worker events', () => {
		const { scene, calls } = makeScene();
		expect(scene.MapRenderer.setMap('prontera.gat')).toBe(true);
		expect(calls.find((c) => c[0] === 'loader.load')[1]).toBe('prontera.rsw');
		expect(scene.MapRenderer.onWorkerMessage({ type: 'MAP_WORLD', request: 999, payload: {} })).toBe(false);
		expect(scene.MapRenderer.onWorkerMessage({ type: 'LOAD_MAP_COMPLETE', request: 7, payload: {} })).toBe(true);
		expect(scene.MapRenderer.loading).toBe(false);
	});
});

describe('R-CTX-013 night-mode transition', () => {
	it('[R-CTX-013] every 8 ms diffuse R and G drop 0.005 until both <= 0.5; blue untouched; env recomputed', () => {
		const n = new NightTransition({ diffuse: [1, 1, 1], ambient: [0.2, 0.2, 0.2] });
		n.setNight(true, 0);
		n.update(8);
		expect(n.diffuse[0]).toBeCloseTo(0.995, 6);
		expect(n.diffuse[1]).toBeCloseTo(0.995, 6);
		expect(n.diffuse[2]).toBe(1);
		n.update(2000);
		expect(n.diffuse[0]).toBeCloseTo(0.5, 6);
		expect(n.diffuse[1]).toBeCloseTo(0.5, 6);
		expect(n.diffuse[2]).toBe(1);
		expect(n.env[0]).toBeCloseTo(1 - 0.5 * 0.8, 6);
	});

	it('[R-CTX-013] day mode reverses up to the map diffuse', () => {
		const n = new NightTransition({ diffuse: [0.9, 0.8, 1], ambient: [0, 0, 0] });
		n.setNight(true, 0);
		n.update(4000);
		n.setNight(false, 4000);
		n.update(10000);
		expect(n.diffuse[0]).toBeCloseTo(0.9, 6);
		expect(n.diffuse[1]).toBeCloseTo(0.8, 6);
	});
});
