import { describe, expect, it, vi } from 'vitest';
import { createFakeGpu, fakeSettings } from '../support/fakeGpu.js';
import {
	CONTEXT_LOST_OVERLAY,
	MAP_FRAME_STEPS,
	PURGE_ON_LOSS_EXTENSIONS,
	WebGpuBackend,
	backingStoreSize
} from '../../src/index.js';
import { NORMAL } from '../../src/pipelines/pipelineKey.js';

const sprite = (fields = {}) => ({
	kind: 'sprite',
	texture: 'f',
	palette: 'p',
	textureClass: 'indexed',
	sampler: 'nearest',
	position: [1, 2, 3],
	offset: [0, 0],
	size: [64, 128],
	angle: 0,
	color: [1, 1, 1, 1],
	shadowFactor: 1,
	zIndex: 0,
	depthBias: 0,
	blend: NORMAL,
	depthTest: true,
	depthWrite: true,
	depthCorrection: true,
	ignoreDepthMinCap: false,
	...fields
});

const strLayer = (fields = {}) => ({
	kind: 'effect',
	family: 'str',
	pass: 'after',
	texture: 'img:str',
	position: [10, 20, 1],
	color: [1, 0.5, 0.25, 0.75],
	blend: NORMAL,
	depthTest: true,
	depthWrite: false,
	depthCorrection: false,
	fog: false,
	strAttachment: false,
	...fields,
	params: {
		xy: [-20, 20, -10, 10, -30, -30, 30, 30],
		scale: 1,
		angle: 0,
		offset: [-20, 10],
		yLower: 0.5,
		clipZBias: -0.1
	}
});

const SCENE_STEPS = MAP_FRAME_STEPS.filter(s => s.owner === 'scene').map(s => s.step);

/** A backend on the fake GPU with recording ports. */
async function setup({ settings = {}, adapter = true, sampleCount } = {}) {
	const fake = createFakeGpu({ adapter });
	const images = {
		f: { format: 'r8', width: 64, height: 128, data: new Uint8Array(64 * 128) },
		'img:str': { format: 'rgba8', width: 64, height: 32, data: new Uint8Array(64 * 32 * 4) }
	};
	const frames = {
		frame: handle => images[handle] ?? null,
		palette: () => new Uint8Array(1024)
	};
	const steps = [];
	const ports = {
		gpu: fake.gpu,
		canvas: fake.canvas,
		overlay: { show: vi.fn(), hide: vi.fn() },
		assets: { purge: vi.fn() },
		settings: fakeSettings(settings),
		scene: {
			runStep: step => steps.push(step),
			currentMap: () => 'prontera',
			setMap: vi.fn(async () => {})
		},
		fallback: { switchToWebgl2: vi.fn(async () => {}) },
		now: () => 0,
		frames,
		sampleCount
	};
	const backend = await new WebGpuBackend(ports).init();
	return { fake, ports, backend, steps };
}

