import { GL } from '../pipeline/glEnums.js';
import { createProgram } from '../pipeline/glProgram.js';
import { SHADERS } from '../shaders/index.js';
import { GR2_ALPHA_REF, GR2_MAX_BONES } from '../constants.js';
import { multiply } from '../world/glm32.js';
import { gr2LightUniforms } from './gr2.js';

/** Uniform-buffer binding point of the bone palette block (Gr2Bones). */
export const GR2_BONES_BINDING = 3;
/** Floats in one palette (48 mat4). */
const PALETTE_FLOATS = GR2_MAX_BONES * 16;
const PALETTE_BYTES = PALETTE_FLOATS * 4;

const UNIFORMS = Object.freeze([
	'uModelViewMat',
	'uProjectionMat',
	'uNormalMat',
	'uLightDirection',
	'uLightOpacity',
	'uLightAmbient',
	'uLightDiffuse',
	'uLightEnv',
	'uAlphaRef',
	'uAlpha',
	'uFogUse',
	'uFogNear',
	'uFogFar',
	'uFogColor',
	'uDiffuse'
]);

const NORMAL_BLEND = Object.freeze({ src: 'SRC_ALPHA', dst: 'ONE_MINUS_SRC_ALPHA' });
/** R-GR2-002: depth test and write on (depth correction does not apply to this program). */
const GR2_STATE = Object.freeze({ blend: NORMAL_BLEND, depthTest: true, depthWrite: true });
const NO_ENV = new Float32Array([1, 1, 1]);

/**
 * @typedef {Object} Gr2Record  A GR2 instance draw (WorldDraw-shaped, part 'gr2')
 * @property {'world'} kind
 * @property {'gr2'} part
 * @property {number} alpha                 entity alpha (effectColor[3], R-GR2-005); < 1 blends
 * @property {Float32Array} matrices        bone palette: boneCount ≤ 48 column-major mat4 (R-GR2-003)
 * @property {{type: string, world: ArrayLike<number>, emblem?: unknown}} params
 *   type: the .gr2 path (residency key, R-GR2-001 profile); world: the instance world
 *   matrix (column-major, R-GR2-004 facing applied); emblem: the guild emblem handle (R-GR2-006)
 */

/**
 * The GR2 pass (R-CTX-010 step 11, C-14): GPU skinning with a 48-bone palette held in
 * one uniform buffer per frame (each distinct palette uploaded once, then bound per
 * instance with bindBufferRange, so instances sharing a 40 Hz pose share the range),
 * the R-GR2-001 per-model light, the R-GR2-002 hard alpha test and opaque state, the
 * entity alpha (blend only while < 1) and the R-GR2-006 emblem submesh.
 *
 * The per-instance matrices follow legacy GR2ModelRenderer.render exactly (float32
 * view·world, inverse-transpose normal matrix, view-space light direction), so the
 * uniforms are bit-identical. One draw per submesh per instance, in record order.
 */
export class Gr2Pipeline {
	/**
	 * @param {{gl: WebGL2RenderingContext, state: import('../pipeline/GLStateCache.js').GLStateCache, residency: import('./Gr2Residency.js').Gr2Residency}} deps
	 */
	constructor({ gl, state, residency }) {
		this.gl = gl;
		this.state = state;
		this.residency = residency;
		this._mv = new Float32Array(16);
		this._nmat = new Float32Array(9);
		this._lightView = new Float32Array(3);
		this.reset();
	}

	/** Context loss: program and buffer died with the context. */
	reset() {
		this._program = null;
		this._ubo = null;
		this._staging = new Float32Array(0);
		/** Draw calls issued by the last draw() (diagnostics). */
		this.lastDrawCalls = 0;
		/** Distinct palettes uploaded by the last draw(). */
		this.lastPalettes = 0;
	}

	_ensureProgram() {
		if (this._program) {
			return this._program;
		}
		const { gl } = this;
		const program = createProgram(gl, SHADERS.gr2Vert, SHADERS.gr2Frag);
		const u = {};
		for (const name of UNIFORMS) {
			u[name] = gl.getUniformLocation(program, name);
		}
		gl.uniformBlockBinding(program, gl.getUniformBlockIndex(program, 'Gr2Bones'), GR2_BONES_BINDING);
		const align = Number(gl.getParameter(GL.UNIFORM_BUFFER_OFFSET_ALIGNMENT)) || 256;
		this._stride = Math.ceil(PALETTE_BYTES / align) * align;
		this._ubo = gl.createBuffer();
		this._program = { program, u };
		return this._program;
	}

