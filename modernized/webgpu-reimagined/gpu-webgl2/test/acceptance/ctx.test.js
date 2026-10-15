import { describe, expect, it } from 'vitest';
import { GLDevice } from '../../src/device/GLDevice.js';
import { onRenderError } from '../../src/device/frameErrorPolicy.js';
import { GLStateCache } from '../../src/pipeline/GLStateCache.js';
import { GL } from '../../src/pipeline/glEnums.js';
import { ContextUnavailableError } from '../../src/errors.js';
import { MAP_FRAME_STEPS, runMapFrame } from '../../src/frame/passOrder.js';
import { clearColorFor, envColor, lightDirection } from '../../src/world/lighting.js';
import { WebGL2Backend } from '../../src/WebGL2Backend.js';
import { createFakeCanvas, createFakeGl, createFakePorts } from '../support/fakeGl.js';
import { ADDITIVE, sprite } from '../support/records.js';

describe('R-CTX-001 WebGL2 context with fixed attributes', () => {
	it('requests webgl2 with the fixed attribute set', () => {
		const canvas = createFakeCanvas();
		new GLDevice({ canvas }).init();
		expect(canvas.requests[0]).toEqual({
			name: 'webgl2',
			attrs: {
				alpha: false,
				depth: true,
				stencil: false,
				antialias: true,
				premultipliedAlpha: false,
				preserveDrawingBuffer: true,
				powerPreference: 'high-performance'
			}
		});
	});

	it('falls back to experimental-webgl2', () => {
		const gl = createFakeGl();
		const canvas = createFakeCanvas({ contexts: { 'experimental-webgl2': gl } });
		const device = new GLDevice({ canvas });
		expect(device.init()).toBe(gl);
		expect(device.contextName).toBe('experimental-webgl2');
	});

	it('throws and does not render when no context is available', () => {
		const canvas = createFakeCanvas({ contexts: {} });
		expect(() => new GLDevice({ canvas }).init()).toThrow(ContextUnavailableError);
	});
});

describe('R-CTX-002 default GL state', () => {
	it('sets clearDepth 1, depth test LEQUAL, blend SRC_ALPHA/ONE_MINUS_SRC_ALPHA at init', () => {
		const gl = createFakeGl();
		new GLDevice({ canvas: createFakeCanvas({ contexts: { webgl2: gl } }) }).init();
		expect(gl.callsTo('clearDepth')).toEqual([['clearDepth', 1.0]]);
		expect(gl.callsTo('enable')).toEqual(expect.arrayContaining([['enable', GL.DEPTH_TEST], ['enable', GL.BLEND]]));
		expect(gl.callsTo('depthFunc')).toEqual([['depthFunc', GL.LEQUAL]]);
		expect(gl.callsTo('blendFunc')).toEqual([['blendFunc', GL.SRC_ALPHA, GL.ONE_MINUS_SRC_ALPHA]]);
	});

	it('a pass that changes blend restores the default afterwards', () => {
		const gl = createFakeGl();
		const state = new GLStateCache(gl);
		state.apply(sprite({ blend: ADDITIVE }));
		state.restoreDefault();
		expect(gl.callsTo('blendFunc').at(-1)).toEqual(['blendFunc', GL.SRC_ALPHA, GL.ONE_MINUS_SRC_ALPHA]);
	});
});

describe('R-CTX-005 render error turns bloom off', () => {
	it('turns bloom off permanently and continues when the context is alive', () => {
		const ports = createFakePorts({ settings: { bloom: true } });
		expect(onRenderError({ contextLost: false, settings: ports.settings })).toBe('continue');
		expect(ports.settings.get('bloom')).toBe(false);
	});

	it('exits the loop when the context is lost', () => {
		const ports = createFakePorts({ settings: { bloom: true } });
		expect(onRenderError({ contextLost: true, settings: ports.settings })).toBe('exit');
		expect(ports.settings.get('bloom')).toBe(true);
	});
});

function lossFixture() {
	const ports = createFakePorts();
	const gl = createFakeGl();
	const canvas = createFakeCanvas({ contexts: { webgl2: gl } });
	const backend = new WebGL2Backend({ ...ports, canvas }).init();
	return { ports, gl, canvas, backend };
}

describe('R-CTX-006 context loss', () => {
	it('prevents default, stops rendering, purges caches and shows the overlay', () => {
		const { ports, canvas, backend } = lossFixture();
		let prevented = false;
		canvas.fire('webglcontextlost', { preventDefault: () => (prevented = true) });
		expect(prevented).toBe(true);
		expect(backend.running).toBe(false);
		expect(ports.log).toContainEqual(['assets.purge', ['.bmp', '.jpg', '.png', '.spr', '.pal', '.str']]);
		expect(ports.log).toContainEqual(['overlay.show', { background: 'rgba(0,0,0,0.85)', zIndex: 10000, title: 'Graphics Context Lost' }]);
		expect(backend.residency.residentCount).toBe(0);
	});

	it('ignores resize while lost', () => {
		const { canvas, backend } = lossFixture();
		canvas.fire('webglcontextlost');
		expect(backend.resize(100, 100)).toBe(false);
	});

	it('drawFrame does nothing while lost', () => {
		const { canvas, backend } = lossFixture();
		canvas.fire('webglcontextlost');
		expect(backend.drawFrame({ passes: {} })).toEqual([]);
	});
});

