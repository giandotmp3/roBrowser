import { GL } from '../pipeline/glEnums.js';

/**
 * Streaming instance buffer. Each run appends its instances after the
 * previous run's; when the buffer is full it is orphaned (`bufferData` with a
 * fresh store, so the driver never stalls on in-flight draws) and writing
 * restarts at 0. A run larger than the whole buffer grows it (power of two).
 */
export class InstanceRing {
	/** @param {{gl: WebGL2RenderingContext, capacityBytes?: number}} deps */
	constructor({ gl, capacityBytes = 1 << 18 }) {
		this.gl = gl;
		this.capacity = capacityBytes;
		this.buffer = null;
		this.offset = 0;
		/** Number of times the store was orphaned (wrap or growth). */
		this.orphans = 0;
	}

	/**
	 * Upload one run's instances.
	 * @param {Float32Array} data
	 * @returns {number} byte offset of the run in the buffer (bound to ARRAY_BUFFER on return)
	 */
	write(data) {
		const { gl } = this;
		const bytes = data.byteLength;
		if (!this.buffer) {
			this.buffer = gl.createBuffer();
			gl.bindBuffer(GL.ARRAY_BUFFER, this.buffer);
			this._orphan(bytes, false);
		} else {
			gl.bindBuffer(GL.ARRAY_BUFFER, this.buffer);
			if (this.offset + bytes > this.capacity) {
				this._orphan(bytes, true);
			}
		}
		const at = this.offset;
		gl.bufferSubData(GL.ARRAY_BUFFER, at, data);
		this.offset = at + bytes;
		return at;
	}

	_orphan(bytes, counted) {
		while (this.capacity < bytes) {
			this.capacity *= 2;
		}
		this.gl.bufferData(GL.ARRAY_BUFFER, this.capacity, GL.DYNAMIC_DRAW);
		this.offset = 0;
		if (counted) {
			this.orphans++;
		}
	}

	/** R-CTX-006: the buffer died with the context. */
	reset() {
		this.buffer = null;
		this.offset = 0;
	}
}
