import { POT_CLASSES } from '../constants.js';

/**
 * Per-instance vertex data of the instanced STR quad (`shaders/str.wgsl`). One STR
 * EffectDraw record → one instance; 26 float32 per instance packed in this order,
 * byte-identical to gpu-webgl2's layout (`gpu-webgl2/src/effects/strInstance.js`).
 * There is no per-vertex buffer: the strip vertex is `@builtin(vertex_index)`.
 *
 * The values are the ones legacy StrEffect handed its uniforms and its 4-vertex
 * buffer, computed the same way on the CPU (float32), so the shader sees identical
 * inputs.
 */
export const STR_INSTANCE_FIELDS = Object.freeze([
	['position', 3],
	['quadX', 4], // corner x in strip order (xy[0], xy[1], xy[3], xy[2]) × scale, sprite px
	['quadY', 4], // corner y in strip order (xy[4], xy[5], xy[7], xy[6]) × scale
	['rotation', 2], // (cos, sin) of −angle (legacy mat4.rotateZ, always applied)
	['offset', 2], // pos − pivot (+ attachment offset), sprite px
	['color', 4],
	['str', 3], // x: yLower, y: clip z bias, z: fog (R-EFX-010 fix: record.fog)
	['tex', 4] // x: array layer (−1 miss), y: POT class index, zw: texture size / class size
]);

export const STR_INSTANCE_FLOATS = STR_INSTANCE_FIELDS.reduce((n, [, size]) => n + size, 0);

export const STR_INSTANCE_STRIDE = STR_INSTANCE_FLOATS * 4;

const FORMATS = Object.freeze({ 1: 'float32', 2: 'float32x2', 3: 'float32x3', 4: 'float32x4' });

/**
 * Attribute table: shader location, component count and byte offset of each field.
 * @type {ReadonlyArray<{name: string, shaderLocation: number, size: number, offset: number, format: string}>}
 */
export const STR_INSTANCE_ATTRIBUTES = Object.freeze(
	STR_INSTANCE_FIELDS.reduce((list, [name, size], index) => {
		const prev = list[list.length - 1];
		const offset = prev ? prev.offset + prev.size * 4 : 0;
		list.push(Object.freeze({ name, shaderLocation: index, size, offset, format: FORMATS[size] }));
		return list;
	}, [])
);

/** GPUVertexBufferLayout[]: slot 0 is the instance-step record buffer (no per-vertex buffer). */
export const STR_VERTEX_BUFFERS = Object.freeze([
	Object.freeze({
		arrayStride: STR_INSTANCE_STRIDE,
		stepMode: 'instance',
		attributes: Object.freeze(
			STR_INSTANCE_ATTRIBUTES.map(({ shaderLocation, offset, format }) =>
				Object.freeze({ shaderLocation, offset, format })
			)
		)
	})
]);

/** Legacy STR draw: the strip takes keyframe corners 0, 1, 3, 2 (StrEffect.js drawStrRecord). */
const STRIP_CORNERS = Object.freeze([0, 1, 3, 2]);

/** R-EFX-009 constants for records that omit them (render-records always sets them). */
const DEFAULT_Y_LOWER = 0.5;
const DEFAULT_CLIP_Z_BIAS = -0.1;

/**
 * Pack one STR layer record into `out` at `offset`.
 * @param {{position: ArrayLike<number>, color: ArrayLike<number>, fog?: boolean,
 *   params: {xy: ArrayLike<number>, scale?: number, angle?: number, offset: ArrayLike<number>,
 *   yLower?: number, clipZBias?: number}}} r  STR EffectDraw (render-records StrPlayer or the legacy native record)
 * @param {{layer: number, classIndex?: number, width?: number, height?: number}} slot  Residency lookup result
 * @param {Float32Array} out
 * @param {number} offset
 * @returns {number} next offset
 */
export function packStrInstance(r, slot, out, offset) {
	const p = r.params;
	const scale = p.scale ?? 1;
	const angle = p.angle ?? 0;
	// Legacy: mat4.rotateZ(identity, −angle/180·π) on every draw (also for angle 0).
	const rad = (-angle / 180) * Math.PI;
	const classSize = POT_CLASSES[slot.classIndex ?? 0];

	let o = offset;
	out[o++] = r.position[0];
	out[o++] = r.position[1];
	out[o++] = r.position[2];
	for (const corner of STRIP_CORNERS) {
		out[o++] = p.xy[corner] * scale;
	}
	for (const corner of STRIP_CORNERS) {
		out[o++] = p.xy[4 + corner] * scale;
	}
	out[o++] = Math.cos(rad);
	out[o++] = Math.sin(rad);
	out[o++] = p.offset[0];
	out[o++] = p.offset[1];
	out[o++] = r.color[0];
	out[o++] = r.color[1];
	out[o++] = r.color[2];
	out[o++] = r.color[3];
	out[o++] = p.yLower ?? DEFAULT_Y_LOWER;
	out[o++] = p.clipZBias ?? DEFAULT_CLIP_Z_BIAS;
	out[o++] = r.fog ? 1 : 0;
	out[o++] = slot.layer;
	out[o++] = slot.classIndex ?? 0;
	out[o++] = (slot.width ?? classSize) / classSize;
	out[o++] = (slot.height ?? classSize) / classSize;
	return o;
}
