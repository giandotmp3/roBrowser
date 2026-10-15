/**
 * Static meshes of the mesh effect families: the vertex data legacy uploads once per
 * class (or per instance, for Cylinder), generated with the legacy generators' exact
 * arithmetic so the float32 vertices are identical. Cached per mesh key by the
 * pipeline; one GL buffer per key, shared by every record that uses it.
 */

/** Two triangles over [−1, 1]²: x, y, u, v (Tiles, FlatColorTile, SpiritSphere, WarlockSphere). */
export const QUAD_XY = Object.freeze([
	-1.0, -1.0, 0.0, 0.0, +1.0, -1.0, 1.0, 0.0, +1.0, +1.0, 1.0, 1.0, +1.0, +1.0, 1.0, 1.0, -1.0, +1.0, 0.0, 1.0, -1.0,
	-1.0, 0.0, 0.0
]);

/** The same quad over [−0.5, 0.5]² (LockOnTarget). */
export const QUAD_XY_HALF = Object.freeze([
	-0.5, -0.5, 0.0, 0.0, +0.5, -0.5, 1.0, 0.0, +0.5, +0.5, 1.0, 1.0, +0.5, +0.5, 1.0, 1.0, -0.5, +0.5, 0.0, 1.0, -0.5,
	-0.5, 0.0, 0.0
]);

/** Horizontal quad in the XZ plane: x, y, z, u, v (GroundAura, RainWeather puddles). */
export const QUAD_XZ = Object.freeze([
	-0.5, 0.0, -0.5, 0.0, 0.0, 0.5, 0.0, -0.5, 1.0, 0.0, -0.5, 0.0, 0.5, 0.0, 1.0, 0.5, 0.0, -0.5, 1.0, 0.0, 0.5, 0.0,
	0.5, 1.0, 1.0, -0.5, 0.0, 0.5, 0.0, 1.0
]);

/** Spray particle corners, a 4-vertex strip (WaterfallEffect PARTICLE_CORNERS). */
export const SPRAY_CORNERS = Object.freeze([-1, -1, 1, -1, -1, 1, 1, 1]);

const QUADHORN_VERTICES = [
	0.0, 1.0, 0.0, -1.0, -1.0, 1.0, 1.0, -1.0, 1.0, 0.0, 1.0, 0.0, 1.0, -1.0, 1.0, 1.0, -1.0, -1.0, 0.0, 1.0, 0.0, 1.0,
	-1.0, -1.0, -1.0, -1.0, -1.0, 0.0, 1.0, 0.0, -1.0, -1.0, -1.0, -1.0, -1.0, 1.0
];
const QUADHORN_TEX_COORDS = [0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 0, 0, 1, 0, 0];

/**
 * QuadHorn's 12 vertices (legacy uploads positions and uvs as two buffers), interleaved
 * x, y, z, u, v.
 * @returns {Float32Array}
 */
export function quadHornMesh() {
	const out = new Float32Array(12 * 5);
	for (let i = 0; i < 12; i++) {
		out.set(QUADHORN_VERTICES.slice(i * 3, i * 3 + 3), i * 5);
		out.set(QUADHORN_TEX_COORDS.slice(i * 2, i * 2 + 2), i * 5 + 3);
	}
	return out;
}

/**
 * Legacy `generateCylinder(totalCircleSides, circleSides, repeatTextureX)` (Cylinder.js):
 * x, y, z (0 bottom / 1 top), u, v. The last segment reads past the arrays, so it pushes
 * 3 vertices (bottom, top, top) instead of 6, as legacy's does.
 * @param {number} totalCircleSides
 * @param {number} circleSides
 * @param {number} repeatTextureX
 * @returns {Float32Array}
 */
export function cylinderMesh(totalCircleSides, circleSides, repeatTextureX) {
	const bottom = [];
	const top = [];
	const mesh = [];
	for (let i = 0; i <= circleSides; i++) {
		const a = (i + 0.0) / totalCircleSides;
		const b = (i + 0.0) / totalCircleSides;
		bottom[i] = [
			Math.sin(a * Math.PI * 2),
			Math.cos(a * Math.PI * 2),
			0,
			a * (totalCircleSides / circleSides) * repeatTextureX,
			1
		];
		top[i] = [
			Math.sin(b * Math.PI * 2),
			Math.cos(b * Math.PI * 2),
			1,
			b * (totalCircleSides / circleSides) * repeatTextureX,
			0
		];
	}
	const push = vertex => {
		if (vertex) {
			mesh.push(...vertex);
		}
	};
	for (let i = 0; i <= circleSides; i++) {
		push(bottom[i]);
		push(top[i]);
		push(bottom[i + 1]);
		push(top[i]);
		push(bottom[i + 1]);
		push(top[i + 1]);
	}
	return new Float32Array(mesh);
}

/**
 * Legacy `generatePropertyGround()` = `generateMagicRing()` (20 segments, top ring offset
 * half a segment): x, y, z (0 bottom / 1 top), u, v; same short last segment as the
 * cylinder.
 * @returns {Float32Array}
 */
export function groundRingMesh() {
	const total = 20;
	const bottom = [];
	const top = [];
	const mesh = [];
	for (let i = 0; i <= total; i++) {
		const a = (i + 0.0) / total;
		const b = (i + 0.5) / total;
		bottom[i] = [Math.sin(a * Math.PI * 2), Math.cos(a * Math.PI * 2), 0, a, 1];
		top[i] = [Math.sin(b * Math.PI * 2), Math.cos(b * Math.PI * 2), 1, b, 0];
	}
	const push = vertex => {
		if (vertex) {
			mesh.push(...vertex);
		}
	};
	for (let i = 0; i <= total; i++) {
		push(bottom[i]);
		push(top[i]);
		push(bottom[i + 1]);
		push(top[i]);
		push(bottom[i + 1]);
		push(top[i + 1]);
	}
	return new Float32Array(mesh);
}

/** SwirlingAura band: 21 divisions, two vertices each (legacy E_DIVISION). */
export const SWIRL_DIVISIONS = 21;

/**
 * Legacy SwirlingAura `generateIndices()`: two triangles per division step.
 * @returns {Uint16Array}
 */
export function swirlingAuraIndices() {
	const indices = [];
	for (let k = 0; k < SWIRL_DIVISIONS - 1; k++) {
		const i0 = k * 2;
		const i1 = k * 2 + 1;
		const i2 = k * 2 + 2;
		const i3 = k * 2 + 3;
		indices.push(i0, i1, i2, i1, i3, i2);
	}
	return new Uint16Array(indices);
}
