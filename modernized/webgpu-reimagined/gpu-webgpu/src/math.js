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
