import { DEFAULT_DEPTH_COMPARE, DEPTH_FORMAT, MSAA_SAMPLES, RENDER_FORMAT } from '../constants.js';
import { toGpuBlend } from './blendMap.js';
import { NORMAL, pipelineSpecKey } from './pipelineKey.js';

/**
 * GPUColorWrite RED | GREEN | BLUE. Legacy draws into buffers without an alpha
 * channel (R-CTX-001 context `alpha: false`; the PostProcess FBO is `gl.RGB`), so a
 * blend factor reading the destination alpha sees 1: DST_ALPHA = 1,
 * ONE_MINUS_DST_ALPHA = 0, SRC_ALPHA_SATURATE = min(As, 1 − 1) = 0 (STR D3D 7/8/11).
 * The rgba8unorm scene target reproduces that by never writing alpha: it keeps the
 * clear alpha (1, opaque clear colours) under every blend.
 */
export const SCENE_WRITE_MASK = 0x7;

/**
 * Build the GPURenderPipelineDescriptor for a spec. Depth test off is expressed
 * as depthCompare 'always' (pipelines always carry the single depth attachment);
 * like GL, a disabled depth test also writes no depth.
 * @param {import('./pipelineKey.js').PipelineSpec} spec
 * @param {{module: GPUShaderModule, layout: GPUPipelineLayout|'auto', buffers?: GPUVertexBufferLayout[], vertexEntry?: string, fragmentEntry?: string}} shader
 * @param {{sampleCount?: number, depthFormat?: GPUTextureFormat}} [options]  sampleCount 1 when the target has MSAA
 *   off; depthFormat: the scene target's (default depth24plus; the backend smoke page also runs depth16unorm)
 */
export function describePipeline(spec, shader, { sampleCount = MSAA_SAMPLES, depthFormat = DEPTH_FORMAT } = {}) {
	return {
		label: pipelineSpecKey(spec),
		layout: shader.layout,
		vertex: { module: shader.module, entryPoint: shader.vertexEntry ?? 'vs_main', buffers: shader.buffers ?? [] },
		fragment: {
			module: shader.module,
			entryPoint: shader.fragmentEntry ?? 'fs_main',
			targets: [{ format: RENDER_FORMAT, blend: toGpuBlend(spec.blend), writeMask: SCENE_WRITE_MASK }]
		},
		primitive: { topology: spec.topology ?? 'triangle-list', cullMode: 'none' },
		depthStencil: {
			format: depthFormat,
			depthWriteEnabled: Boolean(spec.depthTest && spec.depthWrite),
			depthCompare: spec.depthTest ? DEFAULT_DEPTH_COMPARE : 'always'
		},
		multisample: { count: sampleCount }
	};
}

/**
 * Build-time blend-pair census -> spec list (architecture §2.2 "Pipelines").
 * Normal alpha is always present so the fallback below can never miss.
 * @param {{family: string, blends: ReadonlyArray<{src: string, dst: string}>, depth: ReadonlyArray<{depthTest: boolean, depthWrite: boolean}>}[]} census
 * @returns {import('./pipelineKey.js').PipelineSpec[]}
 */
export function expandCensus(census) {
	const out = new Map();
	for (const { family, blends, depth } of census) {
		for (const blend of [NORMAL, ...blends]) {
			for (const d of depth) {
				const spec = { family, blend, depthTest: d.depthTest, depthWrite: d.depthWrite };
				out.set(pipelineSpecKey(spec), spec);
			}
		}
	}
	return [...out.values()];
}

/**
 * Precompiled pipeline set. All census pipelines are compiled with
 * createRenderPipelineAsync at device init; an uncommon pair still compiling
 * falls back to normal alpha (same family/depth) for that frame.
 */
export class PipelineSet {
	/**
	 * @param {GPUDevice} device
	 * @param {(family: string) => {module: any, layout: any, buffers?: any[], vertexEntry?: string, fragmentEntry?: string}} shaderFor
	 * @param {{sampleCount?: number, depthFormat?: GPUTextureFormat}} [options]
	 */
	constructor(device, shaderFor, { sampleCount = MSAA_SAMPLES, depthFormat = DEPTH_FORMAT } = {}) {
		this._device = device;
		this._shaderFor = shaderFor;
		this._sampleCount = sampleCount;
		this._depthFormat = depthFormat;
		/** @type {Map<string, GPURenderPipeline>} */
		this._ready = new Map();
		/** @type {Map<string, Promise<GPURenderPipeline>>} */
		this._pending = new Map();
	}

	/** @param {import('./pipelineKey.js').PipelineSpec} spec */
	compile(spec) {
		const key = pipelineSpecKey(spec);
		if (this._ready.has(key) || this._pending.has(key)) {
			return this._pending.get(key) ?? Promise.resolve(this._ready.get(key));
		}
		const p = this._device
			.createRenderPipelineAsync(
				describePipeline(spec, this._shaderFor(spec.family), {
					sampleCount: this._sampleCount,
					depthFormat: this._depthFormat
				})
			)
			.then(pipeline => {
				this._ready.set(key, pipeline);
				this._pending.delete(key);
				return pipeline;
			});
		this._pending.set(key, p);
		return p;
	}

	/**
	 * Compile every census spec. Normal-alpha variants are awaited first so the
	 * fallback is guaranteed before the first frame.
	 * @param {import('./pipelineKey.js').PipelineSpec[]} specs
	 */
	async precompile(specs) {
		const isNormal = s => s.blend.src === NORMAL.src && s.blend.dst === NORMAL.dst;
		await Promise.all(specs.filter(isNormal).map(s => this.compile(s)));
		specs.filter(s => !isNormal(s)).forEach(s => this.compile(s));
	}

	/**
	 * @param {import('./pipelineKey.js').PipelineSpec} spec
	 * @returns {{pipeline: GPURenderPipeline|null, fellBack: boolean}}
	 */
	get(spec) {
		const ready = this._ready.get(pipelineSpecKey(spec));
		if (ready) {
			return { pipeline: ready, fellBack: false };
		}
		this.compile(spec);
		const fallback = this._ready.get(pipelineSpecKey({ ...spec, blend: NORMAL }));
		return { pipeline: fallback ?? null, fellBack: true };
	}

	/** Resolves once every pipeline requested so far has compiled (tests, harness warm-up). */
	async settled() {
		while (this._pending.size) {
			await Promise.all([...this._pending.values()]);
		}
	}

	get readyCount() {
		return this._ready.size;
	}
}
