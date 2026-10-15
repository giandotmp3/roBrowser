import { POT_CLASSES, ZINDEX_BIAS } from '../constants.js';
import { NotImplementedError } from '../errors.js';
import { identity, invert } from '../math.js';
import { PipelineSet } from '../pipelines/PipelineSet.js';
import { ADDITIVE, NORMAL } from '../pipelines/pipelineKey.js';
import { SHADERS } from '../shaders/index.js';
import { InstanceRing } from './InstanceRing.js';
import { SPRITE_INSTANCE_FLOATS, SPRITE_QUAD, SPRITE_VERTEX_BUFFERS, packSpriteInstance } from './instanceLayout.js';
import { splitRuns } from './runs.js';

export { SPRITE_INSTANCE_FLOATS };

/**
 * R-SPR-006 (shader side, reference of shaders/sprite.wgsl):
 * clip.z −= (zIndex·0.01 + depthBias) / max(zoom, 1).
 * @returns {number} the amount subtracted from clip z
 */
export function zIndexBias(zIndex, depthBias, zoom) {
	return (zIndex * ZINDEX_BIAS + depthBias) / Math.max(zoom, 1);
}

/**
 * R-SPR-005 CPU reference (the shader implements it; see sprite.wgsl vs_main and
 * the gpu-webgpu parity harness). Not yet mirrored on the CPU.
 */
export function depthCorrectedClipZ(_vertexWorld, _spriteCentre, _camera, _ignoreDepthMinCap) {
	throw new NotImplementedError('depthCorrectedClipZ CPU reference (R-SPR-005; shader side implemented)');
}

/**
 * R-SPR-014 CPU reference (the shader implements it; see sprite.wgsl sample_indexed).
 * Not yet mirrored on the CPU.
 */
export function samplePaletteBilinear(_indexImage, _paletteRow, _u, _v) {
	throw new NotImplementedError('samplePaletteBilinear CPU reference (R-SPR-014; shader side implemented)');
}

/** Pipeline families: runs never mix texture classes, so the class picks the fragment entry point. */
export const SPRITE_FAMILIES = Object.freeze({ indexed: 'sprite:indexed', rgba: 'sprite:rgba' });

const FRAGMENT_ENTRY = Object.freeze({ [SPRITE_FAMILIES.indexed]: 'fs_indexed', [SPRITE_FAMILIES.rgba]: 'fs_rgba' });

const DEPTH_STATES = Object.freeze([
	{ depthTest: true, depthWrite: true },
	{ depthTest: true, depthWrite: false },
	{ depthTest: false, depthWrite: true },
	{ depthTest: false, depthWrite: false }
]);

/**
 * Pipeline spec of a sprite record (run head).
 * @param {{textureClass?: string, blend: {src: string, dst: string}, depthTest: boolean, depthWrite: boolean}} record
 */
export function spriteSpec(record) {
	return {
		family: record.textureClass === 'rgba' ? SPRITE_FAMILIES.rgba : SPRITE_FAMILIES.indexed,
		blend: record.blend,
		depthTest: record.depthTest,
		depthWrite: record.depthWrite,
		topology: 'triangle-strip'
	};
}

/**
 * Sprite blend/depth census (architecture §2.2 "Pipelines"): SpriteDraw blends are
 * normal alpha or additive (R-SPR-023), with any depth test/write combination.
 * @param {ReadonlyArray<{src: string, dst: string}>} [blends]
 */
export function spriteCensus(blends = [NORMAL, ADDITIVE]) {
	const specs = [];
	for (const family of Object.values(SPRITE_FAMILIES)) {
		for (const blend of blends) {
			for (const depth of DEPTH_STATES) {
				specs.push(spriteSpec({ textureClass: family.split(':')[1], blend, ...depth }));
			}
		}
	}
	return specs;
}

/** Frame uniform block (WGSL `Frame`): 3 mat4, zoom, Fog{vec3 color, u32 use, near, far}. */
export const FRAME_UNIFORM_FLOATS = 60;
export const FRAME_UNIFORM_BYTES = FRAME_UNIFORM_FLOATS * 4;

/**
 * @typedef {Object} SpriteView  Per-frame inputs (legacy SpriteRenderer.bind3DContext)
 * @property {ArrayLike<number>} modelView
 * @property {ArrayLike<number>} projection
 * @property {number} zoom                 Camera.zoom (R-SPR-006)
 * @property {{use: boolean, near: number, far: number, color: ArrayLike<number>}} [fog]  `use` = fog.use && fog.exist
 */

