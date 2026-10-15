/**
 * 2D and 3D EffectTable effects (R-EFX-011…013) are SpriteRenderer draws in legacy
 * (ThreeDEffect.js / TwoDEffect.js hand their records to SpriteRenderer.render), so
 * their EffectDraw records carry SpriteRenderer-shaped params (size, offset, angle,
 * zIndex, depthBias, shadowFactor, xSize/ySize, palette, paletteSize...). gpu-webgl2
 * draws them through the instanced sprite program: this module maps one such record
 * onto the SpriteRecord fields `packSpriteInstance` and `Residency.slotOf` read.
 *
 * Blend (GL-order table, already normalised to the unified enum by render-records),
 * depth test/write and the overlay flag stay record state: blend and depth are run
 * state (GLStateCache), `depthCorrection` (false for overlays, R-EFX-013) is per
 * instance. Scene fog applies as for sprites: the record's `fog` is the scene fog of
 * the pass (`use && exist`), which is the frame's fog uniform.
 */

/** Effect families drawn by the sprite program. */
export const SPRITE_EFFECT_FAMILIES = Object.freeze(['2d', '3d']);

/** @param {{kind: string, family?: string}} record */
export function isSpriteEffect(record) {
	return record.kind === 'effect' && SPRITE_EFFECT_FAMILIES.includes(/** @type {string} */ (record.family));
}

const ZERO2 = Object.freeze([0, 0]);

/**
 * Sprite view of one 2D/3D effect record (fields shared, not copied).
 *
 * Sampler: indexed layers (a palette is set) are NEAREST (the shader filters the
 * palette); RGBA layers use `params.sampler` when the producer set it (a
 * sprite-backed 3D layer under pixelPerfectSprites), else LINEAR: effect images
 * (WebGL.texture) and RGBA SPR frames are LINEAR in legacy.
 *
 * @param {{texture: unknown, position: ArrayLike<number>, color: ArrayLike<number>, depthTest: boolean,
 *   depthWrite: boolean, depthCorrection: boolean, params: Record<string, any>}} record
 * @param {Record<string, any>} [out]  Reused result (allocation-free packing)
 * @returns {import('../ports.js').SpriteRecord & {xSize: number, ySize: number, paletteSize: ArrayLike<number>|null}}
 */
export function spriteEffectView(record, out = {}) {
	const p = record.params ?? {};
	const palette = p.palette ?? null;
	const indexed = palette !== null;
	out.kind = 'sprite';
	out.texture = record.texture;
	out.palette = palette;
	out.textureClass = indexed ? 'indexed' : 'rgba';
	out.sampler = indexed ? 'nearest' : (p.sampler ?? 'linear');
	out.paletteSize = indexed ? (p.paletteSize ?? null) : null;
	out.position = record.position;
	out.offset = p.offset ?? ZERO2;
	out.size = p.size;
	out.xSize = p.xSize ?? 5;
	out.ySize = p.ySize ?? 5;
	out.angle = p.angle ?? 0;
	out.color = record.color;
	out.shadowFactor = p.shadowFactor ?? 1;
	out.zIndex = p.zIndex ?? 0;
	out.depthBias = p.depthBias ?? 0;
	out.depthTest = record.depthTest;
	out.depthWrite = record.depthWrite;
	out.depthCorrection = record.depthCorrection;
	out.ignoreDepthMinCap = p.ignoreDepthMinCap ?? false;
	return /** @type {any} */ (out);
}

/**
 * Texture class of an effect record for the split-class fallback (fewer than 11
 * fragment texture units), where one sprite run binds one class set.
 * @param {{params?: {palette?: unknown}}} record
 * @returns {'indexed'|'rgba'}
 */
export function spriteEffectClass(record) {
	return (record.params?.palette ?? null) !== null ? 'indexed' : 'rgba';
}
