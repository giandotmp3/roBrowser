import { describe, it, expect } from 'vitest';
import { Camera } from '../../src/domain/Camera.js';
import { transformVec4 } from '../../src/math/mat4.js';
import { FakeTimers, seededRng } from '../support/fakes.js';

const outdoor = (opts = {}) => {
	const c = new Camera({ rng: seededRng(), ...opts });
	c.init({ indoor: false });
	return c;
};

describe('R-CAM-001 zoom limits', () => {
	it('[R-CAM-001] outdoor iso zoomFinal clamps to [65, 325]', () => {
		const c = outdoor();
		expect(c.zoomRange()).toEqual([65, 325]);
		c.setZoom(10_000);
		expect(c.zoomFinal).toBe(325);
		c.setZoom(0);
		expect(c.zoomFinal).toBe(65);
	});

	it('[R-CAM-001] indoor max is 65 * 2.5 = 162.5', () => {
		const c = new Camera();
		c.init({ indoor: true });
		expect(c.zoomRange()[1]).toBe(162.5);
	});

	it('[R-CAM-001] CameraMaxZoomOut overrides MAX_ZOOM', () => {
		expect(outdoor({ config: { maxZoomOut: 8 } }).zoomRange()[1]).toBe(520);
	});

	it('[R-CAM-001] wheel step is 15*mult; ctrl-drag is dy*(15*mult/10) per pixel', () => {
		const c = outdoor();
		c.wheel(1);
		expect(c.zoomFinal).toBe(140);
		c.ctrlDragZoom(10);
		expect(c.zoomFinal).toBe(155);
	});
});

describe('R-CAM-002 initial camera', () => {
	it('[R-CAM-002] outdoors: pitch 230, yaw 0, zoom = saved preference (default 125)', () => {
		const c = outdoor();
		expect([c.angleFinal[0], c.angleFinal[1], c.zoomFinal]).toEqual([230, 0, 125]);
		const p = new Camera({ prefs: { zoom: 200 } });
		p.init({ indoor: false });
		expect(p.zoomFinal).toBe(200);
	});

	it('[R-CAM-002] indoors: zoom = indoorZoom (default 125), pitch 230, yaw -40', () => {
		const c = new Camera();
		c.init({ indoor: true });
		expect([c.angleFinal[0], c.angleFinal[1], c.zoomFinal]).toEqual([230, -40, 125]);
	});
});

describe('R-CAM-003 pitch limits', () => {
	it('[R-CAM-003] pitch moves by dy/screenHeight*300 deg', () => {
		const c = outdoor();
		c.dragPitch(100, 1000);
		expect(c.angleFinal[0]).toBe(260);
	});

	it('[R-CAM-003] iso clamp [190,270], indoor [220,240], third [175,270], first [90,270]', () => {
		const c = outdoor();
		c.dragPitch(10_000, 1000);
		expect(c.angleFinal[0]).toBe(270);
		c.dragPitch(-10_000, 1000);
		expect(c.angleFinal[0]).toBe(190);
		c.indoor = true;
		expect(c.pitchRange()).toEqual([220, 240]);
		c.mode = 'third';
		expect(c.pitchRange()).toEqual([175, 270]);
		c.mode = 'first';
		expect(c.pitchRange()).toEqual([90, 270]);
	});

	it.fails('[R-CAM-003][pending R-CAM-009] in third/first person a plain drag also changes pitch', () => {
		const c = outdoor({ config: { thirdPerson: true } });
		c.setZoom(30);
		c.resolveMode();
		const before = c.angleFinal[0];
		c.rightDrag(0, 100, { width: 1000, height: 1000 });
		expect(c.angleFinal[0]).not.toBe(before);
	});
});

describe('R-CAM-004 yaw limits', () => {
	it('[R-CAM-004] yaw moves by -dx/screenWidth*720 deg', () => {
		const c = outdoor();
		c.dragYaw(10, 720);
		expect(c.angleFinal[1]).toBe(-10);
	});

	it('[R-CAM-004] current and target yaw are rewrapped by 360 when they pass 180', () => {
		const c = outdoor();
		c.angle[1] = c.angleFinal[1] = 170;
		c.dragYaw(-20, 720);
		expect(c.angleFinal[1]).toBe(-170);
		expect(c.angle[1]).toBe(-190);
	});

	it('[R-CAM-004] indoor clamp [-60, -25]', () => {
		const c = new Camera();
		c.init({ indoor: true });
		c.dragYaw(-10_000, 720);
		expect(c.angleFinal[1]).toBe(-25);
		c.dragYaw(10_000, 720);
		expect(c.angleFinal[1]).toBe(-60);
	});
});

describe('R-CAM-005 double right-click resets', () => {
	it.fails('[R-CAM-005][pending] Shift double right-click resets pitch to 230 outdoors', () => {
		const c = outdoor();
		c.angleFinal[0] = 260;
		c.rightPress({ x: 100, y: 100, tick: 0, shift: true });
		c.rightPress({ x: 105, y: 103, tick: 400, shift: true });
		expect(c.angleFinal[0]).toBe(230);
	});

	it.fails('[R-CAM-005][pending] Ctrl double right-click resets zoom to 125; plain resets yaw (0 / -25 indoors)', () => {
		const c = outdoor();
		c.setZoom(300);
		c.rightPress({ x: 0, y: 0, tick: 0, ctrl: true });
		c.rightPress({ x: 0, y: 0, tick: 100, ctrl: true });
		expect(c.zoomFinal).toBe(125);
		c.angleFinal[1] = 90;
		c.rightPress({ x: 0, y: 0, tick: 1000 });
		c.rightPress({ x: 0, y: 0, tick: 1100 });
		expect(c.angleFinal[1]).toBe(0);
	});
});

