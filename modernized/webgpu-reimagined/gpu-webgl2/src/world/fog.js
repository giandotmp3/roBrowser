import { FOG_DB_SCALE } from '../constants.js';
import { smoothstep } from '../math.js';

/**
 * R-MAP-004: fog uniforms shared by ground, sprite, model, STR and effect
 * shaders (one GLSL include: shaders/fog.glsl). near/far are DB values ×240;
 * factor is not used. No entry or preference off → no fog.
 * @param {{near: number, far: number, color: number[]}|undefined|null} dbFog
 * @param {boolean} fogPreference
 */
export function fogUniforms(dbFog, fogPreference) {
	if (!dbFog || !fogPreference) {
		return { use: false, near: 0, far: 0, color: [0, 0, 0] };
	}
	return { use: true, near: dbFog.near * FOG_DB_SCALE, far: dbFog.far * FOG_DB_SCALE, color: [...dbFog.color] };
}

/**
 * CPU reference of fog.glsl: f = smoothstep(near, far, depth), rgb = mix(rgb, fog, f); alpha kept.
 * @param {number[]} rgba
 * @param {number} depth  gl_FragCoord.z / gl_FragCoord.w
 * @param {ReturnType<typeof fogUniforms>} fog
 */
export function applyFog(rgba, depth, fog) {
	if (!fog.use) {
		return [...rgba];
	}
	const f = smoothstep(fog.near, fog.far, depth);
	return [0, 1, 2].map(i => rgba[i] * (1 - f) + fog.color[i] * f).concat(rgba[3]);
}
