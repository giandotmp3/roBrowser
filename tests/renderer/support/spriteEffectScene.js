/**
 * Scripted 3D and 2D EffectTable effects (Renderer/Effects/ThreeDEffect.js,
 * TwoDEffect.js) shared by the GL snapshot test and the record diff.
 *
 * Textures are named objects ({ id }); sprite-backed 3D effects use small synthetic
 * SPR/ACT resources. Spawn parameters follow EffectManager.spamEffect: positions are
 * copied unless the effect is attachedEntity (then the owner's live array is shared),
 * endTick = startTick + duration or -1 when open-ended.
 */

const tex = id => ({ id });

/** Texture files resolved by Client.loadFile -> WebGL.texture (buffer.name becomes the id). */
export const TEXTURE_FILES = Object.fromEntries(
	['a', 'b', 'c', 'f0', 'f1', 'f2'].map(n => [`data/texture/effect/${n}.tga`, { name: n }])
);

function frame(id, width, height) {
	return { texture: tex(id), width, height };
}

function sprLayer(fields) {
	return { index: 0, spr_type: 0, scale: [100, 100], is_mirror: false, color: [1, 1, 1, 1], angle: 0, pos: [0, 0], ...fields };
}

/** Indexed + RGBA frames: rgba_index 2, old_rgba_index 2 (frames 2.. are RGBA). */
const ABS_SPR = {
	frames: [frame('abs:0', 32, 64), frame('abs:1', 48, 48), frame('abs:2', 40, 20), frame('abs:3', 16, 16)],
	palette: new Uint8Array(4),
	texture: tex('abs:pal'),
	rgba_index: 2,
	old_rgba_index: 2
};

const ABS_ACT = {
	actions: [0, 1, 2].map(a => ({
		delay: 60 + a * 10,
		animations: [0, 1, 2].map(f => ({
			pos: f === 1 ? [] : [{ x: 3 + a, y: -2 - f }],
			layers: [
				sprLayer({ index: f % 2, angle: 10 + f, pos: [2, -4], color: [1, 0.5, 0.25, 0.8] }),
				sprLayer({ index: 1, spr_type: 1, scale: [50, 150], is_mirror: true, angle: 25, pos: [-6, 3] }),
				sprLayer({ index: 3, spr_type: 0, angle: -5, color: [0.5, 1, 1, 0.5] })
			]
		}))
	}))
};

/** RGBA-only sprite (rgba_index 0): every layer takes the RGBA branch. */
const NAME_SPR = {
	frames: [frame('nm:0', 20, 30), frame('nm:1', 24, 24)],
	palette: null,
	texture: tex('nm:pal'),
	rgba_index: 0,
	old_rgba_index: 0
};

const NAME_ACT = {
	actions: Array.from({ length: 16 }, (_, a) => ({
		delay: 100,
		animations: [
			{ pos: [{ x: 1, y: 1 }], layers: [sprLayer({ index: a % 2, angle: 7, pos: [1, 2] }), sprLayer({ index: 1, angle: 3 })] }
		]
	}))
};

const SHADOW_SPR = { frames: [frame('shadow:0', 24, 12)], palette: new Uint8Array(4), texture: tex('shadow:pal'), rgba_index: 1, old_rgba_index: 1 };
const SHADOW_ACT = {
	actions: [{ delay: 100, animations: [{ pos: [], layers: [sprLayer({ index: 0, pos: [0, 1] })] }] }]
};

/** Synchronously returned resources (Client.loadFile(path) without callback). */
export const SPRITE_FILES = {
	'data/sprite/fx/abs.spr': ABS_SPR,
	'data/sprite/fx/abs.act': ABS_ACT,
	'data/sprite/\xc0\xcc\xc6\xd1\xc6\xae/fx2.spr': NAME_SPR,
	'data/sprite/\xc0\xcc\xc6\xd1\xc6\xae/fx2.act': NAME_ACT,
	'data/sprite/shadow.spr': SHADOW_SPR,
	'data/sprite/shadow.act': SHADOW_ACT
};

export const ALL_FILES = { ...TEXTURE_FILES, ...SPRITE_FILES };

/** Altitude.getCellHeight stand-in (non-uniform terrain). */
export const cellHeight = (x, y) => 0.1 * x - 0.05 * y + 0.25;

/** Camera stand-in values per tick. */
export function cameraAt(tick) {
	return { angle1: ((tick - 1000) * 0.37) % 360, direction: Math.floor(tick / 211) % 8 };
}

export const TICKS = Array.from({ length: 44 }, (_, i) => 980 + i * 23);

const BLEND_CODES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, -1, 0, undefined];

