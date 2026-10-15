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
	/** @param {GPUDevice} device */
	constructor(device) {
		this._device = device;
		this.msaa = null;
		this.depth = null;
		this.resolve = null;
		this.width = 0;
		this.height = 0;
	}

	/** Descriptors (exposed so tests can assert format/sample count without a GPU). */
	static descriptors(width, height) {
		const size = { width, height };
		const RENDER_ATTACHMENT = 0x10;
		const TEXTURE_BINDING = 0x04;
		const COPY_SRC = 0x01;
		return {
			msaa: { size, format: RENDER_FORMAT, sampleCount: MSAA_SAMPLES, usage: RENDER_ATTACHMENT },
			depth: { size, format: DEPTH_FORMAT, sampleCount: MSAA_SAMPLES, usage: RENDER_ATTACHMENT },
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
		const d = OffscreenTarget.descriptors(width, height);
		this.msaa = this._device.createTexture(d.msaa);
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
		return {
			colorAttachments: [
				{
					view: this.msaa.createView(),
					resolveTarget: this.resolve.createView(),
					clearValue: { r, g, b, a },
					loadOp: 'clear',
					storeOp: 'discard'
				}
			],
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
