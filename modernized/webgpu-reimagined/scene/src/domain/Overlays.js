import { OVERLAY, SIGNBOARD, SPRITE } from '../constants.js';
import { transformVec4 } from '../math/mat4.js';
import { notImplemented } from '../errors.js';

/**
 * DOM overlay projection (C-13, R-UI-001, R-UI-003, R-UI-004, R-PP-011 fix).
 *
 * R-PP-011 is fixed here: when the illusion flip is active, EVERY overlay kind and the
 * entity hover rectangles mirror Y (legacy mirrored only ground pick, signboards, life bars).
 */

/**
 * Project a world point to CSS px.
 * @param {Float32Array} viewProjection
 * @param {number[]} p [x, y-up, z] scene space
 * @param {{width:number,height:number}} viewport CSS px
 * @param {{ flipped?: boolean }} [opts]
 * @returns {{x:number,y:number,w:number}}
 */
export const projectToScreen = (viewProjection, p, viewport, { flipped = false } = {}) => {
	const [cx, cy, , cw] = transformVec4(viewProjection, [p[0], p[1], p[2], 1]);
	const x = ((cx / cw + 1) / 2) * viewport.width;
	let y = ((1 - cy / cw) / 2) * viewport.height;
	if (flipped) {
		y = viewport.height - y;
	}
	return { x, y, w: cw };
};

/** World (x, y, z) -> scene origin (x+0.5, -z, y+0.5) (spec §5 shared conventions). */
export const sceneOrigin = (position) => [position[0] + 0.5, -position[2], position[1] + 0.5];

/**
 * Billboard-space anchor for an overlay kind (R-UI-001). The offset is applied in the
 * spherical-billboard local frame (Y), then projected.
 * @param {keyof typeof OVERLAY} kind
 * @param {number[]} position world [x, y, z]
 * @returns {{ origin: number[], billboardY: number, pxOffsetY: number }}
 */
export const overlayAnchor = (kind, position) => {
	const spec = OVERLAY[kind];
	if (!spec) {
		throw new RangeError(`unknown overlay kind ${kind}`);
	}
	return { origin: sceneOrigin(position), billboardY: spec.lift, pxOffsetY: spec.px };
};

/**
 * Full overlay placement including projection and mirroring (R-UI-001 + R-PP-011 fix).
 * @param {object} _args
 */
export const placeOverlay = (_args) => notImplemented('placeOverlay (projected DOM placement)', 'R-UI-001', 'R-PP-011');

/**
 * R-PP-011 fix applied to a pick rect: mirror Y across the viewport.
 * @param {{x0:number,x1:number,y0:number,y1:number}} rect
 * @param {number} viewportHeight
 */
export const mirrorRectY = (rect, viewportHeight) => ({
	x0: rect.x0,
	x1: rect.x1,
	y0: viewportHeight - rect.y1,
	y1: viewportHeight - rect.y0
});

/**
 * R-UI-003: hide/show every overlay canvas of an entity depending on cull state.
 * @param {import('./EntityTypes.js').SceneEntity} entity
 * @param {boolean} culled
 */
export const applyCullToOverlays = (entity, culled) => {
	for (const node of Object.values(entity.overlays ?? {})) {
		if (culled) {
			node.style.display = 'none';
		} else if (node.style.display === 'none') {
			node.style.display = '';
		}
	}
};

/**
 * R-UI-004 signboard anchor: ground level at cell centre, lifted, shifted left.
 * @param {number} x
 * @param {number} y
 * @param {{ iconOnly?: boolean }} opts
 * @param {{ getCellHeight: (x:number,y:number)=>number }} altitude
 */
export const signboardAnchor = (x, y, { iconOnly = false }, altitude) => {
	const spec = iconOnly ? SIGNBOARD.ICON_ONLY : SIGNBOARD.FULL;
	return {
		origin: sceneOrigin([x, y, altitude.getCellHeight(x, y)]),
		billboardY: spec.lift,
		shiftLeftPx: spec.shiftLeftPx
	};
};

export const PX_TO_CELLS = 1 / SPRITE.PX_PER_CELL;
