/** GPUBufferUsage bits (numeric so Node tests need no WebGPU globals). */
const USAGE = Object.freeze({ COPY_DST: 0x08, VERTEX: 0x20 });

/**
 * Streaming instance-step vertex buffer, written with `queue.writeBuffer`.
 * Writes append after the previous one within a frame; `beginFrame()` rewinds
 * to 0. Rewinding is safe because queue writes are ordered with submits: the
 * previous frame's draws have consumed the data before the next write lands.
 * A frame that outgrows the buffer gets a new, larger one (power of two); draws
 * already encoded keep the old buffer alive.
 */
export class InstanceRing {
	/** @param {{device: GPUDevice, capacityBytes?: number}} deps */
	constructor({ device, capacityBytes = 1 << 18 }) {
		this.device = device;
		this.capacity = capacityBytes;
		/** @type {GPUBuffer|null} */
		this.buffer = null;
		this.offset = 0;
		/** Number of buffers allocated after the first (growth). */
		this.grows = 0;
	}

	beginFrame() {
		this.offset = 0;
	}

	/**
	 * @param {Float32Array} data
	 * @returns {{buffer: GPUBuffer, offset: number}} where the data landed
	 */
	write(data) {
		const bytes = data.byteLength;
		if (!this.buffer || this.offset + bytes > this.capacity) {
			if (this.buffer) {
				this.grows++;
				this.capacity *= 2;
			}
			while (this.capacity < bytes) {
				this.capacity *= 2;
			}
			this.buffer = this.device.createBuffer({
				label: 'sprite-instances',
				size: this.capacity,
				usage: USAGE.VERTEX | USAGE.COPY_DST
			});
			this.offset = 0;
		}
		const at = this.offset;
		this.device.queue.writeBuffer(this.buffer, at, data.buffer, data.byteOffset, bytes);
		// writeBuffer offsets must stay 4-byte aligned; instance data is float32, so they are.
		this.offset = at + bytes;
		return { buffer: this.buffer, offset: at };
	}

	/** Device loss: the buffer died with the device. */
	reset() {
		this.buffer = null;
		this.offset = 0;
	}
}