function owner(name, position) {
	const o = {
		name,
		position,
		action: 1,
		direction: 2,
		xSize: 5,
		ySize: 5,
		attachment: null,
		log: []
	};
	o.attachments = {
		add: a => o.log.push(['add', a.completeFile, a.head, a.direction, a.repeat, a.stopAtEnd]),
		remove: key => o.log.push(['remove', key]),
		get: key => {
			o.log.push(['get', key]);
			return (o.attachment ??= {});
		}
	};
	return o;
}

/** 3D spawns. Sprite-backed ones come last (see LEAK_3D). */
export const SPAWNS_3D = [
	{ name: 'plain', effect: { file: 'effect/a.tga', posx: 1, angle: 20 }, duration: 600 },
	{
		name: 'fade',
		effect: { file: 'effect/a.tga', fadeIn: true, fadeOut: true, alphaMax: 0.8, blendMode: 2, red: 0.5, green: 0.7, blue: 0.9, zIndex: 3 },
		duration: 700
	},
	{ name: 'sparkle', effect: { file: 'effect/b.tga', sparkling: true, sparkNumber: 3, alphaMax: 1.5, blendMode: 5 }, duration: 800 },
	{
		name: 'sparkRand',
		effect: { file: 'effect/b.tga', sparkling: true, sparkNumberRand: [1, 4], alphaMax: 0.6, alphaMaxDelta: 0.1, blendMode: 7 },
		duplicateID: 2,
		duration: 800
	},
	...BLEND_CODES.map((blendMode, i) => ({
		name: `blend${blendMode}`,
		effect: { file: 'effect/c.tga', blendMode, size: 40 },
		start: 1000 + i * 40,
		duration: 60
	})),
	{ name: 'overlay', effect: { file: 'effect/a.tga', overlay: true, fadeIn: true, size: 80 }, duration: 500 },
	{
		name: 'rotPos',
		effect: { file: 'effect/a.tga', rotatePosX: 2, rotatePosY: 3, nbOfRotation: 2, rotateLate: 0.5, rotateLateDelta: 0.25, rotationClockwise: true, posz: 1 },
		duplicateID: 1,
		duration: 900
	},
	{
		name: 'smooth',
		effect: {
			file: 'effect/b.tga',
			posxStart: 1,
			posxEnd: 4,
			posxSmooth: true,
			posyStart: -2,
			posyEnd: 3,
			posySmooth: true,
			poszStart: 0.5,
			poszEnd: 2,
			poszSmooth: true,
			sizeStart: 50,
			sizeEnd: 120,
			sizeY: 80,
			sizeSmooth: true,
			rotate: true,
			angle: 10,
			toAngle: 190,
			rotateWithCamera: true
		},
		duration: 700
	},
	{
		name: 'smoothY',
		effect: { file: 'effect/b.tga', sizeStartX: 30, sizeStartY: 20, sizeEndY: 90, sizeSmooth: true, rotateWithCamera: true, angle: 5 },
		duration: 700
	},
	{
		name: 'linear',
		effect: {
			file: 'effect/c.tga',
			posxStart: -1,
			posxEnd: 2,
			posyEnd: 4,
			poszStart: 1,
			sizeStartX: 30,
			sizeEndX: 90,
			sizeStartY: 40,
			sizeEndY: 20,
			rotate: true,
			toAngle: -90
		},
		duration: 600
	},
	{
		name: 'rand',
		effect: {
			file: 'effect/c.tga',
			posxRand: 2,
			posxEndRand: 1,
			posxEndRandMiddle: 3,
			posyRandDiff: 1.5,
			poszStartRand: 1,
			poszStartRandMiddle: 2,
			poszEndRand: 0.5,
			posxStartRand: 0.7,
			posyEndRand: 0.4,
			posyStartRand: 0.3,
			posyRand: 1,
			poszRand: 0.2,
			posxRandDiff: 0.6,
			poszRandDiff: 0.8,
			size: 60,
			sizeRand: 10,
			sizeRandX: 20,
			sizeRandXMiddle: 80,
			sizeRandY: 5
		},
		duration: 600
	},
	{
		name: 'fromSrc',
		effect: {
			file: 'effect/a.tga',
			fromSrc: true,
			xOffset: 0.5,
			yOffset: -0.5,
			zOffset: 1,
			zOffsetStart: 0.2,
			zOffsetEnd: 0.4,
			posxStartRand: 0.5,
			poszEndRand: 0.3,
			posyEndRand: 0.2,
			rotateToTarget: true,
			arc: 3,
			size: 70
		},
		other: [14, 25, 2],
		duration: 600
	},
	{
		name: 'toSrc',
		effect: { file: 'effect/a.tga', toSrc: true, retreat: 2, arc: -1, posyStartRand: 0.4, poszStartRand: 0.1, posxEndRand: 0.2 },
		other: [6, 12, 0],
		duration: 600
	},
	{ name: 'soul0', effect: { file: 'effect/b.tga', soulStrikePattern: true, duration: 400, retreat: 1, arc: 2, posxEnd: 3 }, duration: 400 },
	{ name: 'soul1', effect: { file: 'effect/b.tga', soulStrikePattern: true, duration: 400, posyEnd: 2 }, duplicateID: 1, duration: 400 },
	{ name: 'drain', effect: { file: 'effect/b.tga', drainPattern: true, duration: 400, retreat: 1.5, posxEnd: -2 }, duplicateID: 1, duration: 400 },
	{
		name: 'attached',
		effect: { file: 'effect/a.tga', attachedEntity: true, posz: 2 },
		owner: [30, 40, 1],
		move: (o, tick) => {
			o.position[0] = 30 + (tick - 980) * 0.01;
			o.position[2] = 1 + ((tick / 100) % 3);
		},
		duration: 900
	},
	{ name: 'list', effect: { fileList: ['effect/f0.tga', 'effect/f1.tga', 'effect/f2.tga'], frameDelay: 40 }, duration: 800 },
	{ name: 'listDefault', effect: { fileList: ['effect/f0.tga', 'effect/f1.tga'], frameDelay: 'x' }, duration: 300 },
	{ name: 'sizeDelta', effect: { file: 'effect/c.tga', size: 50, sizeDelta: 5 }, duplicateID: 3, duration: 500 },
	{ name: 'noTexture', effect: { size: 40 }, duration: 300 },
	{ name: 'missing', effect: { file: 'effect/zz.tga' }, duration: 300 },
	{ name: 'open', effect: { file: 'effect/a.tga', size: 40 }, duration: 0 },
	{ name: 'late', effect: { file: 'effect/c.tga', fadeOut: true }, start: 1400, duration: 300 },
	{ name: 'shadow', effect: { shadowTexture: true, posxEnd: 3, size: 90 }, duration: 600 },
	{
		name: 'sprAbs',
		effect: { absoluteSpriteName: 'data/sprite/fx/abs', playSprite: true, angle: 15, size: 2, sizeEnd: 3, fadeIn: true, red: 0.8 },
		owner: [12.6, 22.3, 0],
		duration: 800
	},
	{
		name: 'sprName',
		effect: { spriteName: 'fx2', sprDelay: 50, rotateToTarget: true, posxEnd: 2, posyEnd: 2, overlay: true, blendMode: 2 },
		duration: 500
	}
];

