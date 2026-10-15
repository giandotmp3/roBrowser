/**
 * Scripted level-99 aura stack (EntityAura R-EFX-015: EF_LEVEL99 SwirlingAura,
 * EF_LEVEL99_2 GroundAura, EF_LEVEL99_3 Level99Bubble) plus off-table variants, a tick
 * list, a moving owner, terrain and camera. Shared by the GL snapshot tests
 * (GroundAura/SwirlingAura/Level99Bubble.records.test.js) and the record diff.
 *
 * Spawns mirror EffectTable 200/201/202 (FUNC entries): the constructor gets the owner
 * entity's live position (attachedEntity) and Params.Inst.startTick. Static spawns get
 * their own array. A texture whose name contains 'missing' never loads, so the instance
 * is never ready (never drawn).
 */

export const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
export const PROJECTION = new Float32Array([2, 0, 0, 0, 0, 2, 0, 0, 0, 0, -1, -1, 0, 0, -0.2, 0]);

/**
 * Ticks: one frame before the common start (negative elapsed), 25 ms / sub-tick / skipped
 * frames, a frame past the 250 ms dt cap, then 250 ms frames for ~30 s (long enough for
 * Level99Bubble anchors to fall through the visible band and respawn).
 */
export const TICKS = (() => {
	const ticks = [900, 1000, 1010, 1025, 1050, 1075, 1100, 1110, 1130, 1160, 1500];
	for (let t = 1750; t <= 31000; t += 250) {
		ticks.push(t);
	}
	ticks.push(31010, 31013, 31100);
	return ticks;
})();

/** Scene fog of frame i (exists on two frames out of three). */
export function fogAt(i) {
	return { use: true, exist: i % 3 !== 0, near: 10 + i, far: 100, color: new Float32Array([0.5, 0.6, 0.7]) };
}

/** Camera angles [pitch, yaw] of a tick (Level99Bubble billboards read them). */
export function cameraAngleAt(tick) {
	return [200 + (tick % 70), (tick / 7) % 360];
}

/** Terrain height (Altitude.getCellHeight mock, non-uniform). */
export function cellHeight(x, y) {
	return 0.1 * x - 0.05 * y + 0.25;
}

/** Owner entity followed by attached auras. */
export function makeOwner() {
	return { position: new Float32Array([20, 30, 1.5]) };
}

/** Move the owner in place (Entity.position is a vec3 mutated by walking). */
export function moveOwner(owner, tick) {
	owner.position[0] = 20 + tick / 2500;
	owner.position[1] = 30 - tick / 5000;
	owner.position[2] = 1.5 + tick / 40000;
}

const spawn = (name, args, { attached = true, position = [12.25, 18.5, 0.25] } = {}) => ({
	name,
	args,
	attached,
	position
});

/** GroundAura(position, size, distance, textureName, tick). */
export const GROUND_AURA_SPAWNS = [
	spawn('level99-2', [100, 15.0, 'pikapika2.bmp', 1000]),
	spawn('small-zero-start', [40, 5, 'pikapika2.bmp', 0], { attached: false }),
	spawn('delayed', [100, 15.0, 'pikapika2.bmp', 1600]),
	spawn('missing-texture', [100, 15.0, 'missing.bmp', 1000])
];

/** SwirlingAura(position, textureName, tick, sizeType). */
export const SWIRLING_AURA_SPAWNS = [
	spawn('level99', ['ring_blue.tga', 1000]),
	spawn('green', ['ring_blue.tga', 1000, 7], { attached: false }),
	spawn('delayed', ['ring_blue.tga', 1600, 4]),
	spawn('missing-texture', ['missing.tga', 1000])
];

/** Level99Bubble(position, textureName, tick, flag1). */
export const LEVEL99_BUBBLE_SPAWNS = [
	spawn('blue', ['whitelight.tga', 1000, 1]),
	spawn('default-flag', [undefined, 1000, undefined]),
	spawn('white', ['whitelight.tga', 1000, 0], { attached: false }),
	spawn('ghost', ['whitelight.tga', 1000, 11]),
	spawn('ghost3', ['whitelight.tga', 1000, 3], { attached: false }),
	spawn('other-flag', ['whitelight.tga', 1000, 5]),
	spawn('zero-start', ['whitelight.tga', 0, 1]),
	spawn('delayed', ['whitelight.tga', 1600, 1]),
	spawn('missing-texture', ['missing.tga', 1000, 1])
];

/**
 * Build legacy instances the way the EffectTable FUNC entries do (needInit set by
 * EffectManager.add).
 *
 * @param {Function} Ctor legacy GroundAura / SwirlingAura / Level99Bubble
 * @param {Array} spawns
 * @param {object} owner entity followed by attached spawns
 */
export function spawnLegacy(Ctor, spawns, owner) {
	return spawns.map(s => {
		const position = s.attached ? owner.position : s.position.slice();
		const effect = new Ctor(position, ...s.args);
		effect.needInit = true;
		return { name: s.name, spawn: s, effect };
	});
}

/**
 * One EffectManager.render pass over a constructor's live instances.
 *
 * @param {object} gl
 * @param {Function} Ctor
 * @param {Array} live spawned instances
 * @param {number} tick
 * @param {object} fog
 * @param {function} [onRender] called after each instance's turn
 */
export function renderLegacyFrame(gl, Ctor, live, tick, fog, onRender) {
	Ctor.beforeRender(gl, IDENTITY, PROJECTION, fog, tick);
	for (const entry of live) {
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
	}
	Ctor.afterRender(gl);
}