describe('R-CTX-007 context restore', () => {
	it('hides overlay, reapplies default state, reinits post, resizes, rebuilds map, resumes', () => {
		const { ports, gl, canvas, backend } = lossFixture();
		const reinit = [];
		backend.post._targets = { resize: () => reinit.push('resize'), reinit: names => reinit.push(['reinit', names]) };
		canvas.fire('webglcontextlost');
		gl.clearCalls();
		canvas.fire('webglcontextrestored');
		expect(ports.log).toContainEqual(['overlay.hide']);
		expect(gl.callsTo('depthFunc')).toEqual([['depthFunc', GL.LEQUAL]]);
		expect(gl.callsTo('blendFunc')).toEqual([['blendFunc', GL.SRC_ALPHA, GL.ONE_MINUS_SRC_ALPHA]]);
		expect(reinit[0]).toEqual(['reinit', []]);
		expect(reinit).toContain('resize');
		// Fix of legacy restore (architecture §2.2): the map is rebuilt.
		expect(ports.log).toContainEqual(['scene.rebuildMap']);
		expect(backend.running).toBe(true);
	});
});

describe('R-CTX-009 clear colour from the map sky', () => {
	it('uses skyColor when the map has an entry', () => {
		expect(clearColorFor({ skyColor: [0.4, 0.6, 0.8, 1], cloudColor: [1, 1, 1] })).toEqual({ color: [0.4, 0.6, 0.8, 1], clouds: true });
	});
	it('uses opaque black and no clouds when the map has no entry', () => {
		expect(clearColorFor(undefined)).toEqual({ color: [0, 0, 0, 1], clouds: false });
	});
});

describe('R-CTX-010 map render pass order', () => {
	it('lists the 25 steps in legacy order', () => {
		expect(MAP_FRAME_STEPS.map(s => s.id)).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
		expect(MAP_FRAME_STEPS.map(s => s.name)).toEqual([
			'postPrepare', 'cameraUpdate', 'ground', 'mapEffectEmitters', 'groundPickAndGridSelector', 'skyClouds',
			'occluderFadeBegin', 'staticModels', 'animatedModels', 'entityCull', 'gr2Models',
			'screenEffectsBeforeEntities', 'effectsBeforeEntities', 'entities', 'water', 'fadedModels',
			'effectsAfterEntities', 'effectEntities', 'damageNumbers', 'signboards', 'screenEffects', 'sounds',
			'entityPick', 'memoryClean', 'postProcess'
		]);
	});

	it('interleaves GPU passes and scene steps in that order', () => {
		const trace = [];
		const passes = Object.fromEntries(MAP_FRAME_STEPS.filter(s => s.owner === 'gpu').map(s => [s.name, () => trace.push(s.name)]));
		runMapFrame(passes, { runStep: n => trace.push(n), currentMap: () => null });
		expect(trace).toEqual(MAP_FRAME_STEPS.map(s => s.name));
	});

	it('entities are drawn before water, effect entities after (backend frame)', () => {
		const { gl, backend } = lossFixture();
		gl.clearCalls();
		const order = backend.drawFrame({ passes: { entities: [sprite()], water: [], effectEntities: [sprite()] } });
		expect(order.indexOf('entities')).toBeLessThan(order.indexOf('water'));
		expect(order.indexOf('water')).toBeLessThan(order.indexOf('effectEntities'));
	});
});

describe('R-CTX-012 global light setup', () => {
	it('env = 1 − (1 − D)(1 − A) per channel', () => {
		const env = envColor([0.5, 0.2, 1], [0.5, 0.5, 0]);
		expect(env[0]).toBeCloseTo(0.75);
		expect(env[1]).toBeCloseTo(0.6);
		expect(env[2]).toBeCloseTo(1);
	});
	it('direction = −(RotY(lon)·RotX(lat)·(0,1,0))', () => {
		const d = lightDirection(0, 0);
		expect(d[0]).toBeCloseTo(0);
		expect(d[1]).toBeCloseTo(-1);
		expect(d[2]).toBeCloseTo(0);
		const e = lightDirection(90, 90);
		expect(e[0]).toBeCloseTo(-1);
		expect(e[1]).toBeCloseTo(0);
		expect(e[2]).toBeCloseTo(0);
	});
});
