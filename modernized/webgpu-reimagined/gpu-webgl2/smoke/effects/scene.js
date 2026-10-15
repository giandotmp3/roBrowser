/**
 * Effect parity scene: STR effects (legacy Renderer/Effects/StrEffect.js) and 3D/2D
 * EffectTable effects (ThreeDEffect.js, TwoDEffect.js), spawned the way
 * EffectManager / EntityAttachments spawn them. Browser-safe port of the root
 * suite's tests/renderer/support/strEffectScene.js and spriteEffectScene.js: same
 * keyframes, flags and blend codes, positions moved around one camera target, and
 * textures named after smoke/effects/assets.js images.
 *
 * Kept out (declared, see smoke/README.md):
 * - invalid blend codes (#41: STR 0/12/13 and non-integers; #49: in-range non-integer
 *   2D/3D codes) and the WebGL-invalid STR pair 14/15 (CONSTANT_COLOR with
 *   ONE_MINUS_CONSTANT_ALPHA): legacy keeps the previous draw's blend there; the rebuild
 *   draws normal alpha;
 * - the #47 state leak (a plain 3D effect after a sprite-backed one in the same pass);
 *   sprite-backed 3D effects come last, as in the root suite;
 * - a missing STR file (legacy StrEffect.render dereferences the undefined file).
 */

/** Camera (common.js cameraMatrices): looks at the effects. */
export const CAMERA = Object.freeze({ target: [10, 20], distance: 40, pitch: 50, yaw: 25, fovy: 20 });

/** Scene fog of the fog frames: near/far bracket the effects' depth (≈ 36–44). */
export const FOG = Object.freeze({ use: true, exist: true, near: 30, far: 56, color: [0.55, 0.6, 0.75] });

/** Legacy timeline: every tick renders (persistent/hat state), these are captured. */
export const START_TICK = 980;
export const TICK_MS = 20;
export const CAPTURES = Object.freeze([
	{ name: 'effects-t1040', at: 1040, fog: false },
	{ name: 'effects-t1200', at: 1200, fog: false },
	{ name: 'effects-t1300-fog', at: 1300, fog: true },
	{ name: 'effects-t1400', at: 1400, fog: false },
	{ name: 'effects-t1560', at: 1560, fog: false }
]);

/* -------------------------------------------------------------------- STR */

/** One STR keyframe in loader shape (colours already /255). */
function key(fields) {
	const k = {
		frame: 0,
		type: 0,
		pos: [320, 320],
		uv: [0, 0, 1, 0, 0, 1, 1, 1],
		xy: [-40, 40, -40, 40, -60, -60, 60, 60],
		aniframe: 0,
		anitype: 0,
		delay: 0,
		angle: 0,
		color: [1, 1, 1, 1],
		srcalpha: 5,
		destalpha: 2,
		mtpreset: 0,
		...fields
	};
	for (const f of ['pos', 'uv', 'xy', 'color']) {
		k[f] = new Float32Array(k[f]);
	}
	return k;
}

/** A delta key: every interpolated field moves by these amounts per key. */
const delta = fields =>
	key({
		type: 1,
		pos: [0, 0],
		uv: [0, 0, 0, 0, 0, 0, 0, 0],
		xy: [0, 0, 0, 0, 0, 0, 0, 0],
		color: [0, 0, 0, 0],
		anitype: 1,
		...fields
	});

/** @param {Array<string|undefined>} textures  image names (undefined: never loaded) */
function layer(textures, animations) {
	return {
		texcnt: textures.length,
		texname: textures.map(t => t ?? 'missing'),
		textures,
		materials: [],
		anikeynum: animations.length,
		animations
	};
}

function str(fps, maxKey, layers) {
	return { header: 'STRM', version: 0x94, fps, maxKey, layernum: layers.length, layers };
}

const M = ['str/m0', 'str/m1', 'str/m2', 'str/m3'];

