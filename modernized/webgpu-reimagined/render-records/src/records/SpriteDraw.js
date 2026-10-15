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
 * @property {[number, number]} offset    World-unit offset (R-SPR-003)
 * @property {[number, number]} size     World-unit size (R-SPR-003)
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
