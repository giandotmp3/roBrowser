/**
 * preview2d: synchronous Canvas2D composer for baked outputs.
 * Owns R-SPR-034 and the cursor-sheet / cursor-animation side of R-UI-005.
 */
export * from './constants.js';
export * from './errors.js';
export { createSpriteFrame, isEmptyFrame } from './domain/SpriteFrame.js';
export { colorizeFrame } from './domain/colorize.js';
export { VariantCache } from './domain/VariantCache.js';
export { computeDrawTransform } from './domain/DrawTransform.js';
export { CURSOR_ACTION, CURSOR_INFO, ENTITY_TYPE, cursorInfo } from './domain/CursorTypes.js';
export { selectCursorFrame, cursorHotspot, cursorStyle } from './domain/CursorAnimation.js';
export { Preview2DComposer, Preview2DTarget } from './api/Preview2DComposer.js';
export { CursorDriver } from './api/CursorDriver.js';
