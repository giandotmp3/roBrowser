import { DeviceUnavailableError, DeviceLimitError } from '../errors.js';
import { CLEAR_DEPTH, DEFAULT_DEPTH_COMPARE, DEPTH_FORMAT, MSAA_SAMPLES, RENDER_FORMAT } from '../constants.js';

/**
 * WebGPU translation of the legacy context attributes (R-CTX-001).
 * - alpha:false            -> canvas alphaMode 'opaque'
 * - depth:true             -> depth24plus attachment on the offscreen target
 * - stencil:false          -> no stencil aspect
 * - antialias:true         -> 4x MSAA offscreen target
 * - premultipliedAlpha:false -> irrelevant with an opaque canvas
 * - preserveDrawingBuffer:true -> replaced by explicit in-frame Capture (C-20)
 * - powerPreference        -> 'high-performance'
 */
export const DEVICE_REQUEST = Object.freeze({
	adapter: Object.freeze({ powerPreference: 'high-performance' }),
	canvas: Object.freeze({ alphaMode: 'opaque' }),
	target: Object.freeze({ format: RENDER_FORMAT, depthFormat: DEPTH_FORMAT, stencil: false, sampleCount: MSAA_SAMPLES })
});

/** Default pipeline state every pipeline starts from (R-CTX-002). */
export const DEFAULT_PIPELINE_STATE = Object.freeze({
	clearDepth: CLEAR_DEPTH,
	depthCompare: DEFAULT_DEPTH_COMPARE,
	depthWriteEnabled: true,
	blend: Object.freeze({
		color: Object.freeze({ srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' }),
		alpha: Object.freeze({ srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' })
	})
});

/** Limits the backend depends on (NFR-08). */
export const REQUIRED_LIMITS = Object.freeze({
	maxTextureDimension2D: 2048,
	maxTextureArrayLayers: 64
});

/**
 * Session-scoped GPU device. Owns adapter, device and the main canvas context.
 * All GPU handles are scoped to an instance (spec §2.3 item 1): no module-level singletons.
 */
export class RenderDevice {
	/**
	 * @param {{gpu: import('../ports.js').GpuPort|undefined|null, canvas: import('../ports.js').CanvasPort}} deps
	 */
	constructor({ gpu, canvas }) {
		this._gpu = gpu;
		this._canvas = canvas;
		/** @type {GPUAdapter|null} */
		this.adapter = null;
		/** @type {GPUDevice|null} */
		this.device = null;
		/** @type {GPUCanvasContext|null} */
		this.context = null;
		this.canvasFormat = null;
		this.lost = false;
		/** @type {Promise<{reason: string, message: string}>|null} */
		this.lostPromise = null;
	}

	/**
	 * Acquire adapter + device and configure the canvas. Throws
	 * DeviceUnavailableError when WebGPU cannot be used, so the facade selects
	 * gpu-webgl2 (the WebGPU equivalent of legacy "throws and does not render").
	 */
	async init() {
		if (!this._gpu) {
			throw new DeviceUnavailableError('navigator.gpu missing');
		}
		const adapter = await this._gpu.requestAdapter(DEVICE_REQUEST.adapter);
		if (!adapter) {
			throw new DeviceUnavailableError('no adapter');
		}
		for (const [limit, required] of Object.entries(REQUIRED_LIMITS)) {
			const available = adapter.limits?.[limit] ?? 0;
			if (available < required) {
				throw new DeviceLimitError(limit, required, available);
			}
		}
		const device = await adapter.requestDevice({ requiredLimits: { ...REQUIRED_LIMITS } });
		const context = this._canvas.getContext('webgpu');
		if (!context) {
			throw new DeviceUnavailableError('canvas has no webgpu context');
		}
		this.canvasFormat = this._gpu.getPreferredCanvasFormat();
		context.configure({ device, format: this.canvasFormat, alphaMode: DEVICE_REQUEST.canvas.alphaMode });
		this.adapter = adapter;
		this.device = device;
		this.context = context;
		this.lost = false;
		this.lostPromise = device.lost.then(info => {
			this.lost = true;
			return info;
		});
		return this;
	}

	/** Limit lookup used by residency / storage-buffer guards (NFR-08). */
	limit(name) {
		return this.device?.limits?.[name] ?? this.adapter?.limits?.[name] ?? 0;
	}

	destroy() {
		this.context?.unconfigure?.();
		this.device?.destroy?.();
		this.device = null;
		this.context = null;
	}
}
