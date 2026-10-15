import { chain, rotationX, rotationY, transformPoint } from '../math.js';

/**
 * R-CTX-012: env colour = 1-(1-D)(1-A) per channel; light direction =
 * -(RotY(longitude)·RotX(latitude)·(0,1,0)).
 * @param {{diffuse: number[], ambient: number[], longitude: number, latitude: number}} light
 */
export function globalLight({ diffuse, ambient, longitude, latitude }) {
	const env = diffuse.map((d, i) => 1 - (1 - d) * (1 - ambient[i]));
	const dir = transformPoint(chain(rotationY(longitude), rotationX(latitude)), [0, 1, 0]).map(v => -v);
	return { env, direction: dir, diffuse: [...diffuse], ambient: [...ambient] };
}

/**
 * R-CTX-009: clear colour is the map's sky colour; a map with no sky entry
 * clears to opaque black and has no clouds.
 * @param {Record<string, {skyColor: number[], cloudColor?: number[]}>} skyTable
 * @param {string} mapName
 * @returns {{clearColor: [number, number, number, number], clouds: boolean, cloudColor: number[]|null}}
 */
export function skyForMap(skyTable, mapName) {
	const entry = skyTable[mapName];
	if (!entry) {
		return { clearColor: [0, 0, 0, 1], clouds: false, cloudColor: null };
	}
	const [r, g, b, a = 1] = entry.skyColor;
	return { clearColor: [r, g, b, a], clouds: Boolean(entry.cloudColor), cloudColor: entry.cloudColor ?? null };
}
