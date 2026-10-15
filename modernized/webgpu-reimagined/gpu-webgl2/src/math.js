/** Minimal column-major mat4 helpers (gl-matrix compatible layout). */

export const deg2rad = d => (d * Math.PI) / 180;

export function identity() {
	const m = new Float32Array(16);
	m[0] = m[5] = m[10] = m[15] = 1;
	return m;
}

/** out = a · b */
export function multiply(a, b) {
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
}

export function translation(x, y, z) {
	const m = identity();
	m[12] = x;
	m[13] = y;
	m[14] = z;
	return m;
}

export function scaling(x, y, z) {
	const m = identity();
	m[0] = x;
	m[5] = y;
	m[10] = z;
	return m;
}

export function rotationX(rad) {
	const m = identity();
	const c = Math.cos(rad);
	const s = Math.sin(rad);
	m[5] = c;
	m[6] = s;
	m[9] = -s;
	m[10] = c;
	return m;
}

export function rotationY(rad) {
	const m = identity();
	const c = Math.cos(rad);
	const s = Math.sin(rad);
	m[0] = c;
	m[2] = -s;
	m[8] = s;
	m[10] = c;
	return m;
}

export function rotationZ(rad) {
	const m = identity();
	const c = Math.cos(rad);
	const s = Math.sin(rad);
	m[0] = c;
	m[1] = s;
	m[4] = -s;
	m[5] = c;
	return m;
}

/** Product of a list of matrices, left to right. */
export function chain(...ms) {
	return ms.reduce((acc, m) => multiply(acc, m), identity());
}

export const clamp01 = v => Math.min(Math.max(v, 0), 1);

export function smoothstep(e0, e1, x) {
	const t = clamp01((x - e0) / (e1 - e0));
	return t * t * (3 - 2 * t);
}
