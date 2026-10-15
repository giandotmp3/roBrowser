import { POT_CLASSES } from '../constants.js';

/**
 * Per-instance vertex attributes of the instanced STR quad (GLSL 300 es,
 * `str.vert`). One STR EffectDraw record → one instance; floats are packed in
 * this order. There is no per-vertex buffer: the strip vertex is gl_VertexID.
 *
 * The values are the ones legacy StrEffect handed its uniforms and its 4-vertex
 * buffer, computed the same way on the CPU (float32), so the shader sees
 * identical inputs.
 */
export const STR_INSTANCE_FIELDS = Object.freeze([
	['aPosition', 3],
	['aQuadX', 4], // corner x in strip order (xy[0], xy[1], xy[3], xy[2]) × scale, sprite px
	['aQuadY', 4], // corner y in strip order (xy[4], xy[5], xy[7], xy[6]) × scale
	['aRotation', 2], // (cos, sin) of −angle (legacy mat4.rotateZ, always applied)
	['aOffset', 2], // pos − pivot (+ attachment offset), sprite px
	['aColor', 4],
	['aStr', 3], // x: yLower, y: clip z bias, z: fog (R-EFX-010 fix: record.fog)
	['aTex', 4] // x: array layer (−1 miss), y: POT class index, zw: texture size / class size
]);

export const STR_INSTANCE_FLOATS = STR_INSTANCE_FIELDS.reduce((n, [, size]) => n + size, 0);

export const STR_INSTANCE_STRIDE = STR_INSTANCE_FLOATS * 4;

/**
 * Attribute table: location, component count and byte offset of each field.
 * @type {ReadonlyArray<{name: string, location: number, size: number, offset: number}>}
 */
export const STR_INSTANCE_ATTRIBUTES = Object.freeze(
	STR_INSTANCE_FIELDS.reduce((list, [name, size], index) => {
		const prev = list[list.length - 1];
		const offset = prev ? prev.offset + prev.size * 4 : 0;
		list.push(Object.freeze({ name, location: index, size, offset }));
		return list;
	}, [])
);

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