/** Compiled STR files (Loaders/Str.js output); the page attaches `materials`. */
export function strFiles() {
	return {
		// Multiple layers, interpolation, anitype 1-4 and default, re-sourced keys.
		'data/texture/effect/multi.str': str(30, 20, [
			layer(M.slice(0, 3), [
				key({ frame: 0, pos: [300, 330], color: [1, 0.5, 0.25, 1], angle: 10 }),
				delta({
					frame: 0,
					aniframe: 0.25,
					color: [0, 0.01, 0, -0.02],
					pos: [1.5, -2],
					xy: [-0.5, 0.5, -0.25, 0.25, -1, -1, 1, 1],
					angle: 3
				}),
				key({ frame: 8, srcalpha: 5, destalpha: 6, aniframe: 1, angle: 45 }),
				delta({ frame: 8, anitype: 2, delay: 0.5, angle: -2, pos: [-3, 1] }),
				key({ frame: 16, aniframe: 2 })
			]),
			layer(M.slice(0, 2), [
				key({
					frame: 2,
					srcalpha: 9,
					destalpha: 6,
					color: [0.8, 0.8, 1, 0.6],
					xy: [-16, 16, -16, 16, -8, -8, 24, 24]
				}),
				delta({ frame: 2, anitype: 3, delay: 0.7, color: [0, 0, -0.02, 0.01] })
			]),
			layer(M.slice(0, 4), [
				key({ frame: 0, aniframe: 3, angle: 90 }),
				delta({ frame: 0, anitype: 4, delay: 0.3 })
			]),
			layer(M.slice(0, 2), [
				key({ frame: 0, srcalpha: 2, destalpha: 2, aniframe: 1 }),
				delta({ frame: 0, anitype: 7, aniframe: 1 })
			])
		]),

		// D3D blend pairs, including the rare constant (blend constant 0, legacy never sets
		// it) and saturate factors. 14/15 (constant colour with constant alpha) is invalid
		// in WebGL: replaced by 14/6 and 1/15.
		'data/texture/effect/blends.str': str(
			60,
			30,
			[
				[11, 6],
				[14, 6],
				[1, 15],
				[1, 3],
				[7, 8],
				[4, 10],
				[9, 2]
			].map(([s, d], i) =>
				layer(
					[`str/b${i}`],
					[
						key({ frame: 0, srcalpha: s, destalpha: d, angle: i * 15, pos: [300 + i * 12, 310] }),
						delta({ frame: 0 })
					]
				)
			)
		),

		// Persistent loop (wraps at maxKey, never removed).
		'data/texture/effect/loop.str': str(20, 10, [
			layer(['str/l0', 'str/l1'], [key({ frame: 0, angle: 5 }), delta({ frame: 0, pos: [2, 1], aniframe: 0.2 })])
		]),

		// Hat effect: layer 0 goes blank at key 6, layer 1 at key 9 (both blank → restart).
		'data/texture/effect/hat.str': str(20, 12, [
			layer(
				['str/h0', 'str/h1'],
				[
					key({ frame: 0, pos: [310, 300], angle: 20 }),
					delta({ frame: 0, aniframe: 0.3, pos: [1, 1], angle: 1 }),
					key({ frame: 6 })
				]
			),
			layer(
				['str/k0'],
				[
					key({ frame: 0, srcalpha: 5, destalpha: 6, color: [1, 1, 1, 0.5] }),
					delta({ frame: 0, color: [0, 0, 0, 0.02], xy: [-1, 1, -1, 1, 0, 0, 0, 0] }),
					key({ frame: 9 })
				]
			)
		]),

		// Fallback textures: material 1 never loaded, a layer with no textures, a late layer,
		// and a 200×100 material (stretched to 256×128).
		'data/texture/effect/holes.str': str(10, 8, [
			layer(['str/f0', undefined, 'str/f2'], [key({ frame: 0 }), delta({ frame: 0, aniframe: 0.5 })]),
			layer([], [key({ frame: 0 }), delta({ frame: 0 })]),
			layer(
				['str/f3'],
				[key({ frame: 3, angle: -30, srcalpha: 5, destalpha: 6 }), delta({ frame: 3, angle: -5 })]
			)
		]),

		// The CPU fog check: one opaque layer, normal blend, alpha 1, no black texel.
		'data/texture/effect/fog.str': str(10, 1000, [
			layer(
				['str/fog'],
				[
					key({ frame: 0, srcalpha: 5, destalpha: 6, xy: [-90, 90, -90, 90, -70, -70, 70, 70] }),
					delta({ frame: 0 })
				]
			)
		])
	};
}

