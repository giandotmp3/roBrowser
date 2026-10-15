import { POT_CLASSES } from '../../constants.js';
import { identity } from '../../math.js';
import { PipelineSet } from '../../pipelines/PipelineSet.js';
import { NORMAL } from '../../pipelines/pipelineKey.js';
import { resolveBlend } from '../../pipelines/blendMap.js';
import { InstanceRing } from '../../sprites/InstanceRing.js';
import { normalMatrix } from './legacyMatrix.js';
import { MESH_EFFECT_PROGRAM, meshWrap } from './meshFamilies.js';
import { MESH_PROGRAMS, RSM_LIGHT, meshFloats, meshShaderSource, meshVertexBuffers, textureField } from './programs.js';

/** GPU usage / stage bits (numeric so Node tests need no WebGPU globals). */
const BUFFER = Object.freeze({ COPY_DST: 0x08, VERTEX: 0x20, UNIFORM: 0x40 });
const STAGE = Object.freeze({ VERTEX: 0x1, FRAGMENT: 0x2 });

/** Pipeline family prefix of the mesh programs (`mesh-<program id>`). */
export const MESH_FAMILY_PREFIX = 'mesh-';

/** Sampler address modes per wrap (LINEAR, one mip level, as legacy's effect textures). */
export const MESH_WRAPS = Object.freeze({
	clamp: { addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' },
	repeat: { addressModeU: 'repeat', addressModeV: 'repeat' },
	repeatS: { addressModeU: 'repeat', addressModeV: 'clamp-to-edge' }
});

/** Bytes of the pass block (shaders/effects/common.wgsl `MeshFrame`). */
export const MESH_FRAME_BYTES = 256;

/**
 * Pack the pass block: model-view, projection, the RSM normal matrix (legacy beforeRender:
 * mat4.toInverseMat3 + mat3.transpose of the model-view; a singular model-view, which a
 * camera never gives, leaves the identity), the RSM family light and the fog near / far /
 * colour (applied per record: each record's `fog` decides, as the legacy shaders' uFogUse).
 * @param {import('../../sprites/SpriteRunRenderer.js').SpriteView} [view]
 * @param {ArrayBuffer} [out]
 * @returns {ArrayBuffer}
 */
export function packMeshFrame(view, out = new ArrayBuffer(MESH_FRAME_BYTES)) {
	const f = new Float32Array(out);
	f.fill(0);
	const modelView = view?.modelView ?? identity();
	f.set(modelView, 0);
	f.set(view?.projection ?? identity(), 16);
	const normal = normalMatrix(modelView) ?? new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
	// mat3x3f columns are 16 bytes apart.
	for (let c = 0; c < 3; c++) {
		f.set(normal.subarray(c * 3, c * 3 + 3), 32 + c * 4);
	}
	f.set(RSM_LIGHT.direction, 44);
	f[47] = RSM_LIGHT.opacity;
	f.set(RSM_LIGHT.ambient, 48);
	f.set(RSM_LIGHT.diffuse, 52);
	const fog = view?.fog;
	f.set(fog?.color ?? [0, 0, 0], 56);
	f[59] = fog?.near ?? 0;
	f[60] = fog?.far ?? 1;
	return out;
}

/**
 * Pipeline spec of a mesh family record (batch head): the program's family and topology,
 * the record's blend pair (resolved: invalid or inexpressible pairs draw normal alpha) and
 * depth state.
 * @param {{family: string, blend: {src: string, dst: string}|null, depthTest: boolean, depthWrite: boolean}} record
 */
export function meshSpec(record) {
	const program = MESH_PROGRAMS[MESH_EFFECT_PROGRAM[record.family]];
	return {
		family: `${MESH_FAMILY_PREFIX}${program.id}`,
		blend: resolveBlend(record.blend),
		depthTest: record.depthTest,
		depthWrite: record.depthWrite,
		topology: program.topology
	};
}

/** Bind group layout entries of the mesh programs' group 0 (common.wgsl). */
export function meshBindGroupLayoutEntries() {
	return [
		{ binding: 0, visibility: STAGE.VERTEX | STAGE.FRAGMENT, buffer: { type: 'uniform' } },
		{ binding: 1, visibility: STAGE.FRAGMENT, sampler: { type: 'filtering' } },
		...POT_CLASSES.map((_, i) => ({
			binding: 2 + i,
			visibility: STAGE.FRAGMENT,
			texture: { sampleType: 'float', viewDimension: '2d-array' }
		}))
	];
}

/**
 * Default census: normal alpha for every program with the depth states the legacy classes
 * use (depth test on, write on or off). Other pairs compile from `warm` or on first use.
 */
export function meshCensus() {
	const specs = [];
	for (const program of Object.values(MESH_PROGRAMS)) {
		for (const depthWrite of [false, true]) {
			specs.push({
				family: `${MESH_FAMILY_PREFIX}${program.id}`,
				blend: NORMAL,
				depthTest: true,
				depthWrite,
				topology: program.topology
			});
		}
	}
	return specs;
}

/**
 * @typedef {Object} MeshDraw  One staged mesh batch
 * @property {string} program   Program id
 * @property {number} offset    Byte offset of its data in the staged ring buffer
 * @property {number} units     Instances (instanced) or vertices (stream); 0 draws nothing
 * @property {{key: string, data: ArrayLike<number>|null, count: number}|null} mesh  Static mesh (instanced)
 */

/**
 * Mesh effect families on WebGPU (every effect family that is neither the sprite
 * program's 2D/3D nor STR): cylinder, quadhorn, RSM, auras, spheres, tiles, rings,
 * target markers, waterfall and rain puddles. Port of gpu-webgl2's MeshEffectPipeline:
 * the same grouping into 15 programs (meshFamilies.js), the same per-record packing
 * (programs.js, byte-identical floats) and the legacy shader pairs operation for
 * operation in WGSL (shaders/effects/*.wgsl, GL clip z remapped at the very end).
 *
 * One batch = one draw call:
 * - instanced programs: a cached static mesh (a GPU buffer per mesh key; the waterfall
 *   strip uses vertex_index corners) × the batch's records (`draw(meshCount, units)`);
 * - stream programs (per-record geometry: RSM objects, the swirling band, bubble quads,
 *   the magic-target ground plane): the batch's vertices, each carrying its record's
 *   fields (`draw(units)`).
 * Order inside a batch is the record order, so blending is legacy's draw for draw.
 *
 * Usage per frame (like StrPipeline): `stage()` packs every mesh batch of the stream into
 * one ring write and writes the pass block; `encodeBatches` then calls `groupFor` (the
 * group of the batch's texture wrap: clamp, repeat or repeat-u sampler over the shared
 * rgba8 pools), `pipelineFor` (blend, depth and topology of the head, per program) and
 * `drawBatch` in stream order. Scene pipelines write RGB only (SCENE_WRITE_MASK).
 */
export class MeshEffectPipeline {
	/**
	 * @param {{device: GPUDevice, residency: import('../../residency/SpriteResidency.js').SpriteResidency,
	 *   pools?: import('../../residency/TextureArrayPools.js').TextureArrayPools, sampleCount?: number,
	 *   depthFormat?: GPUTextureFormat, ring?: InstanceRing}} deps
	 */
	constructor({ device, residency, pools, sampleCount, depthFormat, ring }) {
		this.device = device;
		this.residency = residency;
		this.pools = pools ?? /** @type {any} */ (residency.uploader);
		this.sampleCount = sampleCount;
		this.depthFormat = depthFormat;
		this.ring = ring ?? new InstanceRing({ device });
		/** @type {Map<string, GPUShaderModule>} program id → module */
		this.modules = new Map();
		this.bindGroupLayout = null;
		this.pipelineLayout = null;
		/** @type {PipelineSet|null} */
		this.pipelines = null;
		this.uniforms = null;
		/** @type {Record<string, GPUSampler>} */
		this.samplers = {};
		/** @type {Map<string, GPUBuffer>} static meshes by key */
		this.meshes = new Map();
		this._groups = {};
		this._groupsVersion = -1;
		this._uniformData = new ArrayBuffer(MESH_FRAME_BYTES);
		this._scratch = new Float32Array(4096);
		this._tex = [0, 0, 0, 0];
		this._slot = {};
		this._staged = null;
	}

	/**
	 * @param {{family?: string}} record
	 * @returns {boolean}
	 */
	handles(record) {
		return Boolean(MESH_EFFECT_PROGRAM[/** @type {string} */ (record.family)]);
	}

	/**
	 * Create the GPU objects (one shader module per program) and precompile `census`
	 * (normal-alpha variants awaited).
	 * @param {ReturnType<typeof meshCensus>} [census]
	 */
	async init(census = meshCensus()) {
		const { device } = this;
		for (const program of Object.values(MESH_PROGRAMS)) {
			this.modules.set(
				program.id,
				device.createShaderModule({ label: `mesh ${program.id}.wgsl`, code: meshShaderSource(program) })
			);
		}
		this.bindGroupLayout = device.createBindGroupLayout({
			label: 'mesh group 0',
			entries: meshBindGroupLayoutEntries()
		});
		this.pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [this.bindGroupLayout] });
		this.pipelines = new PipelineSet(
			device,
			family => {
				const program = MESH_PROGRAMS[family.slice(MESH_FAMILY_PREFIX.length)];
				return {
					module: this.modules.get(program.id),
					layout: this.pipelineLayout,
					buffers: /** @type {any} */ (meshVertexBuffers(program)),
					vertexEntry: 'vs_main',
					fragmentEntry: 'fs_main'
				};
			},
			{ sampleCount: this.sampleCount, depthFormat: this.depthFormat }
		);
		this.uniforms = device.createBuffer({
			label: 'mesh-frame',
			size: MESH_FRAME_BYTES,
			usage: BUFFER.UNIFORM | BUFFER.COPY_DST
		});
		for (const [wrap, modes] of Object.entries(MESH_WRAPS)) {
			this.samplers[wrap] = device.createSampler({
				label: `mesh-${wrap}`,
				magFilter: 'linear',
				minFilter: 'linear',
				mipmapFilter: 'nearest',
				...modes
			});
		}
		await this.pipelines.precompile(census);
		return this;
	}

	/**
	 * Group 0 of a wrap mode (rebuilt when a pool texture is created or purged).
	 * @param {'clamp'|'repeat'|'repeatS'} wrap
	 */
	_group(wrap) {
		if (this._groupsVersion !== this.pools.version) {
			this._groups = {};
		}
		let group = this._groups[wrap];
		if (!group) {
			const views = this.pools.views();
			group = this.device.createBindGroup({
				label: `mesh group 0 (${wrap})`,
				layout: this.bindGroupLayout,
				entries: [
					{ binding: 0, resource: { buffer: this.uniforms } },
					{ binding: 1, resource: this.samplers[wrap] },
					...views.rgba.map((resource, i) => ({ binding: 2 + i, resource }))
				]
			});
			// views() may create the palette table or dummies; read the version after it.
			if (this._groupsVersion !== this.pools.version) {
				this._groups = {};
				this._groupsVersion = this.pools.version;
			}
			this._groups[wrap] = group;
		}
		return group;
	}

	/** @param {number} floats */
	_buffer(floats) {
		if (this._scratch.length < floats) {
			this._scratch = new Float32Array(floats * 2);
		}
		return this._scratch;
	}

	/**
	 * Pack the mesh batches of one frame (stream order) into one ring write, and write the
	 * pass block. Records must be resident already (`residency.prepare`).
	 * @param {ReadonlyArray<any>} records
	 * @param {ReadonlyArray<{start: number, count: number}>} batches  Mesh batches only
	 * @param {import('../../sprites/SpriteRunRenderer.js').SpriteView} [view]
	 * @returns {MeshDraw[]} one staged draw per batch
	 */
	stage(records, batches, view) {
		/** @type {MeshDraw[]} */
		const draws = [];
		let total = 0;
		for (const batch of batches) {
			const program = MESH_PROGRAMS[MESH_EFFECT_PROGRAM[records[batch.start].family]];
			let units = 0;
			for (let i = batch.start; i < batch.start + batch.count; i++) {
				units +=
					program.mode === 'stream' ? program.vertices(records[i]) : (program.instances?.(records[i]) ?? 1);
			}
			total += units * meshFloats(program).unit;
			draws.push({ program: program.id, offset: 0, units, mesh: null });
		}
		const data = this._buffer(total);
		let o = 0;
		batches.forEach((batch, b) => {
			const draw = draws[b];
			const program = MESH_PROGRAMS[draw.program];
			draw.offset = o * 4;
			if (program.mode === 'instanced') {
				draw.mesh = program.mesh(records[batch.start]);
			}
			for (let i = batch.start; i < batch.start + batch.count; i++) {
				const record = records[i];
				const tex =
					program.textured === false
						? this._tex
						: textureField(this.residency.slotOf(record, this._slot), this._tex);
				o = program.pack(record, tex, data, o, view);
			}
		});
		this._staged = null;
		if (o > 0) {
			this.ring.beginFrame();
			this._staged = this.ring.write(data.subarray(0, o));
			for (const draw of draws) {
				draw.offset += this._staged.offset;
			}
		}
		if (batches.length) {
			this.device.queue.writeBuffer(this.uniforms, 0, packMeshFrame(view, this._uniformData));
		}
		return draws;
	}

	/** Switch the pass to the mesh programs: vertex buffers are set per batch (`drawBatch`). */
	bind() {}

	/**
	 * Group 0 of a batch: the sampler of its texture wrap.
	 * @param {any} head
	 * @returns {GPUBindGroup}
	 */
	groupFor(head) {
		return this._group(meshWrap(head));
	}

	/**
	 * Pipeline of a batch (normal-alpha fallback while an uncommon pair compiles).
	 * @param {any} head
	 * @returns {{pipeline: GPURenderPipeline|null, fellBack: boolean}}
	 */
	pipelineFor(head) {
		return this.pipelines.get(meshSpec(head));
	}

	/**
	 * Encode one staged batch: its vertex buffers, then one draw.
	 * @param {GPURenderPassEncoder} pass
	 * @param {MeshDraw} draw
	 * @returns {boolean} false when the batch has nothing to draw
	 */
	drawBatch(pass, draw) {
		if (!draw.units || !this._staged) {
			return false;
		}
		const program = MESH_PROGRAMS[draw.program];
		const buffer = this._staged.buffer;
		if (program.mode === 'stream') {
			pass.setVertexBuffer(0, buffer, draw.offset);
			pass.draw(draw.units, 1, 0, 0);
			return true;
		}
		const mesh = /** @type {NonNullable<MeshDraw['mesh']>} */ (draw.mesh);
		let slot = 0;
		if (program.vertex.length) {
			pass.setVertexBuffer(slot++, this._mesh(mesh));
		}
		pass.setVertexBuffer(slot, buffer, draw.offset);
		pass.draw(mesh.count, draw.units, 0, 0);
		return true;
	}

	/**
	 * Static mesh buffer of a key (created and written on first use).
	 * @param {{key: string, data: ArrayLike<number>|null}} mesh
	 */
	_mesh(mesh) {
		let buffer = this.meshes.get(mesh.key);
		if (!buffer) {
			const data = new Float32Array(/** @type {ArrayLike<number>} */ (mesh.data));
			buffer = this.device.createBuffer({
				label: `mesh ${mesh.key}`,
				size: Math.max(4, data.byteLength),
				usage: BUFFER.VERTEX | BUFFER.COPY_DST
			});
			this.device.queue.writeBuffer(buffer, 0, data.buffer, data.byteOffset, data.byteLength);
			this.meshes.set(mesh.key, buffer);
		}
		return buffer;
	}

	/** Device loss: every GPU object died; `init()` again on the new device. */
	reset(device = this.device) {
		this.device = device;
		this.ring = new InstanceRing({ device });
		this.modules.clear();
		this.meshes.clear();
		this.bindGroupLayout = this.pipelineLayout = this.pipelines = null;
		this.uniforms = null;
		this.samplers = {};
		this._groups = {};
		this._groupsVersion = -1;
		this._staged = null;
	}
}
