/** Base error for the preview2d module. */
export class Preview2DError extends Error {
	constructor(message) {
		super(message);
		this.name = 'Preview2DError';
	}
}

/** Thrown by API stubs that are scaffolded but not yet implemented. */
export class NotImplementedError extends Preview2DError {
	/** @param {string} what */
	constructor(what) {
		super(`preview2d: ${what} is not implemented yet`);
		this.name = 'NotImplementedError';
	}
}