/** Owner entity of the attachment effects; moves every tick. */
function makeOwner() {
	return { position: [8.5, 21, 0.5], direction: 2, xSize: 10, ySize: 8 };
}

function moveOwner(owner, tick) {
	owner.position[0] = 8.5 + (tick - 1000) / 400;
	owner.position[1] = 21 - (tick - 1000) / 800;
}

/** STR spawns (strEffectScene.js SPAWNS, repositioned). */
export const STR_SPAWNS = [
	{ name: 'multi', file: 'data/texture/effect/multi.str', position: [10, 20, 1], startTick: 1000 },
	{ name: 'blends', file: 'data/texture/effect/blends.str', position: [7.5, 18.5, 0], startTick: 1000 },
	{
		name: 'loop',
		file: 'data/texture/effect/loop.str',
		position: [12.5, 21.5, 2],
		startTick: 1000,
		persistent: true
	},
	{
		name: 'hat',
		file: 'data/texture/effect/hat.str',
		position: [0, 0, 0],
		startTick: 1000,
		persistent: true,
		attachment: { xOffset: 3, yOffset: -2 }
	},
	{
		name: 'hatOnce',
		file: 'data/texture/effect/hat.str',
		position: [0, 0, 0],
		startTick: 1100,
		attachment: { xOffset: 0, yOffset: 4 }
	},
	{ name: 'holes', file: 'data/texture/effect/holes.str', position: [11.5, 17.5, 1], startTick: 1040 }
];

/** The isolated STR of the CPU fog check. */
export const FOG_CHECK_SPAWN = {
	name: 'fogCheck',
	file: 'data/texture/effect/fog.str',
	position: [10, 20, 1],
	startTick: 0
};

/** Build legacy StrEffect instances the way EffectManager / EntityAttachments do. */
export function spawnStr(StrEffect, spawns = STR_SPAWNS) {
	return spawns.map(spawn => {
		const effect = new StrEffect(spawn.file, spawn.position.slice(), spawn.startTick, '');
		let move = null;
		if (spawn.persistent) {
			effect.persistent = true;
		}
		if (spawn.attachment) {
			const owner = makeOwner();
			effect.ownerEntity = owner;
			effect.xOffset = spawn.attachment.xOffset;
			effect.yOffset = spawn.attachment.yOffset;
			move = tick => moveOwner(owner, tick);
		}
		return { name: spawn.name, effect, move };
	});
}

/* ------------------------------------------------------------------ 2D/3D */

/** Valid 2D/3D blendMode codes: GL-order 1..15, and 0/16/-1/undefined (normal alpha). */
const BLEND_CODES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, -1, 0, undefined];

function makeEffectOwner(name, position) {
	const o = { name, position, action: 1, direction: 2, xSize: 5, ySize: 5, attachment: null };
	o.attachments = {
		add: () => {},
		remove: () => {},
		get: () => (o.attachment ??= {})
	};
	return o;
}

