/**
 * Mesh-family effect parity scene (smoke/effects2.js): the legacy Cylinder, QuadHorn,
 * RsmEffect, GroundAura, SwirlingAura, Level99Bubble, SpiritSphere, WarlockSphere,
 * Tiles (FlatTexture, HoveringTexture), LPEffect, SpiderWeb, FlatColorTile,
 * PropertyGround, MagicRing, LockOnTarget, MagicTarget, RainWeather (puddles) and
 * WaterfallEffect classes, spawned the way EffectManager / EffectTable FUNC entries
 * spawn them. Browser-safe port of the root suite's tests/renderer/support scenes
 * (cylinderQuadHornScene, auraScene, sphereScene, groundTileScene, groundRingScene,
 * targetMarkerScene, rsmEffectScene, waterfallScene, rainScene): the same branches,
 * flags and blend codes, positions moved around one camera target, textures named after
 * smoke/effects2/assets.js images. The RSM models are the root suite's synthetic ones
 * (FakeModel, imported: that module is browser-safe).
 *
 * Kept out (declared, see smoke/README.md):
 * - spawns whose texture never loads ('missing' names): legacy never draws them;
 * - invalid blend codes (#49: in-range non-integers): legacy keeps the previous draw's
 *   blend, the rebuild draws normal alpha;
 * - RSM models whose rebuild changes the object count (texture reload mid-run) and
 *   failed textures (#56, fixed in render-records);
 * - the EffectManager list keying of FlatColorTile colours (#59): each class draws its
 *   own list here.
 */

/** Camera (common.js cameraMatrices): looks at the effects. */
export const CAMERA = Object.freeze({ target: [10, 20], distance: 40, pitch: 50, yaw: 25, fovy: 20 });

/** Legacy Camera.angle [pitch, yaw] (cylinder camera modes, spheres, bubbles) and position (puddles). */
export const CAMERA_ANGLE = Object.freeze([230, 25]);
export const CAMERA_POSITION = Object.freeze([10, -18, 4]);

/** Scene fog of the fog frame: near/far bracket the effects' depth. */
export const FOG = Object.freeze({ use: true, exist: true, near: 30, far: 56, color: [0.55, 0.6, 0.75] });

export const START_TICK = 0;
export const TICK_MS = 40;
export const CAPTURES = Object.freeze([
	{ name: 'effects2-t480', at: 480, fog: false },
	{ name: 'effects2-t1200', at: 1200, fog: false },
	{ name: 'effects2-t2000-fog', at: 2000, fog: true },
	{ name: 'effects2-t2800', at: 2800, fog: false },
	{ name: 'effects2-t4400', at: 4400, fog: false }
]);

/** Owner entity followed by attached effects (moved in place every tick). */
export function makeOwner() {
	return { position: new Float32Array([9, 19, 0.5]), direction: 3, cast: { display: true } };
}

export function moveOwner(owner, tick) {
	owner.position[0] = 9 + tick / 2500;
	owner.position[1] = 19 - tick / 5000;
	owner.position[2] = 0.5 + tick / 40000;
}

/* ------------------------------------------------------------- cylinder */

const grid = (k, x0, y0, columns, step) => [x0 + (k % columns) * step, y0 + Math.floor(k / columns) * step];

const cyl = (name, effect, inst = {}) => ({
	name,
	effect: { type: 'CYLINDER', textureName: 'ring_blue', topSize: 1.2, bottomSize: 0.8, height: 3, ...effect },
	startTick: 0,
	endTick: 4000,
	...inst
});

