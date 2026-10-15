/**
 * Synthetic SpiritSphere / WarlockSphere spawns, scripted ticks and camera, shared by the
 * GL snapshot test (Spheres.records.test.js) and the record diff (RecordDiff.spheres).
 *
 * Spheres follow their owner entity (the constructor keeps `entity.position`, moved in
 * place every tick). Sphere counts cover every size branch (i > 10, i > 5, else core +
 * glow) and the coin palette; `initialAlpha` presets reach the fade-in clamp at 1.
 */

export const SPHERE_TICKS = [0, 16, 33, 50, 100, 250, 400, 640, 1000, 1500, 2300, 4096, 7000];

/** Camera of a tick (angle [pitch, yaw] read by beforeRender, zoom by render). */
export function sphereCameraAt(tick) {
	return { angle: [200 + (tick % 70), (tick / 7) % 360], zoom: 1 + (tick % 5) / 4 };
}

export const SPIRIT_SPAWNS = [
	{ name: 'none', num: 0 },
	{ name: 'one', num: 1 },
	{ name: 'five-coin', num: 5, isCoin: true },
	{ name: 'six', num: 6 },
	{ name: 'ten-coin', num: 10, isCoin: true },
	{ name: 'eleven', num: 11 },
	{ name: 'fifteen-coin', num: 15, isCoin: true },
	{ name: 'three-near-full', num: 3, initialAlpha: 0.997 }
];

export const WARLOCK_SPAWNS = [
	{ name: 'no-list', spheres: undefined },
	{ name: 'one', spheres: [68] },
	{ name: 'three', spheres: [68, 69, 70] },
	{ name: 'five', spheres: [68, 69, 70, 71, 68] },
	{ name: 'seven', spheres: [69, 69, 69, 69, 69, 69, 69] },
	{ name: 'twelve-near-full', spheres: new Array(12).fill(70), initialAlpha: 0.998 }
];

/** Owner entity of spawn k. */
export function makeSphereOwner(k) {
	return { position: new Float32Array([10 + k, 20 - k, 0.5 + k / 10]) };
}

/** Move an owner in place. */
export function moveSphereOwner(owner, k, tick) {
	owner.position[0] = 10 + k + tick / 300;
	owner.position[1] = 20 - k - tick / 700;
	owner.position[2] = 0.5 + k / 10 + tick / 5000;
}

/**
 * Legacy instances the way EffectTable does (`new SpiritSphere(ownerEntity, num, isCoin)`,
 * `new WarlockSphere(entity, spheres)`), init gates set like EffectManager.add.
 *
 * @param {Function} Ctor
 * @param {'spirit'|'warlock'} kind
 * @param {Array} spawns
 * @param {Array} owners one per spawn
 */
export function spawnSpheres(Ctor, kind, spawns, owners) {
	Ctor.needInit = true;
	return spawns.map((spawn, k) => {
		const effect =
			kind === 'spirit' ? new Ctor(owners[k], spawn.num, spawn.isCoin) : new Ctor(owners[k], spawn.spheres);
		if (spawn.initialAlpha !== undefined) {
			effect.initialAlpha = spawn.initialAlpha;
		}
		effect.needInit = true;
		return { name: spawn.name, spawn, k, effect };
	});
}
