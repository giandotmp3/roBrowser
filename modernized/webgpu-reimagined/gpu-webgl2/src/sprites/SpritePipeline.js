import { GL } from '../pipeline/glEnums.js';
import { createProgram } from '../pipeline/glProgram.js';
import { SHADERS } from '../shaders/index.js';
import { InstanceRing } from '../batching/InstanceRing.js';
import { SPRITE_INSTANCE_ATTRIBUTES, SPRITE_INSTANCE_STRIDE } from '../batching/instanceLayout.js';
import { SPRITE_TEXTURE_UNITS } from '../residency/TextureArrayPools.js';
import { POT_CLASSES } from '../constants.js';
import { identity, invert } from '../math.js';

/** Legacy SpriteRenderer quad: position (±0.5) + uv, triangle strip. */
const QUAD = new Float32Array([-0.5, +0.5, 0.0, 0.0, +0.5, +0.5, 1.0, 0.0, -0.5, -0.5, 0.0, 1.0, +0.5, -0.5, 1.0, 1.0]);

const UNIFORMS = Object.freeze([
	'uModelView',
	'uViewModel',
	'uProjection',
	'uZoom',
	'uFogUse',
	'uFogNear',
	'uFogFar',
	'uFogColor',
	'uIndexed[0]',
	'uRgba[0]',
	'uPalettes',
	'uIndexedRun'
]);

/**
 * @typedef {Object} SpriteView  Per-frame inputs (legacy SpriteRenderer.bind3DContext)
 * @property {ArrayLike<number>} modelView
 * @property {ArrayLike<number>} projection
 * @property {number} zoom                 Camera.zoom (R-SPR-006)
 * @property {{use: boolean, near: number, far: number, color: ArrayLike<number>}} [fog]  `use` = fog.use && fog.exist
 */

/**
 * The GL program, VAO and streaming instance buffer for sprite runs. One
 * `drawRun` = one `drawArraysInstanced` (4-vertex strip × N instances).
 * GL objects are created on first use, so construction is GL-free.
 */
export class SpritePipeline {
	/**
	 * @param {{gl: WebGL2RenderingContext, pools?: {bind?(): void}, ring?: InstanceRing}} deps
	 */
	constructor({ gl, pools, ring }) {
		this.gl = gl;
		this.pools = pools;
		this.ring = ring ?? new InstanceRing({ gl });
		this.program = null;
		this.vao = null;
		this.quad = null;
		/** @type {Record<string, WebGLUniformLocation|null>} */
		this.uniform = {};
		this._viewModel = new Float32Array(16);
		this._indexedRun = null;
	}

	_ensure() {
		if (this.program) {
			return;
		}
		const { gl } = this;
		this.program = createProgram(gl, SHADERS.spriteVert, SHADERS.spriteFrag);
		for (const name of UNIFORMS) {
			this.uniform[name] = gl.getUniformLocation(this.program, name);
		}

		this.vao = gl.createVertexArray();
		gl.bindVertexArray(this.vao);

		this.quad = gl.createBuffer();
		gl.bindBuffer(GL.ARRAY_BUFFER, this.quad);
		gl.bufferData(GL.ARRAY_BUFFER, QUAD, GL.STATIC_DRAW);
		gl.enableVertexAttribArray(0);
		gl.vertexAttribPointer(0, 2, GL.FLOAT, false, 16, 0);
		gl.enableVertexAttribArray(1);
		gl.vertexAttribPointer(1, 2, GL.FLOAT, false, 16, 8);

		for (const { location } of SPRITE_INSTANCE_ATTRIBUTES) {
			gl.enableVertexAttribArray(location);
			gl.vertexAttribDivisor(location, 1);
		}
		gl.bindVertexArray(null);
	}

	/**
	 * Bind program, frame uniforms, textures and VAO (legacy bind3DContext).
	 * @param {SpriteView} [view]
	 */
	bindFrame(view) {
		this._ensure();
		const { gl, uniform } = this;
		const modelView = view?.modelView ?? identity();
		const fog = view?.fog;
		gl.useProgram(this.program);
		gl.uniformMatrix4fv(uniform.uProjection, false, view?.projection ?? identity());
		gl.uniformMatrix4fv(uniform.uModelView, false, modelView);
		gl.uniformMatrix4fv(uniform.uViewModel, false, invert(modelView, this._viewModel) ?? identity());
		gl.uniform1f(uniform.uZoom, view?.zoom ?? 1);
		gl.uniform1i(uniform.uFogUse, fog?.use ? 1 : 0);
		gl.uniform1f(uniform.uFogNear, fog?.near ?? 0);
		gl.uniform1f(uniform.uFogFar, fog?.far ?? 1);
		gl.uniform3fv(uniform.uFogColor, fog?.color ?? [0, 0, 0]);
		gl.uniform1i(uniform.uPalettes, SPRITE_TEXTURE_UNITS.palette);
		gl.uniform1iv(
			uniform['uIndexed[0]'],
			POT_CLASSES.map((_, i) => SPRITE_TEXTURE_UNITS.indexed + i)
		);
		gl.uniform1iv(
			uniform['uRgba[0]'],
			POT_CLASSES.map((_, i) => SPRITE_TEXTURE_UNITS.rgba + i)
		);
		this._indexedRun = null;
		this.pools?.bind?.();
		gl.bindVertexArray(this.vao);
	}

	/**
	 * One run = one instanced draw.
	 * @param {Float32Array} instances  Packed with packSpriteInstance
	 * @param {number} count
	 * @param {boolean} indexed  Run texture class (runs never mix classes)
	 */
	drawRun(instances, count, indexed) {
		const { gl } = this;
		const base = this.ring.write(instances);
		for (const { location, size, offset } of SPRITE_INSTANCE_ATTRIBUTES) {
			gl.vertexAttribPointer(location, size, GL.FLOAT, false, SPRITE_INSTANCE_STRIDE, base + offset);
		}
		if (this._indexedRun !== indexed) {
			gl.uniform1i(this.uniform.uIndexedRun, indexed ? 1 : 0);
			this._indexedRun = indexed;
		}
		gl.drawArraysInstanced(GL.TRIANGLE_STRIP, 0, 4, count);
	}

	/** Leave no VAO bound for the next pass. */
	endFrame() {
		this.gl.bindVertexArray(null);
	}

	/** R-CTX-006: every GL object died with the context; rebuild lazily. */
	reset() {
		this.program = null;
		this.vao = null;
		this.quad = null;
		this.uniform = {};
		this.ring.reset();
	}
}
