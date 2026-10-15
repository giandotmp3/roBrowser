import { GL } from '../../pipeline/glEnums.js';
import { createProgram } from '../../pipeline/glProgram.js';
import { InstanceRing } from '../../batching/InstanceRing.js';
import { SPRITE_TEXTURE_UNITS } from '../../residency/TextureArrayPools.js';
import { POT_CLASSES } from '../../constants.js';
import { identity } from '../../math.js';
import { MESH_PROGRAMS, fragmentSource, textureField, vertexSource } from './programs.js';
import { MESH_EFFECT_PROGRAM, meshWrap } from './meshFamilies.js';

const FRAME_UNIFORMS = Object.freeze([
	'uModelViewMat',
	'uProjectionMat',
	'uFogNear',
	'uFogFar',
	'uFogColor',
	'uRgba[0]'
]);

/** Sampler state per wrap mode (null: the pools' own CLAMP_TO_EDGE + LINEAR). */
const WRAPS = Object.freeze({
	clamp: null,
	repeat: { s: GL.REPEAT, t: GL.REPEAT },
	repeatS: { s: GL.REPEAT, t: GL.CLAMP_TO_EDGE }
});

/**
 * Mesh effect families on WebGL2 (every effect family that is neither the sprite
 * program's 2D/3D nor STR): cylinder, quadhorn, RSM, auras, spheres, tiles, rings,
 * target markers, waterfall and rain puddles. See meshFamilies.js for the grouping
 * into programs and programs.js for each program's geometry and fields.
 *
 * Each program is the legacy shader pair, operation for operation, with the per-draw
 * uniforms turned into per-instance attributes and the TEXTURE_2D sampler into a
 * texture-array layer lookup (residency, rgba8 pools on units 1..5). One `drawRun` is
 * one draw call:
 * - instanced programs: a cached static mesh (or gl_VertexID corners) × the run's
 *   records (`drawArraysInstanced`);
 * - stream programs (per-record geometry: RSM objects, the swirling band, bubble quads,
 *   the magic-target ground plane): the run's vertices, each carrying its record's
 *   fields (`drawArrays`).
 * Order inside a run is the record order, so blending is legacy's draw for draw.
 *
 * Blend, depth test and depth write are record state, applied per run by GLStateCache.
 * A legacy texture that wraps (REPEAT) is drawn with a REPEAT sampler object bound to
 * the pool units for the run (the wrap is part of the batch key).
 */
export class MeshEffectPipeline {
	/**
	 * @param {{gl: WebGL2RenderingContext, pools?: {bind?(only?: 'indexed'|'rgba'): void}, ring?: InstanceRing}} deps
	 */
	constructor({ gl, pools, ring }) {
		this.gl = gl;
		this.pools = pools;
		this.ring = ring ?? new InstanceRing({ gl });
		/** @type {Map<string, {program: WebGLProgram, vao: WebGLVertexArrayObject, uniform: Record<string, WebGLUniformLocation|null>, frame: number}>} */
		this.programs = new Map();
		/** @type {Map<string, WebGLBuffer>} static meshes by key */
		this.meshes = new Map();
		/** @type {Record<string, WebGLSampler>} */
		this.samplers = {};
		this.view = null;
		this._frame = 0;
		this._bound = null;
		this._wrap = 'clamp';
		this._scratch = new Float32Array(4096);
		this._tex = [0, 0, 0, 0];
		this._slot = {};
	}

	/**
	 * @param {{family?: string}} record
	 * @returns {boolean}
	 */
	handles(record) {
		return Boolean(MESH_EFFECT_PROGRAM[/** @type {string} */ (record.family)]);
	}

	/**
	 * Start a mesh pass (RunRenderer: when a run of this pipeline follows another program).
	 * Binds the rgba8 pools on units 1..5; per-program pass uniforms are uploaded on each
	 * program's first run of the pass.
	 * @param {import('../../sprites/SpritePipeline.js').SpriteView} [view]
	 */
	bindFrame(view) {
		this.view = view ?? null;
		this._frame++;
		this._bound = null;
		this.pools?.bind?.('rgba');
	}

	/**
	 * Draw one run (records[start .. start+count), same batch key: same program, wrap and
	 * static mesh). One draw call.
	 * @param {ReadonlyArray<any>} records
	 * @param {number} start
	 * @param {number} count
	 * @param {{slotOf(record: object, out?: object): object}} residency
	 */
	drawRun(records, start, count, residency) {
		const { gl } = this;
		const head = records[start];
		const spec = MESH_PROGRAMS[MESH_EFFECT_PROGRAM[head.family]];
		const entry = this._use(spec);
		this._bindWrap(meshWrap(head));

		const vertexFloats = spec.vertex.reduce((n, [, size]) => n + size, 0);
		const instanceFloats = spec.instance.reduce((n, [, size]) => n + size, 0);
		const stream = spec.mode === 'stream';
		const unitFloats = stream ? vertexFloats + instanceFloats : instanceFloats;
		let units = 0;
		for (let i = start; i < start + count; i++) {
			units += stream ? spec.vertices(records[i]) : (spec.instances?.(records[i]) ?? 1);
		}
		if (units === 0) {
			return;
		}
		const data = this._buffer(units * unitFloats);
		let o = 0;
		for (let i = start; i < start + count; i++) {
			const record = records[i];
			const tex =
				spec.textured === false ? this._tex : textureField(residency.slotOf(record, this._slot), this._tex);
			o = spec.pack(record, tex, data, o, this.view);
		}
		const base = this.ring.write(data.subarray(0, o));
		gl.bindVertexArray(entry.vao);

		if (stream) {
			let offset = 0;
			[...spec.vertex, ...spec.instance].forEach(([, size], location) => {
				gl.vertexAttribPointer(location, size, GL.FLOAT, false, unitFloats * 4, base + offset * 4);
				offset += size;
			});
			gl.drawArrays(spec.primitive, 0, units);
			return;
		}

		const mesh = spec.mesh(head);
		if (spec.vertex.length) {
			gl.bindBuffer(GL.ARRAY_BUFFER, this._mesh(mesh));
			let offset = 0;
			spec.vertex.forEach(([, size], location) => {
				gl.vertexAttribPointer(location, size, GL.FLOAT, false, vertexFloats * 4, offset * 4);
				offset += size;
			});
			gl.bindBuffer(GL.ARRAY_BUFFER, this.ring.buffer);
		}
		let offset = 0;
		spec.instance.forEach(([, size], i) => {
			gl.vertexAttribPointer(
				spec.vertex.length + i,
				size,
				GL.FLOAT,
				false,
				instanceFloats * 4,
				base + offset * 4
			);
			offset += size;
		});
		gl.drawArraysInstanced(spec.primitive, 0, mesh.count, units);
	}

