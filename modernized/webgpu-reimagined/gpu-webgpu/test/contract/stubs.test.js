import { describe, expect, it } from 'vitest';
import { createFakeGpu } from '../support/fakeGpu.js';
import { Capture, LivePreviews, NotImplementedError, OffscreenTarget, Residency, selectBackend } from '../../src/index.js';

// Capability-level contracts with no behaviour-contract rule (C-16, C-19, C-20).
// Expected-failure until implemented; tagged with the capability ID.
describe('capability contracts', () => {
	it('C-01: selectBackend returns a webgpu device when an adapter exists, and honours renderer=webgl', async () => {
		const fake = createFakeGpu();
		expect((await selectBackend({ gpu: fake.gpu, canvas: fake.canvas })).backend).toBe('webgpu');
		expect((await selectBackend({ gpu: fake.gpu, canvas: fake.canvas, preference: 'webgl' })).backend).toBe('webgl2');
	});

	it('C-01: offscreen target recreates its three textures on resize only', () => {
		const fake = createFakeGpu();
		const t = new OffscreenTarget(fake.device);
		t.resize(640, 480);
		t.resize(640, 480);
		expect(fake.calls.filter(c => c[0] === 'createTexture')).toHaveLength(3);
	});

	it('C-16: residency pools slots per (format, POT class) from a free list; oversize is limit-checked (NFR-08)', () => {
		const r = new Residency({ limit: () => 1024 });
		const a = r.slotFor('r8unorm', 30, 20);
		const b = r.slotFor('r8unorm', 60, 20);
		const c = r.slotFor('rgba8unorm', 30, 20);
		expect(a.size).toBe(32);
		expect(b.size).toBe(64);
		expect(r.pools.size).toBe(3);
		expect(c.format).toBe('rgba8unorm');
		expect(r.slotFor('rgba8unorm', 1000, 10).size).toBe('oversize');
		expect(() => r.slotFor('rgba8unorm', 2000, 10)).toThrow(/maxTextureDimension2D/);
		expect(r.palettes.allocate()).toBe(0);
	});

	it.fails('C-16: residency uploads into its slot and generates mips when enabled', () => {
		const r = new Residency({ limit: () => 8192 });
		r.upload(r.slotFor('rgba8unorm', 32, 32), new Uint8Array(32 * 32 * 4));
	});

	it('C-19: live previews reconfigure every attached canvas on a new device', () => {
		const first = createFakeGpu();
		const p = new LivePreviews({ device: first.device });
		const char = createFakeGpu();
		const equip = createFakeGpu();
		p.attach('CharSelect', char.canvas);
		p.attach('Equipment', equip.canvas);
		expect(char.calls.filter(c => c[0] === 'context.configure')[0][1]).toMatchObject({ device: first.device });
		const next = createFakeGpu().device;
		expect(p.reconfigureAll(next)).toBe(2);
		for (const fake of [char, equip]) {
			expect(fake.calls.filter(c => c[0] === 'context.configure').at(-1)[1]).toEqual({
				device: next,
				format: 'bgra8unorm',
				alphaMode: 'opaque'
			});
		}
		p.detach('Equipment');
		expect(p.reconfigureAll(next)).toBe(1);
	});

	it('C-20: capture copies the final frame to a buffer inside the frame and resolves an ImageData-like image', async () => {
		const fake = createFakeGpu();
		const cap = new Capture({ device: fake.device });
		expect(cap.encode({}, {}, { width: 1, height: 1, format: 'bgra8unorm' })).toBeNull(); // nothing pending
		const image = cap.request();
		expect(cap.pending).toBe(true);
		const copies = [];
		const encoder = { copyTextureToBuffer: (...a) => copies.push(a) };
		const swap = { swapchain: true };
		const job = cap.encode(encoder, swap, { width: 3, height: 2, format: 'bgra8unorm' });
		expect(cap.pending).toBe(false);
		const [[src, dst, size]] = copies;
		expect(src).toEqual({ texture: swap });
		expect(dst).toMatchObject({ bytesPerRow: 256, rowsPerImage: 2 }); // rows padded to 256 bytes
		expect(size).toEqual({ width: 3, height: 2, depthOrArrayLayers: 1 });
		// BGRA rows as the canvas stores them: pixel (x, y) = (b, g, r, a) = (x, y, 9, 0).
		const mapped = new Uint8Array(dst.buffer.data);
		for (let y = 0; y < 2; y++) {
			for (let x = 0; x < 3; x++) {
				mapped.set([x, y, 9, 0], y * 256 + x * 4);
			}
		}
		await job.finish();
		const img = await image;
		expect(img.width).toBe(3);
		expect(img.height).toBe(2);
		expect([...img.data.subarray(0, 8)]).toEqual([9, 0, 0, 255, 9, 0, 1, 255]); // RGBA, opaque
		expect([...img.data.subarray(12, 16)]).toEqual([9, 1, 0, 255]); // row 1 follows row 0 tightly
	});

	it('C-20: a capture whose map fails (device lost after the submit) rejects', async () => {
		const fake = createFakeGpu();
		const cap = new Capture({ device: fake.device });
		const image = cap.request();
		const job = cap.encode({ copyTextureToBuffer() {} }, {}, { width: 1, height: 1, format: 'rgba8unorm' });
		fake.device.destroy();
		await job.finish();
		await expect(image).rejects.toThrow(/lost/);
	});

	it('stubs throw NotImplementedError, never silently succeed', () => {
		expect(() => new LivePreviews({}).render('CharSelect', [])).toThrow(NotImplementedError);
	});
});