/** CYLINDER entries covering legacy Cylinder.js's branches (tests/.../cylinderQuadHornScene.js). */
export const CYLINDER_SPAWNS = [
	cyl('static', { red: 0.2, green: 0.4, blue: 0.6, alphaMax: 0.6, zIndex: 3, posX: 0.5, posY: -0.25, posZ: 1 }),
	cyl('grow-long-fade', { animation: 1, fade: true, blendMode: 2, rotate: true, alphaMax: 0.8 }, { endTick: 5000 }),
	cyl('grow-short', { animation: 1, blendMode: 8, textureName: 'magic_green' }, { endTick: 1600 }),
	cyl('top-long-angles', { animation: 2, angleX: 30, angleY: 45, angleZ: 10, blendMode: 5 }, { endTick: 5000 }),
	cyl(
		'top-short-repeat',
		{
			animation: 2,
			repeatTextureX: 3,
			totalCircleSides: 12,
			circleSides: 6,
			blendMode: 7,
			textureName: 'cyl_repeat'
		},
		{ endTick: 1500 }
	),
	cyl('repeat-wide', { repeatTextureX: 2, textureName: 'cyl_wide', rotate: true, blendMode: 8 }, { endTick: 5000 }),
	cyl('pulse', { animation: 3, fade: true, blendMode: 0 }, { endTick: 2400 }),
	cyl('widen-delayed', { animation: 4, blendMode: 16 }, { startTick: 250, endTick: 3000 }),
	cyl('rise-fall-camera', { animation: 5, rotateWithCamera: true, posX: 0.3, posY: 0.7, blendMode: 15 }),
	cyl(
		'fixed-perspective',
		{
			fixedPerspective: true,
			posX: 0.2,
			posY: 0.4,
			posZ: 1.5,
			angleXRandom: 30,
			angleYRandom: 360,
			angleZRandom: 20,
			blendMode: 11,
			alphaMax: 0.9
		},
		{ endTick: 5000 }
	),
	cyl('fixed-perspective-flat', { fixedPerspective: true, totalCircleSides: 16, circleSides: 8, blendMode: 3 }),
	cyl('to-target', { rotateToTarget: true, blendMode: 4 }, { otherPosition: [14, 17, 0] }),
	cyl(
		'with-source',
		{ rotateWithSource: true, attachedEntity: true, rotate: true, blendMode: 6 },
		{ attached: true, endTick: 5000 }
	),
	cyl('open-ended', { height: 5, blendMode: 9 }, { endTick: -1 }),
	cyl(
		'attached-delayed',
		{ attachedEntity: true, animation: 1, fade: true, blendMode: 10, topSize: 0.6, bottomSize: 0.6 },
		{ attached: true, startTick: 400, endTick: 4100 }
	),
	cyl('zero-blend', { blendMode: 1, red: 1, green: 0.5 }, { endTick: 1300 }),
	cyl('constant-blends-12', { blendMode: 12, angleY: 90 }, { endTick: 3000 }),
	cyl('constant-blends-13', { blendMode: 13, zIndex: -2 }, { endTick: 3000 }),
	cyl('constant-blends-14', { blendMode: 14, posZ: 2 }, { endTick: 3000 })
].map((spawn, k) => ({ ...spawn, position: [...grid(k, 3.5, 13.5, 5, 3.4), 0.3 + (k % 3) * 0.2] }));

/* ------------------------------------------------------------- quadhorn */

const qh = (name, effect, inst = {}) => ({
	name,
	effect: { type: 'QuadHorn', textureFile: 'effect/ice.tga', ...effect },
	startTick: 0,
	endTick: 5000,
	...inst
});

