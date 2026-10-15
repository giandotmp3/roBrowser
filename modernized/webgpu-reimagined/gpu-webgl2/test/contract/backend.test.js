import { describe, expect, it } from 'vitest';
import * as api from '../../src/index.js';
import { NotImplementedError } from '../../src/errors.js';
import { createFakeCanvas, createFakePorts } from '../support/fakeGl.js';
import { sprite } from '../support/records.js';

describe('gpu-webgl2 backend contract (same shape as gpu-webgpu)', () => {
	const make = () => new api.WebGL2Backend({ ...createFakePorts(), canvas: createFakeCanvas() }).init();

	it('exposes kind, init, resize, drawFrame, acceptMapMessage, capture, handleRenderError, dispose', () => {
		const b = make();
		expect(b.kind).toBe('webgl2');
		for (const m of ['init', 'resize', 'drawFrame', 'acceptMapMessage', 'capture', 'handleRenderError', 'dispose']) {
			expect(typeof b[m]).toBe('function');
		}
	});

	it('drawFrame consumes per-pass record streams and returns the executed step order', () => {
		const order = make().drawFrame({ passes: { entities: [sprite()] } });
		expect(order).toHaveLength(25);
	});

	it('map upload (C-17) and capture (C-20) are stubs awaiting implementation', () => {
		const b = make();
		expect(() => b.acceptMapMessage({ type: 'MAP_GROUND', payload: {} })).toThrow(NotImplementedError);
		expect(() => b.capture()).toThrow(NotImplementedError);
	});
});