/** 3D spawns (spriteEffectScene.js SPAWNS_3D). Sprite-backed ones come last (#47). */
export const SPAWNS_3D = [
	{ name: 'plain', effect: { file: 'effect/a.tga', posx: 1, angle: 20 }, duration: 600 },
	{
		name: 'fade',
		effect: {
			file: 'effect/a.tga',
			fadeIn: true,
			fadeOut: true,
			alphaMax: 0.8,
			blendMode: 2,
			red: 0.5,
			green: 0.7,
			blue: 0.9,
			zIndex: 3
		},
		duration: 700
	},
	{
		name: 'sparkle',
		effect: { file: 'effect/b.tga', sparkling: true, sparkNumber: 3, alphaMax: 1.5, blendMode: 5 },
		duration: 800
	},
	{
		name: 'sparkRand',
		effect: {
			file: 'effect/b.tga',
			sparkling: true,
			sparkNumberRand: [1, 4],
			alphaMax: 0.6,
			alphaMaxDelta: 0.1,
			blendMode: 7
		},
		duplicateID: 2,
		duration: 800
	},
	...BLEND_CODES.map((blendMode, i) => ({
		name: `blend${blendMode}`,
		effect: { file: 'effect/c.tga', blendMode, size: 40, posx: (i % 5) - 2, posy: Math.floor(i / 5) - 2 },
		start: 1000 + i * 30,
		duration: 400
	})),
	{ name: 'overlay', effect: { file: 'effect/a.tga', overlay: true, fadeIn: true, size: 80 }, duration: 500 },
	{
		name: 'rotPos',
		effect: {
			file: 'effect/a.tga',
			rotatePosX: 2,
			rotatePosY: 3,
			nbOfRotation: 2,
			rotateLate: 0.5,
			rotateLateDelta: 0.25,
			rotationClockwise: true,
			posz: 1
		},
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
			posyRandDiff: 1.5,
			poszStartRand: 1,
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
			posxStartRand: 0.5,
			rotateToTarget: true,
			arc: 3,
			size: 70
		},
		other: [13, 23, 2],
		duration: 600
	},
	{
		name: 'toSrc',
		effect: { file: 'effect/a.tga', toSrc: true, retreat: 2, arc: -1, posyStartRand: 0.4 },
		other: [7, 17, 0],
		duration: 600
	},
	{
		name: 'soul0',
		effect: { file: 'effect/b.tga', soulStrikePattern: true, duration: 400, retreat: 1, arc: 2, posxEnd: 3 },
		duration: 400
	},
	{
		name: 'attached',
		effect: { file: 'effect/a.tga', attachedEntity: true, posz: 2 },
		owner: [12, 19, 1],
		move: (o, tick) => {
			o.position[0] = 12 + (tick - 980) * 0.004;
			o.position[2] = 1 + ((tick / 100) % 3);
		},
		duration: 900
	},
	{
		name: 'list',
		effect: { fileList: ['effect/f0.tga', 'effect/f1.tga', 'effect/f2.tga'], frameDelay: 40, size: 90 },
		duration: 800
	},
	{ name: 'sizeDelta', effect: { file: 'effect/c.tga', size: 50, sizeDelta: 5 }, duplicateID: 3, duration: 500 },
	{ name: 'noTexture', effect: { size: 40 }, duration: 300 },
	{ name: 'missing', effect: { file: 'effect/zz.tga' }, duration: 300 },
	{ name: 'open', effect: { file: 'effect/a.tga', size: 40 }, duration: 0 },
	{ name: 'late', effect: { file: 'effect/c.tga', fadeOut: true }, start: 1300, duration: 300 },
	// Sprite-backed (SpriteRenderer state they leave behind would leak into a later plain one: #47).
	{ name: 'shadow', effect: { shadowTexture: true, posxEnd: 3, size: 3 }, owner: [9, 19, 0], duration: 600 },
	{
		name: 'sprAbs',
		effect: {
			absoluteSpriteName: 'data/sprite/fx/abs',
			playSprite: true,
			angle: 15,
			size: 2,
			sizeEnd: 3,
			fadeIn: true,
			red: 0.8
		},
		owner: [11.6, 21.3, 0],
		duration: 800
	},
	{
		name: 'sprName',
		effect: {
			spriteName: 'fx2',
			sprDelay: 50,
			rotateToTarget: true,
			posxEnd: 2,
			posyEnd: 2,
			size: 2,
			blendMode: 2
		},
		owner: [8.5, 19.5, 0.5],
		duration: 700
	},
	{
		name: 'sprOverlay',
		effect: { spriteName: 'fx2', overlay: true, size: 1.5, posx: -2 },
		owner: [10.5, 18, 0],
		duration: 900
	}
];

