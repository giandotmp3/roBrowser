/** Visual constants for the entity layer (spec §5 appendix). */

/** @enum {string} */
export const EntityType = Object.freeze({
	PC: 'PC',
	MERC: 'MERC',
	HOM: 'HOM',
	FALCON: 'FALCON',
	NPC: 'NPC',
	MOB: 'MOB',
	ITEM: 'ITEM',
	EFFECT: 'EFFECT',
	PET: 'PET',
	ELEM: 'ELEM',
	WUG: 'WUG',
	NPC_ABR: 'NPC_ABR',
	NPC_BIONIC: 'NPC_BIONIC',
	WARP: 'WARP'
});

/** Subset of ACTION ids needed by render rules. */
export const Action = Object.freeze({
	IDLE: 0,
	WALK: 1,
	SIT: 2,
	PICKUP: 3,
	READYFIGHT: 4,
	ATTACK: 5,
	HURT: 6,
	FREEZE2: 7,
	DIE: 8
});

export const SPRITE_PIXEL_DIVISOR = 175;
export const DEFAULT_XSIZE = 5;
export const BABY_XSIZE = 4;
export const WARP_XSIZE = 20;
export const ENTITY_LIFT = 0.2;
export const SHADOW_LIFT = 0.05;
export const ACT_TICK_MS = 25;
export const DEFAULT_FRAME_DELAY_MS = 150;
/** 4.6 · 0.37 · 4 · 25 (R-SPR-028) */
export const WALK_MOTION_CONSTANT = 4.6 * 0.37 * 4 * 25;
export const BODY_Z = 250;
export const DEFAULT_BODY_ZINDEX = 150;
export const FALCON_ZINDEX = 1000;
/** Job id that never casts a shadow (R-SPR-011). */
export const NO_SHADOW_JOB = 45;