/**
 * A plain 3D effect drawn right after a sprite-backed one inherits SpriteRenderer
 * state that only the sprite path sets (offset, palette). Snapshot-only; not diffed.
 */
export const LEAK_3D = [{ name: 'afterSprite', effect: { file: 'effect/a.tga', size: 30 }, duration: 900 }];

/** 2D spawns. */
export const SPAWNS_2D = [
	{ name: 'plain', effect: { file: 'effect/a.tga', size: 100, angle: 30 }, duration: 600 },
	{
		name: 'fade',
		effect: { file: 'effect/a.tga', size: 80, fadeIn: true, fadeOut: true, alphaMax: 0.7, blendMode: 6, red: 0.3, green: 0.6, blue: 0.2, zIndex: 2 },
		duration: 700
	},
	{ name: 'overlay', effect: { file: 'effect/b.tga', size: 60, overlay: true, alphaMax: 2, blendMode: 2 }, duration: 600 },
	...BLEND_CODES.map((blendMode, i) => ({
		name: `blend${blendMode}`,
		effect: { file: 'effect/c.tga', blendMode, size: 40 },
		start: 1010 + i * 40,
		duration: 60
	})),
	{
		name: 'smooth',
		effect: {
			file: 'effect/b.tga',
			posxStart: 1,
			posxEnd: 3,
			posxSmooth: true,
			posyStart: -1,
			posyEnd: 2,
			posySmooth: true,
			poszStart: 0.5,
			poszEnd: 1.5,
			poszSmooth: true,
			offsetxStart: 10,
			offsetxEnd: 40,
			offsetxSmooth: true,
			offsetyStart: -5,
			offsetyEnd: 20,
			offsetySmooth: true,
			sizeStartX: 50,
			sizeEndX: 150,
			sizeStartY: 80,
			sizeEndY: 40,
			sizeSmooth: true,
			rotate: true,
			angle: 30,
			toAngle: 120
		},
		duration: 700
	},
	{
		name: 'linear',
		effect: {
			file: 'effect/c.tga',
			posxStart: 2,
			posyEnd: -3,
			poszStart: 1,
			poszEnd: 3,
			offsetxStart: -8,
			offsetxEnd: 8,
			offsetyEnd: 12,
			sizeStart: 20,
			sizeEnd: 60,
			sizeX: 45
		},
		duration: 600
	},
	{
		name: 'fixed',
		effect: { file: 'effect/c.tga', posx: 1, posy: 2, posz: 0.5, offsetx: 5, offsety: -4, size: 70, sizeStartY: 30, sizeEndX: 90, sizeEndY: 10 },
		duration: 600
	},
	{
		name: 'rand',
		effect: {
			file: 'effect/a.tga',
			posxRand: 3,
			posxRandDiff: 2,
			posxStartRand: 1,
			posxStartRandMiddle: 2,
			posxEndRand: 2,
			posyRand: 2,
			posyRandDiff: 2,
			posyStartRand: 2,
			posyStartRandMiddle: 1,
			posyEndRand: 1,
			poszRand: 1,
			poszRandDiff: 1,
			poszStartRand: 1,
			poszEndRand: 1,
			poszEndRandMiddle: 2,
			offsetxRand: 4,
			offsetxRandDiff: 3,
			offsetxStartRand: 3,
			offsetxEndRand: 2,
			offsetxEndRandMiddle: 5,
			offsetyRand: 4,
			offsetyRandDiff: 6,
			offsetyStartRand: 2,
			offsetyEndRand: 2,
			offsetyEndRandMiddle: 5,
			size: 50,
			sizeRand: 20,
			sizeRandX: 30,
			sizeRandXMiddle: 120,
			sizeRandY: 10,
			angleRand: [10, 80],
			sizeRandStartX: [20, 30],
			sizeRandStartY: [25, 35],
			sizeRandEndX: [60, 70],
			sizeRandEndY: [5, 15],
			durationRand: [200, 300]
		},
		duration: 600
	},
	{
		name: 'circle',
		effect: {
			file: 'effect/b.tga',
			circlePattern: true,
			angleRand: [0, 35],
			circleOuterSizeRand: [5, 6],
			circleInnerSize: 2.2,
			sizeEndX: 1,
			sizeRandEndY: [250, 300],
			sizeRandStartX: [25, 40],
			sizeRandStartY: [10, 10],
			fadeOut: true,
			overlay: true,
			alphaMax: 12
		},
		duration: 500
	},
	{ name: 'rotTarget', effect: { file: 'effect/a.tga', rotateToTarget: true, posxEnd: 2, posyEnd: 2, size: 60, angle: 5 }, duration: 500 },
	{
		name: 'attached',
		effect: { file: 'effect/a.tga', attachedEntity: true, shadowTexture: true, size: 50, posxEnd: 1, offsetyStart: 3 },
		owner: [20, 30, 0.5],
		move: (o, tick) => {
			o.position[1] = 30 - (tick - 980) * 0.02;
		},
		duration: 600
	},
	{ name: 'ownerNoShadow', effect: { file: 'effect/b.tga', size: 40 }, owner: [5, 5, 0], duration: 300 },
	{ name: 'missing', effect: { file: 'effect/zz.tga', size: 40 }, duration: 300 },
	{ name: 'open', effect: { file: 'effect/a.tga', size: 40 }, duration: 0 },
	{ name: 'late', effect: { file: 'effect/c.tga', size: 40, fadeIn: true }, start: 1500, duration: 300 }
];

/**
 * Spawn instances the way EffectManager.spamEffect does.
 * @returns {Array<{name, spawn, effect, owner, move?}>}
 */
export function spawnEffects(Ctor, spawns) {
	return spawns.map(spawn => {
		const ownerEntity = spawn.owner ? owner(spawn.name, spawn.owner.slice()) : undefined;
		const base = ownerEntity ? ownerEntity.position : [10, 20, 1];
		const position = spawn.effect.attachedEntity ? base : base.slice();
		const startTick = spawn.start ?? 1000;
		const duration = spawn.duration;
		const effectDef = { ...spawn.effect };
		const inst = {
			position,
			otherPosition: spawn.other ?? [position[0] - 5, position[1] + 5, position[2]],
			startTick,
			endTick: duration > 0 ? startTick + duration : -1,
			duplicateID: spawn.duplicateID ?? 0
		};
		const init = { ownerAID: 77, ownerEntity };
		const effect = new Ctor(effectDef, inst, init);
		return {
			name: spawn.name,
			spawn,
			effectDef,
			inst,
			effect,
			owner: ownerEntity,
			move: spawn.move && ownerEntity ? tick => spawn.move(ownerEntity, tick) : null
		};
	});
}
