import {
	Action,
	BABY_XSIZE,
	DEFAULT_XSIZE,
	ENTITY_LIFT,
	EntityType,
	SPRITE_PIXEL_DIVISOR,
	WARP_XSIZE
} from './constants.js';

/**
 * R-SPR-001 visual direction.
 * @param {number} cameraDirection 0..7 (R-CAM-008)
 * @param {number} entityDirection 0..7
 */
export function visualDirection(cameraDirection, entityDirection) {
	return (cameraDirection + entityDirection + 8) % 8;
}

/**
 * R-SPR-001 ACT action index. A negative action renders as IDLE.
 * @param {number} action
 * @param {number} visualDir
 * @param {number} actionCount
 */
export function actIndex(action, visualDir, actionCount) {
	const a = action < 0 ? Action.IDLE : action;
	return (a * 8 + visualDir) % actionCount;
}

/**
 * R-SPR-003 xSize selection.
 * @param {{isBaby?: boolean, isWarp?: boolean}} entity
 */
export function xSizeFor({ isBaby = false, isWarp = false } = {}) {
	if (isWarp) {
		return WARP_XSIZE;
	}
	return isBaby ? BABY_XSIZE : DEFAULT_XSIZE;
}

/**
 * R-SPR-003 pixels → world units.
 * @param {number} pixels
 * @param {number} [xSize]
 */
export function pixelsToWorld(pixels, xSize = DEFAULT_XSIZE) {
	return (pixels / SPRITE_PIXEL_DIVISOR) * xSize;
}

/**
 * R-SPR-003 offsets: same scale, minus 0.5 on Y.
 * @param {[number, number]} offsetPx
 * @param {number} [xSize]
 * @returns {[number, number]}
 */
export function offsetToWorld([x, y], xSize = DEFAULT_XSIZE) {
	return [pixelsToWorld(x, xSize), pixelsToWorld(y, xSize) - 0.5];
}

/**
 * R-SPR-004 body lift (also used by picking).
 * @param {[number, number, number]} position
 * @returns {[number, number, number]}
 */
export function liftedBodyPosition([x, y, z]) {
	return [x, y, z + ENTITY_LIFT];
}

/**
 * R-SPR-005 depth-correction flags for an entity body record.
 * @param {string} type EntityType
 */
export function depthCorrectionFlags(type) {
	return { depthCorrection: true, ignoreDepthMinCap: type === EntityType.NPC };
}

/**
 * R-SPR-006 CPU reference of the shader z bias (parity oracle for backends).
 * @param {number} zIndex
 * @param {number} depthBias
 * @param {number} zoom
 */
export function zIndexClipBias(zIndex, depthBias, zoom) {
	return (zIndex * 0.01 + depthBias) / Math.max(zoom, 1);
}
