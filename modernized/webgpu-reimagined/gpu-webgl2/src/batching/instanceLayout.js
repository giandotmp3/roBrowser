/**
 * Per-instance vertex attributes for the instanced sprite quad (GLSL 300 es,
 * `sprite.vert`). One record → one instance; floats are packed in this order.
 * Locations 0 and 1 are the per-vertex quad (corner, uv); instance attributes
 * start at location 2.
 *
 * The values are the ones legacy SpriteRenderer handed its uniforms, computed
 * the same way on the CPU (float32), so the shader sees identical inputs.
 */
export const SPRITE_INSTANCE_FIELDS = Object.freeze([
	['aPosition', 3],
	['aOffset', 2], // world units: px/175·xSize, y − 0.5 (R-SPR-003, legacy _offset)
	['aSize', 2], // world units, signed: a mirrored layer has a negative width
	['aRotation', 2], // (cos, sin) of −angle (legacy mat4.rotateZ)
	['aColor', 4],
	['aShadow', 1],
	['aZIndex', 1],
	['aDepthBias', 1],
	['aDepthFlags', 2], // x: depthCorrection, y: ignoreDepthMinCap (R-SPR-005)
	['aLayer', 4], // x: array layer, y: palette row (R-SPR-014), z: POT class index, w: sampler (1 linear)
	['aFrame', 4] // xy: frame size in texels, zw: palette bilinear size (legacy uTextSize)
]);

/** First instance attribute location (0: aCorner, 1: aTexCoord). */
export const SPRITE_INSTANCE_FIRST_LOCATION = 2;

export const SPRITE_INSTANCE_FLOATS = SPRITE_INSTANCE_FIELDS.reduce((n, [, size]) => n + size, 0);

export const SPRITE_INSTANCE_STRIDE = SPRITE_INSTANCE_FLOATS * 4;

/**
 * Attribute table: location, component count and byte offset of each field.
 * @type {ReadonlyArray<{name: string, location: number, size: number, offset: number}>}
 */
export const SPRITE_INSTANCE_ATTRIBUTES = Object.freeze(
	SPRITE_INSTANCE_FIELDS.reduce((list, [name, size], index) => {
		const prev = list[list.length - 1];
		const offset = prev ? prev.offset + prev.size * 4 : 0;
		list.push(Object.freeze({ name, location: SPRITE_INSTANCE_FIRST_LOCATION + index, size, offset }));
		return list;
	}, [])
);

/** Legacy sprite unit: 175 px is xSize world units (R-SPR-003). */
const PX_PER_UNIT = 175;

/**
 * Pack one sprite record into `out` at `offset`.
 * @param {import('../ports.js').SpriteRecord & {xSize?: number, ySize?: number, paletteSize?: ArrayLike<number>}} r
 * @param {{layer: number, paletteRow: number, classIndex?: number, width?: number, height?: number}} slot
 *   Residency lookup result
 * @param {Float32Array} out
 * @param {number} offset
 * @returns {number} next offset
 */
export function packSpriteInstance(r, slot, out, offset) {
	const xSize = r.xSize ?? 5;
	const ySize = r.ySize ?? 5;
	const width = slot.width ?? 1;
	const height = slot.height ?? 1;
	// Legacy: identity when angle is 0, otherwise mat4.rotateZ(identity, −angle/180·π).
	const rad = (-r.angle / 180) * Math.PI;
	const cos = r.angle ? Math.cos(rad) : 1;
	const sin = r.angle ? Math.sin(rad) : 0;
	// Legacy uTextSize: the palette bilinear step. Entities and weather pass 2× the frame size.
	const textW = r.paletteSize ? r.paletteSize[0] : 2 * width;
	const textH = r.paletteSize ? r.paletteSize[1] : 2 * height;

	let o = offset;
	out[o++] = r.position[0];
	out[o++] = r.position[1];
	out[o++] = r.position[2];
	out[o++] = (r.offset[0] / PX_PER_UNIT) * xSize;
	out[o++] = (r.offset[1] / PX_PER_UNIT) * ySize - 0.5;
	out[o++] = (r.size[0] / PX_PER_UNIT) * xSize;
	out[o++] = (r.size[1] / PX_PER_UNIT) * ySize;
	out[o++] = cos;
	out[o++] = sin;
	out[o++] = r.color[0];
	out[o++] = r.color[1];
	out[o++] = r.color[2];
	out[o++] = r.color[3];
	out[o++] = r.shadowFactor;
	out[o++] = r.zIndex;
	out[o++] = r.depthBias;
	out[o++] = r.depthCorrection ? 1 : 0;
	out[o++] = r.ignoreDepthMinCap ? 1 : 0;
	out[o++] = slot.layer;
	out[o++] = slot.paletteRow;
	out[o++] = slot.classIndex ?? 0;
	out[o++] = r.sampler === 'linear' ? 1 : 0;
	out[o++] = width;
	out[o++] = height;
	out[o++] = textW;
	out[o++] = textH;
	return o;
}
