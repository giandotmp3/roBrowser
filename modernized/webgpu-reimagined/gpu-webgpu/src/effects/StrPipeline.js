import { POT_CLASSES } from '../constants.js';
import { PipelineSet } from '../pipelines/PipelineSet.js';
import { resolveBlend } from '../pipelines/blendMap.js';
import { SHADERS } from '../shaders/index.js';
import { InstanceRing } from '../sprites/InstanceRing.js';
import { FRAME_UNIFORM_BYTES, packFrameUniforms } from '../sprites/SpriteRunRenderer.js';
import { STR_INSTANCE_FLOATS, STR_VERTEX_BUFFERS, packStrInstance } from './strInstance.js';

/** Pipeline family of STR layers. */
export const STR_FAMILY = 'str';

/** GPU usage / stage bits (numeric so Node tests need no WebGPU globals). */
const BUFFER = Object.freeze({ COPY_DST: 0x08, UNIFORM: 0x40 });
const STAGE = Object.freeze({ VERTEX: 0x1, FRAGMENT: 0x2 });

/**
 * Pipeline spec of an STR record (batch head): the record's blend pair (resolved:
 * invalid or WebGPU-inexpressible pairs draw normal alpha) and depth state
 * (R-EFX-008: depth write off for every STR record, record state).
 * @param {{blend: {src: string, dst: string}|null, depthTest: boolean, depthWrite: boolean}} record
 */
export function strSpec(record) {
	return {
		family: STR_FAMILY,
		blend: resolveBlend(record.blend),
		depthTest: record.depthTest,
		depthWrite: record.depthWrite,
		topology: 'triangle-strip'
	};
}

