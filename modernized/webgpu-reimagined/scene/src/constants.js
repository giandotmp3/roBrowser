/**
 * Visual / timing constants owned by the scene module.
 * Values come from AI_NATIVE_SPEC.md §5 "Visual constants".
 */

export const FRAME = Object.freeze({
	DEFAULT_FPS_LIMIT: 60, // R-CTX-003
	OUT_OF_GAME_CAP: 60, // R-CTX-003
	RESIZE_DEBOUNCE_MS: 500 // R-CTX-008
});

export const PROJECTION = Object.freeze({
	NEAR: 1, // R-CTX-008
	FAR: 1000,
	VFOV_ISO: 15, // R-CAM-009
	VFOV_THIRD: 30,
	VFOV_FIRST: 50
});

export const CAMERA = Object.freeze({
	ALTITUDE_FROM: 0, // R-CAM-001: |altitudeTo - altitudeFrom| = 65
	ALTITUDE_TO: -65,
	MIN_ZOOM: 1,
	MAX_ZOOM: 5,
	INDOOR_MAX_ZOOM: 2.5,
	THIRD_PERSON_MIN_ZOOM: 0.2,
	ZOOM_STEP: 15,
	FIRST_PERSON_ZOOM_STEP_MULT: 0.3,
	DEFAULT_ZOOM: 125, // R-CAM-002
	DEFAULT_PITCH: 230,
	DEFAULT_YAW: 0,
	INDOOR_PITCH: 230,
	INDOOR_YAW: -40,
	PITCH_RESET_INDOOR: 240, // R-CAM-005
	YAW_RESET_INDOOR: -25,
	PITCH_ISO: Object.freeze([190, 270]), // R-CAM-003
	PITCH_INDOOR: Object.freeze([220, 240]),
	PITCH_THIRD: Object.freeze([175, 270]),
	PITCH_FIRST: Object.freeze([90, 270]),
	YAW_OUTDOOR: Object.freeze([-360, 360]), // R-CAM-004
	YAW_INDOOR: Object.freeze([-60, -25]),
	PITCH_DRAG_DEG: 300,
	YAW_DRAG_DEG: 720,
	LERP_PER_MS: 0.006, // R-CAM-006
	DOUBLE_CLICK_MS: 500, // R-CAM-005
	DOUBLE_CLICK_PX: 10,
	FIRST_PERSON_Z_OFFSET: 2, // R-CAM-009
	THIRD_PERSON_Z_OFFSET: 1.5,
	QUAKE_DURATION_MS: 650, // R-CAM-010
	QUAKE_SIDE: 1.0,
	QUAKE_LATITUDE: 0.2,
	QUAKE_ZOOM: 0.24,
	ZOOM_SAVE_DELAY_MS: 3000 // R-CAM-011
});

export const NIGHT = Object.freeze({
	STEP: 0.005, // R-CTX-013
	INTERVAL_MS: 8,
	FLOOR: 0.5
});

export const PICK = Object.freeze({
	GROUND_RAY_STEPS: 200, // R-PICK-001
	GROUND_RAY_TOLERANCE: 0.5,
	MIN_RECT_WIDTH: 60, // R-PICK-003
	MIN_RECT_WIDTH_ITEM: 30,
	DEFAULT_RECT: Object.freeze({ x0: -25, x1: 25, y0: 0, y1: 45 }),
	NO_UPDATE_JOB: 139,
	WALK_CURSOR_PACKETVER: 20200101 // R-PICK-002
});

export const SPRITE = Object.freeze({
	SCALE: 175, // R-SPR-003 (consumed for pick rect / overlay projection)
	ENTITY_LIFT: 0.2, // R-SPR-004
	PX_PER_CELL: 35
});

export const PERF = Object.freeze({
	SCENE_SCALE: 0.75, // R-PERF-002 / R-PP-003
	DEFAULT_VIEW_AREA: 14, // R-PERF-001
	EFFECT_CULL_RADIUS: 20, // R-PERF-002 / R-EFX-005
	SORT_EVERY_FRAMES: 3,
	SORT_EVERY_FRAMES_PERF: 6,
	TRAIL_MAX: 5,
	TRAIL_MAX_PERF: 2,
	ANIMATED_RSM_DIVISOR: 1.14,
	ANIMATED_RSM_DIVISOR_PERF: 2,
	BLOOM_SCALE: 0.25,
	BLOOM_SCALE_PERF: 0.125
});

/** R-UI-001 overlay anchors: world-unit lift + pixel offset. */
export const OVERLAY = Object.freeze({
	life: Object.freeze({ lift: -0.5, px: 0 }),
	name: Object.freeze({ lift: -0.5, px: 13 }),
	chat: Object.freeze({ lift: 90 / 35, px: 0, bottomAlignPx: 2 }),
	cast: Object.freeze({ lift: 90 / 35, px: 0 }),
	room: Object.freeze({ lift: 120 / 35, px: 0 }),
	emblem: Object.freeze({ lift: 140 / 35, px: 0 })
});

/** R-UI-002 life bar. */
export const LIFE_BAR = Object.freeze({
	WIDTH: 60,
	HP_HEIGHT: 5,
	EXTRA_BAR_HEIGHT: 4,
	BORDER: '#10189c',
	EMPTY: '#424242',
	HP_MOB: '#FF00E7',
	HP_PET: '#FFE7E7',
	HP_OTHER: '#10ef21',
	HP_LOW_MOB_PET: '#FFFF00',
	HP_LOW_OTHER: '#FF0000',
	LOW_THRESHOLD: 0.25,
	SP: '#1863de',
	AP: '#ffc663',
	Z_PC: 2,
	Z_OTHER: 1
});

/** R-UI-004 signboards. */
export const SIGNBOARD = Object.freeze({
	FULL: Object.freeze({ lift: 140 / 35, shiftLeftPx: 70 }),
	ICON_ONLY: Object.freeze({ lift: 120 / 35, shiftLeftPx: 15 })
});

/**
 * R-UI-005 cursor frame-rate multipliers: the legacy table (CursorManager.js:317-323), kept
 * by HITL round 2. Types missing from it use DEFAULT (2.0), as legacy CursorManager.js:230 does;
 * must match preview2d CURSOR_INFO.delayMult.
 */
export const CURSOR_SPEED = Object.freeze({
	DEFAULT: 2.0,
	TALK: 1.0,
	WARP: 1.0,
	ROTATE: 1.0,
	PICK: 1.0,
	TARGET: 0.5,
	NOWALK: 1.0
});
