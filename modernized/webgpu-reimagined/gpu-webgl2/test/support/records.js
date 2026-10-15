/**
 * Record fixtures in the render-records shape (structural, no import of the
 * sibling module so this backend's tests are independent of its build state).
 */
export const NORMAL = Object.freeze({ src: 'SRC_ALPHA', dst: 'ONE_MINUS_SRC_ALPHA' });
export const ADDITIVE = Object.freeze({ src: 'SRC_ALPHA', dst: 'ONE' });

export function sprite(fields = {}) {
	return Object.freeze({
		kind: 'sprite',
		texture: 'spr:1',
		textureClass: 'indexed',
		palette: 'pal:1',
		sampler: 'nearest',
		position: [10, 20, 0],
		offset: [0, 0],
		size: [1, 1],
		angle: 0,
		mirror: false,
		color: [1, 1, 1, 1],
		shadowFactor: 1,
		zIndex: 0,
		depthBias: 0,
		depthTest: true,
		depthWrite: true,
		depthCorrection: true,
		ignoreDepthMinCap: false,
		blend: NORMAL,
		...fields
	});
}

export function effect(fields = {}) {
	return Object.freeze({
		kind: 'effect',
		family: 'str',
		pass: 'after',
		texture: 'str:1',
		position: [0, 0, 0],
		color: [1, 1, 1, 1],
		blend: NORMAL,
		depthTest: true,
		depthWrite: false,
		depthCorrection: false,
		fog: true,
		strAttachment: false,
		params: {},
		...fields
	});
}
