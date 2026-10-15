import { deg2rad } from '../math.js';
import { DEFAULT_CLEAR_COLOR } from '../constants.js';

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
