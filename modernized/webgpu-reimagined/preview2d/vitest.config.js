/**
 * Vitest config (plain object so it loads without resolving 'vitest/config').
 * Environment is plain node: every DOM/canvas touchpoint goes through the
 * injected CanvasFactory port, and tests use the in-repo FakeCanvas stub
 * (tests/support/FakeCanvas.js) instead of jsdom + node-canvas.
 */
export default {
	test: {
		environment: 'node',
		include: ['tests/**/*.test.js']
	}
};
