const NORMAL = Object.freeze({ src: 'SRC_ALPHA', dst: 'ONE_MINUS_SRC_ALPHA' });

/**
 * Legacy native effect record (legacy `StrEffect` / `ThreeDEffect` / `TwoDEffect`
 * `addRecordSink`) → the EffectDraw shape this backend consumes, as render-records
 * emits it. The native record carries GL texture objects of the legacy context;
 * the backend needs residency handles. The record-side decisions render-records
 * applies are applied here too, so a captured legacy stream replays as the rebuild
 * draws it:
 *
 * - **#41 / #49:** an invalid blend code gives `blend: null` in legacy (GL then gets an
 *   undefined factor and keeps the previous blend); the rebuild draws normal alpha.
 * - **R-EFX-010 (fixed):** legacy STR records never ask for fog (legacy never set
 *   uFogUse); the rebuild's STR layers obey the scene fog: `fog = sceneFog.use`, as
 *   render-records `strLayerDrawFields` sets it.
 * - 2D/3D: `params.palette` becomes a residency handle; a sprite-backed 3D layer
 *   (`params.layer ≥ 0`) with RGBA frames samples NEAREST under pixelPerfectSprites,
 *   as `Core/Client.js` uploads those frames (`params.sampler`).
 *
 * Not applied (cannot be recovered from a native record): the #47 self-contained
 * 3D record fix. A plain 3D effect drawn after a sprite-backed one in the same pass
 * carries the leaked offset and palette in its native record.
 *
 * Arrays are shared with the native record (sinks hand out a fresh record per draw).
 *
 * @param {{kind: 'effect', family: string, texture: unknown, position: ArrayLike<number>, color: ArrayLike<number>,
 *   blend: {src: string, dst: string}|null, depthTest: boolean, depthWrite: boolean, depthCorrection: boolean,
 *   fog: boolean, strAttachment: boolean, params: Record<string, any>}} native
 * @param {{textureHandle?: (texture: unknown) => unknown, paletteHandle?: (palette: unknown) => unknown,
 *   sceneFog?: {use: boolean}|null, pixelPerfectSprites?: boolean}} [options]
 * @returns {import('../ports.js').EffectRecord & {texture: unknown, position: ArrayLike<number>, color: ArrayLike<number>}}
 */
export function fromLegacyEffectRecord(native, options = {}) {
	const { textureHandle = t => t, paletteHandle = p => p, sceneFog = null, pixelPerfectSprites = false } = options;
	const base = {
		kind: 'effect',
		family: native.family,
		pass: 'after',
		texture: textureHandle(native.texture),
		position: native.position,
		color: native.color,
		blend: native.blend ?? NORMAL,
		depthTest: native.depthTest,
		depthWrite: native.depthWrite,
		depthCorrection: native.depthCorrection,
		fog: native.fog,
		strAttachment: native.strAttachment
	};
	if (native.family === 'str') {
		return /** @type {any} */ ({ ...base, fog: Boolean(sceneFog?.use), params: native.params });
	}
	const params = native.params;
	const palette = params.palette === null || params.palette === undefined ? null : paletteHandle(params.palette);
	const spriteBacked = params.layer >= 0;
	return /** @type {any} */ ({
		...base,
		params: {
			...params,
			palette,
			sampler: palette === null && spriteBacked && pixelPerfectSprites ? 'nearest' : undefined
		}
	});
}
