import { DEPTH_FORMAT, MSAA_SAMPLES, PERF_SCENE_SCALE, RENDER_FORMAT } from '../constants.js';

/**
 * Scene size in device pixels. R-PP-003: performance mode renders the scene at
 * 0.75x and the Upsampling pass restores full size.
 * @param {{width: number, height: number, performanceMode: boolean}} p
 */
export function sceneSize({ width, height, performanceMode }) {
	const s = performanceMode ? PERF_SCENE_SCALE : 1;
	return { width: Math.max(1, Math.floor(width * s)), height: Math.max(1, Math.floor(height * s)) };
}

/**
 * The single offscreen scene target: rgba8unorm 4x MSAA colour + depth24plus,
 * resolved into a single-sample rgba8unorm texture, then post-processed or
 * blitted to the swapchain (architecture §2.2 "Single render format").
 */
export class OffscreenTarget {
	/**
	 * @param {GPUDevice} device
	 * @param {{sampleCount?: number, depthFormat?: GPUTextureFormat}} [options]  sampleCount 1 renders straight
	 *   into the resolve texture (MSAA off); depthFormat must match the pipelines' (default depth24plus)
	 */
	constructor(device, { sampleCount = MSAA_SAMPLES, depthFormat = DEPTH_FORMAT } = {}) {
		this._device = device;
		this.sampleCount = sampleCount;
		this.depthFormat = depthFormat;
		this.msaa = null;
		this.depth = null;
		this.resolve = null;
		this.width = 0;
		this.height = 0;
	}

	/** Descriptors (exposed so tests can assert format/sample count without a GPU). */
	static descriptors(width, height, sampleCount = MSAA_SAMPLES, depthFormat = DEPTH_FORMAT) {
		const size = { width, height };
		const RENDER_ATTACHMENT = 0x10;
		const TEXTURE_BINDING = 0x04;
		const COPY_SRC = 0x01;
		return {
			msaa: sampleCount > 1 ? { size, format: RENDER_FORMAT, sampleCount, usage: RENDER_ATTACHMENT } : null,
			depth: { size, format: depthFormat, sampleCount, usage: RENDER_ATTACHMENT },
			resolve: {
				size,
				format: RENDER_FORMAT,
				sampleCount: 1,
				usage: RENDER_ATTACHMENT | TEXTURE_BINDING | COPY_SRC
			}
		};
	}

	resize(width, height) {
		if (width === this.width && height === this.height) {
			return;
		}
		this.destroy();
		const d = OffscreenTarget.descriptors(width, height, this.sampleCount, this.depthFormat);
		this.msaa = d.msaa ? this._device.createTexture(d.msaa) : null;
		this.depth = this._device.createTexture(d.depth);
		this.resolve = this._device.createTexture(d.resolve);
		this.width = width;
		this.height = height;
	}

	/**
	 * Scene pass attachments; clear colour comes from the sky (R-CTX-009).
	 * @param {[number, number, number, number]} clearColor
	 */
	passDescriptor(clearColor, occlusionQuerySet = null) {
		const [r, g, b, a] = clearColor;
		const color = this.msaa
			? { view: this.msaa.createView(), resolveTarget: this.resolve.createView(), storeOp: 'discard' }
			: { view: this.resolve.createView(), storeOp: 'store' };
		return {
			colorAttachments: [{ ...color, clearValue: { r, g, b, a }, loadOp: 'clear' }],
			depthStencilAttachment: {
				view: this.depth.createView(),
				depthClearValue: 1.0,
				depthLoadOp: 'clear',
				depthStoreOp: 'discard'
			},
			...(occlusionQuerySet ? { occlusionQuerySet } : {})
		};
	}

	destroy() {
		for (const t of [this.msaa, this.depth, this.resolve]) {
			t?.destroy?.();
		}
		this.msaa = this.depth = this.resolve = null;
		this.width = this.height = 0;
	}
}
