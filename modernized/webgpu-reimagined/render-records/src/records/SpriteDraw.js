import { BLEND_NORMAL } from './blend.js';

/**
 * One sprite layer draw. Replaces the legacy mutable global
 * `SpriteRenderer.*` (spec §2.3 item 2).
 *
 * @typedef {Object} SpriteDraw
 * @property {'sprite'} kind
 * @property {string|null} source        Diagnostic tag, e.g. 'gid:123/body'
 * @property {string|number|null} texture  Residency handle for the frame
 * @property {'indexed'|'rgba'} textureClass  R-SPR-014
 * @property {string|number|null} palette  Residency handle (indexed only)
 * @property {'nearest'|'linear'} sampler  R-SPR-014
 * @property {'spherical'} billboard      R-SPR-002
 * @property {[number, number, number]} position  World (x, y, z), lift applied
 * @property {[number, number]} offset    Sprite-pixel offset, as legacy `SpriteRenderer.offset`
 * @property {[number, number]} size     Sprite-pixel size, as legacy `SpriteRenderer.size`
 * @property {number} xSize               R-SPR-003 scale (5; baby 4; warp 20). 3D backends convert
 *                                        with `spriteToWorld` (px/175·xSize, offset y −0.5);
 *                                        the 2D path (preview2d) uses the pixels directly.
 * @property {number} ySize               R-SPR-003 scale, Y axis
 * @property {number} angle               Degrees
 * @property {boolean} mirror
 * @property {[number, number, number, number]} color  layer colour × effectColor (R-SPR-017)
 * @property {number} shadowFactor        R-SPR-012 (1 = no darkening)
 * @property {number} zIndex              R-SPR-006
 * @property {number} depthBias           Per-record bias; never carried over (R-DMG-009 fix)
 * @property {boolean} depthTest
 * @property {boolean} depthWrite
 * @property {boolean} depthCorrection    R-SPR-005
 * @property {boolean} ignoreDepthMinCap  R-SPR-005 (NPCs)
 * @property {import('./blend.js').BlendState} blend
 */

/** @type {Readonly<Omit<SpriteDraw, 'kind'>>} */
export const SPRITE_DEFAULTS = Object.freeze({
	source: null,
	texture: null,
	textureClass: 'indexed',
	palette: null,
	sampler: 'nearest',
	billboard: 'spherical',
	position: [0, 0, 0],
	offset: [0, 0],
	size: [0, 0],
	xSize: 5,
	ySize: 5,
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
	blend: BLEND_NORMAL
});

/**
 * @param {Partial<SpriteDraw>} fields
 * @returns {Readonly<SpriteDraw>}
 */
export function createSpriteDraw(fields = {}) {
	return Object.freeze({ ...SPRITE_DEFAULTS, ...fields, kind: 'sprite' });
}

/**
 * R-SPR-003 record units → world units, applied by the 3D backends exactly as
 * legacy `SpriteRenderer.render` did (SpriteRenderer.js:86-89).
 * @param {Pick<SpriteDraw, 'size'|'offset'|'xSize'|'ySize'>} record
 * @returns {{size: [number, number], offset: [number, number]}}
 */
export function spriteToWorld({ size, offset, xSize, ySize }) {
	return {
		size: [(size[0] / 175) * xSize, (size[1] / 175) * ySize],
		offset: [(offset[0] / 175) * xSize, (offset[1] / 175) * ySize - 0.5]
	};
}
