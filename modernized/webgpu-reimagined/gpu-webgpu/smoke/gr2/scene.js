/**
 * The gr2 parity scene: camera, light, fog, the GR2 instances (entity-backed through
 * GR2ModelRenderer.attach, dev ones through spawn) and the action timeline.
 */

/** Map camera (legacy angle range, looking down from RO's negative Y). */
export const CAMERA = Object.freeze({ target: [20, 19], distance: 46, pitch: 230, yaw: 25, fovy: 20 });
/** Fog distances in view units (DB value × 240 already applied). */
export const FOG = Object.freeze({ near: 30, far: 62, color: [0.62, 0.68, 0.8] });
export const SKY = Object.freeze({ skyColor: [0.42, 0.55, 0.78, 1], cloudColor: null });
/** MAP_WORLD light block (R-CTX-012 inputs). */
export const LIGHT = Object.freeze({
	longitude: 45,
	latitude: 40,
	diffuse: [0.9, 0.85, 0.8],
	ambient: [0.45, 0.4, 0.5],
	opacity: 0.8
});
export const TICK_MS = 25;

/**
 * Entity-backed instances. `mob` false → NPC (bind pose, standbyIdx −1). `emblem` names
 * one of the page's emblem images. `culled` is the EntityManager view-area flag.
 */
export const ENTITIES = Object.freeze([
	{ id: 'flagMob', model: 'guildflag90_1', pos: [16, 22], dir: 2, mob: true, emblem: 'a' },
	{ id: 'flagNpc', model: 'guildflag90_1', pos: [24, 23], dir: 0, mob: false, emblem: 'b' },
	{ id: 'emp1', model: 'empelium90_0', pos: [20, 20], dir: 0, mob: true },
	{ id: 'emp2', model: 'empelium90_0', pos: [22, 18], dir: 4, mob: true },
	{ id: 'knight', model: 'kguardian90_7', pos: [17, 17], dir: 1, mob: true },
	{ id: 'archer', model: 'aguardian90_8', pos: [24, 16], dir: 3, mob: true },
	{ id: 'soldier', model: 'sguardian90_9', pos: [19, 15], dir: 5, mob: true },
	{ id: 'box', model: 'treasurebox_2', pos: [26, 20], dir: 6, mob: true },
	{ id: 'culled', model: 'sguardian90_9', pos: [21, 21], dir: 2, mob: true, culled: true },
	{ id: 'offscreen', model: 'kguardian90_7', pos: [70, 70], dir: 0, mob: true }
]);

/** Dev instances (GR2ModelRenderer.spawn): no entity, so no emblem and no action sync. */
export const SPAWNS = Object.freeze([
	{ model: 'guildflag90_1', pos: [13, 19], dir: 7 },
	{ model: 'aguardian90_8', pos: [27, 24], dir: 2, action: 'move' }
]);

/** Entity changes: `action` (entity ACTION name, re-issued), `alpha` (effectColor[3]). */
export const EVENTS = Object.freeze([
	{ at: 500, id: 'knight', action: 'WALK' },
	{ at: 500, id: 'soldier', action: 'HURT' },
	{ at: 500, id: 'box', action: 'HURT' },
	{ at: 1300, id: 'knight', action: 'ATTACK' },
	{ at: 1300, id: 'archer', action: 'ATTACK' },
	{ at: 1500, id: 'soldier', action: 'DIE' },
	{ at: 1500, id: 'box', action: 'DIE' },
	{ at: 1700, id: 'archer', alpha: 0.6 },
	{ at: 1700, id: 'emp2', alpha: 0.35 },
	{ at: 2000, id: 'archer', action: 'ATTACK' }
]);

/** Captured frames (legacy and gpu-webgl2 compared). */
export const CAPTURES = Object.freeze([
	{ at: 800, name: 'gr2-stand-move-damage', fog: false },
	{ at: 1450, name: 'gr2-attack-fog', fog: true },
	{ at: 1900, name: 'gr2-dead-fading', fog: false },
	{ at: 2400, name: 'gr2-reverted-fog', fog: true }
]);