/**
 * @param {SpriteView} [view]
 * @param {ArrayBuffer} [out]
 * @returns {ArrayBuffer}
 */
export function packFrameUniforms(view, out = new ArrayBuffer(FRAME_UNIFORM_BYTES)) {
	const f = new Float32Array(out);
	const u = new Uint32Array(out);
	const modelView = view?.modelView ?? identity();
	f.set(modelView, 0);
	f.set(invert(modelView) ?? identity(), 16);
	f.set(view?.projection ?? identity(), 32);
	f[48] = view?.zoom ?? 1;
	const fog = view?.fog;
	f.set(fog?.color ?? [0, 0, 0], 52);
	u[55] = fog?.use ? 1 : 0;
	f[56] = fog?.near ?? 0;
	f[57] = fog?.far ?? 1;
	return out;
}

/** GPU usage / stage bits (numeric so Node tests need no WebGPU globals). */
const BUFFER = Object.freeze({ COPY_DST: 0x08, VERTEX: 0x20, UNIFORM: 0x40 });
const STAGE = Object.freeze({ VERTEX: 0x1, FRAGMENT: 0x2 });

/** Bind group layout entries of `sprite.wgsl` group 0. */
export function spriteBindGroupLayoutEntries() {
	const texture = (binding, viewDimension) => ({
		binding,
		visibility: STAGE.FRAGMENT,
		texture: { sampleType: 'float', viewDimension }
	});
	return [
		{ binding: 0, visibility: STAGE.VERTEX | STAGE.FRAGMENT, buffer: { type: 'uniform' } },
		{ binding: 1, visibility: STAGE.FRAGMENT, sampler: { type: 'filtering' } },
		texture(2, '2d'),
		...POT_CLASSES.map((_, i) => texture(3 + i, '2d-array')),
		...POT_CLASSES.map((_, i) => texture(3 + POT_CLASSES.length + i, '2d-array'))
	];
}

/**
 * Draws SpriteDraw runs (contiguous, legacy order) as instanced quads: one
 * pipeline switch (when the state changes) and one `draw(4, count, 0, first)`
 * per run, all instances of the frame in one instance-step vertex buffer write.
 */
