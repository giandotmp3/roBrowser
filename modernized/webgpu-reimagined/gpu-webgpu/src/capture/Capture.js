/** GPUBufferUsage / GPUMapMode bits (numeric so Node tests need no WebGPU globals). */
const BUFFER_MAP_READ = 0x01;
const BUFFER_COPY_DST = 0x08;
const MAP_READ = 0x01;

/** Copy rows are aligned to 256 bytes (WebGPU `bytesPerRow` rule). */
export const COPY_ROW_ALIGNMENT = 256;

/**
 * Tightly packed, top-down RGBA rows from a mapped copy buffer: strips the row padding, swizzles
 * BGRA canvas formats to RGBA and writes alpha 255 (the canvas is opaque, R-CTX-001 `alpha:false`,
 * so stored alpha is never displayed).
 * @param {Uint8Array} src  Mapped rows, `bytesPerRow` apart
 * @param {{width: number, height: number, bytesPerRow: number, format: string}} layout
 * @returns {Uint8ClampedArray}
 */
export function unpackRows(src, { width, height, bytesPerRow, format }) {
	const bgra = format.startsWith('bgra');
	const out = new Uint8ClampedArray(width * height * 4);
	for (let y = 0; y < height; y++) {
		const s = y * bytesPerRow;
		const d = y * width * 4;
		for (let x = 0; x < width * 4; x += 4) {
			out[d + x] = src[s + x + (bgra ? 2 : 0)];
			out[d + x + 1] = src[s + x + 1];
			out[d + x + 2] = src[s + x + (bgra ? 0 : 2)];
			out[d + x + 3] = 255;
		}
	}
	return out;
}

/**
 * C-20 in-frame capture (architecture §2.2 "Capture"): on request, the final frame, after the
 * whole post chain (so after any VerticalFlip) or the blit, is copied inside the frame's command
 * encoder to a MAP_READ buffer, then mapped once the frame is submitted, and handed over as an
 * ImageData-like `{width, height, data}` (top-down RGBA rows) for ScreenShot.js; html2canvas
 * composites the DOM overlays above it. Replaces legacy `preserveDrawingBuffer: true`.
 */
export class Capture {
	/** @param {{device?: GPUDevice}} deps */
	constructor(deps = {}) {
		this.device = deps.device ?? null;
		/** @type {{resolve: (img: CaptureImage) => void, reject: (err: unknown) => void}[]} */
		this._requests = [];
	}

	/**
	 * Capture the next drawn frame.
	 * @returns {Promise<CaptureImage>}
	 */
	request() {
		return new Promise((resolve, reject) => this._requests.push({ resolve, reject }));
	}

	get pending() {
		return this._requests.length > 0;
	}

	/**
	 * Encode the copy of `texture` (the frame's final colour: the swapchain texture, configured with
	 * COPY_SRC) for every pending request. Call before `queue.submit`, then `finish()` the returned job
	 * after it (the buffer can only be mapped once the copy is submitted).
	 * @param {GPUCommandEncoder} encoder
	 * @param {GPUTexture} texture
	 * @param {{width: number, height: number, format: string}} frame
	 * @returns {{finish: () => Promise<void>}|null}  null when nothing is pending
	 */
	encode(encoder, texture, { width, height, format }) {
		if (!this.pending) {
			return null;
		}
		const requests = this._requests.splice(0);
		const bytesPerRow = Math.ceil((width * 4) / COPY_ROW_ALIGNMENT) * COPY_ROW_ALIGNMENT;
		const buffer = this.device.createBuffer({
			label: 'capture',
			size: bytesPerRow * height,
			usage: BUFFER_MAP_READ | BUFFER_COPY_DST
		});
		encoder.copyTextureToBuffer(
			{ texture },
			{ buffer, bytesPerRow, rowsPerImage: height },
			{ width, height, depthOrArrayLayers: 1 }
		);
		const finish = async () => {
			try {
				await buffer.mapAsync(MAP_READ);
				const data = unpackRows(new Uint8Array(buffer.getMappedRange()), {
					width,
					height,
					bytesPerRow,
					format
				});
				buffer.unmap();
				for (const { resolve } of requests) {
					resolve({ width, height, data });
				}
			} catch (err) {
				// Device lost between the submit and the map: the frame is gone.
				for (const { reject } of requests) {
					reject(err);
				}
			} finally {
				buffer.destroy?.();
			}
		};
		return { finish };
	}

	/** Device loss: requests still pending wait for the first frame on the new device. */
	reset(device) {
		this.device = device;
	}
}

/**
 * @typedef {{width: number, height: number, data: Uint8ClampedArray}} CaptureImage  ImageData-like, top-down rows
 */
