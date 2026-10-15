/**
 * Synthetic EffectTable entries for the legacy Cylinder ('CYLINDER') and QuadHorn
 * effects, a scripted tick list, and an EffectManager-like driver. Shared by the GL
 * snapshot tests (Cylinder/QuadHorn.records.test.js) and the record diffs.
 *
 * Every spawn carries its EffectTable entry (`effect`) plus the EffectManager instance
 * parameters (start/end tick, position, other position). `attached` spawns follow the
 * owner entity: their position is the owner's Float32Array, moved in place every tick
 * (EffectManager.spamEffect keeps the reference when attachedEntity is set).
 *
 * Textures load synchronously in the tests' Client/WebGL mocks; a texture whose name
 * contains 'missing' never loads, so its effect is never ready (never drawn).
 */

export const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
export const PROJECTION = new Float32Array([2, 0, 0, 0, 0, 2, 0, 0, 0, 0, -1, -1, 0, 0, -0.2, 0]);

export const TICKS = [
	0, 50, 150, 250, 400, 500, 650, 800, 1000, 1200, 1250, 1300, 1500, 1900, 2100, 2600, 3200, 4100, 5200
];

/** Scene fog of frame i (exists on two frames out of three). */
export function fogAt(i) {
	return { use: true, exist: i % 3 !== 0, near: 10 + i, far: 100, color: new Float32Array([0.5, 0.6, 0.7]) };
}

/** Camera angles [pitch, yaw] of a tick (rotateWithCamera / fixedPerspective read them). */
export function cameraAngleAt(tick) {
	return [200 + (tick % 70), (tick / 7) % 360];
}

/** Owner entity followed by attached effects. */
export function makeOwner() {
	return { position: new Float32Array([20, 30, 1.5]), direction: 3 };
}

/** Move the owner in place (Entity.position is a vec3 mutated by walking). */
export function moveOwner(owner, tick) {
	owner.position[0] = 20 + tick / 250;
	owner.position[1] = 30 - tick / 500;
	owner.position[2] = 1.5 + tick / 4000;
}

const cyl = (name, effect, inst = {}) => ({
	name,
	effect: { type: 'CYLINDER', textureName: 'ring_blue', topSize: 1.2, bottomSize: 0.8, height: 3, ...effect },
	position: [10, 20, 0.5],
	startTick: 0,
	endTick: 1000,
	...inst
});

/** CYLINDER entries covering every branch of legacy Cylinder.js. */
export const CYLINDER_SPAWNS = [
	cyl('static', { red: 0.2, green: 0.4, blue: 0.6, alphaMax: 0.6, zIndex: 3, posX: 0.5, posY: -0.25, posZ: 1 }),
	cyl('grow-long-fade', { animation: 1, fade: true, blendMode: 2, rotate: true, alphaMax: 0.8 }, { endTick: 2000 }),
	cyl('grow-short', { animation: 1, blendMode: 8, textureName: 'magic_green' }, { endTick: 600 }),
	cyl('top-long-angles', { animation: 2, angleX: 30, angleY: 45, angleZ: 10, blendMode: 5 }, { endTick: 2000 }),
	cyl(
		'top-short-repeat',
		{ animation: 2, repeatTextureX: 3, totalCircleSides: 12, circleSides: 6, blendMode: 7 },
		{ endTick: 500 }
	),
	cyl('pulse', { animation: 3, fade: true, blendMode: 0 }, { endTick: 800 }),
	cyl('widen-delayed', { animation: 4, blendMode: 16 }, { startTick: 250, endTick: 650 }),
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
			alphaMax: 0
		},
		{ endTick: 2100 }
	),
	cyl('fixed-perspective-flat', { fixedPerspective: true, totalCircleSides: 16, circleSides: 8, blendMode: 3 }),
	cyl('to-target', { rotateToTarget: true, blendMode: 4 }, { otherPosition: [14, 17, 0] }),
	cyl(
		'with-source',
		{ rotateWithSource: true, attachedEntity: true, rotate: true, blendMode: 6 },
		{ attached: true, endTick: 3200 }
	),
	cyl('open-ended', { height: 5, blendMode: 9 }, { endTick: -1 }),
	cyl(
		'attached-delayed',
		{ attachedEntity: true, animation: 1, fade: true, blendMode: 10 },
		{ attached: true, startTick: 400, endTick: 4100 }
	),
	cyl('zero-blend', { blendMode: 1, red: 1, green: 0.5 }, { endTick: 250 }),
	cyl('constant-blends-12', { blendMode: 12, angleY: 90 }, { endTick: 150 }),
	cyl('constant-blends-13', { blendMode: 13, zIndex: -2 }, { endTick: 150 }),
	cyl('constant-blends-14', { blendMode: 14, posZ: 2 }, { endTick: 150 }),
	cyl('missing-texture', { textureName: 'missing' })
];

