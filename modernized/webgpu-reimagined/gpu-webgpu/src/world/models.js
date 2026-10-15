import { chain, clamp, rotationX, rotationY, rotationZ, scaling, translation } from '../math.js';

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const normalize = v => {
	const l = Math.hypot(...v) || 1;
	return v.map(c => c / l);
};

/** R-MAP-012: RSM >= 1.4 and RSM2 store alpha as a byte /255; older files are opaque. */
export function modelAlpha(version, raw) {
	return version >= 1.4 ? raw / 255 : 1;
}

/**
 * Reference of shaders/models.wgsl (R-MAP-012) and animated_models.wgsl.
 * R-MAP-013 FIX: animated models honour the `lightmap` preference exactly like
 * static models (legacy always applied N·L to animated models).
 * Returns null when the fragment is discarded (tex alpha exactly 0).
 */
export function shadeModel({ tex, alpha, normal, light, lightmapPref }) {
	if (tex[3] === 0) {
		return null;
	}
	const nl = lightmapPref ? Math.max(dot(normal, light.direction), 0) : 1;
	const rgb = tex.slice(0, 3).map((c, i) => c * clamp(nl * light.diffuse[i] + light.ambient[i]) * clamp(light.env[i]));
	return [...rgb, tex[3] * alpha];
}

/** R-MAP-012: models depth test + write on, normal alpha blend, no sorting. */
export const MODEL_DEPTH = Object.freeze({ depthTest: true, depthWrite: true });

/**
 * R-MAP-014: T(pos + mapOffset)·RotZ·RotX·RotY·Scale; for RSM >= 2.2
 * additionally ·Scale(flip)·T(offset)·T(0, box.range.y, 0)·T(box.offset).
 */
export function rsmInstanceMatrix({ position, mapOffset = [0, 0, 0], rotation, scale, version, flip = [1, 1, 1], offset = [0, 0, 0], boxRangeY = 0, boxOffset = [0, 0, 0] }) {
	const parts = [
		translation(position[0] + mapOffset[0], position[1] + mapOffset[1], position[2] + mapOffset[2]),
		rotationZ(rotation[2]),
		rotationX(rotation[0]),
		rotationY(rotation[1]),
		scaling(...scale)
	];
	if (version >= 2.2) {
		parts.push(scaling(...flip), translation(...offset), translation(0, boxRangeY, 0), translation(...boxOffset));
	}
	return chain(...parts);
}

export const SHADE = Object.freeze({ NONE: 0, FLAT: 1, SMOOTH: 2 });

/**
 * R-MAP-015 normals. NONE: constant (-1,-1,-1); FLAT: per-face; SMOOTH: average
 * of face normals sharing a vertex within the same smoothGroup. Any other
 * shadeType is treated as NONE.
 * @param {number} shadeType
 * @param {{vertices: number[][], vertexIds: number[], smoothGroup: number}[]} faces
 * @returns {number[][][]} per face, per corner normal
 */
export function computeNormals(shadeType, faces) {
	if (shadeType !== SHADE.FLAT && shadeType !== SHADE.SMOOTH) {
		return faces.map(() => [[-1, -1, -1], [-1, -1, -1], [-1, -1, -1]]);
	}
	const faceN = faces.map(f => normalize(cross(sub(f.vertices[1], f.vertices[0]), sub(f.vertices[2], f.vertices[0]))));
	if (shadeType === SHADE.FLAT) {
		return faceN.map(n => [n, n, n]);
	}
	const acc = new Map();
	faces.forEach((f, i) => {
		f.vertexIds.forEach(v => {
			const key = `${f.smoothGroup}:${v}`;
			const cur = acc.get(key) ?? [0, 0, 0];
			acc.set(key, cur.map((c, k) => c + faceN[i][k]));
		});
	});
	return faces.map(f => f.vertexIds.map(v => normalize(acc.get(`${f.smoothGroup}:${v}`))));
}

/**
 * R-PERF-004: once every texture has loaded, static RSM draws merge into one
 * draw per texture over contiguous vertex ranges (infos arrive sorted by
 * texture from the worker). Before that, one draw per model info.
 * @param {{texture: string, vertOffset: number, vertCount: number}[]} infos
 * @param {boolean} allTexturesLoaded
 */
export function batchStaticModels(infos, allTexturesLoaded) {
	if (!allTexturesLoaded) {
		return infos.map(i => ({ texture: i.texture, first: i.vertOffset, count: i.vertCount }));
	}
	const out = [];
	for (const i of infos) {
		const last = out[out.length - 1];
		if (last && last.texture === i.texture && last.first + last.count === i.vertOffset) {
			last.count += i.vertCount;
		} else {
			out.push({ texture: i.texture, first: i.vertOffset, count: i.vertCount });
		}
	}
	return out;
}
