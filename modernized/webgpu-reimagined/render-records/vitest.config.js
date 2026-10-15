import { defineConfig } from 'vitest/config';

// render-records is CPU-only: no DOM, no GPU. Tests run in plain Node.
export default defineConfig({
	test: {
		environment: 'node',
		include: ['test/**/*.test.js']
	}
});
