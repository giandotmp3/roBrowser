/**
 * Minimal column-major mat4/vec helpers (gl-matrix compatible layout).
 * Kept local so the scene module has no cross-module imports.
 */

/** @returns {Float32Array} */
export const create = () => identity(new Float32Array(16));

/** @param {Float32Array} out */
export const identity = (out) => {
	out.fill(0);
	out[0] = out[5] = out[10] = out[15] = 1;
	return out;
};

/**
 * gl-matrix perspective (fovy in radians).
 * @param {Float32Array} out
 */
export const perspective = (out, fovy, aspect, near, far) => {
	const f = 1.0 / Math.tan(fovy / 2);
	out.fill(0);
	out[0] = f / aspect;
	out[5] = f;
	out[11] = -1;
	const nf = 1 / (near - far);
	out[10] = (far + near) * nf;
	out[14] = 2 * far * near * nf;
	return out;
};

/** out = a * b */
export const multiply = (out, a, b) => {
	const r = new Float32Array(16);
	for (let c = 0; c < 4; c++) {
		for (let row = 0; row < 4; row++) {
			let s = 0;
			for (let k = 0; k < 4; k++) {
				s += a[k * 4 + row] * b[c * 4 + k];
			}
			r[c * 4 + row] = s;
		}
	}
	out.set(r);
	return out;
};

/** out = m * T(v) */
export const translate = (out, m, [x, y, z]) => {
	const t = create();
	t[12] = x;
	t[13] = y;
	t[14] = z;
	return multiply(out, m, t);
};

/** out = m * Rx(rad) */
export const rotateX = (out, m, rad) => {
	const r = create();
	const c = Math.cos(rad);
	const s = Math.sin(rad);
	r[5] = c;
	r[6] = s;
	r[9] = -s;
	r[10] = c;
	return multiply(out, m, r);
};

/** out = m * Ry(rad) */
export const rotateY = (out, m, rad) => {
	const r = create();
	const c = Math.cos(rad);
	const s = Math.sin(rad);
	r[0] = c;
	r[2] = -s;
	r[8] = s;
	r[10] = c;
	return multiply(out, m, r);
};

/** General 4x4 inverse. Returns null when singular. */
export const invert = (out, a) => {
	const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = a;
	const b00 = a00 * a11 - a01 * a10;
	const b01 = a00 * a12 - a02 * a10;
	const b02 = a00 * a13 - a03 * a10;
	const b03 = a01 * a12 - a02 * a11;
	const b04 = a01 * a13 - a03 * a11;
	const b05 = a02 * a13 - a03 * a12;
	const b06 = a20 * a31 - a21 * a30;
	const b07 = a20 * a32 - a22 * a30;
	const b08 = a20 * a33 - a23 * a30;
	const b09 = a21 * a32 - a22 * a31;
	const b10 = a21 * a33 - a23 * a31;
	const b11 = a22 * a33 - a23 * a32;
	let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
	if (!det) {
		return null;
	}
	det = 1.0 / det;
	out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
	out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
	out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
	out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
	out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
	out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
	out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
	out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
	out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
	out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
	out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
	out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
	out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
	out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
	out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
	out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
	return out;
};

/** out = M * v (vec4) */
export const transformVec4 = (m, [x, y, z, w]) => [
	m[0] * x + m[4] * y + m[8] * z + m[12] * w,
	m[1] * x + m[5] * y + m[9] * z + m[13] * w,
	m[2] * x + m[6] * y + m[10] * z + m[14] * w,
	m[3] * x + m[7] * y + m[11] * z + m[15] * w
];

export const toRad = (deg) => (deg * Math.PI) / 180;