/** QuadHorn entries covering legacy QuadHorn.js's branches. */
export const QUADHORN_SPAWNS = [
	qh('static-default', { height: 2, bottomSize: 0.4 }),
	qh(
		'grow-open-ended',
		{
			animation: 1,
			animationSpeed: 50,
			height: [2.8, 3.3],
			offsetX: [0.25, 0.75],
			offsetY: [0.25, 0.75],
			offsetZ: -0.1,
			bottomSize: [0.3, 0.5],
			blendMode: 8,
			rotateY: [1, 360],
			color: [1, 1, 1, 1]
		},
		{ endTick: -1 }
	),
	qh(
		'move-out',
		{
			textureFile: 'effect/stone.bmp',
			animation: 2,
			animationSpeed: 1000,
			animationOut: true,
			height: [0.6, 0.9],
			offsetX: [0.5, 0.7],
			offsetY: [0.0, -0.2],
			offsetZ: 0.6,
			bottomSize: [0.2, 0.3],
			blendMode: 1,
			rotateY: [1, 360],
			rotateZ: [-15, 15],
			color: [0.9, 0.8, 0.7, 0.6]
		},
		{ endTick: 2400 }
	),
	qh(
		'rise',
		{ animation: 3, animationSpeed: 400, height: 2, offsetZ: 0.3, bottomSize: 0.5, blendMode: 2 },
		{
			endTick: 3500
		}
	),
	qh(
		'emerge-fade',
		{
			animation: 4,
			animationSpeed: 330,
			riseDistance: 2,
			fadeOut: 170,
			height: [1.2, 1.8],
			bottomSize: [0.16, 0.22],
			offsetX: 0,
			offsetY: 0,
			offsetZ: 0,
			blendMode: 8,
			rotateX: [-15, 15],
			rotateY: [0, 360],
			color: [1, 1, 1, 0.8]
		},
		{ endTick: 2900 }
	),
	qh(
		'attached',
		{
			attachedEntity: true,
			animation: 4,
			animationSpeed: 600,
			riseDistance: [0.5, 1],
			height: 1.5,
			bottomSize: 0.3,
			rotateX: 20,
			rotateY: 30,
			rotateZ: 40,
			blendMode: 16
		},
		{ attached: true, endTick: 4600 }
	),
	qh('blend-zero-delayed', { blendMode: 0, height: 1, bottomSize: 0.25 }, { startTick: 150, endTick: 3200 }),
	qh('fade-open-ended', { fadeOut: 300, height: 1, color: [0.5, 0.5, 1, 0.9] }, { endTick: -1 }),
	qh(
		'sink-slow',
		{ animation: 1, animationSpeed: 100, height: 1, offsetZ: 0.5, animationOut: true, fadeOut: 400, blendMode: 5 },
		{ endTick: 1900 }
	)
].map((spawn, k) => ({ ...spawn, position: [...grid(k, 5, 22.5, 3, 2.6), 0.25] }));

/* ------------------------------------------------------------------ auras */

/** GroundAura(position, size, distance, textureName, tick). */
export const GROUND_AURA_SPAWNS = [
	{ name: 'level99-2', args: [100, 15.0, 'pikapika2.bmp', 0], attached: true },
	{ name: 'small', args: [40, 5, 'pikapika2.bmp', 100], position: [14.5, 17.5, 0.2] },
	{ name: 'delayed', args: [100, 15.0, 'pikapika2.bmp', 600], position: [6.5, 25.5, 0.1] }
];

/** SwirlingAura(position, textureName, tick, sizeType). */
export const SWIRLING_AURA_SPAWNS = [
	{ name: 'level99', args: ['ring_blue.tga', 0], attached: true },
	{ name: 'green', args: ['ring_blue.tga', 100, 7], position: [14.5, 17.5, 0.2] },
	{ name: 'delayed', args: ['ring_blue.tga', 600, 4], position: [6.5, 25.5, 0.1] }
];

/** Level99Bubble(position, textureName, tick, flag1). Ghost columns fall fast enough to show in the run. */
export const LEVEL99_BUBBLE_SPAWNS = [
	{ name: 'blue', args: ['whitelight.tga', 10, 1], attached: true },
	{ name: 'white', args: ['whitelight.tga', 10, 0], position: [12.5, 24.5, 0.3] },
	{ name: 'ghost', args: ['whitelight.tga', 10, 11], position: [15.5, 21.5, 0.3] },
	{ name: 'ghost3', args: ['whitelight.tga', 10, 3], position: [8.5, 16.5, 0.2] },
	{ name: 'other-flag', args: ['whitelight.tga', 10, 5], position: [13.5, 15.5, 0.2] }
];

/* ---------------------------------------------------------------- spheres */

/** SpiritSphere(entity, num, isCoin) — owners near the target; alpha presets skip the slow fade-in. */
export const SPIRIT_SPAWNS = [
	{ name: 'one', num: 1, initialAlpha: 0.6 },
	{ name: 'five-coin', num: 5, isCoin: true, initialAlpha: 0.8 },
	{ name: 'eleven', num: 11, initialAlpha: 0.9 },
	{ name: 'fifteen-coin', num: 15, isCoin: true, initialAlpha: 0.3 }
];

