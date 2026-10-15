import { describe, expect, it, vi } from 'vitest';
import { createFakeGpu, fakeSettings } from '../support/fakeGpu.js';
import {
	CONTEXT_LOST_OVERLAY,
	DEFAULT_PIPELINE_STATE,
	DeviceLossController,
	DeviceUnavailableError,
	MAP_FRAME_STEPS,
	NORMAL,
	OffscreenTarget,
	PURGE_ON_LOSS_EXTENSIONS,
	RenderDevice,
	describePipeline,
	globalLight,
	onRenderError,
	runMapFrame,
	selectBackend,
	skyForMap
} from '../../src/index.js';

describe('CTX: device, frame, loss', () => {
	it('R-CTX-001: requests a high-performance adapter, opaque canvas, 4x MSAA rgba8unorm + depth, no stencil', async () => {
		const fake = createFakeGpu();
		const rd = await new RenderDevice({ gpu: fake.gpu, canvas: fake.canvas }).init();
		expect(fake.calls.find(c => c[0] === 'requestAdapter')[1]).toEqual({ powerPreference: 'high-performance' });
		expect(fake.calls.find(c => c[0] === 'context.configure')[1]).toMatchObject({ alphaMode: 'opaque', device: rd.device });
		const d = OffscreenTarget.descriptors(800, 600);
		expect(d.msaa).toMatchObject({ format: 'rgba8unorm', sampleCount: 4 });
		expect(d.depth.format).toBe('depth24plus'); // no stencil aspect
		expect(d.resolve.sampleCount).toBe(1);
	});

	it('R-CTX-001: with no adapter it throws and does not render; the facade selects webgl2', async () => {
		const fake = createFakeGpu({ adapter: false });
		await expect(new RenderDevice({ gpu: fake.gpu, canvas: fake.canvas }).init()).rejects.toBeInstanceOf(DeviceUnavailableError);
		await expect(new RenderDevice({ gpu: undefined, canvas: fake.canvas }).init()).rejects.toBeInstanceOf(DeviceUnavailableError);
		const sel = await selectBackend({ gpu: fake.gpu, canvas: fake.canvas });
		expect(sel.backend).toBe('webgl2');
	});

	it('R-CTX-002: default pipeline state is clearDepth 1, less-equal, SRC_ALPHA/ONE_MINUS_SRC_ALPHA; per-pipeline state cannot leak', () => {
		expect(DEFAULT_PIPELINE_STATE.clearDepth).toBe(1.0);
		expect(DEFAULT_PIPELINE_STATE.depthCompare).toBe('less-equal');
		expect(DEFAULT_PIPELINE_STATE.blend.color).toMatchObject({ srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' });
		const desc = describePipeline({ family: 'sprite', blend: NORMAL, depthTest: true, depthWrite: true }, { module: {}, layout: 'auto' });
		expect(desc.depthStencil.depthCompare).toBe('less-equal');
		expect(desc.fragment.targets[0].blend.color).toMatchObject({ srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' });
		const t = new OffscreenTarget({ createTexture: d => ({ d, createView: () => ({}), destroy() {} }) });
		t.resize(4, 4);
		expect(t.passDescriptor([0, 0, 0, 1]).depthStencilAttachment.depthClearValue).toBe(1.0);
	});

	it('R-CTX-005: a render error with the device alive turns bloom off permanently', () => {
		const settings = fakeSettings({ bloom: true });
		expect(onRenderError({ deviceLost: false, settings })).toEqual({ action: 'continue', bloomDisabled: true });
		expect(settings.store.bloom).toBe(false);
		expect(onRenderError({ deviceLost: false, settings })).toEqual({ action: 'continue', bloomDisabled: false });
	});

	it('R-CTX-005: a render error with the device lost exits the loop', () => {
		const settings = fakeSettings({ bloom: true });
		expect(onRenderError({ deviceLost: true, settings }).action).toBe('exit');
		expect(settings.store.bloom).toBe(true);
	});

	it('R-CTX-006: device loss stops rendering, purges image/sprite caches, shows the overlay and ignores resize', () => {
		const overlay = { show: vi.fn(), hide: vi.fn() };
		const assets = { purge: vi.fn() };
		const ctl = new DeviceLossController({ overlay, assets, scene: /** @type {any} */ ({}), fallback: /** @type {any} */ ({}), createDevice: vi.fn() });
		ctl.onLost();
		expect(ctl.rendering).toBe(false);
		expect(assets.purge).toHaveBeenCalledWith(PURGE_ON_LOSS_EXTENSIONS);
		expect([...PURGE_ON_LOSS_EXTENSIONS].sort()).toEqual(['.bmp', '.jpg', '.pal', '.png', '.spr', '.str']);
		expect(overlay.show).toHaveBeenCalledWith({ background: 'rgba(0,0,0,0.85)', zIndex: 10000, title: 'Graphics Context Lost' });
		expect(CONTEXT_LOST_OVERLAY.title).toBe('Graphics Context Lost');
		expect(ctl.shouldHandleResize()).toBe(false);
	});

	it('R-CTX-007: rebuild hides the overlay, recreates pipelines/post targets, reconfigures previews, re-runs setMap(currentMap) and resumes', async () => {
		const fake = createFakeGpu();
		const order = [];
		const overlay = { show: vi.fn(), hide: vi.fn(() => order.push('hide')) };
		const scene = {
			runStep: vi.fn(),
			currentMap: () => 'prontera',
			setMap: vi.fn(async () => order.push('setMap'))
		};
		const previews = { reconfigureAll: vi.fn(() => order.push('previews')) };
		const postChain = { rebuild: vi.fn(async () => order.push('post')) };
		const pipelines = { rebuild: vi.fn(async () => order.push('pipelines')) };
		const residency = { purgeAll: vi.fn(), reset: vi.fn(() => order.push('residency')) };
		const ctl = new DeviceLossController({
			overlay,
			assets: { purge: vi.fn() },
			scene,
			fallback: { switchToWebgl2: vi.fn() },
			previews,
			postChain,
			pipelines,
			residency,
			createDevice: () => new RenderDevice({ gpu: fake.gpu, canvas: fake.canvas }).init()
		});
		ctl.onLost({ reason: 'unknown', message: 'gpu reset' });
		expect(residency.purgeAll).toHaveBeenCalledTimes(1);
		expect(await ctl.rebuild()).toBe('webgpu');
		const device = fake.devices[0];
		expect(overlay.hide).toHaveBeenCalled();
		expect(pipelines.rebuild).toHaveBeenCalledWith(device);
		expect(postChain.rebuild).toHaveBeenCalledWith(device);
		expect(previews.reconfigureAll).toHaveBeenCalledWith(device);
		expect(residency.reset).toHaveBeenCalledWith(device);
		expect(scene.setMap).toHaveBeenCalledWith('prontera');
		// GPU objects first, then the overlay goes and the map is rebuilt (the legacy restore never did).
		expect(order).toEqual(['residency', 'pipelines', 'post', 'previews', 'hide', 'setMap']);
		expect(fake.calls.filter(c => c[0] === 'context.configure')).toHaveLength(1); // main canvas on the new device
		expect(ctl.rendering).toBe(true);
		expect(ctl.lost).toBe(false);
		expect(ctl.shouldHandleResize()).toBe(true);
		expect(ctl.lastLoss).toEqual({ reason: 'unknown', message: 'gpu reset' });
	});

	it('R-CTX-007: with no adapter on rebuild, switches to gpu-webgl2 mid-session', async () => {
		const fallback = { switchToWebgl2: vi.fn(async () => {}) };
		const overlay = { show: vi.fn(), hide: vi.fn() };
		const scene = { runStep: vi.fn(), currentMap: () => 'prontera', setMap: vi.fn(async () => {}) };
		const ctl = new DeviceLossController({
			overlay,
			assets: { purge: vi.fn() },
			scene,
			fallback,
			createDevice: async () => {
				throw new DeviceUnavailableError('no adapter');
			}
		});
		ctl.onLost();
		expect(await ctl.rebuild()).toBe('webgl2');
		expect(fallback.switchToWebgl2).toHaveBeenCalledWith('WebGPU unavailable: no adapter');
		expect(overlay.hide).toHaveBeenCalled();
		expect(scene.setMap).toHaveBeenCalledWith('prontera'); // the map is rebuilt on gpu-webgl2
		expect(ctl.active).toBe('webgl2');
		expect(ctl.rendering).toBe(false); // this backend stays stopped
	});

	it("R-CTX-009: clear colour is the map's skyColor; no entry clears opaque black with no clouds", () => {
		const table = { prontera: { skyColor: [0.4, 0.6, 0.8, 1], cloudColor: [1, 1, 1] } };
		expect(skyForMap(table, 'prontera')).toMatchObject({ clearColor: [0.4, 0.6, 0.8, 1], clouds: true });
		expect(skyForMap(table, 'unknown')).toEqual({ clearColor: [0, 0, 0, 1], clouds: false, cloudColor: null });
		const t = new OffscreenTarget({ createTexture: d => ({ d, createView: () => ({}), destroy() {} }) });
		t.resize(2, 2);
		expect(t.passDescriptor([0.4, 0.6, 0.8, 1]).colorAttachments[0].clearValue).toEqual({ r: 0.4, g: 0.6, b: 0.8, a: 1 });
	});

	it('R-CTX-010: the map frame runs its 25 steps in legacy order, delegating non-GPU steps to scene', () => {
		const expected = [
			'postPrepare', 'cameraUpdate', 'ground', 'mapEffectEmitters', 'groundPickAndGrid', 'skyClouds', 'occluderFadeBegin',
			'staticModels', 'animatedModels', 'entityCull', 'gr2Models', 'screenEffectsBeforeEntities', 'effectsBeforeEntities',
			'entitiesNonEffect', 'water', 'fadedModels', 'effectsAfterEntities', 'effectEntities', 'damageNumbers', 'signboards',
			'screenEffects', 'sounds', 'entityPick', 'memoryClean', 'postProcess'
		];
		expect(MAP_FRAME_STEPS.map(s => s.step)).toEqual(expected);
		const order = [];
		const gpuSteps = Object.fromEntries(MAP_FRAME_STEPS.filter(s => s.owner === 'gpu').map(s => [s.step, () => order.push(`gpu:${s.step}`)]));
		const scene = { runStep: step => order.push(`scene:${step}`), currentMap: () => null, setMap: async () => {} };
		runMapFrame(gpuSteps, scene);
		expect(order.map(o => o.split(':')[1])).toEqual(expected);
		expect(order.filter(o => o.startsWith('scene:'))).toEqual(['scene:cameraUpdate', 'scene:entityCull', 'scene:signboards', 'scene:sounds', 'scene:entityPick', 'scene:memoryClean']);
	});

	it('R-CTX-012: env = 1-(1-D)(1-A); light direction = -(RotY(lon)·RotX(lat)·(0,1,0))', () => {
		const l = globalLight({ diffuse: [0.5, 0.5, 0.5], ambient: [0.5, 0.2, 0], longitude: 0, latitude: 0 });
		expect(l.env[0]).toBeCloseTo(0.75);
		expect(l.env[1]).toBeCloseTo(0.6);
		expect(l.env[2]).toBeCloseTo(0.5);
		l.direction.forEach((v, i) => expect(v).toBeCloseTo([0, -1, 0][i]));
		const l2 = globalLight({ diffuse: [1, 1, 1], ambient: [0, 0, 0], longitude: 90, latitude: 90 });
		// RotX(90)·(0,1,0) = (0,0,1); RotY(90)·(0,0,1) = (1,0,0); negated -> (-1,0,0)
		l2.direction.forEach((v, i) => expect(v).toBeCloseTo([-1, 0, 0][i]));
	});
});
