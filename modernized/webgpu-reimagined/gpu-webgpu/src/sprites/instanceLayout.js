/**
 * Per-instance vertex data for the instanced sprite quad (`shaders/sprite.wgsl`).
 * One record → one instance; 26 float32 per instance, byte-identical to the
 * gpu-webgl2 layout (`gpu-webgl2/src/batching/instanceLayout.js`), so both
 * backends pack the same values the legacy SpriteRenderer handed its uniforms.
 *
 * WGSL takes at most 16 vertex attributes, so zIndex and depthBias (adjacent
 * floats) are read as one vec2 attribute; the byte offsets are unchanged.
 */
export const SPRITE_INSTANCE_FIELDS = Object.freeze([
	['position', 3],
	['offset', 2], // world units: px/175·xSize, y − 0.5 (R-SPR-003, legacy _offset)
	['size', 2], // world units, signed: a mirrored layer has a negative width
	['rotation', 2], // (cos, sin) of −angle (legacy mat4.rotateZ)
	['color', 4],
	['shadow', 1],
	['zIndexBias', 2], // x: zIndex, y: depthBias (R-SPR-006)
	['depthFlags', 2], // x: depthCorrection, y: ignoreDepthMinCap (R-SPR-005)
	['layer', 4], // x: array layer, y: palette row (R-SPR-014), z: POT class index, w: sampler (1 linear)
	['frame', 4] // xy: frame size in texels, zw: palette bilinear size (legacy uTextSize)
]);

/** First instance shader location (0: corner, 1: tex_coord). */
export const SPRITE_INSTANCE_FIRST_LOCATION = 2;

export const SPRITE_INSTANCE_FLOATS = SPRITE_INSTANCE_FIELDS.reduce((n, [, size]) => n + size, 0);

export const SPRITE_INSTANCE_STRIDE = SPRITE_INSTANCE_FLOATS * 4;

const FORMATS = Object.freeze({ 1: 'float32', 2: 'float32x2', 3: 'float32x3', 4: 'float32x4' });

/**
 * Attribute table: shader location, component count and byte offset of each field.
 * @type {ReadonlyArray<{name: string, shaderLocation: number, size: number, offset: number, format: string}>}
 */
export const SPRITE_INSTANCE_ATTRIBUTES = Object.freeze(
	SPRITE_INSTANCE_FIELDS.reduce((list, [name, size], index) => {
		const prev = list[list.length - 1];
		const offset = prev ? prev.offset + prev.size * 4 : 0;
		list.push(
			Object.freeze({
				name,
				shaderLocation: SPRITE_INSTANCE_FIRST_LOCATION + index,
				size,
				offset,
				format: FORMATS[size]
			})
		);
		return list;
	}, [])
);

/** Legacy SpriteRenderer quad: corner (±0.5) + uv, drawn as a 4-vertex triangle strip. */
export const SPRITE_QUAD = Object.freeze([
	-0.5, +0.5, 0.0, 0.0, +0.5, +0.5, 1.0, 0.0, -0.5, -0.5, 0.0, 1.0, +0.5, -0.5, 1.0, 1.0
]);

/** GPUVertexBufferLayout[]: slot 0 the per-vertex quad, slot 1 the instance-step records. */
export const SPRITE_VERTEX_BUFFERS = Object.freeze([
	Object.freeze({
		arrayStride: 16,
		stepMode: 'vertex',
		attributes: Object.freeze([
			Object.freeze({ shaderLocation: 0, offset: 0, format: 'float32x2' }),
			Object.freeze({ shaderLocation: 1, offset: 8, format: 'float32x2' })
		])
	}),
	Object.freeze({
		arrayStride: SPRITE_INSTANCE_STRIDE,
		stepMode: 'instance',
		attributes: Object.freeze(
			SPRITE_INSTANCE_ATTRIBUTES.map(({ shaderLocation, offset, format }) =>
				Object.freeze({ shaderLocation, offset, format })
			)
		)
	})
]);

/** Legacy sprite unit: 175 px is xSize world units (R-SPR-003). */
const PX_PER_UNIT = 175;

/**
 * Pack one sprite record into `out` at `offset` (floats).
 * @param {object} r  SpriteDraw record (sizes/offsets in sprite pixels, xSize/ySize default 5)
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

/**
 * Read one packed instance back into named fields (the WGSL `Instance` view of it), for
 * the CPU shader references (`spriteVertexClip`) and diagnostics.
 * @param {ArrayLike<number>} data
 * @param {number} [offset]  Float offset of the instance
 * @returns {Record<string, number[]>}
 */
export function unpackSpriteInstance(data, offset = 0) {
	const out = {};
	for (const { name, size, offset: byteOffset } of SPRITE_INSTANCE_ATTRIBUTES) {
		const at = offset + byteOffset / 4;
		out[name] = Array.from({ length: size }, (_, i) => data[at + i]);
	}
	return out;
}
