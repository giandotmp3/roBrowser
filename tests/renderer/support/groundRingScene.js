/**
 * Synthetic PropertyGround / MagicRing spawns, shared by the GL snapshot test
 * (GroundRings.records.test.js) and the record diff (RecordDiff.groundRings.test.js).
 *
 * PropertyGround: EffectTable spawns `new PropertyGround(position, 3, 1, 2, 'ring_red',
 * startTick)`; 18 instances wrap the module-level 16-slot rotation counter. Its size
 * phase consumes Math.random (seeded by the tests).
 * MagicRing: `new MagicRing(entity, 2.45, 0.8, 2.8, 'ring_jadu', endTick)` follows its
 * caster and ends at endTick or as soon as the caster's cast bar is hidden.
 * A texture whose name contains 'missing' never loads (never drawn).
 */

export const RING_TICKS = [0, 30, 200, 480, 900, 1300, 2100, 3000, 4200, 5600, 7700, 10001, 12500];

const PROPERTY_TEXTURES = ['ring_red', 'ring_blue', 'ring_yellow'];

/** 18 PropertyGround spawns (two never load their texture). */
export const PROPERTY_SPAWNS = Array.from({ length: 18 }, (_v, k) => ({
	name: `pg-${k}`,
	position: [5 + k, 9 - k / 2, 0.1 * (k % 4)],
	topSize: k % 5 === 0 ? 2.5 : 3.0,
	bottomSize: k % 3 === 0 ? 0.5 : 1.0,
	height: k % 2 ? 2 : 1.5,
	texture: k === 7 || k === 15 ? 'missing_ring' : PROPERTY_TEXTURES[k % 3],
	startTick: 50 * k
}));

/** MagicRing spawns: caster index, texture, end tick, tick at which the cast bar hides. */
export const MAGIC_RING_SPAWNS = [
	{ name: 'ring-long', caster: 0, texture: 'ring_jadu', endTick: 10000 },
	{ name: 'ring-cast-hidden', caster: 1, texture: 'ring_jadu', endTick: 10000, hideAt: 2100 },
	{ name: 'ring-short', caster: 2, texture: 'ring_blue', endTick: 900, topSize: 1.5, bottomSize: 0.4, height: 1 },
	{ name: 'ring-missing', caster: 0, texture: 'missing_ring', endTick: 10000 }
];

/** Caster entity k (position mutated in place; cast.display toggled). */
export function makeCaster(k) {
	return { position: new Float32Array([40 + k, 50 - k, 0.3 * k]), cast: { display: true } };
}

/** Move caster k and hide the cast bars due at this tick. */
export function updateCasters(casters, tick) {
	casters.forEach((c, k) => {
		c.position[0] = 40 + k + tick / 400;
		c.position[1] = 50 - k - tick / 900;
	});
	for (const spawn of MAGIC_RING_SPAWNS) {
		if (spawn.hideAt !== undefined && tick >= spawn.hideAt) {
			casters[spawn.caster].cast.display = false;
		}
	}
}

/**
 * @param {Function} PropertyGround legacy constructor
 * @returns {Array<{name: string, spawn: object, effect: object}>}
 */
export function spawnPropertyGrounds(PropertyGround) {
	PropertyGround.needInit = true;
	return PROPERTY_SPAWNS.map(spawn => {
		const effect = new PropertyGround(
			[...spawn.position],
			spawn.topSize,
			spawn.bottomSize,
			spawn.height,
			spawn.texture,
			spawn.startTick
		);
		effect.needInit = true;
		return { name: spawn.name, spawn, effect };
	});
}

/**
 * @param {Function} MagicRing legacy constructor
 * @param {Array} casters
 * @returns {Array<{name: string, spawn: object, effect: object}>}
 */
export function spawnMagicRings(MagicRing, casters) {
	MagicRing.needInit = true;
	return MAGIC_RING_SPAWNS.map(spawn => {
		const effect = new MagicRing(
			casters[spawn.caster],
			spawn.topSize ?? 2.45,
			spawn.bottomSize ?? 0.8,
			spawn.height ?? 2.8,
			spawn.texture,
			spawn.endTick
		);
		effect.needInit = true;
		return { name: spawn.name, spawn, effect };
	});
}
