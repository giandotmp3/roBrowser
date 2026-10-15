import { deg2rad } from '../math.js';
import { DEFAULT_CLEAR_COLOR } from '../constants.js';
import { create, multiplyVec3, rotateX, rotateY } from './glm32.js';

/**
 * R-CTX-012: env = 1 − (1 − D)(1 − A) per channel.
 * @param {number[]} diffuse
 * @param {number[]} ambient
 */
export function envColor(diffuse, ambient) {
	return diffuse.map((d, i) => 1 - (1 - d) * (1 - ambient[i]));
}

/**
 * R-CTX-012: light direction = −(RotY(longitude)·RotX(latitude)·(0,1,0)).
 * @param {number} longitudeDeg
 * @param {number} latitudeDeg
 */
export function lightDirection(longitudeDeg, latitudeDeg) {
	const a = deg2rad(latitudeDeg);
	const b = deg2rad(longitudeDeg);
	const v = [Math.sin(a) * Math.sin(b), Math.cos(a), Math.sin(a) * Math.cos(b)];
	return v.map(c => -c);
}

/**
 * R-CTX-009: clear colour is the sky entry's skyColor, or opaque black (and no
 * clouds) when the map has no entry.
 * @param {{skyColor: number[], cloudColor?: number[]}|undefined|null} skyEntry
 */
export function clearColorFor(skyEntry) {
	if (!skyEntry) {
		return { color: [...DEFAULT_CLEAR_COLOR], clouds: false };
	}
	return { color: [...skyEntry.skyColor], clouds: Boolean(skyEntry.cloudColor) };
}

/**
 * R-CTX-012 with legacy MapRenderer's exact arithmetic (onWorldComplete): env per
 * channel and the light direction from a float32 RotY(longitude)·RotX(latitude)
 * matrix applied to (0, 1, 0), negated, both stored as Float32Array, so the uniforms
 * are bit-identical to legacy's.
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
