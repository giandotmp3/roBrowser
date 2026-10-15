import { CLOUDS } from '../constants.js';

/** R-MAP-022 cloud pipeline depth state: test on, write off, no depth correction. */
export const CLOUD_DEPTH = Object.freeze({ depthTest: true, depthWrite: false, depthCorrection: false });

/**
 * R-MAP-022: spawn one cloud billboard within ±35 cells of the player at z = −10.
 * @param {() => number} rng  injected seeded RNG in [0,1) (test-harness)
 */
export function spawnCloud(rng, player) {
	return {
		position: [player[0] + (rng() * 2 - 1) * CLOUDS.spawnRadius, player[1] + (rng() * 2 - 1) * CLOUDS.spawnRadius, CLOUDS.z],
		texture: CLOUDS.textures[Math.floor(rng() * CLOUDS.textures.length)],
		size: CLOUDS.size,
		age: 0
	};
}

/** R-MAP-022: a field of 150 billboards tinted with cloudColor. */
export function createCloudField(rng, player, cloudColor) {
	return { color: [...cloudColor], clouds: Array.from({ length: CLOUDS.count }, () => spawnCloud(rng, player)) };
}

/**
 * R-MAP-022 alpha envelope: fade in over 1 s, hold to the 6 s life, fade out
 * over 2 s, then respawn. Returns null once the cloud must respawn.
 * (Interpretation of "holds for a 6 s life": fade-out starts at age 6 s.)
 */
export function cloudAlpha(ageMs) {
	if (ageMs < CLOUDS.fadeInMs) {
		return ageMs / CLOUDS.fadeInMs;
	}
	if (ageMs < CLOUDS.lifeMs) {
		return 1;
	}
	if (ageMs < CLOUDS.lifeMs + CLOUDS.fadeOutMs) {
		return 1 - (ageMs - CLOUDS.lifeMs) / CLOUDS.fadeOutMs;
	}
	return null;
}
