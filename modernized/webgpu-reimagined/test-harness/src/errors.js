/** Harness error types. */

/** Thrown by a subject capability that has not been implemented yet (rule stays pending). */
export class NotImplementedError extends Error {
	constructor(what) {
		super(`not implemented: ${what}`);
		this.name = 'NotImplementedError';
	}
}

/** Thrown when a scene script or record violates the harness contract. */
export class HarnessContractError extends Error {
	constructor(message) {
		super(message);
		this.name = 'HarnessContractError';
	}
}
