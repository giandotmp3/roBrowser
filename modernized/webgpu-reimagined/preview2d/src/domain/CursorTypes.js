/**
 * Cursor action indices (ACT action slots in cursors.act) and the per-type
 * table from legacy CursorManager.js (ActionInformations).
 *
 * - drawX/drawY: 2D origin used when baking each frame into its 50x50 cell.
 * - startX/startY: hotspot; the cursor element is translated by (-startX, -startY).
 * - delayMult: frame delay multiplier (R-UI-005, legacy table per HITL round 2: DEFAULT 2.0,
 *   TARGET 0.5, the other listed types 1.0; unlisted types use DEFAULT's 2.0).
 */
export const CURSOR_ACTION = Object.freeze({
	DEFAULT: 0,
	TALK: 1,
	CLICK: 2,
	LOCK: 3,
	ROTATE: 4,
	ATTACK: 5,
	WARP: 7,
	PICK: 9,
	TARGET: 10,
	NOWALK: 13
});

/**
 * @typedef {Object} CursorInfo
 * @property {number} drawX
 * @property {number} drawY
 * @property {number} startX
 * @property {number} startY
 * @property {number} delayMult
 */

/** @type {Readonly<Record<number, Readonly<CursorInfo>>>} */
export const CURSOR_INFO = Object.freeze({
	[CURSOR_ACTION.DEFAULT]: Object.freeze({ drawX: 1, drawY: 19, startX: 0, startY: 0, delayMult: 2.0 }),
	[CURSOR_ACTION.TALK]: Object.freeze({ drawX: 20, drawY: 40, startX: 20, startY: 20, delayMult: 1.0 }),
	[CURSOR_ACTION.WARP]: Object.freeze({ drawX: 10, drawY: 32, startX: 0, startY: 0, delayMult: 1.0 }),
	[CURSOR_ACTION.ROTATE]: Object.freeze({ drawX: 18, drawY: 26, startX: 10, startY: 0, delayMult: 1.0 }),
	[CURSOR_ACTION.PICK]: Object.freeze({ drawX: 20, drawY: 40, startX: 15, startY: 15, delayMult: 1.0 }),
	[CURSOR_ACTION.TARGET]: Object.freeze({ drawX: 20, drawY: 50, startX: 20, startY: 28, delayMult: 0.5 }),
	[CURSOR_ACTION.NOWALK]: Object.freeze({ drawX: 13, drawY: 25, startX: 14, startY: 6, delayMult: 1.0 })
});

/**
 * Per-type info; unknown types (CLICK, LOCK, ATTACK, ...) fall back to DEFAULT
 * for hotspot, draw origin and delayMult (2.0), as legacy CursorManager.js:230 does.
 * HITL round 2 kept this legacy table over the spec wording "others 1.0".
 *
 * @param {number} type
 * @returns {Readonly<CursorInfo>}
 */
export function cursorInfo(type) {
	return CURSOR_INFO[type] ?? CURSOR_INFO[CURSOR_ACTION.DEFAULT];
}

/** Legacy Entity.TYPE_* values relevant to cursor magnetism. */
export const ENTITY_TYPE = Object.freeze({
	PC: 0,
	ITEM: 2,
	MOB: 5,
	NPC: 6,
	NPC_ABR: 13,
	NPC_BIONIC: 14
});
