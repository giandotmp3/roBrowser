/**
 * Thrown by API stubs whose behaviour is specified but not yet built.
 * Acceptance tests for these paths are marked `it.fails` and tagged with the rule ID.
 */
export class NotImplementedError extends Error {
	/** @param {string} what  Usually `'<Class>.<method> (<rule or capability ID>)'` */
	constructor(what) {
		super(`Not implemented: ${what}`);
		this.name = 'NotImplementedError';
	}
}

/** No WebGPU adapter/device is available; the caller selects the gpu-webgl2 backend. */
export class DeviceUnavailableError extends Error {
	constructor(reason) {
		super(`WebGPU unavailable: ${reason}`);
		this.name = 'DeviceUnavailableError';
	}
}

/** A device limit required by a resource is not met (NFR-08). */
export class DeviceLimitError extends Error {
	constructor(limit, required, available) {
		super(`Device limit ${limit} too small: need ${required}, have ${available}`);
		this.name = 'DeviceLimitError';
		this.limit = limit;
	}
}
