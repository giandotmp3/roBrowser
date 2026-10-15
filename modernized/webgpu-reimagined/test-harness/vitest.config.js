/** Vitest config (plain object so it loads without resolving 'vitest/config'). */
export default {
	test: {
		environment: 'node',
		include: ['test/**/*.test.js'],
		// Determinism: tests never depend on wall-clock or Math.random (see src/determinism).
		sequence: { shuffle: false }
	}
};
