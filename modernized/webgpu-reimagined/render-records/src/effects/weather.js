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

/**
 * R-EFX-016 effect id of each map-flag weather (WeatherTable `weather` value), as
 * ScreenEffectManager starts them. 'leaves' is EF_MAPLE (discrepancy #60).
 */
export const MAP_FLAG_WEATHER_EFFECTS = Object.freeze({
	snow: 162, // EF_SNOW
	rain: 161, // EF_RAIN
	fireworks: 297, // EF_POKJUK
	leaves: 333, // EF_MAPLE
	sakura: 163, // EF_SAKURA
	cloud: 229, // EF_CLOUD
	cloud2: 230, // EF_CLOUD2
	cloud3: 233, // EF_CLOUD3
	cloud4: 515, // EF_CLOUD4
	cloud5: 516, // EF_CLOUD5
	cloud6: 592, // EF_CLOUD6
	cloud7: 697, // EF_CLOUD7
	cloud8: 698 // EF_CLOUD8
});

/**
 * Discrepancy #60 [FLAG, fixed]: the effect id of a weather instance, whichever spelling the
 * caller used. Legacy map-flag weather sets `Inst.effectId` while EffectManager sets
 * `Inst.effectID`, and each legacy weather class reads only one of them: the map-flag
 * 'leaves' shows sakura (SakuraWeatherEffect reads effectID) and EF_CLOUD2 from the
 * EffectTable gets the EF_CLOUD profile (CloudWeatherEffect reads effectId).
 * @param {{effectId?: number, effectID?: number}} inst
 * @returns {number|undefined}
 */
export function weatherEffectId(inst) {
	return inst.effectId ?? inst.effectID;
}
