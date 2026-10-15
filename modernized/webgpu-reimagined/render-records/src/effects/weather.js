import { notImplemented } from '../util/errors.js';

/** 1 rag tick = 25 ms (R-EFX-017). */
export const RAG_TICK_MS = 25;

/** R-EFX-017 weather parameters. */
export const WEATHER_PARAMS = Object.freeze({
	snow: Object.freeze({
		perTick: 2,
		lifeMs: 8000,
		fadeInMs: 250,
		fadeOutFraction: 1 / 5,
		radius: 60,
		spawnHeight: [18, 22],
		fallPerTick: 0.1
	}),
	rain: Object.freeze({
		perTick: 10,
		maxDrops: 1100,
		radius: 70,
		spawnHeight: [22, 42],
		wind: 0.14,
		windJitter: 0.06,
		maxWindAngle: 0.55,
		thunderMs: [5000, 60000],
		maxPuddles: 600,
		maxPuddleAlpha: 0.45
	}),
	sakura: Object.freeze({ spawnIntervalMs: 150, lifeMs: 15000 })
});

/**
 * R-EFX-016 map-flag weather started at map load from
 * WeatherTable.effects[map].weather. Pending (needs WeatherTable data binding).
 * @param {string} _mapName
 * @param {Object} _weatherTable
 * @returns {string[]} e.g. ['snow'] / ['cloud3']
 */
export function mapWeather(_mapName, _weatherTable) {
	return notImplemented('R-EFX-016', 'map-flag weather lookup');
}
