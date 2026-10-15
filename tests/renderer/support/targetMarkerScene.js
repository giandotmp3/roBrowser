/**
 * Synthetic LockOnTarget / MagicTarget spawns, shared by the GL snapshot test
 * (TargetMarkers.records.test.js) and the record diff (RecordDiff.targetMarkers.test.js).
 *
 * LockOnTarget: `new LockOnTarget(ownerEntity, startTick, endTick)` follows its target.
 * MagicTarget: `new MagicTarget(skillId, x, y, endTick, srcEntity)` picks its area size
 * from the legacy CastSize table, using the session player's last skill level when the
 * player cast that skill. `session` is applied to the player before each construction.
 */

export const MARKER_TICKS = [0, 15, 45, 100, 260, 333, 700, 1000, 1999, 2001, 2600, 4000, 5001];

export const LOCK_ON_SPAWNS = [
	{ name: 'lock-a', target: 0, startTick: 0, endTick: 2000 },
	{ name: 'lock-late', target: 1, startTick: 300, endTick: 5000 },
	{ name: 'lock-open', target: 0, startTick: 100, endTick: -1 }
];

/** Skill ids (DB/Skills/SkillConst.js) and their legacy CastSize rows. */
export const SKILL = { AC_SHOWER: 47, WZ_STORMGUST: 89, SA_LANDPROTECTOR: 288, UNKNOWN: 99999 };
export const CAST_SIZES = {
	[SKILL.AC_SHOWER]: [3, 3, 3, 3, 3, 5, 5, 5, 5, 5],
	[SKILL.WZ_STORMGUST]: [11],
	[SKILL.SA_LANDPROTECTOR]: [7, 7, 9, 9, 11]
};

export const MAGIC_TARGET_SPAWNS = [
	{ name: 'unknown-skill', skillId: SKILL.UNKNOWN, x: 10.6, y: 20.2, endTick: 2600, self: true },
	{ name: 'storm-other', skillId: SKILL.WZ_STORMGUST, x: 12, y: 18, endTick: 5000, self: false },
	{
		name: 'shower-self-lv7',
		skillId: SKILL.AC_SHOWER,
		x: 30.5,
		y: 31.5,
		endTick: 1000,
		self: true,
		session: { lastSKID: SKILL.AC_SHOWER, lastSkLvl: 7 }
	},
	{
		name: 'shower-self-lv0',
		skillId: SKILL.AC_SHOWER,
		x: 4,
		y: 5,
		endTick: 700,
		self: true,
		session: { lastSKID: SKILL.AC_SHOWER, lastSkLvl: 0 }
	},
	{
		name: 'shower-self-lv11',
		skillId: SKILL.AC_SHOWER,
		x: 6,
		y: 7,
		endTick: 700,
		self: true,
		session: { lastSKID: SKILL.AC_SHOWER, lastSkLvl: 11 }
	},
	{
		name: 'shower-self-other-last',
		skillId: SKILL.AC_SHOWER,
		x: 8,
		y: 9,
		endTick: 700,
		self: true,
		session: { lastSKID: SKILL.WZ_STORMGUST, lastSkLvl: 9 }
	},
	{
		name: 'lp-self-lv5',
		skillId: SKILL.SA_LANDPROTECTOR,
		x: 50,
		y: 60,
		endTick: -1,
		self: true,
		session: { lastSKID: SKILL.SA_LANDPROTECTOR, lastSkLvl: 5 }
	}
];

/** Entity k followed by lock-on markers. */
export function makeMarkerTarget(k) {
	return { position: new Float32Array([70 + k, 80 - k, 0.2 + k]) };
}

/** Move the targets in place. */
export function moveMarkerTargets(targets, tick) {
	targets.forEach((t, k) => {
		t.position[0] = 70 + k - tick / 500;
		t.position[1] = 80 - k + tick / 800;
	});
}

/** Deterministic stand-in for Altitude.generatePlane (size² cells, 30 floats each). */
export function fakePlane(x, y, size) {
	const data = new Float32Array(size * size * 30);
	for (let i = 0; i < data.length; i++) {
		data[i] = Math.floor(x) + Math.floor(y) / 100 + (i % 30) / 1000;
	}
	return data;
}

/**
 * @param {Function} LockOnTarget legacy constructor
 * @param {Array} targets
 */
export function spawnLockOns(LockOnTarget, targets) {
	LockOnTarget.needInit = true;
	return LOCK_ON_SPAWNS.map(spawn => {
		const effect = new LockOnTarget(targets[spawn.target], spawn.startTick, spawn.endTick);
		effect.needInit = true;
		return { name: spawn.name, spawn, effect };
	});
}

/**
 * @param {Function} MagicTarget legacy constructor
 * @param {object} session the mocked Engine/SessionStorage.js default export
 */
export function spawnMagicTargets(MagicTarget, session) {
	MagicTarget.needInit = true;
	const other = { lastSKID: 0, lastSkLvl: 0 };
	return MAGIC_TARGET_SPAWNS.map(spawn => {
		Object.assign(session.Entity, { lastSKID: 0, lastSkLvl: 0 }, spawn.session);
		const effect = new MagicTarget(
			spawn.skillId,
			spawn.x,
			spawn.y,
			spawn.endTick,
			spawn.self ? session.Entity : other
		);
		effect.needInit = true;
		return { name: spawn.name, spawn, effect };
	});
}