/** WarlockSphere(entity, spheres). */
export const WARLOCK_SPAWNS = [
	{ name: 'three', spheres: [68, 69, 70], initialAlpha: 0.7 },
	{ name: 'seven', spheres: [69, 69, 69, 69, 69, 69, 69], initialAlpha: 0.95 },
	{ name: 'twelve', spheres: new Array(12).fill(70), initialAlpha: 0.5 }
];

export function sphereOwner(k, kind) {
	const base = kind === 'spirit' ? [4 + k * 3.2, 18] : [6 + k * 3.5, 24];
	return { position: new Float32Array([base[0], base[1], 0.3 + k / 10]) };
}

export function moveSphereOwner(owner, k, kind, tick) {
	const base = kind === 'spirit' ? [4 + k * 3.2, 18] : [6 + k * 3.5, 24];
	owner.position[0] = base[0] + tick / 3000;
	owner.position[1] = base[1] - tick / 7000;
}

/* ------------------------------------------------------------------ tiles */

/** Position of instance k of a tile group. */
export const tileAt = (group, k) => [3 + group * 1.7, 15 + k * 2.2, 0.15 * k];

/**
 * Tile groups (tests/.../groundTileScene.js): FlatTexture (flat tiles draw nothing,
 * uSize and alpha never set), HoveringTexture, LPEffect, SpiderWeb, FlatColorTile.
 */
export const TILE_GROUPS = [
	{ group: 'flat', make: (T, d) => T.FlatTexture(`${d}effect/plain.bmp`), file: 'effect/plain.bmp', count: 1 },
	{
		group: 'flat-big',
		make: (T, d) => T.FlatTexture(`${d}effect/big.bmp`, 128),
		file: 'effect/big.bmp',
		count: 1
	},
	{
		group: 'lens',
		make: (T, d) => T.HoveringTexture(`${d}effect/lens_w.bmp`, 0.5, 0.7),
		file: 'effect/lens_w.bmp',
		count: 2
	},
	{ group: 'zz', make: (T, d) => T.HoveringTexture(`${d}effect/zz.bmp`), file: 'effect/zz.bmp', count: 2 },
	{ group: 'lp', make: (T, d, c) => c.LPEffect, file: 'effect/aaa copy.bmp', count: 3 },
	{ group: 'spider', make: (T, d, c) => c.SpiderWeb, file: 'effect/spiderweb.tga', count: 2 },
	{
		group: 'salmon',
		make: (T, d, c) => c.FlatColorTile('salmon', { r: 1, g: 0x8a / 255, b: 0xbb / 255, a: 0.6 }),
		count: 2
	},
	{ group: 'lullaby', make: (T, d, c) => c.FlatColorTile('lullaby', { r: 0.2, g: 0.4, b: 0.6 }), count: 2 }
];

/* ------------------------------------------------------------------ rings */

const PROPERTY_TEXTURES = ['ring_red', 'ring_blue', 'ring_yellow'];

/** PropertyGround(position, topSize, bottomSize, height, textureName, tick). */
export const PROPERTY_SPAWNS = Array.from({ length: 7 }, (_v, k) => ({
	name: `pg-${k}`,
	position: [12 + (k % 4) * 1.8, 22 + Math.floor(k / 4) * 2.4, 0.1 * (k % 4)],
	topSize: k % 5 === 0 ? 2.5 : 1.6,
	bottomSize: k % 3 === 0 ? 0.5 : 1.0,
	height: k % 2 ? 2 : 1.5,
	texture: PROPERTY_TEXTURES[k % 3],
	startTick: 50 * k
}));

/** MagicRing(target, topSize, bottomSize, height, textureName, endTick) on casters. */
export const MAGIC_RING_SPAWNS = [
	{ name: 'ring-long', caster: 0, texture: 'ring_jadu', endTick: 10000 },
	{ name: 'ring-cast-hidden', caster: 1, texture: 'ring_jadu', endTick: 10000, hideAt: 2300 },
	{ name: 'ring-short', caster: 2, texture: 'ring_blue', endTick: 1500, topSize: 1.5, bottomSize: 0.4, height: 1 }
];

export function makeCaster(k) {
	return { position: new Float32Array([15 + k * 1.5, 14 + k, 0.2 * k]), cast: { display: true } };
}

