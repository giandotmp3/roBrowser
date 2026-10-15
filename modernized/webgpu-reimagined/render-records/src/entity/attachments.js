import { notImplemented } from '../util/errors.js';

export const HEAD_ATTACHMENT_LIFT_PX = 100;

/**
 * R-SPR-031 per-record state of a sprite attachment.
 * @param {{opacity?: number, behind?: boolean, head?: boolean, directional?: boolean}} a
 * @param {number} visualDir
 */
export function attachmentRecordState({ opacity = 1, behind = false, head = false, directional = false }, visualDir) {
	return {
		color: [1, 1, 1, opacity],
		zIndex: behind ? 1 : 500,
		depthWrite: false,
		ignoreShadow: behind,
		liftPx: head ? HEAD_ATTACHMENT_LIFT_PX : 0,
		direction: directional ? visualDir : 0
	};
}

/**
 * R-SPR-031 attachment lifetime (non-repeat removed at last frame unless
 * stopAtEnd; `duration` caps repeating ones). Pending.
 * @param {Object} _attachment
 * @param {number} _tick
 * @returns {{alive: boolean, frame: number}}
 */
export function attachmentLifetime(_attachment, _tick) {
	return notImplemented('R-SPR-031', 'attachment lifetime');
}

/**
 * R-SPR-032 STR attachment scale and offsets.
 * @param {{xSize: number, ySize: number, xOffset?: number, yOffset?: number}} s
 */
export function strAttachmentTransform({ xSize, ySize, xOffset = 0, yOffset = 0 }) {
	const scale = (xSize + ySize) / 2 / 5;
	return {
		scale,
		pivot: [320, 320],
		verticalBase: 0,
		offset: [xOffset * 0.2 * 35 * scale, yOffset * 0.2 * 35 * scale]
	};
}

/**
 * R-SPR-032 persistent hat effect: reuse last valid frame on blank keys,
 * restart when all layers are blank. Pending.
 * @param {Object} _state
 * @param {number} _keyIndex
 */
export function persistentHatFrame(_state, _keyIndex) {
	return notImplemented('R-SPR-032', 'persistent hat effect frame reuse');
}
