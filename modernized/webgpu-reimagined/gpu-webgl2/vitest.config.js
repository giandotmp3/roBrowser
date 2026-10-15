import { defineConfig } from 'vitest/config';

// gpu-webgl2 tests run in plain Node against a recording fake WebGL2 context
// (test/support/fakeGl.js). GLSL sources are imported with Vite's `?raw` suffix.
// Real-GPU smoke goldens belong to the test-harness module (Playwright), not here.
export default defineConfig({
	test: {
		environment: 'node',
		include: ['test/**/*.test.js']
	}
});
