/**
 * Per-instance vertex attributes for the instanced sprite quad (GLSL 300 es,
 * `sprite.vert`). One record → one instance; floats are packed in this order.
 */
export const SPRITE_INSTANCE_FIELDS = Object.freeze([
	['aPosition', 3],
	['aOffset', 2],
	['aSize', 2],
	['aAngle', 1],
	['aMirror', 1],
	['aColor', 4],
	['aShadow', 1],
	['aZIndex', 1],
	['aDepthBias', 1],
	['aDepthFlags', 2], // x: depthCorrection, y: ignoreDepthMinCap (R-SPR-005)
	['aLayer', 2], // x: texture-array layer, y: palette row (R-SPR-014)
	['aSampler', 1] // 0 nearest, 1 linear (pixelPerfectSprites without re-upload)
]);

export const SPRITE_INSTANCE_FLOATS = SPRITE_INSTANCE_FIELDS.reduce((n, [, size]) => n + size, 0);

/**
 * Pack one sprite record into `out` at `offset`.
 * @param {import('../ports.js').SpriteRecord} r
 * @param {{layer: number, paletteRow: number}} slot  Residency lookup result
 * @param {Float32Array} out
 * @param {number} offset
 * @returns {number} next offset
 */
export function packSpriteInstance(r, slot, out, offset) {
	const v = [
		...r.position,
		...r.offset,
		...r.size,
		r.angle,
		r.mirror ? 1 : 0,
		...r.color,
		r.shadowFactor,
		r.zIndex,
		r.depthBias,
		r.depthCorrection ? 1 : 0,
		r.ignoreDepthMinCap ? 1 : 0,
		slot.layer,
		slot.paletteRow,
		r.sampler === 'linear' ? 1 : 0
	];
	out.set(v, offset);
	return offset + v.length;
}
