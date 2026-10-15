import { FOG_DB_SCALE } from '../constants.js';
import { mix, smoothstep } from '../math.js';

/**
 * R-MAP-004 fog uniforms: active only if the preference is on and the map has
 * an entry; near/far are DB values ×240; `factor` is stored but unused.
 * @param {{fogPref: boolean, entry: {near: number, far: number, color: number[], factor?: number}|null}} p
 */
export function fogUniforms({ fogPref, entry }) {
	if (!fogPref || !entry) {
		return { use: false, near: 0, far: 0, color: [0, 0, 0] };
	}
	return { use: true, near: entry.near * FOG_DB_SCALE, far: entry.far * FOG_DB_SCALE, color: [...entry.color] };
}

/**
 * CPU reference of shaders/fog.wgsl. `viewDepth` = fragCoord.z / fragCoord.w.
 * @param {number[]} rgba
 */
export function applyFog(rgba, viewDepth, fog) {
	if (!fog.use) {
		return [...rgba];
	}
	const f = smoothstep(fog.near, fog.far, viewDepth);
	return [mix(rgba[0], fog.color[0], f), mix(rgba[1], fog.color[1], f), mix(rgba[2], fog.color[2], f), rgba[3]];
}
