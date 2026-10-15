import { ZINDEX_BIAS } from '../constants.js';
import { invert } from '../math.js';

/**
 * R-SPR-006: clip.z −= (zIndex·0.01 + depth) / max(zoom, 1).
 * CPU reference of the same line in shaders/sprite.vert.
 */
export function zIndexBias(zIndex, depthBias, zoom) {
	return (zIndex * ZINDEX_BIAS + depthBias) / Math.max(zoom, 1);
}

/**
 * R-SPR-005 cap: corrected z is capped with min(original, corrected) except
 * NPCs (ignoreDepthMinCap) which take the corrected z outright.
 */
export function cappedDepth(originalZ, correctedZ, ignoreDepthMinCap) {
	return ignoreDepthMinCap ? correctedZ : Math.min(originalZ, correctedZ);
}

/** column-major mat4 · vec4 */
const transform = (m, v) => [0, 1, 2, 3].map(r => m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2] + m[12 + r] * v[3]);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const normalize = v => {
	const l = Math.hypot(v[0], v[1], v[2]);
	return l ? [v[0] / l, v[1] / l, v[2] / l] : [0, 0, 0];
};

/**
 * R-SPR-002: the view matrix translated to the sprite (x, −z, y) + half a cell,
 * with its rotation replaced by identity. CPU reference of `project()` in sprite.vert.
 * @param {ArrayLike<number>} modelView
 * @param {ArrayLike<number>} position  World (x, y, z)
 */
export function billboardModelView(modelView, position) {
	const m = Array.from(modelView);
	const x = position[0] + 0.5;
	const y = -position[2];
	const z = position[1] + 0.5;
	for (let r = 0; r < 4; r++) {
		m[12 + r] += m[r] * x + m[4 + r] * y + m[8 + r] * z;
	}
	m.splice(0, 3, 1, 0, 0);
	m.splice(4, 3, 0, 1, 0);
	m.splice(8, 3, 0, 0, 1);
	return m;
}

/**
 * R-SPR-005: depth where the vertex's camera ray meets the vertical plane
 * through the sprite centre (normal = flattened camera forward), in clip z,
 * then capped (cappedDepth). CPU reference of the same block in sprite.vert.
 * @param {{modelView: ArrayLike<number>, projection: ArrayLike<number>, position: ArrayLike<number>,
 *   local: ArrayLike<number>, ignoreDepthMinCap?: boolean}} input
 *   `local` is the quad vertex in sprite space (after size, angle and offset)
 * @returns {{original: number, corrected: number, z: number}}
 */
export function correctedClipZ({ modelView, projection, position, local, ignoreDepthMinCap = false }) {
	const viewModel = invert(modelView);
	const mv = billboardModelView(modelView, position);
	const viewPosition = transform(mv, [local[0], local[1], 0, 1]);
	const viewCenter = transform(mv, [0, 0, 0, 1]);
	const clip = transform(projection, viewPosition);

	const cameraPos = transform(viewModel, [0, 0, 0, 1]);
	const cameraForward = normalize(transform(viewModel, [0, 0, -1, 0]));
	const planePoint = transform(viewModel, viewCenter);
	let planeNormal = normalize([cameraForward[0], 0, cameraForward[2]]);
	if (Math.hypot(...planeNormal) < 0.000001) {
		planeNormal = cameraForward;
	}
	const worldVertex = transform(viewModel, viewPosition);
	const rayDir = normalize(sub(worldVertex, cameraPos));
	const denom = Math.max(dot(planeNormal, rayDir), 0.000001);
	const dist = dot(sub(planePoint, cameraPos), planeNormal) / denom;
	const hit = [0, 1, 2].map(i => cameraPos[i] + rayDir[i] * dist);
	const planeClip = transform(projection, transform(modelView, [...hit, 1]));
	const corrected = planeClip[2] * (clip[3] / Math.max(planeClip[3], 0.000001));
	return { original: clip[2], corrected, z: cappedDepth(clip[2], corrected, ignoreDepthMinCap) };
}