	/**
	 * Draw the GR2 records of one frame.
	 * @param {ReadonlyArray<Gr2Record>} records  in legacy instance order
	 * @param {{modelView: ArrayLike<number>, projection: ArrayLike<number>, fog?: {use: boolean, near: number, far: number, color: ArrayLike<number>}}} view
	 * @param {{direction: ArrayLike<number>, ambient?: ArrayLike<number>, diffuse?: ArrayLike<number>, env?: ArrayLike<number>, opacity?: number}} light  map light
	 */
	draw(records, view, light) {
		this.lastDrawCalls = 0;
		this.lastPalettes = 0;
		const items = [];
		for (const record of records) {
			const type = this.residency.type(record.params.type);
			if (!type || !record.matrices || record.matrices.length > PALETTE_FLOATS) {
				continue;
			}
			items.push({ record, type });
		}
		if (items.length === 0) {
			return;
		}
		const { gl } = this;
		const { program, u } = this._ensureProgram();

		// One upload of every distinct palette (identity = the same 40 Hz pose).
		const offsets = new Map();
		for (const { record } of items) {
			if (!offsets.has(record.matrices)) {
				offsets.set(record.matrices, offsets.size * this._stride);
			}
		}
		const floats = (offsets.size * this._stride) / 4;
		if (this._staging.length < floats) {
			this._staging = new Float32Array(floats);
		}
		for (const [matrices, offset] of offsets) {
			this._staging.set(matrices, offset / 4);
		}
		gl.bindBuffer(GL.UNIFORM_BUFFER, this._ubo);
		gl.bufferData(GL.UNIFORM_BUFFER, this._staging.subarray(0, floats), GL.DYNAMIC_DRAW);
		this.lastPalettes = offsets.size;

		gl.useProgram(program);
		gl.uniformMatrix4fv(u.uProjectionMat, false, view.projection);
		gl.uniform1f(u.uLightOpacity, light.opacity ?? 1);
		gl.uniform3fv(u.uLightEnv, light.env ?? NO_ENV);
		gl.uniform1f(u.uAlphaRef, GR2_ALPHA_REF);
		const fog = view.fog ?? { use: false, near: 0, far: 1, color: [0, 0, 0] };
		gl.uniform1i(u.uFogUse, fog.use ? 1 : 0);
		gl.uniform1f(u.uFogNear, fog.near);
		gl.uniform1f(u.uFogFar, fog.far);
		gl.uniform3fv(u.uFogColor, fog.color);
		gl.activeTexture(GL.TEXTURE0);
		gl.uniform1i(u.uDiffuse, 0);
		gl.uniform3fv(u.uLightDirection, this._viewLight(view.modelView, light.direction));

		// R-GR2-002: opaque (no blend) with depth test and write.
		this.state.apply(GR2_STATE);
		gl.disable(GL.BLEND);

		for (const { record, type } of items) {
			const emblem = type.hasEmblem ? this.residency.emblem(record.params.emblem) : null;
			const mv = multiply(this._mv, view.modelView, record.params.world);
			gl.uniformMatrix4fv(u.uModelViewMat, false, mv);
			gl.uniformMatrix3fv(u.uNormalMat, false, this._normalMatrix(mv));
			gl.bindBufferRange(
				GL.UNIFORM_BUFFER,
				GR2_BONES_BINDING,
				this._ubo,
				offsets.get(record.matrices),
				PALETTE_BYTES
			);
			const { diffuse, ambient } = gr2LightUniforms(record.params.type, light);
			gl.uniform3fv(u.uLightDiffuse, diffuse);
			gl.uniform3fv(u.uLightAmbient, ambient);
			const alpha = Math.min(1, Math.max(0, record.alpha ?? 1));
			gl.uniform1f(u.uAlpha, alpha);
			const fading = alpha < 1;
			if (fading) {
				gl.enable(GL.BLEND);
			}
			for (const sm of type.submeshes) {
				if (sm.emblem) {
					// R-GR2-006: skipped until the emblem has loaded.
					if (!emblem) {
						continue;
					}
					gl.bindTexture(GL.TEXTURE_2D, emblem);
				} else {
					gl.bindTexture(GL.TEXTURE_2D, sm.texture);
				}
				gl.bindVertexArray(sm.vao);
				gl.drawElements(GL.TRIANGLES, sm.count, GL.UNSIGNED_SHORT, 0);
				this.lastDrawCalls++;
			}
			if (fading) {
				gl.disable(GL.BLEND);
			}
		}
		gl.bindVertexArray(null);
		gl.bindBufferBase(GL.UNIFORM_BUFFER, GR2_BONES_BINDING, null);
		gl.bindBuffer(GL.UNIFORM_BUFFER, null);
		gl.enable(GL.BLEND);
	}

	/**
	 * Light direction (world) → view space with the view's upper 3×3, normalised, stored
	 * float32 at the same points as legacy (mat3MulVec3 + normalize3).
	 */
	_viewLight(m, v) {
		const out = this._lightView;
		out[0] = m[0] * v[0] + m[4] * v[1] + m[8] * v[2];
		out[1] = m[1] * v[0] + m[5] * v[1] + m[9] * v[2];
		out[2] = m[2] * v[0] + m[6] * v[1] + m[10] * v[2];
		const len = Math.hypot(out[0], out[1], out[2]) || 1;
		out[0] /= len;
		out[1] /= len;
		out[2] /= len;
		return out;
	}

	/**
	 * Inverse-transpose of the upper 3×3 (gl-matrix mat4.toInverseMat3 then
	 * mat3.transpose, same arithmetic); a singular matrix keeps the previous value.
	 */
	_normalMatrix(mat) {
		const dest = this._nmat;
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
			return dest;
		}
		const id = 1 / d;
		dest[0] = b01 * id;
		dest[1] = (-a22 * a01 + a02 * a21) * id;
		dest[2] = (a12 * a01 - a02 * a11) * id;
		dest[3] = b11 * id;
		dest[4] = (a22 * a00 - a02 * a20) * id;
		dest[5] = (-a12 * a00 + a02 * a10) * id;
		dest[6] = b21 * id;
		dest[7] = (-a21 * a00 + a01 * a20) * id;
		dest[8] = (a11 * a00 - a01 * a10) * id;
		// transpose in place (gl-matrix mat3.transpose, out === a)
		const t01 = dest[1];
		const t02 = dest[2];
		const t12 = dest[5];
		dest[1] = dest[3];
		dest[2] = dest[6];
		dest[3] = t01;
		dest[5] = dest[7];
		dest[6] = t02;
		dest[7] = t12;
		return dest;
	}
}
