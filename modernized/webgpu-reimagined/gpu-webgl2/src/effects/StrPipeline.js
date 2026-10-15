import { GL } from '../pipeline/glEnums.js';
import { createProgram } from '../pipeline/glProgram.js';
import { SHADERS } from '../shaders/index.js';
import { InstanceRing } from '../batching/InstanceRing.js';
import { STR_INSTANCE_ATTRIBUTES, STR_INSTANCE_STRIDE } from './strInstance.js';
import { SPRITE_TEXTURE_UNITS } from '../residency/TextureArrayPools.js';
import { POT_CLASSES } from '../constants.js';
import { identity } from '../math.js';

const UNIFORMS = Object.freeze([
	'uModelView',
	'uProjection',
	'uFogUse',
	'uFogNear',
	'uFogFar',
	'uFogColor',
	'uRgba[0]'
]);

/**
 * The GL program, VAO and streaming instance buffer for STR layer runs
 * (R-EFX-008/009/010). One `drawRun` = one `drawArraysInstanced` (4-vertex strip
 * × N instances, no per-vertex buffer). Textures are rgba8 texture-array layers:
 * the run binds only the rgba8 class pools, on the units 1..5 (6 units with the
 * palette table), so it works on every WebGL2 context.
 *
 * Depth write is off for every STR record (R-EFX-008): it is record state,
 * applied by GLStateCache like every run's. GL objects are created on first use.
 */
export class StrPipeline {
	/**
	 * @param {{gl: WebGL2RenderingContext, pools?: {bind?(only?: 'indexed'|'rgba'): void}, ring?: InstanceRing}} deps
	 */
	constructor({ gl, pools, ring }) {
		this.gl = gl;
		this.pools = pools;
		this.ring = ring ?? new InstanceRing({ gl });
		this.program = null;
		this.vao = null;
		/** @type {Record<string, WebGLUniformLocation|null>} */
		this.uniform = {};
	}

	_ensure() {
		if (this.program) {
			return;
		}
		const { gl } = this;
		this.program = createProgram(gl, SHADERS.strVert, SHADERS.strFrag);
		for (const name of UNIFORMS) {
			this.uniform[name] = gl.getUniformLocation(this.program, name);
		}
		this.vao = gl.createVertexArray();
		gl.bindVertexArray(this.vao);
		for (const { location } of STR_INSTANCE_ATTRIBUTES) {
			gl.enableVertexAttribArray(location);
			gl.vertexAttribDivisor(location, 1);
		}
		gl.bindVertexArray(null);
	}

	/**
	 * Bind program, frame uniforms, the rgba8 pools and the VAO (legacy StrEffect.beforeRender).
	 * R-EFX-010 fix: fog uses the scene fog of the pass (the shared include, same near/far as
	 * sprites); each instance applies it only when its record asks (record.fog).
	 * @param {import('../sprites/SpritePipeline.js').SpriteView} [view]
	 */
	bindFrame(view) {
		this._ensure();
		const { gl, uniform } = this;
		const fog = view?.fog;
		gl.useProgram(this.program);
		gl.uniformMatrix4fv(uniform.uProjection, false, view?.projection ?? identity());
		gl.uniformMatrix4fv(uniform.uModelView, false, view?.modelView ?? identity());
		gl.uniform1i(uniform.uFogUse, fog?.use ? 1 : 0);
		gl.uniform1f(uniform.uFogNear, fog?.near ?? 0);
		gl.uniform1f(uniform.uFogFar, fog?.far ?? 1);
		gl.uniform3fv(uniform.uFogColor, fog?.color ?? [0, 0, 0]);
		gl.uniform1iv(
			uniform['uRgba[0]'],
			POT_CLASSES.map((_, i) => SPRITE_TEXTURE_UNITS.indexed + i)
		);
		// Split binding: the rgba8 pools on units 1..5.
		this.pools?.bind?.('rgba');
		gl.bindVertexArray(this.vao);
	}

	/**
	 * One run = one instanced draw.
	 * @param {Float32Array} instances  Packed with packStrInstance
	 * @param {number} count
	 */
	drawRun(instances, count) {
		const { gl } = this;
		const base = this.ring.write(instances);
		for (const { location, size, offset } of STR_INSTANCE_ATTRIBUTES) {
			gl.vertexAttribPointer(location, size, GL.FLOAT, false, STR_INSTANCE_STRIDE, base + offset);
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
		this.uniform = {};
		this.ring.reset();
	}
}
