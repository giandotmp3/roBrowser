/**
 * Fake WebGPU surface for Node tests. Records every call so tests can assert
 * descriptors without a real adapter. Only what the code under test touches is faked.
 *
 * Every `requestDevice` after the first returns a NEW device (a device-loss rebuild gets
 * a fresh one); `fake.device` is the first, `fake.devices` all of them. `loseDevice(reason)`
 * resolves the latest device's `lost`; `device.destroy()` resolves it with 'destroyed', as in
 * browsers. `adapter` may be toggled later through `fake.setAdapter(false)` (no adapter on
 * rebuild). Command encoders record passes and draws into `calls`.
 */
export function createFakeGpu({ adapter = true, limits = {}, adapterInfo = {}, compileDelay = null } = {}) {
	const calls = [];
	let adapterAvailable = adapter;
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

	const pass = desc => {
		const record =
			name =>
			(...a) =>
				calls.push([`pass.${name}`, a]);
		return {
			desc,
			setPipeline: record('setPipeline'),
			setBindGroup: record('setBindGroup'),
			setVertexBuffer: record('setVertexBuffer'),
			setBlendConstant: record('setBlendConstant'),
			beginOcclusionQuery: record('beginOcclusionQuery'),
			endOcclusionQuery: record('endOcclusionQuery'),
			draw: record('draw'),
			end: record('end')
		};
	};

	const devices = [];
	function makeDevice() {
		let resolveLost;
		const lost = new Promise(resolve => {
			resolveLost = resolve;
		});
		const listeners = new Map();
		const device = {
			id: devices.length,
			limits: deviceLimits,
			lost,
			destroyed: false,
			queue: {
				writeBuffer: (...a) => calls.push(['queue.writeBuffer', a]),
				writeTexture: (...a) => calls.push(['queue.writeTexture', a]),
				submit: cmds => calls.push(['queue.submit', cmds]),
				onSubmittedWorkDone: async () => {}
			},
			addEventListener: (type, fn) => listeners.set(type, [...(listeners.get(type) ?? []), fn]),
			dispatch: (type, event) => (listeners.get(type) ?? []).forEach(fn => fn(event)),
			createTexture: desc => {
				calls.push(['createTexture', desc]);
				return texture(desc);
			},
			createBuffer: desc => {
				calls.push(['createBuffer', desc]);
				const data = new ArrayBuffer(desc.size);
				return {
					desc,
					data,
					destroy() {},
					unmap() {},
					mapAsync: async () => {
						if (device.destroyed) {
							throw new Error('device lost');
						}
					},
					getMappedRange: (offset = 0, size = desc.size - offset) => data.slice(offset, offset + size)
				};
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
				return { desc, getCompilationInfo: async () => ({ messages: [] }) };
			},
			createRenderPipeline: desc => {
				calls.push(['createRenderPipeline', desc, device.id]);
				return { desc, device: device.id };
			},
			createRenderPipelineAsync: desc => {
				calls.push(['createRenderPipelineAsync', desc, device.id]);
				const pipeline = { desc, device: device.id };
				if (compileDelay && compileDelay(desc)) {
					return new Promise(() => {}); // never resolves: simulates a pair still compiling
				}
				return Promise.resolve(pipeline);
			},
			createCommandEncoder: desc => {
				calls.push(['createCommandEncoder', desc, device.id]);
				return {
					beginRenderPass: d => {
						calls.push(['beginRenderPass', d]);
						return pass(d);
					},
					copyTextureToBuffer: (...a) => calls.push(['copyTextureToBuffer', a]),
					resolveQuerySet: (...a) => calls.push(['resolveQuerySet', a]),
					copyBufferToBuffer: (...a) => calls.push(['copyBufferToBuffer', a]),
					finish: () => ({ commands: true, device: device.id })
				};
			},
			destroy: () => {
				calls.push(['device.destroy', device.id]);
				device.destroyed = true;
				resolveLost({ reason: 'destroyed', message: 'Device destroyed' });
			},
			lose: (reason = 'unknown') => {
				device.destroyed = true;
				resolveLost({ reason, message: 'fake loss' });
			}
		};
		devices.push(device);
		return device;
	}
	const firstDevice = makeDevice();

	const fakeAdapter = {
		limits: deviceLimits,
		info: { vendor: '', architecture: '', description: '', ...adapterInfo },
		requestDevice: async desc => {
			calls.push(['requestDevice', desc]);
			const used = calls.filter(c => c[0] === 'requestDevice').length;
			return used === 1 ? firstDevice : makeDevice();
		}
	};

	const gpu = {
		requestAdapter: async opts => {
			calls.push(['requestAdapter', opts]);
			return adapterAvailable ? fakeAdapter : null;
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
		device: firstDevice,
		devices,
		adapter: fakeAdapter,
		context,
		calls,
		setAdapter: available => {
			adapterAvailable = available;
		},
		loseDevice: (reason = 'unknown') => devices[devices.length - 1].lose(reason)
	};
}

/** In-memory settings port. */
export function fakeSettings(initial = {}) {
	const store = { ...initial };
	return { get: k => store[k], set: (k, v) => (store[k] = v), store };
}