/**
 * In-range non-integer blend codes (discrepancy #49): legacy's GL factor is undefined;
 * render-records draws normal alpha. Kept out of the main spawn lists (declared divergence).
 */
export const INVALID_BLEND_CYLINDER = [cyl('blend-2.5', { blendMode: 2.5 }, { endTick: 300 })];

const qh = (name, effect, inst = {}) => ({
	name,
	effect: { type: 'QuadHorn', textureFile: 'effect/ice.tga', ...effect },
	position: [12, 18, 0.25],
	startTick: 0,
	endTick: 1000,
	...inst
});

/** QuadHorn entries covering every branch of legacy QuadHorn.js. */
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
	qh('grow-zero', { animation: 1, height: 0, bottomSize: 0.2 }),
	qh(
		'move-out',
		{
			textureFile: 'effect/stone.bmp',
			animation: 2,
			animationSpeed: 1000,
			animationOut: true,
			height: [0.2, 0.4],
			offsetX: [0.5, 0.7],
			offsetY: [0.0, -0.2],
			offsetZ: 0.6,
			bottomSize: [0.1, 0.2],
			blendMode: 1,
			rotateY: [1, 360],
			rotateZ: [-15, 15],
			color: [0.9, 0.8, 0.7, 0.6]
		}
	),
	qh('rise', { animation: 3, animationSpeed: 400, height: 2, offsetZ: 0.3, bottomSize: 0.5, blendMode: 2 }, {
		endTick: 1500
	}),
	qh(
		'emerge-fade',
		{
			animation: 4,
			animationSpeed: 330,
			riseDistance: 2,
			fadeOut: 170,
			height: [0.2, 1.8],
			bottomSize: [0.06, 0.22],
			offsetX: 0,
			offsetY: 0,
			offsetZ: 0,
			blendMode: 8,
			rotateX: [-15, 15],
			rotateY: [0, 360],
			color: [1, 1, 1, 0.8]
		},
		{ endTick: 670 }
	),
	qh('out-before-done', { animation: 2, animationSpeed: 5000, animationOut: true, offsetZ: 1, height: 1 }, {
		endTick: 400
	}),
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
		{ attached: true, endTick: 2600 }
	),
	qh('blend-zero-delayed', { blendMode: 0, height: 1, bottomSize: 0.25 }, { startTick: 150, endTick: 1200 }),
	qh('fade-open-ended', { fadeOut: 300, height: 1, color: [0.5, 0.5, 1, 0.9] }, { endTick: -1 }),
	qh(
		'sink-slow',
		{ animation: 1, animationSpeed: 100, height: 1, offsetZ: 0.5, animationOut: true, fadeOut: 400, blendMode: 5 },
		{ endTick: 1200 }
	),
	qh('missing-texture', { textureFile: 'effect/missing.tga', height: 1 })
];

export const INVALID_BLEND_QUADHORN = [qh('blend-8.5', { blendMode: 8.5, height: 1 }, { endTick: 300 })];

/**
 * Build legacy instances the way EffectManager.spamEffect / add do (positions copied
 * unless attached; other position defaults to position + (−5, +5); needInit set).
 *
 * @param {Function} Ctor legacy Cylinder or QuadHorn
 * @param {Array} spawns
 * @param {object} owner entity followed by attached spawns
 */
export function spawnLegacy(Ctor, spawns, owner) {
	return spawns.map(spawn => {
		const base = spawn.attached ? owner.position : spawn.position;
		const position = spawn.attached ? owner.position : [base[0], base[1], base[2]];
		const otherPosition = spawn.otherPosition ?? [base[0] - 5, base[1] + 5, base[2]];
		const inst = {
			position,
			otherPosition,
			direction: spawn.attached ? owner.direction : 0,
			startTick: spawn.startTick,
			endTick: spawn.endTick
		};
		const effect = new Ctor(spawn.effect, inst, {});
		effect.needInit = true;
		return { name: spawn.name, spawn, inst, effect };
	});
}

/**
 * One EffectManager.render pass over a constructor's live instances.
 *
 * @param {object} gl
 * @param {Function} Ctor
 * @param {Array} live spawned instances (finished ones are removed in place)
 * @param {number} tick
 * @param {object} fog
 * @param {function} [onRender] called after each instance's turn
 */
export function renderLegacyFrame(gl, Ctor, live, tick, fog, onRender) {
	Ctor.beforeRender(gl, IDENTITY, PROJECTION, fog, tick);
	for (let j = 0; j < live.length; j++) {
		const entry = live[j];
		const { effect } = entry;
		if (!effect.ready && effect.needInit) {
			effect.init(gl);
			effect.needInit = false;
		}
		const drawn = Boolean(effect.ready);
		if (drawn) {
			effect.render(gl, tick);
		}
		onRender?.(entry, tick, drawn);
		if (effect.needCleanUp) {
			effect.free(gl);
			live.splice(j, 1);
			j--;
		}
	}
	Ctor.afterRender(gl);
}
