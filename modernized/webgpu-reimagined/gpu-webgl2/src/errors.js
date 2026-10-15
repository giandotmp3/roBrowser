/** Raised when no WebGL2 context can be created (R-CTX-001: throw, never render). */
export class ContextUnavailableError extends Error {
	constructor(message = 'WebGL2 context unavailable') {
		super(message);
		this.name = 'ContextUnavailableError';
	}
}

/** Raised when a device limit is too small for a residency pool or matrix texture (NFR-08). */
export class DeviceLimitError extends Error {
	/**
	 * @param {string} limit
	 * @param {number} required
	 * @param {number} available
	 */
	constructor(limit, required, available) {
		super(`${limit}: required ${required}, available ${available}`);
		this.name = 'DeviceLimitError';
		this.limit = limit;
		this.required = required;
		this.available = available;
	}
}

/** Scaffold marker: thrown by stubs awaiting implementation. Tests for these are `it.fails`. */
export class NotImplementedError extends Error {
	/** @param {string} what  Rule ID or feature name */
	constructor(what) {
		super(`Not implemented: ${what}`);
		this.name = 'NotImplementedError';
	}
}
