/**
 * The few matrix steps the mesh effect families compute themselves, written as the
 * legacy gl-matrix build (src/Vendors/gl-matrix.js) computes them: float64 arithmetic
 * in the same order, stored into a Float32Array. The shaders then see exactly the
 * values legacy uploaded with uniformMatrix4fv / uniformMatrix3fv, which pixel parity
 * needs (a rotation built in the shader with its own sin/cos would not match).
 */

const EPSILON = 0.000001;

/**
 * gl-matrix `mat4.rotate(out, identity, rad, axis)`: rotation about an arbitrary axis,
 * applied to the identity (QuadHorn's three rotation uniforms).
 * @param {number} rad
 * @param {ArrayLike<number>} axis
 * @param {Float32Array} [out]
 * @returns {Float32Array}
 */
export function rotationAboutAxis(rad, axis, out = new Float32Array(16)) {
	let x = axis[0];
	let y = axis[1];
	let z = axis[2];
	let len = Math.sqrt(x * x + y * y + z * z);
	out.fill(0);
	out[0] = out[5] = out[10] = out[15] = 1;
	if (Math.abs(len) < EPSILON) {
		return out;
	}
	len = 1 / len;
	x *= len;
	y *= len;
	z *= len;
	const s = Math.sin(rad);
	const c = Math.cos(rad);
	const t = 1 - c;
	const b00 = x * x * t + c;
	const b01 = y * x * t + z * s;
	const b02 = z * x * t - y * s;
	const b10 = x * y * t - z * s;
	const b11 = y * y * t + c;
	const b12 = z * y * t + x * s;
	const b20 = x * z * t + y * s;
	const b21 = y * z * t - x * s;
	const b22 = z * z * t + c;
	// a = identity: out[i] = a00·b + a10·b + a20·b with the identity's ones and zeros.
	const a = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
	for (let col = 0; col < 3; col++) {
		const [p, q, r] = [
			[b00, b01, b02],
			[b10, b11, b12],
			[b20, b21, b22]
		][col];
		for (let row = 0; row < 4; row++) {
			out[col * 4 + row] = a[row] * p + a[4 + row] * q + a[8 + row] * r;
		}
	}
	return out;
}

/**
 * gl-matrix `mat4.toInverseMat3(mat)` followed by `mat3.transpose` (legacy RsmEffect
 * normal matrix, from the pass model-view). Null when the 3×3 block is singular.
 * @param {ArrayLike<number>} mat
 * @param {Float32Array} [out]
 * @returns {Float32Array|null}
 */
export function normalMatrix(mat, out = new Float32Array(9)) {
	const a00 = mat[0];
	const a01 = mat[1];
	const a02 = mat[2];
	const a10 = mat[4];
	const a11 = mat[5];
	const a12 = mat[6];
	const a20 = mat[8];
	const a21 = mat[9];
	const a22 = mat[10];
	const b01 = a22 * a11 - a12 * a21;
	const b11 = -a22 * a10 + a12 * a20;
	const b21 = a21 * a10 - a11 * a20;
	const d = a00 * b01 + a01 * b11 + a02 * b21;
	if (!d) {
		return null;
	}
	const id = 1 / d;
	const inv = new Float32Array(9);
	inv[0] = b01 * id;
	inv[1] = (-a22 * a01 + a02 * a21) * id;
	inv[2] = (a12 * a01 - a02 * a11) * id;
	inv[3] = b11 * id;
	inv[4] = (a22 * a00 - a02 * a20) * id;
	inv[5] = (-a12 * a00 + a02 * a10) * id;
	inv[6] = b21 * id;
	inv[7] = (-a21 * a00 + a01 * a20) * id;
	inv[8] = (a11 * a00 - a01 * a10) * id;
	// mat3.transpose (float32 values moved, not recomputed).
	for (let r = 0; r < 3; r++) {
		for (let c = 0; c < 3; c++) {
			out[c * 3 + r] = inv[r * 3 + c];
		}
	}
	return out;
}
