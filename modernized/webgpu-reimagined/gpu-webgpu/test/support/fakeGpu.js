/**
 * Fake WebGPU surface for Node tests. Records every call so tests can assert
 * descriptors without a real adapter. Only what the scaffold touches is faked.
 */
export function createFakeGpu({ adapter = true, limits = {}, adapterInfo = {}, compileDelay = null } = {}) {
	const calls = [];
	let loseDevice;
	const lost = new Promise(resolve => {
		loseDevice = resolve;
	});
	const defaultLimits = {
		maxTextureDimension2D: 8192,
		maxTextureArrayLayers: 256,
		maxStorageBufferBindingSize: 134217728
	};
	const deviceLimits = { ...defaultLimits, ...limits };

	const texture = desc => ({
		desc,
		createView: (view = {}) => ({ texture: desc, ...view }),
		destroy: () => calls.push(['texture.destroy', desc])
	});

	const device = {
		limits: deviceLimits,
		lost,
		queue: {
			writeBuffer: (...a) => calls.push(['queue.writeBuffer', a]),
			writeTexture: (...a) => calls.push(['queue.writeTexture', a]),
			submit: cmds => calls.push(['queue.submit', cmds])
		},
		createTexture: desc => {
			calls.push(['createTexture', desc]);
			return texture(desc);
		},
		createBuffer: desc => {
			calls.push(['createBuffer', desc]);
			return { desc, destroy() {}, mapAsync: async () => {}, getMappedRange: () => new ArrayBuffer(desc.size) };
		},
		createSampler: desc => {
			calls.push(['createSampler', desc]);
			return { desc };
		},
		createQuerySet: desc => {
			calls.push(['createQuerySet', desc]);
			return { desc, destroy() {} };
		},
		createBindGroupLayout: desc => {
			calls.push(['createBindGroupLayout', desc]);
			return { desc };
		},
		createPipelineLayout: desc => {
			calls.push(['createPipelineLayout', desc]);
			return { desc };
		},
		createBindGroup: desc => {
			calls.push(['createBindGroup', desc]);
			return { desc };
		},
		createShaderModule: desc => {
			calls.push(['createShaderModule', desc]);
			return { desc };
		},
		createRenderPipelineAsync: desc => {
			calls.push(['createRenderPipelineAsync', desc]);
			const pipeline = { desc };
			if (compileDelay && compileDelay(desc)) {
				return new Promise(() => {}); // never resolves: simulates a pair still compiling
			}
			return Promise.resolve(pipeline);
		},
		destroy: () => calls.push(['device.destroy'])
	};

	const fakeAdapter = {
		limits: deviceLimits,
		info: { vendor: '', architecture: '', description: '', ...adapterInfo },
		requestDevice: async desc => {
			calls.push(['requestDevice', desc]);
			return device;
		}
	};

	const gpu = {
		requestAdapter: async opts => {
			calls.push(['requestAdapter', opts]);
			return adapter ? fakeAdapter : null;
		},
		getPreferredCanvasFormat: () => 'bgra8unorm'
	};

	const context = {
		configure: cfg => calls.push(['context.configure', cfg]),
		unconfigure: () => calls.push(['context.unconfigure']),
		getCurrentTexture: () => texture({ swapchain: true })
	};
	const canvas = { width: 800, height: 600, getContext: type => (type === 'webgpu' ? context : null) };

	return {
		gpu,
		canvas,
		device,
		adapter: fakeAdapter,
		context,
		calls,
		loseDevice: (reason = 'unknown') => loseDevice({ reason, message: 'fake loss' })
	};
}

/** In-memory settings port. */
export function fakeSettings(initial = {}) {
	const store = { ...initial };
	return { get: k => store[k], set: (k, v) => (store[k] = v), store };
}