	/** Leave no VAO or sampler object bound for the next program. */
	endFrame() {
		this._bindWrap('clamp');
		this.gl.bindVertexArray(null);
		this._bound = null;
	}

	/** R-CTX-006: every GL object died with the context; rebuild lazily. */
	reset() {
		this.programs.clear();
		this.meshes.clear();
		this.samplers = {};
		this._bound = null;
		this._wrap = 'clamp';
		this.ring.reset();
	}

	/** @param {number} floats */
	_buffer(floats) {
		if (this._scratch.length < floats) {
			this._scratch = new Float32Array(floats * 2);
		}
		return this._scratch;
	}

	/**
	 * Program of a spec: compiled on first use (attributes enabled in its VAO, instance
	 * fields with divisor 1), bound, pass uniforms uploaded once per pass.
	 * @param {import('./programs.js').MeshProgram} spec
	 */
	_use(spec) {
		const { gl } = this;
		let entry = this.programs.get(spec.id);
		if (!entry) {
			const program = createProgram(gl, vertexSource(spec), fragmentSource(spec));
			const uniform = {};
			for (const name of [...FRAME_UNIFORMS, ...(spec.uniforms ?? [])]) {
				uniform[name] = gl.getUniformLocation(program, name);
			}
			const vao = gl.createVertexArray();
			gl.bindVertexArray(vao);
			const instanced = spec.mode === 'instanced';
			[...spec.vertex, ...spec.instance].forEach((_, location) => {
				gl.enableVertexAttribArray(location);
				gl.vertexAttribDivisor(location, instanced && location >= spec.vertex.length ? 1 : 0);
			});
			gl.bindVertexArray(null);
			entry = { program, vao, uniform, frame: -1 };
			this.programs.set(spec.id, entry);
		}
		if (this._bound !== spec.id) {
			gl.useProgram(entry.program);
			this._bound = spec.id;
		}
		if (entry.frame !== this._frame) {
			entry.frame = this._frame;
			const { uniform } = entry;
			const view = this.view;
			const fog = view?.fog;
			gl.uniformMatrix4fv(uniform.uModelViewMat, false, view?.modelView ?? identity());
			gl.uniformMatrix4fv(uniform.uProjectionMat, false, view?.projection ?? identity());
			gl.uniform1f(uniform.uFogNear, fog?.near ?? 0);
			gl.uniform1f(uniform.uFogFar, fog?.far ?? 1);
			gl.uniform3fv(uniform.uFogColor, fog?.color ?? [0, 0, 0]);
			if (spec.textured !== false) {
				gl.uniform1iv(
					uniform['uRgba[0]'],
					POT_CLASSES.map((_, i) => SPRITE_TEXTURE_UNITS.indexed + i)
				);
			}
			spec.frame?.(gl, uniform, view);
		}
		return entry;
	}

	/** @param {{key: string, data: ArrayLike<number>|null}} mesh */
	_mesh(mesh) {
		let buffer = this.meshes.get(mesh.key);
		if (!buffer) {
			const { gl } = this;
			buffer = gl.createBuffer();
			gl.bindBuffer(GL.ARRAY_BUFFER, buffer);
			gl.bufferData(
				GL.ARRAY_BUFFER,
				new Float32Array(/** @type {ArrayLike<number>} */ (mesh.data)),
				GL.STATIC_DRAW
			);
			this.meshes.set(mesh.key, buffer);
		}
		return buffer;
	}

	/**
	 * Bind the wrap mode's sampler object on the pool units (none for clamp).
	 * @param {'clamp'|'repeat'|'repeatS'} wrap
	 */
	_bindWrap(wrap) {
		if (this._wrap === wrap) {
			return;
		}
		const { gl } = this;
		let sampler = null;
		const params = WRAPS[wrap];
		if (params) {
			sampler = this.samplers[wrap];
			if (!sampler) {
				sampler = gl.createSampler();
				gl.samplerParameteri(sampler, GL.TEXTURE_MIN_FILTER, GL.LINEAR);
				gl.samplerParameteri(sampler, GL.TEXTURE_MAG_FILTER, GL.LINEAR);
				gl.samplerParameteri(sampler, GL.TEXTURE_WRAP_S, params.s);
				gl.samplerParameteri(sampler, GL.TEXTURE_WRAP_T, params.t);
				this.samplers[wrap] = sampler;
			}
		}
		POT_CLASSES.forEach((_, i) => gl.bindSampler(SPRITE_TEXTURE_UNITS.indexed + i, sampler));
		this._wrap = wrap;
	}
}
