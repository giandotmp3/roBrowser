/** AI_NATIVE_SPEC §5.2 — CAM: camera (11 rules). */
import { describe, expect } from 'vitest';
import { rule } from '../support/rule.js';
import { inGame, run, LOCAL_GID } from '../support/scenes.js';
import { flatMap } from '../../src/scenes/fixtures.js';
import { lastFrame } from '../../src/subject/queries.js';
import { cameraModelView } from '../support/mat4.js';

const indoor = flatMap({ name: 'fixture_indoor', indoor: true });

describe('CAM', () => {
	rule(
		'R-CAM-001',
		'zoom clamp [65, 325] outdoors, max 162.5 indoors, CameraMaxZoomOut override, wheel step 15',
		async s => {
			const out = await run(
				s,
				inGame('cam-001-out')
					.input({ type: 'wheel', delta: 1000 })
					.advance(5000, 1)
					.input({ type: 'wheel', delta: -1000 })
					.advance(5000, 1)
			);
			expect(out.frames[0].camera.zoomFinal).toBe(325);
			expect(out.frames[1].camera.zoomFinal).toBe(65);
			const ind = await run(
				s,
				inGame('cam-001-in', { map: indoor }).input({ type: 'wheel', delta: 1000 }).advance(5000, 1)
			);
			expect(lastFrame(ind).camera.zoomFinal).toBe(162.5);
			const cfg = await run(
				s,
				inGame('cam-001-cfg', { config: { CameraMaxZoomOut: 3 } })
					.input({ type: 'wheel', delta: 1000 })
					.advance(5000, 1)
			);
			expect(lastFrame(cfg).camera.zoomFinal).toBe(195);
			const step = await run(s, inGame('cam-001-step').input({ type: 'wheel', delta: 1 }).advance(17));
			expect(lastFrame(step).camera.zoomFinal).toBe(125 + 15);
		}
	);

	rule('R-CAM-002', 'initial pitch 230, yaw 0, zoom 125; indoors zoom indoorZoom, pitch 230, yaw -40', async s => {
		const out = await run(s, inGame('cam-002-out').advance(1));
		expect(out.frames[0].camera).toMatchObject({ pitch: 230, yaw: 0, zoomFinal: 125 });
		const ind = await run(s, inGame('cam-002-in', { map: indoor }).advance(1));
		expect(ind.frames[0].camera).toMatchObject({ pitch: 230, yaw: -40, zoomFinal: 125 });
	});

	rule(
		'R-CAM-003',
		'shift-drag pitch Δy/h·300°, clamp iso [190,270], indoor [220,240], 3P [175,270], 1P [90,270]',
		async s => {
			const drag = dy => ({ type: 'rightdrag', shift: true, dx: 0, dy });
			const iso = await run(
				s,
				inGame('cam-003')
					.input(drag(48))
					.advance(5000, 1)
					.input(drag(-10000))
					.advance(5000, 1)
					.input(drag(10000))
					.advance(5000, 1)
			);
			expect(iso.frames[0].camera.pitch).toBeCloseTo(230 + (48 / 480) * 300, 3);
			expect(iso.frames[1].camera.pitch).toBe(190);
			expect(iso.frames[2].camera.pitch).toBe(270);
			const ind = await run(s, inGame('cam-003-in', { map: indoor }).input(drag(-10000)).advance(5000, 1));
			expect(lastFrame(ind).camera.pitch).toBe(220);
			const tp = await run(
				s,
				inGame('cam-003-3p', { config: { ThirdPersonCamera: true } })
					.camera('setZoom', 30)
					.input(drag(-10000))
					.advance(5000, 1)
			);
			expect(lastFrame(tp).camera.pitch).toBe(175);
			const fp = await run(
				s,
				inGame('cam-003-1p', { config: { FirstPersonCamera: true } })
					.camera('setZoom', 0)
					.input(drag(-10000))
					.advance(5000, 1)
			);
			expect(lastFrame(fp).camera.pitch).toBe(90);
		}
	);

	rule('R-CAM-004', 'yaw −Δx/w·720°, outdoor ±360, indoor [−60,−25], rewrap at ±180', async s => {
		const r = await run(s, inGame('cam-004').input({ type: 'rightdrag', dx: -64, dy: 0 }).advance(5000, 1));
		expect(r.frames[0].camera.yaw).toBeCloseTo((64 / 640) * 720, 3);
		const wrap = await run(
			s,
			inGame('cam-004-wrap').input({ type: 'rightdrag', dx: -200, dy: 0 }).advance(5000, 1)
		);
		expect(lastFrame(wrap).camera.yaw).toBeCloseTo(225 - 360, 3);
		const ind = await run(
			s,
			inGame('cam-004-in', { map: indoor }).input({ type: 'rightdrag', dx: -10000, dy: 0 }).advance(5000, 1)
		);
		expect(lastFrame(ind).camera.yaw).toBeGreaterThanOrEqual(-60);
		expect(lastFrame(ind).camera.yaw).toBeLessThanOrEqual(-25);
	});

	rule('R-CAM-005', 'double right-click (<500 ms, <10 px): shift→pitch, ctrl→zoom 125, else yaw', async s => {
		const dbl = mods => [
			{ type: 'rightdown', x: 100, y: 100, ...mods },
			{ type: 'rightdown', x: 104, y: 100, at: 300, ...mods }
		];
		const base = inGame('cam-005')
			.camera('rotate', 90)
			.camera('setZoom', 200)
			.input({ type: 'rightdrag', shift: true, dx: 0, dy: 40 })
			.advance(5000, 1);
		for (const e of dbl({})) {
			base.input(e);
		}
		base.advance(5000, 1);
		for (const e of dbl({ shift: true })) {
			base.input(e);
		}
		base.advance(5000, 1);
		for (const e of dbl({ ctrl: true })) {
			base.input(e);
		}
		base.advance(5000, 1);
		const r = await run(s, base);
		expect(r.frames[1].camera.yaw).toBeCloseTo(0, 3);
		expect(r.frames[2].camera.pitch).toBeCloseTo(230, 3);
		expect(r.frames[3].camera.zoomFinal).toBe(125);
	});

	rule('R-CAM-006', 'lerp = min(Δt·0.006, 1); zoom/angles by 2·lerp; smooth off snaps', async s => {
		const r = await run(s, inGame('cam-006').camera('setZoom', 225).advance(16, 1));
		const lerp = 16 * 0.006;
		expect(r.frames[0].camera.zoom).toBeCloseTo(125 + (225 - 125) * lerp * 2, 3);
		const snap = await run(
			s,
			inGame('cam-006-snap', { prefs: { smooth: false } })
				.entity({ gid: 1, type: 'npc', position: [25, 25, 0] })
				.camera('setTarget', 1)
				.advance(16, 1)
		);
		expect(snap.frames[0].camera.position.slice(0, 2)).toEqual([25, 25]);
	});

	rule(
		'R-CAM-007',
		'MV = Tz(−zoom/2)·Rx(pitch)·Ry(yaw)·T(−x−0.5, h+zOffset, −y−0.5); normal = inverse-transpose',
		async s => {
			const r = await run(s, inGame('cam-007', { prefs: { smooth: false } }).advance(16));
			const c = lastFrame(r).camera;
			const [x, y] = c.position;
			const h = c.targetHeight; // terrain height term used by the camera (flat fixture: 0)
			const expected = cameraModelView({ zoom: c.zoom, pitch: c.pitch, yaw: c.yaw, x, y, h, zOffset: c.zOffset });
			c.modelView.forEach((v, i) => expect(v).toBeCloseTo(expected[i], 4));
			// orbit focus = −(last translation)
			expect(c.focus[0]).toBeCloseTo(x + 0.5, 5);
			expect(c.focus[1]).toBeCloseTo(-(h + c.zOffset), 5);
			expect(c.focus[2]).toBeCloseTo(y + 0.5, 5);
		}
	);

	rule('R-CAM-008', 'direction = floor((yaw+22.5)/45) % 8; yaw 50 → 1', async s => {
		const r = await run(
			s,
			inGame('cam-008', { prefs: { smooth: false } })
				.camera('rotate', 50)
				.advance(16)
		);
		expect(lastFrame(r).camera.direction).toBe(1);
	});

	rule(
		'R-CAM-009',
		'1P: vFov 50, zOffset 2, own entity hidden; 3P: vFov 30, zOffset 1.5; iso vFov 15; mode change resizes',
		async s => {
			const fp = await run(
				s,
				inGame('cam-009-1p', { config: { FirstPersonCamera: true } })
					.camera('setZoom', 0)
					.advance(5000, 1)
			);
			const f = lastFrame(fp);
			expect(f.camera).toMatchObject({ mode: 'first', vFov: 50, zOffset: 2 });
			expect(f.records.filter(x => x.kind === 'sprite' && x.owner?.gid === LOCAL_GID)).toHaveLength(0);
			expect(f.viewport.resizes).toBeGreaterThan(0);
			const tp = await run(
				s,
				inGame('cam-009-3p', { config: { ThirdPersonCamera: true } })
					.camera('setZoom', 30)
					.advance(5000, 1)
			);
			expect(lastFrame(tp).camera).toMatchObject({ mode: 'third', vFov: 30, zOffset: 1.5 });
			const iso = await run(s, inGame('cam-009-iso').advance(16));
			expect(lastFrame(iso).camera).toMatchObject({ mode: 'iso', vFov: 15 });
		}
	);

	rule(
		'R-CAM-010',
		'quake: 650 ms default, (rand[−.25,.25]+amount)·0.1 (pitch /15), sign flips each frame; seeded',
		async s => {
			const script = inGame('cam-010', { prefs: { smooth: false } })
				.camera('setQuake', 0)
				.frames(50, 16);
			const a = await run(s, script);
			const b = await run(s, script);
			expect(a.frames.map(f => f.camera.zoom)).toEqual(b.frames.map(f => f.camera.zoom)); // deterministic under SeededRng
			const during = a.frames.filter(f => f.tick <= 650).map(f => f.camera.zoom - 125);
			const after = a.frames.filter(f => f.tick > 700).map(f => f.camera.zoom - 125);
			expect(during.some(d => d !== 0)).toBe(true);
			after.forEach(d => expect(d).toBeCloseTo(0, 6));
		}
	);

	rule('R-CAM-011', 'zoom saved 3 s after the last change; indoor/outdoor separately', async s => {
		const r = await run(s, inGame('cam-011').camera('setZoom', 200).advance(2999, 1).advance(2, 1));
		expect(r.frames[0].preferencesWritten).not.toHaveProperty('zoom');
		expect(lastFrame(r).preferencesWritten).toMatchObject({ zoom: 200 });
		const ind = await run(s, inGame('cam-011-in', { map: indoor }).camera('setZoom', 100).advance(3001, 1));
		expect(lastFrame(ind).preferencesWritten).toMatchObject({ indoorZoom: 100 });
	});
});