export function updateCasters(casters, tick) {
	casters.forEach((c, k) => {
		c.position[0] = 15 + k * 1.5 + tick / 4000;
		c.position[1] = 14 + k - tick / 9000;
	});
	for (const spawn of MAGIC_RING_SPAWNS) {
		if (spawn.hideAt !== undefined && tick >= spawn.hideAt) {
			casters[spawn.caster].cast.display = false;
		}
	}
}

/* ---------------------------------------------------------------- markers */

/** LockOnTarget(target, startTick, endTick). */
export const LOCK_ON_SPAWNS = [
	{ name: 'lock-a', target: 0, startTick: 0, endTick: 3000 },
	{ name: 'lock-late', target: 1, startTick: 900, endTick: 5000 },
	{ name: 'lock-open', target: 2, startTick: 100, endTick: -1 }
];

export function makeMarkerTarget(k) {
	return { position: new Float32Array([11 + k * 2.5, 16 + k * 0.7, 0.2 + k * 0.3]) };
}

export function moveMarkerTargets(targets, tick) {
	targets.forEach((t, k) => {
		t.position[0] = 11 + k * 2.5 - tick / 5000;
		t.position[1] = 16 + k * 0.7 + tick / 8000;
	});
}

/** Skill ids (DB/Skills/SkillConst.js) with CastSize rows: AC_SHOWER 47, WZ_STORMGUST 89, SA_LANDPROTECTOR 288. */
export const MAGIC_TARGET_SPAWNS = [
	{ name: 'unknown-skill', skillId: 99999, x: 10.6, y: 20.2, endTick: 5000, self: true },
	{ name: 'storm-other', skillId: 89, x: 7, y: 23, endTick: 5000, self: false },
	{
		name: 'shower-self-lv7',
		skillId: 47,
		x: 13.5,
		y: 18.5,
		endTick: 2500,
		self: true,
		session: { lastSKID: 47, lastSkLvl: 7 }
	},
	{
		name: 'lp-self-lv3',
		skillId: 288,
		x: 5,
		y: 17,
		endTick: -1,
		self: true,
		session: { lastSKID: 288, lastSkLvl: 3 }
	}
];

/* -------------------------------------------------------------------- RSM */

/** RsmEffect params (the root suite's synthetic models, see rsmEffectScene.js MODELS). */
export const RSM_SPAWNS = [
	{ name: 'static', file: 'effect\\static', size: 9, position: [7.5, 20.5, 0.4], startTick: 0 },
	{ name: 'spin', file: 'effect\\spin', size: 8, position: [12.5, 19, 0.2], startTick: 30 },
	{ name: 'spin-attached', file: 'effect\\spin', size: 5, attached: true, startTick: 0 },
	{ name: 'stale-textures', file: 'effect\\stale', size: 7, position: [10, 24, 0.3], startTick: 260 },
	{ name: 'frozen', file: 'effect\\frozen', size: 10, position: [14, 21, 0.1], startTick: 0 }
];

/* -------------------------------------------------------------- waterfall */

/** WaterfallEffect(effect, instance): variants (small/dark) and vertical. */
export const WATERFALL_SPAWNS = [
	{ name: 'default', effect: { variant: '' }, position: [6, 21, 1.5], startTick: 0 },
	{
		name: 'small-dark-vertical',
		effect: { variant: 'small dark', vertical: true },
		position: [15, 25, 1],
		startTick: 200
	}
];

/* ---------------------------------------------------------------- puddles */

/** Puddles injected into the RainWeather instance (drops would seed them at random). */
export const PUDDLES = [
	{ x: 8.2, y: 18.4, size: 160, alpha: 0.4, angle: 0.4, nextDryTick: 1e9 },
	{ x: 11.6, y: 21.3, size: 110, alpha: 0.3, angle: 2.1, nextDryTick: 1e9 },
	{ x: 13.1, y: 16.2, size: 220, alpha: 0.45, angle: 4.0, nextDryTick: 1e9 },
	{ x: 5.4, y: 23.8, size: 80, alpha: 0.25, angle: 1.0, nextDryTick: 1500 },
	{ x: 9.9, y: 25.1, size: 60, alpha: 0.2, angle: 5.5, nextDryTick: 600 }
];
