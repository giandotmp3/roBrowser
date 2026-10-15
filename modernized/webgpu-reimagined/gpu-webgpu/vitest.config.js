import { defineConfig } from 'vitest/config';

// gpu-webgpu tests run in plain Node against a fake GPU (test/support/fakeGpu.js).
// WGSL sources are imported with Vite's `?raw` suffix, which Vitest resolves natively.
// Real-GPU smoke goldens belong to the test-harness module (Playwright), not here.
export default defineConfig({
	test: {
		environment: 'node',
		include: ['test/**/*.test.js']
	}
});
