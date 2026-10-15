import { CLOUDS } from '../constants.js';

/**
 * R-MAP-022: cloud alpha envelope: fade in 1 s, hold for a 6 s life, fade out 2 s.
 * @param {number} ageMs
 * @returns {{alpha: number, respawn: boolean}}
 */
export function cloudAlpha(ageMs) {
	const { fadeInMs, lifeMs, fadeOutMs } = CLOUDS;
	if (ageMs < fadeInMs) {
		return { alpha: ageMs / fadeInMs, respawn: false };
	}
	if (ageMs < lifeMs) {
		return { alpha: 1, respawn: false };
	}
	if (ageMs < lifeMs + fadeOutMs) {
		return { alpha: 1 - (ageMs - lifeMs) / fadeOutMs, respawn: false };
	}
	return { alpha: 0, respawn: true };
}

/**
 * R-MAP-022: spawn within ±35 cells of the player at z = −10.
 * @param {number[]} player
 * @param {() => number} rng  [0,1) — injected for determinism (test-harness seeded RNG)
 */
export function spawnCloud(player, rng) {
	const r = CLOUDS.spawnRadius;
	return {
		position: [player[0] + (rng() * 2 - 1) * r, player[1] + (rng() * 2 - 1) * r, CLOUDS.z],
		texture: CLOUDS.textures[Math.floor(rng() * CLOUDS.textures.length)],
		age: 0
	};
}

/** R-MAP-022: drift ±0.01 cells per 25 ms horizontally, ±0.001 vertically, Δt capped at 250. */
export function cloudDrift(dtMs, rng) {
	const steps = Math.min(dtMs, CLOUDS.dtCapMs) / CLOUDS.driftStepMs;
	return [(rng() * 2 - 1) * CLOUDS.driftXY * steps, (rng() * 2 - 1) * CLOUDS.driftXY * steps, (rng() * 2 - 1) * CLOUDS.driftZ * steps];
}

/** R-MAP-022: test on, write off, no depth correction. */
export const CLOUD_PASS_STATE = Object.freeze({ depthTest: true, depthWrite: false, depthCorrection: false });
