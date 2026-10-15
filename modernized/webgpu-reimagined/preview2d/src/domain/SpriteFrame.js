import { FRAME_TYPE } from '../constants.js';
import { Preview2DError } from '../errors.js';

/**
 * CPU-side SPR frame as produced by `Loaders/Sprite.js`.
 * - INDEXED: `data` holds one palette index per pixel (index 0 is transparent).
 * - RGBA: `data` holds RGBA bytes, already flipped and re-ordered (R-SPR-016).
 *
 * @typedef {Object} SpriteFrame
 * @property {0|1} type
 * @property {number} width
 * @property {number} height
 * @property {Uint8Array|Uint8ClampedArray} data
 */

/**
 * @param {Partial<SpriteFrame>} fields
 * @returns {Readonly<SpriteFrame>}
 */
export function createSpriteFrame({ type = FRAME_TYPE.INDEXED, width = 0, height = 0, data } = {}) {
	if (type !== FRAME_TYPE.INDEXED && type !== FRAME_TYPE.RGBA) {
		throw new Preview2DError(`unknown frame type ${type}`);
	}
	const bpp = type === FRAME_TYPE.RGBA ? 4 : 1;
	const expected = Math.max(0, width) * Math.max(0, height) * bpp;
	const buf = data ?? new Uint8Array(expected);
	if (buf.length < expected) {
		throw new Preview2DError(`frame data too short: ${buf.length} < ${expected}`);
	}
	return Object.freeze({ type, width, height, data: buf });
}

/** @param {SpriteFrame} frame */
export function isEmptyFrame(frame) {
	return !frame || frame.width <= 0 || frame.height <= 0;
}
