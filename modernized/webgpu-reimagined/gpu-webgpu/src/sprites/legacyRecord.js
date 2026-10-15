import { spriteSampler } from '../residency/spriteFrames.js';
import { ADDITIVE, NORMAL } from '../pipelines/pipelineKey.js';

/**
 * Legacy native sprite record (legacy `SpriteRenderer.addRecordSink`, phase 2a) →
 * the SpriteDraw shape gpu-webgpu consumes (same mapping as gpu-webgl2
 * `fromLegacySpriteRecord`). The native record carries texture objects of the
 * legacy GL context and a `'normal'|'additive'` blend; the backend needs residency
 * handles, a blend pair and the sampler (legacy keeps it on the texture:
 * Core/Client.js uploads indexed frames NEAREST, RGBA frames LINEAR unless
 * pixelPerfectSprites).
 *
 * Arrays are shared with the native record (the sink hands out a fresh record per draw).
 *
 * @param {{texture: unknown, palette: unknown, textureClass: 'indexed'|'rgba', paletteSize: ArrayLike<number>,
 *   position: ArrayLike<number>, offset: ArrayLike<number>, size: ArrayLike<number>, xSize: number, ySize: number,
 *   angle: number, color: ArrayLike<number>, shadowFactor: number, zIndex: number, depthBias: number,
 *   depthTest: boolean, depthWrite: boolean, depthCorrection: boolean, ignoreDepthMinCap: boolean,
 *   blend: 'normal'|'additive'}} native
 * @param {{textureHandle?: (texture: unknown) => unknown, paletteHandle?: (palette: unknown) => unknown, pixelPerfectSprites?: boolean}} [options]
 */
export function fromLegacySpriteRecord(native, options = {}) {
	const { textureHandle = t => t, paletteHandle = p => p, pixelPerfectSprites = false } = options;
	const indexed = native.textureClass === 'indexed';
	return {
		kind: 'sprite',
		texture: textureHandle(native.texture),
		textureClass: native.textureClass,
		palette: indexed ? paletteHandle(native.palette) : null,
		sampler: spriteSampler(native.textureClass, pixelPerfectSprites),
		paletteSize: native.paletteSize,
		position: native.position,
		offset: native.offset,
		size: native.size,
		xSize: native.xSize,
		ySize: native.ySize,
		angle: native.angle,
		mirror: native.size[0] < 0,
		color: native.color,
		shadowFactor: native.shadowFactor,
		zIndex: native.zIndex,
		depthBias: native.depthBias,
		depthTest: native.depthTest,
		depthWrite: native.depthWrite,
		depthCorrection: native.depthCorrection,
		ignoreDepthMinCap: native.ignoreDepthMinCap,
		blend: native.blend === 'additive' ? ADDITIVE : NORMAL
	};
}