/** 2D spawns (spriteEffectScene.js SPAWNS_2D). */
export const SPAWNS_2D = [
	{ name: 'plain', effect: { file: 'effect/a.tga', size: 100, angle: 30, posx: -2 }, duration: 600 },
	{
		name: 'fade',
		effect: {
			file: 'effect/a.tga',
			size: 80,
			fadeIn: true,
			fadeOut: true,
			alphaMax: 0.7,
			blendMode: 6,
			red: 0.3,
			green: 0.6,
			blue: 0.2,
			zIndex: 2
		},
		duration: 700
	},
	{
		name: 'overlay',
		effect: { file: 'effect/b.tga', size: 60, overlay: true, alphaMax: 2, blendMode: 2 },
		duration: 600
	},
	...BLEND_CODES.map((blendMode, i) => ({
		name: `blend${blendMode}`,
		effect: { file: 'effect/c.tga', blendMode, size: 40, posx: (i % 5) - 1.5, posy: Math.floor(i / 5) - 1 },
		start: 1010 + i * 30,
		duration: 400
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
		effect: {
			file: 'effect/c.tga',
			posx: 1,
			posy: 2,
			posz: 0.5,
			offsetx: 5,
			offsety: -4,
			size: 70,
			sizeStartY: 30,
			sizeEndX: 90,
			sizeEndY: 10
		},
		duration: 600
	},
	{
		name: 'rand',
		effect: {
			file: 'effect/a.tga',
			posxRand: 3,
			posyRandDiff: 2,
			poszRand: 1,
			offsetxRand: 4,
			offsetyRandDiff: 6,
			size: 50,
			sizeRand: 20,
			angleRand: [10, 80],
			sizeRandStartX: [20, 30],
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
	{
		name: 'rotTarget',
		effect: { file: 'effect/a.tga', rotateToTarget: true, posxEnd: 2, posyEnd: 2, size: 60, angle: 5 },
		duration: 500
	},
	{
		name: 'attached',
		effect: {
			file: 'effect/a.tga',
			attachedEntity: true,
			shadowTexture: true,
			size: 50,
			posxEnd: 1,
			offsetyStart: 3
		},
		owner: [8, 21, 0.5],
		move: (o, tick) => {
			o.position[1] = 21 - (tick - 980) * 0.004;
		},
		duration: 600
	},
	{ name: 'ownerNoShadow', effect: { file: 'effect/b.tga', size: 40 }, owner: [11, 18, 0], duration: 300 },
	{ name: 'missing', effect: { file: 'effect/zz.tga', size: 40 }, duration: 300 },
	{ name: 'open', effect: { file: 'effect/a.tga', size: 40 }, duration: 0 },
	{ name: 'late', effect: { file: 'effect/c.tga', size: 40, fadeIn: true }, start: 1350, duration: 300 }
];

/**
 * Spawn instances the way EffectManager.spamEffect does: positions are copied unless
 * attachedEntity (then the owner's live array is shared), endTick = start + duration
 * or -1 when open-ended.
 */
export function spawnSprite(Ctor, spawns) {
	return spawns.map(spawn => {
		const ownerEntity = spawn.owner ? makeEffectOwner(spawn.name, spawn.owner.slice()) : undefined;
		const base = ownerEntity ? ownerEntity.position : [10, 20, 1];
		const position = spawn.effect.attachedEntity ? base : base.slice();
		const startTick = spawn.start ?? 1000;
		const inst = {
			position,
			otherPosition: spawn.other ?? [position[0] - 3, position[1] + 3, position[2]],
			startTick,
			endTick: spawn.duration > 0 ? startTick + spawn.duration : -1,
			duplicateID: spawn.duplicateID ?? 0
		};
		const effect = new Ctor({ ...spawn.effect }, inst, { ownerAID: 77, ownerEntity });
		const move = spawn.move && ownerEntity ? tick => spawn.move(ownerEntity, tick) : null;
		return { name: spawn.name, effect, move };
	});
}
