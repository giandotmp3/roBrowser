import { RENDER_FORMAT } from '../constants.js';
import { SHADERS } from '../shaders/index.js';
import { POST_MAX_PASSES, POST_PIPELINES, POST_UNIFORM_BYTES, POST_UNIFORM_STRIDE } from './postPasses.js';

/** GPUShaderStage / GPUTextureUsage / GPUBufferUsage bits. */
const STAGE_FRAGMENT = 0x2;
const TEXTURE_BINDING = 0x04;
const RENDER_ATTACHMENT = 0x10;
const BUFFER_UNIFORM = 0x40;
const BUFFER_COPY_DST = 0x08;

/** Every intermediate the chain owns (R-PP-002: legacy RGB8; alpha is never displayed). */
const OWNED_TARGETS = ['pingA', 'pingB', 'bloom'];
const MAX_CACHED_GROUPS = 64;

/**
 * C-11 post chain on WebGPU: executes a `buildPostPasses` graph.
 *
 * - One bind group layout for every pass: 0 linear clamp-to-edge sampler (legacy FBO textures: LINEAR,
 *   CLAMP_TO_EDGE), 1 input, 2 the pass's 32-byte uniform block, 3 a second texture (bloom composite).
 * - Two pipelines per pass: one writing `rgba8unorm` (ping-pong / bloom targets) and one writing the canvas
 *   format (the last active module writes the swapchain), all compiled up front with createRenderPipelineAsync.
 * - Targets: 'pingA'/'pingB' at the scene size and 'bloom' at the bloom size, recreated when the graph's
 *   sizes change (resize, performance mode). The scene texture is the caller's (OffscreenTarget.resolve).
 * - Uniform blocks go through `queue.writeBuffer` at slot · 256; one graph per queue submit.
 */
export class PostChain {
	/**
	 * @param {{device: GPUDevice, format: GPUTextureFormat}} deps  format: the canvas (swapchain) format
	 */
	constructor({ device, format }) {
		this.device = device;
		this.format = format;
		this.layout = null;
		this.sampler = null;
		this.uniforms = null;
		/** @type {Map<string, GPURenderPipeline>} `${pipeline}|${format}` */
		this.pipelines = new Map();
		/** @type {Record<string, GPUTexture|null>} */
		this.targets = { pingA: null, pingB: null, bloom: null };
		this._sizes = null;
		this._groups = new Map();
		this._ids = new WeakMap();
		this._nextId = 1;
	}