const passes = fake => fake.calls.filter(c => c[0] === 'beginRenderPass').map(c => c[1]);
const draws = fake => fake.calls.filter(c => c[0] === 'pass.draw');
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('WebGpuBackend: one frame in R-CTX-010 order', () => {
	it('R-CTX-008: backing store = CSS size × quality × DPR', () => {
		expect(backingStoreSize({ cssWidth: 1920, cssHeight: 1080, dpr: 2, quality: 50 })).toEqual({
			width: 1920,
			height: 1080
		});
		expect(backingStoreSize({ cssWidth: 1366, cssHeight: 768, dpr: 1.5 })).toEqual({ width: 2049, height: 1152 });
		expect(backingStoreSize({ cssWidth: 0, cssHeight: 0 })).toEqual({ width: 1, height: 1 });
	});

	it('draws scene steps in legacy order in one scene pass, skips unsupported families with a count, then blits', async () => {
		const { fake, backend, steps } = await setup();
		fake.calls.length = 0;
		const stats = backend.drawFrame(
			{
				ground: [{ kind: 'world', part: 'water' }],
				gr2Models: [{ kind: 'gr2' }],
				entitiesNonEffect: [sprite(), sprite({ zIndex: 1 })],
				effectsAfterEntities: [strLayer(), { ...strLayer(), family: 'cylinder' }, strLayer()]
			},
			{ sky: { clearColor: [0.4, 0.6, 0.8, 1] }, view: { zoom: 30 } }
		);
		expect(stats).toMatchObject({
			drawn: true,
			records: 4,
			unsupportedRecords: 3,
			unsupportedByFamily: { 'world:water': 1, gr2: 1, 'effect:cylinder': 1 },
			drawCalls: 2,
			post: 'blit',
			postPasses: 0,
			captured: false
		});
		expect(backend.stats.unsupportedRecords).toBe(3);
		expect(stats.steps).toEqual(MAP_FRAME_STEPS.map(s => s.step));
		expect(steps).toEqual(SCENE_STEPS); // non-GPU steps delegated to scene, in order
		// One encoder, one submit: the scene pass (sky clear, R-CTX-009), then the blit.
		expect(fake.calls.filter(c => c[0] === 'createCommandEncoder')).toHaveLength(1);
		const [scenePass, blitPass, ...rest] = passes(fake);
		expect(rest).toEqual([]);
		expect(scenePass.colorAttachments[0]).toMatchObject({ clearValue: { r: 0.4, g: 0.6, b: 0.8, a: 1 } });
		expect(scenePass.depthStencilAttachment.depthClearValue).toBe(1);
		expect(blitPass.label).toBe('blit');
		expect(fake.calls.filter(c => c[0] === 'queue.submit')).toHaveLength(1);
		// The sprite batch, the STR batch (the cylinder left out between them draws nothing, so the two
		// STR layers stay contiguous and in order), then the blit triangle.
		expect(draws(fake).map(c => c[1].slice(0, 2))).toEqual([[4, 2], [4, 2], [3]]);
	});

	it('takes a flat stream (array or RecordStream) as the whole scene pass; clears black without a sky', async () => {
		const { fake, backend } = await setup();
		fake.calls.length = 0;
		expect(backend.drawFrame({ records: [sprite()] })).toMatchObject({ records: 1, drawCalls: 1 });
		expect(passes(fake)[0].colorAttachments[0].clearValue).toEqual({ r: 0, g: 0, b: 0, a: 1 });
		expect(backend.drawFrame([sprite(), strLayer()])).toMatchObject({ records: 2, drawCalls: 2 });
		expect(backend.drawFrame(null)).toMatchObject({ drawn: true, records: 0, drawCalls: 0 });
	});

	it('runs the post chain when a module is active (performance mode: 0.75× scene + Upsampling)', async () => {
		const { fake, backend } = await setup({ settings: { fxaaEnabled: true, performanceMode: true } });
		fake.calls.length = 0;
		const stats = backend.drawFrame([sprite()], { post: { illusion: true } });
		expect(stats).toMatchObject({ post: 'FXAA+VerticalFlip+Upsampling', postPasses: 3 });
		expect(stats.sceneSize).toEqual({ width: 600, height: 450 });
		expect(passes(fake).map(p => p.label)).toEqual([undefined, 'post FXAA', 'post VerticalFlip', 'post Upsampling']);
		const target = fake.calls.filter(c => c[0] === 'createTexture').map(c => c[1].size);
		expect(target).toContainEqual({ width: 600, height: 450 });
	});

	it('R-PP-004: bloom runs only where bloomSupported allows it', async () => {
		const { fake, backend } = await setup({ settings: { bloom: true } });
		fake.calls.length = 0;
		expect(backend.drawFrame([sprite()]).post).toBe('Bloom');
		backend.bloomAllowed = false;
		expect(backend.drawFrame([sprite()]).post).toBe('blit');
	});

	it('C-20: capture() copies the next frame from the swapchain after the post chain and resolves it', async () => {
		const { fake, backend } = await setup({ settings: { vibranceEnabled: true } });
		const image = backend.capture();
		fake.calls.length = 0;
		expect(backend.drawFrame([sprite()]).captured).toBe(true);
		const order = fake.calls.map(c => c[0]).filter(n => ['beginRenderPass', 'copyTextureToBuffer', 'queue.submit'].includes(n));
		expect(order).toEqual(['beginRenderPass', 'beginRenderPass', 'copyTextureToBuffer', 'queue.submit']);
		const copy = fake.calls.find(c => c[0] === 'copyTextureToBuffer')[1];
		expect(copy[0].texture.desc).toEqual({ swapchain: true });
		const img = await image;
		expect([img.width, img.height, img.data.length]).toEqual([800, 600, 800 * 600 * 4]);
		expect(backend.drawFrame([sprite()]).captured).toBe(false); // one request, one frame
	});

	it('R-CTX-005: a render error turns bloom off permanently and the loop continues', async () => {
		const { backend, ports } = await setup({ settings: { bloom: true } });
		const encode = vi.spyOn(backend.runs, 'encode').mockImplementationOnce(() => {
			throw new Error('boom');
		});
		const failed = backend.drawFrame([sprite()]);
		expect(failed).toMatchObject({ drawn: false, action: 'continue', bloomDisabled: true });
		expect(failed.error.message).toBe('boom');
		expect(ports.settings.store.bloom).toBe(false);
		expect(backend.drawFrame([sprite()])).toMatchObject({ drawn: true, post: 'blit' });
		expect(encode).toHaveBeenCalledTimes(2);
	});

	it('R-CTX-005: an uncaptured out-of-memory error also turns bloom off', async () => {
		const { fake, backend, ports } = await setup({ settings: { bloom: true } });
		class GPUOutOfMemoryError extends Error {}
		fake.device.dispatch('uncapturederror', { error: new GPUOutOfMemoryError('oom') });
		fake.device.dispatch('uncapturederror', { error: new Error('validation') });
		expect(ports.settings.store.bloom).toBe(false);
		expect(backend.errors).toEqual(['oom', 'validation']);
	});
});

