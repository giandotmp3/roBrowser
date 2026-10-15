/**
 * GR2 instance world matrix and per-model lighting (C-14), CPU only.
 *
 * Same arithmetic, in the same order, as legacy Renderer/GR2/gr2World.js, gr2Math.js and
 * the GR2ModelRenderer lighting dispatch, so the matrix handed to the backends is
 * bit-identical: a row-vector (D3D, v' = v·M) chain `ipRow · Rx(+90°) · Ry(yaw) · S(0.2) ·
 * T(x + 0.5, y + groundOffset, z + 0.5)` whose flat array is read column-major as-is.
 */
import { gr2Yaw } from './GR2Pose.js';

/** Geometry scale under the /5 referential (0.2 = 1.0u / 5.0u). */
export const GR2_UNIT_SCALE = 0.2;
/** Cell-centre offset on X and Z. */
export const GR2_PLACEMENT_OFS = 0.5;
/** asm-cited +180° plus the live-map +180° reconciliation. */
export const GR2_YAW_BASE_DEG = 360;

export const GR2_IDENTITY_ROW = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

/** Row-vector 4×4 product a·b (float64, like legacy gr2Math.mul). */
export function gr2MulRow(a, b) {
	const o = new Array(16);
	for (let r = 0; r < 4; r++) {
		for (let c = 0; c < 4; c++) {
			let s = 0;
			for (let k = 0; k < 4; k++) {
				s += a[r * 4 + k] * b[k * 4 + c];
			}
			o[r * 4 + c] = s;
		}
	}
	return o;
}

const transRow = (x, y, z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
const rotXRow = a => {
	const s = Math.sin(a);
	const c = Math.cos(a);
	return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1];
};
const rotYRow = a => {
	const s = Math.sin(a);
	const c = Math.cos(a);
	return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
};
const scaleRow = s => [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, 0, 0, 0, 1];

/**
 * Row-vector world core Rx(+90°)·Ry(yaw)·S(0.2)·T at the /5 referential.
 * @param {number} yawDeg  facing in degrees (R-GR2-004: dir·45°)
 * @param {ArrayLike<number>} pos  [x, up, z] in the caller's referential
 * @param {number} [heightOffset]
 */
export function gr2WorldCore(yawDeg, pos, heightOffset = 0) {
	const yaw = ((yawDeg + GR2_YAW_BASE_DEG) / 180) * Math.PI;
	let m = gr2MulRow(rotXRow(Math.PI / 2), rotYRow(yaw));
	m = gr2MulRow(m, scaleRow(GR2_UNIT_SCALE));
	return gr2MulRow(m, transRow(pos[0] + GR2_PLACEMENT_OFS, pos[1] + heightOffset, pos[2] + GR2_PLACEMENT_OFS));
}

/**
 * The instance world matrix (Float32Array, column-major for the backends).
 * @param {number} yawDeg
 * @param {ArrayLike<number>} pos  [x, up, z]
 * @param {ArrayLike<number>} [ipRow]  the model's InitialPlacement (row-vector)
 * @param {number} [heightOffset]
 */
export function gr2BuildWorld(yawDeg, pos, ipRow, heightOffset = 0) {
	return new Float32Array(gr2MulRow(ipRow || GR2_IDENTITY_ROW, gr2WorldCore(yawDeg, pos, heightOffset)));
}

/**
 * R-GR2-004 world of an instance at entity position `[cellX, cellY, cellHeight]` facing
 * `dir` (0..7). Entity height is a negated terrain height, so world up = −position[2].
 * @param {number} dir
 * @param {ArrayLike<number>} position
 * @param {{ipRow?: ArrayLike<number>, groundOffset?: number}} model
 */
export function gr2InstanceWorld(dir, position, model) {
	return gr2BuildWorld(gr2Yaw(dir), [position[0], -position[2], position[1]], model.ipRow, model.groundOffset);
}

/**
 * The height offset that puts the model's base (its world-Y maximum vertex: the camera
 * inverts Y) on the terrain, computed in the model's InitialPlacement frame.
 * @param {ReadonlyArray<{bind: ArrayLike<number>, vcount: number}>} meshes
 * @param {ArrayLike<number>} [ipRow]
 */
export function gr2GroundOffset(meshes, ipRow) {
	const m = gr2BuildWorld(0, [0, 0, 0], ipRow);
	let max = -Infinity;
	for (const { bind, vcount } of meshes) {
		for (let i = 0; i < vcount; i++) {
			const y = m[1] * bind[i * 3] + m[5] * bind[i * 3 + 1] + m[9] * bind[i * 3 + 2];
			if (y > max) {
				max = y;
			}
		}
	}
	return max === -Infinity ? 0 : -max;
}

/**
 * R-GR2-001 roster: the models drawn in 3D and their lighting profile.
 * 'flag' → diffuse 100/255, ambient = Rec.601 grey of the map ambient; 'emp' → diffuse
 * 128/255, ambient 127/255. Anything else renders with the plain map light.
 */
export const GR2_ROSTER = Object.freeze({
	guildflag90_1: 'flag',
	empelium90_0: 'emp',
	kguardian90_7: 'emp',
	aguardian90_8: 'emp',
	sguardian90_9: 'emp',
	treasurebox_2: 'emp'
});

/**
 * Lowercased .gr2 basename (no directory, no extension): the roster key.
 * @param {string} path
 */
export function gr2Basename(path) {
	const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
	const dot = path.lastIndexOf('.');
	return path.slice(cut + 1, dot > cut ? dot : path.length).toLowerCase();
}

/**
 * R-GR2-001: whether a path is drawn in 3D (unlisted models fall back to a Poring sprite).
 * @param {string} path
 */
export const gr2IsSupported = path => GR2_ROSTER[gr2Basename(path)] !== undefined;

const FLAG_DIFFUSE = new Float32Array(3).fill(100 / 255);
const EMP_DIFFUSE = new Float32Array(3).fill(128 / 255);
const EMP_AMBIENT = new Float32Array(3).fill(127 / 255);

/**
 * R-GR2-001 per-instance light uniforms (Float32, grey broadcast R = G = B), as legacy
 * uploads them. A map light without ambient / diffuse falls back to the Phase-0 greys.
 * @param {string} path
 * @param {{ambient?: ArrayLike<number>, diffuse?: ArrayLike<number>}} light
 * @returns {{diffuse: ArrayLike<number>, ambient: ArrayLike<number>}}
 */
export function gr2LightFor(path, light) {
	const profile = GR2_ROSTER[gr2Basename(path)];
	if (profile === 'flag') {
		const a = light.ambient || EMP_AMBIENT;
		const grey = 0.299 * a[0] + 0.587 * a[1] + 0.114 * a[2];
		return { diffuse: FLAG_DIFFUSE, ambient: new Float32Array(3).fill(grey) };
	}
	if (profile === 'emp') {
		return { diffuse: EMP_DIFFUSE, ambient: EMP_AMBIENT };
	}
	return { diffuse: light.diffuse || EMP_DIFFUSE, ambient: light.ambient || EMP_AMBIENT };
}
