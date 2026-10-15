/**
 * Float32 matrix helpers for the world CPU paths (light direction, occluder eye,
 * animated RSM node matrices). Each one performs the same arithmetic, in the same
 * order, with the same Float32Array storage points as the gl-matrix build legacy
 * uses (src/Vendors/gl-matrix.js and its src/Utils/gl-matrix.js extensions), so the
 * values that reach the GPU are bit-identical to legacy's. Column-major mat4.
 *
 * Kept local to gpu-webgl2: the package never imports the legacy client.
 */

/** gl-matrix GLMAT_EPSILON */
const EPSILON = 0.000001;

export const create = () => identity(new Float32Array(16));

export const vec3 = (x = 0, y = 0, z = 0) => Float32Array.of(x, y, z);

/** @param {Float32Array} out */
export function identity(out) {
	out.fill(0);
	out[0] = out[5] = out[10] = out[15] = 1;
	return out;
}

/**
 * @param {Float32Array} out
 * @param {ArrayLike<number>} a
 */
export function copy(out, a) {
	for (let i = 0; i < 16; i++) {
		out[i] = a[i];
	}
	return out;
}

/**
 * out = a · b (gl-matrix mat4.multiply; out may alias a or b).
 * @param {Float32Array} out
 * @param {ArrayLike<number>} a
 * @param {ArrayLike<number>} b
 */
