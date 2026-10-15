/**
 * gl-matrix compatible 4x4 helpers on column-major arrays (post-multiplied rotations,
 * like mat4.rotateX/Y/Z(out, out, rad)), for effect families whose shaders take a
 * rotation matrix uniform.
 */

/** @returns {number[]} a fresh identity matrix */
export function identity() {
	return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

/**
 * m = m · Rx(rad), in place.
 * @param {number[]} m
 * @param {number} rad
 * @returns {number[]} m
 */
export function rotateX(m, rad) {
	const s = Math.sin(rad);
	const c = Math.cos(rad);
	for (let k = 0; k < 4; k++) {
		const a1 = m[4 + k];
		const a2 = m[8 + k];
		m[4 + k] = a1 * c + a2 * s;
		m[8 + k] = a2 * c - a1 * s;
	}
	return m;
}

/**
 * m = m · Ry(rad), in place.
 * @param {number[]} m
 * @param {number} rad
 * @returns {number[]} m
 */
export function rotateY(m, rad) {
	const s = Math.sin(rad);
	const c = Math.cos(rad);
	for (let k = 0; k < 4; k++) {
		const a0 = m[k];
		const a2 = m[8 + k];
		m[k] = a0 * c - a2 * s;
		m[8 + k] = a0 * s + a2 * c;
	}
	return m;
}

/**
 * m = m · Rz(rad), in place.
 * @param {number[]} m
 * @param {number} rad
 * @returns {number[]} m
 */
export function rotateZ(m, rad) {
	const s = Math.sin(rad);
	const c = Math.cos(rad);
	for (let k = 0; k < 4; k++) {
		const a0 = m[k];
		const a1 = m[4 + k];
		m[k] = a0 * c + a1 * s;
		m[4 + k] = a1 * c - a0 * s;
	}
	return m;
}
