import { DEFAULT_DEPTH_COMPARE, DEPTH_FORMAT, MSAA_SAMPLES, RENDER_FORMAT } from '../constants.js';
import { toGpuBlend } from './blendMap.js';
import { NORMAL, pipelineSpecKey } from './pipelineKey.js';

/**
 * Build the GPURenderPipelineDescriptor for a spec. Depth test off is expressed
 * as depthCompare 'always' (pipelines always carry the single depth attachment).
 * @param {import('./pipelineKey.js').PipelineSpec} spec
 * @param {{module: GPUShaderModule, layout: GPUPipelineLayout|'auto', buffers?: GPUVertexBufferLayout[]}} shader
 */
export function describePipeline(spec, shader) {
	return {
		label: pipelineSpecKey(spec),
		layout: shader.layout,
		vertex: { module: shader.module, entryPoint: 'vs_main', buffers: shader.buffers ?? [] },
		fragment: {
			module: shader.module,
			entryPoint: 'fs_main',
			targets: [{ format: RENDER_FORMAT, blend: toGpuBlend(spec.blend) }]
		},
		primitive: { topology: spec.topology ?? 'triangle-list', cullMode: 'none' },
		depthStencil: {
			format: DEPTH_FORMAT,
			depthWriteEnabled: spec.depthWrite,
			depthCompare: spec.depthTest ? DEFAULT_DEPTH_COMPARE : 'always'
		},
		multisample: { count: MSAA_SAMPLES }
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
	 * @param {(family: string) => {module: any, layout: any, buffers?: any[]}} shaderFor
	 */
	constructor(device, shaderFor) {
		this._device = device;
		this._shaderFor = shaderFor;
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
		const p = this._device.createRenderPipelineAsync(describePipeline(spec, this._shaderFor(spec.family))).then(pipeline => {
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

	get readyCount() {
		return this._ready.size;
	}
}