	/** Compiles every pipeline; resolves to `this`. */
	async init() {
		const { device } = this;
		this.layout = device.createBindGroupLayout({
			label: 'post group 0',
			entries: [
				{ binding: 0, visibility: STAGE_FRAGMENT, sampler: { type: 'filtering' } },
				{ binding: 1, visibility: STAGE_FRAGMENT, texture: { sampleType: 'float', viewDimension: '2d' } },
				{
					binding: 2,
					visibility: STAGE_FRAGMENT,
					buffer: { type: 'uniform', minBindingSize: POST_UNIFORM_BYTES }
				},
				{ binding: 3, visibility: STAGE_FRAGMENT, texture: { sampleType: 'float', viewDimension: '2d' } }
			]
		});
		this.sampler = device.createSampler({
			label: 'post-linear-clamp',
			magFilter: 'linear',
			minFilter: 'linear',
			addressModeU: 'clamp-to-edge',
			addressModeV: 'clamp-to-edge'
		});
		this.uniforms = device.createBuffer({
			label: 'post uniforms',
			size: POST_UNIFORM_STRIDE * POST_MAX_PASSES,
			usage: BUFFER_UNIFORM | BUFFER_COPY_DST
		});
		const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [this.layout] });
		const modules = new Map();
		const jobs = [];
		for (const [name, { shader, entryPoint }] of Object.entries(POST_PIPELINES)) {
			if (!modules.has(shader)) {
				modules.set(shader, device.createShaderModule({ label: `post/${shader}`, code: SHADERS[shader] }));
			}
			const module = modules.get(shader);
			// The bloom prefilter only ever writes its internal target.
			const formats = name === 'Bloom.prefilter' ? [RENDER_FORMAT] : [...new Set([RENDER_FORMAT, this.format])];
			for (const format of formats) {
				jobs.push(
					device
						.createRenderPipelineAsync({
							label: `post ${name} → ${format}`,
							layout: pipelineLayout,
							vertex: { module, entryPoint: 'vs_main' },
							fragment: { module, entryPoint, targets: [{ format }] },
							primitive: { topology: 'triangle-list' }
						})
						.then(p => this.pipelines.set(`${name}|${format}`, p))
				);
			}
		}
		await Promise.all(jobs);
		return this;
	}

	/**
	 * (Re)creates the owned targets for the graph's sizes; a no-op when they are unchanged.
	 * @param {{scene: {width: number, height: number}, bloom: {width: number, height: number}}} sizes
	 * @param {{bloom?: boolean}} [need]  create the bloom target (only while Bloom runs)
	 */
	ensureTargets(sizes, { bloom = true } = {}) {
		const same = (a, b) => a && b && a.width === b.width && a.height === b.height;
		if (!same(this._sizes?.scene, sizes.scene) || !same(this._sizes?.bloom, sizes.bloom)) {
			this.destroyTargets();
			this._sizes = { scene: { ...sizes.scene }, bloom: { ...sizes.bloom } };
		}
		const make = (label, { width, height }) =>
			this.device.createTexture({
				label,
				size: { width: Math.max(1, width), height: Math.max(1, height) },
				format: RENDER_FORMAT,
				usage: RENDER_ATTACHMENT | TEXTURE_BINDING
			});
		this.targets.pingA ??= make('post pingA', sizes.scene);
		this.targets.pingB ??= make('post pingB', sizes.scene);
		if (bloom) {
			this.targets.bloom ??= make('post bloom', sizes.bloom);
		}
	}

	/**
	 * Encodes the graph: one render pass per graph pass, full-target viewport, full-screen triangle.
	 * @param {GPUCommandEncoder} encoder
	 * @param {ReturnType<import('./postPasses.js').buildPostPasses>} graph
	 * @param {GPUTexture} sceneTexture  the scene at `graph.sizes.scene` (OffscreenTarget.resolve)
	 * @param {GPUTextureView} swapchainView
	 */
	encode(encoder, graph, sceneTexture, swapchainView) {
		const { passes, sizes } = graph;
		this.ensureTargets(sizes, { bloom: passes.some(p => p.output === 'bloom') });
		const texture = name => (name === 'scene' ? sceneTexture : this.targets[name]);
		for (const p of passes) {
			this.device.queue.writeBuffer(this.uniforms, p.slot * POST_UNIFORM_STRIDE, p.uniforms);
			const toSwapchain = p.output === 'swapchain';
			const pipeline = this.pipelines.get(`${p.pipeline}|${toSwapchain ? this.format : RENDER_FORMAT}`);
			const view = toSwapchain ? swapchainView : texture(p.output).createView();
			const pass = encoder.beginRenderPass({
				label: `post ${p.name}`,
				colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }]
			});
			pass.setPipeline(pipeline);
			pass.setBindGroup(0, this._group(p.slot, texture(p.input), texture(p.input2 ?? p.input)));
			pass.draw(3);
			pass.end();
		}
	}

	/** R-CTX-007: a new device after a loss; every GPU object is recreated. */
	async rebuild(device) {
		this.destroy();
		this.device = device;
		this.pipelines.clear();
		return this.init();
	}

	destroyTargets() {
		for (const name of OWNED_TARGETS) {
			this.targets[name]?.destroy();
			this.targets[name] = null;
		}
		this._sizes = null;
		this._groups.clear();
	}

	destroy() {
		this.destroyTargets();
		this.uniforms?.destroy();
		this.uniforms = null;
	}

	_id(texture) {
		let id = this._ids.get(texture);
		if (!id) {
			id = this._nextId++;
			this._ids.set(texture, id);
		}
		return id;
	}

	_group(slot, input, input2) {
		const key = `${slot}|${this._id(input)}|${this._id(input2)}`;
		let group = this._groups.get(key);
		if (!group) {
			if (this._groups.size >= MAX_CACHED_GROUPS) {
				this._groups.clear(); // caller-owned scene textures come and go
			}
			group = this.device.createBindGroup({
				layout: this.layout,
				entries: [
					{ binding: 0, resource: this.sampler },
					{ binding: 1, resource: input.createView() },
					{
						binding: 2,
						resource: {
							buffer: this.uniforms,
							offset: slot * POST_UNIFORM_STRIDE,
							size: POST_UNIFORM_BYTES
						}
					},
					{ binding: 3, resource: input2.createView() }
				]
			});
			this._groups.set(key, group);
		}
		return group;
	}
}