export function multiply(out, a, b) {
	const a00 = a[0];
	const a01 = a[1];
	const a02 = a[2];
	const a03 = a[3];
	const a10 = a[4];
	const a11 = a[5];
	const a12 = a[6];
	const a13 = a[7];
	const a20 = a[8];
	const a21 = a[9];
	const a22 = a[10];
	const a23 = a[11];
	const a30 = a[12];
	const a31 = a[13];
	const a32 = a[14];
	const a33 = a[15];
	for (let c = 0; c < 16; c += 4) {
		const b0 = b[c];
		const b1 = b[c + 1];
		const b2 = b[c + 2];
		const b3 = b[c + 3];
		out[c] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
		out[c + 1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
		out[c + 2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
		out[c + 3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
	}
	return out;
}

/**
 * gl-matrix mat4.translate.
 * @param {Float32Array} out
 * @param {Float32Array} a
 * @param {ArrayLike<number>} v
 */
export function translate(out, a, v) {
	const x = v[0];
	const y = v[1];
	const z = v[2];
	if (a === out) {
		out[12] = a[0] * x + a[4] * y + a[8] * z + a[12];
		out[13] = a[1] * x + a[5] * y + a[9] * z + a[13];
		out[14] = a[2] * x + a[6] * y + a[10] * z + a[14];
		out[15] = a[3] * x + a[7] * y + a[11] * z + a[15];
		return out;
	}
	for (let i = 0; i < 12; i++) {
		out[i] = a[i];
	}
	out[12] = a[0] * x + a[4] * y + a[8] * z + a[12];
	out[13] = a[1] * x + a[5] * y + a[9] * z + a[13];
	out[14] = a[2] * x + a[6] * y + a[10] * z + a[14];
	out[15] = a[3] * x + a[7] * y + a[11] * z + a[15];
	return out;
}

/**
 * gl-matrix mat4.scale.
 * @param {Float32Array} out
 * @param {Float32Array} a
 * @param {ArrayLike<number>} v
 */
export function scale(out, a, v) {
	for (let i = 0; i < 4; i++) {
		out[i] = a[i] * v[0];
		out[4 + i] = a[4 + i] * v[1];
		out[8 + i] = a[8 + i] * v[2];
		out[12 + i] = a[12 + i];
	}
	return out;
}

/**
 * gl-matrix mat4.rotate (axis-angle). Returns null, leaving `out` untouched, for a
 * zero-length axis.
 * @param {Float32Array} out
 * @param {Float32Array} a
 * @param {number} rad
 * @param {ArrayLike<number>} axis
 */
export function rotate(out, a, rad, axis) {
	let x = axis[0];
	let y = axis[1];
	let z = axis[2];
	let len = Math.sqrt(x * x + y * y + z * z);
	if (Math.abs(len) < EPSILON) {
		return null;
	}
	len = 1 / len;
	x *= len;
	y *= len;
	z *= len;
	const s = Math.sin(rad);
	const c = Math.cos(rad);
	const t = 1 - c;
	const a00 = a[0];
	const a01 = a[1];
	const a02 = a[2];
	const a03 = a[3];
	const a10 = a[4];
	const a11 = a[5];
	const a12 = a[6];
	const a13 = a[7];
	const a20 = a[8];
	const a21 = a[9];
	const a22 = a[10];
	const a23 = a[11];
	const b00 = x * x * t + c;
	const b01 = y * x * t + z * s;
	const b02 = z * x * t - y * s;
	const b10 = x * y * t - z * s;
	const b11 = y * y * t + c;
	const b12 = z * y * t + x * s;
	const b20 = x * z * t + y * s;
	const b21 = y * z * t - x * s;
	const b22 = z * z * t + c;
	out[0] = a00 * b00 + a10 * b01 + a20 * b02;
	out[1] = a01 * b00 + a11 * b01 + a21 * b02;
	out[2] = a02 * b00 + a12 * b01 + a22 * b02;
	out[3] = a03 * b00 + a13 * b01 + a23 * b02;
	out[4] = a00 * b10 + a10 * b11 + a20 * b12;
	out[5] = a01 * b10 + a11 * b11 + a21 * b12;
	out[6] = a02 * b10 + a12 * b11 + a22 * b12;
	out[7] = a03 * b10 + a13 * b11 + a23 * b12;
	out[8] = a00 * b20 + a10 * b21 + a20 * b22;
	out[9] = a01 * b20 + a11 * b21 + a21 * b22;
	out[10] = a02 * b20 + a12 * b21 + a22 * b22;
	out[11] = a03 * b20 + a13 * b21 + a23 * b22;
	if (a !== out) {
		out[12] = a[12];
		out[13] = a[13];
		out[14] = a[14];
		out[15] = a[15];
	}
	return out;
}

/**
 * gl-matrix mat4.rotateX (in place on `a`).
 * @param {Float32Array} a
 * @param {number} rad
 */
export function rotateX(a, rad) {
	const s = Math.sin(rad);
	const c = Math.cos(rad);
	const a10 = a[4];
	const a11 = a[5];
	const a12 = a[6];
	const a13 = a[7];
	const a20 = a[8];
	const a21 = a[9];
	const a22 = a[10];
	const a23 = a[11];
	a[4] = a10 * c + a20 * s;
	a[5] = a11 * c + a21 * s;
	a[6] = a12 * c + a22 * s;
	a[7] = a13 * c + a23 * s;
	a[8] = a20 * c - a10 * s;
	a[9] = a21 * c - a11 * s;
	a[10] = a22 * c - a12 * s;
	a[11] = a23 * c - a13 * s;
	return a;
}

/**
 * gl-matrix mat4.rotateY (in place on `a`).
 * @param {Float32Array} a
 * @param {number} rad
 */
export function rotateY(a, rad) {
	const s = Math.sin(rad);
	const c = Math.cos(rad);
	const a00 = a[0];
	const a01 = a[1];
	const a02 = a[2];
	const a03 = a[3];
	const a20 = a[8];
	const a21 = a[9];
	const a22 = a[10];
	const a23 = a[11];
	a[0] = a00 * c - a20 * s;
	a[1] = a01 * c - a21 * s;
	a[2] = a02 * c - a22 * s;
	a[3] = a03 * c - a23 * s;
	a[8] = a00 * s + a20 * c;
	a[9] = a01 * s + a21 * c;
	a[10] = a02 * s + a22 * c;
	a[11] = a03 * s + a23 * c;
	return a;
}

/**
 * gl-matrix mat4.fromQuat.
 * @param {Float32Array} out
 * @param {ArrayLike<number>} q
 */
export function fromQuat(out, q) {
	const x = q[0];
	const y = q[1];
	const z = q[2];
	const w = q[3];
	const x2 = x + x;
	const y2 = y + y;
	const z2 = z + z;
	const xx = x * x2;
	const xy = x * y2;
	const xz = x * z2;
	const yy = y * y2;
	const yz = y * z2;
	const zz = z * z2;
	const wx = w * x2;
	const wy = w * y2;
	const wz = w * z2;
	out[0] = 1 - (yy + zz);
	out[1] = xy + wz;
	out[2] = xz - wy;
	out[3] = 0;
	out[4] = xy - wz;
	out[5] = 1 - (xx + zz);
	out[6] = yz + wx;
	out[7] = 0;
	out[8] = xz + wy;
	out[9] = yz - wx;
	out[10] = 1 - (xx + yy);
	out[11] = 0;
	out[12] = 0;
	out[13] = 0;
	out[14] = 0;
	out[15] = 1;
	return out;
}

/**
 * Legacy Utils/gl-matrix mat3.toMat4: a new mat4 holding the mat3 (column-major).
 * @param {ArrayLike<number>} m
 */
export function mat3ToMat4(m) {
	const out = new Float32Array(16);
	out[0] = m[0];
	out[1] = m[1];
	out[2] = m[2];
	out[4] = m[3];
	out[5] = m[4];
	out[6] = m[5];
	out[8] = m[6];
	out[9] = m[7];
	out[10] = m[8];
	out[15] = 1;
	return out;
}

/**
 * gl-matrix mat4.invert. Returns null for a singular matrix.
 * @param {Float32Array} out
 * @param {ArrayLike<number>} a
 */
export function invert(out, a) {
	const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = Array.from(a);
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
}

/**
 * Legacy Utils/gl-matrix mat4.multiplyVec3 (w = 1): a new Float32Array(3).
 * @param {ArrayLike<number>} v
 * @param {ArrayLike<number>} m
 */
export function multiplyVec3(v, m) {
	const out = new Float32Array(3);
	const [x, y, z] = [v[0], v[1], v[2]];
	out[0] = m[0] * x + m[4] * y + m[8] * z + m[12];
	out[1] = m[1] * x + m[5] * y + m[9] * z + m[13];
	out[2] = m[2] * x + m[6] * y + m[10] * z + m[14];
	return out;
}

/**
 * gl-matrix quat.slerp.
 * @param {Float32Array} out
 * @param {ArrayLike<number>} a
 * @param {ArrayLike<number>} b
 * @param {number} t
 */
export function slerp(out, a, b, t) {
	const ax = a[0];
	const ay = a[1];
	const az = a[2];
	const aw = a[3];
	let bx = b[0];
	let by = b[1];
	let bz = b[2];
	let bw = b[3];
	let cosom = ax * bx + ay * by + az * bz + aw * bw;
	if (cosom < 0.0) {
		cosom = -cosom;
		bx = -bx;
		by = -by;
		bz = -bz;
		bw = -bw;
	}
	let scale0;
	let scale1;
	if (1.0 - cosom > 0.000001) {
		const omega = Math.acos(cosom);
		const sinom = Math.sin(omega);
		scale0 = Math.sin((1.0 - t) * omega) / sinom;
		scale1 = Math.sin(t * omega) / sinom;
	} else {
		scale0 = 1.0 - t;
		scale1 = t;
	}
	out[0] = scale0 * ax + scale1 * bx;
	out[1] = scale0 * ay + scale1 * by;
	out[2] = scale0 * az + scale1 * bz;
	out[3] = scale0 * aw + scale1 * bw;
	return out;
}

/**
 * gl-matrix vec3.lerp.
 * @param {Float32Array} out
 * @param {ArrayLike<number>} a
 * @param {ArrayLike<number>} b
 * @param {number} t
 */
export function lerp3(out, a, b, t) {
	const ax = a[0];
	const ay = a[1];
	const az = a[2];
	out[0] = ax + t * (b[0] - ax);
	out[1] = ay + t * (b[1] - ay);
	out[2] = az + t * (b[2] - az);
	return out;
}