describe('WebGpuBackend: device loss (R-CTX-006/007)', () => {
	it('R-CTX-006/007: device.destroy() mid-run: overlay, purge, rebuild on a new device, setMap, next frame re-uploads', async () => {
		const { fake, ports, backend } = await setup();
		await backend.warm([sprite(), strLayer({ blend: { src: 'ONE', dst: 'ONE' } })]);
		expect(backend.drawFrame([sprite(), strLayer()])).toMatchObject({ drawn: true, uploads: 3 });
		expect(backend.residency.residentCount).toBe(2);

		// Hold the new adapter back, so the test sees the lost window.
		let release;
		const gate = new Promise(resolve => {
			release = resolve;
		});
		const requestAdapter = fake.gpu.requestAdapter;
		fake.gpu.requestAdapter = async opts => {
			await gate;
			return requestAdapter(opts);
		};
		fake.device.destroy();
		await flush();
		expect(backend.drawFrame([sprite()])).toEqual({ drawn: false, reason: 'lost' });
		expect(ports.overlay.show).toHaveBeenCalledWith({ ...CONTEXT_LOST_OVERLAY });
		expect(ports.assets.purge).toHaveBeenCalledWith(PURGE_ON_LOSS_EXTENSIONS);
		expect(backend.residency.residentCount).toBe(0);
		expect(backend.resize({ cssWidth: 640, cssHeight: 480 })).toBeNull(); // ignored while lost
		expect([fake.canvas.width, fake.canvas.height]).toEqual([800, 600]);
		release();

		expect(await backend.recovered()).toBe('webgpu');
		const next = fake.devices[1];
		expect(backend.device).toBe(next);
		expect(ports.overlay.hide).toHaveBeenCalled();
		expect(ports.scene.setMap).toHaveBeenCalledWith('prontera');
		expect([fake.canvas.width, fake.canvas.height]).toEqual([640, 480]); // the kept size, applied
		// Pipelines recompiled on the new device, the warmed additive STR pair included.
		const compiled = fake.calls.filter(c => c[0] === 'createRenderPipelineAsync' && c[2] === next.id);
		expect(compiled.some(c => c[1].label.includes('ONE|ONE'))).toBe(true);
		expect(backend.pools.device).toBe(next);

		fake.calls.length = 0;
		const stats = backend.drawFrame([sprite(), strLayer()]);
		expect(stats).toMatchObject({ drawn: true, drawCalls: 2, fallbacks: 0, uploads: 3 }); // re-uploaded on demand
		expect(fake.calls.find(c => c[0] === 'createCommandEncoder')[2]).toBe(next.id);
		expect(backend.loss.losses).toBe(1);
		expect(backend.loss.lastLoss.reason).toBe('destroyed');
	});

	it('R-CTX-007: with no adapter after the loss it hands over to gpu-webgl2 and stops drawing', async () => {
		const { fake, ports, backend } = await setup();
		fake.setAdapter(false);
		fake.loseDevice('unknown');
		await flush();
		expect(await backend.recovered()).toBe('webgl2');
		expect(ports.fallback.switchToWebgl2).toHaveBeenCalledWith('WebGPU unavailable: no adapter');
		expect(ports.scene.setMap).toHaveBeenCalledWith('prontera');
		expect(backend.retired).toBe(true);
		expect(backend.drawFrame([sprite()])).toEqual({ drawn: false, reason: 'retired' });
	});

	it('dispose() destroys the device without starting a rebuild', async () => {
		const { fake, ports, backend } = await setup();
		backend.dispose();
		await flush();
		expect(fake.calls.some(c => c[0] === 'device.destroy')).toBe(true);
		expect(ports.overlay.show).not.toHaveBeenCalled();
		expect(backend.drawFrame([sprite()])).toEqual({ drawn: false, reason: 'disposed' });
	});
});