describe('R-CAM-006 smoothing', () => {
	it('[R-CAM-006] lerp = min(dt*0.006, 1)', () => {
		expect(Camera.lerpFactor(16)).toBeCloseTo(0.096, 10);
		expect(Camera.lerpFactor(1000)).toBe(1);
	});

	it('[R-CAM-006] position follows by lerp; zoom and angles by lerp*2', () => {
		const c = outdoor({ prefs: { smooth: true } });
		c.setTarget({ position: [10, 20, 3] });
		c.zoom = 125;
		c.zoomFinal = 225;
		c.lastTick = 0;
		c.update(16);
		expect(c.position[0]).toBeCloseTo(-10 * 0.096, 6);
		expect(c.position[2]).toBeCloseTo(3 * 0.096, 6);
		expect(c.zoom).toBeCloseTo(125 + 100 * 0.192, 6);
	});

	it('[R-CAM-006] snaps when the smooth preference is off', () => {
		const c = outdoor({ prefs: { smooth: false } });
		c.setTarget({ position: [10, 20, 3] });
		c.update(16);
		expect(c.position).toEqual([-10, -20, 3]);
	});
});

describe('R-CAM-007 view matrix', () => {
	it('[R-CAM-007] the orbit focus maps to (0, 0, (0 - zoom)/2) in view space', () => {
		const c = outdoor({ prefs: { smooth: false } });
		c.setTarget({ position: [10, 20, 3] });
		c.zoom = c.zoomFinal = 125;
		c.angle = [230, 30];
		c.angleFinal = [230, 30];
		c.update(16);
		expect(c.focus.map((v) => Math.round(v * 1e6) / 1e6)).toEqual([10.5, -3, 20.5]);
		const v = transformVec4(c.modelView, [...c.focus, 1]);
		expect(v[0]).toBeCloseTo(0, 4);
		expect(v[1]).toBeCloseTo(0, 4);
		expect(v[2]).toBeCloseTo(-62.5, 4);
	});

	it('[R-CAM-007] normal matrix is the inverse-transpose of MV (equals MV rotation for rigid MV)', () => {
		const c = outdoor({ prefs: { smooth: false } });
		c.setTarget({ position: [1, 2, 0] });
		c.update(16);
		for (const i of [0, 1, 2, 4, 5, 6, 8, 9, 10]) {
			expect(c.normalMat[i]).toBeCloseTo(c.modelView[i], 5);
		}
	});
});

describe('R-CAM-008 camera direction index', () => {
	it('[R-CAM-008] yaw 50 -> floor((50+22.5)/45) % 8 = 1', () => {
		expect(Camera.directionFromYaw(50)).toBe(1);
		expect(Camera.directionFromYaw(0)).toBe(0);
		expect(Camera.directionFromYaw(337.5)).toBe(0);
	});

	it('[R-CAM-008] update() publishes direction from the current yaw', () => {
		const c = outdoor({ prefs: { smooth: false } });
		c.angle[1] = c.angleFinal[1] = 50;
		c.update(16);
		expect(c.direction).toBe(1);
	});
});

describe('R-CAM-009 first- and third-person modes', () => {
	it.fails('[R-CAM-009][pending] first person (zoomFinal 0): vFov 50, zOffset 2', () => {
		const c = outdoor({ config: { firstPerson: true } });
		c.zoomFinal = 0;
		expect(c.resolveMode()).toEqual({ mode: 'first', vFov: 50, zOffset: 2 });
	});

	it.fails('[R-CAM-009][pending] third person (zoomFinal < 65): vFov 30, zOffset 1.5; otherwise iso vFov 15', () => {
		const c = outdoor({ config: { thirdPerson: true } });
		c.zoomFinal = 40;
		expect(c.resolveMode()).toEqual({ mode: 'third', vFov: 30, zOffset: 1.5 });
		c.zoomFinal = 100;
		expect(c.resolveMode()).toEqual({ mode: 'iso', vFov: 15, zOffset: 0 });
	});
});

describe('R-CAM-010 screen quake', () => {
	it.fails('[R-CAM-010][pending] perturbs zoom within the 650 ms window and stops after it', () => {
		const c = outdoor({ prefs: { smooth: false } });
		c.setTarget({ position: [5, 5, 0] });
		c.update(0);
		c.setQuake(0);
		const base = c.zoom;
		c.update(16);
		expect(c.zoom).not.toBe(base);
		c.update(700);
		const settled = c.zoom;
		c.update(716);
		expect(c.zoom).toBeCloseTo(settled, 6);
	});
});

describe('R-CAM-011 zoom is saved', () => {
	it.fails('[R-CAM-011][pending] saves outdoor zoom 3 s after the last change', () => {
		const timers = new FakeTimers();
		const prefs = { zoom: 125, indoorZoom: 125, save: () => {} };
		const c = new Camera({ timers, prefs });
		c.init({ indoor: false });
		c.setZoom(200);
		c.scheduleZoomSave();
		timers.advanceTo(2999);
		expect(prefs.zoom).toBe(125);
		timers.advanceTo(3000);
		expect(prefs.zoom).toBe(200);
		expect(prefs.indoorZoom).toBe(125);
	});
});
