/**
 * WebGPU side of the parity pages: adapter and device, an opaque canvas, the
 * gpu-webgpu offscreen target + blit, and the canvas read-back
 * (copyTextureToBuffer + mapAsync) as bottom-up RGBA rows that line up with
 * gl.readPixels.
 */
import { OffscreenTarget } from '../src/target/OffscreenTarget.js';
import { Blit } from '../src/target/Blit.js';

/** GPUTextureUsage / GPUBufferUsage / GPUMapMode bits. */
const TEXTURE_COPY_SRC = 0x01;
const TEXTURE_RENDER_ATTACHMENT = 0x10;
const BUFFER_MAP_READ = 0x01;
const BUFFER_COPY_DST = 0x08;
const MAP_READ = 0x01;

/**
 * @param {{width: number, height: number, antialias: boolean, clearColor: number[], label?: string}} options
 * @returns {Promise<object>} `{noAdapter: true, reason}` when WebGPU is unavailable
 */
export async function createWebGpuSide({ width, height, antialias, clearColor, label = 'gpu-webgpu' }) {
	if (!navigator.gpu) {
		return { noAdapter: true, reason: 'navigator.gpu missing' };
	}
	const adapter = await navigator.gpu.requestAdapter();
	if (!adapter) {
		return { noAdapter: true, reason: 'requestAdapter() returned null' };
	}
	const device = await adapter.requestDevice();
	const errors = [];
	device.addEventListener('uncapturederror', e => errors.push(String(e.error?.message ?? e.error)));
	device.lost.then(info => errors.push(`device lost: ${info.reason} ${info.message}`));

	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	canvas.title = label;
	document.getElementById('canvases').append(canvas);
	const context = canvas.getContext('webgpu');
	const format = navigator.gpu.getPreferredCanvasFormat();
	context.configure({
		device,
		format,
		alphaMode: 'opaque',
		usage: TEXTURE_RENDER_ATTACHMENT | TEXTURE_COPY_SRC
	});

	const sampleCount = antialias ? 4 : 1;
	const target = new OffscreenTarget(device, { sampleCount });
	target.resize(width, height);
	const blit = await new Blit({ device, format }).init();
	const info = adapter.info ?? {};

	/**
	 * Encode one frame (`encodeScene(pass)` inside the target's render pass), blit it to
	 * the canvas and read the canvas back.
	 * @param {(pass: GPURenderPassEncoder) => T} encodeScene
	 * @returns {Promise<{pixels: Uint8Array, result: T}>}
	 * @template T
	 */
	async function render(encodeScene) {
		const encoder = device.createCommandEncoder();
		const pass = encoder.beginRenderPass(target.passDescriptor(clearColor));
		const result = encodeScene(pass);
		pass.end();

		const swap = context.getCurrentTexture();
		blit.encode(encoder, target.resolve, swap.createView());

		const bytesPerRow = Math.ceil((width * 4) / 256) * 256; // copy rows are 256-byte aligned
		const buffer = device.createBuffer({ size: bytesPerRow * height, usage: BUFFER_MAP_READ | BUFFER_COPY_DST });
		encoder.copyTextureToBuffer(
			{ texture: swap },
			{ buffer, bytesPerRow, rowsPerImage: height },
			{ width, height, depthOrArrayLayers: 1 }
		);
		device.queue.submit([encoder.finish()]);
		await buffer.mapAsync(MAP_READ);
		const src = new Uint8Array(buffer.getMappedRange());
		const bgra = format.startsWith('bgra');
		const out = new Uint8Array(width * height * 4);
		for (let y = 0; y < height; y++) {
			const s = y * bytesPerRow;
			const d = (height - 1 - y) * width * 4; // WebGPU row 0 is the top; GL's is the bottom
			for (let x = 0; x < width * 4; x += 4) {
				out[d + x] = src[s + x + (bgra ? 2 : 0)];
				out[d + x + 1] = src[s + x + 1];
				out[d + x + 2] = src[s + x + (bgra ? 0 : 2)];
				// alphaMode 'opaque' (legacy: alpha:false): compare what is shown.
				out[d + x + 3] = 255;
			}
		}
		buffer.unmap();
		buffer.destroy();
		return { pixels: out, result };
	}

	/** Bottom-up RGBA rows → PNG data URL (screen orientation). */
	function toPng(rows) {
		const png = document.createElement('canvas');
		png.width = width;
		png.height = height;
		const ctx = png.getContext('2d');
		const img = ctx.createImageData(width, height);
		for (let y = 0; y < height; y++) {
			img.data.set(rows.subarray((height - 1 - y) * width * 4, (height - y) * width * 4), y * width * 4);
		}
		ctx.putImageData(img, 0, 0);
		return png.toDataURL('image/png');
	}

	return {
		device,
		errors,
		format,
		sampleCount,
		render,
		toPng,
		adapter: `${info.vendor ?? ''} ${info.architecture ?? ''} ${info.description ?? ''}`.trim(),
		fallbackAdapter: Boolean(info.isFallbackAdapter ?? adapter.isFallbackAdapter)
	};
}