export class SpriteRunRenderer {
	/**
	 * @param {{
	 *   device: GPUDevice,
	 *   residency: import('../residency/SpriteResidency.js').SpriteResidency,
	 *   pools?: import('../residency/TextureArrayPools.js').TextureArrayPools,
	 *   sampleCount?: number,
	 *   ring?: InstanceRing
	 * }} deps
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
		this.quad = null;
		this.uniforms = null;
		this.sampler = null;
		this._bindGroup = null;
		this._bindGroupVersion = -1;
		this._uniformData = new ArrayBuffer(FRAME_UNIFORM_BYTES);
		this._instances = new Float32Array(SPRITE_INSTANCE_FLOATS * 256);
		this._slot = {};
		/** Draw calls issued by the last `encode()` (draw count is measured, §5 phase 3). */
		this.lastDrawCalls = 0;
		/** Runs of the last `encode()`, for diagnostics. */
		this.lastRuns = [];
		/** Runs drawn with the normal-alpha fallback pipeline in the last `encode()`. */
		this.lastFallbacks = 0;
	}

	/**
	 * Create the GPU objects and precompile the sprite census (normal-alpha
	 * variants are awaited, the rest compile in the background).
	 * @param {ReturnType<typeof spriteCensus>} [census]
	 */
	async init(census = spriteCensus()) {
		const { device } = this;
		this.module = device.createShaderModule({ label: 'sprite.wgsl', code: SHADERS.sprite });
		this.bindGroupLayout = device.createBindGroupLayout({
			label: 'sprite group 0',
			entries: spriteBindGroupLayoutEntries()
		});
		this.pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [this.bindGroupLayout] });
		this.pipelines = new PipelineSet(
			device,
			family => ({
				module: this.module,
				layout: this.pipelineLayout,
				buffers: /** @type {any} */ (SPRITE_VERTEX_BUFFERS),
				vertexEntry: 'vs_main',
				fragmentEntry: FRAGMENT_ENTRY[family]
			}),
			this.sampleCount === undefined ? undefined : { sampleCount: this.sampleCount }
		);
		this.quad = device.createBuffer({
			label: 'sprite-quad',
			size: SPRITE_QUAD.length * 4,
			usage: BUFFER.VERTEX | BUFFER.COPY_DST
		});
		device.queue.writeBuffer(this.quad, 0, new Float32Array(SPRITE_QUAD));
		this.uniforms = device.createBuffer({
			label: 'sprite-frame',
			size: FRAME_UNIFORM_BYTES,
			usage: BUFFER.UNIFORM | BUFFER.COPY_DST
		});
		// R-SPR-014: RGBA frames filter LINEAR (pixelPerfect → per-instance textureLoad instead);
		// indexed frames and palettes are read with textureLoad (NEAREST).
		this.sampler = device.createSampler({
			label: 'sprite-linear',
			magFilter: 'linear',
			minFilter: 'linear',
			mipmapFilter: 'nearest',
			addressModeU: 'clamp-to-edge',
			addressModeV: 'clamp-to-edge'
		});
		await this.pipelines.precompile(census);
		return this;
	}

	_bindGroupFor() {
		const version = this.pools.version;
		if (!this._bindGroup || this._bindGroupVersion !== version) {
			const views = this.pools.views();
			const resources = [
				{ binding: 0, resource: { buffer: this.uniforms } },
				{ binding: 1, resource: this.sampler },
				{ binding: 2, resource: views.palette },
				...views.indexed.map((resource, i) => ({ binding: 3 + i, resource })),
				...views.rgba.map((resource, i) => ({ binding: 3 + POT_CLASSES.length + i, resource }))
			];
			this._bindGroup = this.device.createBindGroup({
				label: 'sprite group 0',
				layout: this.bindGroupLayout,
				entries: resources
			});
			// views() may create the palette table or dummies; read the version after it.
			this._bindGroupVersion = this.pools.version;
		}
		return this._bindGroup;
	}

	/**
	 * Encode every sprite run of `records` into `pass`. Writes the frame uniforms
	 * and instance data with queue writes, so call once per submitted frame.
	 * Non-sprite runs are skipped (their family renderers are not wired here).
	 * @param {GPURenderPassEncoder} pass
	 * @param {ReadonlyArray<any>} records  Legacy order
	 * @param {SpriteView} [view]
	 * @returns {{drawCalls: number, runs: number, fallbacks: number}}
	 */
	encode(pass, records, view) {
		this.lastDrawCalls = 0;
		this.lastFallbacks = 0;
		this.lastRuns = splitRuns(records).filter(run => records[run.start].kind === 'sprite');
		if (!this.lastRuns.length) {
			return { drawCalls: 0, runs: 0, fallbacks: 0 };
		}

		// Pack all sprite instances of the frame, in run order, then one queue write.
		const total = this.lastRuns.reduce((n, run) => n + run.count, 0);
		if (this._instances.length < total * SPRITE_INSTANCE_FLOATS) {
			this._instances = new Float32Array(total * SPRITE_INSTANCE_FLOATS * 2);
		}
		let offset = 0;
		for (const run of this.lastRuns) {
			for (let i = run.start; i < run.start + run.count; i++) {
				offset = packSpriteInstance(
					records[i],
					this.residency.slotOf(records[i], this._slot),
					this._instances,
					offset
				);
			}
		}
		this.ring.beginFrame();
		const at = this.ring.write(this._instances.subarray(0, offset));
		this.device.queue.writeBuffer(this.uniforms, 0, packFrameUniforms(view, this._uniformData));

		pass.setBindGroup(0, this._bindGroupFor());
		pass.setVertexBuffer(0, this.quad);
		pass.setVertexBuffer(1, at.buffer, at.offset);
		let first = 0;
		let current = null;
		for (const run of this.lastRuns) {
			const { pipeline, fellBack } = this.pipelines.get(spriteSpec(records[run.start]));
			if (pipeline) {
				if (pipeline !== current) {
					pass.setPipeline(pipeline);
					current = pipeline;
				}
				pass.draw(4, run.count, 0, first);
				this.lastDrawCalls++;
				if (fellBack) {
					this.lastFallbacks++;
				}
			}
			first += run.count;
		}
		return { drawCalls: this.lastDrawCalls, runs: this.lastRuns.length, fallbacks: this.lastFallbacks };
	}

	/** Device loss: every GPU object died; `init()` again on the new device. */
	reset(device = this.device) {
		this.device = device;
		this.ring = new InstanceRing({ device });
		this.module = this.bindGroupLayout = this.pipelineLayout = this.pipelines = null;
		this.quad = this.uniforms = this.sampler = this._bindGroup = null;
		this._bindGroupVersion = -1;
	}
}