/** Bind group layout entries of `str.wgsl` group 0: frame block, LINEAR sampler, the 5 rgba8 pools. */
export function strBindGroupLayoutEntries() {
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
 * The WebGPU pipelines, bind group and streaming instance buffer for STR layer
 * batches (R-EFX-008/009/010). One batch = one `draw(4, count, 0, first)`
 * (4-vertex strip × N instances, no per-vertex buffer). Textures are rgba8
 * texture-array layers of the shared residency pools (the same pools as sprites).
 *
 * Usage per frame: `stage()` packs every STR batch of the stream and writes the
 * instance data and frame uniforms (queue writes, before the pass is submitted);
 * then `encodeBatches` (batching/encodeBatches.js) binds the program when the pass
 * switches to it and draws each batch in stream order, interleaved with the
 * sprite batches (RunRenderer).
 */
export class StrPipeline {
	/**
	 * @param {{device: GPUDevice, residency: import('../residency/SpriteResidency.js').SpriteResidency,
	 *   pools?: import('../residency/TextureArrayPools.js').TextureArrayPools, sampleCount?: number, ring?: InstanceRing}} deps
	 */
	constructor({ device, residency, pools, sampleCount, ring }) {
		this.device = device;
		this.residency = residency;
		this.pools = pools ?? /** @type {any} */ (residency.uploader);
		this.sampleCount = sampleCount;
		this.ring = ring ?? new InstanceRing({ device });
		this.module = null;
		this.bindGroupLayout = null;
		this.pipelineLayout = null;
		/** @type {PipelineSet|null} */
		this.pipelines = null;
		this.uniforms = null;
		this.sampler = null;
		this._bindGroup = null;
		this._bindGroupVersion = -1;
		this._uniformData = new ArrayBuffer(FRAME_UNIFORM_BYTES);
		this._instances = new Float32Array(STR_INSTANCE_FLOATS * 256);
		this._slot = {};
		this._staged = null;
	}

	/**
	 * Create the GPU objects and precompile `census` (STR pipeline specs; normal-alpha
	 * variants are awaited, the rest compile in the background).
	 * @param {ReturnType<typeof strSpec>[]} [census]
	 */
	async init(census = [strSpec({ blend: null, depthTest: true, depthWrite: false })]) {
		const { device } = this;
		this.module = device.createShaderModule({ label: 'str.wgsl', code: SHADERS.str });
		this.bindGroupLayout = device.createBindGroupLayout({
			label: 'str group 0',
			entries: strBindGroupLayoutEntries()
		});
		this.pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [this.bindGroupLayout] });
		this.pipelines = new PipelineSet(
			device,
			() => ({
				module: this.module,
				layout: this.pipelineLayout,
				buffers: /** @type {any} */ (STR_VERTEX_BUFFERS),
				vertexEntry: 'vs_main',
				fragmentEntry: 'fs_main'
			}),
			this.sampleCount === undefined ? undefined : { sampleCount: this.sampleCount }
		);
		this.uniforms = device.createBuffer({
			label: 'str-frame',
			size: FRAME_UNIFORM_BYTES,
			usage: BUFFER.UNIFORM | BUFFER.COPY_DST
		});
		// Legacy WebGL.texture: LINEAR, CLAMP_TO_EDGE, no mipmaps.
		this.sampler = device.createSampler({
			label: 'str-linear',
			magFilter: 'linear',
			minFilter: 'linear',
			mipmapFilter: 'nearest',
			addressModeU: 'clamp-to-edge',
			addressModeV: 'clamp-to-edge'
		});
		await this.pipelines.precompile(census);
		return this;
	}

	/** Group 0, rebuilt when a pool texture is created or purged. */
	_group() {
		if (this._bindGroup && this._bindGroupVersion === this.pools.version) {
			return this._bindGroup;
		}
		const views = this.pools.views();
		this._bindGroup = this.device.createBindGroup({
			label: 'str group 0',
			layout: this.bindGroupLayout,
			entries: [
				{ binding: 0, resource: { buffer: this.uniforms } },
				{ binding: 1, resource: this.sampler },
				...views.rgba.map((resource, i) => ({ binding: 2 + i, resource }))
			]
		});
		// views() may create the palette table or dummies; read the version after it.
		this._bindGroupVersion = this.pools.version;
		return this._bindGroup;
	}

	/**
	 * Pack the STR batches of one frame (stream order) and write them with the frame
	 * uniforms (R-EFX-010 fix: the scene fog of the pass, applied per instance only when
	 * its record asks). Records must be resident already (`residency.prepare`).
	 * @param {ReadonlyArray<any>} records
	 * @param {ReadonlyArray<{start: number, count: number}>} batches  STR batches only
	 * @param {import('../sprites/SpriteRunRenderer.js').SpriteView} [view]
	 * @returns {number[]} first instance of each batch
	 */
	stage(records, batches, view) {
		const total = batches.reduce((n, batch) => n + batch.count, 0);
		if (this._instances.length < total * STR_INSTANCE_FLOATS) {
			this._instances = new Float32Array(total * STR_INSTANCE_FLOATS * 2);
		}
		const firsts = [];
		let offset = 0;
		let first = 0;
		for (const batch of batches) {
			firsts.push(first);
			for (let i = batch.start; i < batch.start + batch.count; i++) {
				offset = packStrInstance(
					records[i],
					this.residency.slotOf(records[i], this._slot),
					this._instances,
					offset
				);
			}
			first += batch.count;
		}
		this._staged = null;
		if (total) {
			this.ring.beginFrame();
			this._staged = this.ring.write(this._instances.subarray(0, offset));
			this.device.queue.writeBuffer(this.uniforms, 0, packFrameUniforms(view, this._uniformData));
		}
		return firsts;
	}

	/**
	 * Switch the pass to the STR program: instance buffer (slot 0).
	 * @param {GPURenderPassEncoder} pass
	 */
	bind(pass) {
		pass.setVertexBuffer(0, this._staged.buffer, this._staged.offset);
	}

	/**
	 * Group 0 of a batch (one group for every STR batch).
	 * @returns {GPUBindGroup}
	 */
	groupFor() {
		return this._group();
	}

	/**
	 * Pipeline of a batch (normal-alpha fallback while an uncommon pair compiles).
	 * @param {any} head  Batch head record (blend and depth state)
	 * @returns {{pipeline: GPURenderPipeline|null, fellBack: boolean}}
	 */
	pipelineFor(head) {
		return this.pipelines.get(strSpec(head));
	}

	/** Device loss: every GPU object died; `init()` again on the new device. */
	reset(device = this.device) {
		this.device = device;
		this.ring = new InstanceRing({ device });
		this.module = this.bindGroupLayout = this.pipelineLayout = this.pipelines = null;
		this.uniforms = this.sampler = null;
		this._bindGroup = null;
		this._bindGroupVersion = -1;
		this._staged = null;
	}
}
