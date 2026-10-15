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

	it.fails('C-19: live previews reconfigure every attached canvas on a new device', () => {
		const p = new LivePreviews({});
		p.attach('CharSelect', createFakeGpu().canvas);
		p.reconfigureAll(createFakeGpu().device);
	});

	it.fails('C-20: capture copies the resolved frame (after VerticalFlip) to a buffer inside the frame', () => {
		const cap = new Capture({});
		cap.request();
		expect(cap.pending).toBe(true);
		cap.encode({}, {});
	});

	it('stubs throw NotImplementedError, never silently succeed', () => {
		expect(() => new Capture({}).encode({}, {})).toThrow(NotImplementedError);
	});
});
