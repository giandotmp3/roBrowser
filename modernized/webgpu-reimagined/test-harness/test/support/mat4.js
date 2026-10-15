/** Minimal column-major mat4 (gl-matrix semantics) for independent reference values in tests. */
export const identity = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

export function multiply(a, b) {
	const o = new Array(16).fill(0);
	for (let c = 0; c < 4; c++) {
		for (let r = 0; r < 4; r++) {
			let s = 0;
			for (let k = 0; k < 4; k++) {
				s += a[k * 4 + r] * b[c * 4 + k];
			}
			o[c * 4 + r] = s;
		}
	}
	return o;
}

export const translation = ([x, y, z]) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];

export function rotationX(deg) {
	const r = (deg * Math.PI) / 180;
	const c = Math.cos(r);
	const s = Math.sin(r);
	return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1];
}

export function rotationY(deg) {
	const r = (deg * Math.PI) / 180;
	const c = Math.cos(r);
	const s = Math.sin(r);
	return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
}

/** R-CAM-007 reference: Tz((0−zoom)/2)·Rx(pitch)·Ry(yaw)·T(−x−0.5, h+zOffset, −y−0.5). */
export const cameraModelView = ({ zoom, pitch, yaw, x, y, h, zOffset }) =>
	[
		translation([0, 0, (0 - zoom) / 2]),
		rotationX(pitch),
		rotationY(yaw),
		translation([-x - 0.5, h + zOffset, -y - 0.5])
	].reduce(multiply, identity());
