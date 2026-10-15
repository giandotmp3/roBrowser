/** Vitest config (plain object so it loads without resolving 'vitest/config'). */
export default {
	test: {
		environment: 'node',
		include: ['tests/**/*.test.js']
	}
};
