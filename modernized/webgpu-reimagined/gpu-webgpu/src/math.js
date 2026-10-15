/** Minimal column-major mat4 helpers (CPU side only; matches gl-matrix layout). */

export const identity = () => {
	const m = new Float32Array(16);
	m[0] = m[5] = m[10] = m[15] = 1;
	return m;
};

export const multiply = (a, b) => {
	const out = new Float32Array(16);
	for (let c = 0; c < 4; c++) {
		for (let r = 0; r < 4; r++) {
			let s = 0;
			for (let k = 0; k < 4; k++) {
				s += a[k * 4 + r] * b[c * 4 + k];
			}
			out[c * 4 + r] = s;
		}
	}
	return out;
};

export const translation = (x, y, z) => {
	const m = identity();
	m[12] = x;
	m[13] = y;
	m[14] = z;
	return m;
};

export const scaling = (x, y, z) => {
	const m = identity();
	m[0] = x;
	m[5] = y;
	m[10] = z;
	return m;
};

const rad = deg => (deg * Math.PI) / 180;

export const rotationX = deg => {
	const m = identity();
	const c = Math.cos(rad(deg));
	const s = Math.sin(rad(deg));
	m[5] = c;
	m[6] = s;
	m[9] = -s;
	m[10] = c;
	return m;
};

export const rotationY = deg => {
	const m = identity();
	const c = Math.cos(rad(deg));
	const s = Math.sin(rad(deg));
	m[0] = c;
	m[2] = -s;
	m[8] = s;
	m[10] = c;
	return m;
};

export const rotationZ = deg => {
	const m = identity();
	const c = Math.cos(rad(deg));
	const s = Math.sin(rad(deg));
	m[0] = c;
	m[1] = s;
	m[4] = -s;
	m[5] = c;
	return m;
};

export const chain = (...ms) => ms.reduce((acc, m) => multiply(acc, m), identity());

export const transformPoint = (m, [x, y, z]) => [
	m[0] * x + m[4] * y + m[8] * z + m[12],
	m[1] * x + m[5] * y + m[9] * z + m[13],
	m[2] * x + m[6] * y + m[10] * z + m[14]
];

export const clamp = (v, lo = 0, hi = 1) => Math.min(Math.max(v, lo), hi);

export const smoothstep = (e0, e1, x) => {
	const t = clamp((x - e0) / (e1 - e0));
	return t * t * (3 - 2 * t);
};

export const mix = (a, b, t) => a + (b - a) * t;

export const nextPow2 = n => {
	let p = 1;
	while (p < n) {
		p <<= 1;
	}
	return p;
};

/** out = inverse(a) (gl-matrix mat4.invert); null when singular. */
export function invert(a, out = new Float32Array(16)) {
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
}
