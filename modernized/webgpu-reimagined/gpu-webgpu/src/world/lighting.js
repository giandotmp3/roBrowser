import { chain, rotationX, rotationY, transformPoint } from '../math.js';
import { create, multiplyVec3, rotateX, rotateY } from './glm32.js';

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

/**
 * R-CTX-009 for a WeatherTable sky entry (the frame's `world.sky`): its skyColor, or
 * opaque black when the map has no entry. Same as gpu-webgl2 `clearColorFor`.
 * @param {{skyColor: number[]}|undefined|null} skyEntry
 * @returns {[number, number, number, number]}
 */
export function clearColorFor(skyEntry) {
	if (!skyEntry) {
		return [0, 0, 0, 1];
	}
	const [r, g, b, a = 1] = skyEntry.skyColor;
	return [r, g, b, a];
}

/**
 * R-CTX-012 with legacy MapRenderer's exact arithmetic (onWorldComplete): env per
 * channel and the light direction from a float32 RotY(longitude)·RotX(latitude)
 * matrix applied to (0, 1, 0), negated, both stored as Float32Array, so the uniforms
 * are bit-identical to legacy's. Same as gpu-webgl2 `mapLight`.
 * @param {{longitude: number, latitude: number, diffuse: ArrayLike<number>, ambient: ArrayLike<number>, opacity: number}} light
 * @returns {{direction: Float32Array, env: Float32Array, diffuse: Float32Array, ambient: Float32Array, opacity: number}}
 */
export function mapLight(light) {
	const d = light.diffuse;
	const a = light.ambient;
	const env = new Float32Array([
		1 - (1 - d[0]) * (1 - a[0]),
		1 - (1 - d[1]) * (1 - a[1]),
		1 - (1 - d[2]) * (1 - a[2])
	]);
	const m = create();
	rotateY(m, (light.longitude * Math.PI) / 180);
	rotateX(m, (light.latitude * Math.PI) / 180);
	const v = multiplyVec3([0, 1, 0], m);
	const direction = new Float32Array([-v[0], -v[1], -v[2]]);
	return {
		direction,
		env,
		diffuse: Float32Array.from(d),
		ambient: Float32Array.from(a),
		opacity: light.opacity
	};
}
