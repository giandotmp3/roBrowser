/**
 * Visual constants for the Canvas2D baked-output path.
 * Values are the acceptance oracle (spec §5 appendix, R-SPR-034, R-UI-005).
 */

/** R-SPR-034: Y is lifted half a cell (0.5 * 35 px) so the origin is the cell middle. */
export const CELL_MIDDLE_Y = 0.5 * 35;

/** R-SPR-034: colour variants cached per (frame, palette) before FIFO eviction. */
export const MAX_COLOR_VARIANTS = 8;

/** Legacy `bind2DContext` forces xSize = ySize = 5 for the 2D path. */
export const PREVIEW_SPRITE_SIZE = 5;

/** SPR frame types (Loaders/Sprite.js). */
export const FRAME_TYPE = Object.freeze({
	INDEXED: 0,
	RGBA: 1
});

/** Cursor sheet cell size in CSS px (CursorManager.js preCompiledAnimations). */
export const CURSOR_CELL_SIZE = 50;
