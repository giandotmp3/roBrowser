/** AI_NATIVE_SPEC §5.1 — CTX: context, init, frame loop (13 rules). */
import { describe, expect } from 'vitest';
import { rule } from '../support/rule.js';
import { inGame, run, VIEW } from '../support/scenes.js';
import { scene } from '../../src/scenes/SceneScript.js';
import { flatMap, mob } from '../../src/scenes/fixtures.js';
import { lastFrame, passOrder, sprites } from '../../src/subject/queries.js';
import { Blend, MAP_PASSES } from '../../src/records/RecordTypes.js';

describe('CTX', () => {
	rule('R-CTX-001', 'device requested with fixed attributes; no device → throws, no render', async s => {
		const r = await run(s, scene('ctx-001').viewport(VIEW).advance(16));
		const req = lastFrame(r).device.requested;
		expect(req).toMatchObject({
			alpha: false,
			depth: true,
			stencil: false,
			antialias: true,
			premultipliedAlpha: false,
			powerPreference: 'high-performance'
		});
		await expect(run(s, scene('ctx-001-none').device('unavailable').viewport(VIEW).advance(16))).rejects.toThrow();
	});

	rule(
		'R-CTX-002',
		'default state: clearDepth 1, LEQUAL, SRC_ALPHA/ONE_MINUS_SRC_ALPHA; restored after passes',
		async s => {
			const r = await run(
				s,
				inGame('ctx-002')
					.entity(mob({ gid: 120_000_001, position: [22, 20, 0] }))
					.effect({ effectId: 'fixture-str-additive', ownerAID: 120_000_001 })
					.advance(100, 2)
			);
			const f = lastFrame(r);
			expect(f.device.defaults).toEqual({
				clearDepth: 1,
				depthCompare: 'less-equal',
				depthTest: true,
				blend: Blend.NORMAL
			});
			// After the additive effect, the next default sprite draw is back to normal blending.
			const idx = f.records.findIndex(x => x.kind === 'effect');
			const next = f.records.slice(idx + 1).find(x => x.kind === 'sprite' && x.layer === 'body');
			if (next) {
				expect(next.blend).toEqual(Blend.NORMAL);
			}
		}
	);

	rule('R-CTX-003', 'fps cap: 1000/fpslimit interval, snapped; <=0 uncapped; 60 outside the game', async s => {
		const interval = 1000 / 60;
		// rAF every 7 ms for 200 ms, cap 60, in game.
		const capped = await run(s, inGame('ctx-003-capped', { prefs: { fpslimit: 60 } }).advance(203, 29));
		const times = capped.frames.map(f => f.loopTime);
		for (let i = 1; i < times.length; i++) {
			const d = times[i] - times[i - 1];
			expect(d).toBeGreaterThanOrEqual(interval - 1e-6);
			expect(Math.abs(d / interval - Math.round(d / interval))).toBeLessThan(1e-6); // snapped, no drift
		}
		const uncapped = await run(s, inGame('ctx-003-uncapped', { prefs: { fpslimit: 0 } }).advance(203, 29));
		expect(uncapped.frames.length).toBe(29);
		const charSelect = await run(
			s,
			scene('ctx-003-out')
				.viewport(VIEW)
				.preferences({ fpslimit: 0 })
				.session({ playing: false })
				.advance(203, 29)
		);
		expect(charSelect.frames.length).toBeLessThanOrEqual(Math.ceil(203 / interval) + 1);
	});

	rule('R-CTX-004', 'frame order: serverTick, events, callbacks, cursor, next rAF', async s => {
		const r = await run(s, inGame('ctx-004').loop('ui-a').loop('ui-b').advance(17));
		const loop = lastFrame(r).loop;
		expect(loop).toEqual([
			'serverTick',
			'events',
			'callback:map',
			'callback:ui-a',
			'callback:ui-b',
			'cursor',
			'raf'
		]);
	});

	rule('R-CTX-005', 'render error turns bloom off permanently; device loss exits the loop', async s => {
		const r = await run(
			s,
			inGame('ctx-005', { prefs: { bloom: true } })
				.loop('boom', { throws: true })
				.advance(34, 2)
		);
		expect(lastFrame(r).device.settings.bloom).toBe(false);
		expect(r.frames.length).toBe(2); // loop continues
		const lost = await run(s, inGame('ctx-005-lost').loop('boom', { throws: true }).device('lost').advance(34, 2));
		expect(lastFrame(lost).device.state).toBe('lost');
		expect(lost.frames.filter(f => f.device.state === 'lost' && f.records.length > 0)).toHaveLength(0);
	});

	rule('R-CTX-006', 'device loss: stop rendering, purge cached assets, show overlay, ignore resize', async s => {
		const r = await run(
			s,
			inGame('ctx-006')
				.advance(17)
				.device('lost')
				.viewport({ ...VIEW, width: 800 })
				.advance(600, 2)
		);
		const f = lastFrame(r);
		expect(f.records).toHaveLength(0);
		expect(f.device.overlay).toMatchObject({
			visible: true,
			background: 'rgba(0,0,0,0.85)',
			zIndex: 10000,
			title: 'Graphics Context Lost'
		});
		expect(f.device.purged).toEqual(expect.arrayContaining(['.bmp', '.jpg', '.png', '.spr', '.pal', '.str']));
		expect(f.viewport.cssWidth).toBe(VIEW.width);
	});

	rule(
		'R-CTX-007',
		'restore: overlay hidden, defaults reapplied, PP re-init, resized, rendering resumes (map rebuilt)',
		async s => {
			const r = await run(
				s,
				inGame('ctx-007', { prefs: { fxaa: true } })
					.advance(17)
					.device('lost')
					.advance(17)
					.device('restored')
					.advance(17)
			);
			const f = lastFrame(r);
			expect(f.device.overlay.visible).toBe(false);
			expect(f.device.state).toBe('ready');
			expect(f.postChain.map(p => p.module)).toContain('fxaa');
			expect(passOrder(f)).toContain('ground'); // map rebuilt (architecture §2.2 device-loss fix)
			expect(sprites(f).length).toBeGreaterThan(0);
		}
	);

	rule(
		'R-CTX-008',
		'resize 500 ms debounce; backing = css × quality × DPR; perspective(vFov, aspect, 1, 1000)',
		async s => {
			const r = await run(
				s,
				scene('ctx-008').viewport({ width: 1920, height: 1080, dpr: 2, quality: 50 }).advance(499).advance(2)
			);
			const before = r.frames[0].viewport;
			const after = lastFrame(r).viewport;
			expect(before.width).not.toBe(1920);
			expect(after).toMatchObject({ cssWidth: 1920, cssHeight: 1080, width: 1920, height: 1080 });
			expect(lastFrame(r).camera.projectionParams).toMatchObject({
				vFov: 15,
				aspect: 1920 / 1080,
				near: 1,
				far: 1000
			});
		}
	);

	rule('R-CTX-009', 'clear colour = WeatherTable sky colour; none → opaque black, no clouds', async s => {
		const sky = await run(
			s,
			inGame('ctx-009-sky', { map: flatMap({ sky: { skyColor: [0.4, 0.6, 0.9, 1] } }) }).advance(17)
		);
		expect(lastFrame(sky).map.clearColor).toEqual([0.4, 0.6, 0.9, 1]);
		const none = await run(s, inGame('ctx-009-none').advance(17));
		expect(lastFrame(none).map.clearColor).toEqual([0, 0, 0, 1]);
		expect(lastFrame(none).records.filter(x => x.layer === 'clouds')).toHaveLength(0);
	});

	rule('R-CTX-010', 'map render passes in legacy order', async s => {
		const r = await run(s, inGame('ctx-010').advance(17));
		expect(passOrder(lastFrame(r))).toEqual([...MAP_PASSES]);
	});

	rule(
		'R-CTX-011',
		'map name normalisation; same-map teleport clears entities/damage/effects without reload',
		async s => {
			const r = await run(
				s,
				scene('ctx-011')
					.viewport(VIEW)
					.session({ playing: true })
					.map('0061@tower', flatMap({ name: '1@tower' }))
					.advance(17)
					.map('003#prontera.gat', flatMap({ name: 'prontera' }))
					.advance(17)
					.entity(mob({ gid: 120_000_002 }))
					.damage({ amount: 10, gid: 120_000_002, type: 0 })
					.map('prontera.rsw', flatMap({ name: 'prontera' }))
					.advance(17)
			);
			expect(r.frames[0].map.currentMap).toBe('1@tower');
			expect(r.frames[1].map.currentMap).toBe('prontera');
			const f = lastFrame(r);
			expect(f.map.reloads).toBe(2);
			expect(sprites(f, { gid: 120_000_002 })).toHaveLength(0);
			expect(f.records.filter(x => x.kind === 'damage' || x.kind === 'effect')).toHaveLength(0);
		}
	);

	rule('R-CTX-012', 'env = 1-(1-D)(1-A); direction = -(RotY(lon)·RotX(lat)·(0,1,0))', async s => {
		const light = { longitude: 90, latitude: 0, diffuse: [0.5, 0.5, 0.5], ambient: [0.5, 0.2, 0], opacity: 1 };
		const r = await run(s, inGame('ctx-012', { map: flatMap({ light }) }).advance(17));
		const l = lastFrame(r).map.light;
		expect(l.env[0]).toBeCloseTo(0.75, 5);
		expect(l.env[1]).toBeCloseTo(0.6, 5);
		expect(l.env[2]).toBeCloseTo(0.5, 5);
		// latitude 0 → RotX(0)·up = up; RotY never moves the up vector → direction = (0,-1,0)
		expect(l.direction[0]).toBeCloseTo(0, 5);
		expect(l.direction[1]).toBeCloseTo(-1, 5);
		expect(l.direction[2]).toBeCloseTo(0, 5);
	});

	rule('R-CTX-013', 'night: every 8 ms diffuse R,G -= 0.005 to <= 0.5, B untouched; day reverses', async s => {
		const light = { longitude: 45, latitude: 45, diffuse: [1, 1, 0.9], ambient: [0, 0, 0], opacity: 1 };
		const r = await run(
			s,
			inGame('ctx-013', { map: flatMap({ light }) })
				.screen('setNight', true)
				.advance(80, 1)
				.advance(2000, 1)
				.screen('setNight', false)
				.advance(2000, 1)
		);
		const [step, night, day] = r.frames.map(f => f.map.light.diffuse);
		expect(step[0]).toBeCloseTo(1 - 10 * 0.005, 5);
		expect(step[2]).toBeCloseTo(0.9, 5);
		expect(night[0]).toBeLessThanOrEqual(0.5);
		expect(night[1]).toBeLessThanOrEqual(0.5);
		expect(night[2]).toBeCloseTo(0.9, 5);
		expect(day).toEqual([1, 1, 0.9]);
	});
});
